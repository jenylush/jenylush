// Guest email workflows: invitations, RSVP confirmations, and the server-side schedule
// for reminders and updates. Send times are calculated in the wedding's own timezone
// and recalculated whenever the date, deadline or rules change.

import { now, uuid, parseJson } from './db.js';
import { buildGuestEmail, WORKFLOWS, DEFAULT_RULE_CONFIG } from './email/templates.js';
import { queueEmail, processQueue, recoverStuck } from './mailer.js';
import { zonedToUtc, addDays, utcToZonedDate } from './timezone.js';
import { weddingPlan } from './entitlements.js';
import { getWedding, loadDesign, loadSections, latestPublished, siteUrls } from './services.js';
import { resolvePalette } from '../shared/color.js';
import { getTemplate } from '../shared/templates.js';

const SCHEDULED_TYPES = Object.keys(WORKFLOWS).filter((t) => WORKFLOWS[t].scheduled);
const STALE_MS = 48 * 3600e3;

export function getRules(db, weddingId) {
  return db.all('SELECT * FROM email_automation_rules WHERE wedding_id = ?', weddingId)
    .map((r) => ({ ...r, enabled: !!r.enabled, config: { ...(DEFAULT_RULE_CONFIG[r.type] || {}), ...parseJson(r.config, {}) } }));
}

function hourStr(h) {
  const n = Math.max(0, Math.min(23, Number.isInteger(+h) ? +h : 10));
  return String(n).padStart(2, '0') + ':00';
}

// The occurrences each enabled scheduled rule should have, from today onwards.
export function desiredOccurrences(wedding, rules, entitlements, at = new Date()) {
  const out = [];
  if (wedding.automation_paused) return out;
  const weddingDate = wedding.wedding_date_local ? wedding.wedding_date_local.slice(0, 10) : null;
  const weddingAt = wedding.wedding_at_utc ? new Date(wedding.wedding_at_utc) : null;
  for (const rule of rules) {
    if (!rule.enabled || !SCHEDULED_TYPES.includes(rule.type) || !entitlements.email_workflows.includes(rule.type)) continue;
    const c = rule.config;
    const push = (key, date, payload) => {
      const sendAt = zonedToUtc(`${date}T${hourStr(c.send_hour)}`, wedding.timezone);
      if (sendAt && sendAt > at && (!weddingAt || sendAt < weddingAt)) out.push({ rule_id: rule.id, type: rule.type, key, send_at: sendAt.toISOString(), payload });
    };
    if (rule.type === 'rsvp_reminder' && wedding.rsvp_deadline) {
      for (const d of uniqDays(c.days_before_deadline)) push(`d${d}:${addDays(wedding.rsvp_deadline, -d)}`, addDays(wedding.rsvp_deadline, -d), { days_before_deadline: d });
    }
    if (rule.type === 'final_reminders' && weddingDate) {
      for (const d of uniqDays(c.days_before)) push(`d${d}:${addDays(weddingDate, -d)}`, addDays(weddingDate, -d), { days_before: d });
    }
    if (rule.type === 'biweekly_update' && weddingDate) {
      let date = /^\d{4}-\d{2}-\d{2}$/.test(c.start_date || '') ? c.start_date : addDays(utcToZonedDate(at, wedding.timezone), 1);
      for (let i = 0; i < 60 && date < weddingDate; i++, date = addDays(date, 14)) push(`b:${date}`, date, {});
    }
  }
  return out;
}

function uniqDays(list) {
  return [...new Set((Array.isArray(list) ? list : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 365))];
}

// Reconcile scheduled_messages with the rules: cancel obsolete pending messages and
// create missing ones. Messages already sent are never touched.
export function syncSchedule(db, weddingId, at = new Date()) {
  const wedding = getWedding(db, weddingId);
  if (!wedding) return { created: 0, cancelled: 0 };
  const desired = desiredOccurrences(wedding, getRules(db, weddingId), weddingPlan(db, weddingId).entitlements, at);
  const desiredKeys = new Set(desired.map((d) => `${d.type}|${d.key}`));
  let created = 0, cancelled = 0;
  db.tx(() => {
    const pending = db.all(`SELECT * FROM scheduled_messages WHERE wedding_id = ? AND status = 'pending' AND type IN (${SCHEDULED_TYPES.map(() => '?').join(',')})`, weddingId, ...SCHEDULED_TYPES);
    for (const m of pending) {
      if (!desiredKeys.has(`${m.type}|${m.occurrence_key}`)) {
        db.run("UPDATE scheduled_messages SET status = 'cancelled', processed_at = ? WHERE id = ?", now(), m.id);
        cancelled++;
      }
    }
    for (const d of desired) {
      const r = db.run(
        `INSERT INTO scheduled_messages (id, wedding_id, rule_id, type, occurrence_key, send_at, status, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
         ON CONFLICT(wedding_id, type, occurrence_key) DO UPDATE SET status = 'pending', send_at = excluded.send_at, rule_id = excluded.rule_id, processed_at = NULL
         WHERE scheduled_messages.status = 'cancelled'`,
        uuid(), weddingId, d.rule_id, d.type, d.key, d.send_at, JSON.stringify(d.payload), now()
      );
      created += r.changes;
    }
  });
  return { created, cancelled };
}

