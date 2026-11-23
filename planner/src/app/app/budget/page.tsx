import Link from "next/link";
import { deleteCategory, saveCategory, updateBudget } from "@/app/actions/budget";
import { AllocationBars } from "@/components/charts";
import { ActionForm, AutoSubmit, ConfirmButton, SubmitButton } from "@/components/client";
import { Card, EmptyState, Field, Input, LinkButton, Money, MoneyInput, PageHeader, Ribbon, Select, Stamp, Stat, Tabs, expenseTone } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { byCategory, loadExpenses, loadLookups } from "@/lib/data";
import { fmtDate } from "@/lib/dates";
import { EXPENSE_STATUS_LABEL, summarise, type ExpenseStatus } from "@/lib/finance";
import { naira } from "@/lib/money";

export const metadata = { title: "Budget & Expenses" };

type SP = { tab?: string; q?: string; category?: string; event?: string; status?: string; vendor?: string };

export default async function BudgetPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { wedding, weddingId } = await requireWorkspace();
  const [list, lookups] = await Promise.all([loadExpenses(weddingId), loadLookups(weddingId)]);
  const summary = summarise(wedding.totalBudget, list.map((e) => e.state));
  const cats = byCategory(list, lookups.categories);
  const tab = sp.tab === "categories" ? "categories" : "expenses";

  const q = sp.q?.toLowerCase().trim();
  const filtered = list.filter(
    (e) =>
      (!q || [e.name, e.vendor?.name, e.description, e.notes].some((x) => x?.toLowerCase().includes(q))) &&
      (!sp.category || (sp.category === "none" ? !e.categoryId : e.categoryId === sp.category)) &&
      (!sp.event || e.eventId === sp.event) &&
      (!sp.vendor || e.vendorId === sp.vendor) &&
      (!sp.status || e.state.status === sp.status),
  );
  const totalAllocated = lookups.categories.reduce((s, c) => s + c.allocated, 0);

  return (
    <>
      <PageHeader
        folio="II · Budget & Expenses"
        title="The ledger"
        lede="Every cost line for every event. Outstanding balances and statuses recalculate from the payments you record."
        actions={
          <>
            <details className="relative">
              <summary className="list-none"><span className="inline-flex cursor-pointer items-center gap-2 border border-linen px-4 py-2.5 text-sm font-semibold hover:border-gold">Export ▾</span></summary>
              <div className="sheet absolute right-0 z-20 mt-1 w-64 p-2 text-sm">
                <a className="block px-3 py-2 hover:bg-ivory" href="/api/exports/budget?format=xlsx">Excel workbook (.xlsx)</a>
                <a className="block px-3 py-2 hover:bg-ivory" href="/api/exports/budget?format=docx">Word / Google Docs (.docx)</a>
                <a className="block px-3 py-2 hover:bg-ivory" href="/api/exports/budget?format=csv">CSV for Google Sheets</a>
                <Link className="block px-3 py-2 text-gold-deep hover:bg-ivory" href="/app/reports#google">Live Google Sheets link →</Link>
              </div>
            </details>
            <LinkButton href="/app/budget/new" variant="primary">+ Add expense</LinkButton>
          </>
        }
      />

      <div className="sheet mb-6 grid grid-cols-2 gap-5 p-5 md:grid-cols-5">
        <Stat label="Total budget" value={naira(summary.budget)} />
        <Stat label="Committed" value={naira(summary.committed)} sub={`${summary.utilisedPct}%`} />
        <Stat label="Paid" value={naira(summary.spent)} tone="sage" />
        <Stat label="Outstanding" value={naira(summary.outstanding)} tone="gold" />
        <Stat label="Remaining" value={naira(summary.remaining)} tone={summary.remaining < 0 ? "rose" : "ink"} />
      </div>

      <Tabs current={`/app/budget${tab === "categories" ? "?tab=categories" : ""}`} items={[{ href: "/app/budget", label: "Expenses", count: list.length }, { href: "/app/budget?tab=categories", label: "Categories & allocation", count: lookups.categories.length }]} />

      {tab === "expenses" ? (
        <Card pad={false}>
          <AutoSubmit className="grid gap-2 border-b border-linen p-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(4,1fr)_auto]">
            <Input type="search" name="q" placeholder="Search expenses or vendors…" defaultValue={sp.q} />
            <Select name="category" defaultValue={sp.category ?? ""}><option value="">All categories</option>{lookups.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}<option value="none">Uncategorised</option></Select>
            <Select name="event" defaultValue={sp.event ?? ""}><option value="">All events</option>{lookups.events.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            <Select name="vendor" defaultValue={sp.vendor ?? ""}><option value="">All vendors</option>{lookups.vendors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            <Select name="status" defaultValue={sp.status ?? ""}><option value="">Any status</option>{(Object.keys(EXPENSE_STATUS_LABEL) as ExpenseStatus[]).map((s) => <option key={s} value={s}>{EXPENSE_STATUS_LABEL[s]}</option>)}</Select>
            <button className="border border-linen px-3 text-sm hover:border-gold">Filter</button>
          </AutoSubmit>
          {filtered.length ? (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[880px]">
                <thead>
                  <tr><th>Expense</th><th>Vendor</th><th className="num">Total</th><th className="num">Paid</th><th className="num">Outstanding</th><th>Status</th><th>Next due</th></tr>
                </thead>
                <tbody>
                  {filtered.map((e) => (
                    <tr key={e.id} className={e.state.status === "cancelled" ? "opacity-55" : ""}>
                      <td>
                        <Link href={`/app/budget/${e.id}`} className="font-semibold text-ink hover:underline">{e.name}</Link>
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                          {e.category && <i className="inline-block h-2 w-2" style={{ background: e.category.color }} />}
                          {e.category?.name ?? "Uncategorised"}{e.event && <> · {e.event.name}</>}
                        </div>
                      </td>
                      <td className="text-ink-soft">{e.vendor ? <Link className="hover:underline" href={`/app/vendors/${e.vendor.id}`}>{e.vendor.name}</Link> : "—"}</td>
                      <td className="num">{naira(e.state.total)}{e.actualCost == null && <div className="text-[0.65rem] text-faint">estimate</div>}</td>
                      <td className="num text-sage">{naira(e.state.paid)}</td>
                      <td className="num w-40">
                        {naira(e.state.outstanding)}
                        <div className="mt-1.5"><Ribbon value={e.state.progress} tone={e.state.status === "overdue" ? "rose" : "sage"} height={4} /></div>
                      </td>
                      <td><Stamp tone={expenseTone(e.state.status)}>{EXPENSE_STATUS_LABEL[e.state.status]}</Stamp></td>
                      <td className="whitespace-nowrap text-xs text-ink-soft">{e.state.nextDue ? <>{fmtDate(e.state.nextDue.date)}<div className="text-faint">{e.state.nextDue.label} · {naira(e.state.nextDue.amount)}</div></> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td colSpan={2} className="border-t border-ink px-[0.9rem] py-3">{filtered.length} expenses</td>
                    <td className="num border-t border-ink px-[0.9rem]">{naira(filtered.reduce((s, e) => s + (e.state.status === "cancelled" ? 0 : e.state.total), 0))}</td>
                    <td className="num border-t border-ink px-[0.9rem]">{naira(filtered.reduce((s, e) => s + e.state.paid, 0))}</td>
                    <td className="num border-t border-ink px-[0.9rem]">{naira(filtered.reduce((s, e) => s + (e.state.status === "cancelled" ? 0 : e.state.outstanding), 0))}</td>
                    <td colSpan={2} className="border-t border-ink" />
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <EmptyState title={list.length ? "No expenses match these filters" : "No expenses yet"} action={<LinkButton href="/app/budget/new" variant="primary">Add an expense</LinkButton>} />
          )}
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <Card title="Categories" folio="§" pad={false} action={<span className="figure text-xs text-muted">allocated {naira(totalAllocated)} / {naira(wedding.totalBudget)}</span>}>
            <ul className="divide-y divide-linen">
              {lookups.categories.map((c) => {
                const st = cats.find((x) => x.id === c.id);
                return (
                  <li key={c.id}>
                    <details className="group">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 hover:bg-gold-soft/20">
                        <span className="flex items-center gap-2.5 text-sm"><i className="inline-block h-3 w-3" style={{ background: c.color }} />{c.name}<span className="text-xs text-faint">{st?.count ?? 0} items</span></span>
                        <span className="figure text-sm">{naira(c.allocated)} <span className="ml-1 text-xs text-gold-deep group-open:hidden">edit</span></span>
                      </summary>
                      <div className="border-t border-dashed border-linen bg-ivory/50 px-5 py-4">
                        <ActionForm action={saveCategory} className="grid items-end gap-3 sm:grid-cols-[1fr_9rem_4rem_auto]" closeOnSuccess>
                          <input type="hidden" name="id" value={c.id} />
                          <Field label="Name"><Input name="name" defaultValue={c.name} required /></Field>
                          <Field label="Allocation"><MoneyInput name="allocated" defaultValue={c.allocated} /></Field>
                          <Field label="Colour"><Input type="color" name="color" defaultValue={c.color} className="h-[42px] p-1" /></Field>
                          <SubmitButton size="sm">Save</SubmitButton>
                        </ActionForm>
                        <form action={deleteCategory} className="mt-3">
                          <input type="hidden" name="id" value={c.id} />
                          <ConfirmButton message={`Delete "${c.name}"? Its expenses will become uncategorised.`}>Delete category</ConfirmButton>
                        </form>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-linen p-5">
              <div className="eyebrow mb-3">New category</div>
              <ActionForm action={saveCategory} className="grid items-end gap-3 sm:grid-cols-[1fr_9rem_4rem_auto]" resetOnSuccess>
                <Field label="Name"><Input name="name" placeholder="e.g. Gele stylist" required /></Field>
                <Field label="Allocation"><MoneyInput name="allocated" /></Field>
                <Field label="Colour"><Input type="color" name="color" defaultValue="#B89B6A" className="h-[42px] p-1" /></Field>
                <SubmitButton size="sm">Add</SubmitButton>
              </ActionForm>
            </div>
          </Card>
          <div className="space-y-6">
            <Card title="Overall budget" folio="Σ">
              <ActionForm action={updateBudget} className="flex items-end gap-3">
                <Field label="Total wedding budget" className="flex-1"><MoneyInput name="totalBudget" defaultValue={wedding.totalBudget} /></Field>
                <SubmitButton>Update</SubmitButton>
              </ActionForm>
              {totalAllocated !== wedding.totalBudget && (
                <p className="mt-3 text-xs text-muted">
                  Category allocations add up to {naira(totalAllocated)} — {totalAllocated > wedding.totalBudget ? <span className="text-rose">{naira(totalAllocated - wedding.totalBudget)} more</span> : <>{naira(wedding.totalBudget - totalAllocated)} less</>} than the budget.
                </p>
              )}
            </Card>
            <Card title="Allocation vs committed" folio="≈">
              <AllocationBars rows={cats.filter((c) => c.allocated || c.committed)} />
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
