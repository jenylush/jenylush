// Budget & gifts for the test version. Same calculations as the platform
// (shared/budget.js); data lives in this browser.
import { $, $$, esc, modal, toast, confirmDialog, setFieldErrors, copyText } from './local-api.js';
import * as B from './backend.js';
import { formatMoney, fromMinor, toMinor, STATUS_LABELS, budgetSummary, expenseCost, expenseStatus, CURRENCIES, PAID_BY, GIFT_TYPES, DEFAULT_CATEGORIES } from '../../platform/shared/budget.js';

const TABS = [['overview', 'Overview'], ['expenses', 'Expenses'], ['categories', 'Categories'], ['gifts', 'Gifts']];
let tab = 'overview';
let expFilter = { category: '', status: '', q: '' };
let giftFilter = 'all';

const bud = () => B.data().budget;
const shortDate = (s) => (s ? new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${s.slice(0, 10)}T00:00:00Z`)) : '');
const csvLine = (l) => l.map((v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : (v ?? ''))).join(',');

function snapshot() {
  const b = bud();
  const today = B.today();
  const expenses = b.expenses.map((e) => ({ ...e, cost_minor: expenseCost(e), status: expenseStatus(e, today) }))
    .sort((x, y) => (x.due_date || '9999').localeCompare(y.due_date || '9999'));
  const d = { settings: b.settings, categories: b.categories, expenses, gifts: [...b.gifts].sort((x, y) => (y.received_date || '').localeCompare(x.received_date || '')), today };
  d.summary = budgetSummary(d, today);
  return d;
}

function money(v, field, { required = false } = {}) {
  if (v === '' || v === null || v === undefined) {
    if (required) throw Object.assign(new Error('Enter an amount.'), { data: { fields: { [field]: 'Required.' } } });
    return null;
  }
  const m = toMinor(v);
  if (m === null || m < 0) throw Object.assign(new Error('Enter an amount of zero or more, using numbers only.'), { data: { fields: { [field]: 'Invalid amount.' } } });
  return m;
}

export function mountBudget(box, { compact = false, onOpen } = {}) {
  const draw = () => {
    if (!box.isConnected) return;
    const d = snapshot();
    const m = (v, o) => formatMoney(v, d.settings.currency, o);
    if (compact) {
      const s = d.summary, next = s.upcoming[0];
      box.innerHTML = `<h2 style="font-size:1.3rem;margin:0 0 8px">Budget</h2>${s.total ? `<p class="small" style="margin:0 0 6px"><strong class="money">${m(s.committed, { compact: true })}</strong> committed of <span class="money">${m(s.total, { compact: true })}</span> · <span class="money">${m(s.paid, { compact: true })}</span> paid</p>
        <div class="progress ${s.committed > s.total ? 'full' : s.committed > s.total * 0.9 ? 'warn' : ''}"><div style="width:${Math.min(100, s.used_pct || 0)}%"></div></div>
        ${s.overdue ? `<p class="small" style="color:var(--danger);margin:8px 0 0">⚠ ${s.overdue} overdue payment${s.overdue === 1 ? '' : 's'}</p>` : next ? `<p class="small muted" style="margin:8px 0 0">Next: ${esc(next.item)}, <span class="money">${m(next.balance)}</span> on ${esc(shortDate(next.due_date))}</p>` : ''}`
        : '<p class="small muted" style="margin:0 0 10px">Set a total budget to track spending, payment due dates and gifts.</p>'}<button class="btn btn-secondary btn-sm" type="button" data-open style="margin-top:10px">Open budget & gifts</button>`;
      $('[data-open]', box).addEventListener('click', () => onOpen?.());
      return;
    }
    box.innerHTML = `<div class="page-head"><div><h1>Budget & gifts</h1><p>Plan what you'll spend, track every payment before the wedding, and log gifts and thank-you notes after it.</p></div>
      <div class="export-bar"><button class="btn btn-secondary btn-sm" type="button" data-copy="exp">Copy expenses (CSV)</button><button class="btn btn-secondary btn-sm" type="button" data-copy="gift">Copy gifts (CSV)</button></div></div>
      <p class="notice info small" style="margin-bottom:14px">On the full platform this page also downloads an Excel workbook whose totals and “Overdue / Due soon” statuses keep updating by themselves. Here you can copy the data and paste it into Excel or Google Sheets.</p>
      ${d.summary.overdue ? `<p class="form-error" style="margin-bottom:16px" role="status">⚠ ${d.summary.overdue} payment${d.summary.overdue === 1 ? ' is' : 's are'} overdue (${m(d.summary.overdue_amount)} outstanding). <button class="link-btn" type="button" data-overdue>Show overdue</button></p>` : ''}
      <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}${k === 'expenses' ? ` <span class="badge">${d.expenses.length}</span>` : k === 'gifts' ? ` <span class="badge">${d.gifts.length}</span>` : ''}</button>`).join('')}</div><div id="tabc"></div>`;
    $$('[data-tab]', box).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; draw(); }));
    $('[data-overdue]', box)?.addEventListener('click', () => { tab = 'expenses'; expFilter = { category: '', status: 'overdue', q: '' }; draw(); });
    $$('[data-copy]', box).forEach((b) => b.addEventListener('click', () => {
      const cat = (id) => d.categories.find((c) => c.id === id)?.name || 'Uncategorised';
      const f = (v) => (v === null || v === undefined ? '' : (v / 100).toFixed(2));
      const type = Object.fromEntries(GIFT_TYPES);
      copyText(b.dataset.copy === 'exp'
        ? [csvLine(['Item', 'Category', 'Vendor', 'Paid by', 'Estimated', 'Actual', 'Cost', 'Paid', 'Balance', 'Next due', 'Status', 'Notes']), ...d.expenses.map((e) => csvLine([e.item, cat(e.category_id), e.vendor, e.paid_by, f(e.estimated_minor), f(e.actual_minor), f(e.cost_minor), f(e.paid_minor), f(Math.max(0, e.cost_minor - e.paid_minor)), e.due_date || '', STATUS_LABELS[e.status], e.notes]))].join('\n')
        : [csvLine(['From', 'Type', 'Description', 'Amount', 'Received', 'Thank-you sent']), ...d.gifts.map((g) => csvLine([g.giver_name, type[g.gift_type], g.description, f(g.amount_minor), g.received_date || '', g.thank_you_sent_at ? 'Yes' : 'No']))].join('\n'));
    }));
    ({ overview, expenses, categories, gifts })[tab]($('#tabc', box), d, m, draw);
  };
  draw();
  return draw;
}

