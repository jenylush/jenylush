"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="sheet mx-auto mt-10 max-w-lg p-8 text-center">
      <div className="eyebrow mb-2">Something went wrong</div>
      <h1 className="font-display text-2xl">{error.message && !error.message.includes("digest") ? error.message : "We couldn't complete that."}</h1>
      <p className="mt-2 text-sm text-muted">Nothing was charged or lost. Try again, and if it keeps happening, refresh the page.</p>
      <button onClick={reset} className="mt-6 bg-ink px-4 py-2.5 text-sm font-semibold text-ivory">Try again</button>
    </div>
  );
}
