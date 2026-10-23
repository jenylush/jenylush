// Reusable UI pieces: template cards and plan comparison.
import { esc } from './api.js';
import { TEMPLATES } from '/shared/templates.js';

export function templateCard(t, { selected = false, actions = '', lazy = true } = {}) {
  const def = TEMPLATES.find((x) => x.id === t.id) || t;
  const pal = def.defaults.palette;
  return `<article class="template-card${selected ? ' selected' : ''}" data-template="${esc(t.id)}">
    <div class="template-thumb">
      <iframe src="/templates/${esc(t.id)}/demo" title="${esc(t.name)} template preview" ${lazy ? 'loading="lazy"' : ''} tabindex="-1" aria-hidden="true"></iframe>
      <span class="tier">${t.tier === 'premium' ? '<span class="premium-tag">Premium</span>' : '<span class="badge green">Free</span>'}</span>
    </div>
    <div class="template-body">
      <div class="row between"><h3 style="margin:0">${esc(t.name)}</h3><div class="swatch-row" aria-hidden="true">${['primary', 'secondary', 'accent', 'background'].map((k) => `<span style="background:${esc(pal[k])}"></span>`).join('')}</div></div>
      <p class="small" style="margin:0;color:var(--brand);font-weight:600">${esc(t.style)}</p>
      <p class="small muted" style="margin:0">${esc(t.description)}</p>
      <div class="actions">${actions}</div>
    </div>
  </article>`;
}

function money(cents, currency) {
  if (!cents) return 'Free';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100); } catch { return `${(cents / 100).toFixed(2)} ${currency}`; }
}

function storage(mb) { return mb >= 1024 ? `${Math.round(mb / 102.4) / 10} GB` : `${mb} MB`; }

export function planFeatures(e) {
  return [
    [e.template_tiers?.includes('premium') ? 'All templates, including premium designs' : 'A selection of free templates', true],
    [e.advanced_colours ? 'Full colour control and every font pairing' : 'Preset palettes, your own primary colour and core fonts', true],
    [e.animations?.includes('expressive') ? 'Static, subtle and expressive animation' : 'Static and subtle animation', true],
    [`${e.max_photos} photos · ${storage(e.storage_mb)} storage`, true],
    [e.custom_questions > 2 ? 'Advanced RSVP forms with custom questions' : `RSVP form with ${e.custom_questions} custom questions`, true],
    ['Your own address on our domain, mobile-ready publishing', true],
    ['RSVP confirmation and invitation emails', true],
    ['Scheduled reminders and wedding update emails', (e.email_workflows || []).includes('rsvp_reminder')],
    ['Password protection', !!e.password_protection],
    ['Custom domain', !!e.custom_domain],
    ['No platform branding', !!e.remove_branding],
    ['Full RSVP history export', !!e.advanced_exports]
  ];
}

export function planCards(plans, { current = null, waitlisted = [], paymentsEnabled = false, signedIn = false } = {}) {
  return plans.map((p) => {
    const featured = p.id === 'premium';
    let cta;
    if (p.id === 'free') cta = current === 'free' ? '<span class="badge green">Your current plan</span>' : signedIn ? '' : '<a class="btn btn-secondary" href="/signup">Start for free</a>';
    else if (current === p.id) cta = '<span class="badge gold">Your current plan</span>';
    else if (p.status === 'coming_soon' || !paymentsEnabled) cta = signedIn
      ? (waitlisted.includes(p.id) ? '<span class="badge green">You are on the waitlist ✓</span>' : `<button class="btn btn-primary" type="button" data-waitlist="${esc(p.id)}">Join the Premium waitlist</button>`)
      : '<a class="btn btn-primary" href="/signup">Start free — upgrade later</a>';
    else cta = `<button class="btn btn-primary" type="button" data-checkout="${esc(p.id)}">Upgrade to ${esc(p.name)}</button>`;
    return `<div class="plan${featured ? ' featured' : ''}">
      <div class="row between"><h3 style="margin:0;font-size:1.3rem">${esc(p.name)}</h3>${p.status === 'coming_soon' ? '<span class="badge gold">Coming soon</span>' : ''}</div>
      <div><span class="price">${money(p.price_cents, p.currency)}</span>${p.price_cents ? `<span class="muted small"> ${p.billing_interval === 'one_time' ? 'one-time' : `per ${esc(p.billing_interval)}`}</span>` : ''}</div>
      <p class="muted small" style="margin:0">${esc(p.description)}</p>
      <ul>${planFeatures(p.entitlements).map(([label, yes]) => `<li class="${yes ? '' : 'no'}">${esc(label)}</li>`).join('')}</ul>
      <div style="margin-top:auto">${cta}</div>
    </div>`;
  }).join('');
}
