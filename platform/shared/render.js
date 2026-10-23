// Renders a wedding website from the couple's own saved data. Runs on the server
// (published pages, previews, template demos) and in the editor's preview frame, so
// what couples see while editing is exactly what guests will see.

import { SECTION_TYPES } from './sections.js';
import { getTemplate } from './templates.js';
import { resolvePalette } from './color.js';
import { getPairing, googleFontsHref } from './fonts.js';

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function paragraphs(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  return t.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
}

function safeUrl(url) {
  const u = String(url || '').trim();
  return /^https?:\/\//i.test(u) ? u : '';
}

export function formatDate(dateStr, locale = 'en-GB', withWeekday = true) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(dateStr || '')) return '';
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: withWeekday ? 'long' : undefined, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatTime(timeStr, locale = 'en-GB') {
  if (!/^\d{2}:\d{2}$/.test(timeStr || '')) return '';
  const [h, mi] = timeStr.split(':').map(Number);
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(new Date(Date.UTC(2000, 0, 1, h, mi)));
}

export function coupleNames(w) {
  const a = (w.partner1 || '').trim(), b = (w.partner2 || '').trim();
  if (a && b) return `${a} & ${b}`;
  return a || b || 'Our wedding';
}

const SIZES = [400, 1200, 2000];

function imageTag(ctx, assetId, { sizes = '100vw', cls = '', alt = '', eager = false } = {}) {
  const asset = ctx.mediaById.get(assetId);
  if (!asset) return '';
  const altText = alt || asset.caption || '';
  if (asset.src) {
    return `<img src="${esc(asset.src)}" alt="${esc(altText)}" class="${cls}" ${eager ? '' : 'loading="lazy"'} decoding="async">`;
  }
  const base = `${ctx.mediaBase}/${asset.id}`;
  const v = asset.updated_at ? `?v=${encodeURIComponent(String(asset.updated_at).replace(/\D/g, ''))}` : '';
  const srcset = SIZES.filter((s) => !asset.width || s <= Math.max(asset.width, 400)).map((s) => `${base}/${s}${v} ${s}w`).join(', ');
  const dims = asset.width && asset.height ? `width="${asset.width}" height="${asset.height}"` : '';
  return `<img src="${base}/1200${v}" srcset="${srcset}" sizes="${sizes}" alt="${esc(altText)}" class="${cls}" ${dims} ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
}

const FLORAL_SVG = `<svg viewBox="0 0 200 200" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 190 C60 150 80 90 150 40"/><path d="M60 140c-20-6-34-22-36-44 22 2 38 18 36 44z"/><path d="M90 100c-4-20 4-40 24-50 6 20-4 40-24 50z"/><path d="M118 68c14-14 34-18 52-8-12 16-32 20-52 8z"/><circle cx="152" cy="38" r="9"/><circle cx="152" cy="38" r="3"/><path d="M40 168c-16 4-30-2-38-14 16-6 30-2 38 14z"/></g></svg>`;

function sectionHead(title, intro) {
  return `<header class="section-head" data-reveal>${title ? `<h2 class="section-title">${esc(title)}</h2>` : ''}${intro ? `<div class="section-intro">${paragraphs(intro)}</div>` : ''}</header>`;
}

const renderers = {
  hero(s, ctx) {
    const c = s.content, w = ctx.wedding;
    const layout = ctx.layoutFor(s);
    const cover = ctx.coverId;
    const names = c.heading
      ? esc(c.heading)
      : (w.partner1 && w.partner2
        ? `<span>${esc(w.partner1)}</span> <span class="amp">&amp;</span> <span>${esc(w.partner2)}</span>`
        : esc(coupleNames(w)));
    const tagline = c.subheading || w.tagline || '';
    const date = c.show_date && w.wedding_date_local ? formatDate(w.wedding_date_local, ctx.locale) : '';
    const meta = [date, c.show_location ? w.location : ''].filter(Boolean).map((m) => `<span>${esc(m)}</span>`).join('<span class="dot" aria-hidden="true">·</span>');
    const rsvpVisible = ctx.visibleTypes.has('rsvp');
    const cta = rsvpVisible && c.cta_label ? `<a class="btn" href="#rsvp">${esc(c.cta_label)}</a>` : '';
    const text = `<div class="hero-text" data-reveal>
        ${c.eyebrow ? `<p class="eyebrow">${esc(c.eyebrow)}</p>` : ''}
        <h1 class="hero-names">${names}</h1>
        ${ctx.template.id === 'ivory' ? '<div class="divider" aria-hidden="true"></div>' : ''}
        ${tagline ? `<p class="hero-tagline">${esc(tagline)}</p>` : ''}
        ${meta ? `<p class="hero-meta">${meta}</p>` : ''}
        ${cta}
      </div>`;
    const media = cover ? `<div class="hero-media" data-reveal>${imageTag(ctx, cover, { sizes: layout === 'fullbleed' ? '100vw' : '(min-width: 900px) 45vw, 90vw', eager: true })}</div>` : '';
    const decor = ctx.template.decor === 'floral' ? `<span class="decor-floral tl">${FLORAL_SVG}</span><span class="decor-floral br">${FLORAL_SVG}</span>` : '';
    if (layout === 'fullbleed') {
      return `<div class="hero-bg">${cover ? imageTag(ctx, cover, { sizes: '100vw', eager: true }) : ''}</div><div class="hero-inner on-photo${cover ? '' : ' no-photo'}">${text}</div>`;
    }
    if (layout === 'split') {
      return `${decor}<div class="hero-inner hero-split">${media}${text}</div>`;
    }
    return `${decor}<div class="hero-inner">${cover ? media : ''}${text}</div>`;
  },

  countdown(s, ctx) {
    const c = s.content, w = ctx.wedding;
    const layout = ctx.layoutFor(s);
    if (!w.wedding_at_utc) return sectionHead(c.title) + '<p class="center muted">Add your wedding date to start the countdown.</p>';
    const units = [['days', 'Days'], ['hours', 'Hours'], ['minutes', 'Minutes']].concat(c.show_seconds ? [['seconds', 'Seconds']] : []);
    const boxes = units.map(([k, label]) => `<div class="countdown-box"><span class="countdown-num" data-unit="${k}">–</span><span class="countdown-label">${label}</span></div>`).join('');
    return `${sectionHead(c.title)}
      <div class="countdown countdown-${layout}" data-countdown="${esc(w.wedding_at_utc)}" data-done="${esc(c.message || '')}" data-reveal>${boxes}</div>
      <p class="center muted countdown-date">${esc(formatDate(w.wedding_date_local, ctx.locale))}</p>`;
  },

  story(s, ctx) {
    const c = s.content;
    const layout = ctx.layoutFor(s);
    const items = (c.milestones || []).filter((m) => m.title || m.text).map((m, i) => {
      const img = m.image ? imageTag(ctx, m.image, { sizes: '(min-width: 900px) 40vw, 90vw', alt: m.title }) : '';
      return `<article class="story-item${img ? ' has-img' : ''}${layout === 'alternating' && i % 2 ? ' flip' : ''}" data-reveal>
        ${img ? `<div class="story-img">${img}</div>` : ''}
        <div class="story-body">
          ${m.date_label ? `<p class="story-when">${esc(m.date_label)}</p>` : ''}
          ${m.title ? `<h3>${esc(m.title)}</h3>` : ''}
          ${paragraphs(m.text)}
        </div></article>`;
    }).join('');
    return `${sectionHead(c.title, c.intro)}<div class="story story-${layout}">${items}</div>`;
  },

  details(s, ctx) {
    const c = s.content;
    const layout = ctx.layoutFor(s);
    const events = (c.events || []).filter((e) => e.name && !e.restricted);
    const cards = events.map((e) => {
      const time = [formatTime(e.start_time, ctx.locale), formatTime(e.end_time, ctx.locale)].filter(Boolean).join(' – ');
      const map = safeUrl(e.map_url);
      return `<article class="card event" data-reveal>
        <h3>${esc(e.name)}</h3>
        ${e.date ? `<p class="event-when"><strong>${esc(formatDate(e.date, ctx.locale))}</strong>${time ? `<br>${esc(time)}` : ''}</p>` : (time ? `<p class="event-when">${esc(time)}</p>` : '')}
        ${e.venue ? `<p class="event-venue">${esc(e.venue)}</p>` : ''}
        ${e.address ? `<p class="event-address muted">${esc(e.address).replace(/\n/g, '<br>')}</p>` : ''}
        ${paragraphs(e.description)}
        ${map ? `<p><a class="text-link" href="${esc(map)}" target="_blank" rel="noopener noreferrer">View map<span class="sr-only"> for ${esc(e.name)} (opens in a new tab)</span></a></p>` : ''}
      </article>`;
    }).join('');
    const empty = events.length ? '' : '<p class="center muted">Event details coming soon.</p>';
    return `${sectionHead(c.title, c.intro)}<div class="events events-${layout}">${cards}</div>${empty}`;
  },

  gallery(s, ctx) {
    const c = s.content;
    const layout = ctx.layoutFor(s);
    const items = ctx.gallery;
    if (!items.length) return `${sectionHead(c.title, c.intro)}<p class="center muted">Photos coming soon.</p>`;
    const figs = items.map((a, i) => `<figure data-reveal><button type="button" class="gallery-open" data-index="${i}" aria-label="Open photo ${i + 1}${a.caption ? ': ' + esc(a.caption) : ''}">${imageTag(ctx, a.id, { sizes: layout === 'carousel' ? '(min-width: 900px) 60vw, 90vw' : '(min-width: 900px) 30vw, 50vw' })}</button>${c.show_captions && a.caption ? `<figcaption>${esc(a.caption)}</figcaption>` : ''}</figure>`).join('');
    const controls = layout === 'carousel' ? `<div class="carousel-controls"><button type="button" class="btn btn-ghost" data-carousel="prev" aria-label="Previous photo">‹</button><button type="button" class="btn btn-ghost" data-carousel="next" aria-label="Next photo">›</button></div>` : '';
    const lightboxData = esc(JSON.stringify(items.map((a) => ({ src: a.src || `${ctx.mediaBase}/${a.id}/2000`, caption: a.caption || '' }))));
    return `${sectionHead(c.title, c.intro)}<div class="gallery gallery-${layout === 'masonry' ? 'masonry' : layout === 'carousel' ? 'carousel' : 'grid'}" data-lightbox="${lightboxData}">${figs}</div>${controls}`;
  },

  rsvp(s, ctx) {
    const c = s.content;
    const r = ctx.rsvp;
    const layout = ctx.layoutFor(s);
    if (!r.open) {
      return `${sectionHead(c.title)}<div class="card rsvp-card center" data-reveal>${paragraphs(c.closed_message)}</div>`;
    }
    const events = (ctx.publicEvents || []).map((e) => `<label class="check"><input type="checkbox" name="events" value="${esc(e.id)}" checked> ${esc(e.name)}${e.date ? ` <span class="muted">· ${esc(formatDate(e.date, ctx.locale, false))}</span>` : ''}</label>`).join('');
    const custom = (r.questions || []).map((q) => {
      const req = q.required ? ' required' : '';
      const reqMark = q.required ? ' <span aria-hidden="true">*</span>' : ' <span class="muted">(optional)</span>';
      const name = `q_${esc(q.id)}`;
      if (q.type === 'select') {
        return `<label class="field"><span>${esc(q.label)}${reqMark}</span><select name="${name}"${req}><option value="">Choose…</option>${(q.options || []).map((o) => `<option>${esc(o)}</option>`).join('')}</select></label>`;
      }
      if (q.type === 'checkbox') return `<label class="check"><input type="checkbox" name="${name}" value="yes"${req}> ${esc(q.label)}</label>`;
      if (q.type === 'textarea') return `<label class="field"><span>${esc(q.label)}${reqMark}</span><textarea name="${name}" rows="3"${req}></textarea></label>`;
      return `<label class="field"><span>${esc(q.label)}${reqMark}</span><input type="text" name="${name}"${req}></label>`;
    }).join('');
    const deadline = r.deadline ? `<p class="muted center">Please respond by ${esc(formatDate(r.deadline, ctx.locale))}.</p>` : '';
    const codeField = r.mode === 'invite_only'
      ? `<label class="field"><span>Invitation code <span aria-hidden="true">*</span></span><input type="text" name="invite_code" autocomplete="off" required inputmode="text" maxlength="20"></label>`
      : '<input type="hidden" name="invite_code">';
    const plusOne = `<fieldset class="plus-one" ${r.plus_ones === 'everyone' ? '' : 'hidden'} data-plus-one><legend>Bringing a guest?</legend>
        <label class="check"><input type="checkbox" name="plus_one" value="yes"> I'll bring a plus-one</label>
        <label class="field"><span>Their name</span><input type="text" name="plus_one_name" maxlength="120"></label></fieldset>`;
    const form = `<form class="rsvp-form" novalidate data-rsvp-form ${ctx.mode === 'published' ? '' : 'data-preview-only'}>
        <div class="rsvp-invite-note" data-invite-note hidden></div>
        ${codeField}
        <label class="field"><span>Your full name <span aria-hidden="true">*</span></span><input type="text" name="name" autocomplete="name" required maxlength="120"></label>
        <label class="field"><span>Email ${r.collect_email === 'required' ? '<span aria-hidden="true">*</span>' : '<span class="muted">(for your confirmation)</span>'}</span><input type="email" name="email" autocomplete="email" maxlength="200" ${r.collect_email === 'required' ? 'required' : ''}></label>
        <fieldset class="attend"><legend>Will you attend? <span aria-hidden="true">*</span></legend>
          <label class="check"><input type="radio" name="attending" value="yes" required> Joyfully accept</label>
          <label class="check"><input type="radio" name="attending" value="no"> Regretfully decline</label>
        </fieldset>
        <fieldset class="rsvp-events" data-events ${events ? '' : 'hidden'}><legend>Which events will you attend?</legend><div data-event-list>${events}</div></fieldset>
        ${plusOne}
        ${r.dietary ? `<label class="field"><span>Dietary requirements <span class="muted">(optional)</span></span><textarea name="dietary" rows="2" maxlength="1000"></textarea></label>` : ''}
        ${r.accessibility ? `<label class="field"><span>Accessibility needs <span class="muted">(optional)</span></span><textarea name="accessibility" rows="2" maxlength="1000"></textarea></label>` : ''}
        ${custom}
        <label class="check small"><input type="checkbox" name="updates_opt_in" value="yes"> Email me occasional updates about the wedding (you can unsubscribe at any time)</label>
        <div class="hp" aria-hidden="true"><label>Leave this empty<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
        <p class="form-error" role="alert" data-form-error hidden></p>
        <button class="btn" type="submit">Send RSVP</button>
      </form>
      <div class="rsvp-success center" data-rsvp-success hidden tabindex="-1">${paragraphs(c.success_message)}<p><button type="button" class="text-link" data-rsvp-again>Change my response</button></p></div>`;
    const photo = layout === 'split' && ctx.coverId ? `<div class="rsvp-photo">${imageTag(ctx, ctx.gallery[0]?.id || ctx.coverId, { sizes: '(min-width: 900px) 40vw, 0px' })}</div>` : '';
    return `${sectionHead(c.title, c.intro)}${deadline}<div class="rsvp-wrap rsvp-${layout}">${photo}<div class="card rsvp-card" data-reveal>${form}</div></div>`;
  },

  party(s, ctx) {
    const c = s.content;
    const people = (c.members || []).filter((m) => m.name || m.role).map((m) => `<article class="person" data-reveal>${m.image ? `<div class="person-img">${imageTag(ctx, m.image, { sizes: '200px', alt: m.name })}</div>` : `<div class="person-img placeholder" aria-hidden="true">${esc((m.name || '?').slice(0, 1))}</div>`}<h3>${esc(m.name)}</h3>${m.role ? `<p class="muted">${esc(m.role)}</p>` : ''}${paragraphs(m.bio)}</article>`).join('');
    return `${sectionHead(c.title)}<div class="people">${people}</div>`;
  },

  dresscode(s) {
    const c = s.content;
    const swatches = String(c.colours || '').split(',').map((x) => x.trim()).filter((x) => /^#[0-9a-f]{3,6}$/i.test(x));
    return `${sectionHead(c.title)}<div class="card narrow center" data-reveal>${c.code ? `<p class="lead">${esc(c.code)}</p>` : ''}${paragraphs(c.description)}${swatches.length ? `<div class="swatches">${swatches.map((x) => `<span class="swatch" style="background:${esc(x)}" title="${esc(x)}"></span>`).join('')}</div>` : ''}</div>`;
  },

  venue(s) {
    const c = s.content;
    const map = safeUrl(c.map_url);
    return `${sectionHead(c.title)}<div class="card narrow" data-reveal>${c.name ? `<h3>${esc(c.name)}</h3>` : ''}${c.address ? `<p class="muted">${esc(c.address).replace(/\n/g, '<br>')}</p>` : ''}${map ? `<p><a class="btn btn-ghost" href="${esc(map)}" target="_blank" rel="noopener noreferrer">Open map</a></p>` : ''}${c.directions ? `<h4>Directions</h4>${paragraphs(c.directions)}` : ''}${c.parking ? `<h4>Parking</h4>${paragraphs(c.parking)}` : ''}</div>`;
  },

  travel(s) {
    const c = s.content;
    const hotels = (c.hotels || []).filter((h) => h.name).map((h) => { const u = safeUrl(h.url); return `<article class="card" data-reveal><h3>${u ? `<a class="text-link" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(h.name)}</a>` : esc(h.name)}</h3>${h.distance ? `<p class="muted">${esc(h.distance)}</p>` : ''}${paragraphs(h.notes)}</article>`; }).join('');
    return `${sectionHead(c.title, c.intro)}${hotels ? `<div class="events events-cards">${hotels}</div>` : ''}${c.transport ? `<div class="narrow" data-reveal><h4>Getting around</h4>${paragraphs(c.transport)}</div>` : ''}`;
  },

  registry(s) {
    const c = s.content;
    const links = (c.links || []).filter((l) => l.label && safeUrl(l.url)).map((l) => `<a class="card registry-link" href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener noreferrer" data-reveal><strong>${esc(l.label)}</strong>${l.description ? `<span class="muted">${esc(l.description)}</span>` : ''}</a>`).join('');
    return `${sectionHead(c.title, c.intro)}${links ? `<div class="registry">${links}</div>` : ''}${c.details ? `<div class="card narrow" data-reveal>${paragraphs(c.details)}</div>` : ''}`;
  },

  faq(s, ctx) {
    const c = s.content;
    const layout = ctx.layoutFor(s);
    const items = (c.items || []).filter((i) => i.q);
    const body = layout === 'accordion'
      ? items.map((i) => `<details class="faq-item" data-reveal><summary>${esc(i.q)}</summary>${paragraphs(i.a)}</details>`).join('')
      : items.map((i) => `<div class="faq-item" data-reveal><h3>${esc(i.q)}</h3>${paragraphs(i.a)}</div>`).join('');
    return `${sectionHead(c.title)}<div class="faq narrow">${body}</div>`;
  }
};

// Build every value the renderers need from the raw site state.
function buildContext(state) {
  const template = getTemplate(state.design?.template_id);
  const media = state.media || [];
  const mediaById = new Map(media.map((m) => [m.id, m]));
  const cover = media.find((m) => m.is_cover) || null;
  const gallery = media.filter((m) => m.kind === 'gallery').sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const sections = (state.sections || []).filter((s) => s.status === 'visible' && renderers[s.type]).sort((a, b) => a.position - b.position);
  const details = (state.sections || []).find((s) => s.type === 'details' && s.status === 'visible');
  const publicEvents = (details?.content?.events || []).filter((e) => e.name && !e.restricted);
  return {
    template,
    wedding: state.wedding || {},
    mediaById,
    coverId: cover ? cover.id : (gallery[0]?.id || null),
    gallery,
    sections,
    visibleTypes: new Set(sections.map((s) => s.type)),
    publicEvents,
    rsvp: { open: true, questions: [], mode: 'open', plus_ones: 'invited_only', collect_email: 'optional', dietary: true, accessibility: false, ...(state.rsvp || {}) },
    mode: state.options?.mode || 'published',
    mediaBase: state.options?.mediaBase || '/media',
    locale: state.wedding?.locale || 'en-GB',
    layoutFor: (s) => s.settings?.layout || template.layouts[s.type] || SECTION_TYPES[s.type].layouts[0][0]
  };
}

export function buildCss(state) {
  const template = getTemplate(state.design?.template_id);
  const { effective } = resolvePalette(state.design?.palette, template.defaults.palette);
  const fonts = getPairing(state.design?.font_pairing || template.defaults.font_pairing);
  const vars = `:root{--c-primary:${effective.primary};--c-secondary:${effective.secondary};--c-accent:${effective.accent};--c-bg:${effective.background};--c-surface:${effective.surface};--c-text:${effective.text};--c-text-surface:${effective.textOnSurface};--c-heading:${effective.heading};--c-link:${effective.link};--c-button:${effective.button};--c-on-primary:${effective.onPrimary};--c-on-secondary:${effective.onSecondary};--c-muted:${effective.muted};--c-border:${effective.border};--f-heading:'${fonts.heading}',Georgia,serif;--f-body:'${fonts.body}',system-ui,sans-serif;--f-script:'${fonts.script || fonts.heading}',cursive;}`;
  return vars + BASE_CSS + template.css;
}

export function renderSiteParts(state) {
  const ctx = buildContext(state);
  const w = ctx.wedding;
  const names = coupleNames(w);
  const nav = ctx.sections.filter((s) => s.type !== 'hero').map((s) => `<li><a href="#${esc(anchorFor(s))}">${esc(navLabel(s))}</a></li>`).join('');
  const body = ctx.sections.map((s) => `<section id="${esc(anchorFor(s))}" class="section s-${s.type}" data-section-id="${esc(s.id)}">${s.type === 'hero' ? '' : '<div class="section-inner">'}${renderers[s.type](s, ctx)}${s.type === 'hero' ? '' : '</div>'}</section>`).join('\n');
  const empty = ctx.sections.length ? '' : '<section class="section"><div class="section-inner center"><p class="muted">This website has no visible sections yet.</p></div></section>';
  const opts = state.options || {};
  const branding = opts.showBranding !== false ? `<p class="branding">Made with <a href="${esc(opts.platformUrl || '/')}">${esc(opts.platformName || 'Vowly')}</a></p>` : '';
  const report = opts.mode === 'published' && opts.reportUrl ? `<p class="report"><a href="${esc(opts.reportUrl)}">Report this website</a></p>` : '';
  const footer = `<footer class="site-footer"><p class="footer-names">${esc(names)}</p>${w.wedding_date_local ? `<p class="muted">${esc(formatDate(w.wedding_date_local, ctx.locale))}</p>` : ''}${branding}${report}</footer>`;
  const html = `<a class="skip-link" href="#main">Skip to content</a>
<header class="site-nav"><div class="nav-inner"><a class="nav-brand" href="#top">${esc(w.partner1 && w.partner2 ? `${w.partner1.slice(0, 1)} & ${w.partner2.slice(0, 1)}` : names)}</a>
<button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-menu"><span class="sr-only">Menu</span><span aria-hidden="true">☰</span></button>
<nav aria-label="Website sections"><ul id="site-menu">${nav}</ul></nav></div></header>
<main id="main">${body}${empty}</main>${footer}
<dialog class="lightbox" aria-label="Photo viewer"><button type="button" class="lightbox-close" aria-label="Close">×</button><button type="button" class="lightbox-prev" aria-label="Previous photo">‹</button><figure><img alt=""><figcaption></figcaption></figure><button type="button" class="lightbox-next" aria-label="Next photo">›</button></dialog>`;
  const animation = ['static', 'subtle', 'expressive'].includes(state.design?.animation) ? state.design.animation : 'subtle';
  const fonts = getPairing(state.design?.font_pairing || ctx.template.defaults.font_pairing);
  return {
    css: buildCss(state),
    html,
    fontsHref: googleFontsHref(fonts),
    bodyClass: `t-${ctx.template.id} anim-${animation} mode-${ctx.mode}`,
    title: names
  };
}

function anchorFor(s) {
  return s.type === 'hero' ? 'top' : s.type === 'details' ? 'details' : s.type;
}

function navLabel(s) {
  const t = s.content?.title;
  const short = { story: 'Our story', countdown: 'Countdown', details: 'Details', gallery: 'Gallery', rsvp: 'RSVP', faq: 'Q&A', travel: 'Travel', venue: 'Venue', registry: 'Gifts', party: 'Wedding party', dresscode: 'Dress code' };
  return short[s.type] || t || SECTION_TYPES[s.type].name;
}

// Full HTML document for server responses.
export function renderSiteDocument(state) {
  const parts = renderSiteParts(state);
  const o = state.options || {};
  const w = state.wedding || {};
  const desc = [w.wedding_date_local ? formatDate(w.wedding_date_local, w.locale || 'en-GB') : '', w.location, w.tagline].filter(Boolean).join(' · ');
  const meta = [
    `<meta name="description" content="${esc(desc || `The wedding of ${parts.title}`)}">`,
    o.noindex ? '<meta name="robots" content="noindex, nofollow">' : '',
    o.canonicalUrl ? `<link rel="canonical" href="${esc(o.canonicalUrl)}">` : '',
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(parts.title)}">`,
    `<meta property="og:description" content="${esc(desc || 'Join us to celebrate our wedding.')}">`,
    o.canonicalUrl ? `<meta property="og:url" content="${esc(o.canonicalUrl)}">` : '',
    o.ogImage ? `<meta property="og:image" content="${esc(o.ogImage)}"><meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'
  ].filter(Boolean).join('\n');
  const apiBase = o.apiBase ?? '';
  return `<!doctype html>
<html lang="${esc((w.locale || 'en-GB').slice(0, 2))}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<title>${esc(parts.title)}${o.mode === 'preview' ? ' (preview)' : ''}</title>
${meta}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${esc(parts.fontsHref)}">
<style>${parts.css}</style>
</head>
<body class="${parts.bodyClass}" data-api-base="${esc(apiBase)}" data-mode="${esc(o.mode || 'published')}">
${o.banner || ''}
${parts.html}
<script src="/site.js" defer></script>
</body>
</html>`;
}

const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none!important}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
@media (prefers-reduced-motion: reduce){html{scroll-behavior:auto}}
body{margin:0;background:var(--c-bg);color:var(--c-text);font-family:var(--f-body);font-size:1.0625rem;line-height:1.7;--w-content:1080px}
img{max-width:100%;height:auto;display:block}
h1,h2,h3,h4{font-family:var(--f-heading);color:var(--c-heading);line-height:1.15;margin:0 0 .5em;font-weight:600}
h3{font-size:1.4rem}h4{font-size:1.1rem;margin-top:1.4em}
p{margin:0 0 1em}
a{color:var(--c-link)}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0}
.skip-link{position:absolute;left:-999px;top:8px;background:var(--c-button);color:var(--c-on-primary);padding:8px 14px;z-index:100;border-radius:4px}
.skip-link:focus{left:8px}
:focus-visible{outline:3px solid var(--c-link);outline-offset:3px}
.muted{color:var(--c-muted)}.center{text-align:center}.small{font-size:.9rem}.lead{font-size:1.4rem;font-family:var(--f-heading);color:var(--c-heading)}
.narrow{max-width:680px;margin-left:auto;margin-right:auto}
.btn{display:inline-block;background:var(--c-button);color:var(--c-on-primary);border:1px solid var(--c-button);padding:13px 28px;border-radius:6px;font:600 .95rem var(--f-body);text-decoration:none;cursor:pointer;transition:transform .2s ease,box-shadow .2s ease,background .2s ease}
.btn:hover{transform:translateY(-1px)}
.btn-ghost{background:transparent;color:var(--c-heading);border-color:var(--c-border)}
.text-link{background:none;border:0;padding:0;font:inherit;color:var(--c-link);text-decoration:underline;cursor:pointer}
.site-nav{position:sticky;top:0;z-index:50;background:color-mix(in srgb,var(--c-bg) 92%,transparent);backdrop-filter:blur(8px)}
.nav-inner{max-width:var(--w-content);margin:0 auto;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;gap:16px}
.nav-brand{font-family:var(--f-heading);color:var(--c-heading);text-decoration:none;font-size:1.25rem}
.site-nav ul{list-style:none;margin:0;padding:0;display:flex;gap:22px;flex-wrap:wrap}
.site-nav nav a{color:var(--c-text);text-decoration:none;font-size:.9rem;letter-spacing:.04em}
.site-nav nav a:hover{color:var(--c-link)}
.nav-toggle{display:none;background:none;border:1px solid var(--c-border);color:var(--c-text);border-radius:6px;padding:6px 10px;font-size:1.1rem;cursor:pointer}
@media (max-width:760px){.nav-toggle{display:block}.site-nav nav{position:absolute;left:0;right:0;top:100%;background:var(--c-bg);border-bottom:1px solid var(--c-border);display:none}.site-nav.open nav{display:block}.site-nav ul{flex-direction:column;gap:0;padding:8px 20px 16px}.site-nav ul a{display:block;padding:10px 0}}
.section{position:relative;padding:96px 20px;overflow:hidden}
@media (max-width:760px){.section{padding:64px 18px}}
.section-inner{max-width:var(--w-content);margin:0 auto}
.section-head{text-align:center;margin-bottom:44px}
.section-title{font-size:clamp(2rem,5vw,3rem)}
.section-intro{max-width:620px;margin:0 auto;color:var(--c-muted)}
.s-hero{padding:0;min-height:80vh;display:flex;align-items:center;justify-content:center;background:var(--c-surface);color:var(--c-text-surface)}
.hero-inner{position:relative;z-index:1;max-width:var(--w-content);margin:0 auto;padding:72px 20px;text-align:center;width:100%}
.hero-inner .hero-media{max-width:340px;margin:0 auto 36px}
.hero-inner .hero-media img{width:100%;object-fit:cover;aspect-ratio:4/5;border-radius:8px}
.hero-split{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center;text-align:left}
.hero-split .hero-media{max-width:none;margin:0}
@media (max-width:760px){.hero-split{grid-template-columns:1fr;text-align:center;gap:28px}.hero-split .hero-media{max-width:300px;margin:0 auto}}
.eyebrow{text-transform:uppercase;letter-spacing:.28em;font-size:.78rem;color:var(--c-muted);margin-bottom:18px}
.hero-names{font-size:clamp(2.6rem,8vw,5.2rem);margin-bottom:.3em}
.hero-tagline{font-size:1.2rem;max-width:560px;margin:0 auto 1em;font-family:var(--f-heading);font-style:italic}
.hero-split .hero-tagline{margin-left:0}
.hero-meta{letter-spacing:.12em;text-transform:uppercase;font-size:.85rem;margin-bottom:2em}
.hero-meta .dot{margin:0 .6em}
.hero-bg{position:absolute;inset:0}
.hero-bg img{width:100%;height:100%;object-fit:cover}
.s-hero:has(.hero-bg){min-height:92vh}
.hero-bg::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.25),rgba(0,0,0,.55))}
.on-photo:not(.no-photo),.on-photo:not(.no-photo) .hero-names,.on-photo:not(.no-photo) .eyebrow,.on-photo:not(.no-photo) .hero-meta{color:#fff}
.on-photo:not(.no-photo) .btn{background:#fff;color:#111;border-color:#fff}
.card{background:var(--c-surface);color:var(--c-text-surface);border-radius:10px;padding:28px}
.card h3{color:var(--c-heading)}
.countdown{display:flex;justify-content:center;gap:16px;flex-wrap:wrap}
.countdown-box{min-width:104px;padding:20px 12px;text-align:center;background:var(--c-surface);color:var(--c-text-surface);border-radius:10px}
.countdown-minimal .countdown-box{background:transparent;min-width:90px}
.countdown-num{display:block;font-variant-numeric:lining-nums tabular-nums;font-family:var(--f-heading);font-size:clamp(2.2rem,6vw,3.4rem);color:var(--c-heading);line-height:1}
.countdown-label{text-transform:uppercase;letter-spacing:.2em;font-size:.72rem;color:var(--c-muted)}
.countdown-date{margin-top:24px}
.countdown.done{font-family:var(--f-heading);font-size:1.6rem;color:var(--c-heading)}
.story{display:grid;gap:56px;max-width:900px;margin:0 auto}
.story-item{display:grid;gap:36px;align-items:center}
.story-item.has-img{grid-template-columns:1fr 1.1fr}
.story-alternating .story-item.flip .story-img{order:2}
.story-img img{border-radius:8px;width:100%;aspect-ratio:4/3;object-fit:cover}
.story-when{text-transform:uppercase;letter-spacing:.2em;font-size:.78rem;color:var(--c-link);margin-bottom:6px}
.story-timeline{border-left:1px solid var(--c-border);padding-left:32px;gap:48px}
.story-timeline .story-item{position:relative}
.story-timeline .story-item::before{content:"";position:absolute;left:-38px;top:8px;width:11px;height:11px;border-radius:50%;background:var(--c-heading)}
.story-simple{max-width:680px;text-align:center}
.story-simple .story-item.has-img{grid-template-columns:1fr}
@media (max-width:760px){.story-item.has-img{grid-template-columns:1fr}.story-alternating .story-item.flip .story-img{order:0}}
.events{display:grid;gap:24px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.events-timeline{grid-template-columns:1fr;max-width:720px;margin:0 auto;border-left:1px solid var(--c-border);padding-left:28px}
.event-when{margin-bottom:.6em}.event-venue{font-weight:600;margin-bottom:.2em}
.gallery-grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(200px,1fr))}
.gallery-grid img{width:100%;height:100%;aspect-ratio:1;object-fit:cover}
.gallery-masonry{columns:3 220px;column-gap:12px}
.gallery-masonry figure{break-inside:avoid;margin-bottom:12px}
.gallery-carousel{display:flex;gap:14px;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:10px;scrollbar-width:thin}
.gallery-carousel figure{flex:0 0 min(78%,640px);scroll-snap-align:center}
.gallery-carousel img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px}
.carousel-controls{display:flex;justify-content:center;gap:12px;margin-top:16px}
.gallery figure{margin:0}
.gallery figcaption{font-size:.88rem;color:var(--c-muted);padding:6px 2px}
.gallery-open{display:block;width:100%;padding:0;border:0;background:none;cursor:zoom-in;overflow:hidden;border-radius:6px}
.lightbox{border:0;padding:0;background:transparent;max-width:100vw;max-height:100vh;width:100vw;height:100vh}
.lightbox::backdrop{background:rgba(10,10,10,.9)}
.lightbox[open]{display:flex;align-items:center;justify-content:center}
.lightbox figure{margin:0;max-width:90vw}
.lightbox img{max-height:82vh;width:auto;margin:0 auto;border-radius:4px}
.lightbox figcaption{color:#eee;text-align:center;padding:10px}
.lightbox button{position:absolute;background:rgba(255,255,255,.12);color:#fff;border:0;width:48px;height:48px;border-radius:50%;font-size:1.8rem;cursor:pointer}
.lightbox-close{top:16px;right:16px}.lightbox-prev{left:16px}.lightbox-next{right:16px}
.rsvp-wrap{max-width:640px;margin:0 auto}
.rsvp-split{display:grid;grid-template-columns:1fr 1.2fr;gap:32px;max-width:var(--w-content);align-items:stretch}
.rsvp-photo img{width:100%;height:100%;object-fit:cover;border-radius:10px}
@media (max-width:760px){.rsvp-split{grid-template-columns:1fr}.rsvp-photo{display:none}}
.rsvp-form{display:grid;gap:18px}
.field{display:grid;gap:6px;font-weight:600;font-size:.95rem}
.field input,.field select,.field textarea{font:400 1rem var(--f-body);padding:12px 14px;border:1px solid var(--c-border);border-radius:6px;background:var(--c-bg);color:var(--c-text);width:100%}
fieldset{border:0;padding:0;margin:0;display:grid;gap:8px}
legend{font-weight:600;margin-bottom:6px;font-size:.95rem}
.check{display:flex;gap:10px;align-items:flex-start;font-weight:400}
.check input{margin-top:.35em;accent-color:var(--c-button);width:18px;height:18px}
.hp{position:absolute;left:-9999px}
.form-error{color:#b00020;background:#fdecee;padding:10px 14px;border-radius:6px;margin:0}
.rsvp-invite-note{background:var(--c-bg);border:1px dashed var(--c-border);padding:10px 14px;border-radius:6px}
.people{display:grid;gap:28px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));text-align:center}
.person-img{width:140px;height:140px;margin:0 auto 14px;border-radius:50%;overflow:hidden;background:var(--c-surface)}
.person-img img{width:100%;height:100%;object-fit:cover}
.person-img.placeholder{display:flex;align-items:center;justify-content:center;font-family:var(--f-heading);font-size:3rem;color:var(--c-heading)}
.swatches{display:flex;gap:10px;justify-content:center;margin-top:12px}
.swatch{width:36px;height:36px;border-radius:50%;border:2px solid var(--c-border)}
.registry{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin-bottom:24px}
.registry-link{display:grid;gap:4px;text-decoration:none}
.faq-item{border-bottom:1px solid var(--c-border);padding:16px 0}
.faq-item summary{cursor:pointer;font-family:var(--f-heading);font-size:1.2rem;color:var(--c-heading)}
.faq-item h3{font-size:1.2rem}
.faq-item[open] summary{margin-bottom:10px}
.site-footer{text-align:center;padding:56px 20px;border-top:1px solid var(--c-border)}
.footer-names{font-family:var(--f-heading);font-size:1.6rem;color:var(--c-heading);margin-bottom:.2em}
.branding,.report{font-size:.82rem;color:var(--c-muted);margin:.6em 0 0}
.branding a,.report a{color:var(--c-muted)}
.mode-editor .section{cursor:pointer}
.mode-editor .section.is-selected{outline:2px dashed var(--c-link);outline-offset:-6px}
@media (prefers-reduced-motion: no-preference){
.reveal-ready .anim-subtle [data-reveal]{opacity:0;transform:translateY(14px);transition:opacity .7s ease,transform .7s ease}
.reveal-ready .anim-expressive [data-reveal]{opacity:0;transform:translateY(36px) scale(.98);transition:opacity .9s cubic-bezier(.2,.7,.2,1),transform .9s cubic-bezier(.2,.7,.2,1)}
.anim-subtle [data-reveal].is-visible,.anim-expressive [data-reveal].is-visible{opacity:1;transform:none}
.anim-expressive .hero-media img,.anim-expressive .hero-bg img{animation:heroZoom 14s ease-out both}
.anim-expressive .decor-floral{animation:sway 9s ease-in-out infinite alternate}
.anim-expressive .gallery-open img{transition:transform .6s ease}.anim-expressive .gallery-open:hover img{transform:scale(1.05)}
@keyframes heroZoom{from{transform:scale(1.08)}to{transform:scale(1)}}
@keyframes sway{from{rotate:-3deg}to{rotate:3deg}}
}
`;
