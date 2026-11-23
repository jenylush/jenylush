import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { notificationLogs, notifications, weddings } from "@/db/schema";
import { emailLayout, sendEmail, type SendResult } from "./integrations/email";

type Wedding = typeof weddings.$inferSelect;

export interface Message {
  type: string; // e.g. vendor_payment_due, asoebi_payment_confirmed
  trigger: string; // human-readable cause, e.g. "3 days before due date"
  title: string;
  body: string;
  href?: string;
  email?: Parameters<typeof emailLayout>[0];
  /** Stable key — the same key is never delivered twice per channel+recipient. */
  dedupeKey?: string;
  entity?: { type: string; id: string };
}

interface Recipient {
  channel: "email" | "in_app";
  to: string;
}

async function deliver(logId: string) {
  const [log] = await db.select().from(notificationLogs).where(eq(notificationLogs.id, logId));
  if (!log) return;
  let result: SendResult;
  if (log.channel === "email") {
    result = await sendEmail(log.recipient, log.subject ?? log.type, log.html ?? log.body, log.body);
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
        subject: msg.title,
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

  const n = await dispatch(wedding.id, msg, recipients);
  // The in-app inbox item is only created the first time (dedupe respected above).
  if (n > 0 && wedding.notifyInApp) {
    await db.insert(notifications).values({ weddingId: wedding.id, kind: msg.type, title: msg.title, body: msg.body, href: msg.href });
  }
  return n;
}

/** Notify an Aso Ebi guest by email, when they gave one. */
export async function notifyGuest(wedding: Wedding, to: { email?: string | null }, msg: Message) {
  const recipients: Recipient[] = [];
  if (to.email) recipients.push({ channel: "email", to: to.email });
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
