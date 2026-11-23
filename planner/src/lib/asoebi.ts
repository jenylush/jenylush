import "server-only";
import { and, eq, inArray, or, sql } from "drizzle-orm";
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
import { appUrl } from "./config";
import { fmtDateTime, todayISO } from "./dates";
import { orderStatusFor, orderTotals } from "./finance";
import { orderCode, paymentReference, secretToken } from "./ids";
import { paymentProvider, type VerifiedTransaction } from "./integrations/paystack";
import { naira } from "./money";
import { notifyCouple, notifyGuest } from "./notify";

export const GUEST_STATUS = [
  "Invited",
  "Link sent",
  "Order started",
  "Payment pending",
  "Partially paid",
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
  pending_payment: "Payment pending",
  partially_paid: "Partially paid",
  paid: "Paid",
  cancelled: "Cancelled",
} as const;

export function guestStatus(
  g: { linkSentAt: Date | null },
  o?: {
    status: keyof typeof ORDER_LABEL;
    deliveryMethod: "delivery" | "pickup";
    delivery?: { status: keyof typeof DELIVERY_LABEL } | null;
    payments?: Array<{ status: string }>;
  } | null,
): GuestStatus {
  if (!o) return g.linkSentAt ? "Link sent" : "Invited";
  if (o.status === "cancelled") return "Cancelled";
  if (o.status === "pending_payment")
    return o.payments?.some((p) => p.status === "pending" || p.status === "initialized") ? "Payment pending" : "Order started";
  if (o.status === "partially_paid") return "Partially paid";
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
  email: string;
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
          .where(and(eq(guests.weddingId, wedding.id), or(eq(guests.phone, input.phone), sql`lower(${guests.email}) = lower(${input.email})`)))
          .limit(1)
      )[0];
    if (!guest)
      [guest] = await tx
        .insert(guests)
        .values({ weddingId: wedding.id, name: input.fullName, phone: input.phone, email: input.email, category: "Self-registered", inviteToken: secretToken(9) })
        .returning();
    else if (!guest.email || !guest.phone)
      await tx.update(guests).set({ email: guest.email ?? input.email, phone: guest.phone ?? input.phone }).where(eq(guests.id, guest.id));

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
        email: input.email.toLowerCase(),
        deliveryMethod: input.deliveryMethod,
        subtotal: totals.subtotal,
        deliveryFee: totals.deliveryFee,
        total: totals.total,
        paymentPlan: campaign.allowInstalments ? "instalments" : "full",
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
    with: { items: true, address: true, delivery: true, payments: { orderBy: (p, { desc }) => [desc(p.createdAt)] }, campaign: true },
  });
  if (!o) return null;
  const [wedding] = await db.select().from(weddings).where(eq(weddings.id, o.weddingId));
  return { order: o, wedding };
}

export const guestOrderUrl = (o: { code: string; accessToken: string }) =>
  `/asoebi/order/${o.code}?t=${encodeURIComponent(o.accessToken)}`;

/** The amount a guest may pay now, respecting the couple's instalment rules. */
export function paymentBounds(o: { total: number; amountPaid: number; paymentPlan: string }, minDepositPercent: number) {
  const outstanding = Math.max(0, o.total - o.amountPaid);
  if (o.paymentPlan !== "instalments") return { min: outstanding, max: outstanding, outstanding };
  const deposit = o.amountPaid === 0 ? Math.ceil((o.total * minDepositPercent) / 100) : Math.min(outstanding, 500_000);
  return { min: Math.min(outstanding, deposit), max: outstanding, outstanding };
}

