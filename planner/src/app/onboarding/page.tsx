import { completeOnboarding } from "@/app/actions/onboarding";
import { Wordmark } from "@/components/brand";
import { ActionForm, SubmitButton } from "@/components/client";
import { Field, Input, MoneyInput, Select } from "@/components/ui";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Set up your wedding" };

const EVENTS = [
  ["introduction", "Introduction"],
  ["traditional", "Traditional wedding"],
  ["white", "White / church wedding"],
  ["reception", "Reception"],
  ["after_party", "After-party"],
] as const;

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-6 border-t border-linen py-8 md:grid-cols-[13rem_1fr]">
      <legend className="sr-only">{title}</legend>
      <div>
        <div className="font-display text-3xl italic text-gold">{n}</div>
        <div className="font-display mt-1 text-lg">{title}</div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export default async function Onboarding() {
  const user = await requireUser();
  return (
    <main className="mx-auto max-w-4xl px-5 py-10">
      <Wordmark />
      <div className="mt-12">
        <div className="eyebrow mb-2">Step 2 of 2</div>
        <h1 className="font-display text-4xl">Tell us about the wedding</h1>
        <p className="mt-2 max-w-lg text-sm text-muted">We&apos;ll set up your budget categories and events from this. You can change everything later in Settings.</p>
      </div>
      <ActionForm action={completeOnboarding} className="mt-8">
        <Section n="i." title="The couple">
          <Field label="Partner one" required><Input name="partnerOneName" defaultValue={user.name} required /></Field>
          <Field label="Partner two" required><Input name="partnerTwoName" required /></Field>
          <Field label="Partner one email" required hint="Payment reminders go here."><Input name="partnerOneEmail" type="email" defaultValue={user.email} required /></Field>
          <Field label="Partner two email"><Input name="partnerTwoEmail" type="email" /></Field>
          <Field label="Partner one phone" required><Input name="partnerOnePhone" type="tel" placeholder="0803 123 4567" required /></Field>
          <Field label="Partner two phone"><Input name="partnerTwoPhone" type="tel" placeholder="0805 987 6543" /></Field>
        </Section>
        <Section n="ii." title="The dates">
          <Field label="Main wedding date" required><Input name="weddingDate" type="date" required /></Field>
          <Field label="Traditional wedding" hint="If applicable"><Input name="traditionalDate" type="date" /></Field>
          <Field label="Church / white wedding" hint="If applicable"><Input name="whiteWeddingDate" type="date" /></Field>
          <Field label="Venue"><Input name="venue" placeholder="e.g. Harbour Point, Victoria Island" /></Field>
          <Field label="City"><Input name="city" placeholder="Lagos" /></Field>
          <Field label="Estimated guests"><Input name="estimatedGuests" type="number" min={0} placeholder="350" /></Field>
        </Section>
        <Section n="iii." title="The money">
          <Field label="Overall budget" required hint="Split across 18 suggested categories — adjust any time."><MoneyInput name="totalBudget" placeholder="15,000,000" required /></Field>
          <Field label="Currency"><Select name="currency" defaultValue="NGN"><option value="NGN">Nigerian Naira (₦)</option></Select></Field>
          <div className="sm:col-span-2">
            <div className="mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">Events you&apos;re planning</div>
            <div className="flex flex-wrap gap-2">
              {EVENTS.map(([v, l]) => (
                <label key={v} className="flex cursor-pointer items-center gap-2 border border-linen bg-paper px-3 py-2 text-sm has-[:checked]:border-gold has-[:checked]:bg-gold-soft/50">
                  <input type="checkbox" name="events" value={v} defaultChecked={v !== "after_party"} className="accent-[#8F7444]" /> {l}
                </label>
              ))}
            </div>
          </div>
        </Section>
        <div className="flex justify-end border-t border-linen pt-6">
          <SubmitButton pendingText="Setting up…">Open my ledger →</SubmitButton>
        </div>
      </ActionForm>
    </main>
  );
}
