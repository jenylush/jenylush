# Ezinne & Ebenezer — wedding website

A static site (plain HTML, CSS and JavaScript, no build step):

- `index.html` — the page (one responsive layout for desktop and phone)
- `styles.css` — design tokens, typography, layout and all animations
- `app.js` — the envelope sequence, scroll reveals, parallax, countdown, menu, story, lightbox, copy buttons and the game
- `assets/` — the photos
- `_headers` — security headers Netlify sends with every page

## Look & motion

**Typography** follows the "My lovely / With love" card: *Belleza* (flared, Optima-like sans) for reading text and labels, *EB Garamond semibold italic* in sage green for names and headings, and *Pinyon Script* for the gold JE monogram. A large faint JE watermark sits behind sections, like the card's background.

**Motion:**
- Envelope intro: floating envelope, breathing wax seal with gold ripples, then seal lifts → flap opens in 3D with a burst of gold/sage/burgundy flecks → letter rises → the page fades in.
- Hero: slow Ken Burns zoom and parallax on the portrait, names rise in line by line, rolling countdown digits, scroll cue.
- Sections: headings slide up from a mask, photos wipe in, line drawings (coal, Olumo Rock, flourishes) draw themselves, date numbers count up, the travel route draws stop by stop.
- Interactions: sticky header that hides on scroll down, gold progress bar, phone menu that opens in a circle, smooth story accordions, gallery lightbox (arrows, swipe, Esc), copy buttons with a tick, confetti in the game.
- Guests who set "reduce motion" on their device get the same content with the animations switched off.

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
- **Safe rendering:** game text is inserted as plain text (never as HTML).
- **Photos:** checked for hidden metadata (EXIF/GPS location) — none is present.

Keep in mind that everything on the site, including family names, venues and (once filled in) bank details, is public to anyone with the link.

## Editing

Text such as `[Bank name]`, `[Account name]` and Ebenezer's side of the story are placeholders — search `index.html` for `[` to find them. There is one layout, so each piece of text only needs editing once.
