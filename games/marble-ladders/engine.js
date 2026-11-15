// Marble Rush — game engine (pure logic, no DOM). Shared by the page and the payout simulator.
// Every outcome is decided here from the rand() it is given; the page only replays it.
(function (root) {
  const COLS = 7, ROWS = 7, MIN_CLUSTER = 7;
  const COLORS = ['ruby', 'amber', 'jade', 'sapphire', 'amethyst'];
  const GOLD = 'gold';
  // Relative chance of each marble dropping in. Rarer colours pay more.
  const WEIGHTS = { ruby: 14, amber: 17, jade: 20, sapphire: 22, amethyst: 24, gold: 0.742 };
  // Bonus ×2 spins: the same weights with more gold, so the Marble Run comes up twice as often.
  const BOOST = { cost: 1.2, gold: 0.957 };
  // Win for a 7-marble cluster, as a multiple of the bet.
  const COLOR_PAY = { ruby: 3.32, amber: 2.28, jade: 1.33, sapphire: 1.13, amethyst: 0.9 };
  // Cluster size → multiplier on COLOR_PAY.
  const SIZE_MULT = { 7: 1, 8: 1.5, 9: 2, 10: 3, 11: 4, 12: 5, 13: 7, 14: 9, 15: 12, 16: 15, 17: 18, 18: 22, 19: 26 };
  const sizeMult = n => (n >= 20 ? 40 : SIZE_MULT[n] || 0);
  // Ladder Climb: the n-th cascade in one spin pays × LADDER[n-1] (the last rung repeats).
  const LADDER = [1, 2, 3, 5];

  // The player's lucky marble. Each perk is worth about the same over time.
  const LUCKY = {
    gold:     { name: 'Gold star',      ladder: [1, 3, 6, 8], perk: 'The ladder climbs faster: ×1, ×3, ×6, ×8' },
    ruby:     { name: 'Ruby cat’s-eye', color: 'ruby', mult: 3.78, perk: 'Ruby clusters pay ×3.78' },
    lava:     { name: 'Lava',           color: 'amber', mult: 2.3, perk: 'Amber clusters pay ×2.3' },
    seaglass: { name: 'Sea glass',      color: 'jade', mult: 1.91, perk: 'Jade clusters pay ×1.91' },
    galaxy:   { name: 'Galaxy',         color: 'sapphire', mult: 1.65, perk: 'Sapphire clusters pay ×1.65' },
    oilslick: { name: 'Oil slick',      color: 'amethyst', mult: 1.525, perk: 'Amethyst clusters pay ×1.525' },
  };
  const ladderFor = luckyId => (LUCKY[luckyId] && LUCKY[luckyId].ladder) || LADDER;
  const rung = (luckyId, n) => { const L = ladderFor(luckyId); return L[Math.min(n, L.length) - 1]; };

  // ---------------------------------------------------------------------------------------------
  // Marble Run: a peg wall. The player taps where to drop each marble; marbles bounce off the pegs, the walls
  // and each other (real 2-D physics, stepped live by the page) and pile into 9 slots. Under each slot is a
  // hidden multiplier, drawn at random before the first marble drops and independent of where marbles land,
  // so no drop spot is luckier than another. When every marble has landed the cards are revealed and each
  // slot pays marbles × multiplier × bet.
  // Units are cells (x right, y down). Slot j covers x from j - 4.5 to j - 3.5 (the outer two reach the walls).
  const PHYS = {
    ROWS: 9, SY: 0.74, PEG_R: 0.1, BALL_R: 0.2, DIV_R: 0.05, WALL_X: 4.62,
    G: 80, E_PEG: 0.3, E_WALL: 0.5, E_FLOOR: 0.3, E_BALL: 0.45, MU: 0.1, NUDGE: 0.02,
    V0: 1.5, START_Y: -1.0, AIM_MAX: 4.3, V_IMPACT: 0.75, DT: 1 / 240,
  };
  PHYS.JAR_TOP = (PHYS.ROWS - 1) * PHYS.SY + 0.62;
  PHYS.FLOOR = PHYS.JAR_TOP + 1.75;
  PHYS.NSLOTS = 9;
  // staggered rows: even rows have pegs at whole x (-4..4); odd rows at half x (-4.5..4.5), the outer two being
  // half-pegs on the walls, so there is no free gutter down the sides
  const PEGS = [], ROW_PEGS = [];
  for (let r = 0; r < PHYS.ROWS; r++) {
    ROW_PEGS.push([]);
    const odd = r % 2 === 1, n = odd ? 10 : 9;
    for (let k = 0; k < n; k++) {
      const x = odd ? k - 4.5 : k - 4, peg = { ax: x, ay: r * PHYS.SY, bx: x, by: r * PHYS.SY, r: PHYS.PEG_R, e: PHYS.E_PEG, id: PEGS.length, row: r, k };
      PEGS.push(peg); ROW_PEGS[r].push(peg);
    }
  }
  const WALLS = [-1, 1].map(s => ({ ax: s * PHYS.WALL_X, ay: PHYS.START_Y - 1.5, bx: s * PHYS.WALL_X, by: PHYS.FLOOR, r: 0, e: PHYS.E_WALL, id: -1 }));
  const DIVIDERS = [];
  for (let j = 1; j < PHYS.NSLOTS; j++) DIVIDERS.push({ ax: j - 4.5, ay: PHYS.JAR_TOP, bx: j - 4.5, by: PHYS.FLOOR, r: PHYS.DIV_R, e: PHYS.E_WALL, id: -2 });
  const FLOOR_SEG = { ax: -PHYS.WALL_X, ay: PHYS.FLOOR, bx: PHYS.WALL_X, by: PHYS.FLOOR, r: 0, e: PHYS.E_FLOOR, id: -3 };
  const slotOfX = x => Math.max(0, Math.min(PHYS.NSLOTS - 1, Math.floor(x + 4.5)));

  function collide(b, c, rand) {
    const P = PHYS, ex = c.bx - c.ax, ey = c.by - c.ay, l2 = ex * ex + ey * ey;
    let t = l2 > 0 ? ((b.x - c.ax) * ex + (b.y - c.ay) * ey) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = b.x - (c.ax + ex * t), dy = b.y - (c.ay + ey * t), d2 = dx * dx + dy * dy, R = P.BALL_R + c.r;
    if (d2 >= R * R || d2 === 0) return 0;
    const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
    b.x += nx * (R - d); b.y += ny * (R - d);
    const vn = b.vx * nx + b.vy * ny;
    if (vn >= 0) return 1e-9;
    let vt = -b.vx * ny + b.vy * nx;
    const impact = -vn > P.V_IMPACT;
    const e = impact ? c.e : 0, f = impact ? P.MU * (1 + e) * -vn : 0;
    vt = vt > f ? vt - f : vt < -f ? vt + f : 0;
    if (impact) vt += (rand() - 0.5) * 2 * P.NUDGE * -vn;
    const vn2 = -e * vn;
    b.vx = nx * vn2 - ny * vt; b.vy = ny * vn2 + nx * vt;
    return -vn;
  }
  function collideBalls(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy, R = 2 * PHYS.BALL_R;
    if (d2 >= R * R || d2 === 0) return 0;
    const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
    // a sleeping marble (settled in its slot) is a solid obstacle: only the awake one moves
    const wa = a.sleep ? 0 : b.sleep ? 1 : 0.5, wb = 1 - wa;
    a.x -= nx * (R - d) * wa; a.y -= ny * (R - d) * wa; b.x += nx * (R - d) * wb; b.y += ny * (R - d) * wb;
    const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (vn >= 0) return 1e-9;
    const j = -(1 + PHYS.E_BALL) * vn;
    a.vx -= j * wa * nx; a.vy -= j * wa * ny; b.vx += j * wb * nx; b.vy += j * wb * ny;
    return -vn;
  }

  // A live board. add(x) drops a marble at x; step() advances one DT and calls onHit(ball, peg, speed) for
  // real peg impacts; settled() is true once every marble rests in a slot.
  function makeBoard(rand) {
    const P = PHYS, balls = [];
    let calm = 0, since = 0;
    return {
      balls,
      add(x) {
        const ax = Math.max(-P.AIM_MAX, Math.min(P.AIM_MAX, x));
        const b = { x: ax + (rand() - 0.5) * 0.04, y: P.START_Y, vx: (rand() - 0.5) * 0.3, vy: P.V0, slow: 0, still: 0, sleep: false, px: 0, py: 0, id: balls.length, kicked: 0 };
        balls.push(b); calm = 0; since = 0; return b;
      },
      step(onHit) {
        for (const b of balls) {
          if (b.sleep) continue;
          b.vy += P.G * P.DT; b.x += b.vx * P.DT; b.y += b.vy * P.DT;
          const rc = Math.round(b.y / P.SY);
          for (let r = rc - 1; r <= rc + 1; r++) {
            if (r < 0 || r >= P.ROWS) continue;
            const row = ROW_PEGS[r], kc = r % 2 ? Math.round(b.x + 4.5) : Math.round(b.x + 4);
            for (let k = kc - 1; k <= kc + 1; k++) {
              if (k < 0 || k >= row.length) continue;
              const v = collide(b, row[k], rand);
              if (v > P.V_IMPACT && onHit) onHit(b, row[k], v);
            }
          }
          collide(b, WALLS[0], rand); collide(b, WALLS[1], rand);
          if (b.y > P.JAR_TOP - P.BALL_R - P.DIV_R) {
            const jc = slotOfX(b.x);
            for (let j = jc - 1; j <= jc; j++) if (j >= 0 && j < DIVIDERS.length) collide(b, DIVIDERS[j], rand);
          }
          if (b.y > P.FLOOR - 1) collide(b, FLOOR_SEG, rand);
        }
        for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) {
          if (balls[i].sleep && balls[j].sleep) continue;
          const v = collideBalls(balls[i], balls[j]);
          if (v > P.V_IMPACT * 2 && onHit) onHit(balls[i], null, v);
        }
        let moving = false;
        for (const b of balls) {
          if (b.sleep) continue;
          const sp2 = b.vx * b.vx + b.vy * b.vy, inSlot = b.y > P.JAR_TOP - P.BALL_R;
          // settled in a slot: it goes to sleep and becomes part of the pile
          // judged by how far it actually moved this step (a marble wedged on the pile can show speed but not move)
          const moved = Math.abs(b.x - b.px) + Math.abs(b.y - b.py); b.px = b.x; b.py = b.y;
          if (inSlot && (sp2 < 1.5 || moved < 0.004)) { if (++b.still > 24) { b.sleep = true; b.vx = b.vy = 0; continue; } } else b.still = 0;
          moving = true;
          if (!inSlot) {
            moving = true;
            if (sp2 < 0.04) { if (++b.slow > 60) { b.vx += (rand() - 0.5) * 2.5; b.vy -= 0.8; b.slow = 0; b.kicked++; } }
            else b.slow = 0;
          }
        }
        calm = moving ? 0 : calm + 1; since++;
      },
      // all asleep — or, 6 s after the last drop, every marble at least sitting in a slot (a rare wedge on the pile)
      settled: () => balls.length > 0 && (calm > 30 || (since > 240 * 6 && balls.every(b => b.y > P.JAR_TOP - P.BALL_R))),
      slots: () => balls.map(b => slotOfX(b.x)),
    };
  }

  // Hidden slot multipliers: each slot draws its own, so a marble's expected multiplier is the table average
  // (4.85) wherever it is dropped. Weights are out of 1000.
  const MULTS = [[1, 320], [2, 250], [3, 160], [5, 130], [10, 90], [25, 40], [100, 10]];
  const MULT_TOTAL = MULTS.reduce((a, m) => a + m[1], 0);
  const drawMult = rand => { let x = rand() * MULT_TOTAL; for (const [v, w] of MULTS) { x -= w; if (x < 0) return v; } return 1; };
  const drawMults = (rand, boost = 1) => Array.from({ length: PHYS.NSLOTS }, () => drawMult(rand) * boost);
  // Buy bonus: clean prices for Ladder Spins. Super and Mega start the climber higher up the ladder (rung index `start`).
  const BUY = [
    { id: 'spins', name: 'Ladder Spins', price: 50,  spins: 12, start: 0 },
    { id: 'super', name: 'Super Spins',  price: 100, spins: 12, start: 3 },
    { id: 'mega',  name: 'Mega Spins',   price: 200, spins: 12, start: 6 },
  ];
  // What a finished run pays: per slot, marbles in it × its multiplier × bet.
  function payRun(mults, slots, bet) {
    const counts = new Array(PHYS.NSLOTS).fill(0);
    for (const s of slots) counts[s]++;
    const pays = counts.map((c, j) => Math.round(c * mults[j] * bet * 100) / 100);
    return { counts, pays, total: Math.round(pays.reduce((a, b) => a + b, 0) * 100) / 100 };
  }
  // Simulator for the payout maths: random drop spots, a marble every `gap` steps (the page uses the player's taps).
  function playBonus(rand, bet, marbles, boost = 1, gap = 60) {
    const mults = drawMults(rand, boost), board = makeBoard(rand);
    let steps = 0;
    for (let i = 0; i < marbles; i++) { board.add((rand() - 0.5) * 2 * PHYS.AIM_MAX); for (let s = 0; s < gap; s++, steps++) board.step(); }
    while (!board.settled() && steps < 240 * 30) { board.step(); steps++; }
    const slots = board.slots();
    return { mults, slots, steps, kicks: board.balls.reduce((a, b) => a + b.kicked, 0), ...payRun(mults, slots, bet) };
  }
  const buyPrice = (tier, bet) => Math.round(tier.price * bet * 100) / 100;
  const spinCost = (bet, boosted) => Math.round(bet * (boosted ? BOOST.cost : 1) * 100) / 100;

  // ---------------------------------------------------------------------------------------------
  // Base game.
  let nextId = 1;
  function makeDrawer(boosted) {
    const w = Object.assign({}, WEIGHTS, boosted ? { gold: BOOST.gold } : {});
    const total = Object.values(w).reduce((a, b) => a + b, 0);
    return rand => { let x = rand() * total; for (const k in w) { x -= w[k]; if (x < 0) return k; } return 'amethyst'; };
  }
  const DRAW = { false: makeDrawer(false), true: makeDrawer(true) };
  function findClusters(grid) {
    const seen = grid.map(col => col.map(() => false));
    const out = [];
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
      const color = grid[c][r].color;
      if (seen[c][r] || color === GOLD) continue;
      const cells = [], stack = [[c, r]]; seen[c][r] = true;
      while (stack.length) {
        const [x, y] = stack.pop(); cells.push([x, y]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || seen[nx][ny]) continue;
          if (grid[nx][ny].color !== color) continue;
          seen[nx][ny] = true; stack.push([nx, ny]);
        }
      }
      if (cells.length >= MIN_CLUSTER) out.push({ color, size: cells.length, cells, ids: cells.map(([x, y]) => grid[x][y].id) });
    }
    return out;
  }
  const luckyMult = (color, luckyId) => { const L = LUCKY[luckyId]; return L && L.color === color ? L.mult : 1; };
  const clusterPayAt = (color, size, bet, luckyId, mult) =>
    Math.round(COLOR_PAY[color] * sizeMult(size) * luckyMult(color, luckyId) * mult * bet * 100) / 100;
  const clusterPay = (color, size, bet, luckyId, step = 1) => clusterPayAt(color, size, bet, luckyId, rung(luckyId, step));
  const QUEUE = 7;
  // The order marbles leave the queue: pass after pass across the columns, one marble per
  // column that still needs one. need[c] = marbles column c needs. Returns [column, layer] pairs.
  function dropOrder(need) {
    const out = [], left = need.slice();
    for (let layer = 0; left.some(n => n > 0); layer++) {
      const cols = [0, 1, 2, 3, 4, 5, 6];            // the slide runs right to left, so far columns go first
      for (const c of cols) if (left[c] > 0) { out.push([c, need[c] - left[c]]); left[c]--; }
    }
    return out;
  }
  const countGold = g => g.reduce((n, col) => n + col.filter(m => m.color === GOLD).length, 0);
  const cloneGrid = g => g.map(col => col.map(m => ({ ...m })));

  // One spin: initial grid, then cascades until no cluster remains. ladder.mult() is what the next cascade pays
  // (× on every cluster in it) and ladder.climb() moves up a rung after it.
  function spinCore(rand, bet, luckyId, draw, ladder) {
    const fresh = () => ({ id: nextId++, color: draw(rand) });
    const grid = [];
    for (let c = 0; c < COLS; c++) { grid.push([]); for (let r = 0; r < ROWS; r++) grid[c].push(fresh()); }
    const initial = cloneGrid(grid), cascades = [];
    // One lift feeds the whole pit. It shows the next marbles, in the order they will drop.
    const queue = Array.from({ length: QUEUE }, fresh);
    const cloneQ = () => queue.map(m => ({ ...m }));
    const queue0 = cloneQ();
    const initialOrder = dropOrder(new Array(COLS).fill(ROWS)).map(([c, k]) => grid[c][k].id);
    let total = 0;
    for (let n = 1; ; n++) {
      const clusters = findClusters(grid);
      if (!clusters.length) break;
      const mult = ladder.mult(n), at = ladder.at ? ladder.at() : n;
      let win = 0;
      for (const cl of clusters) { cl.lucky = luckyMult(cl.color, luckyId) > 1; cl.rung = mult; cl.pay = clusterPayAt(cl.color, cl.size, bet, luckyId, mult); win += cl.pay; }
      total += win;
      if (ladder.climb) ladder.climb();
      const popped = new Set(clusters.flatMap(cl => cl.ids));
      for (let c = 0; c < COLS; c++) grid[c] = grid[c].filter(m => !popped.has(m.id));
      // the lift refills the gaps sweeping across the columns, one marble per column per pass
      const need = grid.map(col => ROWS - col.length), order = [];
      for (const [c] of dropOrder(need)) { const m = queue.shift(); grid[c].push(m); order.push(m.id); queue.push(fresh()); }
      cascades.push({ clusters, win, rung: mult, at, after: cloneGrid(grid), order, queue: cloneQ() });
    }
    return { initial, initialOrder, queue0, cascades, total: Math.round(total * 100) / 100, gold: countGold(grid) };
  }

  // ---------------------------------------------------------------------------------------------
  // Ladder Spins, the bonus. 3 or more gold marbles on the grid after a spin win free spins, and in them the
  // Ladder Climb stops resetting: every cascade climbs a rung of a tall ladder and the climber stays up there
  // for the rest of the bonus. Every gold marble that lands climbs a rung too, and 3+ gold in a free spin win
  // more spins. Reach the top rung and the Marble Run opens as the finale once the spins are done.
  const BIG = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 50];
  // Gold star's ladder climbs faster here too: the same rungs, richer from ×5 up.
  const BIG_STAR = [1, 2, 3, 5, 6, 8, 10, 12, 15, 20, 25, 30, 50];
  const bigFor = luckyId => (luckyId === GOLD ? BIG_STAR : BIG);
  const TOP = BIG.length - 1;
  const FS = { gold: 0.67, spins: [10, 11, 12], retrig: 3, maxSpins: 60, finale: 5 };
  const freeSpins = gold => FS.spins[Math.min(gold, 5) - 3];
  const DRAW_FS = (() => {
    const w = Object.assign({}, WEIGHTS, { gold: FS.gold }), total = Object.values(w).reduce((a, b) => a + b, 0);
    return rand => { let x = rand() * total; for (const k in w) { x -= w[k]; if (x < 0) return k; } return 'amethyst'; };
  })();
  // Plays a whole bonus up front (the page replays it). startRung: where the climber starts (bought tiers start higher).
  function playLadder(rand, bet, luckyId, spins, startRung = 0) {
    let r = Math.min(TOP, startRung), left = spins, total = 0, top = r === TOP;
    const start = r, out = [];
    const L = bigFor(luckyId);
    const ladder = { mult: () => L[r], at: () => r, climb: () => { r = Math.min(TOP, r + 1); } };
    while (left > 0 && out.length < FS.maxSpins) {
      left--;
      const r0 = r;
      const res = spinCore(rand, bet, luckyId, DRAW_FS, ladder);
      const afterCascades = r;
      r = Math.min(TOP, r + res.gold);
      const extra = res.gold >= 3 ? FS.retrig : 0;
      left += extra;
      if (r === TOP) top = true;
      total += res.total;
      out.push({ ...res, rungStart: r0, rungCascades: afterCascades, rungEnd: r, extra, left });
    }
    total = Math.round(total * 100) / 100;
    return { spins: out, start, total, top, finale: top ? { marbles: FS.finale, mults: drawMults(rand, 1) } : null };
  }

  // One paid spin. The Ladder Climb resets every spin here: cascade n pays × rung(n).
  function playSpin(rand, bet, luckyId, boosted = false) {
    const res = spinCore(rand, bet, luckyId, DRAW[!!boosted], { mult: n => rung(luckyId, n) });
    return { ...res, bonus: res.gold >= 3, spins: res.gold >= 3 ? freeSpins(res.gold) : 0 };
  }

  root.MarbleEngine = {
    COLS, ROWS, QUEUE, MIN_CLUSTER, COLORS, GOLD, WEIGHTS, BOOST, COLOR_PAY, sizeMult, LADDER, LUCKY, ladderFor, rung, luckyMult,
    PHYS, PEGS, WALLS, DIVIDERS, MULTS, BUY, buyPrice, spinCost, slotOfX, BIG, BIG_STAR, bigFor, TOP, FS, freeSpins,
    makeBoard, drawMults, payRun, playBonus, playSpin, playLadder, findClusters, clusterPay,
  };
})(typeof window !== 'undefined' ? window : globalThis);
