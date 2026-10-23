import { api, $, $$, esc, param, getMe, getConfig, showError, toast, track, currentWedding, confirmDialog } from '../api.js';
import { DraftStore, statusText } from '../draft-store.js';
import { PreviewFrame } from '../preview.js';
import { renderSectionList, renderSectionSettings, renderDesign, renderPhotos } from '../editor-controls.js';
import { publishFlow } from '../publish.js';

const [me, config] = await Promise.all([getMe(), getConfig()]);
let summary;
try { summary = await currentWedding(); } catch (err) { showError(err); throw err; }
if (!summary) throw new Error('no wedding');
if (!summary.permissions.edit) { location.href = `/app?id=${summary.wedding.id}`; throw new Error('read only'); }

const wid = summary.wedding.id;
const plan = summary.plan;
const store = new DraftStore(wid);
await store.load();

const { templates } = await api('GET', '/api/templates');
$('#site-title').textContent = summary.wedding.names;
document.title = `Editing — ${summary.wedding.names}`;
$('#back-link').href = `/app?id=${wid}`;
$('#preview-link').href = `/preview/${wid}`;
$('#preview-link').addEventListener('click', () => track('preview_opened', { source: 'editor' }, wid));

let selected = param('tab') === 'design' ? 'design' : param('tab') === 'photos' ? 'photos' : (store.sectionByType('hero')?.id || 'design');
let settingsView = null;

const preview = new PreviewFrame($('#preview'), { onSelect: (id) => { select(id); setMobile('settings'); } });
const rerender = () => preview.render(store.state, { selected, showBranding: !plan.entitlements.remove_branding, platformName: config.platform_name });
store.onChange(() => rerender());
rerender();

const list = renderSectionList($('#section-list'), store, { plan, getSelected: () => selected, onSelect: (id) => { select(id); preview.scrollTo(id); setMobile('settings'); } });

function select(id) {
  selected = id;
  settingsView?.destroy?.();
  settingsView = null;
  const box = $('#settings');
  $$('[data-pseudo]').forEach((b) => b.classList.toggle('selected', b.dataset.pseudo === id));
  if (id === 'design') {
    box.innerHTML = '<h2>Design</h2><div></div>';
    renderDesign(box.lastElementChild, store, { plan, showTemplates: true, templates });
  } else if (id === 'photos') {
    box.innerHTML = '<h2>Photos</h2><div></div>';
    renderPhotos(box.lastElementChild, store, { plan });
  } else {
    box.innerHTML = '<h2>Section settings</h2><div></div>';
    settingsView = renderSectionSettings(box.lastElementChild, store, id, { plan, extra: rsvpExtra });
    preview.select(id);
  }
  list.redraw();
}

$$('[data-pseudo]').forEach((b) => b.addEventListener('click', () => { select(b.dataset.pseudo); setMobile('settings'); }));

