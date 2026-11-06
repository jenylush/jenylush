// In-browser stand-in for the platform server. It keeps one couple's account,
// wedding, guests and budget in this browser's storage and answers the same API
// calls the real editor panels make, with the same rules (plan limits, publish
// checklist, RSVP matching), so the test version behaves like the real product.

import { ApiError } from '../../platform/public/js/api.js';
import { SECTION_TYPES, DEFAULT_SECTIONS, isKnownSection, sanitizeContent, sanitizeSettings } from '../../platform/shared/sections.js';
import { TEMPLATES, getTemplate } from '../../platform/shared/templates.js';
import { FONT_PAIRINGS } from '../../platform/shared/fonts.js';
import { PRESET_PALETTES, suggestPalette, normalizeHex, TOKEN_KEYS } from '../../platform/shared/color.js';
import { DEFAULT_CATEGORIES } from '../../platform/shared/budget.js';

const KEY = 'vowly-test-v1';
const FREE_SECTIONS = ['hero', 'story', 'countdown', 'details', 'gallery', 'rsvp', 'faq', 'dresscode', 'venue', 'travel', 'registry'];
const ALL_SECTIONS = [...FREE_SECTIONS, 'party', 'guestbook', 'games', 'programme'];

export const PLANS = {
  free: { id: 'free', name: 'Free', entitlements: { template_tiers: ['free'], font_tiers: ['free'], animations: ['static', 'subtle'], advanced_colours: false, sections: FREE_SECTIONS, storage_mb: 100, max_photos: 40, max_upload_mb: 10, custom_questions: 2, email_workflows: ['rsvp_confirmation', 'invitation'], password_protection: false, custom_domain: false, remove_branding: false, advanced_exports: false, coowners: 1 } },
  premium: { id: 'premium', name: 'Premium', entitlements: { template_tiers: ['free', 'premium'], font_tiers: ['free', 'premium'], animations: ['static', 'subtle', 'expressive'], advanced_colours: true, sections: ALL_SECTIONS, storage_mb: 2048, max_photos: 500, max_upload_mb: 25, custom_questions: 20, email_workflows: ['rsvp_confirmation', 'invitation', 'rsvp_reminder', 'biweekly_update', 'final_reminders', 'update_notification'], password_protection: true, custom_domain: true, remove_branding: true, advanced_exports: true, coowners: 3 } }
};

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
const now = () => new Date().toISOString();
const clone = (v) => JSON.parse(JSON.stringify(v));

// ---------------------------------------------------------------- storage
let db = load();
const listeners = new Set();

function blank() { return { user: null, wedding: null, design: null, sections: [], media: [], published: null, questions: [], guests: [], rsvps: [], budget: null }; }

function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...blank(), ...JSON.parse(raw) }; } catch { /* storage unavailable: keep in memory */ }
  return blank();
}

let saveTimer = null;
let warnedStorage = false;
export function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {
      if (!warnedStorage) { warnedStorage = true; window.dispatchEvent(new CustomEvent('storage-full')); }
    }
  }, 150);
  for (const fn of listeners) fn();
}

export function onData(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const data = () => db;
export function resetAll() { db = blank(); try { localStorage.removeItem(KEY); } catch { /* ignore */ } persist(); }

export function plan() { return db.user?.premium ? PLANS.premium : PLANS.free; }
export function setPremium(on) { db.user.premium = !!on; persist(); }

// ---------------------------------------------------------------- account
export function signUp({ name, email, password }) {
  const fields = {};
  if (!String(name || '').trim()) fields.name = 'Please tell us your name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || '').trim())) fields.email = 'Enter a valid email address.';
  if (String(password || '').length < 10) fields.password = 'Use at least 10 characters.';
  if (Object.keys(fields).length) throw new ApiError(400, { error: 'Please fix the highlighted fields.', fields });
  db.user = { name: name.trim(), email: email.trim().toLowerCase(), premium: false, created_at: now() };
  persist();
}

// ---------------------------------------------------------------- wedding
function zoneToday(tz) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); } catch { return new Date().toISOString().slice(0, 10); }
}
export const today = () => zoneToday(db.wedding?.timezone || 'UTC');

