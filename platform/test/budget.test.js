import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { startTestApp, signupVerified, createWedding } from './helpers.js';
import { runBudgetReminders } from '../src/notifications.js';
import { addDays } from '../src/timezone.js';

let app, c, w;
before(async () => {
  app = await startTestApp();
  c = app.client();
  await signupVerified(app, c);
  w = await createWedding(c, { timezone: 'Africa/Lagos' });
});
after(async () => { await app.stop(); });

const today = () => new Date().toISOString().slice(0, 10);
const base = () => `/api/weddings/${w.id}/budget`;

test('budget starts with suggested categories and a local currency', async () => {
  const r = await c.get(base());
  assert.equal(r.status, 200);
  assert.equal(r.data.settings.currency, 'NGN', 'currency guessed from the Lagos timezone');
  assert.equal(r.data.categories.length, 12);
  assert.equal(r.data.summary.total, 0);
});

test('settings, suggested split, expenses, payments and automatic statuses', async () => {
  assert.equal((await c.put(`${base()}/settings`, { total_budget: -5 })).status, 400);
  assert.equal((await c.put(`${base()}/settings`, { currency: 'XYZ' })).status, 400);
  assert.equal((await c.put(`${base()}/settings`, { total_budget: 5000000, currency: 'NGN' })).status, 200);
  assert.equal((await c.post(`${base()}/categories/suggest-split`)).status, 200);
  let d = (await c.get(base())).data;
  const venue = d.categories.find((x) => x.name === 'Venue');
  assert.equal(venue.planned_minor, 1000000 * 100, 'venue gets 20% of the budget');
  assert.equal(d.summary.unallocated, 0);

  const bad = await c.post(`${base()}/expenses`, { item: '', estimated: 'abc' });
  assert.equal(bad.status, 400);
  const add = (body) => c.post(`${base()}/expenses`, body);
  assert.equal((await add({ item: 'Hall', category_id: venue.id, estimated: 1200000, actual: 1100000, paid: 500000, due_date: addDays(today(), -3), vendor: 'Eko Hotel' })).status, 201);
  assert.equal((await add({ item: 'Photographer', estimated: 400000, due_date: addDays(today(), 5) })).status, 201);
  assert.equal((await add({ item: 'Rings', estimated: 300000, paid: 300000 })).status, 201);
  assert.equal((await add({ item: 'Cake', estimated: 150000, due_date: addDays(today(), 60) })).status, 201);
  d = (await c.get(base())).data;
  const by = (item) => d.expenses.find((e) => e.item === item);
  assert.equal(by('Hall').status, 'overdue');
  assert.equal(by('Hall').cost_minor, 110000000, 'actual cost replaces the estimate');
  assert.equal(by('Photographer').status, 'due_soon');
  assert.equal(by('Rings').status, 'paid');
  assert.equal(by('Cake').status, 'unpaid');
  assert.equal(d.summary.committed, (1100000 + 400000 + 300000 + 150000) * 100);
  assert.equal(d.summary.paid, 800000 * 100);
  assert.equal(d.summary.overdue, 1);
  assert.equal(d.summary.categories.find((x) => x.name === 'Venue').committed, 110000000);

  const pay = await c.post(`${base()}/expenses/${by('Hall').id}/payments`, { amount: 600000, next_due_date: null, note: 'Final balance, receipt 0042' });
  assert.equal(pay.status, 200);
  d = (await c.get(base())).data;
  assert.equal(d.expenses.find((e) => e.item === 'Hall').status, 'paid');
  assert.match(d.expenses.find((e) => e.item === 'Hall').notes, /receipt 0042/);
  assert.equal(d.summary.overdue, 0);

  // Deleting a category keeps its expenses.
  assert.equal((await c.del(`${base()}/categories/${venue.id}`)).status, 200);
  d = (await c.get(base())).data;
  assert.equal(d.expenses.find((e) => e.item === 'Hall').category_id, null);
});

test('gifts and thank-you tracking', async () => {
  const guest = (await c.post(`/api/weddings/${w.id}/guests`, { first_name: 'Tunde', last_name: 'Bello', email: 'tunde@example.com' })).data.guest;
  assert.equal((await c.post(`${base()}/gifts`, { guest_id: guest.id, gift_type: 'transfer', amount: 50000 })).status, 201);
  assert.equal((await c.post(`${base()}/gifts`, { giver_name: 'Aunty Ngozi', gift_type: 'item', description: 'Stand mixer', amount: 85000, thank_you_sent: true })).status, 201);
  assert.equal((await c.post(`${base()}/gifts`, { giver_name: '' })).status, 400);
  let d = (await c.get(base())).data;
  assert.equal(d.gifts.find((g) => g.guest_id === guest.id).giver_name, 'Tunde Bello', 'name filled from the guest list');
  assert.equal(d.summary.gifts.count, 2);
  assert.equal(d.summary.gifts.cash, 50000 * 100);
  assert.equal(d.summary.gifts.thank_you_pending, 1);
  const g = d.gifts.find((x) => x.guest_id === guest.id);
  await c.patch(`${base()}/gifts/${g.id}`, { thank_you_sent: true });
  d = (await c.get(base())).data;
  assert.equal(d.summary.gifts.thank_you_pending, 0);
});

