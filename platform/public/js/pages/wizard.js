import { api, $, $$, esc, param, appChrome, showError, setFieldErrors, toast, track, ApiError, getConfig } from '../api.js';
import { DraftStore, statusText } from '../draft-store.js';
import { PreviewFrame } from '../preview.js';
import { renderBasics, renderTemplatePicker, renderDesign, renderPhotos, renderSectionList, applyTemplate } from '../editor-controls.js';
import { publishFlow } from '../publish.js';
import { getTemplate } from '/shared/templates.js';

const STEPS = [
  { key: 'basics', title: 'Wedding basics', intro: 'Let’s start with the essentials. You can change any of this later.' },
  { key: 'template', title: 'Choose a template', intro: 'Pick the design that feels most like you. Your content moves with you if you switch later.' },
  { key: 'theme', title: 'Set your theme', intro: 'Choose your wedding colours, fonts and how much movement you like.' },
  { key: 'photos', title: 'Add photos', intro: 'Upload a cover photo and a few favourites for your gallery. You can add more any time.' },
  { key: 'sections', title: 'Choose sections', intro: 'Decide what to include and in what order. Hidden and removed sections keep their content.' },
  { key: 'publish', title: 'Preview & publish', intro: 'Check everything looks right, choose your web address and go live — or save it as a draft.' }
];

const config = await getConfig();
let summary = null;
let store = null;
let step = 0;
let preview = null;
let offPreview = null;
let offStatus = null;
const main = $('#main');

// Existing wedding? Resume it; otherwise start at step 1 with a creation form.
try {
  if (param('id')) summary = await api('GET', `/api/weddings/${encodeURIComponent(param('id'))}`);
  else {
    const { weddings } = await api('GET', '/api/weddings');
    if (weddings.length && !param('new')) summary = await api('GET', `/api/weddings/${weddings[0].wedding.id}`);
  }
} catch (err) { showError(err); }

await appChrome({ weddingId: summary?.wedding.id });

if (summary) {
  store = new DraftStore(summary.wedding.id);
  await store.load();
  step = Math.min(Math.max(summary.wedding.setup_step - 1, 0), STEPS.length - 1);
  if (summary.wedding.first_published_at) step = 0;
  if (param('step')) step = Math.min(STEPS.length - 1, Math.max(0, Number(param('step')) - 1));
}

const preferredTemplate = param('template');

function frame() {
  main.innerHTML = `
    <ol class="wizard-steps" aria-label="Setup steps">${STEPS.map((s, i) => `<li class="${i < step ? 'done' : ''}${i === step ? ' current' : ''}"><button type="button" data-step="${i}" ${!store || i > (summary?.wedding.setup_step ?? 1) - 1 + 1 ? 'disabled' : ''} ${i === step ? 'aria-current="step"' : ''}>${i + 1}. ${esc(s.title)}</button></li>`).join('')}</ol>
    <div class="page-head" style="margin-bottom:18px"><div><p class="eyebrow" style="margin:0 0 6px">Step ${step + 1} of ${STEPS.length}</p><h1>${esc(STEPS[step].title)}</h1><p>${esc(STEPS[step].intro)}</p></div></div>
    <div id="step-body"></div>
    <div class="wizard-foot"><div class="inner">
      <button class="btn btn-ghost" type="button" id="back" ${step === 0 ? 'hidden' : ''}>← Back</button>
      <span class="save-status" id="status" role="status" data-state="saved">${store ? 'All changes saved' : ''}</span>
      <span class="row"><a class="btn btn-ghost hide-sm" href="/app${summary ? `?id=${summary.wedding.id}` : ''}" ${store ? '' : 'hidden'}>Finish later</a>
      <button class="btn btn-primary" type="button" id="next">${step === STEPS.length - 1 ? 'Go to dashboard' : 'Continue →'}</button></span>
    </div></div>`;
  $$('[data-step]').forEach((b) => b.addEventListener('click', () => go(Number(b.dataset.step))));
  $('#back').addEventListener('click', () => go(step - 1));
  $('#next').addEventListener('click', next);
  offPreview?.(); offPreview = null;
  offStatus?.();
  if (store) offStatus = store.onStatus((s, d) => { const el = $('#status'); if (el) { el.dataset.state = s; el.textContent = statusText(s, d); } });
  renderStep();
  main.focus?.();
  window.scrollTo(0, 0);
}

