/**
 * Pure budget maths. Nothing here touches the database, so it is unit-tested directly
 * (tests/unit/finance.test.ts) and reused by the dashboard, reports, exports and reminders.
 */
import { todayISO } from "./dates";

export type ExpenseStatus = "not_paid" | "partially_paid" | "fully_paid" | "overdue" | "cancelled";

export const EXPENSE_STATUS_LABEL: Record<ExpenseStatus, string> = {
  not_paid: "Not paid",
  partially_paid: "Partially paid",
  fully_paid: "Fully paid",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

export type InstalmentStatus = "paid" | "partial" | "due" | "overdue";

export interface ExpenseInput {
  id: string;
  estimatedCost: number;
  actualCost: number | null;
  dueDate: string | null;
  cancelledAt: Date | string | null;
}
export interface InstalmentInput {
  id: string;
  label: string;
  amount: number;
  dueDate: string;
  sortOrder?: number;
}
export interface PaymentInput {
  amount: number;
  instalmentId?: string | null;
}

export interface InstalmentState extends InstalmentInput {
  paid: number;
  remaining: number;
  status: InstalmentStatus;
}

export interface ExpenseState {
  total: number;
  paid: number;
  outstanding: number;
  status: ExpenseStatus;
  instalments: InstalmentState[];
  /** The next amount the couple has to pay, and when. */
  nextDue: { date: string; amount: number; label: string; instalmentId: string | null } | null;
  progress: number;
}

export const expenseTotal = (e: Pick<ExpenseInput, "estimatedCost" | "actualCost">) =>
  e.actualCost ?? e.estimatedCost;

/**
 * Payments are applied to instalments in due-date order (a waterfall). This matches how
 * vendors in practice treat money received — the oldest instalment is cleared first —
 * and means an over-payment on one instalment rolls into the next.
 */
export function computeExpense(
  expense: ExpenseInput,
  instalments: InstalmentInput[],
  payments: PaymentInput[],
  today: string = todayISO(),
): ExpenseState {
  const total = expenseTotal(expense);
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const outstanding = Math.max(0, total - paid);
  const cancelled = !!expense.cancelledAt;

  const ordered = [...instalments].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  );
  let pool = paid;
  const states: InstalmentState[] = ordered.map((i) => {
    const applied = Math.min(pool, i.amount);
    pool -= applied;
    const remaining = i.amount - applied;
    const status: InstalmentStatus =
      remaining === 0 ? "paid" : i.dueDate < today ? "overdue" : applied > 0 ? "partial" : "due";
    return { ...i, paid: applied, remaining, status };
  });

  let nextDue: ExpenseState["nextDue"] = null;
  if (!cancelled && outstanding > 0) {
    const first = states.find((s) => s.remaining > 0);
    if (first) nextDue = { date: first.dueDate, amount: first.remaining, label: first.label, instalmentId: first.id };
    else if (expense.dueDate) nextDue = { date: expense.dueDate, amount: outstanding, label: "Balance", instalmentId: null };
  }

  let status: ExpenseStatus;
  if (cancelled) status = "cancelled";
  else if (total > 0 && outstanding === 0) status = "fully_paid";
  else if (
    states.some((s) => s.status === "overdue") ||
    (states.length === 0 && !!expense.dueDate && expense.dueDate < today && outstanding > 0)
  )
    status = "overdue";
  else if (paid > 0) status = "partially_paid";
  else status = "not_paid";

  return { total, paid, outstanding, status, instalments: states, nextDue, progress: total > 0 ? Math.min(1, paid / total) : 0 };
}

export interface BudgetSummary {
  budget: number;
  /** Money that has actually left the couple's account. */
  spent: number;
  /** Everything the couple has agreed to pay (live expenses) plus money lost on cancelled ones. */
  committed: number;
  outstanding: number;
  /** Budget not yet committed to anything. Negative = over budget. */
  remaining: number;
  utilisedPct: number;
  spentPct: number;
  overdueCount: number;
  pendingCount: number;
}

export function summarise(budget: number, states: Array<ExpenseState>): BudgetSummary {
  let spent = 0,
    committed = 0,
    outstanding = 0,
    overdueCount = 0,
    pendingCount = 0;
  for (const s of states) {
    spent += s.paid;
    if (s.status === "cancelled") {
      committed += s.paid;
      continue;
    }
    committed += Math.max(s.total, s.paid);
    outstanding += s.outstanding;
    if (s.status === "overdue") overdueCount++;
    if (s.outstanding > 0) pendingCount++;
  }
  const remaining = budget - committed;
  return {
    budget,
    spent,
    committed,
    outstanding,
    remaining,
    utilisedPct: budget > 0 ? Math.round((committed / budget) * 1000) / 10 : 0,
    spentPct: budget > 0 ? Math.round((spent / budget) * 1000) / 10 : 0,
    overdueCount,
    pendingCount,
  };
}

/** Aso Ebi order maths */
export function orderTotals(
  items: Array<{ unitPrice: number; quantity: number }>,
  deliveryFee: number,
  method: "delivery" | "pickup",
) {
  const subtotal = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
  const fee = method === "delivery" ? deliveryFee : 0;
  return { subtotal, deliveryFee: fee, total: subtotal + fee };
}

export function orderStatusFor(total: number, amountPaid: number, cancelled: boolean) {
  if (cancelled) return "cancelled" as const;
  if (amountPaid >= total && total > 0) return "paid" as const;
  if (amountPaid > 0) return "partially_paid" as const;
  return "pending_payment" as const;
}

/**
 * Which reminder stage applies today. With offsets [7,3,0] and 5 days to go we are in
 * the "7-day" stage. Using the tightest stage that has been reached (rather than an
 * exact-day match) means a missed cron run catches up without sending every stage.
 */
export function reminderStage(daysLeft: number, offsets: number[]): number | null {
  const sorted = [...offsets].sort((a, b) => a - b);
  for (const o of sorted) if (daysLeft <= o && daysLeft >= 0) return o;
  return null;
}