function toUtc(local, tz) {
  if (!local) return null;
  const [d, t = '00:00'] = local.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, day, h, mi);
  const offset = (ts) => {
    try {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ts / 1000) * 1000;
    } catch { return 0; }
  };
  let ts = guess - offset(guess);
  ts = guess - offset(ts);
  return new Date(ts).toISOString();
}

export function slugify(t) {
  return String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'our-wedding';
}

function guessCurrency(tz = '') {
  const map = [[/^Africa\/Lagos/, 'NGN'], [/^Africa\/Accra/, 'GHS'], [/^Africa\/Nairobi/, 'KES'], [/^Africa\/Johannesburg/, 'ZAR'], [/^Europe\/(London|Belfast)/, 'GBP'], [/^Europe\//, 'EUR'], [/^America\/(Toronto|Vancouver)/, 'CAD'], [/^Australia\//, 'AUD'], [/^Asia\/(Kolkata|Calcutta)/, 'INR'], [/^Asia\/Dubai/, 'AED']];
  return (map.find(([re]) => re.test(tz)) || [null, 'USD'])[1];
}

export function createWedding(b) {
  const fields = {};
  if (!String(b.partner1 || '').trim()) fields.partner1 = 'Please enter a name.';
  if (!String(b.partner2 || '').trim()) fields.partner2 = 'Please enter a name.';
  if (Object.keys(fields).length) throw new ApiError(400, { error: 'Please check the highlighted fields.', fields });
  const tz = b.timezone || 'UTC';
  const tpl = getTemplate(b.template && TEMPLATES.some((t) => t.id === b.template && plan().entitlements.template_tiers.includes(t.tier)) ? b.template : 'ivory');
  db.wedding = {
    id: 'local', slug: slugify(`${b.partner1} and ${b.partner2}`), partner1: b.partner1.trim(), partner2: b.partner2.trim(),
    wedding_date_local: b.wedding_date_local || null, timezone: tz, wedding_at_utc: toUtc(b.wedding_date_local, tz),
    location: (b.location || '').trim(), tagline: (b.tagline || '').trim(), locale: 'en-GB',
    status: 'draft', visibility: 'public', setup_step: 2, draft_version: 1, visits: 0,
    rsvp_deadline: null, rsvp_mode: 'open', rsvp_plus_ones: 'invited_only', rsvp_collect_email: 'optional', rsvp_dietary: true, rsvp_accessibility: false,
    created_at: now(), updated_at: now(), published_at: null, first_published_at: null
  };
  db.design = { template_id: tpl.id, palette: { ...tpl.defaults.palette }, font_pairing: tpl.defaults.font_pairing, animation: tpl.defaults.animation };
  db.sections = DEFAULT_SECTIONS.map((type, i) => ({ id: uid(), type, position: i, status: 'visible', content: SECTION_TYPES[type].defaults(db.wedding), settings: {} }));
  db.media = []; db.published = null; db.questions = []; db.guests = []; db.rsvps = [];
  db.budget = { settings: { currency: guessCurrency(tz), total_budget_minor: 0, reminders_enabled: true }, categories: DEFAULT_CATEGORIES.map(([name], i) => ({ id: uid(), name, planned_minor: 0, position: i })), expenses: [], gifts: [] };
  persist();
}

export function rsvpConfig() {
  const w = db.wedding;
  return { open: !w.rsvp_deadline || today() <= w.rsvp_deadline, deadline: w.rsvp_deadline, mode: w.rsvp_mode, plus_ones: w.rsvp_plus_ones, collect_email: w.rsvp_collect_email, dietary: !!w.rsvp_dietary, accessibility: !!w.rsvp_accessibility, questions: db.questions };
}

const publicWedding = (w) => ({ id: w.id, slug: w.slug, partner1: w.partner1, partner2: w.partner2, wedding_date_local: w.wedding_date_local, timezone: w.timezone, wedding_at_utc: w.wedding_at_utc, location: w.location, tagline: w.tagline, locale: w.locale, rsvp_deadline: w.rsvp_deadline });

export function draftState() {
  return clone({ wedding: publicWedding(db.wedding), design: db.design, sections: db.sections, media: db.media, rsvp: rsvpConfig(), version: db.wedding.draft_version });
}

export function updateWedding(fields) { Object.assign(db.wedding, fields); db.wedding.wedding_at_utc = toUtc(db.wedding.wedding_date_local, db.wedding.timezone); persist(); }

const planError = (feature, label, error) => new ApiError(402, { error, code: 'plan_limit', feature, feature_label: label });
const samePalette = (a, b) => TOKEN_KEYS.every((k) => normalizeHex(a?.[k]) === normalizeHex(b?.[k]));

function saveDraft(p) {
  const ent = plan().entitlements;
  if (p.wedding) {
    const w = { ...db.wedding };
    for (const k of ['partner1', 'partner2', 'wedding_date_local', 'timezone', 'location', 'tagline']) if (k in p.wedding) w[k] = String(p.wedding[k] ?? '').slice(0, 200);
    w.wedding_date_local = w.wedding_date_local || null;
    w.wedding_at_utc = toUtc(w.wedding_date_local, w.timezone);
    db.wedding = w;
  }
  if (p.design) {
    const cur = db.design, next = { ...cur };
    if (p.design.template_id && p.design.template_id !== cur.template_id) {
      const t = TEMPLATES.find((x) => x.id === p.design.template_id);
      if (!t) throw new ApiError(400, { error: 'Unknown template.' });
      if (!ent.template_tiers.includes(t.tier)) throw planError('template', 'Premium templates', `${t.name} is a premium template.`);
      next.template_id = t.id;
    }
    if (p.design.font_pairing && p.design.font_pairing !== cur.font_pairing) {
      const f = FONT_PAIRINGS.find((x) => x.id === p.design.font_pairing);
      if (!f || !ent.font_tiers.includes(f.tier)) throw planError('font', 'Premium font pairings', 'These fonts are part of Premium.');
      next.font_pairing = f.id;
    }
    if (p.design.animation && p.design.animation !== cur.animation) {
      if (!ent.animations.includes(p.design.animation)) throw planError('animation', 'Expressive animations', 'Expressive animation is part of Premium.');
      next.animation = p.design.animation;
    }
    if (p.design.palette) {
      const pal = {};
      for (const k of TOKEN_KEYS) pal[k] = normalizeHex(p.design.palette[k]) || cur.palette[k];
      if (!ent.advanced_colours && !samePalette(pal, cur.palette)) {
        const allowed = [...PRESET_PALETTES.map((x) => x.palette), ...TEMPLATES.map((t) => t.defaults.palette), suggestPalette(pal.primary)];
        if (!allowed.some((a) => samePalette(a, pal))) throw planError('advanced_colours', 'Individual colour controls', 'Choosing each colour individually is part of Premium.');
      }
      next.palette = pal;
    }
    db.design = next;
  }
  if (Array.isArray(p.sections)) {
    const prev = new Map(db.sections.map((s) => [s.id, s]));
    const seen = new Set();
    const out = p.sections.map((s, i) => {
      if (!isKnownSection(s.type) || seen.has(s.type)) throw new ApiError(400, { error: 'Each section type can only appear once.' });
      seen.add(s.type);
      const old = prev.get(s.id);
      const status = ['visible', 'hidden', 'removed'].includes(s.status) ? s.status : 'visible';
      if (SECTION_TYPES[s.type].required && status === 'removed') throw new ApiError(400, { error: 'The welcome section cannot be removed (you can hide it).' });
      const becomingActive = status !== 'removed' && (!old || old.status === 'removed');
      if (becomingActive && !ent.sections.includes(s.type)) throw planError('section', SECTION_TYPES[s.type].name, `The ${SECTION_TYPES[s.type].name} section is part of Premium.`);
      return { id: s.id || uid(), type: s.type, position: i, status, content: sanitizeContent(s.type, s.content), settings: sanitizeSettings(s.type, s.settings) };
    });
    for (const s of db.sections) if (!out.some((o) => o.id === s.id)) out.push({ ...s, position: out.length });
    db.sections = out;
  }
  if (p.setup_step) db.wedding.setup_step = Math.max(db.wedding.setup_step, Number(p.setup_step) || 1);
  db.wedding.draft_version++;
  db.wedding.updated_at = now();
  persist();
  return { ok: true, version: db.wedding.draft_version, saved_at: now() };
}

export function checklist() {
  const w = db.wedding;
  const vis = db.sections.filter((s) => s.status === 'visible');
  const items = [
    { key: 'names', label: 'Both of your names', ok: !!(w.partner1 && w.partner2), required: true },
    { key: 'date', label: 'Wedding date and time', ok: !!w.wedding_date_local, required: true },
    { key: 'sections', label: 'At least one visible section', ok: vis.length > 0, required: true },
    { key: 'slug', label: 'Website address', ok: !!w.slug, required: true },
    { key: 'cover', label: 'A cover photo', ok: db.media.some((m) => m.is_cover), required: false },
    { key: 'location', label: 'Wedding location', ok: !!w.location, required: false },
    { key: 'events', label: 'Event details (ceremony, reception…)', ok: vis.some((s) => s.type === 'details' && (s.content.events || []).some((e) => e.name && (e.venue || e.date))), required: false },
    { key: 'rsvp_deadline', label: 'An RSVP deadline', ok: !!w.rsvp_deadline, required: false }
  ];
  return { items, ready: items.filter((i) => i.required).every((i) => i.ok) };
}

export function publish() {
  const c = checklist();
  if (!c.ready) throw new ApiError(400, { error: `Before publishing, please add: ${c.items.filter((i) => i.required && !i.ok).map((i) => i.label).join(', ')}.` });
  db.published = clone({ wedding: publicWedding(db.wedding), design: db.design, sections: db.sections.filter((s) => s.status === 'visible'), media: db.media });
  const t = now();
  Object.assign(db.wedding, { status: 'published', published_at: t, first_published_at: db.wedding.first_published_at || t, updated_at: t, setup_step: 7 });
  persist();
}

export function unpublish() { db.wedding.status = 'draft'; persist(); }
export const hasUnpublishedChanges = () => db.wedding?.status === 'published' && db.wedding.updated_at > db.wedding.published_at;

// ---------------------------------------------------------------- media
async function resizeToDataUrl(file, max = 1400) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That file could not be read as an image. Please use a JPEG, PNG or WebP photo.')); i.src = url; });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return { src: c.toDataURL('image/jpeg', 0.74), width: c.width, height: c.height };
  } finally { URL.revokeObjectURL(url); }
}

