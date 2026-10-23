// Email providers. Resend (HTTP API) and SMTP are supported. With no provider
// configured, messages are recorded with status "not_configured" — the app never
// pretends an email was sent.

import nodemailer from 'nodemailer';

export class TransientEmailError extends Error {}

export function createEmailProvider(config) {
  const { provider, resendApiKey, smtpUrl, from } = config.email;
  if (provider === 'resend' && resendApiKey && from) return resendProvider(resendApiKey, from);
  if (provider === 'smtp' && smtpUrl && from) return smtpProvider(smtpUrl, from);
  return { name: 'none', configured: false, async send() { throw new Error('No email provider is configured.'); } };
}

function resendProvider(apiKey, from) {
  return {
    name: 'resend',
    configured: true,
    async send({ to, subject, html, text, idempotencyKey, headers = {} }) {
      let res;
      try {
        res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey.slice(0, 256) },
          body: JSON.stringify({ from, to: [to], subject, html, text, headers }),
          signal: AbortSignal.timeout(15000)
        });
      } catch (err) {
        throw new TransientEmailError(`Network error contacting Resend: ${err.message}`);
      }
      const body = await res.json().catch(() => ({}));
      if (res.status === 429 || res.status >= 500) throw new TransientEmailError(`Resend ${res.status}: ${body.message || 'temporary error'}`);
      if (!res.ok) throw new Error(`Resend ${res.status}: ${body.message || 'request rejected'}`);
      return { id: body.id };
    }
  };
}

function smtpProvider(url, from) {
  const transport = nodemailer.createTransport(url);
  return {
    name: 'smtp',
    configured: true,
    async send({ to, subject, html, text, headers = {} }) {
      try {
        const info = await transport.sendMail({ from, to, subject, html, text, headers });
        return { id: info.messageId };
      } catch (err) {
        // 4xx SMTP replies and connection problems are worth retrying; 5xx are permanent.
        if (!err.responseCode || (err.responseCode >= 400 && err.responseCode < 500)) throw new TransientEmailError(err.message);
        throw err;
      }
    }
  };
}
