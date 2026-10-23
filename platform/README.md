# Vowly: wedding website builder

A self-service platform where couples create, customise, publish and manage their own wedding website. They pick a template, set their colours and fonts, add photos and sections, publish to their own address, and collect RSVPs. There's also guest list management and email automation. Couples don't need design or coding skills.

It launches as a **freemium** product. Everything a couple needs to publish a site and collect RSVPs is free. Premium features are configured and enforced, but checkout is switched off until a payment provider is connected, so the app never pretends a payment happened. Couples can join a Premium waitlist, and admins can grant plans by hand for support or testing.

> The `wedding-site/` folder at the repository root is the original hand-built site for Ezinne & Ebenezer. This platform lives entirely in `platform/` and does not change that site.

## Quick start

```sh
cd platform
npm install
npm start                 # http://localhost:3000
npm test                  # integration tests (real HTTP + real SQLite)
```

You need Node.js 22.13 or later, which includes the built-in `node:sqlite`. No database server is needed.

* Sign up with an email listed in `ADMIN_EMAILS` to get the admin area. You can also run `npm run make-admin -- you@example.com` after signing up.
* With no email provider configured, verification and reset links appear in the UI in development, and every guest email is recorded with status `not_configured`. Nothing is shown as "sent" unless a provider accepted it.
* Configuration lives in `.env` (see `.env.example`).

## What a couple can do (MVP definition of done)

| # | Requirement | Where |
|---|---|---|
| 1 | Create an account | `/signup`: hashed passwords (scrypt), email verification, password reset, 30-day sessions |
| 2 | Start a wedding website | `/app/wizard`: 6-step setup with autosave |
| 3 | Choose a template | 5 templates: Ivory (minimal), Rosewater (romantic), Gazette (editorial), Gilded (luxury, Premium), Confetti (playful, Premium) |
| 4 | Add details and photos | Wizard and editor; photos are validated, auto-rotated, stripped of GPS/EXIF, and resized to responsive WebP |
| 5 | Customise colours, type and sections | Preset palettes, palette generated from one colour, per-token overrides (Premium), 7 font pairings, static / subtle / expressive animation |
| 6 | Hide and restore sections | Sections are hidden or "removed" but never deleted, and can be restored with their content |
| 7 | Preview on desktop and mobile | Live preview in the editor and wizard, plus a full preview page |
| 8 | Save a draft and come back | Autosave with visible status, undo/redo, unsaved-changes guard, conflict detection between collaborators |
| 9 | Publish a unique URL | Unique slug with an availability check, `/w/<slug>` and `<slug>.<SITE_BASE_DOMAIN>` |
| 10 | Share with guests | Copy link, WhatsApp, email, native share, personal invitation links and codes |
| 11 | Collect RSVPs | Attendance, events, plus-ones, dietary and accessibility needs, custom questions, deadline, invite-only mode, update-in-place with history |
| 12 | View and export the guest list | `/app/guests`: filters, CSV import and export, per-guest history |
| 13 | RSVP confirmation email | Sent through Resend or SMTP once configured (see Email) |
| 14 | Upgrade through a working payment flow, if payments are enabled | Payments are off for the freemium launch. The checkout endpoint refuses honestly, and the waitlist records demand (see Payments) |

The rest of the build prompt is covered as well:

* **Landing page:** hero, CTAs, template gallery, how it works, feature highlights, plan comparison, FAQ, legal and footer.
* **Dashboard:** countdown, status, URL, visits, RSVP totals, quick actions, checklist, plan and storage usage, referral link.
* **Collaborators:** co-owners with edit, guest-list and publish permissions.
* **Email workflows:** RSVP confirmation, invitation, RSVP reminders, biweekly updates, final reminders and update notifications. They run on server-side scheduling.
* **Admin area:** metrics, users, plan grants, website takedowns, content reports, template tiers, plan entitlements, platform settings and email health.

## Architecture

```
platform/
  shared/            Runs on BOTH server and browser
    render.js        Wedding-site renderer (published pages, previews, editor frame)
    templates.js     Template definitions: structure, layouts, CSS, default theme
    sections.js      Section registry: field schemas, layouts, defaults, sanitising
    color.js         Palette generation and WCAG contrast enforcement
    fonts.js         Supported font pairings
  src/
    server.js        Express app: security headers, host routing, API, pages
    db.js            SQLite schema (node:sqlite)
    services.js      Drafts, validation, publishing snapshots, slugs, URLs
    entitlements.js  Plan limits (seed values; the live values are in the DB)
    notifications.js Email workflows + scheduler (times calculated in the wedding timezone)
    mailer.js        Delivery queue: dedupe, retries with backoff, crash recovery
    email/           Provider adapters (Resend, SMTP) and email templates
    media.js         Image processing (sharp) and private storage
    analytics.js     Product events and metrics
    routes/          auth, weddings, media, guests, emails, site (public), account, admin, webhooks
  public/            Front end: plain HTML, CSS and ES modules, no build step
  test/              Integration tests
```

