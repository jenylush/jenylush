import "server-only";
import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  campaigns,
  deliveries,
  deliveryAddresses,
  guests,
  orderItems,
  orders,
  packages,
  payments,
  weddings,
} from "@/db/schema";
import { audit } from "./audit";
import { fmtDateTime, todayISO } from "./dates";
import { orderStatusFor, orderTotals } from "./finance";
import { orderCode, secretToken } from "./ids";
import { naira } from "./money";
import { notifyCouple, notifyGuest } from "./notify";

export const GUEST_STATUS = [
  "Invited",
  "Link sent",
  "Ordered, not paid",
  "Says paid",
  "Payment confirmed",
  "Order completed",
  "Delivery pending",
  "Delivered",
  "Cancelled",
] as const;
export type GuestStatus = (typeof GUEST_STATUS)[number];

export const DELIVERY_LABEL = {
  awaiting: "Awaiting delivery",
  processing: "Processing",
  ready_for_collection: "Ready for collection",
  dispatched: "Dispatched",
  delivered: "Delivered",
  failed: "Delivery failed",
} as const;

export const ORDER_LABEL = {
  pending_payment: "Not paid yet",
  transfer_reported: "Says paid — confirm",
  partially_paid: "Partially paid",
  paid: "Paid (confirmed)",
  cancelled: "Cancelled",
} as const;

export function guestStatus(
  g: { linkSentAt: Date | null },
  o?: {
    status: keyof typeof ORDER_LABEL;
    deliveryMethod: "delivery" | "pickup";
    delivery?: { status: keyof typeof DELIVERY_LABEL } | null;
  } | null,
): GuestStatus {
  if (!o) return g.linkSentAt ? "Link sent" : "Invited";
  if (o.status === "cancelled") return "Cancelled";
  if (o.status === "pending_payment" || o.status === "partially_paid") return "Ordered, not paid";
  if (o.status === "transfer_reported") return "Says paid";
  const d = o.delivery?.status ?? "awaiting";
  if (d === "delivered") return o.deliveryMethod === "pickup" ? "Order completed" : "Delivered";
  if (d === "awaiting") return "Payment confirmed";
  return "Delivery pending";
}

/* ─── Public campaign lookup ───────────────────────────────────────── */

export async function publicCampaign(slug: string) {
  const c = await db.query.campaigns.findFirst({
    where: and(eq(campaigns.slug, slug), eq(campaigns.isPublished, true)),
    with: {
      packages: { where: eq(packages.isActive, true), orderBy: (p, { asc }) => [asc(p.sortOrder), asc(p.price)] },
      images: { with: { file: true }, orderBy: (i, { asc }) => [asc(i.sortOrder)] },
      event: true,
    },
  });
  if (!c) return null;
  const [wedding] = await db.select().from(weddings).where(eq(weddings.id, c.weddingId));
  const sold = await db
    .select({ packageId: orderItems.packageId, qty: sql<number>`coalesce(sum(${orderItems.quantity}),0)`.mapWith(Number) })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orders.campaignId, c.id), sql`${orders.status} <> 'cancelled'`))
    .groupBy(orderItems.packageId);
  const soldMap = new Map(sold.map((s) => [s.packageId, s.qty]));
  const pk = c.packages.map((p) => ({
    ...p,
    remaining: p.quantityAvailable == null ? null : Math.max(0, p.quantityAvailable - (soldMap.get(p.id) ?? 0)),
  }));
  const today = todayISO();
  const window =
    c.salesOpenAt && today < c.salesOpenAt ? "not_open" : c.salesCloseAt && today > c.salesCloseAt ? "closed" : "open";
  return { campaign: { ...c, packages: pk }, wedding, window: window as "not_open" | "open" | "closed" };
}

/* ─── Orders ───────────────────────────────────────────────────────── */

export interface OrderInput {
  fullName: string;
  phone: string;
  email?: string | null;
  items: Array<{ packageId: string; quantity: number }>;
  deliveryMethod: "delivery" | "pickup";
  address?: { street: string; area: string; city: string; state: string; landmark?: string; instructions?: string };
  guestToken?: string | null;
}

