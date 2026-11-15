// SVG board drawing. Board space is 1000×1000; square n's centre comes from squareCenter(n).
// Layers (back to front): tiles → art (ladders, snakes) → labels (numbers, values) → reach → token → fx.
// Labels sit above the art with a halo so values stay readable under ladders and snakes.

import { N, isResting, squareCenter } from '../engine/board.js';
import { fmtMult } from './format.js';

// Jungle: sand at the bottom, through sunlit leaves, up to the canopy. Rows 9–10 are the dark Serpent's Nest.
const ROW_COLORS = ['#F6DFAE', '#F3CB8E', '#ECE38E', '#CBE68C', '#A6DD8F', '#86D3A6', '#7CCBC2', '#8CCBE0'];
const NEST = ['#2F5D3A', '#284F32'];
const INK = '#22301F';

/** Shared gradients and filters, drawn once into <defs>. */
export function defsMarkup() {
  return `
  <linearGradient id="tileShine" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.45"/>
    <stop offset="0.45" stop-color="#FFFFFF" stop-opacity="0"/>
    <stop offset="1" stop-color="#000000" stop-opacity="0.08"/>
  </linearGradient>
  <linearGradient id="bustTile" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FF6B6F"/><stop offset="1" stop-color="#C81D25"/>
  </linearGradient>
  <radialGradient id="pit" cx="0.5" cy="0.35" r="0.7">
    <stop offset="0" stop-color="#2A0306"/><stop offset="1" stop-color="#6E0B11"/>
  </radialGradient>
  <linearGradient id="goldTile" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#FFE38A"/><stop offset="0.5" stop-color="#FFC83D"/><stop offset="1" stop-color="#F0A500"/>
  </linearGradient>
  <linearGradient id="startTile" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FFB86B"/><stop offset="1" stop-color="#E07A2E"/>
  </linearGradient>
  <linearGradient id="snakeSkin" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#6FA8FF"/><stop offset="1" stop-color="#1F5FD6"/>
  </linearGradient>
  <linearGradient id="snakeSkin2" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#B48CFF"/><stop offset="1" stop-color="#6A3FD1"/>
  </linearGradient>
  <radialGradient id="pawnBody" cx="0.35" cy="0.3" r="0.8">
    <stop offset="0" stop-color="#FF9ACB"/><stop offset="0.55" stop-color="#FF4FA3"/><stop offset="1" stop-color="#C21E72"/>
  </radialGradient>
  <filter id="artShadow" x="-10%" y="-10%" width="120%" height="120%">
    <feDropShadow dx="3" dy="7" stdDeviation="3.5" flood-color="#1A2A10" flood-opacity="0.4"/>
  </filter>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="6"/>
  </filter>`;
}

function tileFill(n) {
  const row = Math.floor((n - 1) / 10);
  const alt = (n + row) % 2 === 0;
  if (row >= 8) return alt ? NEST[1] : NEST[0];
  return alt ? shade(ROW_COLORS[row], 0.07) : ROW_COLORS[row];
}

function shade(hex, amt) {
  const v = parseInt(hex.slice(1), 16);
  const ch = (x) => Math.round(x * (1 - amt)).toString(16).padStart(2, '0');
  return `#${ch(v >> 16)}${ch((v >> 8) & 255)}${ch(v & 255)}`;
}

function tile(x, y, fill) {
  return `<rect x="${x - 47}" y="${y - 47}" width="94" height="94" rx="16" fill="${fill}"/>` +
    `<rect x="${x - 47}" y="${y - 47}" width="94" height="94" rx="16" fill="url(#tileShine)"/>`;
}

function bustTile(x, y) {
  return `<rect x="${x - 47}" y="${y - 47}" width="94" height="94" rx="16" fill="url(#bustTile)"/>` +
    `<rect x="${x - 47}" y="${y - 47}" width="94" height="94" rx="16" fill="url(#tileShine)"/>` +
    `<ellipse cx="${x}" cy="${y + 14}" rx="31" ry="21" fill="url(#pit)" stroke="#8E1219" stroke-width="3"/>` +
    // fangs hanging into the pit
    `<path d="M${x - 17} ${y - 4} l7 19 l7 -19 z M${x + 3} ${y - 4} l7 19 l7 -19 z" fill="#FFFFFF" stroke="#E9D6D6" stroke-width="1.5" stroke-linejoin="round"/>` +
    `<circle cx="${x - 11}" cy="${y + 26}" r="3.5" fill="#FFD23F"/><circle cx="${x + 11}" cy="${y + 26}" r="3.5" fill="#FFD23F"/>`;
}