export async function uploadMedia(url, fd, onProgress) {
  const ent = plan().entitlements;
  const file = fd.get('file');
  const replace = /\/media\/([^/]+)\/replace$/.exec(url)?.[1];
  if (!file) throw new ApiError(400, { error: 'Choose a photo to upload.' });
  if (file.size > ent.max_upload_mb * 1048576) throw planError('storage', 'More photo storage', `Photos on your plan can be up to ${ent.max_upload_mb} MB each.`);
  if (!replace && db.media.length >= Math.min(ent.max_photos, 24)) throw planError('photos', 'More photos', 'This test version holds up to 24 photos (the full platform allows 40 on Free).');
  onProgress?.(0.4);
  let out;
  try { out = await resizeToDataUrl(file); } catch (err) { throw new ApiError(400, { error: err.message }); }
  onProgress?.(1);
  if (replace) {
    const m = db.media.find((x) => x.id === replace);
    if (!m) throw new ApiError(404, { error: 'Photo not found.' });
    Object.assign(m, out, { original_name: file.name, updated_at: now() });
    db.wedding.updated_at = now(); persist();
    return { asset: clone(m) };
  }
  const kind = fd.get('kind') === 'library' ? 'library' : 'gallery';
  const makeCover = !db.media.some((m) => m.is_cover) && kind === 'gallery' && fd.get('auto_cover') !== 'false';
  const asset = { id: uid(), kind, caption: '', position: db.media.length, is_cover: makeCover, original_name: file.name, bytes: Math.round(out.src.length * 0.75), updated_at: now(), ...out };
  db.media.push(asset);
  db.wedding.updated_at = now();
  persist();
  return { asset: clone(asset) };
}

