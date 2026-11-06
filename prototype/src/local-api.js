// Replaces the platform's browser API module for the test version: the shared
// editor panels import this instead, and their calls are answered in the browser.
import { ApiError, toast, modal, esc } from '../../platform/public/js/api.js';
import { handle, uploadMedia } from './backend.js';

export { $, $$, esc, toast, modal, confirmDialog, setFieldErrors, formatDate, relativeTime, ApiError, copyText } from '../../platform/public/js/api.js';

export async function api(method, url, body) { return handle(method, url, body); }
export function upload(url, fd, onProgress) { return uploadMedia(url, fd, onProgress); }
export function track() {}

export function upgradePrompt(d = {}) {
  modal({
    title: d.feature_label ? `${d.feature_label} is a Premium feature` : 'Upgrade to Premium',
    body: `<div class="stack"><p>${esc(d.error || 'This feature is part of Premium.')}</p><p class="muted small">Nothing you have made is changed or deleted. In this test version you can switch Premium on for free from the Plans page to try these features.</p></div>`,
    actions: [{ label: 'Not now' }, { label: 'Go to Plans', className: 'btn-primary', onClick: () => window.__go?.('plans') }]
  });
}

export function showError(err, fallback = 'Something went wrong. Please try again.') {
  if (err?.name === 'AbortError') return;
  if (err instanceof ApiError && err.data?.code === 'plan_limit') return upgradePrompt(err.data);
  toast(err?.message || fallback, 'error', 6000);
}
