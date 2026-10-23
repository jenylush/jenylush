import express from 'express';
import { now, uuid } from '../db.js';
import {
  hashPassword, verifyPassword, validatePassword, validateEmail, createSession, destroySession,
  createAuthToken, consumeAuthToken, rateLimit, requireUser, randomToken
} from '../auth.js';
import { buildAccountEmail } from '../email/templates.js';
import { queueEmail } from '../mailer.js';
import { track } from '../analytics.js';
import { getSetting } from '../seed.js';
import { userPlan } from '../entitlements.js';

export function publicUser(db, u) {
  const plan = userPlan(db, u.id);
  return {
    id: u.id, email: u.email, name: u.name, role: u.role, email_verified: !!u.email_verified_at,
    referral_code: u.referral_code, created_at: u.created_at,
    plan: { id: plan.id, name: plan.name, entitlements: plan.entitlements }
  };
}

export function sendAccountEmail(ctx, user, type, url, extra = {}) {
  const email = buildAccountEmail(type, { platformName: ctx.config.platformName, url, ...extra });
  const r = queueEmail(ctx.db, ctx.provider, {
    userId: user.id, type, to: extra.to || user.email, subject: email.subject, html: email.html, text: email.text,
    essential: true, dedupeKey: `${type}:${user.id}:${uuid()}`
  });
  ctx.deps.kick?.();
  // In development without an email provider, hand the link back so the flow can be tested.
  return ctx.config.exposeDevLinks && r.status === 'not_configured' ? url : null;
}

export function authRoutes(ctx) {
  const { db, config } = ctx;
  const r = express.Router();
  const limiter = rateLimit({ windowMs: 15 * 60000, max: 20 });
  const emailLimiter = rateLimit({ windowMs: 60 * 60000, max: 5, key: (req) => `${req.ip}:${String(req.body?.email || req.user?.id || '').toLowerCase()}` });

  function startVerification(user) {
    const token = createAuthToken(db, user.id, 'verify_email', 48 * 60);
    return sendAccountEmail(ctx, user, 'verify_email', `${config.baseUrl}/verify?token=${encodeURIComponent(token)}`);
  }

  r.post('/signup', limiter, (req, res) => {
    if (!getSetting(db, 'signups_enabled', true)) return res.status(403).json({ error: 'New sign-ups are paused right now. Please try again later.' });
    const name = String(req.body.name || '').trim().slice(0, 100);
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = req.body.password;
    const errors = {};
    if (!name) errors.name = 'Please tell us your name.';
    if (!validateEmail(email)) errors.email = 'Enter a valid email address.';
    const pwErr = validatePassword(password);
    if (pwErr) errors.password = pwErr;
    if (!req.body.accept_terms) errors.accept_terms = 'Please accept the terms to continue.';
    if (Object.keys(errors).length) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: errors });
    if (db.get('SELECT 1 FROM users WHERE email = ?', email)) {
      return res.status(409).json({ error: 'An account with this email already exists. Try logging in instead.', fields: { email: 'Already registered.' } });
    }
    const id = uuid();
    const ts = now();
    const referrer = req.body.ref ? db.get('SELECT id FROM users WHERE referral_code = ?', String(req.body.ref)) : null;
    const role = config.adminEmails.includes(email) ? 'admin' : 'user';
    db.tx(() => {
      db.run('INSERT INTO users (id, email, password_hash, name, role, referral_code, referred_by, marketing_opt_in, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, email, hashPassword(password), name, role, randomToken(6).replace(/[^a-zA-Z0-9]/g, 'x'), referrer?.id || null, req.body.marketing_opt_in ? 1 : 0, ts, ts);
      db.run("INSERT INTO user_subscriptions (id, user_id, plan_id, status, source, started_at, created_at) VALUES (?, ?, 'free', 'active', 'default', ?, ?)", uuid(), id, ts, ts);
    });
    const user = db.get('SELECT * FROM users WHERE id = ?', id);
    createSession(db, res, id, config);
    const devLink = startVerification(user);
    track(db, 'account_created', { userId: id, props: { referred: !!referrer } });
    res.status(201).json({ user: publicUser(db, user), next: '/app/wizard', dev_verification_link: devLink });
  });

  r.post('/login', limiter, (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = db.get('SELECT * FROM users WHERE email = ?', email);
    // Same message either way so the form does not reveal which emails are registered.
    if (!user || !verifyPassword(req.body.password || '', user.password_hash)) return res.status(401).json({ error: 'That email and password do not match.' });
    if (user.disabled_at) return res.status(403).json({ error: 'This account has been disabled. Please contact support.' });
    createSession(db, res, user.id, config);
    const hasWedding = db.get('SELECT 1 FROM wedding_members WHERE user_id = ?', user.id);
    res.json({ user: publicUser(db, user), next: hasWedding ? '/app' : '/app/wizard' });
  });

  r.post('/logout', (req, res) => {
    destroySession(db, req, res, config);
    res.json({ ok: true });
  });

  r.get('/me', (req, res) => {
    if (!req.user) return res.json({ user: null });
    res.json({ user: publicUser(db, req.user) });
  });

  r.post('/verify', limiter, (req, res) => {
    const row = consumeAuthToken(db, req.body.token, 'verify_email');
    if (!row) return res.status(400).json({ error: 'This verification link is invalid or has expired. Request a new one from your dashboard.' });
    db.run('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?', now(), now(), row.user_id);
    res.json({ ok: true });
  });

  r.post('/resend-verification', requireUser, emailLimiter, (req, res) => {
    if (req.user.email_verified_at) return res.json({ ok: true, already: true });
    res.json({ ok: true, dev_verification_link: startVerification(req.user) });
  });

  r.post('/forgot', emailLimiter, (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = validateEmail(email) ? db.get('SELECT * FROM users WHERE email = ? AND disabled_at IS NULL', email) : null;
    let devLink = null;
    if (user) {
      const token = createAuthToken(db, user.id, 'reset_password', 60);
      devLink = sendAccountEmail(ctx, user, 'reset_password', `${config.baseUrl}/reset?token=${encodeURIComponent(token)}`);
    }
    res.json({ ok: true, message: 'If an account exists for that email, we have sent a reset link.', dev_reset_link: devLink });
  });

  r.post('/reset', limiter, (req, res) => {
    const pwErr = validatePassword(req.body.password);
    if (pwErr) return res.status(400).json({ error: pwErr, fields: { password: pwErr } });
    const row = consumeAuthToken(db, req.body.token, 'reset_password');
    if (!row) return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
    db.tx(() => {
      db.run('UPDATE users SET password_hash = ?, email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?', hashPassword(req.body.password), now(), now(), row.user_id);
      db.run('DELETE FROM sessions WHERE user_id = ?', row.user_id); // sign out everywhere
    });
    createSession(db, res, row.user_id, config);
    res.json({ ok: true, next: '/app' });
  });

  return r;
}
