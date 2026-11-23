"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { campaignImages, campaigns, deliveries, deliveryAddresses, events, files, guests, orders, packages, payments } from "@/db/schema";
import { guard, parse, zs, type ActionState } from "@/lib/action";
import { addressSchema } from "@/lib/schemas";
import { applyVerifiedTransaction, DELIVERY_LABEL, guestOrderUrl, reconcilePending } from "@/lib/asoebi";
import { audit } from "@/lib/audit";
import { requireWorkspace } from "@/lib/auth";
import { orderStatusFor } from "@/lib/finance";
import { secretToken, shortCode, slugify } from "@/lib/ids";
import { paymentProvider } from "@/lib/integrations/paystack";
import { naira } from "@/lib/money";
import { notifyGuest } from "@/lib/notify";
import { normaliseNgPhone } from "@/lib/phone";
import { storeUpload } from "@/lib/storage";

const refresh = (extra: string[] = []) => {
  for (const p of ["/app", "/app/asoebi", "/app/guests", "/app/orders", "/app/delivery", ...extra]) revalidatePath(p);
};

/* ─── Campaigns ────────────────────────────────────────────────────── */

const campaignSchema = z.object({
  id: zs.optUuid(),
  name: zs.text(120),
  fabricName: zs.text(120),
  colourStory: zs.optText(200),
  eventId: zs.optUuid(),
  description: zs.optText(3000),
  instructions: zs.optText(3000),
  salesOpenAt: zs.optDate(),
  salesCloseAt: zs.optDate(),
  paymentDeadline: zs.optDate(),
  allowInstalments: zs.bool(),
  minDepositPercent: z.coerce.number().int().min(10).max(100).default(50),
  allowDelivery: zs.bool(),
  allowPickup: zs.bool(),
  deliveryFee: zs.money(),
  pickupDetails: zs.optText(1000),
  deliveryDetails: zs.optText(1000),
  contactName: zs.optText(120),
  contactPhone: zs.optPhone(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#8E5B5B"),
});

export async function saveCampaign(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const { weddingId, wedding, user } = await requireWorkspace({ write: true });
    const p = parse(campaignSchema, fd);
    if ("error" in p) return p.error;
    const { id, ...v } = p.data;
    if (!v.allowDelivery && !v.allowPickup) return { error: "Offer at least one of home delivery or pickup." };
    if (v.salesOpenAt && v.salesCloseAt && v.salesCloseAt < v.salesOpenAt) return { error: "Sales can't close before they open." };
    if (v.eventId && !(await db.select().from(events).where(and(eq(events.id, v.eventId), eq(events.weddingId, weddingId)))).length) return { error: "Invalid event." };
    const values = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x ?? null])) as typeof v;
    let cid = id;
    if (id) {
      const r = await db.update(campaigns).set(values).where(and(eq(campaigns.id, id), eq(campaigns.weddingId, weddingId))).returning();
      if (!r.length) return { error: "Campaign not found." };
    } else {
      const slug = `${slugify(`${wedding.partnerOneName}-${wedding.partnerTwoName}`)}-${shortCode(5).toLowerCase()}`;
      const [c] = await db.insert(campaigns).values({ ...values, weddingId, slug }).returning();
      cid = c.id;
    }
    await audit({ weddingId, userId: user.id, action: id ? "campaign.updated" : "campaign.created", entityType: "campaign", entityId: cid, summary: `Aso Ebi campaign "${v.name}" ${id ? "updated" : "created"}` });
    refresh([`/app/asoebi/${cid}`]);
    return id ? { ok: true, message: "Campaign saved." } : { ok: true, redirect: `/app/asoebi/${cid}` };
  });
}

export async function togglePublish(fd: FormData) {
  const { weddingId } = await requireWorkspace({ write: true });
  const id = String(fd.get("id"));
  const c = await db.query.campaigns.findFirst({ where: and(eq(campaigns.id, id), eq(campaigns.weddingId, weddingId)), with: { packages: true } });
  if (!c) return;
  if (!c.isPublished && !c.packages.some((p) => p.isActive)) throw new Error("Add at least one package before publishing.");
  await db.update(campaigns).set({ isPublished: !c.isPublished }).where(eq(campaigns.id, id));
  refresh([`/app/asoebi/${id}`, `/asoebi/${c.slug}`]);
}

