import { and, eq, isNull } from "drizzle-orm";
import { deleteEvent, invitePartner, saveEvent, savePreferences, saveProfile } from "@/app/actions/settings";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/client";
import { Card, Field, Input, MoneyInput, PageHeader, Select, Stamp } from "@/components/ui";
import { db } from "@/db";
import { events, invites, memberships, users } from "@/db/schema";
import { requireWorkspace } from "@/lib/auth";
import { integrationStatus } from "@/lib/config";
import { fmtDate } from "@/lib/dates";
import { naira } from "@/lib/money";
import { displayPhone } from "@/lib/phone";

export const metadata = { title: "Settings" };

const EVENT_TYPES = [["introduction", "Introduction"], ["traditional", "Traditional wedding"], ["white", "White wedding"], ["reception", "Reception"], ["after_party", "After-party"], ["other", "Other"]] as const;

export default async function Settings() {
  const { wedding: w, weddingId, role } = await requireWorkspace();
  const [evs, team, pending] = await Promise.all([
    db.select().from(events).where(eq(events.weddingId, weddingId)).orderBy(events.date),
    db.select({ name: users.name, email: users.email, role: memberships.role }).from(memberships).innerJoin(users, eq(users.id, memberships.userId)).where(eq(memberships.weddingId, weddingId)),
    db.select().from(invites).where(and(eq(invites.weddingId, weddingId), isNull(invites.acceptedAt))),
  ]);
  const integ = integrationStatus();

  return (
    <>
      <PageHeader folio="XIII · Settings" title="Settings" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Wedding details" folio="a." className="lg:row-span-2">
          <ActionForm action={saveProfile} className="grid gap-4 sm:grid-cols-2">
            <Field label="Partner one"><Input name="partnerOneName" defaultValue={w.partnerOneName} required /></Field>
            <Field label="Partner two"><Input name="partnerTwoName" defaultValue={w.partnerTwoName} required /></Field>
            <Field label="Partner one email"><Input type="email" name="partnerOneEmail" defaultValue={w.partnerOneEmail ?? ""} /></Field>
            <Field label="Partner two email"><Input type="email" name="partnerTwoEmail" defaultValue={w.partnerTwoEmail ?? ""} /></Field>
            <Field label="Partner one phone"><Input type="tel" name="partnerOnePhone" defaultValue={w.partnerOnePhone ? displayPhone(w.partnerOnePhone) : ""} /></Field>
            <Field label="Partner two phone"><Input type="tel" name="partnerTwoPhone" defaultValue={w.partnerTwoPhone ? displayPhone(w.partnerTwoPhone) : ""} /></Field>
            <Field label="Wedding date"><Input type="date" name="weddingDate" defaultValue={w.weddingDate ?? ""} /></Field>
            <Field label="Traditional wedding"><Input type="date" name="traditionalDate" defaultValue={w.traditionalDate ?? ""} /></Field>
            <Field label="White wedding"><Input type="date" name="whiteWeddingDate" defaultValue={w.whiteWeddingDate ?? ""} /></Field>
            <Field label="Estimated guests"><Input type="number" name="estimatedGuests" defaultValue={w.estimatedGuests ?? ""} /></Field>
            <Field label="Venue"><Input name="venue" defaultValue={w.venue ?? ""} /></Field>
            <Field label="City"><Input name="city" defaultValue={w.city ?? ""} /></Field>
            <Field label="Overall budget"><MoneyInput name="totalBudget" defaultValue={w.totalBudget} /></Field>
            <Field label="Currency"><Input value="NGN — Nigerian Naira (₦)" disabled readOnly /></Field>
            <div className="flex justify-end sm:col-span-2"><SubmitButton>Save details</SubmitButton></div>
          </ActionForm>
        </Card>

        <Card title="Events" folio="b." pad={false}>
          <ul className="divide-y divide-linen">
            {evs.map((e) => (
              <li key={e.id}>
                <details>
                  <summary className="flex cursor-pointer list-none justify-between gap-3 px-5 py-3 text-sm">
                    <span><b>{e.name}</b> <span className="text-muted">· {fmtDate(e.date)}{e.venue && ` · ${e.venue}`}</span></span>
                    <span className="figure text-xs text-muted">{e.budget ? naira(e.budget) : ""}</span>
                  </summary>
                  <div className="border-t border-dashed border-linen bg-ivory/40 p-5">
                    <EventForm e={e} />
                    <form action={deleteEvent} className="mt-2"><input type="hidden" name="id" value={e.id} /><ConfirmButton message="Delete this event? Its expenses stay, unlinked.">Delete event</ConfirmButton></form>
                  </div>
                </details>
              </li>
            ))}
          </ul>
          <div className="border-t border-linen p-5"><div className="eyebrow mb-3">Add event</div><EventForm /></div>
        </Card>

        <Card title="Notifications & reminders" folio="c.">
          <ActionForm action={savePreferences} className="space-y-5">
            <div>
              <div className="mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">Channels</div>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" name="notifyEmail" defaultChecked={w.notifyEmail} className="accent-[#8F7444]" /> Email</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="notifyWhatsapp" defaultChecked={w.notifyWhatsapp} className="accent-[#8F7444]" /> WhatsApp</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="notifyInApp" defaultChecked={w.notifyInApp} className="accent-[#8F7444]" /> In-app</label>
              </div>
            </div>
            <div>
              <div className="mb-2 text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-ink-soft">Remind us before a vendor payment is due</div>
              <div className="flex flex-wrap gap-4 text-sm">
                {[14, 7, 5, 3, 1, 0].map((n) => <label key={n} className="flex items-center gap-2"><input type="checkbox" name="offsets" value={n} defaultChecked={w.reminderOffsets.includes(n)} className="accent-[#8F7444]" /> {n === 0 ? "On the day" : `${n} day${n > 1 ? "s" : ""}`}</label>)}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Repeat overdue reminders every" hint="days"><Input type="number" min={1} max={30} name="overdueRepeatDays" defaultValue={w.overdueRepeatDays} /></Field>
              <Field label="Remind Aso Ebi guests" hint="days before the payment deadline"><Input type="number" min={0} max={30} name="guestReminderDays" defaultValue={w.guestReminderDays} /></Field>
            </div>
            <div className="flex justify-end"><SubmitButton>Save preferences</SubmitButton></div>
          </ActionForm>
        </Card>

        <Card title="People with access" folio="d.">
          <ul className="mb-4 space-y-2 text-sm">
            {team.map((t) => <li key={t.email} className="flex justify-between"><span>{t.name} <span className="text-muted">· {t.email}</span></span><Stamp tone={t.role === "owner" ? "gold" : "muted"}>{t.role}</Stamp></li>)}
            {pending.map((p) => <li key={p.id} className="flex justify-between text-muted"><span>{p.email}</span><Stamp>invited · {p.role}</Stamp></li>)}
          </ul>
          {(role === "owner" || role === "partner") && (
            <ActionForm action={invitePartner} className="grid items-end gap-3 sm:grid-cols-[1fr_9rem_auto]" resetOnSuccess>
              <Field label="Invite by email"><Input type="email" name="email" required /></Field>
              <Field label="Role"><Select name="role"><option value="partner">Partner</option><option value="planner">Planner</option><option value="viewer">View only</option></Select></Field>
              <SubmitButton size="sm">Invite</SubmitButton>
            </ActionForm>
          )}
        </Card>

        <Card title="Integrations" folio="e." className="lg:col-span-2" pad={false}>
          <div id="integrations" />
          <ul className="divide-y divide-linen">
            {integ.map((i) => (
              <li key={i.key} className="grid gap-2 px-5 py-4 md:grid-cols-[14rem_1fr_auto] md:items-center">
                <div><div className="font-semibold">{i.name}</div><div className="text-xs text-muted">{i.purpose}</div></div>
                <div className="text-xs text-muted">
                  Environment variables: {i.env.map((e) => <code key={e} className="figure mr-1 bg-sand/60 px-1">{e}</code>)}
                  {"webhook" in i && i.webhook && <div className="mt-1">Webhook URL: <code className="figure bg-sand/60 px-1">{i.webhook}</code></div>}
                </div>
                <Stamp tone={i.connected ? "sage" : "rose"}>{i.connected ? "Connected" : "Not connected"}</Stamp>
              </li>
            ))}
          </ul>
          <p className="border-t border-linen px-5 py-3 text-xs text-muted">Secrets live only in server environment variables and are never sent to the browser. See README → “Connecting live services”.</p>
        </Card>
      </div>
    </>
  );
}

function EventForm({ e }: { e?: typeof events.$inferSelect }) {
  return (
    <ActionForm action={saveEvent} className="grid items-end gap-3 sm:grid-cols-2" resetOnSuccess={!e} closeOnSuccess={!!e}>
      {e && <input type="hidden" name="id" value={e.id} />}
      <Field label="Name"><Input name="name" defaultValue={e?.name} required /></Field>
      <Field label="Type"><Select name="type" defaultValue={e?.type ?? "other"}>{EVENT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      <Field label="Date"><Input type="date" name="date" defaultValue={e?.date ?? ""} /></Field>
      <Field label="Event budget"><MoneyInput name="budget" defaultValue={e?.budget} /></Field>
      <Field label="Venue" className="sm:col-span-2"><Input name="venue" defaultValue={e?.venue ?? ""} /></Field>
      <div className="flex justify-end sm:col-span-2"><SubmitButton size="sm">{e ? "Save event" : "Add event"}</SubmitButton></div>
    </ActionForm>
  );
}
