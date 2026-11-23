import { and, asc, eq } from "drizzle-orm";
import { deleteTask, saveTask, toggleTask } from "@/app/actions/vendors";
import { ActionForm, AutoSubmit, ConfirmButton, SubmitButton } from "@/components/client";
import { MonthGrid } from "@/components/month-grid";
import { Card, EmptyState, Field, Input, PageHeader, Ribbon, Select, Stamp, Tabs, Textarea, cx } from "@/components/ui";
import { db } from "@/db";
import { events, tasks } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { daysBetween, fmtDate, relativeDays, todayISO } from "@/lib/dates";

export const metadata = { title: "Wedding Checklist" };

const prTone = { high: "rose", medium: "gold", low: "muted" } as const;

function TaskFields({ t, names, evs }: { t?: typeof tasks.$inferSelect; names: [string, string]; evs: Array<typeof events.$inferSelect> }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {t && <input type="hidden" name="id" value={t.id} />}
      <Field label="Task" className="sm:col-span-2" required><Input name="title" defaultValue={t?.title} placeholder="e.g. Meet with decorator" required /></Field>
      <Field label="Deadline"><Input type="date" name="dueDate" defaultValue={t?.dueDate ?? ""} /></Field>
      <Field label="Type"><Select name="kind" defaultValue={t?.kind ?? "task"}><option value="task">Task</option><option value="activity">Activity / appointment</option></Select></Field>
      <Field label="Assigned to"><Select name="assignee" defaultValue={t?.assignee ?? "both"}><option value="both">Both of us</option><option value="partner_one">{names[0]}</option><option value="partner_two">{names[1]}</option></Select></Field>
      <Field label="Priority"><Select name="priority" defaultValue={t?.priority ?? "medium"}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></Select></Field>
      <Field label="Repeat"><Select name="recurrence" defaultValue={t?.recurrence ?? "none"}><option value="none">Doesn't repeat</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></Select></Field>
      <Field label="Event"><Select name="eventId" defaultValue={t?.eventId ?? ""}><option value="">—</option>{evs.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select></Field>
      <Field label="Description" className="sm:col-span-2 lg:col-span-3"><Textarea name="description" defaultValue={t?.description ?? ""} className="min-h-[42px]" /></Field>
      <div>
        <div className="mb-1.5 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">Remind me</div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {[[7, "7d"], [3, "3d"], [1, "1d"], [0, "on the day"]].map(([n, l]) => (
            <label key={n} className="flex items-center gap-1"><input type="checkbox" name="remind" value={n} defaultChecked={t ? t.remindDaysBefore.includes(n as number) : n === 1} className="accent-[#8F7444]" />{l}</label>
          ))}
        </div>
      </div>
    </div>
  );
}

