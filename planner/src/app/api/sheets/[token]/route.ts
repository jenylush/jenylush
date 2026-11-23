import { eq } from "drizzle-orm";
import { db } from "@/db";
import { weddings } from "@/db/schema";
import { budgetCsv } from "@/lib/exports";

export const dynamic = "force-dynamic";

/**
 * Read-only live CSV for Google Sheets: =IMPORTDATA("https://…/api/sheets/<token>")
 * The token is a 192-bit secret the couple can turn off or rotate at any time.
 */
export async function GET(_: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  if (!token || token.length < 20) return new Response("Not found", { status: 404 });
  const [w] = await db.select().from(weddings).where(eq(weddings.sheetsFeedToken, token));
  if (!w) return new Response("Not found", { status: 404 });
  return new Response(await budgetCsv(w), { headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}
