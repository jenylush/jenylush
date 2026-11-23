import { and, eq, isNull } from "drizzle-orm";
import { MonthGrid, type CalItem } from "@/components/month-grid";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { campaigns, tasks } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { loadExpenses, loadLookups, scheduleFrom } from "@/lib/data";
import { todayISO } from "@/lib/dates";
import { nairaShort } from "@/lib/money";

export const metadata = { title: "Calendar" };

export default async function Calendar({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const { wedding, weddingId } = await requireWorkspace();
  const today = todayISO();
  const [list, l, openTasks, camps] = await Promise.all([
    loadExpenses(weddingId, today),
    loadLookups(weddingId),
    db.select().from(tasks).where(and(eq(tasks.weddingId, weddingId), isNull(tasks.completedAt))),
    db.select().from(campaigns).where(eq(campaigns.weddingId, weddingId)),
  ]);
  const items: CalItem[] = [
    ...l.events.filter((e) => e.date).map((e) => ({ date: e.date!, label: `✦ ${e.name}`, tone: "ink" as const })),
    ...(wedding.weddingDate ? [{ date: wedding.weddingDate, label: "✦ The wedding", tone: "ink" as const }] : []),
    ...scheduleFrom(list, today).filter((i) => i.status !== "paid").map((i) => ({ date: i.date, label: `₦ ${nairaShort(i.amount).slice(1)} ${i.vendorName ?? i.expenseName}`, href: `/app/budget/${i.expenseId}`, tone: i.status === "overdue" ? ("rose" as const) : ("gold" as const) })),
    ...openTasks.filter((t) => t.dueDate).map((t) => ({ date: t.dueDate!, label: t.title, href: "/app/checklist", tone: t.dueDate! < today ? ("rose" as const) : ("sage" as const) })),
    ...camps.flatMap((c) => [c.paymentDeadline && { date: c.paymentDeadline, label: `Aso Ebi deadline`, href: `/app/asoebi/${c.id}`, tone: "gold" as const }, c.salesCloseAt && { date: c.salesCloseAt, label: `Aso Ebi sales close`, href: `/app/asoebi/${c.id}`, tone: "gold" as const }].filter(Boolean) as CalItem[]),
  ];
  return (
    <>
      <PageHeader folio="VI · Calendar" title="Everything, by date" lede="Events, payment deadlines, checklist tasks and Aso Ebi dates in one view." />
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 bg-ink" />Events</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 bg-gold" />Payments</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 bg-sage" />Tasks</span>
        <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 bg-rose" />Overdue</span>
      </div>
      <MonthGrid month={sp.month ?? today.slice(0, 7)} today={today} basePath="/app/calendar" items={items} />
    </>
  );
}
