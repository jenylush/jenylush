/**
 * End-to-end test of the eight journeys in the product brief.
 *
 * Runs a real Next.js server against the real database, with a local mock standing in
 * for Paystack (initialize / verify / hosted checkout) and Resend. Nothing in the app is
 * stubbed: payment verification, webhook signatures and reminders all run the real code.
 *
 *   npm run test:e2e
 */
import "../../scripts/load-env";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import ExcelJS from "exceljs";
import { Pool } from "pg";

const require = createRequire(import.meta.url);
const { chromium } = (() => {
  try {
    return require("playwright");
  } catch {
    return require("/opt/node22/lib/node_modules/playwright");
  }
})() as { chromium: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

const APP = "http://localhost:3100";
const MOCK = "http://localhost:4010";
const SECRET = "sk_test_mock_e2e";
const CRON = "e2e-cron-secret";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows as T[];

/* ─── Mock Paystack + Resend ───────────────────────────────────────── */
const txs = new Map<string, { amount: number; email: string; callback: string; status: string }>();
let nextStatus = "success";
const emails: Array<{ to: string[]; subject: string }> = [];

const mock = http.createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  const json = (code: number, data: unknown) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };
  const url = new URL(req.url!, MOCK);
  if (url.pathname.startsWith("/transaction") && req.headers.authorization !== `Bearer ${SECRET}`) return json(401, { status: false, message: "bad key" });
  if (req.method === "POST" && url.pathname === "/transaction/initialize") {
    const b = JSON.parse(body);
    txs.set(b.reference, { amount: b.amount, email: b.email, callback: b.callback_url, status: nextStatus });
    return json(200, { status: true, message: "ok", data: { authorization_url: `${MOCK}/checkout/${b.reference}`, access_code: "x", reference: b.reference } });
  }
  if (url.pathname.startsWith("/transaction/verify/")) {
    const ref = decodeURIComponent(url.pathname.split("/").pop()!);
    const t = txs.get(ref);
    if (!t) return json(404, { status: false, message: "Transaction reference not found" });
    return json(200, { status: true, message: "ok", data: { reference: ref, status: t.status, amount: t.amount, currency: "NGN", channel: "card", gateway_response: t.status === "success" ? "Approved" : "Pending", paid_at: t.status === "success" ? new Date().toISOString() : null } });
  }
  if (url.pathname.startsWith("/checkout/")) {
    const ref = url.pathname.split("/").pop()!;
    const t = txs.get(ref)!;
    res.writeHead(302, { Location: `${t.callback}&reference=${ref}&trxref=${ref}` });
    return res.end();
  }
  if (req.method === "POST" && url.pathname === "/emails") {
    if (req.headers.authorization !== "Bearer re_mock") return json(401, { message: "bad key" });
    const b = JSON.parse(body);
    emails.push({ to: b.to, subject: b.subject });
    return json(200, { id: `em_${emails.length}` });
  }
  json(404, {});
});

/* ─── Harness ──────────────────────────────────────────────────────── */
let app: ChildProcess;
const results: Array<[string, boolean, string?]> = [];
async function scenario(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push([name, true]);
    console.log(`  ✓ ${name}`);
  } catch (e) {
    results.push([name, false, e instanceof Error ? e.message : String(e)]);
    console.log(`  ✗ ${name}\n      ${e instanceof Error ? e.message : e}`);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}
const iso = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const webhook = (payload: unknown, secret = SECRET) => {
  const raw = JSON.stringify(payload);
  return fetch(`${APP}/api/webhooks/paystack`, { method: "POST", headers: { "Content-Type": "application/json", "x-paystack-signature": crypto.createHmac("sha512", secret).update(raw).digest("hex") }, body: raw });
};

