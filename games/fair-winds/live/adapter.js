/* Magellan Live — adapter between the shared voyage engine (engine.js) and the Fair Winds renderer (fw-render.js).
 * Every frame it sets the renderer's state (R, SC) from the voyage on the clock: route progress, weather, the one ship
 * (docked, sailing, lost, or anchored home) and the end-of-voyage effects.
 * Parts copied from Fair Winds' frame(), simStep(), sinkShip(), buildMini()/drawMini() and drawChart() are marked "(Fair Winds: …)". */
"use strict";
const ML = window.MagLive;
const LIVE = { key: null, pendingSinks: [], miniCv: null, chartCv: null, miniBase: null, chartBase: null, mini: null, stormObj: null, zoneObj: null };

// (Fair Winds: later/runLater) small timers on the scene clock
const LATER = [];
function later(sec, f) { LATER.push({ at: SC.t + sec, f }); }
function runLater() { for (let i = 0; i < LATER.length; i++) if (LATER[i].at <= SC.t) { const f = LATER[i].f; LATER.splice(i--, 1); try { f(); } catch (e) { setTimeout(() => { throw e; }); } } }

function liveLonLat() { const p = ML.posAt(SC.p); return [p.lon, p.lat]; }

function liveInit() {
  cv = $("scene"); cx = cv.getContext("2d");
  LIVE.miniCv = $("mini"); LIVE.chartCv = $("chart");
  liveResize();
  new ResizeObserver(liveResize).observe(cv);
}
// (Fair Winds: resize)
function liveResize() {
  DPR = Math.min(2, devicePixelRatio || 1);
  W = cv.clientWidth || 800; H = cv.clientHeight || 500; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  for (const c of [LIVE.miniCv, LIVE.chartCv]) { c.width = Math.round(c.clientWidth * DPR); c.height = Math.round(c.clientHeight * DPR); }
  LIVE.miniBase = null; LIVE.chartBase = null;
  if (!R || R.state === "count") SC.portX = portHome();
  const sl = slotsFor(SC.ships.length); SC.ships.forEach((s, i) => { if (sl[i]) s.hx = sl[i].x; });
}

/* ---------- a new voyage: the ship docks at Sanlúcar ---------- */
function liveBegin(Rd, st, now) {
  const h = n => parseInt(Rd.hash.slice(n, n + 8), 16);
  // each voyage its own sea and its own hour of the day (from its hash, so every screen agrees)
  R = { v: Object.assign({}, LIVE_VOYAGE, { theme: ["atlantic", "pacific", "tropical"][h(40) % 3] }),
    state: "count", t0: null, rng: mulberry32(h(48)), boost: 1, reg: null, zone: null, inStorm: null, storms: [],
    home: false, finale: false, showResult: false, Rd, day0: (h(32) % 1000) / 1000 * .55 };
  SC.landing = null; SC.prizeFx = null; SC.raiders = []; SC.bergs = []; SC.reefs = []; SC.nears = []; SC.tentacles = []; SC.waves = []; SC.rogues = []; SC.whales = [];
  SC.far = []; SC.parts = []; SC.ambN = 0; SC.bolts = []; SC.coinRain = 0; SC.fwUntil = 0; SC.twk = 0; SC.fount = 0;
  buildSprites(LIVE_VOYAGE.ships.map((n, i) => ({ type: "plain", design: LIVE_VOYAGE.designs[i], sz: LIVE_VOYAGE.sizes[i] })), LIVE_VOYAGE.design);
  SC.ships.forEach(s => { s.state = "dock"; s.anch = SC.t - 1; });   // riding at anchor off the beach (the cable already hangs slack)
  SC.portX = portHome(); SC.p = 0; SC.mirrorPort = false;
  LIVE.pendingSinks = []; LIVE.stormObj = null; LIVE.zoneObj = null; LIVE.key = Rd.key; LIVE.mini = null;
  if (st.phase === "board") return;
  // joining part-way through a voyage: put the scene where everyone else already is
  const el = now - Rd.sailStart;
  R.state = "sailing"; R.t0 = SC.t - 30;
  SC.ships.forEach(s => { s.state = "sail"; s.anch = null; });
  SC.p = ML.fAt(Rd, Math.min(el, Rd.crashMs));
  SC.portX = SC.p > .02 ? -(260 * portScale() + 600) : portHome();
  if (st.phase === "result") liveEnd(Rd, now);
}

