"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { events, invites, notifications, weddings } from "@/db/schema";
import { guard, parse, zs, type ActionState } from "@/lib/action";
import { audit } from "@/lib/audit";
import { canManageTeam, requireWorkspace } from "@/lib/auth";
import { appUrl } from "@/lib/config";
import { secretToken, sha256 } from "@/lib/ids";
import { emailLayout, sendEmail } from "@/lib/integrations/email";
import { retryNotifications } from "@/lib/notify";
import { runReminders } from "@/lib/reminders";

const profileSchema = z.object({
  partnerOneName: zs.text(80),
  partnerTwoName: zs.text(80),
  partnerOneEmail: zs.optEmail(),
  partnerTwoEmail: zs.optEmail(),
  partnerOnePhone: zs.optPhone(),
  partnerTwoPhone: zs.optPhone(),
  weddingDate: zs.optDate(),
  traditionalDate: zs.optDate(),
  whiteWeddingDate: zs.optDate(),
  venue: zs.optText(200),
  city: zs.optText(80),
  estimatedGuests: z.coerce.number().int().min(0).max(100000).default(0),
  totalBudget: zs.money(),
});

export async function saveProfile(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const { weddingId, wedding, user } = await requireWorkspace({ write: true });
    const p = parse(profileSchema, fd);
    if ("error" in p) return p.error;
    const v = Object.fromEntries(Object.entries(p.data).map(([k, x]) => [k, x ?? null])) as Record<string, unknown>;
    await db.update(weddings).set(v).where(eq(weddings.id, weddingId));
    if (wedding.totalBudget !== p.data.totalBudget)
      await audit({ weddingId, userId: user.id, action: "budget.updated", entityType: "wedding", entityId: weddingId, summary: `Total budget changed`, before: { totalBudget: wedding.totalBudget }, after: { totalBudget: p.data.totalBudget } });
    revalidatePath("/app", "layout");
    return { ok: true, message: "Wedding details saved." };
  });
}

const prefSchema = z.object({
  notifyEmail: zs.bool(),
  notifyWhatsapp: zs.bool(),
  notifyInApp: zs.bool(),
  offsets: z.union([z.string(), z.array(z.string())]).optional(),
  overdueRepeatDays: z.coerce.number().int().min(1).max(30),
  guestReminderDays: z.coerce.number().int().min(0).max(30),
});

export async function savePreferences(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const { weddingId } = await requireWorkspace({ write: true });
    const p = parse(prefSchema, fd);
    if ("error" in p) return p.error;
    const reminderOffsets = [...new Set(([] as string[]).concat(p.data.offsets ?? []).map(Number).filter((n) => n >= 0 && n <= 60))].sort((a, b) => b - a);
    await db.update(weddings).set({ notifyEmail: p.data.notifyEmail, notifyWhatsapp: p.data.notifyWhatsapp, notifyInApp: p.data.notifyInApp, overdueRepeatDays: p.data.overdueRepeatDays, guestReminderDays: p.data.guestReminderDays, reminderOffsets }).where(eq(weddings.id, weddingId));
    revalidatePath("/app/settings");
    return { ok: true, message: "Notification preferences saved." };
  });
}

const eventSchema = z.object({ id: zs.optUuid(), name: zs.text(80), type: z.enum(["introduction", "traditional", "white", "reception", "after_party", "other"]), date: zs.optDate(), venue: zs.optText(200), budget: zs.optMoney() });

export async function saveEvent(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const { weddingId } = await requireWorkspace({ write: true });
    const p = parse(eventSchema, fd);
    if ("error" in p) return p.error;
    const { id, ...v } = p.data;
    const values = { ...v, date: v.date ?? null, venue: v.venue ?? null, budget: v.budget ?? null };
    if (id) await db.update(events).set(values).where(and(eq(events.id, id), eq(events.weddingId, weddingId)));
    else await db.insert(events).values({ ...values, weddingId });
    revalidatePath("/app", "layout");
    return { ok: true, message: "Event saved." };
  });
}

export async function deleteEvent(fd: FormData) {
  const { weddingId } = await requireWorkspace({ write: true });
  await db.delete(events).where(and(eq(events.id, String(fd.get("id"))), eq(events.weddingId, weddingId)));
  revalidatePath("/app", "layout");
}

export async function toggleSheetsFeed(fd: FormData) {
  const { weddingId } = await requireWorkspace({ write: true });
  const on = fd.get("on") === "1";
  await db.update(weddings).set({ sheetsFeedToken: on ? secretToken(24) : null }).where(eq(weddings.id, weddingId));
  revalidatePath("/app/reports");
}

export async function invitePartner(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const { weddingId, wedding, role, user } = await requireWorkspace({ write: true });
    if (!canManageTeam(role)) return { error: "Only the couple can invite people." };
    const p = parse(z.object({ email: zs.email(), role: z.enum(["partner", "planner", "viewer"]) }), fd);
    if ("error" in p) return p.error;
    const token = secretToken(24);
    await db.insert(invites).values({ weddingId, email: p.data.email, role: p.data.role, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 14 * 86_400_000) });
    const link = `${appUrl()}/signup?invite=${token}&email=${encodeURIComponent(p.data.email)}`;
    const { html, text } = emailLayout({ eyebrow: "Invitation", title: `${user.name} invited you to plan ${wedding.partnerOneName} & ${wedding.partnerTwoName}'s wedding`, cta: { label: "Accept invitation", href: link } });
    const sent = await sendEmail(p.data.email, "You've been invited to a wedding workspace", html, text);
    await audit({ weddingId, userId: user.id, action: "team.invited", entityType: "invite", summary: `${p.data.email} invited as ${p.data.role}` });
    revalidatePath("/app/settings");
    return { ok: true, message: sent.ok ? `Invitation emailed to ${p.data.email}.` : `Email isn't connected, so share this link yourself (valid 14 days): ${link}` };
  });
}

export async function markAllRead() {
  const { weddingId } = await requireWorkspace();
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.weddingId, weddingId), isNull(notifications.readAt)));
  revalidatePath("/app", "layout");
}

export async function retryFailed(fd: FormData) {
  const { weddingId } = await requireWorkspace({ write: true });
  const ids = fd.getAll("id").map(String);
  await retryNotifications(weddingId, ids);
  revalidatePath("/app/notifications");
}

export async function runRemindersNow() {
  const { weddingId } = await requireWorkspace({ write: true });
  await runReminders(new Date(), weddingId);
  revalidatePath("/app", "layout");
}

export async function switchWedding(fd: FormData) {
  const { cookies } = await import("next/headers");
  (await cookies()).set("ol_wedding", String(fd.get("id")), { httpOnly: true, sameSite: "lax", path: "/" });
  revalidatePath("/app", "layout");
}

export async function deleteNotifications(fd: FormData) {
  const { weddingId } = await requireWorkspace();
  const ids = fd.getAll("id").map(String);
  if (ids.length) await db.delete(notifications).where(and(eq(notifications.weddingId, weddingId), inArray(notifications.id, ids)));
  revalidatePath("/app/notifications");
}
