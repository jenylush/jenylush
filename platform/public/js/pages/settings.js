import { api, $, $$, esc, appChrome, currentWedding, toast, showError, setFieldErrors, confirmDialog, getConfig, modal } from '../api.js';

const summaryInit = await currentWedding();
let summary = summaryInit;
const wid = summary.wedding.id;
const { me } = await appChrome({ weddingId: wid });
const config = await getConfig();
document.title = `Settings — ${summary.wedding.names}`;
let tab = location.hash === '#account' ? 'account' : 'website';

function premium(on) { return on ? '' : ' <span class="premium-tag">Premium</span>'; }

function render() {
  const w = summary.wedding;
  const ent = summary.plan.entitlements;
  $('#main').innerHTML = `<div class="page-head"><div><h1>Settings</h1><p>${esc(w.names)}</p></div></div>
    <div class="tabs" role="tablist">${[['website', 'Website'], ['rsvp', 'RSVP'], ['people', 'Collaborators'], ['account', 'Account & data']].map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`).join('')}</div>
    <div id="tab"></div>`;
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; history.replaceState(null, '', `#${tab}`); render(); }));
  const box = $('#tab');
  if (tab === 'website') {
    const owner = summary.permissions.owner;
    box.innerHTML = `<div class="stack narrow" style="margin:0">
      <form class="card stack" id="f-address" novalidate><h2 style="font-size:1.3rem;margin:0">Web address</h2>
        <label class="field"><span>Address</span><input type="text" name="slug" value="${esc(w.slug)}" maxlength="50" autocapitalize="none" spellcheck="false"><span class="hint">Your website: <a href="${esc(summary.urls.primary)}" target="_blank" rel="noopener">${esc(summary.urls.primary)}</a>. Changing it breaks links you've already shared.</span></label>
        <button class="btn btn-primary btn-sm" type="submit" style="justify-self:start">Save address</button></form>

      <form class="card stack" id="f-privacy" novalidate><h2 style="font-size:1.3rem;margin:0">Privacy</h2>
        <fieldset class="stack-sm"><legend class="label">Who can see your website?</legend>
          <label class="check"><input type="radio" name="visibility" value="public" ${w.visibility === 'public' ? 'checked' : ''}> <span><strong>Anyone with the link</strong><br><span class="small muted">Best for most weddings.</span></span></label>
          <label class="check"><input type="radio" name="visibility" value="password" ${w.visibility === 'password' ? 'checked' : ''} ${ent.password_protection || w.visibility === 'password' ? '' : 'disabled'}> <span><strong>Guests with a password</strong>${premium(ent.password_protection)}<br><span class="small muted">Guests enter a password you share with them.</span></span></label>
          <label class="check"><input type="radio" name="visibility" value="private" ${w.visibility === 'private' ? 'checked' : ''}> <span><strong>Only us</strong><br><span class="small muted">Hidden from guests — useful while you're still working on it.</span></span></label>
        </fieldset>
        <label class="field" data-pw ${w.visibility === 'password' ? '' : 'hidden'}><span>Website password ${w.has_password ? '<span class="hint">Leave blank to keep the current password</span>' : ''}</span><input type="text" name="site_password" maxlength="100" autocomplete="off"></label>
        <label class="switch"><input type="checkbox" name="search_indexing" ${w.search_indexing ? 'checked' : ''}> Let search engines (like Google) list our website</label>
        <span class="hint">Off by default. Only applies when your website is visible to anyone with the link.</span>
        <button class="btn btn-primary btn-sm" type="submit" style="justify-self:start">Save privacy settings</button></form>

      <form class="card stack" id="f-domain" novalidate><h2 style="font-size:1.3rem;margin:0">Custom domain${premium(ent.custom_domain)}</h2>
        <p class="small muted" style="margin:0">Use a domain you own, like <em>ourwedding.com</em>.</p>
        <label class="field"><span>Domain</span><input type="text" name="custom_domain" value="${esc(w.custom_domain || '')}" placeholder="ourwedding.com" ${ent.custom_domain ? '' : 'disabled'}></label>
        ${w.custom_domain ? `<div class="notice ${w.custom_domain_verified ? '' : 'warn'} small">${w.custom_domain_verified ? `Connected — your website is served at https://${esc(w.custom_domain)}.` : `Pending: point a CNAME record for <strong>${esc(w.custom_domain)}</strong> to <strong>${esc(config.site_base_domain || new URL(config.base_url).host)}</strong>. Our team activates the domain and HTTPS certificate once DNS is in place.`}</div>` : ''}
        ${ent.custom_domain ? '<button class="btn btn-primary btn-sm" type="submit" style="justify-self:start">Save domain</button>' : '<a class="btn btn-secondary btn-sm" href="/app/upgrade?feature=custom_domain" style="justify-self:start">Learn about Premium</a>'}</form>

      ${owner ? `<div class="card stack" style="border-color:#f1c9c5"><h2 style="font-size:1.3rem;margin:0;color:var(--danger)">Delete this website</h2>
        <p class="small">Permanently deletes the website, photos, guest list and RSVPs. This cannot be undone. Export your guest list first if you need it.</p>
        <label class="field"><span>Type <strong>${esc(w.slug)}</strong> to confirm</span><input type="text" id="del-confirm" autocomplete="off"></label>
        <button class="btn btn-danger btn-sm" type="button" id="del-site" style="justify-self:start">Delete website permanently</button></div>` : ''}
    </div>`;
    $('#f-address').addEventListener('submit', (e) => save(e, { slug: e.target.slug.value.trim().toLowerCase() }, 'Address saved'));
    $$('#f-privacy [name=visibility]').forEach((r) => r.addEventListener('change', () => { $('[data-pw]').hidden = r.value !== 'password' || !r.checked; }));
    $('#f-privacy').addEventListener('submit', (e) => {
      const f = e.target;
      const body = { visibility: f.visibility.value, search_indexing: f.search_indexing.checked };
      if (f.site_password.value) body.site_password = f.site_password.value;
      save(e, body, 'Privacy settings saved');
    });
    $('#f-domain').addEventListener('submit', (e) => save(e, { custom_domain: e.target.custom_domain.value }, 'Domain saved'));
    $('#del-site')?.addEventListener('click', async () => {
      const confirmText = $('#del-confirm').value;
      if (confirmText.trim().toLowerCase() !== w.slug) return toast(`Type ${w.slug} to confirm.`, 'error');
      if (!await confirmDialog('This permanently deletes your website and all of its data.', { title: 'Delete website?', confirmLabel: 'Delete forever', danger: true })) return;
      try { await api('DELETE', `/api/weddings/${wid}`, { confirm: confirmText }); location.href = '/app/wizard?new=1'; } catch (err) { showError(err); }
    });
  }
  if (tab === 'rsvp') {
    box.innerHTML = `<form class="card stack narrow" style="margin:0" id="f-rsvp" novalidate>
      <label class="field"><span>RSVP deadline</span><input type="date" name="rsvp_deadline" value="${esc(w.rsvp_deadline || '')}"><span class="hint">Responses close at the end of this day (${esc(w.timezone)}).</span></label>
      <label class="field"><span>Who can RSVP?</span><select name="rsvp_mode"><option value="open" ${w.rsvp_mode === 'open' ? 'selected' : ''}>Anyone with the link</option><option value="invite_only" ${w.rsvp_mode === 'invite_only' ? 'selected' : ''}>Only guests with an invitation code</option></select></label>
      <label class="field"><span>Plus-ones</span><select name="rsvp_plus_ones"><option value="none" ${w.rsvp_plus_ones === 'none' ? 'selected' : ''}>No plus-ones</option><option value="invited_only" ${w.rsvp_plus_ones === 'invited_only' ? 'selected' : ''}>Only guests I allow</option><option value="everyone" ${w.rsvp_plus_ones === 'everyone' ? 'selected' : ''}>Everyone</option></select></label>
      <label class="field"><span>Guest email address</span><select name="rsvp_collect_email"><option value="optional" ${w.rsvp_collect_email === 'optional' ? 'selected' : ''}>Optional</option><option value="required" ${w.rsvp_collect_email === 'required' ? 'selected' : ''}>Required</option></select></label>
      <label class="switch"><input type="checkbox" name="rsvp_dietary" ${w.rsvp_dietary ? 'checked' : ''}> Ask about dietary requirements</label>
      <label class="switch"><input type="checkbox" name="rsvp_accessibility" ${w.rsvp_accessibility ? 'checked' : ''}> Ask about accessibility needs</label>
      <p class="small muted">Add your own questions in the editor's RSVP section.</p>
      <button class="btn btn-primary btn-sm" type="submit" style="justify-self:start">Save RSVP settings</button></form>`;
    $('#f-rsvp').addEventListener('submit', (e) => {
      const f = e.target;
      save(e, { rsvp_deadline: f.rsvp_deadline.value, rsvp_mode: f.rsvp_mode.value, rsvp_plus_ones: f.rsvp_plus_ones.value, rsvp_collect_email: f.rsvp_collect_email.value, rsvp_dietary: f.rsvp_dietary.checked, rsvp_accessibility: f.rsvp_accessibility.checked }, 'RSVP settings saved');
    });
  }
  if (tab === 'people') renderPeople(box);
  if (tab === 'account') renderAccount(box);
}

