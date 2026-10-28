/* Agnostic Solutions — shared account + leaderboard widget.
   Drop-in client for the canonical account service (netlify/functions: auth,
   leaderboard, sync, recovery). Self-contained: injects its own styling, a
   floating button and a modal with a Leaderboard tab and an Account tab
   (register / log in / change PIN / recovery email / forgot PIN).

   Identity is a username + 6-digit PIN; an email is optional and only used to
   recover a forgotten PIN. The signed token is kept in localStorage so you stay
   logged in across visits, and because accounts live on the server you are the
   same player on every device.

   Usage (after the game knows its best score):
     Account.init({ game: 'devil-run', title: 'Devil Run' });
     Account.reportBest(score);   // call on game over / whenever a best changes

   Theme via CSS custom properties on :root (all optional):
     --acc        accent colour (buttons, highlights)
     --acc-ink    text colour on the accent
     --acc-panel  modal background
     --acc-text   modal text
     --acc-font   font family
*/
(function () {
  'use strict';
  var API = '', GAME = 'game', TITLE = 'Leaderboard';
  var TOKENK = 'as.acct.token', NAMEK = 'as.acct.name';
  var token = null, me = null, period = 'all', pendingBest = 0;

  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]; }); }
  function n(x) { return Number(x || 0).toLocaleString(); }

  // ---- API ----
  function api(path, opts) {
    opts = opts || {};
    var h = { 'Content-Type': 'application/json' };
    if (opts.auth && token) h.Authorization = 'Bearer ' + token;
    return fetch(API + path, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined, cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.detail || j.message || ('HTTP ' + r.status)); e.status = r.status; throw e; } return j; }); });
  }

  // ---- styling ----
  var css = '' +
    ':root{--acc:#e0182a;--acc-ink:#fff;--acc-panel:#0b1020;--acc-text:#eef3ff;--acc-font:ui-monospace,Menlo,Consolas,monospace}' +
    '#as-btn{position:fixed;left:14px;bottom:14px;z-index:99998;display:flex;align-items:center;gap:7px;padding:9px 13px;border:1px solid var(--acc);border-radius:11px;' +
    'background:rgba(8,12,28,.82);color:var(--acc);font:700 13px/1 var(--acc-font);letter-spacing:.12em;cursor:pointer;backdrop-filter:blur(4px);transition:transform .14s,box-shadow .2s}' +
    '#as-btn:hover{transform:translateY(-2px)}#as-btn.on{box-shadow:0 0 0 2px var(--acc)}' +
    '#as-ov{position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(3,5,12,.78);backdrop-filter:blur(6px);font-family:var(--acc-font)}' +
    '#as-ov.show{display:flex}' +
    '#as-panel{width:min(430px,95vw);max-height:92vh;overflow:auto;background:var(--acc-panel);color:var(--acc-text);border:1px solid var(--acc);border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.6)}' +
    '#as-head{display:flex;align-items:center;gap:6px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.12)}' +
    '#as-head h2{margin:0;font-size:16px;letter-spacing:.14em;flex:1;text-transform:uppercase}' +
    '#as-x{background:none;border:0;color:var(--acc-text);font-size:22px;line-height:1;cursor:pointer;opacity:.7}#as-x:hover{opacity:1}' +
    '.as-tabs{display:flex;gap:6px;padding:12px 16px 0}' +
    '.as-tab{flex:1;padding:9px;border:1px solid rgba(255,255,255,.18);background:transparent;color:var(--acc-text);border-radius:9px 9px 0 0;font:700 12px/1 var(--acc-font);letter-spacing:.12em;cursor:pointer;opacity:.6}' +
    '.as-tab.sel{opacity:1;border-bottom-color:var(--acc);background:rgba(255,255,255,.05)}' +
    '.as-body{padding:16px}' +
    '#as-list{list-style:none;margin:0;padding:0}' +
    '#as-list li{display:grid;grid-template-columns:34px 1fr auto;gap:8px;align-items:center;padding:9px 8px;border-bottom:1px solid rgba(255,255,255,.08);font-size:14px}' +
    '#as-list li.me{background:rgba(224,24,42,.14);border-radius:8px}' +
    '#as-list .rk{color:var(--acc);font-weight:700}#as-list b{font-variant-numeric:tabular-nums}' +
    '#as-list .mut{grid-column:1/-1;text-align:center;opacity:.6;padding:16px}' +
    '.as-seg{display:flex;gap:6px;margin-bottom:12px}.as-seg button{flex:1;padding:7px;border:1px solid rgba(255,255,255,.18);background:transparent;color:var(--acc-text);border-radius:8px;font:600 12px/1 var(--acc-font);letter-spacing:.1em;cursor:pointer;opacity:.6}.as-seg button.sel{opacity:1;border-color:var(--acc)}' +
    '.as-field{display:block;margin:0 0 10px}.as-field span{display:block;font-size:11px;letter-spacing:.14em;opacity:.7;margin-bottom:5px;text-transform:uppercase}' +
    '.as-field input{width:100%;box-sizing:border-box;font:600 16px var(--acc-font);padding:11px 12px;border-radius:9px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.06);color:var(--acc-text)}' +
    '.as-field input:focus{outline:2px solid var(--acc);outline-offset:0}' +
    '.as-bt{width:100%;padding:12px;border:0;border-radius:9px;background:var(--acc);color:var(--acc-ink);font:800 14px/1 var(--acc-font);letter-spacing:.1em;cursor:pointer;margin-top:4px}' +
    '.as-bt.ghost{background:transparent;border:1px solid rgba(255,255,255,.22);color:var(--acc-text);font-weight:600}' +
    '.as-note{font-size:12.5px;line-height:1.5;min-height:1.2em;margin:8px 0 2px}.as-note.err{color:#ff8a8a}.as-note.ok{color:#8affb0}' +
    '.as-link{background:none;border:0;color:var(--acc);font:inherit;font-size:12.5px;cursor:pointer;padding:0;text-decoration:underline}' +
    '.as-row{display:flex;gap:8px}.as-row>*{flex:1}.as-muted{opacity:.65;font-size:12.5px;line-height:1.5}';

  // ---- DOM ----
  var btn, ov, panel, listEl, bodyEl, headEl, tab = 'board';
  function el(tag, attrs, html) { var e = document.createElement(tag); if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; }

  function build() {
    var st = el('style'); st.textContent = css; document.head.appendChild(st);
    btn = el('button', { id: 'as-btn', type: 'button', 'aria-label': TITLE }, '🏆 <span>RANKS</span>');
    document.body.appendChild(btn);
    ov = el('div', { id: 'as-ov' });
    ov.appendChild(panel = el('div', { id: 'as-panel', role: 'dialog', 'aria-label': TITLE }));
    document.body.appendChild(ov);
    btn.addEventListener('click', open);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ov.classList.contains('show')) close(); });
    render();
  }

  function open() { ov.classList.add('show'); btn.classList.add('on'); render(); if (tab === 'board') loadBoard(); }
  function close() { ov.classList.remove('show'); btn.classList.remove('on'); }

  function render() {
    panel.innerHTML = '';
    var head = el('div', { id: 'as-head' }, '<h2>' + esc(TITLE) + '</h2>');
    var x = el('button', { id: 'as-x', 'aria-label': 'Close' }, '&times;'); x.addEventListener('click', close); head.appendChild(x);
    panel.appendChild(head);
    var tabs = el('div', { 'class': 'as-tabs' });
    var tB = el('button', { 'class': 'as-tab' + (tab === 'board' ? ' sel' : '') }, 'Leaderboard');
    var tA = el('button', { 'class': 'as-tab' + (tab === 'acct' ? ' sel' : '') }, me ? esc(me.username) : 'Account');
    tB.addEventListener('click', function () { tab = 'board'; render(); loadBoard(); });
    tA.addEventListener('click', function () { tab = 'acct'; render(); });
    tabs.appendChild(tB); tabs.appendChild(tA); panel.appendChild(tabs);
    bodyEl = el('div', { 'class': 'as-body' }); panel.appendChild(bodyEl);
    if (tab === 'board') renderBoard(); else renderAccount();
  }

  // ---- leaderboard tab ----
  function renderBoard() {
    var seg = el('div', { 'class': 'as-seg' });
    var a = el('button', { 'class': period === 'all' ? 'sel' : '' }, 'ALL-TIME');
    var w = el('button', { 'class': period === 'week' ? 'sel' : '' }, 'THIS WEEK');
    a.addEventListener('click', function () { period = 'all'; render(); loadBoard(); });
    w.addEventListener('click', function () { period = 'week'; render(); loadBoard(); });
    seg.appendChild(a); seg.appendChild(w); bodyEl.appendChild(seg);
    listEl = el('ol', { id: 'as-list' }, '<li class="mut">Loading…</li>'); bodyEl.appendChild(listEl);
    if (!me) bodyEl.appendChild(el('p', { 'class': 'as-muted' }, 'Sign in on the Account tab to put your score on the board.'));
  }

  function loadBoard() {
    if (!listEl) return;
    api('/api/leaderboard?game=' + encodeURIComponent(GAME) + '&period=' + period + '&limit=25')
      .then(function (d) {
        var rows = (d && d.entries) || [];
        if (!rows.length) { listEl.innerHTML = '<li class="mut">No scores yet — be the first.</li>'; return; }
        var mine = me && me.username ? me.username.toLowerCase() : '';
        listEl.innerHTML = rows.map(function (e, i) {
          var isme = mine && e.username.toLowerCase() === mine;
          return '<li class="' + (isme ? 'me' : '') + '"><span class="rk">#' + (i + 1) + '</span><span>' + esc(e.username) + (isme ? ' (you)' : '') + '</span><b>' + n(e.best) + '</b></li>';
        }).join('');
      })
      .catch(function () { listEl.innerHTML = '<li class="mut">Leaderboard offline — try again shortly.</li>'; });
  }

  // ---- account tab ----
  function renderAccount() {
    bodyEl.innerHTML = '';
    if (me) return renderLoggedIn();
    renderAuth('login');
  }

  function field(label, id, attrs) {
    var f = el('label', { 'class': 'as-field' }, '<span>' + esc(label) + '</span>');
    var i = el('input', Object.assign({ id: id, autocomplete: 'off' }, attrs || {}));
    f.appendChild(i); return f;
  }
  function note(where) { var p = el('p', { 'class': 'as-note', 'aria-live': 'polite' }); where.appendChild(p); return p; }

  function renderAuth(mode) {
    bodyEl.innerHTML = '';
    var reg = mode === 'register';
    bodyEl.appendChild(field('Username', 'as-u', { maxlength: 16, placeholder: '3–16 letters/numbers', value: ls(NAMEK) || '' }));
    bodyEl.appendChild(field('6-digit PIN', 'as-p', { inputmode: 'numeric', maxlength: 6, placeholder: '••••••', type: 'password' }));
    if (reg) bodyEl.appendChild(field('Recovery email (optional)', 'as-e', { type: 'email', placeholder: 'to reset a forgotten PIN' }));
    var nt = note(bodyEl);
    var go = el('button', { 'class': 'as-bt' }, reg ? 'CREATE ACCOUNT' : 'LOG IN'); bodyEl.appendChild(go);
    var swap = el('button', { 'class': 'as-link' }, reg ? 'Have an account? Log in' : 'New here? Create an account');
    var forgot = el('button', { 'class': 'as-link' }, 'Forgot PIN?');
    var foot = el('div', { 'class': 'as-row' }); foot.style.marginTop = '12px';
    foot.appendChild(swap); if (!reg) foot.appendChild(forgot); bodyEl.appendChild(foot);
    swap.addEventListener('click', function () { renderAuth(reg ? 'login' : 'register'); });
    forgot.addEventListener('click', function () { renderForgot(); });
    go.addEventListener('click', function () {
      var u = (document.getElementById('as-u').value || '').trim();
      var p = (document.getElementById('as-p').value || '').trim();
      var e = reg ? (document.getElementById('as-e').value || '').trim() : '';
      if (!/^[A-Za-z0-9_]{3,16}$/.test(u)) { nt.className = 'as-note err'; nt.textContent = 'Username: 3–16 letters, numbers or _'; return; }
      if (!/^\d{6}$/.test(p)) { nt.className = 'as-note err'; nt.textContent = 'PIN must be exactly 6 digits.'; return; }
      nt.className = 'as-note'; nt.textContent = reg ? 'Creating…' : 'Logging in…';
      api('/api/auth/' + (reg ? 'register' : 'login'), { body: reg ? { username: u, pin: p, email: e } : { username: u, pin: p } })
        .then(function (res) { setSession(res); ls(NAMEK, res.username); if (pendingBest > 0) submit(pendingBest); render(); })
        .catch(function (err) { nt.className = 'as-note err'; nt.textContent = err.message || 'Could not sign in.'; });
    });
  }

  function renderForgot() {
    bodyEl.innerHTML = '';
    bodyEl.appendChild(el('p', { 'class': 'as-muted' }, "We'll email a 6-digit reset code to the address saved on the account."));
    bodyEl.appendChild(field('Username', 'as-fu', { maxlength: 16, value: ls(NAMEK) || '' }));
    var nt1 = note(bodyEl);
    var send = el('button', { 'class': 'as-bt' }, 'SEND RESET CODE'); bodyEl.appendChild(send);
    var codeWrap = el('div'); bodyEl.appendChild(codeWrap);
    var back = el('button', { 'class': 'as-link' }, '← Back'); back.style.marginTop = '12px'; bodyEl.appendChild(back);
    back.addEventListener('click', function () { renderAuth('login'); });
    send.addEventListener('click', function () {
      var u = (document.getElementById('as-fu').value || '').trim();
      if (!u) { nt1.className = 'as-note err'; nt1.textContent = 'Enter your username.'; return; }
      nt1.className = 'as-note'; nt1.textContent = 'Sending…';
      api('/api/auth/forgot', { body: { username: u } })
        .then(function (r) {
          nt1.className = 'as-note ok'; nt1.textContent = (r && r.message) || 'If that account has an email, a code is on its way.';
          if (!codeWrap.childNodes.length) {
            codeWrap.appendChild(field('Reset code', 'as-code', { inputmode: 'numeric', maxlength: 6, placeholder: '6-digit code' }));
            codeWrap.appendChild(field('New 6-digit PIN', 'as-np', { inputmode: 'numeric', maxlength: 6, type: 'password' }));
            var nt2 = note(codeWrap);
            var rb = el('button', { 'class': 'as-bt' }, 'SET NEW PIN'); codeWrap.appendChild(rb);
            rb.addEventListener('click', function () {
              var code = (document.getElementById('as-code').value || '').trim(), np = (document.getElementById('as-np').value || '').trim();
              if (!/^\d{6}$/.test(np)) { nt2.className = 'as-note err'; nt2.textContent = 'New PIN must be 6 digits.'; return; }
              nt2.className = 'as-note'; nt2.textContent = 'Setting…';
              api('/api/auth/reset', { body: { username: u, code: code, pin: np } })
                .then(function (res) { setSession(res); ls(NAMEK, res.username); nt2.className = 'as-note ok'; nt2.textContent = 'PIN reset — you are signed in.'; setTimeout(render, 700); })
                .catch(function (err) { nt2.className = 'as-note err'; nt2.textContent = err.message || 'Could not reset.'; });
            });
          }
        })
        .catch(function (err) { nt1.className = 'as-note err'; nt1.textContent = err.message || 'Could not send.'; });
    });
  }

  function renderLoggedIn() {
    var g = (me.games || {})[GAME] || {};
    bodyEl.appendChild(el('p', { 'class': 'as-muted' }, 'Signed in as <b style="color:var(--acc)">' + esc(me.username) + '</b>' + (g.best ? ' · best ' + n(g.best) : '') + (me.email ? ' · ' + esc(me.email) : ' · no recovery email')));
    var addEmail = el('button', { 'class': 'as-bt ghost' }, me.email ? 'CHANGE RECOVERY EMAIL' : 'ADD RECOVERY EMAIL');
    var changePin = el('button', { 'class': 'as-bt ghost' }, 'CHANGE PIN');
    var out = el('button', { 'class': 'as-bt ghost' }, 'SIGN OUT');
    [addEmail, changePin, out].forEach(function (b) { b.style.marginTop = '8px'; bodyEl.appendChild(b); });
    var area = el('div'); bodyEl.appendChild(area);
    addEmail.addEventListener('click', function () { emailForm(area); });
    changePin.addEventListener('click', function () { pinForm(area); });
    out.addEventListener('click', function () { token = null; me = null; ls(TOKENK, null); render(); });
  }

  function emailForm(area) {
    area.innerHTML = '';
    area.appendChild(field('Recovery email', 'as-se', { type: 'email', placeholder: 'you@example.com' }));
    area.appendChild(field('Current PIN', 'as-sp', { inputmode: 'numeric', maxlength: 6, type: 'password' }));
    var nt = note(area); var b = el('button', { 'class': 'as-bt' }, 'SAVE EMAIL'); area.appendChild(b);
    b.addEventListener('click', function () {
      var em = (document.getElementById('as-se').value || '').trim(), p = (document.getElementById('as-sp').value || '').trim();
      nt.className = 'as-note'; nt.textContent = 'Saving…';
      api('/api/auth/set-email', { auth: true, body: { email: em, pin: p } })
        .then(function (r) { me.email = r.email || em; nt.className = 'as-note ok'; nt.textContent = 'Saved.'; setTimeout(render, 700); })
        .catch(function (err) { nt.className = 'as-note err'; nt.textContent = err.message || 'Could not save.'; });
    });
  }

  function pinForm(area) {
    area.innerHTML = '';
    area.appendChild(field('Current PIN', 'as-cp', { inputmode: 'numeric', maxlength: 6, type: 'password' }));
    area.appendChild(field('New 6-digit PIN', 'as-cn', { inputmode: 'numeric', maxlength: 6, type: 'password' }));
    var nt = note(area); var b = el('button', { 'class': 'as-bt' }, 'UPDATE PIN'); area.appendChild(b);
    b.addEventListener('click', function () {
      var cur = (document.getElementById('as-cp').value || '').trim(), np = (document.getElementById('as-cn').value || '').trim();
      if (!/^\d{6}$/.test(np)) { nt.className = 'as-note err'; nt.textContent = 'New PIN must be 6 digits.'; return; }
      nt.className = 'as-note'; nt.textContent = 'Updating…';
      api('/api/auth/change-pin', { auth: true, body: { pin: cur, new_pin: np } })
        .then(function (res) { setSession(res); nt.className = 'as-note ok'; nt.textContent = 'PIN updated.'; setTimeout(render, 700); })
        .catch(function (err) { nt.className = 'as-note err'; nt.textContent = err.message || 'Could not update.'; });
    });
  }

  // ---- session + scores ----
  function setSession(res) { token = res.token; me = res; ls(TOKENK, token); }
  // ISO week id, matching the server's weekId() exactly, so the weekly board
  // lands in the right bucket. reportBest is always a freshly-played score, so
  // it is a valid candidate for this week's best.
  function weekId() {
    var d = new Date();
    var t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    var day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    var y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    var wk = Math.ceil(((t - y0) / 864e5 + 1) / 7);
    return t.getUTCFullYear() + '-W' + String(wk).padStart(2, '0');
  }
  function submit(best) {
    if (!token || !(best > 0)) return;
    var wk = weekId();
    api('/api/sync', { auth: true, body: { game: GAME, best: best, week: wk, week_best: best } })
      .then(function (r) { if (me) { me.games = me.games || {}; me.games[GAME] = { best: r.best }; } pendingBest = 0; if (btn) { btn.classList.add('on'); setTimeout(function () { if (!ov.classList.contains('show')) btn.classList.remove('on'); }, 1500); } })
      .catch(function () {});
  }

  // restore session from the token on load
  function restore() {
    token = ls(TOKENK) || null;
    if (!token) return Promise.resolve();
    return api('/api/me', { auth: true }).then(function (u) { me = { token: token, username: u.username, games: u.games, email: u.email }; if (pendingBest > 0) submit(pendingBest); })
      .catch(function (e) { if (e.status === 401) { token = null; ls(TOKENK, null); } });
  }

  // ---- public API ----
  var Account = {
    init: function (opts) {
      opts = opts || {};
      GAME = opts.game || GAME; API = opts.apiBase || ''; TITLE = opts.title ? (opts.title + ' Ranks') : 'Leaderboard';
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { build(); restore().then(render); });
      else { build(); restore().then(render); }
      return Account;
    },
    // call when the game knows a (possibly new) best score
    reportBest: function (best) {
      best = Math.max(0, Math.floor(Number(best) || 0));
      if (best <= 0) return;
      pendingBest = best;
      if (me && token) submit(best);         // logged in → store immediately
      else if (btn) btn.classList.add('on');  // nudge: sign in to save it
    },
    // switch which game's board this widget shows/reports to (one site, many games)
    setGame: function (game, title) { if (game) GAME = game; if (title) TITLE = title + ' Ranks'; pendingBest = 0; if (ov && ov.classList.contains('show')) { tab = 'board'; render(); loadBoard(); } return Account; },
    open: open, isLoggedIn: function () { return !!me; }
  };
  window.Account = Account;
})();
