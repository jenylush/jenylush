// Product analytics stored in our own database. Events carry IDs and small
// non-personal properties only — never names, emails or free text.

import { now, uuid, parseJson } from './db.js';

export const EVENT_NAMES = [
  'account_created', 'website_creation_started', 'template_selected', 'colour_settings_changed',
  'gallery_image_uploaded', 'section_added', 'section_removed', 'preview_opened', 'website_published',
  'website_shared', 'guest_rsvp_submitted', 'email_automation_enabled', 'paid_upgrade_viewed',
  'subscription_purchased', 'upgrade_interest_registered'
];

// Events the browser may report directly (everything else is recorded server-side).
export const CLIENT_EVENTS = new Set(['preview_opened', 'website_shared', 'paid_upgrade_viewed']);

const ALLOWED_PROP = /^[a-z_]{1,32}$/;

export function track(db, name, { userId = null, weddingId = null, props = {} } = {}) {
  if (!EVENT_NAMES.includes(name)) return;
  const clean = {};
  for (const [k, v] of Object.entries(props || {})) {
    if (!ALLOWED_PROP.test(k)) continue;
    if (typeof v === 'number' || typeof v === 'boolean') clean[k] = v;
    else if (typeof v === 'string' && /^[a-z0-9_:.-]{0,64}$/i.test(v)) clean[k] = v;
  }
  try {
    db.run('INSERT INTO product_events (id, name, user_id, wedding_id, props, created_at) VALUES (?, ?, ?, ?, ?, ?)', uuid(), name, userId, weddingId, JSON.stringify(clean), now());
  } catch (err) {
    console.error('analytics: failed to record event', name, err.message);
  }
}

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Product metrics for the admin dashboard. `sinceDays` limits the cohort of new users.
export function metrics(db, { sinceDays = 90 } = {}) {
  const since = new Date(Date.now() - sinceDays * 864e5).toISOString();
  const newUsers = db.get('SELECT COUNT(*) AS n FROM users WHERE created_at >= ?', since).n;
  const activated = db.get(
    `SELECT COUNT(DISTINCT u.id) AS n FROM users u JOIN wedding_members m ON m.user_id = u.id AND m.role = 'owner'
     JOIN weddings w ON w.id = m.wedding_id WHERE u.created_at >= ? AND w.first_published_at IS NOT NULL`, since
  ).n;
  const publishTimes = db.all(
    'SELECT creation_started_at, first_published_at FROM weddings WHERE first_published_at IS NOT NULL AND created_at >= ?', since
  ).map((r) => (Date.parse(r.first_published_at) - Date.parse(r.creation_started_at)) / 36e5);
  const published = db.get("SELECT COUNT(*) AS n FROM weddings WHERE status = 'published'").n;
  // "Meaningful guest interaction": at least one RSVP submitted.
  const engaged = db.get(
    "SELECT COUNT(DISTINCT w.id) AS n FROM weddings w JOIN rsvp_submissions r ON r.wedding_id = w.id WHERE w.status = 'published'"
  ).n;
  const invited = db.get("SELECT COUNT(*) AS n FROM guests WHERE invitation_status = 'invited'").n;
  const invitedResponded = db.get(
    "SELECT COUNT(DISTINCT g.id) AS n FROM guests g JOIN rsvp_submissions r ON r.guest_id = g.id WHERE g.invitation_status = 'invited'"
  ).n;
  const totalUsers = db.get('SELECT COUNT(*) AS n FROM users').n;
  const paid = db.get("SELECT COUNT(DISTINCT user_id) AS n FROM user_subscriptions WHERE source = 'payment' AND plan_id != 'free'").n;
  const referrers = db.get('SELECT COUNT(DISTINCT referred_by) AS n FROM users WHERE referred_by IS NOT NULL').n;
  const couples = db.get("SELECT COUNT(DISTINCT user_id) AS n FROM wedding_members WHERE role = 'owner'").n;
  const interest = db.get('SELECT COUNT(*) AS n FROM upgrade_interest').n;
  const counts = Object.fromEntries(db.all('SELECT name, COUNT(*) AS n FROM product_events WHERE created_at >= ? GROUP BY name', since).map((r) => [r.name, r.n]));
  return {
    window_days: sinceDays,
    activation: { value: pct(activated, newUsers), activated, new_users: newUsers, label: 'New users who published a website' },
    time_to_publish_hours: { median: publishTimes.length ? Math.round(median(publishTimes) * 10) / 10 : null, samples: publishTimes.length },
    guest_engagement: { value: pct(engaged, published), engaged, published, label: 'Published websites with at least one RSVP' },
    rsvp_conversion: { value: pct(invitedResponded, invited), responded: invitedResponded, invited, label: 'Invited guests who responded' },
    paid_conversion: { value: pct(paid, totalUsers), paid, eligible: totalUsers, upgrade_interest: interest, label: 'Users with a paid plan' },
    referral_rate: { value: pct(referrers, couples), referrers, couples, label: 'Couples who referred someone' },
    event_counts: counts
  };
}

export function recentEvents(db, limit = 50) {
  return db.all('SELECT name, user_id, wedding_id, props, created_at FROM product_events ORDER BY created_at DESC LIMIT ?', limit)
    .map((e) => ({ ...e, props: parseJson(e.props, {}) }));
}
