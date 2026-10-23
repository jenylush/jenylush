import { api, $, $$, esc, appChrome, toast, showError, confirmDialog, relativeTime } from '../api.js';

await appChrome();
let tab = location.hash.slice(1) || 'metrics';
const TABS = [['metrics', 'Metrics'], ['users', 'Users'], ['weddings', 'Websites'], ['reports', 'Reports'], ['templates', 'Templates'], ['plans', 'Plans'], ['email', 'Email health'], ['settings', 'Settings']];

function shell() {
  $('#main').innerHTML = `<div class="page-head"><div><h1>Platform admin</h1><p>Manage users, templates, plans and reported content.</p></div></div>
    <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`).join('')}</div><div id="tab"><div class="loading"><span class="spinner"></span></div></div>`;
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; history.replaceState(null, '', `#${tab}`); shell(); }));
  VIEWS[tab]($('#tab')).catch(showError);
}

const pct = (v) => (v === null || v === undefined ? '—' : `${v}%`);

const VIEWS = {
  async metrics(box) {
    const { metrics: m, recent } = await api('GET', '/api/admin/metrics?days=90');
    box.innerHTML = `<p class="small muted">Last ${m.window_days} days. Calculated from real application data.</p>
      <div class="metric-grid">
        <div class="metric"><span class="label">Activation</span><strong>${pct(m.activation.value)}</strong><div class="detail">${m.activation.activated} of ${m.activation.new_users} new users published a website</div></div>
        <div class="metric"><span class="label">Time to publish (median)</span><strong>${m.time_to_publish_hours.median === null ? '—' : `${m.time_to_publish_hours.median} h`}</strong><div class="detail">${m.time_to_publish_hours.samples} published websites</div></div>
        <div class="metric"><span class="label">Guest engagement</span><strong>${pct(m.guest_engagement.value)}</strong><div class="detail">${m.guest_engagement.engaged} of ${m.guest_engagement.published} published sites have RSVPs</div></div>
        <div class="metric"><span class="label">RSVP conversion</span><strong>${pct(m.rsvp_conversion.value)}</strong><div class="detail">${m.rsvp_conversion.responded} of ${m.rsvp_conversion.invited} invited guests responded</div></div>
        <div class="metric"><span class="label">Paid conversion</span><strong>${pct(m.paid_conversion.value)}</strong><div class="detail">${m.paid_conversion.paid} paying users · ${m.paid_conversion.upgrade_interest} on the Premium waitlist</div></div>
        <div class="metric"><span class="label">Referral rate</span><strong>${pct(m.referral_rate.value)}</strong><div class="detail">${m.referral_rate.referrers} of ${m.referral_rate.couples} couples referred someone</div></div>
      </div>
      <h2 style="font-size:1.3rem;margin-top:28px">Event counts</h2>
      <div class="table-wrap"><table><thead><tr><th>Event</th><th>Count</th></tr></thead><tbody>${Object.entries(m.event_counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">No events yet.</td></tr>'}</tbody></table></div>
      <h2 style="font-size:1.3rem;margin-top:28px">Recent events</h2>
      <div class="table-wrap"><table><thead><tr><th>Event</th><th>Properties</th><th>When</th></tr></thead><tbody>${recent.map((e) => `<tr><td>${esc(e.name)}</td><td class="small muted">${esc(JSON.stringify(e.props))}</td><td class="small">${esc(relativeTime(e.created_at))}</td></tr>`).join('')}</tbody></table></div>`;
  },
  async users(box) {
    const draw = async (q = '') => {
      const { users } = await api('GET', `/api/admin/users?q=${encodeURIComponent(q)}`);
      const { plans } = await api('GET', '/api/admin/plans');
      $('#user-rows').innerHTML = users.map((u) => `<tr><td><strong>${esc(u.name)}</strong><div class="tiny muted">${esc(u.email)}</div></td>
        <td>${u.email_verified_at ? '<span class="badge green">Verified</span>' : '<span class="badge">Unverified</span>'} ${u.disabled_at ? '<span class="badge red">Disabled</span>' : ''} ${u.role === 'admin' ? '<span class="badge rose">Admin</span>' : ''}</td>
        <td>${u.weddings}</td><td><select data-plan="${u.id}" aria-label="Plan for ${esc(u.email)}">${plans.map((p) => `<option value="${p.id}" ${u.plan === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></td>
        <td class="small">${esc(relativeTime(u.created_at))}</td>
        <td><button class="btn btn-ghost btn-sm" type="button" data-disable="${u.id}" data-on="${u.disabled_at ? 0 : 1}">${u.disabled_at ? 'Enable' : 'Disable'}</button></td></tr>`).join('');
      $$('[data-plan]').forEach((s) => s.addEventListener('change', async () => {
        try { await api('PATCH', `/api/admin/users/${s.dataset.plan}`, { plan_id: s.value }); toast('Plan updated (recorded as an admin grant, not a payment)', 'success'); } catch (err) { showError(err); }
      }));
      $$('[data-disable]').forEach((b) => b.addEventListener('click', async () => {
        try { await api('PATCH', `/api/admin/users/${b.dataset.disable}`, { disabled: b.dataset.on === '1' }); draw($('#uq').value); } catch (err) { showError(err); }
      }));
    };
    box.innerHTML = `<label><span class="sr-only">Search users</span><input type="search" id="uq" placeholder="Search by email or name" style="max-width:360px;margin-bottom:12px"></label>
      <div class="table-wrap"><table><thead><tr><th>User</th><th>Status</th><th>Websites</th><th>Plan</th><th>Joined</th><th></th></tr></thead><tbody id="user-rows"></tbody></table></div>`;
    let t; $('#uq').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => draw(e.target.value), 300); });
    await draw();
  },
  async weddings(box) {
    const { weddings } = await api('GET', '/api/admin/weddings');
    box.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Website</th><th>Owner</th><th>Status</th><th>Visits</th><th>Custom domain</th><th></th></tr></thead><tbody>${weddings.map((w) => `<tr>
      <td><strong>${esc(w.names)}</strong><div class="tiny"><a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(w.slug)}</a></div></td><td class="small">${esc(w.owner_email || '—')}</td>
      <td><span class="badge ${w.status === 'published' ? 'green' : ''}">${esc(w.status)}</span> ${w.unpublished_reason?.startsWith('admin:') ? '<span class="badge red">Taken down</span>' : ''} ${w.open_reports ? `<span class="badge red">${w.open_reports} reports</span>` : ''}</td>
      <td>${w.visits}</td><td class="small">${w.custom_domain ? `${esc(w.custom_domain)} ${w.custom_domain_verified_at ? '<span class="badge green">Active</span>' : `<button class="btn btn-ghost btn-sm" type="button" data-verify="${w.id}">Mark DNS verified</button>`}` : '—'}</td>
      <td>${w.unpublished_reason?.startsWith('admin:') ? `<button class="btn btn-ghost btn-sm" type="button" data-restore="${w.id}">Allow republishing</button>` : w.status === 'published' ? `<button class="btn btn-ghost btn-sm" type="button" data-takedown="${w.id}">Take down</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
    $$('[data-takedown]').forEach((b) => b.addEventListener('click', async () => {
      if (!await confirmDialog('The website will go offline immediately and the couple cannot republish until you allow it.', { title: 'Take down website?', confirmLabel: 'Take down', danger: true })) return;
      await api('POST', `/api/admin/weddings/${b.dataset.takedown}/takedown`, { reason: 'policy' }).catch(showError); shell();
    }));
    $$('[data-restore]').forEach((b) => b.addEventListener('click', async () => { await api('POST', `/api/admin/weddings/${b.dataset.restore}/restore`).catch(showError); shell(); }));
    $$('[data-verify]').forEach((b) => b.addEventListener('click', async () => { await api('POST', `/api/admin/weddings/${b.dataset.verify}/verify-domain`, {}).catch(showError); shell(); }));
  },
  async reports(box) {
    const { reports } = await api('GET', '/api/admin/reports');
    box.innerHTML = reports.length ? `<div class="table-wrap"><table><thead><tr><th>Website</th><th>Reason</th><th>Details</th><th>Status</th><th></th></tr></thead><tbody>${reports.map((r) => `<tr>
      <td><strong>${esc(r.names)}</strong><div class="tiny"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.slug)}</a></div></td><td>${esc(r.reason)}</td>
      <td class="small">${esc(r.details)}${r.reporter_email ? `<div class="muted">From ${esc(r.reporter_email)}</div>` : ''}<div class="muted">${esc(relativeTime(r.created_at))}</div></td>
      <td><span class="badge ${r.status === 'open' ? 'red' : ''}">${esc(r.status)}</span></td>
      <td class="row" style="gap:4px">${r.status === 'open' ? `<button class="btn btn-ghost btn-sm" type="button" data-st="dismissed" data-id="${r.id}">Dismiss</button><button class="btn btn-ghost btn-sm" type="button" data-st="actioned" data-id="${r.id}" data-wid="${r.wedding_id}">Take down site</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><h3>No reports</h3><p>Reports submitted from published websites appear here.</p></div>';
    $$('[data-st]').forEach((b) => b.addEventListener('click', async () => {
      try {
        if (b.dataset.st === 'actioned') await api('POST', `/api/admin/weddings/${b.dataset.wid}/takedown`, { reason: 'report' });
        await api('PATCH', `/api/admin/reports/${b.dataset.id}`, { status: b.dataset.st }); shell();
      } catch (err) { showError(err); }
    }));
  },
  async templates(box) {
    const { templates } = await api('GET', '/api/admin/templates');
    box.innerHTML = `<p class="small muted">Template designs live in code (shared/templates.js); availability and tier are controlled here.</p><div class="table-wrap"><table><thead><tr><th>Template</th><th>Tier</th><th>Enabled</th><th>Order</th></tr></thead><tbody>${templates.map((t) => `<tr>
      <td><strong>${esc(t.name)}</strong><div class="tiny muted">${esc(t.style)}</div></td>
      <td><select data-tier="${t.id}"><option value="free" ${t.tier === 'free' ? 'selected' : ''}>Free</option><option value="premium" ${t.tier === 'premium' ? 'selected' : ''}>Premium</option></select></td>
      <td><label class="switch"><input type="checkbox" data-enabled="${t.id}" ${t.enabled ? 'checked' : ''}><span class="sr-only">Enabled</span></label></td>
      <td><input type="number" data-sort="${t.id}" value="${t.sort}" style="width:80px"></td></tr>`).join('')}</tbody></table></div>`;
    const patch = async (id, body) => { try { await api('PATCH', `/api/admin/templates/${id}`, body); toast('Template updated', 'success'); } catch (err) { showError(err); } };
    $$('[data-tier]').forEach((s) => s.addEventListener('change', () => patch(s.dataset.tier, { tier: s.value })));
    $$('[data-enabled]').forEach((s) => s.addEventListener('change', () => patch(s.dataset.enabled, { enabled: s.checked })));
    $$('[data-sort]').forEach((s) => s.addEventListener('change', () => patch(s.dataset.sort, { sort: Number(s.value) })));
  },
  async plans(box) {
    const { plans, payments_enabled } = await api('GET', '/api/admin/plans');
    box.innerHTML = `<p class="notice ${payments_enabled ? '' : 'warn'} small">${payments_enabled ? 'Payments are enabled.' : 'Payments are off (freemium launch). Paid plans show as “coming soon” with a waitlist. Set PAYMENTS_ENABLED and connect a payment provider to sell plans.'}</p>
      <div class="stack" style="margin-top:14px">${plans.map((p) => `<form class="card stack" data-plan="${p.id}">
        <div class="row between"><h2 style="font-size:1.3rem;margin:0">${esc(p.name)} <span class="tiny muted">(${esc(p.id)})</span></h2>
        <select name="status" aria-label="Status"><option value="active" ${p.status === 'active' ? 'selected' : ''}>Active</option><option value="coming_soon" ${p.status === 'coming_soon' ? 'selected' : ''}>Coming soon</option><option value="hidden" ${p.status === 'hidden' ? 'selected' : ''}>Hidden</option></select></div>
        <div class="grid-2"><label class="field"><span>Name</span><input type="text" name="name" value="${esc(p.name)}"></label><label class="field"><span>Price (minor units, e.g. cents)</span><input type="number" name="price_cents" value="${p.price_cents}" min="0"></label></div>
        <div class="grid-2"><label class="field"><span>Currency</span><input type="text" name="currency" value="${esc(p.currency)}" maxlength="3"></label><label class="field"><span>Billing</span><select name="billing_interval">${['one_time', 'month', 'year'].map((x) => `<option ${p.billing_interval === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label></div>
        <label class="field"><span>Description</span><input type="text" name="description" value="${esc(p.description)}"></label>
        <label class="field"><span>Entitlements (JSON)</span><textarea class="code" name="entitlements">${esc(JSON.stringify(p.entitlements, null, 2))}</textarea></label>
        <button class="btn btn-primary btn-sm" type="submit" style="justify-self:start">Save ${esc(p.name)}</button></form>`).join('')}</div>`;
    $$('[data-plan]').forEach((f) => f.addEventListener('submit', async (e) => {
      e.preventDefault();
      let entitlements;
      try { entitlements = JSON.parse(f.entitlements.value); } catch { return toast('Entitlements must be valid JSON.', 'error'); }
      try {
        await api('PUT', `/api/admin/plans/${f.dataset.plan}`, { name: f.name.value, price_cents: Number(f.price_cents.value), currency: f.currency.value, billing_interval: f.billing_interval.value, description: f.description.value, status: f.status.value, entitlements });
        toast('Plan saved', 'success');
      } catch (err) { showError(err); }
    }));
  },
  async email(box) {
    const h = await api('GET', '/api/admin/email-health');
    box.innerHTML = `<p class="notice ${h.configured ? '' : 'warn'} small">Provider: <strong>${esc(h.provider)}</strong> ${h.configured ? '(configured)' : '— not configured, emails are recorded as “not configured” and never sent'}</p>
      <div class="metric-grid" style="margin-top:14px">${Object.entries(h.counts).map(([k, v]) => `<div class="metric"><span class="label">${esc(k.replace(/_/g, ' '))}</span><strong>${v}</strong></div>`).join('')}
      <div class="metric"><span class="label">Overdue scheduled messages</span><strong>${h.overdue}</strong><div class="detail">Pending for 15+ minutes past their send time</div></div></div>
      <h2 style="font-size:1.3rem;margin-top:24px">Failures</h2>
      ${h.failures.length ? `<div class="table-wrap"><table><thead><tr><th>Type</th><th>To</th><th>Error</th><th>When</th><th></th></tr></thead><tbody>${h.failures.map((f) => `<tr><td>${esc(f.type)}</td><td class="small">${esc(f.to_email)}</td><td class="small">${esc(f.last_error || f.status)}</td><td class="small">${esc(relativeTime(f.updated_at))}</td><td>${f.status === 'failed' ? `<button class="btn btn-ghost btn-sm" type="button" data-retry="${f.id}">Retry</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">No failed emails.</p>'}`;
    $$('[data-retry]').forEach((b) => b.addEventListener('click', async () => { try { await api('POST', `/api/admin/email-health/${b.dataset.retry}/retry`); toast('Queued for retry', 'success'); shell(); } catch (err) { showError(err); } }));
  },
  async settings(box) {
    const { settings, environment } = await api('GET', '/api/admin/settings');
    box.innerHTML = `<form class="card stack narrow" style="margin:0" id="f-set">
      <label class="switch"><input type="checkbox" name="signups_enabled" ${settings.signups_enabled ? 'checked' : ''}> Allow new sign-ups</label>
      <label class="field"><span>Announcement banner <span class="hint">Shown at the top of every page; leave empty to hide</span></span><input type="text" name="announcement" value="${esc(settings.announcement)}" maxlength="300"></label>
      <label class="field"><span>Default locale</span><input type="text" name="default_locale" value="${esc(settings.default_locale)}"></label>
      <button class="btn btn-primary btn-sm" type="submit" style="justify-self:start">Save settings</button></form>
      <h2 style="font-size:1.3rem;margin-top:24px">Environment</h2><pre class="json">${esc(JSON.stringify(environment, null, 2))}</pre>`;
    $('#f-set').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      try { await api('PUT', '/api/admin/settings', { signups_enabled: f.signups_enabled.checked, announcement: f.announcement.value, default_locale: f.default_locale.value }); toast('Settings saved', 'success'); } catch (err) { showError(err); }
    });
  }
};

if (!VIEWS[tab]) tab = 'metrics';
shell();
