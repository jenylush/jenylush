'use strict';
/* Ezinne & Ebenezer · Sealed with love
   Loaded in <head> (not deferred) so the page knows about JS and about a
   returning guest before first paint; everything else waits for the DOM. */
(function () {
  var root = document.documentElement;
  root.classList.add('js');
  var opened = false;
  try { opened = sessionStorage.getItem('je-opened') === '1'; } catch (e) {}
  root.classList.add(opened ? 'intro-skip' : 'is-locked');

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var TARGET = Date.parse('2026-11-13T10:00:00+01:00');

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function later(fn, ms) { return setTimeout(fn, reduce ? 0 : ms); }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  document.addEventListener('DOMContentLoaded', function () {
    setupDrawings();
    setupReveals();
    setupIntro();
    setupHeaderAndScroll();
    setupMenu();
    setupCountdown();
    setupAccordion();
    setupLightbox();
    setupCopy();
    setupGame();
  });

  /* ---------- SVG line drawing: normalise every stroke to length 1 ---------- */
  function setupDrawings() {
    $$('[data-draw] path, [data-draw] polygon, [data-draw] circle, [data-draw] line').forEach(function (el, i) {
      el.setAttribute('pathLength', '1');
    });
  }

  /* ---------- Scroll reveals ---------- */
  function setupReveals() {
    // Stagger groups
    $$('#gallery-grid .shot').forEach(function (el, i) { el.style.setProperty('--d', (i % 4) * 120 + Math.floor(i / 4) * 60 + 'ms'); });
    $$('.info-row').forEach(function (el, i) { el.style.setProperty('--d', i * 90 + 'ms'); });
    $$('.gift').forEach(function (el) { el.setAttribute('data-release', ''); });

    var targets = $$('[data-reveal], [data-draw], [data-clip]');
    if (!('IntersectionObserver' in window) || reduce) {
      targets.forEach(function (el) { show(el); });
      return;
    }
    // A fully clipped element never counts as visible, so clip-wipes are
    // triggered by watching their parent instead.
    var watched = new Map();
    targets.forEach(function (el) {
      var key = el.hasAttribute('data-clip') ? el.parentElement : el;
      if (!watched.has(key)) watched.set(key, []);
      watched.get(key).push(el);
    });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        io.unobserve(entry.target);
        watched.get(entry.target).forEach(show);
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -6% 0px' });
    watched.forEach(function (_, key) { io.observe(key); });
  }

  function show(el) {
    el.classList.add('is-in');
    $$('[data-count]', el).concat(el.hasAttribute('data-count') ? [el] : []).forEach(countUp);
    if (el.hasAttribute('data-release')) {
      // Hand the element back to its own hover transitions once it has arrived.
      var d = parseInt(getComputedStyle(el).getPropertyValue('--d'), 10) || 0;
      setTimeout(function () { el.removeAttribute('data-reveal'); el.classList.remove('is-in'); }, 1300 + d);
    }
  }

  function countUp(el) {
    var end = parseInt(el.getAttribute('data-count'), 10);
    if (reduce || !end) return;
    var start = performance.now(), dur = 1400;
    (function tick(now) {
      var t = Math.min(1, (now - start) / dur);
      el.textContent = pad(Math.max(1, Math.round(easeOut(t) * end)));
      if (t < 1) requestAnimationFrame(tick);
    })(start);
  }

  /* ---------- Intro: the sealed envelope ---------- */
  function setupIntro() {
    var intro = $('#intro'), env = $('#envelope'), sparks = $('.sparks', intro), hero = $('.hero');
    var timers = [];

    // Gold, sage and burgundy flecks for the moment the flap lifts
    for (var i = 0; i < 22; i++) {
      var s = document.createElement('i');
      var a = (Math.PI * 2 * i) / 22 + Math.random() * 0.3;
      var r = 110 + Math.random() * 160;
      s.style.setProperty('--x', Math.cos(a) * r + 'px');
      s.style.setProperty('--y', Math.sin(a) * r * 0.7 - 60 + 'px');
      s.style.setProperty('--sd', Math.round(Math.random() * 220) + 'ms');
      sparks.appendChild(s);
    }

    function startHero() { requestAnimationFrame(function () { hero.classList.add('is-live'); }); }

    if (opened) { setTimeout(startHero, 60); }

    function open() {
      if (intro.classList.contains('is-opening')) return;
      intro.classList.add('is-opening');
      timers.push(later(function () { intro.classList.add('is-flap'); }, 350));
      timers.push(later(function () { intro.classList.add('is-letter'); }, 1000));
      timers.push(later(function () { intro.classList.add('is-zoom'); }, 2000));
      timers.push(later(function () {
        intro.classList.add('is-gone');
        root.classList.remove('is-locked');
        window.scrollTo(0, 0);
        startHero();
        try { sessionStorage.setItem('je-opened', '1'); } catch (e) {}
        var title = $('#hero-title');
        if (title) try { title.focus({ preventScroll: true }); } catch (e) {}
      }, 2550));
      timers.push(later(function () {
        root.classList.add('intro-skip');
        intro.className = 'intro';
      }, 3500));
    }
    env.addEventListener('click', open);

    $('#replay').addEventListener('click', function () {
      timers.forEach(clearTimeout); timers = [];
      try { sessionStorage.removeItem('je-opened'); } catch (e) {}
      hero.classList.remove('is-live');
      intro.className = 'intro';
      // restart the CSS entrance animations
      $$('.intro-head > *, .envelope, .intro-hint', intro).forEach(function (el) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; });
      root.classList.remove('intro-skip');
      root.classList.add('is-locked');
      window.scrollTo(0, 0);
      try { env.focus({ preventScroll: true }); } catch (e) {}
    });
  }

  /* ---------- Header, progress bar, parallax, active link ---------- */
  function setupHeaderAndScroll() {
    var header = $('#header'), bar = $('#progress'), hero = $('.hero');
    var links = $$('.nav-link');
    var sections = links.map(function (a) { return $(a.getAttribute('href')); });
    var par = $$('[data-parallax]'), inner = $$('[data-parallax-inner]');
    var lastY = window.scrollY, ticking = false;

    function update() {
      ticking = false;
      var y = window.scrollY, vh = window.innerHeight;
      var max = document.documentElement.scrollHeight - vh;
      bar.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, y / max) : 0) + ')';

      var heroH = hero.offsetHeight;
      header.classList.toggle('is-solid', y > heroH - 100);
      var menuOpen = root.classList.contains('menu-open');
      header.classList.toggle('is-hidden', !menuOpen && y > heroH && y > lastY + 4);
      if (y < lastY - 4 || y < heroH) header.classList.remove('is-hidden');
      lastY = y;

      var current = -1;
      sections.forEach(function (sec, i) { if (sec && sec.getBoundingClientRect().top < vh * 0.4) current = i; });
      links.forEach(function (a, i) { a.classList.toggle('is-active', i === current); });

      if (reduce) return;
      par.forEach(function (el) {
        var r = el.parentElement.getBoundingClientRect();
        if (r.bottom < -200 || r.top > vh + 200) return;
        var f = parseFloat(el.getAttribute('data-parallax'));
        var off = -((r.top + r.height / 2) - vh / 2) * f;
        el.style.translate = '0 ' + off.toFixed(1) + 'px';
      });
      inner.forEach(function (el) {
        var frame = el.parentElement.getBoundingClientRect();
        if (frame.bottom < 0 || frame.top > vh) return;
        var p = ((frame.top + frame.height / 2) - vh / 2) / vh; // -0.5 .. 0.5ish
        var travel = el.offsetHeight - frame.height;
        el.style.translate = '0 ' + (-travel / 2 + p * travel * 0.9).toFixed(1) + 'px';
      });
    }
    function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
  }

  /* ---------- Phone menu ---------- */
  function setupMenu() {
    var btn = $('#menu-btn'), menu = $('#menu');
    function set(open) {
      root.classList.toggle('menu-open', open);
      root.classList.toggle('is-locked', open);
      btn.setAttribute('aria-expanded', String(open));
      btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }
    btn.addEventListener('click', function () { set(!root.classList.contains('menu-open')); });
    $$('a', menu).forEach(function (a) { a.addEventListener('click', function () { set(false); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root.classList.contains('menu-open')) { set(false); btn.focus(); } });
  }

  /* ---------- Countdown with rolling digits ---------- */
  function setupCountdown() {
    var units = {};
    $$('[data-cd]').forEach(function (el) { units[el.getAttribute('data-cd')] = { el: el, value: '' }; });

    function setValue(u, str) {
      if (u.value === str) return;
      var digits = $$('.cd-digit', u.el);
      if (digits.length !== str.length) {
        u.el.innerHTML = '';
        digits = str.split('').map(function () {
          var d = document.createElement('span'); d.className = 'cd-digit'; u.el.appendChild(d); return d;
        });
        u.value = '';
      }
      str.split('').forEach(function (ch, i) {
        var d = digits[i];
        if (u.value[i] === ch) return;
        var animate = u.value !== '' && !reduce;
        var old = d.firstElementChild;
        var span = document.createElement('span');
        span.textContent = ch;
        if (animate) {
          span.className = 'in';
          if (old) { old.className = 'out'; setTimeout(function () { old.remove(); }, 600); }
        } else if (old) old.remove();
        d.appendChild(span);
      });
      u.value = str;
      u.el.setAttribute('aria-label', str);
    }
    function tick() {
      var ms = Math.max(0, TARGET - Date.now());
      setValue(units.days, pad(Math.floor(ms / 86400000)));
      setValue(units.hours, pad(Math.floor(ms / 3600000) % 24));
      setValue(units.minutes, pad(Math.floor(ms / 60000) % 60));
      setValue(units.seconds, pad(Math.floor(ms / 1000) % 60));
    }
    tick();
    setInterval(tick, 1000);
  }

  /* ---------- Story accordion ---------- */
  function setupAccordion() {
    $$('.acc').forEach(function (acc) {
      var btn = $('.acc-btn', acc);
      btn.addEventListener('click', function () {
        var open = !acc.classList.contains('is-open');
        acc.classList.toggle('is-open', open);
        btn.setAttribute('aria-expanded', String(open));
        if (open && !reduce) {
          setTimeout(function () {
            var r = btn.getBoundingClientRect();
            if (r.top < 70 || r.top > window.innerHeight * 0.6) window.scrollBy({ top: r.top - 100, behavior: 'smooth' });
          }, 120);
        }
      });
    });
  }

  /* ---------- Gallery lightbox ---------- */
  function setupLightbox() {
    var box = $('#lightbox'), img = $('img', box), cap = $('figcaption', box);
    var shots = $$('#gallery-grid .shot');
    var index = 0, lastFocus = null, touchX = null;

    function load(i) {
      index = (i + shots.length) % shots.length;
      var src = $('img', shots[index]);
      img.classList.remove('is-ready');
      var swap = function () {
        img.src = src.currentSrc || src.src;
        img.alt = src.alt;
        cap.textContent = $('figcaption', shots[index]).textContent;
        var ready = function () { requestAnimationFrame(function () { img.classList.add('is-ready'); }); };
        if (img.complete && img.naturalWidth) ready(); else img.onload = ready;
      };
      if (box.classList.contains('is-open') && !reduce) setTimeout(swap, 250); else swap();
    }
    function open(i) {
      lastFocus = document.activeElement;
      box.hidden = false;
      void box.offsetWidth;
      box.classList.add('is-open');
      root.classList.add('is-locked');
      load(i);
      $('.lb-close', box).focus();
    }
    function close() {
      box.classList.remove('is-open');
      root.classList.remove('is-locked');
      setTimeout(function () { if (!box.classList.contains('is-open')) box.hidden = true; }, reduce ? 0 : 500);
      if (lastFocus) lastFocus.focus();
    }
    shots.forEach(function (s, i) {
      s.addEventListener('click', function () { open(i); });
      s.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(i); } });
    });
    $('.lb-close', box).addEventListener('click', close);
    $('.lb-prev', box).addEventListener('click', function () { load(index - 1); });
    $('.lb-next', box).addEventListener('click', function () { load(index + 1); });
    box.addEventListener('click', function (e) { if (e.target === box) close(); });
    document.addEventListener('keydown', function (e) {
      if (box.hidden) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') load(index - 1);
      else if (e.key === 'ArrowRight') load(index + 1);
      else if (e.key === 'Tab') {
        var f = $$('button', box), first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    box.addEventListener('touchstart', function (e) { touchX = e.touches[0].clientX; }, { passive: true });
    box.addEventListener('touchend', function (e) {
      if (touchX == null) return;
      var dx = e.changedTouches[0].clientX - touchX; touchX = null;
      if (Math.abs(dx) > 50) load(index + (dx < 0 ? 1 : -1));
    });
  }

  /* ---------- Copy bank details ---------- */
  function setupCopy() {
    $$('[data-copy]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var src = $('[data-copy-src="' + btn.getAttribute('data-copy') + '"]');
        var text = src ? src.textContent.trim() : '';
        var done = function () {
          btn.classList.add('is-copied');
          clearTimeout(btn._t);
          btn._t = setTimeout(function () { btn.classList.remove('is-copied'); }, 2200);
        };
        if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
        else fallback();
        function fallback() {
          var ta = document.createElement('textarea');
          ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); done(); } catch (e) {}
          ta.remove();
        }
      });
    });
  }

  /* ---------- Game: who knows us better? ---------- */
  function setupGame() {
    var ANSWERS = ['eb', 'ez', 'ez', 'ez', 'eb', 'eb', 'eb', 'eb', 'ez', 'eb'];
    var NAMES = { ez: 'Ezinne', eb: 'Ebenezer' };
    var QS = [
      ['Love', 'Who fell in love first?'],
      ['Love', 'Who is more likely to say “I love you” first every morning?'],
      ['Love', 'Who is more likely to write a long love note for no reason?'],
      ['Affection', 'Who is more likely to ask for a hug after a long day?'],
      ['Affection', 'Who is more likely to plan a surprise date?'],
      ['Care', 'Who is more likely to cook when the other is tired?'],
      ['Care', 'Who is more likely to remind the other to eat, drink water and rest?'],
      ['Finance', 'Who is more likely to stick to the budget?'],
      ['Finance', 'Who is more likely to make a spontaneous purchase?'],
      ['Finance', 'Who is more likely to send money for “something small” without being asked?']
    ];
    var COLORS = ['#C9A24C', '#6E1F2F', '#9AA886', '#DCC28A'];
    var picks = {};
    var list = $('#questions'), result = $('#result');

    function el(tag, cls, text) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }
    function verdict(score, total) {
      if (score === total) return 'Perfect score! You know us inside out.';
      if (score >= 8) return 'So close to perfect. You clearly know us well!';
      if (score >= 5) return 'Not bad at all. You’ve been paying attention.';
      return 'Looks like you’ll have to get to know us better at the wedding!';
    }
    function score() { return Object.keys(picks).filter(function (k) { return picks[k] === ANSWERS[k]; }).length; }

    function row(i) {
      var r = el('div', 'q'); r.setAttribute('data-row', i);
      r.appendChild(el('span', 'num', pad(i + 1)));
      var t = el('div'); t.appendChild(el('span', 'cat', QS[i][0])); t.appendChild(el('span', 'text', QS[i][1])); r.appendChild(t);
      var p = el('div', 'picks');
      ['ez', 'eb'].forEach(function (who) {
        var b = el('button', 'pick', NAMES[who]);
        b.type = 'button';
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', function () { choose(i, who, r); });
        p.appendChild(b);
      });
      r.appendChild(p);
      return r;
    }
    function choose(i, who, r) {
      if (picks[i]) return;
      picks[i] = who;
      var ans = ANSWERS[i], right = who === ans;
      $$('.pick', r).forEach(function (b, j) {
        var me = j === 0 ? 'ez' : 'eb';
        b.setAttribute('aria-disabled', 'true');
        b.setAttribute('aria-pressed', String(me === who));
        if (me === who) b.classList.add(right ? 'is-right' : 'is-wrong');
        else if (me === ans) b.classList.add('is-answer');
        else b.classList.add('is-dim');
      });
      var fb = el('div', 'fb ' + (right ? 'is-right' : 'is-wrong'));
      if (right && !reduce) {
        var c = el('span', 'confetti'); c.setAttribute('aria-hidden', 'true');
        for (var k = 0; k < 14; k++) {
          var bit = el('i');
          var a = Math.random() * Math.PI * 2, d = 30 + Math.random() * 46;
          bit.style.setProperty('--c', COLORS[k % COLORS.length]);
          bit.style.setProperty('--x', Math.cos(a) * d + 'px');
          bit.style.setProperty('--y', Math.sin(a) * d - 24 + 'px');
          if (k % 2) bit.style.borderRadius = '50%';
          c.appendChild(bit);
        }
        fb.appendChild(c);
      }
      var emoji = el('span', 'emoji', right ? '🎉' : '😞'); emoji.setAttribute('aria-hidden', 'true');
      fb.appendChild(emoji);
      var msg = el('span', 'msg', right ? 'Yes! You got it.' : 'Not quite, it was ' + NAMES[ans] + '.');
      msg.setAttribute('role', 'status');
      fb.appendChild(msg);
      r.appendChild(fb);
      update(true);
    }
    function update(animate) {
      var n = Object.keys(picks).length, s = score();
      $('#g-answered').textContent = n;
      $('#g-total').textContent = QS.length;
      $('#g-score').textContent = s;
      $('#g-meter').style.transform = 'scaleX(' + n / QS.length + ')';
      if (n === QS.length) {
        result.innerHTML = '';
        var box = el('div', 'result');
        box.appendChild(el('div', 'label', 'Your score'));
        var sc = el('div', 'score'); var num = el('span', null, '0'); sc.appendChild(num); sc.appendChild(el('small', null, ' / ' + QS.length));
        box.appendChild(sc);
        box.appendChild(el('div', 'verdict', verdict(s, QS.length)));
        result.appendChild(box);
        result.hidden = false;
        if (animate && !reduce) {
          var start = performance.now();
          (function t(now) { var p = Math.min(1, (now - start) / 1000); num.textContent = Math.round(easeOut(p) * s); if (p < 1) requestAnimationFrame(t); })(start);
          setTimeout(function () { result.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 500);
        } else num.textContent = s;
      } else {
        result.hidden = true;
      }
    }
    function build() {
      list.innerHTML = '';
      QS.forEach(function (_, i) { list.appendChild(row(i)); });
      update(false);
    }
    $('#g-reset').addEventListener('click', function () { picks = {}; build(); });
    build();
  }
})();
