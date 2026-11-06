// Vowly test version: the platform's real templates, renderer and editor panels,
// running as one web app in the browser.
import { $, $$, esc, toast, modal, confirmDialog, setFieldErrors, copyText, ApiError } from './local-api.js';
import { showError, upgradePrompt } from './local-api.js';
import * as B from './backend.js';
import { DraftStore, statusText } from '../../platform/public/js/draft-store.js';
import { renderBasics, renderTemplatePicker, renderDesign, renderPhotos, renderSectionList, renderSectionSettings, applyTemplate } from '../../platform/public/js/editor-controls.js';
import { planFeatures } from '../../platform/public/js/components.js';
import { TEMPLATES, getTemplate } from '../../platform/shared/templates.js';
import { coupleNames, formatDate } from '../../platform/shared/render.js';
import { parseCsv } from '../../platform/src/csv.js';
import { siteHtml, LivePreview, demoState } from './site-frame.js';
import { mountBudget } from './budget-view.js';

const app = document.getElementById('app');
let route = 'home';
let store = null;            // DraftStore for the couple's website draft
let cleanup = [];            // listeners to drop when leaving a view

const ROUTES = ['home', 'templates', 'signup', 'wizard', 'dashboard', 'editor', 'site', 'guests', 'budget', 'plans', 'settings'];
const APP_ROUTES = new Set(['dashboard', 'editor', 'site', 'guests', 'budget', 'settings']);

function savedRoute() { try { return localStorage.getItem('vowly-test-route'); } catch { return null; } }
function rememberRoute(r) { try { localStorage.setItem('vowly-test-route', r); } catch { /* storage unavailable */ } }

async function getStore() {
  if (!store) { store = new DraftStore('local'); await store.load(); }
  return store;
}

export async function go(r, opts = {}) {
  if (!ROUTES.includes(r)) r = 'home';
  const d = B.data();
  if (APP_ROUTES.has(r) || r === 'wizard') {
    if (!d.user) r = 'signup';
    else if (!d.wedding && r !== 'wizard') r = 'wizard';
  }
  if (r === 'signup' && d.user) r = d.wedding ? 'dashboard' : 'wizard';
  if (store) await store.flush();
  cleanup.forEach((fn) => fn());
  cleanup = [];
  route = r;
  rememberRoute(r);
  window.scrollTo(0, 0);
  await VIEWS[r](opts);
}
window.__go = go;

// Links inside shared panels point at real platform URLs; keep them in the app.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="/"], a[data-go]');
  if (!a) return;
  e.preventDefault();
  const href = a.dataset.go || a.getAttribute('href');
  if (href.startsWith('/app/upgrade') || href === 'plans') go('plans');
  else if (ROUTES.includes(href)) go(href);
}, true);

window.addEventListener('storage-full', () => toast('This browser’s storage is full, so recent changes may not be kept. Remove a few photos.', 'error', 9000));

// ---------------------------------------------------------------- chrome
const LOGO = '<a class="logo" href="#" data-go="home"><span class="logo-mark" aria-hidden="true"></span>Vowly</a>';

function shell(inner, opts = {}) {
  const d = B.data();
  const appNav = opts.appNav ?? !!(d.user && d.wedding);
  const navItems = appNav
    ? [['dashboard', 'Dashboard'], ['editor', 'Website'], ['templates', 'Templates'], ['guests', 'Guests & RSVPs'], ['budget', 'Budget & gifts'], ['settings', 'Settings']]
    : [['templates', 'Templates'], ['plans', 'Plans']];
  app.innerHTML = `
    <div class="announcement">Test version · everything you create is saved in this browser only <button type="button" class="link-btn" data-reset style="color:#fff;margin-left:8px">Start over</button></div>
    <header class="topbar"><div class="container">${LOGO}
      <button class="btn btn-ghost btn-icon menu-toggle" type="button" aria-expanded="false" aria-controls="nav" aria-label="Menu">☰</button>
      <nav class="topnav" id="nav" aria-label="Main">${navItems.map(([r, l]) => `<a href="#" data-go="${r}" ${route === r ? 'aria-current="page"' : ''}>${l}</a>`).join('')}${appNav ? `<a href="#" data-go="plans" ${route === 'plans' ? 'aria-current="page"' : ''}>Plans</a>` : ''}</nav>
      <div class="right">${d.user && d.wedding
        ? `<button class="btn btn-secondary btn-sm hide-sm" type="button" data-go-btn="site">View my website</button><span class="avatar" title="${esc(d.user.email)}" aria-hidden="true">${esc(d.user.name.slice(0, 1).toUpperCase())}</span>`
        : d.user ? '<button class="btn btn-primary btn-sm" type="button" data-go-btn="wizard">Continue setup</button>'
        : '<button class="btn btn-primary btn-sm" type="button" data-go-btn="signup">Get started free</button>'}</div>
    </div></header>
    <main id="main">${inner}</main>`;
  const header = $('.topbar');
  $('.menu-toggle').addEventListener('click', () => header.classList.toggle('open'));
  $$('[data-go-btn]').forEach((b) => b.addEventListener('click', () => go(b.dataset.goBtn)));
  $('[data-reset]').addEventListener('click', resetFlow);
  return $('#main');
}

async function resetFlow() {
  if (!await confirmDialog('This deletes your test account, website, guests and budget from this browser so you can start again.', { title: 'Start over?', confirmLabel: 'Delete and start over', danger: true })) return;
  store = null;
  B.resetAll();
  go('home');
}

const iframeFor = (state, { mode = 'demo', cls = '', title = 'Website preview' } = {}) => {
  const f = document.createElement('iframe');
  f.title = title;
  if (cls) f.className = cls;
  f.srcdoc = siteHtml(state, { mode, showBranding: false });
  return f;
};

// ---------------------------------------------------------------- public pages
const VIEWS = {};

VIEWS.home = () => {
  const d = B.data();
  const main = shell(`
    <section class="lp-hero"><div class="container">
      <div><p class="eyebrow">Wedding websites, made simple</p>
        <h1>Your wedding. <em>Your story.</em> Your website.</h1>
        <p class="lede">Choose a template, add your wedding colours and photos, and publish a beautiful website your guests will love, with RSVPs, a guest list and a budget tracker in one place. No design or coding skills needed.</p>
        <div class="row" style="margin-top:28px"><button class="btn btn-primary btn-lg" type="button" data-start>${d.wedding ? 'Go to my dashboard' : 'Create Your Wedding Website'}</button><button class="btn btn-secondary btn-lg" type="button" data-go-btn2="templates">Explore Templates</button></div>
        <p class="small muted" style="margin-top:16px">This is the test version: try every step yourself. Nothing is sent to anyone.</p></div>
      <div class="device-stack" aria-hidden="true"><div class="device desktop" data-dev="rosewater"></div><div class="device phone" data-dev="gazette"></div></div>
    </div></section>
    <section class="lp-section alt"><div class="container">
      <div class="section-intro"><p class="eyebrow">How it works</p><h2>Published in an afternoon</h2></div>
      <div class="steps">
        <div class="step"><h3>Tell us the basics</h3><p class="muted">Your names, the date and the place.</p></div>
        <div class="step"><h3>Pick a template</h3><p class="muted">Five designs, each fully customisable.</p></div>
        <div class="step"><h3>Make it yours</h3><p class="muted">Colours, fonts, photos and sections, with a live preview.</p></div>
        <div class="step"><h3>Share & collect RSVPs</h3><p class="muted">Publish, invite guests and track replies and your budget.</p></div>
      </div></div></section>`);
  $$('[data-dev]', main).forEach((el) => el.append(iframeFor(demoState(el.dataset.dev), { title: 'Example website' })));
  $('[data-start]', main).addEventListener('click', () => go(d.wedding ? 'dashboard' : d.user ? 'wizard' : 'signup'));
  $('[data-go-btn2]', main).addEventListener('click', () => go('templates'));
};