// Everything the email builders need about a wedding.
function emailContext(deps, weddingId) {
  const { db, config } = deps;
  const wedding = getWedding(db, weddingId);
  const design = loadDesign(db, weddingId);
  const published = latestPublished(db, weddingId);
  const sections = published?.snapshot?.sections || loadSections(db, weddingId);
  const details = sections.find((s) => s.type === 'details' && s.status !== 'removed');
  const allEvents = (details?.content?.events || []).filter((e) => e.name);
  const { effective } = resolvePalette(design?.palette, getTemplate(design?.template_id).defaults.palette);
  return {
    wedding, palette: { primary: effective.button }, siteUrl: siteUrls(config, wedding).primary, platformName: config.platformName,
    eventsFor: (guest) => allEvents.filter((e) => !e.restricted || guest?.private_events),
    rule: (type) => getRules(db, weddingId).find((r) => r.type === type)
  };
}

function unsubscribeUrl(config, guest) {
  return guest?.unsubscribe_token ? `${config.baseUrl}/u/${guest.unsubscribe_token}` : null;
}

function enqueueGuest(deps, ctx, type, guest, { to, dedupeKey, scheduledMessageId = null, payload = {}, rsvp = null, config }) {
  const email = buildGuestEmail(type, {
    wedding: ctx.wedding, palette: ctx.palette, siteUrl: ctx.siteUrl, platformName: ctx.platformName,
    guest, events: ctx.eventsFor(guest), config, payload, rsvp, unsubscribeUrl: unsubscribeUrl(deps.config, guest)
  });
  return queueEmail(deps.db, deps.provider, {
    weddingId: ctx.wedding.id, guestId: guest?.id, scheduledMessageId, type, to: to || guest.email,
    subject: email.subject, html: email.html, text: email.text, essential: email.essential, dedupeKey
  });
}

export function previewEmail(deps, weddingId, type, { config } = {}) {
  const ctx = emailContext(deps, weddingId);
  const rule = ctx.rule(type);
  const sample = { id: null, first_name: 'Alex', email: 'guest@example.com', invite_code: 'ABCD-1234', unsubscribe_token: 'preview', private_events: 0 };
  return buildGuestEmail(type, {
    wedding: ctx.wedding, palette: ctx.palette, siteUrl: ctx.siteUrl, platformName: ctx.platformName,
    guest: sample, events: ctx.eventsFor(sample), config: { ...(rule?.config || {}), ...(config || {}) },
    payload: { days_to_go: 42, days_before: (config?.days_before || rule?.config?.days_before || [7])[0], subject: 'Our schedule has been updated', message: 'We have added hotel suggestions and the full schedule for the day.' },
    rsvp: { name: 'Alex Morgan', attending: 'yes', events: ctx.eventsFor(sample).map((e) => e.id), plus_one_name: '' },
    unsubscribeUrl: `${deps.config.baseUrl}/u/preview`
  });
}

export function sendInvitations(deps, weddingId, guestIds, userId) {
  const { db } = deps;
  const ctx = emailContext(deps, weddingId);
  const rule = ctx.rule('invitation');
  const day = new Date().toISOString().slice(0, 10);
  const results = { queued: 0, skipped_no_email: 0, duplicate: 0, not_configured: 0, suppressed: 0 };
  for (const gid of guestIds) {
    const guest = db.get('SELECT * FROM guests WHERE id = ? AND wedding_id = ?', gid, weddingId);
    if (!guest) continue;
    if (!guest.email) { results.skipped_no_email++; continue; }
    const r = enqueueGuest(deps, ctx, 'invitation', guest, { dedupeKey: `invitation:${guest.id}:${day}`, config: rule?.config || {} });
    if (r.duplicate) { results.duplicate++; continue; }
    if (r.status === 'not_configured') results.not_configured++;
    else if (r.status === 'suppressed') results.suppressed++;
    else results.queued++;
    if (r.status === 'queued') {
      db.run("UPDATE guests SET invitation_status = 'invited', invited_at = COALESCE(invited_at, ?), updated_at = ? WHERE id = ?", now(), now(), guest.id);
      db.run("INSERT INTO invitations (id, wedding_id, guest_id, channel, delivery_log_id, created_by, created_at) VALUES (?, ?, ?, 'email', ?, ?, ?)", uuid(), weddingId, guest.id, r.id, userId, now());
    }
  }
  kick(deps);
  return results;
}