// ---------------------------------------------------------------- API router used by the shared editor panels
export async function handle(method, url, body) {
  return handleSync(method, url, body);
}

function handleSync(method, url, body) {
  const path = url.replace(/^\/api\/weddings\/[^/]+/, '');
  if (!db.wedding) throw new ApiError(404, { error: 'Create your wedding first.' });
  if (method === 'GET' && path === '/draft') return draftState();
  if (method === 'PUT' && path === '/draft') return saveDraft(body || {});
  let m;
  if (method === 'PATCH' && (m = /^\/media\/([^/]+)$/.exec(path))) {
    const a = db.media.find((x) => x.id === m[1]);
    if (!a) throw new ApiError(404, { error: 'Photo not found.' });
    if (body.caption !== undefined) a.caption = String(body.caption).slice(0, 300);
    if (body.is_cover === true) db.media.forEach((x) => { x.is_cover = x.id === a.id; });
    if (body.is_cover === false) a.is_cover = false;
    db.wedding.updated_at = now(); persist();
    return { asset: clone(a) };
  }
  if (method === 'PUT' && path === '/media-order') {
    (body.ids || []).forEach((id, i) => { const a = db.media.find((x) => x.id === id); if (a) a.position = i; });
    db.wedding.updated_at = now(); persist();
    return { ok: true };
  }
  if (method === 'DELETE' && (m = /^\/media\/([^/]+)$/.exec(path))) {
    db.media = db.media.filter((x) => x.id !== m[1]);
    db.wedding.updated_at = now(); persist();
    return { ok: true };
  }
  throw new ApiError(404, { error: `Not available in the test version (${method} ${path}).` });
}

