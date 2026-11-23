import { NextResponse } from "next/server";
import { runReminders } from "@/lib/reminders";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Called daily by Vercel Cron (see vercel.json) or any scheduler with the CRON_SECRET bearer token. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const at = new URL(req.url).searchParams.get("at"); // optional ISO date for testing/backfill
  const report = await runReminders(at ? new Date(`${at}T09:00:00+01:00`) : new Date());
  return NextResponse.json({ ok: true, ...report });
}
