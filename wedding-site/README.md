# Ezinne & Ebenezer — wedding website

A static site (plain HTML, CSS and JavaScript, no build step). `index.html` holds the whole page; `assets/` holds the photos.

## Deploy to Netlify

**Option A — drag and drop:** go to https://app.netlify.com/drop and drop this `wedding-site` folder onto the page.

**Option B — from GitHub:** in Netlify choose *Add new site → Import an existing project*, pick this repository and branch. `netlify.toml` at the repo root already tells Netlify to publish the `wedding-site` folder; leave the build command empty.

## Editing

Text such as `[Bank name]`, `[Account name]` and Ebenezer's side of the story are placeholders — search `index.html` for `[` to find them. The page contains a desktop layout (`.v-desktop`) and a phone layout (`.v-mobile`); edit the text in both.
