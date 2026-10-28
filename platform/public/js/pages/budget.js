import { api, $, $$, esc, appChrome, currentWedding, modal, toast, showError, confirmDialog, setFieldErrors } from '../api.js';
import { formatMoney, fromMinor, STATUS_LABELS, budgetSummary } from '/shared/budget.js';

const summary0 = await currentWedding();
const wid = summary0.wedding.id;
await appChrome({ weddingId: wid });
document.title = `Budget & gifts — ${summary0.wedding.names}`;

const TABS = [['overview', 'Overview'], ['expenses', 'Expenses'], ['categories', 'Categories'], ['gifts', 'Gifts']];
let tab = TABS.some(([k]) => k === location.hash.slice(1)) ? location.hash.slice(1) : 'overview';
let d;               // data from the API
let expFilter = { category: '', status: '', q: '' };
let giftFilter = 'all';

const m = (minor, opts) => formatMoney(minor, d.settings.currency, opts);
const catName = (id) => d.categories.find((c) => c.id === id)?.name || 'Uncategorised';
const shortDate = (s) => (s ? new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${s.slice(0, 10)}T00:00:00Z`)) : '');

async function load() {
  d = await api('GET', `/api/weddings/${wid}/budget`);
  d.summary = budgetSummary(d, d.today); // same maths as the server and the spreadsheet
  render();
}

function render() {
  const s = d.summary;
  $('#main').innerHTML = `
    <div class="page-head"><div><h1>Budget & gifts</h1><p>Plan what you'll spend, track every payment before the wedding, and log gifts and thank-you notes after it.</p></div>
      <div class="export-bar"><a class="btn btn-primary btn-sm" href="/api/weddings/${wid}/budget/tracker.xlsx" data-export="xlsx">Download spreadsheet (.xlsx)</a>
      <a class="btn btn-secondary btn-sm" href="/api/weddings/${wid}/budget/expenses.csv">Expenses CSV</a><a class="btn btn-secondary btn-sm" href="/api/weddings/${wid}/budget/gifts.csv">Gifts CSV</a></div></div>
    ${s.overdue ? `<p class="form-error" style="margin-bottom:16px" role="status">⚠ ${s.overdue} payment${s.overdue === 1 ? ' is' : 's are'} overdue (${m(s.overdue_amount)} outstanding). <button class="link-btn" type="button" data-goto-overdue>Show overdue</button></p>` : ''}
    <div class="tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}${k === 'expenses' ? ` <span class="badge">${d.expenses.length}</span>` : k === 'gifts' ? ` <span class="badge">${d.gifts.length}</span>` : ''}</button>`).join('')}</div>
    <div id="tab"></div>`;
  $$('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; history.replaceState(null, '', `#${tab}`); render(); }));
  $('[data-goto-overdue]')?.addEventListener('click', () => { tab = 'expenses'; expFilter = { category: '', status: 'overdue', q: '' }; render(); });
  ({ overview, expenses, categories, gifts })[tab]($('#tab'));
}

