"use client";

import { useMemo, useState } from "react";
import { placeOrder } from "@/app/actions/public";
import { ActionForm, SubmitButton } from "./client";
import { NG_STATES } from "@/lib/phone";

type Pkg = { id: string; name: string; description: string | null; price: number; remaining: number | null; maxPerOrder: number };

const fmt = (k: number) => `₦${new Intl.NumberFormat("en-NG").format(Math.round(k / 100))}`;
const inputCls = "w-full border border-[#E6DCCB] bg-white px-3.5 py-3 text-[16px] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/15";
const labelCls = "mb-1.5 block text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-[#4A4540]";

/**
 * Mobile-first, three-step form: choose → details → review. Everything posts once at the
 * end; the server re-validates prices, stock and the address rules.
 */
export function OrderForm({ slug, guestToken, packages, deliveryFee, allowDelivery, allowPickup }: { slug: string; guestToken?: string; packages: Pkg[]; deliveryFee: number; allowDelivery: boolean; allowPickup: boolean }) {
  const [step, setStep] = useState(0);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<"delivery" | "pickup">(allowDelivery ? "delivery" : "pickup");
  const [f, setF] = useState({ fullName: "", phone: "", email: "", street: "", area: "", city: "", state: "Lagos", landmark: "", instructions: "" });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const subtotal = useMemo(() => packages.reduce((s, p) => s + p.price * (qty[p.id] ?? 0), 0), [qty, packages]);
  const fee = method === "delivery" ? deliveryFee : 0;
  const total = subtotal ? subtotal + fee : 0;
  const count = Object.values(qty).reduce((a, b) => a + b, 0);

  const next = () => {
    setErr(null);
    if (step === 0 && count === 0) return setErr("Choose at least one package.");
    if (step === 1) {
      if (!f.fullName.trim() || !f.phone.trim()) return setErr("Please enter your full name and phone number.");
      if (f.email.trim() && !/\S+@\S+\.\S+/.test(f.email)) return setErr("That email doesn't look right — or leave it blank.");
      if (!/^(\+?234|0)?[789][01]\d{8}$/.test(f.phone.replace(/[\s-]/g, ""))) return setErr("Enter a valid Nigerian phone number, e.g. 0803 123 4567.");
      if (method === "delivery" && (!f.street.trim() || !f.area.trim() || !f.city.trim() || !f.state)) return setErr("Home delivery needs your street address, area, city and state.");
    }
    setStep(step + 1);
    window.scrollTo({ top: document.getElementById("order")!.offsetTop - 12, behavior: "smooth" });
  };

  const Step = ({ n, label }: { n: number; label: string }) => (
    <li className={`flex items-center gap-2 ${step >= n ? "text-[#2A2725]" : "text-[#A59C90]"}`}>
      <span className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs ${step > n ? "border-[var(--accent)] bg-[var(--accent)] text-white" : step === n ? "border-[var(--accent)]" : "border-[#E6DCCB]"}`}>{step > n ? "✓" : n + 1}</span>
      <span className="text-xs font-semibold uppercase tracking-[0.12em]">{label}</span>
    </li>
  );

  return (
    <div
      id="order"
      onKeyDown={(e) => {
        if (e.key === "Enter" && step < 2 && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
          next();
        }
      }}
    >
      <ol className="mb-6 flex justify-between gap-2"><Step n={0} label="Choose" /><Step n={1} label="Details" /><Step n={2} label="Review" /></ol>
      <ActionForm action={placeOrder}>
        <input type="hidden" name="slug" value={slug} />
        {guestToken && <input type="hidden" name="guestToken" value={guestToken} />}
        {/* All values are kept in hidden inputs so the final submit carries everything */}
        {packages.map((p) => <input key={p.id} type="hidden" name={`qty_${p.id}`} value={qty[p.id] ?? 0} />)}
        <input type="hidden" name="deliveryMethod" value={method} />
        {(Object.keys(f) as Array<keyof typeof f>).filter((k) => method === "delivery" || !["street", "area", "city", "state", "landmark", "instructions"].includes(k)).map((k) => <input key={k} type="hidden" name={k} value={f[k]} />)}

        {step === 0 && (
          <div className="space-y-3">
            {packages.map((p) => {
              const n = qty[p.id] ?? 0;
              const max = Math.min(p.maxPerOrder, p.remaining ?? Infinity);
              const soldOut = p.remaining === 0;
              return (
                <div key={p.id} className={`flex items-center justify-between gap-4 border bg-white p-4 transition ${n ? "border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)]" : "border-[#E6DCCB]"} ${soldOut ? "opacity-50" : ""}`}>
                  <div className="min-w-0">
                    <div className="font-semibold text-[#2A2725]">{p.name}</div>
                    {p.description && <div className="mt-0.5 text-sm text-[#7A7268]">{p.description}</div>}
                    <div className="mt-1.5 font-mono text-lg text-[#2A2725]">{fmt(p.price)}</div>
                    {p.remaining != null && p.remaining <= 10 && <div className="text-xs text-[#A86A6A]">{soldOut ? "Sold out" : `Only ${p.remaining} left`}</div>}
                  </div>
                  <div className="flex shrink-0 items-center border border-[#E6DCCB]">
                    <button type="button" aria-label={`Fewer ${p.name}`} disabled={!n} onClick={() => setQty({ ...qty, [p.id]: n - 1 })} className="h-11 w-11 text-xl disabled:opacity-30">−</button>
                    <span className="w-8 text-center font-mono" aria-live="polite">{n}</span>
                    <button type="button" aria-label={`More ${p.name}`} disabled={soldOut || n >= max} onClick={() => setQty({ ...qty, [p.id]: n + 1 })} className="h-11 w-11 text-xl disabled:opacity-30">+</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div><label className={labelCls} htmlFor="fn">Full name *</label><input id="fn" autoComplete="name" className={inputCls} value={f.fullName} onChange={set("fullName")} /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className={labelCls} htmlFor="ph">Phone (WhatsApp) *</label><input id="ph" type="tel" autoComplete="tel" inputMode="tel" placeholder="0803 123 4567" className={inputCls} value={f.phone} onChange={set("phone")} /></div>
              <div><label className={labelCls} htmlFor="em">Email (optional)</label><input id="em" type="email" autoComplete="email" className={inputCls} value={f.email} onChange={set("email")} /><p className="mt-1 text-xs text-[#7A7268]">For your receipt.</p></div>
            </div>
            {allowDelivery && allowPickup && (
              <fieldset>
                <legend className={labelCls}>How would you like to get it? *</legend>
                <div className="grid grid-cols-2 gap-2">
                  {(["delivery", "pickup"] as const).map((m) => (
                    <button type="button" key={m} onClick={() => setMethod(m)} className={`border px-3 py-3 text-left text-sm ${method === m ? "border-[var(--accent)] bg-[var(--accent)]/5 shadow-[0_0_0_1px_var(--accent)]" : "border-[#E6DCCB] bg-white"}`}>
                      <span className="block font-semibold">{m === "delivery" ? "Home delivery" : "Pickup"}</span>
                      <span className="text-xs text-[#7A7268]">{m === "delivery" ? (deliveryFee ? `+ ${fmt(deliveryFee)}` : "Free") : "Collect it yourself"}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            {method === "delivery" && (
              <div className="space-y-4 border-l-2 border-[var(--accent)] pl-4">
                <div><label className={labelCls} htmlFor="st">Street address *</label><input id="st" autoComplete="street-address" placeholder="House number and street" className={inputCls} value={f.street} onChange={set("street")} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={labelCls} htmlFor="sa">State *</label><select id="sa" className={inputCls} value={f.state} onChange={set("state")}>{NG_STATES.map((s) => <option key={s}>{s}</option>)}</select></div>
                  <div><label className={labelCls} htmlFor="ci">City *</label><input id="ci" autoComplete="address-level2" className={inputCls} value={f.city} onChange={set("city")} /></div>
                </div>
                <div><label className={labelCls} htmlFor="ar">Area / neighbourhood *</label><input id="ar" placeholder="e.g. Lekki Phase 1" className={inputCls} value={f.area} onChange={set("area")} /></div>
                <div><label className={labelCls} htmlFor="lm">Closest landmark</label><input id="lm" placeholder="e.g. Opposite Shoprite" className={inputCls} value={f.landmark} onChange={set("landmark")} /></div>
                <div><label className={labelCls} htmlFor="in">Delivery instructions</label><textarea id="in" rows={2} className={inputCls} value={f.instructions} onChange={set("instructions")} /></div>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="border border-[#E6DCCB] bg-white">
              <div className="border-b border-[#E6DCCB] px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-[#7A7268]">Please check your order</div>
              <dl className="divide-y divide-[#EFE8DB] text-sm">
                {packages.filter((p) => qty[p.id]).map((p) => <div key={p.id} className="flex justify-between px-4 py-2.5"><dt>{qty[p.id]} × {p.name}</dt><dd className="font-mono">{fmt(p.price * qty[p.id])}</dd></div>)}
                {fee > 0 && <div className="flex justify-between px-4 py-2.5"><dt>Delivery</dt><dd className="font-mono">{fmt(fee)}</dd></div>}
                <div className="flex justify-between px-4 py-3 text-base font-semibold"><dt>Total</dt><dd className="font-mono">{fmt(total)}</dd></div>
                <div className="px-4 py-2.5"><dt className="text-xs text-[#7A7268]">Name</dt><dd>{f.fullName}</dd></div>
                <div className="px-4 py-2.5"><dt className="text-xs text-[#7A7268]">Contact</dt><dd>{f.phone}{f.email && ` · ${f.email}`}</dd></div>
                <div className="px-4 py-2.5"><dt className="text-xs text-[#7A7268]">{method === "delivery" ? "Deliver to" : "Collection"}</dt><dd>{method === "delivery" ? `${f.street}, ${f.area}, ${f.city}, ${f.state}${f.landmark ? ` (near ${f.landmark})` : ""}` : "I'll pick it up"}</dd></div>
              </dl>
            </div>
            <p className="text-sm text-[#4A4540]">Next you&apos;ll see the couple&apos;s account details to pay by bank transfer.</p>
            <label className="flex items-start gap-2.5 text-sm"><input type="checkbox" name="confirm" value="yes" required className="mt-0.5 h-4 w-4 accent-[var(--accent)]" /> My details are correct.</label>
          </div>
        )}

        {err && <p role="alert" className="mt-4 border-l-2 border-[#A86A6A] bg-[#F3E3DF] px-3 py-2 text-sm">{err}</p>}

        <div className="sticky bottom-0 -mx-5 mt-6 flex items-center justify-between gap-3 border-t border-[#E6DCCB] bg-[#FBF8F2]/95 px-5 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          <div>
            <div className="text-[0.65rem] uppercase tracking-[0.16em] text-[#7A7268]">{count} item{count === 1 ? "" : "s"}</div>
            <div className="font-mono text-xl text-[#2A2725]">{fmt(total)}</div>
          </div>
          <div className="flex gap-2">
            {step > 0 && <button type="button" onClick={() => setStep(step - 1)} className="border border-[#E6DCCB] px-4 py-3 text-sm">Back</button>}
            {step < 2 ? (
              <button type="button" onClick={next} className="bg-[var(--accent)] px-6 py-3 text-sm font-semibold text-white">Continue</button>
            ) : (
              <SubmitButton className="!bg-[var(--accent)] !border-[var(--accent)] px-6 py-3" pendingText="Saving…">Continue to payment</SubmitButton>
            )}
          </div>
        </div>
      </ActionForm>
    </div>
  );
}
