import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { deliveryAddresses, orders, webhookEvents } from "@/db/schema";
import { audit } from "@/lib/audit";
import { verifyMetaSignature } from "@/lib/integrations/whatsapp";
import { NG_STATES } from "@/lib/phone";

export const dynamic = "force-dynamic";

/** Meta's subscription handshake */
export async function GET(req: Request) {
  const u = new URL(req.url);
  if (u.searchParams.get("hub.mode") === "subscribe" && process.env.WHATSAPP_VERIFY_TOKEN && u.searchParams.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN)
    return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
  return new Response("forbidden", { status: 403 });
}

/**
 * Only STRUCTURED WhatsApp Flow submissions are used — we never parse free-text chat.
 * The Flow must send back the order code and its access token (embedded in the Flow's
 * flow_token when the couple sends it), so a submission can only update its own order.
 */
const flowAddress = z.object({
  flow_token: z.string().min(10), // "<ORDER CODE>.<access token>"
  street: z.string().min(3).max(300),
  area: z.string().min(2).max(120),
  city: z.string().min(2).max(120),
  state: z.enum(NG_STATES),
  landmark: z.string().max(200).optional(),
  instructions: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"))) return new Response("invalid signature", { status: 401 });
  const body = JSON.parse(raw) as { entry?: Array<{ changes?: Array<{ value?: { messages?: Array<{ id: string; type: string; interactive?: { type: string; nfm_reply?: { response_json: string } } }> } }> }> };
  const msgs = body.entry?.flatMap((e) => e.changes?.flatMap((c) => c.value?.messages ?? []) ?? []) ?? [];
  let updated = 0;
  for (const m of msgs) {
    if (m.type !== "interactive" || m.interactive?.type !== "nfm_reply" || !m.interactive.nfm_reply) continue;
    const [dupe] = await db.insert(webhookEvents).values({ provider: "whatsapp", event: "flow_reply", dedupeKey: `wa:${m.id}`, signatureValid: true, payload: m as object }).onConflictDoNothing().returning();
    if (!dupe) continue;
    const parsed = flowAddress.safeParse(JSON.parse(m.interactive.nfm_reply.response_json));
    if (!parsed.success) continue;
    const [code, token] = parsed.data.flow_token.split(".");
    const [o] = await db.select().from(orders).where(and(eq(orders.code, code), eq(orders.accessToken, token ?? ""), sql`${orders.status} <> 'cancelled'`));
    if (!o) continue;
    const v = { street: parsed.data.street, area: parsed.data.area, city: parsed.data.city, state: parsed.data.state, landmark: parsed.data.landmark ?? null, instructions: parsed.data.instructions ?? null, source: "whatsapp_flow" };
    await db.insert(deliveryAddresses).values({ orderId: o.id, ...v }).onConflictDoUpdate({ target: deliveryAddresses.orderId, set: v });
    await audit({ weddingId: o.weddingId, actor: "guest", action: "address.updated", entityType: "order", entityId: o.id, summary: `Delivery address for ${o.code} received via WhatsApp Flow` });
    updated++;
  }
  return NextResponse.json({ ok: true, updated });
}
