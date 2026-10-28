// SQLite storage (Node's built-in node:sqlite). Every wedding-specific table carries a
// wedding_id foreign key; templates and plans are platform-level records kept apart
// from couples' content. Timestamps are ISO-8601 UTC strings.

import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  email_verified_at TEXT,
  disabled_at TEXT,
  referral_code TEXT UNIQUE,
  referred_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  marketing_opt_in INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,               -- sha256 of the cookie token
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('verify_email','reset_password')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS website_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  style TEXT NOT NULL,
  description TEXT NOT NULL,
  tier TEXT NOT NULL DEFAULT 'free',
  enabled INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weddings (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE COLLATE NOCASE,
  partner1 TEXT NOT NULL DEFAULT '',
  partner2 TEXT NOT NULL DEFAULT '',
  wedding_date_local TEXT,            -- 'YYYY-MM-DDTHH:mm' wall-clock time at the wedding
  timezone TEXT NOT NULL DEFAULT 'UTC',
  wedding_at_utc TEXT,                -- the same instant in UTC, derived from the two above
  location TEXT NOT NULL DEFAULT '',
  tagline TEXT NOT NULL DEFAULT '',
  locale TEXT NOT NULL DEFAULT 'en-GB',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','password','private')),
  site_password_hash TEXT,
  search_indexing INTEGER NOT NULL DEFAULT 0,
  rsvp_deadline TEXT,                 -- 'YYYY-MM-DD', closes at the end of that day in the wedding timezone
  rsvp_mode TEXT NOT NULL DEFAULT 'open' CHECK (rsvp_mode IN ('open','invite_only')),
  rsvp_plus_ones TEXT NOT NULL DEFAULT 'invited_only' CHECK (rsvp_plus_ones IN ('none','invited_only','everyone')),
  rsvp_collect_email TEXT NOT NULL DEFAULT 'optional' CHECK (rsvp_collect_email IN ('optional','required')),
  rsvp_dietary INTEGER NOT NULL DEFAULT 1,
  rsvp_accessibility INTEGER NOT NULL DEFAULT 0,
  automation_paused INTEGER NOT NULL DEFAULT 0,
  custom_domain TEXT UNIQUE COLLATE NOCASE,
  custom_domain_verified_at TEXT,
  setup_step INTEGER NOT NULL DEFAULT 1,
  draft_version INTEGER NOT NULL DEFAULT 1,
  visits INTEGER NOT NULL DEFAULT 0,
  creation_started_at TEXT NOT NULL,
  first_published_at TEXT,
  published_at TEXT,
  unpublished_reason TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wedding_members (
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','coowner')),
  can_edit INTEGER NOT NULL DEFAULT 1,
  can_manage_guests INTEGER NOT NULL DEFAULT 1,
  can_publish INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (wedding_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON wedding_members(user_id);

CREATE TABLE IF NOT EXISTS member_invites (
  id TEXT PRIMARY KEY,
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  token_hash TEXT NOT NULL UNIQUE,
  can_edit INTEGER NOT NULL DEFAULT 1,
  can_manage_guests INTEGER NOT NULL DEFAULT 1,
  can_publish INTEGER NOT NULL DEFAULT 0,
  invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS website_designs (
  wedding_id TEXT PRIMARY KEY REFERENCES weddings(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES website_templates(id),
  palette TEXT NOT NULL,              -- JSON design tokens
  font_pairing TEXT NOT NULL,
  animation TEXT NOT NULL DEFAULT 'subtle' CHECK (animation IN ('static','subtle','expressive')),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS website_sections (
  id TEXT PRIMARY KEY,
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  position INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','hidden','removed')),
  content TEXT NOT NULL,              -- JSON
  settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sections_wedding ON website_sections(wedding_id, position);

CREATE TABLE IF NOT EXISTS published_versions (
  id TEXT PRIMARY KEY,
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  snapshot TEXT NOT NULL,             -- JSON copy of the couple's design, sections and media at publish time
  published_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_published_wedding ON published_versions(wedding_id, created_at);

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'gallery' CHECK (kind IN ('gallery','library')),
  original_name TEXT NOT NULL DEFAULT '',
  bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  caption TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  is_cover INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_wedding ON media_assets(wedding_id, position);

CREATE TABLE IF NOT EXISTS guests (
  id TEXT PRIMARY KEY,
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT COLLATE NOCASE,
  phone TEXT NOT NULL DEFAULT '',
  household TEXT NOT NULL DEFAULT '',
  plus_one_allowed INTEGER NOT NULL DEFAULT 0,
  private_events INTEGER NOT NULL DEFAULT 0,  -- may see and RSVP to restricted events
  invite_code TEXT NOT NULL UNIQUE,
  invitation_status TEXT NOT NULL DEFAULT 'not_invited' CHECK (invitation_status IN ('not_invited','invited')),
  invited_at TEXT,
  updates_opt_in INTEGER NOT NULL DEFAULT 0,
  unsubscribed_at TEXT,
  unsubscribe_token TEXT NOT NULL UNIQUE,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_guests_wedding ON guests(wedding_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_guests_email ON guests(wedding_id, email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  guest_id TEXT NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email','link','whatsapp','sms','other')),
  delivery_log_id TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS form_definitions (
  id TEXT PRIMARY KEY,
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'rsvp',
  questions TEXT NOT NULL DEFAULT '[]',   -- JSON [{id,label,type,options,required}]
  updated_at TEXT NOT NULL,
  UNIQUE (wedding_id, kind)
);

CREATE TABLE IF NOT EXISTS rsvp_submissions (
  id TEXT PRIMARY KEY,
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  guest_id TEXT REFERENCES guests(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT COLLATE NOCASE,
  attending TEXT NOT NULL CHECK (attending IN ('yes','no')),
  events TEXT NOT NULL DEFAULT '[]',
  plus_one_name TEXT,
  dietary TEXT NOT NULL DEFAULT '',
  accessibility TEXT NOT NULL DEFAULT '',
  updates_opt_in INTEGER NOT NULL DEFAULT 0,
  is_latest INTEGER NOT NULL DEFAULT 1,
  superseded_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rsvp_wedding ON rsvp_submissions(wedding_id, is_latest);

CREATE TABLE IF NOT EXISTS form_submissions (
  id TEXT PRIMARY KEY,
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  form_definition_id TEXT REFERENCES form_definitions(id) ON DELETE SET NULL,
  rsvp_submission_id TEXT REFERENCES rsvp_submissions(id) ON DELETE CASCADE,
  answers TEXT NOT NULL,                 -- JSON {questionId: {label, value}}
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consent_records (
  id TEXT PRIMARY KEY,
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  guest_id TEXT REFERENCES guests(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                    -- 'wedding_updates' | 'all_email'
  granted INTEGER NOT NULL,
  source TEXT NOT NULL,                  -- 'rsvp_form' | 'unsubscribe_link' | 'couple'
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_automation_rules (
  id TEXT PRIMARY KEY,
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  UNIQUE (wedding_id, type)
);

CREATE TABLE IF NOT EXISTS scheduled_messages (
  id TEXT PRIMARY KEY,
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  rule_id TEXT REFERENCES email_automation_rules(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  occurrence_key TEXT NOT NULL,
  send_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','cancelled','expired')),
  payload TEXT NOT NULL DEFAULT '{}',
  recipients INTEGER,
  processed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (wedding_id, type, occurrence_key)
);
CREATE INDEX IF NOT EXISTS idx_sched_due ON scheduled_messages(status, send_at);

CREATE TABLE IF NOT EXISTS email_delivery_logs (
  id TEXT PRIMARY KEY,
  wedding_id TEXT REFERENCES weddings(id) ON DELETE CASCADE,
  scheduled_message_id TEXT REFERENCES scheduled_messages(id) ON DELETE SET NULL,
  guest_id TEXT REFERENCES guests(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  text TEXT NOT NULL,
  essential INTEGER NOT NULL DEFAULT 1,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','delivered','bounced','complained','failed','not_configured','suppressed')),
  provider TEXT,
  provider_message_id TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_delivery_queue ON email_delivery_logs(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_delivery_provider ON email_delivery_logs(provider_message_id);

CREATE TABLE IF NOT EXISTS subscription_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  billing_interval TEXT NOT NULL DEFAULT 'one_time',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','coming_soon','hidden')),
  entitlements TEXT NOT NULL,         -- JSON, see src/entitlements.js
  sort INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES subscription_plans(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','canceled','expired')),
  source TEXT NOT NULL DEFAULT 'default' CHECK (source IN ('default','admin_grant','payment')),
  started_at TEXT NOT NULL,
  ends_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subs_user ON user_subscriptions(user_id, status);

CREATE TABLE IF NOT EXISTS payment_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  subscription_id TEXT REFERENCES user_subscriptions(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  provider_ref TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS upgrade_interest (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL,
  feature TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, plan_id)
);

CREATE TABLE IF NOT EXISTS gift_registries (
  id TEXT PRIMARY KEY,
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  provider TEXT,
  external_url TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gift_contributions (
  id TEXT PRIMARY KEY,
  registry_id TEXT NOT NULL REFERENCES gift_registries(id) ON DELETE CASCADE,
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  guest_name TEXT,
  amount_cents INTEGER,
  currency TEXT,
  message TEXT,
  payment_transaction_id TEXT REFERENCES payment_transactions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  wedding_id TEXT REFERENCES weddings(id) ON DELETE SET NULL,
  props TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_name ON product_events(name, created_at);

CREATE TABLE IF NOT EXISTS content_reports (
  id TEXT PRIMARY KEY,
  wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  reporter_email TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','dismissed','actioned')),
  resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
`;

export function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'app.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  return wrap(db);
}

// Additive migrations for databases created by earlier versions.
function migrate(db) {
  const userCols = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
  const add = (col, def) => { if (!userCols.has(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`); };
  add('totp_secret', 'TEXT');
  add('totp_enabled_at', 'TEXT');
  add('totp_last_counter', 'INTEGER');
  add('recovery_codes', 'TEXT');
  db.exec(`
    CREATE TABLE IF NOT EXISTS security_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      subject TEXT,                 -- hashed login identifier, for lockout counting
      ip TEXT,
      user_agent TEXT,
      detail TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_security_subject ON security_events(subject, type, created_at);
    CREATE INDEX IF NOT EXISTS idx_security_user ON security_events(user_id, created_at);

    CREATE TABLE IF NOT EXISTS budget_settings (
      wedding_id TEXT PRIMARY KEY REFERENCES weddings(id) ON DELETE CASCADE,
      currency TEXT NOT NULL DEFAULT 'USD',
      total_budget_minor INTEGER NOT NULL DEFAULT 0,
      reminders_enabled INTEGER NOT NULL DEFAULT 1,  -- email the couple before payments are due
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS budget_categories (
      id TEXT PRIMARY KEY,
      wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      planned_minor INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_budget_cat ON budget_categories(wedding_id, position);
    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
      category_id TEXT REFERENCES budget_categories(id) ON DELETE SET NULL,
      item TEXT NOT NULL,
      vendor TEXT NOT NULL DEFAULT '',
      vendor_contact TEXT NOT NULL DEFAULT '',
      estimated_minor INTEGER,
      actual_minor INTEGER,            -- NULL until the real price is agreed
      paid_minor INTEGER NOT NULL DEFAULT 0,
      due_date TEXT,                   -- 'YYYY-MM-DD' next payment due
      paid_by TEXT NOT NULL DEFAULT 'Us',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_expenses_wedding ON expenses(wedding_id, due_date);
    CREATE TABLE IF NOT EXISTS gifts_received (
      id TEXT PRIMARY KEY,
      wedding_id TEXT NOT NULL REFERENCES weddings(id) ON DELETE CASCADE,
      guest_id TEXT REFERENCES guests(id) ON DELETE SET NULL,
      giver_name TEXT NOT NULL,
      gift_type TEXT NOT NULL DEFAULT 'cash',
      description TEXT NOT NULL DEFAULT '',
      amount_minor INTEGER,            -- cash amount or estimated value of an item
      received_date TEXT,
      thank_you_sent_at TEXT,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gifts_wedding ON gifts_received(wedding_id);
  `);
}

// Small helper layer: prepared statement cache, JSON-friendly helpers and transactions.
function wrap(db) {
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = db.prepare(sql); cache.set(sql, s); }
    return s;
  };
  let depth = 0;
  return {
    raw: db,
    get: (sql, ...params) => stmt(sql).get(...params) ?? null,
    all: (sql, ...params) => stmt(sql).all(...params),
    run: (sql, ...params) => stmt(sql).run(...params),
    exec: (sql) => db.exec(sql),
    tx(fn) {
      if (depth > 0) return fn();
      depth++;
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      } finally {
        depth--;
      }
    },
    close: () => db.close()
  };
}

export const now = () => new Date().toISOString();
export const uuid = () => randomUUID();

export function parseJson(value, fallback) {
  if (value == null) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}
