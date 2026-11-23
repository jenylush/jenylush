import Link from "next/link";
import { signup } from "@/app/actions/auth";
import { ActionForm, SubmitButton } from "@/components/client";
import { Field, Input } from "@/components/ui";

export const metadata = { title: "Create your workspace" };

export default async function Signup({ searchParams }: { searchParams: Promise<{ invite?: string; email?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <div className="eyebrow mb-2">{sp.invite ? "You've been invited" : "Step 1 of 2"}</div>
      <h1 className="font-display mb-2 text-3xl">{sp.invite ? "Join the wedding workspace" : "Start your wedding ledger"}</h1>
      <p className="mb-8 text-sm text-muted">{sp.invite ? "Create your login to join your partner's workspace." : "Your own private workspace — no one else can see your figures or guests."}</p>
      <ActionForm action={signup} className="space-y-5">
        <input type="hidden" name="invite" value={sp.invite ?? ""} />
        <Field label="Your name"><Input name="name" autoComplete="name" required /></Field>
        <Field label="Email"><Input name="email" type="email" autoComplete="email" required defaultValue={sp.email ?? ""} /></Field>
        <Field label="Password" hint="At least 8 characters."><Input name="password" type="password" autoComplete="new-password" minLength={8} required /></Field>
        <SubmitButton className="w-full" pendingText="Creating…">Continue</SubmitButton>
      </ActionForm>
      <p className="mt-6 text-sm text-muted">Already have an account? <Link className="text-ink underline underline-offset-4" href={`/login${sp.invite ? `?invite=${sp.invite}` : ""}`}>Sign in</Link></p>
    </>
  );
}
