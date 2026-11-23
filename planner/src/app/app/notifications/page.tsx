import { and, desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { markAllRead, retryFailed, runRemindersNow } from "@/app/actions/settings";
import { AutoSubmit, SubmitButton } from "@/components/client";
import { Button, Card, EmptyState, Notice, PageHeader, Select, Stamp, Stat, Tabs, cx } from "@/components/ui";
import { db } from "@/db";
import { auditLogs, notificationLogs, notifications } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { integrations } from "@/lib/config";
import { fmtDateTime } from "@/lib/dates";

export const metadata = { title: "Notifications" };

const st = { sent: "sage", failed: "rose", skipped: "amber", queued: "muted" } as const;

export default async function Notifications({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string; channel?: string }> }) {
  const sp = await searchParams;
  const { weddingId } = await requireWorkspace();
  const tab = sp.tab ?? "inbox";
  const [inbox, logs, audit] = await Promise.all([
    db.select().from(notifications).where(eq(notifications.weddingId, weddingId)).orderBy(desc(notifications.createdAt)).limit(100),
    db
      .select()
      .from(notificationLogs)
      .where(and(eq(notificationLogs.weddingId, weddingId), sp.status ? eq(notificationLogs.status, sp.status as "sent") : undefined, sp.channel ? eq(notificationLogs.channel, sp.channel as "email") : undefined))
      .orderBy(desc(notificationLogs.createdAt))
      .limit(300),
    tab === "audit" ? db.select().from(auditLogs).where(eq(auditLogs.weddingId, weddingId)).orderBy(desc(auditLogs.createdAt)).limit(200) : Promise.resolve([]),
  ]);
  const failed = logs.filter((l) => l.status === "failed" || l.status === "skipped");
  const unread = inbox.filter((n) => !n.readAt).length;
  const allLogs = await db.select({ status: notificationLogs.status }).from(notificationLogs).where(eq(notificationLogs.weddingId, weddingId));
  const c = (s: string) => allLogs.filter((l) => l.status === s).length;

  return (
    <>
      <PageHeader
        folio="XII · Notifications"
        title="Notification centre"
        lede="Everything the platform has sent — or tried to send — on your behalf, with retries for anything that failed."
        actions={
          <>
            <form action={runRemindersNow}><SubmitButton variant="ghost" pendingText="Running…">Run scheduled reminders now</SubmitButton></form>
            {unread > 0 && <form action={markAllRead}><Button variant="primary">Mark all read</Button></form>}
          </>
        }
      />
      {(!integrations.email() || !integrations.whatsapp()) && (
        <div className="mb-6">
          <Notice title="Some channels aren't connected">
            {!integrations.email() && "Email (Resend) is not configured, so emails are recorded as “skipped” and can be retried once you add the keys. "}
            {!integrations.whatsapp() && "WhatsApp Business is not configured. "}
            <Link className="underline" href="/app/settings#integrations">See Settings → Integrations</Link>.
          </Notice>
        </div>
      )}
      <div className="sheet mb-6 grid grid-cols-2 gap-5 p-5 md:grid-cols-4">
        <Stat label="Sent" value={c("sent")} tone="sage" />
        <Stat label="Failed" value={c("failed")} tone="rose" />
        <Stat label="Skipped (not connected)" value={c("skipped")} tone="gold" />
        <Stat label="Unread in-app" value={unread} />
      </div>
      <Tabs current={`/app/notifications${tab === "inbox" ? "" : `?tab=${tab}`}`} items={[{ href: "/app/notifications", label: "Inbox", count: unread }, { href: "/app/notifications?tab=history", label: "Automation history", count: allLogs.length }, { href: "/app/notifications?tab=audit", label: "Audit log" }]} />

      {tab === "inbox" && (
        <Card pad={false}>
          {inbox.length ? (
            <ul className="divide-y divide-linen">
              {inbox.map((n) => (
                <li key={n.id} className={cx("flex gap-4 px-5 py-3.5", !n.readAt && "bg-gold-soft/25")}>
                  <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-linen" : "bg-rose")} />
                  <div className="min-w-0 flex-1">
                    {n.href ? <Link href={n.href} className="font-semibold hover:underline">{n.title}</Link> : <span className="font-semibold">{n.title}</span>}
                    {n.body && <div className="text-sm text-ink-soft">{n.body}</div>}
                    <div className="mt-0.5 text-xs text-faint">{fmtDateTime(n.createdAt)} · {n.kind.replace(/_/g, " ")}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="All quiet">Reminders and payment alerts will appear here.</EmptyState>}
        </Card>
      )}

      {tab === "history" && (
        <Card pad={false}>
          <AutoSubmit className="flex flex-wrap gap-2 border-b border-linen p-4">
            <input type="hidden" name="tab" value="history" />
            <Select name="status" defaultValue={sp.status ?? ""} className="w-auto"><option value="">All statuses</option><option value="sent">Sent</option><option value="failed">Failed</option><option value="skipped">Skipped</option></Select>
            <Select name="channel" defaultValue={sp.channel ?? ""} className="w-auto"><option value="">All channels</option><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="in_app">In-app</option></Select>
          </AutoSubmit>
          <form action={retryFailed}>
            {failed.length > 0 && (
              <div className="flex items-center justify-between border-b border-linen bg-rose-soft/40 px-4 py-2 text-sm">
                <span>{failed.length} failed or skipped deliveries shown</span>
                {failed.slice(0, 100).map((f) => <input key={f.id} type="hidden" name="id" value={f.id} />)}
                <Button size="sm" variant="primary">Retry all shown</Button>
              </div>
            )}
          </form>
          <div className="overflow-x-auto">
            <table className="data-table min-w-[900px]">
              <thead><tr><th>When</th><th>Type</th><th>Channel</th><th>Recipient</th><th>Trigger</th><th>Status</th><th /></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap text-xs">{fmtDateTime(l.createdAt)}</td>
                    <td className="text-xs">{l.type.replace(/_/g, " ")}<div className="max-w-[16rem] truncate text-faint" title={l.body}>{l.channel === "whatsapp" ? l.body : l.subject}</div></td>
                    <td className="text-xs capitalize">{l.channel.replace("_", "-")}</td>
                    <td className="max-w-[12rem] truncate text-xs">{l.recipient}</td>
                    <td className="text-xs text-muted">{l.trigger}</td>
                    <td><Stamp tone={st[l.status]}>{l.status}</Stamp>{l.error && <div className="mt-1 max-w-[14rem] text-[0.68rem] text-rose">{l.error}</div>}{l.attempts > 1 && <div className="text-[0.65rem] text-faint">{l.attempts} attempts</div>}</td>
                    <td>{(l.status === "failed" || l.status === "skipped") && <form action={retryFailed}><input type="hidden" name="id" value={l.id} /><Button size="sm" variant="ghost">Retry</Button></form>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!logs.length && <EmptyState title="Nothing sent yet">Run reminders or wait for the daily schedule.</EmptyState>}
          </div>
        </Card>
      )}

      {tab === "audit" && (
        <Card pad={false}>
          <ol className="divide-y divide-linen">
            {audit.map((a) => (
              <li key={a.id} className="grid gap-1 px-5 py-3 text-sm sm:grid-cols-[11rem_6rem_1fr]">
                <span className="text-xs text-muted">{fmtDateTime(a.createdAt)}</span>
                <span><Stamp tone={a.actor === "user" ? "ink" : a.actor === "guest" ? "gold" : "sage"}>{a.actor}</Stamp></span>
                <span>{a.summary}<span className="ml-2 text-xs text-faint">{a.action}</span></span>
              </li>
            ))}
          </ol>
          {!audit.length && <EmptyState title="No audit entries yet" />}
        </Card>
      )}
    </>
  );
}
