"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { categories, expenseAttachments, expensePayments, expenses, instalments, vendors } from "@/db/schema";
import { guard, parse, zs, type ActionState } from "@/lib/action";
import { audit } from "@/lib/audit";
import { requireWorkspace } from "@/lib/auth";
import { computeExpense } from "@/lib/finance";
import { todayISO } from "@/lib/dates";
import { naira } from "@/lib/money";
import { storeUpload } from "@/lib/storage";

const refresh = () => {
  for (const p of ["/app", "/app/budget", "/app/vendors", "/app/schedule", "/app/calendar", "/app/reports"]) revalidatePath(p);
};

/* ─── Categories ───────────────────────────────────────────────────── */

const catSchema = z.object({ id: zs.optUuid(), name: zs.text(60), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#B89B6A"), allocated: zs.money() });

export async function saveCategory(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const { weddingId, user } = await requireWorkspace({ write: true });
    const p = parse(catSchema, fd);
    if ("error" in p) return p.error;
    const { id, ...v } = p.data;
    try {
      if (id) await db.update(categories).set(v).where(and(eq(categories.id, id), eq(categories.weddingId, weddingId)));
      else await db.insert(categories).values({ ...v, weddingId, sortOrder: 99 });
    } catch {
      return { error: `You already have a category called "${v.name}".` };
    }
    await audit({ weddingId, userId: user.id, action: id ? "category.updated" : "category.created", entityType: "category", entityId: id, summary: `Category "${v.name}" ${id ? "updated" : "created"} (allocation ${naira(v.allocated)})` });
    refresh();
    return { ok: true, message: "Category saved." };
  });
}

export async function deleteCategory(fd: FormData) {
  const { weddingId, user } = await requireWorkspace({ write: true });
  const id = String(fd.get("id"));
  const [c] = await db.delete(categories).where(and(eq(categories.id, id), eq(categories.weddingId, weddingId))).returning();
  if (c) await audit({ weddingId, userId: user.id, action: "category.deleted", entityType: "category", entityId: id, summary: `Category "${c.name}" deleted — its expenses are now uncategorised` });
  refresh();
}

/* ─── Expenses ─────────────────────────────────────────────────────── */

const expenseSchema = z.object({
  id: zs.optUuid(),
  name: zs.text(120),
  categoryId: zs.optUuid(),
  eventId: zs.optUuid(),
  vendorId: zs.optUuid(),
  description: zs.optText(1000),
  estimatedCost: zs.money(),
  actualCost: zs.optMoney(),
  dueDate: zs.optDate(),
  notes: zs.optText(2000),
  initialPayment: zs.optMoney(),
});

async function owns(table: typeof categories | typeof vendors, id: string | undefined, weddingId: string) {
  if (!id) return true;
  const r = await db.select({ id: table.id }).from(table).where(and(eq(table.id, id), eq(table.weddingId, weddingId)));
  return r.length === 1;
}

export async function saveExpense(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const { weddingId, user } = await requireWorkspace({ write: true });
    const p = parse(expenseSchema, fd);
    if ("error" in p) return p.error;
    const { id, initialPayment, ...v } = p.data;
    if (!(await owns(categories, v.categoryId, weddingId)) || !(await owns(vendors, v.vendorId, weddingId))) return { error: "Invalid category or vendor." };
    const values = { ...v, categoryId: v.categoryId ?? null, eventId: v.eventId ?? null, vendorId: v.vendorId ?? null, actualCost: v.actualCost ?? null, dueDate: v.dueDate ?? null, description: v.description ?? null, notes: v.notes ?? null };

    let expenseId = id;
    if (id) {
      const [before] = await db.select().from(expenses).where(and(eq(expenses.id, id), eq(expenses.weddingId, weddingId)));
      if (!before) return { error: "Expense not found." };
      await db.update(expenses).set(values).where(eq(expenses.id, id));
      await audit({ weddingId, userId: user.id, action: "expense.updated", entityType: "expense", entityId: id, summary: `Expense "${v.name}" updated`, before: { estimatedCost: before.estimatedCost, actualCost: before.actualCost }, after: { estimatedCost: v.estimatedCost, actualCost: v.actualCost } });
    } else {
      const [e] = await db.insert(expenses).values({ ...values, weddingId }).returning();
      expenseId = e.id;
      await audit({ weddingId, userId: user.id, action: "expense.created", entityType: "expense", entityId: e.id, summary: `Expense "${v.name}" created (${naira(v.actualCost ?? v.estimatedCost)})` });
      if (initialPayment && initialPayment > 0) {
        await db.insert(expensePayments).values({ weddingId, expenseId: e.id, amount: initialPayment, paidOn: todayISO(), method: "transfer", recordedBy: user.id });
        await audit({ weddingId, userId: user.id, action: "payment.recorded", entityType: "expense", entityId: e.id, summary: `${naira(initialPayment)} paid towards "${v.name}"` });
      }
    }
    const receipt = fd.get("receipt");
    if (receipt instanceof File && receipt.size) {
      const f = await storeUpload(receipt, { weddingId, visibility: "private", userId: user.id });
      if (f) await db.insert(expenseAttachments).values({ expenseId: expenseId!, fileId: f.id });
    }
    refresh();
    return { ok: true, redirect: `/app/budget/${expenseId}` };
  });
}