**Why code rather than a no-code builder?** The prompt asks to "use no-code wherever practical", and to check that the platform supports dynamic templates, per-couple content, unique public URLs, secure data access and scheduled workflows. No-code tools could not be set up or verified from this environment. A small Node service meets every one of those requirements and can be tested end to end. It has 4 runtime dependencies: express, multer, sharp and nodemailer.

**Templates stay separate from content.** A template is code-defined structure and styling. Each couple's content lives in their own rows: `weddings`, `website_designs` and `website_sections`. When a couple publishes, the app writes an immutable snapshot to `published_versions`. The public site renders only that snapshot, so draft edits never leak and no shared template can change a couple's live site. Switching templates changes only `website_designs.template_id`.

**What the editor shows is what guests get.** The editor preview runs the same `shared/render.js` that the server uses for live sites.

## Data model

Tables: `users`, `sessions`, `auth_tokens`, `weddings`, `wedding_members`, `member_invites`, `website_templates`, `website_designs`, `website_sections`, `published_versions`, `media_assets`, `guests`, `invitations`, `form_definitions`, `rsvp_submissions`, `form_submissions`, `consent_records`, `email_automation_rules`, `scheduled_messages`, `email_delivery_logs`, `subscription_plans`, `user_subscriptions`, `payment_transactions`, `upgrade_interest`, `gift_registries`, `gift_contributions`, `platform_settings`, `product_events`, `content_reports`.

* Every wedding-specific table has a `wedding_id` foreign key, and deletes cascade.
* Wedding times are stored as a wall-clock time plus an IANA timezone (`wedding_date_local`, `timezone`) and as a derived UTC instant (`wedding_at_utc`). The conversion is DST-safe and tested.
* Invitation status (`guests.invitation_status`) is separate from RSVP status. RSVP status is derived only from an actual response, so a guest who hasn't replied is "pending", never assumed.
* Updated RSVPs mark the previous row `is_latest = 0` and keep it as history.

## Security and privacy

* **Authorisation:** every `/api/weddings/:id/*` route checks membership on the server. Non-members get a 404, and fine-grained permissions apply to editing, guests and publishing. Tests check that another couple gets 404 on every route.
* **CSRF:** state-changing API calls need a custom header, and cookies are `SameSite=Lax` and `HttpOnly`. Only a hash of each session token is stored.
* **Content Security Policy:** no inline scripts anywhere. All text is HTML-escaped when rendered, and URLs are limited to http(s).
* **Photos** are stored outside the web root and served through `/media/:id/:size`. Before publishing, only members can load them. After publishing, a visitor can load only the photos the published site actually uses, and only if they're allowed to see the site (public, or unlocked by password).
* **Site visibility:** public, password-protected (Premium) or private. Sites send `noindex` unless the couple turns on search indexing.
* **Rate limits** on login, sign-up, RSVP, invitation-code lookups and password unlock. RSVP forms have a honeypot.
* **CSV exports** guard against spreadsheet formula injection.
* **Account data:** users can export it as JSON and delete their account, which removes owned websites, photos and guest data.
* The admin area deliberately doesn't show couples' guest lists or RSVP answers.

## Email

Set `EMAIL_PROVIDER=resend` with `RESEND_API_KEY` and `EMAIL_FROM` (a domain verified in Resend), or `EMAIL_PROVIDER=smtp` with `SMTP_URL`.

* **Dedupe:** each email is a row in `email_delivery_logs` with a unique dedupe key, so double clicks, overlapping worker ticks and restarts can't send duplicates. Resend also receives an `Idempotency-Key`.
* **Retries:** transient failures (network, 429, 5xx, 4xx SMTP replies) retry with backoff for up to 5 attempts. Permanent failures are marked `failed` and shown in admin → Email health with a retry button.
* **Scheduling:** `scheduled_messages` holds future reminders. Send times are calculated in the wedding's timezone. Changing the wedding date, RSVP deadline or rules cancels obsolete messages and creates new ones. Pausing cancels all pending messages, and resuming recreates future ones.
* **Recipients:** chosen when a message is sent. For example, RSVP reminders skip anyone who has already responded, and updates go only to guests who opted in.
* **Delivery status:** set `RESEND_WEBHOOK_SECRET` and point a Resend webhook at `/webhooks/resend` to record delivered, bounced and complained. Bounces and complaints suppress further email to that guest.
* **Consent:** RSVP confirmations, invitations and reminders count as essential. Biweekly and update emails need the guest's opt-in, which is recorded in `consent_records`. Every guest email links to a preferences page (`/u/<token>`) and sends a `List-Unsubscribe` header.
* Visiting a website never triggers an email.
* The worker runs inside the app process on a timer and keeps all its state in the database, so it doesn't depend on a browser being open. For several app servers, run the worker in one process only (`SCHEDULER_ENABLED=false` on the others).

