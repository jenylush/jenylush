import Link from "next/link";
import { Card, EmptyState, LinkButton, PageHeader, Ribbon, Stamp } from "@/components/ui";
import { requireWorkspace } from "@/lib/auth";
import { loadExpenses, loadLookups } from "@/lib/data";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { displayPhone, waNumber } from "@/lib/phone";

export const metadata = { title: "Vendors" };

export default async function Vendors() {
  const { weddingId } = await requireWorkspace();
  const [list, lookups] = await Promise.all([loadExpenses(weddingId), loadLookups(weddingId)]);
  const rows = lookups.vendors.map((v) => {
    const ex = list.filter((e) => e.vendorId === v.id && e.state.status !== "cancelled");
    const agreed = ex.reduce((s, e) => s + e.state.total, 0);
    const paid = ex.reduce((s, e) => s + e.state.paid, 0);
    const next = ex.map((e) => e.state.nextDue).filter(Boolean).sort((a, b) => a!.date.localeCompare(b!.date))[0];
    const overdue = ex.some((e) => e.state.status === "overdue");
    return { v, agreed, paid, outstanding: agreed - paid, next, overdue, cat: lookups.categories.find((c) => c.id === v.categoryId) };
  });
  const tot = rows.reduce((a, r) => ({ agreed: a.agreed + r.agreed, paid: a.paid + r.paid }), { agreed: 0, paid: 0 });

  return (
    <>
      <PageHeader folio="III · Vendors" title="Vendors & contracts" lede={`${rows.length} vendors · ${naira(tot.agreed)} agreed · ${naira(tot.paid)} paid · ${naira(tot.agreed - tot.paid)} outstanding`} actions={<LinkButton href="/app/vendors/new" variant="primary">+ Add vendor</LinkButton>} />
      {rows.length ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ v, agreed, paid, outstanding, next, overdue, cat }) => (
            <Card key={v.id} pad={false} className="flex flex-col">
              <Link href={`/app/vendors/${v.id}`} className="block flex-1 p-5 hover:bg-gold-soft/15">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="eyebrow !text-muted">{cat?.name ?? "Vendor"}</div>
                    <h2 className="font-display mt-1 truncate text-xl">{v.name}</h2>
                    <div className="mt-0.5 truncate text-xs text-muted">{v.contactName ?? "—"}{v.phone && ` · ${displayPhone(v.phone)}`}</div>
                  </div>
                  {overdue ? <Stamp tone="rose">Overdue</Stamp> : agreed > 0 && outstanding === 0 ? <Stamp tone="sage">Paid</Stamp> : null}
                </div>
                <div className="mt-5 grid grid-cols-3 gap-2 text-xs">
                  <div><div className="text-muted">Agreed</div><div className="figure mt-0.5 text-sm">{naira(agreed)}</div></div>
                  <div><div className="text-muted">Paid</div><div className="figure mt-0.5 text-sm text-sage">{naira(paid)}</div></div>
                  <div><div className="text-muted">Balance</div><div className="figure mt-0.5 text-sm">{naira(outstanding)}</div></div>
                </div>
                <div className="mt-3"><Ribbon value={agreed ? paid / agreed : 0} tone={overdue ? "rose" : "sage"} height={5} /></div>
                <div className="mt-3 text-xs text-muted">{next ? <>Next: <span className="text-ink">{naira(next.amount)}</span> on {fmtDate(next.date)} · {next.label}</> : agreed ? "Nothing scheduled" : "No contract recorded"}</div>
              </Link>
              {v.phone && (
                <div className="flex border-t border-linen text-xs">
                  <a className="flex-1 py-2.5 text-center hover:bg-ivory" href={`tel:${v.phone}`}>Call</a>
                  <a className="flex-1 border-l border-linen py-2.5 text-center hover:bg-ivory" target="_blank" rel="noreferrer" href={`https://wa.me/${waNumber(v.phone)}`}>WhatsApp</a>
                </div>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <Card><EmptyState title="No vendors yet" action={<LinkButton href="/app/vendors/new" variant="primary">Add your first vendor</LinkButton>}>Add your photographer, caterer or decorator with their agreed price and instalment plan.</EmptyState></Card>
      )}
    </>
  );
}
