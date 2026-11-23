import Link from "next/link";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/brand";
import { buttonClass } from "@/components/ui";
import { getUser } from "@/lib/auth";

const entries = [
  ["Venue — Eko Hotel, Victoria Island", "₦3,500,000", "Paid", "sage"],
  ["Catering — Mama Cass Events, 2 of 3", "₦2,850,000", "Part", "gold"],
  ["Photography — Lens & Lace Studio", "₦500,000", "Due 3d", "rose"],
  ["Aso Ebi — 42 guests paid", "+₦3,570,000", "In", "ink"],
] as const;

const chapters = [
  ["I", "The budget, kept like a ledger", "Set one overall budget, split it across the introduction, traditional, white wedding and reception, and watch committed, paid and outstanding update the moment you record a payment."],
  ["II", "Vendors and their instalments", "Your photographer's ₦200k / ₦150k / ₦150k plan lives with its contract. Each instalment has its own due date, status and reminder."],
  ["III", "Reminders that actually arrive", "Seven days, three days, the day of, and every few days after a payment slips. By email today, WhatsApp when you connect it — with a full history of what was sent."],
  ["IV", "Aso Ebi, without the spreadsheet", "One link to share anywhere. Guests choose a package, say where to send it, transfer to your account and tap “I have sent the money”. Your register fills itself and exports straight to Excel."],
];

export default async function Landing() {
  if (await getUser()) redirect("/app");
  return (
    <main className="overflow-x-hidden">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6">
        <Wordmark />
        <nav className="flex items-center gap-2">
          <Link href="/login" className={buttonClass("quiet")}>Sign in</Link>
          <Link href="/signup" className={buttonClass("primary")}>Start your ledger</Link>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl gap-12 px-5 pb-20 pt-10 md:grid-cols-[1.15fr_1fr] md:pt-16">
        <div className="rise">
          <div className="eyebrow mb-5">For Nigerian couples · ₦ first</div>
          <h1 className="font-display text-[2.7rem] leading-[1.02] text-ink md:text-[4.4rem]">
            Every naira, every guest, every yard of <em className="text-gold-deep">Aso Ebi</em> — accounted for.
          </h1>
          <p className="mt-6 max-w-lg text-[1.02rem] leading-relaxed text-ink-soft">
            Owambe Ledger is a private workspace for your wedding money: budgets per event, vendor instalments with automatic reminders, and an Aso Ebi shop your guests can pay into from their phones.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className={buttonClass("primary")}>Create your wedding workspace</Link>
            <Link href="/login?demo=1" className={buttonClass("ghost")}>Explore the demo</Link>
          </div>
          <p className="mt-4 text-xs text-muted">Demo login: <span className="figure">demo@owambe.ng</span> / <span className="figure">demo-wedding</span></p>
        </div>

        <div className="relative rise" style={{ animationDelay: "120ms" }}>
          <div className="absolute -right-6 -top-6 hidden h-40 w-40 rounded-full border border-gold/40 md:block" aria-hidden />
          <div className="sheet relative rotate-[0.6deg] p-0">
            <div className="flex items-center justify-between border-b border-linen px-5 py-3">
              <span className="font-display italic">Adaeze &amp; Tunde</span>
              <span className="figure text-[0.7rem] text-muted">fol. 14</span>
            </div>
            <div className="px-5 pt-5">
              <div className="eyebrow !text-muted">Remaining budget</div>
              <div className="figure mt-1 text-4xl text-ink">₦4,210,000</div>
              <div className="mt-3 flex h-2.5 w-full overflow-hidden bg-sand">
                <div className="weave h-full bg-ink" style={{ width: "38%" }} />
                <div className="weave h-full bg-gold" style={{ width: "34%" }} />
              </div>
              <div className="mt-1.5 flex justify-between text-[0.68rem] text-muted"><span>Paid 38%</span><span>Committed 72% of ₦15m</span></div>
            </div>
            <ul className="mt-5 divide-y divide-linen border-t border-linen">
              {entries.map(([what, amt, tag, tone]) => (
                <li key={what} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span className="min-w-0 truncate text-ink-soft">{what}</span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="figure">{amt}</span>
                    <span className={`w-14 border px-1.5 py-0.5 text-center text-[0.58rem] font-semibold uppercase tracking-widest ${tone === "sage" ? "border-sage/40 text-sage" : tone === "gold" ? "border-gold text-gold-deep" : tone === "rose" ? "border-rose/40 text-rose" : "border-ink/30 text-ink"}`}>{tag}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <div className="rule-gold mx-auto max-w-6xl" />

      <section className="mx-auto grid max-w-6xl gap-x-14 gap-y-12 px-5 py-20 md:grid-cols-2">
        {chapters.map(([n, t, d]) => (
          <article key={n} className="grid grid-cols-[3rem_1fr] gap-4">
            <span className="font-display text-3xl italic text-gold">{n}</span>
            <div>
              <h2 className="font-display text-2xl text-ink">{t}</h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{d}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="bg-ink text-ivory">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-5 py-14 md:flex-row md:items-center">
          <div>
            <div className="eyebrow !text-gold">Private by design</div>
            <p className="font-display mt-2 max-w-xl text-2xl leading-snug">Your figures, guests and payments live in your own private workspace — no one else can see them.</p>
          </div>
          <Link href="/signup" className={buttonClass("gold")}>Begin</Link>
        </div>
      </section>
      <footer className="mx-auto max-w-6xl px-5 py-8 text-xs text-muted">© {new Date().getFullYear()} Owambe Ledger · Made for owambe season.</footer>
    </main>
  );
}
