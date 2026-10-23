import express from 'express';
import { parseJson } from '../db.js';
import { TEMPLATES } from '../../shared/templates.js';
import { getSetting } from '../seed.js';

export function publicApiRoutes(ctx) {
  const { db, config } = ctx;
  const r = express.Router();

  // Template list merges the code definition (structure) with admin-controlled DB state.
  r.get('/templates', (req, res) => {
    const rows = new Map(db.all('SELECT * FROM website_templates').map((t) => [t.id, t]));
    const templates = TEMPLATES.filter((t) => rows.get(t.id)?.enabled)
      .map((t) => ({ id: t.id, name: t.name, style: t.style, description: t.description, tier: rows.get(t.id).tier, sort: rows.get(t.id).sort, defaults: t.defaults, layouts: t.layouts, supportedSections: t.supportedSections }))
      .sort((a, b) => a.sort - b.sort);
    res.json({ templates });
  });

  r.get('/plans', (req, res) => {
    const plans = db.all("SELECT id, name, description, price_cents, currency, billing_interval, status, entitlements FROM subscription_plans WHERE status != 'hidden' ORDER BY sort")
      .map((p) => ({ ...p, entitlements: parseJson(p.entitlements, {}) }));
    res.json({ plans, payments_enabled: config.paymentsEnabled });
  });

  r.get('/config', (req, res) => {
    res.json({
      platform_name: config.platformName, support_email: config.supportEmail, payments_enabled: config.paymentsEnabled,
      site_base_domain: config.siteBaseDomain || null, base_url: config.baseUrl, announcement: getSetting(db, 'announcement', ''),
      email_configured: ctx.provider.configured, signups_enabled: getSetting(db, 'signups_enabled', true)
    });
  });

  return r;
}
