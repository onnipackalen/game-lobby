/* Magellan Live — betting, the HUD and the live loop. Needs data.js, engine.js, fw-render.js and adapter.js. */
(function () {
  'use strict';
  const ML = window.MagLive, CFG = ML.CFG, Clock = ML.Clock;
  const $ = id => document.getElementById(id);
  const el = {
    stage: $('stage'), mult: $('mult'), banner: $('banner'), hist: $('hist'), gold: $('gold'), walletBox: $('walletBox'),
    acts: $('acts'), slips: $('slips'), addBet: $('addBet'), note: $('note'), rescue: $('rescue'),
    log: $('log'), pop: $('pop'), modal: $('modal'), clockInfo: $('clockInfo'), soundBtn: $('soundBtn'),
  };
  const round2 = x => Math.round(x * 100) / 100;
  const money = x => round2(x).toLocaleString('en-US', { minimumFractionDigits: x % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const xm = m => '×' + (m >= 100 ? Math.floor(m + 1e-9).toFixed(0) : ML.floor2(m).toFixed(2));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const AUTOS = [0, 1.5, 2, 3, 5, 10, 25, 50, 100];

  // every visit starts fresh, like Fair Winds: 10,000 gold, one bet of 10, auto cash-out off.
  // A second, separate bet is added further down the deck ("+ Add bet 2"); its button then comes up beside bet 1's (user, 2026-11-14).
  // Each slip has its own stake, auto cash-out, open bet and result; n = how many bets are in play.
  const slip = i => ({ i, stake: 10, auto: 0, bet: null, last: null, pressed: false, downAt: 0, ui: null });
  const S = { gold: 10000, n: 1, slips: [slip(0), slip(1)], log: [] };
  // Game Lobby: inside the lobby this game plays from the lobby's shared wallet (nothing changes when the game is opened on its own)
  const LOBBY = (() => { try { return window.parent !== window && window.parent.LobbyWallet || null; } catch (e) { return null; } })();
  if (LOBBY) S.gold = LOBBY.attach(() => S.gold);
  const active = () => S.slips.slice(0, S.n);

  $('logoShip').innerHTML = shipSvg('Carrack', 40);
  liveInit();

  /* ---------- the multiplier (Fair Winds: renderMult) ---------- */
  let multScale = 1, multPop = 0;
  function renderMult(st, now, dt) {
    const R0 = st.round, bets = S.slips.filter(s => s.bet && s.bet.key === R0.key).map(s => s.bet);
    const banked = S.slips.filter(s => s.last && s.last.key === R0.key && s.last.cash), bankedSum = round2(banked.reduce((a, s) => a + s.last.paid, 0));
    let big, size, col = '#ffffff', sub, lost = false, stormy = false;
    if (st.phase === 'board') {
      const left = (R0.sailStart - now) / 1000;
      big = left > .35 ? String(Math.ceil(left)) : 'Sail!';
      size = Math.min(W * .17, 76);
      sub = bets.length ? `Aboard with <b>${money(round2(bets.reduce((a, b) => a + b.stake, 0)))}</b> · sailing soon` : 'Next voyage · join now';
    } else if (st.phase === 'sail') {
      const m = st.mult; big = xm(m);
      size = Math.min(W * .17, 48 + Math.log(m) * 9);
      col = m < 2 ? '#ffffff' : m < 5 ? '#ffe39a' : m < 20 ? '#ffc93c' : m < 60 ? '#ff9a3c' : '#ff5a3c';
      stormy = R.boost > 1.01;
      sub = bets.length ? `worth <b>${money(round2(bets.reduce((a, b) => a + round2(b.stake * ML.floor2(m)), 0)))}</b>` : banked.length ? `you banked <b>${money(bankedSum)}</b>` : 'at sea · join the next voyage';
      for (const b of bets) if (b.auto) sub += `<span class="atag">AUTO ${xm(b.auto)}</span>`;
    } else if (R0.home) {
      big = xm(CFG.max); size = Math.min(W * .17, 48 + Math.log(CFG.max) * 9); col = '#ffc93c';
      sub = banked.length ? `Around the world! You banked <b>${money(bankedSum)}</b>` : 'Around the world! Everyone aboard paid ×1000';
    } else {
      big = xm(R0.crash); size = Math.min(W * .17, 48 + Math.log(Math.max(1, R0.crash)) * 9); lost = true;
      sub = banked.length ? `Lost at sea · you banked <b>${money(bankedSum)}</b>` : 'Lost at sea';
    }
    const target = 1 + (stormy ? .14 + (R.boost - 1) * .1 : 0);
    multScale = lerp(multScale, target, clamp(dt * 6, 0, 1)); multPop = Math.max(0, multPop - dt * 2.6);
    const tens = st.phase === 'sail' ? clamp(SC.p, 0, 1) : 0, beat = calm() ? 0 : Math.pow(Math.max(0, Math.sin(SC.t * (3 + 4 * tens))), 8) * (.006 + .016 * tens);
    el.mult.style.fontSize = size.toFixed(1) + 'px'; el.mult.style.color = col;
    el.mult.style.transform = `scale(${(multScale + Math.sin(multPop * Math.PI) * .16 + beat).toFixed(3)})`;
    const tsh = `0 6px 0 ${INK}, 0 0 ${Math.round(14 + (multScale - 1) * 40)}px ${stormy ? 'rgba(155,108,255,.6)' : 'rgba(255,190,80,.3)'}`;
    if (el.mult.dataset.ts !== tsh) { el.mult.dataset.ts = tsh; el.mult.style.textShadow = tsh; }
    el.mult.classList.toggle('storm', stormy && !calm());
    el.mult.classList.toggle('lost', lost);
    const html = `${big}<span class="sub">${sub}</span>`;
    if (el.mult.dataset.h !== html) { el.mult.dataset.h = html; el.mult.innerHTML = html; }
    // only how much faster, never what it is or where (user, 2026-11-12: no storm or area names on screen; same as Fair Winds)
    const bn = el.banner;
    if (st.phase === 'sail' && (R.inStorm ? SC.t - (R.stormT || 0) < 2.5 : R.zone && SC.t - (R.zoneT || 0) < 2.5)) {
      bn.hidden = false; bn.className = 'banner' + (R.inStorm ? '' : ' wind');
      bn.textContent = `» ×${Math.round(R.boost * 100 + 1e-6) / 100} speed`;
    } else bn.hidden = true;
  }

  /* ---------- checkpoints: unnamed markers, each one a little celebration ---------- */
  let cpSeen = { key: '', n: 0 };
  function checkpoints(st) {
    const R0 = st.round, f = st.phase === 'board' ? 0 : SC.p;
    let n = 0; for (const c of ML.CHECKPOINTS) if (c.f > 0 && c.f < 1 && c.f <= f) n++;
    if (cpSeen.key !== R0.key) { cpSeen = { key: R0.key, n }; return; }
    if (n > cpSeen.n) {
      cpSeen.n = n;
      if (st.phase !== 'sail') return;
      multPop = 1; liveMilestone();
      const ring = document.createElement('div'); ring.className = 'mring'; el.stage.appendChild(ring); setTimeout(() => ring.remove(), 1000);
    }
  }

  /* ---------- the history strip: where recent voyages ended, the same on every screen ---------- */
  let histKey = '';
  function renderHist(now) {
    const H = ML.history(now, 16);
    if (H[0].key === histKey) return;
    const first = !histKey; histKey = H[0].key;
    el.hist.innerHTML = H.map((R0, i) => `<span class="hp ${R0.home ? 'arr' : R0.crash >= 10 ? 'hi' : R0.crash >= 2 ? 'mid' : 'lo'}${i === 0 && !first ? ' new' : ''}" data-key="${R0.key}">${xm(R0.crash)}</span>`).join('');
  }
  el.hist.addEventListener('click', e => {
    const t = e.target.closest('.hp'); if (!t) return;
    const R0 = ML.roundByKey(t.dataset.key); if (!R0) return;
    el.pop.innerHTML = `<b>Voyage ${R0.P}·${R0.r + 1}</b> · ${R0.home ? 'home at ×1000' : 'lost at ' + xm(R0.crash)}<code>SHA-256("${R0.seed}")</code><code>= ${R0.hash}</code>`;
    el.pop.hidden = false; e.stopPropagation();
  });
  document.addEventListener('click', e => { if (!el.pop.hidden && !el.pop.contains(e.target)) el.pop.hidden = true; });

  function renderLog() {
    if (!S.log.length) { el.log.innerHTML = '<li class="empty">No voyages yet.</li>'; return; }
    el.log.innerHTML = S.log.slice(0, 8).map(e => `<li${e.fresh ? ' class="stamp"' : ''}><span>#${e.r}${e.tag ? ` <i class="bn">${e.tag}</i>` : ''} <small>stake ${money(e.stake)}</small></span>${e.cash ? `<span class="tkt"><small class="bk">banked<i class="seal" aria-hidden="true"></i></small><b>${xm(e.cash)} · ${money(e.paid)}</b>${e.how ? `<small class="tag">${e.how}</small>` : ''}</span>` : '<span>lost</span>'}</li>`).join('');
    S.log.forEach(e => (e.fresh = false));
  }

  /* ---------- the bet slips: stake and auto cash-out, one set per bet ---------- */
  // no top limit on a stake (as in Fair Winds, user 2026-11-12): your gold is the only limit, checked when you join
  const cleanStake = v => round2(Number.isFinite(v) && v > 0 ? v : 0);
  const CHIPS = [5, 10, 25, 50, 100], CHIPC = ['#e8402f', '#2c7fd4', '#1fae5f', '#6a3cc9', '#1b1f3a'];
  function buildSlip(sl) {
    const d = document.createElement('div'); d.className = 'slip'; d.dataset.i = sl.i;
    d.innerHTML = `<div class="slip-h"><span class="lbl"><i class="bn">${sl.i + 1}</i><span class="nm">Bet ${sl.i + 1}</span></span>${sl.i ? '<button type="button" class="ghost rm">Remove</button>' : ''}</div>
      <div class="ctl"><div class="stakebox"><span class="coin"></span><input class="betin" inputmode="decimal" autocomplete="off" aria-label="Bet ${sl.i + 1} stake"><button type="button" class="clr" aria-label="Clear stake">✕</button></div>
      <div class="chips">${CHIPS.map((c, k) => `<button type="button" class="chip" style="--c:${CHIPC[k]}" data-add="${c}">${c}</button>`).join('')}<button type="button" class="ghost x2" data-x2>2×</button></div></div>
      <div class="ctl"><span class="lbl">Auto cash-out</span><div class="seg"></div></div>`;
    el.slips.appendChild(d);
    const u = sl.ui = { root: d, input: d.querySelector('.betin'), box: d.querySelector('.stakebox'), seg: d.querySelector('.seg'), btn: $('action' + sl.i), nm: d.querySelector('.nm') };
    u.input.addEventListener('input', () => { sl.stake = readStake(sl); });
    u.input.addEventListener('blur', () => setStake(sl, readStake(sl)));
    u.input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); u.input.blur(); } });
    d.querySelector('.clr').addEventListener('click', () => { setStake(sl, 0); sfx('down'); });
    d.querySelector('.chips').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.add) {
        // a chip you can't afford drops to the biggest chip that still fits; only when not even the smallest fits is it refused (as in Fair Winds)
        const room = round2(S.gold - sl.stake), want = Number(b.dataset.add);
        const g = want <= room ? want : CHIPS.filter(c => c < want && c <= room).pop();
        if (!g) { note('Not enough gold'); sfx('down'); return; }
        setStake(sl, sl.stake + g);
      }
      else if ('x2' in b.dataset) { if (sl.stake * 2 > S.gold + 1e-9) { note('Not enough gold to double'); sfx('down'); return; } setStake(sl, sl.stake * 2); }
      sfx('up');
    });
    const rm = d.querySelector('.rm'); if (rm) rm.addEventListener('click', () => setBets(1));
    u.seg.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; sl.auto = Number(b.dataset.a); renderAuto(sl); sfx('tick'); });
    // cash-outs act the instant a finger goes down, like Fair Winds; the click that follows is ignored. CASH OUT presses in (Fair Winds: pressFx)
    u.btn.addEventListener('pointerdown', e => { if (e.button) return; sl.downAt = performance.now();
      if (u.btn.classList.contains('cash') && !u.btn.disabled) { sl.pressed = true; u.btn.classList.add('press'); }
      onAction(sl); });
    u.btn.addEventListener('click', () => { if (performance.now() - sl.downAt < 800) return; onAction(sl); });
    setStake(sl, sl.stake); renderAuto(sl);
  }
  function setStake(sl, v) { sl.stake = cleanStake(v); sl.ui.input.value = sl.stake ? String(sl.stake) : ''; }
  const readStake = sl => cleanStake(parseFloat(String(sl.ui.input.value).replace(/,/g, '')));
  function renderAuto(sl) {
    sl.ui.seg.innerHTML = AUTOS.map(a => `<button type="button" data-a="${a}" aria-pressed="${sl.auto === a}">${a ? '×' + a : 'Off'}</button>`).join('');
  }
  // one bet or two: bet 2's slip and button come and go (it can't go while it has gold aboard)
  function setBets(n) {
    if (n === 1 && S.slips[1].bet) { note('Bet 2 is aboard · step ashore or cash out first'); sfx('down'); return; }
    S.n = n; const two = n === 2;
    S.slips[1].ui.root.hidden = !two; S.slips[1].ui.btn.hidden = !two; el.addBet.hidden = two;
    el.acts.classList.toggle('two', two); el.slips.classList.toggle('two', two);
    S.slips[0].ui.nm.textContent = two ? 'Bet 1' : 'Your stake';
    if (two) { setStake(S.slips[1], S.slips[1].stake || 10); sfx('up'); } else S.slips[1].last = null;
  }
  el.addBet.addEventListener('click', () => setBets(2));

  let noteTimer = 0;
  function note(html, ms = 5000) { el.note.innerHTML = html; clearTimeout(noteTimer); if (ms) noteTimer = setTimeout(() => (el.note.innerHTML = ''), ms); }

  /* ---------- money in and out (Fair Winds: renderWallet, coinsFly, bankFx) ---------- */
  // the wallet: steady digits while it counts up, one small bump when it lands
  let walletShown = null, walletRaf = 0, walletGen = 0, walletHold = 0;
  function renderWallet(animate) {
    const gen = ++walletGen; cancelAnimationFrame(walletRaf); walletRaf = 0; walletHold = 0;
    const to = S.gold;
    if (!animate || calm() || walletShown == null || to <= walletShown) { walletShown = to; el.gold.textContent = money(to); return; }
    const from = walletShown, dur = clamp(350 + 120 * Math.log10(1 + (to - from) / 100), 350, 600), t0 = performance.now();
    const step = now => { if (gen !== walletGen) return; const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3), tgt = S.gold;
      walletShown = p < 1 ? from + (tgt - from) * e : tgt; el.gold.textContent = money(walletShown);
      if (p < 1) walletRaf = requestAnimationFrame(step); else { walletRaf = 0; walletBump(); } };
    walletRaf = requestAnimationFrame(step);
  }
  function walletBump() { if (calm()) return; el.walletBox.classList.remove('tick'); void el.walletBox.offsetWidth; el.walletBox.classList.add('tick'); }
  const coinCount = m => m < 2 ? 3 : m < 5 ? 4 : m < 20 ? 5 : 6;
  // coins fly on one curved arc each from the ship to the wallet's coin, growing to the top of the arc and shrinking into the wallet
  function coinsFly(from, n, { delay = 80, gap = 50, onEach, onFirst } = {}) {
    const wc = el.walletBox.querySelector('.coin') || el.walletBox, t = wc.getBoundingClientRect();
    if (calm() || !n || t.bottom < 0 || t.top > innerHeight) { onFirst && onFirst(); return 0; }
    const x2 = t.left + t.width / 2, y2 = t.top + t.height / 2, els = []; let landed = 0, over = false;
    const land = c => { if (c.dataset.l) return; c.dataset.l = 1; c.remove(); onEach && onEach(landed); if (landed++ === 0 && onFirst) onFirst(); };
    for (let k = 0; k < n; k++) {
      const c = document.createElement('div'); c.className = 'flycoin'; document.body.appendChild(c); els.push(c);
      const x0 = from.x + (Math.random() - .5) * 18, y0 = from.y + (Math.random() - .5) * 8, dx = x2 - x0, dy = y2 - y0, len = Math.hypot(dx, dy) || 1;
      let nx = -dy / len, ny = dx / len; if (ny > 0) { nx = -nx; ny = -ny; }
      if (Math.abs(ny) < .3 && k % 2) { nx = -nx; ny = -ny; }
      const bow = 60 + Math.random() * 30, qx = (x0 + x2) / 2 + nx * bow, qy = (y0 + y2) / 2 + ny * bow - 10;
      const frames = []; for (let j = 0; j <= 8; j++) { const u = j / 8, a = (1 - u) * (1 - u), b = 2 * u * (1 - u), e = u * u;
        const sc = u < .5 ? .7 + .7 * u : 1.05 - .7 * (u - .5);
        frames.push({ transform: `translate(${(a * x0 + b * qx + e * x2 - 9).toFixed(1)}px,${(a * y0 + b * qy + e * y2 - 9).toFixed(1)}px) scale(${sc.toFixed(3)})`, opacity: u === 0 ? 0 : 1, offset: u }); }
      const an = c.animate(frames, { duration: 450 + Math.random() * 200, delay: delay + k * gap, easing: 'cubic-bezier(.45,.05,.55,.95)', fill: 'both' });
      an.onfinish = () => land(c);
    }
    setTimeout(() => { if (!over) { over = true; els.forEach(land); } }, delay + n * gap + 900);   // nothing left behind; the callbacks always run
    return n;
  }
  // a cash-out: a thunk, a ping, the coins (one rising note as each lands, a bright top note from ×10) and the wallet counting up
  function bankFx(m) {
    const p = liveCashFx(m >= 10), r = $('scene').getBoundingClientRect(), from = { x: r.left + p.x, y: r.top + p.y };
    bankSfx('thunk'); bankSfx('ping', 0, .08);
    const n = coinCount(m), hi = m >= 10; let landed = 0, started = false;
    const first = () => { if (!started) { started = true; renderWallet(true); } };
    walletHold = performance.now() + 1600;   // the wallet waits for the first coin (with a safety)
    const flew = coinsFly(from, n, { onFirst: first, onEach: () => { bankSfx('note', landed++); if (landed === n && hi) bankSfx('bright', 0, .07); } });
    if (!flew) { first(); for (let j = 0; j < n; j++) bankSfx('note', j, (500 + j * 50) / 1000); if (hi) bankSfx('bright', 0, (570 + n * 50) / 1000); }
  }
  function settle(sl, b, m, live) {
    const R0 = ML.roundByKey(b.key), paid = m ? round2(b.stake * m) : 0;
    S.gold = round2(S.gold + paid);
    sl.last = { key: b.key, cash: m, paid, stake: b.stake };
    S.log.unshift({ r: R0 ? R0.r + 1 : 0, tag: b.two ? sl.i + 1 : 0, stake: b.stake, cash: m, paid, how: m && b.auto === m ? 'auto' : '', fresh: live }); S.log.length = Math.min(S.log.length, 20);
    sl.bet = null; renderLog();
    if (live && m) bankFx(m);   // the multiplier's caption and the log say the rest (less explaining, as in Fair Winds)
  }
  // settles the open bet from the voyage itself, so it works the same in a background tab
  function resolve(now, live) { for (const sl of S.slips) resolveSlip(sl, now, live); }
  function resolveSlip(sl, now, live) {
    const b = sl.bet; if (!b) return;
    const R0 = ML.roundByKey(b.key);
    if (!R0) { S.gold = round2(S.gold + b.stake); sl.bet = null; return; }
    if (now < R0.sailStart) { b.auto = sl.auto; return; }
    const autoAt = b.auto ? R0.sailStart + ML.msFor(R0, b.auto) : Infinity;
    if (b.auto && R0.crash >= b.auto && now >= autoAt) return settle(sl, b, b.auto, live && now - autoAt < 2000);
    if (now >= R0.crashAt) return settle(sl, b, R0.home ? CFG.max : 0, live && now - R0.crashAt < 2000);
  }

  function onAction(sl) {
    audioInit();
    const btn = sl.ui.btn;
    if (btn.classList.contains('over') || btn.hidden) return;   // the brass VOYAGE OVER plate is a result, not a button
    const now = Clock.now(), st = ML.stateAt(now), b = sl.bet;
    if (b) {
      const R0 = ML.roundByKey(b.key);
      if (now < R0.sailStart) { S.gold = round2(S.gold + b.stake); sl.bet = null; note('You stepped ashore · stake back'); sfx('down'); return; }
      if (now < R0.crashAt) return settle(sl, b, ML.floor2(ML.multAt(R0, now - R0.sailStart)), true);
      return;
    }
    if (document.activeElement === sl.ui.input) setStake(sl, readStake(sl));
    const stake = sl.stake;
    if (stake < 1) { note('Put at least <b>1</b> gold on your stake'); return; }
    if (stake > S.gold + 1e-9) { note(`Not enough gold for <b>${money(stake)}</b>`); sl.ui.box.classList.add('bad'); setTimeout(() => sl.ui.box.classList.remove('bad'), 1200); return; }
    const target = st.phase === 'board' ? st.round : ML.nextRound(st.round);
    S.gold = round2(S.gold - stake);
    sl.bet = { key: target.key, stake, auto: sl.auto, two: S.n === 2 };
    sl.last = null; sfx('up');
  }
  // Space: cash out every bet at sea; otherwise it works bet 1's button (join, or step ashore)
  function actAll() {
    const now = Clock.now(), sea = active().filter(s => s.bet && now >= ML.roundByKey(s.bet.key).sailStart);
    if (sea.length) sea.forEach(onAction); else onAction(S.slips[0]);
  }
  const release = () => { for (const sl of S.slips) { if (!sl.pressed) continue; sl.pressed = false; const b = sl.ui.btn; b.classList.remove('press');
    if (calm() || b.disabled) continue;
    b.animate([{ scale: '.97', translate: '0 3px' }, { scale: '1.04', translate: '0 0', offset: .5 }, { scale: '1', translate: '0 0' }], { duration: 180, easing: 'cubic-bezier(.34,1.56,.64,1)' }); } };
  addEventListener('pointerup', release); addEventListener('pointercancel', release);
  el.rescue.addEventListener('click', () => { S.gold = round2(S.gold + 100); note('The crown sends <b>100</b> gold'); sfx('coin'); });
  document.addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.repeat || /INPUT|TEXTAREA|BUTTON|SUMMARY/.test(document.activeElement.tagName) || !el.modal.hidden) return;
    e.preventDefault(); actAll();
  });

  function renderAction(st, now) {
    const two = S.n === 2;
    for (const sl of active()) {
      const b = sl.bet, btn = sl.ui.btn, tag = two ? `<i class="bn">${sl.i + 1}</i>` : '';
      let cls = 'big go', a1, a2, dis = false;
      if (b) {
        const R0 = ML.roundByKey(b.key);
        if (now < R0.sailStart) {
          cls = 'big wait'; a1 = 'STEP ASHORE';
          a2 = two ? `aboard · ${money(b.stake)}` : R0.key === st.round.key ? `aboard with ${money(b.stake)} · sails in ${Math.max(0, Math.ceil((R0.sailStart - now) / 1000))}s` : `joined the next voyage · ${money(b.stake)}`;
        } else { cls = 'big cash'; a1 = 'CASH OUT'; a2 = money(round2(b.stake * ML.floor2(st.mult))); }
      } else if (st.phase === 'result' && sl.last && sl.last.key === st.round.key) {
        // the voyage this bet was in is over: its plank becomes a brass plate with what came back (MAX WIN said here on the deck, never over the sea)
        const won = sl.last.cash >= CFG.max;
        cls = 'big wait over' + (won ? ' won' : ''); a1 = won ? 'MAX WIN' : 'VOYAGE OVER'; dis = true;
        a2 = sl.last.cash ? `banked ${money(sl.last.paid)}` : `${money(0)} of ${money(sl.last.stake)} back`;
      } else {
        a1 = two ? (st.phase === 'board' ? 'JOIN' : 'JOIN NEXT') : st.phase === 'board' ? 'JOIN THE VOYAGE' : 'JOIN NEXT VOYAGE';
        a2 = sl.stake >= 1 ? `${two ? '' : 'stake '}${money(sl.stake)}${sl.auto ? (two ? ' · ' : ' · auto ') + xm(sl.auto) : ''}` : 'pick a stake';
        dis = S.gold < 1 || sl.stake < 1;
      }
      if (sl.pressed) cls += ' press';   // keeps the press while a finger is down
      if (btn.className !== cls) btn.className = cls;
      const h = `${tag}<span class="a1">${a1}</span><small class="a2">${a2}</small>`;
      if (btn.dataset.h !== h) { btn.dataset.h = h; btn.innerHTML = h; }
      btn.disabled = dis;
    }
    if (!walletRaf && walletShown !== S.gold && performance.now() > walletHold) renderWallet(false);
    el.rescue.hidden = !(S.gold < 1 && !S.slips.some(s => s.bet));
  }

  /* ---------- sound ---------- */
  document.addEventListener('pointerdown', () => audioInit(), { once: true, capture: true });
  el.soundBtn.addEventListener('click', () => { G.sound = G.music = !G.sound; audioInit(); applyAudio(); el.soundBtn.setAttribute('aria-pressed', String(G.sound)); el.soundBtn.setAttribute('aria-label', G.sound ? 'Sound on' : 'Sound off'); });
  $('infoBtn').addEventListener('click', () => { el.modal.hidden = false; });
  $('closeModal').addEventListener('click', () => { el.modal.hidden = true; });
  el.modal.addEventListener('click', e => { if (e.target === el.modal) el.modal.hidden = true; });

  /* ---------- the loop ---------- */
  let lastP = performance.now(), titleAt = 0;
  function frame() { try { frameStep(); } finally { requestAnimationFrame(frame); } }
  function frameStep() {
    const p = performance.now(), dt = Math.min(.25, (p - lastP) / 1000); lastP = p;
    const now = Clock.now(), st = ML.stateAt(now);
    resolve(now, true);
    liveUpdate(st, now, dt);
    checkpoints(st);
    renderMult(st, now, dt);
    renderHist(now);
    renderAction(st, now);
    if (p - titleAt > 250) { titleAt = p; title(st); }
  }
  function title(st) {
    const t = st.phase === 'sail' ? xm(st.mult) + ' · Magellan Live' : st.phase === 'board' ? 'Boarding · Magellan Live' : (st.round.home ? '×1000 home! · ' : 'Lost ' + xm(st.round.crash) + ' · ') + 'Magellan Live';
    if (document.title !== t) document.title = t;
  }
  // background tabs get no animation frames: keep settling bets and the tab title
  setInterval(() => { const now = Clock.now(); resolve(now, false); if (document.hidden) title(ML.stateAt(now)); }, 500);

  function showClock() {
    el.clockInfo.textContent = Clock.synced
      ? `Clock synced to the server (±${Clock.err} ms), so this screen shows the same voyage as every other one.`
      : 'Using this device\'s clock (no server time here). Screens with the right time still show the same voyage.';
  }
  async function syncClock() { try { await Clock.sync(); } catch (e) { /* stay on the local clock */ } showClock(); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncClock(); });
  setInterval(syncClock, 5 * 60 * 1000);

  S.slips.forEach(buildSlip); setBets(1); renderLog(); showClock(); syncClock();
  requestAnimationFrame(frame);
  window.__ML = { S, settle, resolve };
})();
