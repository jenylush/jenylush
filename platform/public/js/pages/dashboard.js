import { api, $, esc, appChrome, currentWedding, toast, showError, copyText, track, formatDate, confirmDialog } from '../api.js';
import { publishFlow } from '../publish.js';
import { budgetSummary, formatMoney } from '/shared/budget.js';

const summary = await currentWedding();
if (summary) {
  const w = summary.wedding;
  const { me, config } = await appChrome({ weddingId: w.id });
  document.title = `${w.names} — Dashboard`;
  render(summary, me, config);
}

function countdownParts(iso) {
  const diff = Date.parse(iso) - Date.now();
  if (!iso || isNaN(diff)) return null;
  if (diff <= 0) return { done: true };
  return { days: Math.floor(diff / 864e5), hours: Math.floor(diff / 36e5) % 24, minutes: Math.floor(diff / 6e4) % 60 };
}

function render(s, me, config) {
  const w = s.wedding;
  const cd = countdownParts(w.wedding_at_utc);
  const pub = w.status === 'published';
  const shareText = `${w.names} are getting married! Find all the details and RSVP here: ${s.urls.primary}`;
  const setupIncomplete = !w.first_published_at && w.setup_step < 7;
  const storagePct = Math.min(100, Math.round((s.storage.bytes / (s.storage.limit_mb * 1048576)) * 100));
  const required = s.checklist.items.filter((i) => i.required);
  const done = s.checklist.items.filter((i) => i.ok).length;
  const devLink = sessionStorage.getItem('dev_verification_link');

  $('#main').innerHTML = `
    ${!me.email_verified ? `<div class="notice warn row between" style="margin-bottom:18px"><span>Please confirm your email address (${esc(me.email)}) so you can publish your website.${devLink ? ` <span class="tiny">Development mode: <a href="${esc(devLink)}">confirm now</a></span>` : ''}</span><button class="btn btn-secondary btn-sm" type="button" id="resend">Resend email</button></div>` : ''}
    ${w.unpublished_reason?.startsWith('admin:') ? '<div class="form-error" style="margin-bottom:18px">Your website was taken offline by our team for review. Please contact support.</div>' : ''}
    ${setupIncomplete ? `<div class="card upgrade-card row between" style="margin-bottom:20px"><div><h3 style="margin:0">Finish setting up your website</h3><p class="muted small" style="margin:4px 0 0">You're on step ${Math.min(w.setup_step, 6)} of 6. Your progress is saved.</p></div><a class="btn btn-primary" href="/app/wizard?id=${w.id}">Continue setup</a></div>` : ''}
    <div class="dash-grid">
      <div class="stack">
        <section class="card hero-card" aria-labelledby="names">
          <div class="row between"><span class="badge ${pub ? 'green' : ''} dot">${pub ? (w.visibility === 'public' ? 'Published' : w.visibility === 'password' ? 'Published · password protected' : 'Published · private') : 'Draft — not published'}</span><span class="small muted">Template: <strong>${esc(s.template.name)}</strong></span></div>
          <p class="names" id="names">${esc(w.names)}</p>
          <p class="muted" style="margin:0">${w.wedding_date_local ? esc(formatDate(w.wedding_date_local)) : 'Add your wedding date'}${w.location ? ` · ${esc(w.location)}` : ''}</p>
          ${cd ? (cd.done ? '<p class="names" style="font-size:1.6rem;margin-top:16px">Congratulations — you\'re married! 🎉</p>' : `<div class="countdown-inline" aria-label="Time until the wedding"><div><strong>${cd.days}</strong><span>days</span></div><div><strong>${cd.hours}</strong><span>hours</span></div><div><strong>${cd.minutes}</strong><span>minutes</span></div></div>`) : ''}
          <div class="url-box"><a href="${esc(s.urls.primary)}" target="_blank" rel="noopener">${esc(s.urls.primary.replace(/^https?:\/\//, ''))}</a>
            <button class="btn btn-secondary btn-sm" type="button" data-copy>Copy link</button></div>
          <div class="row" style="margin-top:14px">
            ${pub ? `<a class="btn btn-secondary btn-sm" href="https://wa.me/?text=${encodeURIComponent(shareText)}" target="_blank" rel="noopener" data-share="whatsapp">Share on WhatsApp</a>
              <a class="btn btn-secondary btn-sm" href="mailto:?subject=${encodeURIComponent(`${w.names}'s wedding`)}&body=${encodeURIComponent(shareText)}" data-share="email">Share by email</a>
              ${navigator.share ? '<button class="btn btn-secondary btn-sm" type="button" data-native-share>More…</button>' : ''}` : '<span class="small muted">Publish your website to start sharing it with guests.</span>'}
          </div>
          ${w.unpublished_changes ? '<p class="notice warn small" style="margin-top:14px">You have changes that are not live yet. Publish to update your website.</p>' : ''}
        </section>

        <section aria-labelledby="rsvp-h">
          <div class="row between" style="margin-bottom:10px"><h2 id="rsvp-h" style="font-size:1.4rem;margin:0">Guests & RSVPs</h2><a class="small" href="/app/guests?id=${w.id}">View guest list →</a></div>
          <div class="stats">
            <div class="stat green"><strong>${s.rsvp.confirmed}</strong><span>Attending${s.rsvp.plus_ones ? ` (+${s.rsvp.plus_ones} guests)` : ''}</span></div>
            <div class="stat rose"><strong>${s.rsvp.declined}</strong><span>Declined</span></div>
            <div class="stat gold"><strong>${s.rsvp.pending}</strong><span>Not replied yet</span></div>
            <div class="stat"><strong>${w.visits}</strong><span>Website visits</span></div>
          </div>
          <p class="small muted" style="margin-top:8px">${s.rsvp.guests} on your guest list · ${s.rsvp.invited} invited${w.rsvp_deadline ? ` · RSVP deadline ${esc(formatDate(w.rsvp_deadline, { weekday: false }))}` : ''}</p>
        </section>

        <section class="card" aria-labelledby="qa-h">
          <h2 id="qa-h" style="font-size:1.4rem">Quick actions</h2>
          <div class="quick-actions">
            ${s.permissions.edit ? `<a href="/app/editor?id=${w.id}"><span class="qa-icon" aria-hidden="true">✎</span>Edit website</a>` : ''}
            <a href="/preview/${w.id}" target="_blank" rel="noopener" data-preview><span class="qa-icon" aria-hidden="true">◉</span>Preview</a>
            ${s.permissions.publish ? (pub ? `<button type="button" data-publish><span class="qa-icon" aria-hidden="true">↻</span>${w.unpublished_changes ? 'Publish changes' : 'Republish'}</button>` : `<button type="button" data-publish><span class="qa-icon" aria-hidden="true">★</span>Publish website</button>`) : ''}
            ${s.permissions.guests ? `<a href="/app/guests?id=${w.id}"><span class="qa-icon" aria-hidden="true">☺</span>Manage guests</a>` : ''}
            ${s.permissions.edit ? `<a href="/app/editor?id=${w.id}&tab=design"><span class="qa-icon" aria-hidden="true">Aa</span>Customise design</a>` : ''}
            <a href="/app/emails?id=${w.id}"><span class="qa-icon" aria-hidden="true">✉</span>Guest emails</a>
            <a href="/app/budget?id=${w.id}"><span class="qa-icon" aria-hidden="true">¤</span>Budget & gifts</a>
          </div>
          ${pub && s.permissions.publish ? '<p class="small" style="margin:14px 0 0"><button class="link-btn" type="button" data-unpublish>Unpublish website</button></p>' : ''}
        </section>
      </div>

      <aside class="stack">
        <section class="card" aria-labelledby="cl-h">
          <h2 id="cl-h" style="font-size:1.3rem">Website checklist</h2>
          <div class="progress" style="margin-bottom:14px" role="progressbar" aria-valuenow="${done}" aria-valuemin="0" aria-valuemax="${s.checklist.items.length}" aria-label="Checklist progress"><div style="width:${Math.round(done / s.checklist.items.length * 100)}%"></div></div>
          <ul class="checklist">${s.checklist.items.map((i) => `<li class="${i.ok ? 'ok' : ''}"><span class="tick" aria-hidden="true">${i.ok ? '✓' : ''}</span><span>${esc(i.label)}${i.required && !i.ok ? ' <span class="badge red">Required</span>' : ''}<span class="sr-only">${i.ok ? ' — done' : ' — to do'}</span></span></li>`).join('')}</ul>
          ${required.every((i) => i.ok) ? '' : '<p class="small muted" style="margin:12px 0 0">Complete the required items to publish.</p>'}
        </section>

        <section class="card" aria-labelledby="bud-h" id="budget-card"><h2 id="bud-h" style="font-size:1.3rem;margin:0 0 8px">Budget</h2><p class="small muted" style="margin:0">Loading…</p></section>

        <section class="card" aria-labelledby="plan-h">
          <div class="row between"><h2 id="plan-h" style="font-size:1.3rem;margin:0">Your plan</h2><span class="badge ${s.plan.id === 'free' ? '' : 'gold'}">${esc(s.plan.name)}</span></div>
          <p class="small muted" style="margin:10px 0 6px">Photo storage: ${(s.storage.bytes / 1048576).toFixed(1)} MB of ${s.storage.limit_mb} MB · ${s.storage.count} of ${s.storage.max_photos} photos</p>
          <div class="progress ${storagePct > 95 ? 'full' : storagePct > 80 ? 'warn' : ''}"><div style="width:${storagePct}%"></div></div>
          ${s.plan.id === 'free' ? '<div class="stack-sm" style="margin-top:16px"><p class="small" style="margin:0">Premium adds every template, full colour control, scheduled reminders and password protection.</p><a class="btn btn-secondary btn-sm" href="/app/upgrade" style="justify-self:start">Explore Premium</a></div>' : ''}
        </section>

        <section class="card-flat" aria-labelledby="ref-h">
          <h2 id="ref-h" style="font-size:1.15rem">Know another couple?</h2>
          <p class="small muted">Share ${esc(config.platform_name)} with friends who are planning their wedding.</p>
          <button class="btn btn-secondary btn-sm" type="button" data-referral>Copy invite link</button>
        </section>
      </aside>
    </div>`;

  loadBudgetCard(w.id);
  $('[data-copy]').addEventListener('click', () => { copyText(s.urls.primary); track('website_shared', { channel: 'copy' }, w.id); });
  document.querySelectorAll('[data-share]').forEach((a) => a.addEventListener('click', () => track('website_shared', { channel: a.dataset.share }, w.id)));
  $('[data-native-share]')?.addEventListener('click', async () => {
    try { await navigator.share({ title: `${w.names}'s wedding`, text: shareText, url: s.urls.primary }); track('website_shared', { channel: 'native' }, w.id); } catch { /* cancelled */ }
  });
  $('[data-preview]')?.addEventListener('click', () => track('preview_opened', { source: 'dashboard' }, w.id));
  $('[data-referral]').addEventListener('click', () => copyText(`${location.origin}/?ref=${me.referral_code}`));
  $('#resend')?.addEventListener('click', async () => {
    try {
      const r = await api('POST', '/api/auth/resend-verification');
      if (r.dev_verification_link) sessionStorage.setItem('dev_verification_link', r.dev_verification_link);
      toast(r.dev_verification_link ? 'No email provider configured — use the development link.' : 'Verification email sent. Check your inbox.', 'success');
      if (r.dev_verification_link) location.reload();
    } catch (err) { showError(err); }
  });
  $('[data-publish]')?.addEventListener('click', () => publishFlow(s));
  $('[data-unpublish]')?.addEventListener('click', async () => {
    if (!await confirmDialog('Guests will no longer be able to see your website or RSVP until you publish it again. Your content is kept.', { title: 'Unpublish your website?', confirmLabel: 'Unpublish', danger: true })) return;
    try { await api('POST', `/api/weddings/${w.id}/unpublish`); toast('Your website is now offline.'); location.reload(); } catch (err) { showError(err); }
  });
}

async function loadBudgetCard(wid) {
  const box = $('#budget-card');
  try {
    const b = await api('GET', `/api/weddings/${wid}/budget`);
    const s = budgetSummary(b, b.today);
    const m = (v) => formatMoney(v, b.settings.currency, { compact: true });
    const next = s.upcoming[0];
    box.innerHTML = `<h2 id="bud-h" style="font-size:1.3rem;margin:0 0 8px">Budget</h2>${s.total ? `
      <p class="small" style="margin:0 0 6px"><strong class="money">${m(s.committed)}</strong> committed of <span class="money">${m(s.total)}</span> · <span class="money">${m(s.paid)}</span> paid</p>
      <div class="progress ${s.committed > s.total ? 'full' : s.committed > s.total * 0.9 ? 'warn' : ''}" role="progressbar" aria-label="Budget used" aria-valuenow="${Math.round(s.used_pct || 0)}" aria-valuemin="0" aria-valuemax="100"><div style="width:${Math.min(100, s.used_pct || 0)}%"></div></div>
      ${s.overdue ? `<p class="small" style="color:var(--danger);margin:8px 0 0">⚠ ${s.overdue} overdue payment${s.overdue === 1 ? '' : 's'}</p>` : next ? `<p class="small muted" style="margin:8px 0 0">Next: ${esc(next.item)}, <span class="money">${m(next.balance)}</span> on ${esc(formatDate(next.due_date, { weekday: false }))}</p>` : ''}
      ${s.gifts.thank_you_pending ? `<p class="small muted" style="margin:4px 0 0">${s.gifts.thank_you_pending} thank-you note${s.gifts.thank_you_pending === 1 ? '' : 's'} to send</p>` : ''}`
      : '<p class="small muted" style="margin:0 0 10px">Set a total budget to track spending, payment due dates and gifts.</p>'}
      <a class="btn btn-secondary btn-sm" href="/app/budget?id=${wid}" style="margin-top:10px">Open budget & gifts</a>`;
  } catch { box.remove(); }
}
