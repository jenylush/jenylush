import { notFound } from "next/navigation";
import { guestUpdateAddress, reportSent } from "@/app/actions/public";
import { AddressFields } from "@/components/address-fields";
import { ActionForm, CopyButton, SubmitButton } from "@/components/client";
import { DELIVERY_LABEL, orderForGuest } from "@/lib/asoebi";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { naira } from "@/lib/money";
import { displayPhone, waNumber } from "@/lib/phone";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your Aso Ebi order", robots: { index: false } };

const GUEST_LABEL = { pending_payment: "Not paid yet", transfer_reported: "Paid · awaiting confirmation", partially_paid: "Part paid", paid: "Paid ✓", cancelled: "Cancelled" } as const;
const inputCls = "w-full border border-[#E6DCCB] bg-white px-3.5 py-3 text-[16px]";

export default async function GuestOrder({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ t?: string }> }) {
  const { code } = await params;
  const { t = "" } = await searchParams;
  const found = await orderForGuest(code, t);
  if (!found) notFound();
  const { order: o, wedding: w } = found;
  const c = o.campaign;
  const accent = c.accent;
  const due = o.total - o.amountPaid;
  const reported = o.payments.find((p) => p.status === "reported");
  const dstatus = o.delivery?.status ?? "awaiting";
  const editable = dstatus !== "dispatched" && dstatus !== "delivered" && o.status !== "cancelled";
  const statusColor = o.status === "paid" ? "#6F7F62" : o.status === "transfer_reported" ? "#B7863B" : o.status === "cancelled" ? "#7A7268" : accent;

  return (
    <main className="min-h-dvh bg-[#FBF8F2] pb-16" style={{ ["--accent" as string]: accent }}>
      <header className="px-5 py-8 text-center text-[#FBF8F2]" style={{ background: accent }}>
        <div className="text-[0.62rem] uppercase tracking-[0.3em] opacity-80">{w.partnerOneName} &amp; {w.partnerTwoName} · Aso Ebi</div>
        <h1 className="font-display mt-3 text-3xl">Thank you, {o.fullName.split(" ")[0]}</h1>
        <p className="mt-1 text-sm opacity-85">Order <span className="font-mono">{o.code}</span></p>
      </header>

      <div className="mx-auto max-w-xl space-y-6 px-5 pt-6">
        {/* Step 2: pay by transfer */}
        {o.status === "pending_payment" && (
          <section className="border-2 bg-white" style={{ borderColor: accent }}>
            <div className="px-4 pt-4">
              <div className="text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-[#7A7268]">Step 2 of 2 · Pay by bank transfer</div>
              <div className="mt-2 font-mono text-3xl text-[#2A2725]">{naira(due)}</div>
              {c.paymentDeadline && <p className="text-sm text-[#7A7268]">Please pay by {fmtDate(c.paymentDeadline, "long")}.</p>}
            </div>
            {c.accountNumber ? (
              <dl className="mx-4 mt-4 divide-y divide-[#EFE8DB] border border-[#E6DCCB] text-sm">
                <div className="flex justify-between gap-3 px-3 py-2.5"><dt className="text-[#7A7268]">Bank</dt><dd className="font-semibold">{c.bankName}</dd></div>
                <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <dt className="text-[#7A7268]">Account number</dt>
                  <dd className="flex items-center gap-2"><span className="font-mono text-lg tracking-wider">{c.accountNumber}</span><CopyButton text={c.accountNumber} label="Copy" size="sm" /></dd>
                </div>
                <div className="flex justify-between gap-3 px-3 py-2.5"><dt className="text-[#7A7268]">Account name</dt><dd className="text-right font-semibold">{c.accountName}</dd></div>
                <div className="flex items-center justify-between gap-3 px-3 py-2.5"><dt className="text-[#7A7268]">Amount</dt><dd className="flex items-center gap-2"><span className="font-mono">{naira(due)}</span><CopyButton text={String(due / 100)} label="Copy" size="sm" /></dd></div>
              </dl>
            ) : (
              <p className="mx-4 mt-4 border-l-2 border-[#A86A6A] bg-[#F3E3DF] px-3 py-2 text-sm">The couple hasn&apos;t added their account details yet. Please contact them below.</p>
            )}
            <ActionForm action={reportSent} className="space-y-3 p-4">
              <input type="hidden" name="code" value={o.code} />
              <input type="hidden" name="t" value={t} />
              <p className="text-sm text-[#4A4540]">After you&apos;ve made the transfer, tap the button below so your name is recorded.</p>
              <label className="block"><span className="mb-1 block text-xs text-[#7A7268]">Name on the account you sent from (optional, helps the couple find it)</span><input name="senderName" defaultValue={o.fullName} className={inputCls} /></label>
              <SubmitButton className="w-full !border-[var(--accent)] !bg-[var(--accent)] py-4 text-base" pendingText="Recording…">✓ I have sent the money</SubmitButton>
            </ActionForm>
          </section>
        )}

        {o.status === "transfer_reported" && (
          <section role="status" className="border-l-2 border-[#B7863B] bg-[#F5E8CF] px-4 py-3 text-sm">
            <div className="font-semibold">You&apos;re recorded as paid ✓</div>
            <div className="mt-0.5 text-[#4A4540]">Marked as sent {reported ? fmtDateTime(reported.reportedAt) : ""}{reported?.senderName ? ` from ${reported.senderName}` : ""}. The couple will confirm once they see it in their account.</div>
          </section>
        )}
        {o.status === "paid" && (
          <section role="status" className="border-l-2 border-[#6F7F62] bg-[#E5EADC] px-4 py-3 text-sm">
            <div className="font-semibold">Payment confirmed by the couple ✓</div>
            <div className="mt-0.5 text-[#4A4540]">Thank you! You can download your receipt below.</div>
          </section>
        )}

        <section className="border border-[#E6DCCB] bg-white">
          <div className="flex items-center justify-between border-b border-[#E6DCCB] px-4 py-3">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#7A7268]">Your order</span>
            <span className="text-sm font-semibold" style={{ color: statusColor }}>{GUEST_LABEL[o.status]}</span>
          </div>
          <dl className="divide-y divide-[#EFE8DB] text-sm">
            {o.items.map((i) => <div key={i.id} className="flex justify-between px-4 py-2.5"><dt>{i.quantity} × {i.packageName}</dt><dd className="font-mono">{naira(i.lineTotal)}</dd></div>)}
            {o.deliveryFee > 0 && <div className="flex justify-between px-4 py-2.5"><dt>Delivery</dt><dd className="font-mono">{naira(o.deliveryFee)}</dd></div>}
            <div className="flex justify-between px-4 py-2.5 font-semibold"><dt>Total</dt><dd className="font-mono">{naira(o.total)}</dd></div>
          </dl>
          {o.status === "paid" && <div className="border-t border-[#E6DCCB] p-3 text-right"><a className="border border-[#2A2725] px-3 py-1.5 text-xs font-semibold" href={`/api/receipts/${o.code}?t=${encodeURIComponent(t)}`}>Download receipt (PDF)</a></div>}
        </section>

        <section className="border border-[#E6DCCB] bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl">{o.deliveryMethod === "delivery" ? "Where we'll send it" : "Pickup"}</h2>
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7A7268]">{DELIVERY_LABEL[dstatus]}</span>
          </div>
          {o.delivery?.riderName && <p className="mt-2 text-sm">Rider: {o.delivery.riderName}{o.delivery.riderPhone && <> · <a className="underline" href={`tel:${o.delivery.riderPhone}`}>{displayPhone(o.delivery.riderPhone)}</a></>}</p>}
          {o.deliveryMethod === "pickup" && c.pickupDetails && <p className="mt-2 text-sm text-[#4A4540]">{c.pickupDetails}</p>}
          {o.address && <p className="mt-2 text-sm text-[#4A4540]">{o.address.street}, {o.address.area}, {o.address.city}, {o.address.state}{o.address.landmark && ` · near ${o.address.landmark}`}</p>}
          {editable && (
            <details className="mt-3" open={o.deliveryMethod === "delivery" && !o.address}>
              <summary className="cursor-pointer text-sm underline underline-offset-2">{o.address ? "Change address" : o.deliveryMethod === "pickup" ? "Have it delivered instead" : "Add your address"}</summary>
              <ActionForm action={guestUpdateAddress} className="mt-4 grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="code" value={o.code} />
                <input type="hidden" name="t" value={t} />
                <AddressFields a={o.address} />
                <div className="sm:col-span-2"><SubmitButton className="w-full">Save address</SubmitButton></div>
              </ActionForm>
            </details>
          )}
        </section>

        {c.contactPhone && <p className="text-center text-sm text-[#4A4540]">Questions? <a className="underline" target="_blank" rel="noreferrer" href={`https://wa.me/${waNumber(c.contactPhone)}?text=${encodeURIComponent(`Hello, about my Aso Ebi order ${o.code}`)}`}>Message {c.contactName ?? "the couple"}</a></p>}
        <p className="text-center text-xs text-[#A59C90]">Bookmark this page — it&apos;s your private link to this order.</p>
      </div>
    </main>
  );
}
