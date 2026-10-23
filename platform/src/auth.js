// Password hashing, sessions, CSRF protection and rate limiting.
// Session cookies hold a random token; only its SHA-256 hash is stored, so a leaked
// database cannot be used to hijack sessions.

import { scryptSync, randomBytes, timingSafeEqual, createHash, createHmac } from 'node:crypto';
import { now, uuid } from './db.js';

// Over HTTPS the "__Host-" prefix stops wedding subdomains from setting or
// overwriting the platform's session cookie.
const sessionCookie = (config) => (config.cookieSecure ? '__Host-sid' : 'sid');
const SESSION_DAYS = 30;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  const [, saltHex, hashHex] = stored.split('$');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(expected, actual);
}

export const sha256 = (v) => createHash('sha256').update(String(v)).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'Use at least 10 characters.';
  if (pw.length > 200) return 'That password is too long.';
  return null;
}

export function validateEmail(email) {
  return typeof email === 'string' && email.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore malformed */ }
  }
  return out;
}

export function setCookie(res, name, value, { maxAge, secure, httpOnly = true, path = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'SameSite=Lax'];
  if (httpOnly) parts.push('HttpOnly');
  if (secure) parts.push('Secure');
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  res.append('Set-Cookie', parts.join('; '));
}

export function createSession(db, res, userId, config) {
  const token = randomToken();
  const ts = now();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.run('INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)', sha256(token), userId, ts, expires, ts);
  setCookie(res, sessionCookie(config), token, { maxAge: SESSION_DAYS * 86400, secure: config.cookieSecure });
}

export function destroySession(db, req, res, config) {
  const token = parseCookies(req.headers.cookie)[sessionCookie(config)];
  if (token) db.run('DELETE FROM sessions WHERE id = ?', sha256(token));
  setCookie(res, sessionCookie(config), '', { maxAge: 0, secure: config.cookieSecure });
}

// Attaches req.user when a valid session cookie is present.
export function sessionMiddleware(db, config) {
  return (req, _res, next) => {
    req.cookies = parseCookies(req.headers.cookie);
    const token = req.cookies[sessionCookie(config)];
    req.user = null;
    if (token) {
      const id = sha256(token);
      const row = db.get(
        `SELECT s.id AS sid, s.expires_at, s.last_seen_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = ? AND u.disabled_at IS NULL`, id
      );
      if (row && row.expires_at > now()) {
        req.sessionId = row.sid;
        const { sid, expires_at, last_seen_at, password_hash, totp_secret, recovery_codes, ...user } = row;
        req.user = user;
        // Refresh last-seen at most every 10 minutes.
        if (Date.now() - Date.parse(last_seen_at) > 6e5) db.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', now(), id);
      }
    }
    next();
  };
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in to continue.', code: 'auth_required' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in to continue.', code: 'auth_required' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Administrators only.' });
  next();
}

// CSRF: state-changing API requests must carry a custom header, which browsers will
// not send cross-site without a CORS preflight (which this server never approves).
// Session cookies are also SameSite=Lax.
export function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'fetch') return res.status(403).json({ error: 'Request blocked (missing CSRF header).' });
  // Defence in depth: if the browser says where the request came from, it must be us.
  const origin = req.get('origin');
  if (origin && origin !== 'null') {
    let host = null;
    try { host = new URL(origin).host; } catch { /* malformed */ }
    if (host !== req.get('host')) return res.status(403).json({ error: 'Request blocked (cross-site).' });
  }
  next();
}

export function createAuthToken(db, userId, type, ttlMinutes) {
  const token = randomToken();
  db.run("UPDATE auth_tokens SET used_at = ? WHERE user_id = ? AND type = ? AND used_at IS NULL", now(), userId, type);
  db.run(
    'INSERT INTO auth_tokens (id, user_id, type, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    uuid(), userId, type, sha256(token), new Date(Date.now() + ttlMinutes * 60000).toISOString(), now()
  );
  return token;
}

export function consumeAuthToken(db, token, type) {
  if (typeof token !== 'string' || !token) return null;
  const row = db.get('SELECT * FROM auth_tokens WHERE token_hash = ? AND type = ?', sha256(token), type);
  if (!row || row.used_at || row.expires_at < now()) return null;
  db.run('UPDATE auth_tokens SET used_at = ? WHERE id = ?', now(), row.id);
  return row;
}

// Signed values (e.g. site-unlock cookies): "<payload>.<hmac>".
export function sign(secret, payload) {
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

export function unsign(secret, value) {
  if (typeof value !== 'string') return null;
  const i = value.lastIndexOf('.');
  if (i < 0) return null;
  const payload = value.slice(0, i);
  const a = Buffer.from(sign(secret, payload));
  const b = Buffer.from(value);
  return a.length === b.length && timingSafeEqual(a, b) ? payload : null;
}

// Fixed-window in-memory rate limiter. Good enough for a single instance; swap for a
// shared store (e.g. Redis) when running several app servers. `rateLimit.scale`
// (RATE_LIMIT_SCALE) loosens limits for automated tests.
export function rateLimit({ windowMs, max, key = (req) => req.ip }) {
  const hits = new Map();
  max = Math.ceil(max * rateLimit.scale);
  setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (v.reset < t) hits.delete(k); }, windowMs).unref();
  return (req, res, next) => {
    const k = key(req);
    const t = Date.now();
    let entry = hits.get(k);
    if (!entry || entry.reset < t) { entry = { count: 0, reset: t + windowMs }; hits.set(k, entry); }
    entry.count++;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.reset - t) / 1000)));
      return res.status(429).json({ error: 'Too many attempts. Please wait a moment and try again.' });
    }
    next();
  };
}

rateLimit.scale = 1;
