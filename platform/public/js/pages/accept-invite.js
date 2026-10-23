import { api, $, esc, appChrome, param } from '../api.js';

await appChrome();
const main = $('#main');
try {
  const r = await api('POST', '/api/invites/accept', { token: param('token') });
  main.innerHTML = `<div class="card stack center" style="margin-top:40px"><h1>You're in!</h1><p>You can now help with this wedding website.</p><a class="btn btn-primary" href="/app?id=${esc(r.wedding_id)}" style="justify-self:center">Open the dashboard</a></div>`;
} catch (err) {
  main.innerHTML = `<div class="card stack center" style="margin-top:40px"><h1>We couldn't accept this invitation</h1><p class="form-error">${esc(err.message)}</p><a class="btn btn-secondary" href="/app" style="justify-self:center">Go to my dashboard</a></div>`;
}
