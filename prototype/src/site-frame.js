// Renders wedding websites into iframes with the platform's real renderer and
// runtime. The site's RSVP requests are relayed to the in-browser backend.
import { renderSiteDocument } from '../../platform/shared/render.js';
import { getTemplate } from '../../platform/shared/templates.js';
import { SECTION_TYPES } from '../../platform/shared/sections.js';
import SITE_JS from 'raw:site';
import ART1 from 'raw:art-1'; import ART2 from 'raw:art-2'; import ART3 from 'raw:art-3';
import ART4 from 'raw:art-4'; import ART5 from 'raw:art-5'; import ART6 from 'raw:art-6';
import { siteRequest } from './backend.js';

const svg = (s) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`;
export const DEMO_ART = [ART1, ART2, ART3, ART4, ART5, ART6].map(svg);

// Inside the frame, fetch() is replaced by a message to this page.
const FETCH_SHIM = `window.fetch=function(u,o){return new Promise(function(res){var id=Math.random().toString(36).slice(2);function on(e){var d=e.data||{};if(d.__reply!==id)return;removeEventListener('message',on);res({ok:d.ok,status:d.status,json:function(){return Promise.resolve(d.body)}})}addEventListener('message',on);parent.postMessage({__fetch:id,url:String(u),body:o&&o.body?JSON.parse(o.body):{}},'*')})};
var __st;addEventListener('scroll',function(){clearTimeout(__st);__st=setTimeout(function(){parent.postMessage({__scroll:scrollY},'*')},80)});`;

window.addEventListener('message', (e) => {
  const d = e.data || {};
  if (!d.__fetch || !e.source) return;
  let reply;
  try { reply = siteRequest(d.url, d.body || {}); } catch (err) { reply = { ok: false, status: 400, body: { error: err.data?.error || err.message, fields: err.data?.fields } }; }
  e.source.postMessage({ __reply: d.__fetch, ...reply }, '*');
  if (reply.ok && /\/rsvp$/.test(d.url)) window.dispatchEvent(new CustomEvent('site-rsvp'));
});

export function siteHtml(state, { mode = 'published', scroll = 0, showBranding = true } = {}) {
  const html = renderSiteDocument({ ...state, options: { mode, apiBase: '', mediaBase: '', showBranding, platformName: 'Vowly', noindex: true } });
  return html
    .replace(/<link rel="icon"[^>]*>/, '')
    // A replacer function, so "$$" etc. in the script are not read as replacement patterns.
    .replace('<script src="/site.js" defer></script>', () => `<script>${FETCH_SHIM}</script><script>${SITE_JS.replace(/<\/script/gi, '<\\/script')}</script>${scroll ? `<script>addEventListener('load',function(){scrollTo(0,${Math.round(scroll)})});</script>` : ''}`);
}

// A live preview that re-renders as the draft changes and keeps its scroll position.
export class LivePreview {
  constructor(iframe, { onSelect } = {}) {
    this.iframe = iframe;
    this.scroll = 0;
    this.timer = null;
    window.addEventListener('message', (e) => {
      if (e.source !== iframe.contentWindow) return;
      const d = e.data || {};
      if (typeof d.__scroll === 'number') this.scroll = d.__scroll;
      if (d.type === 'select-section') onSelect?.(d.id);
    });
  }
  render(state, opts = {}) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.iframe.isConnected) return;
      this.iframe.srcdoc = siteHtml(state, { mode: opts.mode || 'editor', scroll: this.scroll, showBranding: opts.showBranding !== false });
    }, 220);
  }
  scrollToTop() { this.scroll = 0; }
}

export function demoState(templateId) {
  const tpl = getTemplate(templateId);
  const date = new Date(Date.now() + 160 * 864e5).toISOString().slice(0, 10);
  const media = DEMO_ART.map((src, i) => ({ id: `demo-${i}`, src, caption: ['Engagement day', 'Golden hour', 'Where it began', 'The proposal', 'Weekend away', 'Family dinner'][i], kind: i === 0 ? 'library' : 'gallery', is_cover: i === 0, position: i }));
  const sec = (type, content = {}) => ({ id: `demo-${type}`, type, status: 'visible', settings: {}, content: { ...SECTION_TYPES[type].defaults({ wedding_date_local: `${date}T15:00`, location: 'The Old Orangery, Lisbon' }), ...content } });
  const sections = [
    sec('hero', { eyebrow: 'Together with their families' }), sec('countdown'),
    sec('story', { milestones: [
      { title: 'A rainy Tuesday', date_label: 'Spring 2019', text: 'We reached for the last umbrella at the same café and decided to share it.', image: 'demo-2' },
      { title: 'Two cities, one playlist', date_label: '2021', text: 'Long-distance, late-night calls and a shared playlist that grew to 400 songs.', image: null },
      { title: 'The question', date_label: 'Summer 2025', text: 'On a cliff above the sea, with one very nervous knee on the ground.', image: 'demo-3' }
    ] }),
    sec('details', { events: [
      { id: 'ceremony', name: 'Ceremony', date, start_time: '15:00', end_time: '16:00', venue: 'The Old Orangery', address: 'Rua das Flores 12, Lisbon', map_url: '', description: 'Please arrive by 2:30 pm.', restricted: false },
      { id: 'reception', name: 'Dinner & dancing', date, start_time: '18:00', end_time: '23:30', venue: 'Garden Terrace', address: '', map_url: '', description: 'Dinner, speeches and dancing under the stars.', restricted: false }
    ] }),
    sec('gallery'), sec('faq'), sec('rsvp')
  ].map((s, i) => ({ ...s, position: i }));
  return {
    wedding: { partner1: 'Amara', partner2: 'Theo', wedding_date_local: `${date}T15:00`, timezone: 'Europe/Lisbon', wedding_at_utc: new Date(`${date}T14:00:00Z`).toISOString(), location: 'Lisbon, Portugal', tagline: 'Join us for a weekend of love, laughter and celebration.', locale: 'en-GB' },
    design: { template_id: tpl.id, palette: tpl.defaults.palette, font_pairing: tpl.defaults.font_pairing, animation: 'static' },
    sections, media,
    rsvp: { open: true, mode: 'open', plus_ones: 'everyone', collect_email: 'optional', dietary: true, accessibility: false, questions: [] }
  };
}
