import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  campaigns,
  categories,
  events,
  expenses,
  guests,
  orders,
  payments,
  tasks,
  vendors,
} from "@/db/schema";
import { computeExpense, summarise, type ExpenseState } from "./finance";
import { todayISO } from "./dates";

/** Every function here takes weddingId and filters on it — this is the tenancy boundary for reads. */

export async function loadExpenses(weddingId: string, today = todayISO()) {
  const rows = await db.query.expenses.findMany({
    where: eq(expenses.weddingId, weddingId),
    with: { category: true, event: true, vendor: true, instalments: true, payments: true, attachments: { with: { file: true } } },
    orderBy: [asc(expenses.createdAt)],
  });
  return rows.map((e) => ({ ...e, state: computeExpense(e, e.instalments, e.payments, today) }));
}
export type LoadedExpense = Awaited<ReturnType<typeof loadExpenses>>[number];

export async function loadLookups(weddingId: string) {
  const [cats, evs, vens] = await Promise.all([
    db.select().from(categories).where(eq(categories.weddingId, weddingId)).orderBy(asc(categories.sortOrder), asc(categories.name)),
    db.select().from(events).where(eq(events.weddingId, weddingId)).orderBy(asc(events.date), asc(events.sortOrder)),
    db.select().from(vendors).where(eq(vendors.weddingId, weddingId)).orderBy(asc(vendors.name)),
  ]);
  return { categories: cats, events: evs, vendors: vens };
}

export function byCategory(list: LoadedExpense[], cats: Array<typeof categories.$inferSelect>) {
  const map = new Map<string, { id: string | null; name: string; color: string; allocated: number; committed: number; paid: number; outstanding: number; count: number }>();
  for (const c of cats) map.set(c.id, { id: c.id, name: c.name, color: c.color, allocated: c.allocated, committed: 0, paid: 0, outstanding: 0, count: 0 });
  for (const e of list) {
    const key = e.categoryId ?? "none";
    if (!map.has(key)) map.set(key, { id: null, name: "Uncategorised", color: "#9A9188", allocated: 0, committed: 0, paid: 0, outstanding: 0, count: 0 });
    const row = map.get(key)!;
    row.count++;
    row.paid += e.state.paid;
    if (e.state.status !== "cancelled") {
      row.committed += Math.max(e.state.total, e.state.paid);
      row.outstanding += e.state.outstanding;
    } else row.committed += e.state.paid;
  }
  return [...map.values()];
}

export interface ScheduleItem {
  key: string;
  date: string;
  amount: number;
  label: string;
  expenseId: string;
  expenseName: string;
  vendorName: string | null;
  status: "paid" | "partial" | "due" | "overdue";
  outstandingOnExpense: number;
}

/** Flatten instalments (or single due dates) into one payment calendar. */
export function scheduleFrom(list: LoadedExpense[], today = todayISO()): ScheduleItem[] {
  const items: ScheduleItem[] = [];
  for (const e of list) {
    if (e.state.status === "cancelled") continue;
    if (e.state.instalments.length) {
      for (const i of e.state.instalments)
        items.push({
          key: i.id,
          date: i.dueDate,
          amount: i.status === "paid" ? i.amount : i.remaining,
          label: i.label,
          expenseId: e.id,
          expenseName: e.name,
          vendorName: e.vendor?.name ?? null,
          status: i.status,
          outstandingOnExpense: e.state.outstanding,
        });
    } else if (e.dueDate) {
      const s = e.state;
      items.push({
        key: e.id,
        date: e.dueDate,
        amount: s.outstanding || s.total,
        label: "Full payment",
        expenseId: e.id,
        expenseName: e.name,
        vendorName: e.vendor?.name ?? null,
        status: s.outstanding === 0 ? "paid" : e.dueDate < today ? "overdue" : s.paid > 0 ? "partial" : "due",
        outstandingOnExpense: s.outstanding,
      });
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

export async function asoEbiTotals(weddingId: string) {
  const [row] = await db
    .select({
      orders: sql<number>`count(*) filter (where ${orders.status} <> 'cancelled')`.mapWith(Number),
      paidOrders: sql<number>`count(*) filter (where ${orders.status} = 'paid')`.mapWith(Number),
      expected: sql<number>`coalesce(sum(${orders.total}) filter (where ${orders.status} <> 'cancelled'), 0)`.mapWith(Number),
      collected: sql<number>`coalesce(sum(${orders.amountPaid}), 0)`.mapWith(Number),
    })
    .from(orders)
    .where(eq(orders.weddingId, weddingId));
  return row;
}

export async function overviewData(weddingId: string, budget: number) {
  const today = todayISO();
  const list = await loadExpenses(weddingId, today);
  const states: ExpenseState[] = list.map((e) => e.state);
  const summary = summarise(budget, states);
  const [lookups, aso, openTasks, recentPayments, campaignCount, guestCount] = await Promise.all([
    loadLookups(weddingId),
    asoEbiTotals(weddingId),
    db
      .select()
      .from(tasks)
      .where(and(eq(tasks.weddingId, weddingId), sql`${tasks.completedAt} is null`))
      .orderBy(asc(tasks.dueDate))
      .limit(6),
    db
      .select({ p: payments, o: orders })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(and(eq(payments.weddingId, weddingId), inArray(payments.status, ["reported", "confirmed"])))
      .orderBy(desc(payments.reportedAt))
      .limit(5),
    db.$count(campaigns, eq(campaigns.weddingId, weddingId)),
    db.$count(guests, eq(guests.weddingId, weddingId)),
  ]);
  return {
    list,
    summary,
    lookups,
    cats: byCategory(list, lookups.categories),
    schedule: scheduleFrom(list, today),
    aso,
    openTasks,
    recentPayments,
    campaignCount,
    guestCount,
    today,
  };
}