/** Create a pending payment record and a Paystack checkout. Throws PaymentNotConfiguredError without keys. */
export async function startPayment(code: string, token: string, requested?: number) {
  const found = await orderForGuest(code, token);
  if (!found) throw new OrderError("Order not found.");
  const { order, wedding } = found;
  if (order.status === "cancelled") throw new OrderError("This order was cancelled.");
  const bounds = paymentBounds(order, order.campaign.minDepositPercent);
  if (bounds.outstanding === 0) throw new OrderError("This order is already fully paid.");
  const amount = requested ? Math.round(requested) : bounds.max;
  if (amount < bounds.min || amount > bounds.max) throw new OrderError(`Enter an amount between ${naira(bounds.min)} and ${naira(bounds.max)}.`);

  const provider = paymentProvider();
  if (!provider.configured()) {
    const { PaymentNotConfiguredError } = await import("./integrations/paystack");
    throw new PaymentNotConfiguredError();
  }
  const reference = paymentReference(order.code);
  const [p] = await db
    .insert(payments)
    .values({ weddingId: wedding.id, orderId: order.id, provider: provider.name, reference, amount, currency: "NGN", status: "initialized" })
    .returning();
  try {
    const init = await provider.initialize({
      email: order.email,
      amount,
      reference,
      callbackUrl: `${appUrl()}/asoebi/order/${order.code}/return?t=${encodeURIComponent(order.accessToken)}`,
      metadata: { order_code: order.code, order_id: order.id, wedding_id: wedding.id, payment_id: p.id },
    });
    await db.update(payments).set({ authorizationUrl: init.authorizationUrl, status: "pending" }).where(eq(payments.id, p.id));
    return init.authorizationUrl;
  } catch (e) {
    await db.update(payments).set({ status: "failed", gatewayResponse: e instanceof Error ? e.message : "initialize failed" }).where(eq(payments.id, p.id));
    throw e;
  }
}

export type ApplyResult = "applied" | "already_applied" | "not_successful" | "mismatch" | "unknown_reference";

/**
 * Apply a transaction that has been VERIFIED with the gateway's server API.
 * Called from both the redirect handler and the signed webhook; whichever arrives
 * first wins and the other becomes a no-op (row lock + applied_at guard).
 */
export async function applyVerifiedTransaction(tx: VerifiedTransaction, source: "webhook" | "redirect" | "reconcile"): Promise<ApplyResult> {
  const outcome = await db.transaction(async (t) => {
    const [p] = await t.select().from(payments).where(eq(payments.reference, tx.reference)).for("update");
    if (!p) return { result: "unknown_reference" as const };
    if (p.appliedAt) return { result: "already_applied" as const, p };

    if (tx.status !== "success") {
      const status = tx.status === "reversed" ? "failed" : tx.status;
      await t.update(payments).set({ status, gatewayResponse: tx.gatewayResponse, raw: tx.raw as object, verifiedAt: new Date() }).where(eq(payments.id, p.id));
      return { result: "not_successful" as const, p };
    }
    if (tx.amount !== p.amount || tx.currency !== p.currency) {
      await t.update(payments).set({ status: "failed", gatewayResponse: `Amount/currency mismatch: got ${tx.amount} ${tx.currency}, expected ${p.amount} ${p.currency}`, raw: tx.raw as object, verifiedAt: new Date() }).where(eq(payments.id, p.id));
      await audit({ weddingId: p.weddingId, actor: "system", action: "payment.mismatch", entityType: "payment", entityId: p.id, summary: `Rejected ${tx.reference}: amount or currency did not match`, after: { tx: tx.amount, expected: p.amount } }, t);
      return { result: "mismatch" as const, p };
    }

    const now = new Date();
    await t.update(payments).set({ status: "success", channel: tx.channel, gatewayResponse: tx.gatewayResponse, paidAt: tx.paidAt ? new Date(tx.paidAt) : now, verifiedAt: now, appliedAt: now, raw: tx.raw as object }).where(eq(payments.id, p.id));
    const [o] = await t.select().from(orders).where(eq(orders.id, p.orderId)).for("update");
    const amountPaid = o.amountPaid + p.amount;
    const status = orderStatusFor(o.total, amountPaid, !!o.cancelledAt);
    const [updated] = await t.update(orders).set({ amountPaid, status }).where(eq(orders.id, o.id)).returning();
    await audit({ weddingId: p.weddingId, actor: source === "webhook" ? "webhook" : "system", action: "payment.verified", entityType: "order", entityId: o.id, summary: `${naira(p.amount)} verified for ${o.code} via ${source} (${tx.reference})`, before: { amountPaid: o.amountPaid, status: o.status }, after: { amountPaid, status } }, t);
    return { result: "applied" as const, p: { ...p, paidAt: tx.paidAt ? new Date(tx.paidAt) : now }, order: updated };
  });

  if (outcome.result === "applied" && outcome.order) await afterPaymentApplied(outcome.order.id, outcome.p.id);
  return outcome.result;
}

