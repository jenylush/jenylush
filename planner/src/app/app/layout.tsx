import { and, eq, isNull } from "drizzle-orm";
import { logout } from "@/app/actions/auth";
import { MobileNav, Sidebar } from "@/components/nav";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { daysUntil } from "@/lib/dates";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { wedding, user, role } = await requireWorkspace();
  const unread = await db.$count(notifications, and(eq(notifications.weddingId, wedding.id), isNull(notifications.readAt)));
  const couple = `${wedding.partnerOneName} & ${wedding.partnerTwoName}`;
  const d = wedding.weddingDate ? daysUntil(wedding.weddingDate) : null;
  const countdown = d == null ? null : d > 0 ? `${d} days to go` : d === 0 ? "It's today!" : "Married ✦";
  const footer = (
    <div className="flex items-center justify-between gap-2 text-xs text-ivory/55">
      <span className="truncate">{user.name}<span className="ml-1 text-ivory/30">· {role}</span></span>
      <form action={logout}><button className="uppercase tracking-[0.18em] hover:text-ivory">Sign out</button></form>
    </div>
  );
  return (
    <div className="flex min-h-dvh">
      <Sidebar couple={couple} countdown={countdown} unread={unread} footer={footer} />
      <div className="min-w-0 flex-1">
        <MobileNav couple={couple} unread={unread} footer={footer} />
        <main className="mx-auto max-w-[78rem] px-4 pb-28 pt-6 md:px-8 md:pt-10 lg:pb-16">{children}</main>
      </div>
    </div>
  );
}
