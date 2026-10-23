import { api, $, publicChrome, publicFooter, showError } from '../api.js';
import { templateCard, planCards } from '../components.js';

const { config, me } = await publicChrome();
$('#footer').innerHTML = publicFooter(config.platform_name, config.support_email);

try {
  const { templates } = await api('GET', '/api/templates');
  $('#template-grid').innerHTML = templates.slice(0, 3).map((t) => templateCard(t, {
    actions: `<a class="btn btn-primary btn-sm" href="${me ? `/app/wizard?template=${t.id}` : `/signup?template=${t.id}`}">Use this template</a><a class="btn btn-ghost btn-sm" href="/templates/${t.id}/demo" target="_blank" rel="noopener">Preview<span class="sr-only"> ${t.name} (opens in a new tab)</span></a>`
  })).join('');
} catch (err) {
  $('#template-grid').innerHTML = '<p class="muted center">Templates could not be loaded right now.</p>';
}

try {
  const { plans, payments_enabled } = await api('GET', '/api/plans');
  $('#plans').innerHTML = planCards(plans, { paymentsEnabled: payments_enabled, signedIn: false });
} catch (err) {
  showError(err);
}
