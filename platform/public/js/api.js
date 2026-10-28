// Shared browser helpers: API calls, toasts, dialogs, navigation chrome.

export class ApiError extends Error {
  constructor(status, data) { super(data?.error || `Request failed (${status})`); this.status = status; this.data = data || {}; }
}

export async function api(method, url, body, { signal } = {}) {
  const opts = { method, headers: { 'x-requested-with': 'fetch' }, credentials: 'same-origin', signal };
  if (body instanceof FormData) opts.body = body;
  else if (typeof body === 'string') { opts.body = body; opts.headers['content-type'] = 'text/plain'; }
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['content-type'] = 'application/json'; }
  let res;
  try { res = await fetch(url, opts); } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, { error: 'We could not reach the server. Check your connection and try again.' });
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (res.status === 401 && data?.code === 'auth_required' && !url.startsWith('/api/auth/')) {
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

// Upload with progress (fetch has no upload progress events yet).
export function upload(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('x-requested-with', 'fetch');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { data = { error: 'Upload failed.' }; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data); else reject(new ApiError(xhr.status, data));
    };
    xhr.onerror = () => reject(new ApiError(0, { error: 'Upload failed — check your connection.' }));
    xhr.send(formData);
  });
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function toast(message, type = 'info', ms = 4200) {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.append(box); }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = message;
  box.append(t);
  while (box.children.length > 3) box.firstElementChild.remove(); // keep the stack short
  setTimeout(() => t.remove(), ms);
}

export function showError(err, fallback = 'Something went wrong. Please try again.') {
  if (err?.name === 'AbortError') return;
  if (err instanceof ApiError && err.data?.code === 'plan_limit') return upgradePrompt(err.data);
  toast(err?.message || fallback, 'error', 6000);
}

export function modal({ title, body, actions = [], wide = false, onClose }) {
  const d = document.createElement('dialog');
  d.className = `modal${wide ? ' wide' : ''}`;
  d.innerHTML = `<div class="modal-head"><h2></h2><button type="button" class="btn btn-ghost btn-icon" data-close aria-label="Close">✕</button></div><div class="modal-body"></div>${actions.length ? '<div class="modal-foot"></div>' : ''}`;
  $('h2', d).textContent = title;
  const b = $('.modal-body', d);
  if (typeof body === 'string') b.innerHTML = body; else if (body) b.append(body);
  for (const a of actions) {
    const btn = document.createElement(a.href ? 'a' : 'button');
    btn.className = `btn ${a.className || 'btn-secondary'}`;
    btn.textContent = a.label;
    if (a.href) btn.href = a.href; else btn.type = 'button';
    btn.addEventListener('click', async (e) => { if (a.onClick) { const keep = await a.onClick(e, d); if (keep === false) return; } if (!a.href) d.close(); });
    $('.modal-foot', d).append(btn);
  }
  $('[data-close]', d).addEventListener('click', () => d.close());
  d.addEventListener('close', () => { onClose?.(); d.remove(); });
  document.body.append(d);
  d.showModal();
  return d;
}

export function confirmDialog(message, { title = 'Are you sure?', confirmLabel = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    modal({
      title, body: `<p>${esc(message)}</p>`,
      actions: [
        { label: 'Cancel', onClick: () => { answered = true; resolve(false); } },
        { label: confirmLabel, className: danger ? 'btn-danger' : 'btn-primary', onClick: () => { answered = true; resolve(true); } }
      ],
      onClose: () => { if (!answered) resolve(false); }
    });
  });
}

export function upgradePrompt(data = {}) {
  track('paid_upgrade_viewed', { feature: data.feature || 'unknown' });
  modal({
    title: data.feature_label ? `${data.feature_label} is a Premium feature` : 'Upgrade to Premium',
    body: `<div class="stack"><p>${esc(data.error || 'This feature is part of Premium.')}</p><p class="muted small">Nothing you have already created is changed or deleted. Premium is launching soon — join the waitlist and we will tell you as soon as it is available.</p></div>`,
    actions: [{ label: 'Not now' }, { label: 'See Premium', className: 'btn-primary', href: `/app/upgrade?feature=${encodeURIComponent(data.feature || '')}` }]
  });
}

