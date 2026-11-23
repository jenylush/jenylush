import "server-only";
import bcrypt from "bcryptjs";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { memberships, sessions, users, weddings } from "@/db/schema";
import { secretToken, sha256 } from "./ids";

export const SESSION_COOKIE = "ol_session";
const WEDDING_COOKIE = "ol_wedding";
const SESSION_DAYS = 30;

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export async function createSession(userId: string) {
  const token = secretToken(32);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ tokenHash: sha256(token), userId, expiresAt });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  jar.delete(SESSION_COOKIE);
  jar.delete(WEDDING_COOKIE);
}

export const getUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name, phone: users.phone })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row ?? null;
});

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

export type Role = "owner" | "partner" | "planner" | "viewer";
export type Workspace = Awaited<ReturnType<typeof loadWorkspace>>;

const loadWorkspace = cache(async (userId: string) => {
  const preferred = (await cookies()).get(WEDDING_COOKIE)?.value;
  const rows = await db
    .select({ wedding: weddings, role: memberships.role })
    .from(memberships)
    .innerJoin(weddings, eq(weddings.id, memberships.weddingId))
    .where(eq(memberships.userId, userId));
  const row = rows.find((r) => r.wedding.id === preferred) ?? rows[0];
  return row ? { wedding: row.wedding, role: row.role as Role } : null;
});

/**
 * The tenant boundary. Every dashboard page and server action calls this, and every
 * query then filters on `wedding.id`. A user can only ever resolve a wedding they are
 * a member of, so one couple's data is unreachable from another couple's session.
 */
export async function requireWorkspace(opts: { write?: boolean; allowUnonboarded?: boolean } = {}) {
  const user = await requireUser();
  const ws = await loadWorkspace(user.id);
  if (!ws) redirect("/onboarding");
  if (!ws.wedding.onboardedAt && !opts.allowUnonboarded) redirect("/onboarding");
  if (opts.write && ws.role === "viewer") throw new Error("You have view-only access to this wedding.");
  return { user, wedding: ws.wedding, role: ws.role, weddingId: ws.wedding.id };
}

export const canWrite = (role: Role) => role !== "viewer";
export const canManageTeam = (role: Role) => role === "owner" || role === "partner";
