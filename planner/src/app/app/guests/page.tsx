import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { deleteGuest, importGuests, markLinkSent, saveGuest } from "@/app/actions/asoebi";
import { ActionForm, AutoSubmit, ConfirmButton, SubmitButton } from "@/components/client";
import { Card, EmptyState, Field, Input, PageHeader, Select, Stamp, Stat, deliveryTone, guestTone, orderTone } from "@/components/ui";
import { db } from "@/db";
import { campaigns, guests, packages } from "@/db/schema";
import { DELIVERY_LABEL, GUEST_STATUS, ORDER_LABEL, guestStatus } from "@/lib/asoebi";
import { requireWorkspace } from "@/lib/auth";
import { fmtDate } from "@/lib/dates";
import { GUEST_CATEGORIES } from "@/lib/defaults";
import { naira } from "@/lib/money";
import { displayPhone, waNumber } from "@/lib/phone";

export const metadata = { title: "Guest Register" };

type SP = { q?: string; status?: string; pkg?: string; delivery?: string; category?: string; pay?: string };

export default async function Guests({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { weddingId, wedding } = await requireWorkspace();
  const [list, camp, pkgs] = await Promise.all([
    db.query.guests.findMany({
      where: eq(guests.weddingId, weddingId),
      with: { orders: { with: { items: true, address: true, delivery: true, payments: true }, orderBy: (o, { desc }) => [desc(o.createdAt)] } },
      orderBy: [desc(guests.createdAt)],
    }),
    db.query.campaigns.findFirst({ where: and(eq(campaigns.weddingId, weddingId), eq(campaigns.isPublished, true)), orderBy: (c, { desc }) => [desc(c.createdAt)] }),
    db.select().from(packages).where(eq(packages.weddingId, weddingId)),
  ]);

  const rows = list.map((g) => {
    const o = g.orders.find((x) => x.status !== "cancelled") ?? g.orders[0];
    return { g, o, status: guestStatus(g, o) };
  });
  const q = sp.q?.toLowerCase().trim();
  const filtered = rows.filter(({ g, o, status }) =>
    (!q || [g.name, g.email, g.phone, o?.code, o?.address?.city, o?.address?.area].some((x) => x?.toLowerCase().includes(q))) &&
    (!sp.status || status === sp.status) &&
    (!sp.category || g.category === sp.category) &&
    (!sp.pkg || o?.items.some((i) => i.packageId === sp.pkg)) &&
    (!sp.delivery || (o && (o.delivery?.status ?? "awaiting") === sp.delivery)) &&
    (!sp.pay || (sp.pay === "none" ? !o : o?.status === sp.pay)),
  );
  const count = (fn: (r: (typeof rows)[number]) => boolean) => rows.filter(fn).length;
  const categories = [...new Set([...GUEST_CATEGORIES, ...list.map((g) => g.category)])];
  const personal = (token: string) => (camp ? `/asoebi/${camp.slug}?g=${token}` : null);

  return (
    <>
      <PageHeader
        folio="VIII · Guest Register"
        title="Aso Ebi register"
        lede="Updates itself as guests order, pay, change their address or receive their delivery."
        actions={
          <details className="relative">
            <summary className="list-none"><span className="inline-flex cursor-pointer items-center gap-2 bg-ink px-4 py-2.5 text-sm font-semibold text-ivory">Export to Excel ▾</span></summary>
            <div className="sheet absolute right-0 z-20 mt-1 w-60 p-2 text-sm">
              <a className="block px-3 py-2 hover:bg-ivory" href="/api/exports/register?filter=all">Entire register</a>
              <a className="block px-3 py-2 hover:bg-ivory" href="/api/exports/register?filter=paid">Paid guests only</a>
              <a className="block px-3 py-2 hover:bg-ivory" href="/api/exports/register?filter=awaiting">Awaiting payment</a>
              <a className="block px-3 py-2 hover:bg-ivory" href="/api/exports/register?filter=delivery">Delivery addresses</a>
            </div>
          </details>
        }
      />

      <div className="sheet mb-6 grid grid-cols-2 gap-5 p-5 md:grid-cols-5">
        <Stat label="Guests" value={rows.length} />
        <Stat label="Link opened" value={count((r) => !!r.g.linkOpenedAt)} sub="via personal links" />
        <Stat label="Ordered" value={count((r) => !!r.o && r.o.status !== "cancelled")} />
        <Stat label="Paid in full" value={count((r) => r.o?.status === "paid")} tone="sage" />
        <Stat label="Not paid" value={count((r) => !!r.o && (r.o.status === "pending_payment" || r.o.status === "partially_paid"))} tone="rose" />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <details className="sheet">
          <summary className="cursor-pointer px-5 py-3.5 font-display">+ Add a guest</summary>
          <div className="border-t border-linen p-5">
            <ActionForm action={saveGuest} className="grid gap-4 sm:grid-cols-2" resetOnSuccess>
              <Field label="Full name" required><Input name="name" required /></Field>
              <Field label="Category"><Select name="category" defaultValue="Friends">{categories.map((c) => <option key={c}>{c}</option>)}</Select></Field>
              <Field label="Phone"><Input name="phone" type="tel" placeholder="0803 123 4567" /></Field>
              <Field label="Email"><Input name="email" type="email" /></Field>
              <div className="sm:col-span-2 flex justify-end"><SubmitButton size="sm">Add guest</SubmitButton></div>
            </ActionForm>
          </div>
        </details>
        <details className="sheet">
          <summary className="cursor-pointer px-5 py-3.5 font-display">⇪ Upload guest list (Excel or CSV)</summary>
          <div className="border-t border-linen p-5">
            <p className="mb-3 text-xs text-muted">First row must be headers. We look for <b>Name</b>, <b>Phone</b>, <b>Email</b> and <b>Category</b> columns. Duplicates (same phone or email) are skipped. <a className="underline" href="data:text/csv;charset=utf-8,Name,Phone,Email,Category%0AChiamaka Obi,08031112222,chiamaka@example.com,Bride's side%0A">Download template</a></p>
            <ActionForm action={importGuests} className="flex flex-wrap items-end gap-2" resetOnSuccess>
              <Input type="file" name="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="flex-1 text-xs" required />
              <SubmitButton size="sm" pendingText="Importing…">Import</SubmitButton>
            </ActionForm>
          </div>
        </details>
      </div>

      <Card pad={false}>
        <AutoSubmit className="grid gap-2 border-b border-linen p-4 sm:grid-cols-3 lg:grid-cols-[1.5fr_repeat(5,1fr)]">
          <Input type="search" name="q" placeholder="Search name, phone, order ID, city…" defaultValue={sp.q} />
          <Select name="status" defaultValue={sp.status ?? ""}><option value="">Any status</option>{GUEST_STATUS.map((s) => <option key={s}>{s}</option>)}</Select>
          <Select name="pay" defaultValue={sp.pay ?? ""}><option value="">Any payment</option>{Object.entries(ORDER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="none">No order yet</option></Select>
          <Select name="pkg" defaultValue={sp.pkg ?? ""}><option value="">Any package</option>{pkgs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
          <Select name="delivery" defaultValue={sp.delivery ?? ""}><option value="">Any delivery</option>{Object.entries(DELIVERY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <Select name="category" defaultValue={sp.category ?? ""}><option value="">Any category</option>{categories.map((c) => <option key={c}>{c}</option>)}</Select>
        </AutoSubmit>
        {filtered.length ? (
          <form action={markLinkSent}>
            <div className="flex items-center justify-between border-b border-linen px-4 py-2 text-xs text-muted">
              <span>{filtered.length} of {rows.length} guests</span>
              <button className="underline underline-offset-2 hover:text-ink">Mark selected as “link sent”</button>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table min-w-[1100px]">
                <thead>
                  <tr><th className="w-6" /><th>Guest Name</th><th>Phone</th><th>Email</th><th>Package</th><th className="num">Qty</th><th className="num">Amount</th><th>Payment</th><th>Delivery Address</th><th>Order ID</th><th>Invite</th></tr>
                </thead>
                <tbody>
                  {filtered.map(({ g, o, status }) => {
                    const link = personal(g.inviteToken);
                    const msg = `Hi ${g.name.split(" ")[0]}! ${wedding.partnerOneName} & ${wedding.partnerTwoName}'s Aso Ebi is ready. Order here: `;
                    return (
                      <tr key={g.id}>
                        <td><input type="checkbox" name="id" value={g.id} aria-label={`Select ${g.name}`} className="accent-[#8F7444]" /></td>
                        <td>
                          <div className="font-semibold">{g.name}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-1"><Stamp tone={guestTone(status)}>{status}</Stamp><span className="text-[0.65rem] text-faint">{g.category}</span></div>
                        </td>
                        <td className="whitespace-nowrap">{displayPhone(g.phone)}</td>
                        <td className="max-w-[12rem] truncate text-xs">{g.email ?? "—"}</td>
                        <td className="text-xs">{o ? o.items.map((i) => i.packageName).join(", ") : "—"}</td>
                        <td className="num">{o ? o.items.reduce((s, i) => s + i.quantity, 0) : "—"}</td>
                        <td className="num">{o ? <>{naira(o.total)}{o.amountPaid > 0 && o.amountPaid < o.total && <div className="text-[0.65rem] text-gold-deep">paid {naira(o.amountPaid)}</div>}</> : "—"}</td>
                        <td>{o ? <Stamp tone={orderTone(o.status)}>{ORDER_LABEL[o.status]}</Stamp> : <span className="text-xs text-faint">—</span>}</td>
                        <td className="max-w-[16rem] text-xs">
                          {o ? (o.deliveryMethod === "pickup" ? <span className="text-muted">Pickup</span> : o.address ? <>{o.address.street}, {o.address.area}, {o.address.city}, {o.address.state}{o.address.landmark && <div className="text-faint">near {o.address.landmark}</div>}</> : <Stamp tone="rose">Missing</Stamp>) : "—"}
                          {o?.delivery && o.delivery.status !== "awaiting" && <div className="mt-1"><Stamp tone={deliveryTone(o.delivery.status)}>{DELIVERY_LABEL[o.delivery.status]}</Stamp></div>}
                        </td>
                        <td className="whitespace-nowrap">{o ? <Link className="figure text-xs underline underline-offset-2" href={`/app/orders/${o.id}`}>{o.code}</Link> : "—"}</td>
                        <td className="whitespace-nowrap text-xs">
                          <div className="text-faint">{g.linkOpenedAt ? `Opened ${fmtDate(g.linkOpenedAt)}` : g.linkSentAt ? `Sent ${fmtDate(g.linkSentAt)}` : "Not sent"}</div>
                          {link && g.phone && <a className="text-gold-deep underline" target="_blank" rel="noreferrer" href={`https://wa.me/${waNumber(g.phone)}?text=${encodeURIComponent(msg + (process.env.APP_URL ?? "") + link)}`}>WhatsApp link</a>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </form>
        ) : (
          <EmptyState title={rows.length ? "No guests match" : "No guests yet"}>Add guests manually, upload a list, or share your Aso Ebi link — guests who order are added automatically.</EmptyState>
        )}
      </Card>

      {filtered.length > 0 && (
        <details className="mt-6 text-sm text-muted">
          <summary className="cursor-pointer">Remove a guest</summary>
          <ul className="mt-3 grid gap-1 sm:grid-cols-3">
            {filtered.filter((r) => !r.o).map(({ g }) => (
              <li key={g.id}><form action={deleteGuest} className="flex items-center justify-between gap-2 border-b border-linen py-1"><input type="hidden" name="id" value={g.id} /><span className="truncate">{g.name}</span><ConfirmButton variant="quiet" message={`Remove ${g.name}?`}>remove</ConfirmButton></form></li>
            ))}
          </ul>
          <p className="mt-2 text-xs">Guests with orders can&apos;t be removed — cancel the order instead.</p>
        </details>
      )}
    </>
  );
}
