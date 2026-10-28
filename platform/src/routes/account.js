import express from 'express';
import { now, uuid, parseJson } from '../db.js';
import { requireUser, verifyPassword, hashPassword, validatePassword, destroySession } from '../auth.js';
import { HttpError } from '../services.js';
import { publicUser } from './auth.js';
import { track, CLIENT_EVENTS } from '../analytics.js';
import { deleteWeddingFiles } from '../media.js';
import { userPlan, getPlan, FEATURE_LABELS } from '../entitlements.js';
import { logSecurityEvent, securityEvents, passwordProblem, newTotpSecret, otpauthUri, verifyTotp, newRecoveryCodes, checkSecondFactor } from '../security.js';
import { rateLimit } from '../auth.js';

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
    const err = validatePassword(req.body?.new_password) || passwordProblem(req.body?.new_password, u);
    if (err) throw new HttpError(400, err, { fields: { new_password: err } });
    db.tx(() => {
      db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', hashPassword(req.body.new_password), now(), u.id);
      db.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', u.id, req.sessionId); // sign out other devices
    });
    logSecurityEvent(db, 'password_changed', { userId: u.id, req });
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
        email_rules: db.all('SELECT type, enabled, config FROM email_automation_rules WHERE wedding_id = ?', w.id),
        budget: db.get('SELECT currency, total_budget_minor FROM budget_settings WHERE wedding_id = ?', w.id),
        budget_categories: db.all('SELECT name, planned_minor FROM budget_categories WHERE wedding_id = ?', w.id),
        expenses: db.all('SELECT item, vendor, vendor_contact, estimated_minor, actual_minor, paid_minor, due_date, paid_by, notes FROM expenses WHERE wedding_id = ?', w.id),
        gifts_received: db.all('SELECT giver_name, gift_type, description, amount_minor, received_date, thank_you_sent_at, notes FROM gifts_received WHERE wedding_id = ?', w.id)
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
    logSecurityEvent(db, 'account_deleted', { req, detail: { websites: owned.length } });
    destroySession(db, req, res, config);
    res.json({ ok: true });
  });

  // ----- Two-step verification (TOTP) -----
  const mfaLimiter = rateLimit({ windowMs: 15 * 60000, max: 20, key: (req) => `mfa:${req.user?.id}` });

  r.get('/security', (req, res) => {
    const sessions = db.get('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?', req.user.id, new Date().toISOString()).n;
    const u = db.get('SELECT totp_enabled_at, recovery_codes FROM users WHERE id = ?', req.user.id);
    res.json({
      mfa_enabled: !!u.totp_enabled_at, mfa_enabled_at: u.totp_enabled_at,
      recovery_codes_left: u.totp_enabled_at ? parseJson(u.recovery_codes, []).length : 0,
      active_sessions: sessions, events: securityEvents(db, { userId: req.user.id, limit: 20 }).map(({ ip, ...e }) => ({ ...e, ip: ip ? ip.replace(/(\d+\.\d+)\.\d+\.\d+$/, '$1.x.x') : null }))
    });
  });

  r.post('/2fa/setup', (req, res) => {
    const u = db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (u.totp_enabled_at) throw new HttpError(400, 'Two-step verification is already on.');
    const secret = newTotpSecret();
    db.run('UPDATE users SET totp_secret = ?, totp_last_counter = NULL WHERE id = ?', secret, u.id);
    res.json({ secret, uri: otpauthUri(secret, u.email, config.platformName) });
  });

  r.post('/2fa/enable', mfaLimiter, (req, res) => {
    const u = db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (u.totp_enabled_at) throw new HttpError(400, 'Two-step verification is already on.');
    if (!u.totp_secret) throw new HttpError(400, 'Start the setup again.');
    const counter = verifyTotp(u.totp_secret, req.body?.code);
    if (counter === null) throw new HttpError(400, 'That code is not right. Make sure your phone’s clock is correct and try the newest code.', { fields: { code: 'Incorrect code.' } });
    const { codes, hashes } = newRecoveryCodes();
    db.tx(() => {
      db.run('UPDATE users SET totp_enabled_at = ?, totp_last_counter = ?, recovery_codes = ? WHERE id = ?', now(), counter, JSON.stringify(hashes), u.id);
      db.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', u.id, req.sessionId);
    });
    logSecurityEvent(db, 'mfa_enabled', { userId: u.id, req });
    res.json({ ok: true, recovery_codes: codes });
  });

  r.post('/2fa/disable', mfaLimiter, (req, res) => {
    const u = db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!u.totp_enabled_at) throw new HttpError(400, 'Two-step verification is not on.');
    if (!verifyPassword(req.body?.password || '', u.password_hash)) throw new HttpError(400, 'Your password is not right.', { fields: { password: 'Incorrect.' } });
    if (!checkSecondFactor(db, u, req.body?.code)) throw new HttpError(400, 'That code is not right.', { fields: { code: 'Incorrect code.' } });
    if (u.role === 'admin' && config.requireAdmin2fa) throw new HttpError(400, 'Administrators must keep two-step verification on.');
    db.run('UPDATE users SET totp_enabled_at = NULL, totp_secret = NULL, totp_last_counter = NULL, recovery_codes = NULL WHERE id = ?', u.id);
    logSecurityEvent(db, 'mfa_disabled', { userId: u.id, req });
    res.json({ ok: true });
  });

  r.post('/2fa/recovery-codes', mfaLimiter, (req, res) => {
    const u = db.get('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!u.totp_enabled_at) throw new HttpError(400, 'Two-step verification is not on.');
    if (!checkSecondFactor(db, u, req.body?.code)) throw new HttpError(400, 'That code is not right.', { fields: { code: 'Incorrect code.' } });
    const { codes, hashes } = newRecoveryCodes();
    db.run('UPDATE users SET recovery_codes = ? WHERE id = ?', JSON.stringify(hashes), u.id);
    res.json({ recovery_codes: codes });
  });

  r.post('/sessions/revoke-others', (req, res) => {
    const out = db.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', req.user.id, req.sessionId);
    logSecurityEvent(db, 'sessions_revoked', { userId: req.user.id, req, detail: { count: out.changes } });
    res.json({ ok: true, signed_out: out.changes });
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
