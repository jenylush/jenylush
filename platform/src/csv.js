// Minimal RFC 4180 CSV parsing and writing.

export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', i = 0, quoted = false;
  const s = String(text || '').replace(/^\uFEFF/, '');
  const firstLine = s.split('\n', 1)[0];
  const delim = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { quoted = true; i++; continue; }
    if (c === delim) { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

// Neutralise spreadsheet formula injection (cells starting with = + - @).
function safeCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv(header, rows) {
  return [header, ...rows].map((r) => r.map(safeCell).join(',')).join('\r\n') + '\r\n';
}
