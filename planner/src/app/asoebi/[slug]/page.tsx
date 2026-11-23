import { and, eq, isNull } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrderForm } from "@/components/order-form";
import { db } from "@/db";
import { guests } from "@/db/schema";
import { publicCampaign } from "@/lib/asoebi";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { displayPhone, waNumber } from "@/lib/phone";
import { fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const pub = await publicCampaign((await params).slug);
  if (!pub) return { title: "Aso Ebi" };
  const couple = `${pub.wedding.partnerOneName} & ${pub.wedding.partnerTwoName}`;
  const img = pub.campaign.images[0];
  return {
    title: `${couple} · Aso Ebi`,
    description: `${pub.campaign.fabricName}. Order and pay securely online.`,
    openGraph: { title: `${couple} — Aso Ebi`, description: pub.campaign.fabricName, images: img ? [fileUrl(img.fileId)!] : [] },
    robots: { index: false },
  };
}

export default async function PublicAsoEbi({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ g?: string }> }) {
  const { slug } = await params;
  const { g } = await searchParams;
  const pub = await publicCampaign(slug);
  if (!pub) notFound();
  const { campaign: c, wedding: w, window } = pub;
  if (g && /^[\w-]{6,40}$/.test(g)) await db.update(guests).set({ linkOpenedAt: new Date() }).where(and(eq(guests.weddingId, w.id), eq(guests.inviteToken, g), isNull(guests.linkOpenedAt)));
  const accent = c.accent;
  const minPrice = Math.min(...c.packages.map((p) => p.price));

  return (
    <main className="min-h-dvh bg-[#FBF8F2]" style={{ ["--accent" as string]: accent }}>
      {/* Fabric hero */}
      <section className="relative overflow-hidden text-[#FBF8F2]" style={{ background: accent }}>
        {c.images[0] && <div className="absolute inset-0 bg-cover bg-center opacity-35 mix-blend-luminosity" style={{ backgroundImage: `url(${fileUrl(c.images[0].fileId)})` }} />}
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/20 to-black/55" />
        <div className="relative mx-auto max-w-xl px-5 pb-10 pt-12 text-center">
          <div className="text-[0.66rem] font-semibold uppercase tracking-[0.34em] opacity-80">Aso Ebi{c.event ? ` · ${c.event.name}` : ""}</div>
          <h1 className="font-display mt-4 text-[2.7rem] leading-[1.02]">
            {w.partnerOneName}
            <span className="mx-2 font-light italic opacity-80">&amp;</span>
            {w.partnerTwoName}
          </h1>
          <p className="mt-3 text-sm opacity-90">
            {c.event?.date ? fmtDate(c.event.date, "long") : w.weddingDate ? fmtDate(w.weddingDate, "long") : ""}
            {(c.event?.venue ?? w.venue) && <> · {c.event?.venue ?? w.venue}</>}
          </p>
          <div className="mx-auto mt-6 h-px w-24 bg-white/50" />
          <p className="font-display mt-6 text-xl italic">{c.fabricName}</p>
          {c.colourStory && <p className="mt-1 text-xs uppercase tracking-[0.2em] opacity-75">{c.colourStory}</p>}
        </div>
      </section>

      <div className="mx-auto max-w-xl px-5">
        {/* Swatch gallery — horizontal scroll on phones */}
        {c.images.length > 0 && (
          <div className="-mx-5 -mt-6 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-2">
            {c.images.map((im) => (
              <figure key={im.id} className="w-[78%] shrink-0 snap-center sm:w-[48%]">
                <div className="aspect-[4/5] border-4 border-white bg-[#EDE4D3] bg-cover bg-center shadow-[0_18px_40px_-20px_rgba(0,0,0,0.45)]" style={{ backgroundImage: `url(${fileUrl(im.fileId)})` }} role="img" aria-label={im.caption ?? c.fabricName} />
                {im.caption && <figcaption className="mt-2 text-center text-xs text-[#7A7268]">{im.caption}</figcaption>}
              </figure>
            ))}
          </div>
        )}

        <section className="py-8">
          {c.description && <p className="text-[0.95rem] leading-relaxed text-[#4A4540]">{c.description}</p>}
          <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden border border-[#E6DCCB] bg-[#E6DCCB] text-sm">
            <div className="bg-white p-3"><dt className="text-[0.62rem] uppercase tracking-[0.16em] text-[#7A7268]">From</dt><dd className="mt-0.5 font-mono text-lg">{naira(minPrice)}</dd></div>
            <div className="bg-white p-3"><dt className="text-[0.62rem] uppercase tracking-[0.16em] text-[#7A7268]">Pay by</dt><dd className="mt-0.5 text-lg">{fmtDate(c.paymentDeadline)}</dd></div>
            <div className="col-span-2 bg-white p-3 text-[#4A4540]">Pay by bank transfer to the couple. Account details are shown after you place your order.</div>
          </dl>
          {c.instructions && (
            <div className="mt-6 border-l-2 pl-4 text-sm leading-relaxed text-[#4A4540]" style={{ borderColor: accent }}>
              <div className="mb-1 text-[0.62rem] font-semibold uppercase tracking-[0.18em] text-[#7A7268]">How to order</div>
              {c.instructions}
            </div>
          )}
        </section>

        <section className="border-t border-[#E6DCCB] py-8">
          <h2 className="font-display mb-5 text-2xl text-[#2A2725]">Order your Aso Ebi</h2>
          {window === "open" ? (
            <OrderForm slug={c.slug} guestToken={g} packages={c.packages.map((p) => ({ id: p.id, name: p.name, description: p.description, price: p.price, remaining: p.remaining, maxPerOrder: p.maxPerOrder }))} deliveryFee={c.deliveryFee} allowDelivery={c.allowDelivery} allowPickup={c.allowPickup} />
          ) : (
            <p className="border border-[#E6DCCB] bg-white p-5 text-center text-[#4A4540]">{window === "closed" ? "Orders for this Aso Ebi have closed. Thank you!" : `Orders open on ${fmtDate(c.salesOpenAt, "long")}.`}</p>
          )}
        </section>

        <section className="space-y-4 border-t border-[#E6DCCB] py-8 text-sm text-[#4A4540]">
          {c.allowDelivery && c.deliveryDetails && <p><b className="text-[#2A2725]">Delivery.</b> {c.deliveryDetails}</p>}
          {c.allowPickup && c.pickupDetails && <p><b className="text-[#2A2725]">Pickup.</b> {c.pickupDetails}</p>}
          {c.contactPhone && (
            <p>
              <b className="text-[#2A2725]">Questions?</b> {c.contactName ?? "Contact"} · <a className="underline" href={`tel:${c.contactPhone}`}>{displayPhone(c.contactPhone)}</a> ·{" "}
              <a className="underline" target="_blank" rel="noreferrer" href={`https://wa.me/${waNumber(c.contactPhone)}`}>WhatsApp</a>
            </p>
          )}
          <p className="flex items-center gap-2 pt-2 text-xs text-[#7A7268]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><rect x="4" y="10" width="16" height="11" rx="1" /><path d="M8 10V7a4 4 0 1 1 8 0v3" /></svg>
            Your details are only shared with the couple.
          </p>
        </section>
      </div>
      <footer className="pb-10 text-center text-[0.65rem] uppercase tracking-[0.3em] text-[#A59C90]">Owambe Ledger</footer>
    </main>
  );
}