/* ---------- the end: lost together, or home at ×1000 ---------- */
function liveEnd(Rd, now) {
  R.state = "done"; R.showResult = true; R.home = Rd.home;
  const fresh = now - Rd.crashAt < 2500;
  if (Rd.home) {
    SC.ships.forEach(s => { if (s.state === "sail") { s.state = "arrive"; s.st = fresh ? 0 : 4; s.anch = fresh ? null : SC.t; } });
    if (fresh) liveCelebrate();
    return;
  }
  // a ×1.00 voyage is lost the instant she sails, so the sailing stage never comes and she is still moored: she casts off here
  // and goes down just off the quay (as in Fair Winds, where she is lost on the voyage's first step; near port that is shoals,
  // a wave or lightning, never a monster: pickCause/nearPort)
  const quay = SC.ships.filter(s => s.state === "dock");
  if (quay.length && fresh) { R.t0 = SC.t; quay.forEach(s => { s.state = "sail"; liveWeigh(s); }); sfx("go"); sfx("bell"); }   // R.t0: she surges off her berth
  const afloat = SC.ships.filter(s => s.state === "sail" || s.state === "dock");
  if (!fresh) { afloat.forEach(s => (s.state = "gone")); return; }
  const cause = pickCause(), at = SC.t + (quay.length ? .5 : 0);   // half a second under way first, so she is seen to leave
  afloat.forEach(s => LIVE.pendingSinks.push({ s, at, cause }));
}
// "Sail!": the anchor comes up out of the water where it lay (a ring and a few drips, as when Fair Winds lets one go) and the cable is gone
function liveWeigh(s) {
  if (s.anch && s.anX != null && !calm()) { const L = s.row ? 3 : 2, y = wy(L, s.anX) + 2;
    spawn({ k: "ring", z: L, x: s.anX, y, vx: 0, vy: 0, life: .8, max: .8, r: 4, L });
    for (let k = 0; k < 5; k++) spawn({ k: "spray", z: L, x: s.anX, y, vx: (Math.random() - .5) * 50, vy: -30 - Math.random() * 40, life: .5, max: .5, r: 1.4 }); }
  s.anch = null;
}
// (Fair Winds: sinkShip, the sprite part)
function liveSink(sh, cause) {
  sh.state = "sink"; sh.st = 0; sh.cause = cause; sh.sc0 = null;
  const P = shipPose(sh), L = P.L, dS = sh.row ? 1 : .74;
  if (cause === "lightning") bolt(P.x + (Math.random() - .5) * 40, 0, P.x, P.y - P.h * .7);
  if (cause === "kraken") {
    SC.tentacles.push({ L, ship: sh, x: P.x, bw: P.bw, h: P.h, t: 0, side: P.x < W * .5 ? 1 : -1,
      arms: [{ ty: "over", bx: -.2, c2: [-.1, -.78], tip: [-.3, .02] }, { ty: "over", bx: .26, c2: [.32, -.72], tip: [.13, .04] }, { ty: "end", bx: -.56, c2: [-.54, -.8], tip: [-.3, -.26] }, { ty: "end", bx: .58, c2: [.58, -.76], tip: [.34, -.24] }, { ty: "wave", bx: -.84 }, { ty: "wave", bx: .88 }]
        .map((a, n) => Object.assign(a, { len: P.h * (a.ty === "wave" ? 1.05 + Math.random() * .3 : 1.2 + Math.random() * .25), w: P.bw * (.135 + Math.random() * .03), ph: Math.random() * 6, delay: [.1, .16, .04, .08, 0, .2][n] + Math.random() * .04, out: a.ty === "wave" ? 1.66 : 1.58 })) });
    sfx("whale");
  }
  if (cause === "wave") rogueHit(sh);
  if (cause === "whale") { SC.whales.push({ L, x: P.x, y: wy(L, P.x) + 40 * dS, t: 0, dur: 1.6, h: P.h * 2.2, s: clamp(W / 900, .5, 1) * .9 * dS }); sfx("whale"); SC.shake = Math.max(SC.shake, 1); }
  if (cause === "iceberg") SC.bergs.push({ L, x0: W + 140, tx: P.x + P.bw * .5, x: W + 140, y: wy(L, P.x) + 6, s: P.bw / 100, t: 0, hit: false });
  if (cause === "pirates") {
    const pz = (R.reg && R.reg.pirates) || PIRATE_WATERS[1], big = pz.ship === "Lanong" ? 1.2 : 1.05;
    sh.shot = pz.shot; SC.raiders.push({ ship: pz.ship, shot: pz.shot, x0: W + 100, tx: W - P.bw * big * .58, x: W + 100, L, bw: P.bw * big, h: P.h * big, t: 0, fired: 0, target: { x: P.x, y: P.y }, vic: sh });
  }
  if (cause === "reef") { const d = Math.sign(P.fx || 1); sh.sc0 = SC.scroll; SC.reefs.push({ L, sc0: SC.scroll, x: P.x + d * P.bw * .2, w: P.bw * .68, h: P.h * .52, t: 0, d, seed: 1 + Math.floor(Math.random() * 1e6), kind: rockKind() }); sfx("crack"); }
  later(.35 + Math.max(0, -sh.st), () => { sfx("sink"); const bx = sh.state === "sink" ? shipPose(sh).x : P.x; for (let k = 0; k < 10; k++) spawn({ k: "bubble", z: L, x: bx + (Math.random() - .5) * P.bw * .6, y: wy(L, bx) + 8 + Math.random() * 10, vx: (Math.random() - .5) * 20, vy: -14 - Math.random() * 16, life: 1.4, max: 1.4, r: 2 + Math.random() * 4 }); });
  if (cause !== "iceberg") SC.shake = Math.max(SC.shake, .7);   // a berg's jolt waits for the strike (drawBergs)
}
// (Fair Winds: landfallFx + the finale's fireworks and coin rain)
function liveCelebrate() {
  if (!calm()) for (let k = 0; k < 80; k++) spawn({ k: "confetti", x: W * (.3 + Math.random() * .5), y: H * .15, vx: (Math.random() - .5) * 220, vy: -60 - Math.random() * 160, life: 2.5, max: 2.5, c: ["#ffc93c", "#ff5a3c", "#7fe6ff", "#9b6cff", "#2fd27a"][k % 5] });
  SC.coinRain = SC.t + 3.5; SC.fwUntil = SC.t + 7; SC.fwNext = 0; SC.winGlow = 1; SC.twk = SC.t + 4;
  sfx("fanfare");
}
// the player's own cash-out (Fair Winds: shipLeaveFx): a gold ring and glints at the ship, which sails on (everyone else is still aboard);
// the coins themselves fly to the wallet (game.js). Returns where the ship is, in canvas pixels.
function liveCashFx(big) {
  const s = SC.ships[0];
  let x = W * .43, y = H * .6;
  if (s && s.state === "sail") { const P = shipPose(s); x = P.x; y = P.y - P.h * .5;
    if (!calm()) { spawn({ k: "ring", z: P.L, x: P.x, y: P.y - P.h * .35, vx: 0, vy: 0, life: .6, max: .6, r: P.bw * .3, L: P.L, gold: true });
      for (let k = 0; k < 3; k++) spawn({ k: "spark", gold: true, z: P.L, x: P.x + (Math.random() - .5) * P.bw * .5, y: P.y - P.h * (.6 + Math.random() * .4), vx: (Math.random() - .5) * 20, vy: -20 - Math.random() * 20, life: .5, max: .5, r: 2.5 + Math.random() * 1.5 }); } }
  if (big && !calm()) SC.twk = SC.t + 1.5;
  return { x, y };
}
// a checkpoint passed: sparks round the multiplier (Fair Winds: milestone)
function liveMilestone() {
  sfx("mile");
  const mx = W / 2, my = H * .26;
  for (let k = 0; k < 12; k++) { const a = k / 12 * 6.283, v = 110 + Math.random() * 80; spawn({ k: "spark", x: mx + Math.cos(a) * 30, y: my + Math.sin(a) * 18, vx: Math.cos(a) * v, vy: Math.sin(a) * v * .6 - 40, life: .7, max: .7, r: 1.8 + Math.random() * 2 }); }
}

