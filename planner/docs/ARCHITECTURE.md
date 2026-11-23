# Owambe Ledger — architecture

A multi-tenant SaaS for Nigerian couples: wedding budget & vendor management (Module 1) and
a guest-facing Aso Ebi ordering & payment portal (Module 2), tied together by an
automation & notification centre (Module 3).

## 1. Stack

| Concern | Choice | Why |
|---|---|---|
| App | **Next.js 15 (App Router) + React 19 + TypeScript** | Server components for data-heavy pages, server actions for forms, route handlers for webhooks/exports — one deployable. |
| Styling | **Tailwind CSS v4** with design tokens in `globals.css` | Fonts self-hosted via `@fontsource` (Fraunces, Manrope, IBM Plex Mono). |
| Database | **PostgreSQL** via **Drizzle ORM** (`pg` driver) | Typed schema in `src/db/schema.ts`, SQL migrations in `drizzle/`. Works with Supabase, Neon, RDS or local Postgres. |
| Auth | Built-in email + password: bcrypt (cost 12) hashes, random 256-bit session tokens stored **hashed** (SHA-256), `httpOnly` `SameSite=Lax` cookies | No vendor lock-in; easy to swap for Supabase Auth later (only `src/lib/auth.ts` changes). |
| Files | Storage adapter: local disk (dev) or **Supabase Storage** (`STORAGE_DRIVER=supabase`) | Fabric photos are public; receipts/contracts are private and only served to members of that wedding. |
| Payments | **Paystack** behind a `PaymentProvider` interface | Flutterwave = one new adapter file implementing `initialize / verify / verifyWebhookSignature`. |
| Email | **Resend** REST API | Table-based, client-safe HTML template. |
| WhatsApp | **WhatsApp Business Cloud API** (approved templates) + `wa.me` share links (no credentials needed) | Flow replies are accepted only as structured, signed webhooks. |
| Exports | `exceljs` (.xlsx), `pdf-lib` + embedded DejaVu (₦ glyph) (.pdf), `docx` (.docx for Word/Google Docs), CSV + live `IMPORTDATA` feed for Google Sheets | |
| Scheduling | `GET /api/cron/reminders` (Bearer `CRON_SECRET`), daily via `vercel.json` | Idempotent — safe to run as often as you like. |

## 2. Tenancy & security model