export async function deleteCampaign(fd: FormData) {
  const { weddingId } = await requireWorkspace({ write: true });
  const id = String(fd.get("id"));
  const hasOrders = await db.select({ id: orders.id }).from(orders).where(eq(orders.campaignId, id)).limit(1);
  if (hasOrders.length) throw new Error("This campaign has orders. Unpublish it instead of deleting.");
  await db.delete(campaigns).where(and(eq(campaigns.id, id), eq(campaigns.weddingId, weddingId)));
  refresh();
  redirect("/app/asoebi");
}

const pkgSchema = z.object({
  id: zs.optUuid(),
  campaignId: z.string().uuid(),
  name: zs.text(80),
  description: zs.optText(500),
  price: zs.money(),
  quantityAvailable: z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(0).optional()),
  maxPerOrder: z.coerce.number().int().min(1).max(100).default(10),
  isActive: zs.bool(),
});

export async function savePackage(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const { weddingId } = await requireWorkspace({ write: true });
    const p = parse(pkgSchema, fd);
    if ("error" in p) return p.error;
    const { id, ...v } = p.data;
    if (v.price <= 0) return { error: "Set a price for this package." };
    const [c] = await db.select().from(campaigns).where(and(eq(campaigns.id, v.campaignId), eq(campaigns.weddingId, weddingId)));
    if (!c) return { error: "Campaign not found." };
    const values = { ...v, description: v.description ?? null, quantityAvailable: v.quantityAvailable ?? null };
    if (id) await db.update(packages).set(values).where(and(eq(packages.id, id), eq(packages.weddingId, weddingId)));
    else await db.insert(packages).values({ ...values, weddingId });
    refresh([`/app/asoebi/${c.id}`, `/asoebi/${c.slug}`]);
    return { ok: true, message: "Package saved." };
  });
}

export async function deletePackage(fd: FormData) {
  const { weddingId } = await requireWorkspace({ write: true });
  const [p] = await db.update(packages).set({ isActive: false }).where(and(eq(packages.id, String(fd.get("id"))), eq(packages.weddingId, weddingId))).returning();
  if (p) refresh([`/app/asoebi/${p.campaignId}`]);
}

export async function uploadFabricImages(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const { weddingId, user } = await requireWorkspace({ write: true });
    const campaignId = String(fd.get("campaignId"));
    const [c] = await db.select().from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.weddingId, weddingId)));
    if (!c) return { error: "Campaign not found." };
    const list = fd.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
    if (!list.length) return { error: "Choose at least one photo." };
    for (const [i, f] of list.entries()) {
      if (!f.type.startsWith("image/")) return { error: "Fabric pictures must be images (JPG, PNG or WEBP)." };
      const stored = await storeUpload(f, { weddingId, visibility: "public", userId: user.id });
      if (stored) await db.insert(campaignImages).values({ campaignId, fileId: stored.id, sortOrder: i });
    }
    refresh([`/app/asoebi/${campaignId}`, `/asoebi/${c.slug}`]);
    return { ok: true, message: `${list.length} photo${list.length > 1 ? "s" : ""} uploaded.` };
  });
}

export async function deleteFabricImage(fd: FormData) {
  const { weddingId } = await requireWorkspace({ write: true });
  const id = String(fd.get("id"));
  const [img] = await db
    .select({ id: campaignImages.id, fileId: campaignImages.fileId, campaignId: campaignImages.campaignId })
    .from(campaignImages)
    .innerJoin(campaigns, eq(campaigns.id, campaignImages.campaignId))
    .where(and(eq(campaignImages.id, id), eq(campaigns.weddingId, weddingId)));
  if (!img) return;
  await db.delete(campaignImages).where(eq(campaignImages.id, id));
  await db.delete(files).where(and(eq(files.id, img.fileId), eq(files.weddingId, weddingId)));
  refresh([`/app/asoebi/${img.campaignId}`]);
}

/* ─── Guests ───────────────────────────────────────────────────────── */

const guestSchema = z.object({ id: zs.optUuid(), name: zs.text(120), email: zs.optEmail(), phone: zs.optPhone(), category: zs.text(40), notes: zs.optText(500) });