export function sendRsvpConfirmation(deps, weddingId, submission, guest) {
  const ctx = emailContext(deps, weddingId);
  const rule = ctx.rule('rsvp_confirmation');
  const to = submission.email || guest?.email;
  if (!rule?.enabled || !to) return null;
  const r = enqueueGuest(deps, ctx, 'rsvp_confirmation', guest, {
    to, dedupeKey: `rsvp_confirmation:${submission.id}`, config: rule.config,
    rsvp: { ...submission, events: parseJson(submission.events, []) }
  });
  kick(deps);
  return r;
}

export function scheduleUpdateNotification(deps, weddingId, { subject, message }) {
  const ent = weddingPlan(deps.db, weddingId).entitlements;
  if (!ent.email_workflows.includes('update_notification')) return null;
  const id = uuid();
  deps.db.run(
    "INSERT INTO scheduled_messages (id, wedding_id, rule_id, type, occurrence_key, send_at, status, payload, created_at) VALUES (?, ?, NULL, 'update_notification', ?, ?, 'pending', ?, ?)",
    id, weddingId, `u:${id}`, now(), JSON.stringify({ subject: String(subject || '').slice(0, 150), message: String(message || '').slice(0, 3000) }), now()
  );
  kick(deps);
  return id;
}

function recipientsFor(db, msg) {
  const base = 'SELECT g.* FROM guests g WHERE g.wedding_id = ? AND g.email IS NOT NULL AND g.unsubscribed_at IS NULL';
  switch (msg.type) {
    case 'rsvp_reminder':
      // Only invited guests who have not responded at all.
      return db.all(`${base} AND g.invitation_status = 'invited' AND NOT EXISTS (SELECT 1 FROM rsvp_submissions r WHERE r.guest_id = g.id)`, msg.wedding_id);
    case 'final_reminders':
      return db.all(`${base} AND EXISTS (SELECT 1 FROM rsvp_submissions r WHERE r.guest_id = g.id AND r.is_latest = 1 AND r.attending = 'yes')`, msg.wedding_id);
    case 'biweekly_update':
    case 'update_notification':
      return db.all(`${base} AND g.updates_opt_in = 1`, msg.wedding_id);
    default:
      return [];
  }
}

export function runDueMessages(deps, at = new Date()) {
  const { db } = deps;
  const due = db.all("SELECT * FROM scheduled_messages WHERE status = 'pending' AND send_at <= ? ORDER BY send_at LIMIT 20", at.toISOString());
  let processed = 0;
  for (const msg of due) {
    const claim = db.run("UPDATE scheduled_messages SET status = 'processing', processed_at = ? WHERE id = ? AND status = 'pending'", now(), msg.id);
    if (claim.changes !== 1) continue;
    const wedding = getWedding(db, msg.wedding_id);
    const ent = weddingPlan(db, msg.wedding_id).entitlements;
    const rule = msg.rule_id ? db.get('SELECT * FROM email_automation_rules WHERE id = ?', msg.rule_id) : null;
    const stillWanted = wedding && !wedding.automation_paused && ent.email_workflows.includes(msg.type) && (msg.type === 'update_notification' || rule?.enabled);
    if (!stillWanted) { db.run("UPDATE scheduled_messages SET status = 'cancelled' WHERE id = ?", msg.id); continue; }
    if (at - new Date(msg.send_at) > STALE_MS) { db.run("UPDATE scheduled_messages SET status = 'expired' WHERE id = ?", msg.id); continue; }
    const ctx = emailContext(deps, msg.wedding_id);
    const payload = parseJson(msg.payload, {});
    if (msg.type === 'biweekly_update' && wedding.wedding_at_utc) payload.days_to_go = Math.max(0, Math.ceil((new Date(wedding.wedding_at_utc) - at) / 864e5));
    const config = rule ? { ...(DEFAULT_RULE_CONFIG[msg.type] || {}), ...parseJson(rule.config, {}) } : {};
    const recipients = recipientsFor(db, msg);
    for (const guest of recipients) {
      enqueueGuest(deps, ctx, msg.type, guest, { dedupeKey: `${msg.wedding_id}:${msg.type}:${msg.occurrence_key}:${guest.id}`, scheduledMessageId: msg.id, payload, config });
    }
    db.run("UPDATE scheduled_messages SET status = 'sent', recipients = ?, processed_at = ? WHERE id = ?", recipients.length, now(), msg.id);
    processed++;
  }
  return processed;
}

// Background worker. Runs inside the app process on a timer; all state lives in the
// database, so restarts lose nothing and nothing depends on a browser being open.
export function startWorker(deps) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      recoverStuck(deps.db);
      runDueMessages(deps);
      await processQueue(deps.db, deps.provider, { baseUrl: deps.config.baseUrl });
    } catch (err) {
      console.error('worker error:', err);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, deps.config.schedulerIntervalMs);
  timer.unref();
  deps.kick = () => setImmediate(tick);
  setImmediate(tick);
  return () => clearInterval(timer);
}

function kick(deps) {
  if (deps.kick) deps.kick();
}
