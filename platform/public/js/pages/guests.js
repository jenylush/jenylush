import { api, $, $$, esc, appChrome, currentWedding, modal, toast, showError, confirmDialog, copyText, setFieldErrors, relativeTime, formatDate } from '../api.js';

const summary = await currentWedding();
const wid = summary.wedding.id;
await appChrome({ weddingId: wid });
document.title = `Guests — ${summary.wedding.names}`;
if (!summary.permissions.guests) {
  $('#main').innerHTML = '<div class="empty"><h3>No access to the guest list</h3><p>Ask the website owner to give you guest list permissions.</p></div>';
  throw new Error('no access');
}

let data = { guests: [], events: [], site_url: '', published: false };
let filter = 'all';
let query = '';
const selected = new Set();

const STATUS = { pending: ['Not replied', ''], confirmed: ['Attending', 'green'], declined: ['Declined', 'rose'] };

async function load() {
  data = await api('GET', `/api/weddings/${wid}/guests`);
  for (const id of [...selected]) if (!data.guests.some((g) => g.id === id)) selected.delete(id);
  render();
}

function inviteLink(g) { return `${data.site_url}?invite=${encodeURIComponent(g.invite_code)}`; }

function counts() {
  const c = { all: data.guests.length, pending: 0, confirmed: 0, declined: 0, not_invited: 0 };
  for (const g of data.guests) { c[g.rsvp_status]++; if (g.invitation_status === 'not_invited') c.not_invited++; }
  return c;
}

function visible() {
  const q = query.trim().toLowerCase();
  return data.guests.filter((g) => {
    if (filter === 'not_invited' ? g.invitation_status !== 'not_invited' : filter !== 'all' && g.rsvp_status !== filter) return false;
    return !q || `${g.first_name} ${g.last_name} ${g.email || ''} ${g.household}`.toLowerCase().includes(q);
  });
}

