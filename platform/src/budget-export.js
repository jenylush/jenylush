// Builds the couple's wedding tracker as a real Excel workbook. Totals, balances,
// statuses and the summary are live formulas, so the file keeps working when the
// couple edits it in Excel, Google Sheets or Numbers. Each formula also carries its
// current result, so previews that don't recalculate still show the right numbers.

import ExcelJS from 'exceljs';
import { currencySymbol, expenseCost, expenseStatus, STATUS_LABELS, GIFT_TYPES, PAID_BY, DEFAULT_CATEGORIES, budgetSummary, daysBetween } from '../shared/budget.js';

const EXTRA_EXPENSE_ROWS = 150;
const EXTRA_GIFT_ROWS = 250;
const EXTRA_CATEGORY_ROWS = 8;

const INK = 'FF2A2224', ROSE = 'FF8C4A52', ROSE_SOFT = 'FFF5E7E6', PAPER = 'FFFBF8F4', LINE = 'FFE6DDD4';
const FILL = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

const toDate = (s) => (s ? new Date(`${s}T00:00:00Z`) : null);
const money = (m) => (m === null || m === undefined ? null : m / 100);

function styleHeader(row) {
  row.height = 32;
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = FILL(ROSE);
    c.alignment = { vertical: 'middle', wrapText: true };
  });
}