async function save(e, body, message) {
  e.preventDefault();
  setFieldErrors(e.target, {});
  try {
    const r = await api('PATCH', `/api/weddings/${wid}/settings`, body);
    summary = { ...summary, ...r };
    toast(message, 'success');
    render();
  } catch (err) { setFieldErrors(e.target, err.data?.fields); showError(err); }
}

async function renderPeople(box) {
  const { members, invites } = await api('GET', `/api/weddings/${wid}/members`);
  const owner = summary.permissions.owner;
  const perm = (m) => [m.can_edit && 'Edit website', m.can_manage_guests && 'Guest list', m.can_publish && 'Publish'].filter(Boolean).join(' · ') || 'View only';
  box.innerHTML = `<div class="stack narrow" style="margin:0">
    <div class="card stack"><h2 style="font-size:1.3rem;margin:0">People with access</h2>
      <ul class="stack-sm" style="list-style:none;padding:0;margin:0">${members.map((m) => `<li class="row between" style="border-bottom:1px solid var(--line);padding-bottom:10px"><span><strong>${esc(m.name || m.email)}</strong> <span class="badge ${m.role === 'owner' ? 'rose' : ''}">${m.role === 'owner' ? 'Owner' : 'Co-owner'}</span><br><span class="small muted">${esc(m.email)}${m.role === 'owner' ? '' : ` · ${esc(perm(m))}`}</span></span>
        ${m.role !== 'owner' && (owner || m.id === me.id) ? `<button class="btn btn-ghost btn-sm" type="button" data-remove="${esc(m.id)}">${m.id === me.id ? 'Leave' : 'Remove'}</button>` : ''}</li>`).join('')}
      ${invites.map((i) => `<li class="row between"><span>${esc(i.email)} <span class="badge gold">Invited</span></span>${owner ? `<button class="btn btn-ghost btn-sm" type="button" data-revoke="${esc(i.id)}">Cancel invite</button>` : ''}</li>`).join('')}</ul></div>
    ${owner ? `<form class="card stack" id="f-invite" novalidate><h2 style="font-size:1.3rem;margin:0">Invite your partner or a helper</h2>
      <p class="small muted" style="margin:0">They'll get an email with a link. Your plan includes ${summary.plan.entitlements.coowners} collaborator${summary.plan.entitlements.coowners === 1 ? '' : 's'}.</p>
      <label class="field"><span>Email</span><input type="email" name="email" required></label>
      <label class="switch"><input type="checkbox" name="can_edit" checked> Can edit the website</label>
      <label class="switch"><input type="checkbox" name="can_manage_guests" checked> Can manage guests and RSVPs</label>
      <label class="switch"><input type="checkbox" name="can_publish"> Can publish changes</label>
      <div data-devlink></div>
      <button class="btn btn-primary btn-sm" type="submit" style="justify-self:start">Send invitation</button></form>` : ''}
  </div>`;
  $$('[data-remove]', box).forEach((b) => b.addEventListener('click', async () => {
    if (!await confirmDialog('They will lose access to this wedding website.', { title: 'Remove access?', confirmLabel: 'Remove', danger: true })) return;
    try { await api('DELETE', `/api/weddings/${wid}/members/${b.dataset.remove}`); if (b.dataset.remove === me.id) location.href = '/app'; else renderPeople(box); } catch (err) { showError(err); }
  }));
  $$('[data-revoke]', box).forEach((b) => b.addEventListener('click', async () => { try { await api('DELETE', `/api/weddings/${wid}/invites/${b.dataset.revoke}`); renderPeople(box); } catch (err) { showError(err); } }));
  $('#f-invite')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      const r = await api('POST', `/api/weddings/${wid}/members`, { email: f.email.value, can_edit: f.can_edit.checked, can_manage_guests: f.can_manage_guests.checked, can_publish: f.can_publish.checked });
      toast('Invitation sent', 'success');
      if (r.dev_invite_link) { await renderPeople(box); $('[data-devlink]', box).innerHTML = `<p class="notice info small">Development mode (no email provider): share this link — <a href="${esc(r.dev_invite_link)}">${esc(r.dev_invite_link)}</a></p>`; } else renderPeople(box);
    } catch (err) { showError(err); }
  });
}

