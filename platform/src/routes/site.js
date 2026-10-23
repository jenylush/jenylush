// Public wedding websites: rendering, password unlock, RSVP submission, invitation
// lookups, content reports and guest email preferences.

import express from 'express';
import { now, uuid, parseJson } from '../db.js';
import { renderSiteDocument, esc, coupleNames } from '../../shared/render.js';
import { getWedding, latestPublished, draftState, rsvpConfig, siteUrls, loadQuestions, HttpError } from '../services.js';
import { siteAccess, issueUnlock, isMember } from '../siteAccess.js';
import { verifyPassword, rateLimit, validateEmail, setCookie } from '../auth.js';
import { weddingPlan } from '../entitlements.js';
import { sendRsvpConfirmation } from '../notifications.js';
import { insertGuest } from './guests.js';
import { track } from '../analytics.js';
import { TEMPLATES, getTemplate } from '../../shared/templates.js';
import { SECTION_TYPES } from '../../shared/sections.js';
import { deadlinePassed } from '../timezone.js';

const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|preview|whatsapp|telegram|discord|curl|wget|headless/i;

export function simplePage(ctx, { title, body, status = 200, noindex = true }) {
  return { status, html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>${noindex ? '<meta name="robots" content="noindex">' : ''}<link rel="stylesheet" href="/css/app.css"></head><body class="simple-page"><main class="simple-card">${body}<p class="simple-foot"><a href="${esc(ctx.config.baseUrl)}/">${esc(ctx.config.platformName)}</a></p></main></body></html>` };
}

function send(res, page) {
  res.status(page.status).type('html').send(page.html);
}

// Media referenced by the snapshot is the only media a visitor's browser may load.
function siteState(ctx, w, { draft = false, base, mode }) {
  const { db, config } = ctx;
  const plan = weddingPlan(db, w.id);
  let data;
  if (draft) {
    const d = draftState(db, w.id);
    data = { wedding: d.wedding, design: d.design, sections: d.sections.filter((s) => s.status === 'visible'), media: d.media };
  } else {
    data = latestPublished(db, w.id)?.snapshot;
    if (!data) return null;
  }
  const urls = siteUrls(config, w);
  const cover = data.media.find((m) => m.is_cover) || data.media.find((m) => m.kind === 'gallery');
  const indexable = !draft && w.status === 'published' && w.visibility === 'public' && !!w.search_indexing;
  return {
    ...data,
    wedding: { ...data.wedding, rsvp_deadline: w.rsvp_deadline },
    rsvp: rsvpConfig(db, w),
    options: {
      mode, apiBase: base, mediaBase: '/media', platformName: config.platformName, platformUrl: `${config.baseUrl}/?ref=site`,
      showBranding: !plan.entitlements.remove_branding, canonicalUrl: urls.primary, noindex: !indexable,
      ogImage: cover && w.visibility === 'public' && !draft ? `${config.baseUrl}/media/${cover.id}/1200` : null,
      reportUrl: `${base}/report`
    },
    indexable
  };
}

function bannerHtml(text, link) {
  return `<div style="position:sticky;top:0;z-index:99;background:#1f1d1b;color:#fff;font:14px/1.4 system-ui,sans-serif;padding:10px 16px;text-align:center">${esc(text)}${link ? ` <a href="${esc(link.href)}" style="color:#ffd9a8">${esc(link.label)}</a>` : ''}</div>`;
}

function countVisit(ctx, req, res, w) {
  if (BOT_UA.test(req.get('user-agent') || '')) return;
  const name = `v_${w.id.slice(0, 8)}`;
  if (req.cookies[name]) return;
  setCookie(res, name, '1', { maxAge: 12 * 3600, secure: ctx.config.cookieSecure });
  ctx.db.run('UPDATE weddings SET visits = visits + 1 WHERE id = ?', w.id);
}

export function renderWeddingSite(ctx, req, res, w, base) {
  const access = siteAccess(ctx, req, w);
  if (access === 'hidden') return send(res, notFoundPage(ctx));
  if (access === 'password') return send(res, passwordPage(ctx, w, base));
  const member = isMember(ctx.db, req, w.id);
  const showDraft = member && w.status !== 'published';
  const state = siteState(ctx, w, { draft: showDraft || (member && !latestPublished(ctx.db, w.id)), base, mode: 'published' });
  if (!state) return send(res, notFoundPage(ctx));
  if (member) {
    state.options.banner = showDraft
      ? bannerHtml('Only you can see this — your website is not published yet.', { href: `${ctx.config.baseUrl}/app/editor?id=${w.id}`, label: 'Back to the editor' })
      : bannerHtml(w.visibility === 'private' ? 'Your website is private — only you and your collaborators can see it.' : 'You are viewing your published website.', { href: `${ctx.config.baseUrl}/app`, label: 'Dashboard' });
  } else countVisit(ctx, req, res, w);
  if (!state.indexable) res.set('X-Robots-Tag', 'noindex, nofollow');
  res.set('Cache-Control', 'private, no-cache');
  res.type('html').send(renderSiteDocument(state));
}

function notFoundPage(ctx) {
  return simplePage(ctx, { status: 404, title: 'Website not found', body: '<h1>We could not find that wedding website</h1><p>It may be private, not published yet, or the address may be mistyped. Please check the link the couple shared with you.</p>' });
}

function passwordPage(ctx, w, base, error = '') {
  return simplePage(ctx, {
    status: error ? 401 : 200,
    title: `${coupleNames(w)} — password required`,
    body: `<h1>${esc(coupleNames(w))}</h1><p>This wedding website is password protected. The couple will have shared the password with you.</p>
      <form method="post" action="${esc(base)}/unlock" class="stack">
        <label class="field"><span>Website password</span><input type="password" name="password" autocomplete="current-password" required autofocus></label>
        ${error ? `<p class="form-error" role="alert">${esc(error)}</p>` : ''}
        <button class="btn btn-primary" type="submit">View website</button>
      </form>`
  });
}

export function siteRoutes(ctx, resolveWedding) {
  const { db, config } = ctx;
  const r = express.Router({ mergeParams: true });
  const rsvpLimiter = rateLimit({ windowMs: 10 * 60000, max: 30 });
  const lookupLimiter = rateLimit({ windowMs: 10 * 60000, max: 40 });
  const unlockLimiter = rateLimit({ windowMs: 15 * 60000, max: 15 });
  // Also cap guesses per website, so many IPs cannot share the work of guessing a password.
  const unlockSiteLimiter = rateLimit({ windowMs: 60 * 60000, max: 100, key: (req) => `unlock:${req.wedding?.id}` });

  r.use((req, res, next) => {
    const w = resolveWedding(req);
    if (!w) return send(res, notFoundPage(ctx));
    req.wedding = w;
    req.siteBase = req.baseUrl || '';
    next();
  });

  r.get('/', (req, res) => renderWeddingSite(ctx, req, res, req.wedding, req.siteBase));

  r.post('/unlock', unlockLimiter, unlockSiteLimiter, express.urlencoded({ extended: false }), (req, res) => {
    const w = req.wedding;
    if (w.visibility !== 'password' || w.status !== 'published') return res.redirect(303, `${req.siteBase}/`);
    if (!verifyPassword(String(req.body.password || ''), w.site_password_hash)) return send(res, passwordPage(ctx, w, req.siteBase, 'That password is not right. Please try again.'));
    issueUnlock(ctx, res, w.id);
    res.redirect(303, `${req.siteBase}/`);
  });

  function requireSiteAccess(req, res, next) {
    if (siteAccess(ctx, req, req.wedding) !== 'ok') return res.status(404).json({ error: 'This website is not available.' });
    if (req.wedding.status !== 'published' && !isMember(db, req, req.wedding.id)) return res.status(404).json({ error: 'This website is not available.' });
    next();
  }

  function allowedEvents(w, guest) {
    const snap = latestPublished(db, w.id)?.snapshot;
    const details = (snap?.sections || []).find((s) => s.type === 'details');
    return (details?.content?.events || []).filter((e) => e.name && (!e.restricted || guest?.private_events));
  }

  function findGuestByCode(w, code) {
    const c = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length !== 8) return null;
    return db.get('SELECT * FROM guests WHERE wedding_id = ? AND invite_code = ?', w.id, `${c.slice(0, 4)}-${c.slice(4)}`);
  }

  r.post('/rsvp/lookup', lookupLimiter, express.json({ limit: '10kb' }), requireSiteAccess, (req, res) => {
    const guest = findGuestByCode(req.wedding, req.body?.code);
    if (!guest) return res.status(404).json({ error: 'We could not find that invitation code. Please check it and try again.' });
    const latest = db.get('SELECT attending, events, plus_one_name, dietary, accessibility FROM rsvp_submissions WHERE guest_id = ? AND is_latest = 1', guest.id);
    res.json({
      guest: { first_name: guest.first_name, last_name: guest.last_name, plus_one_allowed: !!guest.plus_one_allowed || req.wedding.rsvp_plus_ones === 'everyone' },
      events: allowedEvents(req.wedding, guest).map((e) => ({ id: e.id, name: e.name, date: e.date, restricted: !!e.restricted })),
      existing: latest ? { ...latest, events: parseJson(latest.events, []) } : null
    });
  });

  r.post('/rsvp', rsvpLimiter, express.json({ limit: '50kb' }), requireSiteAccess, (req, res) => {
    const w = getWedding(db, req.wedding.id);
    const b = req.body || {};
    if (b.website) return res.json({ ok: true }); // honeypot: pretend success to bots, store nothing
    if (w.status !== 'published') throw new HttpError(400, 'RSVPs open once the couple publishes their website.');
    if (deadlinePassed(w.rsvp_deadline, w.timezone)) throw new HttpError(400, 'The RSVP deadline has passed. Please contact the couple directly.');
    const name = String(b.name || '').trim().slice(0, 120);
    const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
    const fields = {};
    if (!name) fields.name = 'Please enter your name.';
    if (!['yes', 'no'].includes(b.attending)) fields.attending = 'Please let us know if you can attend.';
    if (email && !validateEmail(email)) fields.email = 'That email address does not look right.';
    if (!email && w.rsvp_collect_email === 'required') fields.email = 'Please enter your email address.';

    let guest = b.invite_code ? findGuestByCode(w, b.invite_code) : null;
    if (b.invite_code && !guest) fields.invite_code = 'We could not find that invitation code.';
    if (!guest && w.rsvp_mode === 'invite_only' && !fields.invite_code) fields.invite_code = 'Please enter the invitation code from your invitation.';

    const { questions, id: formId } = loadQuestions(db, w.id);
    const answers = {};
    for (const q of questions) {
      const raw = b.answers?.[q.id];
      const value = q.type === 'checkbox' ? (raw === true || raw === 'yes' ? 'Yes' : 'No') : String(raw ?? '').trim().slice(0, 2000);
      if (q.required && (q.type === 'checkbox' ? value !== 'Yes' : !value)) fields[`q_${q.id}`] = `Please answer “${q.label}”.`;
      if (q.type === 'select' && value && !q.options.includes(value)) fields[`q_${q.id}`] = 'Please choose one of the options.';
      answers[q.id] = { label: q.label, value };
    }
    if (Object.keys(fields).length) return res.status(400).json({ error: Object.values(fields)[0], fields });

    // Match the response to an existing guest so updates replace rather than duplicate.
    if (!guest && email) guest = db.get('SELECT * FROM guests WHERE wedding_id = ? AND email = ?', w.id, email);
    if (!guest && !email) {
      const [first, ...rest] = name.split(/\s+/);
      guest = db.get('SELECT * FROM guests WHERE wedding_id = ? AND email IS NULL AND lower(first_name) = lower(?) AND lower(last_name) = lower(?)', w.id, first, rest.join(' '));
    }
    const events = allowedEvents(w, guest);
    const chosen = b.attending === 'yes' ? (Array.isArray(b.events) ? b.events.map(String) : []).filter((id) => events.some((e) => e.id === id)) : [];
    const plusOneAllowed = w.rsvp_plus_ones === 'everyone' || (w.rsvp_plus_ones === 'invited_only' && !!guest?.plus_one_allowed);
    const plusOne = b.attending === 'yes' && plusOneAllowed && b.plus_one && String(b.plus_one_name || '').trim() ? String(b.plus_one_name).trim().slice(0, 120) : null;
    const optIn = b.updates_opt_in === true || b.updates_opt_in === 'yes';
    const ts = now();
    let updated = false;
    const submissionId = uuid();

    db.tx(() => {
      if (!guest) {
        const [first, ...rest] = name.split(/\s+/);
        const gid = insertGuest(db, w.id, { first_name: first.slice(0, 80), last_name: rest.join(' ').slice(0, 80), email: email || null, plus_one_allowed: 0 });
        guest = db.get('SELECT * FROM guests WHERE id = ?', gid);
      } else if (email && !guest.email && !db.get('SELECT 1 FROM guests WHERE wedding_id = ? AND email = ?', w.id, email)) {
        db.run('UPDATE guests SET email = ?, updated_at = ? WHERE id = ?', email, ts, guest.id);
      }
      const prev = db.run('UPDATE rsvp_submissions SET is_latest = 0, superseded_at = ? WHERE guest_id = ? AND is_latest = 1', ts, guest.id);
      updated = prev.changes > 0;
      db.run(`INSERT INTO rsvp_submissions (id, wedding_id, guest_id, name, email, attending, events, plus_one_name, dietary, accessibility, updates_opt_in, is_latest, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        submissionId, w.id, guest.id, name, email || guest.email || null, b.attending, JSON.stringify(chosen), plusOne,
        w.rsvp_dietary ? String(b.dietary || '').slice(0, 1000) : '', w.rsvp_accessibility ? String(b.accessibility || '').slice(0, 1000) : '', optIn ? 1 : 0, ts);
      if (questions.length) db.run('INSERT INTO form_submissions (id, wedding_id, form_definition_id, rsvp_submission_id, answers, created_at) VALUES (?, ?, ?, ?, ?, ?)', uuid(), w.id, formId, submissionId, JSON.stringify(answers), ts);
      if (optIn && !guest.updates_opt_in) {
        db.run('UPDATE guests SET updates_opt_in = 1, unsubscribed_at = NULL, updated_at = ? WHERE id = ?', ts, guest.id);
        db.run("INSERT INTO consent_records (id, wedding_id, guest_id, type, granted, source, created_at) VALUES (?, ?, ?, 'wedding_updates', 1, 'rsvp_form', ?)", uuid(), w.id, guest.id, ts);
      }
    });
    track(db, 'guest_rsvp_submitted', { weddingId: w.id, props: { attending: b.attending, updated, with_code: !!b.invite_code } });
    const submission = db.get('SELECT * FROM rsvp_submissions WHERE id = ?', submissionId);
    const freshGuest = db.get('SELECT * FROM guests WHERE id = ?', guest.id);
    const mail = sendRsvpConfirmation(ctx.deps, w.id, submission, freshGuest);
    res.json({ ok: true, updated, confirmation_email: mail ? (mail.status === 'queued' ? 'queued' : mail.status) : 'none' });
  });

  r.get('/report', (req, res) => {
    send(res, simplePage(ctx, {
      title: 'Report this website',
      body: `<h1>Report this website</h1><p>Tell us if this wedding website contains harmful, abusive or misleading content, or if it uses your photos or information without permission.</p>
        <form method="post" action="${esc(req.siteBase)}/report" class="stack">
          <label class="field"><span>Reason</span><select name="reason" required><option value="">Choose a reason…</option><option value="impersonation">Impersonation or fake website</option><option value="privacy">Uses my photos or personal information</option><option value="abuse">Abusive or hateful content</option><option value="scam">Scam or fraud (e.g. fake payment requests)</option><option value="other">Something else</option></select></label>
          <label class="field"><span>Details</span><textarea name="details" rows="4" maxlength="2000"></textarea></label>
          <label class="field"><span>Your email (optional, so we can follow up)</span><input type="email" name="email" maxlength="200"></label>
          <button class="btn btn-primary" type="submit">Send report</button></form>`
    }));
  });

  r.post('/report', rsvpLimiter, express.urlencoded({ extended: false }), (req, res) => {
    const reason = ['impersonation', 'privacy', 'abuse', 'scam', 'other'].includes(req.body.reason) ? req.body.reason : 'other';
    const email = validateEmail(String(req.body.email || '')) ? String(req.body.email).trim() : null;
    db.run('INSERT INTO content_reports (id, wedding_id, reason, details, reporter_email, created_at) VALUES (?, ?, ?, ?, ?, ?)', uuid(), req.wedding.id, reason, String(req.body.details || '').slice(0, 2000), email, now());
    send(res, simplePage(ctx, { title: 'Report received', body: '<h1>Thank you</h1><p>Your report has been sent to our team. We review every report.</p>' }));
  });

  return r;
}