function overview(box, d, m, draw) {
  const s = d.summary;
  const noBudget = !d.settings.total_budget_minor;
  const max = Math.max(1, ...s.categories.map((c) => Math.max(c.planned_minor || 0, c.committed)));
  const sc = (v) => Math.min(100, (v / max) * 100);
  box.innerHTML = `<div class="stack">${noBudget ? '' : `<div class="budget-stats">
      <div class="stat"><strong class="money">${m(s.total, { compact: true })}</strong><span>Total budget</span></div>
      <div class="stat rose"><strong class="money">${m(s.committed, { compact: true })}</strong><span>Committed${s.used_pct !== null ? ` · ${s.used_pct}% of budget` : ''}</span></div>
      <div class="stat green"><strong class="money">${m(s.paid, { compact: true })}</strong><span>Paid so far · ${m(s.outstanding, { compact: true })} still to pay</span></div>
      <div class="stat ${s.remaining < 0 ? 'neg' : 'gold'}"><strong class="money">${m(s.remaining, { compact: true })}</strong><span>${s.remaining < 0 ? 'Over budget' : 'Left in budget'}</span></div></div>`}
    <div class="dash-grid"><div class="stack">
      ${noBudget ? '' : `<section class="card"><div class="row between"><h2 style="font-size:1.4rem;margin:0">Spending by category</h2><div class="meter-legend" aria-hidden="true"><span><i style="background:var(--brand)"></i>Paid</span><span><i style="background:#d9a5a9"></i>Booked, not yet paid</span><span><i style="background:var(--paper-2);border:1px solid var(--line-2)"></i>Planned</span></div></div>
        <div class="cat-meters" style="margin-top:16px">${s.categories.filter((c) => c.planned_minor || c.committed).map((c) => `<div class="meter-row" title="${esc(c.name)}: ${esc(m(c.paid))} paid, ${esc(m(c.committed))} booked, ${esc(m(c.planned_minor))} planned"><span>${esc(c.name)}</span>
          <div class="meter${c.over ? ' over' : ''}" role="img" aria-label="${esc(c.name)}: ${esc(m(c.committed))} booked of ${esc(m(c.planned_minor))} planned, ${esc(m(c.paid))} paid"><span class="planned" style="width:${sc(c.planned_minor || 0)}%"></span><span class="committed" style="width:${sc(c.committed)}%"></span><span class="paid" style="width:${sc(c.paid)}%"></span></div>
          <span class="small money">${m(c.committed, { compact: true })} <span class="muted">of ${m(c.planned_minor, { compact: true })}</span>${c.over ? ' <span class="badge red">▲ Over</span>' : ''}</span></div>`).join('') || '<p class="muted small">Add planned amounts on the Categories tab, or add your first expense.</p>'}</div></section>`}
      <section class="card"><div class="row between"><h2 style="font-size:1.4rem;margin:0">Coming up</h2><button class="btn btn-primary btn-sm" type="button" data-add>＋ Add expense</button></div>
        ${s.upcoming.length ? `<ul class="stack-sm" style="list-style:none;padding:0;margin:14px 0 0">${s.upcoming.map((e) => `<li class="row between" style="border-bottom:1px solid var(--line);padding-bottom:10px"><span><strong>${esc(e.item)}</strong>${e.vendor ? ` <span class="muted small">· ${esc(e.vendor)}</span>` : ''}<br><span class="small">${esc(shortDate(e.due_date))} · <span class="badge status-${e.status}">${STATUS_LABELS[e.status]}</span></span></span><span class="row"><span class="money">${m(e.balance)}</span><button class="btn btn-secondary btn-sm" type="button" data-pay="${e.id}">Record payment</button></span></li>`).join('')}</ul>`
          : `<p class="muted small" style="margin-top:12px">${d.expenses.length ? 'No upcoming payments with a due date.' : 'Add your first booking (venue, caterer, photographer…) with its due date, and upcoming payments will appear here.'}</p>`}</section>
    </div><aside class="stack">
      <section class="card stack"><h2 style="font-size:1.3rem;margin:0">${noBudget ? 'Start with your total budget' : 'Budget settings'}</h2>
        <form class="stack-sm" id="bs" novalidate><label class="field"><span>Currency</span><select name="currency" id="b-cur">${CURRENCIES.map(([c, sym, n]) => `<option value="${c}" ${c === d.settings.currency ? 'selected' : ''}>${esc(sym)} ${c} — ${esc(n)}</option>`).join('')}</select></label>
          <label class="field"><span>Total budget</span><input type="number" name="total" min="0" step="0.01" inputmode="decimal" id="b-total" value="${fromMinor(d.settings.total_budget_minor) || ''}" placeholder="e.g. 5000000"></label>
          <label class="switch"><input type="checkbox" name="rem" ${d.settings.reminders_enabled ? 'checked' : ''}> Email us before payments are due <span class="tiny muted">(full platform)</span></label>
          <button class="btn btn-primary btn-sm" type="submit" style="justify-self:start">Save</button></form>
        ${!noBudget && s.unallocated !== 0 ? `<p class="small ${s.unallocated < 0 ? 'form-error' : 'muted'}" style="margin:0">${s.unallocated > 0 ? `${m(s.unallocated)} isn't assigned to a category yet.` : `Your category plans add up to ${m(-s.unallocated)} more than your total budget.`} <button class="link-btn" type="button" data-split>Use the suggested split</button></p>` : ''}</section>
      <section class="card stack-sm"><h2 style="font-size:1.3rem;margin:0">Gifts</h2><p class="small" style="margin:0">${s.gifts.count} gift${s.gifts.count === 1 ? '' : 's'} logged · <span class="money">${m(s.gifts.total)}</span> in total, <span class="money">${m(s.gifts.cash)}</span> in cash and transfers.</p>
        ${s.gifts.thank_you_pending ? `<p class="notice warn small" style="margin:0">${s.gifts.thank_you_pending} thank-you note${s.gifts.thank_you_pending === 1 ? '' : 's'} still to send.</p>` : ''}
        ${s.gifts.cash ? `<p class="small muted" style="margin:0">Net wedding cost after cash gifts: <strong class="money">${m(s.net_cost)}</strong></p>` : ''}<button class="btn btn-secondary btn-sm" type="button" data-gifts style="justify-self:start">Open gift list</button></section>
    </aside></div></div>`;
  $('#bs', box).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    let total;
    try { total = money(f.total.value || 0, 'total'); } catch (err) { setFieldErrors(f, err.data.fields); return toast(err.message, 'error'); }
    const first = !d.settings.total_budget_minor && total > 0;
    Object.assign(bud().settings, { currency: f.currency.value, total_budget_minor: total, reminders_enabled: f.rem.checked });
    B.persist(); toast('Budget saved', 'success');
    if (first && !bud().categories.some((c) => c.planned_minor)) await split(draw); else draw();
  });
  $('[data-split]', box)?.addEventListener('click', () => split(draw));
  $('[data-add]', box).addEventListener('click', () => editExpense(null, d, draw));
  $$('[data-pay]', box).forEach((b) => b.addEventListener('click', () => pay(d.expenses.find((e) => e.id === b.dataset.pay), d, draw)));
  $('[data-gifts]', box).addEventListener('click', () => { tab = 'gifts'; draw(); });
}