export function setFieldErrors(form, fields = {}) {
  $$('[aria-invalid]', form).forEach((el) => el.removeAttribute('aria-invalid'));
  $$('.field-error', form).forEach((el) => el.remove());
  let first = null;
  for (const [name, msg] of Object.entries(fields || {})) {
    const input = form.elements[name];
    const el = input instanceof RadioNodeList ? input[0] : input;
    if (!el) continue;
    el.setAttribute('aria-invalid', 'true');
    const err = document.createElement('span');
    err.className = 'field-error';
    err.id = `${name}-error`;
    err.textContent = msg;
    el.setAttribute('aria-describedby', err.id);
    (el.closest('.field') || el.parentElement).append(err);
    first ??= el;
  }
  first?.focus();
}

export function track(name, props = {}, weddingId = null) {
  api('POST', '/api/events', { name, props, wedding_id: weddingId }).catch(() => {});
}

let mePromise;
export function getMe() {
  mePromise ??= api('GET', '/api/auth/me').then((r) => r.user).catch(() => null);
  return mePromise;
}

let configPromise;
export function getConfig() {
  configPromise ??= api('GET', '/api/config').catch(() => ({ platform_name: 'Vowly' }));
  return configPromise;
}

export function formatDate(dateStr, opts = {}) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: opts.weekday === false ? undefined : 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function relativeTime(iso) {
  if (!iso) return '';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (Math.abs(s) < 60) return rtf.format(-s, 'second');
  if (Math.abs(s) < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (Math.abs(s) < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  return rtf.format(-Math.round(s / 86400), 'day');
}

export function param(name) {
  return new URLSearchParams(location.search).get(name);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard', 'success'); return true; } catch {
    prompt('Copy this link:', text); return false;
  }
}

const LOGO = (name) => `<a class="logo" href="/"><span class="logo-mark" aria-hidden="true"></span>${esc(name)}</a>`;

// Header for marketing and auth pages.
export async function publicChrome() {
  const [config, me] = await Promise.all([getConfig(), getMe()]);
  document.title = document.title.replace('{platform}', config.platform_name);
  $$('[data-platform-name]').forEach((el) => { el.textContent = config.platform_name; });
  const header = $('#topbar');
  if (header) {
    header.className = 'topbar';
    header.innerHTML = `<div class="container">${LOGO(config.platform_name)}
      <button class="btn btn-ghost btn-icon menu-toggle" type="button" aria-expanded="false" aria-controls="public-nav" aria-label="Menu">☰</button>
      <nav class="topnav" id="public-nav" aria-label="Main"><a href="/templates">Templates</a><a href="/#how">How it works</a><a href="/#pricing">Pricing</a><a href="/#faq">FAQ</a></nav>
      <div class="right">${me ? '<a class="btn btn-primary btn-sm" href="/app">My dashboard</a>' : '<a class="btn btn-ghost btn-sm hide-sm" href="/login">Log in</a><a class="btn btn-primary btn-sm" href="/signup">Get started free</a>'}</div></div>`;
    wireMenu(header);
    markCurrent(header);
  }
  if (config.announcement) $('body').insertAdjacentHTML('afterbegin', `<div class="announcement">${esc(config.announcement)}</div>`);
  return { config, me };
}

// Header for signed-in app pages.
export async function appChrome({ weddingId } = {}) {
  const [config, me] = await Promise.all([getConfig(), getMe()]);
  if (!me) { location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`; return {}; }
  const q = weddingId ? `?id=${encodeURIComponent(weddingId)}` : '';
  const header = $('#topbar');
  header.className = 'topbar';
  header.innerHTML = `<div class="container">${LOGO(config.platform_name)}
    <button class="btn btn-ghost btn-icon menu-toggle" type="button" aria-expanded="false" aria-controls="app-nav" aria-label="Menu">☰</button>
    <nav class="topnav" id="app-nav" aria-label="Main">
      <a href="/app${q}">Dashboard</a><a href="/app/editor${q}">Website</a><a href="/app/guests${q}">Guests & RSVPs</a><a href="/app/budget${q}">Budget & gifts</a><a href="/app/emails${q}">Emails</a><a href="/app/settings${q}">Settings</a>${me.role === 'admin' ? '<a href="/app/admin">Admin</a>' : ''}
    </nav>
    <div class="right">
      ${me.plan.id === 'free' ? `<a class="btn btn-secondary btn-sm hide-sm" href="/app/upgrade"><span class="premium-tag">Premium</span></a>` : `<span class="badge gold hide-sm">${esc(me.plan.name)}</span>`}
      <div class="user-menu"><button type="button" aria-haspopup="true" aria-expanded="false"><span class="avatar" aria-hidden="true">${esc((me.name || me.email).slice(0, 1).toUpperCase())}</span><span class="hide-sm">${esc(me.name || me.email)}</span></button>
        <div class="dropdown" hidden><div class="tiny muted" style="padding:8px 12px">${esc(me.email)}</div><a href="/app/settings${q}#account">Account settings</a><a href="/app/upgrade">Plans</a><hr><button type="button" data-logout>Log out</button></div></div>
    </div></div>`;
  wireMenu(header);
  markCurrent(header);
  const um = $('.user-menu', header);
  const dd = $('.dropdown', um);
  $('button', um).addEventListener('click', (e) => { e.stopPropagation(); dd.hidden = !dd.hidden; $('button', um).setAttribute('aria-expanded', String(!dd.hidden)); });
  document.addEventListener('click', (e) => { if (!um.contains(e.target)) dd.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') dd.hidden = true; });
  $('[data-logout]', um).addEventListener('click', async () => { await api('POST', '/api/auth/logout'); location.href = '/'; });
  if (config.announcement) $('body').insertAdjacentHTML('afterbegin', `<div class="announcement">${esc(config.announcement)}</div>`);
  return { config, me };
}

function wireMenu(header) {
  const t = $('.menu-toggle', header);
  t?.addEventListener('click', () => { header.classList.toggle('open'); t.setAttribute('aria-expanded', String(header.classList.contains('open'))); });
}

function markCurrent(header) {
  $$('.topnav a', header).forEach((a) => { if (new URL(a.href).pathname === location.pathname && !a.hash) a.setAttribute('aria-current', 'page'); });
}

// Resolve which wedding an app page is about: ?id=… or the user's first wedding.
export async function currentWedding({ redirectIfNone = true } = {}) {
  const id = param('id');
  if (id) return api('GET', `/api/weddings/${encodeURIComponent(id)}`);
  const { weddings } = await api('GET', '/api/weddings');
  if (!weddings.length) { if (redirectIfNone) location.href = '/app/wizard'; return null; }
  return api('GET', `/api/weddings/${weddings[0].wedding.id}`);
}

export function publicFooter(platformName, supportEmail = "hello@example.com") {
  const year = new Date().getFullYear();
  return `<footer class="site-footer-app"><div class="container"><div class="footer-cols">
    <div><a class="logo" href="/"><span class="logo-mark" aria-hidden="true"></span>${esc(platformName)}</a><p class="muted small" style="margin-top:12px;max-width:320px">Beautiful wedding websites with RSVPs and guest emails — no design or coding skills needed.</p>
      <div class="social" aria-label="Social media"><a href="https://instagram.com" rel="noopener" aria-label="Instagram">IG</a><a href="https://pinterest.com" rel="noopener" aria-label="Pinterest">P</a><a href="https://tiktok.com" rel="noopener" aria-label="TikTok">TT</a></div></div>
    <div><h4>Product</h4><ul><li><a href="/templates">Templates</a></li><li><a href="/#pricing">Pricing</a></li><li><a href="/#faq">FAQ</a></li></ul></div>
    <div><h4>Company</h4><ul><li><a href="mailto:${esc(supportEmail)}">Contact us</a></li><li><a href="/signup">Create a website</a></li></ul></div>
    <div><h4>Legal</h4><ul><li><a href="/terms">Terms of service</a></li><li><a href="/privacy">Privacy policy</a></li></ul></div>
  </div><p class="tiny muted" style="margin-top:32px">© ${year} ${esc(platformName)}. Made for couples everywhere.</p></div></footer>`;
}