export async function deleteExpense(fd: FormData) {
  const { weddingId, user } = await requireWorkspace({ write: true });
  const id = String(fd.get("id"));
  const [e] = await db.delete(expenses).where(and(eq(expenses.id, id), eq(expenses.weddingId, weddingId))).returning();
  if (e) await audit({ weddingId, userId: user.id, action: "expense.deleted", entityType: "expense", entityId: id, summary: `Expense "${e.name}" deleted`, before: e });
  refresh();
  redirect("/app/budget");
}

export async function toggleCancelExpense(fd: FormData) {
  const { weddingId, user } = await requireWorkspace({ write: true });
  const id = String(fd.get("id"));
  const [e] = await db.select().from(expenses).where(and(eq(expenses.id, id), eq(expenses.weddingId, weddingId)));
  if (!e) return;
  await db.update(expenses).set({ cancelledAt: e.cancelledAt ? null : new Date() }).where(eq(expenses.id, id));
  await audit({ weddingId, userId: user.id, action: e.cancelledAt ? "expense.restored" : "expense.cancelled", entityType: "expense", entityId: id, summary: `Expense "${e.name}" ${e.cancelledAt ? "restored" : "cancelled"}` });
  refresh();
  revalidatePath(`/app/budget/${id}`);
}

/* ─── Instalments ──────────────────────────────────────────────────── */

const instSchema = z.object({ expenseId: z.string().uuid(), label: zs.text(60), amount: zs.money(), dueDate: zs.date() });

export async function addInstalment(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const { weddingId, user } = await requireWorkspace({ write: true });
    const p = parse(instSchema, fd);
    if ("error" in p) return p.error;
    if (p.data.amount <= 0) return { error: "Instalment amount must be more than ₦0." };
    const [e] = await db.select().from(expenses).where(and(eq(expenses.id, p.data.expenseId), eq(expenses.weddingId, weddingId)));
    if (!e) return { error: "Expense not found." };
    await db.insert(instalments).values({ ...p.data, weddingId });
    await audit({ weddingId, userId: user.id, action: "instalment.created", entityType: "expense", entityId: e.id, summary: `Instalment "${p.data.label}" ${naira(p.data.amount)} due ${p.data.dueDate} on "${e.name}"` });
    refresh();
    revalidatePath(`/app/budget/${e.id}`);
    return { ok: true };
  });
}

export async function deleteInstalment(fd: FormData) {
  const { weddingId, user } = await requireWorkspace({ write: true });
  const id = String(fd.get("id"));
  const [i] = await db.delete(instalments).where(and(eq(instalments.id, id), eq(instalments.weddingId, weddingId))).returning();
  if (i) {
    await audit({ weddingId, userId: user.id, action: "instalment.deleted", entityType: "expense", entityId: i.expenseId, summary: `Instalment "${i.label}" (${naira(i.amount)}) removed` });
    revalidatePath(`/app/budget/${i.expenseId}`);
  }
  refresh();
}

/* ─── Payments made by the couple ──────────────────────────────────── */