function renderAccount(box) {
  box.innerHTML = `<div class="stack narrow" style="margin:0">
    <form class="card stack" id="f-profile" novalidate><h2 style="font-size:1.3rem;margin:0">Your profile</h2>
      <label class="field"><span>Name</span><input type="text" name="name" value="${esc(me.name)}" maxlength="100"></label>
      <p class="small muted" style="margin:0">Email: ${esc(me.email)} ${me.email_verified ? '<span class="badge green">Confirmed</span>' : '<span class="badge red">Not confirmed</span>'}</p>
      <label class="switch"><input type="checkbox" name="marketing_opt_in"> Send me occasional tips and product news</label>
      <button class="btn btn-primary btn-sm" type="submit" style="justify-self:start">Save profile</button></form>
    <form class="card stack" id="f-password" novalidate><h2 style="font-size:1.3rem;margin:0">Change password</h2>
      <label class="field"><span>Current password</span><input type="password" name="current_password" autocomplete="current-password"></label>
      <label class="field"><span>New password <span class="hint">At least 10 characters</span></span><input type="password" name="new_password" autocomplete="new-password"></label>
      <button class="btn btn-primary btn-sm" type="submit" style="justify-self:start">Change password</button></form>
    <div class="card stack" id="security-card"><h2 style="font-size:1.3rem;margin:0">Security</h2><div class="loading"><span class="spinner" aria-hidden="true"></span></div></div>
    <div class="card stack"><h2 style="font-size:1.3rem;margin:0">Your data</h2>
      <p class="small" style="margin:0">Download everything we store about you and the websites you own (JSON). Photos are listed with download links.</p>
      <a class="btn btn-secondary btn-sm" href="/api/account/export" download style="justify-self:start">Download my data</a></div>
    <form class="card stack" id="f-delete" novalidate style="border-color:#f1c9c5"><h2 style="font-size:1.3rem;margin:0;color:var(--danger)">Delete my account</h2>
      <p class="small" style="margin:0">Deletes your account and every website you own, including photos, guest lists and RSVPs. Websites you collaborate on are not deleted.</p>
      <label class="field"><span>Password</span><input type="password" name="password" autocomplete="current-password"></label>
      <label class="field"><span>Type <strong>delete my account</strong></span><input type="text" name="confirm" autocomplete="off"></label>
      <button class="btn btn-danger btn-sm" type="submit" style="justify-self:start">Delete my account</button></form>
  </div>`;
  renderSecurity($('#security-card'));
  $('#f-profile').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('PATCH', '/api/account/profile', { name: e.target.name.value, marketing_opt_in: e.target.marketing_opt_in.checked }); toast('Profile saved', 'success'); } catch (err) { setFieldErrors(e.target, err.data?.fields); showError(err); }
  });
  $('#f-password').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('POST', '/api/account/password', { current_password: e.target.current_password.value, new_password: e.target.new_password.value }); e.target.reset(); toast('Password changed. Other devices have been signed out.', 'success'); } catch (err) { setFieldErrors(e.target, err.data?.fields); showError(err); }
  });
  $('#f-delete').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!await confirmDialog('Your account and the websites you own will be permanently deleted.', { title: 'Delete your account?', confirmLabel: 'Delete forever', danger: true })) return;
    try { await api('DELETE', '/api/account', { password: e.target.password.value, confirm: e.target.confirm.value }); location.href = '/'; } catch (err) { setFieldErrors(e.target, err.data?.fields); showError(err); }
  });
}

