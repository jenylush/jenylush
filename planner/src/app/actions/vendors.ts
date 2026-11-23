"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { categories, expenses, instalments, tasks, vendors } from "@/db/schema";
import { guard, parse, zs, type ActionState } from "@/lib/action";
import { audit } from "@/lib/audit";
import { requireWorkspace } from "@/lib/auth";
import { naira } from "@/lib/money";
import { storeUpload } from "@/lib/storage";

const vendorSchema = z.object({
  id: zs.optUuid(),
  name: zs.text(120),
  categoryId: zs.optUuid(),
  contactName: zs.optText(120),
  phone: zs.optPhone(),
  email: zs.optEmail(),
  address: zs.optText(300),
  instagram: zs.optText(80),
  notes: zs.optText(2000),
  // Contract → creates the vendor's expense line and instalment plan
  agreedPrice: zs.optMoney(),
  eventId: zs.optUuid(),
  planLabel: z.union([z.string(), z.array(z.string())]).optional(),
  planAmount: z.union([z.string(), z.array(z.string())]).optional(),
  planDate: z.union([z.string(), z.array(z.string())]).optional(),
});

const arr = (v: string | string[] | undefined) => ([] as string[]).concat(v ?? []);

export async function saveVendor(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const { weddingId, user } = await requireWorkspace({ write: true });
    const p = parse(vendorSchema, fd);
    if ("error" in p) return p.error;
    const { id, agreedPrice, eventId, planLabel, planAmount, planDate, ...v } = p.data;
    if (v.categoryId) {
      const ok = await db.select({ id: categories.id }).from(categories).where(and(eq(categories.id, v.categoryId), eq(categories.weddingId, weddingId)));
      if (!ok.length) return { error: "Invalid category." };
    }
    const plan = arr(planLabel)
      .map((label, i) => ({ label: label.trim(), amount: Math.round(Number(String(arr(planAmount)[i] ?? "").replace(/[₦,\s]/g, "")) * 100), dueDate: arr(planDate)[i] }))
      .filter((r) => r.label && r.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.dueDate ?? ""));
    if (agreedPrice && plan.length) {
      const sum = plan.reduce((s, r) => s + r.amount, 0);
      if (sum !== agreedPrice) return { error: `The instalments add up to ${naira(sum)} but the agreed price is ${naira(agreedPrice)}.` };
    }

    const contract = fd.get("contract");
    const file = contract instanceof File && contract.size ? await storeUpload(contract, { weddingId, visibility: "private", userId: user.id }) : null;
    const values = { ...v, categoryId: v.categoryId ?? null, phone: v.phone ?? null, email: v.email ?? null, contactName: v.contactName ?? null, address: v.address ?? null, instagram: v.instagram ?? null, notes: v.notes ?? null, ...(file ? { contractFileId: file.id } : {}) };

    let vendorId = id;
    await db.transaction(async (tx) => {
      if (id) {
        const r = await tx.update(vendors).set(values).where(and(eq(vendors.id, id), eq(vendors.weddingId, weddingId))).returning();
        if (!r.length) throw new Error("Vendor not found.");
      } else {
        const [row] = await tx.insert(vendors).values({ ...values, weddingId }).returning();
        vendorId = row.id;
      }
      if (agreedPrice && agreedPrice > 0) {
        const [e] = await tx
          .insert(expenses)
          .values({ weddingId, vendorId: vendorId!, categoryId: v.categoryId ?? null, eventId: eventId ?? null, name: `${v.name} — contract`, estimatedCost: agreedPrice, actualCost: agreedPrice, dueDate: plan.at(-1)?.dueDate ?? null })
          .returning();
        if (plan.length) await tx.insert(instalments).values(plan.map((r, i) => ({ ...r, weddingId, expenseId: e.id, sortOrder: i })));
      }
      await audit({ weddingId, userId: user.id, action: id ? "vendor.updated" : "vendor.created", entityType: "vendor", entityId: vendorId, summary: `Vendor "${v.name}" ${id ? "updated" : "added"}${agreedPrice ? ` — contract ${naira(agreedPrice)}${plan.length ? ` in ${plan.length} instalments` : ""}` : ""}` }, tx);
    });
    for (const path of ["/app", "/app/vendors", "/app/budget", "/app/schedule"]) revalidatePath(path);
    return { ok: true, redirect: `/app/vendors/${vendorId}` };
  });
}

export async function deleteVendor(fd: FormData) {
  const { weddingId, user } = await requireWorkspace({ write: true });
  const id = String(fd.get("id"));
  const [v] = await db.delete(vendors).where(and(eq(vendors.id, id), eq(vendors.weddingId, weddingId))).returning();
  if (v) await audit({ weddingId, userId: user.id, action: "vendor.deleted", entityType: "vendor", entityId: id, summary: `Vendor "${v.name}" deleted (expenses kept, unlinked)` });
  revalidatePath("/app/vendors");
  redirect("/app/vendors");
}

/* ─── Checklist ────────────────────────────────────────────────────── */

const taskSchema = z.object({
  id: zs.optUuid(),
  title: zs.text(160),
  description: zs.optText(1000),
  kind: z.enum(["task", "activity"]).default("task"),
  dueDate: zs.optDate(),
  assignee: z.enum(["partner_one", "partner_two", "both"]).default("both"),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  recurrence: z.enum(["none", "weekly", "monthly"]).default("none"),
  eventId: zs.optUuid(),
  remind: z.union([z.string(), z.array(z.string())]).optional(),
});

export async function saveTask(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const { weddingId } = await requireWorkspace({ write: true });
    const p = parse(taskSchema, fd);
    if ("error" in p) return p.error;
    const { id, remind, ...v } = p.data;
    const remindDaysBefore = arr(remind).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 60);
    const values = { ...v, description: v.description ?? null, dueDate: v.dueDate ?? null, eventId: v.eventId ?? null, remindDaysBefore };
    if (id) await db.update(tasks).set(values).where(and(eq(tasks.id, id), eq(tasks.weddingId, weddingId)));
    else await db.insert(tasks).values({ ...values, weddingId });
    revalidatePath("/app/checklist");
    revalidatePath("/app/calendar");
    revalidatePath("/app");
    return { ok: true, message: id ? "Task updated." : "Task added." };
  });
}

export async function toggleTask(fd: FormData) {
  const { weddingId } = await requireWorkspace({ write: true });
  const id = String(fd.get("id"));
  const [t] = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.weddingId, weddingId)));
  if (!t) return;
  const completing = !t.completedAt;
  await db.update(tasks).set({ completedAt: completing ? new Date() : null }).where(eq(tasks.id, id));
  // Recurring tasks roll forward to their next occurrence when completed.
  if (completing && t.recurrence !== "none" && t.dueDate) {
    const { addDays, addMonths } = await import("@/lib/dates");
    const next = t.recurrence === "weekly" ? addDays(t.dueDate, 7) : addMonths(t.dueDate, 1);
    await db.insert(tasks).values({ weddingId, title: t.title, description: t.description, kind: t.kind, dueDate: next, assignee: t.assignee, priority: t.priority, recurrence: t.recurrence, eventId: t.eventId, remindDaysBefore: t.remindDaysBefore });
  }
  revalidatePath("/app/checklist");
  revalidatePath("/app");
}

export async function deleteTask(fd: FormData) {
  const { weddingId } = await requireWorkspace({ write: true });
  await db.delete(tasks).where(and(eq(tasks.id, String(fd.get("id"))), eq(tasks.weddingId, weddingId)));
  revalidatePath("/app/checklist");
}
