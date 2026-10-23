import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createApp } from '../src/server.js';

// A real app on a random port with a throwaway database. The email provider is a
// test double that records what would be sent (the real providers are covered by
// configuration, not by tests that hit external services).
export async function startTestApp(env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vowly-test-'));
  const sent = [];
  const emailProvider = {
    name: 'test', configured: true, failNext: 0,
    async send(msg) {
      if (this.failNext > 0) { this.failNext--; const { TransientEmailError } = await import('../src/email/provider.js'); throw new TransientEmailError('simulated outage'); }
      sent.push(msg); return { id: `test-${sent.length}` };
    }
  };
  const { app, ctx, close } = createApp({ DATA_DIR: dataDir, BASE_URL: 'http://localhost', SCHEDULER_ENABLED: 'false', EXPOSE_DEV_LINKS: 'true', NODE_ENV: 'test', RATE_LIMIT_SCALE: '100', ADMIN_EMAILS: 'admin@example.com', emailProvider, startWorker: false, ...env });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, ctx, sent, emailProvider,
    client: () => new Client(base),
    async stop() { server.close(); close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
  };
}

export class Client {
  constructor(base) { this.base = base; this.cookies = new Map(); }
  cookieHeader() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  store(res) {
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i), v = pair.slice(i + 1);
      if (/Max-Age=0/.test(c)) this.cookies.delete(k); else this.cookies.set(k, v);
    }
  }
  async raw(method, url, { body, headers = {}, json = true } = {}) {
    const h = { 'x-requested-with': 'fetch', cookie: this.cookieHeader(), ...headers };
    let payload = body;
    if (body !== undefined && json && !(body instanceof FormData) && typeof body !== 'string') { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(this.base + url, { method, headers: h, body: payload, redirect: 'manual' });
    this.store(res);
    return res;
  }
  async req(method, url, body, opts = {}) {
    const res = await this.raw(method, url, { body, ...opts });
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  get(url) { return this.req('GET', url); }
  post(url, body) { return this.req('POST', url, body ?? {}); }
  put(url, body) { return this.req('PUT', url, body); }
  patch(url, body) { return this.req('PATCH', url, body); }
  del(url, body) { return this.req('DELETE', url, body); }
}

export async function signupVerified(app, client, email = `couple${Math.random().toString(36).slice(2, 8)}@example.com`) {
  const r = await client.post('/api/auth/signup', { name: 'Test Couple', email, password: 'correct horse battery', accept_terms: true });
  if (r.status !== 201) throw new Error(`signup failed: ${JSON.stringify(r.data)}`);
  // Verification email goes through the (test) provider; pull the token from the queued email.
  const log = app.ctx.db.get("SELECT text FROM email_delivery_logs WHERE type = 'verify_email' AND to_email = ? ORDER BY created_at DESC", email);
  const token = /token=([^\s&]+)/.exec(log.text)[1];
  const v = await client.post('/api/auth/verify', { token: decodeURIComponent(token) });
  if (v.status !== 200) throw new Error('verify failed');
  return { email, user: r.data.user };
}

export async function createWedding(client, overrides = {}) {
  const r = await client.post('/api/weddings', { partner1: 'Ada', partner2: 'Ben', wedding_date_local: '2027-06-12T15:00', timezone: 'Europe/London', location: 'Bath, UK', tagline: 'Two hearts', ...overrides });
  if (r.status !== 201) throw new Error(`create wedding failed: ${JSON.stringify(r.data)}`);
  return r.data.wedding;
}

export async function testImage(width = 1600, height = 1200, color = '#c97') {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg().withMetadata({ exif: { IFD0: { Copyright: 'test' } } }).toBuffer();
}