const EVENT_LABELS = {
  login_success: 'Signed in', login_failed: 'Wrong password entered', login_locked: 'Sign-in blocked (too many attempts)', mfa_failed: 'Wrong verification code',
  password_changed: 'Password changed', password_reset: 'Password reset by email', mfa_enabled: 'Two-step verification turned on', mfa_disabled: 'Two-step verification turned off',
  recovery_code_used: 'Recovery code used', sessions_revoked: 'Signed out other devices', signup: 'Account created', admin_action: 'Admin action'
};

function showRecoveryCodes(codes) {
  const body = document.createElement('div');
  body.className = 'stack';
  body.innerHTML = `<p>Save these recovery codes somewhere safe, such as a password manager. Each one works once, if you lose your phone. <strong>You won't see them again.</strong></p>
    <pre class="json" style="font-size:1rem;line-height:1.8">${codes.map(esc).join('\n')}</pre>
    <button class="btn btn-secondary btn-sm" type="button" data-copy style="justify-self:start">Copy codes</button>`;
  body.querySelector('[data-copy]').addEventListener('click', () => navigator.clipboard?.writeText(codes.join('\n')).then(() => toast('Copied', 'success')));
  modal({ title: 'Your recovery codes', body, actions: [{ label: "I've saved them", className: 'btn-primary' }] });
}

