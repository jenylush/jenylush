import { and, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { adminUpdateAddress, cancelOrder, recheckPayment, recordManualPayment, updateDelivery } from "@/app/actions/asoebi";
import { ActionForm, ConfirmButton, CopyButton, SubmitButton } from "@/components/client";
import { AddressFields } from "@/components/address-fields";
import { Button, Card, Field, Input, MoneyInput, PageHeader, Ribbon, Select, Stamp, Stat, Textarea, deliveryTone, orderTone, paymentTone } from "@/components/ui";
import { db } from "@/db";
import { auditLogs, orders } from "@/db/schema";
import { DELIVERY_LABEL, ORDER_LABEL, guestOrderUrl } from "@/lib/asoebi";
import { requireWorkspace } from "@/lib/auth";
import { fmtDateTime } from "@/lib/dates";
import { naira } from "@/lib/money";
import { displayPhone, waNumber } from "@/lib/phone";

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { weddingId } = await requireWorkspace();
  const o = await db.query.orders.findFirst({ where: and(eq(orders.id, id), eq(orders.weddingId, weddingId)), with: { items: true, address: true, delivery: true, payments: { orderBy: (p, { desc }) => [desc(p.createdAt)] }, campaign: true, guest: true } });
  if (!o) notFound();
  const history = await db.select().from(auditLogs).where(and(eq(auditLogs.weddingId, weddingId), eq(auditLogs.entityId, o.id))).orderBy(desc(auditLogs.createdAt)).limit(20);
  const outstanding = o.total - o.amountPaid;
  const d = o.delivery;

  return (
    <>
      <PageHeader
        folio={`IX · ${o.campaign.name}`}
        title={<>Order <span className="figure">{o.code}</span></>}
        lede={<>{o.fullName} · {displayPhone(o.phone)} · {o.email} · <Stamp tone={orderTone(o.status)}>{ORDER_LABEL[o.status]}</Stamp></>}
        actions={
          <>
            <a className="inline-flex items-center border border-linen px-4 py-2.5 text-sm font-semibold hover:border-gold" target="_blank" rel="noreferrer" href={`https://wa.me/${waNumber(o.phone)}`}>WhatsApp guest</a>
            <CopyButton text={guestOrderUrl(o)} label="Copy guest's order link" />
            <form action={cancelOrder}><input type="hidden" name="id" value={o.id} /><ConfirmButton size="md" variant={o.cancelledAt ? "ghost" : "danger"} message={o.cancelledAt ? "Restore this order?" : "Cancel this order? Any refund must be made separately."}>{o.cancelledAt ? "Restore order" : "Cancel order"}</ConfirmButton></form>
          </>
        }
      />
      <div className="sheet mb-6 p-5">
        <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
          <Stat label="Order total" value={naira(o.total)} sub={o.deliveryFee ? `incl. ${naira(o.deliveryFee)} delivery` : undefined} />
          <Stat label="Paid (verified)" value={naira(o.amountPaid)} tone="sage" />
          <Stat label="Balance" value={naira(outstanding)} tone={outstanding ? "gold" : "sage"} />
          <Stat label="Plan" value={o.paymentPlan === "instalments" ? "Instalments" : "Full"} sub={`Placed ${fmtDateTime(o.createdAt)}`} />
        </div>
        <div className="mt-4"><Ribbon value={o.total ? o.amountPaid / o.total : 0} tone="sage" height={8} /></div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <Card title="Items" folio="a." pad={false}>
            <table className="data-table">
              <thead><tr><th>Package</th><th className="num">Unit</th><th className="num">Qty</th><th className="num">Line</th></tr></thead>
              <tbody>{o.items.map((i) => <tr key={i.id}><td>{i.packageName}</td><td className="num">{naira(i.unitPrice)}</td><td className="num">{i.quantity}</td><td className="num">{naira(i.lineTotal)}</td></tr>)}</tbody>
            </table>
          </Card>

          <Card title="Payments" folio="b." pad={false}>
            {o.payments.length ? (
              <table className="data-table">
                <thead><tr><th>Reference</th><th className="num">Amount</th><th>Status</th><th>When</th><th /></tr></thead>
                <tbody>
                  {o.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="figure text-xs">{p.reference}<div className="font-sans text-faint">{p.provider}{p.channel && ` · ${p.channel}`}</div>{p.gatewayResponse && <div className="font-sans text-faint">{p.gatewayResponse}</div>}</td>
                      <td className="num">{naira(p.amount)}</td>
                      <td><Stamp tone={paymentTone(p.status)}>{p.status}</Stamp></td>
                      <td className="text-xs text-muted">{fmtDateTime(p.paidAt ?? p.createdAt)}</td>
                      <td>{(p.status === "pending" || p.status === "initialized") && p.provider === "paystack" && <form action={recheckPayment}><input type="hidden" name="reference" value={p.reference} /><Button size="sm" variant="ghost">Re-verify</Button></form>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="px-5 py-4 text-sm text-muted">No payment attempts yet.</p>}
            {outstanding > 0 && !o.cancelledAt && (
              <details className="border-t border-linen">
                <summary className="cursor-pointer px-5 py-3 text-sm">Guest paid you directly by bank transfer? Record it</summary>
                <div className="p-5 pt-0">
                  <ActionForm action={recordManualPayment} className="grid items-end gap-3 sm:grid-cols-3" resetOnSuccess>
                    <input type="hidden" name="orderId" value={o.id} />
                    <Field label="Amount received"><MoneyInput name="amount" defaultValue={outstanding} required /></Field>
                    <Field label="Bank reference" required><Input name="reference" placeholder="e.g. session ID" required /></Field>
                    <SubmitButton size="sm">Record transfer</SubmitButton>
                    <Field label="Note" className="sm:col-span-3"><Input name="note" placeholder="Optional" /></Field>
                  </ActionForm>
                  <p className="mt-2 text-xs text-muted">Logged as a manual entry under your name — only do this once the money is in your account.</p>
                </div>
              </details>
            )}
          </Card>

          <Card title="History" folio="e.">
            <ol className="space-y-2.5 text-xs">{history.map((h) => <li key={h.id} className="border-l border-gold pl-3"><div>{h.summary}</div><div className="text-faint">{fmtDateTime(h.createdAt)} · {h.actor}</div></li>)}</ol>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Delivery" folio="c." action={<Stamp tone={deliveryTone(d?.status ?? "awaiting")}>{DELIVERY_LABEL[d?.status ?? "awaiting"]}</Stamp>}>
            {o.deliveryMethod === "pickup" && <p className="mb-4 text-sm text-muted">Guest chose pickup / collection.</p>}
            <ActionForm action={updateDelivery} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="orderId" value={o.id} />
              <Field label="Status" className="sm:col-span-2"><Select name="status" defaultValue={d?.status ?? "awaiting"}>{Object.entries(DELIVERY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="Dispatch rider"><Input name="riderName" defaultValue={d?.riderName ?? ""} /></Field>
              <Field label="Rider phone"><Input name="riderPhone" type="tel" defaultValue={d?.riderPhone ? displayPhone(d.riderPhone) : ""} /></Field>
              <Field label="Tracking reference" className="sm:col-span-2"><Input name="trackingRef" defaultValue={d?.trackingRef ?? ""} /></Field>
              <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" defaultValue={d?.notes ?? ""} className="min-h-[42px]" /></Field>
              <div className="sm:col-span-2 flex justify-end"><SubmitButton size="sm">Update delivery</SubmitButton></div>
            </ActionForm>
          </Card>
          <Card title="Delivery address" folio="d." action={o.address && <span className="text-xs text-faint">via {o.address.source}</span>}>
            <ActionForm action={adminUpdateAddress} className="grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="orderId" value={o.id} />
              <AddressFields a={o.address} />
              <div className="sm:col-span-2 flex justify-end"><SubmitButton size="sm">Save address</SubmitButton></div>
            </ActionForm>
          </Card>
        </div>
      </div>
    </>
  );
}
