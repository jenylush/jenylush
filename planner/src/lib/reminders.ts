import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { campaigns, orders, tasks, weddings } from "@/db/schema";
import { guestOrderUrl } from "./asoebi";
import { loadExpenses, scheduleFrom } from "./data";
import { daysBetween, fmtDate, todayISO } from "./dates";
import { naira } from "./money";
import { reminderStage } from "./finance";
import { notifyCouple, notifyGuest } from "./notify";

const stageText = (o: number) => (o === 0 ? "due today" : o === 1 ? "due tomorrow" : `due in ${o} days`);

export async function runReminders(now = new Date(), onlyWeddingId?: string) {
  const today = todayISO(now);
  const all = await db
    .select()
    .from(weddings)
    .where(and(sql`${weddings.onboardedAt} is not null`, onlyWeddingId ? eq(weddings.id, onlyWeddingId) : undefined));
  const report = { weddings: all.length, sent: 0 };

  for (const w of all) {
    /* 1 ─ vendor / expense payments */
    const list = await loadExpenses(w.id, today);
    for (const item of scheduleFrom(list, today)) {
      if (item.status === "paid") continue;
      const d = daysBetween(today, item.date);
      const who = item.vendorName ? ` to ${item.vendorName}` : "";
      const href = `/app/budget/${item.expenseId}`;
      const rows: Array<[string, string]> = [
        ["Payment", `${item.expenseName} — ${item.label}`],
        ["Vendor", item.vendorName ?? "—"],
        ["Amount due", naira(item.amount)],
        ["Due date", fmtDate(item.date, "long")],
        ["Outstanding on this expense", naira(item.outstandingOnExpense)],
      ];
      let stageKey: string | null = null;
      let headline = "";
      let trigger = "";
      if (d >= 0) {
        const stage = reminderStage(d, w.reminderOffsets);
        if (stage == null) continue;
        stageKey = `d${stage}`;
        headline = `${naira(item.amount)}${who} is ${stageText(d)}`;
        trigger = stage === 0 ? "On the due date" : `${stage} days before due date`;
      } else {
        const overdueBy = -d;
        const cycle = Math.floor((overdueBy - 1) / Math.max(1, w.overdueRepeatDays));
        stageKey = cycle === 0 ? "overdue" : `overdue-${cycle}`;
        headline = cycle === 0 ? `Overdue: ${naira(item.amount)}${who}` : `Still unpaid after ${overdueBy} days: ${naira(item.amount)}${who}`;
        trigger = cycle === 0 ? "Payment became overdue" : `Instalment still unpaid (repeat every ${w.overdueRepeatDays} days)`;
      }
      report.sent += await notifyCouple(w, {
        type: d < 0 ? "vendor_payment_overdue" : "vendor_payment_due",
        trigger,
        title: headline,
        body: `${item.expenseName} · ${item.label} · ${fmtDate(item.date)}`,
        href,
        dedupeKey: `sched:${item.key}:${item.date}:${stageKey}`,
        entity: { type: "expense", id: item.expenseId },
        email: { eyebrow: d < 0 ? "Payment overdue" : "Payment reminder", title: headline, rows, cta: { label: "View this expense", href } },
      });
    }

    /* 2 ─ checklist tasks & activities */
    const open = await db.select().from(tasks).where(and(eq(tasks.weddingId, w.id), isNull(tasks.completedAt), sql`${tasks.dueDate} is not null`));
    for (const t of open) {
      const d = daysBetween(today, t.dueDate!);
      let key: string | null = null;
      let title = "";
      if (d < 0) {
        key = "overdue";
        title = `Overdue: ${t.title}`;
      } else {
        const stage = reminderStage(d, t.remindDaysBefore.length ? t.remindDaysBefore : []);
        if (stage == null) continue;
        key = `d${stage}`;
        title = d === 0 ? `Today: ${t.title}` : `${t.title} — ${stageText(d)}`;
      }
      report.sent += await notifyCouple(w, {
        type: t.kind === "activity" ? "activity_reminder" : "task_reminder",
        trigger: d < 0 ? "Task became overdue" : `${d} days before deadline`,
        title,
        body: t.description ?? fmtDate(t.dueDate, "long"),
        href: "/app/checklist",
        dedupeKey: `task:${t.id}:${t.dueDate}:${key}`,
        entity: { type: "task", id: t.id },
        email: { eyebrow: t.kind === "activity" ? "Wedding activity" : "Checklist", title, intro: t.description ?? undefined, rows: [["Due", fmtDate(t.dueDate, "long")], ["Priority", t.priority]], cta: { label: "Open checklist", href: "/app/checklist" } },
      });
    }

    /* 3 ─ wedding countdown milestones */
    if (w.weddingDate) {
      const d = daysBetween(today, w.weddingDate);
      const m = reminderStage(d, [60, 30, 14, 7, 1]);
      if (m != null) {
        const openCount = open.length;
        report.sent += await notifyCouple(w, {
          type: "countdown",
          trigger: `${m} days before the wedding`,
          title: d <= 1 ? "Tomorrow is the day" : `${d} days to go — checklist check-in`,
          body: `${openCount} checklist item${openCount === 1 ? "" : "s"} still open.`,
          href: "/app/checklist",
          dedupeKey: `wedding:${w.id}:${w.weddingDate}:countdown-${m}`,
          email: { eyebrow: "Countdown", title: `${d} days until ${w.partnerOneName} & ${w.partnerTwoName}`, intro: `You have ${openCount} open checklist items. A good moment to confirm vendors and guest numbers.`, cta: { label: "Review the checklist", href: "/app/checklist" } },
        });
      }
    }

    /* 4 ─ Aso Ebi guests with outstanding balances near the payment deadline */
    const camps = await db.select().from(campaigns).where(and(eq(campaigns.weddingId, w.id), eq(campaigns.isPublished, true)));
    for (const c of camps) {
      if (!c.paymentDeadline) continue;
      const d = daysBetween(today, c.paymentDeadline);
      if (d < 0 || d > w.guestReminderDays) continue;
      const owing = await db.select().from(orders).where(and(eq(orders.campaignId, c.id), inArray(orders.status, ["pending_payment"])));
      for (const o of owing) {
        const due = o.total - o.amountPaid;
        report.sent += await notifyGuest(w, { email: o.email }, {
          type: "asoebi_deadline_reminder",
          trigger: `${w.guestReminderDays} days before Aso Ebi payment deadline`,
          title: `Aso Ebi balance due ${fmtDate(c.paymentDeadline)}`,
          body: `${naira(due)} outstanding on ${o.code}`,
          dedupeKey: `order:${o.id}:deadline:${c.paymentDeadline}`,
          entity: { type: "order", id: o.id },
          email: {
            eyebrow: `${w.partnerOneName} & ${w.partnerTwoName} · Aso Ebi`,
            title: `A gentle reminder about your Aso Ebi`,
            intro: `Hi ${o.fullName.split(" ")[0]}, the payment deadline for ${c.fabricName} is ${fmtDate(c.paymentDeadline, "long")}.`,
            rows: [["Order", o.code], ["Outstanding", naira(due)], ["Deadline", fmtDate(c.paymentDeadline)]],
            cta: { label: "Complete payment", href: guestOrderUrl(o) },
          },
        });
      }
    }
  }

  return report;
}
