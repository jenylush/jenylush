import express from 'express';
import { now, uuid } from '../db.js';
import { member, asyncHandler } from './access.js';
import { HttpError, getWedding } from '../services.js';
import { utcToZonedDate } from '../timezone.js';
import { rateLimit } from '../auth.js';
import { toCsv } from '../csv.js';
import { track } from '../analytics.js';
import { buildTrackerWorkbook } from '../budget-export.js';
import { CURRENCIES, DEFAULT_CATEGORIES, GIFT_TYPES, PAID_BY, expenseStatus, expenseCost, budgetSummary, STATUS_LABELS } from '../../shared/budget.js';

const MAX_MINOR = 1e13; // 100 billion in major units: well above any wedding
const CURRENCY_CODES = new Set(CURRENCIES.map((c) => c[0]));

// A sensible starting currency from the wedding's timezone; couples can change it.
function guessCurrency(tz = '') {
  const map = [[/^Africa\/Lagos/, 'NGN'], [/^Africa\/Accra/, 'GHS'], [/^Africa\/Nairobi/, 'KES'], [/^Africa\/Johannesburg/, 'ZAR'], [/^Africa\/(Abidjan|Dakar|Bamako|Lome|Ouagadougou|Niamey|Porto-Novo)/, 'XOF'],
    [/^Europe\/(London|Belfast)/, 'GBP'], [/^Europe\//, 'EUR'], [/^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax)/, 'CAD'], [/^Australia\//, 'AUD'], [/^Asia\/(Kolkata|Calcutta)/, 'INR'], [/^Asia\/Dubai/, 'AED']];
  return (map.find(([re]) => re.test(tz)) || [null, 'USD'])[1];
}

export function ensureBudget(db, weddingId) {
  if (db.get('SELECT 1 FROM budget_settings WHERE wedding_id = ?', weddingId)) return;
  const w = getWedding(db, weddingId);
  const ts = now();
  db.tx(() => {
    db.run('INSERT OR IGNORE INTO budget_settings (wedding_id, currency, total_budget_minor, reminders_enabled, updated_at) VALUES (?, ?, 0, 1, ?)', weddingId, guessCurrency(w.timezone), ts);
    if (!db.get('SELECT 1 FROM budget_categories WHERE wedding_id = ?', weddingId)) {
      DEFAULT_CATEGORIES.forEach(([name], i) => db.run('INSERT INTO budget_categories (id, wedding_id, name, planned_minor, position, created_at) VALUES (?, ?, ?, 0, ?, ?)', uuid(), weddingId, name, i, ts));
    }
  });
}

export function loadBudget(db, weddingId) {
  ensureBudget(db, weddingId);
  const w = getWedding(db, weddingId);
  const today = utcToZonedDate(new Date(), w.timezone);
  const settings = db.get('SELECT currency, total_budget_minor, reminders_enabled FROM budget_settings WHERE wedding_id = ?', weddingId);
  settings.reminders_enabled = !!settings.reminders_enabled;
  const categories = db.all('SELECT id, name, planned_minor, position FROM budget_categories WHERE wedding_id = ? ORDER BY position, created_at', weddingId);
  const expenses = db.all('SELECT * FROM expenses WHERE wedding_id = ? ORDER BY CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date, created_at', weddingId)
    .map((e) => ({ ...e, cost_minor: expenseCost(e), status: expenseStatus(e, today) }));
  const gifts = db.all('SELECT * FROM gifts_received WHERE wedding_id = ? ORDER BY received_date DESC, created_at DESC', weddingId);
  return { wedding: w, today, settings, categories, expenses, gifts };
}

function amount(v, field, { allowNull = true } = {}) {
  if (v === '' || v === null || v === undefined) {
    if (allowNull) return null;
    throw new HttpError(400, 'Enter an amount.', { fields: { [field]: 'Required.' } });
  }
  const n = Math.round(Number(v) * 100);
  if (!Number.isFinite(n) || n < 0 || n > MAX_MINOR) throw new HttpError(400, 'Enter an amount of zero or more, using numbers only.', { fields: { [field]: 'Invalid amount.' } });
  return n;
}

function date(v, field) {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new HttpError(400, 'Enter a valid date.', { fields: { [field]: 'Invalid date.' } });
  return String(v);
}

const text = (v, max) => String(v ?? '').trim().slice(0, max);

function checkCategory(db, weddingId, id) {
  if (!id) return null;
  if (!db.get('SELECT 1 FROM budget_categories WHERE id = ? AND wedding_id = ?', String(id), weddingId)) throw new HttpError(400, 'That category does not exist.');
  return String(id);
}

function cleanExpense(db, weddingId, b, existing = null) {
  const out = {};
  const has = (k) => !existing || k in b;
  if (has('item')) { out.item = text(b.item, 200); if (!out.item) throw new HttpError(400, 'Say what the expense is for.', { fields: { item: 'Required.' } }); }
  if (has('category_id')) out.category_id = checkCategory(db, weddingId, b.category_id);
  if (has('vendor')) out.vendor = text(b.vendor, 200);
  if (has('vendor_contact')) out.vendor_contact = text(b.vendor_contact, 200);
  if (has('estimated')) out.estimated_minor = amount(b.estimated, 'estimated');
  if (has('actual')) out.actual_minor = amount(b.actual, 'actual');
  if (has('paid')) out.paid_minor = amount(b.paid, 'paid') ?? 0;
  if (has('due_date')) out.due_date = date(b.due_date, 'due_date');
  if (has('paid_by')) out.paid_by = text(b.paid_by, 60) || 'Us';
  if (has('notes')) out.notes = text(b.notes, 2000);
  return out;
}

function cleanGift(db, weddingId, b, existing = null) {
  const out = {};
  const has = (k) => !existing || k in b;
  if (has('guest_id')) {
    out.guest_id = b.guest_id ? String(b.guest_id) : null;
    if (out.guest_id && !db.get('SELECT 1 FROM guests WHERE id = ? AND wedding_id = ?', out.guest_id, weddingId)) throw new HttpError(400, 'That guest is not on your list.');
  }
  if (has('giver_name')) {
    out.giver_name = text(b.giver_name, 200);
    if (!out.giver_name && out.guest_id) { const g = db.get('SELECT first_name, last_name FROM guests WHERE id = ?', out.guest_id); out.giver_name = `${g.first_name} ${g.last_name}`.trim(); }
    if (!out.giver_name) throw new HttpError(400, 'Who is the gift from?', { fields: { giver_name: 'Required.' } });
  }
  if (has('gift_type')) out.gift_type = GIFT_TYPES.some(([k]) => k === b.gift_type) ? b.gift_type : 'other';
  if (has('description')) out.description = text(b.description, 300);
  if (has('amount')) out.amount_minor = amount(b.amount, 'amount');
  if (has('received_date')) out.received_date = date(b.received_date, 'received_date');
  if (has('notes')) out.notes = text(b.notes, 2000);
  if ('thank_you_sent' in b) out.thank_you_sent_at = b.thank_you_sent ? (existing?.thank_you_sent_at || now()) : null;
  return out;
}

function update(db, table, id, weddingId, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db.run(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND wedding_id = ?`, ...keys.map((k) => fields[k]), now(), id, weddingId);
}

export function budgetRoutes(ctx) {
  const { db } = ctx;
  const r = express.Router();

  r.get('/:weddingId/budget', member(db), (req, res) => {
    const data = loadBudget(db, req.weddingId);
    res.json({
      settings: data.settings, categories: data.categories, expenses: data.expenses, gifts: data.gifts, today: data.today,
      summary: budgetSummary(data, data.today),
      guests: db.all("SELECT id, first_name || ' ' || last_name AS name FROM guests WHERE wedding_id = ? ORDER BY first_name COLLATE NOCASE", req.weddingId),
      options: { currencies: CURRENCIES, paid_by: PAID_BY, gift_types: GIFT_TYPES },
      can_edit: req.membership.role === 'owner' || !!req.membership.can_edit
    });
  });

  r.put('/:weddingId/budget/settings', member(db, 'edit'), (req, res) => {
    ensureBudget(db, req.weddingId);
    const b = req.body || {};
    const cur = db.get('SELECT * FROM budget_settings WHERE wedding_id = ?', req.weddingId);
    const currency = b.currency === undefined ? cur.currency : String(b.currency);
    if (!CURRENCY_CODES.has(currency)) throw new HttpError(400, 'Choose a currency from the list.');
    const total = b.total_budget === undefined ? cur.total_budget_minor : amount(b.total_budget, 'total_budget', { allowNull: false });
    const reminders = b.reminders_enabled === undefined ? cur.reminders_enabled : (b.reminders_enabled ? 1 : 0);
    db.run('UPDATE budget_settings SET currency = ?, total_budget_minor = ?, reminders_enabled = ?, updated_at = ? WHERE wedding_id = ?', currency, total, reminders, now(), req.weddingId);
    res.json({ ok: true });
  });

  // ----- Categories
  r.post('/:weddingId/budget/categories', member(db, 'edit'), (req, res) => {
    ensureBudget(db, req.weddingId);
    const name = text(req.body?.name, 80);
    if (!name) throw new HttpError(400, 'Name the category.', { fields: { name: 'Required.' } });
    if (db.get('SELECT COUNT(*) AS n FROM budget_categories WHERE wedding_id = ?', req.weddingId).n >= 40) throw new HttpError(400, 'You can have up to 40 categories.');
    const pos = db.get('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM budget_categories WHERE wedding_id = ?', req.weddingId).p;
    const id = uuid();
    db.run('INSERT INTO budget_categories (id, wedding_id, name, planned_minor, position, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, req.weddingId, name, amount(req.body?.planned, 'planned') ?? 0, pos, now());
    res.status(201).json({ id });
  });

  r.patch('/:weddingId/budget/categories/:id', member(db, 'edit'), (req, res) => {
    const c = db.get('SELECT * FROM budget_categories WHERE id = ? AND wedding_id = ?', req.params.id, req.weddingId);
    if (!c) throw new HttpError(404, 'Category not found.');
    const name = req.body?.name === undefined ? c.name : text(req.body.name, 80);
    if (!name) throw new HttpError(400, 'Name the category.', { fields: { name: 'Required.' } });
    const planned = req.body?.planned === undefined ? c.planned_minor : (amount(req.body.planned, 'planned') ?? 0);
    db.run('UPDATE budget_categories SET name = ?, planned_minor = ? WHERE id = ?', name, planned, c.id);
    res.json({ ok: true });
  });

  r.delete('/:weddingId/budget/categories/:id', member(db, 'edit'), (req, res) => {
    // Expenses in the category are kept and become "Uncategorised".
    const out = db.run('DELETE FROM budget_categories WHERE id = ? AND wedding_id = ?', req.params.id, req.weddingId);
    if (!out.changes) throw new HttpError(404, 'Category not found.');
    res.json({ ok: true });
  });

  // Spread the total budget across categories using the suggested percentages.
  r.post('/:weddingId/budget/categories/suggest-split', member(db, 'edit'), (req, res) => {
    ensureBudget(db, req.weddingId);
    const total = db.get('SELECT total_budget_minor FROM budget_settings WHERE wedding_id = ?', req.weddingId).total_budget_minor;
    if (!total) throw new HttpError(400, 'Set your total budget first.');
    const pct = new Map(DEFAULT_CATEGORIES);
    const cats = db.all('SELECT * FROM budget_categories WHERE wedding_id = ?', req.weddingId);
    const known = cats.filter((c) => pct.has(c.name));
    const knownPct = known.reduce((s, c) => s + pct.get(c.name), 0) || 1;
    db.tx(() => { for (const c of known) db.run('UPDATE budget_categories SET planned_minor = ? WHERE id = ?', Math.round(total * pct.get(c.name) / knownPct), c.id); });
    res.json({ ok: true, updated: known.length });
  });

  // ----- Expenses
  r.post('/:weddingId/budget/expenses', member(db, 'edit'), (req, res) => {
    ensureBudget(db, req.weddingId);
    if (db.get('SELECT COUNT(*) AS n FROM expenses WHERE wedding_id = ?', req.weddingId).n >= 1000) throw new HttpError(400, 'You can track up to 1,000 expenses.');
    const f = cleanExpense(db, req.weddingId, req.body || {});
    const id = uuid();
    const ts = now();
    db.run(`INSERT INTO expenses (id, wedding_id, category_id, item, vendor, vendor_contact, estimated_minor, actual_minor, paid_minor, due_date, paid_by, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, req.weddingId, f.category_id, f.item, f.vendor, f.vendor_contact, f.estimated_minor, f.actual_minor, f.paid_minor, f.due_date, f.paid_by, f.notes, ts, ts);
    track(db, 'budget_expense_added', { userId: req.user.id, weddingId: req.weddingId });
    res.status(201).json({ id });
  });

  r.patch('/:weddingId/budget/expenses/:id', member(db, 'edit'), (req, res) => {
    const e = db.get('SELECT * FROM expenses WHERE id = ? AND wedding_id = ?', req.params.id, req.weddingId);
    if (!e) throw new HttpError(404, 'Expense not found.');
    update(db, 'expenses', e.id, req.weddingId, cleanExpense(db, req.weddingId, req.body || {}, e));
    res.json({ ok: true });
  });

  // Record a payment: adds to what has been paid and optionally moves the next due date.
  r.post('/:weddingId/budget/expenses/:id/payments', member(db, 'edit'), (req, res) => {
    const e = db.get('SELECT * FROM expenses WHERE id = ? AND wedding_id = ?', req.params.id, req.weddingId);
    if (!e) throw new HttpError(404, 'Expense not found.');
    const paid = amount(req.body?.amount, 'amount', { allowNull: false });
    if (!paid) throw new HttpError(400, 'Enter how much you paid.', { fields: { amount: 'Required.' } });
    const next = req.body?.next_due_date === undefined ? e.due_date : date(req.body.next_due_date, 'next_due_date');
    const line = `${now().slice(0, 10)}: paid ${(paid / 100).toFixed(2)}${req.body?.note ? ` — ${text(req.body.note, 200)}` : ''}`;
    update(db, 'expenses', e.id, req.weddingId, { paid_minor: (e.paid_minor || 0) + paid, due_date: next, notes: [e.notes, line].filter(Boolean).join('\n').slice(-2000) });
    res.json({ ok: true });
  });

  r.delete('/:weddingId/budget/expenses/:id', member(db, 'edit'), (req, res) => {
    const out = db.run('DELETE FROM expenses WHERE id = ? AND wedding_id = ?', req.params.id, req.weddingId);
    if (!out.changes) throw new HttpError(404, 'Expense not found.');
    res.json({ ok: true });
  });

  // ----- Gifts
  r.post('/:weddingId/budget/gifts', member(db, 'edit'), (req, res) => {
    if (db.get('SELECT COUNT(*) AS n FROM gifts_received WHERE wedding_id = ?', req.weddingId).n >= 3000) throw new HttpError(400, 'You can log up to 3,000 gifts.');
    const f = cleanGift(db, req.weddingId, req.body || {});
    const id = uuid();
    const ts = now();
    db.run(`INSERT INTO gifts_received (id, wedding_id, guest_id, giver_name, gift_type, description, amount_minor, received_date, thank_you_sent_at, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, req.weddingId, f.guest_id, f.giver_name, f.gift_type, f.description, f.amount_minor, f.received_date, f.thank_you_sent_at ?? null, f.notes, ts, ts);
    track(db, 'gift_logged', { userId: req.user.id, weddingId: req.weddingId, props: { type: f.gift_type } });
    res.status(201).json({ id });
  });

  r.patch('/:weddingId/budget/gifts/:id', member(db, 'edit'), (req, res) => {
    const g = db.get('SELECT * FROM gifts_received WHERE id = ? AND wedding_id = ?', req.params.id, req.weddingId);
    if (!g) throw new HttpError(404, 'Gift not found.');
    update(db, 'gifts_received', g.id, req.weddingId, cleanGift(db, req.weddingId, req.body || {}, g));
    res.json({ ok: true });
  });

  r.delete('/:weddingId/budget/gifts/:id', member(db, 'edit'), (req, res) => {
    const out = db.run('DELETE FROM gifts_received WHERE id = ? AND wedding_id = ?', req.params.id, req.weddingId);
    if (!out.changes) throw new HttpError(404, 'Gift not found.');
    res.json({ ok: true });
  });

  // ----- Downloads
  const fileBase = (w) => (w.slug || 'wedding').replace(/[^a-z0-9-]/gi, '');

  r.get('/:weddingId/budget/tracker.xlsx', member(db), asyncHandler(async (req, res) => {
    const data = loadBudget(db, req.weddingId);
    const buf = await buildTrackerWorkbook({ ...data, platformName: ctx.config.platformName });
    track(db, 'budget_exported', { userId: req.user.id, weddingId: req.weddingId, props: { format: 'xlsx' } });
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="${fileBase(data.wedding)}-wedding-tracker.xlsx"`);
    res.send(Buffer.from(buf));
  }));

  r.get('/:weddingId/budget/expenses.csv', member(db), (req, res) => {
    const data = loadBudget(db, req.weddingId);
    const cat = new Map(data.categories.map((c) => [c.id, c.name]));
    const m = (v) => (v === null || v === undefined ? '' : (v / 100).toFixed(2));
    const rows = data.expenses.map((e) => [e.item, cat.get(e.category_id) || 'Uncategorised', e.vendor, e.vendor_contact, e.paid_by, m(e.estimated_minor), m(e.actual_minor), m(e.cost_minor), m(e.paid_minor), m(Math.max(0, e.cost_minor - e.paid_minor)), e.due_date || '', STATUS_LABELS[e.status], e.notes]);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${fileBase(data.wedding)}-expenses.csv"`);
    res.send('﻿' + toCsv(['Item', 'Category', 'Vendor', 'Vendor contact', 'Paid by', `Estimated (${data.settings.currency})`, 'Actual', 'Cost', 'Paid', 'Balance', 'Next due', 'Status', 'Notes'], rows));
  });

  r.get('/:weddingId/budget/gifts.csv', member(db), (req, res) => {
    const data = loadBudget(db, req.weddingId);
    const type = Object.fromEntries(GIFT_TYPES);
    const rows = data.gifts.map((g) => [g.giver_name, type[g.gift_type] || g.gift_type, g.description, g.amount_minor === null ? '' : (g.amount_minor / 100).toFixed(2), g.received_date || '', g.thank_you_sent_at ? 'Yes' : 'No', g.thank_you_sent_at ? g.thank_you_sent_at.slice(0, 10) : '', g.notes]);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${fileBase(data.wedding)}-gifts.csv"`);
    res.send('﻿' + toCsv(['From', 'Type', 'Description', `Amount (${data.settings.currency})`, 'Received on', 'Thank-you sent', 'Thank-you date', 'Notes'], rows));
  });

  return r;
}

// Free blank tracker anyone can download from the website (a useful marketing tool).
export function templateDownloadRoute(ctx) {
  const limiter = rateLimit({ windowMs: 60 * 60000, max: 30 });
  return [limiter, asyncHandler(async (req, res) => {
    const currency = CURRENCY_CODES.has(String(req.query.currency)) ? String(req.query.currency) : 'USD';
    const buf = await buildTrackerWorkbook({
      wedding: { partner1: '', partner2: '', wedding_date_local: null }, settings: { currency, total_budget_minor: 0 },
      categories: [], expenses: [], gifts: [], today: new Date().toISOString().slice(0, 10), blank: true, platformName: ctx.config.platformName
    });
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', 'attachment; filename="wedding-budget-and-gift-tracker.xlsx"');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(buf));
  })];
}