const paySchema = z.object({
  expenseId: z.string().uuid(),
  amount: zs.money(),
  paidOn: zs.date(),
  method: z.enum(["transfer", "cash", "card", "pos", "cheque", "other"]).default("transfer"),
  reference: zs.optText(120),
  note: zs.optText(500),
});

export async function recordExpensePayment(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const { weddingId, user } = await requireWorkspace({ write: true });
    const p = parse(paySchema, fd);
    if ("error" in p) return p.error;
    if (p.data.amount <= 0) return { error: "Enter the amount paid." };
    const e = await db.query.expenses.findFirst({ where: and(eq(expenses.id, p.data.expenseId), eq(expenses.weddingId, weddingId)), with: { instalments: true, payments: true } });
    if (!e) return { error: "Expense not found." };
    if (e.cancelledAt) return { error: "This expense is cancelled. Restore it before recording payments." };
    const before = computeExpense(e, e.instalments, e.payments);
    if (p.data.amount > before.outstanding && before.total > 0)
      return { error: `That's more than the ${naira(before.outstanding)} outstanding. Update the actual cost first if the price changed.` };
    const evidence = fd.get("evidence");
    const file = evidence instanceof File && evidence.size ? await storeUpload(evidence, { weddingId, visibility: "private", userId: user.id }) : null;
    await db.insert(expensePayments).values({ ...p.data, reference: p.data.reference ?? null, note: p.data.note ?? null, weddingId, recordedBy: user.id, evidenceFileId: file?.id ?? null, instalmentId: before.nextDue?.instalmentId ?? null });
    const after = computeExpense(e, e.instalments, [...e.payments, { amount: p.data.amount }]);
    await audit({ weddingId, userId: user.id, action: "payment.recorded", entityType: "expense", entityId: e.id, summary: `${naira(p.data.amount)} paid towards "${e.name}" — balance ${naira(after.outstanding)}`, before: { paid: before.paid, status: before.status }, after: { paid: after.paid, status: after.status } });
    refresh();
    revalidatePath(`/app/budget/${e.id}`);
    return { ok: true, message: `Payment recorded. Balance is now ${naira(after.outstanding)}.` };
  });
}

export async function deleteExpensePayment(fd: FormData) {
  const { weddingId, user } = await requireWorkspace({ write: true });
  const id = String(fd.get("id"));
  const [pmt] = await db.delete(expensePayments).where(and(eq(expensePayments.id, id), eq(expensePayments.weddingId, weddingId))).returning();
  if (pmt) {
    await audit({ weddingId, userId: user.id, action: "payment.deleted", entityType: "expense", entityId: pmt.expenseId, summary: `Payment of ${naira(pmt.amount)} on ${pmt.paidOn} deleted`, before: pmt });
    revalidatePath(`/app/budget/${pmt.expenseId}`);
  }
  refresh();
}

export async function uploadAttachment(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const { weddingId, user } = await requireWorkspace({ write: true });
    const expenseId = String(fd.get("expenseId"));
    const [e] = await db.select().from(expenses).where(and(eq(expenses.id, expenseId), eq(expenses.weddingId, weddingId)));
    if (!e) return { error: "Expense not found." };
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) return { error: "Choose a file to upload." };
    const f = await storeUpload(file, { weddingId, visibility: "private", userId: user.id });
    if (f) await db.insert(expenseAttachments).values({ expenseId, fileId: f.id });
    revalidatePath(`/app/budget/${expenseId}`);
    return { ok: true, message: "Attachment uploaded." };
  });
}

export async function updateBudget(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const { weddingId, wedding, user } = await requireWorkspace({ write: true });
    const p = parse(z.object({ totalBudget: zs.money() }), fd);
    if ("error" in p) return p.error;
    const { weddings } = await import("@/db/schema");
    await db.update(weddings).set({ totalBudget: p.data.totalBudget }).where(eq(weddings.id, weddingId));
    await audit({ weddingId, userId: user.id, action: "budget.updated", entityType: "wedding", entityId: weddingId, summary: `Total budget changed from ${naira(wedding.totalBudget)} to ${naira(p.data.totalBudget)}`, before: { totalBudget: wedding.totalBudget }, after: { totalBudget: p.data.totalBudget } });
    refresh();
    return { ok: true, message: "Budget updated." };
  });
}
