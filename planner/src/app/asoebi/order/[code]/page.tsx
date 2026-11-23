import { notFound } from "next/navigation";
import { guestUpdateAddress, payNow } from "@/app/actions/public";
import { AddressFields } from "@/components/address-fields";
import { ActionForm, SubmitButton } from "@/components/client";
import { DELIVERY_LABEL, ORDER_LABEL, orderForGuest, paymentBounds } from "@/lib/asoebi";
import { integrations } from "@/lib/config";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { naira } from "@/lib/money";
import { displayPhone, waNumber } from "@/lib/phone";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your Aso Ebi order", robots: { index: false } };

const banners: Record<string, [string, string]> = {
  paid: ["Payment confirmed", "Paystack has confirmed your payment. A receipt has been sent to your email."],
  pending: ["We're confirming your payment", "Your bank hasn't confirmed the transfer yet. This page will show “Paid” as soon as Paystack confirms it — you don't need to pay again."],
  failed: ["Payment not completed", "The payment didn't go through and you haven't been charged for this attempt. You can try again below."],
  unknown: ["We couldn't match that payment", "If you were debited, contact the couple with your order ID."],
};

export default async function GuestOrder({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ t?: string; r?: string }> }) {
  const { code } = await params;
  const { t = "", r } = await searchParams;
  const found = await orderForGuest(code, t);
  if (!found) notFound();
  const { order: o, wedding: w } = found;
  const c = o.campaign;
  const accent = c.accent;
  const bounds = paymentBounds(o, c.minDepositPercent);
  const pendingTx = o.payments.find((p) => p.status === "pending");
  const verified = o.payments.filter((p) => p.status === "success");
  const dstatus = o.delivery?.status ?? "awaiting";
  const editable = dstatus !== "dispatched" && dstatus !== "delivered" && o.status !== "cancelled";
  const banner = r ? banners[r] : pendingTx && o.status !== "paid" ? banners.pending : null;

  return (
    <main className="min-h-dvh bg-[#FBF8F2] pb-16" style={{ ["--accent" as string]: accent }}>
      <header className="px-5 py-8 text-center text-[#FBF8F2]" style={{ background: accent }}>
        <div className="text-[0.62rem] uppercase tracking-[0.3em] opacity-80">{w.partnerOneName} &amp; {w.partnerTwoName} · Aso Ebi</div>
        <h1 className="font-display mt-3 text-3xl">Order <span className="font-mono text-2xl">{o.code}</span></h1>
        <p className="mt-1 text-sm opacity-85">{o.fullName}</p>
      </header>
      <div className="mx-auto max-w-xl space-y-6 px-5 pt-6">
        {banner && (
          <div role="status" className={`border-l-2 px-4 py-3 text-sm ${r === "paid" ? "border-[#6F7F62] bg-[#E5EADC]" : r === "failed" || r === "unknown" ? "border-[#A86A6A] bg-[#F3E3DF]" : "border-[#B7863B] bg-[#F5E8CF]"}`}>
            <div className="font-semibold">{banner[0]}</div>
            <div className="mt-0.5 text-[#4A4540]">{banner[1]}</div>
            {(r === "pending" || (!r && pendingTx)) && <a className="mt-2 inline-block text-xs underline" href={`?t=${encodeURIComponent(t)}`}>Refresh status</a>}
          </div>
        )}

        <section className="border border-[#E6DCCB] bg-white">
          <div className="flex items-center justify-between border-b border-[#E6DCCB] px-4 py-3">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#7A7268]">Status</span>
            <span className="text-sm font-semibold" style={{ color: o.status === "paid" ? "#6F7F62" : o.status === "cancelled" ? "#7A7268" : accent }}>{ORDER_LABEL[o.status]}</span>
          </div>
          <dl className="divide-y divide-[#EFE8DB] text-sm">
            {o.items.map((i) => <div key={i.id} className="flex justify-between px-4 py-2.5"><dt>{i.quantity} × {i.packageName}</dt><dd className="font-mono">{naira(i.lineTotal)}</dd></div>)}
            {o.deliveryFee > 0 && <div className="flex justify-between px-4 py-2.5"><dt>Delivery</dt><dd className="font-mono">{naira(o.deliveryFee)}</dd></div>}
            <div className="flex justify-between px-4 py-2.5 font-semibold"><dt>Total</dt><dd className="font-mono">{naira(o.total)}</dd></div>
            <div className="flex justify-between px-4 py-2.5 text-[#6F7F62]"><dt>Paid</dt><dd className="font-mono">{naira(o.amountPaid)}</dd></div>
            {bounds.outstanding > 0 && <div className="flex justify-between px-4 py-2.5"><dt>Balance</dt><dd className="font-mono">{naira(bounds.outstanding)}</dd></div>}
          </dl>
          <div className="h-1.5 bg-[#EDE4D3]"><div className="h-full" style={{ width: `${(o.amountPaid / o.total) * 100}%`, background: "#6F7F62" }} /></div>
        </section>

        {bounds.outstanding > 0 && o.status !== "cancelled" && (
          <section className="border border-[#E6DCCB] bg-white p-4">
            <h2 className="font-display text-xl">Make a payment</h2>
            {c.paymentDeadline && <p className="mt-1 text-sm text-[#7A7268]">Please pay by {fmtDate(c.paymentDeadline, "long")}.</p>}
            <ActionForm action={payNow} className="mt-4 space-y-3">
              <input type="hidden" name="code" value={o.code} />
              <input type="hidden" name="t" value={t} />
              {bounds.min < bounds.max ? (
                <label className="block">
                  <span className="mb-1.5 block text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[#4A4540]">Amount to pay now</span>
                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-[#7A7268]">₦</span>
                    <input name="amount" inputMode="decimal" defaultValue={bounds.max / 100} className="w-full border border-[#E6DCCB] py-3 pl-8 pr-3 font-mono text-[16px]" />
                  </div>
                  <span className="mt-1 block text-xs text-[#7A7268]">Between {naira(bounds.min)} and {naira(bounds.max)}.</span>
                </label>
              ) : null}
              <SubmitButton className="w-full !border-[var(--accent)] !bg-[var(--accent)] py-3.5" pendingText="Opening secure checkout…">{bounds.min < bounds.max ? "Pay securely with Paystack" : `Pay ${naira(bounds.max)} securely`}</SubmitButton>
              <p className="text-center text-xs text-[#7A7268]">Card · Bank transfer · USSD · via Paystack</p>
              {!integrations.paystack() && <p className="text-center text-xs text-[#A86A6A]">Online payment hasn&apos;t been switched on by the couple yet. Please contact them to pay by bank transfer.</p>}
            </ActionForm>
          </section>
        )}

        {verified.length > 0 && (
          <section className="border border-[#E6DCCB] bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl">Receipt</h2>
              <a className="border border-[#2A2725] px-3 py-1.5 text-xs font-semibold" href={`/api/receipts/${o.code}?t=${encodeURIComponent(t)}`}>Download PDF</a>
            </div>
            <ul className="mt-3 divide-y divide-[#EFE8DB] text-sm">
              {verified.map((p) => <li key={p.id} className="flex justify-between gap-3 py-2"><span><span className="block font-mono text-xs">{p.reference}</span><span className="text-xs text-[#7A7268]">{fmtDateTime(p.paidAt)}{p.channel && ` · ${p.channel}`}</span></span><span className="font-mono">{naira(p.amount)}</span></li>)}
            </ul>
          </section>
        )}

        <section className="border border-[#E6DCCB] bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl">{o.deliveryMethod === "delivery" ? "Delivery" : "Pickup"}</h2>
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7A7268]">{DELIVERY_LABEL[dstatus]}</span>
          </div>
          {o.delivery?.riderName && <p className="mt-2 text-sm">Rider: {o.delivery.riderName}{o.delivery.riderPhone && <> · <a className="underline" href={`tel:${o.delivery.riderPhone}`}>{displayPhone(o.delivery.riderPhone)}</a></>}{o.delivery.trackingRef && <> · Ref {o.delivery.trackingRef}</>}</p>}
          {o.deliveryMethod === "pickup" && c.pickupDetails && <p className="mt-2 text-sm text-[#4A4540]">{c.pickupDetails}</p>}
          {o.address && <p className="mt-2 text-sm text-[#4A4540]">{o.address.street}, {o.address.area}, {o.address.city}, {o.address.state}{o.address.landmark && ` · near ${o.address.landmark}`}</p>}
          {editable && (
            <details className="mt-3" open={o.deliveryMethod === "delivery" && !o.address}>
              <summary className="cursor-pointer text-sm underline underline-offset-2">{o.address ? "Change delivery address" : o.deliveryMethod === "pickup" ? "Switch to home delivery" : "Add your delivery address"}</summary>
              <ActionForm action={guestUpdateAddress} className="mt-4 grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="code" value={o.code} />
                <input type="hidden" name="t" value={t} />
                <AddressFields a={o.address} />
                <div className="sm:col-span-2"><SubmitButton className="w-full">Save address</SubmitButton></div>
              </ActionForm>
            </details>
          )}
        </section>

        {c.contactPhone && <p className="text-center text-sm text-[#4A4540]">Questions? <a className="underline" target="_blank" rel="noreferrer" href={`https://wa.me/${waNumber(c.contactPhone)}?text=${encodeURIComponent(`Hello, about my Aso Ebi order ${o.code}`)}`}>WhatsApp {c.contactName ?? "the couple"}</a></p>}
        <p className="text-center text-xs text-[#A59C90]">Bookmark this page — it&apos;s your private link to this order.</p>
      </div>
    </main>
  );
}
