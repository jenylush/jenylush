import express from 'express';
import { now, uuid, parseJson } from '../db.js';
import { member } from './access.js';
import { requireUser, hashPassword, validateEmail, createAuthToken, sha256, randomToken } from '../auth.js';
import {
  HttpError, validateBasics, createWedding, getWedding, draftState, saveDraft, publish, publishChecklist,
  siteUrls, validateSlug, slugAvailable, hasUnpublishedChanges, suggestSlug, loadQuestions
} from '../services.js';
import { weddingPlan, PlanLimitError, storageUsed } from '../entitlements.js';
import { syncSchedule, scheduleUpdateNotification } from '../notifications.js';
import { track } from '../analytics.js';
import { getTemplate } from '../../shared/templates.js';
import { coupleNames } from '../../shared/render.js';
import { sendAccountEmail } from './auth.js';
import { deleteWeddingFiles } from '../media.js';
import { deadlinePassed } from '../timezone.js';

export function rsvpCounts(db, weddingId) {
  const latest = db.get(
    `SELECT SUM(attending = 'yes') AS yes, SUM(attending = 'no') AS no, SUM(attending = 'yes' AND plus_one_name IS NOT NULL AND plus_one_name != '') AS plus_ones
     FROM rsvp_submissions WHERE wedding_id = ? AND is_latest = 1`, weddingId
  );
  const guests = db.get(
    `SELECT COUNT(*) AS total, SUM(invitation_status = 'invited') AS invited,
       SUM(NOT EXISTS (SELECT 1 FROM rsvp_submissions r WHERE r.guest_id = g.id)) AS pending
     FROM guests g WHERE g.wedding_id = ?`, weddingId
  );
  return {
    confirmed: latest.yes || 0, declined: latest.no || 0, plus_ones: latest.plus_ones || 0,
    headcount: (latest.yes || 0) + (latest.plus_ones || 0),
    pending: guests.pending || 0, guests: guests.total || 0, invited: guests.invited || 0
  };
}

export function weddingSummary(ctx, w, membership) {
  const { db, config } = ctx;
  const plan = weddingPlan(db, w.id);
  const design = db.get('SELECT template_id FROM website_designs WHERE wedding_id = ?', w.id);
  const tpl = getTemplate(design?.template_id);
  return {
    wedding: {
      id: w.id, slug: w.slug, partner1: w.partner1, partner2: w.partner2, names: coupleNames(w),
      wedding_date_local: w.wedding_date_local, timezone: w.timezone, wedding_at_utc: w.wedding_at_utc, location: w.location, tagline: w.tagline,
      status: w.status, visibility: w.visibility, has_password: !!w.site_password_hash, search_indexing: !!w.search_indexing,
      rsvp_deadline: w.rsvp_deadline, rsvp_mode: w.rsvp_mode, rsvp_plus_ones: w.rsvp_plus_ones, rsvp_collect_email: w.rsvp_collect_email,
      rsvp_dietary: !!w.rsvp_dietary, rsvp_accessibility: !!w.rsvp_accessibility, rsvp_open: !deadlinePassed(w.rsvp_deadline, w.timezone),
      automation_paused: !!w.automation_paused, custom_domain: w.custom_domain, custom_domain_verified: !!w.custom_domain_verified_at,
      setup_step: w.setup_step, visits: w.visits, published_at: w.published_at, first_published_at: w.first_published_at,
      unpublished_reason: w.unpublished_reason, unpublished_changes: hasUnpublishedChanges(db, w), locale: w.locale
    },
    urls: siteUrls(config, w),
    template: { id: tpl.id, name: tpl.name, style: tpl.style },
    rsvp: rsvpCounts(db, w.id),
    storage: { ...storageUsed(db, w.id), limit_mb: plan.entitlements.storage_mb, max_photos: plan.entitlements.max_photos },
    plan: { id: plan.id, name: plan.name, entitlements: plan.entitlements },
    role: membership.role,
    permissions: { edit: membership.role === 'owner' || !!membership.can_edit, guests: membership.role === 'owner' || !!membership.can_manage_guests, publish: membership.role === 'owner' || !!membership.can_publish, owner: membership.role === 'owner' }
  };
}

