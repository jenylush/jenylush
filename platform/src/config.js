// All runtime configuration comes from environment variables (see .env.example).
// Prices, plan limits and template tiers are NOT here: they live in the database and
// are editable from the admin area.

import path from 'node:path';
import fs from 'node:fs';

loadDotEnv();

function loadDotEnv() {
  const file = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const bool = (v, d = false) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(v));

export function loadConfig(overrides = {}) {
  const env = { ...process.env, ...overrides };
  const port = Number(env.PORT || 3000);
  const baseUrl = (env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, '');
  const production = env.NODE_ENV === 'production';
  return {
    port,
    production,
    baseUrl,
    platformName: env.PLATFORM_NAME || 'Vowly',
    supportEmail: env.SUPPORT_EMAIL || 'hello@example.com',
    // Wedding sites are served at <slug>.<SITE_BASE_DOMAIN> when set, and always at /w/<slug>.
    siteBaseDomain: (env.SITE_BASE_DOMAIN || '').toLowerCase().replace(/^\./, ''),
    dataDir: path.resolve(env.DATA_DIR || './data'),
    cookieSecure: bool(env.COOKIE_SECURE, production),
    trustProxy: bool(env.TRUST_PROXY, production),
    secret: env.APP_SECRET || '',
    adminEmails: (env.ADMIN_EMAILS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
    email: {
      provider: (env.EMAIL_PROVIDER || 'none').toLowerCase(), // resend | smtp | none
      from: env.EMAIL_FROM || '',
      resendApiKey: env.RESEND_API_KEY || '',
      resendWebhookSecret: env.RESEND_WEBHOOK_SECRET || '',
      smtpUrl: env.SMTP_URL || ''
    },
    // Freemium launch: payments stay off until a payment provider is configured.
    paymentsEnabled: bool(env.PAYMENTS_ENABLED, false),
    schedulerIntervalMs: Number(env.SCHEDULER_INTERVAL_MS || 30000),
    schedulerEnabled: bool(env.SCHEDULER_ENABLED, true),
    rateLimitScale: Number(env.RATE_LIMIT_SCALE || 1),
    exposeDevLinks: !production && bool(env.EXPOSE_DEV_LINKS, true)
  };
}
