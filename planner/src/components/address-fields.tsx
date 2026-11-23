import { Field, Input, Select, Textarea } from "./ui";
import { NG_STATES } from "@/lib/phone";

type A = { street: string; area: string; city: string; state: string; landmark: string | null; instructions: string | null } | null | undefined;

export function AddressFields({ a, required = true }: { a?: A; required?: boolean }) {
  return (
    <>
      <Field label="Street address" className="sm:col-span-2" required={required}><Input name="street" autoComplete="street-address" defaultValue={a?.street} placeholder="House number and street" required={required} /></Field>
      <Field label="State" required={required}>
        <Select name="state" defaultValue={a?.state ?? "Lagos"} required={required}>
          {NG_STATES.map((s) => <option key={s}>{s}</option>)}
        </Select>
      </Field>
      <Field label="City / town" required={required}><Input name="city" autoComplete="address-level2" defaultValue={a?.city} placeholder="e.g. Lagos" required={required} /></Field>
      <Field label="Area / neighbourhood" required={required}><Input name="area" defaultValue={a?.area} placeholder="e.g. Lekki Phase 1" required={required} /></Field>
      <Field label="Closest landmark"><Input name="landmark" defaultValue={a?.landmark ?? ""} placeholder="e.g. Opposite Shoprite" /></Field>
      <Field label="Delivery instructions" className="sm:col-span-2"><Textarea name="instructions" defaultValue={a?.instructions ?? ""} className="min-h-[42px]" placeholder="Gate code, best time to call…" /></Field>
    </>
  );
}
