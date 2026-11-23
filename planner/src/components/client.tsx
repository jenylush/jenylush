"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/action";
import { buttonClass, cx, type BtnVariant } from "./ui";

export function SubmitButton({ children, variant = "primary", size = "md", className, pendingText, name, value }: { children: ReactNode; variant?: BtnVariant; size?: "sm" | "md"; className?: string; pendingText?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending} className={cx(buttonClass(variant, size), className)}>
      {pending ? (pendingText ?? "Saving…") : children}
    </button>
  );
}

/**
 * Wraps a server action of shape (prev, formData) => ActionState.
 * Shows validation errors inline, optionally resets on success, and can close a parent <details>.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
  closeOnSuccess,
  successText,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  closeOnSuccess?: boolean;
  successText?: string;
}) {
  const [state, formAction] = useActionState(action, {} as ActionState);
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (!state.ok) return;
    if (resetOnSuccess) ref.current?.reset();
    if (closeOnSuccess) ref.current?.closest("details")?.removeAttribute("open");
    if (state.redirect) router.push(state.redirect);
  }, [state, resetOnSuccess, closeOnSuccess, router]);
  return (
    <form ref={ref} action={formAction} className={className} noValidate={false}>
      {state.error && (
        <div role="alert" className="mb-4 border-l-2 border-rose bg-rose-soft px-3 py-2 text-sm text-ink">
          {state.error}
          {state.fieldErrors && (
            <ul className="mt-1 list-disc pl-5 text-xs text-ink-soft">
              {Object.entries(state.fieldErrors).map(([k, v]) => (
                <li key={k}>{v}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {state.ok && (successText || state.message) && (
        <div role="status" className="mb-4 border-l-2 border-sage bg-sage-soft px-3 py-2 text-sm text-ink">
          {state.message ?? successText}
        </div>
      )}
      {children}
    </form>
  );
}

export function ConfirmButton({ children, message = "Are you sure?", variant = "danger", size = "sm", className }: { children: ReactNode; message?: string; variant?: BtnVariant; size?: "sm" | "md"; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cx(buttonClass(variant, size), className)}
      onClick={(e) => {
        if (!confirm(message)) e.preventDefault();
      }}
    >
      {pending ? "…" : children}
    </button>
  );
}

export function CopyButton({ text, label = "Copy link", variant = "ghost", size = "md" }: { text: string; label?: string; variant?: BtnVariant; size?: "sm" | "md" }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={buttonClass(variant, size)}
      onClick={async () => {
        const full = text.startsWith("/") ? `${window.location.origin}${text}` : text;
        try {
          await navigator.clipboard.writeText(full);
        } catch {
          prompt("Copy this:", full);
        }
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
    >
      {done ? "Copied ✓" : label}
    </button>
  );
}

/** Opens a link that may be relative, resolving against the current origin (for share intents). */
export function ShareLinks({ path, message }: { path: string; message: string }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const url = `${origin}${path}`;
  const text = `${message}\n${url}`;
  return (
    <div className="flex flex-wrap gap-2">
      <a className={buttonClass("ghost", "sm")} target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(text)}`}>WhatsApp</a>
      <a className={buttonClass("ghost", "sm")} href={`mailto:?subject=${encodeURIComponent("Aso Ebi order")}&body=${encodeURIComponent(text)}`}>Email</a>
      <a className={buttonClass("ghost", "sm")} href={`sms:?&body=${encodeURIComponent(text)}`}>SMS</a>
      <a className={buttonClass("ghost", "sm")} target="_blank" rel="noreferrer" href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`}>X / Twitter</a>
      <a className={buttonClass("ghost", "sm")} target="_blank" rel="noreferrer" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`}>Facebook</a>
    </div>
  );
}

/** Auto-submits a <select> or checkbox filter form on change. */
export function AutoSubmit({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <form
      className={className}
      onChange={(e) => {
        const f = e.currentTarget;
        const t = e.target as unknown as HTMLInputElement;
        if (t.tagName !== "INPUT" || (t.type !== "search" && t.type !== "text")) f.requestSubmit();
      }}
    >
      {children}
    </form>
  );
}

export function LocalTime({ iso }: { iso: string }) {
  const [s, setS] = useState("");
  useEffect(() => setS(new Date(iso).toLocaleString()), [iso]);
  return <time dateTime={iso}>{s}</time>;
}
