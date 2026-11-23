import { describe, expect, it } from "vitest";
import { computeExpense, orderStatusFor, orderTotals, reminderStage as reminderStageForTest, summarise } from "@/lib/finance";
import { normaliseNgPhone } from "@/lib/phone";
import { toKobo, naira } from "@/lib/money";

const today = "2026-11-23";
const photographer = { id: "e1", estimatedCost: 50_000_000, actualCost: 50_000_000, dueDate: null, cancelledAt: null };
const plan = [
  { id: "i1", label: "First", amount: 20_000_000, dueDate: "2026-10-20" },
  { id: "i2", label: "Second", amount: 15_000_000, dueDate: "2026-11-26" },
  { id: "i3", label: "Final", amount: 15_000_000, dueDate: "2027-01-01" },
];

describe("computeExpense", () => {
  it("outstanding = total − paid and waterfalls payments over instalments", () => {
    const s = computeExpense(photographer, plan, [{ amount: 20_000_000 }], today);
    expect(s.outstanding).toBe(30_000_000);
    expect(s.status).toBe("partially_paid");
    expect(s.instalments.map((i) => i.status)).toEqual(["paid", "due", "due"]);
    expect(s.nextDue).toMatchObject({ amount: 15_000_000, date: "2026-11-26", label: "Second" });
  });
  it("marks an unpaid past instalment as overdue", () => {
    const s = computeExpense(photographer, plan, [{ amount: 10_000_000 }], today);
    expect(s.status).toBe("overdue");
    expect(s.instalments[0]).toMatchObject({ status: "overdue", remaining: 10_000_000 });
  });
  it("is fully paid when paid ≥ total", () => {
    expect(computeExpense(photographer, plan, [{ amount: 50_000_000 }], today).status).toBe("fully_paid");
  });
  it("uses the due date when there are no instalments", () => {
    expect(computeExpense({ ...photographer, dueDate: "2026-11-01" }, [], [], today).status).toBe("overdue");
    expect(computeExpense({ ...photographer, dueDate: "2026-12-01" }, [], [], today).status).toBe("not_paid");
  });
  it("cancelled expenses don't count as outstanding but money paid still counts as spent", () => {
    const c = computeExpense({ ...photographer, cancelledAt: new Date() }, [], [{ amount: 5_000_000 }], today);
    const sum = summarise(1_500_000_000, [c]);
    expect(c.status).toBe("cancelled");
    expect(sum.outstanding).toBe(0);
    expect(sum.spent).toBe(5_000_000);
    expect(sum.committed).toBe(5_000_000);
  });
});

describe("summarise", () => {
  it("computes the ₦15m dashboard", () => {
    const s = summarise(1_500_000_000, [computeExpense(photographer, plan, [{ amount: 20_000_000 }], today)]);
    expect(s).toMatchObject({ spent: 20_000_000, committed: 50_000_000, outstanding: 30_000_000, remaining: 1_450_000_000, pendingCount: 1 });
  });
});

describe("Aso Ebi order maths", () => {
  it("adds delivery fee only for home delivery", () => {
    expect(orderTotals([{ unitPrice: 8_500_000, quantity: 2 }], 500_000, "delivery").total).toBe(17_500_000);
    expect(orderTotals([{ unitPrice: 8_500_000, quantity: 2 }], 500_000, "pickup").total).toBe(17_000_000);
  });
  it("derives order status from verified amount paid", () => {
    expect(orderStatusFor(100, 0, false)).toBe("pending_payment");
    expect(orderStatusFor(100, 50, false)).toBe("partially_paid");
    expect(orderStatusFor(100, 100, false)).toBe("paid");
    expect(orderStatusFor(100, 100, true)).toBe("cancelled");
  });
});

describe("Nigerian formats", () => {
  it("normalises phone numbers", () => {
    expect(normaliseNgPhone("0803 123 4567")).toBe("+2348031234567");
    expect(normaliseNgPhone("+234 805 987 6543")).toBe("+2348059876543");
    expect(normaliseNgPhone("2349012223344")).toBe("+2349012223344");
    expect(normaliseNgPhone("12345")).toBeNull();
  });
  it("handles naira/kobo", () => {
    expect(toKobo("₦85,000")).toBe(8_500_000);
    expect(naira(1_500_000_000)).toBe("₦15,000,000");
  });
});

describe("reminder stages", () => {
  it("picks the tightest stage reached, so missed runs catch up without spamming", () => {
    expect(reminderStageForTest(7, [7, 3, 0])).toBe(7);
    expect(reminderStageForTest(5, [7, 3, 0])).toBe(7);
    expect(reminderStageForTest(3, [7, 3, 0])).toBe(3);
    expect(reminderStageForTest(0, [7, 3, 0])).toBe(0);
    expect(reminderStageForTest(10, [7, 3, 0])).toBeNull();
  });
});
