// Outgoing email queue. Every email becomes a row in email_delivery_logs with a unique
// dedupe key, so the same message can never be queued twice. A worker sends queued
// rows, retries transient failures with backoff, and records the provider's response.

import { now, uuid } from './db.js';
import { TransientEmailError } from './email/provider.js';

const MAX_ATTEMPTS = 5;
const BACKOFF_MIN = [1, 5, 30, 120]; // minutes before attempts 2..5

// Returns { id, status, duplicate }.
export function queueEmail(db, provider, msg) {
  const ts = now();
  const existing = db.get('SELECT id, status FROM email_delivery_logs WHERE dedupe_key = ?', msg.dedupeKey);
  if (existing) return { ...existing, duplicate: true };
  let status = 'queued';
  let lastError = null;
  if (msg.guestId) {
    const g = db.get('SELECT unsubscribed_at, updates_opt_in FROM guests WHERE id = ?', msg.guestId);
    if (g?.unsubscribed_at) { status = 'suppressed'; lastError = 'Guest unsubscribed from all wedding emails.'; }
    else if (!msg.essential && !g?.updates_opt_in) { status = 'suppressed'; lastError = 'Guest has not opted in to wedding updates.'; }
  }
  if (status === 'queued' && !provider.configured) { status = 'not_configured'; lastError = 'No email provider is configured, so this email was not sent.'; }
  const id = uuid();
  db.run(
    `INSERT INTO email_delivery_logs (id, wedding_id, scheduled_message_id, guest_id, user_id, type, to_email, subject, html, text, essential, dedupe_key, status, provider, attempts, next_attempt_at, last_error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    id, msg.weddingId || null, msg.scheduledMessageId || null, msg.guestId || null, msg.userId || null, msg.type, msg.to, msg.subject, msg.html, msg.text,
    msg.essential === false ? 0 : 1, msg.dedupeKey, status, provider.name, ts, lastError, ts, ts
  );
  return { id, status, duplicate: false };
}

export async function processQueue(db, provider, { limit = 25, baseUrl = '' } = {}) {
  if (!provider.configured) return 0;
  const due = db.all("SELECT * FROM email_delivery_logs WHERE status = 'queued' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?", now(), limit);
  let sent = 0;
  for (const row of due) {
    // Claim the row so a second worker (or overlapping tick) cannot send it too.
    const claim = db.run("UPDATE email_delivery_logs SET status = 'sending', updated_at = ? WHERE id = ? AND status = 'queued'", now(), row.id);
    if (claim.changes !== 1) continue;
    const headers = {};
    if (row.guest_id) {
      const g = db.get('SELECT unsubscribe_token FROM guests WHERE id = ?', row.guest_id);
      if (g && baseUrl) headers['List-Unsubscribe'] = `<${baseUrl}/u/${g.unsubscribe_token}>`;
    }
    try {
      const result = await provider.send({ to: row.to_email, subject: row.subject, html: row.html, text: row.text, idempotencyKey: row.dedupe_key, headers });
      db.run("UPDATE email_delivery_logs SET status = 'sent', provider_message_id = ?, attempts = attempts + 1, last_error = NULL, updated_at = ? WHERE id = ?", result.id || null, now(), row.id);
      sent++;
    } catch (err) {
      const attempts = row.attempts + 1;
      if (err instanceof TransientEmailError && attempts < MAX_ATTEMPTS) {
        const next = new Date(Date.now() + BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60000).toISOString();
        db.run("UPDATE email_delivery_logs SET status = 'queued', attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?", attempts, next, String(err.message).slice(0, 500), now(), row.id);
      } else {
        db.run("UPDATE email_delivery_logs SET status = 'failed', attempts = ?, last_error = ?, updated_at = ? WHERE id = ?", attempts, String(err.message).slice(0, 500), now(), row.id);
        console.error(`email ${row.id} failed: ${err.message}`);
      }
    }
  }
  return sent;
}

// Rows stuck in 'sending' (process crashed mid-send) go back to the queue. The
// provider idempotency key prevents a duplicate if the first attempt actually went out.
export function recoverStuck(db) {
  const cutoff = new Date(Date.now() - 10 * 60000).toISOString();
  db.run("UPDATE email_delivery_logs SET status = 'queued', updated_at = ? WHERE status = 'sending' AND updated_at < ?", now(), cutoff);
  db.run("UPDATE scheduled_messages SET status = 'pending' WHERE status = 'processing' AND processed_at < ?", cutoff);
}
