# Owambe Ledger

Wedding planning, budgeting and **Aso Ebi** ordering & payments for Nigerian couples.
Each couple gets a private workspace with:

- **Budget & expenses**: a ₦ budget across events (introduction, traditional, white wedding, reception, after-party) and 18 editable categories. Outstanding balances and payment statuses recalculate from every payment you record.
- **Vendors**: contracts, contacts and instalment plans (e.g. ₦500k as 200k / 150k / 150k), each instalment with its own due date and status.
- **Payment schedule & reminders**: 7 days / 3 days / on the day / overdue, by email, WhatsApp and in-app, with full delivery history and retries.
- **Checklist & calendar**: tasks for either partner, priorities, recurring items and a countdown.
- **Aso Ebi**: campaigns, packages, fabric photos and one shareable link. Guests order and pay on their phones with Paystack, and the guest register updates itself.
- **Deliveries**: group orders by state, city and area, assign riders, and bulk-mark them dispatched or delivered.
- **Reports**: Excel, PDF, Word/Google Docs (.docx), CSV, and a **live Google Sheets link** (`=IMPORTDATA(...)`).

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the architecture, database schema, payment-integrity flow and user journeys.

## Run it locally

Requirements: Node 20+ and PostgreSQL 14+.

```bash
cd planner
npm install
cp .env.example .env        # then set DATABASE_URL and SESSION_SECRET
createdb owambe             # or point DATABASE_URL at Supabase/Neon
npm run db:migrate
npm run db:seed             # demo couple, vendors, guests & orders
npm run dev
```

Open http://localhost:3000 and sign in with **demo@owambe.ng / demo-wedding**.
The demo guest page is at http://localhost:3000/asoebi/adaeze-tunde-gold.

Demo Aso Ebi payments are labelled `DEMO-…` with provider `demo`. They are seed data, not real transactions.

## Connecting live services

Everything works without third-party keys. Where a key is missing, the app says so instead of pretending: the Pay button explains that payments are off, and emails are logged as **skipped** so you can retry them later. **Settings → Integrations** shows what is connected.

| Service | Variables | Steps |
|---|---|---|
| **Paystack** | `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY` | Paystack Dashboard → Settings → API Keys & Webhooks. Set **Webhook URL** to `https://YOUR_DOMAIN/api/webhooks/paystack`. Use `sk_test_…` first; test cards are in Paystack's docs. |
| **Resend (email)** | `RESEND_API_KEY`, `EMAIL_FROM` | Verify your domain in Resend, then set `EMAIL_FROM="Owambe Ledger <hello@yourdomain.ng>"`. |
| **WhatsApp Business** | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TEMPLATE_REMINDER`, `WHATSAPP_TEMPLATE_CONFIRMATION`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | In Meta Business Manager, create and get approval for two templates. `payment_reminder` has body params {{1}} item, {{2}} amount, {{3}} due date. `order_confirmation` has {{1}} name, {{2}} order ID, {{3}} amount/status, {{4}} couple. Set the webhook to `https://YOUR_DOMAIN/api/webhooks/whatsapp`. Then turn on WhatsApp under Settings → Notifications. |
| **WhatsApp Flows** (optional) | same as above | Send guests a Flow whose `flow_token` is `<ORDER_CODE>.<order access token>`, returning `street, area, city, state, landmark, instructions`. Signed replies update that order's address. Free-text chat is never parsed. |
| **Supabase Storage** | `STORAGE_DRIVER=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET` | Create a **private** bucket. The app proxies files and checks access itself. |
| **Cron** | `CRON_SECRET` | On Vercel, `vercel.json` already runs `/api/cron/reminders` daily at 07:00 UTC (08:00 Lagos). Anywhere else, call it with `Authorization: Bearer $CRON_SECRET`. |

## Deploy (Vercel + Supabase/Neon)

1. Create a Postgres database and copy its connection string into `DATABASE_URL`.
2. Import the repository into Vercel and set **Root Directory** to `planner`.
3. Add the environment variables above, including `APP_URL=https://your-domain`.
4. Run `npm run db:migrate` once against the production database. Don't run `db:seed` in production.

## Tests

```bash
npm test          # unit tests: budget maths, instalment waterfall, reminder stages, phone/₦ formats
npm run test:e2e  # the 8 journeys from the brief, plus a tenancy check, against a real server
```

The end-to-end suite starts its own server on port 3100. It uses a local mock of the Paystack and Resend APIs, so it exercises the real initialize → checkout → verify flow, signed webhooks (forged, replayed and valid), pending-then-settled payments, receipts, Excel exports, address updates, overdue reminders with no duplicates, and cross-couple isolation. It needs Playwright and Chromium (`npm i -D playwright && npx playwright install chromium`).

## Project layout

```
src/
  app/
    (auth)/            login, signup
    onboarding/        wedding setup
    app/               the couple's dashboard (13 sections)
    asoebi/            public guest pages: campaign, order, payment return
    actions/           server actions (all tenant-scoped and zod-validated)
    api/               webhooks, cron, exports, files, receipts, Google Sheets feed
  components/          UI kit, charts, forms
  db/                  Drizzle schema and client
  lib/                 finance maths, Aso Ebi domain logic, reminders, notifications,
                       exports, integrations (paystack, email, whatsapp), storage, auth
drizzle/               SQL migrations
scripts/               migrate, seed, reset
tests/                 unit + e2e
```
