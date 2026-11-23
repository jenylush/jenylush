"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/db";
import { deliveryAddresses, orders, weddings } from "@/db/schema";
import { guard, parse, zs, type ActionState } from "@/lib/action";
import { createOrder, guestOrderUrl, OrderError, orderForGuest, reportTransfer } from "@/lib/asoebi";
import { audit } from "@/lib/audit";
import { notifyCouple } from "@/lib/notify";
import { addressSchema } from "@/lib/schemas";
import { rateLimit } from "@/lib/rate-limit";

const orderSchema = z.object({
  slug: z.string().min(4).max(80),
  guestToken: zs.optText(64),
  fullName: zs.text(120),
  phone: zs.phone(),
  email: zs.optEmail(),
  deliveryMethod: z.enum(["delivery", "pickup"]),
  confirm: z.literal("yes", { errorMap: () => ({ message: "Please confirm your details are correct" }) }),
});

async function ip() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "local";
}

export async function placeOrder(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    if (!rateLimit(`order:${await ip()}`, 10, 10 * 60_000)) return { error: "Too many orders from this connection. Please wait a few minutes." };
    const p = parse(orderSchema, fd);
    if ("error" in p) return p.error;
    const items: Array<{ packageId: string; quantity: number }> = [];
    for (const [k, v] of fd.entries()) {
      const m = k.match(/^qty_([0-9a-f-]{36})$/);
      if (m) items.push({ packageId: m[1], quantity: Math.max(0, Math.min(100, parseInt(String(v), 10) || 0)) });
    }
    let address;
    if (p.data.deliveryMethod === "delivery") {
      const a = parse(addressSchema, fd);
      if ("error" in a) return { ...a.error, error: "A complete delivery address is required for home delivery." };
      address = { ...a.data, landmark: a.data.landmark ?? undefined, instructions: a.data.instructions ?? undefined };
    }
    try {
      const o = await createOrder(p.data.slug, { ...p.data, items, address, guestToken: p.data.guestToken });
      return { ok: true, redirect: guestOrderUrl(o) };
    } catch (e) {
      if (e instanceof OrderError) return { error: e.message };
      throw e;
    }
  });
}

export async function reportSent(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const code = String(fd.get("code") ?? "");
    const token = String(fd.get("t") ?? "");
    if (!rateLimit(`sent:${code}`, 10, 10 * 60_000)) return { error: "Too many attempts. Please wait a few minutes." };
    const p = parse(z.object({ senderName: zs.optText(120), reference: zs.optText(80) }), fd);
    if ("error" in p) return p.error;
    try {
      await reportTransfer(code, token, p.data);
      return { ok: true, message: "Thank you! You've been recorded as paid. The couple will confirm once they see the money." };
    } catch (e) {
      if (e instanceof OrderError) return { error: e.message };
      throw e;
    }
  });
}

export async function guestUpdateAddress(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const code = String(fd.get("code") ?? "");
    const token = String(fd.get("t") ?? "");
    const found = await orderForGuest(code, token);
    if (!found) return { error: "Order not found." };
    const { order, wedding } = found;
    if (order.delivery?.status === "dispatched" || order.delivery?.status === "delivered") return { error: "This order has already been dispatched. Contact the couple to change the address." };
    const p = parse(addressSchema, fd);
    if ("error" in p) return p.error;
    const v = { ...p.data, landmark: p.data.landmark ?? null, instructions: p.data.instructions ?? null };
    await db.insert(deliveryAddresses).values({ orderId: order.id, ...v, source: "guest" }).onConflictDoUpdate({ target: deliveryAddresses.orderId, set: { ...v, source: "guest" } });
    if (order.deliveryMethod !== "delivery") await db.update(orders).set({ deliveryMethod: "delivery" }).where(eq(orders.id, order.id));
    await audit({ weddingId: wedding.id, actor: "guest", action: "address.updated", entityType: "order", entityId: order.id, summary: `${order.fullName} updated the delivery address on ${order.code}`, before: order.address, after: v });
    const [w] = await db.select().from(weddings).where(eq(weddings.id, wedding.id));
    await notifyCouple(w, { type: "address_updated", trigger: "Guest updated delivery address", title: `${order.fullName} changed their delivery address`, body: `${order.code} · ${v.area}, ${v.city}, ${v.state}`, href: `/app/orders/${order.id}` });
    return { ok: true, message: "Thank you — your delivery address has been updated." };
  });
}