export class OrderError extends Error {}

export async function createOrder(slug: string, input: OrderInput) {
  const pub = await publicCampaign(slug);
  if (!pub) throw new OrderError("This Aso Ebi page is not available.");
  const { campaign, wedding } = pub;
  if (pub.window !== "open") throw new OrderError(pub.window === "closed" ? "Sales for this Aso Ebi have closed." : "Sales have not opened yet.");
  if (input.deliveryMethod === "delivery" && !campaign.allowDelivery) throw new OrderError("Home delivery isn't offered for this Aso Ebi.");
  if (input.deliveryMethod === "pickup" && !campaign.allowPickup) throw new OrderError("Pickup isn't offered for this Aso Ebi.");
  if (input.deliveryMethod === "delivery" && !input.address) throw new OrderError("A full delivery address is required for home delivery.");

  const chosen = input.items.filter((i) => i.quantity > 0);
  if (!chosen.length) throw new OrderError("Choose at least one package.");
  const lines = chosen.map((i) => {
    const p = campaign.packages.find((x) => x.id === i.packageId);
    if (!p) throw new OrderError("One of the selected packages is no longer available.");
    if (i.quantity > p.maxPerOrder) throw new OrderError(`You can order at most ${p.maxPerOrder} × ${p.name}.`);
    if (p.remaining != null && i.quantity > p.remaining)
      throw new OrderError(p.remaining === 0 ? `${p.name} is sold out.` : `Only ${p.remaining} × ${p.name} left.`);
    return { p, quantity: i.quantity };
  });
  const totals = orderTotals(
    lines.map((l) => ({ unitPrice: l.p.price, quantity: l.quantity })),
    campaign.deliveryFee,
    input.deliveryMethod,
  );

  const order = await db.transaction(async (tx) => {
    // Link to an existing guest record: by personal invite token first, then phone or email.
    let guest = input.guestToken
      ? (await tx.select().from(guests).where(and(eq(guests.weddingId, wedding.id), eq(guests.inviteToken, input.guestToken))))[0]
      : undefined;
    if (!guest)
      guest = (
        await tx
          .select()
          .from(guests)
          .where(and(eq(guests.weddingId, wedding.id), input.email ? or(eq(guests.phone, input.phone), sql`lower(${guests.email}) = lower(${input.email})`) : eq(guests.phone, input.phone)))
          .limit(1)
      )[0];
    if (!guest)
      [guest] = await tx
        .insert(guests)
        .values({ weddingId: wedding.id, name: input.fullName, phone: input.phone, email: input.email ?? null, category: "Self-registered", inviteToken: secretToken(9) })
        .returning();
    else if (!guest.email || !guest.phone)
      await tx.update(guests).set({ email: guest.email ?? input.email ?? null, phone: guest.phone ?? input.phone }).where(eq(guests.id, guest.id));

    const [o] = await tx
      .insert(orders)
      .values({
        weddingId: wedding.id,
        campaignId: campaign.id,
        guestId: guest.id,
        code: orderCode(),
        accessToken: secretToken(24),
        fullName: input.fullName,
        phone: input.phone,
        email: input.email?.toLowerCase() ?? null,
        deliveryMethod: input.deliveryMethod,
        subtotal: totals.subtotal,
        deliveryFee: totals.deliveryFee,
        total: totals.total,
      })
      .returning();
    await tx.insert(orderItems).values(
      lines.map((l) => ({ orderId: o.id, packageId: l.p.id, packageName: l.p.name, unitPrice: l.p.price, quantity: l.quantity, lineTotal: l.p.price * l.quantity })),
    );
    if (input.deliveryMethod === "delivery" && input.address) await tx.insert(deliveryAddresses).values({ orderId: o.id, ...input.address });
    await tx.insert(deliveries).values({ orderId: o.id, weddingId: wedding.id, status: "awaiting" });
    await audit({ weddingId: wedding.id, actor: "guest", action: "order.created", entityType: "order", entityId: o.id, summary: `${o.fullName} placed order ${o.code} (${naira(o.total)})`, after: { total: o.total, lines: lines.map((l) => [l.p.name, l.quantity]) } }, tx);
    return o;
  });

  await notifyCouple(wedding, {
    type: "asoebi_order_created",
    trigger: "Guest submitted an Aso Ebi order",
    title: `New Aso Ebi order from ${order.fullName}`,
    body: `${order.code} · ${naira(order.total)} · awaiting payment`,
    href: `/app/orders/${order.id}`,
    dedupeKey: `order:${order.id}:created`,
    entity: { type: "order", id: order.id },
  });
  if (input.deliveryMethod === "delivery" && !input.address)
    await notifyCouple(wedding, { type: "missing_address", trigger: "Order with no delivery address", title: `Missing delivery address — ${order.code}`, body: order.fullName, href: `/app/orders/${order.id}` });
  return order;
}