export default async function Checklist({ searchParams }: { searchParams: Promise<{ view?: string; who?: string; filter?: string; month?: string }> }) {
  const sp = await searchParams;
  const { wedding, weddingId } = await requireWorkspace();
  const today = todayISO();
  const [all, evs] = await Promise.all([
    db.select().from(tasks).where(eq(tasks.weddingId, weddingId)).orderBy(asc(tasks.completedAt), asc(tasks.dueDate)),
    db.select().from(events).where(eq(events.weddingId, weddingId)).orderBy(asc(events.date)),
  ]);
  const names: [string, string] = [wedding.partnerOneName, wedding.partnerTwoName];
  const done = all.filter((t) => t.completedAt).length;
  const overdue = all.filter((t) => !t.completedAt && t.dueDate && t.dueDate < today);
  let list = all;
  if (sp.who) list = list.filter((t) => t.assignee === sp.who || (sp.who !== "both" && t.assignee === "both"));
  if (sp.filter === "overdue") list = overdue;
  else if (sp.filter === "open") list = list.filter((t) => !t.completedAt);
  else if (sp.filter === "done") list = list.filter((t) => t.completedAt);
  const daysLeft = wedding.weddingDate ? daysBetween(today, wedding.weddingDate) : null;
  const view = sp.view === "calendar" ? "calendar" : "list";

  return (
    <>
      <PageHeader folio="V · Wedding Checklist" title="The checklist" lede={daysLeft != null && daysLeft >= 0 ? `${daysLeft} days until ${fmtDate(wedding.weddingDate, "long")}.` : undefined} />
      <div className="mb-6 grid gap-5 md:grid-cols-[auto_1fr]">
        <div className="sheet flex items-center gap-5 px-6 py-4">
          <span className="font-display text-5xl leading-none">{daysLeft ?? "—"}</span>
          <span className="text-xs uppercase leading-tight tracking-[0.2em] text-muted">days<br />remaining</span>
        </div>
        <div className="sheet flex flex-col justify-center gap-2 px-6 py-4">
          <div className="flex justify-between text-sm"><span>{done} of {all.length} done</span>{overdue.length > 0 && <span className="text-rose">{overdue.length} overdue</span>}</div>
          <Ribbon value={all.length ? done / all.length : 0} tone="sage" height={8} />
        </div>
      </div>

      <details className="sheet mb-6" open={all.length === 0}>
        <summary className="cursor-pointer px-5 py-3.5 font-display">+ Add a task or activity</summary>
        <div className="border-t border-linen p-5">
          <ActionForm action={saveTask} resetOnSuccess>
            <TaskFields names={names} evs={evs} />
            <div className="mt-4 flex justify-end"><SubmitButton>Add to checklist</SubmitButton></div>
          </ActionForm>
        </div>
      </details>

      <Tabs current={view === "calendar" ? "/app/checklist?view=calendar" : "/app/checklist"} items={[{ href: "/app/checklist", label: "List", count: all.length }, { href: "/app/checklist?view=calendar", label: "Calendar" }]} />

      {view === "calendar" ? (
        <MonthGrid month={sp.month ?? today.slice(0, 7)} today={today} basePath="/app/checklist?view=calendar" items={all.filter((t) => t.dueDate).map((t) => ({ date: t.dueDate!, label: t.title, tone: t.completedAt ? "muted" : t.dueDate! < today ? "rose" : t.kind === "activity" ? "ink" : "gold" }))} />
      ) : (
        <Card pad={false}>
          <AutoSubmit className="flex flex-wrap gap-2 border-b border-linen p-4">
            <Select name="filter" defaultValue={sp.filter ?? ""} className="w-auto"><option value="">All</option><option value="open">Open</option><option value="overdue">Overdue</option><option value="done">Completed</option></Select>
            <Select name="who" defaultValue={sp.who ?? ""} className="w-auto"><option value="">Everyone</option><option value="partner_one">{names[0]}</option><option value="partner_two">{names[1]}</option><option value="both">Shared</option></Select>
          </AutoSubmit>
          {list.length ? (
            <ul className="divide-y divide-linen">
              {list.map((t) => {
                const late = !t.completedAt && t.dueDate && t.dueDate < today;
                return (
                  <li key={t.id} className={cx(t.completedAt && "bg-ivory/50")}>
                    <div className="flex items-start gap-3 px-5 py-3.5">
                      <form action={toggleTask}>
                        <input type="hidden" name="id" value={t.id} />
                        <button aria-label={t.completedAt ? "Mark as not done" : "Mark as done"} className={cx("mt-0.5 flex h-5 w-5 items-center justify-center border text-[0.7rem]", t.completedAt ? "border-sage bg-sage text-ivory" : "border-ink/40 hover:border-gold")}>{t.completedAt ? "✓" : ""}</button>
                      </form>
                      <div className="min-w-0 flex-1">
                        <div className={cx("text-sm font-semibold", t.completedAt && "text-muted line-through")}>{t.title}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                          <span>{t.assignee === "both" ? "Both" : t.assignee === "partner_one" ? names[0] : names[1]}</span>
                          {t.dueDate && <span className={late ? "text-rose" : ""}>· {fmtDate(t.dueDate)} ({relativeDays(daysBetween(today, t.dueDate))})</span>}
                          {t.kind === "activity" && <Stamp tone="ink">Activity</Stamp>}
                          {t.recurrence !== "none" && <Stamp tone="muted">↻ {t.recurrence}</Stamp>}
                          <Stamp tone={prTone[t.priority]}>{t.priority}</Stamp>
                        </div>
                        {t.description && <p className="mt-1 text-xs text-ink-soft">{t.description}</p>}
                      </div>
                      <details className="relative">
                        <summary className="cursor-pointer list-none px-2 text-xs text-muted hover:text-ink">Edit</summary>
                        <div className="sheet absolute right-0 z-20 mt-2 w-[min(90vw,46rem)] p-5">
                          <ActionForm action={saveTask} closeOnSuccess>
                            <TaskFields t={t} names={names} evs={evs} />
                            <div className="mt-4 flex justify-end gap-2"><SubmitButton size="sm">Save</SubmitButton></div>
                          </ActionForm>
                          <form action={deleteTask} className="mt-2"><input type="hidden" name="id" value={t.id} /><ConfirmButton message="Delete this task?">Delete task</ConfirmButton></form>
                        </div>
                      </details>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="Nothing here">Try a different filter, or add a task above.</EmptyState>
          )}
        </Card>
      )}
    </>
  );
}
