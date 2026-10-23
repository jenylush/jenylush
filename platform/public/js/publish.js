// Publish dialog shared by the dashboard and the editor.
import { api, esc, showError, copyText, track, modal } from './api.js';

export async function publishFlow(s, { onDone = () => location.reload(), beforePublish } = {}) {
  const w = s.wedding;
  const missing = s.checklist.items.filter((i) => i.required && !i.ok);
  const canNotify = s.plan.entitlements.email_workflows.includes('update_notification');
  const body = document.createElement('div');
  body.className = 'stack';
  body.innerHTML = missing.length
    ? `<p>Before publishing, please add:</p><ul>${missing.map((m) => `<li>${esc(m.label)}</li>`).join('')}</ul>`
    : `<p>Your website will be live at <strong>${esc(s.urls.primary)}</strong>.</p>
       ${s.checklist.items.filter((i) => !i.required && !i.ok).length ? `<p class="small muted">Optional, but recommended: ${s.checklist.items.filter((i) => !i.required && !i.ok).map((i) => esc(i.label.toLowerCase())).join(', ')}.</p>` : ''}
       ${w.first_published_at ? `<label class="check"><input type="checkbox" name="notify" ${canNotify ? '' : 'disabled'}> <span>Email guests who opted in about this update ${canNotify ? '' : '<span class="premium-tag">Premium</span>'}</span></label>
       <div class="stack-sm" data-notify-fields hidden><label class="field"><span>Subject</span><input type="text" name="subject" maxlength="150" placeholder="We've updated our wedding website"></label><label class="field"><span>Message</span><textarea name="message" rows="3" maxlength="3000" placeholder="We've added hotel suggestions and the full schedule."></textarea></label></div>` : ''}`;
  const notify = body.querySelector('[name=notify]');
  notify?.addEventListener('change', () => { body.querySelector('[data-notify-fields]').hidden = !notify.checked; });
  modal({
    title: w.first_published_at ? 'Publish your changes' : 'Publish your website',
    body,
    actions: missing.length ? [{ label: 'Close' }, { label: 'Open the editor', className: 'btn-primary', href: `/app/editor?id=${w.id}` }] : [
      { label: 'Cancel' },
      {
        label: 'Publish now', className: 'btn-primary', onClick: async (e, dlg) => {
          e.target.disabled = true;
          try {
            if (beforePublish) await beforePublish();
            const payload = notify?.checked ? { notify_guests: true, subject: body.querySelector('[name=subject]').value, message: body.querySelector('[name=message]').value } : {};
            const r = await api('POST', `/api/weddings/${w.id}/publish`, payload);
            dlg.close();
            modal({
              title: r.first ? 'Your website is live! 🎉' : 'Changes published',
              body: `<div class="stack"><p>Guests can now visit:</p><div class="url-box"><a href="${esc(r.urls.primary)}" target="_blank" rel="noopener">${esc(r.urls.primary)}</a></div>${r.notification_scheduled ? '<p class="small notice">Guests who opted in will get an update email shortly.</p>' : ''}</div>`,
              actions: [{ label: 'Copy link', onClick: () => { copyText(r.urls.primary); track('website_shared', { channel: 'copy' }, w.id); return false; } }, { label: 'Done', className: 'btn-primary', onClick: () => onDone?.(r) }]
            });
          } catch (err) { e.target.disabled = false; dlg.close(); showError(err); }
          return false;
        }
      }
    ]
  });
}