export function weddingRoutes(ctx) {
  const { db, config } = ctx;
  const r = express.Router();

  r.get('/', requireUser, (req, res) => {
    const rows = db.all(
      `SELECT w.*, m.role, m.can_edit, m.can_manage_guests, m.can_publish FROM weddings w JOIN wedding_members m ON m.wedding_id = w.id
       WHERE m.user_id = ? ORDER BY w.created_at`, req.user.id
    );
    res.json({ weddings: rows.map((w) => weddingSummary(ctx, w, w)) });
  });

  r.get('/slug-check', requireUser, (req, res) => {
    const slug = String(req.query.slug || '').toLowerCase();
    const err = validateSlug(slug);
    if (err) return res.json({ available: false, reason: err });
    const ok = slugAvailable(db, slug, req.query.wedding || null);
    res.json({ available: ok, reason: ok ? null : 'That address is already taken.' });
  });

  r.post('/', requireUser, (req, res) => {
    const { values, errors } = validateBasics(req.body || {});
    if (Object.keys(errors).length) return res.status(400).json({ error: 'Please check the highlighted fields.', fields: errors });
    const id = createWedding(db, req.user.id, values);
    track(db, 'website_creation_started', { userId: req.user.id, weddingId: id });
    const w = getWedding(db, id);
    res.status(201).json(weddingSummary(ctx, w, { role: 'owner' }));
  });

  r.get('/:weddingId', member(db), (req, res) => {
    const w = getWedding(db, req.weddingId);
    res.json({ ...weddingSummary(ctx, w, req.membership), checklist: publishChecklist(db, w.id) });
  });

  r.get('/:weddingId/draft', member(db), (req, res) => {
    res.json(draftState(db, req.weddingId));
  });

  r.put('/:weddingId/draft', member(db, 'edit'), (req, res) => {
    const before = db.get('SELECT template_id FROM website_designs WHERE wedding_id = ?', req.weddingId);
    const { version, changes } = saveDraft(db, req.weddingId, req.body || {});
    const ev = { userId: req.user.id, weddingId: req.weddingId };
    if (changes.templateChanged) track(db, 'template_selected', { ...ev, props: { template: changes.template_id, previous: before?.template_id } });
    else if (req.body?.setup_step === 3 && req.body?.design?.template_id) track(db, 'template_selected', { ...ev, props: { template: req.body.design.template_id } });
    if (changes.coloursChanged) track(db, 'colour_settings_changed', ev);
    for (const t of changes.added) track(db, 'section_added', { ...ev, props: { section: t } });
    for (const t of changes.removed) track(db, 'section_removed', { ...ev, props: { section: t } });
    if (changes.dateChanged) syncSchedule(db, req.weddingId);
    res.json({ ok: true, version, saved_at: now() });
  });

  r.get('/:weddingId/checklist', member(db), (req, res) => res.json(publishChecklist(db, req.weddingId)));

  r.post('/:weddingId/publish', member(db, 'publish'), (req, res) => {
    if (!req.user.email_verified_at) {
      return res.status(403).json({ error: 'Please confirm your email address before publishing. We sent you a link when you signed up — you can resend it from your dashboard.', code: 'email_unverified' });
    }
    const w = getWedding(db, req.weddingId);
    if (w.unpublished_reason && w.unpublished_reason.startsWith('admin:')) {
      return res.status(403).json({ error: 'This website was taken down by our team. Please contact support.' });
    }
    const result = publish(db, req.weddingId, req.user.id);
    if (result.first) track(db, 'website_published', { userId: req.user.id, weddingId: req.weddingId, props: { first: true } });
    let notification = null;
    if (req.body?.notify_guests) {
      notification = scheduleUpdateNotification(ctx.deps, req.weddingId, { subject: req.body.subject, message: req.body.message });
      if (!notification) throw new PlanLimitError('email_workflow', 'Emailing guests about updates is part of Premium.');
    }
    syncSchedule(db, req.weddingId);
    const updated = getWedding(db, req.weddingId);
    res.json({ ok: true, first: result.first, urls: siteUrls(config, updated), notification_scheduled: !!notification });
  });

  r.post('/:weddingId/unpublish', member(db, 'publish'), (req, res) => {
    db.run("UPDATE weddings SET status = 'draft' WHERE id = ?", req.weddingId);
    res.json({ ok: true });
  });

  r.patch('/:weddingId/settings', member(db, 'edit'), (req, res) => {
    const w = getWedding(db, req.weddingId);
    const b = req.body || {};
    const ent = weddingPlan(db, w.id).entitlements;
    const set = {};
    if (b.slug !== undefined && b.slug !== w.slug) {
      const slug = String(b.slug).toLowerCase().trim();
      const err = validateSlug(slug);
      if (err) throw new HttpError(400, err, { fields: { slug: err } });
      if (!slugAvailable(db, slug, w.id)) throw new HttpError(409, 'That address is already taken.', { fields: { slug: 'Already taken.' } });
      set.slug = slug;
    }
    if (b.visibility !== undefined) {
      if (!['public', 'password', 'private'].includes(b.visibility)) throw new HttpError(400, 'Unknown visibility option.');
      if (b.visibility === 'password' && !ent.password_protection && w.visibility !== 'password') throw new PlanLimitError('password_protection', 'Password-protecting your website is part of Premium.');
      if (b.visibility === 'password' && !w.site_password_hash && !b.site_password) throw new HttpError(400, 'Choose a password for your website.', { fields: { site_password: 'Required.' } });
      set.visibility = b.visibility;
    }
    if (b.site_password) {
      if (String(b.site_password).length < 4) throw new HttpError(400, 'Use at least 4 characters for the website password.', { fields: { site_password: 'Too short.' } });
      set.site_password_hash = hashPassword(String(b.site_password));
    }
    if (b.search_indexing !== undefined) set.search_indexing = b.search_indexing ? 1 : 0;
    if (b.rsvp_deadline !== undefined) {
      if (b.rsvp_deadline && !/^\d{4}-\d{2}-\d{2}$/.test(b.rsvp_deadline)) throw new HttpError(400, 'Enter a valid RSVP deadline.');
      set.rsvp_deadline = b.rsvp_deadline || null;
    }
    if (b.rsvp_mode !== undefined) { if (!['open', 'invite_only'].includes(b.rsvp_mode)) throw new HttpError(400, 'Unknown RSVP mode.'); set.rsvp_mode = b.rsvp_mode; }
    if (b.rsvp_plus_ones !== undefined) { if (!['none', 'invited_only', 'everyone'].includes(b.rsvp_plus_ones)) throw new HttpError(400, 'Unknown plus-one option.'); set.rsvp_plus_ones = b.rsvp_plus_ones; }
    if (b.rsvp_collect_email !== undefined) { if (!['optional', 'required'].includes(b.rsvp_collect_email)) throw new HttpError(400, 'Unknown email option.'); set.rsvp_collect_email = b.rsvp_collect_email; }
    if (b.rsvp_dietary !== undefined) set.rsvp_dietary = b.rsvp_dietary ? 1 : 0;
    if (b.rsvp_accessibility !== undefined) set.rsvp_accessibility = b.rsvp_accessibility ? 1 : 0;
    if (b.automation_paused !== undefined) set.automation_paused = b.automation_paused ? 1 : 0;
    if (b.custom_domain !== undefined) {
      const d = String(b.custom_domain || '').toLowerCase().trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (d) {
        if (!ent.custom_domain) throw new PlanLimitError('custom_domain', 'Connecting your own domain is part of Premium.');
        if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d)) throw new HttpError(400, 'Enter a domain like ourwedding.com.');
        if (config.siteBaseDomain && d.endsWith(config.siteBaseDomain)) throw new HttpError(400, 'Use a domain you own, not a platform address.');
        const taken = db.get('SELECT id FROM weddings WHERE custom_domain = ? AND id != ?', d, w.id);
        if (taken) throw new HttpError(409, 'That domain is already connected to another website.');
      }
      if ((d || null) !== w.custom_domain) { set.custom_domain = d || null; set.custom_domain_verified_at = null; }
    }
    const keys = Object.keys(set);
    if (keys.length) db.run(`UPDATE weddings SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => set[k]), w.id);
    if ('rsvp_deadline' in set || 'automation_paused' in set) syncSchedule(db, w.id);
    res.json(weddingSummary(ctx, getWedding(db, w.id), req.membership));
  });

  r.get('/:weddingId/rsvp-form', member(db), (req, res) => {
    const ent = weddingPlan(db, req.weddingId).entitlements;
    res.json({ ...loadQuestions(db, req.weddingId), limit: ent.custom_questions });
  });

  r.put('/:weddingId/rsvp-form', member(db, 'edit'), (req, res) => {
    const ent = weddingPlan(db, req.weddingId).entitlements;
    const qs = Array.isArray(req.body?.questions) ? req.body.questions : [];
    const current = loadQuestions(db, req.weddingId).questions;
    if (qs.length > ent.custom_questions && qs.length > current.length) {
      throw new PlanLimitError('custom_questions', `Your plan includes ${ent.custom_questions} custom RSVP question${ent.custom_questions === 1 ? '' : 's'}. Your existing questions are kept.`);
    }
    const clean = qs.slice(0, 50).map((q) => ({
      id: typeof q.id === 'string' && /^[a-z0-9-]{4,40}$/i.test(q.id) ? q.id : uuid().slice(0, 8),
      label: String(q.label || '').trim().slice(0, 200),
      type: ['text', 'textarea', 'select', 'checkbox'].includes(q.type) ? q.type : 'text',
      options: q.type === 'select' ? (Array.isArray(q.options) ? q.options : String(q.options || '').split(',')).map((o) => String(o).trim().slice(0, 80)).filter(Boolean).slice(0, 20) : [],
      required: !!q.required
    })).filter((q) => q.label);
    db.run("UPDATE form_definitions SET questions = ?, updated_at = ? WHERE wedding_id = ? AND kind = 'rsvp'", JSON.stringify(clean), now(), req.weddingId);
    res.json({ questions: clean, limit: ent.custom_questions });
  });

  // ----- Collaborators -----
  r.get('/:weddingId/members', member(db), (req, res) => {
    const members = db.all('SELECT u.id, u.name, u.email, m.role, m.can_edit, m.can_manage_guests, m.can_publish FROM wedding_members m JOIN users u ON u.id = m.user_id WHERE m.wedding_id = ? ORDER BY m.role DESC, m.created_at', req.weddingId);
    const invites = db.all('SELECT id, email, can_edit, can_manage_guests, can_publish, expires_at, created_at FROM member_invites WHERE wedding_id = ? AND accepted_at IS NULL AND expires_at > ?', req.weddingId, now());
    res.json({ members, invites });
  });

  r.post('/:weddingId/members', member(db, 'owner'), (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!validateEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
    if (email === req.user.email.toLowerCase()) throw new HttpError(400, 'You already own this website.');
    const ent = weddingPlan(db, req.weddingId).entitlements;
    const count = db.get("SELECT COUNT(*) AS n FROM wedding_members WHERE wedding_id = ? AND role = 'coowner'", req.weddingId).n
      + db.get('SELECT COUNT(*) AS n FROM member_invites WHERE wedding_id = ? AND accepted_at IS NULL AND expires_at > ?', req.weddingId, now()).n;
    if (count >= ent.coowners) throw new PlanLimitError('coowners', `Your plan includes ${ent.coowners} collaborator${ent.coowners === 1 ? '' : 's'}.`);
    const token = randomToken();
    const w = getWedding(db, req.weddingId);
    db.run('INSERT INTO member_invites (id, wedding_id, email, token_hash, can_edit, can_manage_guests, can_publish, invited_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      uuid(), w.id, email, sha256(token), req.body.can_edit === false ? 0 : 1, req.body.can_manage_guests === false ? 0 : 1, req.body.can_publish ? 1 : 0, req.user.id,
      new Date(Date.now() + 14 * 864e5).toISOString(), now());
    const url = `${config.baseUrl}/app/accept-invite?token=${encodeURIComponent(token)}`;
    const devLink = sendAccountEmail(ctx, { id: req.user.id, email }, 'coowner_invite', url, { to: email, inviter: req.user.name || req.user.email, names: coupleNames(w) });
    res.status(201).json({ ok: true, dev_invite_link: devLink });
  });

  r.patch('/:weddingId/members/:userId', member(db, 'owner'), (req, res) => {
    const m = db.get("SELECT * FROM wedding_members WHERE wedding_id = ? AND user_id = ? AND role = 'coowner'", req.weddingId, req.params.userId);
    if (!m) throw new HttpError(404, 'Collaborator not found.');
    const b = req.body || {};
    db.run('UPDATE wedding_members SET can_edit = ?, can_manage_guests = ?, can_publish = ? WHERE wedding_id = ? AND user_id = ?',
      b.can_edit === undefined ? m.can_edit : b.can_edit ? 1 : 0, b.can_manage_guests === undefined ? m.can_manage_guests : b.can_manage_guests ? 1 : 0,
      b.can_publish === undefined ? m.can_publish : b.can_publish ? 1 : 0, req.weddingId, req.params.userId);
    res.json({ ok: true });
  });

  r.delete('/:weddingId/members/:userId', member(db), (req, res) => {
    // Owners can remove anyone else; collaborators can remove themselves.
    const target = req.params.userId;
    if (req.membership.role !== 'owner' && target !== req.user.id) throw new HttpError(403, 'Only the owner can remove collaborators.');
    const r2 = db.run("DELETE FROM wedding_members WHERE wedding_id = ? AND user_id = ? AND role = 'coowner'", req.weddingId, target);
    if (!r2.changes) throw new HttpError(404, 'Collaborator not found.');
    res.json({ ok: true });
  });

  r.delete('/:weddingId/invites/:inviteId', member(db, 'owner'), (req, res) => {
    db.run('DELETE FROM member_invites WHERE id = ? AND wedding_id = ?', req.params.inviteId, req.weddingId);
    res.json({ ok: true });
  });

  r.delete('/:weddingId', member(db, 'owner'), (req, res) => {
    const w = getWedding(db, req.weddingId);
    if (String(req.body?.confirm || '').trim().toLowerCase() !== String(w.slug).toLowerCase()) throw new HttpError(400, 'Type your website address to confirm.');
    db.run('DELETE FROM weddings WHERE id = ?', w.id);
    deleteWeddingFiles(config.dataDir, w.id);
    res.json({ ok: true });
  });

  return r;
}

export function inviteAcceptRoutes(ctx) {
  const { db } = ctx;
  const r = express.Router();
  r.post('/accept', requireUser, (req, res) => {
    const inv = db.get('SELECT * FROM member_invites WHERE token_hash = ?', sha256(String(req.body?.token || '')));
    if (!inv || inv.accepted_at || inv.expires_at < now()) throw new HttpError(400, 'This invitation is invalid or has expired. Ask the couple to send a new one.');
    if (inv.email.toLowerCase() !== req.user.email.toLowerCase()) throw new HttpError(403, `This invitation was sent to ${inv.email}. Log in with that email address to accept it.`);
    db.tx(() => {
      db.run('INSERT OR IGNORE INTO wedding_members (wedding_id, user_id, role, can_edit, can_manage_guests, can_publish, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        inv.wedding_id, req.user.id, 'coowner', inv.can_edit, inv.can_manage_guests, inv.can_publish, now());
      db.run('UPDATE member_invites SET accepted_at = ? WHERE id = ?', now(), inv.id);
    });
    res.json({ ok: true, wedding_id: inv.wedding_id });
  });
  return r;
}

export { suggestSlug, parseJson };
