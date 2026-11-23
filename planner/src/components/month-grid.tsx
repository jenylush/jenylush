import Link from "next/link";
import { cx } from "./ui";

export interface CalItem {
  date: string;
  label: string;
  href?: string;
  tone: "rose" | "gold" | "sage" | "ink" | "muted";
}

const tones = {
  rose: "border-l-rose bg-rose-soft text-ink",
  gold: "border-l-gold bg-gold-soft/60 text-ink",
  sage: "border-l-sage bg-sage-soft text-ink",
  ink: "border-l-ink bg-ink text-ivory",
  muted: "border-l-faint bg-ivory text-muted line-through",
};

function shift(month: string, n: number) {
  const d = new Date(`${month}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}

/** A ledger-style month: Monday-first, today ringed in gold. */
export function MonthGrid({ month, items, today, basePath }: { month: string; items: CalItem[]; today: string; basePath: string }) {
  const first = new Date(`${month}-01T12:00:00Z`);
  const startDow = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const cells: Array<string | null> = [...Array(startDow).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  while (cells.length % 7) cells.push(null);
  const byDate = new Map<string, CalItem[]>();
  for (const it of items) byDate.set(it.date, [...(byDate.get(it.date) ?? []), it]);
  const sep = basePath.includes("?") ? "&" : "?";

  return (
    <div className="sheet">
      <div className="flex items-center justify-between border-b border-linen px-4 py-3">
        <Link className="px-2 text-sm text-muted hover:text-ink" href={`${basePath}${sep}month=${shift(month, -1)}`}>← Prev</Link>
        <h2 className="font-display text-xl">{first.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}</h2>
        <Link className="px-2 text-sm text-muted hover:text-ink" href={`${basePath}${sep}month=${shift(month, 1)}`}>Next →</Link>
      </div>
      <div className="grid grid-cols-7 border-b border-linen text-center text-[0.6rem] font-semibold uppercase tracking-[0.2em] text-muted">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-2">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((c, i) => (
          <div key={i} className={cx("min-h-[5.5rem] border-b border-r border-linen p-1.5 md:min-h-[7.5rem]", i % 7 === 6 && "border-r-0", !c && "bg-ivory/40")}>
            {c && (
              <>
                <div className={cx("mb-1 inline-flex h-6 w-6 items-center justify-center text-xs", c === today ? "rounded-full border border-gold font-semibold text-gold-deep" : "text-muted")}>{Number(c.slice(8))}</div>
                <ul className="space-y-1">
                  {(byDate.get(c) ?? []).slice(0, 4).map((it, j) => {
                    const inner = <span className={cx("block truncate border-l-2 px-1.5 py-0.5 text-[0.66rem] leading-tight", tones[it.tone])} title={it.label}>{it.label}</span>;
                    return <li key={j}>{it.href ? <Link href={it.href}>{inner}</Link> : inner}</li>;
                  })}
                  {(byDate.get(c)?.length ?? 0) > 4 && <li className="text-[0.62rem] text-muted">+{byDate.get(c)!.length - 4} more</li>}
                </ul>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