// ---------------------------------------------------------------- guests & RSVP
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = () => { let s = ''; for (let i = 0; i < 8; i++) s += ALPH[Math.floor(Math.random() * ALPH.length)]; return `${s.slice(0, 4)}-${s.slice(4)}`; };

export function addGuest(g) {
  const first = String(g.first_name || '').trim();
  if (!first) throw new ApiError(400, { error: 'Enter the guest’s first name.', fields: { first_name: 'Required.' } });
  const email = String(g.email || '').trim().toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new ApiError(400, { error: 'That email address does not look right.', fields: { email: 'Invalid email.' } });
  if (email && db.guests.some((x) => x.email === email && x.id !== g.id)) throw new ApiError(409, { error: 'A guest with this email is already on your list.', fields: { email: 'Already on the list.' } });
  if (g.id) {
    const ex = db.guests.find((x) => x.id === g.id);
    Object.assign(ex, { first_name: first, last_name: String(g.last_name || '').trim(), email, phone: String(g.phone || '').trim(), household: String(g.household || '').trim(), plus_one_allowed: !!g.plus_one_allowed, invitation_status: g.invitation_status || ex.invitation_status });
    persist(); return ex;
  }
  const guest = { id: uid(), first_name: first, last_name: String(g.last_name || '').trim(), email, phone: String(g.phone || '').trim(), household: String(g.household || '').trim(), plus_one_allowed: !!g.plus_one_allowed, invite_code: code(), invitation_status: 'not_invited', invited_at: null, updates_opt_in: false, created_at: now() };
  db.guests.push(guest);
  persist();
  return guest;
}

export function deleteGuest(id) { db.guests = db.guests.filter((g) => g.id !== id); db.rsvps = db.rsvps.filter((r) => r.guest_id !== id); persist(); }
export function markInvited(id) { const g = db.guests.find((x) => x.id === id); if (g && g.invitation_status !== 'invited') { g.invitation_status = 'invited'; g.invited_at = now(); persist(); } }
export const latestRsvp = (guestId) => db.rsvps.find((r) => r.guest_id === guestId && r.is_latest) || null;
export const rsvpStatus = (guestId) => { const r = latestRsvp(guestId); return r ? (r.attending === 'yes' ? 'confirmed' : 'declined') : 'pending'; };

function findByCode(c) {
  const v = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return v.length === 8 ? db.guests.find((g) => g.invite_code === `${v.slice(0, 4)}-${v.slice(4)}`) : null;
}

function publishedEvents(guest) {
  const d = (db.published?.sections || []).find((s) => s.type === 'details');
  return (d?.content?.events || []).filter((e) => e.name && (!e.restricted || guest?.private_events));
}