// Members-only preview of the current draft.
export function previewRoute(ctx) {
  return (req, res) => {
    const w = getWedding(ctx.db, req.params.weddingId);
    if (!w || !isMember(ctx.db, req, w.id)) return send(res, notFoundPage(ctx));
    const state = siteState(ctx, w, { draft: true, base: `/w/${w.slug}`, mode: 'preview' });
    state.options.noindex = true;
    state.options.banner = bannerHtml('Preview of your unpublished changes.', { href: `${ctx.config.baseUrl}/app/editor?id=${w.id}`, label: 'Back to the editor' });
    track(ctx.db, 'preview_opened', { userId: req.user.id, weddingId: w.id, props: { source: 'preview_page' } });
    res.set('X-Robots-Tag', 'noindex');
    res.type('html').send(renderSiteDocument(state));
  };
}

// Template demos with sample content, used by the gallery and landing page.
export const DEMO_ART = ['/demo/art-1.svg', '/demo/art-2.svg', '/demo/art-3.svg', '/demo/art-4.svg', '/demo/art-5.svg', '/demo/art-6.svg'];

export function demoState(templateId) {
  const tpl = getTemplate(templateId);
  const date = new Date(Date.now() + 160 * 864e5).toISOString().slice(0, 10);
  const media = DEMO_ART.map((src, i) => ({ id: `demo-${i}`, src, caption: ['Engagement day', 'Golden hour', 'Where it began', 'The proposal', 'Weekend away', 'Family dinner'][i], kind: i === 0 ? 'library' : 'gallery', is_cover: i === 0, position: i }));
  const sec = (type, content = {}) => ({ id: `demo-${type}`, type, status: 'visible', position: 0, settings: {}, content: { ...SECTION_TYPES[type].defaults({ wedding_date_local: `${date}T15:00`, location: 'The Old Orangery, Lisbon' }), ...content } });
  const sections = [
    sec('hero', { eyebrow: 'Together with their families', subheading: '' }),
    sec('countdown'),
    sec('story', { milestones: [
      { title: 'A rainy Tuesday', date_label: 'Spring 2019', text: 'We reached for the last umbrella at the same café and decided to share it.', image: 'demo-2' },
      { title: 'Two cities, one playlist', date_label: '2021', text: 'Long-distance, late-night calls and a shared playlist that grew to 400 songs.', image: null },
      { title: 'The question', date_label: 'Summer 2025', text: 'On a cliff above the sea, with one very nervous knee on the ground.', image: 'demo-3' }
    ] }),
    sec('details', { events: [
      { id: 'ceremony', name: 'Ceremony', date, start_time: '15:00', end_time: '16:00', venue: 'The Old Orangery', address: 'Rua das Flores 12, Lisbon', map_url: '', description: 'Please arrive by 2:30 pm.', restricted: false },
      { id: 'reception', name: 'Dinner & dancing', date, start_time: '18:00', end_time: '23:30', venue: 'Garden Terrace', address: '', map_url: '', description: 'Dinner, speeches and dancing under the stars.', restricted: false }
    ] }),
    sec('gallery'),
    sec('faq'),
    sec('rsvp')
  ].map((s, i) => ({ ...s, position: i }));
  return {
    wedding: { partner1: 'Amara', partner2: 'Theo', wedding_date_local: `${date}T15:00`, timezone: 'Europe/Lisbon', wedding_at_utc: new Date(`${date}T14:00:00Z`).toISOString(), location: 'Lisbon, Portugal', tagline: 'Join us for a weekend of love, laughter and celebration.', locale: 'en-GB' },
    design: { template_id: tpl.id, palette: tpl.defaults.palette, font_pairing: tpl.defaults.font_pairing, animation: tpl.defaults.animation },
    sections, media,
    rsvp: { open: true, mode: 'open', plus_ones: 'everyone', collect_email: 'optional', dietary: true, accessibility: false, questions: [{ id: 'song', label: 'Which song will get you on the dance floor?', type: 'text', required: false }] }
  };
}

