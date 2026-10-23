import express from 'express';
import { now, parseJson } from '../db.js';
import { member } from './access.js';
import { HttpError, getWedding } from '../services.js';
import { WORKFLOWS, DEFAULT_RULE_CONFIG } from '../email/templates.js';
import { getRules, syncSchedule, previewEmail } from '../notifications.js';
import { weddingPlan, PlanLimitError } from '../entitlements.js';
import { track } from '../analytics.js';

function cleanConfig(type, input, current) {
  const c = { ...(DEFAULT_RULE_CONFIG[type] || {}), ...current };
  const b = input && typeof input === 'object' ? input : {};
  const days = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(',')).map((x) => parseInt(x, 10)).filter((n) => n >= 0 && n <= 365))].sort((a, z) => z - a).slice(0, 6);
  if ('message' in b) c.message = String(b.message || '').slice(0, 3000);
  if ('subject' in b) c.subject = String(b.subject || '').slice(0, 150);
  if ('send_hour' in b) c.send_hour = Math.max(0, Math.min(23, parseInt(b.send_hour, 10) || 10));
  if ('days_before_deadline' in b) c.days_before_deadline = days(b.days_before_deadline);
  if ('days_before' in b) c.days_before = days(b.days_before);
  if ('start_date' in b) {
    if (b.start_date && !/^\d{4}-\d{2}-\d{2}$/.test(b.start_date)) throw new HttpError(400, 'Enter a valid start date.');
    c.start_date = b.start_date || '';
  }
  return c;
}

export function emailRoutes(ctx) {
  const { db } = ctx;
  const r = express.Router();

  r.get('/:weddingId/automations', member(db), (req, res) => {
    const ent = weddingPlan(db, req.weddingId).entitlements;
    const w = getWedding(db, req.weddingId);
    const upcoming = db.all("SELECT type, send_at, status, occurrence_key FROM scheduled_messages WHERE wedding_id = ? AND status = 'pending' ORDER BY send_at LIMIT 50", req.weddingId);
    const rules = getRules(db, req.weddingId).map((rule) => ({
      type: rule.type, enabled: rule.enabled, config: rule.config, ...WORKFLOWS[rule.type],
      allowed: ent.email_workflows.includes(rule.type),
      upcoming: upcoming.filter((u) => u.type === rule.type)
    }));
    res.json({
      rules: Object.keys(WORKFLOWS).map((t) => rules.find((x) => x.type === t)).filter(Boolean),
      paused: !!w.automation_paused, timezone: w.timezone, rsvp_deadline: w.rsvp_deadline, wedding_date_local: w.wedding_date_local,
      provider_configured: ctx.provider.configured, provider: ctx.provider.name
    });
  });

  r.put('/:weddingId/automations/:type', member(db, 'edit'), (req, res) => {
    const type = req.params.type;
    if (!WORKFLOWS[type]) throw new HttpError(404, 'Unknown workflow.');
    const rule = db.get('SELECT * FROM email_automation_rules WHERE wedding_id = ? AND type = ?', req.weddingId, type);
    const ent = weddingPlan(db, req.weddingId).entitlements;
    const enabling = req.body?.enabled === true && !rule.enabled;
    if (enabling && !ent.email_workflows.includes(type)) throw new PlanLimitError('email_workflow', `${WORKFLOWS[type].name} emails are part of Premium.`);
    const config = cleanConfig(type, req.body?.config, parseJson(rule.config, {}));
    const enabled = req.body?.enabled === undefined ? rule.enabled : (req.body.enabled ? 1 : 0);
    db.run('UPDATE email_automation_rules SET enabled = ?, config = ?, updated_at = ? WHERE id = ?', enabled, JSON.stringify(config), now(), rule.id);
    if (enabling) track(db, 'email_automation_enabled', { userId: req.user.id, weddingId: req.weddingId, props: { workflow: type } });
    const sync = syncSchedule(db, req.weddingId);
    res.json({ ok: true, enabled: !!enabled, config, schedule: sync });
  });

  // Renders the email with the couple's real details and the current (possibly unsaved) config.
  r.post('/:weddingId/automations/:type/preview', member(db), (req, res) => {
    const type = req.params.type;
    if (!WORKFLOWS[type]) throw new HttpError(404, 'Unknown workflow.');
    const rule = db.get('SELECT config FROM email_automation_rules WHERE wedding_id = ? AND type = ?', req.weddingId, type);
    const config = cleanConfig(type, req.body?.config, parseJson(rule?.config, {}));
    const email = previewEmail(ctx.deps, req.weddingId, type, { config });
    res.json({ subject: email.subject, html: email.html, text: email.text });
  });

  r.get('/:weddingId/email-log', member(db, 'guests'), (req, res) => {
    const rows = db.all(
      `SELECT l.id, l.type, l.to_email, l.subject, l.status, l.attempts, l.last_error, l.created_at, l.updated_at, g.first_name, g.last_name
       FROM email_delivery_logs l LEFT JOIN guests g ON g.id = l.guest_id WHERE l.wedding_id = ? ORDER BY l.created_at DESC LIMIT 200`, req.weddingId
    );
    const counts = Object.fromEntries(db.all('SELECT status, COUNT(*) AS n FROM email_delivery_logs WHERE wedding_id = ? GROUP BY status', req.weddingId).map((x) => [x.status, x.n]));
    res.json({ log: rows, counts });
  });

  return r;
}