// RSVP options and custom questions live outside the draft (they apply immediately).
async function rsvpExtra(sec, box) {
  if (sec.type !== 'rsvp') return;
  const w = summary.wedding;
  const form = await api('GET', `/api/weddings/${wid}/rsvp-form`);
  box.innerHTML = `<details class="list-item" open><summary>RSVP options</summary><div class="list-body">
      <label class="field"><span>RSVP deadline</span><input type="date" data-s="rsvp_deadline" value="${esc(w.rsvp_deadline || '')}"></label>
      <label class="field"><span>Who can RSVP?</span><select data-s="rsvp_mode"><option value="open" ${w.rsvp_mode === 'open' ? 'selected' : ''}>Anyone with the link</option><option value="invite_only" ${w.rsvp_mode === 'invite_only' ? 'selected' : ''}>Only guests with an invitation code</option></select></label>
      <label class="field"><span>Plus-ones</span><select data-s="rsvp_plus_ones"><option value="none" ${w.rsvp_plus_ones === 'none' ? 'selected' : ''}>No plus-ones</option><option value="invited_only" ${w.rsvp_plus_ones === 'invited_only' ? 'selected' : ''}>Only guests I allow</option><option value="everyone" ${w.rsvp_plus_ones === 'everyone' ? 'selected' : ''}>Everyone may bring a guest</option></select></label>
      <label class="field"><span>Email address</span><select data-s="rsvp_collect_email"><option value="optional" ${w.rsvp_collect_email === 'optional' ? 'selected' : ''}>Optional</option><option value="required" ${w.rsvp_collect_email === 'required' ? 'selected' : ''}>Required</option></select></label>
      <label class="switch"><input type="checkbox" data-s="rsvp_dietary" ${w.rsvp_dietary ? 'checked' : ''}> Ask about dietary requirements</label>
      <label class="switch"><input type="checkbox" data-s="rsvp_accessibility" ${w.rsvp_accessibility ? 'checked' : ''}> Ask about accessibility needs</label>
    </div></details>
    <details class="list-item"><summary>Your own questions <span class="tiny muted">(${form.limit} on your plan)</span></summary><div class="list-body" data-questions></div></details>`;
  $$('[data-s]', box).forEach((el) => el.addEventListener('change', async () => {
    const v = el.type === 'checkbox' ? el.checked : el.value;
    try {
      const r = await api('PATCH', `/api/weddings/${wid}/settings`, { [el.dataset.s]: v });
      summary.wedding = r.wedding;
      const map = { rsvp_deadline: 'deadline', rsvp_mode: 'mode', rsvp_plus_ones: 'plus_ones', rsvp_collect_email: 'collect_email', rsvp_dietary: 'dietary', rsvp_accessibility: 'accessibility' };
      store.state.rsvp[map[el.dataset.s]] = v;
      store.state.rsvp.open = r.wedding.rsvp_open;
      store.emit({ source: 'rsvp' });
      toast('RSVP settings saved', 'success', 2000);
    } catch (err) { showError(err); }
  }));
  let questions = form.questions;
  const qbox = $('[data-questions]', box);
  const drawQ = () => {
    qbox.innerHTML = `${questions.map((q, i) => `<div class="card-flat stack-sm" data-q="${i}">
        <label class="field"><span>Question</span><input type="text" data-qk="label" value="${esc(q.label)}" maxlength="200"></label>
        <div class="grid-2"><label class="field"><span>Answer type</span><select data-qk="type">${[['text', 'Short answer'], ['textarea', 'Long answer'], ['select', 'Choose one'], ['checkbox', 'Yes / no tick box']].map(([v, l]) => `<option value="${v}" ${q.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="switch" style="align-self:end"><input type="checkbox" data-qk="required" ${q.required ? 'checked' : ''}> Required</label></div>
        ${q.type === 'select' ? `<label class="field"><span>Options <span class="hint">comma separated</span></span><input type="text" data-qk="options" value="${esc((q.options || []).join(', '))}"></label>` : ''}
        <button type="button" class="btn btn-ghost btn-sm" data-qdel style="justify-self:start">Remove question</button></div>`).join('')}
      <div class="row"><button type="button" class="btn btn-secondary btn-sm" data-qadd>＋ Add question</button><button type="button" class="btn btn-primary btn-sm" data-qsave>Save questions</button></div>`;
    $$('[data-q]', qbox).forEach((card) => {
      const i = Number(card.dataset.q);
      $$('[data-qk]', card).forEach((el) => el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', () => {
        const k = el.dataset.qk;
        questions[i][k] = k === 'required' ? el.checked : k === 'options' ? el.value.split(',').map((x) => x.trim()).filter(Boolean) : el.value;
        if (k === 'type') drawQ();
      }));
      $('[data-qdel]', card).addEventListener('click', () => { questions.splice(i, 1); drawQ(); });
    });
    $('[data-qadd]', qbox).addEventListener('click', () => { questions.push({ id: crypto.randomUUID().slice(0, 8), label: '', type: 'text', required: false, options: [] }); drawQ(); $$('[data-qk="label"]', qbox).pop()?.focus(); });
    $('[data-qsave]', qbox).addEventListener('click', async () => {
      try {
        const r = await api('PUT', `/api/weddings/${wid}/rsvp-form`, { questions });
        questions = r.questions;
        store.state.rsvp.questions = r.questions;
        store.emit({ source: 'rsvp' });
        drawQ();
        toast('Questions saved', 'success');
      } catch (err) { showError(err); }
    });
  };
  drawQ();
}

// Save status, undo/redo
const statusEl = $('#save-status');
store.onStatus((s, detail) => {
  statusEl.dataset.state = s;
  statusEl.textContent = statusText(s, detail);
  $('#undo').disabled = !store.canUndo();
  $('#redo').disabled = !store.canRedo();
});
store.onChange(() => { $('#undo').disabled = !store.canUndo(); $('#redo').disabled = !store.canRedo(); });
$('#undo').addEventListener('click', () => store.undo());
$('#redo').addEventListener('click', () => store.redo());
document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  const inField = e.target.closest('input, textarea, select, [contenteditable]');
  if (e.key.toLowerCase() === 'z' && !inField) { e.preventDefault(); if (e.shiftKey) store.redo(); else store.undo(); }
  if (e.key.toLowerCase() === 'y' && !inField) { e.preventDefault(); store.redo(); }
  if (e.key.toLowerCase() === 's') { e.preventDefault(); store.flush(); }
});

// Device preview toggle
$$('[data-device]').forEach((b) => b.addEventListener('click', () => {
  $$('[data-device]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  $('#stage').classList.toggle('mobile', b.dataset.device === 'mobile');
}));

// Mobile layout panel switch
function setMobile(panel) {
  if (!matchMedia('(max-width: 900px)').matches) return;
  $('#editor-main').dataset.mobile = panel;
  $$('[data-mobile]').forEach((b) => { if (b.tagName === 'BUTTON') b.setAttribute('aria-selected', String(b.dataset.mobile === panel)); });
}
$$('.mobile-editor-switch [data-mobile]').forEach((b) => b.addEventListener('click', () => setMobile(b.dataset.mobile)));

// Publish state + action
async function refreshSummary() {
  summary = { ...summary, ...(await api('GET', `/api/weddings/${wid}`)) };
  const w = summary.wedding;
  $('#publish-state').textContent = w.status === 'published' ? (w.unpublished_changes ? 'Live · unpublished changes' : 'Live · up to date') : 'Draft · not published';
  $('#publish').textContent = w.status === 'published' && !matchMedia('(max-width: 900px)').matches ? 'Publish changes' : 'Publish';
  $('#publish').hidden = !summary.permissions.publish;
}
await refreshSummary();
store.onStatus((s) => { if (s === 'saved') refreshSummary().catch(() => {}); });

$('#publish').addEventListener('click', async () => {
  await store.flush();
  if (store.status === 'error') return toast('Please fix the save error before publishing.', 'error');
  if (!me.email_verified) {
    if (await confirmDialog('Please confirm your email address before publishing. You can resend the confirmation email from your dashboard.', { title: 'Confirm your email first', confirmLabel: 'Go to dashboard' })) location.href = `/app?id=${wid}`;
    return;
  }
  await refreshSummary();
  publishFlow(summary, { onDone: () => refreshSummary() });
});

select(selected);
