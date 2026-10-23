import express from 'express';
import { now, uuid, parseJson } from '../db.js';
import { member } from './access.js';
import { HttpError, inviteCode, getWedding, siteUrls, loadSections } from '../services.js';
import { validateEmail, randomToken } from '../auth.js';
import { parseCsv, toCsv } from '../csv.js';
import { sendInvitations } from '../notifications.js';
import { weddingPlan, PlanLimitError } from '../entitlements.js';

const MAX_GUESTS = 3000;

function cleanGuest(b, partial = false) {
  const out = {};
  const str = (v, n) => String(v ?? '').trim().slice(0, n);
  if (!partial || 'first_name' in b) { out.first_name = str(b.first_name, 80); if (!out.first_name) throw new HttpError(400, 'Enter the guest’s first name.', { fields: { first_name: 'Required.' } }); }
  if (!partial || 'last_name' in b) out.last_name = str(b.last_name, 80);
  if (!partial || 'email' in b) {
    const e = str(b.email, 200).toLowerCase();
    if (e && !validateEmail(e)) throw new HttpError(400, 'That email address does not look right.', { fields: { email: 'Invalid email.' } });
    out.email = e || null;
  }
  if (!partial || 'phone' in b) out.phone = str(b.phone, 40);
  if (!partial || 'household' in b) out.household = str(b.household, 120);
  if (!partial || 'notes' in b) out.notes = str(b.notes, 1000);
  if (!partial || 'plus_one_allowed' in b) out.plus_one_allowed = b.plus_one_allowed ? 1 : 0;
  if (!partial || 'private_events' in b) out.private_events = b.private_events ? 1 : 0;
  return out;
}

function guestList(db, weddingId) {
  const guests = db.all('SELECT * FROM guests WHERE wedding_id = ? ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE', weddingId);
  const latest = new Map(db.all('SELECT * FROM rsvp_submissions WHERE wedding_id = ? AND is_latest = 1 AND guest_id IS NOT NULL', weddingId).map((r) => [r.guest_id, r]));
  const answers = new Map(db.all('SELECT f.rsvp_submission_id, f.answers FROM form_submissions f WHERE f.wedding_id = ?', weddingId).map((f) => [f.rsvp_submission_id, parseJson(f.answers, {})]));
  return guests.map((g) => {
    const r = latest.get(g.id);
    return {
      id: g.id, first_name: g.first_name, last_name: g.last_name, email: g.email, phone: g.phone, household: g.household,
      plus_one_allowed: !!g.plus_one_allowed, private_events: !!g.private_events, notes: g.notes, invite_code: g.invite_code,
      invitation_status: g.invitation_status, invited_at: g.invited_at, updates_opt_in: !!g.updates_opt_in, unsubscribed: !!g.unsubscribed_at,
      // RSVP status is derived only from an actual response; no response means pending.
      rsvp_status: r ? (r.attending === 'yes' ? 'confirmed' : 'declined') : 'pending',
      rsvp: r ? { id: r.id, attending: r.attending, events: parseJson(r.events, []), plus_one_name: r.plus_one_name, dietary: r.dietary, accessibility: r.accessibility, answers: answers.get(r.id) || {}, created_at: r.created_at } : null
    };
  });
}