export function demoRoute(ctx) {
  return (req, res) => {
    if (!TEMPLATES.some((t) => t.id === req.params.templateId)) return send(res, notFoundPage(ctx));
    const state = demoState(req.params.templateId);
    // Optional overrides so the wizard can preview a template with the couple's palette.
    const pal = req.query.palette ? String(req.query.palette).split(',') : null;
    if (pal && pal.length === 6 && pal.every((h) => /^[0-9a-f]{6}$/i.test(h))) {
      state.design.palette = Object.fromEntries(['primary', 'secondary', 'accent', 'background', 'surface', 'text'].map((k, i) => [k, `#${pal[i]}`]));
    }
    state.options = { mode: 'demo', apiBase: '', platformName: ctx.config.platformName, showBranding: false, noindex: true };
    res.set('X-Robots-Tag', 'noindex');
    res.type('html').send(renderSiteDocument(state));
  };
}

export function unsubscribeRoutes(ctx) {
  const { db } = ctx;
  const r = express.Router();
  const page = (g, msg = '') => {
    const w = getWedding(db, g.wedding_id);
    return simplePage(ctx, {
      title: 'Email preferences',
      body: `<h1>Email preferences</h1><p>For ${esc(g.first_name)}, on the guest list for <strong>${esc(coupleNames(w))}</strong>'s wedding.</p>
        ${msg ? `<p class="notice" role="status">${esc(msg)}</p>` : ''}
        <p>Currently: ${g.unsubscribed_at ? 'you will not receive any emails about this wedding.' : g.updates_opt_in ? 'you receive essential emails (invitation, RSVP confirmation, reminders) and wedding updates.' : 'you receive essential emails only (invitation, RSVP confirmation, reminders).'}</p>
        <form method="post" class="stack">
          ${g.updates_opt_in && !g.unsubscribed_at ? '<button class="btn btn-secondary" name="scope" value="updates">Stop wedding updates</button>' : ''}
          ${!g.unsubscribed_at ? '<button class="btn btn-secondary" name="scope" value="all">Unsubscribe from all emails about this wedding</button>' : '<button class="btn btn-primary" name="scope" value="resubscribe">Receive essential emails again</button>'}
        </form>`
    });
  };
  r.get('/:token', (req, res) => {
    const g = db.get('SELECT * FROM guests WHERE unsubscribe_token = ?', req.params.token);
    if (!g) return send(res, simplePage(ctx, { status: 404, title: 'Link not found', body: '<h1>This link is no longer valid</h1><p>Your guest record may have been removed by the couple.</p>' }));
    send(res, page(g));
  });
  r.post('/:token', express.urlencoded({ extended: false }), (req, res) => {
    const g = db.get('SELECT * FROM guests WHERE unsubscribe_token = ?', req.params.token);
    if (!g) return res.status(404).end();
    const ts = now();
    let msg = '';
    if (req.body.scope === 'updates') { db.run('UPDATE guests SET updates_opt_in = 0, updated_at = ? WHERE id = ?', ts, g.id); msg = 'You will no longer receive wedding updates.'; }
    if (req.body.scope === 'all') { db.run('UPDATE guests SET updates_opt_in = 0, unsubscribed_at = ?, updated_at = ? WHERE id = ?', ts, ts, g.id); msg = 'You have been unsubscribed from all emails about this wedding.'; }
    if (req.body.scope === 'resubscribe') { db.run('UPDATE guests SET unsubscribed_at = NULL, updated_at = ? WHERE id = ?', ts, g.id); msg = 'You will receive essential emails again.'; }
    if (msg) db.run('INSERT INTO consent_records (id, wedding_id, guest_id, type, granted, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', uuid(), g.wedding_id, g.id, req.body.scope === 'updates' ? 'wedding_updates' : 'all_email', req.body.scope === 'resubscribe' ? 1 : 0, 'unsubscribe_link', ts);
    send(res, page(db.get('SELECT * FROM guests WHERE id = ?', g.id), msg));
  });
  return r;
}