async function main() {
  try {
    await fetch(`${APP}/api/health`);
    throw new Error("Port 3100 is already in use — stop the other server first.");
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Port")) throw e;
  }
  await new Promise<void>((r) => mock.listen(4010, r));
  app = spawn("npx", ["next", "dev", "-p", "3100"], {
    env: { ...process.env, NEXT_DIST_DIR: ".next-e2e", APP_URL: APP, PAYSTACK_SECRET_KEY: SECRET, PAYSTACK_BASE_URL: MOCK, RESEND_API_KEY: "re_mock", RESEND_BASE_URL: MOCK, EMAIL_FROM: "Owambe Ledger <test@example.com>", CRON_SECRET: CRON },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  app.stderr?.on("data", (d) => process.env.E2E_VERBOSE && process.stderr.write(d));
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${APP}/api/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }

  const browser = await chromium.launch();
  const couple = await (await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } })).newPage();
  couple.setDefaultTimeout(90_000);
  const stamp = Date.now().toString(36);
  const email = `e2e-${stamp}@example.com`;
  let weddingId = "";
  let campaignUrl = "";

  console.log("\nOwambe Ledger — end-to-end scenarios\n");

  await scenario("1 · Couple signs up, sets a ₦15m budget, adds a vendor with instalments, records a payment and gets reminders", async () => {
    await couple.goto(`${APP}/signup`);
    await couple.fill("input[name=name]", "Kemi Test");
    await couple.fill("input[name=email]", email);
    await couple.fill("input[name=password]", "correct-horse-1");
    await couple.click("button[type=submit]");
    await couple.waitForURL("**/onboarding");
    await couple.fill("input[name=partnerTwoName]", "Dayo");
    await couple.fill("input[name=partnerOnePhone]", "0803 555 1234");
    await couple.fill("input[name=weddingDate]", iso(120));
    await couple.fill("input[name=totalBudget]", "15,000,000");
    await couple.click("button[type=submit]");
    await couple.waitForURL(`${APP}/app`);
    [{ id: weddingId }] = await q<{ id: string }>("select w.id from weddings w join memberships m on m.wedding_id=w.id join users u on u.id=m.user_id where u.email=$1", [email]);
    const [w] = await q<{ total_budget: string }>("select total_budget from weddings where id=$1", [weddingId]);
    assert(Number(w.total_budget) === 1_500_000_000, "budget should be ₦15m in kobo");

    await couple.goto(`${APP}/app/vendors/new`);
    await couple.fill("input[name=name]", "Lens & Light Photography");
    await couple.fill("input[name=phone]", "08091112233");
    await couple.fill("input[name=agreedPrice]", "500000");
    const amounts = await couple.$$("input[name=planAmount]");
    const dates = await couple.$$("input[name=planDate]");
    await amounts[0].fill("200000"); await dates[0].fill(iso(-10));
    await amounts[1].fill("150000"); await dates[1].fill(iso(3));
    await amounts[2].fill("150000"); await dates[2].fill(iso(40));
    await couple.click("button[type=submit]:has-text('Add vendor')");
    await couple.waitForURL(/\/app\/vendors\/[0-9a-f-]{36}$/);

    // Record the first instalment
    await couple.click("text=Record payment →");
    await couple.waitForURL(/\/app\/budget\//);
    await couple.fill("input[name=amount]", "200000");
    await couple.click("button:has-text('Record payment')");
    await couple.waitForSelector("text=Balance is now ₦300,000");
    await couple.goto(`${APP}/app`);
    const committed = await couple.textContent("body");
    assert(committed?.includes("₦14,500,000"), "remaining budget should be ₦14.5m after a ₦500k contract");

    const r = await fetch(`${APP}/api/cron/reminders`, { headers: { authorization: `Bearer ${CRON}` } });
    assert(r.ok, `cron returned ${r.status}`);
    const logs = await q<{ type: string; status: string; channel: string }>("select type,status,channel from notification_logs where wedding_id=$1", [weddingId]);
    assert(logs.some((l) => l.type === "vendor_payment_due" && l.channel === "email" && l.status === "sent"), "a 3-day reminder email should have been sent");
    assert(emails.some((e) => e.to.includes(email) && /₦150,000/.test(e.subject)), "reminder email for ₦150,000 should reach the mock inbox");
    const unauth = await fetch(`${APP}/api/cron/reminders`);
    assert(unauth.status === 401, "cron must reject requests without the secret");
  });

  await scenario("2 · Couple creates an Aso Ebi campaign, uploads fabric pictures, sets ₦85,000 and shares the link", async () => {
    await couple.goto(`${APP}/app/asoebi/new`);
    await couple.fill("input[name=name]", "Trad Aso Ebi");
    await couple.fill("input[name=fabricName]", "Emerald lace");
    await couple.fill("input[name=salesOpenAt]", iso(-1));
    await couple.fill("input[name=paymentDeadline]", iso(30));
    await couple.check("input[name=allowInstalments]");
    await couple.fill("input[name=deliveryFee]", "5000");
    await couple.click("button:has-text('Create campaign')");
    await couple.waitForURL(/\/app\/asoebi\/[0-9a-f-]{36}$/);
    await couple.locator("form:has(button:has-text('Add package')) input[name=price]").fill("85000");
    await couple.locator("form:has(button:has-text('Add package')) input[name=name]").fill("Female package");
    await couple.click("button:has-text('Add package')");
    await couple.waitForSelector("text=Package saved.");
    await couple.setInputFiles("input[name=images]", path.join(process.cwd(), "scripts/demo-assets/lace-champagne.jpg"));
    await couple.click("button:has-text('Upload')");
    await couple.waitForSelector("text=1 photo uploaded.");
    await couple.click("button:has-text('Publish')");
    await couple.waitForSelector("text=Unpublish");
    const [c] = await q<{ slug: string }>("select slug from asoebi_campaigns where wedding_id=$1", [weddingId]);
    campaignUrl = `${APP}/asoebi/${c.slug}`;
    const page = await fetch(campaignUrl);
    assert(page.ok && (await page.text()).includes("Emerald lace"), "public link should serve the campaign");
  });

  const guestCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const guest = await guestCtx.newPage();
  guest.setDefaultTimeout(90_000);
  let orderUrl = "";

  async function placeOrder(p: any, name: string, phone: string, mail: string) {
    await p.goto(campaignUrl);
    await p.click("button[aria-label='More Female package']");
    await p.click("button:has-text('Continue')");
    await p.fill("#fn", name);
    await p.fill("#ph", phone);
    await p.fill("#em", mail);
    await p.fill("#st", "12 Admiralty Way");
    await p.selectOption("#sa", "Lagos");
    await p.fill("#ci", "Lagos");
    await p.fill("#ar", "Lekki Phase 1");
    await p.fill("#lm", "Opposite Mega Chicken");
    await p.click("button:has-text('Continue')");
    await p.check("input[name=confirm]");
    await p.click("button:has-text('Place order')");
    await p.waitForURL(/\/asoebi\/order\/AE-/);
    return p.url();
  }

  await scenario("3 · Guest opens the link, picks a package, enters an address, pays and gets a receipt", async () => {
    orderUrl = await placeOrder(guest, "Bisola Guest", "0812 345 6789", `bisola-${stamp}@example.com`);
    const before = await q<{ status: string }>("select status from asoebi_orders where full_name='Bisola Guest' and wedding_id=$1", [weddingId]);
    assert(before[0].status === "pending_payment", "a new order starts unpaid");
    nextStatus = "success";
    await guest.click("button:has-text('Pay securely with Paystack')");
    await guest.waitForURL(/r=paid/);
    assert((await guest.textContent("body"))?.includes("Payment confirmed"), "guest should see confirmation after verification");
    const [o] = await q<{ status: string; amount_paid: string; total: string }>("select status, amount_paid, total from asoebi_orders where full_name='Bisola Guest' and wedding_id=$1", [weddingId]);
    assert(o.status === "paid" && o.amount_paid === o.total && Number(o.total) === 9_000_000, `order should be paid ₦90,000 (got ${o.status} ${o.amount_paid})`);
    const receipt = await guest.request.get(`${APP}/api/receipts/${orderUrl.match(/AE-\w+/)![0]}?t=${new URL(orderUrl).searchParams.get("t")}`);
    assert(receipt.ok() && (await receipt.body()).subarray(0, 4).toString() === "%PDF", "receipt PDF should download");
    assert(emails.some((e) => e.to.includes(`bisola-${stamp}@example.com`) && e.subject.includes("Payment received")), "receipt email should be sent to the guest");
  });

  await scenario("4 · Couple sees the guest's name, package, payment status and address on the dashboard", async () => {
    await couple.goto(`${APP}/app/guests?q=Bisola`);
    const row = await couple.textContent("table");
    assert(row?.includes("Bisola Guest") && row.includes("Female package") && row.includes("Paid") && row.includes("12 Admiralty Way"), "register row should be complete");
  });

  await scenario("5 · Couple exports the updated register to Excel", async () => {
    const dl = couple.waitForEvent("download");
    await couple.evaluate(() => (window.location.href = "/api/exports/register?filter=all"));
    const file = await (await dl).path();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file!);
    const ws = wb.getWorksheet("Register")!;
    const headers = (ws.getRow(4).values as string[]).slice(1);
    assert(headers.slice(0, 5).join("|") === "Guest Name|Phone|Email|Package|Quantity", `unexpected headers ${headers.join("|")}`);
    let found = false;
    ws.eachRow((r) => {
      const v = (r.values as unknown[]).map(String);
      if (v.includes("Bisola Guest") && v.includes("Paid")) found = true;
    });
    assert(found, "export should contain the paid guest");
  });

  await scenario("6 · A pending payment is NOT marked paid until verified (incl. signed webhook, replay & forgery)", async () => {
    const p2 = await guestCtx.newPage();
    const url = await placeOrder(p2, "Pending Payer", "0703 111 2222", `pending-${stamp}@example.com`);
    nextStatus = "pending";
    await p2.click("button:has-text('Pay securely with Paystack')");
    await p2.waitForURL(/r=pending/);
    assert((await p2.textContent("body"))?.includes("We're confirming your payment"), "guest sees pending, not success");
    const [o] = await q<{ id: string; status: string; amount_paid: string }>("select id,status,amount_paid from asoebi_orders where full_name='Pending Payer' and wedding_id=$1", [weddingId]);
    assert(o.status === "pending_payment" && o.amount_paid === "0", "returning to the site must not mark the order paid");
    const [p] = await q<{ reference: string; amount: string }>("select reference, amount from payments where order_id=$1", [o.id]);

    const forged = await webhook({ event: "charge.success", data: { reference: p.reference, id: 1 } }, "wrong-secret");
    assert(forged.status === 401, "forged webhook must be rejected");
    // Webhook arrives but Paystack still says pending → still unpaid
    await webhook({ event: "charge.success", data: { reference: p.reference, id: 2 } });
    assert((await q<{ status: string }>("select status from asoebi_orders where id=$1", [o.id]))[0].status === "pending_payment", "payload alone must not mark paid — re-verification still says pending");
    // Bank settles
    txs.get(p.reference)!.status = "success";
    const ok = await webhook({ event: "charge.success", data: { reference: p.reference, id: 3 } });
    assert(ok.ok, "valid webhook should be accepted");
    const replay = await (await webhook({ event: "charge.success", data: { reference: p.reference, id: 3 } })).json();
    assert(replay.duplicate === true, "replayed webhook should be ignored");
    await fetch(url.replace("?t=", "/return?t=") + `&reference=${p.reference}`, { redirect: "manual" });
    const [after] = await q<{ status: string; amount_paid: string; total: string }>("select status, amount_paid, total from asoebi_orders where id=$1", [o.id]);
    assert(after.status === "paid" && after.amount_paid === after.total, `paid exactly once (got ${after.amount_paid}/${after.total})`);
    const applied = await q("select 1 from payments where order_id=$1 and applied_at is not null", [o.id]);
    assert(applied.length === 1, "payment applied exactly once");
  });

  await scenario("7 · Guest updates their delivery address; dashboard and export reflect it", async () => {
    await guest.goto(orderUrl);
    await guest.click("text=Change delivery address");
    await guest.fill("input[name=street]", "7 Bourdillon Road");
    await guest.fill("input[name=area]", "Ikoyi");
    await guest.click("button:has-text('Save address')");
    await guest.waitForSelector("text=your delivery address has been updated");
    await couple.goto(`${APP}/app/guests?q=Bisola`);
    assert((await couple.textContent("table"))?.includes("7 Bourdillon Road"), "register should show the new address");
    const res = await couple.request.get(`${APP}/api/exports/register?filter=delivery`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await res.body()) as unknown as ArrayBuffer);
    let found = false;
    wb.getWorksheet("Deliveries")!.eachRow((r) => {
      if ((r.values as unknown[]).map(String).includes("7 Bourdillon Road")) found = true;
    });
    assert(found, "delivery export should contain the new address");
  });

  await scenario("8 · An overdue vendor instalment triggers a reminder and is logged once", async () => {
    // The ₦200k first instalment was paid; make the second one overdue.
    await q("update instalments set due_date=$1 where wedding_id=$2 and amount=15000000 and due_date=$3", [iso(-2), weddingId, iso(3)]);
    await fetch(`${APP}/api/cron/reminders`, { headers: { authorization: `Bearer ${CRON}` } });
    await fetch(`${APP}/api/cron/reminders`, { headers: { authorization: `Bearer ${CRON}` } });
    const rows = await q<{ status: string; channel: string }>("select status, channel from notification_logs where wedding_id=$1 and type='vendor_payment_overdue'", [weddingId]);
    assert(rows.filter((r) => r.channel === "email").length === 1, `exactly one overdue email expected, got ${rows.length}`);
    assert(rows.every((r) => r.status === "sent"), "overdue reminders should be sent");
    await couple.goto(`${APP}/app/notifications?tab=history`);
    assert((await couple.textContent("body"))?.includes("Payment became overdue"), "automation history should show the trigger");
    const inbox = await q("select 1 from notifications where wedding_id=$1 and kind='vendor_payment_overdue'", [weddingId]);
    assert(inbox.length === 1, "one in-app notification");
  });

  await scenario("Tenancy · another couple cannot see this couple's data", async () => {
    const other = await (await browser.newContext()).newPage();
    await other.goto(`${APP}/login`);
    await other.fill("input[name=email]", "demo@owambe.ng");
    await other.fill("input[name=password]", "demo-wedding");
    await other.click("button[type=submit]");
    await other.waitForURL(`${APP}/app`);
    const [o] = await q<{ id: string }>("select id from asoebi_orders where wedding_id=$1 limit 1", [weddingId]);
    const resp = await other.goto(`${APP}/app/orders/${o.id}`);
    assert(resp?.status() === 404, `foreign order must 404 (got ${resp?.status()})`);
    await other.goto(`${APP}/app/guests?q=Bisola`);
    assert(!(await other.textContent("body"))?.includes("Bisola Guest"), "foreign guests must not appear");
  });

  await browser.close();
}

main()
  .catch((e) => {
    console.error(e);
    results.push(["harness", false, String(e)]);
  })
  .finally(async () => {
    if (app?.pid) try { process.kill(-app.pid, "SIGTERM"); } catch {}
    mock.close();
    await pool.end();
    fs.rmSync(".next-e2e", { recursive: true, force: true });
    const failed = results.filter((r) => !r[1]);
    console.log(`\n${results.length - failed.length}/${results.length} scenarios passed`);
    process.exit(failed.length ? 1 : 0);
  });
