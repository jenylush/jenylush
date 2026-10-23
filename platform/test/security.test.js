import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, signupVerified, createWedding } from './helpers.js';
import { hotp, base32Encode, totpCounter, verifyTotp } from '../src/security.js';
import { setSetting } from '../src/seed.js';

let app;
before(async () => { app = await startTestApp(); });
after(async () => { await app.stop(); });

const PASSWORD = 'correct horse battery';

test('TOTP matches the RFC 6238 test vector and blocks replays', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(hotp(secret, 1), '287082');            // T = 59 s
  assert.equal(hotp(secret, 37037036), '081804');     // T = 1111111109 s
  const at = 59 * 1000;
  assert.equal(verifyTotp(secret, '287082', { at }), 1);
  assert.equal(verifyTotp(secret, '287082', { at, lastCounter: 1 }), null, 'a used code cannot be replayed');
  assert.equal(verifyTotp(secret, '000000', { at }), null);
});

test('accounts lock after repeated wrong passwords, even from different IPs', async () => {
  const c = app.client();
  const { email } = await signupVerified(app, c);
  const attacker = app.client();
  for (let i = 0; i < 8; i++) assert.equal((await attacker.post('/api/auth/login', { email, password: `wrong-guess-${i}` })).status, 401);
  const locked = await attacker.post('/api/auth/login', { email, password: PASSWORD });
  assert.equal(locked.status, 429, 'correct password is refused while locked');
  assert.equal(locked.data.code, 'locked');
  // Unknown emails get the same generic answer (no account enumeration).
  const unknown = await attacker.post('/api/auth/login', { email: 'nobody-here@example.com', password: PASSWORD });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.data.error, 'That email and password do not match.');
});

test('weak and common passwords are rejected', async () => {
  const c = app.client();
  for (const password of ['password123', 'aaaaaaaaaaaa', 'wedding2027']) {
    const r = await c.post('/api/auth/signup', { name: 'Ann', email: `weak${Math.random()}@example.com`, password, accept_terms: true });
    assert.equal(r.status, 400, password);
    assert.ok(r.data.fields.password);
  }
  const own = await c.post('/api/auth/signup', { name: 'Ann', email: 'annabelle@example.com', password: 'annabelle-rocks', accept_terms: true });
  assert.equal(own.status, 400, 'password containing the email name is rejected');
  const bot = await c.post('/api/auth/signup', { name: 'Bot', email: 'bot@example.com', password: PASSWORD, accept_terms: true, website: 'http://spam' });
  assert.equal(bot.status, 400, 'honeypot catches bots');
});

