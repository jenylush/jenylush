import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { addInstalment, deleteExpense, deleteExpensePayment, deleteInstalment, recordExpensePayment, toggleCancelExpense, uploadAttachment } from "@/app/actions/budget";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/client";
import { ExpenseForm } from "@/components/forms";
import { Button, Card, Field, Input, Money, MoneyInput, Notice, PageHeader, Ribbon, Select, Stamp, Stat, expenseTone } from "@/components/ui";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { loadExpenses, loadLookups } from "@/lib/data";
import { fmtDate, fmtDateTime, todayISO } from "@/lib/dates";
import { EXPENSE_STATUS_LABEL } from "@/lib/finance";
import { naira } from "@/lib/money";
import { fileUrl } from "@/lib/storage";

const instTone = { paid: "sage", partial: "gold", due: "muted", overdue: "rose" } as const;

export default async function ExpenseDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { weddingId } = await requireWorkspace();
  const [list, lookups] = await Promise.all([loadExpenses(weddingId), loadLookups(weddingId)]);
  const e = list.find((x) => x.id === id);
  if (!e) notFound();
  const s = e.state;
  const history = await db.select().from(auditLogs).where(and(eq(auditLogs.weddingId, weddingId), eq(auditLogs.entityId, id))).orderBy(desc(auditLogs.createdAt)).limit(12);
  const scheduled = s.instalments.reduce((a, i) => a + i.amount, 0);

  return (
    <>
      <PageHeader
        folio={`II · ${e.category?.name ?? "Expense"}${e.event ? ` · ${e.event.name}` : ""}`}
        title={e.name}
        lede={<>{e.vendor ? <>Vendor: <Link className="underline underline-offset-2" href={`/app/vendors/${e.vendor.id}`}>{e.vendor.name}</Link> · </> : null}<Stamp tone={expenseTone(s.status)}>{EXPENSE_STATUS_LABEL[s.status]}</Stamp></>}
        actions={
          <>
            <form action={toggleCancelExpense}><input type="hidden" name="id" value={e.id} /><Button variant="ghost">{e.cancelledAt ? "Restore expense" : "Mark cancelled"}</Button></form>
            <form action={deleteExpense}><input type="hidden" name="id" value={e.id} /><ConfirmButton size="md" message="Delete this expense and all its payments? This can't be undone.">Delete</ConfirmButton></form>
          </>
        }
      />

      <div className="sheet mb-6 p-5">
        <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
          <Stat label="Total cost" value={naira(s.total)} sub={e.actualCost == null ? "Estimate" : `Estimated ${naira(e.estimatedCost)}`} />
          <Stat label="Paid" value={naira(s.paid)} tone="sage" />
          <Stat label="Outstanding" value={naira(s.outstanding)} tone={s.status === "overdue" ? "rose" : "gold"} />
          <Stat label="Next due" value={s.nextDue ? fmtDate(s.nextDue.date) : "—"} sub={s.nextDue ? `${s.nextDue.label} · ${naira(s.nextDue.amount)}` : undefined} />
        </div>
        <div className="mt-5"><Ribbon value={s.progress} tone={s.status === "overdue" ? "rose" : "sage"} height={10} label="Paid" /></div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-6">
          <Card title="Instalments" folio="a." pad={false} action={scheduled !== s.total && s.instalments.length ? <span className="text-xs text-rose">Scheduled {naira(scheduled)} ≠ total</span> : null}>
            {s.instalments.length ? (
              <table className="data-table">
                <thead><tr><th>Instalment</th><th>Due</th><th className="num">Amount</th><th className="num">Remaining</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {s.instalments.map((i) => (
                    <tr key={i.id}>
                      <td>{i.label}</td>
                      <td className="whitespace-nowrap">{fmtDate(i.dueDate)}</td>
                      <td className="num">{naira(i.amount)}</td>
                      <td className="num">{naira(i.remaining)}</td>
                      <td><Stamp tone={instTone[i.status]}>{i.status}</Stamp></td>
                      <td className="text-right"><form action={deleteInstalment}><input type="hidden" name="id" value={i.id} /><ConfirmButton variant="quiet" message="Remove this instalment?">×</ConfirmButton></form></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-5 py-4 text-sm text-muted">No instalments — {e.dueDate ? `the full amount is due ${fmtDate(e.dueDate)}` : "add a due date or split it into instalments"}.</p>
            )}
            <div className="border-t border-linen p-5">
              <ActionForm action={addInstalment} className="grid items-end gap-3 sm:grid-cols-[1fr_9rem_10rem_auto]" resetOnSuccess>
                <input type="hidden" name="expenseId" value={e.id} />
                <Field label="Label"><Input name="label" placeholder={`Instalment ${s.instalments.length + 1}`} required /></Field>
                <Field label="Amount"><MoneyInput name="amount" required /></Field>
                <Field label="Due date"><Input type="date" name="dueDate" required /></Field>
                <SubmitButton size="sm">Add</SubmitButton>
              </ActionForm>
            </div>
          </Card>

          <Card title="Payments made" folio="b." pad={false}>
            {e.payments.length ? (
              <table className="data-table">
                <thead><tr><th>Date</th><th>Method</th><th>Reference</th><th className="num">Amount</th><th /></tr></thead>
                <tbody>
                  {[...e.payments].sort((a, b) => a.paidOn.localeCompare(b.paidOn)).map((p) => (
                    <tr key={p.id}>
                      <td className="whitespace-nowrap">{fmtDate(p.paidOn)}</td>
                      <td className="capitalize">{p.method}</td>
                      <td className="text-xs text-muted">{p.reference ?? "—"}{p.evidenceFileId && <> · <a className="text-gold-deep underline" href={fileUrl(p.evidenceFileId)!} target="_blank">evidence</a></>}{p.note && <div>{p.note}</div>}</td>
                      <td className="num text-sage">{naira(p.amount)}</td>
                      <td className="text-right"><form action={deleteExpensePayment}><input type="hidden" name="id" value={p.id} /><ConfirmButton variant="quiet" message="Delete this payment record? Balances will be recalculated.">×</ConfirmButton></form></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-5 py-4 text-sm text-muted">No payments recorded yet.</p>
            )}
            {!e.cancelledAt && s.outstanding > 0 && (
              <div className="border-t border-linen bg-gold-soft/20 p-5">
                <div className="eyebrow mb-3">Record a payment</div>
                <ActionForm action={recordExpensePayment} className="grid items-end gap-3 sm:grid-cols-3" resetOnSuccess>
                  <input type="hidden" name="expenseId" value={e.id} />
                  <Field label="Amount"><MoneyInput name="amount" defaultValue={s.nextDue?.amount} required /></Field>
                  <Field label="Date paid"><Input type="date" name="paidOn" defaultValue={todayISO()} required /></Field>
                  <Field label="Method"><Select name="method"><option value="transfer">Bank transfer</option><option value="cash">Cash</option><option value="card">Card</option><option value="pos">POS</option><option value="cheque">Cheque</option><option value="other">Other</option></Select></Field>
                  <Field label="Reference"><Input name="reference" placeholder="Bank / transfer ref" /></Field>
                  <Field label="Evidence"><Input type="file" name="evidence" accept="image/*,application/pdf" className="text-xs" /></Field>
                  <SubmitButton>Record payment</SubmitButton>
                </ActionForm>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Receipts & documents" folio="c.">
            {e.attachments.length ? (
              <ul className="mb-4 space-y-2 text-sm">
                {e.attachments.map((a) => <li key={a.fileId}><a className="text-gold-deep underline underline-offset-2" target="_blank" href={fileUrl(a.fileId)!}>{a.file.filename}</a> <span className="text-xs text-faint">· {fmtDateTime(a.file.createdAt)}</span></li>)}
              </ul>
            ) : <p className="mb-4 text-sm text-muted">No attachments yet.</p>}
            <ActionForm action={uploadAttachment} className="flex items-end gap-2" resetOnSuccess>
              <input type="hidden" name="expenseId" value={e.id} />
              <Input type="file" name="file" accept="image/*,application/pdf" className="text-xs" required />
              <SubmitButton size="sm">Upload</SubmitButton>
            </ActionForm>
          </Card>

          {e.description || e.notes ? (
            <Card title="Notes" folio="d.">
              {e.description && <p className="text-sm">{e.description}</p>}
              {e.notes && <p className="mt-2 whitespace-pre-line text-sm text-ink-soft">{e.notes}</p>}
            </Card>
          ) : null}

          <details className="sheet">
            <summary className="cursor-pointer px-5 py-3.5 font-display">Edit expense details</summary>
            <div className="border-t border-linen p-5"><ExpenseForm lookups={lookups} expense={e} /></div>
          </details>

          <Card title="History" folio="e.">
            {history.length ? (
              <ol className="space-y-2.5 text-xs">
                {history.map((h) => <li key={h.id} className="border-l border-gold pl-3"><div className="text-ink">{h.summary}</div><div className="text-faint">{fmtDateTime(h.createdAt)} · {h.actor}</div></li>)}
              </ol>
            ) : <p className="text-sm text-muted">Changes to this expense will be logged here.</p>}
          </Card>
          {e.cancelledAt && <Notice title="This expense is cancelled">It no longer counts towards committed or outstanding totals. Money already paid ({naira(s.paid)}) still counts as spent.</Notice>}
        </div>
      </div>
    </>
  );
}