function previewModal(state, title) {
  const body = document.createElement('div');
  body.className = 'stack';
  body.innerHTML = `<div class="preview-toggle" role="group" aria-label="Preview size" style="justify-self:center"><button type="button" data-dv="desktop" aria-pressed="true">Desktop</button><button type="button" data-dv="mobile" aria-pressed="false">Mobile</button></div><div class="preview-frame-wrap"></div>`;
  body.querySelector('.preview-frame-wrap').append(iframeFor(state, { title }));
  $$('[data-dv]', body).forEach((b) => b.addEventListener('click', () => { $$('[data-dv]', body).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); body.querySelector('.preview-frame-wrap').classList.toggle('mobile', b.dataset.dv === 'mobile'); }));
  modal({ title, body, wide: true });
}

VIEWS.templates = () => {
  const d = B.data();
  const ent = B.plan().entitlements;
  const main = shell(`<div class="page container">
    <div class="section-intro"><p class="eyebrow">Template gallery</p><h1>Find your style</h1><p>Each template is a starting point. Change colours, fonts, photos and sections to make it yours. Your content stays put if you switch later.</p></div>
    <div class="template-grid">${TEMPLATES.map((t) => `<article class="template-card${d.design?.template_id === t.id ? ' selected' : ''}">
      <div class="template-thumb" data-thumb="${t.id}"><span class="tier">${t.tier === 'premium' ? '<span class="premium-tag">Premium</span>' : '<span class="badge green">Free</span>'}</span></div>
      <div class="template-body"><h3 style="margin:0">${esc(t.name)}</h3><p class="small" style="margin:0;color:var(--brand);font-weight:600">${esc(t.style)}</p><p class="small muted" style="margin:0">${esc(t.description)}</p>
        <div class="actions"><button class="btn btn-primary btn-sm" type="button" data-use="${t.id}">${d.design?.template_id === t.id ? 'Your current template' : 'Use this template'}</button><button class="btn btn-ghost btn-sm" type="button" data-prev="${t.id}">Preview</button></div></div></article>`).join('')}</div></div>`);
  $$('[data-thumb]', main).forEach((el) => el.prepend(iframeFor(demoState(el.dataset.thumb), { title: 'Template preview' })));
  $$('[data-prev]', main).forEach((b) => b.addEventListener('click', () => previewModal(demoState(b.dataset.prev), `${getTemplate(b.dataset.prev).name} template`)));
  $$('[data-use]', main).forEach((b) => b.addEventListener('click', async () => {
    const t = getTemplate(b.dataset.use);
    if (!ent.template_tiers.includes(t.tier)) return upgradePrompt({ feature: 'template', feature_label: 'Premium templates', error: `${t.name} is a premium template.` });
    if (!d.user) { pendingTemplate = t.id; return go('signup'); }
    if (!d.wedding) { pendingTemplate = t.id; return go('wizard'); }
    const s = await getStore();
    applyTemplate(s, t.id, B.plan());
    await s.flush();
    toast(`Switched to ${t.name}. All your content was kept.`, 'success');
    go('editor', { tab: 'design' });
  }));
};
let pendingTemplate = null;

VIEWS.signup = () => {
  const main = shell(`<div class="auth-wrap"><aside class="auth-art" aria-hidden="true"><blockquote>“We built our whole website on a lunch break.”</blockquote><p style="opacity:.85">— Amara & Theo</p></aside>
    <div class="auth-main"><div class="auth-card"><h1>Create your wedding website</h1><p class="muted">Free to start and free to publish.</p>
    <form class="stack" id="f" novalidate>
      <label class="field"><span>Your name</span><input type="text" name="name" autocomplete="name" id="su-name"></label>
      <label class="field"><span>Email</span><input type="email" name="email" autocomplete="email" id="su-email"></label>
      <label class="field"><span>Password <span class="hint">At least 10 characters</span></span><input type="password" name="password" autocomplete="new-password" id="su-pw"></label>
      <p class="notice info small">Test version: your account is kept only in this browser and no email is sent.</p>
      <p class="form-error" role="alert" hidden></p>
      <button class="btn btn-primary btn-lg" type="submit">Create my account</button></form></div></div></div>`);
  const f = $('#f', main);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    try { B.signUp(Object.fromEntries(new FormData(f))); go('wizard'); } catch (err) { const box = $('.form-error', f); box.textContent = err.message; box.hidden = false; setFieldErrors(f, err.data?.fields); }
  });
};

VIEWS.plans = () => {
  const p = B.plan();
  const main = shell(`<div class="page container"><div class="section-intro"><p class="eyebrow">Plans</p><h1>Free to start. Free to publish.</h1><p>Everything you need to publish and collect RSVPs is free. Premium adds every template, full colour control, more photos and scheduled guest emails.</p></div>
    <div class="plans">${Object.values(B.PLANS).map((pl) => `<div class="plan${pl.id === 'premium' ? ' featured' : ''}"><div class="row between"><h3 style="margin:0;font-size:1.3rem">${pl.name}</h3>${pl.id === 'premium' ? '<span class="badge gold">Coming soon</span>' : ''}</div>
      <div><span class="price">${pl.id === 'free' ? 'Free' : '$49'}</span>${pl.id === 'free' ? '' : '<span class="muted small"> one-time</span>'}</div>
      <ul>${planFeatures(pl.entitlements).map(([l, yes]) => `<li class="${yes ? '' : 'no'}">${esc(l)}</li>`).join('')}</ul>
      <div style="margin-top:auto">${p.id === pl.id ? '<span class="badge green">Your current plan</span>' : B.data().user ? `<button class="btn ${pl.id === 'premium' ? 'btn-primary' : 'btn-secondary'}" type="button" data-plan="${pl.id}">${pl.id === 'premium' ? 'Turn on Premium for testing' : 'Switch back to Free'}</button>` : '<button class="btn btn-primary" type="button" data-go-btn3="signup">Start for free</button>'}</div></div>`).join('')}</div>
    <p class="center small muted" style="margin-top:24px">In this test version Premium is free to switch on, so you can try every feature. Switching back to Free never deletes anything you made.</p></div>`);
  $$('[data-plan]', main).forEach((b) => b.addEventListener('click', () => { B.setPremium(b.dataset.plan === 'premium'); toast(b.dataset.plan === 'premium' ? 'Premium is on for testing' : 'Back on the Free plan', 'success'); store = null; go('plans'); }));
  $('[data-go-btn3]', main)?.addEventListener('click', () => go('signup'));
};