function topTile(x, y) {
  const star = 'M0 -30l9 18 20 3-14.5 14 3.5 20-18-9.5-18 9.5 3.5-20-14.5-14 20-3z';
  return `<rect x="${x - 47}" y="${y - 47}" width="94" height="94" rx="16" fill="url(#goldTile)" stroke="#FFFFFF" stroke-width="4"/>` +
    `<g class="top-star" style="transform-origin:${x}px ${y - 12}px"><path transform="translate(${x} ${y - 12})" d="${star}" fill="#FFFFFF" stroke="#B37400" stroke-width="4" stroke-linejoin="round"/></g>`;
}

function startTile(x, y) {
  return `<rect x="${x - 47}" y="${y - 47}" width="94" height="94" rx="16" fill="url(#startTile)"/>` +
    `<rect x="${x - 47}" y="${y - 47}" width="94" height="94" rx="16" fill="url(#tileShine)"/>`;
}

function ladderSvg(bottom, top) {
  const a = squareCenter(bottom), b = squareCenter(top);
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  const px = -uy * 20, py = ux * 20;
  // rails run a little past each centre so the ladder sits on the squares
  const a2 = { x: a.x - ux * 18, y: a.y - uy * 18 }, b2 = { x: b.x + ux * 18, y: b.y + uy * 18 };
  const rail = (s) => `M${a2.x + s * px} ${a2.y + s * py}L${b2.x + s * px} ${b2.y + s * py}`;
  const n = Math.max(2, Math.round(len / 38));
  let rungs = '';
  for (let i = 1; i < n; i++) {
    const t = i / n, mx = a.x + dx * t, my = a.y + dy * t;
    rungs += `M${mx + px} ${my + py}L${mx - px} ${my - py}`;
  }
  // Bamboo: dark rings ("nodes") across each rail, rope-tied rungs
  const total = len + 36;
  let nodes = '';
  for (let d = 30; d < total - 10; d += 46) {
    for (const s of [1, -1]) {
      const cx = a2.x + ux * d + s * px, cy = a2.y + uy * d + s * py;
      nodes += `M${cx - uy * 8} ${cy + ux * 8}L${cx + uy * 8} ${cy - ux * 8}`;
    }
  }
  return `<g class="ladder">` +
    `<path d="${rungs}" stroke="#5E4A12" stroke-width="15" stroke-linecap="round"/>` +
    `<path d="${rungs}" stroke="#C9B04A" stroke-width="8" stroke-linecap="round"/>` +
    `<path d="${rail(1)}${rail(-1)}" stroke="#5E4A12" stroke-width="21" stroke-linecap="round"/>` +
    `<path d="${rail(1)}${rail(-1)}" stroke="#D9C45A" stroke-width="14" stroke-linecap="round"/>` +
    `<path d="${rail(1)}${rail(-1)}" stroke="#F4E9A6" stroke-width="4" stroke-linecap="round" transform="translate(${uy * 3} ${-ux * 3})" opacity="0.9"/>` +
    `<path d="${nodes}" stroke="#7A6418" stroke-width="4" stroke-linecap="round"/>` +
    `</g>`;
}

function bezierPoint(p, t) {
  const m = 1 - t;
  return {
    x: m * m * m * p[0].x + 3 * m * m * t * p[1].x + 3 * m * t * t * p[2].x + t * t * t * p[3].x,
    y: m * m * m * p[0].y + 3 * m * m * t * p[1].y + 3 * m * t * t * p[2].y + t * t * t * p[3].y,
  };
}

