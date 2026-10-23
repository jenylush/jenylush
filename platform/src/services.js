// Core wedding operations shared by the API routes: creating a wedding, loading and
// saving the editable draft, publishing a snapshot, and building site URLs.

import { now, uuid, parseJson } from './db.js';
import { SECTION_TYPES, DEFAULT_SECTIONS, isKnownSection, sanitizeContent, sanitizeSettings } from '../shared/sections.js';
import { TEMPLATES, getTemplate } from '../shared/templates.js';
import { FONT_PAIRINGS, getPairing } from '../shared/fonts.js';
import { PRESET_PALETTES, suggestPalette, normalizeHex, TOKEN_KEYS } from '../shared/color.js';
import { zonedToUtc, isValidTimeZone, deadlinePassed } from './timezone.js';
import { PlanLimitError, weddingPlan } from './entitlements.js';
import { DEFAULT_RULE_CONFIG, WORKFLOWS } from './email/templates.js';
import { randomBytes } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

export const RESERVED_SLUGS = new Set(['www', 'app', 'api', 'admin', 'mail', 'email', 'static', 'assets', 'media', 'help', 'support', 'blog', 'login', 'signup', 'dashboard', 'w', 'site', 'status', 'billing', 'docs', 'cdn', 'dev', 'staging', 'test']);
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/;

export function slugify(text) {
  return String(text || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/, '');
}

export function validateSlug(slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) return 'Use 3–50 lowercase letters, numbers or hyphens, starting and ending with a letter or number.';
  if (slug.includes('--')) return 'Avoid double hyphens.';
  if (RESERVED_SLUGS.has(slug)) return 'That address is reserved. Please choose another.';
  return null;
}

export function slugAvailable(db, slug, exceptWeddingId = null) {
  if (validateSlug(slug)) return false;
  const row = db.get('SELECT id FROM weddings WHERE slug = ?', slug);
  return !row || row.id === exceptWeddingId;
}

export function suggestSlug(db, partner1, partner2) {
  const base = slugify([partner1, partner2].filter(Boolean).join(' and ')) || 'our-wedding';
  let candidate = base.length < 3 ? `${base}-wedding` : base;
  for (let i = 0; i < 50; i++) {
    const c = i === 0 ? candidate : `${candidate.slice(0, 44)}-${i + 1}`;
    if (slugAvailable(db, c)) return c;
  }
  return `${candidate.slice(0, 40)}-${randomBytes(3).toString('hex')}`;
}