test('two-step verification: setup, login with code, recovery code, no secrets leaked', async () => {
  const c = app.client();
  const { email } = await signupVerified(app, c);
  const setup = await c.post('/api/account/2fa/setup');
  assert.equal(setup.status, 200);
  assert.match(setup.data.uri, /^otpauth:\/\/totp\//);
  const secret = setup.data.secret;
  assert.equal((await c.post('/api/account/2fa/enable', { code: '123456' })).status, 400);
  const en = await c.post('/api/account/2fa/enable', { code: hotp(secret, totpCounter()) });
  assert.equal(en.status, 200, JSON.stringify(en.data));
  assert.equal(en.data.recovery_codes.length, 8);
  const me = await c.get('/api/auth/me');
  assert.equal(me.data.user.mfa_enabled, true);
  assert.ok(!JSON.stringify(me.data).includes(secret), 'secret never returned after setup');

  const fresh = app.client();
  const step1 = await fresh.post('/api/auth/login', { email, password: PASSWORD });
  assert.equal(step1.data.mfa_required, true);
  assert.equal((await fresh.get('/api/auth/me')).data.user, null, 'password alone does not sign in');
  assert.equal((await fresh.post('/api/auth/login/mfa', { mfa_token: step1.data.mfa_token, code: '000000' })).status, 401);
  assert.equal((await fresh.post('/api/auth/login/mfa', { mfa_token: 'forged.token', code: hotp(secret, totpCounter() + 1) })).status, 401);
  const ok = await fresh.post('/api/auth/login/mfa', { mfa_token: step1.data.mfa_token, code: hotp(secret, totpCounter() + 1) });
  assert.equal(ok.status, 200);
  assert.equal((await fresh.get('/api/auth/me')).data.user.email, email);

  const third = app.client();
  const s1 = await third.post('/api/auth/login', { email, password: PASSWORD });
  const code = en.data.recovery_codes[0];
  assert.equal((await third.post('/api/auth/login/mfa', { mfa_token: s1.data.mfa_token, code })).status, 200);
  const fourth = app.client();
  const s2 = await fourth.post('/api/auth/login', { email, password: PASSWORD });
  assert.equal((await fourth.post('/api/auth/login/mfa', { mfa_token: s2.data.mfa_token, code })).status, 401, 'recovery codes work once');

  const events = (await c.get('/api/account/security')).data.events.map((e) => e.type);
  assert.ok(events.includes('mfa_enabled') && events.includes('recovery_code_used') && events.includes('mfa_failed'));
});

test('sign out other devices', async () => {
  const a = app.client();
  const { email } = await signupVerified(app, a);
  const b = app.client();
  await b.post('/api/auth/login', { email, password: PASSWORD });
  assert.ok((await b.get('/api/auth/me')).data.user);
  const r = await a.post('/api/account/sessions/revoke-others');
  assert.ok(r.data.signed_out >= 1);
  assert.equal((await b.get('/api/auth/me')).data.user, null);
  assert.ok((await a.get('/api/auth/me')).data.user, 'current device stays signed in');
});

test('cross-site requests and security headers', async () => {
  const c = app.client();
  const res = await c.raw('POST', '/api/auth/login', { body: { email: 'x@example.com', password: 'y' }, headers: { origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
  const page = await fetch(`${app.base}/`);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(page.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(page.headers.get('cross-origin-opener-policy'), 'same-origin');
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await (await fetch(`${app.base}/.well-known/security.txt`)).text(), /Contact: mailto:/);
  assert.match(await (await fetch(`${app.base}/robots.txt`)).text(), /Disallow: \/api/);
  assert.equal((await fetch(`${app.base}/healthz`)).status, 200);
});

test('invitation emails are capped per day to prevent spam', async () => {
  const c = app.client();
  await signupVerified(app, c);
  const w = await createWedding(c, { partner1: 'Cap', partner2: 'Test' });
  await c.post(`/api/weddings/${w.id}/publish`, {});
  const ids = [];
  for (const n of ['a', 'b', 'c']) ids.push((await c.post(`/api/weddings/${w.id}/guests`, { first_name: n, email: `${n}-cap@example.com` })).data.guest.id);
  setSetting(app.ctx.db, 'max_invitations_per_day', 2);
  const r = await c.post(`/api/weddings/${w.id}/guests/send-invitations`, { guest_ids: ids });
  assert.equal(r.status, 429);
  assert.equal((await c.post(`/api/weddings/${w.id}/guests/send-invitations`, { guest_ids: ids.slice(0, 2) })).status, 200);
  setSetting(app.ctx.db, 'max_invitations_per_day', 500);
});

test('admins must use two-step verification when required', async () => {
  const strict = await startTestApp({ REQUIRE_ADMIN_2FA: 'true' });
  try {
    const admin = strict.client();
    await signupVerified(strict, admin, 'admin@example.com');
    const blocked = await admin.get('/api/admin/metrics');
    assert.equal(blocked.status, 403);
    assert.equal(blocked.data.code, 'mfa_setup_required');
    const { secret } = (await admin.post('/api/account/2fa/setup')).data;
    await admin.post('/api/account/2fa/enable', { code: hotp(secret, totpCounter()) });
    assert.equal((await admin.get('/api/admin/metrics')).status, 200);
    await admin.put('/api/admin/settings', { announcement: 'Hello' });
    const log = (await admin.get('/api/admin/security')).data.events;
    assert.ok(log.some((e) => e.type === 'admin_action' && e.detail.path === '/settings'), 'admin actions are audited');
  } finally {
    await strict.stop();
  }
});
