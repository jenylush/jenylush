// Timezone helpers built on Intl, so wall-clock times entered by couples ("2 pm in
// Lagos") convert to the correct UTC instant, including across daylight-saving changes.

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

// Offset (ms) of `tz` from UTC at the given instant.
function offsetAt(tsMs, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(new Date(tsMs));
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+v.year, +v.month - 1, +v.day, +v.hour, +v.minute, +v.second);
  return asUtc - Math.floor(tsMs / 1000) * 1000;
}

// 'YYYY-MM-DDTHH:mm' (wall clock in tz) -> Date (UTC instant).
export function zonedToUtc(local, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(local || '');
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
  let ts = guess - offsetAt(guess, tz);
  const second = offsetAt(ts, tz);
  if (guess - second !== ts) ts = guess - second;
  return new Date(ts);
}

// UTC instant -> 'YYYY-MM-DD' in tz.
export function utcToZonedDate(date, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

// The RSVP deadline is inclusive: responses are accepted until 23:59 on that day, wedding time.
export function deadlinePassed(deadline, tz, at = new Date()) {
  if (!deadline) return false;
  const end = zonedToUtc(`${addDays(deadline, 1)}T00:00`, tz);
  return end ? at >= end : false;
}
