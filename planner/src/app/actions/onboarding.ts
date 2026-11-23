"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { categories, events, memberships, weddings } from "@/db/schema";
import { guard, parse, zs, type ActionState } from "@/lib/action";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { DEFAULT_CATEGORIES } from "@/lib/defaults";

const schema = z.object({
  partnerOneName: zs.text(80),
  partnerTwoName: zs.text(80),
  partnerOneEmail: zs.email(),
  partnerTwoEmail: zs.optEmail(),
  partnerOnePhone: zs.phone(),
  partnerTwoPhone: zs.optPhone(),
  weddingDate: zs.date(),
  traditionalDate: zs.optDate(),
  whiteWeddingDate: zs.optDate(),
  venue: zs.optText(200),
  city: zs.optText(80),
  estimatedGuests: z.coerce.number().int().min(0).max(100_000).default(0),
  totalBudget: zs.money(),
  currency: z.enum(["NGN"]).default("NGN"),
  events: z.union([z.string(), z.array(z.string())]).optional(),
});

const EVENT_PRESETS: Record<string, { name: string; type: "introduction" | "traditional" | "white" | "reception" | "after_party" }> = {
  introduction: { name: "Introduction", type: "introduction" },
  traditional: { name: "Traditional wedding", type: "traditional" },
  white: { name: "White wedding", type: "white" },
  reception: { name: "Reception", type: "reception" },
  after_party: { name: "After-party", type: "after_party" },
};

export async function completeOnboarding(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const user = await requireUser();
    const p = parse(schema, fd);
    if ("error" in p) return p.error;
    const d = p.data;
    if (d.totalBudget <= 0) return { error: "Enter your overall wedding budget.", fieldErrors: { totalBudget: "Required" } };
    const chosen = ([] as string[]).concat(d.events ?? []).filter((k) => k in EVENT_PRESETS);

    const existing = await db.select().from(memberships).where(eq(memberships.userId, user.id));
    await db.transaction(async (tx) => {
      const values = {
        partnerOneName: d.partnerOneName,
        partnerTwoName: d.partnerTwoName,
        partnerOneEmail: d.partnerOneEmail,
        partnerTwoEmail: d.partnerTwoEmail ?? null,
        partnerOnePhone: d.partnerOnePhone,
        partnerTwoPhone: d.partnerTwoPhone ?? null,
        weddingDate: d.weddingDate,
        traditionalDate: d.traditionalDate ?? null,
        whiteWeddingDate: d.whiteWeddingDate ?? null,
        venue: d.venue ?? null,
        city: d.city ?? null,
        estimatedGuests: d.estimatedGuests,
        totalBudget: d.totalBudget,
        currency: d.currency,
        onboardedAt: new Date(),
      };
      let weddingId = existing[0]?.weddingId;
      if (weddingId) await tx.update(weddings).set(values).where(eq(weddings.id, weddingId));
      else {
        const [w] = await tx.insert(weddings).values(values).returning();
        weddingId = w.id;
        await tx.insert(memberships).values({ userId: user.id, weddingId, role: "owner" });
        await tx.insert(categories).values(DEFAULT_CATEGORIES.map((c, i) => ({ weddingId: weddingId!, name: c.name, color: c.color, sortOrder: i, allocated: Math.round((d.totalBudget * c.share) / 100) })));
      }
      const dateFor = (k: string) => (k === "traditional" ? d.traditionalDate : k === "white" ? d.whiteWeddingDate : k === "reception" ? (d.whiteWeddingDate ?? d.weddingDate) : undefined) ?? null;
      if (chosen.length && !existing.length)
        await tx.insert(events).values(chosen.map((k, i) => ({ weddingId: weddingId!, name: EVENT_PRESETS[k].name, type: EVENT_PRESETS[k].type, date: dateFor(k), venue: d.venue ?? null, sortOrder: i })));
      await audit({ weddingId, userId: user.id, action: "wedding.onboarded", entityType: "wedding", entityId: weddingId, summary: `Wedding set up with a budget of ₦${(d.totalBudget / 100).toLocaleString("en-NG")}` }, tx);
    });
    return { ok: true, redirect: "/app" };
  });
}