export async function saveGuest(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const { weddingId } = await requireWorkspace({ write: true });
    const p = parse(guestSchema, fd);
    if ("error" in p) return p.error;
    const { id, ...v } = p.data;
    const values = { ...v, email: v.email ?? null, phone: v.phone ?? null, notes: v.notes ?? null };
    if (id) await db.update(guests).set(values).where(and(eq(guests.id, id), eq(guests.weddingId, weddingId)));
    else await db.insert(guests).values({ ...values, weddingId, inviteToken: secretToken(9), invitedAt: new Date() });
    refresh();
    return { ok: true, message: id ? "Guest updated." : `${v.name} added.` };
  });
}

export async function deleteGuest(fd: FormData) {
  const { weddingId } = await requireWorkspace({ write: true });
  await db.delete(guests).where(and(eq(guests.id, String(fd.get("id"))), eq(guests.weddingId, weddingId)));
  refresh();
}

export async function markLinkSent(fd: FormData) {
  const { weddingId } = await requireWorkspace({ write: true });
  const ids = fd.getAll("id").map(String);
  if (ids.length) await db.update(guests).set({ linkSentAt: new Date() }).where(and(eq(guests.weddingId, weddingId), inArray(guests.id, ids)));
  refresh();
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export async function importGuests(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const { weddingId } = await requireWorkspace({ write: true });
    const file = fd.get("file");
    if (!(file instanceof File) || !file.size) return { error: "Choose a CSV or Excel file." };
    if (file.size > 2_000_000) return { error: "That file is too large (2 MB max)." };
    let table: string[][];
    if (/\.xlsx$/i.test(file.name)) {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as unknown as ArrayBuffer);
      const ws = wb.worksheets[0];
      table = [];
      ws.eachRow((r) => table.push((r.values as unknown[]).slice(1).map((v) => (v == null ? "" : typeof v === "object" && v && "text" in v ? String((v as { text: string }).text) : String(v)))));
    } else table = parseCsv(await file.text());
    if (table.length < 2) return { error: "The file needs a header row and at least one guest." };
    const head = table[0].map((h) => h.toLowerCase().trim());
    const col = (...names: string[]) => head.findIndex((h) => names.some((n) => h.includes(n)));
    const ni = col("name"), ei = col("email", "e-mail"), pi = col("phone", "mobile", "whatsapp", "number"), ci = col("category", "group", "side");
    if (ni < 0) return { error: 'Couldn\'t find a "Name" column in the header row.' };
    const existing = await db.select({ phone: guests.phone, email: guests.email }).from(guests).where(eq(guests.weddingId, weddingId));
    const seen = new Set(existing.flatMap((g) => [g.phone, g.email?.toLowerCase()]).filter(Boolean) as string[]);
    const rows = [];
    let skipped = 0, badPhone = 0;
    for (const r of table.slice(1)) {
      const name = (r[ni] ?? "").trim();
      if (!name) { skipped++; continue; }
      const rawPhone = pi >= 0 ? (r[pi] ?? "").trim() : "";
      const phone = rawPhone ? normaliseNgPhone(rawPhone) : null;
      if (rawPhone && !phone) badPhone++;
      const email = ei >= 0 && /\S+@\S+\.\S+/.test(r[ei] ?? "") ? r[ei].trim().toLowerCase() : null;
      if ((phone && seen.has(phone)) || (email && seen.has(email))) { skipped++; continue; }
      if (phone) seen.add(phone);
      if (email) seen.add(email);
      rows.push({ weddingId, name: name.slice(0, 120), phone, email, category: (ci >= 0 && r[ci]?.trim()) || "Friends", inviteToken: secretToken(9), invitedAt: new Date() });
    }
    if (rows.length) await db.insert(guests).values(rows);
    refresh();
    return { ok: true, message: `Imported ${rows.length} guest${rows.length === 1 ? "" : "s"}.${skipped ? ` Skipped ${skipped} duplicate or empty row${skipped === 1 ? "" : "s"}.` : ""}${badPhone ? ` ${badPhone} phone number${badPhone === 1 ? " wasn't" : "s weren't"} a valid Nigerian number and ${badPhone === 1 ? "was" : "were"} left blank.` : ""}` };
  });
}

/* ─── Orders (couple side) ─────────────────────────────────────────── */

async function ownOrder(id: string, weddingId: string) {
  const [o] = await db.select().from(orders).where(and(eq(orders.id, id), eq(orders.weddingId, weddingId)));
  if (!o) throw new Error("Order not found.");
  return o;
}


