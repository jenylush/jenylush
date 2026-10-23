import { api, $, esc, publicChrome, setFieldErrors, param, ApiError } from '../api.js';

await publicChrome();
const page = document.body.dataset.page;
const form = $('#form');
const errorBox = form && $('.form-error', form);

function safeNext(fallback) {
  // Only same-site paths: blocks "//evil.com" and "/\\evil.com" open redirects.
  const n = param('next');
  return n && /^\/(?![\/\\])/.test(n) && !/[\\\s]/.test(n) ? n : fallback;
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
  if (form.dataset.step === 'mfa') return; // handled by askForCode
  errorBox.hidden = true;
  setFieldErrors(form, {});
  const data = Object.fromEntries(new FormData(form));
  const original = $('button[type=submit]', form).textContent;
  busy(true, 'Please wait…');
  try {
    if (page === 'login') {
      const r = await api('POST', '/api/auth/login', data);
      if (r.mfa_required) { busy(false, original); return askForCode(r.mfa_token); }
      location.href = safeNext(r.next);
    } else if (page === 'signup') {
      const r = await api('POST', '/api/auth/signup', { ...data, website: data.website || '', accept_terms: !!data.accept_terms, marketing_opt_in: !!data.marketing_opt_in, ref: param('ref') || localStorageGet('ref') });
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

// Second step for accounts with two-step verification.
function askForCode(mfaToken) {
  form.dataset.step = 'mfa';
  $('h1').textContent = 'Enter your verification code';
  form.innerHTML = `<p class="muted">Open your authenticator app and enter the 6-digit code for this account. Lost your phone? Enter one of your recovery codes instead.</p>
    <label class="field"><span>Code</span><input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" required maxlength="14" autofocus></label>
    <p class="form-error" role="alert" hidden></p>
    <button class="btn btn-primary btn-lg" type="submit">Verify and log in</button>
    <p class="small"><a href="/login">Start again</a></p>`;
  const err = $('.form-error', form);
  form.onsubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    try {
      const r = await api('POST', '/api/auth/login/mfa', { mfa_token: mfaToken, code: form.elements.code.value });
      location.href = safeNext(r.next);
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
      if (ex.data?.code === 'mfa_expired') setTimeout(() => { location.href = '/login'; }, 2500);
    }
  };
  form.elements.code.focus();
}

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
if (param('ref')) { try { localStorage.setItem('ref', param('ref')); } catch { /* storage unavailable */ } }

if (page === 'login' && param('reset')) { const n = document.createElement('p'); n.className = 'notice'; n.textContent = 'Password changed. Log in with your new password and verification code.'; form.prepend(n); }
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