export async function orderForGuest(code: string, token: string) {
  const o = await db.query.orders.findFirst({
    where: and(eq(orders.code, code), eq(orders.accessToken, token)),
    with: { items: true, address: true, delivery: true, payments: { orderBy: (p, { desc }) => [desc(p.reportedAt)] }, campaign: true },
  });
  if (!o) return null;
  const [wedding] = await db.select().from(weddings).where(eq(weddings.id, o.weddingId));
  return { order: o, wedding };
}

export const guestOrderUrl = (o: { code: string; accessToken: string }) =>
  `/asoebi/order/${o.code}?t=${encodeURIComponent(o.accessToken)}`;

/* ─── Bank-transfer payments (MVP — no payment gateway) ────────────── */

/**
 * The guest taps "I have sent the money". This records them in the register straight
 * away as "Says paid"; the couple then checks their bank app and confirms (or marks it
 * not received). Reporting twice for the same order is a no-op.
 */
export async function reportTransfer(code: string, token: string, info: { senderName?: string; reference?: string }) {
  const found = await orderForGuest(code, token);
  if (!found) throw new OrderError("Order not found.");
  const { order: o, wedding } = found;
  if (o.status === "cancelled") throw new OrderError("This order was cancelled. Please contact the couple.");
  if (o.status === "paid") return o;
  const outstanding = o.total - o.amountPaid;
  const already = o.payments.find((p) => p.status === "reported");
  await db.transaction(async (tx) => {
    if (already) await tx.update(payments).set({ senderName: info.senderName ?? already.senderName, reference: info.reference ?? already.reference, reportedAt: new Date() }).where(eq(payments.id, already.id));
    else await tx.insert(payments).values({ weddingId: wedding.id, orderId: o.id, amount: outstanding, senderName: info.senderName ?? null, reference: info.reference ?? null, source: "guest" });
    await tx.update(orders).set({ status: "transfer_reported" }).where(eq(orders.id, o.id));
    await audit({ weddingId: wedding.id, actor: "guest", action: "transfer.reported", entityType: "order", entityId: o.id, summary: `${o.fullName} says they sent ${naira(outstanding)} for ${o.code}${info.senderName ? ` (from ${info.senderName})` : ""}` }, tx);
  });
  if (!already)
    await notifyCouple(wedding, {
      type: "asoebi_transfer_reported",
      trigger: "Guest tapped “I have sent the money”",
      title: `${o.fullName} says they've paid ${naira(outstanding)}`,
      body: `${o.code}${info.senderName ? ` · sender: ${info.senderName}` : ""} — check your bank and confirm.`,
      href: `/app/orders/${o.id}`,
      dedupeKey: `order:${o.id}:reported`,
      entity: { type: "order", id: o.id },
    });
  return o;
}

