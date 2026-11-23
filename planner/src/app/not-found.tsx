import Link from "next/link";
import { Seal } from "@/components/brand";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-5 text-center">
      <Seal size={56} className="text-gold" />
      <h1 className="font-display mt-6 text-4xl">This page isn&apos;t in the ledger.</h1>
      <p className="mt-2 text-sm text-muted">The link may have expired, or the page was moved.</p>
      <Link href="/" className="mt-6 text-sm underline underline-offset-4">Go home</Link>
    </main>
  );
}