// ---------------------------------------------------------------- overview
function overview(box) {
  const s = d.summary;
  const noBudget = !d.settings.total_budget_minor;
  const plannedMax = Math.max(1, ...s.categories.map((c) => Math.max(c.planned_minor || 0, c.committed)));
  box.innerHTML = `<div class="stack">
    ${noBudget ? '' : `<div class="budget-stats">
      <div class="stat"><strong class="money">${m(s.total, { compact: true })}</strong><span>Total budget</span></div>
      <div class="stat rose"><strong class="money">${m(s.committed, { compact: true })}</strong><span>Committed${s.used_pct !== null ? ` · ${s.used_pct}% of budget` : ''}</span></div>
      <div class="stat green"><strong class="money">${m(s.paid, { compact: true })}</strong><span>Paid so far · ${m(s.outstanding, { compact: true })} still to pay</span></div>
      <div class="stat ${s.remaining < 0 ? 'neg' : 'gold'}"><strong class="money">${m(s.remaining, { compact: true })}</strong><span>${s.remaining < 0 ? 'Over budget' : 'Left in budget'}</span></div>
    </div>`}
    <div class="dash-grid">
      <div class="stack">
        ${noBudget ? '' : `<section class="card" aria-labelledby="cat-h"><div class="row between"><h2 id="cat-h" style="font-size:1.4rem;margin:0">Spending by category</h2>
          <div class="meter-legend" aria-hidden="true"><span><i style="background:var(--brand)"></i>Paid</span><span><i style="background:#d9a5a9"></i>Booked, not yet paid</span><span><i style="background:var(--paper-2);border:1px solid var(--line-2)"></i>Planned</span></div></div>
          <div class="cat-meters" style="margin-top:16px">${s.categories.filter((c) => c.planned_minor || c.committed).map((c) => {
            const scale = (v) => Math.min(100, (v / plannedMax) * 100);
            return `<div class="meter-row" title="${esc(c.name)}: ${esc(m(c.paid))} paid, ${esc(m(c.committed))} booked, ${esc(m(c.planned_minor))} planned">
              <span>${esc(c.name)}</span>
              <div class="meter${c.over ? ' over' : ''}" role="img" aria-label="${esc(c.name)}: ${esc(m(c.committed))} booked of ${esc(m(c.planned_minor))} planned, ${esc(m(c.paid))} paid">
                <span class="planned" style="width:${scale(c.planned_minor || 0)}%"></span>
                <span class="committed" style="width:${scale(c.committed)}%"></span><span class="paid" style="width:${scale(c.paid)}%"></span></div>
              <span class="small money">${m(c.committed, { compact: true })} <span class="muted">of ${m(c.planned_minor, { compact: true })}</span>${c.over ? ' <span class="badge red">▲ Over</span>' : ''}</span></div>`;
          }).join('') || '<p class="muted small">Add planned amounts on the Categories tab or add your first expense.</p>'}</div></section>`}

        <section class="card" aria-labelledby="up-h"><div class="row between"><h2 id="up-h" style="font-size:1.4rem;margin:0">Coming up</h2>${d.can_edit ? '<button class="btn btn-primary btn-sm" type="button" data-add-expense>＋ Add expense</button>' : ''}</div>
          ${s.upcoming.length ? `<ul class="stack-sm" style="list-style:none;padding:0;margin:14px 0 0">${s.upcoming.map((e) => `<li class="row between" style="border-bottom:1px solid var(--line);padding-bottom:10px">
            <span><strong>${esc(e.item)}</strong>${e.vendor ? ` <span class="muted small">· ${esc(e.vendor)}</span>` : ''}<br><span class="small">${esc(shortDate(e.due_date))} · <span class="badge status-${e.status}">${STATUS_LABELS[e.status]}</span></span></span>
            <span class="row"><span class="money">${m(e.balance)}</span>${d.can_edit ? `<button class="btn btn-secondary btn-sm" type="button" data-pay="${e.id}">Record payment</button>` : ''}</span></li>`).join('')}</ul>`
            : `<p class="muted small" style="margin-top:12px">${d.expenses.length ? 'No upcoming payments with a due date.' : 'Add your first booking (venue, caterer, photographer…) with its due date, and upcoming payments will appear here.'}</p>`}
        </section>
      </div>
      <aside class="stack">
        <section class="card stack" aria-labelledby="set-h"><h2 id="set-h" style="font-size:1.3rem;margin:0">${noBudget ? 'Start with your total budget' : 'Budget settings'}</h2>
          <form class="stack-sm" id="f-settings" novalidate>
            <div class="stack-sm"><label class="field"><span>Currency</span><select name="currency" ${d.can_edit ? '' : 'disabled'}>${d.options.currencies.map(([c, sym, name]) => `<option value="${c}" ${c === d.settings.currency ? 'selected' : ''}>${esc(sym)} ${esc(c)} — ${esc(name)}</option>`).join('')}</select></label>
            <label class="field"><span>Total budget</span><input type="number" name="total_budget" min="0" step="0.01" inputmode="decimal" value="${fromMinor(d.settings.total_budget_minor) || ''}" placeholder="e.g. 5000000" ${d.can_edit ? '' : 'disabled'}></label></div>
            <label class="switch"><input type="checkbox" name="reminders_enabled" ${d.settings.reminders_enabled ? 'checked' : ''} ${d.can_edit ? '' : 'disabled'}> Email us 3 days before a payment is due, and on the day</label>
            ${d.can_edit ? '<button class="btn btn-primary btn-sm" type="submit" style="justify-self:start">Save</button>' : ''}
          </form>
          ${!noBudget && s.unallocated !== 0 ? `<p class="small ${s.unallocated < 0 ? 'form-error' : 'muted'}" style="margin:0">${s.unallocated > 0 ? `${m(s.unallocated)} isn't assigned to a category yet.` : `Your category plans add up to ${m(-s.unallocated)} more than your total budget.`} ${d.can_edit ? '<button class="link-btn" type="button" data-split>Use the suggested split</button>' : ''}</p>` : ''}
        </section>
        <section class="card stack-sm" aria-labelledby="g-h"><h2 id="g-h" style="font-size:1.3rem;margin:0">Gifts</h2>
          <p class="small" style="margin:0">${s.gifts.count} gift${s.gifts.count === 1 ? '' : 's'} logged · <span class="money">${m(s.gifts.total)}</span> in total, <span class="money">${m(s.gifts.cash)}</span> in cash and transfers.</p>
          ${s.gifts.thank_you_pending ? `<p class="notice warn small" style="margin:0">${s.gifts.thank_you_pending} thank-you note${s.gifts.thank_you_pending === 1 ? '' : 's'} still to send.</p>` : ''}
          ${s.gifts.cash ? `<p class="small muted" style="margin:0">Net wedding cost after cash gifts: <strong class="money">${m(s.net_cost)}</strong></p>` : ''}
          <button class="btn btn-secondary btn-sm" type="button" data-tab-go="gifts" style="justify-self:start">Open gift list</button>
        </section>
        <section class="card-flat small stack-sm"><strong>Your spreadsheet stays live</strong><span class="muted">The .xlsx download has your budget, expenses and gifts with working formulas: totals, balances and "Overdue / Due soon" statuses keep updating in Excel or Google Sheets, even in rows you add yourself.</span></section>
      </aside>
    </div></div>`;
  $('#f-settings').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('PUT', `/api/weddings/${wid}/budget/settings`, { currency: f.currency.value, total_budget: f.total_budget.value || 0, reminders_enabled: f.reminders_enabled.checked });
      const first = !d.settings.total_budget_minor && Number(f.total_budget.value) > 0;
      toast('Budget saved', 'success');
      await load();
      if (first && !d.categories.some((c) => c.planned_minor)) offerSplit();
    } catch (err) { setFieldErrors(f, err.data?.fields); showError(err); }
  });
  $('[data-split]')?.addEventListener('click', offerSplit);
  $('[data-add-expense]')?.addEventListener('click', () => editExpense());
  $$('[data-pay]').forEach((b) => b.addEventListener('click', () => recordPayment(d.expenses.find((e) => e.id === b.dataset.pay))));
  $('[data-tab-go]').addEventListener('click', () => { tab = 'gifts'; render(); });
}

