import { eq, sql } from "drizzle-orm";
import Link from "next/link";
import { CopyButton } from "@/components/client";
import { Card, EmptyState, LinkButton, PageHeader, Ribbon, Stamp } from "@/components/ui";
import { db } from "@/db";
import { campaigns, orders } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { fileUrl } from "@/lib/storage";

export const metadata = { title: "Aso Ebi Manager" };

export default async function AsoEbi() {
  const { weddingId } = await requireWorkspace();
  const list = await db.query.campaigns.findMany({ where: eq(campaigns.weddingId, weddingId), with: { packages: true, images: { limit: 1, orderBy: (i, { asc }) => [asc(i.sortOrder)] }, event: true }, orderBy: (c, { desc }) => [desc(c.createdAt)] });
  const stats = await db
    .select({ campaignId: orders.campaignId, n: sql<number>`count(*) filter (where ${orders.status} <> 'cancelled')`.mapWith(Number), paid: sql<number>`count(*) filter (where ${orders.status} = 'paid')`.mapWith(Number), expected: sql<number>`coalesce(sum(${orders.total}) filter (where ${orders.status} <> 'cancelled'),0)`.mapWith(Number), collected: sql<number>`coalesce(sum(${orders.amountPaid}),0)`.mapWith(Number) })
    .from(orders)
    .where(eq(orders.weddingId, weddingId))
    .groupBy(orders.campaignId);
  return (
    <>
      <PageHeader folio="VII · Aso Ebi Manager" title="Aso Ebi" lede="Create a campaign, share one link, and let guests order and pay from their phones." actions={<LinkButton href="/app/asoebi/new" variant="primary">+ New campaign</LinkButton>} />
      {list.length ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {list.map((c) => {
            const s = stats.find((x) => x.campaignId === c.id) ?? { n: 0, paid: 0, expected: 0, collected: 0 };
            return (
              <Card key={c.id} pad={false}>
                <div className="grid sm:grid-cols-[10rem_1fr]">
                  <div className="h-40 bg-sand bg-cover bg-center sm:h-full" style={c.images[0] ? { backgroundImage: `url(${fileUrl(c.images[0].fileId)})` } : { background: c.accent }} />
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="eyebrow !text-muted">{c.event?.name ?? "Aso Ebi"}</div>
                        <Link href={`/app/asoebi/${c.id}`} className="font-display mt-1 block text-xl hover:underline">{c.name}</Link>
                        <div className="text-xs text-muted">{c.fabricName}</div>
                      </div>
                      <Stamp tone={c.isPublished ? "sage" : "muted"}>{c.isPublished ? "Live" : "Draft"}</Stamp>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-1.5">{c.packages.filter((p) => p.isActive).map((p) => <span key={p.id} className="border border-linen px-2 py-0.5 text-xs">{p.name} · <span className="figure">{naira(p.price)}</span></span>)}</div>
                    <div className="mt-4 text-sm"><span className="figure">{naira(s.collected)}</span> <span className="text-muted">collected of {naira(s.expected)}</span></div>
                    <div className="mt-2"><Ribbon value={s.expected ? s.collected / s.expected : 0} tone="sage" height={5} /></div>
                    <div className="mt-2 text-xs text-muted">{s.paid} paid · {s.n} orders · deadline {fmtDate(c.paymentDeadline)}</div>
                    <div className="mt-4 flex gap-2">
                      <LinkButton size="sm" href={`/app/asoebi/${c.id}`}>Manage</LinkButton>
                      {c.isPublished && <CopyButton size="sm" text={`/asoebi/${c.slug}`} />}
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card><EmptyState title="No campaigns yet" action={<LinkButton href="/app/asoebi/new" variant="primary">Create your first campaign</LinkButton>}>Set your fabric, packages and prices, then share your link on WhatsApp.</EmptyState></Card>
      )}
    </>
  );
}