export function inviteCode() {
  // Unambiguous characters, e.g. "K7PM-Q2XD".
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[bytes[i] % alphabet.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

function cleanText(v, max = 200) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }

export function validateBasics(input, { partial = false } = {}) {
  const out = {};
  const errors = {};
  if (!partial || 'partner1' in input) { out.partner1 = cleanText(input.partner1, 80); if (!out.partner1) errors.partner1 = 'Please enter a name.'; }
  if (!partial || 'partner2' in input) { out.partner2 = cleanText(input.partner2, 80); if (!out.partner2) errors.partner2 = 'Please enter a name.'; }
  if (!partial || 'timezone' in input) {
    out.timezone = cleanText(input.timezone, 64) || 'UTC';
    if (!isValidTimeZone(out.timezone)) errors.timezone = 'Choose a valid timezone.';
  }
  if (!partial || 'wedding_date_local' in input) {
    const v = cleanText(input.wedding_date_local, 16);
    if (v && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) errors.wedding_date_local = 'Enter a date and time.';
    out.wedding_date_local = v || null;
  }
  if (!partial || 'location' in input) out.location = cleanText(input.location, 200);
  if (!partial || 'tagline' in input) out.tagline = cleanText(input.tagline, 200);
  if ('locale' in input) out.locale = /^[a-z]{2}(-[A-Z]{2})?$/.test(input.locale || '') ? input.locale : 'en-GB';
  return { values: out, errors };
}

export function createWedding(db, userId, basics) {
  const id = uuid();
  const ts = now();
  const tpl = getTemplate('ivory');
  const slug = suggestSlug(db, basics.partner1, basics.partner2);
  const atUtc = basics.wedding_date_local ? zonedToUtc(basics.wedding_date_local, basics.timezone)?.toISOString() : null;
  db.tx(() => {
    db.run(
      `INSERT INTO weddings (id, slug, partner1, partner2, wedding_date_local, timezone, wedding_at_utc, location, tagline, setup_step, creation_started_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 2, ?, ?, ?, ?)`,
      id, slug, basics.partner1, basics.partner2, basics.wedding_date_local, basics.timezone, atUtc, basics.location || '', basics.tagline || '', ts, userId, ts, ts
    );
    db.run("INSERT INTO wedding_members (wedding_id, user_id, role, can_edit, can_manage_guests, can_publish, created_at) VALUES (?, ?, 'owner', 1, 1, 1, ?)", id, userId, ts);
    db.run('INSERT INTO website_designs (wedding_id, template_id, palette, font_pairing, animation, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      id, tpl.id, JSON.stringify(tpl.defaults.palette), tpl.defaults.font_pairing, tpl.defaults.animation, ts);
    const w = { ...basics };
    DEFAULT_SECTIONS.forEach((type, i) => {
      db.run('INSERT INTO website_sections (id, wedding_id, type, position, status, content, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        uuid(), id, type, i, 'visible', JSON.stringify(SECTION_TYPES[type].defaults(w)), '{}', ts, ts);
    });
    db.run("INSERT INTO form_definitions (id, wedding_id, kind, questions, updated_at) VALUES (?, ?, 'rsvp', '[]', ?)", uuid(), id, ts);
    for (const type of Object.keys(WORKFLOWS)) {
      db.run('INSERT INTO email_automation_rules (id, wedding_id, type, enabled, config, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        uuid(), id, type, type === 'rsvp_confirmation' ? 1 : 0, JSON.stringify(DEFAULT_RULE_CONFIG[type] || {}), ts);
    }
  });
  return id;
}

export function getWedding(db, id) {
  return db.get('SELECT * FROM weddings WHERE id = ?', id);
}

// Fields that are safe to show to anyone who can see the website.
export function publicWeddingFields(w) {
  return {
    id: w.id, slug: w.slug, partner1: w.partner1, partner2: w.partner2, wedding_date_local: w.wedding_date_local,
    timezone: w.timezone, wedding_at_utc: w.wedding_at_utc, location: w.location, tagline: w.tagline, locale: w.locale,
    rsvp_deadline: w.rsvp_deadline
  };
}

export function loadDesign(db, weddingId) {
  const d = db.get('SELECT * FROM website_designs WHERE wedding_id = ?', weddingId);
  return d ? { template_id: d.template_id, palette: parseJson(d.palette, {}), font_pairing: d.font_pairing, animation: d.animation } : null;
}

export function loadSections(db, weddingId, { includeRemoved = true } = {}) {
  return db.all(`SELECT * FROM website_sections WHERE wedding_id = ? ${includeRemoved ? '' : "AND status != 'removed'"} ORDER BY position`, weddingId)
    .map((s) => ({ id: s.id, type: s.type, position: s.position, status: s.status, content: parseJson(s.content, {}), settings: parseJson(s.settings, {}), updated_at: s.updated_at }));
}

export function loadMedia(db, weddingId) {
  return db.all('SELECT id, kind, caption, position, is_cover, width, height, bytes, original_name, updated_at FROM media_assets WHERE wedding_id = ? ORDER BY position, created_at', weddingId)
    .map((m) => ({ ...m, is_cover: !!m.is_cover }));
}

export function loadQuestions(db, weddingId) {
  const f = db.get("SELECT * FROM form_definitions WHERE wedding_id = ? AND kind = 'rsvp'", weddingId);
  return { id: f?.id || null, questions: parseJson(f?.questions, []) };
}

export function rsvpConfig(db, w) {
  return {
    open: !deadlinePassed(w.rsvp_deadline, w.timezone),
    deadline: w.rsvp_deadline,
    mode: w.rsvp_mode,
    plus_ones: w.rsvp_plus_ones,
    collect_email: w.rsvp_collect_email,
    dietary: !!w.rsvp_dietary,
    accessibility: !!w.rsvp_accessibility,
    questions: loadQuestions(db, w.id).questions
  };
}

export function draftState(db, weddingId) {
  const w = getWedding(db, weddingId);
  return {
    wedding: publicWeddingFields(w),
    design: loadDesign(db, weddingId),
    sections: loadSections(db, weddingId),
    media: loadMedia(db, weddingId),
    rsvp: rsvpConfig(db, w),
    version: w.draft_version
  };
}

export function latestPublished(db, weddingId) {
  const row = db.get('SELECT * FROM published_versions WHERE wedding_id = ? ORDER BY created_at DESC LIMIT 1', weddingId);
  return row ? { ...row, snapshot: parseJson(row.snapshot, null) } : null;
}

// Validates design changes against the plan. Values the couple already had are kept
// even if the plan no longer includes them (e.g. after a downgrade) — limits only
// stop *new* premium choices, they never remove saved work.
function validateDesign(db, input, current, ent) {
  const out = { ...current };
  if (input.template_id !== undefined && input.template_id !== current.template_id) {
    const tpl = TEMPLATES.find((t) => t.id === input.template_id);
    // Tier and availability are admin-controlled, so read them from the database.
    const row = tpl && db.get('SELECT tier, enabled FROM website_templates WHERE id = ?', tpl.id);
    if (!tpl || !row?.enabled) throw new HttpError(400, 'That template is not available.');
    if (!ent.template_tiers.includes(row.tier)) throw new PlanLimitError('template', `${tpl.name} is a premium template.`);
    out.template_id = tpl.id;
  }
  if (input.font_pairing !== undefined && input.font_pairing !== current.font_pairing) {
    const f = FONT_PAIRINGS.find((p) => p.id === input.font_pairing);
    if (!f) throw new HttpError(400, 'Unknown font pairing.');
    if (!ent.font_tiers.includes(f.tier)) throw new PlanLimitError('font', `The ${f.name} fonts are part of Premium.`);
    out.font_pairing = f.id;
  }
  if (input.animation !== undefined && input.animation !== current.animation) {
    if (!['static', 'subtle', 'expressive'].includes(input.animation)) throw new HttpError(400, 'Unknown animation style.');
    if (!ent.animations.includes(input.animation)) throw new PlanLimitError('animation', 'Expressive animation is part of Premium.');
    out.animation = input.animation;
  }
  if (input.palette && typeof input.palette === 'object') {
    const palette = {};
    for (const k of TOKEN_KEYS) palette[k] = normalizeHex(input.palette[k]) || current.palette[k];
    if (!ent.advanced_colours && !samePalette(palette, current.palette)) {
      // Free plan: presets, template palettes, or a palette generated from one primary colour.
      const allowed = [...PRESET_PALETTES.map((p) => p.palette), ...TEMPLATES.map((t) => t.defaults.palette), suggestPalette(palette.primary)];
      if (!allowed.some((a) => samePalette(a, palette))) throw new PlanLimitError('advanced_colours', 'Choosing each colour individually is part of Premium. On the free plan, pick a preset or a primary colour and we will build the palette for you.');
    }
    out.palette = palette;
  }
  return out;
}

function samePalette(a, b) {
  return TOKEN_KEYS.every((k) => normalizeHex(a?.[k]) === normalizeHex(b?.[k]));
}

// Saves the editor/wizard draft. Optimistic concurrency via draft_version stops two
// collaborators silently overwriting each other.
export function saveDraft(db, weddingId, payload) {
  const w = getWedding(db, weddingId);
  if (payload.version !== undefined && Number(payload.version) !== w.draft_version) {
    throw new HttpError(409, 'This website was changed in another window or by a collaborator. Reload to see the latest version.', { code: 'version_conflict', version: w.draft_version });
  }
  const ent = weddingPlan(db, weddingId).entitlements;
  const ts = now();
  const changes = { dateChanged: false, templateChanged: false, coloursChanged: false, added: [], removed: [] };

  db.tx(() => {
    if (payload.wedding && typeof payload.wedding === 'object') {
      const { values, errors } = validateBasics(payload.wedding, { partial: true });
      // Drafts may be incomplete; only reject values that are actually malformed.
      const bad = Object.entries(errors).filter(([k]) => !(k === 'partner1' || k === 'partner2'));
      if (bad.length) throw new HttpError(400, bad[0][1], { field: bad[0][0] });
      const merged = { ...w, ...values };
      const atUtc = merged.wedding_date_local ? zonedToUtc(merged.wedding_date_local, merged.timezone)?.toISOString() : null;
      changes.dateChanged = atUtc !== w.wedding_at_utc || merged.timezone !== w.timezone;
      db.run(`UPDATE weddings SET partner1 = ?, partner2 = ?, wedding_date_local = ?, timezone = ?, wedding_at_utc = ?, location = ?, tagline = ?, locale = ? WHERE id = ?`,
        merged.partner1, merged.partner2, merged.wedding_date_local, merged.timezone, atUtc, merged.location, merged.tagline, merged.locale, weddingId);
    }

    if (payload.design && typeof payload.design === 'object') {
      const current = loadDesign(db, weddingId);
      const next = validateDesign(db, payload.design, current, ent);
      changes.templateChanged = next.template_id !== current.template_id;
      changes.coloursChanged = !samePalette(next.palette, current.palette);
      changes.template_id = next.template_id;
      db.run('UPDATE website_designs SET template_id = ?, palette = ?, font_pairing = ?, animation = ?, updated_at = ? WHERE wedding_id = ?',
        next.template_id, JSON.stringify(next.palette), next.font_pairing, next.animation, ts, weddingId);
    }

    if (Array.isArray(payload.sections)) {
      const existing = new Map(loadSections(db, weddingId).map((s) => [s.id, s]));
      const seenTypes = new Set();
      payload.sections.slice(0, 40).forEach((s, i) => {
        if (!s || typeof s !== 'object' || !isKnownSection(s.type)) throw new HttpError(400, 'Unknown section type.');
        const status = ['visible', 'hidden', 'removed'].includes(s.status) ? s.status : 'visible';
        const content = JSON.stringify(sanitizeContent(s.type, s.content));
        const settings = JSON.stringify(sanitizeSettings(s.type, s.settings));
        const prev = existing.get(s.id);
        if (seenTypes.has(s.type)) throw new HttpError(400, 'Each section type can only appear once.');
        seenTypes.add(s.type);
        if (prev) {
          if (prev.type !== s.type) throw new HttpError(400, 'A section cannot change type.');
          if (SECTION_TYPES[s.type].required && status === 'removed') throw new HttpError(400, 'The welcome section cannot be removed (you can hide it).');
          if (prev.status !== 'removed' && status === 'removed') changes.removed.push(s.type);
          if (prev.status === 'removed' && status !== 'removed') {
            if (!ent.sections.includes(s.type)) throw new PlanLimitError('section', `The ${SECTION_TYPES[s.type].name} section is part of Premium.`);
            changes.added.push(s.type);
          }
          db.run('UPDATE website_sections SET position = ?, status = ?, content = ?, settings = ?, updated_at = ? WHERE id = ? AND wedding_id = ?', i, status, content, settings, ts, s.id, weddingId);
        } else {
          if (SECTION_TYPES[s.type].comingSoon) throw new HttpError(400, `${SECTION_TYPES[s.type].name} is coming soon.`);
          if (!ent.sections.includes(s.type)) throw new PlanLimitError('section', `The ${SECTION_TYPES[s.type].name} section is part of Premium.`);
          if ([...existing.values()].some((e) => e.type === s.type)) throw new HttpError(400, 'Each section type can only appear once.');
          const id = typeof s.id === 'string' && /^[a-z0-9-]{8,64}$/i.test(s.id) ? s.id : uuid();
          if (db.get('SELECT 1 FROM website_sections WHERE id = ?', id)) throw new HttpError(400, 'Invalid section id.');
          db.run('INSERT INTO website_sections (id, wedding_id, type, position, status, content, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', id, weddingId, s.type, i, status, content, settings, ts, ts);
          changes.added.push(s.type);
        }
      });
      // Sections missing from the payload keep their content; they just move to the end.
      let pos = payload.sections.length;
      for (const s of existing.values()) {
        if (!payload.sections.some((p) => p && p.id === s.id)) db.run('UPDATE website_sections SET position = ? WHERE id = ?', pos++, s.id);
      }
    }

    if (payload.setup_step !== undefined) {
      const step = Math.max(1, Math.min(7, Number(payload.setup_step) || 1));
      db.run('UPDATE weddings SET setup_step = MAX(setup_step, ?) WHERE id = ?', step, weddingId);
    }
    db.run('UPDATE weddings SET draft_version = draft_version + 1, updated_at = ? WHERE id = ?', ts, weddingId);
  });
  return { version: w.draft_version + 1, changes };
}

// What a couple must fill in before publishing.
export function publishChecklist(db, weddingId) {
  const w = getWedding(db, weddingId);
  const sections = loadSections(db, weddingId).filter((s) => s.status === 'visible');
  const items = [
    { key: 'names', label: 'Both of your names', ok: !!(w.partner1 && w.partner2), required: true },
    { key: 'date', label: 'Wedding date and time', ok: !!w.wedding_date_local, required: true },
    { key: 'sections', label: 'At least one visible section', ok: sections.length > 0, required: true },
    { key: 'slug', label: 'Website address', ok: !!w.slug, required: true },
    { key: 'cover', label: 'A cover photo', ok: !!db.get('SELECT 1 FROM media_assets WHERE wedding_id = ? AND is_cover = 1', weddingId), required: false },
    { key: 'location', label: 'Wedding location', ok: !!w.location, required: false },
    { key: 'events', label: 'Event details (ceremony, reception…)', ok: sections.some((s) => s.type === 'details' && (s.content.events || []).some((e) => e.name && (e.venue || e.date))), required: false },
    { key: 'rsvp_deadline', label: 'An RSVP deadline', ok: !!w.rsvp_deadline, required: false }
  ];
  return { items, ready: items.filter((i) => i.required).every((i) => i.ok) };
}

export function publish(db, weddingId, userId) {
  const check = publishChecklist(db, weddingId);
  if (!check.ready) {
    const missing = check.items.filter((i) => i.required && !i.ok).map((i) => i.label);
    throw new HttpError(400, `Before publishing, please add: ${missing.join(', ')}.`, { code: 'incomplete', missing });
  }
  const state = draftState(db, weddingId);
  const ts = now();
  const sections = state.sections.filter((s) => s.status === 'visible');
  const snapshot = {
    wedding: state.wedding,
    design: state.design,
    sections,
    // Only photos the website actually shows become publicly reachable.
    media: referencedMedia(state.media, sections).map(({ bytes, original_name, ...m }) => m),
    published_at: ts
  };
  const w = getWedding(db, weddingId);
  db.tx(() => {
    db.run('INSERT INTO published_versions (id, wedding_id, snapshot, published_by, created_at) VALUES (?, ?, ?, ?, ?)', uuid(), weddingId, JSON.stringify(snapshot), userId, ts);
    db.run("UPDATE weddings SET status = 'published', published_at = ?, first_published_at = COALESCE(first_published_at, ?), unpublished_reason = NULL, setup_step = 7, updated_at = ? WHERE id = ?", ts, ts, ts, weddingId);
    // Keep the last 20 versions.
    db.run('DELETE FROM published_versions WHERE wedding_id = ? AND id NOT IN (SELECT id FROM published_versions WHERE wedding_id = ? ORDER BY created_at DESC LIMIT 20)', weddingId, weddingId);
  });
  return { first: !w.first_published_at, published_at: ts };
}

export function referencedMedia(media, visibleSections) {
  const ids = new Set();
  const cover = media.find((m) => m.is_cover);
  if (cover) ids.add(cover.id);
  const gallery = media.filter((m) => m.kind === 'gallery');
  if (visibleSections.some((s) => s.type === 'gallery')) gallery.forEach((m) => ids.add(m.id));
  else if (!cover && gallery[0]) ids.add(gallery[0].id); // the hero falls back to the first gallery photo
  if (gallery[0] && visibleSections.some((s) => s.type === 'rsvp' && s.settings?.layout === 'split')) ids.add(gallery[0].id);
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k === 'image' && typeof x === 'string') ids.add(x); else walk(x); }
  };
  visibleSections.forEach((s) => walk(s.content));
  return media.filter((m) => ids.has(m.id));
}

export function hasUnpublishedChanges(db, w) {
  if (w.status !== 'published' || !w.published_at) return false;
  return w.updated_at > w.published_at;
}

export function siteUrls(config, w) {
  const pathUrl = `${config.baseUrl}/w/${w.slug}`;
  let primary = pathUrl;
  if (w.custom_domain && w.custom_domain_verified_at) primary = `https://${w.custom_domain}`;
  else if (config.siteBaseDomain && w.slug) {
    const base = new URL(config.baseUrl);
    primary = `${base.protocol}//${w.slug}.${config.siteBaseDomain}${base.port ? `:${base.port}` : ''}`;
  }
  return { primary, path: pathUrl };
}

export function isPremiumTemplate(id) {
  return getTemplate(id).tier === 'premium';
}

export { getPairing };
