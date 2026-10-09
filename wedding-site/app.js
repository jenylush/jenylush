'use strict';
(function () {
var ANSWERS = ['eb', 'ez', 'ez', 'ez', 'eb', 'eb', 'eb', 'eb', 'ez', 'eb'];
var NAMES = { ez: 'Ezinne', eb: 'Ebenezer' };
function rowModel(i, pick) {
  var ans = ANSWERS[i], done = !!pick, right = pick === ans;
  function btn(who) {
    var picked = pick === who, isAns = ans === who;
    if (!done) return { bg: 'transparent', fg: '#2B2420', border: '#D5C3A5', cursor: 'pointer', opacity: '1' };
    if (picked && right) return { bg: '#3F6B4A', fg: '#FFFFFF', border: '#3F6B4A', cursor: 'default', opacity: '1' };
    if (picked) return { bg: '#6E1F2F', fg: '#FFFFFF', border: '#6E1F2F', cursor: 'default', opacity: '1' };
    if (isAns) return { bg: '#E6EFE2', fg: '#2E5237', border: '#3F6B4A', cursor: 'default', opacity: '1' };
    return { bg: 'transparent', fg: '#2B2420', border: '#D5C3A5', cursor: 'default', opacity: '0.5' };
  }
  var ez = btn('ez'), eb = btn('eb');
  return {
    ezOn: pick === 'ez', ebOn: pick === 'eb', locked: done ? 'true' : 'false',
    ezBg: ez.bg, ezFg: ez.fg, ezBorder: ez.border, ezCursor: ez.cursor, ezOpacity: ez.opacity,
    ebBg: eb.bg, ebFg: eb.fg, ebBorder: eb.border, ebCursor: eb.cursor, ebOpacity: eb.opacity,
    fbDisplay: done ? 'flex' : 'none',
    fbAnim: done ? 'je-rise 400ms ease-out both' : 'none',
    emoji: done ? (right ? '🎉' : '😞') : '',
    emojiAnim: done ? (right ? 'je-pop 600ms cubic-bezier(.2,1.6,.4,1) both' : 'je-shake 600ms ease-in-out both') : 'none',
    feedback: done ? (right ? 'Yes! You got it.' : 'Not quite, it was ' + NAMES[ans] + '.') : '',
    fbColor: right ? '#2E5237' : '#6E1F2F',
    confettiDisplay: done && right ? 'block' : 'none',
    confettiAnim: done && right ? 'je-burst 900ms ease-out both' : 'none'
  };
}
function verdict(score, total) {
  if (score === total) return 'Perfect score! You know us inside out.';
  if (score >= 8) return 'So close to perfect. You clearly know us well!';
  if (score >= 5) return 'Not bad at all. You’ve been paying attention.';
  return 'Looks like you’ll have to get to know us better at the wedding!';
}

  var TARGET = Date.parse('2026-11-13T10:00:00+01:00');
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
  var state = { opening: false, opened: false, herOpen: true, hisOpen: false, picks: {}, copied: null };
  var copyTimer;
  try { if (sessionStorage.getItem('je-opened') === '1') state.opened = true; } catch (e) {}

  function score() { return Object.keys(state.picks).filter(function (k) { return state.picks[k] === ANSWERS[k]; }).length; }
  function copy(key, text) {
    function done() { state.copied = key; render(); clearTimeout(copyTimer); copyTimer = setTimeout(function () { state.copied = null; render(); }, 2000); }
    function fallback() {
      var t = document.createElement('textarea');
      t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch (e) {}
      t.remove(); done();
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function vals() {
    var ms = Math.max(0, TARGET - Date.now());
    var picks = Object.keys(state.picks).map(function (k) { return state.picks[k]; });
    var lift = window.matchMedia('(max-width: 900px)').matches ? 96 : 170;
    return {
      showEnvelope: !state.opened, showSite: state.opened,
      flapTransform: state.opening ? 'rotateX(180deg)' : 'rotateX(0deg)',
      flapZ: state.opening ? '0' : '3',
      letterTransform: state.opening ? 'translateY(-' + lift + 'px)' : 'translateY(0px)',
      sealOpacity: state.opening ? '0' : '1',
      sealTransform: state.opening ? 'scale(0.8)' : 'scale(1)',
      headOpacity: state.opening ? '0' : '1',
      headTransform: state.opening ? 'translateY(-16px)' : 'translateY(0px)',
      herOpen: state.herOpen, hisOpen: state.hisOpen,
      herBar: state.herOpen ? 'scaleY(0)' : 'scaleY(1)',
      hisBar: state.hisOpen ? 'scaleY(0)' : 'scaleY(1)',
      days: pad(Math.floor(ms / 86400000)), hours: pad(Math.floor(ms / 3600000) % 24),
      minutes: pad(Math.floor(ms / 60000) % 60), seconds: pad(Math.floor(ms / 1000) % 60),
      total: QS.length, answered: picks.length,
      progress: Math.round(picks.length / QS.length * 100) + '%',
      done: picks.length === QS.length,
      score: score(), verdict: verdict(score(), QS.length),
      accessLabel: state.copied === 'access' ? 'Copied ✓' : 'Copy account number',
      opayLabel: state.copied === 'opay' ? 'Copied ✓' : 'Copy account number'
    };
  }

  var actions = {
    openEnvelope: function () {
      if (state.opening) return;
      state.opening = true; render();
      setTimeout(function () {
        state.opened = true; render(); window.scrollTo(0, 0);
        try { sessionStorage.setItem('je-opened', '1'); } catch (e) {}
      }, 2000);
    },
    replay: function () {
      state.opened = false; state.opening = false; render(); window.scrollTo(0, 0);
      try { sessionStorage.removeItem('je-opened'); } catch (e) {}
    },
    toggleHer: function () { state.herOpen = !state.herOpen; render(); },
    toggleHis: function () { state.hisOpen = !state.hisOpen; render(); },
    reset: function () { state.picks = {}; renderLists(); render(); },
    copyAccess: function () { copy('access', '0037147690'); },
    copyOpay: function () { copy('opay', '9034548154'); }
  };

  function rowHtml(tpl, i) {
    var q = QS[i];
    var v = Object.assign({ idx: i, num: pad(i + 1), category: q[0], text: q[1] }, rowModel(i, state.picks[i]));
    return tpl.replace(/\{\{q\.(\w+)\}\}/g, function (_, k) { return esc(v[k]); })
              .replace(/^\s*<div/, '<div data-row="' + i + '"');
  }
  function renderLists(only) {
    document.querySelectorAll('[data-list="questions"]').forEach(function (box) {
      var tpl = box.querySelector('template').innerHTML;
      if (only != null) {
        var old = box.querySelector('[data-row="' + only + '"]');
        if (old) { old.insertAdjacentHTML('afterend', rowHtml(tpl, only)); old.remove(); return; }
      }
      box.querySelectorAll('[data-row]').forEach(function (r) { r.remove(); });
      box.insertAdjacentHTML('beforeend', QS.map(function (_, i) { return rowHtml(tpl, i); }).join(''));
    });
  }

  function render() {
    var v = vals();
    document.querySelectorAll('[data-if]').forEach(function (el) { el.hidden = !v[el.getAttribute('data-if')]; });
    document.querySelectorAll('[data-text]').forEach(function (el) {
      var t = String(v[el.getAttribute('data-text')]);
      if (el.textContent !== t) el.textContent = t;
    });
    document.querySelectorAll('[data-aria]').forEach(function (el) { el.setAttribute('aria-expanded', String(!!v[el.getAttribute('data-aria')])); });
    document.querySelectorAll('[data-bind-style]').forEach(function (el) {
      el.getAttribute('data-bind-style').split(';').forEach(function (pair) {
        var i = pair.indexOf(':'); el.style.setProperty(pair.slice(0, i), v[pair.slice(i + 1)]);
      });
    });
  }

  document.addEventListener('click', function (e) {
    var pick = e.target.closest('[data-pick]');
    if (pick) {
      var i = pick.getAttribute('data-i');
      if (state.picks[i]) return;
      state.picks[i] = pick.getAttribute('data-pick'); renderLists(Number(i)); render(); return;
    }
    var on = e.target.closest('[data-on]');
    var name = on && on.getAttribute('data-on');
    if (name && Object.prototype.hasOwnProperty.call(actions, name)) actions[name]();
  });

  renderLists();
  render();
  setInterval(render, 1000);
})();
