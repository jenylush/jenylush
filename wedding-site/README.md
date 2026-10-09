# Ezinne & Ebenezer — wedding website

A static site (plain HTML, CSS and JavaScript, no build step):

- `index.html` — the page (a desktop layout and a phone layout)
- `app.js` — the envelope, countdown, story toggles and the game
- `assets/` — the photos
- `_headers` — security headers Netlify sends with every page

## Run it on your computer (localhost)

Open a terminal in the repository folder and run **one** of these:

```sh
# Python (already installed on most Macs and Linux machines)
python3 -m http.server 8000 --directory wedding-site

# or Node.js
npx serve wedding-site
```

Then open http://localhost:8000 (Python) or the address `serve` prints (Node). Stop it with `Ctrl + C`.

Double-clicking `index.html` also works for a quick look, but a local server matches how Netlify serves the site.

## Deploy to Netlify

**Option A — drag and drop:** go to https://app.netlify.com/drop and drop this `wedding-site` folder onto the page.

**Option B — from GitHub:** in Netlify choose *Add new site → Import an existing project*, pick this repository and branch. `netlify.toml` at the repo root tells Netlify to publish the `wedding-site` folder; leave the build command empty.

## Security

- **Security headers** (in `_headers`, which Netlify applies with either deploy option): a Content Security Policy that only allows this site's own script, the Google Fonts stylesheet/fonts and the site's own images. It blocks injected scripts, plugins, form posts and network calls. The headers also stop other sites from framing the page (clickjacking), turn off camera/microphone/location access, and force HTTPS.
- **No inline JavaScript:** all code lives in `app.js`, so the policy can refuse any inline or injected `<script>`.
- **No data collection:** the site has no forms, cookies, analytics or back end. The game runs entirely in the guest's browser and sends nothing anywhere.
- **Safe rendering:** game text is HTML-escaped before it's placed on the page, and click handlers only run named actions defined in `app.js`.
- **Photos:** checked for hidden metadata (EXIF/GPS location) — none is present.

Keep in mind that everything on the site, including family names, venues and the bank details, is public to anyone with the link.

## Editing

The page contains a desktop layout (`.v-desktop`) and a phone layout (`.v-mobile`) in `index.html`; change text in both. Remaining placeholders are in square brackets (search for `[`): the aso-ebi details and contact, and the contact for group airport pickups. The account numbers used by the copy buttons are set in `app.js` (`copyAccess`, `copyOpay`).
