// Reusable template definitions. A template is structure and styling only: default
// palette, fonts, layout variants per section and template CSS. Couples' content lives
// in their own records, so the same template renders any wedding and switching
// templates never touches what they wrote.

import { SECTION_ORDER } from './sections.js';

const ALL_SECTIONS = SECTION_ORDER;

export const TEMPLATES = [
  {
    id: 'ivory',
    name: 'Ivory',
    style: 'Minimalist & elegant',
    description: 'Quiet luxury: generous white space, fine serif type and hairline details that let your photos breathe.',
    tier: 'free',
    defaults: { palette: { primary: '#5b6b5a', secondary: '#d7dccf', accent: '#8a6d3b', background: '#fbfaf7', surface: '#f1efe8', text: '#1f2420' }, font_pairing: 'classic', animation: 'subtle' },
    layouts: { hero: 'centered', story: 'simple', countdown: 'minimal', details: 'cards', gallery: 'grid', rsvp: 'card', faq: 'list' },
    supportedSections: ALL_SECTIONS,
    decor: 'lines',
    css: `
.t-ivory .site-nav{border-bottom:1px solid var(--c-border)}
.t-ivory .hero{min-height:88vh}
.t-ivory .hero-names{font-weight:500;letter-spacing:.02em}
.t-ivory .hero .divider{width:1px;height:64px;background:var(--c-heading);opacity:.5;margin:28px auto}
.t-ivory .section-title{font-weight:500;letter-spacing:.04em}
.t-ivory .section-title::after{content:"";display:block;width:40px;height:1px;background:var(--c-heading);margin:18px auto 0;opacity:.6}
.t-ivory .card{background:transparent;border:1px solid var(--c-border);border-radius:2px}
.t-ivory .btn{border-radius:0;letter-spacing:.18em;text-transform:uppercase;font-size:.78rem;padding:14px 30px}
.t-ivory .hero-media img{border-radius:999px 999px 0 0;aspect-ratio:3/4}
`
  },
  {
    id: 'rosewater',
    name: 'Rosewater',
    style: 'Romantic & floral',
    description: 'Soft blush tones, flowing script and hand-drawn botanicals for a garden-romance feel.',
    tier: 'free',
    defaults: { palette: { primary: '#b5677d', secondary: '#e8c4cc', accent: '#5f7a61', background: '#fdf8f6', surface: '#f6e9e8', text: '#3a2a2e' }, font_pairing: 'romantic', animation: 'subtle' },
    layouts: { hero: 'split', story: 'alternating', countdown: 'boxes', details: 'cards', gallery: 'masonry', rsvp: 'split', faq: 'accordion' },
    supportedSections: ALL_SECTIONS,
    decor: 'floral',
    css: `
.t-rosewater .hero-names{font-family:var(--f-script);font-weight:400;font-size:clamp(3rem,9vw,6.2rem);line-height:1.05}
.t-rosewater .section-title{font-style:italic}
.t-rosewater .card{border-radius:18px;box-shadow:0 10px 30px -18px color-mix(in srgb,var(--c-primary) 45%,transparent)}
.t-rosewater .btn{border-radius:999px}
.t-rosewater .hero-media img{border-radius:200px 200px 24px 24px}
.t-rosewater .decor-floral{position:absolute;width:min(34vw,260px);opacity:.55;pointer-events:none;color:var(--c-secondary)}
.t-rosewater .decor-floral.tl{top:-10px;left:-20px}
.t-rosewater .decor-floral.br{bottom:-10px;right:-20px;transform:rotate(180deg)}
.t-rosewater .section:nth-of-type(even){background:var(--c-surface)}
`
  },
  {
    id: 'gazette',
    name: 'Gazette',
    style: 'Modern editorial',
    description: 'Magazine-inspired layouts with oversized type, numbered chapters and bold photo crops.',
    tier: 'free',
    defaults: { palette: { primary: '#1a1a1a', secondary: '#e4dcd2', accent: '#b85c38', background: '#f7f4ef', surface: '#ece6dd', text: '#151515' }, font_pairing: 'editorial', animation: 'subtle' },
    layouts: { hero: 'fullbleed', story: 'alternating', countdown: 'minimal', details: 'timeline', gallery: 'grid', rsvp: 'card', faq: 'list' },
    supportedSections: ALL_SECTIONS,
    decor: 'numbers',
    css: `
.t-gazette{counter-reset:chapter}
.t-gazette .hero-names{font-size:clamp(3.2rem,11vw,8.5rem);line-height:.92;letter-spacing:-.02em}
.t-gazette .section-head{text-align:left;max-width:var(--w-content);margin-left:auto;margin-right:auto}
.t-gazette .section-title{font-size:clamp(2.2rem,6vw,4rem);letter-spacing:-.01em}
.t-gazette .section:not(.s-hero) .section-title::before{counter-increment:chapter;content:counter(chapter,decimal-leading-zero);display:block;font-family:var(--f-body);font-size:.8rem;letter-spacing:.3em;color:var(--c-link);margin-bottom:10px}
.t-gazette .card{border-radius:0;border-top:3px solid var(--c-heading);background:transparent;padding-left:0;padding-right:0}
.t-gazette .btn{border-radius:0}
.t-gazette .section-intro{text-align:left}
.t-gazette .gallery-grid{grid-template-columns:repeat(auto-fill,minmax(220px,1fr))}
.t-gazette .gallery-grid figure:first-child{grid-column:span 2;grid-row:span 2}
`
  },
  {
    id: 'gilded',
    name: 'Gilded',
    style: 'Luxury & sophisticated',
    description: 'Midnight tones, gold accents and art-deco framing for a black-tie celebration.',
    tier: 'premium',
    defaults: { palette: { primary: '#c8a96a', secondary: '#3a3f4f', accent: '#e2c98f', background: '#12151d', surface: '#1b1f2a', text: '#efe8da' }, font_pairing: 'luxe', animation: 'expressive' },
    layouts: { hero: 'centered', story: 'timeline', countdown: 'boxes', details: 'cards', gallery: 'grid', rsvp: 'card', faq: 'accordion' },
    supportedSections: ALL_SECTIONS,
    decor: 'deco',
    css: `
.t-gilded .hero{background:radial-gradient(ellipse at top,color-mix(in srgb,var(--c-primary) 18%,var(--c-bg)),var(--c-bg) 70%)}
.t-gilded .hero-inner{border:1px solid color-mix(in srgb,var(--c-primary) 60%,transparent);outline:1px solid color-mix(in srgb,var(--c-primary) 35%,transparent);outline-offset:8px;padding:56px 28px}
.t-gilded .hero-names{letter-spacing:.08em;text-transform:uppercase;font-size:clamp(2.2rem,7vw,4.6rem)}
.t-gilded .section-title{letter-spacing:.14em;text-transform:uppercase;font-size:clamp(1.5rem,4vw,2.3rem)}
.t-gilded .section-title::after{content:"◆";display:block;font-size:.7rem;color:var(--c-heading);margin-top:14px}
.t-gilded .card{background:var(--c-surface);border:1px solid color-mix(in srgb,var(--c-primary) 40%,transparent);border-radius:2px}
.t-gilded .btn{border-radius:0;letter-spacing:.2em;text-transform:uppercase;font-size:.78rem}
.t-gilded .countdown-box{border:1px solid color-mix(in srgb,var(--c-primary) 50%,transparent)}
`
  },
  {
    id: 'confetti',
    name: 'Confetti',
    style: 'Playful & colourful',
    description: 'Bright colour, rounded shapes and a little bounce for couples who want a party.',
    tier: 'premium',
    defaults: { palette: { primary: '#e0573a', secondary: '#f7c548', accent: '#1d7874', background: '#fffaf0', surface: '#fdebd3', text: '#2b1d14' }, font_pairing: 'playful', animation: 'expressive' },
    layouts: { hero: 'split', story: 'timeline', countdown: 'boxes', details: 'cards', gallery: 'carousel', rsvp: 'card', faq: 'accordion' },
    supportedSections: ALL_SECTIONS,
    decor: 'confetti',
    css: `
.t-confetti .hero{background-image:radial-gradient(circle at 12% 20%,var(--c-secondary) 0 10px,transparent 11px),radial-gradient(circle at 85% 15%,var(--c-link) 0 7px,transparent 8px),radial-gradient(circle at 75% 80%,var(--c-primary) 0 12px,transparent 13px),radial-gradient(circle at 20% 85%,var(--c-link) 0 6px,transparent 7px)}
.t-confetti .hero-names{font-size:clamp(2.8rem,9vw,6rem);line-height:1}
.t-confetti .hero-names .amp{font-family:var(--f-script);color:var(--c-link)}
.t-confetti .card{border-radius:26px;border:3px solid var(--c-text);box-shadow:6px 6px 0 var(--c-secondary)}
.t-confetti .btn{border-radius:999px;border:3px solid var(--c-text);box-shadow:4px 4px 0 var(--c-text)}
.t-confetti .btn:active{transform:translate(2px,2px);box-shadow:2px 2px 0 var(--c-text)}
.t-confetti .hero-media img{border-radius:40% 60% 55% 45%/50% 45% 55% 50%;border:4px solid var(--c-text)}
.t-confetti .countdown-box{border-radius:20px;background:var(--c-secondary);color:var(--c-on-secondary)}
.t-confetti .section:nth-of-type(odd):not(.s-hero){background:var(--c-surface)}
`
  }
];

export function getTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
}