async function offerSplit() {
  if (!await confirmDialog('Spread your total budget across your categories using a typical split (venue 20%, catering 25%, photography 10%…)? You can adjust each amount afterwards.', { title: 'Suggest a split?', confirmLabel: 'Use suggested split' })) return;
  try { await api('POST', `/api/weddings/${wid}/budget/categories/suggest-split`); toast('Budget split across categories', 'success'); load(); } catch (err) { showError(err); }
}

// ---------------------------------------------------------------- expenses
function expenses(box) {
  const q = expFilter.q.toLowerCase();
  const rows = d.expenses.filter((e) => (!expFilter.category || (e.category_id || '') === expFilter.category) && (!expFilter.status || e.status === expFilter.status) && (!q || `${e.item} ${e.vendor} ${e.notes}`.toLowerCase().includes(q)));
  const total = (k) => rows.reduce((s, e) => s + (k === 'balance' ? Math.max(0, e.cost_minor - e.paid_minor) : e[k] || 0), 0);
  box.innerHTML = `<div class="row between" style="margin-bottom:12px">
      <div class="row">
        <label><span class="sr-only">Search expenses</span><input type="search" id="exp-q" placeholder="Search item, vendor or notes" value="${esc(expFilter.q)}" style="max-width:240px"></label>
        <label><span class="sr-only">Category</span><select id="exp-cat"><option value="">All categories</option>${d.categories.map((c) => `<option value="${c.id}" ${expFilter.category === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label><span class="sr-only">Status</span><select id="exp-status"><option value="">Any status</option>${Object.entries(STATUS_LABELS).map(([k, l]) => `<option value="${k}" ${expFilter.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      ${d.can_edit ? '<button class="btn btn-primary btn-sm" type="button" id="add-exp">＋ Add expense</button>' : ''}</div>
    ${d.expenses.length ? `<div class="table-wrap"><table>
      <thead><tr><th scope="col">Item</th><th scope="col">Category</th><th scope="col">Cost</th><th scope="col">Paid</th><th scope="col">Balance</th><th scope="col">Next due</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${rows.map((e) => `<tr>
        <td><strong>${esc(e.item)}</strong>${e.vendor ? `<div class="tiny muted">${esc(e.vendor)}${e.vendor_contact ? ` · ${esc(e.vendor_contact)}` : ''}</div>` : ''}${e.paid_by && e.paid_by !== 'Us' ? `<div class="tiny muted">Paid by ${esc(e.paid_by)}</div>` : ''}</td>
        <td class="small">${esc(catName(e.category_id))}</td>
        <td class="money">${m(e.cost_minor)}${e.actual_minor === null && e.estimated_minor !== null ? '<div class="tiny muted">estimate</div>' : ''}</td>
        <td class="money">${m(e.paid_minor)}</td>
        <td class="money">${m(Math.max(0, e.cost_minor - e.paid_minor))}</td>
        <td class="small">${esc(shortDate(e.due_date)) || '<span class="muted">—</span>'}</td>
        <td><span class="badge status-${e.status}">${e.status === 'overdue' ? '⚠ ' : e.status === 'paid' ? '✓ ' : ''}${STATUS_LABELS[e.status]}</span></td>
        <td>${d.can_edit ? `<div class="row" style="gap:2px;flex-wrap:nowrap">${e.status !== 'paid' ? `<button class="btn btn-ghost btn-sm" type="button" data-pay="${e.id}">Pay</button>` : ''}<button class="btn btn-ghost btn-icon" type="button" data-edit="${e.id}" aria-label="Edit ${esc(e.item)}">✎</button><button class="btn btn-ghost btn-icon" type="button" data-del="${e.id}" aria-label="Delete ${esc(e.item)}">🗑</button></div>` : ''}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th scope="row" colspan="2">${rows.length === d.expenses.length ? 'Total' : `Total of ${rows.length} shown`}</th><th class="money">${m(total('cost_minor'))}</th><th class="money">${m(total('paid_minor'))}</th><th class="money">${m(total('balance'))}</th><th colspan="3"></th></tr></tfoot>
      </table>${rows.length ? '' : '<div class="empty"><p>No expenses match these filters.</p></div>'}</div>`
    : '<div class="card empty"><div class="empty-icon" aria-hidden="true">₦$£</div><h3>No expenses yet</h3><p>Add each booking or purchase: what it is, the estimate or agreed price, what you have paid and when the next payment is due.</p></div>'}`;
  $('#exp-q').addEventListener('input', (e) => { expFilter.q = e.target.value; const pos = e.target.selectionStart; render(); const el = $('#exp-q'); el.focus(); el.setSelectionRange(pos, pos); });
  $('#exp-cat').addEventListener('change', (e) => { expFilter.category = e.target.value; render(); });
  $('#exp-status').addEventListener('change', (e) => { expFilter.status = e.target.value; render(); });
  $('#add-exp')?.addEventListener('click', () => editExpense());
  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => editExpense(d.expenses.find((e) => e.id === b.dataset.edit))));
  $$('[data-pay]').forEach((b) => b.addEventListener('click', () => recordPayment(d.expenses.find((e) => e.id === b.dataset.pay))));
  $$('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const e = d.expenses.find((x) => x.id === b.dataset.del);
    if (!await confirmDialog(`Delete “${e.item}” from your budget?`, { title: 'Delete expense?', confirmLabel: 'Delete', danger: true })) return;
    try { await api('DELETE', `/api/weddings/${wid}/budget/expenses/${e.id}`); toast('Expense deleted'); load(); } catch (err) { showError(err); }
  }));
}

const moneyField = (name, label, value, hint = '') => `<label class="field"><span>${label}${hint ? ` <span class="hint">${hint}</span>` : ''}</span><input type="number" name="${name}" min="0" step="0.01" inputmode="decimal" value="${value === null || value === undefined ? '' : fromMinor(value)}"></label>`;

function editExpense(e = null) {
  const form = document.createElement('form');
  form.className = 'stack';
  form.noValidate = true;
  form.innerHTML = `<label class="field"><span>What is it for?</span><input type="text" name="item" required maxlength="200" value="${esc(e?.item || '')}" placeholder="e.g. Reception hall, Photographer deposit"></label>
    <div class="grid-2"><label class="field"><span>Category</span><select name="category_id"><option value="">Uncategorised</option>${d.categories.map((c) => `<option value="${c.id}" ${e?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <label class="field"><span>Paid by</span><input type="text" name="paid_by" list="paid-by-list" maxlength="60" value="${esc(e?.paid_by || 'Us')}"><datalist id="paid-by-list">${d.options.paid_by.map((p) => `<option value="${esc(p)}">`).join('')}</datalist></label></div>
    <div class="grid-2"><label class="field"><span>Vendor</span><input type="text" name="vendor" maxlength="200" value="${esc(e?.vendor || '')}"></label>
    <label class="field"><span>Vendor phone or email</span><input type="text" name="vendor_contact" maxlength="200" value="${esc(e?.vendor_contact || '')}"></label></div>
    <div class="grid-2">${moneyField('estimated', 'Estimated cost', e?.estimated_minor)}${moneyField('actual', 'Actual cost', e?.actual_minor, 'once agreed')}</div>
    <div class="grid-2">${moneyField('paid', 'Paid so far', e?.paid_minor ?? 0)}<label class="field"><span>Next payment due</span><input type="date" name="due_date" value="${esc(e?.due_date || '')}"></label></div>
    <label class="field"><span>Notes</span><textarea name="notes" rows="3" maxlength="2000">${esc(e?.notes || '')}</textarea></label>
    <p class="form-error" role="alert" hidden></p>`;
  modal({
    title: e ? 'Edit expense' : 'Add an expense', body: form, wide: true,
    actions: [{ label: 'Cancel' }, {
      label: e ? 'Save' : 'Add expense', className: 'btn-primary', onClick: async () => {
        const body = Object.fromEntries(new FormData(form));
        try {
          if (e) await api('PATCH', `/api/weddings/${wid}/budget/expenses/${e.id}`, body);
          else await api('POST', `/api/weddings/${wid}/budget/expenses`, body);
          toast(e ? 'Expense updated' : 'Expense added', 'success');
          load();
          return true;
        } catch (err) {
          const box = $('.form-error', form); box.textContent = err.message; box.hidden = false;
          setFieldErrors(form, err.data?.fields);
          return false;
        }
      }
    }]
  });
  setTimeout(() => form.querySelector('[name=item]').focus(), 50);
}

function recordPayment(e) {
  const balance = Math.max(0, e.cost_minor - e.paid_minor);
  const form = document.createElement('form');
  form.className = 'stack';
  form.noValidate = true;
  form.innerHTML = `<p style="margin:0"><strong>${esc(e.item)}</strong> · ${m(e.paid_minor)} paid of ${m(e.cost_minor)}, <strong>${m(balance)}</strong> left.</p>
    <div class="grid-2">${moneyField('amount', 'Amount paid now', balance)}<label class="field"><span>Next payment due <span class="hint">leave empty if fully paid</span></span><input type="date" name="next_due_date" value=""></label></div>
    <label class="field"><span>Note <span class="hint">optional, e.g. receipt number</span></span><input type="text" name="note" maxlength="200"></label>
    <p class="form-error" role="alert" hidden></p>`;
  modal({
    title: 'Record a payment', body: form,
    actions: [{ label: 'Cancel' }, {
      label: 'Save payment', className: 'btn-primary', onClick: async () => {
        try {
          await api('POST', `/api/weddings/${wid}/budget/expenses/${e.id}/payments`, { amount: form.elements.amount.value, next_due_date: form.elements.next_due_date.value || null, note: form.elements.note.value });
          toast('Payment recorded', 'success');
          load();
          return true;
        } catch (err) {
          const box = $('.form-error', form); box.textContent = err.message; box.hidden = false;
          setFieldErrors(form, err.data?.fields);
          return false;
        }
      }
    }]
  });
}

// ---------------------------------------------------------------- categories
function categories(box) {
  const s = d.summary;
  box.innerHTML = `<div class="row between" style="margin-bottom:12px"><p class="small muted" style="margin:0">Planned in categories: <strong class="money">${m(s.planned)}</strong> of your <span class="money">${m(s.total)}</span> budget${s.unallocated ? ` · <span class="${s.unallocated < 0 ? 'form-error' : ''}" style="padding:0">${s.unallocated > 0 ? `${m(s.unallocated)} unassigned` : `${m(-s.unallocated)} over`}</span>` : ''}.</p>
    ${d.can_edit ? '<div class="row"><button class="btn btn-secondary btn-sm" type="button" data-split>Use suggested split</button><button class="btn btn-primary btn-sm" type="button" id="add-cat">＋ Add category</button></div>' : ''}</div>
    <div class="table-wrap"><table><thead><tr><th scope="col">Category</th><th scope="col">Planned</th><th scope="col">Booked</th><th scope="col">Paid</th><th scope="col">Left</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
    <tbody>${s.categories.map((c) => `<tr data-cat="${c.id}">
      <td>${d.can_edit ? `<label><span class="sr-only">Category name</span><input class="inline-input" type="text" data-k="name" value="${esc(c.name)}" maxlength="80"></label>` : esc(c.name)}</td>
      <td>${d.can_edit ? `<label><span class="sr-only">Planned for ${esc(c.name)}</span><input class="inline-input" type="number" min="0" step="0.01" inputmode="decimal" data-k="planned" value="${fromMinor(c.planned_minor) || ''}" placeholder="0"></label>` : `<span class="money">${m(c.planned_minor)}</span>`}</td>
      <td class="money">${m(c.committed)}</td><td class="money">${m(c.paid)}</td>
      <td class="money" ${c.remaining < 0 ? 'style="color:var(--danger);font-weight:600"' : ''}>${c.remaining < 0 ? '▲ ' : ''}${m(c.remaining)}</td>
      <td>${d.can_edit ? `<button class="btn btn-ghost btn-icon" type="button" data-del-cat="${c.id}" aria-label="Delete ${esc(c.name)}">🗑</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
    <p class="small muted">Changes save when you leave a field. Deleting a category keeps its expenses (they become “Uncategorised”).</p>`;
  $('[data-split]')?.addEventListener('click', offerSplit);
  $('#add-cat')?.addEventListener('click', async () => {
    try { await api('POST', `/api/weddings/${wid}/budget/categories`, { name: 'New category', planned: 0 }); await load(); $$('[data-k="name"]').pop()?.select(); } catch (err) { showError(err); }
  });
  $$('[data-cat] [data-k]').forEach((input) => input.addEventListener('change', async () => {
    const id = input.closest('[data-cat]').dataset.cat;
    try { await api('PATCH', `/api/weddings/${wid}/budget/categories/${id}`, { [input.dataset.k]: input.value || (input.dataset.k === 'planned' ? 0 : '') }); toast('Saved', 'success', 1500); await load(); } catch (err) { showError(err); }
  }));
  $$('[data-del-cat]').forEach((b) => b.addEventListener('click', async () => {
    const c = d.categories.find((x) => x.id === b.dataset.delCat);
    if (!await confirmDialog(`Delete the “${c.name}” category? Its expenses are kept as Uncategorised.`, { title: 'Delete category?', confirmLabel: 'Delete', danger: true })) return;
    try { await api('DELETE', `/api/weddings/${wid}/budget/categories/${c.id}`); load(); } catch (err) { showError(err); }
  }));
}

// ---------------------------------------------------------------- gifts
function gifts(box) {
  const s = d.summary.gifts;
  const type = Object.fromEntries(d.options.gift_types);
  const rows = d.gifts.filter((g) => giftFilter === 'all' || (giftFilter === 'pending' ? !g.thank_you_sent_at : !!g.thank_you_sent_at));
  box.innerHTML = `<div class="budget-stats" style="margin-bottom:16px">
      <div class="stat"><strong>${s.count}</strong><span>Gifts logged</span></div>
      <div class="stat green"><strong class="money">${m(s.total, { compact: true })}</strong><span>Total value</span></div>
      <div class="stat"><strong class="money">${m(s.cash, { compact: true })}</strong><span>Cash & transfers</span></div>
      <div class="stat ${s.thank_you_pending ? 'gold' : 'green'}"><strong>${s.thank_you_pending}</strong><span>Thank-you notes to send</span></div></div>
    <div class="row between" style="margin-bottom:12px">
      <div class="preview-toggle" role="group" aria-label="Filter gifts">${[['all', 'All'], ['pending', 'Thank-you to send'], ['done', 'Thanked']].map(([k, l]) => `<button type="button" data-gf="${k}" aria-pressed="${giftFilter === k}">${l}</button>`).join('')}</div>
      ${d.can_edit ? '<button class="btn btn-primary btn-sm" type="button" id="add-gift">＋ Log a gift</button>' : ''}</div>
    ${d.gifts.length ? `<div class="table-wrap"><table><thead><tr><th scope="col">From</th><th scope="col">Gift</th><th scope="col">Value</th><th scope="col">Received</th><th scope="col">Thank-you sent</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${rows.map((g) => `<tr><td><strong>${esc(g.giver_name)}</strong></td>
        <td class="small">${esc(type[g.gift_type] || g.gift_type)}${g.description ? ` · ${esc(g.description)}` : ''}</td>
        <td class="money">${g.amount_minor === null ? '<span class="muted">—</span>' : m(g.amount_minor)}</td>
        <td class="small">${esc(shortDate(g.received_date))}</td>
        <td>${d.can_edit ? `<label class="switch"><input type="checkbox" data-ty="${g.id}" ${g.thank_you_sent_at ? 'checked' : ''}> <span class="small">${g.thank_you_sent_at ? esc(shortDate(g.thank_you_sent_at.slice(0, 10))) : 'Not yet'}</span></label>` : (g.thank_you_sent_at ? 'Yes' : 'Not yet')}</td>
        <td>${d.can_edit ? `<div class="row" style="gap:2px;flex-wrap:nowrap"><button class="btn btn-ghost btn-icon" type="button" data-edit-gift="${g.id}" aria-label="Edit gift from ${esc(g.giver_name)}">✎</button><button class="btn btn-ghost btn-icon" type="button" data-del-gift="${g.id}" aria-label="Delete gift from ${esc(g.giver_name)}">🗑</button></div>` : ''}</td></tr>`).join('')}</tbody></table>${rows.length ? '' : '<div class="empty"><p>Nothing here.</p></div>'}</div>`
    : '<div class="card empty"><div class="empty-icon" aria-hidden="true">❀</div><h3>No gifts logged yet</h3><p>After the wedding, log each gift as you open it — who it is from, what it is and its value — then tick off thank-you notes as you send them.</p></div>'}`;
  $$('[data-gf]').forEach((b) => b.addEventListener('click', () => { giftFilter = b.dataset.gf; render(); }));
  $('#add-gift')?.addEventListener('click', () => editGift());
  $$('[data-edit-gift]').forEach((b) => b.addEventListener('click', () => editGift(d.gifts.find((g) => g.id === b.dataset.editGift))));
  $$('[data-ty]').forEach((cb) => cb.addEventListener('change', async () => {
    try { await api('PATCH', `/api/weddings/${wid}/budget/gifts/${cb.dataset.ty}`, { thank_you_sent: cb.checked }); load(); } catch (err) { cb.checked = !cb.checked; showError(err); }
  }));
  $$('[data-del-gift]').forEach((b) => b.addEventListener('click', async () => {
    if (!await confirmDialog('Delete this gift from your list?', { title: 'Delete gift?', confirmLabel: 'Delete', danger: true })) return;
    try { await api('DELETE', `/api/weddings/${wid}/budget/gifts/${b.dataset.delGift}`); load(); } catch (err) { showError(err); }
  }));
}

function editGift(g = null) {
  const form = document.createElement('form');
  form.className = 'stack';
  form.noValidate = true;
  form.innerHTML = `<div class="grid-2"><label class="field"><span>From a guest on your list</span><select name="guest_id"><option value="">— Someone else —</option>${d.guests.map((x) => `<option value="${x.id}" ${g?.guest_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
    <label class="field"><span>Name(s) <span class="hint">e.g. “Uncle Tunde & family”</span></span><input type="text" name="giver_name" maxlength="200" value="${esc(g?.giver_name || '')}"></label></div>
    <div class="grid-2"><label class="field"><span>Type</span><select name="gift_type">${d.options.gift_types.map(([k, l]) => `<option value="${k}" ${(g?.gift_type || 'cash') === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
    ${moneyField('amount', 'Amount or value', g?.amount_minor, 'optional for items')}</div>
    <label class="field"><span>Description</span><input type="text" name="description" maxlength="300" value="${esc(g?.description || '')}" placeholder="e.g. Stand mixer, envelope at reception"></label>
    <div class="grid-2"><label class="field"><span>Received on</span><input type="date" name="received_date" value="${esc(g?.received_date || d.today)}"></label>
    <label class="switch" style="align-self:end"><input type="checkbox" name="thank_you_sent" ${g?.thank_you_sent_at ? 'checked' : ''}> Thank-you sent</label></div>
    <label class="field"><span>Notes</span><textarea name="notes" rows="2" maxlength="2000">${esc(g?.notes || '')}</textarea></label>
    <p class="form-error" role="alert" hidden></p>`;
  form.elements.guest_id.addEventListener('change', (e) => {
    const guest = d.guests.find((x) => x.id === e.target.value);
    if (guest && !form.elements.giver_name.value) form.elements.giver_name.value = guest.name;
  });
  modal({
    title: g ? 'Edit gift' : 'Log a gift', body: form, wide: true,
    actions: [{ label: 'Cancel' }, {
      label: g ? 'Save' : 'Add gift', className: 'btn-primary', onClick: async () => {
        const fd = new FormData(form);
        const body = Object.fromEntries(fd);
        body.thank_you_sent = fd.has('thank_you_sent');
        try {
          if (g) await api('PATCH', `/api/weddings/${wid}/budget/gifts/${g.id}`, body);
          else await api('POST', `/api/weddings/${wid}/budget/gifts`, body);
          toast(g ? 'Gift updated' : 'Gift logged', 'success');
          load();
          return true;
        } catch (err) {
          const box = $('.form-error', form); box.textContent = err.message; box.hidden = false;
          setFieldErrors(form, err.data?.fields);
          return false;
        }
      }
    }]
  });
}

await load();
