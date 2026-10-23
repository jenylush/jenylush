// Who may view a wedding website. Public sites are open to all; password-protected
// sites need a signed unlock cookie; private sites (and drafts) are members-only.

import { sign, unsign, setCookie } from './auth.js';

const UNLOCK_DAYS = 30;

export function unlockCookieName(weddingId) {
  return `site_${weddingId.slice(0, 8)}`;
}

export function issueUnlock(ctx, res, weddingId) {
  const payload = `${weddingId}:${Date.now() + UNLOCK_DAYS * 864e5}`;
  setCookie(res, unlockCookieName(weddingId), sign(ctx.secret, payload), { maxAge: UNLOCK_DAYS * 86400, secure: ctx.config.cookieSecure });
}

export function hasUnlock(ctx, req, weddingId) {
  const payload = unsign(ctx.secret, req.cookies?.[unlockCookieName(weddingId)]);
  if (!payload) return false;
  const [id, exp] = payload.split(':');
  return id === weddingId && Number(exp) > Date.now();
}

export function isMember(db, req, weddingId) {
  return !!(req.user && db.get('SELECT 1 FROM wedding_members WHERE wedding_id = ? AND user_id = ?', weddingId, req.user.id));
}

// 'ok' | 'password' | 'hidden'
export function siteAccess(ctx, req, w) {
  if (isMember(ctx.db, req, w.id)) return 'ok';
  if (w.status !== 'published') return 'hidden';
  if (w.visibility === 'public') return 'ok';
  if (w.visibility === 'password') return hasUnlock(ctx, req, w.id) ? 'ok' : 'password';
  return 'hidden';
}
