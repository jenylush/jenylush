import { saveCampaign } from "@/app/actions/asoebi";
import { ActionForm, SubmitButton } from "./client";
import { Field, Input, MoneyInput, Select, Textarea } from "./ui";
import type { campaigns, events } from "@/db/schema";
import { displayPhone } from "@/lib/phone";

export function CampaignForm({ evs, c }: { evs: Array<typeof events.$inferSelect>; c?: typeof campaigns.$inferSelect }) {
  const check = (name: string, label: string, on: boolean, hint?: string) => (
    <label className="flex items-start gap-2.5 text-sm">
      <input type="checkbox" name={name} defaultChecked={on} className="mt-1 accent-[#8F7444]" />
      <span>{label}{hint && <span className="block text-xs text-muted">{hint}</span>}</span>
    </label>
  );
  return (
    <ActionForm action={saveCampaign} className="space-y-8">
      {c && <input type="hidden" name="id" value={c.id} />}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Campaign name" required><Input name="name" defaultValue={c?.name} placeholder="Traditional wedding Aso Ebi" required /></Field>
        <Field label="Wedding event"><Select name="eventId" defaultValue={c?.eventId ?? ""}><option value="">—</option>{evs.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select></Field>
        <Field label="Fabric name" required><Input name="fabricName" defaultValue={c?.fabricName} placeholder="Gold & wine aso-oke with champagne lace" required /></Field>
        <Field label="Colour story"><Input name="colourStory" defaultValue={c?.colourStory ?? ""} placeholder="Wine, antique gold, champagne" /></Field>
        <Field label="Description" className="sm:col-span-2"><Textarea name="description" defaultValue={c?.description ?? ""} /></Field>
        <Field label="Ordering instructions for guests" className="sm:col-span-2"><Textarea name="instructions" defaultValue={c?.instructions ?? ""} /></Field>
      </div>
      <div className="grid gap-5 border-t border-linen pt-6 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <div className="font-display text-lg">Where guests send money</div>
          <p className="text-xs text-muted">Shown to each guest after they place their order. They then tap “I have sent the money”.</p>
        </div>
        <Field label="Bank" required><Input name="bankName" defaultValue={c?.bankName ?? ""} placeholder="e.g. GTBank, Opay, Access" required /></Field>
        <Field label="Account number" required><Input name="accountNumber" inputMode="numeric" maxLength={10} defaultValue={c?.accountNumber ?? ""} placeholder="0123456789" className="figure" required /></Field>
        <Field label="Account name" required><Input name="accountName" defaultValue={c?.accountName ?? ""} required /></Field>
        <Field label="Sales open"><Input type="date" name="salesOpenAt" defaultValue={c?.salesOpenAt ?? ""} /></Field>
        <Field label="Sales close"><Input type="date" name="salesCloseAt" defaultValue={c?.salesCloseAt ?? ""} /></Field>
        <Field label="Payment deadline"><Input type="date" name="paymentDeadline" defaultValue={c?.paymentDeadline ?? ""} /></Field>
      </div>
      <div className="grid gap-5 border-t border-linen pt-6 sm:grid-cols-2">
        <div className="space-y-3">
          {check("allowDelivery", "Offer home delivery", c?.allowDelivery ?? true)}
          {check("allowPickup", "Offer pickup / collection", c?.allowPickup ?? true)}
        </div>
        <Field label="Delivery fee (per order)"><MoneyInput name="deliveryFee" defaultValue={c?.deliveryFee} /></Field>
        <Field label="Delivery arrangements"><Textarea name="deliveryDetails" defaultValue={c?.deliveryDetails ?? ""} placeholder="Lagos 3–5 days; outside Lagos via GIG" /></Field>
        <Field label="Pickup arrangements"><Textarea name="pickupDetails" defaultValue={c?.pickupDetails ?? ""} placeholder="Address and collection hours" /></Field>
        <Field label="Contact name"><Input name="contactName" defaultValue={c?.contactName ?? ""} /></Field>
        <Field label="Contact phone"><Input name="contactPhone" type="tel" defaultValue={c?.contactPhone ? displayPhone(c.contactPhone) : ""} /></Field>
        <Field label="Page accent colour" hint="Match your fabric."><Input type="color" name="accent" defaultValue={c?.accent ?? "#8E5B5B"} className="h-[42px] w-24 p-1" /></Field>
      </div>
      <div className="flex justify-end"><SubmitButton>{c ? "Save campaign" : "Create campaign"}</SubmitButton></div>
    </ActionForm>
  );
}
