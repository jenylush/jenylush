import Link from "next/link";
import { runRemindersNow } from "@/app/actions/settings";
import { SubmitButton } from "@/components/client";
import { MonthGrid } from "@/components/month-grid";
import { Card, EmptyState, Money, PageHeader, Stamp, Stat, Tabs, cx } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { loadExpenses, scheduleFrom } from "@/lib/data";
import { daysBetween, fmtDate, relativeDays, todayISO } from "@/lib/dates";
import { naira } from "@/lib/money";

export const metadata = { title: "Payment Schedule" };

const tone = { paid: "sage", partial: "gold", due: "ink", overdue: "rose" } as const;

export default async function Schedule({ searchParams }: { searchParams: Promise<{ view?: string; month?: string; show?: string }> }) {
  const sp = await searchParams;
  const { wedding, weddingId } = await requireWorkspace();
  const today = todayISO();
  const items = scheduleFrom(await loadExpenses(weddingId, today), today);
  const open = items.filter((i) => i.status !== "paid");
  const overdue = open.filter((i) => i.status === "overdue");
  const next30 = open.filter((i) => i.date >= today && daysBetween(today, i.date) <= 30);
  const shown = sp.show === "all" ? items : open;
  const view = sp.view === "calendar" ? "calendar" : "list";

  const groups = new Map<string, typeof items>();
  for (const i of shown) {
    const k = i.status === "overdue" ? "Overdue" : new Date(`${i.date}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    groups.set(k, [...(groups.get(k) ?? []), i]);
  }

  return (
    <>
      <PageHeader
        folio="IV · Payment Schedule"
        title="What's due, and when"
        lede={`Reminders go out ${wedding.reminderOffsets.map((o) => (o === 0 ? "on the day" : `${o} days before`)).join(", ")}, then every ${wedding.overdueRepeatDays} days while a payment is overdue.`}
        actions={<form action={runRemindersNow}><SubmitButton variant="ghost" pendingText="Checking…">Run reminders now</SubmitButton></form>}
      />
      <div className="sheet mb-6 grid grid-cols-2 gap-5 p-5 md:grid-cols-4">
        <Stat label="Overdue" value={naira(overdue.reduce((s, i) => s + i.amount, 0))} tone="rose" sub={`${overdue.length} payment${overdue.length === 1 ? "" : "s"}`} />
        <Stat label="Due in 30 days" value={naira(next30.reduce((s, i) => s + i.amount, 0))} tone="gold" sub={`${next30.length} payments`} />
        <Stat label="All upcoming" value={naira(open.reduce((s, i) => s + i.amount, 0))} sub={`${open.length} payments`} />
        <Stat label="Paid instalments" value={items.length - open.length} tone="sage" />
      </div>
      <Tabs current={view === "calendar" ? "/app/schedule?view=calendar" : sp.show === "all" ? "/app/schedule?show=all" : "/app/schedule"} items={[{ href: "/app/schedule", label: "Upcoming" }, { href: "/app/schedule?show=all", label: "All incl. paid" }, { href: "/app/schedule?view=calendar", label: "Calendar" }]} />
      {view === "calendar" ? (
        <MonthGrid month={sp.month ?? today.slice(0, 7)} today={today} basePath="/app/schedule?view=calendar" items={items.map((i) => ({ date: i.date, label: `${naira(i.amount)} ${i.vendorName ?? i.expenseName}`, href: `/app/budget/${i.expenseId}`, tone: i.status === "paid" ? "muted" : i.status === "overdue" ? "rose" : "gold" }))} />
      ) : shown.length ? (
        <div className="space-y-6">
          {[...groups.entries()].map(([g, list]) => (
            <Card key={g} title={g} folio={g === "Overdue" ? "!" : undefined} pad={false} action={<span className="figure text-sm">{naira(list.reduce((s, i) => s + i.amount, 0))}</span>}>
              <ul className="divide-y divide-linen">
                {list.map((i) => {
                  const dd = daysBetween(today, i.date);
                  return (
                    <li key={i.key}>
                      <Link href={`/app/budget/${i.expenseId}`} className="grid grid-cols-[4.2rem_1fr_auto] items-center gap-4 px-5 py-3.5 hover:bg-gold-soft/20">
                        <span className={cx("text-center", i.status === "overdue" ? "text-rose" : "text-ink")}>
                          <span className="font-display block text-2xl leading-none">{i.date.slice(8)}</span>
                          <span className="block text-[0.6rem] uppercase tracking-widest text-muted">{fmtDate(i.date, "day").split(" ")[1]}</span>
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{i.vendorName ?? i.expenseName}</span>
                          <span className="block truncate text-xs text-muted">{i.label} · {i.expenseName} · {i.status === "paid" ? "paid" : relativeDays(dd)}</span>
                        </span>
                        <span className="text-right"><Money value={i.amount} className="block" /><Stamp tone={tone[i.status]} className="mt-1">{i.status}</Stamp></span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      ) : (
        <Card><EmptyState title="Nothing outstanding">Every scheduled payment is settled. 🎉</EmptyState></Card>
      )}
    </>
  );
}
