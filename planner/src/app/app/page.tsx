import Link from "next/link";
import { AllocationBars, Ring } from "@/components/charts";
import { Card, EmptyState, LinkButton, Money, Ribbon, Stamp, Stat, cx } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { overviewData } from "@/lib/data";
import { daysBetween, fmtDate, fmtDateTime, relativeDays } from "@/lib/dates";
import { naira, nairaShort } from "@/lib/money";

export const metadata = { title: "Overview" };

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Lagos" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function Overview() {
  const { wedding, user } = await requireWorkspace();
  const d = await overviewData(wedding.id, wedding.totalBudget);
  const s = d.summary;
  const daysLeft = wedding.weddingDate ? daysBetween(d.today, wedding.weddingDate) : null;
  const upcoming = d.schedule.filter((i) => i.status !== "paid").slice(0, 6);
  const vendorCount = d.lookups.vendors.length;
  const ringData = d.cats.filter((c) => c.committed > 0).sort((a, b) => b.committed - a.committed);
  const top = ringData.slice(0, 6);
  const rest = ringData.slice(6).reduce((a, c) => a + c.committed, 0);
  const asoPct = d.aso.expected ? d.aso.collected / d.aso.expected : 0;

  return (
    <div className="space-y-6">
      {/* Masthead */}
      <section className="grid gap-6 border-b border-linen pb-8 md:grid-cols-[1fr_auto] md:items-end">
        <div className="rise">
          <div className="eyebrow mb-2">I · Overview</div>
          <h1 className="font-display text-[2.1rem] leading-tight md:text-5xl">
            {greeting()}, <em className="text-gold-deep">{user.name.split(" ")[0]}</em>.
          </h1>
          <p className="mt-2 text-sm text-muted">
            {wedding.partnerOneName} &amp; {wedding.partnerTwoName}
            {wedding.weddingDate && <> · {fmtDate(wedding.weddingDate, "long")}</>}
            {wedding.venue && <> · {wedding.venue}</>}
          </p>
        </div>
        {daysLeft != null && daysLeft >= 0 && (
          <div className="flex items-end gap-3 md:text-right">
            <span className="font-display text-[4.5rem] leading-[0.8] text-ink md:text-[6rem]">{daysLeft}</span>
            <span className="pb-1 text-xs uppercase leading-tight tracking-[0.22em] text-muted">days<br />to go</span>
          </div>
        )}
      </section>

      {/* The ledger line */}
      <Card pad={false}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 p-5 md:grid-cols-6 md:p-6">
          <div className="col-span-2 md:border-r md:border-linen md:pr-6">
            <Stat big label="Remaining budget" value={naira(s.remaining)} tone={s.remaining < 0 ? "rose" : "ink"} sub={s.remaining < 0 ? "Over budget — review commitments" : `of ${naira(s.budget)} total`} />
          </div>
          <Stat label="Committed" value={nairaShort(s.committed)} sub={`${s.utilisedPct}% utilised`} />
          <Stat label="Spent" value={nairaShort(s.spent)} tone="sage" sub={`${s.spentPct}% of budget`} />
          <Stat label="Outstanding" value={nairaShort(s.outstanding)} tone={s.overdueCount ? "rose" : "gold"} sub={`${s.pendingCount} pending · ${s.overdueCount} overdue`} />
          <Stat label="Vendors" value={vendorCount} sub={<Link className="underline-offset-2 hover:underline" href="/app/vendors">Manage →</Link>} />
        </div>
        <div className="border-t border-linen px-5 pb-5 pt-4 md:px-6">
          <Ribbon
            height={12}
            label="Budget used"
            segments={[
              { value: s.budget ? s.spent / Math.max(s.budget, s.committed) : 0, color: "var(--color-ink)", label: `Paid ${naira(s.spent)}` },
              { value: s.budget ? (s.committed - s.spent) / Math.max(s.budget, s.committed) : 0, color: "var(--color-gold)", label: `Committed, unpaid ${naira(s.committed - s.spent)}` },
            ]}
          />
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[0.7rem] text-muted">
            <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 bg-ink" /> Paid</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 bg-gold" /> Committed, not yet paid</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 bg-sand" /> Uncommitted</span>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.05fr_1fr]">
        <Card folio="01" title="Where the money is going" action={<Link href="/app/budget" className="text-xs text-muted hover:text-ink">All expenses →</Link>}>
          {ringData.length ? (
            <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
              <Ring
                data={[...top.map((c) => ({ label: c.name, value: c.committed, color: c.color })), ...(rest ? [{ label: "Other", value: rest, color: "var(--color-faint)" }] : [])]}
                center={<><span className="eyebrow !text-muted">Committed</span><span className="figure text-xl">{nairaShort(s.committed)}</span></>}
              />
              <ul className="w-full flex-1 space-y-2 text-sm">
                {top.map((c) => (
                  <li key={c.name} className="flex items-center justify-between gap-3 border-b border-linen pb-2">
                    <span className="flex items-center gap-2"><i className="inline-block h-2.5 w-2.5" style={{ background: c.color }} />{c.name}</span>
                    <span className="figure text-ink-soft">{naira(c.committed)}</span>
                  </li>
                ))}
                {rest > 0 && <li className="flex justify-between text-muted"><span>Other categories</span><span className="figure">{naira(rest)}</span></li>}
              </ul>
            </div>
          ) : (
            <EmptyState title="No expenses yet" action={<LinkButton href="/app/budget/new" variant="primary">Add your first expense</LinkButton>}>Add the venue, caterer and photographer to see your budget take shape.</EmptyState>
          )}
        </Card>

        <Card folio="02" title="Upcoming payment deadlines" action={<Link href="/app/schedule" className="text-xs text-muted hover:text-ink">Schedule →</Link>} pad={false}>
          {upcoming.length ? (
            <ul className="divide-y divide-linen">
              {upcoming.map((i) => {
                const dd = daysBetween(d.today, i.date);
                return (
                  <li key={i.key}>
                    <Link href={`/app/budget/${i.expenseId}`} className="grid grid-cols-[3.4rem_1fr_auto] items-center gap-3 px-5 py-3 hover:bg-gold-soft/25">
                      <span className={cx("border-r border-linen pr-3 text-center", i.status === "overdue" ? "text-rose" : "text-ink")}>
                        <span className="font-display block text-xl leading-none">{fmtDate(i.date, "day").split(" ")[0]}</span>
                        <span className="block text-[0.6rem] uppercase tracking-widest text-muted">{fmtDate(i.date, "day").split(" ")[1]}</span>
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm">{i.vendorName ?? i.expenseName}</span>
                        <span className="block truncate text-xs text-muted">{i.label} · {relativeDays(dd)}</span>
                      </span>
                      <span className="text-right">
                        <Money value={i.amount} className="block text-sm" />
                        {i.status === "overdue" && <Stamp tone="rose" className="mt-1">Overdue</Stamp>}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="Nothing due">Add instalments to a vendor and they&apos;ll appear here with reminders.</EmptyState>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card folio="03" title="Budget vs actual" className="lg:col-span-2" action={<Link href="/app/reports" className="text-xs text-muted hover:text-ink">Reports →</Link>}>
          {d.cats.some((c) => c.allocated || c.committed) ? (
            <AllocationBars columns={2} rows={d.cats.filter((c) => c.allocated || c.committed).sort((a, b) => b.allocated - a.allocated).slice(0, 12)} />
          ) : (
            <p className="text-sm text-muted">Set category allocations under Budget &amp; Expenses.</p>
          )}
          <p className="mt-4 text-[0.7rem] text-muted">Frame = allocation · light fill = committed · solid fill = paid. Rose means over allocation.</p>
        </Card>

        <div className="space-y-6">
          <Card folio="04" title="Aso Ebi" action={<Link href="/app/orders" className="text-xs text-muted hover:text-ink">Orders →</Link>}>
            {d.campaignCount ? (
              <>
                <Stat label="Collected" value={naira(d.aso.collected)} tone="sage" sub={`of ${naira(d.aso.expected)} ordered`} />
                <div className="mt-3"><Ribbon value={asoPct} tone="sage" label="Aso Ebi collected" /></div>
                <div className="mt-3 flex justify-between text-xs text-muted"><span>{d.aso.paidOrders} paid of {d.aso.orders} orders</span><span>{d.guestCount} guests</span></div>
                {d.recentPayments.length > 0 && (
                  <ul className="mt-4 space-y-2 border-t border-linen pt-3 text-xs">
                    {d.recentPayments.map(({ p, o }) => (
                      <li key={p.id} className="flex justify-between gap-2"><span className="truncate">{o.fullName} <span className="text-faint">· {fmtDateTime(p.reportedAt)}</span></span><Money value={p.amount} /></li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <EmptyState title="No Aso Ebi yet" action={<LinkButton href="/app/asoebi/new" size="sm">Create a campaign</LinkButton>} />
            )}
          </Card>

          <Card folio="05" title="Next on the checklist" action={<Link href="/app/checklist" className="text-xs text-muted hover:text-ink">All →</Link>} pad={false}>
            {d.openTasks.length ? (
              <ul className="divide-y divide-linen text-sm">
                {d.openTasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span className="truncate">{t.title}</span>
                    <span className={cx("shrink-0 text-xs", t.dueDate && t.dueDate < d.today ? "text-rose" : "text-muted")}>{t.dueDate ? fmtDate(t.dueDate, "day") : "—"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-5 text-sm text-muted">All caught up.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