## Plans and entitlements (freemium)

Plans and their limits live in `subscription_plans.entitlements`. Admins edit them under **Admin → Plans**. `src/entitlements.js` only seeds the initial values. Limits stop *new* premium choices and never delete or hide saved work: after a downgrade, a premium template the couple already uses keeps working. A 402 `plan_limit` response tells the UI which feature was blocked, so it can explain the limit and link to the plans page.

| | Free | Premium (coming soon) |
|---|---|---|
| Templates | Ivory, Rosewater, Gazette | All 5 |
| Colours | Presets or one primary colour (palette generated) | Every colour token |
| Fonts / animation | 4 pairings, static and subtle | All 7, plus expressive |
| Photos | 40 photos, 100 MB, 10 MB each | 500 photos, 2 GB, 25 MB each |
| RSVP | Full form, 2 custom questions | 20 custom questions, full history export |
| Emails | RSVP confirmation, invitations | Plus reminders, biweekly updates, final reminders, update notifications |
| Privacy | Public, private, no-index | Plus password protection, custom domain |
| Other | 1 collaborator, platform footer | 3 collaborators, no branding |

Premium Plus is seeded as hidden and reserved for future tests.

### Payments (not connected yet)

`PAYMENTS_ENABLED=false` by default. In that state, paid plans show as "coming soon" with a waitlist (`upgrade_interest`), and `POST /api/account/checkout` returns 501. To start selling:

1. Create products and prices in Stripe that match the `subscription_plans` rows.
2. In `routes/account.js → /checkout`, create a Stripe Checkout Session and redirect to it.
3. Add a webhook route for `checkout.session.completed`. Verify the signature, insert a `payment_transactions` row, and create a `user_subscriptions` row with `source = 'payment'`.
4. Set `PAYMENTS_ENABLED=true`.

## Domains and HTTPS

* **Subdomains:** set `SITE_BASE_DOMAIN=yourplatform.com`, then add a wildcard DNS record `*.yourplatform.com` and a wildcard TLS certificate at your proxy (for example Caddy, Cloudflare, or Fly/Render custom domains). The app routes by the `Host` header and reserves slugs like `www`, `app` and `admin`.
* **Custom domains (Premium):** couples enter their domain and are told which CNAME to create. Issuing the certificate depends on the host (for example Caddy on-demand TLS, Cloudflare for SaaS, or Fly certs). Once that's done, an admin marks the domain verified in **Admin → Websites**. Automating the certificate step is post-MVP.
* In production, run behind HTTPS with `NODE_ENV=production`. That enables HSTS, secure cookies and `trust proxy`.

## Deployment

The existing Netlify setup only serves static files, so it can't run this app. Use a host with a persistent disk:

* **Docker:** `docker build -t vowly . && docker run -p 3000:3000 -v vowly-data:/data --env-file .env vowly`
* **Render, Railway or Fly.io:** deploy the `platform/` folder, mount a persistent volume at `/data`, and set the environment variables.

**Backups:** `DATA_DIR` holds `app.db` (SQLite in WAL mode) and `media/`. Back up both, for example with nightly `sqlite3 app.db ".backup 'backup.db'"` plus a sync of `media/` to object storage. Test a restore by starting the app with `DATA_DIR` pointed at the restored copy. To serve photos from S3 or R2 later, change only `src/media.js`.

**Monitoring:** errors go to stderr, so collect them with your host's logs or add Sentry in `server.js`. Failed and overdue emails appear in **Admin → Email health**.

## Analytics

`product_events` records `account_created`, `website_creation_started`, `template_selected`, `colour_settings_changed`, `gallery_image_uploaded`, `section_added`, `section_removed`, `preview_opened`, `website_published`, `website_shared`, `guest_rsvp_submitted`, `email_automation_enabled`, `paid_upgrade_viewed`, `subscription_purchased` and `upgrade_interest_registered`. Events carry IDs and small enumerated properties only, never names, emails or free text. **Admin → Metrics** calculates these from real data:

* activation
* median time to publish
* guest engagement
* RSVP conversion
* paid conversion
* referral rate (via `?ref=` links)

## Not built yet (Phase 6 and later)

* Guestbook, wedding games and digital programme. They appear as "coming soon" in the section picker.
* Gift registry payments and contributions. The tables exist; the registry section currently links out to external registries.
* Stripe checkout (see above), automated custom-domain certificates, and wedding planner accounts.
* Demo template previews use abstract illustrations (`public/demo/`). Replace them with licensed wedding photography before launch.
* The legal pages are drafts and must be reviewed by a lawyer.
