// Editing controls shared by the setup wizard and the website editor.
// Each `render*` function draws a panel into a container and writes changes to the
// DraftStore; the store autosaves and the preview re-renders from it.
import { api, upload, $, $$, esc, toast, showError, upgradePrompt, confirmDialog, modal } from './api.js';
import { SECTION_TYPES, SECTION_ORDER } from '/shared/sections.js';
import { TEMPLATES, getTemplate } from '/shared/templates.js';
import { FONT_PAIRINGS, googleFontsHref } from '/shared/fonts.js';
import { PRESET_PALETTES, suggestPalette, resolvePalette, normalizeHex, TOKEN_KEYS } from '/shared/color.js';

const TOKEN_LABELS = { primary: 'Primary', secondary: 'Secondary', accent: 'Accent', background: 'Background', surface: 'Panels', text: 'Text' };
const mediaUrl = (m, size = 400) => `/media/${m.id}/${size}?v=${encodeURIComponent(String(m.updated_at || '').replace(/\D/g, ''))}`;
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));

function premiumTag(show) { return show ? '<span class="premium-tag">Premium</span>' : ''; }

// ---------------------------------------------------------------- basics
export function renderBasics(container, store, { idPrefix = 'b' } = {}) {
  const w = store.state.wedding;
  const zones = (Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['UTC']);
  if (!zones.includes(w.timezone)) zones.unshift(w.timezone);
  container.innerHTML = `<div class="stack">
    <div class="grid-2">
      <label class="field"><span>First partner's name</span><input type="text" data-k="partner1" maxlength="80" value="${esc(w.partner1)}" autocomplete="off"></label>
      <label class="field"><span>Second partner's name</span><input type="text" data-k="partner2" maxlength="80" value="${esc(w.partner2)}" autocomplete="off"></label>
    </div>
    <div class="grid-2">
      <label class="field"><span>Wedding date & time</span><input type="datetime-local" data-k="wedding_date_local" value="${esc(w.wedding_date_local || '')}"></label>
      <label class="field"><span>Timezone <span class="hint">Used for the countdown and email timing</span></span><select data-k="timezone" id="${idPrefix}-tz">${zones.map((z) => `<option ${z === w.timezone ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></label>
    </div>
    <label class="field"><span>Main location</span><input type="text" data-k="location" maxlength="200" value="${esc(w.location)}" placeholder="City, country or venue"></label>
    <label class="field"><span>Tagline <span class="hint">Optional</span></span><input type="text" data-k="tagline" maxlength="200" value="${esc(w.tagline)}" placeholder="Two hearts, one adventure"></label>
  </div>`;
  $$('[data-k]', container).forEach((el) => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
    store.update((s) => { s.wedding[el.dataset.k] = el.value; }, { group: `wedding.${el.dataset.k}` });
  }));
}

// ---------------------------------------------------------------- design
let fontsLoaded = false;
function loadFontSamples() {
  if (fontsLoaded) return;
  fontsLoaded = true;
  for (const p of FONT_PAIRINGS) {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = googleFontsHref(p);
    document.head.append(l);
  }
}

export function renderTemplatePicker(container, store, { plan, templates, onPreview, onApplied, subscribe = true } = {}) {
  const ent = plan.entitlements;
  const list = templates || TEMPLATES;
  const draw = () => {
    const current = store.state.design.template_id;
    container.innerHTML = `<div class="choice-grid" role="group" aria-label="Templates">${list.map((t) => {
      const locked = !ent.template_tiers.includes(t.tier) && t.id !== current;
      return `<button type="button" class="choice" data-tpl="${esc(t.id)}" aria-pressed="${t.id === current}" ${locked ? 'aria-disabled="true"' : ''}>${premiumTag(t.tier === 'premium')}<strong>${esc(t.name)}</strong><span class="small muted">${esc(t.style)}</span>
        <span class="swatch-row" aria-hidden="true">${['primary', 'secondary', 'accent', 'background'].map((k) => `<span style="background:${esc(getTemplate(t.id).defaults.palette[k])}"></span>`).join('')}</span></button>`;
    }).join('')}</div><p class="small muted" style="margin-top:8px">Switching templates keeps all your words, photos and sections.</p>`;
    $$('[data-tpl]', container).forEach((b) => b.addEventListener('click', () => {
      const t = list.find((x) => x.id === b.dataset.tpl);
      onPreview?.(t.id);
      if (b.getAttribute('aria-disabled') === 'true') return upgradePrompt({ feature: 'template', feature_label: 'Premium templates', error: `${t.name} is a premium template. You can preview it, and use it once Premium is available on your account.` });
      applyTemplate(store, t.id, plan);
      draw();
      onApplied?.(t.id);
    }));
  };
  draw();
  if (subscribe) store.onChange((_, meta) => { if (meta.source === 'undo' || meta.source === 'revert') draw(); });
}

// Switching template applies its palette, fonts and animation where the plan allows.
export function applyTemplate(store, templateId, plan) {
  const tpl = getTemplate(templateId);
  const ent = plan.entitlements;
  store.update((s) => {
    s.design.template_id = tpl.id;
    s.design.palette = { ...tpl.defaults.palette };
    const font = FONT_PAIRINGS.find((f) => f.id === tpl.defaults.font_pairing);
    if (font && ent.font_tiers.includes(font.tier)) s.design.font_pairing = font.id;
    if (ent.animations.includes(tpl.defaults.animation)) s.design.animation = tpl.defaults.animation;
    else if (!ent.animations.includes(s.design.animation)) s.design.animation = 'subtle';
  });
}

export function renderDesign(container, store, { plan, showTemplates = false, templates } = {}) {
  const ent = plan.entitlements;
  loadFontSamples();
  const draw = () => {
    const d = store.state.design;
    const { warnings } = resolvePalette(d.palette, getTemplate(d.template_id).defaults.palette);
    const tplPalette = getTemplate(d.template_id).defaults.palette;
    const same = (a, b) => TOKEN_KEYS.every((k) => normalizeHex(a[k]) === normalizeHex(b[k]));
    const presets = [{ id: 'template', name: `${getTemplate(d.template_id).name} original`, palette: tplPalette }, ...PRESET_PALETTES];
    container.innerHTML = `<div class="stack">
      ${showTemplates ? '<div class="field"><span class="label">Template</span><div data-templates></div></div>' : ''}
      <div class="field"><span class="label">Colour palette</span>
        <div class="palette-grid" role="group" aria-label="Preset palettes">${presets.map((p) => `<button type="button" class="palette-option" data-preset="${esc(p.id)}" aria-pressed="${same(p.palette, d.palette)}"><span class="swatch-row" aria-hidden="true">${TOKEN_KEYS.slice(0, 5).map((k) => `<span style="background:${esc(p.palette[k])}"></span>`).join('')}</span>${esc(p.name)}</button>`).join('')}</div>
      </div>
      <div class="field"><label class="label" for="primary-hex">Your wedding colour</label>
        <div class="color-input"><input type="color" id="primary-color" value="${esc(d.palette.primary)}" aria-label="Pick your main colour"><input type="text" id="primary-hex" value="${esc(d.palette.primary)}" maxlength="7" spellcheck="false" inputmode="text" aria-describedby="primary-hint"></div>
        <span class="hint" id="primary-hint">Enter a hex code like #7b1e3a. ${ent.advanced_colours ? 'Use “Suggest matching colours” to rebuild the palette around it.' : 'We build a matching palette from it automatically.'}</span>
        ${ent.advanced_colours ? '<button type="button" class="btn btn-secondary btn-sm" data-suggest style="justify-self:start">Suggest matching colours</button>' : ''}
      </div>
      <details ${ent.advanced_colours ? '' : ''}><summary class="label" style="cursor:pointer">Fine-tune each colour ${premiumTag(!ent.advanced_colours)}</summary>
        <div class="stack-sm" style="margin-top:10px">${TOKEN_KEYS.map((k) => `<div class="color-input"><input type="color" data-token="${k}" value="${esc(d.palette[k])}" aria-label="${TOKEN_LABELS[k]} colour" ${ent.advanced_colours ? '' : 'disabled'}><input type="text" data-token-hex="${k}" value="${esc(d.palette[k])}" maxlength="7" aria-label="${TOKEN_LABELS[k]} hex" ${ent.advanced_colours ? '' : 'disabled'}><span class="small" style="min-width:80px">${TOKEN_LABELS[k]}</span></div>`).join('')}
        ${ent.advanced_colours ? '' : '<p class="upgrade-inline">Choosing every colour individually is part of Premium. <a href="/app/upgrade?feature=advanced_colours">Learn more</a></p>'}</div>
      </details>
      ${warnings.length ? `<div class="contrast-warn" role="status">${warnings.map((w) => esc(w.message)).join('<br>')}</div>` : ''}
      <div class="field"><span class="label">Fonts</span>
        <div class="choice-grid" role="group" aria-label="Font pairings">${FONT_PAIRINGS.map((f) => {
          const locked = !ent.font_tiers.includes(f.tier) && f.id !== d.font_pairing;
          return `<button type="button" class="choice" data-font="${esc(f.id)}" aria-pressed="${f.id === d.font_pairing}" ${locked ? 'aria-disabled="true"' : ''}>${premiumTag(f.tier === 'premium')}<span class="font-sample" style="font-family:'${esc(f.script || f.heading)}',serif">Amara &amp; Theo</span><span class="small" style="font-family:'${esc(f.body)}',sans-serif">${esc(f.name)} · ${esc(f.heading)} / ${esc(f.body)}</span></button>`;
        }).join('')}</div>
      </div>
      <div class="field"><span class="label">Animation</span>
        <div class="choice-grid" role="group" aria-label="Animation style">${[['static', 'Static', 'No decorative motion.'], ['subtle', 'Subtle', 'Gentle fades as guests scroll.'], ['expressive', 'Expressive', 'Bolder reveals, zooms and movement.']].map(([id, name, desc]) => {
          const locked = !ent.animations.includes(id) && d.animation !== id;
          return `<button type="button" class="choice" data-anim="${id}" aria-pressed="${d.animation === id}" ${locked ? 'aria-disabled="true"' : ''}>${premiumTag(id === 'expressive' && !ent.animations.includes(id))}<strong>${name}</strong><span class="small muted">${desc}</span></button>`;
        }).join('')}</div>
        <span class="hint">Guests who prefer reduced motion on their device always see a calm, static version.</span>
      </div>
    </div>`;

    if (showTemplates) renderTemplatePicker($('[data-templates]', container), store, { plan, templates, subscribe: false, onApplied: () => draw() });
    $$('[data-preset]', container).forEach((b) => b.addEventListener('click', () => {
      const p = presets.find((x) => x.id === b.dataset.preset);
      store.update((s) => { s.design.palette = { ...p.palette }; });
      draw();
    }));
    const setPrimary = (hex) => {
      const v = normalizeHex(hex);
      if (!v) return;
      store.update((s) => { s.design.palette = ent.advanced_colours ? { ...s.design.palette, primary: v } : suggestPalette(v); }, { group: 'primary' });
    };
    $('#primary-color', container).addEventListener('input', (e) => { $('#primary-hex', container).value = e.target.value; setPrimary(e.target.value); });
    $('#primary-color', container).addEventListener('change', draw);
    $('#primary-hex', container).addEventListener('change', (e) => {
      if (!normalizeHex(e.target.value)) { e.target.setAttribute('aria-invalid', 'true'); toast('Enter a colour like #7b1e3a', 'error'); return; }
      e.target.removeAttribute('aria-invalid');
      setPrimary(e.target.value); draw();
    });
    $('[data-suggest]', container)?.addEventListener('click', () => { store.update((s) => { s.design.palette = suggestPalette(s.design.palette.primary); }); draw(); });
    $$('[data-token]', container).forEach((el) => {
      el.addEventListener('input', () => {
        $(`[data-token-hex="${el.dataset.token}"]`, container).value = el.value;
        store.update((s) => { s.design.palette[el.dataset.token] = el.value; }, { group: `token.${el.dataset.token}` });
      });
      el.addEventListener('change', draw);
    });
    $$('[data-token-hex]', container).forEach((el) => el.addEventListener('change', () => {
      const v = normalizeHex(el.value);
      if (!v) { el.setAttribute('aria-invalid', 'true'); return; }
      store.update((s) => { s.design.palette[el.dataset.tokenHex] = v; }); draw();
    }));
    $$('[data-font]', container).forEach((b) => b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') === 'true') return upgradePrompt({ feature: 'font', feature_label: 'Premium font pairings', error: 'This font pairing is part of Premium.' });
      store.update((s) => { s.design.font_pairing = b.dataset.font; }); draw();
    }));
    $$('[data-anim]', container).forEach((b) => b.addEventListener('click', () => {
      if (b.getAttribute('aria-disabled') === 'true') return upgradePrompt({ feature: 'animation', feature_label: 'Expressive animations', error: 'Expressive animation is part of Premium.' });
      store.update((s) => { s.design.animation = b.dataset.anim; }); draw();
    }));
  };
  draw();
  store.onChange((_, meta) => { if (meta.source === 'undo' || meta.source === 'revert') draw(); });
}

// ---------------------------------------------------------------- sections list
export function renderSectionList(container, store, { plan, getSelected = () => null, onSelect } = {}) {
  const ent = plan.entitlements;
  let dragId = null;
  const draw = () => {
    const sections = store.state.sections;
    const active = sections.filter((s) => s.status !== 'removed');
    const removed = sections.filter((s) => s.status === 'removed');
    const presentTypes = new Set(sections.map((s) => s.type));
    const addable = SECTION_ORDER.filter((t) => !presentTypes.has(t));
    const selected = getSelected();
    container.innerHTML = `
      <ol class="section-list" aria-label="Website sections (in page order)">${active.map((s, i) => {
        const def = SECTION_TYPES[s.type];
        const hidden = s.status === 'hidden';
        return `<li class="section-item${hidden ? ' is-hidden' : ''}${selected === s.id ? ' selected' : ''}" draggable="true" data-id="${esc(s.id)}">
          <span class="handle" aria-hidden="true" title="Drag to reorder">⋮⋮</span>
          <span class="section-icon" aria-hidden="true">${esc(def.icon)}</span>
          <button type="button" class="section-name" data-select="${esc(s.id)}">${esc(def.name)}${hidden ? '<span class="sr-only"> (hidden)</span>' : ''}</button>
          <span class="tools">
            <button type="button" class="btn btn-ghost btn-icon" data-move="-1" data-id="${esc(s.id)}" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(def.name)} up">↑</button>
            <button type="button" class="btn btn-ghost btn-icon" data-move="1" data-id="${esc(s.id)}" ${i === active.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(def.name)} down">↓</button>
            <button type="button" class="btn btn-ghost btn-icon" data-toggle="${esc(s.id)}" aria-pressed="${!hidden}" aria-label="${hidden ? 'Show' : 'Hide'} ${esc(def.name)}" title="${hidden ? 'Hidden from guests — click to show' : 'Visible — click to hide'}">${hidden ? '◌' : '◉'}</button>
            ${def.required ? '' : `<button type="button" class="btn btn-ghost btn-icon" data-remove="${esc(s.id)}" aria-label="Remove ${esc(def.name)}" title="Remove (you can restore it later)">✕</button>`}
          </span></li>`;
      }).join('')}</ol>
      ${removed.length ? `<div style="margin-top:16px"><p class="label small" style="margin-bottom:6px">Removed sections <span class="hint">— content is kept</span></p><ul class="section-list">${removed.map((s) => `<li class="section-item is-hidden"><span class="section-icon" aria-hidden="true">${esc(SECTION_TYPES[s.type].icon)}</span><span class="section-name">${esc(SECTION_TYPES[s.type].name)}</span><button type="button" class="btn btn-secondary btn-sm" data-restore="${esc(s.id)}">Restore</button></li>`).join('')}</ul></div>` : ''}
      <details style="margin-top:16px"><summary class="btn btn-secondary btn-sm" style="list-style:none">＋ Add a section</summary>
        <div class="stack-sm" style="margin-top:10px">${addable.map((t) => {
          const def = SECTION_TYPES[t];
          const locked = !ent.sections.includes(t);
          return `<button type="button" class="choice" data-add="${t}" ${def.comingSoon ? 'disabled aria-disabled="true"' : locked ? 'aria-disabled="true"' : ''}>${def.comingSoon ? '<span class="badge" style="position:absolute;top:10px;right:10px">Coming soon</span>' : premiumTag(locked)}<strong>${esc(def.icon)} ${esc(def.name)}</strong><span class="small muted">${esc(def.description)}</span></button>`;
        }).join('') || '<p class="small muted">All available sections are on your website.</p>'}</div>
      </details>`;

    $$('[data-select]', container).forEach((b) => b.addEventListener('click', () => onSelect?.(b.dataset.select)));
    $$('[data-move]', container).forEach((b) => b.addEventListener('click', () => {
      move(b.dataset.id, Number(b.dataset.move));
      draw();
      $(`[data-move="${b.dataset.move}"][data-id="${CSS.escape(b.dataset.id)}"]`, container)?.focus();
    }));
    $$('[data-toggle]', container).forEach((b) => b.addEventListener('click', () => {
      store.update((s) => { const x = s.sections.find((y) => y.id === b.dataset.toggle); x.status = x.status === 'hidden' ? 'visible' : 'hidden'; });
      draw();
      $(`[data-toggle="${CSS.escape(b.dataset.toggle)}"]`, container)?.focus();
    }));
    $$('[data-remove]', container).forEach((b) => b.addEventListener('click', () => {
      store.update((s) => { s.sections.find((y) => y.id === b.dataset.remove).status = 'removed'; });
      toast('Section removed. You can restore it from “Removed sections”.');
      draw();
    }));
    $$('[data-restore]', container).forEach((b) => b.addEventListener('click', () => {
      const sec = store.section(b.dataset.restore);
      if (!ent.sections.includes(sec.type)) return upgradePrompt({ feature: 'section', feature_label: SECTION_TYPES[sec.type].name, error: `The ${SECTION_TYPES[sec.type].name} section is part of Premium. Its content is safely kept.` });
      store.update((s) => {
        const x = s.sections.find((y) => y.id === b.dataset.restore);
        x.status = 'visible';
        s.sections = [...s.sections.filter((y) => y.status !== 'removed' && y.id !== x.id), x, ...s.sections.filter((y) => y.status === 'removed' && y.id !== x.id)];
      });
      draw(); onSelect?.(b.dataset.restore);
    }));
    $$('[data-add]', container).forEach((b) => b.addEventListener('click', () => {
      const t = b.dataset.add;
      if (SECTION_TYPES[t].comingSoon) return;
      if (!ent.sections.includes(t)) return upgradePrompt({ feature: 'section', feature_label: SECTION_TYPES[t].name, error: `The ${SECTION_TYPES[t].name} section is part of Premium.` });
      const id = uid();
      store.update((s) => {
        const sec = { id, type: t, status: 'visible', content: SECTION_TYPES[t].defaults(s.wedding), settings: {} };
        const rsvpIdx = s.sections.findIndex((y) => y.type === 'rsvp' && y.status !== 'removed');
        if (rsvpIdx >= 0 && t !== 'rsvp') s.sections.splice(rsvpIdx, 0, sec); else s.sections.splice(s.sections.filter((y) => y.status !== 'removed').length, 0, sec);
      }, { immediate: true });
      draw(); onSelect?.(id);
    }));

    // Drag and drop reordering (buttons above cover keyboard users).
    $$('.section-item[draggable]', container).forEach((li) => {
      li.addEventListener('dragstart', (e) => { dragId = li.dataset.id; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); });
      li.addEventListener('dragend', () => { li.classList.remove('dragging'); $$('.drop-target', container).forEach((x) => x.classList.remove('drop-target')); });
      li.addEventListener('dragover', (e) => { if (!dragId || dragId === li.dataset.id) return; e.preventDefault(); li.classList.add('drop-target'); });
      li.addEventListener('dragleave', () => li.classList.remove('drop-target'));
      li.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = dragId; const to = li.dataset.id; dragId = null;
        if (!from || from === to) return;
        store.update((s) => {
          const arr = s.sections;
          const item = arr.splice(arr.findIndex((x) => x.id === from), 1)[0];
          arr.splice(arr.findIndex((x) => x.id === to), 0, item);
        });
        draw();
      });
    });
  };

  function move(id, dir) {
    store.update((s) => {
      const active = s.sections.filter((x) => x.status !== 'removed');
      const i = active.findIndex((x) => x.id === id);
      const j = i + dir;
      if (j < 0 || j >= active.length) return;
      [active[i], active[j]] = [active[j], active[i]];
      s.sections = [...active, ...s.sections.filter((x) => x.status === 'removed')];
    });
  }

  draw();
  store.onChange((_, meta) => { if (meta.source === 'undo' || meta.source === 'revert') draw(); });
  return { redraw: draw };
}

// ---------------------------------------------------------------- section settings
function fieldInput(f, value, path) {
  const id = `f-${path.replace(/[^a-z0-9]/gi, '-')}`;
  const common = `id="${id}" data-path="${esc(path)}"`;
  switch (f.type) {
    case 'textarea': return `<label class="field" for="${id}"><span>${esc(f.label)}</span><textarea ${common} rows="3" placeholder="${esc(f.placeholder || '')}">${esc(value || '')}</textarea></label>`;
    case 'toggle': return `<label class="switch"><input type="checkbox" ${common} ${value ? 'checked' : ''}> ${esc(f.label)}</label>`;
    case 'date': return `<label class="field" for="${id}"><span>${esc(f.label)}</span><input type="date" ${common} value="${esc(value || '')}"></label>`;
    case 'time': return `<label class="field" for="${id}"><span>${esc(f.label)}</span><input type="time" ${common} value="${esc(value || '')}"></label>`;
    case 'url': return `<label class="field" for="${id}"><span>${esc(f.label)}</span><input type="url" ${common} value="${esc(value || '')}" placeholder="${esc(f.placeholder || 'https://')}"></label>`;
    case 'image': return `<div class="field"><span class="label">${esc(f.label)}</span><div class="image-pick" data-image-path="${esc(path)}"></div></div>`;
    default: return `<label class="field" for="${id}"><span>${esc(f.label)}</span><input type="text" ${common} value="${esc(value || '')}" placeholder="${esc(f.placeholder || '')}" maxlength="300"></label>`;
  }
}

function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => o[k], obj);
  target[last] = value;
}

export function renderSectionSettings(container, store, sectionId, { plan, onPhotos, extra } = {}) {
  const draw = () => {
    const sec = store.section(sectionId);
    if (!sec) { container.innerHTML = '<div class="empty"><p>Select a section to edit it.</p></div>'; return; }
    const def = SECTION_TYPES[sec.type];
    const layouts = def.layouts;
    const tplLayout = getTemplate(store.state.design.template_id).layouts[sec.type] || layouts[0][0];
    const fieldsHtml = def.fields.map((f) => {
      if (f.type !== 'list') return fieldInput(f, sec.content[f.key], `${f.key}`);
      const items = sec.content[f.key] || [];
      return `<div class="field"><span class="label">${esc(f.label)}</span><div class="list-field">${items.map((item, i) => {
        const titleField = f.itemFields.find((x) => x.type === 'text');
        const title = item[titleField?.key] || `New ${f.itemLabel}`;
        return `<details class="list-item" ${items.length <= 2 ? 'open' : ''}><summary><span class="grow">${esc(title)}</span>
          <button type="button" class="btn btn-ghost btn-icon" data-item-move="-1" data-list="${f.key}" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="Move ${esc(title)} up">↑</button>
          <button type="button" class="btn btn-ghost btn-icon" data-item-move="1" data-list="${f.key}" data-i="${i}" ${i === items.length - 1 ? 'disabled' : ''} aria-label="Move ${esc(title)} down">↓</button>
          <button type="button" class="btn btn-ghost btn-icon" data-item-del data-list="${f.key}" data-i="${i}" aria-label="Delete ${esc(title)}">✕</button></summary>
          <div class="list-body">${f.itemFields.map((itf) => fieldInput(itf, item[itf.key], `${f.key}.${i}.${itf.key}`)).join('')}</div></details>`;
      }).join('')}<button type="button" class="btn btn-secondary btn-sm" data-item-add="${f.key}" style="justify-self:start">＋ Add ${esc(f.itemLabel)}</button></div></div>`;
    }).join('');

    container.innerHTML = `<div class="stack">
      <div class="row between"><h3 style="margin:0">${esc(def.icon)} ${esc(def.name)}</h3><label class="switch"><input type="checkbox" data-visible ${sec.status === 'visible' ? 'checked' : ''}> Visible</label></div>
      ${sec.status === 'hidden' ? '<p class="notice info small">This section is hidden. Guests will not see it, but its content is saved.</p>' : ''}
      ${layouts.length > 1 ? `<label class="field"><span>Layout</span><select data-layout>${layouts.map(([v, l]) => `<option value="${v}" ${(sec.settings.layout || tplLayout) === v ? 'selected' : ''}>${esc(l)}${v === tplLayout ? ' (template default)' : ''}</option>`).join('')}</select></label>` : ''}
      <div data-extra></div>
      ${fieldsHtml}
    </div>`;

    if (sec.type === 'hero') {
      const box = $('[data-extra]', container);
      box.innerHTML = '<details open class="list-item"><summary>Names, date & place</summary><div class="list-body" data-basics></div></details><div class="field"><span class="label">Cover photo</span><div data-cover></div></div>';
      renderBasics($('[data-basics]', box), store, { idPrefix: 'hero' });
      renderCoverPicker($('[data-cover]', box), store, { plan });
    }
    if (sec.type === 'gallery') renderPhotos($('[data-extra]', container), store, { plan, onChange: onPhotos });
    if (extra) extra(sec, $('[data-extra]', container));

    $('[data-visible]', container).addEventListener('change', (e) => { store.update((s) => { s.sections.find((x) => x.id === sectionId).status = e.target.checked ? 'visible' : 'hidden'; }); draw(); });
    $('[data-layout]', container)?.addEventListener('change', (e) => store.update((s) => { s.sections.find((x) => x.id === sectionId).settings.layout = e.target.value; }));
    $$('[data-path]', container).forEach((el) => {
      const evt = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(evt, () => {
        const v = el.type === 'checkbox' ? el.checked : el.value;
        store.update((s) => setPath(s.sections.find((x) => x.id === sectionId).content, el.dataset.path, v), { group: `${sectionId}.${el.dataset.path}` });
        const summary = el.closest('details.list-item')?.querySelector('summary .grow');
        if (summary && el.type === 'text' && el === el.closest('.list-body').querySelector('input[type=text]')) summary.textContent = el.value || 'New item';
      });
    });
    $$('[data-image-path]', container).forEach((box) => imagePicker(box, store, {
      value: getPath(sec.content, box.dataset.imagePath),
      onPick: (id) => { store.update((s) => setPath(s.sections.find((x) => x.id === sectionId).content, box.dataset.imagePath, id)); draw(); },
      plan
    }));
    $$('[data-item-add]', container).forEach((b) => b.addEventListener('click', () => {
      const f = def.fields.find((x) => x.key === b.dataset.itemAdd);
      store.update((s) => {
        const c = s.sections.find((x) => x.id === sectionId).content;
        const blank = Object.fromEntries(f.itemFields.map((itf) => [itf.key, itf.type === 'toggle' ? false : itf.type === 'image' ? null : '']));
        blank.id = uid().slice(0, 8);
        c[f.key] = [...(c[f.key] || []), blank];
      });
      draw();
      const items = $$(`.list-item`, container);
      items[items.length - 1]?.setAttribute('open', '');
      items[items.length - 1]?.querySelector('input, textarea')?.focus();
    }));
    $$('[data-item-del]', container).forEach((b) => b.addEventListener('click', async (e) => {
      e.preventDefault();
      if (!await confirmDialog('Delete this item? You can undo with Ctrl+Z.', { title: 'Delete item', confirmLabel: 'Delete', danger: true })) return;
      store.update((s) => { s.sections.find((x) => x.id === sectionId).content[b.dataset.list].splice(Number(b.dataset.i), 1); });
      draw();
    }));
    $$('[data-item-move]', container).forEach((b) => b.addEventListener('click', (e) => {
      e.preventDefault();
      store.update((s) => {
        const arr = s.sections.find((x) => x.id === sectionId).content[b.dataset.list];
        const i = Number(b.dataset.i), j = i + Number(b.dataset.itemMove);
        [arr[i], arr[j]] = [arr[j], arr[i]];
      });
      draw();
    }));
  };
  draw();
  const off = store.onChange((_, meta) => { if (meta.source === 'undo' || meta.source === 'revert') draw(); });
  return { destroy: off, redraw: draw };
}

// ---------------------------------------------------------------- images
function imagePicker(box, store, { value, onPick, plan }) {
  const m = store.state.media.find((x) => x.id === value);
  box.innerHTML = `${m ? `<img src="${mediaUrl(m)}" alt="">` : '<span class="placeholder" aria-hidden="true">▦</span>'}
    <button type="button" class="btn btn-secondary btn-sm" data-pick>${m ? 'Change' : 'Choose photo'}</button>${m ? '<button type="button" class="btn btn-ghost btn-sm" data-clear>Remove</button>' : ''}`;
  $('[data-pick]', box).addEventListener('click', () => openMediaPicker(store, { plan, onPick }));
  $('[data-clear]', box)?.addEventListener('click', () => onPick(null));
}

export function openMediaPicker(store, { plan, onPick, kind = 'library' }) {
  const body = document.createElement('div');
  body.className = 'stack';
  const draw = () => {
    const media = store.state.media;
    body.innerHTML = `<label class="dropzone" style="padding:18px"><input type="file" accept="image/*" hidden data-file><strong>Upload a new photo</strong><span class="small muted"> JPEG, PNG, WebP or HEIC</span></label><div class="upload-list" data-uploads></div>
      ${media.length ? `<div class="picker-grid">${media.map((m) => `<button type="button" data-id="${esc(m.id)}" aria-label="Use ${esc(m.caption || m.original_name || 'photo')}"><img src="${mediaUrl(m)}" alt=""></button>`).join('')}</div>` : '<p class="muted small">No photos yet.</p>'}`;
    $$('[data-id]', body).forEach((b) => b.addEventListener('click', () => { onPick(b.dataset.id); dlg.close(); }));
    $('[data-file]', body).addEventListener('change', async (e) => {
      const asset = await uploadFiles(store, [...e.target.files], { plan, kind, list: $('[data-uploads]', body), autoCover: false });
      if (asset[0]) { onPick(asset[0].id); dlg.close(); }
    });
  };
  const dlg = modal({ title: 'Choose a photo', body, wide: true });
  draw();
}

export async function uploadFiles(store, files, { plan, kind = 'gallery', list, autoCover = true, onDone } = {}) {
  const ent = plan.entitlements;
  const results = [];
  for (const file of files) {
    const row = document.createElement('div');
    row.className = 'upload-item';
    row.innerHTML = `<span>${esc(file.name)}</span><span class="tiny muted" data-pct>0%</span><div class="progress"><div style="width:0%"></div></div>`;
    list?.append(row);
    if (!/^image\//.test(file.type) && !/\.(heic|heif)$/i.test(file.name)) { fail(row, 'Not an image file'); continue; }
    if (file.size > ent.max_upload_mb * 1048576) { fail(row, `Larger than ${ent.max_upload_mb} MB`); continue; }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', kind);
    if (!autoCover) fd.append('auto_cover', 'false');
    try {
      const r = await upload(`/api/weddings/${store.weddingId}/media`, fd, (p) => { $('.progress > div', row).style.width = `${Math.round(p * 90)}%`; $('[data-pct]', row).textContent = p >= 1 ? 'Optimising…' : `${Math.round(p * 100)}%`; });
      $('.progress > div', row).style.width = '100%';
      $('[data-pct]', row).textContent = 'Done';
      if (r.asset.is_cover) store.state.media.forEach((m) => { m.is_cover = false; });
      store.state.media.push({ ...r.asset, is_cover: !!r.asset.is_cover });
      results.push(r.asset);
      store.emit({ source: 'media' });
      setTimeout(() => row.remove(), 1500);
    } catch (err) {
      fail(row, err.message);
      if (err.data?.code === 'plan_limit') { upgradePrompt(err.data); break; }
    }
  }
  onDone?.();
  return results;
  function fail(row, msg) { row.classList.add('failed'); $('[data-pct]', row).textContent = msg; $('.progress > div', row).style.width = '100%'; }
}

export function renderCoverPicker(container, store, { plan }) {
  const draw = () => {
    const cover = store.state.media.find((m) => m.is_cover);
    container.innerHTML = '<div class="image-pick"></div>';
    imagePicker($('.image-pick', container), store, {
      value: cover?.id, plan,
      onPick: async (id) => {
        try {
          if (id) await api('PATCH', `/api/weddings/${store.weddingId}/media/${id}`, { is_cover: true });
          else if (cover) await api('PATCH', `/api/weddings/${store.weddingId}/media/${cover.id}`, { is_cover: false });
          store.state.media.forEach((m) => { m.is_cover = m.id === id; });
          store.emit({ source: 'media' });
          draw();
        } catch (err) { showError(err); }
      }
    });
  };
  draw();
}

export function renderPhotos(container, store, { plan, onChange } = {}) {
  let dragId = null;
  const wid = store.weddingId;
  const changed = () => { store.emit({ source: 'media' }); onChange?.(); };
  const draw = () => {
    const gallery = store.state.media.filter((m) => m.kind === 'gallery').sort((a, b) => a.position - b.position);
    const library = store.state.media.filter((m) => m.kind === 'library');
    const tile = (m, i, arr) => `<div class="photo${m.is_cover ? ' is-cover' : ''}" draggable="${m.kind === 'gallery'}" data-id="${esc(m.id)}">
        ${m.is_cover ? '<span class="cover-flag">Cover</span>' : ''}
        <img src="${mediaUrl(m)}" alt="${esc(m.caption || 'Photo')}" loading="lazy" width="150" height="150">
        <div class="photo-tools">
          ${m.kind === 'gallery' ? `<button type="button" class="btn btn-ghost btn-icon" data-pmove="-1" data-id="${esc(m.id)}" ${i === 0 ? 'disabled' : ''} aria-label="Move photo earlier">←</button><button type="button" class="btn btn-ghost btn-icon" data-pmove="1" data-id="${esc(m.id)}" ${i === arr.length - 1 ? 'disabled' : ''} aria-label="Move photo later">→</button>` : ''}
          <button type="button" class="btn btn-ghost btn-icon" data-cover="${esc(m.id)}" aria-pressed="${!!m.is_cover}" aria-label="${m.is_cover ? 'This is the cover photo' : 'Make cover photo'}" title="Make cover photo">★</button>
          <label class="btn btn-ghost btn-icon" title="Replace photo"><input type="file" accept="image/*" hidden data-replace="${esc(m.id)}"><span aria-hidden="true">⟳</span><span class="sr-only">Replace photo</span></label>
          <button type="button" class="btn btn-ghost btn-icon" data-del="${esc(m.id)}" aria-label="Delete photo" title="Delete">🗑</button>
        </div>
        <input type="text" value="${esc(m.caption)}" placeholder="Add a caption" maxlength="300" data-caption="${esc(m.id)}" aria-label="Caption">
      </div>`;
    const used = store.state.media.length;
    container.innerHTML = `<div class="stack">
      <label class="dropzone" data-drop><input type="file" accept="image/*,.heic,.heif" multiple hidden data-files>
        <strong>Drop photos here or click to upload</strong><br><span class="small muted">JPEG, PNG, WebP or HEIC · up to ${plan.entitlements.max_upload_mb} MB each · ${used} of ${plan.entitlements.max_photos} photos used</span></label>
      <div class="upload-list" data-uploads aria-live="polite"></div>
      ${gallery.length ? `<p class="small muted" style="margin:0">Drag photos (or use the arrows) to change their order. ★ sets the cover photo shown at the top of your website.</p><div class="photo-grid">${gallery.map(tile).join('')}</div>` : '<div class="empty" style="padding:24px"><p>No gallery photos yet. Your first photo becomes the cover.</p></div>'}
      ${library.length ? `<p class="label small" style="margin:8px 0 0">Other photos <span class="hint">used in your story or wedding party</span></p><div class="photo-grid">${library.map(tile).join('')}</div>` : ''}
    </div>`;

    const drop = $('[data-drop]', container);
    $('[data-files]', container).addEventListener('change', (e) => uploadFiles(store, [...e.target.files], { plan, list: $('[data-uploads]', container), onDone: () => { draw(); onChange?.(); } }));
    drop.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); drop.classList.add('over'); } });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); uploadFiles(store, [...e.dataTransfer.files], { plan, list: $('[data-uploads]', container), onDone: () => { draw(); onChange?.(); } }); });

    $$('[data-caption]', container).forEach((el) => el.addEventListener('change', async () => {
      try {
        await api('PATCH', `/api/weddings/${wid}/media/${el.dataset.caption}`, { caption: el.value });
        store.state.media.find((m) => m.id === el.dataset.caption).caption = el.value;
        changed();
      } catch (err) { showError(err); }
    }));
    $$('[data-cover]', container).forEach((b) => b.addEventListener('click', async () => {
      try {
        await api('PATCH', `/api/weddings/${wid}/media/${b.dataset.cover}`, { is_cover: true });
        store.state.media.forEach((m) => { m.is_cover = m.id === b.dataset.cover; });
        changed(); draw();
      } catch (err) { showError(err); }
    }));
    $$('[data-del]', container).forEach((b) => b.addEventListener('click', async () => {
      if (!await confirmDialog('This photo will be permanently deleted from your website.', { title: 'Delete photo?', confirmLabel: 'Delete', danger: true })) return;
      try {
        await api('DELETE', `/api/weddings/${wid}/media/${b.dataset.del}`);
        store.state.media = store.state.media.filter((m) => m.id !== b.dataset.del);
        changed(); draw();
      } catch (err) { showError(err); }
    }));
    $$('[data-replace]', container).forEach((input) => input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      const fd = new FormData(); fd.append('file', file);
      try {
        toast('Replacing photo…');
        const r = await upload(`/api/weddings/${wid}/media/${input.dataset.replace}/replace`, fd);
        Object.assign(store.state.media.find((m) => m.id === input.dataset.replace), r.asset, { is_cover: !!r.asset.is_cover });
        changed(); draw(); toast('Photo replaced', 'success');
      } catch (err) { showError(err); }
    }));
    const reorder = async (ids) => {
      ids.forEach((id, i) => { const m = store.state.media.find((x) => x.id === id); if (m) m.position = i; });
      changed(); draw();
      try { await api('PUT', `/api/weddings/${wid}/media-order`, { ids }); } catch (err) { showError(err); }
    };
    $$('[data-pmove]', container).forEach((b) => b.addEventListener('click', () => {
      const ids = store.state.media.filter((m) => m.kind === 'gallery').sort((a, c) => a.position - c.position).map((m) => m.id);
      const i = ids.indexOf(b.dataset.id), j = i + Number(b.dataset.pmove);
      [ids[i], ids[j]] = [ids[j], ids[i]];
      reorder(ids);
    }));
    $$('.photo[draggable="true"]', container).forEach((el) => {
      el.addEventListener('dragstart', (e) => { dragId = el.dataset.id; el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); });
      el.addEventListener('dragend', () => { el.classList.remove('dragging'); $$('.drop-target', container).forEach((x) => x.classList.remove('drop-target')); });
      el.addEventListener('dragover', (e) => { if (dragId && dragId !== el.dataset.id) { e.preventDefault(); el.classList.add('drop-target'); } });
      el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
      el.addEventListener('drop', (e) => {
        e.preventDefault(); e.stopPropagation();
        const ids = store.state.media.filter((m) => m.kind === 'gallery').sort((a, c) => a.position - c.position).map((m) => m.id);
        const from = ids.indexOf(dragId); const to = ids.indexOf(el.dataset.id);
        dragId = null;
        if (from < 0 || to < 0) return;
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        reorder(ids);
      });
    });
  };
  draw();
  return { redraw: draw };
}
