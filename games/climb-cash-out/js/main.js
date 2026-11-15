import { RISKS, N, CLASSIC_LADDERS, createBoard, shuffleLadders, nextRollOutcomes, averageAfterRoll } from './engine/board.js';
import { rollAt, rollsFor, newSeedPair } from './engine/fair.js';
import { newRound, applyRoll, cashOut, payout, STATUS, superRollPriceCents, bustFaces, roundNet } from './engine/round.js';
import * as store from './store.js';
import { defsMarkup, tilesMarkup, artMarkup, labelsMarkup, reachMarkup, tokenMarkup, placeToken, placeTokenAt } from './ui/board-view.js';
import { squareCenter } from './engine/board.js';
import { fmtChips, fmtSigned, fmtMult, fmtOdds, fmtClock, escapeHtml } from './ui/format.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STAKES = [100, 200, 500, 1000, 2500, 5000, 10000]; // cents
const DIE_ICON = '<svg class="die-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" fill="#FFFFFF" stroke="#1D2340" stroke-width="2"/><circle cx="8" cy="8" r="1.8" fill="#1D2340" stroke="none"/><circle cx="12" cy="12" r="1.8" fill="#1D2340" stroke="none"/><circle cx="16" cy="16" r="1.8" fill="#1D2340" stroke="none"/></svg>';
const MIN_ROLL_MS = 1000;                  // minimum time per roll (play money; see GAME_DESIGN §9.5), no turbo
const AUTO_GAP_MS = 250;                   // pause between auto-rolls
const ROUND_TIMEOUT_MS = 10 * 60 * 1000;   // idle rounds are cashed out at their current value

const state = store.load();
// Game Lobby: inside the lobby this game plays from the lobby's shared wallet (nothing changes when the game is opened on its own)
const LOBBY = (() => { try { return window.parent !== window && window.parent.LobbyWallet || null; } catch (e) { return null; } })();
if (LOBBY) state.balanceCents = LOBBY.attach(() => state.balanceCents, 100);
const session = { start: Date.now(), netCents: 0, nextRealityAt: 0 };
const boardCache = new Map();
let board = null;
let busy = false;
let autoStopped = false;
let lastShowValues = null;
let tooltipTimer = 0;

const tokenEl = $('token');
const dialog = $('dialog');

// ---------- boards ----------

function getBoard(risk, ladders) {
  const key = risk + JSON.stringify(ladders);
  if (!boardCache.has(key)) boardCache.set(key, createBoard(risk, ladders));
  return boardCache.get(key);
}

function setupBoard() {
  const risk = state.prefs.risk;
  board = getBoard(risk, state.prefs.ladders[risk] || CLASSIC_LADDERS);
}

function showValuesNow() {
  const sv = state.settings.showValues;
  if (sv === 'on' || sv === true) return true;
  if (sv === 'off' || sv === false) return false;
  return $('board').clientWidth >= 480;
}

function drawBoard() {
  lastShowValues = showValuesNow();
  $('tileLayer').innerHTML = tilesMarkup(board);
  $('artLayer').innerHTML = artMarkup(board);
  $('labelLayer').innerHTML = labelsMarkup(board, { showValues: lastShowValues });
  $('boardDesc').textContent = `Snakes and ladders board, ${RISKS[board.risk].label} risk, ${board.isClassic ? 'classic' : 'shuffled'} ladders. Top prize ${fmtMult(board.top)}.`;
  drawReach();
}

function drawReach() {
  const r = state.activeRound;
  $('reachLayer').innerHTML = r && r.status === STATUS.ACTIVE && !busy ? reachMarkup(nextRollOutcomes(board, r.pos)) : '';
}

// ---------- rendering ----------

function showView(name) {
  $('setupView').hidden = name !== 'setup';
  $('roundView').hidden = name !== 'round';
  $('resultView').hidden = name !== 'result';
}

function renderHeader() {
  $('balance').textContent = fmtChips(state.balanceCents);
  const net = $('sessionNet');
  net.textContent = fmtSigned(session.netCents);
  $('footHash').textContent = state.seeds ? `${state.seeds.serverHash.slice(0, 12)}…` : '…';
}

