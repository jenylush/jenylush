# Security

This file has two parts: how the platform protects itself in code, and the setup steps the person running it must take, because some protections can only be switched on outside the code. No website can be made attack-proof. The goal is to make attacks hard, limit the damage when something goes wrong, and notice it quickly.

## Built into the platform

| Threat | Protection |
|---|---|
| Password guessing | Per-IP rate limits, plus a per-account lockout after 8 wrong attempts in 15 minutes (works even when attackers use many IPs). Passwords are hashed with scrypt. Common and easily guessed passwords are rejected. |
| Stolen passwords | Optional two-step verification (authenticator app codes, RFC 6238) with single-use recovery codes. It is **required for administrators** in production. Used codes can't be replayed. |
| Finding out who has an account | Login gives the same message and takes the same time whether or not an email is registered. Password-reset requests always give the same answer. |
| Session hijacking | Random session tokens; only their SHA-256 hash is stored. Cookies are `HttpOnly`, `SameSite=Lax` and `Secure`, and use the `__Host-` prefix over HTTPS so couples' subdomains can't overwrite them. Changing your password or turning on 2FA signs out other devices, and users can sign out everywhere themselves. |
| Cross-site request forgery | State-changing API calls need a custom header, and requests whose `Origin` is another website are blocked. |
| Cross-site scripting (injected scripts) | All couple and guest text is HTML-escaped. A strict Content Security Policy blocks inline and third-party scripts. Links are limited to http(s). |
| Clickjacking | `X-Frame-Options` and `frame-ancestors` stop other sites from framing pages. |
| Reading another couple's data | Every wedding API route checks membership on the server, and non-members get a 404. Covered by automated tests. |
| Private photos leaking | Photos are stored outside the web root and served only to members, or to visitors of the published site that uses them. GPS and other metadata are stripped on upload. |
| Malicious uploads | Files are decoded with sharp (non-images are rejected), with size and pixel limits. SVG and other active formats are not accepted. |
| SQL injection | Every query uses bound parameters. |
| Spreadsheet formula injection | CSV exports neutralise cells that start with `= + - @`. |
| Spam through the platform | Guest emails need a verified account and a published site. Invitation emails are capped per website per day (setting in Admin → Settings). Guests can unsubscribe, and bounces and complaints stop further email. |
| Bots | Honeypot fields on sign-up and RSVP forms, plus rate limits on RSVP, invitation-code lookups and website-password attempts (per IP and per website). |
| Open redirects | After login, users are only ever sent to a path on this site. |
| Slow-connection denial of service | Header and request timeouts, request body size limits, and a global API rate limit. |
| Eavesdropping | HTTPS is enforced (HTTP redirects) and HSTS is sent in production. |
| Forged email webhooks | Resend webhooks are verified with their Svix signature and a timestamp window. |
| Vulnerable dependencies | Only 5 runtime dependencies (a patched `uuid` is forced for exceljs). Dependabot opens update PRs, and CI runs the tests plus `npm audit` on every change and weekly. |
| Not noticing an attack | The security log records sign-ins, failures, lockouts, password and 2FA changes, and every admin action. Admins see it under **Admin → Security**, and each user sees their own under **Settings → Account**. Entries are kept for 180 days. |

Vulnerability reports go to the address in `/.well-known/security.txt` (set by `SUPPORT_EMAIL`).

## Your launch checklist (outside the code)

Most real-world breaches come from these steps, not from the code.

1. **Turn on 2FA everywhere** that controls the product: GitHub, your hosting service (Render, Railway or Fly), your domain registrar and DNS, Resend, Stripe (later), and your email inbox. Whoever controls these controls the platform.
2. **Put Cloudflare (free plan) in front of the site.** It absorbs DDoS attacks and blocks common attack traffic. Turn on "Always use HTTPS", and once bot protection is configured, rate-limiting rules for `/api/auth/*`.
3. **Keep secrets secret.** Set `APP_SECRET`, `RESEND_API_KEY` and others only in your host's environment settings, never in GitHub. Don't share the `.env` file. Rotate a key immediately if it might have leaked.
4. **Run in production mode:** `NODE_ENV=production` behind HTTPS. This turns on HTTPS redirects, HSTS, secure cookies and required admin 2FA.
5. **Back up `DATA_DIR` daily** (database and photos) to a separate account or provider, and **test a restore** before launch. Backups are the cure for ransomware, mistakes and failed disks.
6. **Apply updates.** Merge Dependabot pull requests when CI is green, and keep Node.js on a supported version.
7. **Watch the signals weekly:** Admin → Security (failed logins, lockouts), Admin → Email health, and Admin → Reports. Set up your host's uptime and error alerts.
8. **Get a professional review before a big public launch.** Ask a security specialist or a developer you trust for a penetration test or code review. Automated tests can't replace a human attacker's view.
9. **Give admin rights to as few people as possible.**

## If something goes wrong

1. **Take the affected site offline** (Admin → Websites → Take down), or **pause sign-ups** (Admin → Settings).
2. **Rotate secrets:** change `APP_SECRET` (this signs everyone out of password-protected sites), the email API keys, and your own passwords.
3. **Investigate:** review Admin → Security and your host's logs to see what happened and which accounts were affected.
4. **Restore** from backup if data was altered.
5. **Notify** affected couples. Depending on where you and they are, you may be legally required to inform the data-protection authority, for example within 72 hours under Nigeria's NDPA or the EU GDPR. Get legal advice.