function snakeSvg(head, tail, idx) {
  const a = squareCenter(head), b = squareCenter(tail);
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  const nx = -dy / len, ny = dx / len, w = Math.min(70, len * 0.35);
  const ctrl = [a, { x: a.x + dx / 3 + nx * w, y: a.y + dy / 3 + ny * w }, { x: a.x + (2 * dx) / 3 - nx * w, y: a.y + (2 * dy) / 3 - ny * w }, b];
  const centre = `M${a.x} ${a.y}C${ctrl[1].x} ${ctrl[1].y} ${ctrl[2].x} ${ctrl[2].y} ${b.x} ${b.y}`;

  // Tapered body: offset the centre line left/right by a radius that shrinks toward the tail.
  const SAMPLES = 44;
  const left = [], right = [], centrePts = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const p = bezierPoint(ctrl, t);
    const q = bezierPoint(ctrl, Math.min(1, t + 0.01)), o = bezierPoint(ctrl, Math.max(0, t - 0.01));
    let tx = q.x - o.x, ty = q.y - o.y; const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const r = (21 * (1 - t) + 4 * t) * (1 + 0.18 * Math.sin(Math.PI * t));
    left.push([p.x - ty * r, p.y + tx * r]);
    right.push([p.x + ty * r, p.y - tx * r]);
    centrePts.push({ ...p, tx, ty, r });
  }
  const body = `M${left.map((p) => p.join(' ')).join('L')}L${right.reverse().map((p) => p.join(' ')).join('L')}Z`;

  // Spots alternate sides along the back
  let spots = '';
  for (let i = 5; i < SAMPLES - 3; i += 4) {
    const c = centrePts[i], side = (i / 4) % 2 ? 1 : -1, off = c.r * 0.35 * side;
    spots += `<ellipse cx="${c.x - c.ty * off}" cy="${c.y + c.tx * off}" rx="${Math.max(2.5, c.r * 0.34)}" ry="${Math.max(2, c.r * 0.24)}" fill="#FFE066" stroke="#1B2457" stroke-width="1.5" opacity="0.95"/>`;
  }
  // Head points back along the body's starting direction
  const h = centrePts[0];
  const hx = -h.tx, hy = -h.ty; // forward = away from the body
  const ang = (Math.atan2(hy, hx) * 180) / Math.PI;
  const skin = idx % 2 ? 'url(#snakeSkin2)' : 'url(#snakeSkin)';
  const eye = (s) => {
    const ex = h.x + hx * 8 + -hy * 12 * s, ey = h.y + hy * 8 + hx * 12 * s;
    return `<circle cx="${ex}" cy="${ey}" r="8" fill="#FFFFFF" stroke="#1B2457" stroke-width="2"/><circle cx="${ex + hx * 2.5}" cy="${ey + hy * 2.5}" r="4.2" fill="#1D2340"/><circle cx="${ex + hx * 1 - 1.5}" cy="${ey + hy * 1 - 1.5}" r="1.5" fill="#FFFFFF"/>`;
  };
  const tipX = h.x + hx * 34, tipY = h.y + hy * 34;
  const tongue = `<path d="M${h.x + hx * 24} ${h.y + hy * 24}L${tipX} ${tipY}l${hx * 9 - hy * 6} ${hy * 9 + hx * 6}M${tipX} ${tipY}l${hx * 9 + hy * 6} ${hy * 9 - hx * 6}" stroke="#E5383B" stroke-width="4" stroke-linecap="round" fill="none"/>`;
  return `<g class="snake">` +
    `<path id="snake-${head}" d="${centre}" fill="none" stroke="none"/>` +
    `<path d="${body}" fill="${skin}" stroke="#1B2457" stroke-width="5" stroke-linejoin="round"/>` +
    spots + tongue +
    `<ellipse cx="${h.x + hx * 6}" cy="${h.y + hy * 6}" rx="30" ry="25" transform="rotate(${ang} ${h.x + hx * 6} ${h.y + hy * 6})" fill="${skin}" stroke="#1B2457" stroke-width="5"/>` +
    `<circle cx="${h.x + hx * 26 - hy * 6}" cy="${h.y + hy * 26 + hx * 6}" r="2" fill="#1B2457"/><circle cx="${h.x + hx * 26 + hy * 6}" cy="${h.y + hy * 26 - hx * 6}" r="2" fill="#1B2457"/>` +
    eye(1) + eye(-1) + `</g>`;
}

/** Tiles (back layer). */
export function tilesMarkup(board) {
  let out = '';
  for (let n = 1; n <= N; n++) {
    const { x, y } = squareCenter(n);
    out += `<g class="cell" data-sq="${n}">`;
    if (n === N) out += topTile(x, y);
    else if (n === 1) out += startTile(x, y);
    else if (board.biters.has(n)) out += bustTile(x, y);
    else out += tile(x, y, tileFill(n));
    out += '</g>';
  }
  return out;
}

/** Ladders and snakes (middle layer). */
export function artMarkup(board) {
  const ladders = Object.entries(board.ladders).map(([b, t]) => ladderSvg(+b, t)).join('');
  const snakes = Object.entries(board.sliders).map(([h, t], i) => snakeSvg(+h, t, i)).join('');
  return ladders + snakes;
}

