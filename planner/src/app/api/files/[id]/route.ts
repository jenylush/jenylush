import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { files, memberships } from "@/db/schema";
import { getUser } from "@/lib/auth";
import { readStored } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Public files (fabric photos) are served to anyone; private files only to members of that wedding. */
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const [f] = await db.select().from(files).where(eq(files.id, id));
  if (!f) return new Response("Not found", { status: 404 });
  if (f.visibility === "private") {
    const user = await getUser();
    if (!user) return new Response("Not found", { status: 404 });
    const m = await db.select().from(memberships).where(and(eq(memberships.userId, user.id), eq(memberships.weddingId, f.weddingId)));
    if (!m.length) return new Response("Not found", { status: 404 });
  }
  try {
    const bytes = await readStored(f.storageKey);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": f.mimeType,
        "Content-Disposition": `${f.mimeType === "application/pdf" ? "inline" : "inline"}; filename="${f.filename.replace(/"/g, "")}"`,
        "Cache-Control": f.visibility === "public" ? "public, max-age=86400" : "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
