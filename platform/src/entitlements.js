// Plan entitlements. The values below are only the *initial seed*; the live values are
// stored in subscription_plans.entitlements and edited from the admin area, so no
// limit or price is hardcoded anywhere else in the app.

import { now, parseJson } from './db.js';

export const FREE_SECTIONS = ['hero', 'story', 'countdown', 'details', 'gallery', 'rsvp', 'faq', 'dresscode', 'venue', 'travel', 'registry'];
export const ALL_SECTIONS = [...FREE_SECTIONS, 'party', 'guestbook', 'games', 'programme'];

export const SEED_PLANS = [
  {
    id: 'free', name: 'Free', sort: 1, price_cents: 0, currency: 'USD', billing_interval: 'one_time', status: 'active',
    description: 'Everything you need to publish a beautiful wedding website and collect RSVPs.',
    entitlements: {
      template_tiers: ['free'], font_tiers: ['free'], animations: ['static', 'subtle'],
      advanced_colours: false, sections: FREE_SECTIONS,
      storage_mb: 100, max_photos: 40, max_upload_mb: 10,
      custom_questions: 2, email_workflows: ['rsvp_confirmation', 'invitation'],
      password_protection: false, custom_domain: false, remove_branding: false, advanced_exports: false,
      coowners: 1
    }
  },
  {
    id: 'premium', name: 'Premium', sort: 2, price_cents: 4900, currency: 'USD', billing_interval: 'one_time', status: 'coming_soon',
    description: 'Every template, full design control, scheduled guest emails and more privacy options.',
    entitlements: {
      template_tiers: ['free', 'premium'], font_tiers: ['free', 'premium'], animations: ['static', 'subtle', 'expressive'],
      advanced_colours: true, sections: ALL_SECTIONS,
      storage_mb: 2048, max_photos: 500, max_upload_mb: 25,
      custom_questions: 20, email_workflows: ['rsvp_confirmation', 'invitation', 'rsvp_reminder', 'biweekly_update', 'final_reminders', 'update_notification'],
      password_protection: true, custom_domain: true, remove_branding: true, advanced_exports: true,
      coowners: 3
    }
  },
  {
    id: 'premium_plus', name: 'Premium Plus', sort: 3, price_cents: 0, currency: 'USD', billing_interval: 'one_time', status: 'hidden',
    description: 'Reserved for future testing: guest segmentation, expanded storage, registry integrations, extended hosting and post-wedding galleries.',
    entitlements: {
      template_tiers: ['free', 'premium'], font_tiers: ['free', 'premium'], animations: ['static', 'subtle', 'expressive'],
      advanced_colours: true, sections: ALL_SECTIONS,
      storage_mb: 10240, max_photos: 2000, max_upload_mb: 25,
      custom_questions: 50, email_workflows: ['rsvp_confirmation', 'invitation', 'rsvp_reminder', 'biweekly_update', 'final_reminders', 'update_notification'],
      password_protection: true, custom_domain: true, remove_branding: true, advanced_exports: true,
      coowners: 10
    }
  }
];

// Human-readable feature names used in upgrade prompts.
export const FEATURE_LABELS = {
  template: 'Premium templates',
  font: 'Premium font pairings',
  animation: 'Expressive animations',
  advanced_colours: 'Individual colour controls',
  section: 'This section',
  storage: 'More photo storage',
  photos: 'More photos',
  custom_questions: 'More custom RSVP questions',
  email_workflow: 'Scheduled guest emails',
  password_protection: 'Password-protected websites',
  custom_domain: 'Custom domains',
  remove_branding: 'Removing platform branding',
  advanced_exports: 'Full RSVP history exports',
  coowners: 'More collaborators'
};

export class PlanLimitError extends Error {
  constructor(feature, message) {
    super(message);
    this.status = 402;
    this.code = 'plan_limit';
    this.feature = feature;
  }
}

export function getPlan(db, planId) {
  const row = db.get('SELECT * FROM subscription_plans WHERE id = ?', planId);
  if (!row) return null;
  return { ...row, entitlements: parseJson(row.entitlements, {}) };
}

export function activeSubscription(db, userId) {
  return db.get(
    `SELECT * FROM user_subscriptions WHERE user_id = ? AND status = 'active' AND (ends_at IS NULL OR ends_at > ?)
     ORDER BY CASE plan_id WHEN 'free' THEN 1 ELSE 0 END, started_at DESC LIMIT 1`,
    userId, now()
  );
}

export function userPlan(db, userId) {
  const sub = userId ? activeSubscription(db, userId) : null;
  return getPlan(db, sub ? sub.plan_id : 'free') || getPlan(db, 'free');
}

// A wedding's entitlements come from its owner's plan, so co-owners on the free plan
// can still edit a premium couple's site.
export function weddingPlan(db, weddingId) {
  const owner = db.get("SELECT user_id FROM wedding_members WHERE wedding_id = ? AND role = 'owner'", weddingId);
  return userPlan(db, owner?.user_id);
}

export function storageUsed(db, weddingId) {
  const r = db.get('SELECT COALESCE(SUM(bytes),0) AS bytes, COUNT(*) AS count FROM media_assets WHERE wedding_id = ?', weddingId);
  return { bytes: r.bytes, count: r.count };
}
