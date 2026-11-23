import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { naira } from "@/lib/money";

export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

/* ─── Layout ───────────────────────────────────────────────────────── */

export function PageHeader({ folio, title, lede, actions }: { folio?: string; title: ReactNode; lede?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-col gap-4 border-b border-linen pb-6 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {folio && <div className="eyebrow mb-2">{folio}</div>}
        <h1 className="font-display text-3xl leading-tight text-ink md:text-[2.4rem]">{title}</h1>
        {lede && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{lede}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Card({ className, children, title, folio, action, pad = true }: { className?: string; children: ReactNode; title?: ReactNode; folio?: string; action?: ReactNode; pad?: boolean }) {
  return (
    <section className={cx("sheet rise relative", className)}>
      {(title || folio) && (
        <div className="flex items-center justify-between gap-3 border-b border-linen px-5 py-3.5">
          <div className="flex items-baseline gap-3">
            {folio && <span className="figure text-[0.68rem] text-gold-deep">{folio}</span>}
            {title && <h2 className="font-display text-[1.05rem] text-ink">{title}</h2>}
          </div>
          {action}
        </div>
      )}
      <div className={pad ? "p-5" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone = "ink", big }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "ink" | "gold" | "rose" | "sage"; big?: boolean }) {
  const color = { ink: "text-ink", gold: "text-gold-deep", rose: "text-rose", sage: "text-sage" }[tone];
  return (
    <div className="min-w-0">
      <div className="eyebrow !text-muted">{label}</div>
      <div className={cx("figure mt-1.5 truncate", big ? "text-3xl md:text-[2.2rem]" : "text-xl md:text-2xl", color)}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export const Money = ({ value, className }: { value: number | null | undefined; className?: string }) => <span className={cx("figure", className)}>{naira(value)}</span>;

/* ─── Status stamps ────────────────────────────────────────────────── */

const toneMap = {
  ink: "border-ink/30 text-ink bg-ink/[0.03]",
  gold: "border-gold/60 text-gold-deep bg-gold-soft/50",
  sage: "border-sage/40 text-sage bg-sage-soft",
  rose: "border-rose/40 text-rose bg-rose-soft",
  amber: "border-amber/40 text-amber bg-amber-soft",
  muted: "border-linen text-muted bg-ivory",
} as const;
export type Tone = keyof typeof toneMap;

export function Stamp({ tone = "muted", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap border px-2 py-[3px] text-[0.62rem] font-semibold uppercase tracking-[0.12em]", toneMap[tone], className)}>
      {children}
    </span>
  );
}

export const expenseTone = (s: string): Tone =>
  ({ fully_paid: "sage", partially_paid: "gold", overdue: "rose", cancelled: "muted", not_paid: "ink" })[s] as Tone ?? "muted";
export const orderTone = (s: string): Tone => ({ paid: "sage", partially_paid: "gold", pending_payment: "amber", cancelled: "muted" })[s] as Tone ?? "muted";
export const paymentTone = (s: string): Tone => ({ success: "sage", pending: "amber", initialized: "muted", failed: "rose", abandoned: "muted", refunded: "ink" })[s] as Tone ?? "muted";
export const deliveryTone = (s: string): Tone => ({ delivered: "sage", dispatched: "gold", processing: "amber", ready_for_collection: "gold", failed: "rose", awaiting: "muted" })[s] as Tone ?? "muted";
export const guestTone = (s: string): Tone =>
  (({ Delivered: "sage", "Order completed": "sage", "Payment confirmed": "sage", "Delivery pending": "gold", "Partially paid": "gold", "Payment pending": "amber", "Order started": "amber", Cancelled: "muted", "Link sent": "ink", Invited: "muted" }) as Record<string, Tone>)[s] ?? "muted";

/* ─── Progress ribbon (woven, like an Aso Ebi strip) ───────────────── */

export function Ribbon({ value, tone = "gold", segments, height = 8, label }: { value?: number; tone?: "gold" | "rose" | "sage" | "ink"; segments?: Array<{ value: number; color: string; label?: string }>; height?: number; label?: string }) {
  const bg = { gold: "bg-gold", rose: "bg-rose", sage: "bg-sage", ink: "bg-ink" }[tone];
  return (
    <div className="relative w-full overflow-hidden bg-sand" style={{ height }} role="progressbar" aria-label={label} aria-valuenow={value != null ? Math.round(value * 100) : undefined} aria-valuemin={0} aria-valuemax={100}>
      {segments ? (
        <div className="flex h-full w-full">
          {segments.map((s, i) => (
            <div key={i} className="weave h-full" style={{ width: `${Math.max(0, Math.min(100, s.value * 100))}%`, background: s.color }} title={s.label} />
          ))}
        </div>
      ) : (
        <div className={cx("weave h-full transition-[width] duration-700", bg)} style={{ width: `${Math.max(0, Math.min(100, (value ?? 0) * 100))}%` }} />
      )}
    </div>
  );
}

/* ─── Buttons & links ──────────────────────────────────────────────── */

const btn = {
  primary: "bg-ink text-ivory hover:bg-ink-soft border border-ink",
  gold: "bg-gold text-ink hover:bg-gold-deep hover:text-ivory border border-gold",
  ghost: "bg-transparent text-ink border border-linen hover:border-gold hover:bg-paper",
  danger: "bg-transparent text-rose border border-rose/40 hover:bg-rose-soft",
  quiet: "bg-transparent text-ink-soft hover:text-ink underline-offset-4 hover:underline border border-transparent",
} as const;
export type BtnVariant = keyof typeof btn;
export const buttonClass = (variant: BtnVariant = "primary", size: "sm" | "md" = "md") =>
  cx("inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold tracking-[0.01em] transition-colors disabled:cursor-not-allowed disabled:opacity-50", size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2.5 text-sm", btn[variant]);

export function Button({ variant = "primary", size = "md", className, ...rest }: ComponentProps<"button"> & { variant?: BtnVariant; size?: "sm" | "md" }) {
  return <button className={cx(buttonClass(variant, size), className)} {...rest} />;
}
export function LinkButton({ variant = "ghost", size = "md", className, ...rest }: ComponentProps<typeof Link> & { variant?: BtnVariant; size?: "sm" | "md" }) {
  return <Link className={cx(buttonClass(variant, size), className)} {...rest} />;
}

/* ─── Form fields ──────────────────────────────────────────────────── */

export function Field({ label, hint, children, className, required }: { label: string; hint?: ReactNode; children: ReactNode; className?: string; required?: boolean }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">
        {label}
        {required && <span className="ml-0.5 text-rose">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}
export const Input = ({ className, ...p }: ComponentProps<"input">) => <input className={cx("field-input", className)} {...p} />;
export const Textarea = ({ className, ...p }: ComponentProps<"textarea">) => <textarea className={cx("field-input min-h-[84px]", className)} {...p} />;
export const Select = ({ className, ...p }: ComponentProps<"select">) => <select className={cx("field-input", className)} {...p} />;

export function MoneyInput({ name, defaultValue, required, placeholder, ...rest }: Omit<ComponentProps<"input">, "defaultValue"> & { defaultValue?: number | null }) {
  return (
    <div className="relative">
      <span className="figure pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gold-deep">₦</span>
      <input
        name={name}
        inputMode="decimal"
        required={required}
        placeholder={placeholder ?? "0"}
        defaultValue={defaultValue != null ? String(defaultValue / 100) : undefined}
        className="field-input figure pl-7"
        pattern="[0-9,.\s]*"
        {...rest}
      />
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <svg width="54" height="54" viewBox="0 0 54 54" className="mb-4 text-gold" aria-hidden>
        <circle cx="27" cy="27" r="25" fill="none" stroke="currentColor" strokeWidth="1" />
        <circle cx="27" cy="27" r="19" fill="none" stroke="currentColor" strokeWidth="0.6" strokeDasharray="2 3" />
        <path d="M18 27h18M27 18v18" stroke="currentColor" strokeWidth="1" />
      </svg>
      <div className="font-display text-lg">{title}</div>
      {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "gold", title, children }: { tone?: "gold" | "rose" | "sage"; title: string; children?: ReactNode }) {
  const c = { gold: "border-gold bg-gold-soft/40", rose: "border-rose bg-rose-soft", sage: "border-sage bg-sage-soft" }[tone];
  return (
    <div className={cx("border-l-2 px-4 py-3 text-sm", c)}>
      <div className="font-semibold text-ink">{title}</div>
      {children && <div className="mt-0.5 text-ink-soft">{children}</div>}
    </div>
  );
}

export function Tabs({ items, current }: { items: Array<{ href: string; label: string; count?: number }>; current: string }) {
  return (
    <nav className="-mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-linen">
      {items.map((t) => (
        <Link key={t.href} href={t.href} className={cx("whitespace-nowrap border-b-2 px-3 py-2.5 text-sm transition-colors", t.href === current ? "border-ink font-semibold text-ink" : "border-transparent text-muted hover:text-ink")}>
          {t.label}
          {t.count != null && <span className="figure ml-1.5 text-xs text-faint">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