function renderSetup() {
  const p = state.prefs;
  $('riskButtons').innerHTML = Object.values(RISKS).map((r) => {
    const b = getBoard(r.id, p.ladders[r.id] || CLASSIC_LADDERS);
    const level = { low: 1, medium: 2, high: 3 }[r.id];
    const meter = [1, 2, 3].map((i) => `<i class="${i <= level ? 'on' : ''}"></i>`).join('');
    return `<button class="seg" role="radio" data-risk="${r.id}" aria-checked="${p.risk === r.id}">` +
      `<span class="meter" aria-hidden="true">${meter}</span>${r.label}<small>top ${fmtMult(b.top, true)}</small></button>`;
  }).join('');
  $('riskBlurb').textContent = RISKS[p.risk].blurb;

  $('stakeValue').textContent = fmtChips(p.stakeCents);
  $('stakeChips').innerHTML = STAKES.map((c) =>
    `<button class="chip chip-${c / 100}" data-stake="${c}" aria-pressed="${c === p.stakeCents}" aria-label="Stake ${c / 100}"><span>${c / 100}</span></button>`).join('');
  $('stakeDown').disabled = p.stakeCents <= STAKES[0];
  $('stakeUp').disabled = p.stakeCents >= STAKES[STAKES.length - 1];

  $('layoutTag').textContent = board.isClassic ? 'Classic' : 'Shuffled';
  $('classicBtn').disabled = board.isClassic;
  $('layoutInfo').textContent = `Top prize ${fmtMult(board.top)}. Reaching 100 without cashing out: ${fmtOdds(board.topOdds)}.`;

  $('autoToggle').checked = p.autoOn;
  $('autoToggle').setAttribute('aria-checked', String(p.autoOn));
  $('autoTarget').value = p.autoTarget.toFixed(2);
  $('autoTarget').disabled = !p.autoOn;
  $('targetRow').classList.toggle('off', !p.autoOn);

  const short = p.stakeCents > state.balanceCents;
  $('betBtn').innerHTML = `${DIE_ICON}<span>Bet ${fmtChips(p.stakeCents)} &amp; roll</span>`;
  $('betBtn').disabled = short || busy;
  $('betHint').textContent = short ? 'Not enough chips for this stake. Pick a smaller one.' : '';
  $('refillBtn').hidden = !store.canRefill(state);
}

function outcomeView(o, autoOn, target) {
  let cls = o.kind, to, value, tag = '';
  if (o.kind === 'bust') { to = `on ${o.landed}`; value = 'Bust'; }
  else if (o.kind === 'ladder') { to = `ladder ${o.final}`; value = fmtMult(o.value, true); }
  else if (o.kind === 'slide') { to = `slide ${o.final}`; value = fmtMult(o.value, true); }
  else if (o.kind === 'top') { to = '100!'; value = fmtMult(o.value, true); }
  else { to = `→ ${o.final}`; value = fmtMult(o.value, true); }
  if (autoOn && o.kind !== 'bust') {
    const hit = o.value >= target;
    tag = hit ? 'cashes out' : 'rolls on';
    if (hit) cls += ' hit';
  }
  return `<li class="outcome ${cls}"><span class="f" aria-label="Roll ${o.face}">${o.face}</span><span class="to">${to}</span><span class="v">${value}</span>${tag ? `<span class="t">${tag}</span>` : ''}</li>`;
}

