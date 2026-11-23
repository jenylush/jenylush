import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteVendor } from "@/app/actions/vendors";
import { ConfirmButton } from "@/components/client";
import { Card, LinkButton, PageHeader, Ribbon, Stamp, Stat, expenseTone } from "@/components/ui";
import { VendorForm } from "@/components/vendor-form";
import { requireWorkspace } from "@/lib/auth";
import { loadExpenses, loadLookups } from "@/lib/data";
import { fmtDate } from "@/lib/dates";
import { EXPENSE_STATUS_LABEL } from "@/lib/finance";
import { naira } from "@/lib/money";
import { displayPhone, waNumber } from "@/lib/phone";
import { fileUrl } from "@/lib/storage";

const instTone = { paid: "sage", partial: "gold", due: "muted", overdue: "rose" } as const;

export default async function VendorDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { weddingId } = await requireWorkspace();
  const [list, l] = await Promise.all([loadExpenses(weddingId), loadLookups(weddingId)]);
  const v = l.vendors.find((x) => x.id === id);
  if (!v) notFound();
  const ex = list.filter((e) => e.vendorId === id);
  const live = ex.filter((e) => e.state.status !== "cancelled");
  const agreed = live.reduce((s, e) => s + e.state.total, 0);
  const paid = ex.reduce((s, e) => s + e.state.paid, 0);

  return (
    <>
      <PageHeader
        folio={`III · ${l.categories.find((c) => c.id === v.categoryId)?.name ?? "Vendor"}`}
        title={v.name}
        lede={[v.contactName, v.phone && displayPhone(v.phone), v.email, v.address].filter(Boolean).join(" · ")}
        actions={
          <>
            {v.phone && <a className="inline-flex items-center border border-linen px-4 py-2.5 text-sm font-semibold hover:border-gold" target="_blank" rel="noreferrer" href={`https://wa.me/${waNumber(v.phone)}`}>WhatsApp</a>}
            <LinkButton href={`/app/budget/new?vendor=${v.id}${v.categoryId ? `&category=${v.categoryId}` : ""}`}>+ Expense</LinkButton>
            <form action={deleteVendor}><input type="hidden" name="id" value={v.id} /><ConfirmButton size="md" message="Delete this vendor? Their expenses stay in your budget, unlinked.">Delete</ConfirmButton></form>
          </>
        }
      />
      <div className="sheet mb-6 grid grid-cols-2 gap-5 p-5 md:grid-cols-4">
        <Stat label="Agreed price" value={naira(agreed)} />
        <Stat label="Amount paid" value={naira(paid)} tone="sage" />
        <Stat label="Outstanding" value={naira(Math.max(0, agreed - paid))} tone="gold" />
        <div className="self-end"><Ribbon value={agreed ? paid / agreed : 0} tone="sage" height={10} /></div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          {ex.map((e) => (
            <Card key={e.id} title={<Link className="hover:underline" href={`/app/budget/${e.id}`}>{e.name}</Link>} action={<Stamp tone={expenseTone(e.state.status)}>{EXPENSE_STATUS_LABEL[e.state.status]}</Stamp>} pad={false}>
              {e.state.instalments.length ? (
                <table className="data-table">
                  <thead><tr><th>Payment schedule</th><th>Due</th><th className="num">Amount</th><th>Status</th></tr></thead>
                  <tbody>
                    {e.state.instalments.map((i) => (
                      <tr key={i.id}><td>{i.label}</td><td>{fmtDate(i.dueDate)}</td><td className="num">{naira(i.amount)}</td><td><Stamp tone={instTone[i.status]}>{i.status}</Stamp></td></tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="px-5 py-4 text-sm text-muted">{naira(e.state.total)} · {e.dueDate ? `due ${fmtDate(e.dueDate)}` : "no due date"}</p>
              )}
              <div className="flex justify-between border-t border-linen px-5 py-3 text-xs text-muted"><span>Paid {naira(e.state.paid)} of {naira(e.state.total)}</span><Link href={`/app/budget/${e.id}`} className="text-gold-deep">Record payment →</Link></div>
            </Card>
          ))}
          {!ex.length && <Card><p className="text-sm text-muted">No contract or expenses yet. Add one below or with “+ Expense”.</p></Card>}
        </div>
        <div className="space-y-6">
          {v.contractFileId && <Card title="Contract"><a className="text-gold-deep underline" target="_blank" href={fileUrl(v.contractFileId)!}>Open contract document</a></Card>}
          {v.notes && <Card title="Notes"><p className="whitespace-pre-line text-sm">{v.notes}</p></Card>}
          <details className="sheet">
            <summary className="cursor-pointer px-5 py-3.5 font-display">Edit vendor / add a contract</summary>
            <div className="border-t border-linen p-5"><VendorForm cats={l.categories} evs={l.events} vendor={v} /></div>
          </details>
        </div>
      </div>
    </>
  );
}
