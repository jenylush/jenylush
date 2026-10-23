import { api, $, $$, esc, appChrome, currentWedding, modal, toast, showError, upgradePrompt, relativeTime } from '../api.js';

const summary = await currentWedding();
const wid = summary.wedding.id;
await appChrome({ weddingId: wid });
document.title = `Guest emails — ${summary.wedding.names}`;

let data;
let log = { log: [], counts: {} };

const STATUS_BADGE = { queued: '', sending: 'gold', sent: 'green', delivered: 'green', bounced: 'red', complained: 'red', failed: 'red', not_configured: 'red', suppressed: '' };

function configFields(rule) {
  const c = rule.config;
  const f = [];
  if (rule.type === 'rsvp_reminder') f.push(`<label class="field"><span>Days before the RSVP deadline <span class="hint">comma separated</span></span><input type="text" data-c="days_before_deadline" value="${esc((c.days_before_deadline || []).join(', '))}"></label>`);
  if (rule.type === 'final_reminders') f.push(`<label class="field"><span>Days before the wedding <span class="hint">comma separated</span></span><input type="text" data-c="days_before" value="${esc((c.days_before || []).join(', '))}"></label>`);
  if (rule.type === 'biweekly_update') {
    f.push(`<label class="field"><span>First update on</span><input type="date" data-c="start_date" value="${esc(c.start_date || '')}"><span class="hint">Then every 14 days until the wedding.</span></label>`);
    f.push(`<label class="field"><span>Subject</span><input type="text" data-c="subject" value="${esc(c.subject || '')}" maxlength="150"></label>`);
  }
  if (['rsvp_reminder', 'final_reminders', 'biweekly_update'].includes(rule.type)) f.push(`<label class="field"><span>Send at (${esc(data.timezone)} time)</span><select data-c="send_hour">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${Number(c.send_hour) === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select></label>`);
  if (rule.type !== 'update_notification') f.push(`<label class="field"><span>Personal message</span><textarea data-c="message" rows="3" maxlength="3000">${esc(c.message || '')}</textarea></label>`);
  return f.join('');
}

