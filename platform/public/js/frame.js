// Runs inside the editor preview iframe: renders the draft it receives from the parent.
import { renderSiteParts } from '/shared/render.js';

const style = document.getElementById('site-css');
const fonts = document.getElementById('site-fonts');
let lastFonts = '';
let selected = null;

function highlight() {
  document.querySelectorAll('.section.is-selected').forEach((el) => el.classList.remove('is-selected'));
  if (selected) document.querySelector(`.section[data-section-id="${CSS.escape(selected)}"]`)?.classList.add('is-selected');
}

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.source !== window.parent) return;
  const msg = e.data || {};
  if (msg.type === 'render') {
    const scroll = window.scrollY;
    const parts = renderSiteParts({ ...msg.state, options: { mode: 'editor', mediaBase: '/media', showBranding: msg.showBranding !== false, platformName: msg.platformName || '' } });
    style.textContent = parts.css;
    if (parts.fontsHref !== lastFonts) { fonts.href = parts.fontsHref; lastFonts = parts.fontsHref; }
    document.body.className = parts.bodyClass;
    document.body.innerHTML = parts.html;
    selected = msg.selected ?? selected;
    highlight();
    window.__siteInit?.();
    window.scrollTo(0, scroll);
  }
  if (msg.type === 'select') { selected = msg.id; highlight(); }
  if (msg.type === 'scroll-to') {
    selected = msg.id; highlight();
    const el = document.querySelector(`.section[data-section-id="${CSS.escape(msg.id)}"]`);
    el?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }
});

window.parent.postMessage({ type: 'frame-ready' }, location.origin);