/* ---------- weather from the shared schedule (Fair Winds: simStep, the scene part) ---------- */
function liveWeather(Rd, el) {
  const fx = W * .43, w = Math.max(320, W * .95);
  // each storm crosses the screen in its own 11–15 s; its centre passes the fleet at the moment the engine's boost peaks
  R.storms = Rd.storms.filter(s => el >= s.t0 && el < s.t0 + s.dur * 1.3).map(s => {
    const v = (W + w + 40) / s.dur;
    return { kind: s.kind, w, x: fx - w / 2 - (el - s.tc) * v, vx: -v * 1000, ph: s.ph };
  });
  let darkest = 0;
  for (const s of R.storms) {
    const inside = clamp(Math.min(fx - s.x, s.x + s.w - fx) / (s.w * .18), 0, 1);
    darkest = Math.max(darkest, inside * s.kind.dark, clamp(1 - Math.abs(fx - (s.x + s.w / 2)) / W, 0, 1) * .35 * s.kind.dark);
  }
  const storm = ML.stormAt(Rd, el);
  if (storm && storm !== LIVE.stormObj) { R.stormT = SC.t; if (!LIVE.stormObj) { SC.shake = 1; sfx("thunder"); } }
  LIVE.stormObj = storm; R.inStorm = storm ? { kind: storm.kind } : null;
  const z = ML.zoneAt(SC.p), portGone = SC.portX + 260 * portScale() < 0;
  R.zone = z && (z.kind !== "wind" || portGone) ? z : null;
  if (R.zone && R.zone !== LIVE.zoneObj) R.zoneT = SC.t;
  LIVE.zoneObj = R.zone;
  R.boost = ML.boostAt(Rd, el);
  R.reg = regionNow();
  SC.cold = lerp(SC.cold, R.reg.cold ? 1 : 0, clamp(DT * .8, 0, 1)); SC.tropic = lerp(SC.tropic, R.reg.tropic ? 1 : 0, clamp(DT * .8, 0, 1));
  if (R.reg.pirates && !R.pz) { R.pz = true; R.pzT = SC.t; } if (!R.reg.pirates) R.pz = false;
  SC.storm = lerp(SC.storm, darkest, clamp(DT * 2, 0, 1));
  SC.rough = lerp(SC.rough, R.zone && R.zone.kind === "rough" ? Math.max(0, 1 - SC.storm * 1.2) : 0, clamp(DT * 1.5, 0, 1));
  SC.trade = lerp(SC.trade || 0, R.zone && R.zone.kind === "wind" ? 1 : 0, clamp(DT * 1.2, 0, 1));
  SC.mist = lerp(SC.mist, 0, clamp(DT, 0, 1));
}

/* ---------- the homecoming coast: Sanlúcar again, seen from the sea (mirrored) ---------- */
function liveDrawHome() {
  if (!R || !R.Rd || R.state === "count") return;
  const Rd = R.Rd, x = W * .85 + Math.max(0, ML.msAhead(Rd, CFG_MAX) - sceneryMs(Rd)) * sceneryV();
  if (x > W + 10) return;
  cx.save(); cx.translate(x, 0); cx.scale(-1, 1); SC.mirrorPort = true;
  drawPortSanlucar(0, H * LAY[1].y, portScale(), R.v);
  SC.mirrorPort = false; cx.restore();
}
// Scenery that rolls through: a fixed landscape laid out by when the ship would reach each part of it, moving past
// at one calm pace (it never rises out of the sea or changes shape in place). After a voyage ends it only drifts.
const CFG_MAX = ML.CFG.max;
const sceneryV = () => 60 * clamp(W / 800, .6, 1.3) / 1000;   // px per ms
function sceneryMs(Rd) { const el = (LIVE.now || 0) - Rd.sailStart; return Math.min(el, Rd.crashMs); }   // once the voyage is over (home or lost) the coast stays put (user, 2026-11-14)

