import { z } from "zod";
import { toKobo } from "./money";
import { normaliseNgPhone } from "./phone";

export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
  redirect?: string;
}

/** Turn FormData into a plain object; repeated keys become arrays. */
export function formObject(fd: FormData) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith("$ACTION")) continue;
    if (v instanceof File) continue;
    const val = typeof v === "string" ? v.trim() : v;
    if (k in out) out[k] = ([] as unknown[]).concat(out[k], val);
    else out[k] = val;
  }
  return out;
}

export function parse<T extends z.ZodTypeAny>(schema: T, fd: FormData): { data: z.infer<T> } | { error: ActionState } {
  const r = schema.safeParse(formObject(fd));
  if (r.success) return { data: r.data };
  const fieldErrors: Record<string, string> = {};
  for (const i of r.error.issues) fieldErrors[i.path.join(".") || "form"] ??= i.message;
  return { error: { error: "Please check the highlighted details.", fieldErrors } };
}

export async function guard(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (e) {
    // Let Next.js redirects/notFound propagate
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
    console.error(e);
    return { error: e instanceof Error ? e.message : "Something went wrong." };
  }
}

/* Reusable zod field types */
const blankToUndef = (v: unknown) => (v === "" || v == null ? undefined : v);
export const zs = {
  text: (max = 200) => z.string().trim().min(1, "Required").max(max),
  optText: (max = 2000) => z.preprocess(blankToUndef, z.string().trim().max(max).optional()),
  email: () => z.string().trim().toLowerCase().email("Enter a valid email address"),
  optEmail: () => z.preprocess(blankToUndef, z.string().trim().toLowerCase().email("Enter a valid email address").optional()),
  phone: () =>
    z
      .string()
      .trim()
      .transform((v, ctx) => {
        const n = normaliseNgPhone(v);
        if (!n) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid Nigerian phone number, e.g. 0803 123 4567" });
        return n ?? "";
      }),
  optPhone: () =>
    z.preprocess(
      blankToUndef,
      z
        .string()
        .transform((v, ctx) => {
          const n = normaliseNgPhone(v);
          if (!n) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid Nigerian phone number, e.g. 0803 123 4567" });
          return n ?? "";
        })
        .optional(),
    ),
  money: () =>
    z.preprocess(
      (v) => (v === "" || v == null ? 0 : v),
      z.union([z.string(), z.number()]).transform((v, ctx) => {
        const k = toKobo(v);
        if (k < 0 || !Number.isFinite(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid amount" });
        return k;
      }),
    ),
  optMoney: () => z.preprocess(blankToUndef, z.union([z.string(), z.number()]).transform((v) => toKobo(v)).optional()),
  date: () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
  optDate: () => z.preprocess(blankToUndef, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  optUuid: () => z.preprocess(blankToUndef, z.string().uuid().optional()),
  bool: () => z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
  int: (min = 0, max = 1_000_000) => z.coerce.number().int().min(min).max(max),
};
