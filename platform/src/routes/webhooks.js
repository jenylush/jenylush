import express from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { now } from '../db.js';

// Resend delivery webhooks (signed with Svix). Updates delivery logs to delivered,
// bounced or complained; a bounce or complaint also stops further email to that guest.
export function webhookRoutes(ctx) {
  const { db, config } = ctx;
  const r = express.Router();

  r.post('/resend', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
    const secret = config.email.resendWebhookSecret;
    if (!secret) return res.status(404).end();
    const id = req.get('svix-id'), ts = req.get('svix-timestamp'), sigHeader = req.get('svix-signature') || '';
    if (!id || !ts || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return res.status(400).end();
    const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
    const expected = createHmac('sha256', key).update(`${id}.${ts}.${req.body.toString('utf8')}`).digest();
    const ok = sigHeader.split(' ').some((part) => {
      const [, sig] = part.split(',');
      if (!sig) return false;
      const got = Buffer.from(sig, 'base64');
      return got.length === expected.length && timingSafeEqual(got, expected);
    });
    if (!ok) return res.status(401).end();
    let event;
    try { event = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).end(); }
    const status = { 'email.delivered': 'delivered', 'email.bounced': 'bounced', 'email.complained': 'complained' }[event.type];
    const messageId = event.data?.email_id;
    if (status && messageId) {
      const log = db.get('SELECT * FROM email_delivery_logs WHERE provider_message_id = ?', messageId);
      if (log) {
        db.run('UPDATE email_delivery_logs SET status = ?, updated_at = ? WHERE id = ?', status, now(), log.id);
        if ((status === 'bounced' || status === 'complained') && log.guest_id) {
          db.run('UPDATE guests SET unsubscribed_at = COALESCE(unsubscribed_at, ?), updates_opt_in = 0 WHERE id = ?', now(), log.guest_id);
        }
      }
    }
    res.json({ received: true });
  });

  return r;
}
