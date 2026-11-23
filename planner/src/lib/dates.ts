/** Dates are stored as ISO yyyy-mm-dd strings (Postgres DATE) and compared in Africa/Lagos. */
export const TZ = "Africa/Lagos";

export function todayISO(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is in the future). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

export const daysUntil = (iso: string, now = new Date()) => daysBetween(todayISO(now), iso);

export function fmtDate(iso: string | Date | null | undefined, style: "short" | "long" | "day" = "short") {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso) : iso;
  const opts: Intl.DateTimeFormatOptions =
    style === "long"
      ? { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ }
      : style === "day"
        ? { day: "numeric", month: "short", timeZone: TZ }
        : { day: "numeric", month: "short", year: "numeric", timeZone: TZ };
  return new Intl.DateTimeFormat("en-GB", opts).format(d);
}

export function fmtDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  }).format(typeof d === "string" ? new Date(d) : d);
}

export function relativeDays(n: number) {
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}
