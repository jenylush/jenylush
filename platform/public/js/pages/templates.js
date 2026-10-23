import { api, $, $$, esc, publicChrome, publicFooter } from '../api.js';
import { templateCard } from '../components.js';
import { SECTION_TYPES } from '/shared/sections.js';

const { config, me } = await publicChrome();
$('#footer').innerHTML = publicFooter(config.platform_name, config.support_email);

const { templates } = await api('GET', '/api/templates').catch(() => ({ templates: [] }));
const sectionNames = (ids) => ids.filter((id) => !SECTION_TYPES[id].comingSoon).map((id) => SECTION_TYPES[id].name).join(', ');

function render(filter) {
  const list = templates.filter((t) => filter === 'all' || t.tier === filter);
  $('#template-grid').innerHTML = list.length ? list.map((t) => templateCard(t, {
    actions: `<a class="btn btn-primary btn-sm" href="${me ? `/app/wizard?template=${t.id}` : `/signup?template=${t.id}`}">Use this template</a>
      <a class="btn btn-ghost btn-sm" href="/templates/${t.id}/demo" target="_blank" rel="noopener">Full preview<span class="sr-only"> of ${esc(t.name)} (opens in a new tab)</span></a>
      <details class="small" style="width:100%"><summary class="muted">Supported sections</summary><p class="muted" style="margin:6px 0 0">${esc(sectionNames(t.supportedSections))}</p></details>`
  })).join('') : '<div class="empty"><h3>No templates here yet</h3></div>';
}

$$('[data-filter]').forEach((b) => b.addEventListener('click', () => {
  $$('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  render(b.dataset.filter);
}));
render('all');