* A **wedding** is the tenant (the couple's workspace). Users join through `memberships`
  (`owner`, `partner`, `planner`, `viewer`). Every tenant table has `wedding_id`.
* Every page and server action starts with `requireWorkspace()`, which resolves the wedding
  **only through the user's own membership**. Every query then filters on that `wedding_id`
  — including updates and deletes (`and(eq(t.id, id), eq(t.weddingId, weddingId))`).
  Viewers are blocked from writes (`requireWorkspace({ write: true })`).
* Guests never log in. Their order page is protected by a 192-bit `access_token`; personal
  invite links use a separate per-guest token. Campaign URLs use an unguessable slug.
* Input validation with **zod** on every action (Nigerian phone normalisation to E.164,
  36 states + FCT, kobo money parsing). Uploads restricted to JPG/PNG/WEBP/PDF ≤ 8 MB.
* Secrets are only read server-side (`src/lib/config.ts`); nothing is prefixed `NEXT_PUBLIC_`.
* Public endpoints (order placement, payment start) are rate-limited.
* **Audit log** (`audit_logs`) records every financial change: budget edits, expense
  create/update/delete, payments recorded/deleted, gateway verifications, mismatches,
  refunds, manual transfers, address changes and delivery updates — with actor
  (`user`/`guest`/`webhook`/`system`) and before/after values.

## 3. Payment integrity (Aso Ebi)

```
Guest ──Pay──▶ startPayment()  ─ creates payments row (status=initialized, unique reference)
                    │            ─ Paystack /transaction/initialize (amount in kobo, NGN)
                    ▼
             Paystack checkout ──redirect──▶ /asoebi/order/:code/return
                    │                              │  verify(reference) server→Paystack
                    │                              ▼
                    └──signed webhook──▶ /api/webhooks/paystack
                                          │ 1. HMAC-SHA512 signature over raw body
                                          │ 2. webhook_events unique dedupe key (replays ignored)
                                          │ 3. verify(reference) with Paystack API again
                                          ▼
                         applyVerifiedTransaction()  (single DB transaction)
                           SELECT … FOR UPDATE on the payment row
                           applied_at already set?  → no-op (idempotent)
                           status ≠ success?        → record pending/failed, order unchanged
                           amount/currency mismatch → reject + audit
                           else → payment success, order.amount_paid += amount,
                                  status recomputed, audit, then receipts & notifications
```

The success page **never** marks anything paid; it only triggers a server-side verification.
A cron job re-verifies anything still `pending`. Refunds (`refund.processed`) reverse the
amount. Couples can also record a direct bank transfer, which is stored as `provider=manual`
with the user's name in the audit trail.

## 4. Database schema

Money is integer **kobo** in `BIGINT`. Derived values (expense outstanding balance and
payment status) are **computed, not stored** (`src/lib/finance.ts`), so they can never drift.

```
users ─┬─< sessions
       └─< memberships >── weddings (tenant) ──┬─< invites
                                                ├─< events
                                                ├─< categories
                                                ├─< vendors ──────────────┐
                                                ├─< expenses >────────────┘ (vendor_id)
                                                │     ├─< instalments
                                                │     ├─< expense_payments ── files (evidence)
                                                │     └─< expense_attachments ── files
                                                ├─< tasks
                                                ├─< files
                                                ├─< asoebi_campaigns ─┬─< asoebi_campaign_images ── files
                                                │                     ├─< asoebi_packages
                                                │                     └─< asoebi_orders
                                                ├─< guests ──────────────────< asoebi_orders
                                                │                                ├─< asoebi_order_items
                                                │                                ├── delivery_addresses (1:1)
                                                │                                ├── deliveries (1:1)
                                                │                                └─< payments
                                                ├─< notifications        (in-app inbox)
                                                ├─< notification_logs    (every email/WhatsApp/in-app delivery, unique dedupe_key)
                                                └─< audit_logs
webhook_events (provider, unique dedupe_key, signature result, payload)
```

Brief → schema mapping: *Couples* = `weddings` + `memberships`; *Budgets* = `weddings.total_budget`
+ `categories.allocated` + `events.budget`; *Vendor payments* = `instalments` + `expense_payments`
on the vendor's contract expense; *Reminders* = rules on `weddings` / `tasks` executed by the
reminder engine and recorded in `notification_logs`.

## 5. Reminder engine (`src/lib/reminders.ts`)

Runs daily. For each wedding:

1. **Vendor/expense payments** — stages from `reminder_offsets` (default 7, 3, 0 days). Uses
   the tightest stage reached, so a missed run catches up without sending every stage.
   Overdue: once when it becomes overdue, then every `overdue_repeat_days`.
2. **Checklist tasks/activities** — each task's `remind_days_before`, plus overdue.
3. **Countdown** — 60/30/14/7/1 days to the wedding with open-task count.
4. **Aso Ebi guests** with balances, `guest_reminder_days` before the payment deadline.
5. **Reconcile** pending gateway payments.

Every message has a stable `dedupe_key` (e.g. `sched:<instalment>:<date>:d3|email|<to>`) with a
unique index — the same reminder can never be sent twice. Deliveries that fail or are skipped
(provider not configured) are visible in **Notifications → Automation history** and retryable.

## 6. User journeys

**Couple:** Sign up → onboarding (names, emails, phones, dates, venue, guests, ₦ budget, events)
→ 18 categories pre-allocated → add vendors with agreed price + instalment plan → record
payments with evidence → reminders by email/WhatsApp/in-app → checklist & calendar →
reports (PDF/XLSX/DOCX/Google Sheets).

**Aso Ebi:** Create campaign → packages & prices → fabric photos → publish → share link
(WhatsApp/email/SMS/social, or personal tracked links per guest) → watch the register fill
→ manage deliveries (group by state/city/area, assign riders, bulk dispatch) → export.

**Guest (mobile):** Open link → choose packages (stock-aware) → details & delivery/pickup →
review & confirm → unique order ID → pay with Paystack (full or deposit) → verified receipt
(email + PDF) → private order page to pay the balance, update address, track delivery.
