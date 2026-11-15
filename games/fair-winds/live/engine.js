/* Magellan Live — shared round engine.
 *
 * Every screen runs the same voyages at the same moment without a server:
 * the schedule and every result are worked out from the (synced) clock.
 *
 *  - Time is cut into 1-hour periods. Period P starts at P × 3,600,000 ms (UTC).
 *  - Inside a period, voyages run back to back: boarding 8 s → sailing → result.
 *    A voyage that would not finish before the hour ends is not started; the
 *    leftover time becomes a longer boarding for the next hour's first voyage.
 *  - Voyage n of period P: hash = SHA-256("magellan-live:v1:P:n").
 *    The first 52 bits give u in [0,1) and crash = floor(99 / (1 − u)) / 100,
 *    so P(crash ≥ m) = 0.99 / m for every m ≥ 1.01 (99% payback for any target).
 *    The crash is capped at ×1000 = the full circumnavigation home to Sanlúcar.
 *  - The multiplier is 1000^(t / 80 s): the ship moves at constant speed along
 *    the real route, and the multiplier is 1000^(share of the route sailed).
 */
(function (root) {
  'use strict';

  const CFG = {
    salt: 'magellan-live:v1',
    boardMs: 8000,        // time to join before each voyage
    resultMs: 4500,       // pause after a ship is lost
    homeResultMs: 9000,   // longer pause when the voyage comes home at ×1000
    fullMs: 80000,        // Sanlúcar → around the world → Sanlúcar
    max: 1000,
    edge: 0.01,
    periodMs: 3600000,
  };
  const LN_MAX = Math.log(CFG.max);

  /* ---------- SHA-256 (synchronous, UTF-8) ---------- */
  const K = new Uint32Array(64), H0 = new Uint32Array(8);
  (function () {
    let n = 2, k = 0, h = 0;
    while (k < 64) {
      let prime = true;
      for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
      if (prime) {
        if (h < 8) H0[h++] = ((Math.sqrt(n) % 1) * 4294967296) >>> 0;
        K[k++] = ((Math.cbrt(n) % 1) * 4294967296) >>> 0;
      }
      n++;
    }
  })();
  const W = new Uint32Array(64);
  function sha256hex(str) {
    const msg = new TextEncoder().encode(str);
    const len = msg.length, blocks = (len + 9 + 63) >> 6;
    const buf = new Uint8Array(blocks * 64);
    buf.set(msg); buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(buf.length - 4, (len * 8) >>> 0);
    dv.setUint32(buf.length - 8, Math.floor(len / 536870912));
    let h0 = H0[0], h1 = H0[1], h2 = H0[2], h3 = H0[3], h4 = H0[4], h5 = H0[5], h6 = H0[6], h7 = H0[7];
    for (let b = 0; b < blocks; b++) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(b * 64 + i * 4);
      for (let i = 16; i < 64; i++) {
        const x = W[i - 15], y = W[i - 2];
        const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      let a = h0, c1 = h1, c2 = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const t2 = (S0 + ((a & c1) ^ (a & c2) ^ (c1 & c2))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c2; c2 = c1; c1 = a; a = (t1 + t2) | 0;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + c1) | 0; h2 = (h2 + c2) | 0; h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7].map(v => (v >>> 0).toString(16).padStart(8, '0')).join('');
  }

  const floor2 = m => Math.floor(m * 100 + 1e-7) / 100;
  function mulberry32(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  /* ---------- the route: share of the distance sailed = ln(multiplier) / ln(1000) ---------- */
  const DATA = root.ML_DATA;
  const ROUTE = DATA.route, CUM = [0];
  for (let i = 1; i < ROUTE.length; i++) {
    const [lo1, la1] = ROUTE[i - 1], [lo2, la2] = ROUTE[i], r = Math.PI / 180;
    const h = Math.sin((la2 - la1) * r / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin((lo2 - lo1) * r / 2) ** 2;
    CUM.push(CUM[i - 1] + 2 * 6371 * Math.asin(Math.sqrt(h)));
  }
  const TOTAL = CUM[CUM.length - 1];
  // checkpoints along the way (the places are data only; the screen shows them as unnamed markers)
  const CHECKPOINTS = DATA.stops.map(s => ({ i: s.i, f: CUM[s.i] / TOTAL, name: s.name })).map(c => ({ ...c, mult: Math.round(Math.pow(CFG.max, c.f) * 100) / 100 }));
  function posAt(f) {
    const d = Math.max(0, Math.min(1, f)) * TOTAL;
    let lo = 1, hi = CUM.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (CUM[mid] >= d) hi = mid; else lo = mid + 1; }
    const a = ROUTE[lo - 1], b = ROUTE[lo], u = (d - CUM[lo - 1]) / ((CUM[lo] - CUM[lo - 1]) || 1);
    return { lon: a[0] + (b[0] - a[0]) * u, lat: a[1] + (b[1] - a[1]) * u, seg: lo, dx: b[0] - a[0], dy: b[1] - a[1] };
  }

  /* ---------- weather: changes how fast the multiplier climbs, never where the voyage ends ----------
   * As in Fair Winds: storms sweep across the fleet (Squall ×1.35, Gale ×1.7, Hurricane ×2.3 speed while the fleet is inside),
   * trade winds and monsoons blow ×1.35 on the stretches where they really blow, rough water runs ×1.5.
   * The schedule comes from the voyage's own hash, so every screen sees the same weather at the same moment. */
  const STORMS = [
    { name: 'Squall', boost: 1.35, w: 55, dark: .55, bolts: .5 },
    { name: 'Gale', boost: 1.7, w: 32, dark: .75, bolts: 1.1 },
    { name: 'Hurricane', boost: 2.3, w: 13, dark: .95, bolts: 2 },
  ];
  const cp = name => CHECKPOINTS.find(c => c.name === name).f;
  const ZONES = [
    { kind: 'wind', a: cp('Off Sierra Leone') + .02, b: cp('Rio de Janeiro') - .01, boost: 1.35 },     // SE trades
    { kind: 'rough', a: cp('Strait of Magellan'), b: cp('Mar Pacífico'), boost: 1.5 },                 // the strait
    { kind: 'wind', a: cp('Mar Pacífico') + .03, b: cp('Guam') - .01, boost: 1.35 },                   // the long Pacific trade-wind run
    { kind: 'wind', a: cp('Timor') + .02, b: cp('Cape of Good Hope') - .03, boost: 1.35 },             // Indian Ocean
    { kind: 'rough', a: cp('Cape of Good Hope') - .012, b: cp('Cape of Good Hope') + .012, boost: 1.5 },
    { kind: 'wind', a: cp('Cape of Good Hope') + .03, b: cp('Cape Verde') - .02, boost: 1.35 },        // SE trades, homeward
  ];
  const zoneAt = f => ZONES.find(z => f >= z.a && f < z.b) || null;
  // storms per second: few in the calm Pacific, squally in the doldrums, many off the Cape of Storms
  function stormRate(f) {
    if (Math.abs(f - cp('Cape of Good Hope')) < .03) return .3;
    if (f > cp('Off Sierra Leone') && f < cp('Off Sierra Leone') + .02) return .12;
    if (f > cp('Mar Pacífico') + .03 && f < cp('Guam')) return .02;
    return .07;
  }
  const STEP = 50, KR = LN_MAX / CFG.fullMs; // ms per integration step; ln-growth per ms at plain sailing (×1000 in 80 s)
  function pickStorm(u) { const tot = STORMS.reduce((a, s) => a + s.w, 0) * u; let a = 0; for (const s of STORMS) { a += s.w; if (tot <= a) return s; } return STORMS[0]; }
  // Integrates the climb in 50 ms steps with the weather of each step. L[i] = ln(multiplier) at i × 50 ms.
  function voyageCurve(hash, crash) {
    const rng = mulberry32(parseInt(hash.slice(56, 64), 16));
    const lnC = Math.log(crash), L = [0], storms = [];
    if (crash <= 1) return { L: new Float64Array(L), storms, crashMs: 0 };
    let lnm = 0, t = 0, lastStorm = -1e9;
    for (;;) {
      const f = lnm / LN_MAX;
      if (rng() < stormRate(f) * STEP / 1000 && t - lastStorm > 6000) {
        lastStorm = t;
        const kind = pickStorm(rng()), dur = 11000 + rng() * 4000, tc = t + .53 * dur;
        storms.push({ kind, t0: t, dur, tc, a: tc - .2 * dur, b: tc + .2 * dur, ph: rng() * 6 });
      }
      let boost = 1;
      for (const s of storms) if (t >= s.a && t < s.b && s.kind.boost > boost) boost = s.kind.boost;
      const z = zoneAt(f); if (z) boost *= z.boost;
      const next = lnm + KR * boost * STEP;
      L.push(next);
      if (next >= lnC) return { L: new Float64Array(L), storms, crashMs: t + (lnC - lnm) / (KR * boost) };
      lnm = next; t += STEP;
    }
  }
  function lnAt(R, ms) {
    if (ms <= 0) return 0;
    if (ms >= R.crashMs) return Math.log(R.crash);
    const i = Math.floor(ms / STEP), u = (ms - i * STEP) / STEP;
    return R.L[i] + (R.L[i + 1] - R.L[i]) * u;
  }
  const multAt = (R, ms) => Math.exp(lnAt(R, ms));
  const fAt = (R, ms) => lnAt(R, ms) / LN_MAX;
  // the speed factor the weather gives at this moment (1 = plain sailing)
  function boostAt(R, ms) {
    if (ms < 0 || ms >= R.crashMs) return 1;
    const i = Math.floor(ms / STEP);
    return (R.L[i + 1] - R.L[i]) / (KR * STEP);
  }
  // ms after sailing when the voyage reaches multiplier m (Infinity if it never does)
  function msFor(R, m) {
    if (m <= 1) return 0;
    const ln = Math.log(m);
    if (m > R.crash) return Infinity;
    if (ln >= Math.log(R.crash)) return R.crashMs;
    let lo = 0, hi = R.L.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (R.L[mid] <= ln) lo = mid; else hi = mid; }
    return Math.min(R.crashMs, lo * STEP + (ln - R.L[lo]) / (R.L[hi] - R.L[lo]) * STEP);
  }
  const stormAt = (R, ms) => R.storms.find(s => ms >= s.a && ms < s.b) || null;
  // For scenery only: when the voyage would reach m if it sailed on past its end. The climb is the same up to the end
  // (same weather, same steps), so land can be placed ahead on the horizon without giving away where the voyage stops.
  function msAhead(R, m) {
    if (!R.ext) R.ext = R.crash >= CFG.max ? R : Object.assign({ crash: CFG.max }, voyageCurve(R.hash, CFG.max));
    return msFor(R.ext, Math.min(m, CFG.max));
  }

  function crashFromHash(hex) {
    const u = parseInt(hex.slice(0, 13), 16) / 4503599627370496; // 2^52
    const c = Math.floor(100 * (1 - CFG.edge) / (1 - u)) / 100;
    return c < 1 ? 1 : Math.min(c, CFG.max);
  }

  /* ---------- schedule ---------- */
  const periods = new Map();
  function makeRound(P, r, sailStart) {
    const seed = CFG.salt + ':' + P + ':' + r;
    const hash = sha256hex(seed);
    const crash = crashFromHash(hash);
    const home = crash >= CFG.max;
    const cv = voyageCurve(hash, crash);
    const crashAt = sailStart + cv.crashMs;
    return {
      P, r, key: P + '-' + r, seed, hash, crash, home,
      boardStart: sailStart - CFG.boardMs, sailStart, crashAt,
      end: crashAt + (home ? CFG.homeResultMs : CFG.resultMs),
      L: cv.L, storms: cv.storms, crashMs: cv.crashMs,
    };
  }
  function period(P) {
    let list = periods.get(P);
    if (list) return list;
    const t1 = (P + 1) * CFG.periodMs;
    list = [];
    let sail = P * CFG.periodMs + CFG.boardMs;
    for (let r = 0; ; r++) {
      const R = makeRound(P, r, sail);
      if (R.end > t1) break;
      if (r > 0) R.boardStart = list[r - 1].end;
      list.push(R);
      sail = R.end + CFG.boardMs;
    }
    periods.set(P, list);
    if (periods.size > 6) periods.delete(periods.keys().next().value);
    return list;
  }
  // Round 0 of an hour boards from the moment the previous hour's last voyage ended.
  function boardStartOf(R) {
    if (R.r > 0) return R.boardStart;
    const prev = period(R.P - 1);
    return prev[prev.length - 1].end;
  }
  function roundByKey(key) {
    const [P, r] = String(key).split('-').map(Number);
    if (!Number.isFinite(P) || !Number.isFinite(r)) return null;
    return period(P)[r] || null;
  }
  function nextRound(R) {
    return period(R.P)[R.r + 1] || period(R.P + 1)[0];
  }
  function prevRound(R) {
    if (R.r > 0) return period(R.P)[R.r - 1];
    const prev = period(R.P - 1);
    return prev[prev.length - 1];
  }
  // The voyage that owns time t (boarding, sailing or showing its result).
  function roundAt(t) {
    const P = Math.floor(t / CFG.periodMs);
    const list = period(P);
    if (t >= list[list.length - 1].end) return period(P + 1)[0];
    let lo = 0, hi = list.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].end > t) hi = mid; else lo = mid + 1; }
    return list[lo];
  }
  function stateAt(t) {
    const R = roundAt(t);
    let phase, mult = 1;
    if (t < R.sailStart) phase = 'board';
    else if (t < R.crashAt) { phase = 'sail'; mult = multAt(R, t - R.sailStart); }
    else { phase = 'result'; mult = R.crash; }
    return { t, round: R, phase, mult, boardStart: boardStartOf(R) };
  }
  // Finished voyages (crashed by time t), newest first.
  function history(t, n) {
    const out = [];
    let R = roundAt(t);
    if (t < R.crashAt) R = prevRound(R);
    while (out.length < n) { out.push(R); R = prevRound(R); }
    return out;
  }

  /* ---------- clock sync (server Date header, no extra service) ---------- */
  const Clock = {
    offset: 0, err: null, source: 'local', synced: false,
    now() { return Date.now() + this.offset; },
    async sync() {
      if (!/^https?:$/.test(location.protocol)) return this;
      const base = location.href.split('#')[0];
      let lo = -Infinity, hi = Infinity, n = 0;
      for (let i = 0; i < 6; i++) {
        try {
          const url = base + (base.includes('?') ? '&' : '?') + '_clock=' + Date.now() + i;
          const t0 = Date.now();
          const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
          const t1 = Date.now();
          const D = Date.parse(res.headers.get('date') || '');
          if (!Number.isFinite(D)) break;
          // The server stamped D (whole seconds) somewhere between t0 and t1.
          lo = Math.max(lo, D - t1);
          hi = Math.min(hi, D + 1000 - t0);
          n++;
        } catch (e) { break; }
        await new Promise(r => setTimeout(r, 170));
      }
      if (n && lo <= hi) {
        this.offset = Math.round((lo + hi) / 2);
        this.err = Math.round((hi - lo) / 2);
        this.source = 'server'; this.synced = true;
      }
      return this;
    },
  };

  root.MagLive = {
    CFG, Clock, sha256hex, crashFromHash, multAt, msFor, msAhead, fAt, boostAt, stormAt, zoneAt, floor2, mulberry32,
    CHECKPOINTS, ZONES, STORMS, posAt,
    period, roundAt, roundByKey, nextRound, prevRound, stateAt, history, boardStartOf,
  };
})(window);
