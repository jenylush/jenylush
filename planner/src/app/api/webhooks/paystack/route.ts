import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { webhookEvents } from "@/db/schema";
import { applyVerifiedTransaction, markRefunded } from "@/lib/asoebi";
import { paymentProvider } from "@/lib/integrations/paystack";

export const dynamic = "force-dynamic";

/**
 * Paystack webhook. Security model:
 *  1. Reject anything without a valid HMAC-SHA512 signature over the RAW body.
 *  2. Record the event with a unique dedupe key, so a replayed delivery is a no-op.
 *  3. Never trust the payload's amount/status — re-verify the reference with Paystack's
 *     API and apply only what that returns (applyVerifiedTransaction also locks the row).
 */
export async function POST(req: Request) {
  const provider = paymentProvider();
  const raw = await req.text();
  const signature = req.headers.get("x-paystack-signature");
  if (!provider.configured()) return NextResponse.json({ error: "not configured" }, { status: 503 });
  if (!provider.verifyWebhookSignature(raw, signature)) return NextResponse.json({ error: "invalid signature" }, { status: 401 });

  let body: { event?: string; data?: { reference?: string; id?: number; transaction_reference?: string; transaction?: { reference?: string } } };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const event = body.event ?? "unknown";
  const reference = body.data?.reference ?? body.data?.transaction_reference ?? body.data?.transaction?.reference ?? "";
  const dedupeKey = `paystack:${event}:${reference}:${body.data?.id ?? ""}`;

  const [row] = await db
    .insert(webhookEvents)
    .values({ provider: "paystack", event, dedupeKey, signatureValid: true, payload: body as object })
    .onConflictDoNothing({ target: webhookEvents.dedupeKey })
    .returning({ id: webhookEvents.id });
  if (!row) return NextResponse.json({ ok: true, duplicate: true });

  let result = "ignored";
  try {
    if (event === "charge.success" && reference) {
      result = await applyVerifiedTransaction(await provider.verify(reference), "webhook");
    } else if (event === "refund.processed" && reference) {
      result = (await markRefunded(reference, "paystack webhook")) ? "refunded" : "refund_noop";
    }
  } catch (e) {
    console.error("paystack webhook", e);
    // 500 → Paystack retries later. Delete our dedupe row so the retry is processed.
    await db.delete(webhookEvents).where(eq(webhookEvents.id, row.id));
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
  await db.update(webhookEvents).set({ result }).where(eq(webhookEvents.id, row.id));
  return NextResponse.json({ ok: true, result });
}
