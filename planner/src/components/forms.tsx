import { saveExpense } from "@/app/actions/budget";
import { ActionForm, SubmitButton } from "./client";
import { Field, Input, MoneyInput, Select, Textarea } from "./ui";
import type { categories, events, expenses, vendors } from "@/db/schema";

type Lookups = { categories: Array<typeof categories.$inferSelect>; events: Array<typeof events.$inferSelect>; vendors: Array<typeof vendors.$inferSelect> };

export function ExpenseForm({ lookups, expense, defaults }: { lookups: Lookups; expense?: typeof expenses.$inferSelect; defaults?: { vendorId?: string; categoryId?: string } }) {
  const e = expense;
  return (
    <ActionForm action={saveExpense} className="grid gap-5 sm:grid-cols-2">
      {e && <input type="hidden" name="id" value={e.id} />}
      <Field label="Expense name" required className="sm:col-span-2"><Input name="name" defaultValue={e?.name} placeholder="e.g. Small chops for 450 guests" required /></Field>
      <Field label="Category">
        <Select name="categoryId" defaultValue={e?.categoryId ?? defaults?.categoryId ?? ""}>
          <option value="">Uncategorised</option>
          {lookups.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Wedding event">
        <Select name="eventId" defaultValue={e?.eventId ?? ""}>
          <option value="">Whole wedding</option>
          {lookups.events.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Vendor / service provider" hint="Add new vendors under Vendors.">
        <Select name="vendorId" defaultValue={e?.vendorId ?? defaults?.vendorId ?? ""}>
          <option value="">No vendor</option>
          {lookups.vendors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
      </Field>
      <Field label="Payment due date" hint="Or add instalments after saving."><Input type="date" name="dueDate" defaultValue={e?.dueDate ?? ""} /></Field>
      <Field label="Estimated cost" required><MoneyInput name="estimatedCost" defaultValue={e?.estimatedCost} required /></Field>
      <Field label="Actual / agreed cost" hint="Leave blank until you have a quote or invoice."><MoneyInput name="actualCost" defaultValue={e?.actualCost} /></Field>
      {!e && <Field label="Amount already paid" hint="Recorded as a payment today."><MoneyInput name="initialPayment" /></Field>}
      {!e && <Field label="Receipt or evidence" hint="JPG, PNG, WEBP or PDF · 8 MB max"><Input type="file" name="receipt" accept="image/*,application/pdf" className="file:mr-3 file:border-0 file:bg-sand file:px-3 file:py-1" /></Field>}
      <Field label="Description" className="sm:col-span-2"><Textarea name="description" defaultValue={e?.description ?? ""} /></Field>
      <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" defaultValue={e?.notes ?? ""} /></Field>
      <div className="sm:col-span-2 flex justify-end"><SubmitButton>{e ? "Save changes" : "Add expense"}</SubmitButton></div>
    </ActionForm>
  );
}