// Answers the RSVP form running inside the published website frame.
export function siteRequest(url, body) {
  const w = db.wedding;
  if (!db.published || w.status !== 'published') return { ok: false, status: 404, body: { error: 'This website is not published.' } };
  if (url.endsWith('/rsvp/lookup')) {
    const g = findByCode(body.code);
    if (!g) return { ok: false, status: 404, body: { error: 'We could not find that invitation code.' } };
    const r = latestRsvp(g.id);
    return { ok: true, status: 200, body: { guest: { first_name: g.first_name, last_name: g.last_name, plus_one_allowed: g.plus_one_allowed || w.rsvp_plus_ones === 'everyone' }, events: publishedEvents(g), existing: r ? { attending: r.attending, events: r.events, plus_one_name: r.plus_one_name, dietary: r.dietary } : null } };
  }
  if (!url.endsWith('/rsvp')) return { ok: false, status: 404, body: { error: 'Not found' } };
  if (body.website) return { ok: true, status: 200, body: { ok: true } };
  const cfg = rsvpConfig();
  if (!cfg.open) return { ok: false, status: 400, body: { error: 'The RSVP deadline has passed.' } };
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const fields = {};
  if (!name) fields.name = 'Please enter your name.';
  if (!['yes', 'no'].includes(body.attending)) fields.attending = 'Please let us know if you can attend.';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) fields.email = 'That email address does not look right.';
  if (!email && cfg.collect_email === 'required') fields.email = 'Please enter your email address.';
  let guest = body.invite_code ? findByCode(body.invite_code) : null;
  if (body.invite_code && !guest) fields.invite_code = 'We could not find that invitation code.';
  if (!guest && cfg.mode === 'invite_only' && !fields.invite_code) fields.invite_code = 'Please enter the invitation code from your invitation.';
  const answers = {};
  for (const q of cfg.questions) {
    const raw = body.answers?.[q.id];
    const value = q.type === 'checkbox' ? (raw === true || raw === 'yes' ? 'Yes' : 'No') : String(raw ?? '').trim();
    if (q.required && (q.type === 'checkbox' ? value !== 'Yes' : !value)) fields[`q_${q.id}`] = `Please answer “${q.label}”.`;
    answers[q.id] = { label: q.label, value };
  }
  if (Object.keys(fields).length) return { ok: false, status: 400, body: { error: Object.values(fields)[0], fields } };
  if (!guest && email) guest = db.guests.find((g) => g.email === email);
  if (!guest && !email) { const [f, ...rest] = name.split(/\s+/); guest = db.guests.find((g) => !g.email && g.first_name.toLowerCase() === f.toLowerCase() && g.last_name.toLowerCase() === rest.join(' ').toLowerCase()); }
  if (!guest) { const [f, ...rest] = name.split(/\s+/); guest = addGuest({ first_name: f, last_name: rest.join(' '), email }); }
  else if (email && !guest.email) guest.email = email;
  const evs = publishedEvents(guest);
  const plusOk = w.rsvp_plus_ones === 'everyone' || (w.rsvp_plus_ones === 'invited_only' && guest.plus_one_allowed);
  let updated = false;
  db.rsvps.forEach((r) => { if (r.guest_id === guest.id && r.is_latest) { r.is_latest = false; updated = true; } });
  db.rsvps.push({
    id: uid(), guest_id: guest.id, name, email: email || guest.email, attending: body.attending,
    events: body.attending === 'yes' ? (body.events || []).filter((id) => evs.some((e) => e.id === id)) : [],
    plus_one_name: body.attending === 'yes' && plusOk && body.plus_one && String(body.plus_one_name || '').trim() ? String(body.plus_one_name).trim() : null,
    dietary: w.rsvp_dietary ? String(body.dietary || '') : '', accessibility: w.rsvp_accessibility ? String(body.accessibility || '') : '',
    answers, is_latest: true, created_at: now()
  });
  if (body.updates_opt_in) guest.updates_opt_in = true;
  persist();
  return { ok: true, status: 200, body: { ok: true, updated } };
}

export function rsvpCounts() {
  let confirmed = 0, declined = 0, plus = 0;
  for (const r of db.rsvps) if (r.is_latest) { if (r.attending === 'yes') { confirmed++; if (r.plus_one_name) plus++; } else declined++; }
  return { confirmed, declined, plus_ones: plus, pending: db.guests.filter((g) => !db.rsvps.some((r) => r.guest_id === g.id)).length, guests: db.guests.length, invited: db.guests.filter((g) => g.invitation_status === 'invited').length };
}

export function bumpVisits() { if (db.wedding) { db.wedding.visits++; persist(); } }
