import { NextResponse } from "next/server";
import { applyVerifiedTransaction, orderForGuest } from "@/lib/asoebi";
import { appUrl } from "@/lib/config";
import { paymentProvider } from "@/lib/integrations/paystack";

export const dynamic = "force-dynamic";

/**
 * Paystack redirects the guest here after checkout. Arriving here proves nothing — the
 * reference is verified server-to-server with Paystack before anything is marked paid.
 */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  const u = new URL(req.url);
  const t = u.searchParams.get("t") ?? "";
  const reference = u.searchParams.get("reference") ?? u.searchParams.get("trxref") ?? "";
  const found = await orderForGuest(code, t);
  const back = (r: string) => NextResponse.redirect(`${appUrl()}/asoebi/order/${code}?t=${encodeURIComponent(t)}&r=${r}`, 303);
  if (!found) return NextResponse.redirect(`${appUrl()}/`, 303);
  // The reference must belong to this order.
  if (!reference || !found.order.payments.some((p) => p.reference === reference)) return back("unknown");
  try {
    const tx = await paymentProvider().verify(reference);
    const result = await applyVerifiedTransaction(tx, "redirect");
    if (result === "applied" || result === "already_applied") return back("paid");
    return back(tx.status === "pending" ? "pending" : "failed");
  } catch {
    return back("pending");
  }
}
