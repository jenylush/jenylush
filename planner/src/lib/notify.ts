import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { notificationLogs, notifications, weddings } from "@/db/schema";
import { emailLayout, sendEmail, type SendResult } from "./integrations/email";
import { sendWhatsAppTemplate } from "./integrations/whatsapp";

type Wedding = typeof weddings.$inferSelect;

export interface Message {
  type: string; // e.g. vendor_payment_due, asoebi_payment_confirmed
  trigger: string; // human-readable cause, e.g. "3 days before due date"
  title: string;
  body: string;
  href?: string;
  email?: Parameters<typeof emailLayout>[0];
  /** Template + ordered body params for WhatsApp */
  whatsapp?: { template: string; params: string[] };
  /** Stable key — the same key is never delivered twice per channel+recipient. */
  dedupeKey?: string;
  entity?: { type: string; id: string };
}

interface Recipient {
  channel: "email" | "whatsapp" | "in_app";
  to: string;
}

async function deliver(logId: string) {
  const [log] = await db.select().from(notificationLogs).where(eq(notificationLogs.id, logId));
  if (!log) return;
  let result: SendResult;
  if (log.channel === "email") {
    result = await sendEmail(log.recipient, log.subject ?? log.type, log.html ?? log.body, log.body);
  } else if (log.channel === "whatsapp") {
    const meta = JSON.parse(log.subject ?? "{}") as { template?: string; params?: string[] };
    result = meta.template
      ? await sendWhatsAppTemplate(log.recipient, meta.template, meta.params ?? [])
      : { ok: false, error: "No WhatsApp template configured for this message" };
  } else {
    result = { ok: true };
  }
  await db
    .update(notificationLogs)
    .set({
      status: result.ok ? "sent" : "skipped" in result && result.skipped ? "skipped" : "failed",
      error: result.ok ? null : result.error,
      providerId: result.ok ? (result.providerId ?? null) : null,
      attempts: log.attempts + 1,
      sentAt: result.ok ? new Date() : null,
    })
    .where(eq(notificationLogs.id, log.id));
  return result;
}

async function dispatch(weddingId: string, msg: Message, recipients: Recipient[]) {
  const created: string[] = [];
  for (const r of recipients) {
    const rendered = r.channel === "email" && msg.email ? emailLayout(msg.email) : null;
    const [row] = await db
      .insert(notificationLogs)
      .values({
        weddingId,
        channel: r.channel,
        type: msg.type,
        trigger: msg.trigger,
        recipient: r.to,
        subject:
          r.channel === "whatsapp"
            ? JSON.stringify(msg.whatsapp ?? {})
            : msg.title,
        body: rendered?.text ?? msg.body,
        html: rendered?.html ?? null,
        dedupeKey: msg.dedupeKey ? `${msg.dedupeKey}|${r.channel}|${r.to}` : null,
        entityType: msg.entity?.type,
        entityId: msg.entity?.id,
      })
      .onConflictDoNothing({ target: notificationLogs.dedupeKey })
      .returning({ id: notificationLogs.id });
    if (row) created.push(row.id);
  }
  for (const id of created) await deliver(id);
  return created.length;
}

/** Notify the couple on every channel they've enabled. Returns the number of new deliveries. */
export async function notifyCouple(wedding: Wedding, msg: Message) {
  const recipients: Recipient[] = [];
  if (wedding.notifyInApp) recipients.push({ channel: "in_app", to: "couple" });
  if (wedding.notifyEmail)
    for (const e of [wedding.partnerOneEmail, wedding.partnerTwoEmail]) if (e) recipients.push({ channel: "email", to: e });
  if (wedding.notifyWhatsapp && msg.whatsapp)
    for (const p of [wedding.partnerOnePhone, wedding.partnerTwoPhone]) if (p) recipients.push({ channel: "whatsapp", to: p });

  const n = await dispatch(wedding.id, msg, recipients);
  // The in-app inbox item is only created the first time (dedupe respected above).
  if (n > 0 && wedding.notifyInApp) {
    await db.insert(notifications).values({ weddingId: wedding.id, kind: msg.type, title: msg.title, body: msg.body, href: msg.href });
  }
  return n;
}

/** Notify an Aso Ebi guest by email (and WhatsApp when the couple has it enabled). */
export async function notifyGuest(wedding: Wedding, to: { email?: string | null; phone?: string | null }, msg: Message) {
  const recipients: Recipient[] = [];
  if (to.email) recipients.push({ channel: "email", to: to.email });
  if (to.phone && msg.whatsapp && wedding.notifyWhatsapp) recipients.push({ channel: "whatsapp", to: to.phone });
  return dispatch(wedding.id, msg, recipients);
}

/** Retry failed or skipped (e.g. not-yet-configured) deliveries. */
export async function retryNotifications(weddingId: string, ids: string[]) {
  const rows = await db
    .select({ id: notificationLogs.id })
    .from(notificationLogs)
    .where(
      and(
        eq(notificationLogs.weddingId, weddingId),
        inArray(notificationLogs.id, ids),
        inArray(notificationLogs.status, ["failed", "skipped"]),
      ),
    );
  const results = [];
  for (const r of rows) results.push(await deliver(r.id));
  return results.filter((r) => r?.ok).length;
}