export async function buildTrackerWorkbook({ wedding, settings, categories, expenses, gifts, today, blank = false, platformName = 'Vowly' }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = platformName;
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  const sym = currencySymbol(settings.currency);
  const fmt = `"${sym}"#,##0.00;[Red]-"${sym}"#,##0.00`;
  const dateFmt = 'd mmm yyyy';
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const summary = budgetSummary({ settings, categories, expenses, gifts }, today);

  const sSum = wb.addWorksheet('Summary', { properties: { tabColor: { argb: ROSE } }, views: [{ showGridLines: false }] });
  const sBud = wb.addWorksheet('Budget', { views: [{ state: 'frozen', ySplit: 1 }] });
  const sExp = wb.addWorksheet('Expenses', { views: [{ state: 'frozen', ySplit: 1 }] });
  const sGift = wb.addWorksheet('Gifts', { views: [{ state: 'frozen', ySplit: 1 }] });

  // ---------------------------------------------------------------- Budget
  sBud.columns = [
    { header: 'Category', key: 'name', width: 28 },
    { header: 'Planned', key: 'planned', width: 16, style: { numFmt: fmt } },
    { header: 'Committed (from Expenses)', key: 'committed', width: 18, style: { numFmt: fmt } },
    { header: 'Paid so far', key: 'paid', width: 16, style: { numFmt: fmt } },
    { header: 'Left in category', key: 'left', width: 16, style: { numFmt: fmt } },
    { header: '% of plan used', key: 'pct', width: 14, style: { numFmt: '0%' } },
    { header: 'Share of total budget', key: 'share', width: 16, style: { numFmt: '0%' } }
  ];
  styleHeader(sBud.getRow(1));
  const catRows = blank ? DEFAULT_CATEGORIES.map(([name, pct]) => ({ name, pct, planned_minor: Math.round((settings.total_budget_minor || 0) * pct / 100), committed: 0, paid: 0 })) : summary.categories;
  const lastCatRow = catRows.length + EXTRA_CATEGORY_ROWS + 1;
  for (let i = 0; i < catRows.length + EXTRA_CATEGORY_ROWS; i++) {
    const r = i + 2;
    const c = catRows[i];
    const row = sBud.getRow(r);
    row.getCell(1).value = c ? c.name : null;
    // In the blank template, planned amounts follow a suggested split of the total budget until overwritten.
    row.getCell(2).value = c ? (c.pct !== undefined ? { formula: `Summary!$C$7*${c.pct / 100}`, result: money(c.planned_minor) } : money(c.planned_minor)) : null;
    const plannedV = c ? money(c.planned_minor) || 0 : 0;
    const committedV = c ? money(c.committed) || 0 : 0;
    row.getCell(3).value = { formula: `IF(A${r}="","",SUMIFS(Expenses!$G:$G,Expenses!$B:$B,A${r}))`, result: c ? committedV : '' };
    row.getCell(4).value = { formula: `IF(A${r}="","",SUMIFS(Expenses!$H:$H,Expenses!$B:$B,A${r}))`, result: c ? money(c.paid) || 0 : '' };
    row.getCell(5).value = { formula: `IF(A${r}="","",N(B${r})-N(C${r}))`, result: c ? plannedV - committedV : '' };
    row.getCell(6).value = { formula: `IF(N(B${r})=0,"",N(C${r})/B${r})`, result: plannedV ? committedV / plannedV : '' };
    row.getCell(7).value = { formula: `IF(OR(A${r}="",Summary!$C$7=0),"",N(B${r})/Summary!$C$7)`, result: c && settings.total_budget_minor ? (c.planned_minor || 0) / settings.total_budget_minor : '' };
    [2].forEach((col) => { row.getCell(col).fill = FILL(PAPER); });
  }
  sBud.addConditionalFormatting({ ref: `E2:E${lastCatRow}`, rules: [{ type: 'cellIs', operator: 'lessThan', formulae: ['0'], style: { font: { color: { argb: 'FFB3261E' }, bold: true }, fill: FILL('FFFDECEA') } }] });
  sBud.addConditionalFormatting({ ref: `F2:F${lastCatRow}`, rules: [{ type: 'dataBar', cfvo: [{ type: 'num', value: 0 }, { type: 'num', value: 1 }], color: { argb: 'FFD9A5A9' } }] });
  sBud.getCell(`A${lastCatRow + 2}`).value = 'Tip: type your own categories in the empty rows. Expenses use these names in their Category dropdown.';
  sBud.getCell(`A${lastCatRow + 2}`).font = { italic: true, color: { argb: 'FF6F6560' } };

  // ---------------------------------------------------------------- Expenses
  sExp.columns = [
    { header: 'Item', key: 'item', width: 30 },
    { header: 'Category', key: 'cat', width: 24 },
    { header: 'Vendor', key: 'vendor', width: 22 },
    { header: 'Paid by', key: 'by', width: 16 },
    { header: 'Estimated cost', key: 'est', width: 15, style: { numFmt: fmt } },
    { header: 'Actual cost', key: 'act', width: 15, style: { numFmt: fmt } },
    { header: 'Cost used (actual, else estimate)', key: 'cost', width: 17, style: { numFmt: fmt } },
    { header: 'Paid so far', key: 'paid', width: 15, style: { numFmt: fmt } },
    { header: 'Balance to pay', key: 'bal', width: 15, style: { numFmt: fmt } },
    { header: 'Next payment due', key: 'due', width: 15, style: { numFmt: dateFmt } },
    { header: 'Status (automatic)', key: 'status', width: 15 },
    { header: 'Notes', key: 'notes', width: 34 }
  ];
  styleHeader(sExp.getRow(1));
  const expRows = blank ? [] : expenses;
  const lastExpRow = expRows.length + EXTRA_EXPENSE_ROWS + 1;
  for (let i = 0; i < expRows.length + EXTRA_EXPENSE_ROWS; i++) {
    const r = i + 2;
    const e = expRows[i];
    const row = sExp.getRow(r);
    if (e) {
      row.getCell(1).value = e.item;
      row.getCell(2).value = catName.get(e.category_id) || null;
      row.getCell(3).value = e.vendor || null;
      row.getCell(4).value = e.paid_by || null;
      row.getCell(5).value = money(e.estimated_minor);
      row.getCell(6).value = money(e.actual_minor);
      row.getCell(8).value = money(e.paid_minor) || 0;
      row.getCell(10).value = toDate(e.due_date);
      row.getCell(12).value = e.notes || null;
    }
    const cost = e ? expenseCost(e) / 100 : '';
    const status = e ? STATUS_LABELS[expenseStatus(e, today)] : '';
    row.getCell(7).value = { formula: `IF(F${r}="",IF(E${r}="","",E${r}),F${r})`, result: e && (e.actual_minor !== null || e.estimated_minor !== null) ? cost : '' };
    row.getCell(9).value = { formula: `IF(G${r}="","",MAX(0,N(G${r})-N(H${r})))`, result: e ? Math.max(0, cost - (e.paid_minor || 0) / 100) : '' };
    row.getCell(11).value = {
      formula: `IF(AND(A${r}="",N(G${r})=0),"",IF(AND(N(G${r})>0,N(H${r})>=N(G${r})),"Paid",IF(AND(J${r}<>"",J${r}<TODAY()),"Overdue",IF(AND(J${r}<>"",J${r}-TODAY()<=14),"Due soon",IF(N(H${r})>0,"Part-paid","Not paid yet")))))`,
      result: status
    };
    row.getCell(2).dataValidation = { type: 'list', allowBlank: true, formulae: [`Budget!$A$2:$A$${lastCatRow}`], showErrorMessage: false };
    row.getCell(4).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${PAID_BY.join(',').replace(/'/g, '')}"`], showErrorMessage: false };
    row.getCell(10).dataValidation = { type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(Date.UTC(2000, 0, 1))], showErrorMessage: true, error: 'Enter a date, e.g. 14/02/2027' };
    [5, 6, 8, 10].forEach((col) => { row.getCell(col).fill = FILL(PAPER); });
  }
  const statusRef = `K2:K${lastExpRow}`;
  sExp.addConditionalFormatting({ ref: statusRef, rules: [
    { type: 'containsText', operator: 'containsText', text: 'Overdue', style: { font: { color: { argb: 'FFB3261E' }, bold: true }, fill: FILL('FFFDECEA') } },
    { type: 'containsText', operator: 'containsText', text: 'Due soon', style: { font: { color: { argb: 'FF8A5A00' } }, fill: FILL('FFFFF4D6') } },
    { type: 'containsText', operator: 'containsText', text: 'Paid', style: { font: { color: { argb: 'FF2F5A37' } }, fill: FILL('FFE6EEE6') } }
  ] });
  sExp.autoFilter = { from: 'A1', to: 'L1' };

  // ---------------------------------------------------------------- Gifts
  sGift.columns = [
    { header: 'From', key: 'from', width: 28 },
    { header: 'Type', key: 'type', width: 15 },
    { header: 'Description', key: 'desc', width: 30 },
    { header: 'Amount or value', key: 'val', width: 16, style: { numFmt: fmt } },
    { header: 'Received on', key: 'rec', width: 14, style: { numFmt: dateFmt } },
    { header: 'Thank-you sent?', key: 'ty', width: 14 },
    { header: 'Thank-you date', key: 'tyd', width: 14, style: { numFmt: dateFmt } },
    { header: 'Notes', key: 'notes', width: 30 }
  ];
  styleHeader(sGift.getRow(1));
  const typeLabel = Object.fromEntries(GIFT_TYPES);
  const giftRows = blank ? [] : gifts;
  const lastGiftRow = giftRows.length + EXTRA_GIFT_ROWS + 1;
  for (let i = 0; i < giftRows.length + EXTRA_GIFT_ROWS; i++) {
    const r = i + 2;
    const g = giftRows[i];
    const row = sGift.getRow(r);
    if (g) {
      row.getCell(1).value = g.giver_name;
      row.getCell(2).value = typeLabel[g.gift_type] || 'Other';
      row.getCell(3).value = g.description || null;
      row.getCell(4).value = money(g.amount_minor);
      row.getCell(5).value = toDate(g.received_date);
      row.getCell(6).value = g.thank_you_sent_at ? 'Yes' : 'No';
      row.getCell(7).value = g.thank_you_sent_at ? toDate(g.thank_you_sent_at.slice(0, 10)) : null;
      row.getCell(8).value = g.notes || null;
    }
    row.getCell(2).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${GIFT_TYPES.map(([, l]) => l).join(',')}"`] };
    row.getCell(6).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Yes,No"'] };
  }
  sGift.addConditionalFormatting({ ref: `F2:F${lastGiftRow}`, rules: [
    { type: 'cellIs', operator: 'equal', formulae: ['"No"'], style: { font: { color: { argb: 'FF8A5A00' }, bold: true }, fill: FILL('FFFFF4D6') } },
    { type: 'cellIs', operator: 'equal', formulae: ['"Yes"'], style: { font: { color: { argb: 'FF2F5A37' } }, fill: FILL('FFE6EEE6') } }
  ] });
  sGift.autoFilter = { from: 'A1', to: 'H1' };

  // ---------------------------------------------------------------- Summary
  sSum.columns = [{ width: 3 }, { width: 46 }, { width: 24 }];
  const names = [wedding.partner1, wedding.partner2].filter(Boolean).join(' & ') || 'Our wedding';
  sSum.getCell('B2').value = `${names} — wedding budget & gift tracker`;
  sSum.getCell('B2').font = { size: 18, bold: true, color: { argb: INK } };
  sSum.getCell('B3').value = `Made with ${platformName}. Yellow cells are yours to change; everything else updates automatically.`;
  sSum.getCell('B3').font = { italic: true, color: { argb: 'FF6F6560' } };
  const lines = [
    // [row, label, value or formula, result, format, editable]
    [5, 'Wedding date', toDate(wedding.wedding_date_local?.slice(0, 10)), null, dateFmt, true],
    [6, 'Days to go', { formula: 'IF(C5="","",MAX(0,C5-TODAY()))', result: wedding.wedding_date_local ? Math.max(0, daysBetween(today, wedding.wedding_date_local.slice(0, 10))) : '' }, null, '0', false],
    [7, `Total budget (${settings.currency})`, money(settings.total_budget_minor) || 0, null, fmt, true],
    [9, 'Planned across categories', { formula: 'SUM(Budget!B:B)', result: summary.planned / 100 }, null, fmt],
    [10, 'Not yet given to a category', { formula: 'C7-C9', result: summary.unallocated / 100 }, null, fmt],
    [11, 'Committed (cost of everything booked)', { formula: 'SUM(Expenses!G:G)', result: summary.committed / 100 }, null, fmt],
    [12, 'Paid so far', { formula: 'SUM(Expenses!H:H)', result: summary.paid / 100 }, null, fmt],
    [13, 'Still to pay', { formula: 'SUM(Expenses!I:I)', result: summary.outstanding / 100 }, null, fmt],
    [14, 'Left in the budget', { formula: 'C7-C11', result: summary.remaining / 100 }, null, fmt],
    [15, 'Budget used', { formula: 'IF(C7=0,"",C11/C7)', result: summary.total ? summary.committed / summary.total : '' }, null, '0%'],
    [16, 'Overdue payments', { formula: 'COUNTIF(Expenses!K:K,"Overdue")', result: summary.overdue }, null, '0'],
    [17, 'Payments due in the next 14 days', { formula: 'COUNTIF(Expenses!K:K,"Due soon")', result: expenses.filter((e) => expenseStatus(e, today) === 'due_soon').length }, null, '0'],
    [19, 'Gifts received', { formula: 'COUNTA(Gifts!A:A)-1', result: summary.gifts.count }, null, '0'],
    [20, 'Total value of gifts', { formula: 'SUM(Gifts!D:D)', result: summary.gifts.total / 100 }, null, fmt],
    [21, 'Cash and bank transfers', { formula: 'SUMIFS(Gifts!D:D,Gifts!B:B,"Cash")+SUMIFS(Gifts!D:D,Gifts!B:B,"Bank transfer")', result: summary.gifts.cash / 100 }, null, fmt],
    [22, 'Thank-you notes still to send', { formula: 'COUNTIFS(Gifts!A:A,"<>",Gifts!F:F,"No")', result: summary.gifts.thank_you_pending }, null, '0'],
    [24, 'Net wedding cost (committed minus cash gifts)', { formula: 'C11-C21', result: summary.net_cost / 100 }, null, fmt]
  ];
  for (const [r, label, value, , numFmt, editable] of lines) {
    sSum.getCell(`B${r}`).value = label;
    const c = sSum.getCell(`C${r}`);
    c.value = value;
    c.numFmt = numFmt;
    c.font = { bold: true, size: 12 };
    c.alignment = { horizontal: 'right' };
    if (editable) { c.fill = FILL('FFFFF4D6'); c.border = { bottom: { style: 'thin', color: { argb: 'FFD8B45A' } } }; }
    sSum.getCell(`B${r}`).border = { bottom: { style: 'hair', color: { argb: LINE } } };
  }
  [['B8', 'Budget'], ['B18', 'Gifts after the wedding']].forEach(([ref, t]) => { sSum.getCell(ref).value = t; sSum.getCell(ref).font = { bold: true, color: { argb: ROSE }, size: 12 }; });
  sSum.addConditionalFormatting({ ref: 'C14', rules: [{ type: 'cellIs', operator: 'lessThan', formulae: ['0'], style: { font: { color: { argb: 'FFB3261E' } }, fill: FILL('FFFDECEA') } }] });
  sSum.addConditionalFormatting({ ref: 'C16', rules: [{ type: 'cellIs', operator: 'greaterThan', formulae: ['0'], style: { font: { color: { argb: 'FFB3261E' } }, fill: FILL('FFFDECEA') } }] });
  const help = [
    'How this sheet works',
    '• Budget: set a planned amount for each category. "Committed" adds up every expense in that category automatically.',
    '• Expenses: add one row per booking. Fill in the estimate, then the actual cost once agreed. Status updates itself: Paid, Part-paid, Due soon (within 14 days), Overdue.',
    '• Gifts: after the wedding, log every gift and tick "Yes" once you have sent a thank-you note.',
    '• Empty rows already contain the formulas — just type into them.',
    `• Amounts are in ${settings.currency}. Works in Excel, Google Sheets (File → Import) and Numbers.`
  ];
  help.forEach((t, i) => {
    const r = 27 + i;
    sSum.mergeCells(`B${r}:C${r}`);
    const c = sSum.getCell(`B${r}`);
    c.value = t;
    c.alignment = { wrapText: true, vertical: 'top' };
    c.font = i === 0 ? { bold: true, color: { argb: ROSE }, size: 12 } : { color: { argb: 'FF4D4440' } };
    if (i) sSum.getRow(r).height = t.length > 80 ? 46 : 30;
  });

  return wb.xlsx.writeBuffer();
}
