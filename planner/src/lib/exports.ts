import "server-only";
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, weddings } from "@/db/schema";
import { DELIVERY_LABEL, ORDER_LABEL, guestStatus } from "./asoebi";
import { byCategory, loadExpenses, loadLookups, scheduleFrom } from "./data";
import { fmtDate, fmtDateTime, todayISO } from "./dates";
import { EXPENSE_STATUS_LABEL, summarise } from "./finance";
import { naira } from "./money";
import { displayPhone } from "./phone";

type Wedding = typeof weddings.$inferSelect;

/* ─── Data assembly ─────────────────────────────────────────────────── */

export type RegisterFilter = "all" | "paid" | "awaiting" | "delivery";

export async function registerRows(weddingId: string, filter: RegisterFilter = "all", campaignId?: string) {
  const list = await db.query.orders.findMany({
    where: and(eq(orders.weddingId, weddingId), campaignId ? eq(orders.campaignId, campaignId) : undefined),
    with: { items: true, address: true, delivery: true, payments: true, campaign: true, guest: true },
    orderBy: [desc(orders.createdAt)],
  });
  return list
    .filter((o) =>
      filter === "paid" ? o.status === "paid" : filter === "awaiting" ? o.status === "pending_payment" || o.status === "partially_paid" : filter === "delivery" ? o.deliveryMethod === "delivery" && o.status !== "cancelled" : true,
    )
    .map((o) => {
      const lastPay = o.payments.filter((p) => p.status === "success").sort((a, b) => +(b.paidAt ?? 0) - +(a.paidAt ?? 0))[0];
      const a = o.address;
      return {
        id: o.id,
        guestName: o.fullName,
        phone: displayPhone(o.phone),
        email: o.email,
        campaign: o.campaign.name,
        package: o.items.map((i) => i.packageName).join(", "),
        quantity: o.items.reduce((s, i) => s + i.quantity, 0),
        amount: o.total,
        amountPaid: o.amountPaid,
        balance: o.total - o.amountPaid,
        paymentStatus: ORDER_LABEL[o.status],
        guestStatus: guestStatus(o.guest ?? { linkSentAt: null }, o),
        deliveryMethod: o.deliveryMethod === "delivery" ? "Home delivery" : "Pickup",
        deliveryStatus: DELIVERY_LABEL[o.delivery?.status ?? "awaiting"],
        street: a?.street ?? "",
        area: a?.area ?? "",
        city: a?.city ?? "",
        state: a?.state ?? "",
        landmark: a?.landmark ?? "",
        instructions: a?.instructions ?? "",
        deliveryAddress: a ? [a.street, a.area, a.city, a.state].filter(Boolean).join(", ") : o.deliveryMethod === "pickup" ? "Pickup" : "MISSING",
        rider: o.delivery?.riderName ?? "",
        riderPhone: o.delivery?.riderPhone ? displayPhone(o.delivery.riderPhone) : "",
        trackingRef: o.delivery?.trackingRef ?? "",
        orderId: o.code,
        paymentRef: lastPay?.reference ?? "",
        paidAt: lastPay?.paidAt ? fmtDateTime(lastPay.paidAt) : "",
        orderedAt: fmtDateTime(o.createdAt),
      };
    });
}

export async function budgetData(w: Wedding) {
  const today = todayISO();
  const [list, lookups] = await Promise.all([loadExpenses(w.id, today), loadLookups(w.id)]);
  const summary = summarise(w.totalBudget, list.map((e) => e.state));
  return { list, lookups, summary, cats: byCategory(list, lookups.categories), schedule: scheduleFrom(list, today), today };
}

/* ─── Excel ─────────────────────────────────────────────────────────── */

const INK = "FF2A2725";
const IVORY = "FFF6F1E8";
const GOLD = "FFB89B6A";
const NAIRA_FMT = '"₦"#,##0;[Red]-"₦"#,##0';

type Col = { header: string; key: string; width: number; money?: boolean };

