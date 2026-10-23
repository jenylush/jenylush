// Seeds platform-level records on startup. Existing rows are left alone so admin
// edits to plans, template tiers and settings survive restarts.

import { randomBytes } from 'node:crypto';
import { now } from './db.js';
import { TEMPLATES } from '../shared/templates.js';
import { SEED_PLANS } from './entitlements.js';

export const DEFAULT_SETTINGS = {
  signups_enabled: true,
  announcement: '',
  default_locale: 'en-GB',
  // Anti-spam ceilings for guest emails sent from one wedding.
  max_invitations_per_day: 500
};

export function seed(db) {
  const ts = now();
  db.tx(() => {
    TEMPLATES.forEach((t, i) => {
      db.run(
        `INSERT INTO website_templates (id, name, style, description, tier, enabled, sort, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, style = excluded.style, description = excluded.description`,
        t.id, t.name, t.style, t.description, t.tier, i, ts
      );
    });
    for (const p of SEED_PLANS) {
      db.run(
        `INSERT OR IGNORE INTO subscription_plans (id, name, description, price_cents, currency, billing_interval, status, entitlements, sort, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        p.id, p.name, p.description, p.price_cents, p.currency, p.billing_interval, p.status, JSON.stringify(p.entitlements), p.sort, ts
      );
    }
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      db.run('INSERT OR IGNORE INTO platform_settings (key, value, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(value), ts);
    }
    db.run('INSERT OR IGNORE INTO platform_settings (key, value, updated_at) VALUES (?, ?, ?)', 'app_secret', JSON.stringify(randomBytes(32).toString('hex')), ts);
  });
}

export function getSetting(db, key, fallback = null) {
  const row = db.get('SELECT value FROM platform_settings WHERE key = ?', key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
}

export function setSetting(db, key, value) {
  db.run(
    'INSERT INTO platform_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    key, JSON.stringify(value), now()
  );
}
