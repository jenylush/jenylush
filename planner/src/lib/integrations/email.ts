import { appUrl, integrations } from "../config";

export type SendResult = { ok: true; providerId?: string } | { ok: false; skipped?: boolean; error: string };

/** Resend REST API — https://resend.com/docs/api-reference/emails/send-email */
export async function sendEmail(to: string, subject: string, html: string, text: string): Promise<SendResult> {
  if (!integrations.email()) return { ok: false, skipped: true, error: "Email not connected: set RESEND_API_KEY and EMAIL_FROM" };
  try {
    const res = await fetch(`${(process.env.RESEND_BASE_URL || "https://api.resend.com").replace(/\/$/, "")}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, html, text }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${body.message ?? "unknown error"}` };
    return { ok: true, providerId: body.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A restrained, table-based layout that renders in Gmail, Outlook and Apple Mail. */
export function emailLayout(opts: {
  eyebrow: string;
  title: string;
  intro?: string;
  rows?: Array<[string, string]>;
  cta?: { label: string; href: string };
  footer?: string;
}) {
  const rows = (opts.rows ?? [])
    .map(
      ([k, v]) =>
        `<tr><td style="padding:10px 0;border-bottom:1px solid #E9E1D3;color:#7A7268;font-size:13px">${esc(k)}</td><td style="padding:10px 0;border-bottom:1px solid #E9E1D3;text-align:right;font-size:14px;color:#2A2725;font-weight:600">${esc(v)}</td></tr>`,
    )
    .join("");
  const href = opts.cta ? (opts.cta.href.startsWith("http") ? opts.cta.href : `${appUrl()}${opts.cta.href}`) : "";
  const html = `<!doctype html><html><body style="margin:0;background:#F6F1E8;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F1E8;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#FFFDF9;border:1px solid #E6DCCB">
<tr><td style="padding:28px 32px 8px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#A88B5C">${esc(opts.eyebrow)}</td></tr>
<tr><td style="padding:0 32px;font-family:Georgia,serif;font-size:26px;line-height:1.25;color:#2A2725">${esc(opts.title)}</td></tr>
${opts.intro ? `<tr><td style="padding:14px 32px 0;font-size:15px;line-height:1.6;color:#4A4540">${esc(opts.intro)}</td></tr>` : ""}
${rows ? `<tr><td style="padding:18px 32px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>` : ""}
${opts.cta ? `<tr><td style="padding:26px 32px 4px"><a href="${esc(href)}" style="display:inline-block;background:#2A2725;color:#F6F1E8;text-decoration:none;padding:13px 22px;font-size:14px;letter-spacing:.02em">${esc(opts.cta.label)} →</a></td></tr>` : ""}
<tr><td style="padding:26px 32px 28px;font-size:12px;color:#9A9188;line-height:1.5">${esc(opts.footer ?? "Sent by Owambe Ledger on behalf of the couple.")}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [opts.title, opts.intro, ...(opts.rows ?? []).map(([k, v]) => `${k}: ${v}`), opts.cta ? `${opts.cta.label}: ${href}` : ""]
    .filter(Boolean)
    .join("\n");
  return { html, text };
}
