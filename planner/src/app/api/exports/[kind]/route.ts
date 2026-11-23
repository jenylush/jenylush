import { requireWorkspace } from "@/lib/auth";
import { budgetCsv, budgetDocx, budgetXlsx, registerXlsx, reportPdf, type RegisterFilter, type ReportKind } from "@/lib/exports";
import { slugify } from "@/lib/ids";

export const dynamic = "force-dynamic";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function file(body: Buffer | string, type: string, name: string) {
  return new Response(typeof body === "string" ? body : new Uint8Array(body), {
    headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}

export async function GET(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  const { wedding } = await requireWorkspace();
  const q = new URL(req.url).searchParams;
  const base = slugify(`${wedding.partnerOneName}-${wedding.partnerTwoName}`);
  const day = new Date().toISOString().slice(0, 10);

  if (kind === "register") {
    const filter = (["all", "paid", "awaiting", "delivery"].includes(q.get("filter") ?? "") ? q.get("filter") : "all") as RegisterFilter;
    return file(await registerXlsx(wedding, filter), XLSX, `${base}-asoebi-${filter === "delivery" ? "delivery-addresses" : filter}-${day}.xlsx`);
  }
  if (kind === "budget") {
    const fmt = q.get("format") ?? "xlsx";
    if (fmt === "csv") return file(await budgetCsv(wedding), "text/csv; charset=utf-8", `${base}-budget-${day}.csv`);
    if (fmt === "docx") return file(await budgetDocx(wedding), DOCX, `${base}-budget-${day}.docx`);
    return file(await budgetXlsx(wedding), XLSX, `${base}-budget-${day}.xlsx`);
  }
  if (kind === "report") {
    const types: ReportKind[] = ["overall", "expenses", "vendors", "outstanding", "completed", "monthly", "budget-vs-actual"];
    const t = (types.includes(q.get("type") as ReportKind) ? q.get("type") : "overall") as ReportKind;
    return file(await reportPdf(wedding, t), "application/pdf", `${base}-${t}-report-${day}.pdf`);
  }
  return new Response("Unknown export", { status: 404 });
}
