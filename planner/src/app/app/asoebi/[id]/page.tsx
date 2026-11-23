import { and, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteCampaign, deleteFabricImage, deletePackage, savePackage, togglePublish, uploadFabricImages } from "@/app/actions/asoebi";
import { ActionForm, ConfirmButton, CopyButton, ShareLinks, SubmitButton } from "@/components/client";
import { CampaignForm } from "@/components/campaign-form";
import { Button, Card, Field, Input, LinkButton, MoneyInput, Notice, PageHeader, Stamp, Stat, Textarea } from "@/components/ui";
import { db } from "@/db";
import { campaigns, orderItems, orders } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { loadLookups } from "@/lib/data";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { fileUrl } from "@/lib/storage";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { weddingId, wedding } = await requireWorkspace();
  const c = await db.query.campaigns.findFirst({
    where: and(eq(campaigns.id, id), eq(campaigns.weddingId, weddingId)),
    with: { packages: { orderBy: (p, { asc }) => [asc(p.sortOrder), asc(p.price)] }, images: { orderBy: (i, { asc }) => [asc(i.sortOrder)] } },
  });
  if (!c) notFound();
  const l = await loadLookups(weddingId);
  const sold = await db
    .select({ packageId: orderItems.packageId, qty: sql<number>`coalesce(sum(${orderItems.quantity}),0)`.mapWith(Number) })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orders.campaignId, c.id), sql`${orders.status} <> 'cancelled'`))
    .groupBy(orderItems.packageId);
  const [tot] = await db
    .select({ n: sql<number>`count(*) filter (where ${orders.status} <> 'cancelled')`.mapWith(Number), expected: sql<number>`coalesce(sum(${orders.total}) filter (where ${orders.status} <> 'cancelled'),0)`.mapWith(Number), collected: sql<number>`coalesce(sum(${orders.amountPaid}),0)`.mapWith(Number) })
    .from(orders)
    .where(eq(orders.campaignId, c.id));
  const link = `/asoebi/${c.slug}`;
  const message = `Hello! ${wedding.partnerOneName} & ${wedding.partnerTwoName}'s Aso Ebi (${c.fabricName}) is ready. Order and pay securely here:`;

  return (
    <>
      <PageHeader
        folio="VII · Aso Ebi Manager"
        title={c.name}
        lede={<>{c.fabricName} · <Stamp tone={c.isPublished ? "sage" : "muted"}>{c.isPublished ? "Live" : "Draft"}</Stamp></>}
        actions={
          <>
            <LinkButton href={link} target="_blank">Preview page ↗</LinkButton>
            <form action={togglePublish}><input type="hidden" name="id" value={c.id} /><Button variant={c.isPublished ? "ghost" : "gold"}>{c.isPublished ? "Unpublish" : "Publish"}</Button></form>
          </>
        }
      />

      {!c.accountNumber && (
        <div className="mb-6"><Notice tone="rose" title="Add your bank account details">Guests are shown your account number after ordering, then tap “I have sent the money”. Add it under “Edit campaign details” below.</Notice></div>
      )}

      <Card className="mb-6" folio="↗" title="Your shareable ordering link">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="figure truncate border border-dashed border-gold bg-gold-soft/30 px-3 py-2 text-sm">{c.isPublished ? link : "Publish the campaign to activate your link"}</div>
            <p className="mt-2 text-xs text-muted">Personal tracked links for each guest are on the Guest Register.</p>
          </div>
          {c.isPublished && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <CopyButton text={link} variant="primary" />
              <ShareLinks path={link} message={message} />
            </div>
          )}
        </div>
      </Card>

      <div className="sheet mb-6 grid grid-cols-2 gap-5 p-5 md:grid-cols-4">
        <Stat label="Orders" value={tot.n} />
        <Stat label="Ordered value" value={naira(tot.expected)} />
        <Stat label="Collected" value={naira(tot.collected)} tone="sage" />
        <Stat label="Deadline" value={fmtDate(c.paymentDeadline)} sub={c.accountNumber ? `${c.bankName} · ${c.accountNumber}` : "No account added"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <Card title="Packages" folio="a." pad={false}>
            <ul className="divide-y divide-linen">
              {c.packages.map((p) => {
                const s = sold.find((x) => x.packageId === p.id)?.qty ?? 0;
                return (
                  <li key={p.id} className={p.isActive ? "" : "opacity-50"}>
                    <details>
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 hover:bg-gold-soft/15">
                        <span><span className="font-semibold">{p.name}</span>{!p.isActive && <span className="ml-2 text-xs text-muted">(hidden)</span>}<span className="block text-xs text-muted">{p.description}</span></span>
                        <span className="text-right"><span className="figure block">{naira(p.price)}</span><span className="text-xs text-muted">{s} sold{p.quantityAvailable != null && ` / ${p.quantityAvailable}`}</span></span>
                      </summary>
                      <div className="border-t border-dashed border-linen bg-ivory/40 p-5">
                        <PackageForm campaignId={c.id} p={p} />
                        {p.isActive && <form action={deletePackage} className="mt-3"><input type="hidden" name="id" value={p.id} /><ConfirmButton message="Hide this package from guests? Existing orders are kept.">Hide package</ConfirmButton></form>}
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-linen p-5">
              <div className="eyebrow mb-3">Add package</div>
              <PackageForm campaignId={c.id} />
            </div>
          </Card>

          <details className="sheet">
            <summary className="cursor-pointer px-5 py-3.5 font-display">Edit campaign details</summary>
            <div className="border-t border-linen p-5"><CampaignForm evs={l.events} c={c} /></div>
          </details>
        </div>

        <div className="space-y-6">
          <Card title="Fabric pictures" folio="b.">
            {c.images.length > 0 && (
              <div className="mb-4 grid grid-cols-3 gap-2">
                {c.images.map((im) => (
                  <div key={im.id} className="group relative aspect-square bg-sand bg-cover bg-center" style={{ backgroundImage: `url(${fileUrl(im.fileId)})` }}>
                    <form action={deleteFabricImage} className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100"><input type="hidden" name="id" value={im.id} /><ConfirmButton variant="primary" message="Remove this picture?">×</ConfirmButton></form>
                  </div>
                ))}
              </div>
            )}
            <ActionForm action={uploadFabricImages} className="flex flex-wrap items-end gap-2" resetOnSuccess>
              <input type="hidden" name="campaignId" value={c.id} />
              <Input type="file" name="images" accept="image/jpeg,image/png,image/webp" multiple className="flex-1 text-xs" required />
              <SubmitButton size="sm" pendingText="Uploading…">Upload</SubmitButton>
            </ActionForm>
          </Card>
          <Card title="Shortcuts" folio="c.">
            <ul className="space-y-2 text-sm">
              <li><Link className="underline underline-offset-2" href="/app/guests">Guest register & personal links →</Link></li>
              <li><Link className="underline underline-offset-2" href="/app/orders">Orders & payments →</Link></li>
              <li><Link className="underline underline-offset-2" href="/app/delivery">Delivery management →</Link></li>
              <li><a className="underline underline-offset-2" href="/api/exports/register?filter=all">Export register to Excel ↓</a></li>
            </ul>
          </Card>
          {tot.n === 0 && (
            <form action={deleteCampaign}><input type="hidden" name="id" value={c.id} /><ConfirmButton message="Delete this campaign permanently?">Delete campaign</ConfirmButton></form>
          )}
        </div>
      </div>
    </>
  );
}

function PackageForm({ campaignId, p }: { campaignId: string; p?: { id: string; name: string; description: string | null; price: number; quantityAvailable: number | null; maxPerOrder: number; isActive: boolean } }) {
  return (
    <ActionForm action={savePackage} className="grid items-end gap-3 sm:grid-cols-2" resetOnSuccess={!p} closeOnSuccess={!!p}>
      <input type="hidden" name="campaignId" value={campaignId} />
      {p && <input type="hidden" name="id" value={p.id} />}
      <Field label="Package name" required><Input name="name" defaultValue={p?.name} placeholder="Female package" required /></Field>
      <Field label="Price" required><MoneyInput name="price" defaultValue={p?.price} placeholder="85,000" required /></Field>
      <Field label="What's included" className="sm:col-span-2"><Textarea name="description" defaultValue={p?.description ?? ""} className="min-h-[42px]" placeholder="5 yards lace + gele" /></Field>
      <Field label="Quantity available" hint="Blank = unlimited"><Input type="number" min={0} name="quantityAvailable" defaultValue={p?.quantityAvailable ?? ""} /></Field>
      <Field label="Max per order"><Input type="number" min={1} max={100} name="maxPerOrder" defaultValue={p?.maxPerOrder ?? 10} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isActive" defaultChecked={p?.isActive ?? true} className="accent-[#8F7444]" /> Visible to guests</label>
      <div className="flex justify-end"><SubmitButton size="sm">{p ? "Save package" : "Add package"}</SubmitButton></div>
    </ActionForm>
  );
}
