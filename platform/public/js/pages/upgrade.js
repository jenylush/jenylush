import { api, $, $$, esc, appChrome, toast, showError, param, track } from '../api.js';
import { planCards } from '../components.js';

const { me } = await appChrome();
track('paid_upgrade_viewed', { feature: param('feature') || 'plans_page' });

async function render() {
  const sub = await api('GET', '/api/account/subscription');
  const feature = param('feature');
  $('#main').innerHTML = `<div class="section-intro" style="margin-top:12px"><p class="eyebrow">Plans</p><h1>Make it entirely yours</h1>
      <p>You're on <strong>${esc(sub.current.name)}</strong>. Everything you need to publish and collect RSVPs is free, forever.${sub.payments_enabled ? '' : ' Premium is launching soon — join the waitlist and we will email you when it is ready.'}</p>
      ${feature && sub.feature_labels[feature] ? `<p class="notice info">You were looking at: <strong>${esc(sub.feature_labels[feature])}</strong></p>` : ''}</div>
    <div class="plans">${planCards(sub.plans, { current: sub.current.id, waitlisted: sub.waitlisted, paymentsEnabled: sub.payments_enabled, signedIn: true })}</div>
    <p class="center small muted" style="margin-top:28px">Moving between plans never deletes your content. Questions? <a href="/#faq">Read the FAQ</a>.</p>`;
  $$('[data-waitlist]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('POST', '/api/account/upgrade-interest', { plan_id: b.dataset.waitlist, feature }); toast("You're on the list! We'll email you when Premium launches.", 'success'); render(); } catch (err) { showError(err); }
  }));
  $$('[data-checkout]').forEach((b) => b.addEventListener('click', async () => {
    try { await api('POST', '/api/account/checkout', { plan_id: b.dataset.checkout }); } catch (err) { showError(err); }
  }));
}
await render();
