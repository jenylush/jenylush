"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Wordmark } from "./brand";
import { cx } from "./ui";

export const NAV = [
  { n: "I", href: "/app", label: "Overview" },
  { n: "II", href: "/app/budget", label: "Budget & Expenses" },
  { n: "III", href: "/app/vendors", label: "Vendors" },
  { n: "IV", href: "/app/schedule", label: "Payment Schedule" },
  { n: "V", href: "/app/checklist", label: "Wedding Checklist" },
  { n: "VI", href: "/app/calendar", label: "Calendar" },
  { n: "VII", href: "/app/asoebi", label: "Aso Ebi Manager", group: "Aso Ebi" },
  { n: "VIII", href: "/app/guests", label: "Guest Register" },
  { n: "IX", href: "/app/orders", label: "Orders & Payments" },
  { n: "X", href: "/app/delivery", label: "Delivery" },
  { n: "XI", href: "/app/reports", label: "Reports & Exports", group: "Records" },
  { n: "XII", href: "/app/notifications", label: "Notifications" },
  { n: "XIII", href: "/app/settings", label: "Settings" },
];

const isActive = (path: string, href: string) => (href === "/app" ? path === "/app" : path.startsWith(href));

function NavList({ unread, onNavigate }: { unread: number; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <ul className="space-y-0.5">
      {NAV.map((item) => (
        <li key={item.href}>
          {item.group && <div className="mb-2 mt-6 px-3 text-[0.58rem] font-semibold uppercase tracking-[0.3em] text-ivory/35">{item.group}</div>}
          <Link
            href={item.href}
            onClick={onNavigate}
            className={cx(
              "group grid grid-cols-[2.4rem_1fr_auto] items-center px-3 py-2 text-[0.86rem] transition-colors",
              isActive(path, item.href) ? "bg-ivory/[0.07] text-ivory" : "text-ivory/60 hover:text-ivory",
            )}
          >
            <span className={cx("font-display text-[0.8rem] italic", isActive(path, item.href) ? "text-gold" : "text-ivory/30 group-hover:text-gold/70")}>{item.n}</span>
            <span>{item.label}</span>
            {item.href === "/app/notifications" && unread > 0 && <span className="figure min-w-5 bg-rose px-1.5 text-center text-[0.65rem] text-ivory">{unread}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Sidebar({ couple, countdown, unread, footer }: { couple: string; countdown: string | null; unread: number; footer: React.ReactNode }) {
  return (
    <aside className="sticky top-0 hidden h-dvh w-[17rem] shrink-0 flex-col overflow-y-auto bg-ink px-3 py-6 text-ivory lg:flex">
      <Link href="/app" className="px-3"><Wordmark light /></Link>
      <div className="mx-3 mt-6 border-y border-ivory/10 py-4">
        <div className="font-display text-[1.05rem] italic leading-snug text-ivory">{couple}</div>
        {countdown && <div className="mt-1 text-xs text-gold">{countdown}</div>}
      </div>
      <nav className="mt-4 flex-1"><NavList unread={unread} /></nav>
      <div className="mx-3 mt-6 border-t border-ivory/10 pt-4">{footer}</div>
    </aside>
  );
}

export function MobileNav({ couple, unread, footer }: { couple: string; unread: number; footer: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
  }, [open]);
  return (
    <>
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-ink/80 bg-ink px-4 py-3 text-ivory lg:hidden">
        <Link href="/app"><Wordmark light /></Link>
        <button onClick={() => setOpen(true)} className="flex items-center gap-2 border border-ivory/20 px-3 py-1.5 text-xs uppercase tracking-[0.2em]" aria-expanded={open} aria-label="Open menu">
          Menu {unread > 0 && <span className="figure bg-rose px-1.5 text-[0.65rem]">{unread}</span>}
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal>
          <div className="absolute inset-0 bg-ink/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 right-0 flex w-[86%] max-w-xs flex-col overflow-y-auto bg-ink px-3 py-5 text-ivory">
            <div className="mb-4 flex items-center justify-between px-3">
              <span className="font-display italic">{couple}</span>
              <button onClick={() => setOpen(false)} className="text-xs uppercase tracking-[0.2em] text-ivory/60">Close</button>
            </div>
            <NavList unread={unread} onNavigate={() => setOpen(false)} />
            <div className="mx-3 mt-6 border-t border-ivory/10 pt-4">{footer}</div>
          </div>
        </div>
      )}
      {/* Thumb-reach quick bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-linen bg-paper/95 backdrop-blur lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {[NAV[0], NAV[1], NAV[6], NAV[8]].map((i) => (
          <Link key={i.href} href={i.href} className={cx("flex flex-col items-center gap-0.5 py-2.5 text-[0.62rem] uppercase tracking-[0.12em]", isActive(path, i.href) ? "text-ink" : "text-muted")}>
            <span className={cx("font-display text-sm italic", isActive(path, i.href) ? "text-gold-deep" : "text-faint")}>{i.n}</span>
            {i.label.split(" ")[0]}
          </Link>
        ))}
      </nav>
    </>
  );
}
