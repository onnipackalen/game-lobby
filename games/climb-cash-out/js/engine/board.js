// Board math for Climb & Cash Out.
// Every square's multiplier is m(s) = floor(100 * RTP * P(s) / P(1)) / 100, where P(s) is the
// probability of reaching 100 from s if the player never cashes out. That makes the multipliers a
// martingale (rolling never changes the expected value), so no cash-out strategy can beat RTP.
// See GAME_DESIGN.md §4.

export const RTP = 0.97;
export const N = 100;

export const CLASSIC_LADDERS = { 3: 22, 8: 30, 20: 41, 27: 56, 36: 57, 51: 72, 63: 81, 71: 91, 80: 99 };
export const SLIDERS = { 17: 7, 34: 13, 47: 26, 62: 19, 74: 53, 88: 67, 95: 75 };

// Red pits (v3, 2026-11-14) are spread through the board, a little toward the start, so values
// climb from the first rolls instead of staying near 1× until the top rows. Placed by
// design/math/frontload.py, with limits: at most 1/2/3 pits in any 6 squares in a row
// (Low/Medium/High) and at most 1/1/2 pits the first roll can reach.
export const RISKS = {
  low: {
    id: 'low', label: 'Low',
    biters: [6, 15, 35, 61, 70, 77, 87, 97],
    classicTop: 25.05,
    blurb: 'Few red pits. Smaller, steadier wins.',
  },
  medium: {
    id: 'medium', label: 'Medium',
    biters: [6, 9, 12, 16, 24, 28, 33, 35, 60, 61, 77, 85, 87, 96, 97],
    classicTop: 243.35,
    blurb: 'Balanced risk and reward.',
  },
  high: {
    id: 'high', label: 'High',
    biters: [5, 6, 10, 11, 12, 24, 25, 28, 32, 33, 35, 45, 46, 59, 60, 61, 70, 84, 86, 87, 90, 93, 96, 97],
    classicTop: 2791.2,
    blurb: 'Most rounds bust. Rare, huge wins.',
  },
};

// Shuffled layouts must keep the top prize within this band of the classic board's top prize,
// so each risk level keeps its character.
export const SHUFFLE_BAND = [0.6, 1.6];
export const LADDER_COUNT = 9;

/** Square reached by rolling d from s, before ladders/snakes. Overshooting 100 bounces back. */
export function landing(s, d) {
  const t = s + d;
  return t > N ? 2 * N - t : t;
}

/** Resolve one roll: returns { landed, final, kind } where kind is move|ladder|slide|bust|top. */
export function resolve(board, s, d) {
  const landed = landing(s, d);
  if (board.biters.has(landed)) return { landed, final: null, kind: 'bust' };
  if (board.ladders[landed]) {
    const final = board.ladders[landed];
    return { landed, final, kind: final === N ? 'top' : 'ladder' };
  }
  if (board.sliders[landed]) return { landed, final: board.sliders[landed], kind: 'slide' };
  return { landed, final: landed, kind: landed === N ? 'top' : 'move' };
}

/** Exact P(reach 100 | s) for s = 1..100, solved as a linear system (Gaussian elimination). */
export function hitProbabilities(board) {
  const n = N - 1; // unknowns: squares 1..99
  const A = Array.from({ length: n }, () => new Float64Array(n));
  const b = new Float64Array(n);
  for (let s = 1; s < N; s++) {
    const i = s - 1;
    A[i][i] += 1;
    for (let d = 1; d <= 6; d++) {
      const r = resolve(board, s, d);
      if (r.kind === 'bust') continue;
      if (r.final === N) b[i] += 1 / 6;
      else A[i][r.final - 1] -= 1 / 6;
    }
  }
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (piv !== col) { [A[col], A[piv]] = [A[piv], A[col]]; [b[col], b[piv]] = [b[piv], b[col]]; }
    const p = A[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / p;
      if (f === 0) continue;
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
      b[r] -= f * b[col];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let acc = b[r];
    for (let c = r + 1; c < n; c++) acc -= A[r][c] * x[c];
    x[r] = acc / A[r][r];
  }
  const P = new Array(N + 1).fill(0);
  for (let s = 1; s < N; s++) P[s] = Math.max(0, x[s - 1]);
  P[N] = 1;
  return P;
}