function render() {
  const c = counts();
  const rows = visible();
  const eventName = (id) => data.events.find((e) => e.id === id)?.name || id;
  $('#main').innerHTML = `
    <div class="page-head"><div><h1>Guests & RSVPs</h1><p>${c.all} guests · ${c.confirmed} attending · ${c.declined} declined · ${c.pending} not replied${summary.wedding.rsvp_deadline ? ` · deadline ${esc(formatDate(summary.wedding.rsvp_deadline, { weekday: false }))}` : ''}</p></div>
      <div class="row"><button class="btn btn-secondary btn-sm" type="button" id="import">Import CSV</button>
      <a class="btn btn-secondary btn-sm" href="/api/weddings/${wid}/guests/export.csv" download>Export CSV</a>
      ${summary.plan.entitlements.advanced_exports ? `<a class="btn btn-ghost btn-sm" href="/api/weddings/${wid}/rsvp-history.csv" download>Full RSVP history</a>` : ''}
      <button class="btn btn-primary btn-sm" type="button" id="add">＋ Add guest</button></div></div>
    ${data.published ? '' : `<p class="notice warn" style="margin-bottom:16px">Your website is not published yet. Publish it before sending invitations so guests can open the link. <a href="/app?id=${wid}">Go to dashboard</a></p>`}
    <div class="tabs" role="tablist" aria-label="Filter guests">${[['all', 'All'], ['confirmed', 'Attending'], ['declined', 'Declined'], ['pending', 'Not replied'], ['not_invited', 'Not invited yet']].map(([k, l]) => `<button type="button" role="tab" data-filter="${k}" aria-selected="${filter === k}">${l} <span class="badge">${c[k]}</span></button>`).join('')}</div>
    <div class="row between" style="margin-bottom:12px">
      <label class="grow" style="max-width:360px"><span class="sr-only">Search guests</span><input type="search" id="search" placeholder="Search by name, email or household" value="${esc(query)}"></label>
      <div class="row"><span class="small muted" id="sel-count">${selected.size ? `${selected.size} selected` : ''}</span>
        <button class="btn btn-secondary btn-sm" type="button" id="send" ${selected.size ? '' : 'disabled'}>✉ Email invitations</button></div>
    </div>
    ${data.guests.length ? `<div class="table-wrap"><table>
      <thead><tr><th scope="col"><input type="checkbox" id="all" aria-label="Select all shown guests" ${rows.length && rows.every((g) => selected.has(g.id)) ? 'checked' : ''}></th><th scope="col">Guest</th><th scope="col">Contact</th><th scope="col">Invitation</th><th scope="col">RSVP</th><th scope="col">Details</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${rows.map((g) => `<tr>
        <td><input type="checkbox" data-sel="${g.id}" ${selected.has(g.id) ? 'checked' : ''} aria-label="Select ${esc(g.first_name)} ${esc(g.last_name)}"></td>
        <td><strong>${esc(g.first_name)} ${esc(g.last_name)}</strong>${g.household ? `<div class="tiny muted">${esc(g.household)}</div>` : ''}${g.plus_one_allowed ? '<div class="tiny muted">+1 allowed</div>' : ''}</td>
        <td class="small">${g.email ? esc(g.email) : '<span class="muted">No email</span>'}${g.phone ? `<div class="muted">${esc(g.phone)}</div>` : ''}${g.unsubscribed ? '<div><span class="badge red">Unsubscribed</span></div>' : ''}</td>
        <td>${g.invitation_status === 'invited' ? `<span class="badge green">Invited</span>${g.invited_at ? `<div class="tiny muted">${esc(relativeTime(g.invited_at))}</div>` : ''}` : '<span class="badge">Not invited</span>'}</td>
        <td><span class="badge ${STATUS[g.rsvp_status][1]} dot">${STATUS[g.rsvp_status][0]}</span>${g.rsvp ? `<div class="tiny muted">${esc(relativeTime(g.rsvp.created_at))}</div>` : ''}</td>
        <td class="small">${g.rsvp && g.rsvp.attending === 'yes' ? `${g.rsvp.events.map((e) => esc(eventName(e))).join(', ') || '—'}${g.rsvp.plus_one_name ? `<div>+ ${esc(g.rsvp.plus_one_name)}</div>` : ''}${g.rsvp.dietary ? `<div class="muted">Diet: ${esc(g.rsvp.dietary)}</div>` : ''}${g.rsvp.accessibility ? `<div class="muted">Access: ${esc(g.rsvp.accessibility)}</div>` : ''}${Object.values(g.rsvp.answers || {}).filter((a) => a.value).map((a) => `<div class="muted">${esc(a.label)}: ${esc(a.value)}</div>`).join('')}` : '<span class="muted">—</span>'}</td>
        <td><div class="row" style="gap:2px;flex-wrap:nowrap">
          <button class="btn btn-ghost btn-icon" type="button" data-share="${g.id}" aria-label="Share invitation with ${esc(g.first_name)}" title="Share invitation link">🔗</button>
          <button class="btn btn-ghost btn-icon" type="button" data-edit="${g.id}" aria-label="Edit ${esc(g.first_name)}" title="Edit">✎</button>
          <button class="btn btn-ghost btn-icon" type="button" data-history="${g.id}" aria-label="History for ${esc(g.first_name)}" title="Response & email history">⏱</button>
          <button class="btn btn-ghost btn-icon" type="button" data-del="${g.id}" aria-label="Delete ${esc(g.first_name)}" title="Delete">🗑</button></div></td>
      </tr>`).join('')}</tbody></table>${rows.length ? '' : '<div class="empty"><p>No guests match this filter.</p></div>'}</div>`
    : `<div class="card empty"><div class="empty-icon" aria-hidden="true">☺</div><h3>Your guest list is empty</h3><p>Add guests one by one or import a spreadsheet. Guests who RSVP through your website are added automatically.</p><div class="row" style="justify-content:center"><button class="btn btn-primary" type="button" data-add2>Add a guest</button><button class="btn btn-secondary" type="button" data-import2>Import CSV</button></div></div>`}`;

  $$('[data-filter]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.filter; render(); }));
  const search = $('#search');
  search.addEventListener('input', () => { query = search.value; const pos = search.selectionStart; render(); const s2 = $('#search'); s2.focus(); s2.setSelectionRange(pos, pos); });
  $('#add').addEventListener('click', () => editGuest());
  $('[data-add2]')?.addEventListener('click', () => editGuest());
  $('#import').addEventListener('click', importDialog);
  $('[data-import2]')?.addEventListener('click', importDialog);
  $('#all')?.addEventListener('change', (e) => { rows.forEach((g) => (e.target.checked ? selected.add(g.id) : selected.delete(g.id))); render(); });
  $$('[data-sel]').forEach((cb) => cb.addEventListener('change', () => { cb.checked ? selected.add(cb.dataset.sel) : selected.delete(cb.dataset.sel); $('#sel-count').textContent = selected.size ? `${selected.size} selected` : ''; $('#send').disabled = !selected.size; }));
  $('#send').addEventListener('click', sendInvites);
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => editGuest(data.guests.find((g) => g.id === b.dataset.edit))));
  $$('[data-share]').forEach((b) => b.addEventListener('click', () => shareDialog(data.guests.find((g) => g.id === b.dataset.share))));
  $$('[data-history]').forEach((b) => b.addEventListener('click', () => historyDialog(data.guests.find((g) => g.id === b.dataset.history))));
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const g = data.guests.find((x) => x.id === b.dataset.del);
    if (!await confirmDialog(`Remove ${g.first_name} ${g.last_name} and their RSVP from your guest list?`, { title: 'Delete guest?', confirmLabel: 'Delete', danger: true })) return;
    try { await api('DELETE', `/api/weddings/${wid}/guests/${g.id}`); selected.delete(g.id); toast('Guest removed'); load(); } catch (err) { showError(err); }
  }));
}

