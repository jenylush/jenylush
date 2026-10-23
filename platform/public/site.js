// Runtime for published wedding websites (and the editor preview): navigation,
// countdown, reveal animations, gallery viewer and the RSVP form. No dependencies.
(function () {
  'use strict';
  var cleanups = [];
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  function initNav() {
    var nav = $('.site-nav');
    if (!nav) return;
    var btn = $('.nav-toggle', nav);
    if (btn) btn.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(open));
    });
    $$('nav a', nav).forEach(function (a) { a.addEventListener('click', function () { nav.classList.remove('open'); if (btn) btn.setAttribute('aria-expanded', 'false'); }); });
  }

  function initCountdown() {
    $$('[data-countdown]').forEach(function (el) {
      var target = Date.parse(el.getAttribute('data-countdown'));
      if (isNaN(target)) return;
      function tick() {
        var diff = target - Date.now();
        if (diff <= 0) {
          el.classList.add('done');
          el.textContent = el.getAttribute('data-done') || 'Today is the day!';
          return false;
        }
        var parts = { days: Math.floor(diff / 864e5), hours: Math.floor(diff / 36e5) % 24, minutes: Math.floor(diff / 6e4) % 60, seconds: Math.floor(diff / 1e3) % 60 };
        $$('[data-unit]', el).forEach(function (n) { n.textContent = String(parts[n.getAttribute('data-unit')]); });
        return true;
      }
      if (tick()) {
        var hasSeconds = !!$('[data-unit="seconds"]', el);
        var id = setInterval(function () { if (!tick()) clearInterval(id); }, hasSeconds ? 1000 : 30000);
        cleanups.push(function () { clearInterval(id); });
      }
    });
  }

  function initReveal() {
    var els = $$('[data-reveal]');
    if (!els.length) return;
    if (reduceMotion || !('IntersectionObserver' in window) || document.body.classList.contains('anim-static') || document.body.getAttribute('data-mode') === 'demo') {
      els.forEach(function (e) { e.classList.add('is-visible'); });
      return;
    }
    document.documentElement.classList.add('reveal-ready');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    els.forEach(function (e) { io.observe(e); });
    cleanups.push(function () { io.disconnect(); });
  }

  function initGallery() {
    var dlg = $('.lightbox');
    $$('[data-lightbox]').forEach(function (gallery) {
      var items;
      try { items = JSON.parse(gallery.getAttribute('data-lightbox')); } catch (e) { items = []; }
      var index = 0;
      function show(i) {
        if (!dlg || !items.length) return;
        index = (i + items.length) % items.length;
        $('img', dlg).src = items[index].src;
        $('img', dlg).alt = items[index].caption || 'Photo ' + (index + 1);
        $('figcaption', dlg).textContent = items[index].caption || '';
      }
      $$('.gallery-open', gallery).forEach(function (b) {
        b.addEventListener('click', function () {
          if (!dlg || typeof dlg.showModal !== 'function') return;
          show(Number(b.getAttribute('data-index')));
          dlg.showModal();
          dlg._show = show; dlg._index = function () { return index; };
        });
      });
      var carousel = gallery.classList.contains('gallery-carousel') ? gallery : null;
      if (carousel) {
        var controls = gallery.nextElementSibling;
        if (controls && controls.classList.contains('carousel-controls')) {
          $$('[data-carousel]', controls).forEach(function (b) {
            b.addEventListener('click', function () {
              var step = carousel.clientWidth * 0.8 * (b.getAttribute('data-carousel') === 'next' ? 1 : -1);
              carousel.scrollBy({ left: step, behavior: reduceMotion ? 'auto' : 'smooth' });
            });
          });
        }
      }
    });
    if (dlg && !dlg._wired) {
      dlg._wired = true;
      $('.lightbox-close', dlg).addEventListener('click', function () { dlg.close(); });
      $('.lightbox-prev', dlg).addEventListener('click', function () { dlg._show && dlg._show(dlg._index() - 1); });
      $('.lightbox-next', dlg).addEventListener('click', function () { dlg._show && dlg._show(dlg._index() + 1); });
      dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
      dlg.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') dlg._show && dlg._show(dlg._index() + 1);
        if (e.key === 'ArrowLeft') dlg._show && dlg._show(dlg._index() - 1);
      });
    }
  }

  function apiBase() { return document.body.getAttribute('data-api-base') || ''; }

  function post(path, body) {
    return fetch(apiBase() + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { return { ok: res.ok, status: res.status, data: data }; }); });
  }

  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function initRsvp() {
    var form = $('[data-rsvp-form]');
    if (!form) return;
    var preview = form.hasAttribute('data-preview-only');
    var success = $('[data-rsvp-success]');
    var errorBox = $('[data-form-error]', form);
    var params = new URLSearchParams(location.search);
    var code = params.get('invite');

    function setError(msg, fieldName) {
      errorBox.textContent = msg; errorBox.hidden = !msg;
      $$('[aria-invalid]', form).forEach(function (e) { e.removeAttribute('aria-invalid'); });
      if (fieldName && form.elements[fieldName]) {
        var el = form.elements[fieldName].length && !form.elements[fieldName].tagName ? form.elements[fieldName][0] : form.elements[fieldName];
        el.setAttribute('aria-invalid', 'true');
        el.focus();
      }
    }

    function applyInvite(data) {
      var note = $('[data-invite-note]', form);
      note.innerHTML = 'Welcome, <strong>' + escapeHtml(data.guest.first_name) + '</strong>! Your invitation is confirmed.';
      note.hidden = false;
      form.elements.invite_code.value = code;
      if (form.elements.name && !form.elements.name.value) form.elements.name.value = (data.guest.first_name + ' ' + (data.guest.last_name || '')).trim();
      var plus = $('[data-plus-one]', form);
      if (plus) plus.hidden = !data.guest.plus_one_allowed;
      var list = $('[data-event-list]', form);
      if (list && data.events) {
        list.innerHTML = data.events.map(function (e) {
          return '<label class="check"><input type="checkbox" name="events" value="' + escapeHtml(e.id) + '" checked> ' + escapeHtml(e.name) + '</label>';
        }).join('');
        $('[data-events]', form).hidden = !data.events.length;
      }
      var codeInput = form.querySelector('input[name="invite_code"][type="text"]');
      if (codeInput) codeInput.closest('.field').hidden = true;
      if (data.existing) {
        var radio = form.querySelector('input[name="attending"][value="' + data.existing.attending + '"]');
        if (radio) radio.checked = true;
        $$('input[name="events"]', form).forEach(function (cb) { cb.checked = data.existing.events.indexOf(cb.value) >= 0; });
        if (data.existing.plus_one_name && form.elements.plus_one) { form.elements.plus_one.checked = true; form.elements.plus_one_name.value = data.existing.plus_one_name; }
        if (data.existing.dietary && form.elements.dietary) form.elements.dietary.value = data.existing.dietary;
        note.innerHTML += ' You have already replied — you can update your response below.';
      }
    }

    if (code && !preview) {
      post('/rsvp/lookup', { code: code }).then(function (r) { if (r.ok) applyInvite(r.data); });
    }

    function toggleEvents() {
      var attending = form.querySelector('input[name="attending"]:checked');
      var no = attending && attending.value === 'no';
      var ev = $('[data-events]', form);
      if (ev && $$('input', ev).length) ev.hidden = no;
    }
    $$('input[name="attending"]', form).forEach(function (r) { r.addEventListener('change', toggleEvents); });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (preview) { setError('This is a preview — RSVPs are collected once your website is published.'); return; }
      var f = form.elements;
      var attending = form.querySelector('input[name="attending"]:checked');
      if (!f.name.value.trim()) return setError('Please enter your name.', 'name');
      if (!attending) return setError('Please let us know if you can attend.', 'attending');
      if (f.email.required && !f.email.value.trim()) return setError('Please enter your email address.', 'email');
      var answers = {};
      $$('[name^="q_"]', form).forEach(function (el) {
        var id = el.name.slice(2);
        answers[id] = el.type === 'checkbox' ? (el.checked ? 'yes' : '') : el.value;
      });
      var body = {
        name: f.name.value, email: f.email.value, attending: attending.value,
        invite_code: f.invite_code ? f.invite_code.value : '',
        events: $$('input[name="events"]:checked', form).map(function (c) { return c.value; }),
        plus_one: f.plus_one ? f.plus_one.checked : false, plus_one_name: f.plus_one_name ? f.plus_one_name.value : '',
        dietary: f.dietary ? f.dietary.value : '', accessibility: f.accessibility ? f.accessibility.value : '',
        updates_opt_in: f.updates_opt_in ? f.updates_opt_in.checked : false, answers: answers, website: f.website ? f.website.value : ''
      };
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = 'Sending…';
      setError('');
      post('/rsvp', body).then(function (r) {
        btn.disabled = false; btn.textContent = 'Send RSVP';
        if (!r.ok) {
          var fields = r.data.fields || {};
          var first = Object.keys(fields)[0];
          return setError(r.data.error || 'Something went wrong. Please try again.', first);
        }
        form.hidden = true;
        success.hidden = false;
        success.focus();
      }).catch(function () {
        btn.disabled = false; btn.textContent = 'Send RSVP';
        setError('We could not send your RSVP. Please check your connection and try again.');
      });
    });
    var again = $('[data-rsvp-again]');
    if (again) again.addEventListener('click', function () { success.hidden = true; form.hidden = false; form.elements.name.focus(); });
  }

  function initEditorBridge() {
    if (document.body.getAttribute('data-mode') !== 'editor') return;
    $$('.section[data-section-id]').forEach(function (s) {
      s.addEventListener('click', function (e) {
        if (e.target.closest('a, button, input, select, textarea, label, summary')) { if (e.target.closest('a')) e.preventDefault(); return; }
        window.parent.postMessage({ type: 'select-section', id: s.getAttribute('data-section-id') }, location.origin);
      });
    });
    // Links inside the preview must not navigate the editor frame away.
    $$('a[href]').forEach(function (a) {
      if (a.getAttribute('href').charAt(0) !== '#') a.addEventListener('click', function (e) { e.preventDefault(); });
    });
  }

  function init() {
    cleanups.forEach(function (fn) { fn(); });
    cleanups = [];
    initNav(); initCountdown(); initReveal(); initGallery(); initRsvp(); initEditorBridge();
  }

  window.__siteInit = init;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