/** Build a playable board: ladders + fixed green snakes + the risk level's red snakes. */
export function createBoard(riskId, ladders = CLASSIC_LADDERS) {
  const risk = RISKS[riskId];
  const board = {
    risk: riskId,
    ladders: { ...ladders },
    sliders: { ...SLIDERS },
    biters: new Set(risk.biters),
  };
  board.isClassic = sameLadders(ladders, CLASSIC_LADDERS);
  const P = hitProbabilities(board);
  board.P = P;
  board.m = P.map((p, s) => (s === 0 ? 0 : Math.floor(100 * RTP * p / P[1] + 1e-9) / 100));
  board.top = board.m[N];
  board.topOdds = 1 / P[1]; // "1 in X" for a player who never cashes out
  return board;
}

/** Squares a token can rest on (not a ladder bottom, snake head or red snake). */
export function isResting(board, s) {
  return s >= 1 && s <= N && !board.biters.has(s) && !board.ladders[s] && !board.sliders[s];
}

/** What each die face does from square s. */
export function nextRollOutcomes(board, s) {
  const out = [];
  for (let d = 1; d <= 6; d++) {
    const r = resolve(board, s, d);
    out.push({ face: d, ...r, value: r.kind === 'bust' ? 0 : board.m[r.final] });
  }
  return out;
}

/** Average multiplier after one more roll (busts count as 0). */
export function averageAfterRoll(board, s) {
  return nextRollOutcomes(board, s).reduce((a, o) => a + o.value, 0) / 6;
}

function sameLadders(a, b) {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}

function randomInt(rand, lo, hi) { // inclusive
  return lo + Math.floor(rand() * (hi - lo + 1));
}

/** Random ladder layout for a risk level; top prize kept inside SHUFFLE_BAND of the classic one. */
export function shuffleLadders(riskId, rand = cryptoRandom, maxTries = 400) {
  const risk = RISKS[riskId];
  const [lo, hi] = SHUFFLE_BAND;
  for (let attempt = 0; attempt < maxTries; attempt++) {
    const used = new Set([1, N, ...risk.biters]);
    for (const [h, t] of Object.entries(SLIDERS)) { used.add(+h); used.add(t); }
    const ladders = {};
    let ok = true;
    for (let i = 0; i < LADDER_COUNT && ok; i++) {
      ok = false;
      for (let k = 0; k < 60; k++) {
        const bottom = randomInt(rand, 2, 89);
        const top = bottom + randomInt(rand, 10, 38);
        if (top > 99 || used.has(bottom) || used.has(top)) continue;
        // Keep ladders upright so the board stays readable: climb at least 2 rows, at most
        // 3 columns sideways, and never wider than 3/4 of their height.
        const dx = Math.abs(squareCenter(top).x - squareCenter(bottom).x);
        const dy = squareCenter(bottom).y - squareCenter(top).y;
        if (dy < 200 || dx > 300 || dx > dy * 0.75) continue;
        ladders[bottom] = top; used.add(bottom); used.add(top); ok = true; break;
      }
    }
    if (!ok) continue;
    const board = createBoard(riskId, ladders);
    const ratio = board.top / risk.classicTop;
    if (ratio >= lo && ratio <= hi && Number.isFinite(board.top)) return ladders;
  }
  return { ...CLASSIC_LADDERS };
}

export function cryptoRandom() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 2 ** 32;
}

/** Board geometry: centre of square n in a 1000×1000 box (row 1 at the bottom, snaking). */
export function squareCenter(n) {
  const r = Math.floor((n - 1) / 10);
  let c = (n - 1) % 10;
  if (r % 2) c = 9 - c;
  return { x: c * 100 + 50, y: (9 - r) * 100 + 50 };
}
