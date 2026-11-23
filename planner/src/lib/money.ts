/** All amounts are integer kobo. ₦1 = 100 kobo. */
export const toKobo = (naira: number | string): number => {
  const n = typeof naira === "string" ? Number(naira.replace(/[₦,\s]/g, "")) : naira;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
};
export const toNaira = (kobo: number) => kobo / 100;

const fmt = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function naira(kobo: number | null | undefined, opts: { decimals?: boolean; sign?: boolean } = {}) {
  const v = (kobo ?? 0) / 100;
  const body = (opts.decimals ? fmt2 : fmt).format(Math.abs(v));
  const neg = v < 0 ? "−" : opts.sign && v > 0 ? "+" : "";
  return `${neg}₦${body}`;
}

/** Compact form for tight spaces: ₦15m, ₦850k */
export function nairaShort(kobo: number) {
  const v = Math.abs(kobo / 100);
  const s = kobo < 0 ? "−" : "";
  if (v >= 1_000_000_000) return `${s}₦${+(v / 1_000_000_000).toFixed(1)}bn`;
  if (v >= 1_000_000) return `${s}₦${+(v / 1_000_000).toFixed(2)}m`;
  if (v >= 1_000) return `${s}₦${+(v / 1_000).toFixed(0)}k`;
  return `${s}₦${v.toFixed(0)}`;
}

export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
