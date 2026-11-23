/** The mark: two interlocking rings drawn as a ledger "seal". */
export function Seal({ size = 34, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={className} aria-hidden>
      <circle cx="20" cy="20" r="19" fill="none" stroke="currentColor" strokeWidth="0.8" />
      <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="0.4" strokeDasharray="1 1.6" />
      <circle cx="16.5" cy="20.5" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="23.5" cy="19.5" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

export function Wordmark({ light = false }: { light?: boolean }) {
  return (
    <span className={`flex items-center gap-2.5 ${light ? "text-ivory" : "text-ink"}`}>
      <Seal className={light ? "text-gold" : "text-gold-deep"} />
      <span className="leading-none">
        <span className="font-display block text-[1.15rem] italic">Owambe</span>
        <span className="block text-[0.58rem] font-semibold uppercase tracking-[0.34em] opacity-70">Ledger</span>
      </span>
    </span>
  );
}