function renderRound() {
  const r = state.activeRound;
  if (!r) return;
  const m = board.m[r.pos];
  const worth = payout(r.stakeCents, m);
  const started = r.rolls.length > 0;
  $('nowWhere').textContent = started ? `Square ${r.pos} · ${r.rolls.length} roll${r.rolls.length === 1 ? '' : 's'}` : 'Starting on square 1';
  const multText = started ? fmtMult(m) : '–';
  const multEl = $('nowMult');
  if (multEl.textContent !== multText) {
    multEl.textContent = multText;
    if (started && !state.settings.reducedMotion) multEl.animate([{ transform: 'scale(1.25)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'cubic-bezier(.3,1.6,.5,1)' });
  }
  multEl.classList.toggle('below', started && m < 1);
  $('nowStake').textContent = r.feesCents
    ? `Stake ${fmtChips(r.stakeCents)} + ${fmtChips(r.feesCents)} Super Rolls`
    : `Stake ${fmtChips(r.stakeCents)} · ${RISKS[r.risk].label}`;
  $('nowWorth').textContent = started ? `Worth ${fmtChips(worth)}` : 'First roll…';

  const autoOn = state.prefs.autoOn && !autoStopped;
  const outs = nextRollOutcomes(board, r.pos);
  $('outcomes').innerHTML = outs.map((o) => outcomeView(o, autoOn, state.prefs.autoTarget)).join('');
  const busts = outs.filter((o) => o.kind === 'bust').length;
  $('bustChance').textContent = busts ? `${busts} in 6 bust${busts === 1 ? 's' : ''}` : 'No bust possible';
  $('avgLine').textContent = started
    ? `Rolling averages ${fmtMult(averageAfterRoll(board, r.pos))}, about the same as cashing out now. It changes your risk, not your value.`
    : '';

  $('autoStatus').hidden = !autoOn;
  $('autoText').textContent = `Auto-rolling to ${fmtMult(state.prefs.autoTarget)}`;

  $('rollBtn').disabled = busy || !started;
  $('cashBtn').disabled = busy || !started;
  const label = m < 1 ? 'Take back' : 'Cash out';
  $('cashBtn').innerHTML = `<span class="btn-col"><span>${label} ${fmtChips(worth)}</span><span class="sub">at ${fmtMult(m)}</span></span>`;
  $('cashBtn').classList.toggle('btn-yellow', m >= 1);
  $('cashBtn').classList.toggle('btn-ghost', m < 1);

  // Super Roll: priced at what the protection is worth (97% return); not offered with no pits in reach
  const price = superRollPriceCents(r, board);
  const k = started ? bustFaces(board, r.pos) : 0;
  const sb = $('superBtn');
  sb.disabled = busy || !started || price === 0 || price > state.balanceCents;
  if (!started) { $('superLabel').textContent = 'Super Roll'; $('superHint').textContent = 'after your first roll'; }
  else if (price === 0) { $('superLabel').textContent = 'Super Roll'; $('superHint').textContent = 'no red pits in reach'; }
  else {
    $('superLabel').textContent = `Super Roll ${fmtChips(price)}`;
    $('superHint').textContent = price > state.balanceCents ? 'not enough chips' : `blocks ${k} red pit${k === 1 ? '' : 's'}`;
  }
}

function renderResult(r) {
  const stake = r.stakeCents, paid = r.payoutCents, fees = r.feesCents || 0, net = roundNet(r);
  const risk = RISKS[r.risk].label;
  const card = $('resultCard');
  card.className = 'result' + (r.status === STATUS.TOP ? ' top' : r.status === STATUS.BUST ? ' bust' : net > 0 ? ' win' : '');
  let where, title, note;
  if (r.status === STATUS.BUST) {
    where = `Red pit on ${r.pos} · ${risk}`; title = 'Bust';
    note = 'The stake is lost and the round is over.';
  } else if (r.status === STATUS.TOP) {
    where = `Reached 100 · ${risk}`; title = fmtMult(r.multiplier);
    note = 'Top prize!';
  } else if (paid < stake) {
    where = `Took back on square ${r.pos} · ${risk}`; title = fmtMult(r.multiplier);
    note = `You got ${fmtChips(paid)} of your ${fmtChips(stake)} stake back.`;
  } else {
    where = `Cashed out on square ${r.pos} · ${risk}`; title = fmtMult(r.multiplier);
    note = '';
  }
  if (r.timedOut) note = `The round was left for over 10 minutes, so it was cashed out at its current value. ${note}`;
  else if (r.auto && r.status === STATUS.CASHED) note = `Auto Cash-Out reached your ${fmtMult(r.autoTarget)} target. ${note}`;
  if (fees) {
    const n = r.rolls.filter((x) => x.superRoll).length;
    const blocked = r.rolls.filter((x) => x.kind === 'blocked').length;
    note += ` ${n} Super Roll${n === 1 ? '' : 's'} cost ${fmtChips(fees)} chips${blocked ? ` and blocked ${blocked} red pit${blocked === 1 ? '' : 's'}` : ''}; "This round" includes ${n === 1 ? 'it' : 'them'}.`;
  }
  const badges = {
    top: '<svg viewBox="0 0 64 64"><path d="M32 4l8.5 17.5 19 2.7-13.8 13.4 3.3 19L32 47.6 15 56.6l3.3-19L4.5 24.2l19-2.7z" fill="#FFC83D" stroke="#B37400" stroke-width="3" stroke-linejoin="round"/></svg>',
    win: '<svg viewBox="0 0 64 64"><path d="M18 8h28v14a14 14 0 0 1-28 0z" fill="#FFC83D" stroke="#B37400" stroke-width="3"/><path d="M18 12H9v5a9 9 0 0 0 9 9M46 12h9v5a9 9 0 0 1-9 9" fill="none" stroke="#B37400" stroke-width="3"/><path d="M27 36h10v8H27zM20 50h24v6H20z" fill="#FFC83D" stroke="#B37400" stroke-width="3"/></svg>',
    back: '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="24" fill="#E6EBF7" stroke="#8A93B2" stroke-width="3"/><path d="M22 32h20M32 22v0" stroke="#4A5275" stroke-width="5" stroke-linecap="round"/></svg>',
    bust: '<svg viewBox="0 0 64 64"><ellipse cx="32" cy="38" rx="24" ry="17" fill="#6E0B11" stroke="#C81D25" stroke-width="3"/><path d="M20 26l6 18 6-18zM32 26l6 18 6-18z" fill="#FFFFFF" stroke="#E9D6D6" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  };
  const badgeKind = r.status === STATUS.TOP ? 'top' : r.status === STATUS.BUST ? 'bust' : net > 0 ? 'win' : 'back';
  $('resBadge').innerHTML = badges[badgeKind];
  $('resWhere').textContent = where;
  $('resTitle').textContent = title;
  $('resStake').textContent = fmtChips(stake);
  $('resPaidLabel').textContent = paid < stake && r.status === STATUS.CASHED ? 'Returned' : 'Paid';
  $('resPaid').textContent = fmtChips(paid);
  // Count up real wins only (ahead after stake and Super Rolls); anything else stays still.
  if (net > 0 && !state.settings.reducedMotion) countUp($('resPaid'), paid, r.status === STATUS.TOP ? 1400 : 700);
  $('resNet').textContent = fmtSigned(net);
  $('resNet').className = net > 0 ? 'pos' : net < 0 ? 'neg' : '';
  $('resNote').textContent = note.trim();
  $('resNote').hidden = !note.trim();
  $('resPath').textContent = `Rolls: ${r.rolls.map((x) => x.face).join(', ')} · Session net ${fmtSigned(session.netCents)}`;
  const p = state.prefs;
  $('againBtn').textContent = `Bet ${fmtChips(p.stakeCents)} again`;
  $('againBtn').disabled = p.stakeCents > state.balanceCents;
}

function renderAll() {
  renderHeader();
  if (state.activeRound) renderRound(); else renderSetup();
}

// ---------- game flow ----------

async function bet() {
  if (busy || state.activeRound) return;
  const stake = state.prefs.stakeCents;
  if (stake > state.balanceCents) { renderSetup(); return; }
  setupBoard();
  const seeds = state.seeds;
  const round = newRound({ board, stakeCents: stake, nonce: seeds.nonce, serverHash: seeds.serverHash, clientSeed: seeds.clientSeed });
  round.autoTarget = state.prefs.autoOn ? state.prefs.autoTarget : null;
  seeds.nonce += 1;
  store.debit(state, stake, round.id);
  state.activeRound = round;
  autoStopped = false;
  store.save(state);
  tokenEl.classList.remove('token-bust', 'token-pop');
  placeToken(tokenEl, 1);
  $('eventLine').textContent = '';
  $('eventLine').className = 'event';
  showView('round');
  drawBoard();
  renderAll();
  await doRoll();
}

async function doRoll(superRoll = false) {
  const r = state.activeRound;
  if (!r || busy || r.status !== STATUS.ACTIVE) return;
  let feeCents = 0;
  if (superRoll) {
    feeCents = superRollPriceCents(r, board);
    if (!feeCents || feeCents > state.balanceCents) return;
    store.debit(state, feeCents, r.id, 'super-roll');
    renderHeader();
  }
  busy = true;
  drawReach();
  renderRound();
  const face = await rollAt(state.seeds.serverSeed, r.clientSeed, r.nonce, r.rolls.length);
  const { round, roll, path } = applyRoll(r, board, face, { superRoll, feeCents });
  state.activeRound = round;
  store.save(state); // saved before the animation: the outcome is fixed the moment it is rolled
  await animateRoll(face, path, roll);
  busy = false;
  if (round.status !== STATUS.ACTIVE) { finish(round, {}); return; }
  if (state.prefs.autoOn && !autoStopped) {
    if (board.m[round.pos] >= state.prefs.autoTarget) { doCashOut(true); return; }
    drawReach();
    renderRound();
    await sleep(AUTO_GAP_MS);
    if (!autoStopped && state.activeRound === round) { doRoll(); return; }
  }
  drawReach();
  renderRound();
}

function doCashOut(auto = false) {
  const r = state.activeRound;
  if (!r || busy || r.status !== STATUS.ACTIVE || !r.rolls.length) return;
  finish(cashOut(r, board), { auto });
}

function finish(r, { auto = false, timedOut = false }) {
  const done = { ...r, auto, timedOut, endedAt: Date.now() };
  if (done.payoutCents > 0) store.credit(state, done.payoutCents, done.id);
  // Session net counts each finished round's full result (payout − stake − Super Rolls), including
  // a round resumed after a reload whose stake was taken in an earlier session.
  session.netCents += roundNet(done);
  store.pushHistory(state, done);
  state.activeRound = null;
  store.save(state);
  if (done.status === STATUS.BUST) tokenEl.classList.add('token-bust');
  drawReach();
  renderHeader();
  renderResult(done);
  showView('result');
  if (roundNet(done) > 0) {
    celebrate(done.multiplier, done.status === STATUS.TOP);
    if (!state.settings.reducedMotion) floatText(done.pos, `+${fmtChips(roundNet(done))}`);
  }
  maybeRealityCheck();
}

async function animateRoll(face, path, roll) {
  const t0 = performance.now();
  const die = $('die');
  const ev = $('eventLine');
  ev.className = 'event';
  ev.textContent = 'Rolling…';
  const reduced = state.settings.reducedMotion;
  if (!reduced) {
    die.classList.add('rolling');
    for (let i = 0; i < 5; i++) { die.dataset.face = String(1 + Math.floor(Math.random() * 6)); await sleep(55); }
    die.classList.remove('rolling');
  } else {
    await sleep(200);
  }
  die.dataset.face = String(face);
  ev.textContent = roll.superRoll ? `Super Roll: rolled a ${face}` : `Rolled a ${face}`;
  tokenEl.classList.toggle('shielded', !!roll.superRoll);

  if (reduced) placeToken(tokenEl, roll.landed, 250);
  else for (const sq of path) { placeToken(tokenEl, sq, 90); hop(); await sleep(100); }
  await sleep(60);

  if (roll.kind === 'blocked') {
    ev.textContent = `Super Roll blocked the red pit on ${roll.landed}! Back to square ${roll.final}`;
    ev.className = 'event good';
    shieldBlock(roll.landed);
    await sleep(reduced ? 150 : 300);
    placeToken(tokenEl, roll.final, reduced ? 250 : 380);
    if (!reduced) hop();
    await sleep(reduced ? 260 : 400);
  } else if (roll.kind === 'ladder' || (roll.kind === 'top' && roll.landed !== N)) {
    ev.textContent = `Ladder! Up from ${roll.landed} to ${roll.final}`;
    ev.className = 'event good';
    placeToken(tokenEl, roll.final, reduced ? 250 : 420);
    await sleep(reduced ? 260 : 440);
    if (!reduced) sparkle(roll.final);
    tokenEl.classList.add('token-pop');
    setTimeout(() => tokenEl.classList.remove('token-pop'), 500);
  } else if (roll.kind === 'slide') {
    ev.textContent = `Snake! Slide down from ${roll.landed} to ${roll.final}`;
    if (reduced) { placeToken(tokenEl, roll.final, 250); await sleep(260); }
    else await slideAlongSnake(roll.landed, roll.final, 600);
  } else if (roll.kind === 'bust') {
    ev.textContent = `Red pit on ${roll.landed}: bust`;
    ev.className = 'event bad';
    tokenEl.classList.add('token-bust');
    flashSquare(roll.landed);
    await sleep(400);
  }
  if (roll.kind === 'top') { ev.textContent = 'You reached 100!'; ev.className = 'event good'; }
  else if (roll.kind === 'move') ev.textContent = `${roll.superRoll ? 'Super Roll: rolled' : 'Rolled'} a ${face}: square ${roll.final}, worth ${fmtMult(board.m[roll.final])}`;

  const left = MIN_ROLL_MS - (performance.now() - t0);
  if (left > 0) await sleep(left);
  tokenEl.classList.remove('shielded');
}

/** A shield bursts over the red pit it blocked. */
function shieldBlock(sq) {
  const { x, y } = squareCenter(sq);
  fxBurst(`<g class="shield-pop" style="transform-origin:${x}px ${y}px">` +
    `<circle cx="${x}" cy="${y}" r="52" fill="rgba(120,180,255,0.35)" stroke="#FFFFFF" stroke-width="6"/>` +
    `<path transform="translate(${x - 26} ${y - 30}) scale(2.2)" d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" fill="#5B8CFF" stroke="#FFFFFF" stroke-width="2.2" stroke-linejoin="round"/>` +
    `<path transform="translate(${x - 26} ${y - 30}) scale(2.2)" d="M8.5 12 11 14.5 15.5 9.5" fill="none" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</g>`, 900);
}

function hop() {
  tokenEl.querySelector('.token-hop')?.animate(
    [{ transform: 'translateY(0) scale(1, 1)' }, { transform: 'translateY(-30px) scale(0.95, 1.06)', offset: 0.45 }, { transform: 'translateY(0) scale(1.08, 0.92)', offset: 0.85 }, { transform: 'translateY(0) scale(1, 1)' }],
    { duration: 100, easing: 'ease-out' },
  );
}

/** Ride the snake's own body from head to tail. */
function slideAlongSnake(head, tail, ms) {
  const path = document.getElementById(`snake-${head}`);
  if (!path) { placeToken(tokenEl, tail, 600); return sleep(620); }
  const len = path.getTotalLength();
  return new Promise((resolve) => {
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const pt = path.getPointAtLength(len * e);
      placeTokenAt(tokenEl, pt.x, pt.y);
      if (t < 1) requestAnimationFrame(step);
      else { placeToken(tokenEl, tail); resolve(); }
    };
    requestAnimationFrame(step);
  });
}

function fxBurst(markup, ms) {
  const fx = $('fxLayer');
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.innerHTML = markup;
  fx.appendChild(g);
  setTimeout(() => g.remove(), ms);
}

function sparkle(sq) {
  const { x, y } = squareCenter(sq);
  let s = '';
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2, d = 55 + (i % 2) * 15;
    s += `<circle class="spark" cx="${x}" cy="${y}" r="${i % 2 ? 6 : 9}" fill="${i % 3 ? '#FFC83D' : '#FFFFFF'}" style="--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px"/>`;
  }
  fxBurst(s, 700);
}

function flashSquare(sq) {
  const { x, y } = squareCenter(sq);
  fxBurst(`<rect class="bust-flash" x="${x - 50}" y="${y - 50}" width="100" height="100" rx="18" fill="#FF3B3F"/>`, 700);
}

/** Rising "+2.55" over the board after a winning cash-out. */
function floatText(sq, text) {
  const { x, y } = squareCenter(sq);
  fxBurst(`<text class="float-text" x="${x}" y="${y - 40}" text-anchor="middle">${text}</text>`, 1300);
}

function countUp(el, cents, ms) {
  const t0 = performance.now();
  const tick = (now) => {
    const t = Math.min(1, (now - t0) / ms);
    el.textContent = fmtChips(Math.round(cents * (1 - Math.pow(1 - t, 3))));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function celebrate(mult, top) {
  if (state.settings.reducedMotion) return;
  const box = $('confetti');
  const count = top ? 140 : Math.min(90, Math.round(10 + 22 * Math.log10(mult)));
  const colors = ['#7BC043', '#2E7D4F', '#FFC83D', '#F28C28', '#A6DD8F', '#C9B04A']; // falling leaves
  let html = '';
  for (let i = 0; i < count; i++) {
    html += `<i style="left:${Math.random() * 100}%;background:${colors[i % colors.length]};animation-delay:${Math.random() * 0.5}s;animation-duration:${1.2 + Math.random()}s"></i>`;
  }
  box.innerHTML = html;
  setTimeout(() => { box.innerHTML = ''; }, 2600);
}

// ---------- tooltip ----------

function squareInfo(n) {
  if (board.biters.has(n)) return `Square ${n}: red pit, bust`;
  if (board.ladders[n]) return `Square ${n}: ladder up to ${board.ladders[n]} (${fmtMult(board.m[board.ladders[n]])})`;
  if (board.sliders[n]) return `Square ${n}: snake down to ${board.sliders[n]} (${fmtMult(board.m[board.sliders[n]])})`;
  if (n === 1) return 'Start';
  if (n === N) return `Square 100: top prize ${fmtMult(board.m[N])}`;
  return `Square ${n}: ${fmtMult(board.m[n])}`;
}

function showTooltip(n) {
  const tip = $('tooltip');
  const r = Math.floor((n - 1) / 10);
  let c = (n - 1) % 10;
  if (r % 2) c = 9 - c;
  tip.textContent = squareInfo(n);
  tip.style.left = `${Math.min(88, Math.max(12, c * 10 + 5))}%`;
  const rowFromTop = 9 - r;
  if (rowFromTop < 2) { tip.style.top = `${rowFromTop * 10 + 10}%`; tip.style.transform = 'translate(-50%, 10px)'; }
  else { tip.style.top = `${rowFromTop * 10}%`; tip.style.transform = 'translate(-50%, calc(-100% - 6px))'; }
  tip.hidden = false;
  clearTimeout(tooltipTimer);
  tooltipTimer = setTimeout(() => { tip.hidden = true; }, 2600);
}

// ---------- dialogs ----------

function openDialog(kind) {
  const body = $('dialogBody');
  const titles = { history: 'History', fair: 'Provably fair', rules: 'Rules & odds', settings: 'Settings', reality: 'Time check' };
  $('dialogTitle').textContent = titles[kind];
  body.innerHTML = { history: historyHtml, fair: fairHtml, rules: rulesHtml, settings: settingsHtml, reality: realityHtml }[kind]();
  if (!dialog.open) dialog.showModal();
  if (kind === 'history') verifyHistory();
}

function historyHtml() {
  if (!state.history.length) return '<p>No rounds yet.</p>';
  const rows = state.history.slice(0, 50).map((r, i) => {
    const time = new Date(r.endedAt || r.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const supers = r.rolls.filter((x) => x.superRoll).length;
    const res = (r.status === STATUS.BUST ? 'Bust' : r.status === STATUS.TOP ? `Top ${fmtMult(r.multiplier)}` : r.payoutCents < r.stakeCents ? `Took back ${fmtMult(r.multiplier)}` : fmtMult(r.multiplier)) +
      (supers ? ` · ${supers} Super Roll${supers === 1 ? '' : 's'} (${fmtChips(r.feesCents)})` : '');
    const net = roundNet(r);
    return `<tr><td>${time}</td><td>${RISKS[r.risk].label}</td><td>${fmtChips(r.stakeCents)}</td><td>${res}</td>` +
      `<td class="${net > 0 ? 'ok' : net < 0 ? 'bad' : ''}">${fmtSigned(net)}</td><td>${r.rolls.map((x) => x.face).join(' ')}</td>` +
      `<td id="vf-${i}">${state.revealed[r.serverHash] ? 'checking…' : 'after seed change'}</td></tr>`;
  }).join('');
  return `<p>Your last ${Math.min(50, state.history.length)} rounds. Rounds can be verified once their server seed is revealed (Fair → Change seed).</p>` +
    `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Risk</th><th>Stake</th><th>Result</th><th>Net</th><th>Rolls</th><th>Verified</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

async function verifyHistory() {
  const list = state.history.slice(0, 50);
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    const seed = state.revealed[r.serverHash];
    if (!seed) continue;
    const faces = await rollsFor(seed, r.clientSeed, r.nonce, r.rolls.length);
    const ok = faces.every((f, k) => f === r.rolls[k].face);
    const cell = document.getElementById(`vf-${i}`);
    if (cell) cell.innerHTML = ok ? '<span class="ok">✓ matches</span>' : '<span class="bad">✗ mismatch</span>';
  }
}

function fairHtml() {
  const s = state.seeds;
  const revealed = Object.entries(state.revealed).slice(-5).reverse().map(([h, seed]) =>
    `<li><span class="mono">hash ${escapeHtml(h)}</span><br><span class="mono">seed ${escapeHtml(seed)}</span></li>`).join('');
  return `
    <p>Every roll comes from your seeds, fixed before you bet. Each die roll is HMAC-SHA256(server seed, "client seed:round:roll"), and only bytes under 252 are used, so all six faces are equally likely.</p>
    <p><b>This play-money version makes the server seed in your browser.</b> A real-money version would keep it on a server.</p>
    <h3>Current seeds</h3>
    <p>Server seed hash: <span class="mono">${escapeHtml(s.serverHash)}</span></p>
    <div class="field"><label for="clientSeedInput">Your client seed</label><input id="clientSeedInput" value="${escapeHtml(s.clientSeed)}" maxlength="64"></div>
    <p>Rounds played on this seed: ${s.nonce}</p>
    <button class="btn btn-blue" id="rotateBtn" ${state.activeRound ? 'disabled' : ''}>Change seed and reveal the old one</button>
    ${state.activeRound ? '<p class="hint">Finish the current round first.</p>' : ''}
    <h3>Revealed seeds</h3>
    ${revealed ? `<ul>${revealed}</ul>` : '<p>None yet.</p>'}
    <h3>Check any round</h3>
    <div class="field"><label for="vSeed">Server seed</label><input id="vSeed"></div>
    <div class="field"><label for="vClient">Client seed</label><input id="vClient"></div>
    <div class="row-gap"><div class="field"><label for="vNonce">Round number</label><input id="vNonce" type="number" min="0" value="0"></div>
    <div class="field"><label for="vCount">Rolls</label><input id="vCount" type="number" min="1" max="200" value="10"></div></div>
    <button class="btn btn-ghost" id="verifyBtn">Show rolls</button>
    <p id="verifyOut" class="mono"></p>`;
}

function rulesHtml() {
  const rows = Object.values(RISKS).map((r) => {
    const b = getBoard(r.id, CLASSIC_LADDERS);
    return `<tr><td>${r.label}</td><td>${r.biters.length}</td><td>${fmtMult(b.top)}</td><td>${fmtOdds(b.topOdds)}</td></tr>`;
  }).join('');
  return `
    <h3>How to play</h3>
    <ol>
      <li>Pick a risk level and a stake, then press Bet. The first roll happens straight away.</li>
      <li>Every square has a value. Landing on a ladder climbs it; a snake slides you down but you keep playing; a red pit is a bust and the stake is lost.</li>
      <li>After each roll, cash out at your square's value or roll again.</li>
      <li>Go past 100 and you bounce back. Landing exactly on 100 wins the top prize.</li>
    </ol>
    <h3>The odds</h3>
    <p>Each square's value comes from its real chance of reaching 100. Rolling again has the same average value as cashing out, so no way of playing beats the house: the return to player is up to 97% on every risk level, however you play. Your choices change how risky a round is, not the price.</p>
    <div class="table-wrap"><table><thead><tr><th>Risk</th><th>Red pits</th><th>Top prize (classic)</th><th>Reach 100 if you never cash out</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p>Shuffled ladders get new values worked out the same way, with the same 97% return. The top prize stays within 60–160% of the classic one.</p>
    <h3>Super Roll</h3>
    <p>After your first roll you can pay for a Super Roll: if the die lands on a red pit, the pit is blocked and you stay on your square instead of busting. The button shows the price in chips before you press it. It isn't offered when no red pit is in reach.</p>
    <p>The price is what the protection is worth: your stake × your square's value × the share of die faces that would bust, ÷ 0.97. So a Super Roll returns 97% like everything else in the game. It makes a round safer, but it doesn't make the game cheaper or more expensive to play. Its cost counts in the round's result and your session net.</p>
    <h3>Auto Cash-Out</h3>
    <p>Set a target and the current round rolls by itself until it reaches the target, busts or hits 100. You can stop it at any time. Every new round still needs its own Bet press.</p>
    <h3>Play money</h3>
    <p>Chips have no cash value and can't be bought or cashed out. If you run low you can refill to 1,000 chips once a day.</p>`;
}

function settingsHtml() {
  const s = state.settings;
  const sv = s.showValues === true ? 'on' : s.showValues === false ? 'off' : s.showValues;
  return `
    <div class="field"><label for="setValues">Show values on the board</label>
      <select id="setValues"><option value="auto" ${sv === 'auto' ? 'selected' : ''}>When the board is big enough</option><option value="on" ${sv === 'on' ? 'selected' : ''}>Always</option><option value="off" ${sv === 'off' ? 'selected' : ''}>Never (tap a square instead)</option></select></div>
    <label class="row-between"><span><b>Reduced motion</b><br><span class="hint">Simpler animation. Rolls still take 1 second.</span></span><input type="checkbox" role="switch" class="switch" id="setMotion" ${s.reducedMotion ? 'checked' : ''}></label>
    <div class="field"><label for="setReality">Time check</label>
      <select id="setReality">${[15, 30, 60, 0].map((m) => `<option value="${m}" ${s.realityMinutes === m ? 'selected' : ''}>${m ? `Every ${m} minutes` : 'Off'}</option>`).join('')}</select></div>
    <button class="btn btn-ghost" id="resetBtn">Reset play money and history</button>`;
}

function realityHtml() {
  return `<p>You've played for <b>${fmtClock(Date.now() - session.start)}</b>.</p>
    <p>Session net: <b class="${session.netCents >= 0 ? 'ok' : 'bad'}">${fmtSigned(session.netCents)} chips</b>.</p>
    <div class="actions"><button class="btn btn-ghost btn-big" id="breakBtn">Take a break</button><button class="btn btn-blue btn-big" id="keepBtn">Keep playing</button></div>`;
}

function maybeRealityCheck() {
  const mins = state.settings.realityMinutes;
  if (!mins || busy || dialog.open) return;
  if (Date.now() >= session.nextRealityAt) {
    session.nextRealityAt = Date.now() + mins * 60000;
    openDialog('reality');
  }
}

// ---------- events ----------

function bindEvents() {
  $('riskButtons').addEventListener('click', (e) => {
    const b = e.target.closest('[data-risk]');
    if (!b || state.activeRound) return;
    state.prefs.risk = b.dataset.risk;
    store.save(state); setupBoard(); drawBoard(); renderSetup();
  });
  $('stakeChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-stake]');
    if (!b) return;
    state.prefs.stakeCents = +b.dataset.stake;
    store.save(state); renderSetup();
  });
  const stepStake = (dir) => {
    const i = STAKES.indexOf(state.prefs.stakeCents);
    const next = STAKES[Math.max(0, Math.min(STAKES.length - 1, (i < 0 ? 2 : i) + dir))];
    state.prefs.stakeCents = next; store.save(state); renderSetup();
  };
  $('stakeDown').addEventListener('click', () => stepStake(-1));
  $('stakeUp').addEventListener('click', () => stepStake(1));

  $('shuffleBtn').addEventListener('click', () => {
    const risk = state.prefs.risk;
    state.prefs.ladders[risk] = shuffleLadders(risk);
    store.save(state); setupBoard(); drawBoard(); renderSetup();
    $('board').animate([{ transform: 'scale(0.97) rotate(-1deg)' }, { transform: 'none' }], { duration: 260, easing: 'ease-out' });
  });
  $('classicBtn').addEventListener('click', () => {
    delete state.prefs.ladders[state.prefs.risk];
    store.save(state); setupBoard(); drawBoard(); renderSetup();
  });

  $('autoToggle').addEventListener('change', (e) => { state.prefs.autoOn = e.target.checked; store.save(state); renderSetup(); });
  $('autoTarget').addEventListener('change', (e) => {
    let v = parseFloat(e.target.value);
    if (!Number.isFinite(v)) v = 2;
    v = Math.round(Math.min(Math.max(v, 1.01), board.top) * 100) / 100;
    state.prefs.autoTarget = v; store.save(state); renderSetup();
  });

  $('betBtn').addEventListener('click', bet);
  $('againBtn').addEventListener('click', bet);
  $('changeBetBtn').addEventListener('click', () => { setupBoard(); drawBoard(); placeToken(tokenEl, 1); tokenEl.classList.remove('token-bust'); showView('setup'); renderSetup(); });
  $('rollBtn').addEventListener('click', () => doRoll());
  $('cashBtn').addEventListener('click', () => doCashOut(false));
  $('stopAutoBtn').addEventListener('click', () => { autoStopped = true; renderRound(); });
  $('superBtn').addEventListener('click', () => doRoll(true));
  $('refillBtn').addEventListener('click', () => { store.refill(state); store.save(state); renderAll(); });

  $('boardSvg').addEventListener('click', (e) => {
    const cell = e.target.closest('[data-sq]');
    if (cell) showTooltip(+cell.dataset.sq);
  });

  document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openDialog(b.dataset.open)));
  $('dialogClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', async (e) => {
    const id = e.target.id;
    if (id === 'rotateBtn') {
      if (state.activeRound) return;
      const old = state.seeds;
      state.revealed[old.serverHash] = old.serverSeed;
      const client = ($('clientSeedInput')?.value || '').trim() || old.clientSeed;
      state.seeds = await newSeedPair(client);
      store.save(state); renderHeader(); openDialog('fair');
    } else if (id === 'verifyBtn') {
      const seed = $('vSeed').value.trim(), client = $('vClient').value.trim();
      const nonce = Math.max(0, parseInt($('vNonce').value, 10) || 0);
      const count = Math.min(200, Math.max(1, parseInt($('vCount').value, 10) || 1));
      $('verifyOut').textContent = seed && client ? `Rolls: ${(await rollsFor(seed, client, nonce, count)).join(' ')}` : 'Enter a server seed and a client seed.';
    } else if (id === 'resetBtn') {
      if (state.activeRound || !confirm('Reset chips to 1,000 and clear your history?')) return;
      Object.assign(state, store.defaultState(), { seeds: await newSeedPair() });
      store.save(state); session.netCents = 0; dialog.close(); setupBoard(); drawBoard(); showView('setup'); renderAll();
    } else if (id === 'keepBtn' || id === 'breakBtn') {
      dialog.close();
      if (id === 'breakBtn') { showView('setup'); renderSetup(); }
    }
  });
  dialog.addEventListener('change', (e) => {
    const id = e.target.id;
    if (id === 'setValues') { state.settings.showValues = e.target.value; drawBoard(); }
    if (id === 'setMotion') state.settings.reducedMotion = e.target.checked;
    if (id === 'setReality') {
      state.settings.realityMinutes = +e.target.value;
      session.nextRealityAt = Date.now() + state.settings.realityMinutes * 60000;
    }
    store.save(state);
  });

  new ResizeObserver(() => { if (board && showValuesNow() !== lastShowValues) drawBoard(); }).observe($('board'));

  setInterval(() => {
    $('sessionTime').textContent = fmtClock(Date.now() - session.start);
    if (!state.activeRound) maybeRealityCheck();
  }, 1000);
}

// ---------- start ----------

async function init() {
  if (!state.seeds) state.seeds = await newSeedPair();
  if (state.settings.reducedMotion === undefined) state.settings.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  session.nextRealityAt = Date.now() + (state.settings.realityMinutes || 30) * 60000;
  $('boardDefs').innerHTML = defsMarkup();
  tokenEl.innerHTML = tokenMarkup();
  bindEvents();

  const ar = state.activeRound;
  if (ar) {
    board = getBoard(ar.risk, ar.ladders);
    drawBoard();
    placeToken(tokenEl, ar.rolls.length ? ar.pos : 1);
    if (ar.rolls.length && Date.now() - ar.updatedAt > ROUND_TIMEOUT_MS) {
      finish(cashOut(ar, board), { timedOut: true });
      return;
    }
    showView('round');
    renderAll();
    if (!ar.rolls.length) doRoll();
    else {
      $('die').dataset.face = String(ar.rolls[ar.rolls.length - 1].face);
      $('eventLine').textContent = 'Welcome back: your round is still on.';
    }
    return;
  }
  setupBoard();
  drawBoard();
  placeToken(tokenEl, 1);
  showView('setup');
  renderAll();
  store.save(state);
}

init();

// Offline support when installed (service workers need https or localhost).
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
}