/* ---------- every frame ---------- */
function liveUpdate(st, now, dtSec) {
  DT = clamp(dtSec, 0, .25); SC.t += DT; LIVE.now = now; runLater();
  const Rd = st.round;
  if (Rd.key !== LIVE.key) liveBegin(Rd, st, now);
  const el = now - Rd.sailStart;
  if (st.phase === "sail" && R.state === "count") { R.state = "sailing"; R.t0 = SC.t; SC.ships.forEach(s => { if (s.state === "dock") { s.state = "sail"; liveWeigh(s); } }); sfx("go"); sfx("bell"); }
  if (st.phase === "result" && R.state !== "done") liveEnd(Rd, now);
  const sailing = R.state === "sailing";
  if (st.phase !== "board") SC.p = ML.fAt(Rd, Math.min(el, Rd.crashMs));
  R.lnm = SC.p * Math.log(R.v.max);   // how far up the climb (the sky's wind streaks read it)
  if (sailing) liveWeather(Rd, el);
  else { R.boost = 1; R.inStorm = null; R.zone = null; }
  // (Fair Winds: frame) the scene follows the voyage
  // the weather speeds the multiplier up in full, but the scenery never races: at most ×1.6 its plain-sailing pace, eased in
  // when she is lost the scene comes to a stop with her: the sea, the horizon and the land coast to rest within a second, nothing keeps drifting
  // (user, 2026-11-14: "if a boat sinks right away the island should stop moving in the background"; it used to drift on at 18 px/s)
  const lostNow = R.state === "done" && !Rd.home, targetSpeed = sailing ? 80 * Math.min(1.6, 1 + (R.boost - 1) * .5) : 0;
  SC.speed = lerp(SC.speed, targetSpeed, clamp(DT * (lostNow ? 3 : 1.1), 0, 1));
  SC.scroll += SC.speed * DT;
  if (sailing) {
    SC.portX -= SC.speed * 1.6 * DT;
    const gone = -(260 * portScale() + 40); SC.portX = Math.min(SC.portX, lerp(portHome(), gone, ease(clamp(SC.p / .12, 0, 1))));
  } else if (lostNow) SC.portX -= SC.speed * 1.6 * DT;   // the harbour only coasts to a stop with the sea (it used to slide on at 40 px/s)
  // the light: each voyage starts at its own hour and the day keeps turning while it sails
  const tri = x => { x = ((x % 2) + 2) % 2; return x < 1 ? x : 2 - x; };
  SC.nightP = tri(R.day0 + (st.phase === "board" ? 0 : clamp(el, 0, Rd.crashMs + 6000) / 70000));
  if (sailing && SC.cold > .3) for (let n = nPer(SC.cold * .7); n > 0; n--) spawn({ k: "snow", x: Math.random() * W * 1.1 - W * .1, y: -6, vx: 14 + Math.random() * 10, vy: 40 + Math.random() * 30, life: 6, max: 6, r: 1.2 + Math.random() * 1.6, ph: Math.random() * 6 });   // snow drifts ahead on the following wind
  if (!sailing) { SC.trade = lerp(SC.trade || 0, 0, clamp(DT, 0, 1)); SC.storm = lerp(SC.storm, 0, clamp(DT, 0, 1)); SC.rough = lerp(SC.rough, 0, clamp(DT, 0, 1)); SC.mist = lerp(SC.mist, 0, clamp(DT, 0, 1)); }
  // (Fair Winds: frame) sights on the horizon, by region
  if (sailing) { SC.nextFar -= DT; if (SC.nextFar <= 0) { SC.nextFar = 4 + Math.random() * 6;
    const rg = R.reg || {}, shore = SC.portX > -380 * portScale() || SC.p > HOME_P; let types = rg.cold ? ["iceberg", "iceberg", "iceberg", "spout"] : rg.tropic ? ["island", "island", "rocks", "sail", "spout"] : ["rocks", "sail", "spout", "island"];
    if (!rg.traffic) types = types.filter(t => t !== "sail");
    if (!rg.traffic && !rg.tropic) types = types.filter(t => t !== "island");
    if (shore) types = types.filter(t => t !== "iceberg" && t !== "spout");
    if (SC.p > HOME_P) types = [];
    if (!types.length && !rg.pirates) types = shore ? [] : ["rocks"];
    if (rg.pirates && SC.p <= HOME_P) types = types.concat(["pirate", "pirate", "pirate"]);
    if (types.length) SC.far.push({ ship: rg.pirates ? rg.pirates.ship : null, type: types[Math.floor(Math.random() * types.length)], x: W + 80, s: .6 + Math.random() * .6, k: 1, ph: Math.random() * 6 }); } }
  // (Fair Winds: frame) ship timers
  for (const s of SC.ships) {
    if (s.state === "arrive" && !s.anch && s.st > 2.3 + s.i * .3) { s.anch = SC.t; const P = shipPose(s), sg = Math.sign(P.fx || 1), lx = P.bw * (s.kind === "freight" ? 1.14 : 1) * .42 * sg, ly = -P.h * .14, ax = P.x + lx * Math.cos(P.ang) - ly * Math.sin(P.ang) + (P.bw * .12 + (s.gl || 0)) * sg;
      s.anT = s.anch; s.anX = ax; s.anL = 0;   // the cable's sea end (drawShip) stays here; the splash lands under it as the anchor hits the water
      later(.33, () => { if (s.state !== "arrive") return; const ay = wy(P.L, ax) + 2; spawn({ k: "ring", z: P.L, x: ax, y: ay, vx: 0, vy: 0, life: 1, max: 1, r: 5, L: P.L }); for (let k = 0; k < 8; k++) spawn({ k: "spray", z: P.L, x: ax, y: ay, vx: (Math.random() - .5) * 80, vy: -50 - Math.random() * 60, life: .6, max: .6, r: 1.6 }); if (s.i === 0) sfx("splash"); }); }
    if (s.state !== "sail" && s.state !== "dock") { s.st += DT; if (s.state === "leave" && ((s.st > 1 && shipPose(s).x < -shipW() * 1.4) || s.st > 5)) s.state = "gone"; if (s.state === "sink") { sinkFx(s); if (s.st > sinkDur(s)) s.state = "gone"; } }
  }
  for (let i = LIVE.pendingSinks.length - 1; i >= 0; i--) { const p = LIVE.pendingSinks[i]; if (SC.t >= p.at) { LIVE.pendingSinks.splice(i, 1); liveSink(p.s, p.cause); } }
  // (Fair Winds: frame) coin rain, fountain, glints, fireworks
  if (SC.coinRain > SC.t && !calm()) for (let k = 0; k < 2; k++) for (let n = nPer(.28); n > 0; n--) spawn({ k: "coin", x: Math.random() * W, y: -12, vx: (Math.random() - .5) * 50, vy: 140 + Math.random() * 140, life: 3, max: 3, r: 4 + Math.random() * 3, ph: Math.random() * 6 });
  if (SC.twk > SC.t && !calm()) for (let n = nPer(.45); n > 0; n--) spawn({ k: "glint", x: W * (.5 + (Math.random() - .5) * .62), y: H * (.17 + Math.random() * .3), vx: 0, vy: 0, life: .5, max: .5, r: 4 + Math.random() * 6 });
  if (SC.fwUntil > SC.t && !calm()) { SC.fwNext -= DT; if (SC.fwNext <= 0) { SC.fwNext = .25 + Math.random() * .3; firework(W * (.15 + Math.random() * .7), H * (.08 + Math.random() * .22)); } }
  SC.gloom = 0;
  // a short fade back to the harbour between voyages
  const toEnd = Rd.end - now, fromBoard = now - st.boardStart;
  SC.fadeA = st.phase === "result" && toEnd < 450 ? 1 - toEnd / 450 : st.phase === "board" && fromBoard < 450 && fromBoard >= 0 ? 1 - fromBoard / 450 : 0;
  drawScene(); liveDrawMini(); liveDrawChart(st, now);
  if (AU.ctx && AU.windG) AU.windG.gain.setTargetAtTime(G.sound ? SC.storm * .32 + SC.rough * .12 + (SC.trade || 0) * .05 : 0, AU.ctx.currentTime, .3);
}

