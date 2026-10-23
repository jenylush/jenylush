import express from 'express';
import { now, uuid, parseJson } from '../db.js';
import { requireAdmin } from '../auth.js';
import { HttpError, siteUrls } from '../services.js';
import { metrics, recentEvents } from '../analytics.js';
import { getSetting, setSetting, DEFAULT_SETTINGS } from '../seed.js';
import { coupleNames } from '../../shared/render.js';
import { userPlan } from '../entitlements.js';

// Admins manage the platform, not couples' private data: guest lists and RSVP answers
// are deliberately not exposed here.
export function adminRoutes(ctx) {
  const { db, config } = ctx;
  const r = express.Router();
  r.use(requireAdmin);

  r.get('/metrics', (req, res) => {
    res.json({ metrics: metrics(db, { sinceDays: Math.max(1, Math.min(3650, Number(req.query.days) || 90)) }), recent: recentEvents(db, 30) });
  });

  r.get('/users', (req, res) => {
    const q = `%${String(req.query.q || '').trim()}%`;
    const users = db.all(
      `SELECT u.id, u.email, u.name, u.role, u.email_verified_at, u.disabled_at, u.created_at,
         (SELECT COUNT(*) FROM wedding_members m WHERE m.user_id = u.id) AS weddings
       FROM users u WHERE u.email LIKE ? OR u.name LIKE ? ORDER BY u.created_at DESC LIMIT 200`, q, q
    ).map((u) => ({ ...u, plan: userPlan(db, u.id).id }));
    res.json({ users });
  });

  r.patch('/users/:id', (req, res) => {
    const u = db.get('SELECT * FROM users WHERE id = ?', req.params.id);
    if (!u) throw new HttpError(404, 'User not found.');
    if (u.id === req.user.id && (req.body.role === 'user' || req.body.disabled)) throw new HttpError(400, 'You cannot demote or disable yourself.');
    if (req.body.role === 'admin' || req.body.role === 'user') db.run('UPDATE users SET role = ? WHERE id = ?', req.body.role, u.id);
    if (req.body.disabled === true) { db.run('UPDATE users SET disabled_at = ? WHERE id = ?', now(), u.id); db.run('DELETE FROM sessions WHERE user_id = ?', u.id); }
    if (req.body.disabled === false) db.run('UPDATE users SET disabled_at = NULL WHERE id = ?', u.id);
    if (typeof req.body.plan_id === 'string') {
      // Manual grants (support, testing, comp accounts) — recorded as admin_grant, never as a payment.
      const plan = db.get('SELECT id FROM subscription_plans WHERE id = ?', req.body.plan_id);
      if (!plan) throw new HttpError(400, 'Unknown plan.');
      db.tx(() => {
        db.run("UPDATE user_subscriptions SET status = 'canceled' WHERE user_id = ? AND status = 'active' AND plan_id != 'free'", u.id);
        if (plan.id !== 'free') db.run("INSERT INTO user_subscriptions (id, user_id, plan_id, status, source, started_at, ends_at, created_at) VALUES (?, ?, ?, 'active', 'admin_grant', ?, ?, ?)", uuid(), u.id, plan.id, now(), req.body.ends_at || null, now());
      });
    }
    res.json({ ok: true });
  });

  r.get('/weddings', (req, res) => {
    const rows = db.all(
      `SELECT w.id, w.slug, w.partner1, w.partner2, w.status, w.visibility, w.visits, w.created_at, w.published_at, w.unpublished_reason, u.email AS owner_email,
         (SELECT COUNT(*) FROM content_reports c WHERE c.wedding_id = w.id AND c.status = 'open') AS open_reports
       FROM weddings w LEFT JOIN wedding_members m ON m.wedding_id = w.id AND m.role = 'owner' LEFT JOIN users u ON u.id = m.user_id
       ORDER BY w.created_at DESC LIMIT 300`
    ).map((w) => ({ ...w, names: coupleNames(w), url: siteUrls(config, w).primary }));
    res.json({ weddings: rows });
  });

  r.post('/weddings/:id/takedown', (req, res) => {
    const reason = String(req.body?.reason || 'policy').slice(0, 200);
    const out = db.run("UPDATE weddings SET status = 'draft', unpublished_reason = ? WHERE id = ?", `admin:${reason}`, req.params.id);
    if (!out.changes) throw new HttpError(404, 'Wedding not found.');
    res.json({ ok: true });
  });

  r.post('/weddings/:id/restore', (req, res) => {
    db.run('UPDATE weddings SET unpublished_reason = NULL WHERE id = ?', req.params.id);
    res.json({ ok: true });
  });

  r.get('/reports', (req, res) => {
    const reports = db.all(
      `SELECT c.*, w.slug, w.partner1, w.partner2, w.status AS wedding_status FROM content_reports c JOIN weddings w ON w.id = c.wedding_id
       ORDER BY CASE c.status WHEN 'open' THEN 0 ELSE 1 END, c.created_at DESC LIMIT 200`
    ).map((c) => ({ ...c, names: coupleNames(c), url: siteUrls(config, c).primary }));
    res.json({ reports });
  });

  r.patch('/reports/:id', (req, res) => {
    if (!['open', 'dismissed', 'actioned'].includes(req.body?.status)) throw new HttpError(400, 'Unknown status.');
    db.run('UPDATE content_reports SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ?', req.body.status, req.user.id, req.body.status === 'open' ? null : now(), req.params.id);
    res.json({ ok: true });
  });

  r.get('/templates', (req, res) => res.json({ templates: db.all('SELECT * FROM website_templates ORDER BY sort') }));

  r.patch('/templates/:id', (req, res) => {
    const t = db.get('SELECT * FROM website_templates WHERE id = ?', req.params.id);
    if (!t) throw new HttpError(404, 'Template not found.');
    if (req.body.tier !== undefined && !['free', 'premium'].includes(req.body.tier)) throw new HttpError(400, 'Tier must be free or premium.');
    db.run('UPDATE website_templates SET enabled = ?, tier = ?, sort = ? WHERE id = ?',
      req.body.enabled === undefined ? t.enabled : req.body.enabled ? 1 : 0, req.body.tier ?? t.tier, Number.isInteger(req.body.sort) ? req.body.sort : t.sort, t.id);
    res.json({ ok: true });
  });

  r.get('/plans', (req, res) => {
    res.json({ plans: db.all('SELECT * FROM subscription_plans ORDER BY sort').map((p) => ({ ...p, entitlements: parseJson(p.entitlements, {}) })), payments_enabled: config.paymentsEnabled });
  });

  r.put('/plans/:id', (req, res) => {
    const p = db.get('SELECT * FROM subscription_plans WHERE id = ?', req.params.id);
    if (!p) throw new HttpError(404, 'Plan not found.');
    const b = req.body || {};
    const ent = b.entitlements && typeof b.entitlements === 'object' ? b.entitlements : parseJson(p.entitlements, {});
    const required = ['template_tiers', 'font_tiers', 'animations', 'sections', 'storage_mb', 'max_photos', 'max_upload_mb', 'custom_questions', 'email_workflows', 'coowners'];
    const missing = required.filter((k) => !(k in ent));
    if (missing.length) throw new HttpError(400, `Entitlements are missing: ${missing.join(', ')}.`);
    if (b.status !== undefined && !['active', 'coming_soon', 'hidden'].includes(b.status)) throw new HttpError(400, 'Unknown status.');
    if (p.id === 'free' && b.status && b.status !== 'active') throw new HttpError(400, 'The free plan must stay active.');
    db.run('UPDATE subscription_plans SET name = ?, description = ?, price_cents = ?, currency = ?, billing_interval = ?, status = ?, entitlements = ?, updated_at = ? WHERE id = ?',
      String(b.name ?? p.name).slice(0, 60), String(b.description ?? p.description).slice(0, 400), Math.max(0, parseInt(b.price_cents ?? p.price_cents, 10) || 0),
      String(b.currency ?? p.currency).toUpperCase().slice(0, 3), ['one_time', 'month', 'year'].includes(b.billing_interval) ? b.billing_interval : p.billing_interval,
      b.status ?? p.status, JSON.stringify(ent), now(), p.id);
    res.json({ ok: true });
  });

  r.get('/settings', (req, res) => {
    const settings = Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((k) => [k, getSetting(db, k, DEFAULT_SETTINGS[k])]));
    res.json({
      settings,
      environment: {
        email_provider: ctx.provider.name, email_configured: ctx.provider.configured, payments_enabled: config.paymentsEnabled,
        site_base_domain: config.siteBaseDomain || null, base_url: config.baseUrl, scheduler_enabled: config.schedulerEnabled
      }
    });
  });

  r.put('/settings', (req, res) => {
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in (req.body || {})) setSetting(db, k, typeof DEFAULT_SETTINGS[k] === 'boolean' ? !!req.body[k] : String(req.body[k]).slice(0, 500));
    res.json({ ok: true });
  });

  // Delivery health: failed emails and scheduled messages across the platform.
  r.get('/email-health', (req, res) => {
    const counts = Object.fromEntries(db.all('SELECT status, COUNT(*) AS n FROM email_delivery_logs GROUP BY status').map((x) => [x.status, x.n]));
    const failures = db.all("SELECT id, wedding_id, type, to_email, status, attempts, last_error, updated_at FROM email_delivery_logs WHERE status IN ('failed','bounced','complained') ORDER BY updated_at DESC LIMIT 100");
    const scheduled = Object.fromEntries(db.all('SELECT status, COUNT(*) AS n FROM scheduled_messages GROUP BY status').map((x) => [x.status, x.n]));
    const overdue = db.get("SELECT COUNT(*) AS n FROM scheduled_messages WHERE status = 'pending' AND send_at < ?", new Date(Date.now() - 15 * 60000).toISOString()).n;
    res.json({ counts, failures, scheduled, overdue, provider: ctx.provider.name, configured: ctx.provider.configured });
  });

  r.post('/email-health/:id/retry', (req, res) => {
    const out = db.run("UPDATE email_delivery_logs SET status = 'queued', next_attempt_at = ?, updated_at = ? WHERE id = ? AND status = 'failed'", now(), now(), req.params.id);
    if (!out.changes) throw new HttpError(400, 'Only failed emails can be retried.');
    ctx.deps.kick?.();
    res.json({ ok: true });
  });

  return r;
}