async function afterPaymentApplied(orderId: string, paymentId: string) {
  const o = await db.query.orders.findFirst({ where: eq(orders.id, orderId), with: { items: true, address: true } });
  const p = (await db.select().from(payments).where(eq(payments.id, paymentId)))[0];
  if (!o || !p) return;
  const [wedding] = await db.select().from(weddings).where(eq(weddings.id, o.weddingId));
  const couple = `${wedding.partnerOneName} & ${wedding.partnerTwoName}`;
  const pkg = o.items.map((i) => `${i.quantity} × ${i.packageName}`).join(", ");
  const outstanding = o.total - o.amountPaid;
  await notifyGuest(wedding, { email: o.email, phone: o.phone }, {
    type: "asoebi_receipt",
    trigger: "Payment verified",
    title: `Payment received — ${o.code}`,
    body: `${naira(p.amount)} received for ${pkg}`,
    dedupeKey: `payment:${p.id}:receipt`,
    entity: { type: "order", id: o.id },
    email: {
      eyebrow: `${couple} · Aso Ebi`,
      title: outstanding > 0 ? "We've received your part-payment" : "Your Aso Ebi is paid for",
      intro: `Thank you, ${o.fullName.split(" ")[0]}. This is your receipt.`,
      rows: [
        ["Order ID", o.code],
        ["Package", pkg],
        ["Amount paid", naira(p.amount)],
        ["Payment reference", p.reference],
        ["Date", fmtDateTime(p.paidAt)],
        ["Status", outstanding > 0 ? `Part-paid · ${naira(outstanding)} outstanding` : "Paid in full"],
      ],
      cta: { label: "View or download receipt", href: guestOrderUrl(o) },
    },
    whatsapp: { template: process.env.WHATSAPP_TEMPLATE_CONFIRMATION ?? "order_confirmation", params: [o.fullName, o.code, naira(p.amount), couple] },
  });
  await notifyCouple(wedding, {
    type: "asoebi_payment_confirmed",
    trigger: "Payment verified with Paystack",
    title: `${o.fullName} paid ${naira(p.amount)}`,
    body: `${o.code} · ${pkg}${outstanding > 0 ? ` · ${naira(outstanding)} outstanding` : " · paid in full"}`,
    href: `/app/orders/${o.id}`,
    dedupeKey: `payment:${p.id}:couple`,
    entity: { type: "order", id: o.id },
    email: { eyebrow: "Aso Ebi payment", title: `${o.fullName} paid ${naira(p.amount)}`, rows: [["Order", o.code], ["Package", pkg], ["Reference", p.reference], ["Outstanding", naira(outstanding)]], cta: { label: "Open the order", href: `/app/orders/${o.id}` } },
  });
  if (o.deliveryMethod === "delivery" && !o.address)
    await notifyCouple(wedding, { type: "missing_address", trigger: "Paid order has no delivery address", title: `Missing delivery address — ${o.code}`, body: `${o.fullName} has paid but hasn't given an address.`, href: `/app/orders/${o.id}`, dedupeKey: `order:${o.id}:missing-address` });
}

/** Re-check pending payments with the gateway (used by the cron job and the "Re-check" button). */
export async function reconcilePending(weddingId?: string) {
  const provider = paymentProvider();
  if (!provider.configured()) return { checked: 0, applied: 0 };
  const rows = await db
    .select({ reference: payments.reference })
    .from(payments)
    .where(and(inArray(payments.status, ["pending", "initialized"]), eq(payments.provider, provider.name), weddingId ? eq(payments.weddingId, weddingId) : undefined))
    .limit(100);
  let applied = 0;
  for (const r of rows) {
    try {
      const tx = await provider.verify(r.reference);
      if ((await applyVerifiedTransaction(tx, "reconcile")) === "applied") applied++;
    } catch {
      /* transient — try again next run */
    }
  }
  return { checked: rows.length, applied };
}

export async function markRefunded(reference: string, source: string) {
  return db.transaction(async (t) => {
    const [p] = await t.select().from(payments).where(eq(payments.reference, reference)).for("update");
    if (!p || p.status === "refunded") return false;
    await t.update(payments).set({ status: "refunded", refundedAt: new Date() }).where(eq(payments.id, p.id));
    if (p.appliedAt) {
      const [o] = await t.select().from(orders).where(eq(orders.id, p.orderId)).for("update");
      const amountPaid = Math.max(0, o.amountPaid - p.amount);
      await t.update(orders).set({ amountPaid, status: orderStatusFor(o.total, amountPaid, !!o.cancelledAt) }).where(eq(orders.id, o.id));
      await audit({ weddingId: p.weddingId, actor: "webhook", action: "payment.refunded", entityType: "order", entityId: o.id, summary: `${naira(p.amount)} refunded on ${o.code} (${source})`, before: { amountPaid: o.amountPaid }, after: { amountPaid } }, t);
    }
    return true;
  });
}
