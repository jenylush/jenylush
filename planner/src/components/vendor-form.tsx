import { saveVendor } from "@/app/actions/vendors";
import { ActionForm, SubmitButton } from "./client";
import { Field, Input, MoneyInput, Select, Textarea } from "./ui";
import type { categories, events, vendors } from "@/db/schema";
import { displayPhone } from "@/lib/phone";

export function VendorForm({ cats, evs, vendor }: { cats: Array<typeof categories.$inferSelect>; evs: Array<typeof events.$inferSelect>; vendor?: typeof vendors.$inferSelect }) {
  const v = vendor;
  return (
    <ActionForm action={saveVendor} className="space-y-8">
      {v && <input type="hidden" name="id" value={v.id} />}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Business name" required><Input name="name" defaultValue={v?.name} required /></Field>
        <Field label="Service category"><Select name="categoryId" defaultValue={v?.categoryId ?? ""}><option value="">—</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Contact person"><Input name="contactName" defaultValue={v?.contactName ?? ""} /></Field>
        <Field label="Phone"><Input name="phone" type="tel" placeholder="0803 123 4567" defaultValue={v?.phone ? displayPhone(v.phone) : ""} /></Field>
        <Field label="Email"><Input name="email" type="email" defaultValue={v?.email ?? ""} /></Field>
        <Field label="Instagram"><Input name="instagram" placeholder="@handle" defaultValue={v?.instagram ?? ""} /></Field>
        <Field label="Address" className="sm:col-span-2"><Input name="address" defaultValue={v?.address ?? ""} /></Field>
        <Field label="Contract / agreement" hint="PDF or image, 8 MB max."><Input type="file" name="contract" accept="image/*,application/pdf" className="text-xs" /></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" defaultValue={v?.notes ?? ""} /></Field>
      </div>
      <fieldset className="border-t border-linen pt-6">
        <legend className="font-display pr-3 text-lg">{v ? "Add another contract" : "Contract & payment schedule"}</legend>
        <p className="mb-4 text-sm text-muted">Optional. Creates an expense for this vendor and its instalments. Instalments must add up to the agreed price.</p>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Agreed price"><MoneyInput name="agreedPrice" placeholder="500,000" /></Field>
          <Field label="For event"><Select name="eventId"><option value="">Whole wedding</option>{evs.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select></Field>
        </div>
        <div className="mt-4 space-y-2">
          {["First instalment", "Second instalment", "Final payment", ""].map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_8rem_9.5rem] gap-2">
              <Input name="planLabel" defaultValue={l} placeholder="Instalment label" aria-label="Instalment label" />
              <Input name="planAmount" inputMode="decimal" placeholder="₦ amount" aria-label="Amount" className="figure" />
              <Input name="planDate" type="date" aria-label="Due date" />
            </div>
          ))}
        </div>
      </fieldset>
      <div className="flex justify-end"><SubmitButton>{v ? "Save vendor" : "Add vendor"}</SubmitButton></div>
    </ActionForm>
  );
}