function insertGuest(db, weddingId, g) {
  const id = uuid();
  const ts = now();
  db.run(
    `INSERT INTO guests (id, wedding_id, first_name, last_name, email, phone, household, plus_one_allowed, private_events, invite_code, unsubscribe_token, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, weddingId, g.first_name, g.last_name || '', g.email || null, g.phone || '', g.household || '', g.plus_one_allowed || 0, g.private_events || 0,
    inviteCode(), randomToken(18), g.notes || '', ts, ts
  );
  return id;
}

export { insertGuest };

export function guestRoutes(ctx) {
  const { db, config } = ctx;
  const r = express.Router();

  r.get('/:weddingId/guests', member(db, 'guests'), (req, res) => {
    const w = getWedding(db, req.weddingId);
    const details = loadSections(db, req.weddingId).find((s) => s.type === 'details');
    res.json({
      guests: guestList(db, req.weddingId),
      events: (details?.content?.events || []).filter((e) => e.name).map((e) => ({ id: e.id, name: e.name, restricted: !!e.restricted })),
      site_url: siteUrls(config, w).primary,
      published: w.status === 'published'
    });
  });

  r.post('/:weddingId/guests', member(db, 'guests'), (req, res) => {
    const g = cleanGuest(req.body || {});
    if (db.get('SELECT COUNT(*) AS n FROM guests WHERE wedding_id = ?', req.weddingId).n >= MAX_GUESTS) throw new HttpError(400, `Guest lists are limited to ${MAX_GUESTS} people.`);
    if (g.email && db.get('SELECT 1 FROM guests WHERE wedding_id = ? AND email = ?', req.weddingId, g.email)) throw new HttpError(409, 'A guest with this email is already on your list.', { fields: { email: 'Already on the list.' } });
    const id = insertGuest(db, req.weddingId, g);
    res.status(201).json({ guest: guestList(db, req.weddingId).find((x) => x.id === id) });
  });

  r.patch('/:weddingId/guests/:guestId', member(db, 'guests'), (req, res) => {
    const existing = db.get('SELECT * FROM guests WHERE id = ? AND wedding_id = ?', req.params.guestId, req.weddingId);
    if (!existing) throw new HttpError(404, 'Guest not found.');
    const g = cleanGuest(req.body || {}, true);
    if (g.email && g.email !== existing.email && db.get('SELECT 1 FROM guests WHERE wedding_id = ? AND email = ? AND id != ?', req.weddingId, g.email, existing.id)) {
      throw new HttpError(409, 'Another guest already uses this email.', { fields: { email: 'Already on the list.' } });
    }
    if (req.body.invitation_status === 'not_invited' || req.body.invitation_status === 'invited') g.invitation_status = req.body.invitation_status;
    const keys = Object.keys(g);
    if (keys.length) db.run(`UPDATE guests SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...keys.map((k) => g[k]), now(), existing.id);
    res.json({ guest: guestList(db, req.weddingId).find((x) => x.id === existing.id) });
  });

  r.delete('/:weddingId/guests/:guestId', member(db, 'guests'), (req, res) => {
    const out = db.run('DELETE FROM guests WHERE id = ? AND wedding_id = ?', req.params.guestId, req.weddingId);
    if (!out.changes) throw new HttpError(404, 'Guest not found.');
    res.json({ ok: true });
  });

  r.post('/:weddingId/guests/import', member(db, 'guests'), express.text({ type: '*/*', limit: '2mb' }), (req, res) => {
    const text = typeof req.body === 'string' ? req.body : req.body?.csv;
    const rows = parseCsv(text);
    if (rows.length < 2) throw new HttpError(400, 'The file needs a header row and at least one guest.');
    const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
    const col = (...names) => header.findIndex((h) => names.includes(h));
    const idx = {
      first: col('first_name', 'first', 'firstname', 'given_name'), last: col('last_name', 'last', 'lastname', 'surname', 'family_name'),
      name: col('name', 'full_name', 'guest', 'guest_name'), email: col('email', 'email_address', 'e_mail'),
      phone: col('phone', 'mobile', 'phone_number', 'telephone', 'whatsapp'), household: col('household', 'group', 'party', 'family'),
      plus: col('plus_one', 'plus_one_allowed', 'plusone', 'guest_allowed')
    };
    if (idx.first < 0 && idx.name < 0) throw new HttpError(400, 'We could not find a name column. Use a header such as "first_name, last_name, email" or "name, email".');
    const existing = db.get('SELECT COUNT(*) AS n FROM guests WHERE wedding_id = ?', req.weddingId).n;
    const result = { added: 0, skipped: [], total: rows.length - 1 };
    db.tx(() => {
      rows.slice(1).forEach((row, n) => {
        const line = n + 2;
        const get = (i) => (i >= 0 ? String(row[i] || '').trim() : '');
        let first = get(idx.first), last = get(idx.last);
        if (!first && idx.name >= 0) { const parts = get(idx.name).split(/\s+/); first = parts.shift() || ''; last = last || parts.join(' '); }
        if (!first) { result.skipped.push({ line, reason: 'Missing name' }); return; }
        const email = get(idx.email).toLowerCase();
        if (email && !validateEmail(email)) { result.skipped.push({ line, reason: `Invalid email “${email}”` }); return; }
        if (email && db.get('SELECT 1 FROM guests WHERE wedding_id = ? AND email = ?', req.weddingId, email)) { result.skipped.push({ line, reason: `${email} is already on your list` }); return; }
        if (existing + result.added >= MAX_GUESTS) { result.skipped.push({ line, reason: 'Guest list limit reached' }); return; }
        insertGuest(db, req.weddingId, {
          first_name: first.slice(0, 80), last_name: last.slice(0, 80), email: email || null, phone: get(idx.phone).slice(0, 40),
          household: get(idx.household).slice(0, 120), plus_one_allowed: /^(y|yes|true|1|x)$/i.test(get(idx.plus)) ? 1 : 0
        });
        result.added++;
      });
    });
    res.json(result);
  });

  r.get('/:weddingId/guests/export.csv', member(db, 'guests'), (req, res) => {
    const w = getWedding(db, req.weddingId);
    const site = siteUrls(config, w).primary;
    const guests = guestList(db, req.weddingId);
    const details = loadSections(db, req.weddingId).find((s) => s.type === 'details');
    const eventNames = new Map((details?.content?.events || []).map((e) => [e.id, e.name]));
    const questionLabels = [...new Set(guests.flatMap((g) => Object.values(g.rsvp?.answers || {}).map((a) => a.label)))];
    const header = ['First name', 'Last name', 'Email', 'Phone', 'Household', 'Invitation', 'RSVP', 'Events', 'Plus-one allowed', 'Plus-one name', 'Dietary', 'Accessibility', ...questionLabels, 'Responded at', 'Invitation code', 'Personal link'];
    const rows = guests.map((g) => {
      const ans = Object.values(g.rsvp?.answers || {});
      return [
        g.first_name, g.last_name, g.email, g.phone, g.household, g.invitation_status === 'invited' ? 'Invited' : 'Not invited',
        { pending: 'Pending', confirmed: 'Attending', declined: 'Declined' }[g.rsvp_status],
        (g.rsvp?.events || []).map((id) => eventNames.get(id) || id).join('; '), g.plus_one_allowed ? 'Yes' : 'No', g.rsvp?.plus_one_name || '',
        g.rsvp?.dietary || '', g.rsvp?.accessibility || '', ...questionLabels.map((l) => ans.find((a) => a.label === l)?.value ?? ''),
        g.rsvp?.created_at || '', g.invite_code, `${site}?invite=${g.invite_code}`
      ];
    });
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${w.slug || 'guests'}-guest-list.csv"`);
    res.send('﻿' + toCsv(header, rows));
  });

  // Full response history including superseded answers (premium "advanced export").
  r.get('/:weddingId/rsvp-history.csv', member(db, 'guests'), (req, res) => {
    if (!weddingPlan(db, req.weddingId).entitlements.advanced_exports) throw new PlanLimitError('advanced_exports', 'Exporting the full RSVP history is part of Premium. Your guest list export is still available.');
    const rows = db.all('SELECT r.*, f.answers FROM rsvp_submissions r LEFT JOIN form_submissions f ON f.rsvp_submission_id = r.id WHERE r.wedding_id = ? ORDER BY r.created_at', req.weddingId);
    const header = ['Submitted at', 'Name', 'Email', 'Attending', 'Events', 'Plus-one', 'Dietary', 'Accessibility', 'Answers', 'Latest response'];
    const out = rows.map((r) => [r.created_at, r.name, r.email, r.attending, parseJson(r.events, []).join('; '), r.plus_one_name || '', r.dietary, r.accessibility,
      Object.values(parseJson(r.answers, {})).map((a) => `${a.label}: ${a.value}`).join(' | '), r.is_latest ? 'Yes' : 'No']);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="rsvp-history.csv"');
    res.send('﻿' + toCsv(header, out));
  });

  r.get('/:weddingId/guests/:guestId/history', member(db, 'guests'), (req, res) => {
    const g = db.get('SELECT id FROM guests WHERE id = ? AND wedding_id = ?', req.params.guestId, req.weddingId);
    if (!g) throw new HttpError(404, 'Guest not found.');
    const subs = db.all('SELECT r.*, f.answers FROM rsvp_submissions r LEFT JOIN form_submissions f ON f.rsvp_submission_id = r.id WHERE r.guest_id = ? ORDER BY r.created_at DESC', g.id)
      .map((r) => ({ id: r.id, attending: r.attending, events: parseJson(r.events, []), plus_one_name: r.plus_one_name, dietary: r.dietary, accessibility: r.accessibility, answers: parseJson(r.answers, {}), is_latest: !!r.is_latest, created_at: r.created_at }));
    const emails = db.all('SELECT type, status, last_error, created_at, updated_at FROM email_delivery_logs WHERE guest_id = ? ORDER BY created_at DESC LIMIT 50', g.id);
    const invitations = db.all('SELECT channel, created_at FROM invitations WHERE guest_id = ? ORDER BY created_at DESC', g.id);
    res.json({ submissions: subs, emails, invitations });
  });

  r.post('/:weddingId/guests/send-invitations', member(db, 'guests'), (req, res) => {
    const w = getWedding(db, req.weddingId);
    if (w.status !== 'published') throw new HttpError(400, 'Publish your website before sending invitations, so the link in the email works.');
    const ids = Array.isArray(req.body?.guest_ids) ? req.body.guest_ids.map(String).slice(0, MAX_GUESTS) : [];
    if (!ids.length) throw new HttpError(400, 'Choose at least one guest.');
    const result = sendInvitations(ctx.deps, req.weddingId, ids, req.user.id);
    res.json({ ...result, provider_configured: ctx.provider.configured });
  });

  // Invitations shared outside email (WhatsApp, text, in person).
  r.post('/:weddingId/guests/:guestId/mark-invited', member(db, 'guests'), (req, res) => {
    const g = db.get('SELECT * FROM guests WHERE id = ? AND wedding_id = ?', req.params.guestId, req.weddingId);
    if (!g) throw new HttpError(404, 'Guest not found.');
    const channel = ['link', 'whatsapp', 'sms', 'other'].includes(req.body?.channel) ? req.body.channel : 'other';
    db.run("UPDATE guests SET invitation_status = 'invited', invited_at = COALESCE(invited_at, ?), updated_at = ? WHERE id = ?", now(), now(), g.id);
    db.run('INSERT INTO invitations (id, wedding_id, guest_id, channel, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)', uuid(), req.weddingId, g.id, channel, req.user.id, now());
    res.json({ ok: true });
  });

  return r;
}