/* ---------- the route scrap: an old chart following the fleet (Fair Winds: buildMini/drawMini) ---------- */
const LAND_POLYS = Object.values(window.ML_DATA.land).map(pts => ({ pts, min: Math.min(...pts.map(p => p[0])), max: Math.max(...pts.map(p => p[0])) }));
function liveDrawMini() {
  const c = LIVE.miniCv, g = c.getContext("2d"), w = c.width, h = c.height, d = DPR, seed = 1519;
  if (!w || !h) return;
  if (!LIVE.miniBase || LIVE.miniBase.width !== w || LIVE.miniBase.height !== h) { const off = document.createElement("canvas"); off.width = w; off.height = h; parchment(off.getContext("2d"), w, h, seed); LIVE.miniBase = off; }
  const pos = ML.posAt(SC.p), span = 140, sc = w / span;
  const tLon = pos.lon - span * .12, tLat = clamp(pos.lat, -26, 16);
  if (!LIVE.mini) LIVE.mini = { lon: tLon, lat: tLat };
  LIVE.mini.lon += 360 * Math.round((tLon - LIVE.mini.lon) / 360);
  const e = clamp(DT * 2.5, 0, 1); LIVE.mini.lon = lerp(LIVE.mini.lon, tLon, e); LIVE.mini.lat = lerp(LIVE.mini.lat, tLat, e);
  const P = (lon, lat) => [w / 2 + (lon - LIVE.mini.lon) * sc, h / 2 - (lat - LIVE.mini.lat) * sc];
  const l = LIVE.mini.lon - span / 2 - 5, r = LIVE.mini.lon + span / 2 + 5;
  g.clearRect(0, 0, w, h); g.drawImage(LIVE.miniBase, 0, 0);
  g.save(); tornPath(g, w, h, seed, 3.2 * d); g.clip();
  g.fillStyle = "rgba(104,150,160,.28)"; g.fillRect(0, 0, w, h);
  const land = new Path2D();
  for (const poly of LAND_POLYS) for (let n = -2; n <= 1; n++) { const o = n * 360; if (poly.max + o < l || poly.min + o > r) continue;
    poly.pts.forEach((p, i) => { const q = P(p[0] + o, p[1]); i ? land.lineTo(q[0], q[1]) : land.moveTo(q[0], q[1]); }); land.closePath(); }
  g.strokeStyle = "rgba(92,52,18,.28)"; g.lineWidth = 3.2 * d; g.stroke(land);
  g.fillStyle = "#e3c88f"; g.fill(land); g.strokeStyle = "rgba(78,44,14,.9)"; g.lineWidth = .9 * d; g.stroke(land);
  const rx = w * .83, ry = h * .74, rr = Math.min(w, h) * .13;
  g.strokeStyle = "rgba(92,52,18,.16)"; g.lineWidth = .7 * d; for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8; g.beginPath(); g.moveTo(rx, ry); g.lineTo(rx + Math.cos(a) * w * 1.2, ry + Math.sin(a) * w * 1.2); g.stroke(); }
  compassRose(g, rx, ry, rr);
  const route = window.ML_DATA.route;
  for (const o of [-360, 0, 360]) {
    if (-366.6 + o > r || -6.6 + o < l) continue;
    g.setLineDash([2.4 * d, 2.6 * d]); g.strokeStyle = "rgba(78,44,14,.75)"; g.lineWidth = 1.3 * d;
    g.beginPath(); route.forEach((p, i) => { const q = P(p[0] + o, p[1]); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.stroke(); g.setLineDash([]);
    // checkpoints: unnamed markers along the way
    for (const cpt of ML.CHECKPOINTS) { if (!cpt.f || cpt.f >= 1) continue; const q = P(route[cpt.i][0] + o, route[cpt.i][1]), passed = cpt.f <= SC.p;
      g.beginPath(); g.arc(q[0], q[1], 1.9 * d, 0, 7); g.fillStyle = passed ? "#a8241e" : "#f3e3b8"; g.fill(); g.strokeStyle = "rgba(78,44,14,.9)"; g.lineWidth = .8 * d; g.stroke(); }
    // the trail so far
    const tr = [];
    for (let i = 0; i < route.length && i < pos.seg; i++) tr.push(route[i]);
    tr.push([pos.lon, pos.lat]);
    g.strokeStyle = "#a8241e"; g.lineWidth = 2.2 * d; g.lineCap = "round"; g.lineJoin = "round";
    g.beginPath(); tr.forEach((p, i) => { const q = P(p[0] + o, p[1]); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.stroke();
  }
  const hq = P(pos.lon, pos.lat), face = pos.dx < -.01 ? -1 : 1, bob = calm() ? 0 : Math.sin(SC.t * 3) * .6 * d, k = 1.05 * d;
  g.fillStyle = "rgba(168,36,30,.22)"; g.beginPath(); g.arc(hq[0], hq[1], (5.5 + 1.5 * Math.sin(SC.t * 4)) * d, 0, 7); g.fill();
  g.translate(hq[0], hq[1] + bob); g.scale(face * k, k); g.lineJoin = "round"; g.strokeStyle = "#3a2410"; g.lineWidth = 1;
  g.fillStyle = "#6b3b1c"; g.beginPath(); g.moveTo(-5, 0); g.lineTo(5, 0); g.lineTo(3.5, 2.6); g.lineTo(-3.8, 2.6); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = "#fbf3dc"; g.beginPath(); g.moveTo(-.5, -.5); g.lineTo(-.5, -7.5); g.quadraticCurveTo(3.6, -4.5, 3, -.5); g.closePath(); g.fill(); g.stroke();
  g.restore();
}

/* ---------- the log scrap: the climb so far (Fair Winds: drawChart) ---------- */
function liveDrawChart(st, now) {
  const c = LIVE.chartCv, g = c.getContext("2d"), w = c.width, h = c.height, d = DPR;
  if (!w || !h) return;
  g.clearRect(0, 0, w, h);
  if (!LIVE.chartBase || LIVE.chartBase.width !== w || LIVE.chartBase.height !== h) { LIVE.chartBase = document.createElement("canvas"); LIVE.chartBase.width = w; LIVE.chartBase.height = h; const b = LIVE.chartBase.getContext("2d"); parchment(b, w, h, 77);
    b.save(); tornPath(b, w, h, 77, 3.2 * d); b.clip(); b.strokeStyle = "rgba(168,36,30,.35)"; b.lineWidth = d; b.beginPath(); b.moveTo(26 * d, 0); b.lineTo(26 * d, h); b.stroke(); b.restore(); }
  g.drawImage(LIVE.chartBase, 0, 0); g.save(); tornPath(g, w, h, 77, 3.2 * d); g.clip();
  const Rd = st.round, on = st.phase !== "board";
  const el = on ? Math.min(now - Rd.sailStart, Rd.crashMs) : 0, tNow = el / 1000, mNow = on ? (st.phase === "result" ? Rd.crash : st.mult) : 1;
  const pl = 30 * d, pr = 10 * d, pt = 10 * d, pb = 12 * d;
  const tMax = Math.max(10, tNow * 1.12), yMax = Math.max(2, mNow * 1.18);
  const X = t => pl + t / tMax * (w - pl - pr), Y = m => h - pb - (m - 1) / (yMax - 1) * (h - pt - pb);
  // weather that sped the climb, shaded
  if (on) { g.fillStyle = "rgba(70,90,150,.2)"; const N = 60; for (let i = 0; i < N; i++) { const t0 = el * i / N, t1 = el * (i + 1) / N; if (ML.boostAt(Rd, (t0 + t1) / 2) > 1.01) g.fillRect(X(t0 / 1000), pt, Math.max(1, X(t1 / 1000) - X(t0 / 1000)), h - pt - pb); } }
  g.font = `800 ${9.5 * d}px Nunito, sans-serif`; g.textAlign = "right"; g.textBaseline = "middle";
  let lastY = 1e9;
  for (const m of [1, 1.5, 2, 3, 5, 10, 20, 50, 100, 250, 500, 1000]) { if (m > yMax) break; const y = Y(m); if (lastY - y < 13 * d) continue; lastY = y;
    g.strokeStyle = "rgba(92,52,18,.18)"; g.lineWidth = d; g.beginPath(); g.moveTo(pl, y); g.lineTo(w - pr, y); g.stroke();
    g.fillStyle = "rgba(78,44,14,.85)"; g.fillText("×" + m, pl - 4 * d, y); }
  if (!on || el <= 0) { g.restore(); return; }
  const N = 80, Pts = [];
  for (let i = 0; i <= N; i++) { const t = el * i / N; Pts.push([X(t / 1000), Y(ML.multAt(Rd, t))]); }
  const ag = g.createLinearGradient(0, pt, 0, h - pb); ag.addColorStop(0, "rgba(200,110,30,.38)"); ag.addColorStop(1, "rgba(200,110,30,0)");
  g.beginPath(); g.moveTo(Pts[0][0], Y(1)); Pts.forEach(q => g.lineTo(q[0], q[1])); g.lineTo(Pts[N][0], Y(1)); g.closePath(); g.fillStyle = ag; g.fill();
  const lg = g.createLinearGradient(pl, 0, w - pr, 0); lg.addColorStop(0, "#5a3414"); lg.addColorStop(1, st.phase === "result" && !Rd.home ? "#8a1f1a" : "#b0471c");
  g.lineWidth = 2.6 * d; g.lineJoin = "round"; g.lineCap = "round"; g.strokeStyle = lg; g.shadowColor = "rgba(255,170,80,.6)"; g.shadowBlur = 3 * d;
  g.beginPath(); Pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.stroke(); g.shadowBlur = 0;
  const hx = X(tNow), hy = Y(mNow), pulse = 1 + .5 * Math.sin(SC.t * 6);
  g.fillStyle = "rgba(176,71,28,.25)"; g.beginPath(); g.arc(hx, hy, 6.5 * d * pulse, 0, 7); g.fill(); g.fillStyle = "#b0471c"; g.strokeStyle = "#3a2410"; g.lineWidth = d; g.beginPath(); g.arc(hx, hy, 3 * d, 0, 7); g.fill(); g.stroke();
  g.restore();
}

/* ---------- Magellan touches: drawn around the copied renderer (fw-render.js stays untouched) ----------
 * - the southern night sky Pigafetta wrote about on the voyage: the two Magellanic Clouds and the Southern Cross
 * - the Patagonian coast on the horizon, with Magellanic penguins on the cliff tops
 * - the strait: snowy peaks and the shore fires that gave Tierra del Fuego its name; no monsters or bergs in its sheltered water
 * No text: the places stay unnamed. */
const MAG = (() => { const f = n => ML.CHECKPOINTS.find(c => c.name === n).f;
  return { coastA: f("Río de la Plata") + .006, peaksA: f("Port San Julián") + .002, coastB: f("Mar Pacífico") + .008 }; })();
let MAG_STARS = null;
// how much of the Patagonian coast is in sight (0–1)
function magCoastAmount() { const p = SC.p; if (!R || p < MAG.coastA || p > MAG.coastB) return 0; return clamp(Math.min(p - MAG.coastA, MAG.coastB - p) / .006, 0, 1); }

const fwDrawSky = drawSky;
drawSky = function () { fwDrawSky(); magSky(); };
function magSky() {
  if (!R) return;
  const lat = liveLonLat()[1], south = clamp((-lat - 4) / 14, 0, 1);
  const a = clamp((SC.nightP - .7) / .2, 0, 1) * (1 - SC.storm) * south;
  if (a <= .01) return;
  if (!MAG_STARS) { const rnd = mulberry32(1520); MAG_STARS = Array.from({ length: 80 }, () => [rnd(), rnd(), rnd()]); }
  // the Magellanic Clouds: two soft milky patches, the large and the small, each dusted with stars
  [[.82, .31, .085, .5, -.35, 0], [.91, .4, .045, .55, -.2, 1]].forEach(([px, py, rr, flat, rot, k]) => {
    const R0 = Math.max(18, Math.min(W, H * 1.6) * rr);
    cx.save(); cx.translate(W * px, H * py); cx.rotate(rot); cx.scale(1, flat);
    const g = cx.createRadialGradient(0, 0, 0, 0, 0, R0); g.addColorStop(0, `rgba(236,238,255,${.5 * a})`); g.addColorStop(.55, `rgba(205,210,248,${.2 * a})`); g.addColorStop(1, "rgba(205,210,248,0)");
    cx.fillStyle = g; cx.beginPath(); cx.arc(0, 0, R0, 0, 7); cx.fill();
    cx.fillStyle = `rgba(255,255,255,${.75 * a})`;
    MAG_STARS.forEach(([u, v, w2], i) => { if (i % 2 !== k) return; const r = Math.sqrt(u) * R0 * .8, t = v * 6.283; cx.beginPath(); cx.arc(Math.cos(t) * r, Math.sin(t) * r / flat * .6, .45 + w2 * .8, 0, 7); cx.fill(); });
    cx.restore();
  });
  // the Southern Cross: Gacrux at the top, Acrux at the foot, Mimosa and δ across, the faint ε
  const s = clamp(Math.min(W, H) / 480, .7, 1.4), ox = W * .1, oy = H * .405;
  for (const [dx, dy, r, ph] of [[0, -27, 2.3, 0], [2, 27, 2.6, 1.7], [-17, 3, 2.3, 3.1], [16, -6, 1.8, 4.4], [8, 12, 1.1, 2.2]]) {
    const x = ox + dx * s, y = oy + dy * s, tw = .75 + .25 * Math.sin(SC.t * 2.3 + ph);
    const gl = cx.createRadialGradient(x, y, 0, x, y, r * 6 * s); gl.addColorStop(0, `rgba(225,236,255,${.75 * a * tw})`); gl.addColorStop(1, "rgba(220,232,255,0)");
    cx.fillStyle = gl; cx.beginPath(); cx.arc(x, y, r * 6 * s, 0, 7); cx.fill();
    cx.fillStyle = `rgba(255,255,255,${a * tw})`; cx.beginPath(); cx.arc(x, y, r * 1.15 * s, 0, 7); cx.fill();
    if (r > 2) { cx.strokeStyle = `rgba(255,255,255,${.5 * a * tw})`; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(x - r * 3 * s, y); cx.lineTo(x + r * 3 * s, y); cx.moveTo(x, y - r * 3 * s); cx.lineTo(x, y + r * 3 * s); cx.stroke(); }   // a little sparkle on the bright ones
  }
}

const fwDrawFar = drawFar;
drawFar = function () { magCoast(); fwDrawFar(); };
function magPenguin(x, y, s, face, ph) {
  cx.save(); cx.translate(x, y); cx.rotate(Math.sin(SC.t * 5 + ph) * .08); cx.scale(s * face, s);
  cx.fillStyle = "#1c1f2e"; cx.beginPath(); cx.ellipse(0, -6, 3.3, 6.2, 0, 0, 7); cx.fill(); cx.beginPath(); cx.arc(.4, -12.6, 2.7, 0, 7); cx.fill();
  cx.fillStyle = "#f4f1e8"; cx.beginPath(); cx.ellipse(1, -5.4, 2.1, 4.6, 0, 0, 7); cx.fill();
  cx.strokeStyle = "#1c1f2e"; cx.lineWidth = .9; cx.beginPath(); cx.arc(1, -8.4, 2.2, .3, 2.7); cx.stroke();   // the black breast band
  cx.strokeStyle = "#f4f1e8"; cx.lineWidth = .8; cx.beginPath(); cx.arc(.6, -12.4, 2.1, -1.4, .6); cx.stroke();  // the white stripe round the face
  cx.fillStyle = "#e0a040"; cx.beginPath(); cx.moveTo(2.7, -12.9); cx.lineTo(4.6, -12.4); cx.lineTo(2.7, -11.9); cx.closePath(); cx.fill();
  cx.fillRect(-2, -.6, 1.8, .9); cx.fillRect(.6, -.6, 1.8, .9);
  cx.restore();
}
function magCoast() {
  if (!R || !R.Rd || R.state === "count") return;
  const Rd = R.Rd;
  if (R.coastT == null) { const t = n => ML.msAhead(Rd, ML.CHECKPOINTS.find(c => c.name === n).mult);
    R.coastT = { a: t("Río de la Plata"), sj: t("Port San Julián"), st: t("Strait of Magellan"), pc: t("Mar Pacífico") }; }
  const T = R.coastT, v = sceneryV(), xs = W * .43, now = sceneryMs(Rd);
  const tau = x => now + (x - xs) / v;                      // when the ship would be level with this spot
  if (tau(W + 30) < T.a - 900 || tau(-30) > T.pc + 1800) return;
  const sm = (a, b, x) => { const k = clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  const landAt = t => sm(T.a - 900, T.a, t) * (1 - sm(T.pc + 700, T.pc + 1800, t));   // the coast slopes up from the sea and back down
  const peaksAt = t => sm(T.sj, T.st, t) * (1 - sm(T.pc, T.pc + 1100, t));           // mountains along the strait
  const yH = H * LAY[1].y + 4, sc = clamp(H / 520, .6, 1.3), night = clamp((SC.nightP - .6) / .3, 0, 1) * .45, top = [], info = [];
  // only where there is land: the strip runs from where the coast leaves the sea to where it goes back in,
  // and its ends sit below the wave troughs, so no outline or fill ever shows on open water
  const base = yH + 12 * sc, x0 = Math.max(-30, xs + (T.a - 900 - now) * v), x1 = Math.min(W + 30, xs + (T.pc + 1800 - now) * v);
  if (x1 - x0 < 2) return;
  for (let x = x0; ; x = Math.min(x1, x + 6)) {
    const t = tau(x), u = t * v / sc, land = landAt(t), pk = peaksAt(t);
    const cliff = 14 + 5 * Math.sin(u * .021) + 3 * Math.sin(u * .057 + 1.3);
    const mount = Math.max(0, 38 * Math.sin(u * .012 + .7) + 24 * Math.sin(u * .031 + 2.1) + 10 * Math.sin(u * .083));
    top.push([x, base - (12 + cliff + pk * (18 + mount)) * sc * land]); info.push({ land, pk, u });
    if (x >= x1) break;
  }
  const shape = () => { cx.beginPath(); cx.moveTo(x0, base + 4); top.forEach(p => cx.lineTo(p[0], p[1])); cx.lineTo(x1, base + 4); cx.closePath(); };
  cx.save(); cx.lineJoin = "round"; cx.lineCap = "round";
  // ochre cliffs turning to slate mountains along the strait (a colour change across the land, not over time)
  const xA = xs + (T.sj - now) * v, xB = xs + (T.st - now) * v, xC = xs + (T.pc + 300 - now) * v, xD = xs + (T.pc + 1100 - now) * v;
  const span = Math.max(1, xD - xA), at = x => clamp((x - xA) / span, 0, 1);
  const g = cx.createLinearGradient(xA, 0, xD, 0);
  const cliffC = rgb(mixC("#b8925a", "#1d2552", night)), rockC = rgb(mixC("#7d8aa6", "#1d2552", night));
  g.addColorStop(0, cliffC); g.addColorStop(at(xB), rockC); g.addColorStop(at(xC), rockC); g.addColorStop(1, cliffC);
  shape(); cx.fillStyle = g; cx.fill();
  const sh = cx.createLinearGradient(0, yH - 90 * sc, 0, yH); sh.addColorStop(0, "rgba(255,255,255,.08)"); sh.addColorStop(1, "rgba(30,20,10,.28)");
  cx.fillStyle = sh; cx.fill();
  // snow on the high peaks
  cx.save(); shape(); cx.clip(); cx.fillStyle = "rgba(244,248,255,.95)"; cx.beginPath();
  top.forEach((p, i) => (i ? cx.lineTo(p[0], p[1]) : cx.moveTo(p[0], p[1])));
  for (let i = top.length - 1; i >= 0; i--) { const p = top[i], h = yH - p[1]; cx.lineTo(p[0], p[1] + Math.max(0, h - 36 * sc) * .42); }
  cx.closePath(); cx.fill(); cx.restore();
  // grass along the low cliff tops
  cx.strokeStyle = "rgba(122,150,70,.9)"; cx.lineWidth = 4 * sc; cx.beginPath(); let on = false;
  top.forEach((p, i) => { const k = info[i], grass = k.land > .6 && k.pk < .3; if (grass) { on ? cx.lineTo(p[0], p[1] + 2 * sc) : cx.moveTo(p[0], p[1] + 2 * sc); on = true; } else on = false; });
  cx.stroke();
  cx.strokeStyle = INK; cx.lineWidth = 2.5; cx.beginPath(); top.forEach((p, i) => (i ? cx.lineTo(p[0], p[1]) : cx.moveTo(p[0], p[1]))); cx.stroke();
  const topAt = x => top[clamp(Math.round((x - x0) / 6), 0, top.length - 1)][1];
  // penguin colonies on the cliff tops, fixed to the land
  const gap = 230 * sc;
  for (let k = Math.floor((tau(-60) * v) / gap); k * gap < tau(W + 60) * v; k++) {
    const t0 = k * gap / v; if (landAt(t0) < .7 || peaksAt(t0) > .2) continue;
    const n = 2 + (((k % 4) + 4) % 4), base = xs + (t0 - now) * v + ((((k * 37) % 50) + 50) % 50) * sc;
    for (let j = 0; j < n; j++) { const x = base + j * 9 * sc; if (x > -10 && x < W + 10) magPenguin(x, topAt(x) + 1.5 * sc, .95 * sc, (k + j) % 3 ? 1 : -1, k * 3 + j); }
  }
  // the shore fires along the strait, fixed to the land, brighter as the light fails
  const glow = .5 + .5 * clamp((SC.nightP - .45) / .4, 0, 1), fgap = 150 * sc;
  for (let k = Math.floor((tau(-60) * v) / fgap); k * fgap < tau(W + 60) * v; k++) {
    const t0 = k * fgap / v; if (peaksAt(t0) < .5) continue;
    const x = xs + (t0 - now) * v + ((((k * 7919) % 97) + 97) % 97) / 97 * 90 * sc, y = yH - 3 * sc, fl = .75 + .25 * Math.sin(SC.t * 13 + k * 2.3) * Math.sin(SC.t * 7.1 + k);
    if (x < -30 || x > W + 30) continue;
    const gr = cx.createRadialGradient(x, y - 3 * sc, 0, x, y - 3 * sc, 16 * sc); gr.addColorStop(0, `rgba(255,190,90,${.55 * glow * fl})`); gr.addColorStop(1, "rgba(255,140,60,0)");
    cx.fillStyle = gr; cx.beginPath(); cx.arc(x, y - 3 * sc, 16 * sc, 0, 7); cx.fill();
    cx.fillStyle = `rgba(255,${Math.round(150 + 60 * fl)},70,${glow})`; cx.beginPath(); cx.moveTo(x - 2.4 * sc, y); cx.quadraticCurveTo(x - 1 * sc, y - 6 * fl * sc, x, y - 8 * fl * sc); cx.quadraticCurveTo(x + 1 * sc, y - 6 * fl * sc, x + 2.4 * sc, y); cx.closePath(); cx.fill();
  }
  cx.restore();
}

// no kraken, whale or iceberg with the coast close by: the strait and the Patagonian shore are shallow, sheltered water
const fwPickCause = pickCause;
pickCause = function () { const c = fwPickCause(); return magCoastAmount() > .3 && /kraken|whale|iceberg/.test(c) ? (R.rng() < .5 ? "reef" : "wave") : c; };
