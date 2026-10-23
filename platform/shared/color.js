// Colour utilities shared by the editor (browser) and the site renderer (server).
// A wedding's palette is six design tokens. Couples pick a primary colour and the
// rest are suggested from it; every token can be overridden, but text colours are
// always checked against WCAG contrast so a site can never become unreadable.

export const TOKEN_KEYS = ['primary', 'secondary', 'accent', 'background', 'surface', 'text'];

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHex(value) {
  return typeof value === 'string' && HEX_RE.test(value.trim());
}

export function normalizeHex(value) {
  if (!isHex(value)) return null;
  let h = value.trim().replace('#', '').toLowerCase();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return '#' + h;
}

export function hexToRgb(hex) {
  const h = normalizeHex(hex).slice(1);
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

export function rgbToHex({ r, g, b }) {
  const c = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}

export function hexToHsl(hex) {
  let { r, g, b } = hexToRgb(hex);
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }) {
  h = ((h % 360) + 360) % 360; s = clamp(s, 0, 100) / 100; l = clamp(l, 0, 100) / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex({ r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 });
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

export function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function contrastRatio(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// Darken or lighten `fg` (keeping its hue) until it reaches `target` contrast on `bg`.
export function ensureContrast(fg, bg, target = 4.5) {
  if (contrastRatio(fg, bg) >= target) return fg;
  const hsl = hexToHsl(fg);
  const darker = luminance(bg) > 0.4;
  for (let i = 0; i < 100; i++) {
    hsl.l += darker ? -1 : 1;
    const candidate = hslToHex(hsl);
    if (contrastRatio(candidate, bg) >= target) return candidate;
    if (hsl.l <= 0 || hsl.l >= 100) break;
  }
  return darker ? '#111111' : '#ffffff';
}

// Suggest a full palette from a single primary colour.
export function suggestPalette(primaryHex) {
  const primary = normalizeHex(primaryHex) || '#9b6b5a';
  const { h, s } = hexToHsl(primary);
  const background = hslToHex({ h, s: Math.min(s, 35), l: 97 });
  const surface = hslToHex({ h: h + 10, s: Math.min(s, 30), l: 93 });
  const secondary = hslToHex({ h: h + 30, s: Math.max(s * 0.55, 18), l: 72 });
  const accent = hslToHex({ h: h + 180 - 30, s: Math.max(s * 0.6, 25), l: 42 });
  const text = hslToHex({ h, s: Math.min(s, 25), l: 16 });
  return { primary, secondary, accent, background, surface, text };
}

// Fill gaps, normalise hex values, and compute the colours the site will actually use.
// Returns { palette, effective, warnings } — `effective` is what the renderer applies.
export function resolvePalette(input = {}, fallback = suggestPalette('#9b6b5a')) {
  const palette = {};
  for (const key of TOKEN_KEYS) palette[key] = normalizeHex(input[key]) || fallback[key];
  const warnings = [];
  const effective = { ...palette };

  const textOnBg = ensureContrast(palette.text, palette.background, 4.5);
  if (textOnBg !== palette.text) {
    warnings.push({ token: 'text', message: 'Your text colour was too light to read on the background, so a darker shade is used.' });
    effective.text = textOnBg;
  }
  const textOnSurface = ensureContrast(effective.text, palette.surface, 4.5);
  effective.textOnSurface = textOnSurface;
  if (textOnSurface !== effective.text) {
    warnings.push({ token: 'surface', message: 'Text on panels uses an adjusted shade so it stays readable.' });
  }
  // Headings and links in the primary colour on the background need 3:1 (large text).
  effective.heading = ensureContrast(palette.primary, palette.background, 3);
  if (effective.heading !== palette.primary) {
    warnings.push({ token: 'primary', message: 'Headings use a deeper shade of your primary colour for readability.' });
  }
  effective.link = ensureContrast(palette.accent, palette.background, 4.5);
  // Text placed on a primary-coloured button.
  effective.onPrimary = contrastRatio('#ffffff', palette.primary) >= contrastRatio('#111111', palette.primary) ? '#ffffff' : '#111111';
  if (contrastRatio(effective.onPrimary, palette.primary) < 4.5) {
    effective.button = ensureContrast(palette.primary, effective.onPrimary, 4.5);
  } else {
    effective.button = palette.primary;
  }
  effective.onSecondary = contrastRatio('#ffffff', palette.secondary) >= contrastRatio('#111111', palette.secondary) ? '#ffffff' : '#111111';
  effective.muted = mix(effective.text, palette.background, 0.3);
  if (contrastRatio(effective.muted, palette.background) < 4.5) effective.muted = ensureContrast(effective.muted, palette.background, 4.5);
  effective.border = mix(palette.primary, palette.background, 0.75);
  return { palette, effective, warnings };
}

export function mix(a, b, weight) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgbToHex({ r: x.r + (y.r - x.r) * weight, g: x.g + (y.g - x.g) * weight, b: x.b + (y.b - x.b) * weight });
}

export const PRESET_PALETTES = [
  { id: 'blush', name: 'Blush & ivory', palette: { primary: '#b5677d', secondary: '#e8c4cc', accent: '#5f7a61', background: '#fdf8f6', surface: '#f6e9e8', text: '#3a2a2e' } },
  { id: 'sage', name: 'Sage garden', palette: { primary: '#6b8468', secondary: '#c9d6c3', accent: '#a5653f', background: '#f8f9f4', surface: '#e9eee3', text: '#253024' } },
  { id: 'navy', name: 'Navy & gold', palette: { primary: '#1f3a5f', secondary: '#c8a96a', accent: '#a07c35', background: '#fbfaf6', surface: '#eef0f3', text: '#16202e' } },
  { id: 'terracotta', name: 'Terracotta sunset', palette: { primary: '#b85c38', secondary: '#e9b48a', accent: '#2f5d62', background: '#fdf7f1', surface: '#f5e6d8', text: '#3b2418' } },
  { id: 'burgundy', name: 'Burgundy velvet', palette: { primary: '#7b1e3a', secondary: '#d9a5b3', accent: '#b08d57', background: '#fbf7f5', surface: '#f1e4e6', text: '#2c1118' } },
  { id: 'emerald', name: 'Emerald & champagne', palette: { primary: '#1d5c4d', secondary: '#e3d3b0', accent: '#b5893c', background: '#fbfaf5', surface: '#e8efe9', text: '#14271f' } },
  { id: 'lavender', name: 'Lavender haze', palette: { primary: '#7a5c9e', secondary: '#d4c6e6', accent: '#c06f8f', background: '#fbf9fd', surface: '#efe9f6', text: '#2a2135' } },
  { id: 'citrus', name: 'Citrus party', palette: { primary: '#e0573a', secondary: '#f7c548', accent: '#1d7874', background: '#fffaf0', surface: '#fdebd3', text: '#2b1d14' } },
  { id: 'monochrome', name: 'Black & white', palette: { primary: '#1a1a1a', secondary: '#bdbdbd', accent: '#8a6d3b', background: '#ffffff', surface: '#f2f2f2', text: '#141414' } }
];
