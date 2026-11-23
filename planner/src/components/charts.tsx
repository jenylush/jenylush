import { naira, nairaShort } from "@/lib/money";

/** Ring chart — thin strokes with gaps, like stacked gold bangles. */
export function Ring({ data, size = 200, center }: { data: Array<{ label: string; value: number; color: string }>; size?: number; center?: React.ReactNode }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = size / 2 - 12;
  const C = 2 * Math.PI * r;
  const gap = data.filter((d) => d.value > 0).length > 1 ? 3 : 0;
  let offset = 0;
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Spending by category">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-sand)" strokeWidth={14} />
        <circle cx={size / 2} cy={size / 2} r={r + 11} fill="none" stroke="var(--color-linen)" strokeWidth={0.6} />
        {total > 0 &&
          data
            .filter((d) => d.value > 0)
            .map((d) => {
              const len = (d.value / total) * C;
              const el = (
                <circle key={d.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.color} strokeWidth={14} strokeDasharray={`${Math.max(0, len - gap)} ${C}`} strokeDashoffset={-offset} transform={`rotate(-90 ${size / 2} ${size / 2})`}>
                  <title>{`${d.label}: ${naira(d.value)}`}</title>
                </circle>
              );
              offset += len;
              return el;
            })}
      </svg>
      {center && <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{center}</div>}
    </div>
  );
}

/** Budget vs actual — allocation as a hairline frame, committed as a woven fill. */
export function AllocationBars({ rows, columns = 1 }: { rows: Array<{ name: string; color: string; allocated: number; committed: number; paid: number }>; columns?: 1 | 2 }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.allocated, r.committed)));
  return (
    <ul className={columns === 2 ? "grid gap-x-10 gap-y-3.5 sm:grid-cols-2" : "space-y-3.5"}>
      {rows.map((r) => {
        const over = r.committed > r.allocated && r.allocated > 0;
        return (
          <li key={r.name}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-[0.8rem]">
              <span className="flex min-w-0 items-center gap-2 truncate">
                <span className="inline-block h-2 w-2 shrink-0" style={{ background: r.color }} />
                {r.name}
              </span>
              <span className="figure shrink-0 text-xs text-muted">
                <span className={over ? "text-rose" : "text-ink"}>{nairaShort(r.committed)}</span> / {nairaShort(r.allocated)}
              </span>
            </div>
            <div className="relative h-2.5 bg-sand/60">
              <div className="absolute inset-y-0 left-0 border border-ink/25" style={{ width: `${(r.allocated / max) * 100}%` }} />
              <div className="weave absolute inset-y-0 left-0 opacity-45" style={{ width: `${(r.committed / max) * 100}%`, background: over ? "var(--color-rose)" : r.color }} />
              <div className="weave absolute inset-y-0 left-0" style={{ width: `${(r.paid / max) * 100}%`, background: over ? "var(--color-rose)" : r.color }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function MonthBars({ data }: { data: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex h-40 items-end gap-2">
      {data.map((d) => (
        <div key={d.label} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
          <span className="figure text-[0.62rem] text-muted">{d.value ? nairaShort(d.value) : ""}</span>
          <div className="weave w-full bg-gold" style={{ height: `${Math.max(2, (d.value / max) * 110)}px` }} title={naira(d.value)} />
          <span className="text-[0.62rem] uppercase tracking-wider text-muted">{d.label}</span>
        </div>
      ))}
    </div>
  );
}
