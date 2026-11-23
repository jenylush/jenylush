import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { reconcileAll } from "@/app/actions/asoebi";
import { AutoSubmit, SubmitButton } from "@/components/client";
import { Card, EmptyState, Input, PageHeader, Select, Stamp, Stat, Tabs, orderTone, paymentTone } from "@/components/ui";
import { db } from "@/db";
import { orders, payments } from "@/db/schema";
import { ORDER_LABEL } from "@/lib/asoebi";
import { requireWorkspace } from "@/lib/auth";
import { integrations } from "@/lib/config";
import { fmtDateTime } from "@/lib/dates";
import { naira } from "@/lib/money";

export const metadata = { title: "Orders & Payments" };

export default async function Orders({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string; q?: string; pstatus?: string }> }) {
  const sp = await searchParams;
  const { weddingId } = await requireWorkspace();
  const tab = sp.tab === "payments" ? "payments" : "orders";
  const [list, txs] = await Promise.all([
    db.query.orders.findMany({ where: eq(orders.weddingId, weddingId), with: { items: true, payments: true, campaign: true }, orderBy: [desc(orders.createdAt)] }),
    db.select({ p: payments, o: orders }).from(payments).innerJoin(orders, eq(orders.id, payments.orderId)).where(and(eq(payments.weddingId, weddingId), sp.pstatus ? eq(payments.status, sp.pstatus as "success") : undefined)).orderBy(desc(payments.createdAt)).limit(300),
  ]);
  const q = sp.q?.toLowerCase().trim();
  const shown = list.filter((o) => (!sp.status || o.status === sp.status) && (!q || [o.fullName, o.code, o.email, o.phone].some((x) => x.toLowerCase().includes(q))));
  const live = list.filter((o) => o.status !== "cancelled");
  const pending = txs.filter((t) => t.p.status === "pending" || t.p.status === "initialized").length;

  return (
    <>
      <PageHeader
        folio="IX · Orders & Payments"
        title="Orders & payments"
        lede="An order is only marked paid after the payment has been verified with Paystack on our server, or recorded by you as a bank transfer."
        actions={integrations.paystack() && <form action={reconcileAll}><SubmitButton variant="ghost" pendingText="Checking…">Re-check pending payments</SubmitButton></form>}
      />
      <div className="sheet mb-6 grid grid-cols-2 gap-5 p-5 md:grid-cols-4">
        <Stat label="Ordered value" value={naira(live.reduce((s, o) => s + o.total, 0))} />
        <Stat label="Collected (verified)" value={naira(list.reduce((s, o) => s + o.amountPaid, 0))} tone="sage" />
        <Stat label="Outstanding" value={naira(live.reduce((s, o) => s + o.total - o.amountPaid, 0))} tone="gold" />
        <Stat label="Pending transactions" value={pending} tone={pending ? "rose" : "ink"} sub="awaiting gateway confirmation" />
      </div>
      <Tabs current={tab === "payments" ? "/app/orders?tab=payments" : "/app/orders"} items={[{ href: "/app/orders", label: "Orders", count: list.length }, { href: "/app/orders?tab=payments", label: "Transactions", count: txs.length }]} />
      {tab === "orders" ? (
        <Card pad={false}>
          <AutoSubmit className="grid gap-2 border-b border-linen p-4 sm:grid-cols-[1fr_14rem]">
            <Input type="search" name="q" placeholder="Search name, order ID, phone…" defaultValue={sp.q} />
            <Select name="status" defaultValue={sp.status ?? ""}><option value="">All statuses</option>{Object.entries(ORDER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          </AutoSubmit>
          {shown.length ? (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[820px]">
                <thead><tr><th>Order</th><th>Guest</th><th>Items</th><th className="num">Total</th><th className="num">Paid</th><th>Status</th><th>Placed</th></tr></thead>
                <tbody>
                  {shown.map((o) => (
                    <tr key={o.id}>
                      <td><Link href={`/app/orders/${o.id}`} className="figure font-semibold underline-offset-2 hover:underline">{o.code}</Link></td>
                      <td>{o.fullName}<div className="text-xs text-muted">{o.deliveryMethod === "delivery" ? "Home delivery" : "Pickup"}</div></td>
                      <td className="text-xs">{o.items.map((i) => `${i.quantity} × ${i.packageName}`).join(", ")}</td>
                      <td className="num">{naira(o.total)}</td>
                      <td className="num text-sage">{naira(o.amountPaid)}</td>
                      <td><Stamp tone={orderTone(o.status)}>{ORDER_LABEL[o.status]}</Stamp></td>
                      <td className="whitespace-nowrap text-xs text-muted">{fmtDateTime(o.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="No orders yet">Share your Aso Ebi link and orders will appear here as guests submit them.</EmptyState>}
        </Card>
      ) : (
        <Card pad={false}>
          <AutoSubmit className="border-b border-linen p-4">
            <Select name="pstatus" defaultValue={sp.pstatus ?? ""} className="w-auto"><option value="">All transactions</option>{["success", "pending", "initialized", "failed", "abandoned", "refunded"].map((s) => <option key={s} value={s}>{s}</option>)}</Select>
            <input type="hidden" name="tab" value="payments" />
          </AutoSubmit>
          <div className="overflow-x-auto">
            <table className="data-table min-w-[860px]">
              <thead><tr><th>Reference</th><th>Order</th><th>Provider</th><th className="num">Amount</th><th>Status</th><th>Channel</th><th>Paid / verified</th></tr></thead>
              <tbody>
                {txs.map(({ p, o }) => (
                  <tr key={p.id}>
                    <td className="figure text-xs">{p.reference}</td>
                    <td><Link className="underline-offset-2 hover:underline" href={`/app/orders/${o.id}`}>{o.code}</Link><div className="text-xs text-muted">{o.fullName}</div></td>
                    <td className="text-xs capitalize">{p.provider}</td>
                    <td className="num">{naira(p.amount)}</td>
                    <td><Stamp tone={paymentTone(p.status)}>{p.status}</Stamp></td>
                    <td className="text-xs">{p.channel ?? "—"}{p.gatewayResponse && <div className="max-w-[14rem] truncate text-faint" title={p.gatewayResponse}>{p.gatewayResponse}</div>}</td>
                    <td className="whitespace-nowrap text-xs text-muted">{p.paidAt ? fmtDateTime(p.paidAt) : "—"}{p.verifiedAt && <div>✓ {fmtDateTime(p.verifiedAt)}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
