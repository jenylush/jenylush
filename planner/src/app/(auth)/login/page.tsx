import Link from "next/link";
import { login } from "@/app/actions/auth";
import { ActionForm, SubmitButton } from "@/components/client";
import { Field, Input } from "@/components/ui";

export const metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; demo?: string; invite?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <div className="eyebrow mb-2">Welcome back</div>
      <h1 className="font-display mb-8 text-3xl">Open your ledger</h1>
      <ActionForm action={login} className="space-y-5">
        <input type="hidden" name="next" value={sp.next ?? ""} />
        <input type="hidden" name="invite" value={sp.invite ?? ""} />
        <Field label="Email"><Input name="email" type="email" autoComplete="email" required defaultValue={sp.demo ? "demo@owambe.ng" : ""} /></Field>
        <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required defaultValue={sp.demo ? "demo-wedding" : ""} /></Field>
        <SubmitButton className="w-full" pendingText="Signing in…">Sign in</SubmitButton>
      </ActionForm>
      <p className="mt-6 text-sm text-muted">New here? <Link className="text-ink underline underline-offset-4" href={`/signup${sp.invite ? `?invite=${sp.invite}` : ""}`}>Create a workspace</Link></p>
    </>
  );
}