function editGuest(g = null) {
  const form = document.createElement('form');
  form.className = 'stack';
  form.noValidate = true;
  form.innerHTML = `<div class="grid-2"><label class="field"><span>First name</span><input type="text" name="first_name" required maxlength="80" value="${esc(g?.first_name || '')}"></label>
    <label class="field"><span>Last name</span><input type="text" name="last_name" maxlength="80" value="${esc(g?.last_name || '')}"></label></div>
    <div class="grid-2"><label class="field"><span>Email</span><input type="email" name="email" maxlength="200" value="${esc(g?.email || '')}"></label>
    <label class="field"><span>Phone / WhatsApp</span><input type="tel" name="phone" maxlength="40" value="${esc(g?.phone || '')}"></label></div>
    <label class="field"><span>Household or group <span class="hint">e.g. “The Okafor family”</span></span><input type="text" name="household" maxlength="120" value="${esc(g?.household || '')}"></label>
    <label class="switch"><input type="checkbox" name="plus_one_allowed" ${g?.plus_one_allowed ? 'checked' : ''}> Can bring a plus-one</label>
    ${data.events.some((e) => e.restricted) ? `<label class="switch"><input type="checkbox" name="private_events" ${g?.private_events ? 'checked' : ''}> Invited to private events (${esc(data.events.filter((e) => e.restricted).map((e) => e.name).join(', '))})</label>` : ''}
    ${g ? `<label class="field"><span>Invitation status</span><select name="invitation_status"><option value="not_invited" ${g.invitation_status === 'not_invited' ? 'selected' : ''}>Not invited yet</option><option value="invited" ${g.invitation_status === 'invited' ? 'selected' : ''}>Invited</option></select><span class="hint">Invitation status is separate from their RSVP.</span></label>` : ''}
    <label class="field"><span>Private notes</span><textarea name="notes" rows="2" maxlength="1000">${esc(g?.notes || '')}</textarea></label>
    <p class="form-error" role="alert" hidden></p>`;
  modal({
    title: g ? 'Edit guest' : 'Add a guest', body: form,
    actions: [{ label: 'Cancel' }, {
      label: g ? 'Save' : 'Add guest', className: 'btn-primary', onClick: async () => {
        const fd = new FormData(form);
        const body = Object.fromEntries(fd);
        body.plus_one_allowed = fd.has('plus_one_allowed');
        body.private_events = fd.has('private_events');
        try {
          if (g) await api('PATCH', `/api/weddings/${wid}/guests/${g.id}`, body); else await api('POST', `/api/weddings/${wid}/guests`, body);
          toast(g ? 'Guest updated' : 'Guest added', 'success');
          load();
          return true;
        } catch (err) {
          const e = $('.form-error', form); e.textContent = err.message; e.hidden = false;
          setFieldErrors(form, err.data?.fields);
          return false;
        }
      }
    }]
  });
  setTimeout(() => form.elements.first_name.focus(), 50);
}

