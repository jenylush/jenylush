import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, signupVerified, createWedding, testImage } from './helpers.js';
import { processQueue } from '../src/mailer.js';
import { runDueMessages, syncSchedule } from '../src/notifications.js';

let app;
before(async () => { app = await startTestApp(); });
after(async () => { await app.stop(); });

async function flush() {
  runDueMessages(app.ctx.deps, new Date());
  await processQueue(app.ctx.db, app.ctx.provider, { baseUrl: 'http://localhost' });
}

async function uploadPhoto(client, weddingId, opts = {}) {
  const fd = new FormData();
  fd.append('file', new Blob([await testImage()], { type: 'image/jpeg' }), 'photo.jpg');
  if (opts.kind) fd.append('kind', opts.kind);
  return client.req('POST', `/api/weddings/${weddingId}/media`, fd, { json: false });
}

test('sign up, log out, log in, password reset', async () => {
  const c = app.client();
  const bad = await c.post('/api/auth/signup', { name: '', email: 'nope', password: 'short' });
  assert.equal(bad.status, 400);
  assert.ok(bad.data.fields.email && bad.data.fields.password && bad.data.fields.name);

  const { email } = await signupVerified(app, c);
  const me = await c.get('/api/auth/me');
  assert.equal(me.data.user.email, email);
  assert.equal(me.data.user.email_verified, true);
  assert.equal(me.data.user.plan.id, 'free');

  const dup = await c.post('/api/auth/signup', { name: 'X', email, password: 'another long password', accept_terms: true });
  assert.equal(dup.status, 409);

  await c.post('/api/auth/logout');
  assert.equal((await c.get('/api/auth/me')).data.user, null);
  assert.equal((await c.post('/api/auth/login', { email, password: 'wrong password!!' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { email, password: 'correct horse battery' })).status, 200);

  const forgot = await c.post('/api/auth/forgot', { email });
  assert.equal(forgot.status, 200);
  const log = app.ctx.db.get("SELECT text FROM email_delivery_logs WHERE type = 'reset_password' AND to_email = ?", email);
  const token = decodeURIComponent(/token=([^\s&]+)/.exec(log.text)[1]);
  const other = app.client();
  assert.equal((await other.post('/api/auth/reset', { token, password: 'a brand new password' })).status, 200);
  assert.equal((await other.post('/api/auth/reset', { token, password: 'a brand new password' })).status, 400, 'token is single use');
  assert.equal((await c.get('/api/auth/me')).data.user, null, 'old sessions are signed out after a reset');
  assert.equal((await app.client().post('/api/auth/login', { email, password: 'a brand new password' })).status, 200);
});

test('CSRF header is required for state-changing API calls', async () => {
  const res = await fetch(`${app.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
});

test('full couple journey: create, edit, upload, publish, RSVP, export', async () => {
  const c = app.client();
  await signupVerified(app, c);
  const w = await createWedding(c);
  assert.equal(w.slug, 'ada-and-ben');
  assert.equal(w.status, 'draft');

  // Draft is not public yet.
  const guest = app.client();
  assert.equal((await guest.get(`/w/${w.slug}`)).status, 404);

  // Editor save with design + sections.
  let draft = (await c.get(`/api/weddings/${w.id}/draft`)).data;
  assert.equal(draft.sections.length, 6);
  const story = draft.sections.find((s) => s.type === 'story');
  story.content.title = 'How it started';
  const save = await c.put(`/api/weddings/${w.id}/draft`, { version: draft.version, design: { template_id: 'rosewater', palette: draft.design.palette, font_pairing: 'romantic', animation: 'static' }, sections: draft.sections });
  assert.equal(save.status, 200, JSON.stringify(save.data));

  // Stale version is rejected instead of silently overwriting.
  const stale = await c.put(`/api/weddings/${w.id}/draft`, { version: draft.version, sections: draft.sections });
  assert.equal(stale.status, 409);

  // Photos.
  const up = await uploadPhoto(c, w.id);
  assert.equal(up.status, 201, JSON.stringify(up.data));
  assert.equal(up.data.asset.is_cover, 1, 'first gallery photo becomes the cover');
  assert.ok(up.data.asset.width <= 2000);
  const notImage = new FormData();
  notImage.append('file', new Blob(['hello'], { type: 'image/jpeg' }), 'fake.jpg');
  assert.equal((await c.req('POST', `/api/weddings/${w.id}/media`, notImage, { json: false })).status, 400);
  const unused = await uploadPhoto(c, w.id, { kind: 'library' });

  // Unpublished media is private.
  assert.equal((await guest.raw('GET', `/media/${up.data.asset.id}/400`)).status, 404);
  assert.equal((await c.raw('GET', `/media/${up.data.asset.id}/400`)).status, 200);

  // Publish.
  const pub = await c.post(`/api/weddings/${w.id}/publish`, {});
  assert.equal(pub.status, 200, JSON.stringify(pub.data));
  const page = await guest.get(`/w/${w.slug}`);
  assert.equal(page.status, 200);
  assert.match(page.data, /How it started/);
  assert.match(page.data, /t-rosewater/);
  assert.match(page.data, /og:title/);
  assert.match(page.data, /noindex/, 'search indexing is off by default');
  assert.equal((await guest.raw('GET', `/media/${up.data.asset.id}/1200`)).status, 200, 'published cover is visible');
  assert.equal((await guest.raw('GET', `/media/${unused.data.asset.id}/1200`)).status, 404, 'unused library photo stays private');

  // Editing the draft does not change the live site until republished.
  draft = (await c.get(`/api/weddings/${w.id}/draft`)).data;
  draft.sections.find((s) => s.type === 'story').content.title = 'Draft only title';
  await c.put(`/api/weddings/${w.id}/draft`, { version: draft.version, sections: draft.sections });
  assert.doesNotMatch((await guest.get(`/w/${w.slug}`)).data, /Draft only title/);
  assert.equal((await c.get(`/api/weddings/${w.id}`)).data.wedding.unpublished_changes, true);

  // Guest list + RSVP.
  const g1 = await c.post(`/api/weddings/${w.id}/guests`, { first_name: 'Cara', last_name: 'Diaz', email: 'cara@example.com', plus_one_allowed: true });
  assert.equal(g1.status, 201);
  assert.equal(g1.data.guest.rsvp_status, 'pending');
  assert.equal(g1.data.guest.invitation_status, 'not_invited');

  const lookup = await guest.post(`/w/${w.slug}/rsvp/lookup`, { code: g1.data.guest.invite_code.toLowerCase().replace('-', '') });
  assert.equal(lookup.status, 200);
  assert.equal(lookup.data.guest.first_name, 'Cara');

  const missing = await guest.post(`/w/${w.slug}/rsvp`, { name: '', attending: 'maybe' });
  assert.equal(missing.status, 400);
  const r1 = await guest.post(`/w/${w.slug}/rsvp`, { name: 'Cara Diaz', email: 'cara@example.com', attending: 'yes', events: ['ceremony', 'bogus'], plus_one: true, plus_one_name: 'Sam', invite_code: g1.data.guest.invite_code, updates_opt_in: true });
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  assert.equal(r1.data.updated, false);
  await flush();
  const confirmation = app.sent.find((m) => m.to === 'cara@example.com' && /RSVP/.test(m.subject));
  assert.ok(confirmation, 'RSVP confirmation email was sent');
  assert.match(confirmation.html, /Sam/);

  // Updating the RSVP keeps history and only one latest response.
  const r2 = await guest.post(`/w/${w.slug}/rsvp`, { name: 'Cara Diaz', email: 'cara@example.com', attending: 'no' });
  assert.equal(r2.data.updated, true);
  const hist = await c.get(`/api/weddings/${w.id}/guests/${g1.data.guest.id}/history`);
  assert.equal(hist.data.submissions.length, 2);
  assert.equal(hist.data.submissions.filter((s) => s.is_latest).length, 1);
  const list = await c.get(`/api/weddings/${w.id}/guests`);
  assert.equal(list.data.guests.find((g) => g.id === g1.data.guest.id).rsvp_status, 'declined');

  // Open RSVP from someone not on the list adds them, without duplicates on resubmit.
  await guest.post(`/w/${w.slug}/rsvp`, { name: 'Eve Fox', email: 'eve@example.com', attending: 'yes' });
  await guest.post(`/w/${w.slug}/rsvp`, { name: 'Eve Fox', email: 'EVE@example.com', attending: 'yes' });
  const summary = (await c.get(`/api/weddings/${w.id}`)).data;
  assert.equal(summary.rsvp.guests, 2);
  assert.equal(summary.rsvp.confirmed, 1);
  assert.equal(summary.rsvp.declined, 1);
  assert.ok(summary.wedding.visits >= 1);

  // CSV export (and formula-injection guard).
  await c.post(`/api/weddings/${w.id}/guests`, { first_name: '=HYPERLINK("x")', last_name: 'Bad' });
  const csv = await c.get(`/api/weddings/${w.id}/guests/export.csv`);
  assert.equal(csv.status, 200);
  assert.match(csv.data, /Cara,Diaz,cara@example.com/);
  assert.match(csv.data, /'=HYPERLINK/);
});

test('another couple cannot read or change a wedding they do not belong to', async () => {
  const owner = app.client();
  await signupVerified(app, owner);
  const w = await createWedding(owner, { partner1: 'Priya', partner2: 'Sam' });
  const intruder = app.client();
  await signupVerified(app, intruder);
  for (const [method, url] of [['GET', `/api/weddings/${w.id}`], ['GET', `/api/weddings/${w.id}/draft`], ['PUT', `/api/weddings/${w.id}/draft`], ['GET', `/api/weddings/${w.id}/guests`], ['GET', `/api/weddings/${w.id}/guests/export.csv`], ['POST', `/api/weddings/${w.id}/publish`], ['PATCH', `/api/weddings/${w.id}/settings`]]) {
    const r = await intruder.req(method, url, method === 'GET' ? undefined : {});
    assert.equal(r.status, 404, `${method} ${url} should be hidden from non-members`);
  }
  assert.equal((await intruder.get(`/preview/${w.id}`)).status, 404);
  // Slug collisions are prevented.
  const taken = await intruder.patch(`/api/weddings/${(await createWedding(intruder, { partner1: 'Zoe', partner2: 'Yan' })).id}/settings`, { slug: w.slug });
  assert.equal(taken.status, 409);
});

test('co-owner invitations respect permissions', async () => {
  const owner = app.client();
  await signupVerified(app, owner);
  const w = await createWedding(owner, { partner1: 'Lia', partner2: 'Tom' });
  const helper = app.client();
  const { email } = await signupVerified(app, helper);
  const inv = await owner.post(`/api/weddings/${w.id}/members`, { email, can_edit: true, can_manage_guests: false });
  assert.equal(inv.status, 201);
  const log = app.ctx.db.get("SELECT text FROM email_delivery_logs WHERE type = 'coowner_invite' AND to_email = ?", email);
  const token = decodeURIComponent(/token=([^\s&]+)/.exec(log.text)[1]);
  assert.equal((await helper.post('/api/invites/accept', { token })).status, 200);
  assert.equal((await helper.get(`/api/weddings/${w.id}/draft`)).status, 200);
  assert.equal((await helper.get(`/api/weddings/${w.id}/guests`)).status, 403, 'no guest access granted');
  assert.equal((await helper.post(`/api/weddings/${w.id}/publish`, {})).status, 403, 'no publish access granted');
  // Free plan allows one collaborator.
  assert.equal((await owner.post(`/api/weddings/${w.id}/members`, { email: 'second@example.com' })).status, 402);
});

test('free plan limits explain the upgrade and keep content', async () => {
  const c = app.client();
  await signupVerified(app, c);
  const w = await createWedding(c, { partner1: 'Noor', partner2: 'Ali' });
  const draft = (await c.get(`/api/weddings/${w.id}/draft`)).data;
  const premiumTpl = await c.put(`/api/weddings/${w.id}/draft`, { version: draft.version, design: { template_id: 'gilded' } });
  assert.equal(premiumTpl.status, 402);
  assert.equal(premiumTpl.data.code, 'plan_limit');
  assert.equal(premiumTpl.data.feature, 'template');
  const expressive = await c.put(`/api/weddings/${w.id}/draft`, { version: draft.version, design: { animation: 'expressive' } });
  assert.equal(expressive.status, 402);
  const custom = await c.put(`/api/weddings/${w.id}/draft`, { version: draft.version, design: { palette: { ...draft.design.palette, accent: '#00ff00' } } });
  assert.equal(custom.status, 402, 'individual colour overrides are premium');
  const generated = await c.put(`/api/weddings/${w.id}/draft`, { version: draft.version, design: { palette: (await import('../shared/color.js')).suggestPalette('#336699') } });
  assert.equal(generated.status, 200, 'a palette generated from one primary colour is allowed');
  const pw = await c.patch(`/api/weddings/${w.id}/settings`, { visibility: 'password', site_password: 'secret' });
  assert.equal(pw.status, 402);
  const reminder = await c.put(`/api/weddings/${w.id}/automations/rsvp_reminder`, { enabled: true });
  assert.equal(reminder.status, 402);

  // Admin grants premium (no payment involved) -> features unlock; downgrade keeps the saved design.
  const admin = app.client();
  await signupVerified(app, admin, 'admin@example.com');
  const me = (await c.get('/api/auth/me')).data.user;
  assert.equal((await admin.patch(`/api/admin/users/${me.id}`, { plan_id: 'premium' })).status, 200);
  const v = (await c.get(`/api/weddings/${w.id}/draft`)).data.version;
  assert.equal((await c.put(`/api/weddings/${w.id}/draft`, { version: v, design: { template_id: 'gilded', animation: 'expressive' } })).status, 200);
  await admin.patch(`/api/admin/users/${me.id}`, { plan_id: 'free' });
  const after = (await c.get(`/api/weddings/${w.id}/draft`)).data;
  assert.equal(after.design.template_id, 'gilded', 'downgrade does not remove saved premium choices');
  assert.equal((await c.put(`/api/weddings/${w.id}/draft`, { version: after.version, design: after.design, sections: after.sections })).status, 200, 'saving unchanged premium values still works');

  // Checkout is honest about payments being off.
  const checkout = await c.post('/api/account/checkout', { plan_id: 'premium' });
  assert.equal(checkout.status, 501);
  assert.equal((await c.post('/api/account/upgrade-interest', { plan_id: 'premium', feature: 'template' })).status, 200);
});

test('sections can be hidden, removed and restored without losing content', async () => {
  const c = app.client();
  await signupVerified(app, c);
  const w = await createWedding(c, { partner1: 'Kofi', partner2: 'Esi' });
  let d = (await c.get(`/api/weddings/${w.id}/draft`)).data;
  const story = d.sections.find((s) => s.type === 'story');
  story.content.intro = 'Keep me safe';
  story.status = 'removed';
  d.sections.push({ id: crypto.randomUUID(), type: 'faq', status: 'visible', content: { title: 'FAQ', items: [{ q: 'Parking?', a: 'Yes' }] }, settings: {} });
  assert.equal((await c.put(`/api/weddings/${w.id}/draft`, { version: d.version, sections: d.sections })).status, 200);
  d = (await c.get(`/api/weddings/${w.id}/draft`)).data;
  const removed = d.sections.find((s) => s.type === 'story');
  assert.equal(removed.status, 'removed');
  assert.equal(removed.content.intro, 'Keep me safe');
  removed.status = 'visible';
  assert.equal((await c.put(`/api/weddings/${w.id}/draft`, { version: d.version, sections: d.sections })).status, 200);
  d = (await c.get(`/api/weddings/${w.id}/draft`)).data;
  assert.equal(d.sections.find((s) => s.type === 'story').status, 'visible');
  const hero = d.sections.find((s) => s.type === 'hero');
  hero.status = 'removed';
  assert.equal((await c.put(`/api/weddings/${w.id}/draft`, { version: d.version, sections: d.sections })).status, 400, 'welcome section can only be hidden');
  // Premium-only section on free plan.
  d.sections.find((s) => s.type === 'hero').status = 'visible';
  d.sections.push({ id: crypto.randomUUID(), type: 'party', status: 'visible', content: {}, settings: {} });
  assert.equal((await c.put(`/api/weddings/${w.id}/draft`, { version: d.version, sections: d.sections })).status, 402);
});

test('password-protected and private sites', async () => {
  const owner = app.client();
  const { user } = await signupVerified(app, owner);
  const admin = app.client();
  await signupVerified(app, admin, `admin2-${Date.now()}@example.com`);
  app.ctx.db.run("UPDATE users SET role = 'admin' WHERE email LIKE 'admin2-%'");
  await admin.patch(`/api/admin/users/${user.id}`, { plan_id: 'premium' });
  const w = await createWedding(owner, { partner1: 'Ivy', partner2: 'Jon' });
  await owner.post(`/api/weddings/${w.id}/publish`, {});
  assert.equal((await owner.patch(`/api/weddings/${w.id}/settings`, { visibility: 'password', site_password: 'garden' })).status, 200);
  const g = app.client();
  const locked = await g.get(`/w/${w.slug}`);
  assert.match(locked.data, /password protected/);
  const wrong = await g.req('POST', `/w/${w.slug}/unlock`, 'password=nope', { json: false, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(wrong.status, 401);
  const right = await g.req('POST', `/w/${w.slug}/unlock`, 'password=garden', { json: false, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(right.status, 303);
  assert.match((await g.get(`/w/${w.slug}`)).data, /Ivy/);
  await owner.patch(`/api/weddings/${w.id}/settings`, { visibility: 'private' });
  assert.equal((await g.get(`/w/${w.slug}`)).status, 404);
  assert.equal((await owner.get(`/w/${w.slug}`)).status, 200, 'members can still see a private site');
});

test('email automation: schedule in wedding timezone, exclude responders, reschedule, no duplicates, retries', async () => {
  const c = app.client();
  const { user } = await signupVerified(app, c);
  app.ctx.db.run("INSERT INTO user_subscriptions (id, user_id, plan_id, status, source, started_at, created_at) VALUES (?, ?, 'premium', 'active', 'admin_grant', ?, ?)", crypto.randomUUID(), user.id, new Date().toISOString(), new Date().toISOString());
  const soon = new Date(Date.now() + 30 * 864e5);
  const dateStr = soon.toISOString().slice(0, 10);
  const w = await createWedding(c, { partner1: 'Mia', partner2: 'Leo', wedding_date_local: `${dateStr}T16:00`, timezone: 'America/New_York' });
  await c.post(`/api/weddings/${w.id}/publish`, {});
  const deadline = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  await c.patch(`/api/weddings/${w.id}/settings`, { rsvp_deadline: deadline });
  const a = (await c.post(`/api/weddings/${w.id}/guests`, { first_name: 'Ann', email: 'ann@example.com' })).data.guest;
  const b = (await c.post(`/api/weddings/${w.id}/guests`, { first_name: 'Bo', email: 'bo@example.com' })).data.guest;
  await c.post(`/api/weddings/${w.id}/guests/send-invitations`, { guest_ids: [a.id, b.id] });
  const again = await c.post(`/api/weddings/${w.id}/guests/send-invitations`, { guest_ids: [a.id, b.id] });
  assert.equal(again.data.duplicate, 2, 'sending twice the same day does not duplicate');
  await flush();
  assert.equal(app.sent.filter((m) => m.to === 'ann@example.com' && /invited/i.test(m.subject)).length, 1);

  const en = await c.put(`/api/weddings/${w.id}/automations/rsvp_reminder`, { enabled: true, config: { days_before_deadline: [3], send_hour: 9 } });
  assert.equal(en.status, 200, JSON.stringify(en.data));
  let pending = app.ctx.db.all("SELECT * FROM scheduled_messages WHERE wedding_id = ? AND type = 'rsvp_reminder' AND status = 'pending'", w.id);
  assert.equal(pending.length, 1);
  // 09:00 in New York on (deadline - 3 days) is 13:00 or 14:00 UTC depending on DST.
  assert.match(pending[0].send_at, /T1[34]:00:00/);

  // Moving the deadline cancels the obsolete reminder and schedules a new one.
  const newDeadline = new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10);
  await c.patch(`/api/weddings/${w.id}/settings`, { rsvp_deadline: newDeadline });
  const all = app.ctx.db.all("SELECT * FROM scheduled_messages WHERE wedding_id = ? AND type = 'rsvp_reminder'", w.id);
  assert.equal(all.filter((m) => m.status === 'cancelled').length, 1);
  pending = all.filter((m) => m.status === 'pending');
  assert.equal(pending.length, 1);

  // Ann responds; when the reminder fires only Bo gets it.
  const g = app.client();
  await g.post(`/w/${w.slug}/rsvp`, { name: 'Ann', email: 'ann@example.com', attending: 'yes', invite_code: a.invite_code });
  const fireAt = new Date(new Date(pending[0].send_at).getTime() + 1000);
  await processQueue(app.ctx.db, app.ctx.provider, {}); // send Ann's confirmation first
  app.emailProvider.failNext = 1; // first send attempt hits a transient failure
  runDueMessages(app.ctx.deps, fireAt);
  runDueMessages(app.ctx.deps, fireAt); // second tick must not double-send
  await processQueue(app.ctx.db, app.ctx.provider, {});
  const reminderRows = app.ctx.db.all("SELECT * FROM email_delivery_logs WHERE wedding_id = ? AND type = 'rsvp_reminder'", w.id);
  assert.deepEqual(reminderRows.map((r) => r.to_email), ['bo@example.com']);
  assert.equal(reminderRows[0].status, 'queued', 'transient failure is queued for retry');
  assert.equal(reminderRows[0].attempts, 1);
  app.ctx.db.run('UPDATE email_delivery_logs SET next_attempt_at = ? WHERE id = ?', new Date().toISOString(), reminderRows[0].id);
  await processQueue(app.ctx.db, app.ctx.provider, {});
  assert.equal(app.ctx.db.get('SELECT status FROM email_delivery_logs WHERE id = ?', reminderRows[0].id).status, 'sent');

  // Changing the wedding date recalculates final reminders.
  await c.put(`/api/weddings/${w.id}/automations/final_reminders`, { enabled: true, config: { days_before: [7, 1] } });
  assert.equal(app.ctx.db.get("SELECT COUNT(*) AS n FROM scheduled_messages WHERE wedding_id = ? AND type = 'final_reminders' AND status = 'pending'", w.id).n, 2);
  const d = (await c.get(`/api/weddings/${w.id}/draft`)).data;
  const later = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  await c.put(`/api/weddings/${w.id}/draft`, { version: d.version, wedding: { wedding_date_local: `${later}T16:00` } });
  const finals = app.ctx.db.all("SELECT * FROM scheduled_messages WHERE wedding_id = ? AND type = 'final_reminders'", w.id);
  assert.equal(finals.filter((m) => m.status === 'pending').length, 2);
  assert.ok(finals.filter((m) => m.status === 'pending').every((m) => m.occurrence_key.endsWith(String(later.slice(0, 7))) || m.send_at > new Date(Date.now() + 40 * 864e5).toISOString()));

  // Pausing cancels everything pending; unpausing brings future messages back.
  await c.patch(`/api/weddings/${w.id}/settings`, { automation_paused: true });
  assert.equal(app.ctx.db.get("SELECT COUNT(*) AS n FROM scheduled_messages WHERE wedding_id = ? AND status = 'pending'", w.id).n, 0);
  await c.patch(`/api/weddings/${w.id}/settings`, { automation_paused: false });
  assert.ok(app.ctx.db.get("SELECT COUNT(*) AS n FROM scheduled_messages WHERE wedding_id = ? AND status = 'pending'", w.id).n >= 2);

  // Non-essential updates only go to guests who opted in; unsubscribe is honoured.
  const upd = await c.post(`/api/weddings/${w.id}/publish`, { notify_guests: true, subject: 'New hotel info', message: 'See the travel section.' });
  assert.equal(upd.status, 200);
  await flush();
  assert.equal(app.sent.filter((m) => m.subject === 'New hotel info').length, 0, 'nobody opted in yet');
  const preview = await c.post(`/api/weddings/${w.id}/automations/invitation/preview`, { config: { message: 'Custom note' } });
  assert.match(preview.data.html, /Custom note/);
});

test('timezone conversion handles DST', async () => {
  const { zonedToUtc, deadlinePassed } = await import('../src/timezone.js');
  assert.equal(zonedToUtc('2026-07-01T12:00', 'Europe/London').toISOString(), '2026-07-01T11:00:00.000Z');
  assert.equal(zonedToUtc('2026-01-01T12:00', 'Europe/London').toISOString(), '2026-01-01T12:00:00.000Z');
  assert.equal(zonedToUtc('2026-03-29T12:00', 'Africa/Lagos').toISOString(), '2026-03-29T11:00:00.000Z');
  assert.equal(zonedToUtc('2026-11-01T09:00', 'America/New_York').toISOString(), '2026-11-01T14:00:00.000Z');
  assert.equal(deadlinePassed('2026-05-01', 'Asia/Tokyo', new Date('2026-05-01T14:00:00Z')), false);
  assert.equal(deadlinePassed('2026-05-01', 'Asia/Tokyo', new Date('2026-05-01T15:00:00Z')), true);
});

test('colour system keeps text readable', async () => {
  const { resolvePalette, contrastRatio } = await import('../shared/color.js');
  const { effective, warnings } = resolvePalette({ primary: '#ffeeee', secondary: '#ffffff', accent: '#ffff00', background: '#ffffff', surface: '#fafafa', text: '#eeeeee' });
  assert.ok(contrastRatio(effective.text, '#ffffff') >= 4.5);
  assert.ok(contrastRatio(effective.link, '#ffffff') >= 4.5);
  assert.ok(contrastRatio(effective.onPrimary, effective.button) >= 4.5);
  assert.ok(warnings.length >= 1);
});

test('CSV import maps headers and skips bad rows', async () => {
  const c = app.client();
  await signupVerified(app, c);
  const w = await createWedding(c, { partner1: 'Rae', partner2: 'Ola' });
  const csv = 'Name,Email,Phone,Plus One\n"Grace Hopper",grace@example.com,123,yes\nAlan Turing,not-an-email,,\n,missing@example.com,,\n"Ada Lovelace, Countess",ada@example.com,,no\n';
  const r = await c.req('POST', `/api/weddings/${w.id}/guests/import`, csv, { json: false, headers: { 'content-type': 'text/csv' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.added, 2);
  assert.equal(r.data.skipped.length, 2);
  const list = (await c.get(`/api/weddings/${w.id}/guests`)).data.guests;
  assert.ok(list.find((g) => g.first_name === 'Grace' && g.plus_one_allowed));
  assert.ok(list.find((g) => g.first_name === 'Ada' && g.last_name === 'Lovelace, Countess'));
});

test('account export and deletion remove the couple’s data', async () => {
  const c = app.client();
  await signupVerified(app, c);
  const w = await createWedding(c, { partner1: 'Del', partner2: 'Ete' });
  await uploadPhoto(c, w.id);
  const exp = await c.get('/api/account/export');
  assert.equal(exp.status, 200);
  assert.equal(exp.data.weddings.length, 1);
  assert.equal((await c.del('/api/account', { password: 'correct horse battery', confirm: 'nope' })).status, 400);
  assert.equal((await c.del('/api/account', { password: 'correct horse battery', confirm: 'delete my account' })).status, 200);
  assert.equal(app.ctx.db.get('SELECT COUNT(*) AS n FROM weddings WHERE id = ?', w.id).n, 0);
  assert.equal(app.ctx.db.get('SELECT COUNT(*) AS n FROM media_assets WHERE wedding_id = ?', w.id).n, 0);
});

test('admin metrics and moderation', async () => {
  const admin = app.client();
  await admin.post('/api/auth/login', { email: 'admin@example.com', password: 'correct horse battery' });
  const m = await admin.get('/api/admin/metrics');
  assert.equal(m.status, 200);
  assert.ok(m.data.metrics.activation.new_users >= 1);
  const normal = app.client();
  await signupVerified(app, normal);
  assert.equal((await normal.get('/api/admin/metrics')).status, 403);
  const weddings = (await admin.get('/api/admin/weddings')).data.weddings;
  const pub = weddings.find((w) => w.status === 'published');
  const guest = app.client();
  await guest.req('POST', `/w/${pub.slug}/report`, 'reason=scam&details=test', { json: false, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  const reports = (await admin.get('/api/admin/reports')).data.reports;
  assert.ok(reports.find((r) => r.slug === pub.slug));
  await admin.post(`/api/admin/weddings/${pub.id}/takedown`, { reason: 'test' });
  assert.equal((await guest.get(`/w/${pub.slug}`)).status, 404);
});