function render() {
  const fmt = (iso) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: data.timezone }).format(new Date(iso));
  $('#main').innerHTML = `
    <div class="page-head"><div><h1>Guest emails</h1><p>Emails are sent by our servers at the right time in your wedding's timezone (${esc(data.timezone)}) — you don't need to keep this page open.</p></div>
      <label class="switch"><input type="checkbox" id="pause" ${data.paused ? 'checked' : ''}> Pause all scheduled emails</label></div>
    ${data.provider_configured ? '' : '<p class="form-error" style="margin-bottom:16px"><strong>Email sending is not connected on this server.</strong> Emails are recorded but not sent until an administrator configures an email provider (see README → Email). Nothing will be marked as sent.</p>'}
    ${data.paused ? '<p class="notice warn" style="margin-bottom:16px">Scheduled emails are paused. Nothing scheduled will be sent until you resume. RSVP confirmations still go out.</p>' : ''}
    <div class="stack">${data.rules.map((r) => `<section class="card rule-card" data-rule="${r.type}" aria-labelledby="h-${r.type}">
      <div class="rule-head"><div><h2 id="h-${r.type}" style="font-family:var(--f-body);font-size:1.1rem;margin:0">${esc(r.name)} ${r.allowed ? '' : '<span class="premium-tag">Premium</span>'} ${r.essential ? '' : '<span class="badge">Opt-in guests only</span>'}</h2><p class="small muted" style="margin:4px 0 0">${esc(r.trigger)}</p></div>
        ${r.type === 'invitation' || r.type === 'update_notification' ? '<span class="badge">Sent manually</span>' : `<label class="switch"><input type="checkbox" data-enable ${r.enabled ? 'checked' : ''} ${r.allowed || r.enabled ? '' : 'data-locked'}> <span>${r.enabled ? 'On' : 'Off'}</span></label>`}</div>
      ${r.type === 'rsvp_reminder' && !data.rsvp_deadline ? '<p class="notice warn small">Set an RSVP deadline (in the editor’s RSVP section or Settings) to schedule reminders.</p>' : ''}
      ${r.type === 'update_notification' ? '<p class="small muted" style="margin:0">Choose “Email guests about this update” when you publish changes.</p>' : ''}
      ${r.type === 'invitation' ? `<p class="small muted" style="margin:0">Send invitations from your <a href="/app/guests?id=${wid}">guest list</a>.</p>` : ''}
      <details><summary class="small" style="cursor:pointer">Customise</summary><div class="stack-sm" style="margin-top:10px">${configFields(r)}</div></details>
      <div class="row"><button class="btn btn-secondary btn-sm" type="button" data-preview>Preview email</button>${r.type !== 'update_notification' ? '<button class="btn btn-primary btn-sm" type="button" data-save>Save changes</button>' : ''}</div>
      ${r.upcoming.length ? `<div class="small"><strong>Scheduled:</strong> ${r.upcoming.map((u) => esc(fmt(u.send_at))).join(' · ')}</div>` : ''}
    </section>`).join('')}</div>
    <section style="margin-top:32px" aria-labelledby="log-h"><h2 id="log-h" style="font-size:1.5rem">Recent emails</h2>
      <p class="small muted">${Object.entries(log.counts).map(([k, v]) => `${esc(k.replace(/_/g, ' '))}: ${v}`).join(' · ') || 'No emails yet.'}</p>
      ${log.log.length ? `<div class="table-wrap"><table><thead><tr><th>To</th><th>Email</th><th>Status</th><th>When</th></tr></thead><tbody>${log.log.slice(0, 100).map((l) => `<tr><td>${esc([l.first_name, l.last_name].filter(Boolean).join(' ') || l.to_email)}<div class="tiny muted">${esc(l.to_email)}</div></td><td class="small">${esc(l.subject)}</td><td><span class="badge ${STATUS_BADGE[l.status] || ''}">${esc(l.status.replace(/_/g, ' '))}</span>${l.last_error ? `<div class="tiny muted">${esc(l.last_error)}</div>` : ''}</td><td class="small">${esc(relativeTime(l.created_at))}</td></tr>`).join('')}</tbody></table></div>` : ''}
    </section>`;

  $('#pause').addEventListener('change', async (e) => {
    try { await api('PATCH', `/api/weddings/${wid}/settings`, { automation_paused: e.target.checked }); toast(e.target.checked ? 'Scheduled emails paused' : 'Scheduled emails resumed', 'success'); await load(); } catch (err) { showError(err); }
  });
  $$('[data-rule]').forEach((card) => {
    const type = card.dataset.rule;
    const rule = data.rules.find((r) => r.type === type);
    const readConfig = () => {
      const cfg = {};
      $$('[data-c]', card).forEach((el) => { cfg[el.dataset.c] = el.value; });
      return cfg;
    };
    $('[data-enable]', card)?.addEventListener('change', async (e) => {
      if (e.target.dataset.locked !== undefined && e.target.checked) { e.target.checked = false; return upgradePrompt({ feature: 'email_workflow', feature_label: 'Scheduled guest emails', error: `${rule.name} emails are part of Premium.` }); }
      try { await api('PUT', `/api/weddings/${wid}/automations/${type}`, { enabled: e.target.checked, config: readConfig() }); toast(`${rule.name} ${e.target.checked ? 'turned on' : 'turned off'}`, 'success'); await load(); } catch (err) { e.target.checked = !e.target.checked; showError(err); }
    });
    $('[data-save]', card)?.addEventListener('click', async () => {
      try { await api('PUT', `/api/weddings/${wid}/automations/${type}`, { config: readConfig() }); toast('Saved', 'success'); await load(); } catch (err) { showError(err); }
    });
    $('[data-preview]', card).addEventListener('click', async () => {
      try {
        const p = await api('POST', `/api/weddings/${wid}/automations/${type}/preview`, { config: readConfig() });
        const body = document.createElement('div');
        body.className = 'stack';
        body.innerHTML = `<p class="small"><strong>Subject:</strong> ${esc(p.subject)}</p><iframe class="email-preview" sandbox="" title="Email preview"></iframe><p class="tiny muted">Preview uses your real wedding details and a sample guest.</p>`;
        $('iframe', body).srcdoc = p.html;
        modal({ title: `${rule.name} preview`, body, wide: true });
      } catch (err) { showError(err); }
    });
  });
}

async function load() {
  [data, log] = await Promise.all([api('GET', `/api/weddings/${wid}/automations`), summary.permissions.guests ? api('GET', `/api/weddings/${wid}/email-log`) : Promise.resolve({ log: [], counts: {} })]);
  render();
}
await load();
