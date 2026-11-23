import { and, desc, eq, ne } from "drizzle-orm";
import Link from "next/link";
import { updateDelivery } from "@/app/actions/asoebi";
import { ActionForm, AutoSubmit, SubmitButton } from "@/components/client";
import { Card, EmptyState, Field, Input, LinkButton, PageHeader, Select, Stamp, Stat, deliveryTone, orderTone } from "@/components/ui";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { DELIVERY_LABEL, ORDER_LABEL } from "@/lib/asoebi";
import { requireWorkspace } from "@/lib/auth";
import { displayPhone } from "@/lib/phone";

export const metadata = { title: "Delivery Management" };

type SP = { state?: string; city?: string; area?: string; status?: string; method?: string; paid?: string };

export default async function Delivery({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { weddingId } = await requireWorkspace();
  const all = await db.query.orders.findMany({ where: and(eq(orders.weddingId, weddingId), ne(orders.status, "cancelled")), with: { items: true, address: true, delivery: true }, orderBy: [desc(orders.createdAt)] });
  const method = sp.method ?? "delivery";
  const base = all.filter((o) => method === "all" || o.deliveryMethod === method);
  const states = [...new Set(base.map((o) => o.address?.state).filter(Boolean))].sort() as string[];
  const cities = [...new Set(base.filter((o) => !sp.state || o.address?.state === sp.state).map((o) => o.address?.city).filter(Boolean))].sort() as string[];
  const areas = [...new Set(base.filter((o) => (!sp.state || o.address?.state === sp.state) && (!sp.city || o.address?.city === sp.city)).map((o) => o.address?.area).filter(Boolean))].sort() as string[];
  const list = base.filter(
    (o) =>
      (!sp.state || o.address?.state === sp.state) &&
      (!sp.city || o.address?.city === sp.city) &&
      (!sp.area || o.address?.area === sp.area) &&
      (!sp.status || (o.delivery?.status ?? "awaiting") === sp.status) &&
      (sp.paid !== "1" || o.status === "paid"),
  );
  const groups = new Map<string, typeof list>();
  for (const o of list) {
    const k = o.deliveryMethod === "pickup" ? "Pickup / collection" : o.address ? `${o.address.state} · ${o.address.city} · ${o.address.area}` : "⚠ Missing address";
    groups.set(k, [...(groups.get(k) ?? []), o]);
  }
  const cnt = (s: string) => base.filter((o) => (o.delivery?.status ?? "awaiting") === s).length;
  const missing = base.filter((o) => o.deliveryMethod === "delivery" && !o.address).length;

  return (
    <>
      <PageHeader folio="X · Delivery" title="Delivery management" lede="Group orders by location, assign riders, and mark them dispatched or delivered. Guests are notified automatically." actions={<LinkButton href="/api/exports/register?filter=delivery" variant="primary">Export delivery list (.xlsx)</LinkButton>} />
      <div className="sheet mb-6 grid grid-cols-2 gap-5 p-5 md:grid-cols-5">
        <Stat label="Awaiting" value={cnt("awaiting")} />
        <Stat label="Processing" value={cnt("processing")} tone="gold" />
        <Stat label="Dispatched" value={cnt("dispatched")} tone="gold" />
        <Stat label="Delivered" value={cnt("delivered")} tone="sage" />
        <Stat label="Missing address" value={missing} tone={missing ? "rose" : "ink"} />
      </div>

      <Card pad={false}>
        <AutoSubmit className="grid gap-2 border-b border-linen p-4 sm:grid-cols-3 lg:grid-cols-6">
          <Select name="method" defaultValue={method}><option value="delivery">Home delivery</option><option value="pickup">Pickup</option><option value="all">All orders</option></Select>
          <Select name="state" defaultValue={sp.state ?? ""}><option value="">All states</option>{states.map((s) => <option key={s}>{s}</option>)}</Select>
          <Select name="city" defaultValue={sp.city ?? ""}><option value="">All cities</option>{cities.map((s) => <option key={s}>{s}</option>)}</Select>
          <Select name="area" defaultValue={sp.area ?? ""}><option value="">All areas</option>{areas.map((s) => <option key={s}>{s}</option>)}</Select>
          <Select name="status" defaultValue={sp.status ?? ""}><option value="">Any status</option>{Object.entries(DELIVERY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="paid" value="1" defaultChecked={sp.paid === "1"} className="accent-[#8F7444]" /> Paid only</label>
        </AutoSubmit>

        {list.length ? (
          <ActionForm action={updateDelivery}>
            <div className="grid items-end gap-2 border-b border-linen bg-gold-soft/20 p-4 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
              <Field label="Set selected to"><Select name="status" defaultValue="dispatched">{Object.entries(DELIVERY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="Rider"><Input name="riderName" placeholder="Optional" /></Field>
              <Field label="Rider phone"><Input name="riderPhone" type="tel" placeholder="Optional" /></Field>
              <Field label="Tracking ref"><Input name="trackingRef" placeholder="Optional" /></Field>
              <SubmitButton size="sm">Apply to selected</SubmitButton>
            </div>
            {[...groups.entries()].map(([g, os]) => (
              <section key={g}>
                <h3 className="flex items-center justify-between border-b border-linen bg-ivory/60 px-5 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink-soft"><span>{g}</span><span className="text-muted">{os.length}</span></h3>
                <ul className="divide-y divide-linen">
                  {os.map((o) => (
                    <li key={o.id} className="grid grid-cols-[1.5rem_1fr] gap-3 px-5 py-3 text-sm sm:grid-cols-[1.5rem_1.2fr_1.6fr_auto]">
                      <input type="checkbox" name="orderId" value={o.id} aria-label={`Select ${o.code}`} className="mt-1 accent-[#8F7444]" />
                      <div>
                        <Link href={`/app/orders/${o.id}`} className="font-semibold hover:underline">{o.fullName}</Link>
                        <div className="text-xs text-muted">{displayPhone(o.phone)} · <span className="figure">{o.code}</span></div>
                        <div className="text-xs text-muted">{o.items.map((i) => `${i.quantity}× ${i.packageName}`).join(", ")}</div>
                      </div>
                      <div className="col-start-2 text-xs sm:col-start-auto">
                        {o.address ? <>{o.address.street}, {o.address.area}, {o.address.city}{o.address.landmark && <div className="text-faint">Landmark: {o.address.landmark}</div>}{o.address.instructions && <div className="text-faint">“{o.address.instructions}”</div>}</> : o.deliveryMethod === "pickup" ? "Pickup" : <span className="text-rose">No address yet</span>}
                        {o.delivery?.riderName && <div className="mt-1 text-faint">Rider: {o.delivery.riderName}{o.delivery.trackingRef && ` · ${o.delivery.trackingRef}`}</div>}
                      </div>
                      <div className="col-start-2 flex flex-wrap gap-1 sm:col-start-auto sm:flex-col sm:items-end">
                        <Stamp tone={deliveryTone(o.delivery?.status ?? "awaiting")}>{DELIVERY_LABEL[o.delivery?.status ?? "awaiting"]}</Stamp>
                        <Stamp tone={orderTone(o.status)}>{ORDER_LABEL[o.status]}</Stamp>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </ActionForm>
        ) : (
          <EmptyState title="No orders to deliver">Orders that need delivery will appear here, grouped by state, city and area.</EmptyState>
        )}
      </Card>
    </>
  );
}
