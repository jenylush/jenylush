import { toggleSheetsFeed } from "@/app/actions/settings";
import { AllocationBars, MonthBars } from "@/components/charts";
import { CopyButton } from "@/components/client";
import { Button, Card, PageHeader, Stat } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { appUrl } from "@/lib/config";
import { budgetData } from "@/lib/exports";
import { naira } from "@/lib/money";

export const metadata = { title: "Reports & Exports" };

const REPORTS = [
  ["overall", "Overall budget report", "Totals, category breakdown and upcoming payments."],
  ["expenses", "Expense breakdown", "Every expense with total, paid, balance and status."],
  ["vendors", "Vendor payment report", "Agreed, paid and outstanding per vendor."],
  ["outstanding", "Outstanding payments", "Everything still to pay, by due date."],
  ["completed", "Completed payments", "Every payment made, with references."],
  ["monthly", "Monthly spending", "How much went out each month."],
  ["budget-vs-actual", "Budget versus actual", "Allocation against committed spend per category."],
] as const;

export default async function Reports() {
  const { wedding } = await requireWorkspace();
  const { list, summary, cats } = await budgetData(wedding);
  const months = new Map<string, number>();
  for (const e of list) for (const p of e.payments) months.set(p.paidOn.slice(0, 7), (months.get(p.paidOn.slice(0, 7)) ?? 0) + p.amount);
  const monthData = [...months.entries()].sort().slice(-8).map(([m, v]) => ({ label: new Date(`${m}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "short" }), value: v }));
  const feed = wedding.sheetsFeedToken ? `${appUrl()}/api/sheets/${wedding.sheetsFeedToken}` : null;

  return (
    <>
      <PageHeader folio="XI · Reports & Exports" title="Reports & exports" lede="Download your budget for your family, your planner or your own records — as Excel, PDF, Word or straight into Google Sheets." />
      <div className="sheet mb-6 grid grid-cols-2 gap-5 p-5 md:grid-cols-4">
        <Stat label="Budget" value={naira(summary.budget)} />
        <Stat label="Committed" value={naira(summary.committed)} />
        <Stat label="Spent" value={naira(summary.spent)} tone="sage" />
        <Stat label="Outstanding" value={naira(summary.outstanding)} tone="gold" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Budget sheet" folio="a.">
          <p className="mb-4 text-sm text-muted">The full budget as a multi-sheet workbook: Summary, Budget vs actual, Expenses, Payment schedule, Completed payments and Monthly spending — with naira formatting and live total formulas.</p>
          <div className="flex flex-wrap gap-2">
            <a className="inline-flex items-center bg-ink px-4 py-2.5 text-sm font-semibold text-ivory" href="/api/exports/budget?format=xlsx">Excel (.xlsx)</a>
            <a className="inline-flex items-center border border-linen px-4 py-2.5 text-sm font-semibold hover:border-gold" href="/api/exports/budget?format=docx">Word / Google Docs (.docx)</a>
            <a className="inline-flex items-center border border-linen px-4 py-2.5 text-sm font-semibold hover:border-gold" href="/api/exports/budget?format=csv">CSV</a>
          </div>
          <p className="mt-3 text-xs text-muted">To open in Google Docs or Sheets: upload the .docx / .xlsx to Google Drive, then “Open with Google Docs / Sheets”.</p>
        </Card>

        <Card title="Live Google Sheets link" folio="b." className="scroll-mt-6" >
          <div id="google" />
          <p className="mb-4 text-sm text-muted">A private, read-only link that Google Sheets refreshes automatically. In any Google Sheet, paste into cell A1:</p>
          {feed ? (
            <>
              <code className="figure block break-all border border-dashed border-gold bg-gold-soft/30 px-3 py-2 text-xs">=IMPORTDATA(&quot;{feed}&quot;)</code>
              <div className="mt-3 flex flex-wrap gap-2">
                <CopyButton text={`=IMPORTDATA("${feed}")`} label="Copy formula" variant="primary" />
                <a className="inline-flex items-center border border-linen px-4 py-2.5 text-sm font-semibold hover:border-gold" href="https://sheets.new" target="_blank" rel="noreferrer">Open a new Google Sheet ↗</a>
                <form action={toggleSheetsFeed}><input type="hidden" name="on" value="0" /><Button variant="danger">Turn off link</Button></form>
              </div>
              <p className="mt-3 text-xs text-muted">Anyone with this link can read your budget lines. Turn it off (or off and on again to rotate it) whenever you like. {appUrl().includes("localhost") && "Google can only reach this once the app is deployed on a public URL."}</p>
            </>
          ) : (
            <form action={toggleSheetsFeed}><input type="hidden" name="on" value="1" /><Button>Create my Google Sheets link</Button></form>
          )}
        </Card>

        <Card title="Financial reports (PDF)" folio="c." pad={false} className="lg:col-span-2">
          <ul className="grid divide-y divide-linen sm:grid-cols-2 sm:divide-y-0">
            {REPORTS.map(([k, t, d]) => (
              <li key={k} className="flex items-center justify-between gap-4 border-linen px-5 py-4 sm:border-b sm:odd:border-r">
                <div><div className="font-semibold">{t}</div><div className="text-xs text-muted">{d}</div></div>
                <div className="flex shrink-0 gap-1.5">
                  <a className="border border-linen px-2.5 py-1.5 text-xs font-semibold hover:border-gold" href={`/api/exports/report?type=${k}`}>PDF</a>
                  <a className="border border-linen px-2.5 py-1.5 text-xs font-semibold hover:border-gold" href="/api/exports/budget?format=xlsx" title="All reports are sheets in the Excel workbook">XLSX</a>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Aso Ebi register" folio="d.">
          <div className="flex flex-wrap gap-2 text-sm">
            <a className="bg-ink px-3 py-2 font-semibold text-ivory" href="/api/exports/register?filter=all">Entire register</a>
            <a className="border border-linen px-3 py-2 font-semibold hover:border-gold" href="/api/exports/register?filter=paid">Guests who have paid</a>
            <a className="border border-linen px-3 py-2 font-semibold hover:border-gold" href="/api/exports/register?filter=awaiting">Awaiting payment</a>
            <a className="border border-linen px-3 py-2 font-semibold hover:border-gold" href="/api/exports/register?filter=delivery">Delivery addresses</a>
          </div>
        </Card>

        <Card title="Monthly spending" folio="e.">{monthData.length ? <MonthBars data={monthData} /> : <p className="text-sm text-muted">No payments recorded yet.</p>}</Card>

        <Card title="Budget versus actual" folio="f." className="lg:col-span-2"><AllocationBars columns={2} rows={cats.filter((c) => c.allocated || c.committed)} /></Card>
      </div>
    </>
  );
}