test('spreadsheet export has live formulas, dropdowns and current values', async () => {
  const res = await c.raw('GET', `${base()}/tracker.xlsx`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /spreadsheetml/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  assert.deepEqual(wb.worksheets.map((s) => s.name), ['Summary', 'Budget', 'Expenses', 'Gifts']);
  const exp = wb.getWorksheet('Expenses');
  assert.equal(exp.getCell('A1').value, 'Item');
  const hall = [...Array(10).keys()].map((i) => exp.getRow(i + 2)).find((r) => r.getCell(1).value === 'Hall');
  assert.ok(hall, 'expense rows exported');
  assert.match(hall.getCell(11).value.formula, /TODAY\(\)/, 'status is a live formula');
  assert.equal(hall.getCell(11).value.result, 'Paid');
  assert.match(exp.getCell('G150').value.formula, /^IF\(F150=""/, 'empty rows carry formulas too');
  assert.ok(exp.getCell('B2').dataValidation?.formulae?.[0].startsWith('Budget!'), 'category dropdown');
  const sum = wb.getWorksheet('Summary');
  const committedRow = [...Array(30).keys()].map((i) => sum.getRow(i + 1)).find((r) => r.getCell(2).value === 'Committed (cost of everything booked)');
  assert.equal(committedRow.getCell(3).value.formula, 'SUM(Expenses!G:G)');
  assert.equal(committedRow.getCell(3).value.result, 1950000);
  const gifts = wb.getWorksheet('Gifts');
  assert.equal(gifts.getCell('A1').value, 'From');
  const csv = await c.get(`${base()}/expenses.csv`);
  assert.match(csv.data, /Hall,Uncategorised,Eko Hotel/);
  assert.match((await c.get(`${base()}/gifts.csv`)).data, /Aunty Ngozi,Gift item,Stand mixer,85000.00/);
});

test('free blank template is downloadable without an account', async () => {
  const res = await fetch(`${app.base}/tools/wedding-budget-tracker.xlsx?currency=GBP`);
  assert.equal(res.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const bud = wb.getWorksheet('Budget');
  assert.equal(bud.getCell('A2').value, 'Venue');
  assert.equal(bud.getCell('B2').value.formula, 'Summary!$C$7*0.2', 'planned follows the total budget');
  assert.match(bud.getCell('B2').numFmt, /£/);
});

test('budget access control', async () => {
  const other = app.client();
  await signupVerified(app, other);
  assert.equal((await other.get(base())).status, 404);
  assert.equal((await other.post(`${base()}/expenses`, { item: 'x' })).status, 404);
  assert.equal((await other.raw('GET', `${base()}/tracker.xlsx`)).status, 404);
  // A collaborator without edit rights can view but not change.
  const helper = app.client();
  const { email } = await signupVerified(app, helper);
  await c.post(`/api/weddings/${w.id}/members`, { email, can_edit: false, can_manage_guests: true });
  const log = app.ctx.db.get("SELECT text FROM email_delivery_logs WHERE type = 'coowner_invite' AND to_email = ?", email);
  await helper.post('/api/invites/accept', { token: decodeURIComponent(/token=([^\s&]+)/.exec(log.text)[1]) });
  assert.equal((await helper.get(base())).data.can_edit, false);
  assert.equal((await helper.post(`${base()}/expenses`, { item: 'x' })).status, 403);
  // Expenses can't be moved into another wedding's category.
  const w2 = await createWedding(other, { partner1: 'Zed', partner2: 'Yo' });
  const cat2 = (await other.get(`/api/weddings/${w2.id}/budget`)).data.categories[0].id;
  assert.equal((await c.post(`${base()}/expenses`, { item: 'Sneaky', category_id: cat2 })).status, 400);
});

test('payment-due and thank-you reminders are sent once', async () => {
  const lagosToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
  await c.post(`${base()}/expenses`, { item: 'DJ deposit', estimated: 200000, due_date: addDays(lagosToday, 3) });
  await c.post(`${base()}/expenses`, { item: 'Already paid thing', estimated: 1000, paid: 1000, due_date: addDays(lagosToday, 3) });
  const first = runBudgetReminders(app.ctx.deps);
  assert.ok(first >= 1);
  assert.equal(runBudgetReminders(app.ctx.deps), 0, 'no duplicates on the next run');
  const mails = app.ctx.db.all("SELECT subject FROM email_delivery_logs WHERE type = 'payment_due' AND wedding_id = ?", w.id);
  assert.ok(mails.every((m) => /DJ deposit/.test(m.subject)), 'paid expenses are skipped');
  assert.match(mails[0].subject, /in 3 days/);

  // Thank-you reminder 7 days after the wedding when notes are pending.
  const wedDay = addDays(lagosToday, -7);
  await c.put(`/api/weddings/${w.id}/draft`, { version: (await c.get(`/api/weddings/${w.id}/draft`)).data.version, wedding: { wedding_date_local: `${wedDay}T14:00` } });
  await c.post(`${base()}/gifts`, { giver_name: 'Cousin Ada', gift_type: 'cash', amount: 1000 });
  runBudgetReminders(app.ctx.deps);
  assert.ok(app.ctx.db.get("SELECT 1 FROM email_delivery_logs WHERE type = 'thank_you_reminder' AND wedding_id = ?", w.id));

  // Couples can switch reminders off.
  await c.put(`${base()}/settings`, { reminders_enabled: false });
  await c.post(`${base()}/expenses`, { item: 'Florist', estimated: 5000, due_date: lagosToday });
  runBudgetReminders(app.ctx.deps);
  assert.equal(app.ctx.db.get("SELECT COUNT(*) AS n FROM email_delivery_logs WHERE subject LIKE '%Florist%'").n, 0);
});
