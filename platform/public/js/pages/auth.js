import { api, $, esc, publicChrome, setFieldErrors, param, ApiError } from '../api.js';

await publicChrome();
const page = document.body.dataset.page;
const form = $('#form');
const errorBox = form && $('.form-error', form);

function safeNext(fallback) {
  const n = param('next');
  return n && n.startsWith('/') && !n.startsWith('//') ? n : fallback;
}

function fail(err) {
  errorBox.textContent = err.message;
  errorBox.hidden = false;
  if (err instanceof ApiError) setFieldErrors(form, err.data.fields);
}

function busy(on, label) {
  const b = $('button[type=submit]', form);
  b.disabled = on;
  if (label) b.textContent = label;
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.hidden = true;
  setFieldErrors(form, {});
  const data = Object.fromEntries(new FormData(form));
  const original = $('button[type=submit]', form).textContent;
  busy(true, 'Please wait…');
  try {
    if (page === 'login') {
      const r = await api('POST', '/api/auth/login', data);
      location.href = safeNext(r.next);
    } else if (page === 'signup') {
      const r = await api('POST', '/api/auth/signup', { ...data, accept_terms: !!data.accept_terms, marketing_opt_in: !!data.marketing_opt_in, ref: param('ref') || localStorageGet('ref') });
      if (r.dev_verification_link) sessionStorage.setItem('dev_verification_link', r.dev_verification_link);
      const tpl = param('template');
      location.href = tpl ? `/app/wizard?template=${encodeURIComponent(tpl)}` : r.next;
    } else if (page === 'forgot') {
      const r = await api('POST', '/api/auth/forgot', data);
      const n = $('.notice', form);
      n.innerHTML = esc(r.message) + (r.dev_reset_link ? `<br><span class="tiny">Development mode (no email provider): <a href="${esc(r.dev_reset_link)}">open the reset link</a></span>` : '');
      n.hidden = false;
      busy(false, original);
    } else if (page === 'reset') {
      const r = await api('POST', '/api/auth/reset', { ...data, token: param('token') });
      location.href = r.next;
    }
  } catch (err) {
    fail(err);
    busy(false, original);
  }
});

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
if (param('ref')) { try { localStorage.setItem('ref', param('ref')); } catch { /* storage unavailable */ } }

if (page === 'reset' && !param('token')) fail(new Error('This reset link is incomplete. Please use the link from your email.'));

if (page === 'verify') {
  const box = $('#verify-status');
  try {
    await api('POST', '/api/auth/verify', { token: param('token') });
    $('h1').textContent = 'Email confirmed';
    box.innerHTML = '<p class="notice">Thank you — your email address is confirmed. You can now publish your website.</p><a class="btn btn-primary" href="/app">Go to my dashboard</a>';
  } catch (err) {
    $('h1').textContent = 'We could not confirm your email';
    box.innerHTML = `<p class="form-error">${esc(err.message)}</p><a class="btn btn-secondary" href="/app">Go to my dashboard</a>`;
  }
}
