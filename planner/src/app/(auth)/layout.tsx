import Link from "next/link";
import { Wordmark } from "@/components/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh md:grid-cols-[1fr_1.1fr]">
      <aside className="relative hidden overflow-hidden bg-ink p-10 text-ivory md:flex md:flex-col md:justify-between">
        <Link href="/"><Wordmark light /></Link>
        <div>
          <p className="font-display text-[2.6rem] leading-[1.05]">
            “Write it down,<br />and the money <em className="text-gold">behaves.</em>”
          </p>
          <p className="mt-4 text-sm text-ivory/60">— every aunty who has ever planned an owambe</p>
        </div>
        <div className="weave absolute -bottom-24 -right-24 h-72 w-72 rotate-12 bg-gold/25" aria-hidden />
      </aside>
      <section className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 md:hidden"><Link href="/"><Wordmark /></Link></div>
          {children}
        </div>
      </section>
    </main>
  );
}