// ---------------------------------------------------------------- wizard
const STEPS = [
  ['Wedding basics', 'Let’s start with the essentials. You can change any of this later.'],
  ['Choose a template', 'Pick the design that feels most like you. Your content moves with you if you switch later.'],
  ['Set your theme', 'Choose your wedding colours, fonts and how much movement you like.'],
  ['Add photos', 'Upload a cover photo and a few favourites for your gallery.'],
  ['Choose sections', 'Decide what to include and in what order. Hidden and removed sections keep their content.'],
  ['Preview & publish', 'Check everything looks right, choose your web address and go live.']
];

VIEWS.wizard = async ({ step } = {}) => {
  const d = B.data();
  let i = step ?? (d.wedding ? Math.min(Math.max(d.wedding.setup_step - 1, 0), 5) : 0);
  if (d.wedding?.first_published_at && step === undefined) i = 0;
  const main = shell('<div class="wizard" id="wz"></div>', { appNav: !!d.wedding });
  const wz = $('#wz', main);
  let preview = null, offs = [];
  const drop = () => { offs.forEach((f) => f()); offs = []; };
  cleanup.push(drop);

  const draw = async () => {
    drop();
    const s = B.data().wedding ? await getStore() : null;
    const maxStep = B.data().wedding ? B.data().wedding.setup_step - 1 : 0;
    wz.innerHTML = `<ol class="wizard-steps" aria-label="Setup steps">${STEPS.map(([t], k) => `<li class="${k < i ? 'done' : ''}${k === i ? ' current' : ''}"><button type="button" data-step="${k}" ${!s || k > maxStep ? 'disabled' : ''}>${k + 1}. ${t}</button></li>`).join('')}</ol>
      <div class="page-head" style="margin-bottom:18px"><div><p class="eyebrow" style="margin:0 0 6px">Step ${i + 1} of 6</p><h1>${STEPS[i][0]}</h1><p>${STEPS[i][1]}</p></div></div>
      <div id="body"></div>
      <div class="wizard-foot"><div class="inner"><button class="btn btn-ghost" type="button" id="back" ${i === 0 ? 'hidden' : ''}>← Back</button>
        <span class="save-status" id="status" role="status" data-state="saved">${s ? 'All changes saved' : ''}</span>
        <span class="row">${s ? '<button class="btn btn-ghost hide-sm" type="button" id="later">Finish later</button>' : ''}<button class="btn btn-primary" type="button" id="next">${i === 5 ? 'Go to dashboard' : 'Continue →'}</button></span></div></div>`;
    $$('[data-step]', wz).forEach((b) => b.addEventListener('click', () => { i = Number(b.dataset.step); draw(); }));
    $('#back', wz).addEventListener('click', () => { i--; draw(); });
    $('#later', wz)?.addEventListener('click', () => go('dashboard'));
    $('#next', wz).addEventListener('click', next);
    if (s) offs.push(s.onStatus((st, det) => { const el = $('#status'); if (el) { el.dataset.state = st; el.textContent = statusText(st, det); } }));
    const body = $('#body', wz);
    const plan = B.plan();
    const pv = (target = body) => {
      target.insertAdjacentHTML('beforeend', `<div class="stack-sm" style="margin-top:28px"><div class="row between"><h2 style="font-size:1.3rem;margin:0">Live preview</h2><div class="preview-toggle" role="group" aria-label="Preview size"><button type="button" data-dv="desktop" aria-pressed="true">Desktop</button><button type="button" data-dv="mobile" aria-pressed="false">Mobile</button></div></div><div class="preview-frame-wrap" id="pvw"><iframe title="Preview of your website" id="pv"></iframe></div></div>`);
      preview = new LivePreview($('#pv'));
      const render = () => preview.render(s.state, { mode: 'editor', showBranding: !plan.entitlements.remove_branding });
      offs.push(s.onChange(render));
      render();
      $$('[data-dv]', target).forEach((b) => b.addEventListener('click', () => { $$('[data-dv]', target).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); $('#pvw').classList.toggle('mobile', b.dataset.dv === 'mobile'); }));
    };
    if (i === 0 && !s) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const zones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [tz];
      body.innerHTML = `<form class="card stack" id="create" novalidate>
        <div class="grid-2"><label class="field"><span>First partner's name</span><input type="text" name="partner1" maxlength="80" id="c-p1"></label><label class="field"><span>Second partner's name</span><input type="text" name="partner2" maxlength="80" id="c-p2"></label></div>
        <div class="grid-2"><label class="field"><span>Wedding date & time <span class="hint">An estimate is fine</span></span><input type="datetime-local" name="wedding_date_local" id="c-date"></label>
        <label class="field"><span>Timezone</span><select name="timezone" id="c-tz">${zones.map((z) => `<option ${z === tz ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></label></div>
        <label class="field"><span>Main location</span><input type="text" name="location" maxlength="200" placeholder="City, country or venue" id="c-loc"></label>
        <label class="field"><span>Tagline <span class="hint">Optional</span></span><input type="text" name="tagline" maxlength="200" placeholder="Two hearts, one adventure" id="c-tag"></label>
        <p class="form-error" role="alert" hidden></p></form>`;
      $('#c-p1').focus();
    } else if (i === 0) {
      body.innerHTML = '<div class="card" id="basics"></div>';
      renderBasics($('#basics'), s);
    } else if (i === 1) {
      body.innerHTML = '<div id="tpl"></div>';
      renderTemplatePicker($('#tpl'), s, { plan, templates: TEMPLATES });
      pv();
    } else if (i === 2) { body.innerHTML = '<div class="card" id="design"></div>'; renderDesign($('#design'), s, { plan }); pv(); }
    else if (i === 3) { body.innerHTML = '<div class="card" id="photos"></div>'; renderPhotos($('#photos'), s, { plan }); pv(); }
    else if (i === 4) { body.innerHTML = '<div class="card" id="secs"></div>'; renderSectionList($('#secs'), s, { plan }); pv(); }
    else {
      await s.flush();
      const w = B.data().wedding;
      const ch = B.checklist();
      body.innerHTML = `<div class="dash-grid"><div id="pvc"></div><div class="stack" style="margin-top:28px">
        <div class="card stack"><h2 style="font-size:1.3rem;margin:0">Your web address</h2>
          <label class="field"><span>Address</span><div class="row" style="flex-wrap:nowrap;gap:6px"><span class="small muted">vowly.com/w/</span><input type="text" id="slug" value="${esc(w.slug)}" maxlength="50" autocapitalize="none" spellcheck="false"></div></label>
          <p class="small" id="slug-msg" role="status"></p></div>
        <div class="card"><h2 style="font-size:1.3rem">Before you publish</h2>${checklistHtml(ch)}</div>
        <div class="card stack-sm"><button class="btn btn-primary btn-lg" type="button" id="pub">${w.status === 'published' ? 'Publish changes' : 'Publish my website'}</button>
          <button class="btn btn-secondary" type="button" id="draft">Save as draft</button></div></div></div>`;
      pv($('#pvc'));
      $('#slug').addEventListener('input', (e) => {
        e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        const ok = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/.test(e.target.value);
        $('#slug-msg').textContent = ok ? '✓ Available' : 'Use 3–50 lowercase letters, numbers or hyphens.';
        $('#slug-msg').style.color = ok ? 'var(--sage)' : 'var(--danger)';
        if (ok) B.updateWedding({ slug: e.target.value });
      });
      $('#pub').addEventListener('click', () => publishDialog(() => go('site')));
      $('#draft').addEventListener('click', () => go('dashboard'));
    }
  };

  async function next() {
    const btn = $('#next');
    if (i === 0 && !B.data().wedding) {
      const f = $('#create');
      try {
        B.createWedding({ ...Object.fromEntries(new FormData(f)), template: pendingTemplate });
        pendingTemplate = null;
        store = null;
        i = 1;
        draw();
      } catch (err) { const box = $('.form-error', f); box.textContent = err.message; box.hidden = false; setFieldErrors(f, err.data?.fields); }
      return;
    }
    const s = await getStore();
    if (i === 5) { await s.flush(); return go('dashboard'); }
    if (i === 0 && (!s.state.wedding.partner1.trim() || !s.state.wedding.partner2.trim())) return toast('Please enter both names to continue.', 'error');
    btn.disabled = true;
    s.pendingExtra.setup_step = i + 2;
    s.schedule(true);
    await s.flush();
    i++;
    draw();
  }
  await draw();
};

function checklistHtml(ch) {
  return `<ul class="checklist">${ch.items.map((it) => `<li class="${it.ok ? 'ok' : ''}"><span class="tick" aria-hidden="true">${it.ok ? '✓' : ''}</span><span>${esc(it.label)}${it.required && !it.ok ? ' <span class="badge red">Required</span>' : ''}<span class="sr-only">${it.ok ? ' — done' : ' — to do'}</span></span></li>`).join('')}</ul>`;
}

async function publishDialog(after) {
  if (store) await store.flush();
  const ch = B.checklist();
  const missing = ch.items.filter((x) => x.required && !x.ok);
  const w = B.data().wedding;
  modal({
    title: w.first_published_at ? 'Publish your changes' : 'Publish your website',
    body: missing.length ? `<p>Before publishing, please add:</p><ul>${missing.map((m) => `<li>${esc(m.label)}</li>`).join('')}</ul>` : `<div class="stack"><p>Your website will be live at <strong>vowly.com/w/${esc(w.slug)}</strong>.</p><p class="small muted">In this test version, “live” means you can open it as a guest with “View my website” and send RSVPs to yourself.</p></div>`,
    actions: missing.length ? [{ label: 'Close' }] : [{ label: 'Cancel' }, {
      label: 'Publish now', className: 'btn-primary', onClick: () => {
        try { B.publish(); toast(w.first_published_at ? 'Changes published' : 'Your website is live! 🎉', 'success'); after?.(); } catch (err) { showError(err); }
      }
    }]
  });
}

// ---------------------------------------------------------------- dashboard
VIEWS.dashboard = () => {
  const d = B.data();
  const w = d.wedding;
  const c = B.rsvpCounts();
  const ch = B.checklist();
  const pub = w.status === 'published';
  const diff = w.wedding_at_utc ? Date.parse(w.wedding_at_utc) - Date.now() : null;
  const cd = diff === null ? '' : diff <= 0 ? '<p class="names" style="font-size:1.6rem;margin-top:16px">Congratulations — you’re married! 🎉</p>' : `<div class="countdown-inline" aria-label="Time until the wedding"><div><strong>${Math.floor(diff / 864e5)}</strong><span>days</span></div><div><strong>${Math.floor(diff / 36e5) % 24}</strong><span>hours</span></div><div><strong>${Math.floor(diff / 6e4) % 60}</strong><span>minutes</span></div></div>`;
  const done = ch.items.filter((x) => x.ok).length;
  const main = shell(`<div class="page container">
    ${!w.first_published_at && w.setup_step < 7 ? `<div class="card upgrade-card row between" style="margin-bottom:20px"><div><h3 style="margin:0">Finish setting up your website</h3><p class="muted small" style="margin:4px 0 0">You're on step ${Math.min(w.setup_step, 6)} of 6. Your progress is saved.</p></div><button class="btn btn-primary" type="button" data-to="wizard">Continue setup</button></div>` : ''}
    <div class="dash-grid"><div class="stack">
      <section class="card hero-card"><div class="row between"><span class="badge ${pub ? 'green' : ''} dot">${pub ? (w.visibility === 'private' ? 'Published · private' : 'Published') : 'Draft — not published'}</span><span class="small muted">Template: <strong>${esc(getTemplate(d.design.template_id).name)}</strong></span></div>
        <p class="names">${esc(coupleNames(w))}</p><p class="muted" style="margin:0">${w.wedding_date_local ? esc(formatDate(w.wedding_date_local)) : 'Add your wedding date'}${w.location ? ` · ${esc(w.location)}` : ''}</p>${cd}
        <div class="url-box"><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" class="small">vowly.com/w/${esc(w.slug)}</span><button class="btn btn-secondary btn-sm" type="button" data-to="site">${pub ? 'Open as a guest' : 'Preview'}</button></div>
        ${B.hasUnpublishedChanges() ? '<p class="notice warn small" style="margin-top:14px">You have changes that are not live yet. Publish to update your website.</p>' : ''}</section>
      <section><div class="row between" style="margin-bottom:10px"><h2 style="font-size:1.4rem;margin:0">Guests & RSVPs</h2><button class="link-btn small" type="button" data-to="guests">View guest list →</button></div>
        <div class="stats"><div class="stat green"><strong>${c.confirmed}</strong><span>Attending${c.plus_ones ? ` (+${c.plus_ones})` : ''}</span></div><div class="stat rose"><strong>${c.declined}</strong><span>Declined</span></div><div class="stat gold"><strong>${c.pending}</strong><span>Not replied yet</span></div><div class="stat"><strong>${w.visits}</strong><span>Website visits</span></div></div></section>
      <section class="card"><h2 style="font-size:1.4rem">Quick actions</h2><div class="quick-actions">
        <button type="button" data-to="editor"><span class="qa-icon" aria-hidden="true">✎</span>Edit website</button>
        <button type="button" data-to="site"><span class="qa-icon" aria-hidden="true">◉</span>${pub ? 'View as a guest' : 'Preview'}</button>
        <button type="button" data-publish><span class="qa-icon" aria-hidden="true">★</span>${pub ? 'Publish changes' : 'Publish website'}</button>
        <button type="button" data-to="guests"><span class="qa-icon" aria-hidden="true">☺</span>Manage guests</button>
        <button type="button" data-to="templates"><span class="qa-icon" aria-hidden="true">▦</span>Change template</button>
        <button type="button" data-to="budget"><span class="qa-icon" aria-hidden="true">¤</span>Budget & gifts</button></div></section>
    </div><aside class="stack">
      <section class="card"><h2 style="font-size:1.3rem">Website checklist</h2><div class="progress" style="margin-bottom:14px"><div style="width:${Math.round(done / ch.items.length * 100)}%"></div></div>${checklistHtml(ch)}</section>
      <section class="card" id="bud"></section>
      <section class="card-flat small"><strong>Your plan: ${esc(B.plan().name)}</strong><p class="muted" style="margin:6px 0 10px">Premium adds every template, full colour control and more.</p><button class="btn btn-secondary btn-sm" type="button" data-to="plans">See plans</button></section>
    </aside></div></div>`, { appNav: true });
  $$('[data-to]', main).forEach((b) => b.addEventListener('click', () => go(b.dataset.to)));
  $('[data-publish]', main).addEventListener('click', () => publishDialog(() => go('dashboard')));
  mountBudget($('#bud', main), { compact: true, onOpen: () => go('budget') });
};

// ---------------------------------------------------------------- editor
VIEWS.editor = async ({ tab } = {}) => {
  const s = await getStore();
  const plan = B.plan();
  app.innerHTML = `<div class="editor-body">
    <header class="editor-top"><button class="btn btn-ghost btn-sm" type="button" data-to="dashboard">← <span class="hide-sm">Dashboard</span></button>
      <span class="title">${esc(coupleNames(s.state.wedding))}</span><span class="save-status" id="st" role="status" data-state="saved">All changes saved</span><span class="spacer"></span>
      <button class="btn btn-ghost btn-icon" type="button" id="undo" aria-label="Undo" title="Undo (Ctrl+Z)" disabled>↶</button><button class="btn btn-ghost btn-icon" type="button" id="redo" aria-label="Redo" title="Redo" disabled>↷</button>
      <button class="btn btn-secondary btn-sm hide-sm" type="button" data-to="site">View as guest</button><button class="btn btn-primary btn-sm" type="button" id="pub">Publish</button></header>
    <div class="mobile-editor-switch" role="tablist"><button type="button" role="tab" data-m="sections" aria-selected="false">Sections</button><button type="button" role="tab" data-m="preview" aria-selected="true">Preview</button><button type="button" role="tab" data-m="settings" aria-selected="false">Edit</button></div>
    <div class="editor-main" id="em" data-mobile="preview">
      <nav class="editor-left" aria-label="Website sections"><div class="panel"><h2>Website</h2><div class="stack-sm">
        <button type="button" class="section-item" data-pseudo="design" style="cursor:pointer"><span class="section-icon" aria-hidden="true">Aa</span><span class="section-name">Design: template, colours, fonts</span></button>
        <button type="button" class="section-item" data-pseudo="photos" style="cursor:pointer"><span class="section-icon" aria-hidden="true">▦</span><span class="section-name">Photos</span></button></div></div>
        <div class="panel"><h2>Sections</h2><div id="sl"></div></div><div class="panel small muted">Tip: click any part of the preview to edit it. Changes save automatically.</div></nav>
      <section class="editor-canvas" aria-label="Live preview"><div class="canvas-bar"><div class="preview-toggle" role="group" aria-label="Preview size"><button type="button" data-dv="desktop" aria-pressed="true">Desktop</button><button type="button" data-dv="mobile" aria-pressed="false">Mobile</button></div><span class="small muted" id="ps"></span></div>
        <div class="canvas-stage" id="stage"><iframe id="pv" title="Live preview of your website"></iframe></div></section>
      <aside class="editor-right" aria-label="Settings"><div class="panel" id="settings"></div></aside></div></div>`;
  let selected = tab === 'design' ? 'design' : tab === 'photos' ? 'photos' : (s.sectionByType('hero')?.id || 'design');
  let view = null;
  const setMobile = (p) => { if (!matchMedia('(max-width: 900px)').matches) return; $('#em').dataset.mobile = p; $$('[data-m]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.m === p))); };
  const preview = new LivePreview($('#pv'), { onSelect: (id) => { select(id); setMobile('settings'); } });
  const render = () => preview.render(s.state, { mode: 'editor', showBranding: !plan.entitlements.remove_branding });
  cleanup.push(s.onChange(render));
  render();
  const list = renderSectionList($('#sl'), s, { plan, getSelected: () => selected, onSelect: (id) => { select(id); setMobile('settings'); } });

  function select(id) {
    selected = id;
    view?.destroy?.();
    view = null;
    const box = $('#settings');
    $$('[data-pseudo]').forEach((b) => b.classList.toggle('selected', b.dataset.pseudo === id));
    if (id === 'design') { box.innerHTML = '<h2>Design</h2><div></div>'; renderDesign(box.lastElementChild, s, { plan, showTemplates: true, templates: TEMPLATES }); }
    else if (id === 'photos') { box.innerHTML = '<h2>Photos</h2><div></div>'; renderPhotos(box.lastElementChild, s, { plan }); }
    else { box.innerHTML = '<h2>Section settings</h2><div></div>'; view = renderSectionSettings(box.lastElementChild, s, id, { plan, extra: rsvpExtra }); }
    list.redraw();
  }
  $$('[data-pseudo]').forEach((b) => b.addEventListener('click', () => { select(b.dataset.pseudo); setMobile('settings'); }));

  function rsvpExtra(sec, box) {
    if (sec.type !== 'rsvp') return;
    const w = B.data().wedding;
    const limit = plan.entitlements.custom_questions;
    box.innerHTML = `<details class="list-item" open><summary>RSVP options</summary><div class="list-body">
      <label class="field"><span>RSVP deadline</span><input type="date" data-s="rsvp_deadline" value="${esc(w.rsvp_deadline || '')}"></label>
      <label class="field"><span>Who can RSVP?</span><select data-s="rsvp_mode"><option value="open" ${w.rsvp_mode === 'open' ? 'selected' : ''}>Anyone with the link</option><option value="invite_only" ${w.rsvp_mode === 'invite_only' ? 'selected' : ''}>Only guests with an invitation code</option></select></label>
      <label class="field"><span>Plus-ones</span><select data-s="rsvp_plus_ones"><option value="none" ${w.rsvp_plus_ones === 'none' ? 'selected' : ''}>No plus-ones</option><option value="invited_only" ${w.rsvp_plus_ones === 'invited_only' ? 'selected' : ''}>Only guests I allow</option><option value="everyone" ${w.rsvp_plus_ones === 'everyone' ? 'selected' : ''}>Everyone may bring a guest</option></select></label>
      <label class="switch"><input type="checkbox" data-s="rsvp_dietary" ${w.rsvp_dietary ? 'checked' : ''}> Ask about dietary requirements</label>
      <label class="switch"><input type="checkbox" data-s="rsvp_accessibility" ${w.rsvp_accessibility ? 'checked' : ''}> Ask about accessibility needs</label></div></details>
      <details class="list-item"><summary>Your own questions <span class="tiny muted">(${limit} on your plan)</span></summary><div class="list-body" data-q></div></details>`;
    const map = { rsvp_deadline: 'deadline', rsvp_mode: 'mode', rsvp_plus_ones: 'plus_ones', rsvp_dietary: 'dietary', rsvp_accessibility: 'accessibility' };
    $$('[data-s]', box).forEach((el) => el.addEventListener('change', () => {
      const v = el.type === 'checkbox' ? el.checked : (el.value || null);
      B.updateWedding({ [el.dataset.s]: v });
      s.state.rsvp = { ...s.state.rsvp, [map[el.dataset.s]]: v, open: B.rsvpConfig().open };
      s.emit({ source: 'rsvp' });
      toast('RSVP settings saved', 'success', 1800);
    }));
    const qbox = $('[data-q]', box);
    const qs = JSON.parse(JSON.stringify(B.data().questions));
    const drawQ = () => {
      qbox.innerHTML = `${qs.map((q, k) => `<div class="card-flat stack-sm" data-qi="${k}"><label class="field"><span>Question</span><input type="text" data-k="label" value="${esc(q.label)}" maxlength="200"></label>
        <div class="grid-2"><label class="field"><span>Answer type</span><select data-k="type">${[['text', 'Short answer'], ['textarea', 'Long answer'], ['select', 'Choose one'], ['checkbox', 'Yes / no tick box']].map(([v, l]) => `<option value="${v}" ${q.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label class="switch" style="align-self:end"><input type="checkbox" data-k="required" ${q.required ? 'checked' : ''}> Required</label></div>
        ${q.type === 'select' ? `<label class="field"><span>Options <span class="hint">comma separated</span></span><input type="text" data-k="options" value="${esc((q.options || []).join(', '))}"></label>` : ''}<button type="button" class="btn btn-ghost btn-sm" data-del style="justify-self:start">Remove question</button></div>`).join('')}
        <div class="row"><button type="button" class="btn btn-secondary btn-sm" data-add>＋ Add question</button><button type="button" class="btn btn-primary btn-sm" data-save>Save questions</button></div>`;
      $$('[data-qi]', qbox).forEach((card) => {
        const q = qs[Number(card.dataset.qi)];
        $$('[data-k]', card).forEach((el) => el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', () => {
          const k = el.dataset.k;
          q[k] = k === 'required' ? el.checked : k === 'options' ? el.value.split(',').map((x) => x.trim()).filter(Boolean) : el.value;
          if (k === 'type') drawQ();
        }));
        $('[data-del]', card).addEventListener('click', () => { qs.splice(Number(card.dataset.qi), 1); drawQ(); });
      });
      $('[data-add]', qbox).addEventListener('click', () => {
        if (qs.length >= limit) return upgradePrompt({ feature: 'custom_questions', feature_label: 'More custom RSVP questions', error: `Your plan includes ${limit} custom questions.` });
        qs.push({ id: B.uid().slice(0, 8), label: '', type: 'text', required: false, options: [] }); drawQ();
      });
      $('[data-save]', qbox).addEventListener('click', () => {
        const clean = qs.filter((q) => q.label.trim());
        B.data().questions = clean; B.persist();
        s.state.rsvp = { ...s.state.rsvp, questions: clean }; s.emit({ source: 'rsvp' });
        toast('Questions saved', 'success');
      });
    };
    drawQ();
  }

  const st = $('#st');
  cleanup.push(s.onStatus((x, det) => { st.dataset.state = x; st.textContent = statusText(x, det); $('#undo').disabled = !s.canUndo(); $('#redo').disabled = !s.canRedo(); }));
  cleanup.push(s.onChange(() => { $('#undo') && ($('#undo').disabled = !s.canUndo(), $('#redo').disabled = !s.canRedo()); }));
  $('#undo').addEventListener('click', () => s.undo());
  $('#redo').addEventListener('click', () => s.redo());
  const keys = (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.target.closest('input, textarea, select')) return;
    if (e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); }
    if (e.key.toLowerCase() === 'y') { e.preventDefault(); s.redo(); }
  };
  document.addEventListener('keydown', keys);
  cleanup.push(() => document.removeEventListener('keydown', keys));
  $$('[data-dv]').forEach((b) => b.addEventListener('click', () => { $$('[data-dv]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); $('#stage').classList.toggle('mobile', b.dataset.dv === 'mobile'); }));
  $$('[data-m]').forEach((b) => b.addEventListener('click', () => setMobile(b.dataset.m)));
  $$('[data-to]').forEach((b) => b.addEventListener('click', () => go(b.dataset.to)));
  const pubState = () => { const w = B.data().wedding; const el = $('#ps'); if (!el) return; el.textContent = w.status === 'published' ? (B.hasUnpublishedChanges() ? 'Live · unpublished changes' : 'Live · up to date') : 'Draft · not published'; $('#pub').textContent = w.status === 'published' ? 'Publish changes' : 'Publish'; };
  cleanup.push(B.onData(pubState));
  pubState();
  $('#pub').addEventListener('click', () => publishDialog(pubState));
  select(selected);
};

// ---------------------------------------------------------------- guest view of the website
VIEWS.site = async ({ invite } = {}) => {
  if (store) await store.flush();
  const d = B.data();
  const w = d.wedding;
  const pub = w.status === 'published' && d.published;
  const state = pub ? { ...d.published, wedding: { ...d.published.wedding, rsvp_deadline: w.rsvp_deadline }, rsvp: B.rsvpConfig() } : { ...B.draftState() };
  app.innerHTML = `<div style="display:flex;flex-direction:column;height:100dvh">
    <div class="editor-top" style="flex-wrap:wrap;height:auto;min-height:56px;padding-block:8px"><button class="btn btn-ghost btn-sm" type="button" data-to="dashboard">← Dashboard</button>
      <span class="small">${pub ? `<strong>Guest view</strong> of vowly.com/w/${esc(w.slug)}${invite ? ' · opened with a personal invitation link' : ''}` : '<strong>Preview</strong> · not published yet, so guests can’t see it'}</span><span class="spacer"></span>
      <div class="preview-toggle" role="group" aria-label="Preview size"><button type="button" data-dv="desktop" aria-pressed="true">Desktop</button><button type="button" data-dv="mobile" aria-pressed="false">Phone</button></div>
      ${pub ? '' : '<button class="btn btn-primary btn-sm" type="button" id="pub">Publish</button>'}</div>
    <div class="canvas-stage" id="stage" style="background:var(--paper-2);padding-top:12px"></div></div>`;
  const f = document.createElement('iframe');
  f.title = 'Your wedding website';
  let html = siteHtml(state, { mode: pub ? 'published' : 'preview', showBranding: !B.plan().entitlements.remove_branding });
  if (invite) html = html.replace('<script>window.fetch', () => `<script>window.__invite=${JSON.stringify(invite)};</script><script>window.fetch`);
  f.srcdoc = html;
  $('#stage').append(f);
  if (pub) B.bumpVisits();
  $$('[data-dv]').forEach((b) => b.addEventListener('click', () => { $$('[data-dv]').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); $('#stage').classList.toggle('mobile', b.dataset.dv === 'mobile'); }));
  $$('[data-to]').forEach((b) => b.addEventListener('click', () => go(b.dataset.to)));
  $('#pub')?.addEventListener('click', () => publishDialog(() => go('site')));
  const onRsvp = () => setTimeout(() => toast('RSVP received. You’ll find it on your Guests & RSVPs page.', 'success', 5000), 300);
  window.addEventListener('site-rsvp', onRsvp);
  cleanup.push(() => window.removeEventListener('site-rsvp', onRsvp));
};

// ---------------------------------------------------------------- guests
let gFilter = 'all', gQuery = '';
VIEWS.guests = () => {
  const d = B.data();
  const STATUS = { pending: ['Not replied', ''], confirmed: ['Attending', 'green'], declined: ['Declined', 'rose'] };
  const c = B.rsvpCounts();
  const rows = d.guests.filter((g) => {
    const st = B.rsvpStatus(g.id);
    if (gFilter === 'not_invited' ? g.invitation_status !== 'not_invited' : gFilter !== 'all' && st !== gFilter) return false;
    const q = gQuery.toLowerCase();
    return !q || `${g.first_name} ${g.last_name} ${g.email || ''} ${g.household}`.toLowerCase().includes(q);
  });
  const events = (d.sections.find((s) => s.type === 'details')?.content?.events || []);
  const evName = (id) => events.find((e) => e.id === id)?.name || id;
  const main = shell(`<div class="page container">
    <div class="page-head"><div><h1>Guests & RSVPs</h1><p>${c.guests} guests · ${c.confirmed} attending · ${c.declined} declined · ${c.pending} not replied</p></div>
      <div class="row"><button class="btn btn-secondary btn-sm" type="button" id="imp">Import from a spreadsheet</button><button class="btn btn-secondary btn-sm" type="button" id="exp">Copy list (CSV)</button><button class="btn btn-primary btn-sm" type="button" id="add">＋ Add guest</button></div></div>
    ${d.wedding.status !== 'published' ? '<p class="notice warn" style="margin-bottom:16px">Publish your website so guests can RSVP. You can then test it yourself with “Open as this guest”.</p>' : ''}
    <div class="tabs" role="tablist">${[['all', 'All', c.guests], ['confirmed', 'Attending', c.confirmed], ['declined', 'Declined', c.declined], ['pending', 'Not replied', c.pending], ['not_invited', 'Not invited yet', d.guests.filter((g) => g.invitation_status === 'not_invited').length]].map(([k, l, n]) => `<button type="button" role="tab" data-f="${k}" aria-selected="${gFilter === k}">${l} <span class="badge">${n}</span></button>`).join('')}</div>
    <label style="display:block;max-width:360px;margin-bottom:12px"><span class="sr-only">Search guests</span><input type="search" id="q" placeholder="Search by name, email or household" value="${esc(gQuery)}"></label>
    ${d.guests.length ? `<div class="table-wrap"><table><thead><tr><th>Guest</th><th>Contact</th><th>Invitation</th><th>RSVP</th><th>Details</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows.map((g) => {
      const st = B.rsvpStatus(g.id); const r = B.latestRsvp(g.id);
      return `<tr><td><strong>${esc(g.first_name)} ${esc(g.last_name)}</strong>${g.household ? `<div class="tiny muted">${esc(g.household)}</div>` : ''}${g.plus_one_allowed ? '<div class="tiny muted">+1 allowed</div>' : ''}</td>
        <td class="small">${g.email ? esc(g.email) : '<span class="muted">No email</span>'}${g.phone ? `<div class="muted">${esc(g.phone)}</div>` : ''}</td>
        <td>${g.invitation_status === 'invited' ? '<span class="badge green">Invited</span>' : '<span class="badge">Not invited</span>'}</td>
        <td><span class="badge ${STATUS[st][1]} dot">${STATUS[st][0]}</span></td>
        <td class="small">${r && r.attending === 'yes' ? `${r.events.map((e) => esc(evName(e))).join(', ') || '—'}${r.plus_one_name ? `<div>+ ${esc(r.plus_one_name)}</div>` : ''}${r.dietary ? `<div class="muted">Diet: ${esc(r.dietary)}</div>` : ''}${Object.values(r.answers || {}).filter((a) => a.value).map((a) => `<div class="muted">${esc(a.label)}: ${esc(a.value)}</div>`).join('')}` : '<span class="muted">—</span>'}</td>
        <td><div class="row" style="gap:2px;flex-wrap:nowrap"><button class="btn btn-ghost btn-sm" type="button" data-inv="${g.id}">Invite</button><button class="btn btn-ghost btn-icon" type="button" data-edit="${g.id}" aria-label="Edit ${esc(g.first_name)}">✎</button><button class="btn btn-ghost btn-icon" type="button" data-del="${g.id}" aria-label="Delete ${esc(g.first_name)}">🗑</button></div></td></tr>`;
    }).join('')}</tbody></table>${rows.length ? '' : '<div class="empty"><p>No guests match this filter.</p></div>'}</div>`
      : '<div class="card empty"><div class="empty-icon" aria-hidden="true">☺</div><h3>Your guest list is empty</h3><p>Add guests one by one or import a spreadsheet. Guests who RSVP on your website are added automatically.</p></div>'}</div>`, { appNav: true });
  $$('[data-f]', main).forEach((b) => b.addEventListener('click', () => { gFilter = b.dataset.f; go('guests'); }));
  $('#q', main).addEventListener('input', (e) => { gQuery = e.target.value; const pos = e.target.selectionStart; VIEWS.guests(); const q = $('#q'); q.focus(); q.setSelectionRange(pos, pos); });
  $('#add', main).addEventListener('click', () => editGuest());
  $$('[data-edit]', main).forEach((b) => b.addEventListener('click', () => editGuest(d.guests.find((g) => g.id === b.dataset.edit))));
  $$('[data-inv]', main).forEach((b) => b.addEventListener('click', () => inviteGuest(d.guests.find((g) => g.id === b.dataset.inv))));
  $$('[data-del]', main).forEach((b) => b.addEventListener('click', async () => {
    const g = d.guests.find((x) => x.id === b.dataset.del);
    if (!await confirmDialog(`Remove ${g.first_name} ${g.last_name} and their RSVP?`, { title: 'Delete guest?', confirmLabel: 'Delete', danger: true })) return;
    B.deleteGuest(g.id); go('guests');
  }));
  $('#imp', main).addEventListener('click', importGuests);
  $('#exp', main).addEventListener('click', () => {
    const lines = [['First name', 'Last name', 'Email', 'Phone', 'Household', 'Invitation', 'RSVP', 'Plus-one', 'Dietary', 'Invitation code']]
      .concat(d.guests.map((g) => { const r = B.latestRsvp(g.id); return [g.first_name, g.last_name, g.email || '', g.phone, g.household, g.invitation_status, B.rsvpStatus(g.id), r?.plus_one_name || '', r?.dietary || '', g.invite_code]; }));
    copyText(lines.map((l) => l.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(',')).join('\n'));
  });
};

function editGuest(g = null) {
  const form = document.createElement('form');
  form.className = 'stack'; form.noValidate = true;
  form.innerHTML = `<div class="grid-2"><label class="field"><span>First name</span><input type="text" name="first_name" maxlength="80" value="${esc(g?.first_name || '')}"></label><label class="field"><span>Last name</span><input type="text" name="last_name" maxlength="80" value="${esc(g?.last_name || '')}"></label></div>
    <div class="grid-2"><label class="field"><span>Email</span><input type="email" name="email" maxlength="200" value="${esc(g?.email || '')}"></label><label class="field"><span>Phone / WhatsApp</span><input type="tel" name="phone" maxlength="40" value="${esc(g?.phone || '')}"></label></div>
    <label class="field"><span>Household or group</span><input type="text" name="household" maxlength="120" value="${esc(g?.household || '')}" placeholder="e.g. The Okafor family"></label>
    <label class="switch"><input type="checkbox" name="plus_one_allowed" ${g?.plus_one_allowed ? 'checked' : ''}> Can bring a plus-one</label>
    <p class="form-error" role="alert" hidden></p>`;
  modal({ title: g ? 'Edit guest' : 'Add a guest', body: form, actions: [{ label: 'Cancel' }, { label: g ? 'Save' : 'Add guest', className: 'btn-primary', onClick: () => {
    const fd = new FormData(form);
    try { B.addGuest({ ...Object.fromEntries(fd), plus_one_allowed: fd.has('plus_one_allowed'), id: g?.id }); toast(g ? 'Guest updated' : 'Guest added', 'success'); go('guests'); return true; }
    catch (err) { const box = $('.form-error', form); box.textContent = err.message; box.hidden = false; setFieldErrors(form, err.data?.fields); return false; }
  } }] });
}

function inviteGuest(g) {
  const w = B.data().wedding;
  const link = `https://vowly.com/w/${w.slug}?invite=${g.invite_code}`;
  const msg = `Hi ${g.first_name}! You're invited to ${coupleNames(w)}'s wedding. Everything you need, and your personal RSVP, is here: ${link}`;
  const body = document.createElement('div');
  body.className = 'stack';
  body.innerHTML = `<p>Each guest gets a personal link that fills in their name on the RSVP form. On the live platform you'd send it by email or WhatsApp.</p>
    <div class="url-box"><span class="small" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(link)}</span></div>
    <p class="small muted">Invitation code: <strong>${esc(g.invite_code)}</strong></p>
    <div class="row"><button class="btn btn-secondary btn-sm" type="button" data-copy>Copy invitation message</button><button class="btn btn-primary btn-sm" type="button" data-open ${w.status === 'published' ? '' : 'disabled'}>Open as this guest</button></div>
    ${w.status === 'published' ? '' : '<p class="notice warn small">Publish your website first to open it as a guest.</p>'}`;
  const dlg = modal({ title: `Invite ${g.first_name}`, body });
  $('[data-copy]', body).addEventListener('click', () => { copyText(msg); B.markInvited(g.id); });
  $('[data-open]', body).addEventListener('click', () => { B.markInvited(g.id); dlg.close(); go('site', { invite: g.invite_code }); });
}

function importGuests() {
  const body = document.createElement('div');
  body.className = 'stack';
  body.innerHTML = `<p>Paste rows from Excel or Google Sheets (including the header row), or choose a CSV file. Columns such as <em>name, email, phone, household, plus_one</em> are recognised.</p>
    <label class="field"><span>CSV file</span><input type="file" accept=".csv,text/csv" data-file></label>
    <label class="field"><span>Or paste here</span><textarea rows="6" data-paste placeholder="name,email&#10;Grace Okafor,grace@example.com&#10;Tunde Bello,tunde@example.com"></textarea></label><div data-res></div>`;
  modal({ title: 'Import guests', body, wide: true, actions: [{ label: 'Close' }, { label: 'Import', className: 'btn-primary', onClick: async () => {
    const file = $('[data-file]', body).files[0];
    const text = (file ? await file.text() : $('[data-paste]', body).value).replace(/\t/g, ',');
    const rows = parseCsv(text);
    if (rows.length < 2) { toast('Add a header row and at least one guest.', 'error'); return false; }
    const h = rows[0].map((x) => x.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'));
    const col = (...n) => h.findIndex((x) => n.includes(x));
    const ix = { first: col('first_name', 'first', 'firstname'), last: col('last_name', 'last', 'surname'), name: col('name', 'full_name', 'guest'), email: col('email', 'email_address'), phone: col('phone', 'mobile', 'whatsapp'), house: col('household', 'group', 'family'), plus: col('plus_one', 'plusone', 'plus_one_allowed') };
    let added = 0; const skipped = [];
    rows.slice(1).forEach((r, k) => {
      const get = (n) => (n >= 0 ? String(r[n] || '').trim() : '');
      let first = get(ix.first), last = get(ix.last);
      if (!first && ix.name >= 0) { const p = get(ix.name).split(/\s+/); first = p.shift() || ''; last = last || p.join(' '); }
      try { B.addGuest({ first_name: first, last_name: last, email: get(ix.email), phone: get(ix.phone), household: get(ix.house), plus_one_allowed: /^(y|yes|true|1)$/i.test(get(ix.plus)) }); added++; } catch (err) { skipped.push(`Row ${k + 2}: ${err.message}`); }
    });
    $('[data-res]', body).innerHTML = `<p class="notice">Added ${added} of ${rows.length - 1} rows.</p>${skipped.length ? `<ul class="small">${skipped.slice(0, 30).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
    if (route === 'guests') VIEWS.guests();
    return false;
  } }] });
}

// ---------------------------------------------------------------- budget & settings
VIEWS.budget = () => {
  const main = shell('<div class="page container" id="bg"></div>', { appNav: true });
  mountBudget($('#bg', main), {});
};

VIEWS.settings = () => {
  const w = B.data().wedding;
  const main = shell(`<div class="page container"><div class="page-head"><div><h1>Settings</h1><p>${esc(coupleNames(w))}</p></div></div>
    <div class="stack narrow" style="margin:0">
      <form class="card stack" id="s1" novalidate><h2 style="font-size:1.3rem;margin:0">Web address</h2><label class="field"><span>Address</span><div class="row" style="flex-wrap:nowrap;gap:6px"><span class="small muted">vowly.com/w/</span><input type="text" name="slug" value="${esc(w.slug)}" id="st-slug"></div></label><button class="btn btn-primary btn-sm" type="submit" style="justify-self:start">Save</button></form>
      <form class="card stack" id="s2"><h2 style="font-size:1.3rem;margin:0">Privacy</h2>
        <label class="check"><input type="radio" name="visibility" value="public" ${w.visibility === 'public' ? 'checked' : ''}> <span><strong>Anyone with the link</strong></span></label>
        <label class="check"><input type="radio" name="visibility" value="private" ${w.visibility === 'private' ? 'checked' : ''}> <span><strong>Only us</strong> <span class="small muted">— hidden from guests while you work on it</span></span></label>
        <label class="check"><input type="radio" name="visibility" value="password" disabled> <span><strong>Guests with a password</strong> <span class="premium-tag">Premium</span></span></label>
        <button class="btn btn-primary btn-sm" type="submit" style="justify-self:start">Save</button></form>
      <div class="card stack"><h2 style="font-size:1.3rem;margin:0">Website</h2><div class="row">${w.status === 'published' ? '<button class="btn btn-secondary btn-sm" type="button" id="unpub">Unpublish website</button>' : '<span class="small muted">Not published yet.</span>'}</div></div>
      <div class="card stack" style="border-color:#f1c9c5"><h2 style="font-size:1.3rem;margin:0;color:var(--danger)">Start over</h2><p class="small" style="margin:0">Deletes your test account and everything in it from this browser.</p><button class="btn btn-danger btn-sm" type="button" id="rst" style="justify-self:start">Delete test data</button></div>
    </div></div>`, { appNav: true });
  $('#s1', main).addEventListener('submit', (e) => {
    e.preventDefault();
    const v = e.target.slug.value.trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/.test(v)) return setFieldErrors(e.target, { slug: 'Use 3–50 lowercase letters, numbers or hyphens.' });
    B.updateWedding({ slug: v }); toast('Address saved', 'success');
  });
  $('#s2', main).addEventListener('submit', (e) => { e.preventDefault(); B.updateWedding({ visibility: e.target.visibility.value }); toast('Privacy saved', 'success'); });
  $('#unpub', main)?.addEventListener('click', async () => { if (await confirmDialog('Guests will no longer see your website until you publish again. Nothing is deleted.', { title: 'Unpublish?', confirmLabel: 'Unpublish' })) { B.unpublish(); go('settings'); } });
  $('#rst', main).addEventListener('click', resetFlow);
};

// ---------------------------------------------------------------- start
const start = savedRoute();
go(ROUTES.includes(start) ? start : (B.data().wedding ? 'dashboard' : 'home')).catch((err) => { console.error(err); showError(err instanceof ApiError ? err : new Error('Something went wrong loading the app.')); });
