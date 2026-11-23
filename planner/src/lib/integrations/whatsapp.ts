import crypto from "node:crypto";
import { integrations } from "../config";
import type { SendResult } from "./email";
import { waNumber } from "../phone";

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * Business-initiated WhatsApp messages must use a template approved in Meta Business Manager.
 * Body parameters fill {{1}}, {{2}}, … in the template's body, in order.
 */
export async function sendWhatsAppTemplate(toE164: string, template: string, params: string[], lang = "en"): Promise<SendResult> {
  if (!integrations.whatsapp())
    return { ok: false, skipped: true, error: "WhatsApp not connected: set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID" };
  try {
    const res = await fetch(`${GRAPH}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: waNumber(toE164),
        type: "template",
        template: {
          name: template,
          language: { code: lang },
          components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }],
        },
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { messages?: Array<{ id: string }>; error?: { message: string } };
    if (!res.ok) return { ok: false, error: `WhatsApp ${res.status}: ${body.error?.message ?? "unknown error"}` };
    return { ok: true, providerId: body.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Meta signs webhook bodies with the App Secret: X-Hub-Signature-256: sha256=<hex> */
export function verifyMetaSignature(rawBody: string, header: string | null) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const got = header.slice(7);
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

/** Click-to-chat share link — works with no API credentials at all. */
export const waShareLink = (text: string, toE164?: string | null) =>
  `https://wa.me/${toE164 ? waNumber(toE164) : ""}?text=${encodeURIComponent(text)}`;
