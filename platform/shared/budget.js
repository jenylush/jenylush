// Budget and gift calculations shared by the server, the browser and the Excel
// export, so every view of a couple's money agrees. Amounts are integers in the
// currency's minor unit (kobo, cents, pence) to avoid rounding errors.

export const CURRENCIES = [
  ['NGN', '₦', 'Nigerian naira'], ['USD', '$', 'US dollar'], ['GBP', '£', 'British pound'], ['EUR', '€', 'Euro'],
  ['GHS', 'GH₵', 'Ghanaian cedi'], ['KES', 'KSh', 'Kenyan shilling'], ['ZAR', 'R', 'South African rand'], ['CAD', 'CA$', 'Canadian dollar'],
  ['AUD', 'A$', 'Australian dollar'], ['INR', '₹', 'Indian rupee'], ['AED', 'AED', 'UAE dirham'], ['XOF', 'CFA', 'West African CFA franc']
];

export const currencySymbol = (code) => (CURRENCIES.find((c) => c[0] === code) || [code, code])[1];

// Suggested split of the total budget. Couples can rename, add, remove and resize these.
export const DEFAULT_CATEGORIES = [
  ['Venue', 20], ['Catering & drinks', 25], ['Photography & video', 10], ['Attire & beauty', 9],
  ['Decor & flowers', 8], ['Music & entertainment', 6], ['Rings & jewellery', 5], ['Stationery & invitations', 2],
  ['Transport', 3], ['Favours & gifts', 2], ['Honeymoon', 7], ['Miscellaneous', 3]
];

export const PAID_BY = ['Us', "Bride's family", "Groom's family", 'Friends', 'Other'];
export const GIFT_TYPES = [['cash', 'Cash'], ['transfer', 'Bank transfer'], ['item', 'Gift item'], ['voucher', 'Voucher'], ['other', 'Other']];

export const toMinor = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
export const fromMinor = (m) => (m === null || m === undefined ? '' : m / 100);

export function formatMoney(minor, currency = 'USD', { compact = false } = {}) {
  const v = (minor || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: compact && Math.abs(v) >= 1e6 ? 1 : (compact || Number.isInteger(v) ? 0 : 2), notation: compact && Math.abs(v) >= 1e6 ? 'compact' : 'standard' }).format(v);
  } catch {
    return `${currencySymbol(currency)}${v.toLocaleString()}`;
  }
}

// What an expense will actually cost: the real price once known, else the estimate.
export const expenseCost = (e) => (e.actual_minor !== null && e.actual_minor !== undefined ? e.actual_minor : (e.estimated_minor || 0));

// `today` is 'YYYY-MM-DD' in the wedding's timezone.
export function expenseStatus(e, today) {
  const cost = expenseCost(e);
  const paid = e.paid_minor || 0;
  if (cost > 0 && paid >= cost) return 'paid';
  if (e.due_date && e.due_date < today) return 'overdue';
  if (e.due_date && daysBetween(today, e.due_date) <= 14) return 'due_soon';
  if (paid > 0) return 'part_paid';
  return 'unpaid';
}

export const STATUS_LABELS = { paid: 'Paid', overdue: 'Overdue', part_paid: 'Part-paid', due_soon: 'Due soon', unpaid: 'Not paid yet' };

export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5);
}

export function budgetSummary({ settings, categories, expenses, gifts }, today) {
  const total = settings.total_budget_minor || 0;
  const byCat = new Map(categories.map((c) => [c.id, { ...c, committed: 0, paid: 0, count: 0 }]));
  let committed = 0, paid = 0, overdue = 0, overdueAmount = 0;
  const upcoming = [];
  for (const e of expenses) {
    const cost = expenseCost(e);
    committed += cost;
    paid += e.paid_minor || 0;
    const c = byCat.get(e.category_id);
    if (c) { c.committed += cost; c.paid += e.paid_minor || 0; c.count++; }
    const status = expenseStatus(e, today);
    if (status === 'overdue') { overdue++; overdueAmount += Math.max(0, cost - (e.paid_minor || 0)); }
    if ((status === 'due_soon' || status === 'part_paid' || status === 'unpaid') && e.due_date && e.due_date >= today) upcoming.push({ ...e, status, balance: Math.max(0, cost - (e.paid_minor || 0)) });
  }
  upcoming.sort((a, b) => a.due_date.localeCompare(b.due_date));
  const planned = categories.reduce((s, c) => s + (c.planned_minor || 0), 0);
  const giftTotal = gifts.reduce((s, g) => s + (g.amount_minor || 0), 0);
  const cashGifts = gifts.filter((g) => g.gift_type === 'cash' || g.gift_type === 'transfer').reduce((s, g) => s + (g.amount_minor || 0), 0);
  return {
    total, planned, committed, paid,
    outstanding: Math.max(0, committed - paid),
    remaining: total - committed,
    unallocated: total - planned,
    used_pct: total ? Math.round((committed / total) * 1000) / 10 : null,
    overdue, overdue_amount: overdueAmount,
    upcoming: upcoming.slice(0, 8),
    categories: [...byCat.values()].map((c) => ({ ...c, remaining: (c.planned_minor || 0) - c.committed, over: c.committed > (c.planned_minor || 0) && (c.planned_minor || 0) > 0 })),
    gifts: { count: gifts.length, total: giftTotal, cash: cashGifts, thank_you_pending: gifts.filter((g) => !g.thank_you_sent_at).length },
    net_cost: committed - cashGifts
  };
}
