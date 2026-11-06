# Vowly test version

A single-page, clickable version of the platform that runs entirely in the browser, so people can try it without hosting. It reuses the platform's own code, which keeps what testers see identical to the real product:

* the template designs and site renderer (`platform/shared/`)
* the editor panels: design, sections, section settings and photos (`platform/public/js/editor-controls.js`)
* autosave and undo (`draft-store.js`)
* the guest-website runtime: countdown, gallery and RSVP form (`platform/public/site.js`)
* the app styles and the budget calculations

The only thing it swaps out is the server. `src/backend.js` keeps the account, wedding, guests, RSVPs and budget in the browser's local storage, with the same rules the server applies: plan limits, the publish checklist and RSVP matching. Published websites and the guest RSVP form render inside an iframe, and the form's requests are answered in the page.

Differences from the full platform:

* data stays in one browser
* no emails are sent
* Premium can be switched on for free
* spreadsheet downloads are replaced by "copy as CSV" because the viewer blocks downloads

## Build

```sh
cd prototype
npm install
node build.mjs      # writes dist/vowly-test.html (one self-contained page)
```

The output has no `<html>`/`<head>` wrapper: the Artifact host adds that when it is published. To open it locally, wrap it in a basic HTML document.
