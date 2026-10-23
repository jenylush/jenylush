// Account security: audit log, brute-force lockout, password policy and
// TOTP two-step verification (RFC 6238, compatible with Google Authenticator,
// Microsoft Authenticator, 1Password, Authy…).

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { now, uuid, parseJson } from './db.js';
import { sha256, sign, unsign } from './auth.js';

// ---------------------------------------------------------------- audit log
export const SECURITY_EVENTS = [
  'login_success', 'login_failed', 'login_locked', 'mfa_failed', 'password_changed', 'password_reset',
  'mfa_enabled', 'mfa_disabled', 'recovery_code_used', 'sessions_revoked', 'account_deleted', 'signup',
  'admin_action', 'csrf_blocked'
];

const RETENTION_DAYS = 180;

export function logSecurityEvent(db, type, { userId = null, req = null, subject = null, detail = {} } = {}) {
  try {
    db.run('INSERT INTO security_events (id, type, user_id, subject, ip, user_agent, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      uuid(), type, userId, subject, req?.ip || null, String(req?.get?.('user-agent') || '').slice(0, 200) || null, JSON.stringify(detail), now());
    if (Math.random() < 0.01) db.run('DELETE FROM security_events WHERE created_at < ?', new Date(Date.now() - RETENTION_DAYS * 864e5).toISOString());
  } catch (err) {
    console.error('security log failed', err.message);
  }
}

export function securityEvents(db, { userId, limit = 50 } = {}) {
  const rows = userId
    ? db.all('SELECT type, ip, user_agent, detail, created_at FROM security_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', userId, limit)
    : db.all('SELECT s.type, s.user_id, s.ip, s.user_agent, s.detail, s.created_at, u.email FROM security_events s LEFT JOIN users u ON u.id = s.user_id ORDER BY s.created_at DESC LIMIT ?', limit);
  return rows.map((r) => ({ ...r, detail: parseJson(r.detail, {}) }));
}

// ---------------------------------------------------------------- lockout
// Per-account throttling on top of the per-IP rate limit, so a botnet spread over
// many IPs still cannot guess one account's password.
const LOCK_THRESHOLD = 8;
const LOCK_WINDOW_MS = 15 * 60000;

export const emailSubject = (email) => sha256(`login:${String(email).trim().toLowerCase()}`);

export function isLocked(db, subject) {
  const since = new Date(Date.now() - LOCK_WINDOW_MS).toISOString();
  const lastSuccess = db.get("SELECT MAX(created_at) AS t FROM security_events WHERE subject = ? AND type = 'login_success'", subject)?.t || '';
  const n = db.get("SELECT COUNT(*) AS n FROM security_events WHERE subject = ? AND type IN ('login_failed','mfa_failed') AND created_at >= ? AND created_at > ?", subject, since, lastSuccess).n;
  return n >= LOCK_THRESHOLD;
}

// ---------------------------------------------------------------- passwords
const COMMON = new Set(`123456789 1234567890 12345678910 password1 password12 password123 password1234 qwertyuiop qwerty1234 qwerty12345 iloveyou1 iloveyou12 iloveyou123 sunshine1 princess1 football1 baseball1 welcome123 welcome1234 abc1234567 1q2w3e4r5t 1qaz2wsx3edc zaq12wsxcde letmein123 changeme123 trustno1234 superman123 starwars12 dragon1234 monkey1234 master1234 passw0rd123 p@ssw0rd123 p@ssword123 admin12345 administrator 0987654321 1111111111 0000000000 aaaaaaaaaa abcdefghij abcdef1234 asdfghjkl1 lovelove12 mylove1234 wedding123 wedding2026 wedding2027 marriage123 ourwedding foreverandever happilyeverafter justmarried`.split(/\s+/));

export function passwordProblem(password, { email = '', name = '' } = {}) {
  const pw = String(password || '');
  if (pw.length < 10) return 'Use at least 10 characters.';
  if (pw.length > 200) return 'That password is too long.';
  const lower = pw.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(pw) || /^(0123456789|1234567890|abcdefghij)/.test(lower)) return 'That password is too common. Try a short phrase only you would know.';
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 4 && lower.includes(local)) return 'Your password should not contain your email address.';
  const first = String(name).trim().split(/\s+/)[0]?.toLowerCase() || '';
  if (first.length >= 4 && lower.replace(/[^a-z]/g, '') === first) return 'Your password should not be just your name.';
  return null;
}

// ---------------------------------------------------------------- TOTP
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const s = String(str).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const c of s) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error('Invalid base32');
    value = ((value << 5) | i) & 0xffff;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function hotp(secretB32, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secretB32)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

export const totpCounter = (at = Date.now()) => Math.floor(at / 30000);

// Returns the matched counter, or null. Accepts one step of clock drift either way
// and rejects codes at or before `lastCounter` (no replay).
export function verifyTotp(secretB32, code, { lastCounter = -1, at = Date.now() } = {}) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const now30 = totpCounter(at);
  for (const counter of [now30 - 1, now30, now30 + 1]) {
    if (counter <= lastCounter) continue;
    const expected = Buffer.from(hotp(secretB32, counter));
    if (timingSafeEqual(expected, Buffer.from(c))) return counter;
  }
  return null;
}

export function newTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function otpauthUri(secret, email, issuer) {
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

export function newRecoveryCodes(n = 8) {
  const codes = Array.from({ length: n }, () => {
    const s = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase();
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
  return { codes, hashes: codes.map((c) => sha256(c)) };
}

// Second-step token issued after a correct password: "<userId>:<expiry>", HMAC-signed.
export function issueMfaToken(secret, userId) {
  return sign(secret, `mfa:${userId}:${Date.now() + 5 * 60000}`);
}

export function readMfaToken(secret, token) {
  const payload = unsign(secret, token);
  if (!payload) return null;
  const [kind, userId, exp] = payload.split(':');
  return kind === 'mfa' && Number(exp) > Date.now() ? userId : null;
}

// Verify a TOTP code or a recovery code for a user; records the used counter/code.
export function checkSecondFactor(db, user, code) {
  const raw = String(code || '').trim().toLowerCase();
  if (/^\d{3}\s?\d{3}$/.test(raw)) {
    const counter = verifyTotp(user.totp_secret, raw, { lastCounter: user.totp_last_counter ?? -1 });
    if (counter === null) return null;
    db.run('UPDATE users SET totp_last_counter = ? WHERE id = ?', counter, user.id);
    return 'totp';
  }
  const hashes = parseJson(user.recovery_codes, []);
  const h = sha256(raw.replace(/[^a-z0-9]/g, '').replace(/^(.{5})/, '$1-'));
  const idx = hashes.indexOf(h);
  if (idx < 0) return null;
  hashes.splice(idx, 1);
  db.run('UPDATE users SET recovery_codes = ? WHERE id = ?', JSON.stringify(hashes), user.id);
  return 'recovery';
}
