"use server";

import { and, eq, gt, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { invites, memberships, users } from "@/db/schema";
import { guard, parse, zs, type ActionState } from "@/lib/action";
import { createSession, destroySession, hashPassword, verifyPassword } from "@/lib/auth";
import { sha256 } from "@/lib/ids";

const signupSchema = z.object({
  name: zs.text(80),
  email: zs.email(),
  password: z.string().min(8, "Use at least 8 characters"),
  invite: zs.optText(200),
});

export async function signup(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const p = parse(signupSchema, fd);
    if ("error" in p) return p.error;
    const { name, email, password, invite } = p.data;
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existing.length) return { error: "An account with this email already exists. Sign in instead." };
    const [u] = await db.insert(users).values({ name, email, passwordHash: await hashPassword(password) }).returning();
    if (invite) await acceptInviteFor(u.id, email, invite);
    await createSession(u.id);
    return { ok: true, redirect: invite ? "/app" : "/onboarding" };
  });
}

async function acceptInviteFor(userId: string, email: string, token: string) {
  const [inv] = await db
    .select()
    .from(invites)
    .where(and(eq(invites.tokenHash, sha256(token)), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())));
  if (!inv || inv.email.toLowerCase() !== email.toLowerCase()) return false;
  await db.insert(memberships).values({ userId, weddingId: inv.weddingId, role: inv.role }).onConflictDoNothing();
  await db.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, inv.id));
  return true;
}

const loginSchema = z.object({ email: zs.email(), password: z.string().min(1, "Required"), next: zs.optText(200), invite: zs.optText(200) });

export async function login(_: ActionState, fd: FormData): Promise<ActionState> {
  return guard(async () => {
    const p = parse(loginSchema, fd);
    if ("error" in p) return p.error;
    const [u] = await db.select().from(users).where(eq(users.email, p.data.email));
    // Same message whether the email exists or not
    if (!u || !(await verifyPassword(p.data.password, u.passwordHash))) return { error: "That email and password don't match." };
    if (p.data.invite) await acceptInviteFor(u.id, u.email, p.data.invite);
    await createSession(u.id);
    const next = p.data.next?.startsWith("/app") ? p.data.next : "/app";
    return { ok: true, redirect: next };
  });
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