function importDialog() {
  const body = document.createElement('div');
  body.className = 'stack';
  body.innerHTML = `<p>Upload a CSV file exported from Excel, Google Sheets or Numbers. The first row should contain column names such as:</p>
    <pre class="json">first_name,last_name,email,phone,household,plus_one
Grace,Okafor,grace@example.com,+234…,Okafor family,yes</pre>
    <p class="small muted">A single “name” column also works. Guests whose email is already on your list are skipped.</p>
    <label class="field"><span>CSV file</span><input type="file" accept=".csv,text/csv" data-file></label>
    <details><summary class="small">Or paste the rows</summary><textarea data-paste rows="6" style="margin-top:8px" placeholder="name,email"></textarea></details>
    <div data-result></div>`;
  modal({
    title: 'Import guests', body, wide: true,
    actions: [{ label: 'Close' }, {
      label: 'Import', className: 'btn-primary', onClick: async (e) => {
        const file = $('[data-file]', body).files[0];
        const text = file ? await file.text() : $('[data-paste]', body).value;
        if (!text.trim()) { toast('Choose a file or paste some rows first.', 'error'); return false; }
        e.target.disabled = true;
        try {
          const r = await api('POST', `/api/weddings/${wid}/guests/import`, text);
          $('[data-result]', body).innerHTML = `<p class="notice">Added ${r.added} of ${r.total} rows.</p>${r.skipped.length ? `<p class="small"><strong>Skipped:</strong></p><ul class="small">${r.skipped.slice(0, 50).map((s) => `<li>Row ${s.line}: ${esc(s.reason)}</li>`).join('')}</ul>` : ''}`;
          load();
        } catch (err) { $('[data-result]', body).innerHTML = `<p class="form-error">${esc(err.message)}</p>`; }
        e.target.disabled = false;
        return false;
      }
    }]
  });
}

async function sendInvites() {
  const guests = data.guests.filter((g) => selected.has(g.id));
  const withEmail = guests.filter((g) => g.email && !g.unsubscribed);
  const preview = await api('POST', `/api/weddings/${wid}/automations/invitation/preview`, {}).catch(() => null);
  const body = document.createElement('div');
  body.className = 'stack';
  body.innerHTML = `<p>Send an invitation email to <strong>${withEmail.length}</strong> guest${withEmail.length === 1 ? '' : 's'}${guests.length - withEmail.length ? ` (${guests.length - withEmail.length} without an email address or unsubscribed will be skipped — share their link by WhatsApp instead)` : ''}.</p>
    <p class="small muted">Each guest gets a personal link that fills in their RSVP. You can change the message on the <a href="/app/emails?id=${wid}">Emails</a> page.</p>
    ${preview ? `<iframe class="email-preview" sandbox="" title="Invitation email preview"></iframe>` : ''}`;
  if (preview) $('iframe', body).srcdoc = preview.html;
  modal({
    title: 'Send invitations', body, wide: true,
    actions: [{ label: 'Cancel' }, {
      label: `Send ${withEmail.length} invitation${withEmail.length === 1 ? '' : 's'}`, className: 'btn-primary', onClick: async (e) => {
        if (!withEmail.length) { toast('None of the selected guests have an email address.', 'error'); return false; }
        e.target.disabled = true;
        try {
          const r = await api('POST', `/api/weddings/${wid}/guests/send-invitations`, { guest_ids: guests.map((g) => g.id) });
          const parts = [];
          if (r.queued) parts.push(`${r.queued} invitation${r.queued === 1 ? '' : 's'} sending`);
          if (r.duplicate) parts.push(`${r.duplicate} already sent today`);
          if (r.skipped_no_email) parts.push(`${r.skipped_no_email} without email`);
          if (r.suppressed) parts.push(`${r.suppressed} unsubscribed`);
          if (r.not_configured) toast('Email sending is not set up on this server yet, so no invitations were sent. Share the links by WhatsApp or copy them instead.', 'error', 9000);
          else toast(parts.join(' · ') || 'Done', 'success', 6000);
          selected.clear();
          load();
        } catch (err) { showError(err); }
        return true;
      }
    }]
  });
}