function previewBlock() {
  return `<div class="stack-sm" style="margin-top:28px"><div class="row between"><h2 style="font-size:1.3rem;margin:0">Live preview</h2>
    <div class="preview-toggle" role="group" aria-label="Preview size"><button type="button" data-device="desktop" aria-pressed="true">Desktop</button><button type="button" data-device="mobile" aria-pressed="false">Mobile</button></div></div>
    <div class="preview-frame-wrap" id="pv-wrap"><iframe id="pv" title="Preview of your website"></iframe></div></div>`;
}

function mountPreview() {
  const iframe = $('#pv');
  if (!iframe) return;
  offPreview?.();
  preview = new PreviewFrame(iframe);
  const draw = () => preview.render(store.state, { showBranding: !summary.plan.entitlements.remove_branding, platformName: config.platform_name });
  offPreview = store.onChange(draw);
  draw();
  $$('[data-device]').forEach((b) => b.addEventListener('click', () => {
    $$('[data-device]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    $('#pv-wrap').classList.toggle('mobile', b.dataset.device === 'mobile');
  }));
}

async function renderStep() {
  const body = $('#step-body');
  const key = STEPS[step].key;
  if (key === 'basics' && !store) {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const zones = Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : [tz];
    body.innerHTML = `<form class="card stack" id="create" novalidate>
      <div class="grid-2"><label class="field"><span>First partner's name</span><input type="text" name="partner1" required maxlength="80" autocomplete="off"></label>
      <label class="field"><span>Second partner's name</span><input type="text" name="partner2" required maxlength="80" autocomplete="off"></label></div>
      <div class="grid-2"><label class="field"><span>Wedding date & time <span class="hint">Not sure yet? Pick an estimate</span></span><input type="datetime-local" name="wedding_date_local"></label>
      <label class="field"><span>Timezone</span><select name="timezone">${zones.map((z) => `<option ${z === tz ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></label></div>
      <label class="field"><span>Main location</span><input type="text" name="location" maxlength="200" placeholder="City, country or venue"></label>
      <label class="field"><span>Tagline <span class="hint">Optional</span></span><input type="text" name="tagline" maxlength="200" placeholder="Two hearts, one adventure"></label>
      <p class="form-error" role="alert" hidden></p>
    </form>`;
    $('#create input').focus();
    return;
  }
  if (key === 'basics') { body.innerHTML = '<div class="card" id="basics"></div>'; renderBasics($('#basics'), store); return; }
  if (key === 'template') {
    const { templates } = await api('GET', '/api/templates');
    body.innerHTML = `<div id="tpl"></div><p class="small" style="margin-top:12px">Want a closer look? Open a full sample: ${templates.map((t) => `<a href="/templates/${t.id}/demo" target="_blank" rel="noopener">${esc(t.name)}</a>`).join(' · ')}</p>${previewBlock()}`;
    renderTemplatePicker($('#tpl'), store, { plan: summary.plan, templates });
    mountPreview();
    return;
  }
  if (key === 'theme') { body.innerHTML = `<div class="card" id="design"></div>${previewBlock()}`; renderDesign($('#design'), store, { plan: summary.plan }); mountPreview(); return; }
  if (key === 'photos') { body.innerHTML = `<div class="card" id="photos"></div>${previewBlock()}`; renderPhotos($('#photos'), store, { plan: summary.plan }); mountPreview(); return; }
  if (key === 'sections') { body.innerHTML = `<div class="card" id="sections"></div>${previewBlock()}`; renderSectionList($('#sections'), store, { plan: summary.plan }); mountPreview(); return; }
  if (key === 'publish') {
    await store.flush();
    summary = await api('GET', `/api/weddings/${summary.wedding.id}`);
    const w = summary.wedding;
    const slugHost = config.site_base_domain ? `.${config.site_base_domain}` : '';
    body.innerHTML = `<div class="dash-grid">
      <div>${previewBlock()}</div>
      <div class="stack" style="margin-top:28px">
        <div class="card stack">
          <h2 style="font-size:1.3rem;margin:0">Your web address</h2>
          <form class="stack-sm" id="slug-form" novalidate>
            <label class="field"><span>Address</span><div class="row" style="flex-wrap:nowrap;gap:6px">${slugHost ? '' : `<span class="small muted" style="white-space:nowrap">${esc(config.base_url.replace(/^https?:\/\//, ''))}/w/</span>`}<input type="text" name="slug" value="${esc(w.slug)}" maxlength="50" autocapitalize="none" spellcheck="false" aria-describedby="slug-msg">${slugHost ? `<span class="small muted">${esc(slugHost)}</span>` : ''}</div></label>
            <p class="small" id="slug-msg" role="status"></p>
            <button class="btn btn-secondary btn-sm" type="submit" style="justify-self:start">Save address</button>
          </form>
        </div>
        <div class="card"><h2 style="font-size:1.3rem">Before you publish</h2><ul class="checklist">${summary.checklist.items.map((i) => `<li class="${i.ok ? 'ok' : ''}"><span class="tick" aria-hidden="true">${i.ok ? '✓' : ''}</span><span>${esc(i.label)}${i.required && !i.ok ? ' <span class="badge red">Required</span>' : ''}</span></li>`).join('')}</ul></div>
        <div class="card stack-sm">
          <button class="btn btn-primary btn-lg" type="button" id="publish-now">${w.status === 'published' ? 'Publish changes' : 'Publish my website'}</button>
          <a class="btn btn-secondary" href="/app?id=${w.id}">Save as draft</a>
          <a class="btn btn-ghost btn-sm" href="/preview/${w.id}" target="_blank" rel="noopener" id="full-preview">Open full preview in a new tab</a>
        </div>
      </div></div>`;
    mountPreview();
    const input = $('#slug-form [name=slug]');
    let t;
    input.addEventListener('input', () => {
      input.value = input.value.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      clearTimeout(t);
      t = setTimeout(async () => {
        const r = await api('GET', `/api/weddings/slug-check?slug=${encodeURIComponent(input.value)}&wedding=${w.id}`);
        $('#slug-msg').textContent = r.available ? '✓ Available' : r.reason;
        $('#slug-msg').style.color = r.available ? 'var(--sage)' : 'var(--danger)';
      }, 350);
    });
    $('#slug-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await api('PATCH', `/api/weddings/${w.id}/settings`, { slug: input.value });
        summary = { ...summary, ...r };
        toast('Address saved', 'success');
      } catch (err) { setFieldErrors(e.target, err.data?.fields); showError(err); }
    });
    $('#full-preview').addEventListener('click', () => track('preview_opened', { source: 'wizard' }, w.id));
    $('#publish-now').addEventListener('click', async () => {
      const me = (await api('GET', '/api/auth/me')).user;
      if (!me.email_verified) {
        const devLink = sessionStorage.getItem('dev_verification_link');
        showError(new Error('Please confirm your email address first — check your inbox for the link we sent.'));
        if (devLink) toast('Development mode: open the verification link from the dashboard banner.', 'info', 8000);
        return;
      }
      summary = await api('GET', `/api/weddings/${w.id}`);
      publishFlow(summary, { onDone: () => { location.href = `/app?id=${w.id}`; } });
    });
  }
}

async function go(i) {
  if (i < 0 || i >= STEPS.length || !store) return;
  await store.flush();
  step = i;
  history.replaceState(null, '', `/app/wizard?id=${summary.wedding.id}&step=${step + 1}`);
  frame();
}

async function next() {
  const btn = $('#next');
  if (STEPS[step].key === 'basics' && !store) {
    const form = $('#create');
    const data = Object.fromEntries(new FormData(form));
    btn.disabled = true;
    try {
      summary = await api('POST', '/api/weddings', data);
      store = new DraftStore(summary.wedding.id);
      await store.load();
      summary = await api('GET', `/api/weddings/${summary.wedding.id}`);
      if (preferredTemplate && getTemplate(preferredTemplate).id === preferredTemplate) {
        const t = getTemplate(preferredTemplate);
        if (summary.plan.entitlements.template_tiers.includes(t.tier)) { applyTemplate(store, t.id, summary.plan); await store.flush(); }
      }
      step = 1;
      history.replaceState(null, '', `/app/wizard?id=${summary.wedding.id}&step=2`);
      frame();
    } catch (err) {
      btn.disabled = false;
      const e = $('.form-error', form);
      e.textContent = err.message; e.hidden = false;
      if (err instanceof ApiError) setFieldErrors(form, err.data.fields);
    }
    return;
  }
  if (step === STEPS.length - 1) { await store.flush(); location.href = `/app?id=${summary.wedding.id}`; return; }
  if (STEPS[step].key === 'basics') {
    const w = store.state.wedding;
    if (!w.partner1.trim() || !w.partner2.trim()) return toast('Please enter both names to continue.', 'error');
  }
  store.update(() => {}, {});
  store.pendingExtra.setup_step = step + 2;
  store.schedule(true);
  await store.flush();
  summary.wedding.setup_step = Math.max(summary.wedding.setup_step, step + 2);
  step++;
  history.replaceState(null, '', `/app/wizard?id=${summary.wedding.id}&step=${step + 1}`);
  frame();
}

frame();