function styledSheet(wb: ExcelJS.Workbook, name: string, title: string, subtitle: string, cols: Col[], rows: Record<string, unknown>[], totals?: string[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 4 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1 } });
  ws.columns = cols.map((c) => ({ key: c.key, width: c.width }));
  ws.mergeCells(1, 1, 1, cols.length);
  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = { name: "Georgia", size: 16, bold: true, color: { argb: INK } };
  ws.mergeCells(2, 1, 2, cols.length);
  ws.getCell(2, 1).value = subtitle;
  ws.getCell(2, 1).font = { size: 10, italic: true, color: { argb: "FF7A7268" } };
  ws.getRow(1).height = 26;
  const head = ws.getRow(4);
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: IVORY }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INK } };
    cell.alignment = { vertical: "middle", horizontal: c.money ? "right" : "left", wrapText: true };
    cell.border = { bottom: { style: "medium", color: { argb: GOLD } } };
  });
  head.height = 22;
  rows.forEach((r, idx) => {
    const row = ws.addRow(cols.map((c) => (c.money ? Number(r[c.key] ?? 0) / 100 : (r[c.key] ?? ""))));
    row.eachCell((cell, i) => {
      const c = cols[i - 1];
      if (c?.money) cell.numFmt = NAIRA_FMT;
      cell.alignment = { vertical: "top", wrapText: true, horizontal: c?.money ? "right" : "left" };
      cell.font = { size: 10 };
      if (idx % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFBF8F2" } };
      cell.border = { bottom: { style: "hair", color: { argb: "FFE6DCCB" } } };
    });
  });
  if (totals?.length && rows.length) {
    const first = 5, last = 4 + rows.length;
    const tr = ws.addRow(cols.map((c, i) => (i === 0 ? "Total" : totals.includes(c.key) ? { formula: `SUM(${ws.getColumn(i + 1).letter}${first}:${ws.getColumn(i + 1).letter}${last})` } : "")));
    tr.eachCell((cell, i) => {
      cell.font = { bold: true, size: 10 };
      cell.border = { top: { style: "medium", color: { argb: INK } } };
      if (cols[i - 1]?.money) cell.numFmt = NAIRA_FMT;
    });
  }
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols.length } };
  return ws;
}

const coupleName = (w: Wedding) => `${w.partnerOneName} & ${w.partnerTwoName}`;
const stamp = () => `Exported ${fmtDateTime(new Date())} · Owambe Ledger`;