export async function adminUpdateAddress(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const { weddingId, user } = await requireWorkspace({ write: true });
    const o = await ownOrder(String(fd.get("orderId")), weddingId);
    const p = parse(addressSchema, fd);
    if ("error" in p) return p.error;
    const v = { ...p.data, landmark: p.data.landmark ?? null, instructions: p.data.instructions ?? null };
    await db.insert(deliveryAddresses).values({ orderId: o.id, ...v, source: "couple" }).onConflictDoUpdate({ target: deliveryAddresses.orderId, set: { ...v, source: "couple" } });
    if (o.deliveryMethod !== "delivery") await db.update(orders).set({ deliveryMethod: "delivery" }).where(eq(orders.id, o.id));
    await audit({ weddingId, userId: user.id, action: "address.updated", entityType: "order", entityId: o.id, summary: `Delivery address for ${o.code} edited by the couple` });
    refresh([`/app/orders/${o.id}`]);
    return { ok: true, message: "Address saved." };
  });
}

export async function cancelOrder(fd: FormData) {
  const { weddingId, user } = await requireWorkspace({ write: true });
  const o = await ownOrder(String(fd.get("id")), weddingId);
  const cancelled = !o.cancelledAt;
  await db.update(orders).set({ cancelledAt: cancelled ? new Date() : null, status: orderStatusFor(o.total, o.amountPaid, cancelled) }).where(eq(orders.id, o.id));
  await audit({ weddingId, userId: user.id, action: cancelled ? "order.cancelled" : "order.restored", entityType: "order", entityId: o.id, summary: `Order ${o.code} ${cancelled ? "cancelled" : "restored"}${o.amountPaid ? ` (${naira(o.amountPaid)} already paid — refund manually if needed)` : ""}` });
  refresh([`/app/orders/${o.id}`]);
}

const manualSchema = z.object({ orderId: z.string().uuid(), amount: zs.money(), reference: zs.text(80), note: zs.optText(300) });

/**
 * For guests who paid by direct bank transfer to the couple. This is clearly recorded as a
 * manual entry by a named user (not a gateway verification) and appears that way in the audit log.
 */
export async function recordManualPayment(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const { weddingId, wedding, user } = await requireWorkspace({ write: true });
    const p = parse(manualSchema, fd);
    if ("error" in p) return p.error;
    const o = await ownOrder(p.data.orderId, weddingId);
    const outstanding = o.total - o.amountPaid;
    if (p.data.amount <= 0 || p.data.amount > outstanding) return { error: `Enter an amount up to ${naira(outstanding)}.` };
    const reference = `MAN-${o.code}-${shortCode(4)}`;
    await db.transaction(async (tx) => {
      const now = new Date();
      await tx.insert(payments).values({ weddingId, orderId: o.id, provider: "manual", reference, amount: p.data.amount, status: "success", channel: "bank transfer (manual)", gatewayResponse: `Recorded by ${user.name}: ${p.data.reference}${p.data.note ? ` — ${p.data.note}` : ""}`, paidAt: now, verifiedAt: now, appliedAt: now, recordedBy: user.id });
      const [locked] = await tx.select().from(orders).where(eq(orders.id, o.id)).for("update");
      const amountPaid = locked.amountPaid + p.data.amount;
      await tx.update(orders).set({ amountPaid, status: orderStatusFor(locked.total, amountPaid, !!locked.cancelledAt) }).where(eq(orders.id, o.id));
      await audit({ weddingId, userId: user.id, action: "payment.manual", entityType: "order", entityId: o.id, summary: `${user.name} recorded a manual transfer of ${naira(p.data.amount)} for ${o.code} (bank ref ${p.data.reference})`, before: { amountPaid: locked.amountPaid }, after: { amountPaid } }, tx);
    });
    await notifyGuest(wedding, { email: o.email }, {
      type: "asoebi_receipt",
      trigger: "Manual payment recorded by couple",
      title: `Payment received — ${o.code}`,
      body: `${naira(p.data.amount)} recorded`,
      dedupeKey: `payment:${reference}:receipt`,
      email: { eyebrow: `${wedding.partnerOneName} & ${wedding.partnerTwoName} · Aso Ebi`, title: "Your transfer has been confirmed", rows: [["Order ID", o.code], ["Amount", naira(p.data.amount)], ["Reference", reference]], cta: { label: "View receipt", href: guestOrderUrl(o) } },
    });
    refresh([`/app/orders/${o.id}`]);
    return { ok: true, message: "Manual payment recorded." };
  });
}