async function renderSecurity(box) {
  let sec;
  try { sec = await api('GET', '/api/account/security'); } catch (err) { box.innerHTML = `<p class="form-error">${esc(err.message)}</p>`; return; }
  box.innerHTML = `<h2 style="font-size:1.3rem;margin:0">Security</h2>
    <div class="row between"><div><strong>Two-step verification</strong> ${sec.mfa_enabled ? '<span class="badge green">On</span>' : '<span class="badge">Off</span>'}<p class="small muted" style="margin:4px 0 0">${sec.mfa_enabled ? `Signing in needs your password and a code from your authenticator app. ${sec.recovery_codes_left} recovery codes left.` : 'Protect your account with a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) as well as your password.'}</p></div>
      ${sec.mfa_enabled ? '<div class="row"><button class="btn btn-secondary btn-sm" type="button" data-newcodes>New recovery codes</button><button class="btn btn-ghost btn-sm" type="button" data-disable>Turn off</button></div>' : '<button class="btn btn-primary btn-sm" type="button" data-enable>Turn on</button>'}</div>
    <div data-mfa-setup></div>
    <div class="row between" style="border-top:1px solid var(--line);padding-top:14px"><div><strong>Signed-in devices</strong><p class="small muted" style="margin:4px 0 0">You are signed in on ${sec.active_sessions} device${sec.active_sessions === 1 ? '' : 's'} or browser${sec.active_sessions === 1 ? '' : 's'}.</p></div>
      <button class="btn btn-secondary btn-sm" type="button" data-revoke ${sec.active_sessions > 1 ? '' : 'disabled'}>Sign out everywhere else</button></div>
    <details style="border-top:1px solid var(--line);padding-top:14px"><summary><strong>Recent security activity</strong></summary>
      <ul class="small" style="padding-left:18px;margin-top:10px">${sec.events.map((e) => `<li>${esc(EVENT_LABELS[e.type] || e.type)} · ${esc(new Date(e.created_at).toLocaleString())}${e.ip ? ` · ${esc(e.ip)}` : ''}</li>`).join('') || '<li>No activity yet.</li>'}</ul>
      <p class="tiny muted">Don't recognise something? Change your password and sign out everywhere else.</p></details>`;
  const setup = box.querySelector('[data-mfa-setup]');
  box.querySelector('[data-enable]')?.addEventListener('click', async () => {
    try {
      const r = await api('POST', '/api/account/2fa/setup');
      setup.innerHTML = `<form class="card-flat stack-sm" novalidate>
        <p class="small" style="margin:0"><strong>1.</strong> In your authenticator app, add an account using this key${/Android|iPhone|iPad/i.test(navigator.userAgent) ? ` (or <a href="${esc(r.uri)}">tap here to open your app</a>)` : ''}:</p>
        <code style="font-size:1.05rem;letter-spacing:.08em;word-break:break-all;background:var(--paper);padding:10px;border-radius:8px">${esc(r.secret.replace(/(.{4})/g, '$1 ').trim())}</code>
        <p class="small" style="margin:0"><strong>2.</strong> Enter the 6-digit code it shows:</p>
        <label class="field"><span class="sr-only">Verification code</span><input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required></label>
        <button class="btn btn-primary btn-sm" type="submit" style="justify-self:start">Confirm and turn on</button></form>`;
      const f = setup.querySelector('form');
      f.elements.code.focus();
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          const out = await api('POST', '/api/account/2fa/enable', { code: f.elements.code.value });
          showRecoveryCodes(out.recovery_codes);
          toast('Two-step verification is on. Other devices were signed out.', 'success');
          renderSecurity(box);
        } catch (err) { setFieldErrors(f, err.data?.fields); showError(err); }
      });
    } catch (err) { showError(err); }
  });
  const askCode = (title, withPassword, run) => {
    const f = document.createElement('form');
    f.className = 'stack';
    f.innerHTML = `${withPassword ? '<label class="field"><span>Password</span><input type="password" name="password" autocomplete="current-password"></label>' : ''}<label class="field"><span>Code from your app (or a recovery code)</span><input type="text" name="code" autocomplete="one-time-code"></label>`;
    modal({ title, body: f, actions: [{ label: 'Cancel' }, { label: 'Confirm', className: 'btn-primary', onClick: async () => { try { await run(f); return true; } catch (err) { setFieldErrors(f, err.data?.fields); showError(err); return false; } } }] });
  };
  box.querySelector('[data-disable]')?.addEventListener('click', () => askCode('Turn off two-step verification', true, async (f) => {
    await api('POST', '/api/account/2fa/disable', { password: f.elements.password.value, code: f.elements.code.value });
    toast('Two-step verification turned off'); renderSecurity(box);
  }));
  box.querySelector('[data-newcodes]')?.addEventListener('click', () => askCode('New recovery codes', false, async (f) => {
    const r = await api('POST', '/api/account/2fa/recovery-codes', { code: f.elements.code.value });
    showRecoveryCodes(r.recovery_codes); renderSecurity(box);
  }));
  box.querySelector('[data-revoke]').addEventListener('click', async () => {
    if (!await confirmDialog('All other browsers and devices will be signed out. You stay signed in here.', { title: 'Sign out everywhere else?', confirmLabel: 'Sign out others' })) return;
    try { const r = await api('POST', '/api/account/sessions/revoke-others'); toast(`Signed out ${r.signed_out} other session${r.signed_out === 1 ? '' : 's'}`, 'success'); renderSecurity(box); } catch (err) { showError(err); }
  });
}

render();