export async function registerXlsx(w: Wedding, filter: RegisterFilter) {
  const rows = await registerRows(w.id, filter);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Owambe Ledger";
  const label = { all: "Full register", paid: "Paid guests", awaiting: "Guests awaiting payment", delivery: "Delivery addresses" }[filter];
  if (filter === "delivery") {
    styledSheet(wb, "Deliveries", `${coupleName(w)} — Aso Ebi delivery list`, stamp(), [
      { header: "Order ID", key: "orderId", width: 12 },
      { header: "Guest Name", key: "guestName", width: 24 },
      { header: "Phone", key: "phone", width: 16 },
      { header: "Package", key: "package", width: 22 },
      { header: "Qty", key: "quantity", width: 6 },
      { header: "Street address", key: "street", width: 32 },
      { header: "Area", key: "area", width: 16 },
      { header: "City", key: "city", width: 14 },
      { header: "State", key: "state", width: 14 },
      { header: "Closest landmark", key: "landmark", width: 22 },
      { header: "Instructions", key: "instructions", width: 26 },
      { header: "Payment", key: "paymentStatus", width: 14 },
      { header: "Delivery status", key: "deliveryStatus", width: 16 },
      { header: "Rider", key: "rider", width: 16 },
      { header: "Rider phone", key: "riderPhone", width: 15 },
      { header: "Tracking ref", key: "trackingRef", width: 14 },
    ], rows.sort((a, b) => (a.state + a.city + a.area).localeCompare(b.state + b.city + b.area)));
  } else {
    styledSheet(wb, "Register", `${coupleName(w)} — Aso Ebi register (${label})`, stamp(), [
      { header: "Guest Name", key: "guestName", width: 24 },
      { header: "Phone", key: "phone", width: 16 },
      { header: "Email", key: "email", width: 26 },
      { header: "Package", key: "package", width: 22 },
      { header: "Quantity", key: "quantity", width: 9 },
      { header: "Amount", key: "amount", width: 13, money: true },
      { header: "Amount Paid", key: "amountPaid", width: 13, money: true },
      { header: "Balance", key: "balance", width: 12, money: true },
      { header: "Payment Status", key: "paymentStatus", width: 15 },
      { header: "Delivery", key: "deliveryMethod", width: 13 },
      { header: "Delivery Address", key: "deliveryAddress", width: 40 },
      { header: "Closest landmark", key: "landmark", width: 20 },
      { header: "Delivery Status", key: "deliveryStatus", width: 16 },
      { header: "Order ID", key: "orderId", width: 12 },
      { header: "Payment Ref", key: "paymentRef", width: 20 },
      { header: "Paid At", key: "paidAt", width: 18 },
    ], rows, ["quantity", "amount", "amountPaid", "balance"]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function budgetXlsx(w: Wedding) {
  const { list, summary, cats, schedule } = await budgetData(w);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Owambe Ledger";

  const s = wb.addWorksheet("Summary");
  s.columns = [{ width: 34 }, { width: 20 }];
  s.getCell("A1").value = `${coupleName(w)} — Wedding budget`;
  s.getCell("A1").font = { name: "Georgia", size: 16, bold: true };
  s.getCell("A2").value = stamp();
  s.getCell("A2").font = { italic: true, size: 10, color: { argb: "FF7A7268" } };
  const lines: Array<[string, number | string, boolean?]> = [
    ["Total budget", summary.budget, true],
    ["Committed to expenses", summary.committed, true],
    ["Amount spent (paid)", summary.spent, true],
    ["Outstanding payments", summary.outstanding, true],
    ["Remaining (uncommitted) budget", summary.remaining, true],
    ["Budget utilised", `${summary.utilisedPct}%`],
    ["Vendors", new Set(list.map((e) => e.vendorId).filter(Boolean)).size],
    ["Pending payments", summary.pendingCount],
    ["Overdue payments", summary.overdueCount],
  ];
  lines.forEach(([k, v, m], i) => {
    const r = s.getRow(4 + i);
    r.getCell(1).value = k;
    r.getCell(2).value = m ? Number(v) / 100 : v;
    if (m) r.getCell(2).numFmt = NAIRA_FMT;
    r.getCell(1).font = { size: 11 };
    r.getCell(2).font = { bold: true, size: 11 };
    r.getCell(2).alignment = { horizontal: "right" };
    r.eachCell((c) => (c.border = { bottom: { style: "hair", color: { argb: "FFE6DCCB" } } }));
  });

  styledSheet(wb, "Budget vs actual", "Budget versus actual by category", stamp(), [
    { header: "Category", key: "name", width: 26 },
    { header: "Allocated", key: "allocated", width: 15, money: true },
    { header: "Committed", key: "committed", width: 15, money: true },
    { header: "Paid", key: "paid", width: 15, money: true },
    { header: "Outstanding", key: "outstanding", width: 15, money: true },
    { header: "Variance (allocated − committed)", key: "variance", width: 20, money: true },
    { header: "Expenses", key: "count", width: 10 },
  ], cats.filter((c) => c.count || c.allocated).map((c) => ({ ...c, variance: c.allocated - c.committed })), ["allocated", "committed", "paid", "outstanding", "variance", "count"]);

  styledSheet(wb, "Expenses", "Expense register", stamp(), [
    { header: "Expense", key: "name", width: 28 },
    { header: "Category", key: "category", width: 18 },
    { header: "Event", key: "event", width: 18 },
    { header: "Vendor", key: "vendor", width: 22 },
    { header: "Estimated", key: "estimated", width: 14, money: true },
    { header: "Actual", key: "actual", width: 14, money: true },
    { header: "Paid", key: "paid", width: 14, money: true },
    { header: "Outstanding", key: "outstanding", width: 14, money: true },
    { header: "Status", key: "status", width: 14 },
    { header: "Next due", key: "nextDue", width: 14 },
    { header: "Notes", key: "notes", width: 30 },
  ], list.map((e) => ({
    name: e.name,
    category: e.category?.name ?? "",
    event: e.event?.name ?? "",
    vendor: e.vendor?.name ?? "",
    estimated: e.estimatedCost,
    actual: e.actualCost ?? 0,
    paid: e.state.paid,
    outstanding: e.state.outstanding,
    status: EXPENSE_STATUS_LABEL[e.state.status],
    nextDue: e.state.nextDue ? fmtDate(e.state.nextDue.date) : "",
    notes: e.notes ?? "",
  })), ["estimated", "actual", "paid", "outstanding"]);

  styledSheet(wb, "Payment schedule", "Payment schedule", stamp(), [
    { header: "Due date", key: "date", width: 14 },
    { header: "Expense", key: "expenseName", width: 28 },
    { header: "Instalment", key: "label", width: 18 },
    { header: "Vendor", key: "vendorName", width: 22 },
    { header: "Amount", key: "amount", width: 14, money: true },
    { header: "Status", key: "status", width: 12 },
  ], schedule.map((i) => ({ ...i, date: fmtDate(i.date), status: i.status[0].toUpperCase() + i.status.slice(1) })));

  const payments = list.flatMap((e) => e.payments.map((p) => ({ date: fmtDate(p.paidOn), month: p.paidOn.slice(0, 7), expense: e.name, vendor: e.vendor?.name ?? "", amount: p.amount, method: p.method, reference: p.reference ?? "" }))).sort((a, b) => a.date.localeCompare(b.date));
  styledSheet(wb, "Completed payments", "Completed payments", stamp(), [
    { header: "Date", key: "date", width: 14 },
    { header: "Expense", key: "expense", width: 28 },
    { header: "Vendor", key: "vendor", width: 22 },
    { header: "Amount", key: "amount", width: 14, money: true },
    { header: "Method", key: "method", width: 12 },
    { header: "Reference", key: "reference", width: 20 },
  ], payments, ["amount"]);

  const months = new Map<string, number>();
  for (const p of payments) months.set(p.month, (months.get(p.month) ?? 0) + p.amount);
  styledSheet(wb, "Monthly spending", "Monthly spending", stamp(), [
    { header: "Month", key: "month", width: 16 },
    { header: "Amount paid", key: "amount", width: 16, money: true },
  ], [...months.entries()].sort().map(([m, amount]) => ({ month: new Date(`${m}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" }), amount })), ["amount"]);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** CSV for Google Sheets =IMPORTDATA() — values are plain numbers in Naira so formulas work. */
export async function budgetCsv(w: Wedding) {
  const { list } = await budgetData(w);
  const q = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["Expense", "Category", "Event", "Vendor", "Estimated (NGN)", "Actual (NGN)", "Paid (NGN)", "Outstanding (NGN)", "Status", "Next due"];
  const body = list.map((e) =>
    [e.name, e.category?.name, e.event?.name, e.vendor?.name, e.estimatedCost / 100, (e.actualCost ?? 0) / 100, e.state.paid / 100, e.state.outstanding / 100, EXPENSE_STATUS_LABEL[e.state.status], e.state.nextDue?.date ?? ""].map(q).join(","),
  );
  return [head.join(","), ...body].join("\n");
}

/* ─── Word / Google Docs (.docx) ────────────────────────────────────── */

export async function budgetDocx(w: Wedding) {
  const { list, summary, cats } = await budgetData(w);
  const cell = (text: string, opts: { bold?: boolean; right?: boolean; shade?: string } = {}) =>
    new TableCell({
      shading: opts.shade ? { fill: opts.shade } : undefined,
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: [new Paragraph({ alignment: opts.right ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text, bold: opts.bold, size: 18, color: opts.shade === "2A2725" ? "F6F1E8" : "2A2725" })] })],
    });
  const table = (head: string[], rows: string[][], rightFrom = 1) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, bottom: { style: BorderStyle.SINGLE, size: 4, color: "B89B6A" }, left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "E6DCCB" }, insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } },
      rows: [new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, { bold: true, shade: "2A2725", right: i >= rightFrom })) }), ...rows.map((r) => new TableRow({ children: r.map((v, i) => cell(v, { right: i >= rightFrom })) }))],
    });
  const doc = new Document({
    creator: "Owambe Ledger",
    title: `${coupleName(w)} — Wedding budget`,
    styles: { default: { document: { run: { font: "Georgia" } } } },
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: `${coupleName(w)}`, color: "2A2725" })] }),
          new Paragraph({ children: [new TextRun({ text: `Wedding budget · ${w.weddingDate ? fmtDate(w.weddingDate, "long") : ""} · ${stamp()}`, italics: true, color: "7A7268", size: 18 })] }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 300 }, children: [new TextRun("Summary")] }),
          table(["", "Amount"], [["Total budget", naira(summary.budget)], ["Committed", naira(summary.committed)], ["Spent", naira(summary.spent)], ["Outstanding", naira(summary.outstanding)], ["Remaining", naira(summary.remaining)], ["Utilised", `${summary.utilisedPct}%`]]),
          new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 300 }, children: [new TextRun("Budget versus actual")] }),
          table(["Category", "Allocated", "Committed", "Paid", "Outstanding"], cats.filter((c) => c.count || c.allocated).map((c) => [c.name, naira(c.allocated), naira(c.committed), naira(c.paid), naira(c.outstanding)])),
          new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 300 }, children: [new TextRun("Expenses")] }),
          table(["Expense", "Vendor", "Total", "Paid", "Outstanding", "Status"], list.map((e) => [e.name, e.vendor?.name ?? "—", naira(e.state.total), naira(e.state.paid), naira(e.state.outstanding), EXPENSE_STATUS_LABEL[e.state.status]]), 2),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

/* ─── PDF ───────────────────────────────────────────────────────────── */

class PdfWriter {
  doc!: PDFDocument;
  page!: PDFPage;
  font!: PDFFont;
  bold!: PDFFont;
  y = 0;
  readonly W = 595.28;
  readonly H = 841.89;
  readonly M = 48;

  static async create() {
    const w = new PdfWriter();
    w.doc = await PDFDocument.create();
    w.doc.registerFontkit(fontkit);
    const dir = path.join(process.cwd(), "assets", "fonts");
    w.font = await w.doc.embedFont(fs.readFileSync(path.join(dir, "DejaVuSans.ttf")), { subset: true });
    w.bold = await w.doc.embedFont(fs.readFileSync(path.join(dir, "DejaVuSans-Bold.ttf")), { subset: true });
    w.newPage();
    return w;
  }
  newPage() {
    this.page = this.doc.addPage([this.W, this.H]);
    this.page.drawRectangle({ x: 0, y: 0, width: this.W, height: this.H, color: rgb(1, 0.992, 0.976) });
    this.page.drawRectangle({ x: 0, y: this.H - 6, width: this.W, height: 6, color: rgb(0.72, 0.61, 0.42) });
    this.y = this.H - this.M;
  }
  ensure(h: number) {
    if (this.y - h < this.M) this.newPage();
  }
  text(t: string, opts: { size?: number; bold?: boolean; x?: number; color?: [number, number, number]; right?: number } = {}) {
    const size = opts.size ?? 10;
    const f = opts.bold ? this.bold : this.font;
    const x = opts.right != null ? opts.right - f.widthOfTextAtSize(t, size) : (opts.x ?? this.M);
    this.page.drawText(t, { x, y: this.y, size, font: f, color: rgb(...(opts.color ?? [0.165, 0.153, 0.145])) });
  }
  line(gap = 14) {
    this.y -= gap;
  }
  rule(color: [number, number, number] = [0.9, 0.86, 0.8]) {
    this.page.drawLine({ start: { x: this.M, y: this.y }, end: { x: this.W - this.M, y: this.y }, thickness: 0.6, color: rgb(...color) });
  }
  fit(t: string, width: number, size = 9) {
    let s = t;
    while (s.length > 1 && this.font.widthOfTextAtSize(s, size) > width) s = s.slice(0, -2) + "…";
    return s;
  }
  table(cols: Array<{ label: string; width: number; right?: boolean }>, rows: string[][]) {
    const draw = (cells: string[], header: boolean) => {
      this.ensure(18);
      let x = this.M;
      cells.forEach((c, i) => {
        const col = cols[i];
        const s = this.fit(c, col.width - 6, header ? 8 : 9);
        this.text(s, { size: header ? 8 : 9, bold: header, x: col.right ? undefined : x, right: col.right ? x + col.width - 4 : undefined, color: header ? [0.48, 0.45, 0.41] : undefined });
        x += col.width;
      });
      this.y -= 6;
      this.rule(header ? [0.72, 0.61, 0.42] : undefined);
      this.y -= 11;
    };
    draw(cols.map((c) => c.label.toUpperCase()), true);
    rows.forEach((r) => draw(r, false));
  }
  heading(t: string, sub?: string) {
    this.ensure(60);
    this.text(t, { size: 18, bold: true });
    this.line(16);
    if (sub) {
      this.text(sub, { size: 9, color: [0.48, 0.45, 0.41] });
      this.line(22);
    }
  }
  section(t: string) {
    this.ensure(40);
    this.line(8);
    this.text(t.toUpperCase(), { size: 8, bold: true, color: [0.66, 0.55, 0.36] });
    this.line(16);
  }
}

export type ReportKind = "overall" | "expenses" | "vendors" | "outstanding" | "completed" | "monthly" | "budget-vs-actual";

export async function reportPdf(w: Wedding, kind: ReportKind) {
  const { list, summary, cats, schedule, today } = await budgetData(w);
  const p = await PdfWriter.create();
  const titles: Record<ReportKind, string> = {
    overall: "Overall budget report",
    expenses: "Expense breakdown",
    vendors: "Vendor payment report",
    outstanding: "Outstanding payments",
    completed: "Completed payments",
    monthly: "Monthly spending",
    "budget-vs-actual": "Budget versus actual",
  };
  p.heading(titles[kind], `${coupleName(w)} · ${w.weddingDate ? fmtDate(w.weddingDate, "long") : ""} · generated ${fmtDate(today)}`);

  const kpis = () => {
    p.section("At a glance");
    const items: Array<[string, string]> = [["Budget", naira(summary.budget)], ["Committed", naira(summary.committed)], ["Spent", naira(summary.spent)], ["Outstanding", naira(summary.outstanding)], ["Remaining", naira(summary.remaining)], ["Utilised", `${summary.utilisedPct}%`]];
    const colW = (p.W - p.M * 2) / 3;
    items.forEach(([k, v], i) => {
      const x = p.M + (i % 3) * colW;
      if (i % 3 === 0 && i > 0) p.line(38);
      p.text(k, { x, size: 8, color: [0.48, 0.45, 0.41] });
      p.y -= 14;
      p.text(v, { x, size: 14, bold: true });
      p.y += 14;
    });
    p.line(40);
  };
  const catTable = () => {
    p.section("By category");
    p.table([{ label: "Category", width: 150 }, { label: "Allocated", width: 90, right: true }, { label: "Committed", width: 90, right: true }, { label: "Paid", width: 85, right: true }, { label: "Variance", width: 84, right: true }], cats.filter((c) => c.count || c.allocated).map((c) => [c.name, naira(c.allocated), naira(c.committed), naira(c.paid), naira(c.allocated - c.committed)]));
  };
  const payments = list.flatMap((e) => e.payments.map((x) => ({ ...x, expense: e.name, vendor: e.vendor?.name ?? "—" }))).sort((a, b) => a.paidOn.localeCompare(b.paidOn));

  if (kind === "overall") {
    kpis();
    catTable();
    p.section("Upcoming payments");
    p.table([{ label: "Due", width: 70 }, { label: "Expense", width: 170 }, { label: "Vendor", width: 130 }, { label: "Amount", width: 129, right: true }], schedule.filter((s) => s.status !== "paid").slice(0, 15).map((s) => [fmtDate(s.date), `${s.expenseName} · ${s.label}`, s.vendorName ?? "—", naira(s.amount)]));
  } else if (kind === "budget-vs-actual") {
    kpis();
    catTable();
  } else if (kind === "expenses") {
    p.table([{ label: "Expense", width: 140 }, { label: "Category", width: 85 }, { label: "Total", width: 72, right: true }, { label: "Paid", width: 72, right: true }, { label: "Balance", width: 70, right: true }, { label: "Status", width: 60 }], list.map((e) => [e.name, e.category?.name ?? "—", naira(e.state.total), naira(e.state.paid), naira(e.state.outstanding), EXPENSE_STATUS_LABEL[e.state.status]]));
  } else if (kind === "vendors") {
    const m = new Map<string, { name: string; phone: string; total: number; paid: number; out: number }>();
    for (const e of list) {
      if (!e.vendor || e.state.status === "cancelled") continue;
      const r = m.get(e.vendor.id) ?? { name: e.vendor.name, phone: displayPhone(e.vendor.phone), total: 0, paid: 0, out: 0 };
      r.total += e.state.total;
      r.paid += e.state.paid;
      r.out += e.state.outstanding;
      m.set(e.vendor.id, r);
    }
    p.table([{ label: "Vendor", width: 150 }, { label: "Phone", width: 90 }, { label: "Agreed", width: 85, right: true }, { label: "Paid", width: 85, right: true }, { label: "Outstanding", width: 89, right: true }], [...m.values()].map((v) => [v.name, v.phone, naira(v.total), naira(v.paid), naira(v.out)]));
  } else if (kind === "outstanding") {
    p.table([{ label: "Due", width: 70 }, { label: "Expense", width: 170 }, { label: "Vendor", width: 120 }, { label: "Status", width: 60 }, { label: "Amount", width: 79, right: true }], schedule.filter((s) => s.status !== "paid").map((s) => [fmtDate(s.date), `${s.expenseName} · ${s.label}`, s.vendorName ?? "—", s.status, naira(s.amount)]));
    p.line(6);
    p.text(`Total outstanding: ${naira(summary.outstanding)}`, { bold: true, size: 11 });
  } else if (kind === "completed") {
    p.table([{ label: "Date", width: 70 }, { label: "Expense", width: 160 }, { label: "Vendor", width: 120 }, { label: "Ref", width: 70 }, { label: "Amount", width: 79, right: true }], payments.map((x) => [fmtDate(x.paidOn), x.expense, x.vendor, x.reference ?? "", naira(x.amount)]));
    p.line(6);
    p.text(`Total paid: ${naira(summary.spent)}`, { bold: true, size: 11 });
  } else if (kind === "monthly") {
    const months = new Map<string, number>();
    for (const x of payments) months.set(x.paidOn.slice(0, 7), (months.get(x.paidOn.slice(0, 7)) ?? 0) + x.amount);
    const max = Math.max(1, ...months.values());
    for (const [m, v] of [...months.entries()].sort()) {
      p.ensure(24);
      p.text(new Date(`${m}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric" }), { size: 9 });
      p.page.drawRectangle({ x: p.M + 80, y: p.y - 2, width: ((p.W - p.M * 2 - 180) * v) / max, height: 10, color: rgb(0.72, 0.61, 0.42) });
      p.text(naira(v), { right: p.W - p.M, size: 9, bold: true });
      p.line(20);
    }
  }
  return Buffer.from(await p.doc.save());
}

export async function receiptPdf(o: NonNullable<Awaited<ReturnType<typeof import("./asoebi").orderForGuest>>>) {
  const { order, wedding } = o;
  const p = await PdfWriter.create();
  p.text(`${coupleName(wedding)}`.toUpperCase(), { size: 9, bold: true, color: [0.66, 0.55, 0.36] });
  p.line(26);
  p.text("Aso Ebi payment receipt", { size: 22, bold: true });
  p.line(18);
  p.text(order.campaign.name, { size: 10, color: [0.48, 0.45, 0.41] });
  p.line(30);
  const ok = order.payments.filter((x) => x.status === "success");
  const rows: Array<[string, string]> = [
    ["Guest", order.fullName],
    ["Order ID", order.code],
    ["Package", order.items.map((i) => `${i.quantity} × ${i.packageName}`).join(", ")],
    ["Quantity", String(order.items.reduce((s, i) => s + i.quantity, 0))],
    ["Order total", naira(order.total)],
    ["Amount paid", naira(order.amountPaid)],
    ["Balance", naira(order.total - order.amountPaid)],
    ["Payment status", ORDER_LABEL[order.status]],
  ];
  for (const [k, v] of rows) {
    p.text(k, { size: 9, color: [0.48, 0.45, 0.41] });
    p.text(p.fit(v, 320, 11), { size: 11, bold: true, right: p.W - p.M });
    p.line(8);
    p.rule();
    p.line(16);
  }
  p.section("Verified payments");
  p.table([{ label: "Date", width: 130 }, { label: "Reference", width: 170 }, { label: "Channel", width: 90 }, { label: "Amount", width: 109, right: true }], ok.map((x) => [fmtDateTime(x.paidAt), x.reference, x.channel ?? "—", naira(x.amount)]));
  p.line(20);
  p.text("Payments on this receipt were verified directly with the payment provider.", { size: 8, color: [0.48, 0.45, 0.41] });
  return Buffer.from(await p.doc.save());
}