/** Numbers and values (front layer), with a halo so they read over the art. */
export function labelsMarkup(board, { showValues }) {
  let out = '';
  for (let n = 1; n <= N; n++) {
    const { x, y } = squareCenter(n);
    const dark = n > 80 || board.biters.has(n) || n === 1;
    const fill = dark ? '#FFFFFF' : INK;
    const halo = dark ? 'rgba(15,30,15,0.6)' : 'rgba(255,255,255,0.88)';
    const attrs = `fill="${fill}" stroke="${halo}" stroke-width="7" paint-order="stroke" stroke-linejoin="round"`;
    if (n === 1) {
      // written up the left edge so the pawn (which sits right of centre on Start) never covers it
      out += `<text x="${x - 30}" y="${y}" text-anchor="middle" dominant-baseline="central" class="lbl-start" transform="rotate(-90 ${x - 30} ${y})" ${attrs}>START</text>`;
      continue;
    }
    if (n === N) {
      out += `<text x="${x}" y="${y + 38}" text-anchor="middle" class="lbl-val" fill="#5A3A00" stroke="rgba(255,255,255,0.85)" stroke-width="7" paint-order="stroke">${fmtMult(board.m[N], true)}</text>`;
      continue;
    }
    out += `<text x="${x - 38}" y="${y - 22}" class="lbl-num" ${attrs}>${n}</text>`;
    if (showValues && isResting(board, n)) {
      out += `<text x="${x}" y="${y + 33}" text-anchor="middle" class="lbl-val" ${attrs}>${fmtMult(board.m[n], true)}</text>`;
    }
  }
  return out;
}

/** Glowing outlines on squares reachable next roll, with the die face that reaches them. */
export function reachMarkup(outcomes) {
  const seen = new Map();
  for (const o of outcomes) {
    if (!seen.has(o.landed)) seen.set(o.landed, { faces: [], kind: o.kind });
    seen.get(o.landed).faces.push(o.face);
  }
  let out = '';
  for (const [sq, { faces, kind }] of seen) {
    const { x, y } = squareCenter(sq);
    const col = kind === 'bust' ? '#FF3B3F' : '#FFFFFF';
    out += `<rect class="reach-ring" x="${x - 45}" y="${y - 45}" width="90" height="90" rx="15" fill="none" stroke="${col}" stroke-width="7"/>`;
    faces.forEach((f, i) => {
      const bx = x + 28 - i * 30, by = y - 28; // top-right corner: the number is top-left, the value at the bottom
      out += `<rect x="${bx - 14}" y="${by - 14}" width="28" height="28" rx="7" fill="#FFFFFF" stroke="${INK}" stroke-width="3"/>` +
        `<text x="${bx}" y="${by + 8}" text-anchor="middle" class="face-badge">${f}</text>`;
    });
  }
  return out;
}

export function tokenMarkup() {
  return `<ellipse class="token-ground" cx="0" cy="36" rx="26" ry="8" fill="#1A2A10" opacity="0.35"/>` +
    `<g class="token-hop"><circle class="token-shield" cx="0" cy="-4" r="50" fill="rgba(120,180,255,0.28)" stroke="#9CC2FF" stroke-width="5"/>` +
    `<g class="token-shape"><g class="token-bob"><g transform="scale(0.86)">` +
    `<path d="M-27 34 C-27 14 -15 4 -10 -6 L10 -6 C15 4 27 14 27 34 Q0 44 -27 34 Z" fill="url(#pawnBody)" stroke="#FFFFFF" stroke-width="5" stroke-linejoin="round"/>` +
    `<ellipse cx="0" cy="-8" rx="17" ry="6" fill="#C21E72" stroke="#FFFFFF" stroke-width="4"/>` +
    `<circle cx="0" cy="-26" r="20" fill="url(#pawnBody)" stroke="#FFFFFF" stroke-width="5"/>` +
    `<ellipse cx="-7" cy="-31" rx="6" ry="4" fill="#FFFFFF" opacity="0.75"/>` +
    // safari hat
    `<ellipse cx="0" cy="-38" rx="27" ry="7" fill="#C9A86A" stroke="#6B4E1F" stroke-width="3.5"/>` +
    `<path d="M-15 -39 C-15 -56 15 -56 15 -39 Z" fill="#E2C68A" stroke="#6B4E1F" stroke-width="3.5" stroke-linejoin="round"/>` +
    `<path d="M-15 -42 L15 -42" stroke="#6B4E1F" stroke-width="4"/>` +
    `</g></g></g></g>`;
}

export function placeToken(el, n, ms = 0) {
  const c = squareCenter(n);
  const x = n === 1 ? c.x + 14 : c.x, y = c.y;
  el.style.transition = ms ? `transform ${ms}ms cubic-bezier(.3,.7,.4,1)` : 'none';
  el.style.transform = `translate(${x}px, ${y - 6}px)`;
}

/** Put the token at a raw board point (used for sliding along a snake). */
export function placeTokenAt(el, x, y) {
  el.style.transition = 'none';
  el.style.transform = `translate(${x}px, ${y - 6}px)`;
}
