import { orderForGuest } from "@/lib/asoebi";
import { receiptPdf } from "@/lib/exports";

export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const t = new URL(req.url).searchParams.get("t") ?? "";
  const found = await orderForGuest(code, t);
  if (!found || found.order.amountPaid === 0) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(await receiptPdf(found)), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="receipt-${code}.pdf"`, "Cache-Control": "no-store" },
  });
}
