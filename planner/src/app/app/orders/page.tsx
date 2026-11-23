import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { confirmPayment, markNotReceived } from "@/app/actions/asoebi";
import { AutoSubmit, ConfirmButton } from "@/components/client";
import { Button, Card, EmptyState, Input, PageHeader, Select, Stamp, Stat, orderTone } from "@/components/ui";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { ORDER_LABEL } from "@/lib/asoebi";
import { requireWorkspace } from "@/lib/auth";
import { fmtDateTime } from "@/lib/dates";
import { naira } from "@/lib/money";
import { displayPhone } from "@/lib/phone";

export const metadata = { title: "Orders & Payments" };

export default async function Orders({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const sp = await searchParams;
  const { weddingId } = await requireWorkspace();
  const list = await db.query.orders.findMany({ where: eq(orders.weddingId, weddingId), with: { items: true, payments: true }, orderBy: [desc(orders.createdAt)] });
  const q = sp.q?.toLowerCase().trim();
  const shown = list.filter((o) => (!sp.status || o.status === sp.status) && (!q || [o.fullName, o.code, o.email ?? "", o.phone].some((x) => x.toLowerCase().includes(q))));
  const live = list.filter((o) => o.status !== "cancelled");
  const toConfirm = list.filter((o) => o.status === "transfer_reported");
  const sum = (xs: typeof list) => xs.reduce((s, o) => s + o.total, 0);

  return (
    <>
      <PageHeader folio="IX · Orders & Payments" title="Orders & payments" lede="Guests pay by bank transfer and tap “I have sent the money”. Check your bank app, then confirm each one here." />
      <div className="sheet mb-6 grid grid-cols-2 gap-5 p-5 md:grid-cols-4">
        <Stat label="Ordered value" value={naira(sum(live))} sub={`${live.length} orders`} />
        <Stat label="Confirmed received" value={naira(list.reduce((s, o) => s + o.amountPaid, 0))} tone="sage" />
        <Stat label="Says paid — to confirm" value={naira(sum(toConfirm))} tone="gold" sub={`${toConfirm.length} guests`} />
        <Stat label="Not paid yet" value={naira(sum(list.filter((o) => o.status === "pending_payment")))} tone="rose" />
      </div>

      {toConfirm.length > 0 && (
        <Card className="mb-6" folio="!" title={`Check your bank for these ${toConfirm.length} transfer${toConfirm.length === 1 ? "" : "s"}`} pad={false}>
          <ul className="divide-y divide-linen">
            {toConfirm.map((o) => {
              const p = o.payments.find((x) => x.status === "reported");
              return (
                <li key={o.id} className="grid gap-3 px-5 py-3.5 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                  <div>
                    <Link href={`/app/orders/${o.id}`} className="font-semibold hover:underline">{o.fullName}</Link>
                    <div className="text-xs text-muted">{p?.senderName && p.senderName !== o.fullName ? <>Sender: <b className="text-ink">{p.senderName}</b> · </> : null}{o.code} · {displayPhone(o.phone)} · {p ? `said sent ${fmtDateTime(p.reportedAt)}` : ""}</div>
                  </div>
                  <span className="figure text-lg">{naira(o.total - o.amountPaid)}</span>
                  <div className="flex gap-2">
                    <form action={confirmPayment}><input type="hidden" name="id" value={o.id} /><Button size="sm" variant="primary">✓ Confirm received</Button></form>
                    <form action={markNotReceived}><input type="hidden" name="id" value={o.id} /><ConfirmButton message={`Mark ${o.fullName}'s transfer as not received? They'll go back to “Not paid yet”.`}>Not received</ConfirmButton></form>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card pad={false}>
        <AutoSubmit className="grid gap-2 border-b border-linen p-4 sm:grid-cols-[1fr_14rem]">
          <Input type="search" name="q" placeholder="Search name, order ID, phone…" defaultValue={sp.q} />
          <Select name="status" defaultValue={sp.status ?? ""}><option value="">All statuses</option>{(["pending_payment", "transfer_reported", "paid", "cancelled"] as const).map((k) => <option key={k} value={k}>{ORDER_LABEL[k]}</option>)}</Select>
        </AutoSubmit>
        {shown.length ? (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[820px]">
              <thead><tr><th>Order</th><th>Guest</th><th>Items</th><th className="num">Total</th><th>Payment</th><th>Placed</th><th /></tr></thead>
              <tbody>
                {shown.map((o) => (
                  <tr key={o.id}>
                    <td><Link href={`/app/orders/${o.id}`} className="figure font-semibold underline-offset-2 hover:underline">{o.code}</Link></td>
                    <td>{o.fullName}<div className="text-xs text-muted">{o.deliveryMethod === "delivery" ? "Delivery" : "Pickup"}</div></td>
                    <td className="text-xs">{o.items.map((i) => `${i.quantity} × ${i.packageName}`).join(", ")}</td>
                    <td className="num">{naira(o.total)}</td>
                    <td><Stamp tone={orderTone(o.status)}>{ORDER_LABEL[o.status]}</Stamp></td>
                    <td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(o.createdAt)}</td>
                    <td>{(o.status === "pending_payment" || o.status === "transfer_reported") && <form action={confirmPayment}><input type="hidden" name="id" value={o.id} /><ConfirmButton variant="ghost" message={`Confirm you've received ${naira(o.total - o.amountPaid)} from ${o.fullName}?`}>Mark paid</ConfirmButton></form>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="No orders yet">Share your Aso Ebi link — orders appear here as guests fill in the form.</EmptyState>}
      </Card>
    </>
  );
}