function shareDialog(g) {
  const link = inviteLink(g);
  const msg = `Hi ${g.first_name}! You're invited to ${summary.wedding.names}'s wedding. Everything you need — and your personal RSVP — is here: ${link}`;
  const phone = (g.phone || '').replace(/[^\d]/g, '');
  const body = `<div class="stack"><p>Share ${esc(g.first_name)}'s personal invitation link. It fills in their name on the RSVP form.</p>
    <div class="url-box"><a href="${esc(link)}" target="_blank" rel="noopener">${esc(link.replace(/^https?:\/\//, ''))}</a></div>
    <p class="small muted">Invitation code: <strong>${esc(g.invite_code)}</strong></p>
    <div class="row"><a class="btn btn-secondary btn-sm" data-ch="whatsapp" href="https://wa.me/${phone}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">WhatsApp</a>
    <a class="btn btn-secondary btn-sm" data-ch="sms" href="sms:${esc(g.phone || '')}?&body=${encodeURIComponent(msg)}">Text message</a>
    <button class="btn btn-secondary btn-sm" type="button" data-ch="link">Copy message</button></div>
    ${data.published ? '' : '<p class="notice warn small">Your website is not published yet, so this link will not work for guests.</p>'}</div>`;
  const dlg = modal({ title: `Invite ${g.first_name}`, body });
  $$('[data-ch]', dlg).forEach((el) => el.addEventListener('click', async () => {
    if (el.dataset.ch === 'link') await copyText(msg);
    if (g.invitation_status !== 'invited') {
      await api('POST', `/api/weddings/${wid}/guests/${g.id}/mark-invited`, { channel: el.dataset.ch }).catch(() => {});
      load();
    }
  }));
}

async function historyDialog(g) {
  try {
    const h = await api('GET', `/api/weddings/${wid}/guests/${g.id}/history`);
    const eventName = (id) => data.events.find((e) => e.id === id)?.name || id;
    modal({
      title: `${g.first_name} ${g.last_name}`, wide: true,
      body: `<div class="stack"><h3>RSVP responses</h3>${h.submissions.length ? `<ul class="stack-sm" style="padding-left:18px">${h.submissions.map((s) => `<li>${s.is_latest ? '<span class="badge green">Latest</span> ' : ''}<strong>${s.attending === 'yes' ? 'Attending' : 'Declined'}</strong> · ${esc(new Date(s.created_at).toLocaleString())}${s.events.length ? `<br><span class="small muted">Events: ${s.events.map((e) => esc(eventName(e))).join(', ')}</span>` : ''}${s.plus_one_name ? `<br><span class="small muted">Plus-one: ${esc(s.plus_one_name)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="muted">No response yet.</p>'}
        <h3>Invitations</h3>${h.invitations.length ? `<ul class="small" style="padding-left:18px">${h.invitations.map((i) => `<li>${esc(i.channel)} · ${esc(new Date(i.created_at).toLocaleString())}</li>`).join('')}</ul>` : '<p class="muted small">Not invited yet.</p>'}
        <h3>Emails</h3>${h.emails.length ? `<ul class="small" style="padding-left:18px">${h.emails.map((m) => `<li>${esc(m.type.replace(/_/g, ' '))} · <strong>${esc(m.status.replace(/_/g, ' '))}</strong> · ${esc(new Date(m.created_at).toLocaleString())}${m.last_error ? `<br><span class="muted">${esc(m.last_error)}</span>` : ''}</li>`).join('')}</ul>` : '<p class="muted small">No emails yet.</p>'}</div>`
    });
  } catch (err) { showError(err); }
}

await load();
