import express from 'express';
import { now, uuid, parseJson } from '../db.js';
import { requireUser, verifyPassword, hashPassword, validatePassword, destroySession } from '../auth.js';
import { HttpError } from '../services.js';
import { publicUser } from './auth.js';
import { track, CLIENT_EVENTS } from '../analytics.js';
import { deleteWeddingFiles } from '../media.js';
import { userPlan, getPlan, FEATURE_LABELS } from '../entitlements.js';

export function accountRoutes(ctx) {
  const { db, config } = ctx;
  const r = express.Router();
  r.use(requireUser);

  r.patch('/profile', (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 100);
    if (!name) throw new HttpError(400, 'Please enter your name.');
    db.run('UPDATE users SET name = ?, marketing_opt_in = ?, updated_at = ? WHERE id = ?', name, req.body?.marketing_opt_in ? 1 : 0, now(), req.user.id);
    res.json({ user: publicUser(db, db.get('SELECT * FROM users WHERE id = ?', req.user.id)) });
  });

  r.post('/password', (req, res) => {
    const u = db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!verifyPassword(req.body?.current_password || '', u.password_hash)) throw new HttpError(400, 'Your current password is not right.', { fields: { current_password: 'Incorrect.' } });
    const err = validatePassword(req.body?.new_password);
    if (err) throw new HttpError(400, err, { fields: { new_password: err } });
    db.tx(() => {
      db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', hashPassword(req.body.new_password), now(), u.id);
      db.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', u.id, req.sessionId); // sign out other devices
    });
    res.json({ ok: true });
  });

  // Everything we hold about the user and the weddings they own, as JSON.
  r.get('/export', (req, res) => {
    const u = db.get('SELECT id, email, name, role, email_verified_at, marketing_opt_in, created_at FROM users WHERE id = ?', req.user.id);
    const weddings = db.all("SELECT w.* FROM weddings w JOIN wedding_members m ON m.wedding_id = w.id WHERE m.user_id = ? AND m.role = 'owner'", u.id).map((w) => {
      const { site_password_hash, ...rest } = w;
      return {
        ...rest,
        design: db.get('SELECT template_id, palette, font_pairing, animation FROM website_designs WHERE wedding_id = ?', w.id),
        sections: db.all('SELECT type, position, status, content, settings FROM website_sections WHERE wedding_id = ?', w.id).map((s) => ({ ...s, content: parseJson(s.content, {}), settings: parseJson(s.settings, {}) })),
        media: db.all('SELECT id, kind, caption, original_name, width, height, created_at FROM media_assets WHERE wedding_id = ?', w.id).map((m) => ({ ...m, url: `${config.baseUrl}/media/${m.id}/2000` })),
        guests: db.all('SELECT first_name, last_name, email, phone, household, invitation_status, updates_opt_in, unsubscribed_at, created_at FROM guests WHERE wedding_id = ?', w.id),
        rsvp_submissions: db.all('SELECT name, email, attending, events, plus_one_name, dietary, accessibility, is_latest, created_at FROM rsvp_submissions WHERE wedding_id = ?', w.id),
        email_rules: db.all('SELECT type, enabled, config FROM email_automation_rules WHERE wedding_id = ?', w.id)
      };
    });
    const subscriptions = db.all('SELECT plan_id, status, source, started_at, ends_at FROM user_subscriptions WHERE user_id = ?', u.id);
    res.set('Content-Disposition', 'attachment; filename="my-wedding-data.json"');
    res.json({ exported_at: now(), user: u, subscriptions, weddings });
  });

  r.delete('/', (req, res) => {
    const u = db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!verifyPassword(req.body?.password || '', u.password_hash)) throw new HttpError(400, 'Your password is not right.', { fields: { password: 'Incorrect.' } });
    if (String(req.body?.confirm || '').trim().toLowerCase() !== 'delete my account') throw new HttpError(400, 'Type “delete my account” to confirm.');
    const owned = db.all("SELECT wedding_id FROM wedding_members WHERE user_id = ? AND role = 'owner'", u.id).map((r2) => r2.wedding_id);
    db.tx(() => {
      for (const id of owned) db.run('DELETE FROM weddings WHERE id = ?', id);
      db.run('DELETE FROM users WHERE id = ?', u.id);
    });
    owned.forEach((id) => deleteWeddingFiles(config.dataDir, id));
    destroySession(db, req, res, config);
    res.json({ ok: true });
  });

  r.get('/subscription', (req, res) => {
    const plan = userPlan(db, req.user.id);
    const plans = db.all("SELECT * FROM subscription_plans WHERE status != 'hidden' ORDER BY sort").map((p) => ({ ...p, entitlements: parseJson(p.entitlements, {}) }));
    const interest = db.all('SELECT plan_id FROM upgrade_interest WHERE user_id = ?', req.user.id).map((x) => x.plan_id);
    res.json({ current: { id: plan.id, name: plan.name }, plans, payments_enabled: config.paymentsEnabled, waitlisted: interest, feature_labels: FEATURE_LABELS });
  });

  // Freemium launch: premium is not purchasable yet, so couples can register interest.
  r.post('/upgrade-interest', (req, res) => {
    const plan = getPlan(db, String(req.body?.plan_id || 'premium'));
    if (!plan || plan.id === 'free') throw new HttpError(400, 'Unknown plan.');
    db.run('INSERT OR IGNORE INTO upgrade_interest (id, user_id, plan_id, feature, created_at) VALUES (?, ?, ?, ?, ?)', uuid(), req.user.id, plan.id, String(req.body?.feature || '').slice(0, 40) || null, now());
    track(db, 'upgrade_interest_registered', { userId: req.user.id, props: { plan: plan.id, feature: String(req.body?.feature || '').replace(/[^a-z_]/g, '').slice(0, 32) } });
    res.json({ ok: true });
  });

  r.post('/checkout', (req, res) => {
    // A payment provider (e.g. Stripe Checkout) plugs in here. Until it is configured we
    // refuse rather than pretend a payment happened.
    if (!config.paymentsEnabled) throw new HttpError(501, 'Paid plans are not on sale yet. Join the waitlist and we will let you know when Premium launches.', { code: 'payments_disabled' });
    throw new HttpError(501, 'Payments are enabled but no payment provider is connected. See README → Payments.', { code: 'payments_not_connected' });
  });

  return r;
}

export function eventRoutes(ctx) {
  const { db } = ctx;
  const r = express.Router();
  // Client-reported events (only a small allowlist; everything else is recorded server-side).
  r.post('/', (req, res) => {
    const name = String(req.body?.name || '');
    if (!CLIENT_EVENTS.has(name)) return res.status(400).json({ error: 'Unknown event.' });
    let weddingId = null;
    if (req.body?.wedding_id && req.user && db.get('SELECT 1 FROM wedding_members WHERE wedding_id = ? AND user_id = ?', String(req.body.wedding_id), req.user.id)) weddingId = String(req.body.wedding_id);
    track(db, name, { userId: req.user?.id || null, weddingId, props: req.body?.props || {} });
    res.json({ ok: true });
  });
  return r;
}