/** Couple confirms the money arrived (or records a transfer themselves). */
export async function confirmTransfer(orderId: string, weddingId: string, user: { id: string; name: string }) {
  const result = await db.transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.weddingId, weddingId))).for("update");
    if (!o) throw new Error("Order not found.");
    if (o.status === "paid") return null;
    const outstanding = o.total - o.amountPaid;
    const [reported] = await tx.select().from(payments).where(and(eq(payments.orderId, o.id), eq(payments.status, "reported")));
    const now = new Date();
    if (reported) await tx.update(payments).set({ status: "confirmed", amount: outstanding, confirmedAt: now, confirmedBy: user.id }).where(eq(payments.id, reported.id));
    else await tx.insert(payments).values({ weddingId, orderId: o.id, amount: outstanding, status: "confirmed", source: "couple", reportedAt: now, confirmedAt: now, confirmedBy: user.id });
    const [updated] = await tx.update(orders).set({ amountPaid: o.total, status: orderStatusFor(o.total, o.total, !!o.cancelledAt) }).where(eq(orders.id, o.id)).returning();
    await audit({ weddingId, userId: user.id, action: "transfer.confirmed", entityType: "order", entityId: o.id, summary: `${user.name} confirmed ${naira(outstanding)} received for ${o.code} (${o.fullName})`, before: { status: o.status, amountPaid: o.amountPaid }, after: { status: updated.status, amountPaid: updated.amountPaid } }, tx);
    return { order: updated, amount: outstanding };
  });
  if (!result) return;
  const { order: o, amount } = result;
  if (o.email) {
    const [w] = await db.select().from(weddings).where(eq(weddings.id, weddingId));
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    await notifyGuest(w, { email: o.email }, {
      type: "asoebi_receipt",
      trigger: "Couple confirmed transfer",
      title: `Payment confirmed — ${o.code}`,
      body: `${naira(amount)} received`,
      dedupeKey: `order:${o.id}:confirmed`,
      entity: { type: "order", id: o.id },
      email: {
        eyebrow: `${w.partnerOneName} & ${w.partnerTwoName} · Aso Ebi`,
        title: "Your Aso Ebi payment is confirmed",
        intro: `Thank you, ${o.fullName.split(" ")[0]}. We've received your transfer.`,
        rows: [["Order ID", o.code], ["Package", items.map((i) => `${i.quantity} × ${i.packageName}`).join(", ")], ["Amount", naira(amount)], ["Confirmed", fmtDateTime(new Date())]],
        cta: { label: "View your order", href: guestOrderUrl(o) },
      },
    });
  }
}

/** Couple checked and the money hasn't arrived — back to "Not paid yet". */
export async function rejectTransfer(orderId: string, weddingId: string, user: { id: string; name: string }) {
  await db.transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.weddingId, weddingId))).for("update");
    if (!o || o.status !== "transfer_reported") return;
    await tx.update(payments).set({ status: "not_received", confirmedAt: new Date(), confirmedBy: user.id }).where(and(eq(payments.orderId, o.id), eq(payments.status, "reported")));
    await tx.update(orders).set({ status: orderStatusFor(o.total, o.amountPaid, !!o.cancelledAt) }).where(eq(orders.id, o.id));
    await audit({ weddingId, userId: user.id, action: "transfer.not_received", entityType: "order", entityId: o.id, summary: `${user.name} marked the transfer for ${o.code} as not received` }, tx);
  });
}

/** Undo a confirmation made by mistake. */
export async function unconfirmTransfer(orderId: string, weddingId: string, user: { id: string; name: string }) {
  await db.transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.weddingId, weddingId))).for("update");
    if (!o || o.status !== "paid") return;
    await tx.update(payments).set({ status: "reported", confirmedAt: null, confirmedBy: null }).where(and(eq(payments.orderId, o.id), eq(payments.status, "confirmed")));
    await tx.update(orders).set({ amountPaid: 0, status: "transfer_reported" }).where(eq(orders.id, o.id));
    await audit({ weddingId, userId: user.id, action: "transfer.unconfirmed", entityType: "order", entityId: o.id, summary: `${user.name} undid the payment confirmation for ${o.code}` }, tx);
  });
}