async function split(draw) {
  if (!await confirmDialog('Spread your total budget across your categories using a typical split (venue 20%, catering 25%, photography 10%…)? You can adjust each amount afterwards.', { title: 'Suggest a split?', confirmLabel: 'Use suggested split' })) return draw();
  const total = bud().settings.total_budget_minor;
  const pct = new Map(DEFAULT_CATEGORIES);
  const known = bud().categories.filter((c) => pct.has(c.name));
  const sum = known.reduce((s, c) => s + pct.get(c.name), 0) || 1;
  known.forEach((c) => { c.planned_minor = Math.round(total * pct.get(c.name) / sum); });
  B.persist(); toast('Budget split across categories', 'success'); draw();
}

function expenses(box, d, m, draw) {
  const q = expFilter.q.toLowerCase();
  const catName = (id) => d.categories.find((c) => c.id === id)?.name || 'Uncategorised';
  const rows = d.expenses.filter((e) => (!expFilter.category || (e.category_id || '') === expFilter.category) && (!expFilter.status || e.status === expFilter.status) && (!q || `${e.item} ${e.vendor} ${e.notes}`.toLowerCase().includes(q)));
  const tot = (k) => rows.reduce((s, e) => s + (k === 'bal' ? Math.max(0, e.cost_minor - e.paid_minor) : e[k] || 0), 0);
  box.innerHTML = `<div class="row between" style="margin-bottom:12px"><div class="row">
      <label><span class="sr-only">Search</span><input type="search" id="eq" placeholder="Search item, vendor or notes" value="${esc(expFilter.q)}" style="max-width:240px"></label>
      <label><span class="sr-only">Category</span><select id="ec"><option value="">All categories</option>${d.categories.map((c) => `<option value="${c.id}" ${expFilter.category === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <label><span class="sr-only">Status</span><select id="es"><option value="">Any status</option>${Object.entries(STATUS_LABELS).map(([k, l]) => `<option value="${k}" ${expFilter.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <button class="btn btn-primary btn-sm" type="button" id="ea">＋ Add expense</button></div>
    ${d.expenses.length ? `<div class="table-wrap"><table><thead><tr><th>Item</th><th>Category</th><th>Cost</th><th>Paid</th><th>Balance</th><th>Next due</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows.map((e) => `<tr>
      <td><strong>${esc(e.item)}</strong>${e.vendor ? `<div class="tiny muted">${esc(e.vendor)}</div>` : ''}${e.paid_by && e.paid_by !== 'Us' ? `<div class="tiny muted">Paid by ${esc(e.paid_by)}</div>` : ''}</td><td class="small">${esc(catName(e.category_id))}</td>
      <td class="money">${m(e.cost_minor)}${e.actual_minor === null && e.estimated_minor !== null ? '<div class="tiny muted">estimate</div>' : ''}</td><td class="money">${m(e.paid_minor)}</td><td class="money">${m(Math.max(0, e.cost_minor - e.paid_minor))}</td>
      <td class="small">${esc(shortDate(e.due_date)) || '<span class="muted">—</span>'}</td><td><span class="badge status-${e.status}">${e.status === 'overdue' ? '⚠ ' : e.status === 'paid' ? '✓ ' : ''}${STATUS_LABELS[e.status]}</span></td>
      <td><div class="row" style="gap:2px;flex-wrap:nowrap">${e.status !== 'paid' ? `<button class="btn btn-ghost btn-sm" type="button" data-pay="${e.id}">Pay</button>` : ''}<button class="btn btn-ghost btn-icon" type="button" data-edit="${e.id}" aria-label="Edit ${esc(e.item)}">✎</button><button class="btn btn-ghost btn-icon" type="button" data-del="${e.id}" aria-label="Delete ${esc(e.item)}">🗑</button></div></td></tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="2">${rows.length === d.expenses.length ? 'Total' : `Total of ${rows.length} shown`}</th><th class="money">${m(tot('cost_minor'))}</th><th class="money">${m(tot('paid_minor'))}</th><th class="money">${m(tot('bal'))}</th><th colspan="3"></th></tr></tfoot></table>${rows.length ? '' : '<div class="empty"><p>No expenses match these filters.</p></div>'}</div>`
      : '<div class="card empty"><h3>No expenses yet</h3><p>Add each booking or purchase: what it is, the estimate or agreed price, what you have paid and when the next payment is due.</p></div>'}`;
  $('#eq', box).addEventListener('input', (e) => { expFilter.q = e.target.value; const p = e.target.selectionStart; draw(); const el = $('#eq'); el.focus(); el.setSelectionRange(p, p); });
  $('#ec', box).addEventListener('change', (e) => { expFilter.category = e.target.value; draw(); });
  $('#es', box).addEventListener('change', (e) => { expFilter.status = e.target.value; draw(); });
  $('#ea', box).addEventListener('click', () => editExpense(null, d, draw));
  $$('[data-edit]', box).forEach((b) => b.addEventListener('click', () => editExpense(bud().expenses.find((e) => e.id === b.dataset.edit), d, draw)));
  $$('[data-pay]', box).forEach((b) => b.addEventListener('click', () => pay(d.expenses.find((e) => e.id === b.dataset.pay), d, draw)));
  $$('[data-del]', box).forEach((b) => b.addEventListener('click', async () => {
    const e = bud().expenses.find((x) => x.id === b.dataset.del);
    if (!await confirmDialog(`Delete “${e.item}” from your budget?`, { title: 'Delete expense?', confirmLabel: 'Delete', danger: true })) return;
    bud().expenses = bud().expenses.filter((x) => x.id !== e.id); B.persist(); draw();
  }));
}

const moneyField = (name, label, value, hint = '') => `<label class="field"><span>${label}${hint ? ` <span class="hint">${hint}</span>` : ''}</span><input type="number" name="${name}" min="0" step="0.01" inputmode="decimal" value="${value === null || value === undefined ? '' : fromMinor(value)}"></label>`;

function formModal(title, form, submitLabel, onSubmit) {
  modal({ title, body: form, wide: true, actions: [{ label: 'Cancel' }, { label: submitLabel, className: 'btn-primary', onClick: () => {
    try { onSubmit(); return true; } catch (err) { const b = $('.form-error', form); b.textContent = err.message; b.hidden = false; setFieldErrors(form, err.data?.fields); return false; }
  } }] });
}

function editExpense(e, d, draw) {
  const form = document.createElement('form');
  form.className = 'stack'; form.noValidate = true;
  form.innerHTML = `<label class="field"><span>What is it for?</span><input type="text" name="item" maxlength="200" value="${esc(e?.item || '')}" placeholder="e.g. Reception hall, Photographer deposit"></label>
    <div class="grid-2"><label class="field"><span>Category</span><select name="category_id"><option value="">Uncategorised</option>${d.categories.map((c) => `<option value="${c.id}" ${e?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <label class="field"><span>Paid by</span><input type="text" name="paid_by" list="pb" maxlength="60" value="${esc(e?.paid_by || 'Us')}"><datalist id="pb">${PAID_BY.map((p) => `<option value="${esc(p)}">`).join('')}</datalist></label></div>
    <label class="field"><span>Vendor</span><input type="text" name="vendor" maxlength="200" value="${esc(e?.vendor || '')}"></label>
    <div class="grid-2">${moneyField('estimated', 'Estimated cost', e?.estimated_minor)}${moneyField('actual', 'Actual cost', e?.actual_minor, 'once agreed')}</div>
    <div class="grid-2">${moneyField('paid', 'Paid so far', e?.paid_minor ?? 0)}<label class="field"><span>Next payment due</span><input type="date" name="due_date" value="${esc(e?.due_date || '')}"></label></div>
    <label class="field"><span>Notes</span><textarea name="notes" rows="2" maxlength="2000">${esc(e?.notes || '')}</textarea></label><p class="form-error" role="alert" hidden></p>`;
  formModal(e ? 'Edit expense' : 'Add an expense', form, e ? 'Save' : 'Add expense', () => {
    const f = Object.fromEntries(new FormData(form));
    if (!f.item.trim()) throw Object.assign(new Error('Say what the expense is for.'), { data: { fields: { item: 'Required.' } } });
    const vals = { item: f.item.trim(), category_id: f.category_id || null, paid_by: f.paid_by || 'Us', vendor: f.vendor.trim(), estimated_minor: money(f.estimated, 'estimated'), actual_minor: money(f.actual, 'actual'), paid_minor: money(f.paid, 'paid') ?? 0, due_date: f.due_date || null, notes: f.notes };
    if (e) Object.assign(e, vals); else bud().expenses.push({ id: B.uid(), ...vals });
    B.persist(); toast(e ? 'Expense updated' : 'Expense added', 'success'); draw();
  });
  setTimeout(() => form.querySelector('[name=item]').focus(), 50);
}

function pay(e, d, draw) {
  const m = (v) => formatMoney(v, d.settings.currency);
  const bal = Math.max(0, e.cost_minor - e.paid_minor);
  const form = document.createElement('form');
  form.className = 'stack'; form.noValidate = true;
  form.innerHTML = `<p style="margin:0"><strong>${esc(e.item)}</strong> · ${m(e.paid_minor)} paid of ${m(e.cost_minor)}, <strong>${m(bal)}</strong> left.</p>
    <div class="grid-2">${moneyField('amount', 'Amount paid now', bal)}<label class="field"><span>Next payment due <span class="hint">empty if fully paid</span></span><input type="date" name="next"></label></div>
    <label class="field"><span>Note <span class="hint">optional</span></span><input type="text" name="note" maxlength="200"></label><p class="form-error" role="alert" hidden></p>`;
  formModal('Record a payment', form, 'Save payment', () => {
    const amt = money(form.elements.amount.value, 'amount', { required: true });
    if (!amt) throw Object.assign(new Error('Enter how much you paid.'), { data: { fields: { amount: 'Required.' } } });
    const x = bud().expenses.find((y) => y.id === e.id);
    x.paid_minor = (x.paid_minor || 0) + amt;
    x.due_date = form.elements.next.value || null;
    x.notes = [x.notes, `${new Date().toISOString().slice(0, 10)}: paid ${(amt / 100).toFixed(2)}${form.elements.note.value ? ` — ${form.elements.note.value}` : ''}`].filter(Boolean).join('\n');
    B.persist(); toast('Payment recorded', 'success'); draw();
  });
}

function categories(box, d, m, draw) {
  const s = d.summary;
  box.innerHTML = `<div class="row between" style="margin-bottom:12px"><p class="small muted" style="margin:0">Planned in categories: <strong class="money">${m(s.planned)}</strong> of your <span class="money">${m(s.total)}</span> budget.</p>
    <div class="row"><button class="btn btn-secondary btn-sm" type="button" data-split>Use suggested split</button><button class="btn btn-primary btn-sm" type="button" id="ca">＋ Add category</button></div></div>
    <div class="table-wrap"><table><thead><tr><th>Category</th><th>Planned</th><th>Booked</th><th>Paid</th><th>Left</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${s.categories.map((c) => `<tr data-cat="${c.id}">
      <td><label><span class="sr-only">Name</span><input class="inline-input" type="text" data-k="name" value="${esc(c.name)}" maxlength="80"></label></td>
      <td><label><span class="sr-only">Planned for ${esc(c.name)}</span><input class="inline-input" type="number" min="0" step="0.01" data-k="planned" value="${fromMinor(c.planned_minor) || ''}" placeholder="0"></label></td>
      <td class="money">${m(c.committed)}</td><td class="money">${m(c.paid)}</td><td class="money" ${c.remaining < 0 ? 'style="color:var(--danger);font-weight:600"' : ''}>${c.remaining < 0 ? '▲ ' : ''}${m(c.remaining)}</td>
      <td><button class="btn btn-ghost btn-icon" type="button" data-dc="${c.id}" aria-label="Delete ${esc(c.name)}">🗑</button></td></tr>`).join('')}</tbody></table></div>
    <p class="small muted">Changes save when you leave a field. Deleting a category keeps its expenses (they become “Uncategorised”).</p>`;
  $('[data-split]', box).addEventListener('click', () => (bud().settings.total_budget_minor ? split(draw) : toast('Set your total budget on the Overview tab first.', 'error')));
  $('#ca', box).addEventListener('click', () => { bud().categories.push({ id: B.uid(), name: 'New category', planned_minor: 0, position: bud().categories.length }); B.persist(); draw(); });
  $$('[data-cat] [data-k]', box).forEach((inp) => inp.addEventListener('change', () => {
    const c = bud().categories.find((x) => x.id === inp.closest('[data-cat]').dataset.cat);
    if (inp.dataset.k === 'name') c.name = inp.value.trim() || c.name; else c.planned_minor = toMinor(inp.value) || 0;
    B.persist(); draw();
  }));
  $$('[data-dc]', box).forEach((b) => b.addEventListener('click', async () => {
    const c = bud().categories.find((x) => x.id === b.dataset.dc);
    if (!await confirmDialog(`Delete the “${c.name}” category? Its expenses are kept as Uncategorised.`, { title: 'Delete category?', confirmLabel: 'Delete', danger: true })) return;
    bud().categories = bud().categories.filter((x) => x.id !== c.id);
    bud().expenses.forEach((e) => { if (e.category_id === c.id) e.category_id = null; });
    B.persist(); draw();
  }));
}

function gifts(box, d, m, draw) {
  const s = d.summary.gifts;
  const type = Object.fromEntries(GIFT_TYPES);
  const rows = d.gifts.filter((g) => giftFilter === 'all' || (giftFilter === 'pending' ? !g.thank_you_sent_at : !!g.thank_you_sent_at));
  box.innerHTML = `<div class="budget-stats" style="margin-bottom:16px"><div class="stat"><strong>${s.count}</strong><span>Gifts logged</span></div><div class="stat green"><strong class="money">${m(s.total, { compact: true })}</strong><span>Total value</span></div><div class="stat"><strong class="money">${m(s.cash, { compact: true })}</strong><span>Cash & transfers</span></div><div class="stat ${s.thank_you_pending ? 'gold' : 'green'}"><strong>${s.thank_you_pending}</strong><span>Thank-you notes to send</span></div></div>
    <div class="row between" style="margin-bottom:12px"><div class="preview-toggle" role="group" aria-label="Filter gifts">${[['all', 'All'], ['pending', 'Thank-you to send'], ['done', 'Thanked']].map(([k, l]) => `<button type="button" data-gf="${k}" aria-pressed="${giftFilter === k}">${l}</button>`).join('')}</div><button class="btn btn-primary btn-sm" type="button" id="ga">＋ Log a gift</button></div>
    ${d.gifts.length ? `<div class="table-wrap"><table><thead><tr><th>From</th><th>Gift</th><th>Value</th><th>Received</th><th>Thank-you sent</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows.map((g) => `<tr><td><strong>${esc(g.giver_name)}</strong></td><td class="small">${esc(type[g.gift_type] || g.gift_type)}${g.description ? ` · ${esc(g.description)}` : ''}</td>
      <td class="money">${g.amount_minor === null ? '<span class="muted">—</span>' : m(g.amount_minor)}</td><td class="small">${esc(shortDate(g.received_date))}</td>
      <td><label class="switch"><input type="checkbox" data-ty="${g.id}" ${g.thank_you_sent_at ? 'checked' : ''}> <span class="small">${g.thank_you_sent_at ? esc(shortDate(g.thank_you_sent_at)) : 'Not yet'}</span></label></td>
      <td><div class="row" style="gap:2px;flex-wrap:nowrap"><button class="btn btn-ghost btn-icon" type="button" data-eg="${g.id}" aria-label="Edit">✎</button><button class="btn btn-ghost btn-icon" type="button" data-dg="${g.id}" aria-label="Delete">🗑</button></div></td></tr>`).join('')}</tbody></table>${rows.length ? '' : '<div class="empty"><p>Nothing here.</p></div>'}</div>`
      : '<div class="card empty"><h3>No gifts logged yet</h3><p>After the wedding, log each gift as you open it, then tick off thank-you notes as you send them.</p></div>'}`;
  $$('[data-gf]', box).forEach((b) => b.addEventListener('click', () => { giftFilter = b.dataset.gf; draw(); }));
  $('#ga', box).addEventListener('click', () => editGift(null, draw));
  $$('[data-eg]', box).forEach((b) => b.addEventListener('click', () => editGift(bud().gifts.find((g) => g.id === b.dataset.eg), draw)));
  $$('[data-ty]', box).forEach((cb) => cb.addEventListener('change', () => { const g = bud().gifts.find((x) => x.id === cb.dataset.ty); g.thank_you_sent_at = cb.checked ? new Date().toISOString().slice(0, 10) : null; B.persist(); draw(); }));
  $$('[data-dg]', box).forEach((b) => b.addEventListener('click', async () => { if (!await confirmDialog('Delete this gift from your list?', { title: 'Delete gift?', confirmLabel: 'Delete', danger: true })) return; bud().gifts = bud().gifts.filter((g) => g.id !== b.dataset.dg); B.persist(); draw(); }));
}

function editGift(g, draw) {
  const guests = B.data().guests;
  const form = document.createElement('form');
  form.className = 'stack'; form.noValidate = true;
  form.innerHTML = `<div class="grid-2"><label class="field"><span>From a guest on your list</span><select name="guest_id"><option value="">— Someone else —</option>${guests.map((x) => `<option value="${x.id}" ${g?.guest_id === x.id ? 'selected' : ''}>${esc(`${x.first_name} ${x.last_name}`.trim())}</option>`).join('')}</select></label>
    <label class="field"><span>Name(s)</span><input type="text" name="giver_name" maxlength="200" value="${esc(g?.giver_name || '')}" placeholder="e.g. Uncle Tunde & family"></label></div>
    <div class="grid-2"><label class="field"><span>Type</span><select name="gift_type">${GIFT_TYPES.map(([k, l]) => `<option value="${k}" ${(g?.gift_type || 'cash') === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>${moneyField('amount', 'Amount or value', g?.amount_minor, 'optional for items')}</div>
    <label class="field"><span>Description</span><input type="text" name="description" maxlength="300" value="${esc(g?.description || '')}" placeholder="e.g. Stand mixer"></label>
    <div class="grid-2"><label class="field"><span>Received on</span><input type="date" name="received_date" value="${esc(g?.received_date || B.today())}"></label><label class="switch" style="align-self:end"><input type="checkbox" name="ty" ${g?.thank_you_sent_at ? 'checked' : ''}> Thank-you sent</label></div><p class="form-error" role="alert" hidden></p>`;
  form.elements.guest_id.addEventListener('change', (e) => { const x = guests.find((y) => y.id === e.target.value); if (x && !form.elements.giver_name.value) form.elements.giver_name.value = `${x.first_name} ${x.last_name}`.trim(); });
  formModal(g ? 'Edit gift' : 'Log a gift', form, g ? 'Save' : 'Add gift', () => {
    const f = Object.fromEntries(new FormData(form));
    if (!f.giver_name.trim()) throw Object.assign(new Error('Who is the gift from?'), { data: { fields: { giver_name: 'Required.' } } });
    const vals = { guest_id: f.guest_id || null, giver_name: f.giver_name.trim(), gift_type: f.gift_type, description: f.description, amount_minor: money(f.amount, 'amount'), received_date: f.received_date || null, thank_you_sent_at: form.elements.ty.checked ? (g?.thank_you_sent_at || new Date().toISOString().slice(0, 10)) : null };
    if (g) Object.assign(g, vals); else bud().gifts.push({ id: B.uid(), notes: '', ...vals });
    B.persist(); toast(g ? 'Gift updated' : 'Gift logged', 'success'); draw();
  });
}