export async function recheckPayment(fd: FormData) {
  const { weddingId } = await requireWorkspace({ write: true });
  const ref = String(fd.get("reference"));
  const [p] = await db.select().from(payments).where(and(eq(payments.reference, ref), eq(payments.weddingId, weddingId)));
  if (!p) return;
  const provider = paymentProvider();
  if (provider.configured() && p.provider === provider.name) await applyVerifiedTransaction(await provider.verify(ref), "reconcile");
  refresh([`/app/orders/${p.orderId}`]);
}

export async function reconcileAll() {
  const { weddingId } = await requireWorkspace({ write: true });
  await reconcilePending(weddingId);
  refresh();
}

/* ─── Deliveries ───────────────────────────────────────────────────── */

const deliverySchema = z.object({
  orderId: z.union([z.string().uuid(), z.array(z.string().uuid())]),
  status: z.enum(["awaiting", "processing", "ready_for_collection", "dispatched", "delivered", "failed"]),
  riderName: zs.optText(80),
  riderPhone: zs.optPhone(),
  trackingRef: zs.optText(80),
  notes: zs.optText(500),
});

export async function updateDelivery(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const { weddingId, wedding, user } = await requireWorkspace({ write: true });
    const p = parse(deliverySchema, fd);
    if ("error" in p) return p.error;
    const ids = ([] as string[]).concat(p.data.orderId);
    const own = await db.select().from(orders).where(and(eq(orders.weddingId, weddingId), inArray(orders.id, ids)));
    const now = new Date();
    for (const o of own) {
      const set = {
        status: p.data.status,
        ...(p.data.riderName !== undefined ? { riderName: p.data.riderName } : {}),
        ...(p.data.riderPhone !== undefined ? { riderPhone: p.data.riderPhone } : {}),
        ...(p.data.trackingRef !== undefined ? { trackingRef: p.data.trackingRef } : {}),
        ...(p.data.notes !== undefined ? { notes: p.data.notes } : {}),
        ...(p.data.status === "dispatched" ? { dispatchedAt: now } : {}),
        ...(p.data.status === "delivered" ? { deliveredAt: now } : {}),
      };
      await db.insert(deliveries).values({ orderId: o.id, weddingId, ...set }).onConflictDoUpdate({ target: deliveries.orderId, set });
      if (["dispatched", "delivered", "ready_for_collection"].includes(p.data.status))
        await notifyGuest(wedding, { email: o.email, phone: o.phone }, {
          type: "delivery_update",
          trigger: `Delivery marked ${DELIVERY_LABEL[p.data.status]}`,
          title: `Your Aso Ebi: ${DELIVERY_LABEL[p.data.status]}`,
          body: o.code,
          dedupeKey: `delivery:${o.id}:${p.data.status}`,
          email: {
            eyebrow: `${wedding.partnerOneName} & ${wedding.partnerTwoName} · Aso Ebi`,
            title: p.data.status === "ready_for_collection" ? "Your Aso Ebi is ready for collection" : p.data.status === "dispatched" ? "Your Aso Ebi is on its way" : "Your Aso Ebi has been delivered",
            rows: [["Order", o.code], ...(p.data.riderName ? ([["Rider", `${p.data.riderName}${p.data.riderPhone ? ` · ${p.data.riderPhone}` : ""}`]] as Array<[string, string]>) : []), ...(p.data.trackingRef ? ([["Tracking", p.data.trackingRef]] as Array<[string, string]>) : [])],
            cta: { label: "View your order", href: guestOrderUrl(o) },
          },
          whatsapp: { template: process.env.WHATSAPP_TEMPLATE_CONFIRMATION ?? "order_confirmation", params: [o.fullName, o.code, DELIVERY_LABEL[p.data.status], `${wedding.partnerOneName} & ${wedding.partnerTwoName}`] },
        });
    }
    await audit({ weddingId, userId: user.id, action: "delivery.updated", entityType: "order", entityId: ids.length === 1 ? ids[0] : null, summary: `${own.length} order${own.length === 1 ? "" : "s"} marked ${DELIVERY_LABEL[p.data.status]}` });
    refresh(ids.length === 1 ? [`/app/orders/${ids[0]}`] : []);
    return { ok: true, message: `Updated ${own.length} order${own.length === 1 ? "" : "s"}.` };
  });
}
