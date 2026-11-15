/* Fair Winds renderer — copied from src/game.html on 2026-11-14 by live/tools/copy_render.py.
 * Only edit live/adapter.js, not this file: re-run the copy script to carry Fair Winds fixes across.
 * The copy is verbatim; the few changes the live game needs are marked  // LIVE .
 * Each block notes its line range in src/game.html at copy time. */
"use strict";
// ---- LIVE: stand-ins for the Fair Winds globals this code reads (the adapter fills them in) ----
const $ = id => document.getElementById(id);
const G = { sound:true, music:true, calm:false };
const calm = () => G.calm || matchMedia("(prefers-reduced-motion:reduce)").matches;
const LIVE_VOYAGE = { id:"magellan", who:"", year:1519, from:"", to:"", max:1000, storm:.085, design:"Carrack",
  designs:["Carrack"], cargo:"Carrack", theme:"pacific",   // LIVE: one ship sails the voyage
  ships:["Victoria"], sizes:[1.1] };
const voyage = () => LIVE_VOYAGE;
const HOME_P = .97;                     // the home coast comes into sight for the last 3% of the route
let cv = null, cx = null, W = 800, H = 500, DPR = 1;   // DT is declared in the copied drawing block
let R = null;

// ===== helpers — src/game.html lines 865–865 =====
function mulberry32(seed){ return function(){ seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ===== helpers: clamp/lerp/ease — src/game.html lines 892–896 =====
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
// how far to close a gap this frame when easing toward a target at rate k: the same speed at any frame rate (lerp by DT * k ran fast on slow frames)
const follow = (k, dt) => 1 - Math.exp(-k * dt);

// ===== ship art, sprites, rigs, sail motion — src/game.html lines 917–1118 =====
const INK = "#0a0f28";
const DESIGNS = {
  Galleon:{ hull:"#8b4a2b", trim:"#ffc93c", sail:"#ffffff", stripe:"#e8402f", masts:3, rig:"square", flag:"#e8402f", cabin:"#ffc93c" },
  Frigate:{ hull:"#2f5d9e", trim:"#ffffff", sail:"#fffaf0", stripe:"#2f5d9e", masts:3, rig:"square", flag:"#ffc93c", cabin:"#ffffff" },
  Caravel:{ hull:"#c9822b", trim:"#2b2a4a", sail:"#fff4e0", stripe:"#e8402f", masts:3, rig:"mixed", flag:"#e8402f", cabin:"#fffaf0" },
  Pirate:{ hull:"#2b2a3a", trim:"#c9353f", sail:"#22243a", stripe:"#e8e8f0", masts:3, rig:"square", flag:"#111222", cabin:"#c9353f" },
  Brigantine:{ hull:"#9c4d2c", trim:"#ffe08a", sail:"#f3e2bf", stripe:"#c9793a", masts:2, rig:"mixed", flag:"#2f5d9e", cabin:"#ffe08a" },
};
const SK = w => `stroke="${INK}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
// freight sails as a deep-laden merchantman: wider in the beam, cargo lashed on deck.
const DECK = { Carrack:[31, 68, 42], Caravel:[30, 66, 42], GalleonEN:[30, 68, 42], Bark:[20, 80, 40], Junk:[22, 74, 42], Longship:[50, 84, 40] };
function cargoSvg(name){
  const [x0, x1, y] = DECK[name] || [30, 70, 42], rnd = mulberry32(name.length * 131 + name.charCodeAt(1)); let out = "", x = x0;
  while (x < x1 - 5){ const r = rnd();
    if (r < .42){ const st = rnd() < .45 ? 2 : 1; for (let k = 0; k < st; k++){ const yy = y - 6 * (k + 1); out += `<rect x="${x}" y="${yy}" width="7" height="6" fill="#b07a45" ${SK(1.3)}/><path d="M${x},${yy} L${x + 7},${yy + 6} M${x + 7},${yy} L${x},${yy + 6}" stroke="#7a4f28" stroke-width=".9"/>`; } x += 8.5; }
    else if (r < .78){ out += `<rect x="${x}" y="${y - 7}" width="5.6" height="7" rx="2" fill="#9a5a32" ${SK(1.2)}/><path d="M${x},${y - 5} L${x + 5.6},${y - 5} M${x},${y - 2} L${x + 5.6},${y - 2}" stroke="#e0b84a" stroke-width=".9"/>`; x += 7; }
    else { out += `<path d="M${x},${y} Q${x - 1},${y - 6} ${x + 3.5},${y - 7} Q${x + 8},${y - 6} ${x + 7},${y} Z" fill="#d9c49a" ${SK(1.1)}/>`; x += 8.5; } }
  return out;
}
// the historical drawings were made bow-left; mirror them so every ship sails bow-first to the right like the fleet
const FACE_LEFT = new Set(["Carrack", "Caravel", "GalleonEN", "Bark", "Junk"]);
// where each design's flag is, in the drawing's own units: [hoist x, fly x as drawn, top y, bottom y]
const FLAG_AT = { Carrack:[52, 64, 0, 6.5], Caravel:[69, 80, 3, 10], GalleonEN:[50, 66, 0, 11], Bark:[87, 99, 20, 30], Xebec:[28, 14, 1, 10], Sloop:[55, 71, 0, 12], Dhow:[56, 70, 5, 12], PirateJunk:[52, 40, 1, 8], Lanong:[52, 28, 0, 8] };
// one wind for the whole scene: the fleet runs before a following wind, so the sails belly forward and every flag flies out ahead,
// toward the bow; a flag drawn streaming aft (most of them) is mirrored about its hoist. aftFlag: does it fly aft as drawn?
const aftFlag = n => !!FLAG_AT[n] && (FLAG_AT[n][1] - FLAG_AT[n][0]) * (FACE_LEFT.has(n) ? -1 : 1) < 0;
const flagFwd = (name, b) => aftFlag(name) ? b.replace('<g data-l="f">', `<g data-l="f" transform="translate(${2 * FLAG_AT[name][0]} 0) scale(-1 1)">`) : b;
function shipBody(name){ const b = flagFwd(name, shipBodyRaw(name)); return FACE_LEFT.has(name) ? `<g transform="translate(100 0) scale(-1 1)">${b}</g>` : b; }
function shipBodyRaw(name){
  // historical ship types for each voyage
  const S3 = SK(3), S2 = SK(2.5);
  if (name === "Carrack") return `<line x1="30" y1="44" x2="30" y2="14" ${S3}/><line x1="52" y1="44" x2="52" y2="0.8" ${S3}/><line x1="80" y1="44" x2="80" y2="16" ${S3}/>
    <g data-l="s"><path d="M20,17 Q30,21 40,17 Q43,28 40,39 Q30,43 20,39 Q23,28 20,17Z" fill="#fff4e0" ${S2}/><path d="M30,20 L30,38 M23,28 L37,28" stroke="#d6322f" stroke-width="4"/>
    <path d="M39,10 Q52,15 65,10 Q69,24 65,39 Q52,44 39,39 Q43,24 39,10Z" fill="#fff4e0" ${S2}/><path d="M52,13 L52,39 M42,25 L62,25" stroke="#d6322f" stroke-width="5"/>
    <path d="M46,6 Q52,7.5 58,6 L57.5,11 Q52,12 46.5,11Z" fill="#fff4e0" ${SK(2)}/></g>
    <line x1="88" y1="11" x2="72" y2="40" ${SK(2.5)}/><g data-l="s"><path d="M87,13 L74,39 L87,39 Z" fill="#fff4e0" ${S2}/></g>
    <g data-l="f"><path d="M52,0.8 L64,3 L52,5.2Z" fill="#d6322f" ${SK(1.8)}/></g>
    <path d="M4,40 L14,40 L14,29 L29,29 L29,42 L72,42 L72,29 L94,29 L96,42 Q90,62 72,64 L28,64 Q10,62 4,40Z" fill="#8b4a2b" ${S3}/>
    <path d="M8,49 Q50,47 92,47" stroke="#ffc93c" stroke-width="3" fill="none"/>${[36, 50, 64].map(x => `<circle cx="${x}" cy="56" r="3" fill="${INK}"/>`).join("")}
    <rect x="76" y="33" width="5" height="5" fill="#ffc93c" ${SK(1.5)}/><rect x="84" y="33" width="5" height="5" fill="#ffc93c" ${SK(1.5)}/>`;
  if (name === "Caravel") return `<line x1="30" y1="44" x2="30" y2="23" ${S3}/><line x1="54" y1="44" x2="54" y2="20" ${S3}/><line x1="78" y1="44" x2="78" y2="25" ${S3}/>
    <g data-l="s">${[[30, 10], [54, 4], [78, 14]].map(([x, t]) => `<path d="M${x + 14},${t + 2} Q${x + 8},${(t + 40) / 2 + 2} ${x - 11},40 L${x + 13},40 Z" fill="#fff4e0" ${S2}/>`).join("")}
    <path d="M62,24 L62,37 M57.5,30.5 L66,30.5" stroke="#d6322f" stroke-width="3.2"/></g>
    ${[[30, 10], [54, 4], [78, 14]].map(([x, t]) => `<line x1="${x + 15}" y1="${t}" x2="${x - 13}" y2="40" ${SK(2.5)}/>`).join("")}
    <g data-l="f"><path d="M69,4 L80,6.5 L69,9Z" fill="#d6322f" ${SK(1.8)}/></g>
    <path d="M6,42 L74,42 L74,34 L92,34 L95,41 Q90,60 74,62 L26,62 Q12,60 6,42Z" fill="#a8652f" ${S3}/><path d="M10,48 Q50,47 92,46" stroke="#ffe08a" stroke-width="3" fill="none"/>`;
  if (name === "GalleonEN") return `<line x1="28" y1="44" x2="28" y2="10" ${S3}/><line x1="50" y1="44" x2="50" y2="2" ${S3}/><line x1="74" y1="44" x2="74" y2="12" ${S3}/>
    <g data-l="s">${[[28, 12, 10], [50, 6, 12]].map(([x, t, w]) => `<path d="M${x - w},${t + 6} Q${x},${t + 10} ${x + w},${t + 6} Q${x + w + 4},${t + 20} ${x + w},${t + 32} Q${x},${t + 36} ${x - w},${t + 32} Q${x - w + 3},${t + 20} ${x - w},${t + 6}Z" fill="#fbf6ea" ${S2}/><path d="M${x - w + 3},${t + 19} Q${x},${t + 22} ${x + w - 1},${t + 19}" stroke="#d9a54a" stroke-width="3" fill="none"/>`).join("")}</g>
    <line x1="84" y1="10" x2="66" y2="40" ${SK(2.5)}/><g data-l="s"><path d="M83,12 L68,39 L82,39 Z" fill="#fbf6ea" ${S2}/></g>
    <g data-l="f"><rect x="50" y="0" width="16" height="10" fill="#fff" ${SK(1.8)}/><path d="M58,0 L58,10 M50,5 L66,5" stroke="#d6322f" stroke-width="2.6"/></g>
    <path d="M2,38 L12,42 L76,42 L76,32 L94,32 L96,42 Q90,62 72,64 L28,64 Q12,62 2,38Z" fill="#5a3420" ${S3}/>
    <path d="M10,48 Q50,46 92,46" stroke="#d9a54a" stroke-width="3" fill="none"/><path d="M14,54 Q50,53 88,53" stroke="#c9353f" stroke-width="3" fill="none"/>${[30, 44, 58].map(x => `<rect x="${x - 3}" y="56" width="6" height="4" fill="${INK}"/>`).join("")}`;
  if (name === "Bark") return `<line x1="28" y1="44" x2="28" y2="8" ${S3}/><line x1="50" y1="44" x2="50" y2="2" ${S3}/><line x1="72" y1="44" x2="72" y2="10" ${S3}/>
    <g data-l="s">${[[28, 8], [50, 2], [72, 10]].map(([x, t]) => `<path d="M${x - 11},${t + 20} Q${x},${t + 23} ${x + 11},${t + 20} L${x + 12},${t + 36} Q${x},${t + 39} ${x - 12},${t + 36}Z" fill="#f3ead6" ${S2}/><path d="M${x - 8},${t + 6} Q${x},${t + 8} ${x + 8},${t + 6} L${x + 9},${t + 18} Q${x},${t + 20} ${x - 9},${t + 18}Z" fill="#f3ead6" ${SK(2)}/>`).join("")}</g>
    <line x1="87" y1="41" x2="87" y2="21" ${SK(2)}/><g data-l="f"><rect x="87" y="21" width="12" height="8" fill="#c9353f" ${SK(1.5)}/><rect x="87.8" y="21.8" width="5.4" height="3.6" fill="#24407a"/><path d="M87.8,21.8 L93.2,25.4 M93.2,21.8 L87.8,25.4" stroke="#fff" stroke-width=".9"/><path d="M90.5,21.8 L90.5,25.4 M87.8,23.6 L93.2,23.6" stroke="#fff" stroke-width="1.5"/><path d="M90.5,21.8 L90.5,25.4 M87.8,23.6 L93.2,23.6" stroke="#c9353f" stroke-width=".7"/></g>
    <path d="M5,40 L95,40 Q92,60 76,63 L24,63 Q10,60 5,40Z" fill="#2b2a33" ${S3}/><path d="M7,47 L93,46" stroke="#d9a54a" stroke-width="4"/>${[26, 40, 54, 68].map(x => `<rect x="${x - 3}" y="51" width="6" height="4" fill="#d9a54a"/>`).join("")}`;
  if (name === "Longship") return `<path d="M30,8 L30,46" ${SK(3)}/><g data-l="s"><path d="M14,10 L46,10 L48,40 L12,40 Z" fill="#e8402f" ${SK(3)}/><path d="M22,10 L22,40 M30,10 L30,40 M38,10 L38,40" stroke="#fffaf0" stroke-width="4"/></g>
    <path d="M2,40 Q6,30 4,22 Q10,28 12,40 L88,40 Q92,30 96,24 Q100,34 94,44 Q86,62 50,62 Q14,62 6,48 Z" fill="#9c4d2c" ${SK(3)}/>${[22,34,46,58,70].map(x => `<circle cx="${x}" cy="47" r="5" fill="#ffc93c" ${SK(2)}/>`).join("")}<circle cx="95" cy="27" r="2" fill="${INK}"/>`;
  if (name === "Junk") return `${[30,52,72].map((x, k) => `<line x1="${x}" y1="46" x2="${x}" y2="${k === 1 ? 2 : 10}" ${SK(3)}/>`).join("")}
    <g data-l="s">${[30,52,72].map((x, k) => { const t = k === 1 ? 6 : 14; return `<path d="M${x - 2},${t} L${x + 14},${t + 2} L${x + 16},40 L${x - 2},40 Z" fill="#ff7a3c" ${SK(2.5)}/>` + [0,1,2,3].map(j => `<path d="M${x - 2},${t + 7 + j * 7} L${x + 15},${t + 8 + j * 7}" stroke="${INK}" stroke-width="1.5"/>`).join(""); }).join("")}</g>
    <path d="M2,36 L20,42 L84,42 L98,32 Q96,58 74,62 L24,62 Q6,58 2,36 Z" fill="#7a3b2a" ${SK(3)}/><path d="M8,46 L92,46" stroke="#ffc93c" stroke-width="3"/><circle cx="16" cy="52" r="4" fill="#fffaf0" ${SK(2)}/><circle cx="14.8" cy="52" r="1.8" fill="${INK}"/>`;
  // ---- raiders, one kind per pirate sea. Drawn bow-right like the fleet; flipped to face it when they attack ----
  if (name === "Xebec") return `${[[24, 8], [50, 2], [76, 10]].map(([m, t]) => `<line x1="${m}" y1="46" x2="${m}" y2="${(t + (42 - t) * .55).toFixed(1)}" ${SK(3)}/>`).join("")}
    ${[[24, 8, .8], [50, 2, 1], [76, 10, .75]].map(([m, t, k]) => { const a = [m + 18 * k, 42], b = [m - 22 * k, t], c = [m - 16 * k, 44];
      return `<g data-l="s"><path d="M${a} L${b} Q${m - 24 * k},${(t + 44) / 2} ${c} Z" fill="#f1dfb8" ${SK(2.5)}/><path d="M${m + 9 * k},${(t + 42) / 2 + 9} L${m - 19 * k},${(t + 44) / 2 + 2}" stroke="#c9353f" stroke-width="4"/></g><line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" ${SK(3)}/>`; }).join("")}
    <g data-l="f"><path d="M28,2 L14,3 L19,6 L14,9 L28,8Z" fill="#c9353f" ${SK(2)}/><path d="M28,5 L17,5.5" stroke="#ffd36b" stroke-width="2"/></g>
    ${[22, 32, 42, 52, 62, 72].map(x => `<line x1="${x}" y1="50" x2="${x - 7}" y2="64" ${SK(2.2)}/>`).join("")}
    <path d="M2,38 L14,44 L84,44 L99,35 L93,47 Q86,59 70,60 L22,60 Q8,58 2,38 Z" fill="#2f4a3a" ${SK(3)}/>
    <path d="M10,48 Q50,46 90,47" stroke="#c9353f" stroke-width="3" fill="none"/>${[22, 32, 42, 52, 62, 72].map(x => `<circle cx="${x}" cy="52" r="2" fill="${INK}"/>`).join("")}<rect x="84" y="39" width="11" height="3.2" rx="1.5" fill="#2b2a33" ${SK(1)}/>`;
  if (name === "Sloop") return `<line x1="54" y1="46" x2="54" y2="2" ${SK(3)}/><line x1="54" y1="40" x2="14" y2="40" ${SK(2.5)}/><line x1="54" y1="8" x2="24" y2="2" ${SK(2.5)}/>
    <g data-l="s"><path d="M53,9 L25,3 Q16,22 15,39 L53,39 Z" fill="#26283a" ${SK(2.5)}/><path d="M34,14 l6,2 l-1,5 l-6,-2Z M24,28 l7,1 l-1,4 l-7,-1Z" fill="#3a3d55"/>
    <path d="M56,6 L94,38 L58,38 Z" fill="#30324a" ${SK(2.5)}/></g><line x1="54" y1="6" x2="98" y2="36" ${SK(2)}/>
    <g data-l="f"><rect x="55" y="1" width="16" height="10" fill="#111" ${SK(1.5)}/><circle cx="63" cy="5" r="2.4" fill="#fff"/><path d="M59,9 L67,6 M59,6 L67,9" stroke="#fff" stroke-width="1.4"/></g>
    <path d="M4,38 L16,42 L80,42 L96,34 Q94,56 74,60 L24,60 Q8,58 4,38 Z" fill="#3a2a22" ${SK(3)}/><path d="M8,46 L92,45" stroke="#b8322f" stroke-width="3"/>${[34, 48, 62].map(x => `<rect x="${x - 3}" y="49" width="6" height="5" fill="${INK}"/>`).join("")}`;
  if (name === "Dhow") return `<line x1="60" y1="46" x2="56" y2="6" ${SK(3)}/><line x1="26" y1="40" x2="24" y2="16" ${SK(2.5)}/>
    <g data-l="s"><path d="M94,34 L18,2 Q24,26 38,42 Z" fill="#d9c49a" ${SK(2.5)}/><path d="M60,20 l7,3 l-2,6 l-7,-3Z" fill="#c4ac7c"/></g><line x1="96" y1="35" x2="14" y2="0" ${SK(3)}/>
    <g data-l="s"><path d="M36,30 L8,12 Q10,28 16,38 Z" fill="#d9c49a" ${SK(2.2)}/></g><line x1="38" y1="31" x2="6" y2="10" ${SK(2.5)}/>
    <g data-l="f"><path d="M56,6 L70,8 L56,11Z" fill="#c9353f" ${SK(1.8)}/></g>
    <path d="M4,26 L20,26 L22,42 L78,42 L99,24 L95,40 Q86,58 66,60 L24,60 Q10,58 4,26 Z" fill="#9a6a3a" ${SK(3)}/>
    <path d="M7,50 Q50,52 92,46 L90,52 Q84,59 66,60 L24,60 Q12,58 8,52 Z" fill="#efe4c8"/>
    ${[9, 15].map(x => `<path d="M${x},38 L${x},33 Q${x + 2},30 ${x + 4},33 L${x + 4},38 Z" fill="${INK}"/>`).join("")}<path d="M22,44 L84,44" stroke="#5a3a1a" stroke-width="2"/>`;
  if (name === "PirateJunk") return `${[30, 52, 72].map((x, k) => `<line x1="${x}" y1="46" x2="${x}" y2="${k === 1 ? 2 : 10}" ${SK(3)}/>`).join("")}
    <g data-l="s">${[30, 52, 72].map((x, k) => { const t = k === 1 ? 6 : 14; return `<path d="M${x + 2},${t} L${x - 14},${t + 2} L${x - 17},40 L${x - 6},38 L${x + 2},40 Z" fill="#5a2230" ${SK(2.5)}/>` + [0, 1, 2, 3].map(j => `<path d="M${x + 2},${t + 7 + j * 7} L${x - 15},${t + 8 + j * 7}" stroke="#c98a5a" stroke-width="1.5"/>`).join(""); }).join("")}</g>
    <g data-l="f"><path d="M52,2 L40,4 L52,7Z" fill="#d6322f" ${SK(1.8)}/></g>
    <path d="M2,32 L18,42 L84,42 L98,36 Q96,58 76,62 L24,62 Q6,58 2,32 Z" fill="#1f1d24" ${SK(3)}/><path d="M8,46 L94,46" stroke="#d6322f" stroke-width="3"/>
    <circle cx="88" cy="50" r="4.5" fill="#fffaf0" ${SK(2)}/><circle cx="89" cy="50" r="2" fill="${INK}"/>${[36, 58].map(x => `<line x1="${x}" y1="42" x2="${x}" y2="39" ${SK(1.2)}/><rect x="${x - 1}" y="36.5" width="8" height="2.8" rx="1.3" fill="#3a3a44" ${SK(.8)}/>`).join("")}`;
  if (name === "Lanong") return `<line x1="44" y1="38" x2="52" y2="4" ${SK(2.6)}/><line x1="60" y1="38" x2="52" y2="4" ${SK(2.6)}/>
    <g data-l="s"><path d="M34,12 L72,4 L76,32 L38,38 Z" fill="#efe0b4" ${SK(2.5)}/>${[44, 54, 64].map(x => `<path d="M${x},${10 - (x - 44) * .2} L${x + 2},${36 - (x - 44) * .1}" stroke="#c9353f" stroke-width="4"/>`).join("")}</g>
    <line x1="32" y1="12" x2="74" y2="3" ${SK(2.5)}/><line x1="36" y1="38" x2="78" y2="32" ${SK(2.5)}/>
    <g data-l="f"><path d="M52,4 Q46,1 40,3 T28,2" stroke="#ffc93c" stroke-width="2.6" fill="none"/><path d="M52,5 Q47,3 42,6 T32,6" stroke="#2fa36b" stroke-width="2.2" fill="none"/></g>
    <rect x="22" y="30" width="56" height="8" fill="#a8743f" ${SK(2.2)}/>${[30, 46, 62].map(x => `<rect x="${x}" y="26" width="9" height="3" rx="1.5" fill="#e0b84a" ${SK(1.2)}/>`).join("")}
    <path d="M2,40 Q4,36 10,38 L90,38 Q98,36 99,42 Q90,58 70,58 L28,58 Q10,58 2,40 Z" fill="#5b3a24" ${SK(3)}/>
    <path d="M8,44 L92,44" stroke="#e0b84a" stroke-width="3"/><path d="M8,49 L92,49" stroke="#c9353f" stroke-width="2"/>
    ${[16, 50, 84].map(x => `<line x1="${x}" y1="46" x2="${x}" y2="53" ${SK(2.2)}/>`).join("")}<line x1="6" y1="53" x2="96" y2="53" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><line x1="6" y1="53" x2="96" y2="53" stroke="#d8b36e" stroke-width="2.4" stroke-linecap="round"/>`;
  const d = DESIGNS[name], s = SK(3), xs = d.masts === 3 ? [28, 50, 72] : [36, 62], mid = Math.floor(xs.length / 2);
  let out = "";
  xs.forEach((x, k) => { out += `<line x1="${x}" y1="46" x2="${x}" y2="${k === mid ? 4 : 12}" ${s}/>`; });
  xs.forEach((x, k) => { const top = k === mid ? 4 : 12;
    if (d.rig === "mixed" && k === xs.length - 1) out += `<path d="M${x + 2},${top + 4} Q${x + 30},${(top + 44) / 2} ${x + 2},42 Z" fill="${d.sail}" ${s}/>`;
    else { const w = 11, y1 = top + 6, y2 = 40, ym = (y1 + y2) / 2;
      out += `<path d="M${x - w},${y1} Q${x},${y1 + 5} ${x + w},${y1} Q${x + w + 5},${ym} ${x + w},${y2} Q${x},${y2 + 5} ${x - w},${y2} Q${x - w + 4},${ym} ${x - w},${y1} Z" fill="${d.sail}" ${s}/>`;
      if (d.stripe) out += `<path d="M${x - w + 3},${ym} Q${x},${ym + 4} ${x + w - 1},${ym}" stroke="${d.stripe}" stroke-width="5" fill="none"/>`; } });
  out += `<path d="M${xs[mid]},4 L${xs[mid] + 15},7 L${xs[mid]},12 Z" fill="${d.flag}" ${SK(2)}/>`;
  out += `<path d="M5,42 L95,40 Q91,62 75,64 L25,64 Q11,62 5,42 Z" fill="${d.hull}" ${s}/><path d="M9,48 Q50,46 92,45" stroke="${d.trim}" stroke-width="3" fill="none"/>`;
  out += [30, 50, 70].map(x => `<circle cx="${x}" cy="55" r="3.2" fill="${INK}"/>`).join("");
  return out + `<path d="M5,42 L5,34 L20,34 L20,42" fill="${d.cabin}" ${SK(2.5)}/>`;
}
const shipSvg = (name, w = 100) => `<svg viewBox="0 0 100 70" width="${w}" aria-hidden="true">${shipBody(name)}</svg>`;
const SPR = {};
const svgImg = (vb, w, body, h = 210) => { const img = new Image(); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${w}" height="${h}">${body}</svg>`); return img; };
const SPRF = {};
for (const n of Object.keys(DESIGNS).concat(["Longship", "Junk", "Carrack", "GalleonEN", "Bark", "Xebec", "Sloop", "Dhow", "PirateJunk", "Lanong"])){
  SPR[n] = svgImg("0 0 100 70", 300, shipBody(n));
  if (DECK[n]){ SPRF[n] = svgImg("-7 0 114 70", 342, `<g transform="translate(50 0) scale(1.12 1) translate(-50 0)">${shipBody(n)}${cargoSvg(n)}</g>`); }
}
// LIVE: no logo slot in the live page
// ---- rigs: each ship in layers (masts and spars, cloth, hull and deck, flags), so the canvas can fill the sails and fly the flags ----
const STIFF = { Junk:.5, PirateJunk:.5, Lanong:.65 };   // battened and matting sails barely ripple
const RIGS = {}, RIG_H = 222, RIG_PAD = 12;             // layers carry 4 units of headroom so a masthead flag can wave upward
function shipLayers(name){
  const parts = flagFwd(name, shipBodyRaw(name)).split(/(<g data-l="[sf]"[^>]*>[\s\S]*?<\/g>)/), isS = p => p.startsWith('<g data-l="s"'), lastS = parts.reduce((a, p, i) => isS(p) ? i : a, -1);
  const L = { back:"", cloth:"", front:"", flag:"" };
  parts.forEach((p, i) => { if (isS(p)) L.cloth += p; else if (p.startsWith('<g data-l="f"')) L.flag += p; else if (i < lastS) L.back += p; else L.front += p; });
  if (FACE_LEFT.has(name)) for (const k in L) if (L[k]) L[k] = `<g transform="translate(100 0) scale(-1 1)">${L[k]}</g>`;
  return L;
}
// v: "" as drawn, "F" freight (wide, cargo on deck)
function rigOf(name, v){
  const key = v + name; if (RIGS[key]) return RIGS[key];
  const L = shipLayers(name); if (!L.cloth && !L.flag) return (RIGS[key] = { none:true });
  const fr = v === "F", vb = fr ? "-7 -4 114 74" : "0 -4 100 74", w = fr ? 342 : 300, wrap = b => fr ? `<g transform="translate(50 0) scale(1.12 1) translate(-50 0)">${b}</g>` : b;
  const rig = RIGS[key] = { key, w, img:{}, cv:{}, ready:false, stiff:STIFF[name] || 1, fb:null };
  const body = { back:L.back, cloth:L.cloth, front:L.front + (fr ? cargoSvg(name) : ""), flag:L.flag };
  for (const k in body) if (body[k]) rig.img[k] = svgImg(vb, w, wrap(body[k]), RIG_H);
  const fa = FLAG_AT[name];
  if (fa && L.flag){ const tx = x => { let q = FACE_LEFT.has(name) ? 100 - x : x; if (fr) q = 50 + (q - 50) * 1.12 + 7; return q * 3; };
    rig.fb = { hx:tx(fa[0]), fx:tx(aftFlag(name) ? 2 * fa[0] - fa[1] : fa[1]), y0:fa[2] * 3 + RIG_PAD, y1:fa[3] * 3 + RIG_PAD }; }
  return rig;
}
// a rig is ready once all its layers have loaded; they are copied to canvases once so slicing them every frame is cheap
function rigReady(rig){
  if (!rig || rig.none) return false; if (rig.ready) return true;
  for (const k in rig.img){ const im = rig.img[k]; if (!im.complete || !im.naturalWidth) return false; }
  for (const k in rig.img){ const c = document.createElement("canvas"); c.width = rig.w; c.height = RIG_H; c.getContext("2d").drawImage(rig.img[k], 0, 0, rig.w, RIG_H); rig.cv[k] = c; }
  return (rig.ready = true);
}
const RC = document.createElement("canvas"), RC1 = document.createElement("canvas"); RC.width = RC1.width = 342; RC.height = RC1.height = RIG_H;
const rcx = RC.getContext("2d"), rcx1 = RC1.getContext("2d");
const MO0 = { amp:0, lean:0, flap:0, t:0, ph:0 };
// builds one ship on the scratch canvas RC. mo: amp = how hard the cloth ripples, lean = how far the wind pushes the foot of the sails
// toward the bow (both in drawing units), flap = how hard the flag flies, t = the ship's own wind clock.
// wd: which way the wind blows in the ship's own drawing, +1 toward her bow; -1 when she is drawn facing left (turned for home, a raider
// facing the fleet), so the wind keeps its direction on screen: her sails are pushed toward her stern and her flag flies aft
// ships take the light of the hour: a warm wash at dusk, a cool moonlit shade at night and under a storm bank. One fill over the composed
// rig (source-atop, so only her own pixels), worked out once a frame; nothing by day or in harbour
let TINT_T = -1, TINT_C = null;
function rigTint(){
  if (TINT_T === SC.t) return TINT_C; TINT_T = SC.t;
  const p = SC.nightP || 0, st = SC.storm || 0, n = clamp((p - .66) / .24, 0, 1) * .34 + st * .16, d = clamp(1 - Math.abs(p - .64) / .12, 0, 1) * .12 * (1 - st), a = Math.max(n, d);
  if (a < .02) return TINT_C = null;
  const k = n / (n + d), c = mixC([255, 150, 90], [14, 22, 64], k);
  return TINT_C = `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a.toFixed(3)})`;
}
function composeRig(rig, wear, mo, wd = 1){
  const w = rig.w, c = rig.cv, g = rcx;
  const lay = (g, k) => { if (!c[k]) return; g.drawImage(c[k], 0, 0); if (wear > .02){ const ag = agedOf(rig.key + ":" + k, c[k], RIG_PAD, rig.key); if (ag){ g.globalAlpha = wear; g.drawImage(ag, 0, 0); g.globalAlpha = 1; } } };
  g.globalAlpha = 1; g.clearRect(0, 0, 342, RIG_H); lay(g, "back");
  if (c.cloth){
    if (mo.amp < .01 && Math.abs(mo.lean) < .01) lay(g, "cloth");
    else { rcx1.globalAlpha = 1; rcx1.clearRect(0, 0, 342, RIG_H); lay(rcx1, "cloth");
      // the cloth is drawn in one-unit rows, each pushed sideways: a slow billow and a quicker ripple run down from the yard to the foot,
      // which moves most; the head of each sail, laced to its spar, hardly moves
      for (let y = 0; y < 150; y += 3){ const u = (y - RIG_PAD) / 3, e = .2 + .8 * clamp(u / 42, 0, 1);
        const dx = 3 * e * (wd * mo.lean + mo.amp * (.7 * Math.sin(u * .24 - mo.t * 4.4 + mo.ph) + .3 * Math.sin(u * .57 - mo.t * 7.7 + mo.ph * 1.7)));
        g.drawImage(RC1, 0, y, w, 3, dx, y, w, 3); } } }
  lay(g, "front");
  const f = rig.fb;
  if (c.flag && f){
    if (wd < 0){ g.save(); g.translate(2 * f.hx, 0); g.scale(-1, 1); }   // the flag mirrored about its hoist: it flies aft, downwind
    if (mo.flap < .01) g.drawImage(c.flag, 0, 0);
    else { const dir = Math.sign(f.fx - f.hx), len = Math.abs(f.fx - f.hx), x0 = Math.floor(Math.min(f.hx, f.fx)) - 5, x1 = Math.ceil(Math.max(f.hx, f.fx)) + 6, ya = Math.max(0, f.y0 - 8), hh = Math.min(RIG_H - ya, f.y1 - f.y0 + 18);
      // the flag in thin upright strips: a wave runs out from the hoist, growing toward the fly
      for (let x = x0; x < x1; x += 2){ const d = clamp((x + 1 - f.hx) * dir / len, 0, 1.2), dy = mo.flap * 3.3 * d * Math.sin(d * 5 - mo.t * 10.5 + mo.ph);
        g.drawImage(c.flag, x, ya, 2, hh, x, ya + dy, 2, hh); } }
    if (wd < 0) g.restore(); }
  const nt = rigTint(); if (nt){ g.globalCompositeOperation = "source-atop"; g.fillStyle = nt; g.fillRect(0, 0, w, RIG_H); g.globalCompositeOperation = "source-over"; }
}
// how the wind moves a ship's cloth right now: gentle in harbour, fuller with every gust and storm, flogging when she is struck or going down
function sailMotion(s, rig){
  if (calm()) return MO0;
  const gust = .5 + .5 * Math.sin(SC.t * .83 + s.hx * .012) * Math.sin(SC.t * .31 + 1.3); let amp, lean, flap;
  if (s.state === "sink"){ amp = 2.6; lean = .5; flap = 1.9; }   // she loses way but the wind still blows from astern
  else if (s.state === "leave"){ amp = 1.8; lean = 1; flap = 1.5; }
  else if (s.state === "arrive"){ const k = clamp(s.st / 3, 0, 1); amp = lerp(1.3, .45, k); lean = lerp(1.2, .1, k); flap = lerp(1.2, .6, k); }
  else if (s.state === "sail" && R && R.state === "sailing"){ const b = clamp(R.boost - 1, 0, 1.3); amp = 1 + .7 * gust + 1.3 * SC.storm + .5 * SC.rough; lean = .6 + 1 * gust + 1.3 * b; flap = 1 + .8 * SC.storm + .4 * b; }
  else { amp = .6 + .3 * gust; lean = .25 + .25 * gust; flap = .7; }
  amp += 4 * Math.max(0, s.hitT);
  const k = follow(5, DT); s.sAmp = lerp(s.sAmp == null ? amp : s.sAmp, amp, k); s.sLean = lerp(s.sLean == null ? lean : s.sLean, lean, k); s.sFlap = lerp(s.sFlap == null ? flap : s.sFlap, flap, k);
  s.rt = (s.rt || 0) + DT * (1 + .7 * SC.storm);
  return { amp:s.sAmp * rig.stiff, lean:s.sLean * (rig.stiff < 1 ? .7 : 1), flap:s.sFlap, t:s.rt, ph:s.ph };
}

// ===== sound (WebAudio synth) — src/game.html lines 1122–1219 =====
const AU = { ctx:null };
function audioInit(){
  if (AU.ctx) { if (AU.ctx.state !== "running") AU.ctx.resume(); return; }
  try {
    const C = AU.ctx = new (window.AudioContext || window.webkitAudioContext)();
    AU.master = C.createGain(); AU.master.gain.value = .9; AU.master.connect(C.destination);
    AU.sfx = C.createGain(); AU.sfx.connect(AU.master); AU.mus = C.createGain(); AU.mus.connect(AU.master);
    const noiseBuf = (sec, brown) => { const b = C.createBuffer(1, C.sampleRate * sec, C.sampleRate), d = b.getChannelData(0); let l = 0;
      for (let i = 0; i < d.length; i++){ const w = Math.random() * 2 - 1; if (brown){ l = (l + .02 * w) / 1.02; d[i] = l * 3.5; } else d[i] = w; } return b; };
    AU.white = noiseBuf(2, false);
    // ocean: brown noise breathing slowly
    const ocean = C.createBufferSource(); ocean.buffer = noiseBuf(4, true); ocean.loop = true;
    const olp = C.createBiquadFilter(); olp.type = "lowpass"; olp.frequency.value = 520;
    AU.oceanG = C.createGain(); AU.oceanG.gain.value = .0;
    const lfo = C.createOscillator(), lfoG = C.createGain(); lfo.frequency.value = .13; lfoG.gain.value = .06; lfo.connect(lfoG); lfoG.connect(AU.oceanG.gain); lfo.start();
    ocean.connect(olp); olp.connect(AU.oceanG); AU.oceanG.connect(AU.sfx); ocean.start();
    // wind: rises with storms
    const wind = C.createBufferSource(); wind.buffer = AU.white; wind.loop = true;
    const bp = C.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 800; bp.Q.value = .8; AU.windBp = bp;
    AU.windG = C.createGain(); AU.windG.gain.value = 0; wind.connect(bp); bp.connect(AU.windG); AU.windG.connect(AU.sfx); wind.start();
    // rain: a soft hiss that comes and goes with the storm over the fleet (set by drawStorms)
    const rain = C.createBufferSource(); rain.buffer = AU.white; rain.loop = true; rain.loopStart = .37;
    const rhp = C.createBiquadFilter(); rhp.type = "highpass"; rhp.frequency.value = 2600;
    AU.rainG = C.createGain(); AU.rainG.gain.value = 0; rain.connect(rhp); rhp.connect(AU.rainG); AU.rainG.connect(AU.sfx); rain.start(0, .37);
    applyAudio(); startMusic();
  } catch (e) { AU.ctx = null; }
}
document.addEventListener("visibilitychange", () => { if (!AU.ctx) return; try { document.hidden ? AU.ctx.suspend() : AU.ctx.resume(); } catch (e) {} });
function applyAudio(){
  if (!AU.ctx) return; const t = AU.ctx.currentTime;
  AU.sfx.gain.setTargetAtTime(G.sound ? 1 : 0, t, .05);
  AU.mus.gain.setTargetAtTime(G.music ? .32 : 0, t, .1);
  AU.oceanG.gain.setTargetAtTime(G.sound ? .14 : 0, t, .3);
}
function tone(f, dur, { type = "sine", g = .2, at = 0, f2 = null, dest = null, q = 0 } = {}){
  const C = AU.ctx; if (!C) return; const t = C.currentTime + at, o = C.createOscillator(), a = C.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  a.gain.setValueAtTime(0, t); a.gain.linearRampToValueAtTime(g, t + .008); a.gain.exponentialRampToValueAtTime(.0008, t + dur);
  o.connect(a); a.connect(dest || AU.sfx); o.start(t); o.stop(t + dur + .02);
}
function noise(dur, { f = 1000, type = "lowpass", g = .5, at = 0, dest = null } = {}){
  const C = AU.ctx; if (!C) return; const t = C.currentTime + at, s = C.createBufferSource(); s.buffer = AU.white;
  const fl = C.createBiquadFilter(); fl.type = type; fl.frequency.value = f; const a = C.createGain();
  a.gain.setValueAtTime(g, t); a.gain.exponentialRampToValueAtTime(.0008, t + dur); s.connect(fl); fl.connect(a); a.connect(dest || AU.sfx); s.start(t); s.stop(t + dur + .05);
}
function sfx(kind, at = 0){
  if (!AU.ctx || !G.sound) return;
  if (kind === "thunder"){ noise(2.2, { f:180, g:1.1, at }); noise(.4, { f:900, g:.5, at }); }
  else if (kind === "thunderfar"){ noise(2.6, { f:150, g:.6, at }); noise(.3, { f:700, g:.16, at }); }   // a storm's own bolt: the crack is lost in the distance
  else if (kind === "rumble") noise(2.8, { f:110, g:.34, at });                                         // a storm coming over the horizon, or lightning inside the cloud
  else if (kind === "coin") [0, .06, .12, .2].forEach((d, i) => tone([1319, 1568, 2093, 2637][i], .2, { type:"square", g:.05, at:d }));
  else if (kind === "up"){ tone(660, .12, { type:"triangle", g:.08 }); tone(990, .14, { type:"triangle", g:.08, at:.07 }); }
  else if (kind === "down"){ tone(660, .12, { type:"triangle", g:.07 }); tone(440, .14, { type:"triangle", g:.07, at:.07 }); }
  else if (kind === "mile"){ [784, 988, 1175, 1568].forEach((f, i) => tone(f, .35, { type:"triangle", g:.09, at:i * .06 })); }
  else if (kind === "bell"){ tone(988, 1.6, { g:.16 }); tone(1976, 1, { g:.05 }); tone(2961, .6, { g:.03 }); }
  else if (kind === "tick") tone(880, .12, { type:"triangle", g:.18 });
  else if (kind === "go"){ [523, 659, 784, 1047].forEach((f, i) => tone(f, .35, { type:"triangle", g:.13, at:i * .07 })); }
  else if (kind === "surge"){ noise(1.5, { f:360, g:.3 }); noise(.8, { f:1500, type:"bandpass", g:.16, at:.25 }); tone(62, 1.2, { g:.08, f2:34 }); }   // a rogue wave heaving up
  else if (kind === "splash"){ noise(.9, { f:1400, type:"bandpass", g:.6 }); tone(300, .5, { g:.12, f2:80 }); }
  else if (kind === "sink"){ tone(380, 1.1, { type:"triangle", g:.15, f2:55 }); noise(1.2, { f:600, g:.25, at:.2 }); }
  else if (kind === "crack"){ noise(.25, { f:3000, type:"highpass", g:.6 }); tone(140, .3, { g:.25, f2:60 }); }
  else if (kind === "whale"){ tone(160, 1.6, { type:"sawtooth", g:.05, f2:90 }); tone(240, 1.4, { g:.06, f2:130, at:.2 }); noise(1.2, { f:700, g:.4, at:.6 }); }
  else if (kind === "cheer"){ [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, .5, { type:"triangle", g:.1, at:i * .09 })); noise(1.2, { f:2500, type:"bandpass", g:.12, at:.2 }); }
  else if (kind === "fanfare"){ [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, .42, { type:"triangle", g:.12, at:i * .1 })); [262, 330, 392].forEach(f => tone(f, 1.1, { g:.07, at:.1 })); noise(1.6, { f:3000, type:"bandpass", g:.1, at:.3 }); }
  else if (kind === "lose"){ [392, 330, 262, 196].forEach((f, i) => tone(f, .45, { type:"triangle", g:.12, at:i * .16 })); }
}
// the bank sound for a cash-out: a soft wooden thunk, a crisp ping, then one rising note per coin that lands in the wallet. Brighter, never louder
function bankSfx(part, k = 0, at = 0){
  if (!AU.ctx || !G.sound) return;
  if (part === "thunk"){ tone(170, .09, { g:.07, f2:90, at }); noise(.03, { f:900, g:.05, at }); }
  else if (part === "ping") tone(1568, .12, { type:"triangle", g:.06, at });
  else if (part === "note") tone(1319 * Math.pow(2, Math.min(k, 11) / 12), .08, { type:"triangle", g:.035, at });
  else if (part === "bright") tone(2637, .14, { type:"triangle", g:.03, at });
}
// an original shanty in D dorian, eighth notes at 104 bpm
const MEL = [62,0,65,67, 69,0,67,65, 64,0,60,62, 64,65,62,0, 62,0,65,67, 69,72,74,72, 69,67,65,64, 62,0,0,0,
             69,0,69,71, 72,0,71,69, 67,0,64,65, 67,69,65,0, 62,0,65,67, 69,67,65,64, 62,60,57,60, 62,0,0,0];
const BASS = [38,38,36,33, 38,38,33,38, 41,41,36,36, 38,38,33,38];
const mf = n => 440 * Math.pow(2, (n - 69) / 12);
function startMusic(){
  const C = AU.ctx, step = 60 / 104 / 2; AU.next = C.currentTime + .1; AU.step = 0;
  clearInterval(AU.timer);
  AU.timer = setInterval(() => {
    // after the tab was in the background, skip the missed notes instead of playing them all at once
    if (AU.next < C.currentTime) AU.next = C.currentTime + .05;
    while (AU.next < C.currentTime + .25){
      const i = AU.step % MEL.length, t0 = AU.next - C.currentTime;
      const storm = SC.storm > .3;
      if (!G.music){ AU.next += step; AU.step++; continue; }
      if (MEL[i]) { tone(mf(MEL[i]), .32, { type:"triangle", g:storm ? .07 : .12, at:t0, dest:AU.mus }); tone(mf(MEL[i]) * 2, .12, { type:"square", g:.018, at:t0, dest:AU.mus }); }
      if (i % 4 === 0){ const b = BASS[(i / 4) % BASS.length]; tone(mf(b), .55, { g:.2, at:t0, dest:AU.mus }); tone(mf(b + 7), .4, { type:"triangle", g:.05, at:t0, dest:AU.mus }); }
      if (i % 4 === 0) tone(110, .18, { g:.22, at:t0, f2:45, dest:AU.mus });
      if (i % 4 === 2) noise(.06, { f:7000, type:"highpass", g:.08, at:t0, dest:AU.mus });
      AU.next += step; AU.step++;
    }
  }, 60);
}

// ===== sea, sky, wave layers, fleet layout — src/game.html lines 1234–1321 =====
const THEMES = {
  atlantic:["#86c5e6","#4b9fd6","#2d82c2","#2169a7","#184f86"],
  tropical:["#8fe0ee","#47bfe0","#2a9ed2","#1f80bd","#17629a"],
  arctic:["#a7d4de","#6bb0c1","#4a91a6","#36768d","#285c71"],
  pacific:["#7fb9e6","#3f8fd1","#2a73bb","#1f5ca0","#16447f"],
};
const SKY = [ [0, "#79a8e2", "#ffd6a0"], [.3, "#3a8edb", "#bfe6ff"], [.62, "#5a49a0", "#ff9d63"], [.82, "#1d2552", "#7a4d8a"], [1, "#0a1030", "#283567"] ];
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mixC = (a, b, t) => { const A = typeof a === "string" ? hex(a) : a, B = typeof b === "string" ? hex(b) : b; return [lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)]; };
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const LAY = [ { y:.50, a:2, wl:.22, s:.12, ph:0 }, { y:.575, a:4.5, wl:.32, s:.28, ph:1.3 }, { y:.68, a:8, wl:.46, s:.55, ph:2.1 }, { y:.785, a:11, wl:.56, s:.85, ph:.4 }, { y:.915, a:14, wl:.72, s:1.2, ph:2.8 } ];
const SC = { t:0, scroll:0, speed:0, p:0, storm:0, rough:0, mist:0, flash:0, shake:0, cl:{}, stars:[], far:[], parts:[], bolts:[], tentacles:[], waves:[], rogues:[], whales:[], nextFar:3, ships:[], portX:0, nightP:0, bergs:[], raiders:[], reefs:[], cold:0, tropic:0 };
for (let i = 0; i < 90; i++) SC.stars.push({ x:Math.random(), y:Math.random() * .45, r:.6 + Math.random() * 1.3, tw:Math.random() * 6 });
// the swell, worked out once a frame (wy() runs thousands of times a frame):
// - its height scales with the same width measure as its wavelength (never more than the screen height allows), so a phone sea is as
//   steep as the desktop one it was tuned on; it used to scale with height only and stood at breaking point on a phone in calm water
// - in harbour, behind the quay, the swell is gentle; it builds as the port drops astern
// - storms and rough water make the waves longer as well as taller; a longer wave runs faster and heaves slower, as deep-water waves
//   do, and the short sea on top runs slower than the long swell under it
// - the phases are added up frame by frame, so a change of wavelength or speed never sends the pattern racing
const SEA_REF = 664 / 880;   // the canvas's height to width on a 1280x760 desktop, where the sea was tuned
const WV = { t:null, sc:0, A:[0, 0, 0, 0, 0], k:[0, 0, 0, 0, 0], p1:[0, 0, 0, 0, 0], p2:[0, 0, 0, 0, 0] };
function harbSwell(){
  const ps = portScale(), c = clamp((SC.portX + 260 * ps) / (portHome() + 260 * ps), 0, 1);
  return 1 - .55 * ease(c);
}
function seaTick(){
  const lg = 1 + .35 * SC.storm + .25 * SC.rough, amp = Math.min(H, SEA_REF * Math.max(W, 420)) / 520 * (1 + 1.6 * SC.storm + 1.4 * SC.rough) * harbSwell();
  const dt = SC.t - WV.t, dsc = SC.scroll - WV.sc, jump = WV.t == null || dt < 0 || dt > 1;
  for (let L = 0; L < 5; L++){ const l = LAY[L], k = 6.283 / (l.wl * Math.max(W, 420) * lg), w1 = (.55 + L * .12) / Math.sqrt(lg);
    if (jump){ WV.p1[L] = SC.scroll * l.s * k + l.ph + SC.t * w1; WV.p2[L] = WV.p1[L] * 2.13 + 1.1 - SC.t * w1 * .67; }
    else { WV.p1[L] += dsc * l.s * k + dt * w1; WV.p2[L] += 2.13 * dsc * l.s * k + dt * w1 * 1.46; }   // the short sea: 2.13x the wavenumber, sqrt(2.13) the frequency
    WV.k[L] = k; WV.A[L] = l.a * amp; }
  WV.t = SC.t; WV.sc = SC.scroll;
}
// the swell's height on layer L right now (rocks and the horizon settle by it)
const seaA = L => { if (WV.t !== SC.t || WV.sc !== SC.scroll) seaTick(); return WV.A[L]; };
function wy(L, x){
  if (WV.t !== SC.t || WV.sc !== SC.scroll) seaTick();
  const k = WV.k[L];
  return H * LAY[L].y + WV.A[L] * (.68 * Math.sin(x * k + WV.p1[L]) + .32 * Math.sin(x * k * 2.13 + WV.p2[L])) + (SC.rogues.length ? rogueAt(L, x) : 0);
}
// a rogue wave is part of the sea itself: a set of three crests (the middle one the giant) rolls in from ahead and right through the fleet.
// Every ship climbs and pitches over them, a hole opens in the sea in front of each crest, and the giant breaks over the ships it takes.
// d = where each crest runs, in crest spacings behind the leader; a = its share of the giant's height
const ROGUE_SET = [{ d:-1, a:.5 }, { d:0, a:1 }, { d:1, a:.62 }];
function rogueEnv(e, xc, cd){
  // it heaves up out of the sea, and once past the last ship it takes it spends itself (the giant fastest); it fades at the end
  const rise = ease(clamp(e.t / .32, 0, 1)), past = Math.max(0, e.xEnd - e.wid * .4 - xc), end = clamp((e.life - e.t) / .6, 0, 1);
  return rise * end / (1 + past / (e.wid * (cd ? 4 : 2.4)));
}
function rogueAt(L, x){
  let y = 0;
  for (const e of SC.rogues){ const kL = e.kL[L]; if (!kL) continue;
    for (const c of ROGUE_SET){ const xc = e.x + c.d * e.lam - e.c * e.t, d = (x - xc) / e.wid; if (d < -2.6 || d > 3.2) continue;
      const A = e.A * kL * c.a * rogueEnv(e, xc, c.d); if (A < .3) continue;
      // a steep face toward where it runs, a long back, and a trough in front of it
      y += A * (.34 * Math.exp(-(d + 1.15) * (d + 1.15) / .3) - (d < 0 ? Math.exp(-d * d / .2) : Math.exp(-d * d / .8))); } }
  return y;
}
// the deepest trough a running wave set digs on layer L: things fixed at the sea's resting level (rocks) reach that much deeper, so it never bares their feet
const rogueDip = L => { let d = 0; for (const e of SC.rogues) d = Math.max(d, e.A * e.kL[L] * .4); return d; };
const shipW = () => clamp(W * .18, 64, 122) * (SC.fscale || 1);
function slotsFor(n){
  const front = n <= 3 ? n : Math.ceil(n / 2), back = n - front, ws = SC.wids && SC.wids.length === n ? SC.wids : null, c = W * .43, out = [];
  // neighbours in the front row stand a little more than half of each one's drawn width apart, so a wide freighter never overlaps the ship beside it
  let need = (SC.maxSz || 1) * 1.02; if (ws){ need = ws[0] * .95; for (let i = 0; i + 1 < front; i++) need = Math.max(need, (ws[i] + ws[i + 1]) / 2 + .09); }
  const sp = Math.max(shipW() * need, W * .12);
  for (let i = 0; i < front; i++) out.push({ row:1, x:c + (i - (front - 1) / 2) * sp });
  for (let i = 0; i < back; i++) out.push({ row:0, x:c + (i - (back - 1) / 2) * sp + (back === front ? sp / 2 : 0) });
  return out;
}
// sprites on screen: one per ship for small fleets, a convoy of group sprites for big ones
function buildSprites(list, design){
  const nf = list.filter(s => s.type === "freight").length, one = list.length <= 6;
  const fS = one ? nf : Math.min(nf, 7);
  // freight is drawn 1.14 wide, so it needs that much more room (big freighters used to overlap their neighbours)
  const big = s => s.sz || 1;
  SC.maxSz = Math.max(1, ...list.map(s => big(s) * (s.type === "freight" ? 1.14 : 1))) * .92;
  SC.wids = one ? list.map(s => big(s) * (s.type === "freight" ? 1.14 : 1)) : null;
  SC.group = !one; SC.fscale = one ? 1 : .74;
  const kinds = one ? list.map(s => s.type) : Array(fS).fill("freight"), sl = slotsFor(kinds.length);
  SC.ships = sl.map((s, k) => ({ i:k, kind:kinds[k], row:s.row, hx:s.x, x:s.x, y:H * .7, ang:0, design, state:"sail", st:0, alpha:1, flip:1, cause:null, ph:Math.random() * 6, members:[], hitT:0 }));
  const cnt = { freight:0 };
  if (one) list.forEach((s, idx) => { SC.ships[idx].members.push(idx); s.spr = idx; });
  else list.forEach((s, idx) => { const pool = SC.ships.filter(x => x.kind === s.type); if (!pool.length) return; const sp = pool[cnt[s.type]++ % pool.length]; sp.members.push(idx); s.spr = SC.ships.indexOf(sp); });
  SC.ships.forEach(sp => { const m = list[sp.members[0]]; sp.design = (m && m.design) || design; sp.sz = m ? big(m) : 1; });
}

// ===== particles, sky, waves, shore helpers, port — src/game.html lines 1374–1687 =====
const AMBIENT = { snow:1, rain:1 };
AMBIENT.drip = 1;   // rain splashing on the sea
function spawn(p){ if (AMBIENT[p.k]){ if ((SC.ambN || 0) >= 220) return; SC.ambN = (SC.ambN || 0) + 1; } else if (SC.parts.length - (SC.ambN || 0) >= 480) return;
  // anything thrown about at sea (spray, chips, sparks, embers, coins) falls under the one sea gravity, sized like the ships: the effects
  // were tuned on a phone (where they keep their size) and were floaty next to the bigger desktop ships; aimed shots set their own speed (aim)
  if (p.z && p.z < 5 && !p.aim && !NOFALL[p.k]){ const k = gK(); p.vx *= k * G_V; p.vy *= k * G_V; p.life *= G_T; p.max *= G_T; }
  SC.parts.push(p); }
// one gravity at sea, scaled with the ships (1 on a 390 px phone, whose scene is 362 wide; 1.87 on desktop); the foreground (coin rain,
// confetti) keeps the old 260
const gK = () => clamp(W * .18, 64, 122) / 65.16, GRAV = () => 400 * gK(), G_T = Math.sqrt(260 / 400), G_V = 1 / G_T;
const NOFALL = { debris:1, foam:1, ring:1, smoke:1, snow:1, flash:1, drip:1, rain:1, bubble:1, glint:1, ball:1, arrow:1 };
// how many to spawn this frame for something meant to come p times a frame at 60 fps: the same number a second at any frame rate
// (the fraction is rounded up or down at random, so 30, 60 and 144 Hz all get the same count on average)
const nPer = p => { const m = p * DT * 60; return Math.floor(m) + (Math.random() < m % 1 ? 1 : 0); };
// a drop or a bubble meets the sea: a tiny ring where it lands (at most ~360 a second at any frame rate, none with reduced motion)
function splashRing(L, x, r){ if (SC.splT !== SC.t){ SC.splT = SC.t; SC.splN = 0; } if (calm() || SC.splN++ >= 6 * DT * 60) return;
  spawn({ k:"ring", z:L, x, y:wy(L, x) + 1, vx:0, vy:0, life:.3, max:.3, r, g:16, L }); }
// a lightning bolt: a jagged stroke with a fork or two, lighting up the sky where it leaves the cloud. A strike on a ship (no options) is
// close: a hard flash and the thunder at once. A storm's own bolts (o.far) flash softer, and their thunder rolls in later the further they are from the fleet
function bolt(x0, y0, x1, y1, o = {}){
  const jag = (xa, ya, xb, yb, n, j) => { const p = [[xa, ya]]; for (let i = 1; i < n; i++){ const t = i / n; p.push([lerp(xa, xb, t) + (Math.random() - .5) * j * (1 - t * .4), lerp(ya, yb, t)]); } p.push([xb, yb]); return p; };
  const pts = jag(x0, y0, x1, y1, 9, 46), br = [];
  for (let k = 0, nb = 1 + (Math.random() < .45 ? 1 : 0); k < nb; k++){ const [bx, by] = pts[2 + Math.floor(Math.random() * 4)], len = (y1 - y0) * (.16 + Math.random() * .18), dir = Math.random() < .5 ? -1 : 1;
    br.push(jag(bx, by, bx + dir * len * (.45 + Math.random() * .5), by + len, 4, 20)); }
  SC.bolts.push({ pts, br, life:.36, max:.36, sea:!!o.sea });
  (SC.glows || (SC.glows = [])).push({ x:x0, y:o.cy != null ? o.cy : y0, r:o.r || 120, life:.45, max:.45 });
  SC.flash = Math.max(SC.flash, o.far ? .3 : o.near ? .5 : .75);
  sfx(o.far ? "thunderfar" : "thunder", o.far ? thunderLag(x1) : 0);
}
// how long a storm's thunder takes to reach the fleet: sound covers about 343 m a second over the full distance to the strike, not just the
// left-right part. A storm cell lies out beyond the fleet (about 400 m off, toward the horizon) and a screen's width out there is about
// 4 km of sea, so a bolt right beside the fleet cracks after about 1.2 s and one on the horizon at the screen's edge rolls in after 6-8 s
function thunderLag(x){ const ax = clamp(Math.abs(x - W * .43) / W, 0, 1.2) * 4000; return Math.min(8, Math.hypot(ax, 400) / 343); }
// ---------- clouds, Storybook style (ported from prototypes/clouds-storybook.html, 2026-11-13) ----------
// chunky outlined cartoon cumulus: a soft ink outline (a dark tint of the sky, never pure black), three flat tones (a shaded band along the
// flat base, the sunlit body, a crisp highlight rim on the sun side of the top), lobes of deliberate sizes (one big, one medium, small ends,
// never equal bumps). Every fair cloud is painted ONCE into its own little canvas and stamped each frame (one drawImage); it is repainted
// only when its shape, size or the sky's tint changes (the tint is rounded, so a slow sunset repaints a cloud every few seconds, not every frame)
const sstep = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };   // smoothstep 0..1
// shapes: {c:[x, y, r]} circles or {b:[x, y, w, h]} rects, in the sprite's own px. grow pads every shape outward (for the outline)
function clPath(g, shapes, grow = 0){
  g.beginPath();
  for (const q of shapes){
    if (q.c){ const [x, y, r] = q.c, Rr = r + grow; g.moveTo(x + Rr, y); g.arc(x, y, Rr, 0, Math.PI * 2); }
    else { const [x, y, w, h] = q.b; g.rect(x - grow, y - grow, w + grow * 2, h + grow * 2); }
  }
}
function clBounds(shapes, pad){
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const q of shapes){ if (q.c){ const [x, y, r] = q.c; x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); y0 = Math.min(y0, y - r); y1 = Math.max(y1, y + r); }
    else { const [x, y, w, h] = q.b; x0 = Math.min(x0, x); x1 = Math.max(x1, x + w); y0 = Math.min(y0, y); y1 = Math.max(y1, y + h); } }
  return { x0:x0 - pad, y0:y0 - pad, x1:x1 + pad, y1:y1 + pad };
}
// a canvas for a sprite at the screen's pixel density (the old one is reused when a cloud is repainted)
function clCanvas(w, h, old){ const c = old || document.createElement("canvas"), d = DPR; c.width = Math.max(1, Math.ceil(w * d)); c.height = Math.max(1, Math.ceil(h * d)); const g = c.getContext("2d"); g.setTransform(d, 0, 0, d, 0, 0); return [c, g]; }
// lobe recipes (radii left to right): one big, one medium, small ends. The flat stratus ones are for the far layer
const CL_RECIPES = [[12, 30, 20, 13], [14, 22, 32, 17], [11, 19, 29, 22, 12], [13, 31, 18, 22, 11], [12, 24, 33, 15], [15, 27, 17, 12]];
const CL_STRATUS = [[8, 12, 15, 11, 13, 9, 7], [7, 11, 13, 16, 12, 8], [9, 14, 11, 13, 8]];
function clLobes(seed, far){
  const r = mulberry32(seed), list = far ? CL_STRATUS : CL_RECIPES, rec = list[Math.floor(r() * list.length)].map(v => v * (.88 + r() * .24));
  if (r() < .5) rec.reverse();
  const L = []; let x = 0;
  rec.forEach((rad, i) => { if (i) x += (rec[i - 1] + rad) * (far ? .7 : .6); L.push([x, -rad * (far ? .42 : .6) - (far ? 0 : r() * 3), rad]); });
  const mid = (L[0][0] + L[L.length - 1][0]) / 2; L.forEach(l => l[0] -= mid);
  return L;   // unit coords, the flat base at y = 0
}
// the palette for the current sky: every colour is a tint of the sky, so dusk and night clouds belong to their sky. storm 1 = the grey of a
// cloud darkening under a storm bank (drawFairClouds blends that version in)
function clPalette(t, storm){
  const day = { lit:"#f1f6ff", hi:"#ffffff", shade:mixC("#a9bfe9", t.bot, .2) };
  let lit = mixC(mixC(day.lit, "#ffe2c0", t.dusk * .85), "#8d97c6", t.night * .8),
      hi = mixC(mixC(day.hi, "#fff3da", t.dusk), "#aab3df", t.night * .8),
      shade = mixC(mixC(day.shade, "#d88f9e", t.dusk * .7), "#3d4677", t.night * .85);
  lit = mixC(lit, "#8c92ad", storm); hi = mixC(hi, "#a2a8c2", storm); shade = mixC(shade, "#5b6080", storm);
  const out = mixC(INK, t.top, .3);
  return { lit, hi, shade, out, farLit:mixC(lit, t.bot, .5), farShade:mixC(shade, t.bot, .45) };
}
const clKey = cols => cols.map(c => c.map(v => Math.round(v / 6)).join(",")).join("|");   // rounded, so a slow sweep rarely repaints
// paint one fair cloud into its sprite (s = px per unit): the ink outline under the fill, the shaded base, the lit body, the highlight rim
function clBuild(c, s, pal, sunDir, old){
  const far = c.far, ow = far ? 0 : 1.2 + 1.1 * s, L = c.lobes;
  const shapes = L.map(([x, y, r]) => ({ c:[x * s, y * s, r * s] }));
  const xa = L[0][0] * s, xb = L[L.length - 1][0] * s, hb = Math.min(L[0][2], L[L.length - 1][2]) * s * .9;
  shapes.push({ b:[xa, -hb, xb - xa, hb] });
  const bb = clBounds(shapes, ow + 2); bb.y1 = ow + 2;
  const [cv2, g] = clCanvas(bb.x1 - bb.x0, bb.y1 - bb.y0, old && old.img); g.translate(-bb.x0, -bb.y0);
  const lit = far ? pal.farLit : pal.lit, shade = far ? pal.farShade : pal.shade;
  if (ow){ g.save(); g.beginPath(); g.rect(bb.x0, bb.y0, 1e4, -bb.y0 + ow); g.clip(); g.fillStyle = rgb(pal.out); clPath(g, shapes, ow); g.fill(); g.restore(); }
  g.save(); g.beginPath(); g.rect(bb.x0, bb.y0, 1e4, -bb.y0); g.clip();
  g.fillStyle = rgb(shade); clPath(g, shapes); g.fill();
  clPath(g, shapes); g.clip();
  // sunlit body: the lobes again, nudged up and toward the sun; a straight cut keeps a crisp shaded band along the flat base
  const band = (far ? 4 : 10) * s;
  g.save(); g.beginPath(); g.rect(bb.x0, bb.y0, 1e4, -bb.y0 - band); g.clip();
  const litPath = (dx = 0, dy = 0) => { g.beginPath();
    for (const [x, y, r] of L){ const X = (x + sunDir * r * .06) * s + dx, Y = (y - r * .2) * s + dy, R2 = r * .9 * s; g.moveTo(X + R2, Y); g.arc(X, Y, R2, 0, 7); } };
  g.fillStyle = rgb(lit); litPath(); g.fill();
  // highlight (near clouds only): a rim of light along the sun-side top = the lit shape minus itself shifted away from the sun, so it can
  // only ever show on the outer edge, never as a ring inside the cloud
  if (!far){ const o = 1.4 + 1.5 * s;
    litPath(); g.clip();
    g.fillStyle = rgb(pal.hi); g.fill();
    g.fillStyle = rgb(lit); litPath(-sunDir * o * .55, o); g.fill(); }
  g.restore();
  g.restore();
  return { img:cv2, ox:bb.x0, oy:bb.y0, w:bb.x1 - bb.x0, h:bb.y1 - bb.y0 };
}
// lay out and drift the fair-weather clouds: few (3 near and 4 far on a phone, 5 and 6 wide), in evenly spaced slots that all drift at one
// speed, so they can never pile into one white mass; scaled down on narrow screens. st = SC.cl, a = overall visibility (0 while a storm is
// over the fleet), speed (the fleet's) only nudges the drift. A cloud darkens as a storm bank gathers over it and is swallowed by the bank
// (stormCover) rather than just vanishing
function drawFairClouds(dt, tint, st, a, speed){
  const ks = clamp(W / 820, .6, 1) * 1.3, narrow = W < 600;
  if (st.W !== W || st.H !== H){   // (re)lay out on a new screen size
    const nN = narrow ? 3 : 5, nF = narrow ? 4 : 6, mN = 110 * ks, mF = 50 * ks;
    const ys = [.2, .31, .16, .27, .22], fy = [.43, .405, .445, .415, .435, .4];
    const prev = st.near;
    st.near = []; st.far = []; st.W = W; st.H = H; st.spanN = W + mN * 2; st.spanF = W + mF * 2; st.mN = mN; st.mF = mF;
    for (let i = 0; i < nN; i++) st.near.push({ x:-mN + (i + .5) * st.spanN / nN, y:ys[i], s:[1.05, .78, .92, .7, .86][i], seed:(prev && prev[i] ? prev[i].seed : 11 + i * 977) });
    for (let i = 0; i < nF; i++) st.far.push({ x:-mF + (i + .5) * st.spanF / nF, y:fy[i], s:.42 + (i % 3) * .06, seed:501 + i * 313, far:true });
  }
  const pal = clPalette(tint, 0), palS = clPalette(tint, 1), d = DPR,
        key = clKey([pal.lit, pal.shade, pal.out, pal.farLit]) + tint.sunDir, keyS = clKey([palS.lit, palS.shade, palS.out, palS.farLit]) + tint.sunDir;
  let budget = 2;   // at most two repaints a frame: when the sky's tint moves on, the clouds catch up a frame or two apart
  const stamp = (c, sc) => {
    const cov = stormCover(c.x), al = a * (1 - sstep((cov - .45) / .45)), dk = clamp(Math.max(SC.storm * 1.5, cov * 1.6), 0, 1);   // swallowed / darkened
    if (al <= .02) return;
    if (!c.lobes){ c.lobes = clLobes(c.seed, c.far); c.spr = c.sprS = null; }
    if (!c.spr || (c.key !== key || c.sc !== sc || c.d !== d) && budget-- > 0){ c.spr = clBuild(c, sc, pal, tint.sunDir, c.spr); c.key = key; c.sc = sc; c.d = d; c.keyS = null; }
    const S = c.spr; cx.globalAlpha = al; cx.drawImage(S.img, c.x + S.ox, c.y * H + S.oy, S.w, S.h);
    if (dk > .02){ if (!c.sprS || c.keyS !== keyS && budget-- > 0){ c.sprS = clBuild(c, sc, palS, tint.sunDir, c.sprS); c.keyS = keyS; }
      const D = c.sprS; cx.globalAlpha = al * dk; cx.drawImage(D.img, c.x + D.ox, c.y * H + D.oy, D.w, D.h); }
  };
  const vF = (4 + speed * .02) * ks * dt, vN = (11 + speed * .06) * ks * dt;
  for (const c of st.far){ c.x -= vF; if (c.x < -st.mF){ c.x += st.spanF; c.seed = (c.seed * 7 + 13) % 1e6; c.lobes = null; } }
  for (const c of st.near){ c.x -= vN; if (c.x < -st.mN){ c.x += st.spanN; c.seed = (c.seed * 7 + 13) % 1e6; c.lobes = null; c.s = .7 + ((c.seed % 100) / 100) * .4; } }
  if (a <= .02) return;
  cx.save();
  for (const c of st.far) stamp(c, c.s * ks);
  for (const c of st.near) stamp(c, c.s * ks);
  cx.restore();
}
function drawSky(){
  const p = SC.nightP; let a = SKY[0], b = SKY[SKY.length - 1];
  for (let i = 0; i < SKY.length - 1; i++) if (p >= SKY[i][0] && p <= SKY[i + 1][0]){ a = SKY[i]; b = SKY[i + 1]; break; }
  const t = (p - a[0]) / Math.max(1e-6, b[0] - a[0]), st = SC.storm * .85;
  const top = mixC(mixC(a[1], b[1], t), "#262a40", st), bot = mixC(mixC(a[2], b[2], t), "#596079", st); SC.skyBot = bot;   // (the horizon's colour, for drawHorizon)
  const g = cx.createLinearGradient(0, 0, 0, H * .52); g.addColorStop(0, rgb(top)); g.addColorStop(1, rgb(bot));
  cx.fillStyle = g; cx.fillRect(0, 0, W, H * .53);
  // stars and moon late in the voyage
  const nightA = clamp((p - .7) / .2, 0, 1) * (1 - SC.storm);
  if (nightA <= 0) SC.moonA = 0;
  if (nightA > 0){ for (const s of SC.stars){ cx.fillStyle = `rgba(255,255,255,${nightA * (.5 + .5 * Math.sin(SC.t * 2 + s.tw))})`; cx.beginPath(); cx.arc(s.x * W, s.y * H, s.r, 0, 7); cx.fill(); }
    const mx = W < 620 ? W * .46 : W * .2, my = W < 620 ? Math.max(30, H * .075) : H * .14;   // on a phone the moon sits between the chart corners, not behind the map
    SC.moonA = nightA; SC.moonX = mx;
    const mh = cx.createRadialGradient(mx, my, 8, mx, my, 54); mh.addColorStop(0, `rgba(214,226,255,${.2 * nightA})`); mh.addColorStop(1, "rgba(214,226,255,0)"); cx.fillStyle = mh; cx.fillRect(mx - 54, my - 54, 108, 108);
    // the crescent is one path: the moon's limb, then the edge of the shadow disc back across it (nothing is painted over the sky)
    const mf = Math.atan2(-4, 7), a1 = Math.acos(125 / (2 * Math.hypot(7, 4) * 16)), a2 = Math.acos(5 / (2 * Math.hypot(7, 4) * 14));
    cx.fillStyle = `rgba(255,248,220,${nightA})`; cx.beginPath(); cx.arc(mx, my, 16, mf + a1, mf - a1 + Math.PI * 2); cx.arc(mx + 7, my - 4, 14, mf + Math.PI + a2, mf + Math.PI - a2, true); cx.closePath(); cx.fill(); }
  // the sun sinks westward as the voyage goes on
  const sunA = clamp(1 - (p - .72) / .12, 0, 1) * clamp(1 - SC.storm * 1.5, 0, 1),   /* a storm hides the sun completely */ rise = SC.landing ? clamp((p - .04) / .8, 0, 1) : 0;
  const sx = SC.landing ? W * .82 : W < 620 ? W * (.56 - .31 * p) : W * (.8 - .55 * p), sy = SC.landing ? H * (.16 + .36 * rise) : H * (.12 + .36 * p); SC.sunA = sunA; SC.sunX = sx; SC.sunY = sy;
  if (sunA > 0){ const gl = cx.createRadialGradient(sx, sy, 4, sx, sy, 90);
    gl.addColorStop(0, `rgba(255,240,190,${.9 * sunA})`); gl.addColorStop(1, "rgba(255,200,120,0)"); cx.fillStyle = gl; cx.fillRect(sx - 90, sy - 90, 180, 180);
    cx.fillStyle = `rgba(255,236,170,${sunA})`; cx.beginPath(); cx.arc(sx, sy, 20, 0, 7); cx.fill(); }
  drawRainbow();   // behind the clouds
  // clouds (Storybook style): a far layer low over the horizon, no outline, blended into the sky, and a few near inked cumulus; both tinted
  // by the sky (golden at dusk, blue-grey at night). They darken as a storm bank gathers over them and are swallowed by it, and while a
  // storm is over the fleet they are gone (only its dark bank is left); they come back once it has passed
  // (their tint leaves the storm out: they darken by blending in their storm-grey copy, so a passing storm doesn't repaint them)
  const dusk = clamp(1 - Math.abs(p - .74) / .14, 0, 1), night = clamp((p - .8) / .12, 0, 1), skyB = mixC(a[2], b[2], t);
  const fair = clamp(1 - (SC.storm - .25) * 3, 0, 1);
  drawFairClouds(DT, { top:mixC(a[1], b[1], t), bot:skyB, dusk, night, sunDir:(SC.sunX || 0) > W * .5 ? 1 : -1 }, SC.cl || (SC.cl = {}), fair, SC.speed);
}
function seaCol(i){
  const base = THEMES[(R ? R.v : voyage()).theme][i];
  let c = mixC(base, base, 0);
  if (SC.cold > .01) c = mixC(c, THEMES.arctic[i], SC.cold * .85);
  if (SC.tropic > .01) c = mixC(c, THEMES.tropical[i], SC.tropic * .75);
  return mixC(mixC(c, "#0d1838", clamp((SC.nightP - .62) / .3, 0, 1) * .55), "#4b5470", SC.storm * .45);
}
const hash1 = n => { const v = Math.sin(n * 127.1 + 31.7) * 43758.5453; return v - Math.floor(v); };
function drawLayer(L){
  const c = seaCol(L), step = 8, top = [];
  cx.beginPath(); cx.moveTo(-10, H + 10);
  for (let x = -10; x <= W + 10; x += step){ const y = wy(L, x); top.push([x, y]); cx.lineTo(x, y); }
  cx.lineTo(W + 10, H + 10); cx.closePath();
  const g = cx.createLinearGradient(0, H * LAY[L].y - 20, 0, H); g.addColorStop(0, rgb(mixC(c, "#ffffff", .08))); g.addColorStop(1, rgb(mixC(c, "#06102a", .35)));
  cx.fillStyle = g; cx.fill();
  // little ripples fixed to the water, so the sea visibly streams past the fleet (sparser and fainter far away)
  if (L >= 1){ const sp = 60 + L * 22, off = SC.scroll * LAY[L].s, yb = (L < 4 ? H * LAY[L + 1].y : H * .99) - H * LAY[L].y;
    cx.strokeStyle = `rgba(255,255,255,${.09 + .035 * L})`; cx.lineWidth = .9 + L * .3; cx.lineCap = "round";
    for (let k = Math.floor(off / sp) - 1; k * sp - off < W + sp; k++){ const xx = k * sp - off + hash1(k * 3.1 + L) * sp * .7, yy = wy(L, xx) + 7 + L + hash1(k * 7.7 + L * 2.3) * Math.max(0, yb - 6 - L), ww = 4 + L * 2.2 + hash1(k + L * 9) * 4;
      cx.beginPath(); cx.moveTo(xx - ww, yy); cx.quadraticCurveTo(xx - ww * .3, yy - 1.5 - L * .4, xx, yy); cx.quadraticCurveTo(xx + ww * .3, yy - 1.5 - L * .4, xx + ww, yy); cx.stroke(); }
    cx.lineCap = "butt"; }
  cx.strokeStyle = `rgba(255,255,255,${.18 + .12 * L / 4 + SC.rough * .2})`; cx.lineWidth = 1.5 + L * .4; cx.beginPath();
  top.forEach(([x, y], i) => i ? cx.lineTo(x, y) : cx.moveTo(x, y)); cx.stroke();
  // a pale band of light under the crest line and a thin shade below it: the face of each swell catches the sky (one soft stroke each)
  if (L >= 1){ const d1 = 3 + L * 1.1, d2 = d1 * 2.3;
    cx.strokeStyle = `rgba(255,255,255,${.05 + .012 * L})`; cx.lineWidth = d1 * 1.5; cx.beginPath(); top.forEach(([x, y], i) => i ? cx.lineTo(x, y + d1) : cx.moveTo(x, y + d1)); cx.stroke();
    cx.strokeStyle = "rgba(6,16,42,.06)"; cx.lineWidth = d1; cx.beginPath(); top.forEach(([x, y], i) => i ? cx.lineTo(x, y + d2) : cx.moveTo(x, y + d2)); cx.stroke(); }
  // the sun sparkles on the water below it
  // and the moon lays a cooler, narrower path of light across the night sea
  for (const [lx, la, lc, sp0] of [[SC.sunX, SC.sunA, "255,248,215", 40], [SC.moonX, SC.moonA, "214,226,255", 22]]) if (L >= 1 && L <= 3 && la > .05){
    if (lx === SC.moonX){ const my = wy(L, lx) + 8 + L * 4, mg = cx.createRadialGradient(lx, my, 0, lx, my, 30 + L * 26); mg.addColorStop(0, `rgba(214,226,255,${.16 * la})`); mg.addColorStop(1, "rgba(214,226,255,0)");
      cx.fillStyle = mg; cx.beginPath(); cx.ellipse(lx, my, 30 + L * 26, 6 + L * 3, 0, 0, 7); cx.fill(); }
    cx.fillStyle = `rgba(${lc},${(lx === SC.moonX ? .95 : .7) * la})`; const spread = sp0 + L * (sp0 + 10);
    for (let gx = lx - spread; gx < lx + spread; gx += 9){ const f = Math.sin(gx * .37 + SC.t * 5 + L * 2) * Math.sin(gx * .11 - SC.t * 1.7), fall = 1 - Math.abs(gx - lx) / spread;
      if (f > .55){ cx.globalAlpha = clamp((f - .55) * 2.5, 0, 1) * fall; cx.beginPath(); cx.ellipse(gx, wy(L, gx) + 5 + L * 3, 1.5 + L * .8, 1, 0, 0, 7); cx.fill(); } } cx.globalAlpha = 1; }
  // whitecaps on rough water and in storms
  const foam = clamp(SC.rough + SC.storm * .8, 0, 1);
  if (foam > .15 && L >= 1){ cx.strokeStyle = `rgba(255,255,255,${.85 * foam})`; cx.lineCap = "round"; cx.lineWidth = 1.6 + L * .7;
    cx.fillStyle = cx.strokeStyle;
    for (let i = 1; i < top.length - 1; i++){ if (top[i][1] < top[i - 1][1] && top[i][1] <= top[i + 1][1]){ const n = 1 + Math.round(L * .6);
      // a whitecap: a short curl of foam riding the crest, not a blob. It sits on the crest itself (found between the samples), so it glides
      // along with the wave, and it fades in as the crest sharpens and out as it flattens
      const y0 = top[i - 1][1], y1 = top[i][1], y2 = top[i + 1][1], cv2 = y0 - 2 * y1 + y2, xc = top[i][0] + (cv2 > 1e-6 ? clamp(.5 * (y0 - y2) / cv2, -.5, .5) : 0) * step;
      cx.globalAlpha = clamp(cv2 * 2.2, 0, 1);
      cx.beginPath(); for (let k = -n; k <= n; k++){ const xx = xc + k * step, yy = wy(L, xx) + 1; k === -n ? cx.moveTo(xx, yy) : cx.lineTo(xx, yy); } cx.stroke();
      cx.beginPath(); cx.arc(xc + 3, wy(L, xc) - 1, 1 + L * .5, 0, 7); cx.fill(); cx.globalAlpha = 1;
      for (let n = nPer(.04 * foam); n > 0; n--) spawn({ k:"spray", z:L, x:top[i][0], y:top[i][1], vx:(Math.random() - .7) * 60, vy:-40 - Math.random() * 60, life:.8, max:.8, r:1.5 + Math.random() * 2 }); } } cx.lineCap = "butt"; }
}
// ---------- shore scenery: a port on a headland, the destination, islands on the horizon ----------
function ribbon(x, y, text, s){
  if (R && R.finale && !R.home) return;   // the end-of-voyage banner owns the sky
  cx.font = "17px 'Lilita One', sans-serif"; const w = cx.measureText(text).width + 30, wv = Math.sin(SC.t * 2) * 1.5;
  if (!R || R.state === "count" || R.home) x = Math.max(x, (w / 2 + 18) * s + 4);
  // on a phone the home port's name steps aside for the multiplier while it would sit under it (countdown, leaving harbour)
  if (R && R.state !== "done" && W < 620 && R.v && text === R.v.from && Math.abs(x - W / 2) < (w / 2 + 18) * s + 96 && y > H * .26 - 34 - 12 * s && y < H * .26 + 52 + 12 * s) return;
  cx.save(); cx.translate(x, y); cx.scale(s, s);
  cx.strokeStyle = INK; cx.lineWidth = 2.5; cx.lineJoin = "round"; cx.fillStyle = "#b9894f";
  for (const d of [-1, 1]){ cx.beginPath(); cx.moveTo(d * (w / 2 + 14), 6); cx.lineTo(d * w / 2, -4); cx.lineTo(d * w / 2, 16); cx.closePath(); cx.fill(); cx.stroke(); }
  cx.fillStyle = "#fff3d6"; cx.beginPath(); cx.moveTo(-w / 2, -12); cx.quadraticCurveTo(0, -12 + wv, w / 2, -12); cx.lineTo(w / 2, 10); cx.quadraticCurveTo(0, 10 + wv, -w / 2, 10); cx.closePath(); cx.fill(); cx.stroke();
  cx.fillStyle = INK; cx.textAlign = "center"; cx.textBaseline = "middle"; cx.fillText(text, 0, wv / 2 + 1); cx.textBaseline = "alphabetic";
  cx.restore();
}
// the coast profile of the port being drawn, so buildings can stand on the real ground
let COAST = null;
const groundAt = x => { const t = COAST; if (!t) return 0; if (x <= t[0][0]) return t[0][1]; for (let i = 1; i < t.length; i++) if (x <= t[i][0]) return lerp(t[i - 1][1], t[i][1], (x - t[i - 1][0]) / (t[i][0] - t[i - 1][0])); return t[t.length - 1][1]; };
// a dressed-stone footing under a building wherever the ground falls away beneath it
function plinth(x0, x1, base){
  if (!COAST) return; let lo = -1e9; for (let x = x0; x < x1; x += 3) lo = Math.max(lo, groundAt(x)); lo = Math.max(lo, groundAt(x1));
  if (lo - base < 1.5) return; const hgt = lo - base + 5;
  cx.fillStyle = "#a89c88"; cx.strokeStyle = INK; cx.lineWidth = 2.5; cx.fillRect(x0, base - 1, x1 - x0, hgt); cx.strokeRect(x0, base - 1, x1 - x0, hgt);
  cx.strokeStyle = "rgba(40,30,20,.35)"; cx.lineWidth = 1.2; for (let yy = base + 5, r = 0; yy < lo + 3; yy += 6, r++){ cx.beginPath(); cx.moveTo(x0 + 2, yy); cx.lineTo(x1 - 2, yy); cx.stroke(); for (let xx = x0 + (r % 2 ? 6 : 12); xx < x1 - 3; xx += 12){ cx.beginPath(); cx.moveTo(xx, yy - 6); cx.lineTo(xx, yy); cx.stroke(); } }
}
function house(hx, base, w, h, wall, roof, night){
  if (COAST){ base = Math.min(groundAt(hx - w / 2), groundAt(hx + w / 2), groundAt(hx)); plinth(hx - w / 2 - 1, hx + w / 2 + 1, base); }
  cx.strokeStyle = INK; cx.lineWidth = 2.5;
  cx.fillStyle = "#7a5a3a"; cx.fillRect(hx + w * .18, base - h - 20, 7, 14); cx.strokeRect(hx + w * .18, base - h - 20, 7, 14); CHIMS.push([hx, hx + w * .18 + 3.5, base - h - 20]);
  cx.fillStyle = wall; cx.fillRect(hx - w / 2, base - h, w, h); cx.strokeRect(hx - w / 2, base - h, w, h);
  cx.fillStyle = "rgba(0,0,0,.12)"; cx.fillRect(hx + w * .1, base - h, w * .4, h);
  cx.fillStyle = roof; cx.beginPath(); cx.moveTo(hx - w / 2 - 5, base - h + 1); cx.lineTo(hx, base - h - h * .62); cx.lineTo(hx + w / 2 + 5, base - h + 1); cx.closePath(); cx.fill(); cx.stroke();
  cx.fillStyle = "#6b3f24"; cx.fillRect(hx - 4, base - 12, 8, 12); cx.strokeRect(hx - 4, base - 12, 8, 12);
  cx.fillStyle = night > .1 ? `rgba(255,214,110,${.5 + .5 * night})` : "#7fb6e6";
  for (const wx of [-w * .3, w * .3]) if (Math.abs(wx) > 8){ cx.fillRect(hx + wx - 4, base - h + 7, 8, 8); cx.strokeRect(hx + wx - 4, base - h + 7, 8, 8); }
}
// the harbour scales with the screen so the whole town fits on a phone
const portScale = () => clamp(Math.min(H / 520, W / 760), .48, 1.15);
const portHome = () => Math.max(W * .15, 330 * portScale());
function drawPort(){   // LIVE: the voyage always leaves from Sanlúcar
  const s = portScale(), x = SC.portX; if (x < -560 * s) return;
  drawPortSanlucar(x, H * LAY[1].y, s, R ? R.v : voyage());
  portGulls(x, H * LAY[1].y, s);
}
// three gulls wheel over the quay on slow loops of their own, wings beating (they glide with wings held on a calm setting)
function portGulls(x, y0, s){
  cx.save(); cx.strokeStyle = "rgba(20,25,50,.75)"; cx.lineWidth = Math.max(1.3, 2 * s); cx.lineCap = "round"; cx.lineJoin = "round";
  for (let q = 0; q < 3; q++){ const a = SC.t * (.42 + q * .07) + q * 2.3, gx = x + (70 + q * 46 + Math.cos(a) * (64 + q * 18)) * s, gy = y0 - (118 + q * 30 + Math.sin(a * 1.6) * 16) * s,
      fl = calm() ? 1.5 : Math.sin(SC.t * (7.5 + q) + q * 1.7) * 3.2, w = (7 + q) * s;
    cx.beginPath(); cx.moveTo(gx - w, gy - fl * s); cx.quadraticCurveTo(gx - w * .4, gy - 2.6 * s, gx, gy); cx.quadraticCurveTo(gx + w * .4, gy - 2.6 * s, gx + w, gy - fl * s); cx.stroke(); }
  cx.restore();
}
// ---------- the European departures: whitewashed Iberian towns, an English port; a lighthouse only where one stood ----------
// ---------- shared pieces for the coast towns ----------
let CHIMS = [];
function portBegin(x, y0, s){ COAST = null; CHIMS = []; cx.save(); cx.translate(x, y0); cx.scale(s, s); cx.lineJoin = "round"; cx.lineCap = "round"; }
// a land profile: rock or earth with an optional top band (grass, sand) along the first `bandN` points, strata lines, outline
function coastLand(top, rockA, rockB, band, bandN, strata){
  COAST = top;
  const land = () => { cx.beginPath(); cx.moveTo(-760, 30); top.forEach(p => cx.lineTo(p[0], p[1])); cx.lineTo(top[top.length - 1][0], 30); cx.closePath(); };
  land(); const g = cx.createLinearGradient(0, Math.min(...top.map(p => p[1])), 0, 24); g.addColorStop(0, rockA); g.addColorStop(1, rockB); cx.fillStyle = g; cx.fill();
  cx.save(); land(); cx.clip();
  if (strata){ cx.strokeStyle = strata; cx.lineWidth = 2; for (let k = 0; k < 7; k++){ const yy = -110 + k * 18; cx.beginPath(); for (let xx = -760; xx <= 220; xx += 30) xx === -760 ? cx.moveTo(xx, yy) : cx.lineTo(xx, yy + Math.sin(xx * .045 + k * 1.7) * 5); cx.stroke(); } }
  if (band){ const b = top.slice(0, bandN || top.length); cx.fillStyle = band; cx.beginPath(); b.forEach((p, i) => i ? cx.lineTo(p[0], p[1]) : cx.moveTo(p[0], p[1])); for (let i = b.length - 1; i >= 0; i--) cx.lineTo(b[i][0], b[i][1] + 13); cx.closePath(); cx.fill(); }
  cx.restore(); cx.strokeStyle = INK; cx.lineWidth = 3; land(); cx.stroke();
}
// smoke drifts downwind: the fleet's following wind carries it ahead, toward the ships' bows (all smoke has a positive vx)
function chimneySmoke(x, y0, s, xs){ const ch = CHIMS.filter(c => xs.includes(c[0])); if (ch.length) for (let n = nPer(.16); n > 0; n--){ const c = ch[Math.floor(Math.random() * ch.length)]; spawn({ k:"smoke", z:1, light:true, x:x + c[1] * s, y:y0 + (c[2] - 2) * s, vx:(5 + Math.random() * 6) * s, vy:-(15 + Math.random() * 5) * s, life:2.6, max:2.6, r:(2.2 + Math.random() * 1.6) * s, g:3.4 * s, wob:Math.random() * 6 }); } }
function rowboat(x, y, col){ const rb = Math.sin(SC.t * 1.8 + x) * 2.5; cx.save(); cx.translate(x, y + rb); cx.rotate(Math.sin(SC.t * 1.3 + x) * .05); cx.fillStyle = col || "#a5532f"; cx.strokeStyle = INK; cx.lineWidth = 3;
  cx.beginPath(); cx.moveTo(-26, -8); cx.lineTo(26, -8); cx.quadraticCurveTo(22, 8, 0, 9); cx.quadraticCurveTo(-22, 8, -26, -8); cx.closePath(); cx.fill(); cx.stroke(); cx.restore(); }
// the flat-topped stone pine of the Huelva and Cádiz coast
function stonePine(x, y, h){ cx.strokeStyle = INK; cx.lineWidth = 2.5; cx.fillStyle = "#6b3f24";
  cx.beginPath(); cx.moveTo(x - 3, y); cx.quadraticCurveTo(x - 2, y - h * .5, x + 4, y - h * .82); cx.lineTo(x + 9, y - h * .82); cx.quadraticCurveTo(x + 3, y - h * .5, x + 4, y); cx.closePath(); cx.fill(); cx.stroke();
  cx.fillStyle = "#3f6b3a"; cx.beginPath(); cx.moveTo(x - h * .5, y - h * .8); cx.quadraticCurveTo(x - h * .45, y - h * 1.04, x - h * .1, y - h * 1.02); cx.quadraticCurveTo(x + h * .2, y - h * 1.12, x + h * .45, y - h * .98); cx.quadraticCurveTo(x + h * .66, y - h * .9, x + h * .55, y - h * .78); cx.closePath(); cx.fill(); cx.stroke(); }
function reeds(x0, x1, y){ cx.strokeStyle = "#7d7a3a"; cx.lineWidth = 2; for (let xx = x0; xx < x1; xx += 7){ const hh = 10 + (xx * 7 % 9), sw = Math.sin(SC.t * 1.5 + xx * .3) * 2; cx.beginPath(); cx.moveTo(xx, y); cx.quadraticCurveTo(xx + sw * .5, y - hh * .6, xx + sw, y - hh); cx.stroke(); }
  cx.fillStyle = "#8a5a2a"; for (let xx = x0 + 10; xx < x1; xx += 23){ cx.beginPath(); cx.ellipse(xx + Math.sin(SC.t * 1.5 + xx * .3) * 2, y - 14 - (xx * 7 % 9), 1.8, 4, 0, 0, 7); cx.fill(); } }
function stork(x, y){ cx.strokeStyle = INK; cx.lineWidth = 2; cx.fillStyle = "#8a6a3a"; cx.beginPath(); cx.ellipse(x, y, 11, 4, 0, 0, 7); cx.fill(); cx.stroke();
  cx.fillStyle = "#fff"; cx.beginPath(); cx.ellipse(x + 1, y - 7, 6, 4, -.2, 0, 7); cx.fill(); cx.stroke(); cx.beginPath(); cx.moveTo(x + 5, y - 9); cx.lineTo(x + 7, y - 16); cx.stroke();
  cx.fillStyle = "#e8402f"; cx.beginPath(); cx.moveTo(x + 7, y - 17); cx.lineTo(x + 15, y - 15); cx.lineTo(x + 7, y - 14); cx.closePath(); cx.fill(); }
function crenels(x0, x1, y, w){ for (let bx = x0; bx < x1 - 2; bx += w * 1.8){ cx.fillRect(bx, y - w, w, w); cx.strokeRect(bx, y - w, w, w); } }
function windmill(x, y, s){ cx.save(); cx.translate(x, y); cx.scale(s, s); cx.strokeStyle = INK; cx.lineWidth = 2.5; cx.fillStyle = "#cfc8b8";
  cx.beginPath(); cx.moveTo(-12, 0); cx.lineTo(-8, -40); cx.lineTo(8, -40); cx.lineTo(12, 0); cx.closePath(); cx.fill(); cx.stroke();
  cx.fillStyle = "#4a4f68"; cx.beginPath(); cx.moveTo(-11, -40); cx.quadraticCurveTo(0, -54, 11, -40); cx.closePath(); cx.fill(); cx.stroke();
  cx.translate(0, -42); cx.rotate(SC.t * .9); cx.fillStyle = "#f2ead8"; for (let k = 0; k < 4; k++){ cx.rotate(Math.PI / 2); cx.fillRect(2, -3, 28, 7); cx.strokeRect(2, -3, 28, 7); }
  cx.fillStyle = INK; cx.beginPath(); cx.arc(0, 0, 3, 0, 7); cx.fill(); cx.restore(); }

// ---------- Palos de la Frontera, 1492: a low hill over the marshes of the Río Tinto ----------

// ===== the port of Sanlúcar — src/game.html lines 1719–1752 =====
function drawPortSanlucar(x, y0, s, v){
  const night = clamp((SC.nightP - .6) / .25, 0, 1); portBegin(x, y0, s);
  // the upper town's bluff, then a long sandy beach down to the water
  const beach = [[-150, -76], [-110, -48], [-40, -34], [40, -24], [100, -12], [132, 4], [146, 30]];
  coastLand([[-760, -100], [-400, -104], [-200, -102], ...beach], "#c9a66b", "#9a7a48", "#e9cf8f", 3, "rgba(80,50,20,.18)");
  // the beach itself is pale sand
  cx.fillStyle = "#f0dca6"; cx.beginPath(); beach.forEach((q, i) => i ? cx.lineTo(q[0], q[1]) : cx.moveTo(q[0], q[1])); cx.lineTo(-250, 30); cx.quadraticCurveTo(-192, 22, -164, groundAt(-164)); cx.lineTo(-150, -76); cx.closePath(); cx.fill();   // the sand starts at the castle's right wall, so the dark bluff never shows past it   // the beach runs up the foot of the bluff as a sand slope (it met the bluff in a straight vertical seam)
  cx.strokeStyle = "rgba(120,85,40,.45)"; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(-250, 30); cx.quadraticCurveTo(-192, 22, -164, groundAt(-164)); cx.stroke();
  cx.strokeStyle = INK; cx.lineWidth = 3; cx.beginPath(); beach.forEach((q, i) => i ? cx.lineTo(q[0], q[1]) : cx.moveTo(q[0], q[1])); cx.stroke();
  cx.strokeStyle = "rgba(180,140,80,.5)"; cx.lineWidth = 2; for (let k = 0; k < 4; k++){ cx.beginPath(); cx.moveTo(-90 + k * 60, -14 + k * 5); cx.quadraticCurveTo(-64 + k * 60, -18 + k * 5, -38 + k * 60, -12 + k * 5); cx.stroke(); }
  // Castillo de Santiago: curtain walls, round towers and a tall keep
  const kx = -250, kb = -102; plinth(kx - 90, kx + 86, kb); cx.fillStyle = "#d9c9a6"; cx.strokeStyle = INK; cx.lineWidth = 3;
  cx.fillRect(kx - 70, kb - 40, 150, 40); cx.strokeRect(kx - 70, kb - 40, 150, 40); crenels(kx - 70, kx + 80, kb - 40, 8);
  [kx - 78, kx + 74].forEach(tx => { cx.fillRect(tx - 12, kb - 58, 24, 58); cx.strokeRect(tx - 12, kb - 58, 24, 58); crenels(tx - 12, tx + 12, kb - 58, 6); });
  cx.fillStyle = "#cdbb94"; cx.fillRect(kx - 18, kb - 96, 40, 56); cx.strokeRect(kx - 18, kb - 96, 40, 56); crenels(kx - 18, kx + 22, kb - 96, 7);
  cx.fillStyle = INK; [kx - 6, kx + 8].forEach(wx => cx.fillRect(wx, kb - 80, 4, 10));
  cx.strokeStyle = INK; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(kx + 2, kb - 103); cx.lineTo(kx + 2, kb - 124); cx.stroke(); cx.fillStyle = "#f2c230"; cx.beginPath(); cx.moveTo(kx + 2, kb - 124); cx.lineTo(kx + 20, kb - 119); cx.lineTo(kx + 2, kb - 114); cx.closePath(); cx.fill(); cx.stroke();
  // the beach houses cast a soft shade on the sand below them (leaning the same way as the bluff's shade under the castle), lighter at night
  for (const [hx, w] of [[-104, 30], [-66, 28]]){ let lo = -1e9; for (let xx = hx - w / 2 - 1; xx <= hx + w / 2 + 1; xx += 3) lo = Math.max(lo, groundAt(xx));
    const x0 = hx - w / 2 - 3, x1 = hx + w / 2 + 3, yt = lo + 3, d = 28, a = .52 * (1 - .5 * night), g = cx.createLinearGradient(0, yt, 0, yt + d);
    g.addColorStop(0, `rgba(140,105,55,${a})`); g.addColorStop(1, "rgba(140,105,55,0)");
    cx.fillStyle = g; cx.beginPath(); cx.moveTo(x0, yt); cx.lineTo(x1, yt); cx.lineTo(x1 - 12, yt + d); cx.lineTo(x0 - 12, yt + d); cx.closePath(); cx.fill(); }
  // the lower town along the beach
  [[-370, -104, 30, 26], [-104, -45, 30, 24], [-66, -38, 28, 22]].forEach(([hx, by, w, hh], k) => house(hx, by, w, hh, k % 2 ? "#fbf6ea" : "#fffaf0", k % 2 ? "#d07a45" : "#c9673a", night));
  // fishing boats pulled up on the sand and a short wooden pier
  [[10, -27, .12], [74, -18, -.14]].forEach(([bx, by, r]) => { cx.save(); cx.translate(bx, by); cx.rotate(r); cx.fillStyle = "#3d6aa8"; cx.strokeStyle = INK; cx.lineWidth = 3; cx.beginPath(); cx.moveTo(-22, -8); cx.lineTo(22, -8); cx.quadraticCurveTo(18, 6, 0, 7); cx.quadraticCurveTo(-18, 6, -22, -8); cx.closePath(); cx.fill(); cx.stroke(); cx.fillStyle = "#fff"; cx.fillRect(-18, -8, 36, 3); cx.restore(); });
  cx.strokeStyle = INK; cx.lineWidth = 3; for (let px = 156; px <= 234; px += 26){ cx.beginPath(); cx.moveTo(px, -6); cx.lineTo(px, 34); cx.stroke(); }
  cx.fillStyle = "#b9894f"; cx.fillRect(118, -12, 124, 7); cx.strokeRect(118, -12, 124, 7);
  rowboat(266, 8, "#3d6aa8");
  cx.restore();
  // LIVE: no place-name ribbon (no place names on screen)
  if (!SC.mirrorPort) chimneySmoke(x, y0, s, [-370, -104, -66]);   // LIVE: no smoke on the mirrored homecoming coast
}

// ===== regions, hazards — src/game.html lines 1825–2046 =====
const PIRATE_WATERS = [
  // yrs: when raiders really worked these waters (French corsairs reach the Caribbean in the 1520s; Barbary corsairs until 1830; Chen Zuyi's fleet at Palembang 1407; wokou; Moro raiders)
  // ship: what the raiders sailed there. shot: cannon, or volleys of fire arrows where guns came late
  { name:"the Caribbean", box:[-90, -60, 9, 28], yrs:[1520, 1830], ship:"Sloop", shot:"ball" }, { name:"the Barbary Coast", box:[-6, 12, 30, 38], yrs:[1504, 1830], ship:"Xebec", shot:"ball" },
  // the Atlantic side: Moroccan corsairs raid out to Madeira and the Canaries from the 1560s (Lanzarote 1569 and 1586; the Salé rovers after 1610).
  // Columbus 1492, da Gama 1497 and Magellan 1519 sailed this coast before them; Drake (1577, a man seized at Mogador) and Cook after
  { name:"the Barbary Coast", box:[-20, -6, 27, 36], yrs:[1565, 1830], ship:"Xebec", shot:"ball" },
  { name:"the Arabian Sea", box:[42, 66, 0, 16], yrs:[1000, 2000], ship:"Dhow", shot:"arrow" }, { name:"the Strait of Malacca", box:[94, 106, -3, 8], yrs:[1300, 1900], ship:"PirateJunk", shot:"arrow" },
  { name:"the South China Sea", box:[105, 122, 4, 23], yrs:[1300, 1900], ship:"PirateJunk", shot:"arrow" }, { name:"the Sulu Sea", box:[118, 130, 4, 16], yrs:[1500, 1900], ship:"Lanong", shot:"ball" },
];
// other ships on the horizon only where and when there was shipping to see. An explorer opening a new ocean (Columbus past Iberia, Leif past
// Greenland, da Gama's and Magellan's Atlantic, every Pacific crossing) sails it alone
const TRADE_LANES = [
  { box:[-10, 30, 35, 62], yrs:[800, 2000] },     // Europe's own coasts, the Channel and the Mediterranean
  { box:[-50, -12, 58, 68], yrs:[985, 1450] },    // the Norse run between Iceland and Greenland (Brattahlíð's own fjords)
  { box:[32, 80, -12, 26], yrs:[800, 2000] },     // the monsoon trade: east Africa, Arabia, India
  { box:[80, 125, -10, 32], yrs:[800, 2000] },    // the Bay of Bengal, Malacca and the China seas
  { box:[-80, -5, -35, 60], yrs:[1550, 2000] },   // the Atlantic once Spain and Portugal ply it (Drake takes a Portuguese ship off Cape Verde in 1578)
  { box:[-90, -60, 9, 28], yrs:[1510, 2000] },    // the Spanish Caribbean
  { box:[-120, -78, 0, 25], yrs:[1540, 2000] },   // Spain's Pacific coast: New Spain and Panama
  { box:[-86, -68, -45, 0], yrs:[1540, 2000] },   // and down to Peru and Chile, where Drake took the Cacafuego (hugging the coast, not the open ocean)
];
const inBox = (b, lon, lat) => lon >= b[0] && lon <= b[1] && lat >= b[2] && lat <= b[3];
function fleetLonLat(){ return liveLonLat(); }   // LIVE: position on the shared route
function regionNow(){
  const [lon0, lat] = fleetLonLat(), lon = ((lon0 + 180) % 360 + 360) % 360 - 180, yr = (R ? R.v : voyage()).year;
  // icebergs only where they drift: off Greenland, Labrador and Newfoundland, and the Southern Ocean round Cape Horn
  // (the Strait of Magellan itself, 52–54°S, is sheltered water: cold, but no drifting bergs)
  const ice = (lat > 46 && lon > -70 && lon < -10) || lat > 62 || lat < -54.5;
  const when = z => yr >= z.yrs[0] && yr <= z.yrs[1] && inBox(z.box, lon, lat);
  return { lat, lon, cold:ice, tropic:Math.abs(lat) < 23.5, traffic:TRADE_LANES.some(when), pirates:PIRATE_WATERS.find(when) || null };
}
// the great storm takes its local name: a hurricane in the Caribbean and the tropical Atlantic (and off Mexico), a typhoon in the China seas
// and the western Pacific, a cyclone in the Indian Ocean and the South Pacific; anywhere else (the North Atlantic, the capes, the Southern Ocean,
// right on the equator where they never form) it is a tempest. Only the name: every great storm is the same ×2.3
function stormName(kind){
  if (kind.dark < .9) return kind.name;
  const rg = (R && R.reg) || regionNow(), lon = rg.lon, lat = rg.lat;
  if (Math.abs(lat) < 5) return "Tempest";
  if (lat > 0 && lat < 40 && lon > 100) return "Typhoon";
  if (lat > 0 && ((lon > -100 && lon < -15 && lat < 40) || (lon >= -140 && lon <= -100 && lat < 30))) return "Hurricane";
  if ((lat < 30 && lat > -40 && lon > 30 && lon <= 100) || (lat < 0 && lat > -40 && (lon > 100 || lon < -130))) return "Cyclone";
  return "Tempest";
}
// still near the home port (shallow water)? Under sail this goes by how far the port has dropped astern on the voyage's own clock (R.port,
// kept by simStep: 0 at the quay, 1 just out of sight, and the port is drawn there), so it is the same on every screen and at any frame
// rate; without R.port (Fair Winds Live) it goes by where the port is on screen
const PORT_SHORE = 1.1, nearPort = () => R && R.port != null ? R.port < PORT_SHORE : SC.portX > -380 * portScale();
function pickCause(n = 1){
  const rg = R.reg || {}, w = { lightning:2, wave:3 + 6 * (n - 1), kraken:1.4, reef:.6, whale:.7, iceberg:0, pirates:0 };
  if (R.inStorm){ w.lightning += 4; w.wave += 2; }
  if (R.zone && R.zone.kind !== "wind"){ w.wave += 3; if (R.zone.kind === "mystery") w.kraken += 3; }
  if (rg.cold){ w.iceberg += 6; w.whale += 1.5; w.reef = 0; w.lightning *= .5; }
  if (rg.tropic){ w.reef += 3; w.lightning += 1; }
  if (rg.pirates) w.pirates += 7;
  // in harbour or with the landfall coast in sight the water is too shallow for sea monsters and bergs; shoals are the danger
  if (nearPort() || SC.p > HOME_P)   /* LIVE: home coast */{ w.kraken = 0; w.whale = 0; w.iceberg = 0; w.reef += 2.5; }
  let t = Object.values(w).reduce((a, b) => a + b, 0) * R.rng();
  for (const [k, v] of Object.entries(w)){ t -= v; if (t <= 0) return k; }
  return "wave";
}
// an iceberg drifts into a ship: it lies still in the water (it drifts with the sea, astern at the water's speed) and looms out of the haze
// just ahead of her bow; she runs onto it at her own speed (the strike at .38 s), stops dead against it, and berg and wreck go astern together.
// Its waterline rides the swell (a big berg bridges the short waves and rolls slowly). (Live's old-style berg, x0 at W + 140, works the same.)
function drawBergs(L){
  for (const b of SC.bergs){ if (b.L !== L) continue;
    if (b.sc0 == null){ b.sc0 = SC.scroll; b.x0 = b.tx + SC.speed * LAY[L].s * .38; b.ang = 0; }   // where it lies so the water brings it to her bow at the strike
    b.t += DT; b.x = b.x0 - (SC.scroll - b.sc0) * LAY[L].s;
    const s = b.s, hw = 40 * s, yl = wy(L, b.x - hw), yr = wy(L, b.x + hw);
    b.y = (yl + 2 * wy(L, b.x) + yr) / 4 + 6; b.ang += (clamp(Math.atan((yr - yl) / (2 * hw)) * .5, -.15, .15) - b.ang) * follow(3, DT);
    // the jolt matches the strike: a ship running at her speed onto still ice (stronger for the faster near row), not the old fly-in
    if (!b.hit && b.t >= .38){ b.hit = true; sfx("crack"); for (let q = 0; q < 14; q++) spawn({ k:"spray", z:b.L, x:b.tx - 10, y:b.y - 10, vx:(Math.random() - .7) * 160, vy:-80 - Math.random() * 120, life:.8, max:.8, r:2 + Math.random() * 2 }); SC.shake = Math.max(SC.shake, clamp(SC.speed * LAY[L].s / 110, .3, .65)); }
    const a = b.t > 2.6 ? clamp(1 - (b.t - 2.6) / .6, 0, 1) : clamp(b.t / .22, 0, 1);
    cx.save(); cx.globalAlpha = a; cx.translate(b.x, b.y); cx.rotate(b.ang); cx.scale(s, s); cx.strokeStyle = INK; cx.lineWidth = 3; cx.lineJoin = "round";
    cx.fillStyle = "#f1fbff"; cx.beginPath(); cx.moveTo(-52, 14); cx.lineTo(-40, -36); cx.lineTo(-18, -26); cx.lineTo(0, -70); cx.lineTo(24, -38); cx.lineTo(48, 14); cx.closePath(); cx.fill(); cx.stroke();
    cx.fillStyle = "#b9e2f3"; cx.beginPath(); cx.moveTo(0, -70); cx.lineTo(24, -38); cx.lineTo(48, 14); cx.lineTo(16, 14); cx.lineTo(8, -30); cx.closePath(); cx.fill();
    cx.fillStyle = "rgba(120,200,235,.45)"; cx.fillRect(-52, 8, 100, 8);
    cx.restore();
  }
  SC.bergs = SC.bergs.filter(b => b.t < 3.2);
}
// ---------- rocks: chunky boulders with a lit top, a shaded flank, a crack, barnacles and a wet foot fringed with weed. In the tropics they are
// coral heads over pale shallows, in cold seas growlers of old ice. A cluster is drawn from its own seed, so it keeps its shape as it moves
const ROCKPAL = {
  rock:{ lit:"#b2a9c2", mid:"#857b9e", dark:"#5c5175", wet:"#3a3250", fleck:"#dcd5e4", weed:"#2f5a34" },
  coral:{ lit:"#ecd8cc", mid:"#c3a49a", dark:"#8d7070", wet:"#5f4a52", fleck:"#f6ebe4", weed:null },
  ice:{ lit:"#ffffff", mid:"#e4f6fc", dark:"#a9d8ec", wet:"#7cbad8", fleck:"#ffffff", weed:null } };
ROCKPAL.sand = ROCKPAL.coral;   // coral rock seen from afar: the colour without the coral heads
const CORAL = ["#ff7f8a", "#ff9f5a", "#c58cf0", "#ffd166"];
function rockKind(){ return SC.cold > .5 ? "ice" : SC.tropic > .5 ? "coral" : "rock"; }
// a cluster of boulders standing in the sea at (x, y = the waterline), about w wide and h tall; up (0–1) is how far it has come out of the
// water. skirtL: the cluster stands between two rows of waves, so it draws the water round its own foot (the body of layer skirtL) and its surf
// dp: how far the stones reach below the waterline, so a passing trough uncovers more rock instead of the rock's underside (rocks stand on the
// seabed and never ride the waves: callers give y as the sea's resting level, not the wave height)
function drawRocks(x, y, w, h, seed, kind, up, skirtL, dp = 0){
  if (up <= .01) return;
  const pal = ROCKPAL[kind] || ROCKPAL.rock, rnd = mulberry32(seed | 0), n = 3 + (seed % 2), lw = clamp(w / 30, 1.4, 2.8), ice = kind === "ice", sink = (1 - up) * h * 1.1, stones = [];
  for (let i = 0; i < n; i++){ const rel = i / (n - 1) - .5, mid = 1 - Math.abs(rel) * 1.2;
    stones.push({ x:x + rel * w * .74 + (rnd() - .5) * w * .1, bw:w * (.32 + .16 * rnd()) * (.8 + .35 * mid), bh:h * (.34 + .24 * rnd() + .42 * Math.max(0, mid)), lean:(rnd() - .5) * .6, k:[0, 1, 2, 3, 4, 5, 6].map(() => .8 + .32 * rnd()), cr:rnd(), sp:rnd() }); }
  stones.sort((a, b) => b.bh - a.bh);
  cx.save(); cx.lineJoin = "round"; cx.lineCap = "round";
  // between two rows of waves nothing of it shows below the waterline
  if (skirtL != null){ cx.beginPath(); cx.rect(x - w * 2, y - h * 3, w * 4, h * 3 + 3); cx.clip(); }
  if (kind === "coral"){ cx.fillStyle = `rgba(150,240,225,${.32 * up})`; cx.beginPath(); cx.ellipse(x, y + 3, w * .78, Math.max(4, h * .18), 0, 0, 7); cx.fill(); }
  for (const st of stones){ const bw = st.bw, base = y + sink + 7 + dp, ty = y + sink - st.bh; if (ty > y + 1) continue;
    const pts = []; for (let j = 0; j <= 6; j++){ const a = Math.PI * j / 6, r = j === 0 || j === 6 ? 1 : st.k[j];
      pts.push([st.x + Math.cos(a) * bw / 2 * r + st.lean * bw * .5 * Math.sin(a) * Math.sin(a), base - Math.sin(a) * (st.bh + 7 + dp) * r]); }
    const path = () => { cx.beginPath(); cx.moveTo(pts[0][0], pts[0][1]);
      if (ice) for (let j = 1; j <= 6; j++) cx.lineTo(pts[j][0], pts[j][1]);
      else { for (let j = 1; j < 6; j++) cx.quadraticCurveTo(pts[j][0], pts[j][1], (pts[j][0] + pts[j + 1][0]) / 2, (pts[j][1] + pts[j + 1][1]) / 2); cx.lineTo(pts[6][0], pts[6][1]); }
      cx.closePath(); };
    path(); cx.fillStyle = pal.mid; cx.fill();
    cx.save(); path(); cx.clip();
    const lx = st.x - bw * (.14 - st.lean * .2);
    // the sun on its shoulder, the shade down the far flank, and dark wet stone where the sea washes it
    cx.fillStyle = pal.lit; cx.beginPath(); cx.ellipse(lx, ty + st.bh * .2, bw * .4, st.bh * .46, -.35, 0, 7); cx.fill();
    cx.fillStyle = pal.dark; cx.beginPath(); cx.moveTo(st.x + bw * .12, ty - 6); cx.quadraticCurveTo(st.x + bw * (.02 + .12 * st.cr), ty + st.bh * .55, st.x + bw * .22, base + 2); cx.lineTo(st.x + bw, base + 2); cx.lineTo(st.x + bw, ty - 6); cx.closePath(); cx.fill();
    const wg = cx.createLinearGradient(0, y - st.bh * .4, 0, y + 3); wg.addColorStop(0, "rgba(0,0,0,0)"); wg.addColorStop(1, pal.wet); cx.fillStyle = wg; cx.fillRect(st.x - bw, y - st.bh * .4, bw * 2, st.bh * .4 + 12);
    if (!ice){ cx.strokeStyle = "rgba(10,15,40,.5)"; cx.lineWidth = Math.max(1, lw * .5); const c0 = st.x + (st.cr - .5) * bw * .35;
      cx.beginPath(); cx.moveTo(c0, ty + st.bh * .08); cx.lineTo(c0 + bw * .07, ty + st.bh * .3); cx.lineTo(c0 - bw * .01, ty + st.bh * .52); cx.stroke(); }
    cx.fillStyle = pal.fleck; for (let q = 0; q < (kind === "coral" ? 1 : 3); q++){ const fx = st.x + (((st.sp * 7 + q * .37) % 1) - .5) * bw * .6, fy = y - st.bh * (.12 + q * .1);
      cx.beginPath(); cx.ellipse(fx, fy, lw * .85, lw * .55, 0, 0, 7); cx.fill(); }
    cx.restore();
    path(); cx.strokeStyle = INK; cx.lineWidth = lw; cx.stroke();
    cx.strokeStyle = ice ? "rgba(255,255,255,.95)" : "rgba(255,255,255,.6)"; cx.lineWidth = Math.max(1, lw * .7);
    cx.beginPath(); cx.ellipse(lx + bw * .04, ty + st.bh * .36, bw * .25, st.bh * .3, -.35, Math.PI * 1.08, Math.PI * 1.42); cx.stroke();
    // weed hanging at the tide line
    if (pal.weed && st.bh > h * .45 && ty < y - 8){ cx.strokeStyle = pal.weed; cx.globalAlpha = .7; cx.lineWidth = Math.max(1, lw * .5); for (let q = -1; q <= 1; q++){ const qx = st.x + q * bw * .2 + st.sp * 3, qy = y - 3 - st.sp * 2;
      cx.beginPath(); cx.moveTo(qx, qy - 2); cx.quadraticCurveTo(qx + 2, qy + 1, qx, qy + 4); cx.stroke(); } cx.globalAlpha = 1; }
    // coral heads on the tallest stones
    if (kind === "coral" && st === stones[0]) for (let q = 0; q < 2; q++){ const qx = st.x + (q - .5) * bw * .32, qy = ty + st.bh * (.12 + q * .08), sz = Math.max(2.5, bw * .085), col = CORAL[(q + Math.floor(st.sp * 4)) % 4];
      for (const [cs, wd] of [[INK, lw * 2.5], [col, lw * 1.25]]){ cx.strokeStyle = cs; cx.lineWidth = wd; cx.beginPath();
        for (const [a1, b1, a2, b2] of [[0, .2, 0, -1], [0, -.4, -.55, -1.05], [0, -.3, .5, -.9]]){ cx.moveTo(qx + a1 * sz, qy + b1 * sz); cx.lineTo(qx + a2 * sz, qy + b2 * sz); } cx.stroke(); } }
  }
  if (skirtL != null){ cx.restore(); cx.save();
    // the sea round its foot: the same water as the waves behind it, so the stones stand in the sea rather than on it
    const L = skirtL, c = seaCol(L), g = cx.createLinearGradient(0, H * LAY[L].y - 20, 0, H); g.addColorStop(0, rgb(mixC(c, "#ffffff", .08))); g.addColorStop(1, rgb(mixC(c, "#06102a", .35)));
    cx.fillStyle = g; cx.beginPath(); const x0 = x - w * .82, x1 = x + w * .82;
    for (let i = 0; i <= 12; i++){ const xx = lerp(x0, x1, i / 12); cx.lineTo(xx, y + 1.5 + Math.sin(xx * .09 + SC.t * 2.2) * 1.3); }
    cx.quadraticCurveTo(x, y + h * .9, x0, y + 1.5); cx.closePath(); cx.fill();
  }
  if (skirtL != null && up > .3){
    // surf: the swell runs up the rocks and drains off again, white water all along the foot
    const a = clamp((up - .3) / .4, 0, 1), still = calm();
    for (let q = 0; q < 10; q++){ const u = q / 9 - .5, wash = still ? .4 : .5 + .5 * Math.sin(SC.t * 2.6 + q * 1.3 + seed), qx = x + u * w * 1.15;
      cx.fillStyle = `rgba(255,255,255,${(.55 + .35 * wash) * a})`; cx.beginPath(); cx.ellipse(qx, y + 1.5 - wash * 1.5, w * (.07 + .04 * Math.sin(q * 2.1 + seed)), 1.4 + 2.4 * wash * (1 - Math.abs(u)), 0, 0, 7); cx.fill(); }
  }
  cx.restore();
}
// a ship strikes a reef: rocks heave up out of a trough round her bow, she rides up onto them and settles by the stern, and once she has
// gone the swell closes over them. The big rocks stand behind her (back pass), a low ledge in front of her keel (front pass), and the
// surf breaking on them is foam on the water in front
function drawReefs(L, back){
  for (const rf of SC.reefs){ if (rf.L !== L) continue;
    if (!back) rf.t += DT;
    // the rocks belong to the seabed: as the fleet sails on they slide astern with the water of their row (the screen follows the ships)
    const rx = rf.x - (SC.scroll - (rf.sc0 != null ? rf.sc0 : SC.scroll)) * LAY[L].s;
    const t = rf.t, d = rf.d || 1, kind = rf.kind || rockKind(), seed = rf.seed || 7, w = rf.w, h = rf.h || w * .4, y = H * LAY[L].y + 1, dp = seaA(L) + 2 + (SC.rogues.length ? rogueDip(L) : 0);   // fixed: rocks never ride the swell
    const up = ease(clamp(t / .22, 0, 1));   // they stay up and roll out of the picture astern (user, 2026-11-13: never sink back into the sea)
    if (back){ drawRocks(rx, y, w, h, seed, kind, up, null, dp); continue; }
    // as they slide astern past a ship still under sail in this row, the low ledge in front would cut across her hull: they pass behind her
    const passing = SC.ships.some(o => o.row === (L === 3 ? 1 : 0) && (o.state === "sail" || o.state === "leave") && Math.abs(shipPose(o).x - rx) < (w + shipPose(o).bw) * .55);
    if (!passing) drawRocks(rx + d * w * .15, y + 3, w * .7, h * .4, seed + 3, kind, up, null, dp);
    if (!rf.hit && t > .1){ rf.hit = true; for (let k = 0; k < 16; k++) spawn({ k:"spray", z:L, x:rx - d * w * .25 + (Math.random() - .5) * w * .3, y:y - h * .25, vx:d * (Math.random() * 140 - 40), vy:-90 - Math.random() * 140, life:.75, max:.75, r:1.6 + Math.random() * 2.2 }); SC.shake = Math.max(SC.shake, .6); }
    if (!calm() && up > .4) for (let n = nPer(.55); n > 0; n--){ const qx = rx + (Math.random() - .5) * w * 1.1; spawn({ k:"foam", z:L, x:qx, y:wy(L, qx) + 1, vx:0, vy:0, life:.9, max:.9, r:2.5 + Math.random() * 3.5, L }); }
    if (!calm() && up > .6) for (let n = nPer(.12); n > 0; n--) for (let q = 0; q < 3; q++) spawn({ k:"spray", z:L, x:rx + (Math.random() - .5) * w * .8, y:y - 2, vx:(Math.random() - .5) * 50, vy:-50 - Math.random() * 60, life:.6, max:.6, r:1.3 + Math.random() * 1.5 });
  }
  if (!back) SC.reefs = SC.reefs.filter(rf => rf.t < 40 && rf.x - (SC.scroll - (rf.sc0 != null ? rf.sc0 : SC.scroll)) * LAY[rf.L].s + rf.w > -60);
}
// near misses: rocks awash slide past on the near side of a ship, between her and the next row of waves (cosmetic, see nearMiss())
function drawNear(Lh){
  if (!SC.nears || !SC.nears.length) return;
  const L0 = Math.floor(Lh), f = Lh - L0;
  for (const n of SC.nears){ if (n.Lh !== Lh) continue;
    n.t += DT; n.x -= SC.speed * lerp(LAY[L0].s, LAY[L0 + 1].s, f) * DT;
    if (n.end == null && n.t > 40) n.end = n.t;   // they roll out of the picture astern instead of sinking (user, 2026-11-13)
    const up = ease(clamp(n.t / .5, 0, 1)) * (n.end != null ? 1 - ease(clamp((n.t - n.end) / .6, 0, 1)) : 1), y = lerp(H * LAY[L0].y, H * LAY[L0 + 1].y, n.f || f);   // fixed: the sea moves round the rocks, they never ride it
    drawRocks(n.x, y, n.w, n.h, n.seed, n.kind, up, L0);
    // as she draws level the surf slaps against her side: a shudder and a burst of spray, and the crew breathe again
    const sh = n.ship; if (!n.hit && sh && sh.state === "sail" && n.x < n.hx + n.w * .2){ n.hit = true; const P = shipPose(sh);
      sh.hitT = Math.max(sh.hitT || 0, .22); for (let q = 0; q < 9; q++) spawn({ k:"spray", z:L0 + 1, x:n.x + (Math.random() - .5) * n.w * .6, y:y - n.h * .5, vx:(Math.random() - .5) * 70, vy:-70 - Math.random() * 90, life:.7, max:.7, r:1.4 + Math.random() * 1.8 });
      if (typeof nearCue === "function") nearCue(P.x, P.y - P.h * .9, "rocks"); }
  }
  SC.nears = SC.nears.filter(n => !(n.end != null && n.t - n.end > .65) && n.x + n.w > -60);
}
// a pirate ship sails in, fires a broadside and leaves
function drawRaiders(L){
  for (const r of SC.raiders){ if (r.L !== L) continue; const img = SPR[r.ship] || SPR.Pirate;
    r.t += DT; const t = r.t; r.rec = Math.max(0, (r.rec || 0) - DT * 6);
    if (r.vic && r.vic.state === "sink") r.target.x = shipPose(r.vic).x;   // her prize loses way and falls astern: shots and plunder follow her
    // she runs in, fights, comes about (the same turn as a ship for home, turnFx) and makes off, gathering way to a top speed (runOff)
    const turn = ease(clamp((t - 1.5) / TURN_T, 0, 1));
    r.x = (t < .6 ? lerp(r.x0, r.tx, ease(t / .6)) : r.tx - Math.sin(Math.PI * turn) * r.bw * .2 + runOff(t - 1.5 - TURN_T * .8, runTop())) + r.rec * 7;
    // she follows the sea with the same little lag as a ship (rideSea), not snapping to every wave
    const [y, ra] = rideSea(r, wy(r.L, r.x), clamp(Math.atan((wy(r.L, r.x + 10) - wy(r.L, r.x - 10)) / 20) * .9, -.6, .6), 1, r.h);
    if ((t < .6 || t > 1.75)) for (let n = nPer(.5); n > 0; n--) spawn({ k:"spray", z:r.L, x:r.x + (t < .6 ? -r.bw * .45 : r.bw * .45), y:y - 2, vx:(t < .6 ? -1 : 1) * (40 + Math.random() * 40), vy:-30 - Math.random() * 30, life:.5, max:.5, r:1.3 + Math.random() * 1.5 });
    // plunder: the gold of the stricken ship flies to the raider
    // (each coin flies a true arc and lands on her deck, r.deck, wherever she has moved to by then: see drawParticles)
    const rot = ra + r.rec * .05 + Math.sin(Math.PI * turn) * .09;
    r.deck = [r.x + Math.sin(rot) * r.h * .45, y - Math.cos(rot) * r.h * .45];
    if (!r.looted && t >= 1.3){ r.looted = true; const T = .55;
      for (let q = 0; q < 9; q++){ const sx = r.target.x + (Math.random() - .5) * r.bw * .3, sy = r.target.y - r.h * .4; spawn({ k:"coin", z:r.L, x:sx, y:sy, vx:0, vy:0, dst:r, dx:(Math.random() - .5) * r.bw * .3, hop:Math.random() * 10, life:T, max:T, aim:1, r:3.5 + Math.random() * 1.5, ph:Math.random() * 6 }); }
      if (AU.ctx && G.sound) [0, .07, .14].forEach((d, i) => tone([880, 740, 587][i], .14, { type:"square", g:.035, at:d })); }
    for (const [vi, ft] of [[0, .62], [1, .86], [2, 1.08]]) if (r.fired < ft && t >= ft){ r.fired = ft;
      if (r.shot === "arrow"){ const x0 = r.x - r.bw * .3, y0 = y - r.h * .55, T = .5, ty = r.target.y - r.h * .4;
        for (let q = 0; q < 6; q++){ const tx = r.target.x + (Math.random() - .5) * r.bw * .7; spawn({ k:"arrow", z:r.L, x:x0 + (Math.random() - .5) * 14, y:y0, vx:(tx - x0) / T, vy:(ty - y0 - .5 * GRAV() * T * T) / T - Math.random() * 30, life:T, max:T, r:2 }); }
        if (AU.ctx && G.sound) noise(.25, { f:1400, type:"bandpass", g:.18 }); continue; }
      const gx = r.x - r.bw * .36, gy = y - r.h * .33, miss = vi === 0, T = .36, tx = miss ? r.target.x + r.bw * .75 : r.target.x + (Math.random() - .5) * r.bw * .2, ty = miss ? wy(r.L, r.target.x + r.bw * .75) : r.target.y - r.h * .35;
      spawn({ k:"flash", z:r.L, x:gx, y:gy, vx:0, vy:0, life:.14, max:.14, r:r.bw * .22 }); r.rec = 1;
      for (let q = 0; q < 3; q++) spawn({ k:"smoke", light:true, z:r.L, x:gx - Math.random() * 8, y:gy + (Math.random() - .5) * 6, vx:8 + Math.random() * 22, vy:-12 - Math.random() * 16, life:1.2, max:1.2, r:5 + Math.random() * 5 });
      spawn({ k:"ball", z:r.L, miss, x:gx, y:gy, vx:(tx - gx) / T, vy:(ty - gy - .5 * GRAV() * T * T) / T, life:T, max:T, r:3.2 });
      if (AU.ctx && G.sound){ noise(.45, { f:200, g:.9 }); tone(110, .35, { g:.4, f2:40 }); } SC.shake = Math.max(SC.shake, .5); }
    // the raider faces the fleet while it fights, then comes about and runs for it
    const sx = turnFx(turn, -1);
    if (img && img.complete){ cx.save(); cx.translate(r.x, y); cx.rotate(ra + r.rec * .05 + Math.sin(Math.PI * turn) * .09); cx.scale(sx, 1); const rig = rigOf(SPR[r.ship] ? r.ship : "Pirate", "");
      if (rigReady(rig)){ composeRig(rig, 0, calm() ? MO0 : { amp:(1.4 + 3 * r.rec) * rig.stiff, lean:.9, flap:1.4, t:t * 1.2 + 3, ph:2 }, Math.sign(sx)); cx.drawImage(RC, 0, 0, rig.w, RIG_H, -r.bw / 2, -r.h * (.8 + RIG_PAD / 210), r.bw, r.h * RIG_H / 210); }
      else cx.drawImage(img, -r.bw / 2, -r.h * .8, r.bw, r.h);
      cx.restore(); }
  }
  SC.raiders = SC.raiders.filter(r => (r.x < W + 200 || r.t < 1.75) && r.t < 6);
}
// ---------- scenery props, drawn in local units inside a translated, scaled context ----------

// ===== horizon, ships, bow wave, monsters, weather, wrecks, particles, drawScene — src/game.html lines 2242–3183 =====
function drawDest(){ liveDrawHome(); }   // LIVE: the homecoming coast is drawn by the adapter
function drawFar(){
  const yH = H * LAY[1].y + 4;
  // islands, icebergs and rocks ride a fixed line: in heavy seas they settle deeper, so their base stays under the lowest trough
  const A1 = seaA(1);
  for (const f of SC.far){
    f.x -= SC.speed * LAY[1].s * DT * f.k;
    const y = f.type === "sail" ? wy(1, f.x) - 4 : f.type === "spout" || f.type === "pirate" ? wy(1, f.x) + 4 : f.type === "rocks" ? yH : yH + Math.max(0, A1 - 1 - 8 * f.s), rg = R && R.state === "sailing" ? R.reg : null;
    if (rg && ((f.type === "iceberg" && !rg.cold) || (f.type === "pirate" && !rg.pirates) || (SC.p > HOME_P /* LIVE */ && f.type !== "island" && f.type !== "rocks"))) f.fade = Math.max(0, (f.fade == null ? 1 : f.fade) - DT * 1.2);
    // a far pirate rides the swell like a ship (pitching with it, with the same little lag); the rest sit on their line
    let yy = y, fa = 0; if (f.type === "pirate"){ const hl = 14 * f.s; [yy, fa] = rideSea(f, y, clamp(Math.atan((wy(1, f.x + hl) - wy(1, f.x - hl)) / (2 * hl)) * .9, -.6, .6), 1, 36 * f.s); }
    cx.save(); cx.globalAlpha = f.fade == null ? 1 : f.fade; cx.translate(f.x, yy); cx.rotate(fa); cx.scale(f.s, f.s); cx.strokeStyle = INK; cx.lineWidth = 2.5; cx.lineJoin = "round";
    if (f.type === "iceberg"){ cx.fillStyle = "#eef9ff"; cx.beginPath(); cx.moveTo(-44, 8); cx.lineTo(-30, -30); cx.lineTo(-12, -20); cx.lineTo(6, -52); cx.lineTo(22, -26); cx.lineTo(40, 8); cx.closePath(); cx.fill();
      // ink the outline only above the sea, with no flat keel line along the bottom
      cx.beginPath(); cx.moveTo(-44, 8); cx.lineTo(-30, -30); cx.lineTo(-12, -20); cx.lineTo(6, -52); cx.lineTo(22, -26); cx.lineTo(40, 8); cx.stroke();
      cx.fillStyle = "#b9e2f3"; cx.beginPath(); cx.moveTo(6, -52); cx.lineTo(22, -26); cx.lineTo(40, 8); cx.lineTo(14, 8); cx.lineTo(10, -22); cx.closePath(); cx.fill(); cx.fillStyle = "rgba(120,200,235,.5)"; cx.fillRect(-44, 4, 84, 5); }
    else if (f.type === "island"){ const isl = () => { cx.beginPath(); cx.moveTo(-60, 8); cx.quadraticCurveTo(-34, -18, -12, -24); cx.quadraticCurveTo(6, -40, 22, -26); cx.quadraticCurveTo(44, -16, 62, 8); cx.closePath(); };
      isl(); const g = cx.createLinearGradient(0, -40, 0, 8); g.addColorStop(0, "#e9b965"); g.addColorStop(1, "#b07a3c"); cx.fillStyle = g; cx.fill();
      cx.save(); isl(); cx.clip(); cx.fillStyle = "#f8e2a6"; cx.fillRect(-62, 0, 126, 10); cx.fillStyle = "#8a6a4a"; cx.beginPath(); cx.moveTo(-2, -26); cx.lineTo(8, -40); cx.lineTo(20, -24); cx.closePath(); cx.fill(); cx.restore();
      // the coastline is inked open, with no flat line where the island meets the sea
      cx.beginPath(); cx.moveTo(-60, 8); cx.quadraticCurveTo(-34, -18, -12, -24); cx.quadraticCurveTo(6, -40, 22, -26); cx.quadraticCurveTo(44, -16, 62, 8); cx.stroke();
      cx.fillStyle = "#fff3e0"; cx.fillRect(28, -24, 12, 10); cx.strokeRect(28, -24, 12, 10); cx.fillStyle = "#c9793a"; cx.beginPath(); cx.moveTo(25, -24); cx.lineTo(34, -32); cx.lineTo(43, -24); cx.closePath(); cx.fill(); cx.stroke(); }
    else if (f.type === "rocks"){ if (!f.seed) f.seed = 1 + Math.floor(Math.random() * 1e6);
      const rk = rockKind(); drawRocks(4, 7, 84, 34, f.seed, rk === "coral" ? "sand" : rk, 1, null, (A1 + 2) / f.s);
      cx.strokeStyle = "rgba(255,255,255,.85)"; cx.lineWidth = 2; cx.beginPath(); for (let xx = -46; xx <= 54; xx += 4){ const yy = 7 + Math.sin(xx * .3 + SC.t * 4) * 1.5; xx === -46 ? cx.moveTo(xx, yy) : cx.lineTo(xx, yy); } cx.stroke();
      if (rockKind() !== "ice"){ cx.strokeStyle = "rgba(20,25,50,.7)"; cx.lineWidth = 1.6; for (let q = 0; q < 2; q++){ const a = SC.t * .9 + f.seed + q * 2.6, gx = 6 + Math.cos(a) * 22, gy = -40 + Math.sin(a * 1.7) * 6, fl = Math.sin(SC.t * 9 + q) * 2;
        cx.beginPath(); cx.moveTo(gx - 5, gy - fl); cx.quadraticCurveTo(gx - 2, gy - 2, gx, gy); cx.quadraticCurveTo(gx + 2, gy - 2, gx + 5, gy - fl); cx.stroke(); } } }
    else if (f.type === "pirate"){ const img = SPR[f.ship] || SPR.Pirate; if (img && img.complete){ cx.scale(-1, 1);
      // she faces the fleet, so the following wind blows from her bow: her flag flies aft (the layered rig, mirrored back)
      const rig = rigOf(SPR[f.ship] ? f.ship : "Pirate", "");
      if (rigReady(rig)){ composeRig(rig, 0, MO0, -1); cx.drawImage(RC, 0, 0, rig.w, RIG_H, -26, -30 - 36 * RIG_PAD / 210, 52, 36 * RIG_H / 210); } else cx.drawImage(img, -26, -30, 52, 36); } }
    else if (f.type === "sail"){ cx.fillStyle = "rgba(20,30,70,.5)"; cx.beginPath(); cx.moveTo(-14, 2); cx.lineTo(14, 2); cx.lineTo(10, 8); cx.lineTo(-10, 8); cx.closePath(); cx.fill(); cx.beginPath(); cx.moveTo(0, 2); cx.lineTo(0, -24); cx.lineTo(12, -6); cx.closePath(); cx.fill(); }
    else if (f.type === "spout"){ const a = Math.max(0, Math.sin(SC.t * 1.6 + f.ph)); cx.fillStyle = "rgba(30,50,90,.7)"; cx.beginPath(); cx.ellipse(0, 4, 26, 6, 0, Math.PI, 0); cx.fill(); cx.fillStyle = `rgba(255,255,255,${a * .85})`; for (let k = 0; k < 5; k++){ cx.beginPath(); cx.arc((k - 2) * 5, -6 - a * 20 - Math.abs(k - 2) * 2, 3, 0, 7); cx.fill(); } }
    cx.restore();
  }
  SC.far = SC.far.filter(f => f.x > -140 && f.fade !== 0);
}

const sinkDur = s => s.cause === "pirates" ? 2.3 : s.cause === "kraken" ? 2.05 : s.cause === "wave" ? 1.6 : 1.9;
// how a sinking ship loses way: [seconds into the sinking she stops sailing, seconds her way on takes to die]
const WRECK_WAY = { lightning:[0, 1.5], pirates:[.3, 1.3], wave:[0, .5], kraken:[0, 0], whale:[0, 0], iceberg:[.4, 0] };
// running off (a ship cashed out for home, a raider making off with her plunder): she gathers way and settles at a top speed instead of
// speeding up for ever; runOff(t, v) = how far she has run t seconds after she starts, v = top speed, RUN_TAU = how long she takes to gather way
const RUN_TAU = .45, runOff = (t, v) => t > 0 ? v * (t - RUN_TAU * (1 - Math.exp(-t / RUN_TAU))) : 0, runTop = () => Math.max(W * 1.15, 440);
// how a ship comes about: .55 s, carrying her way on through the turn (she swings out ahead a little and back) and heeling into it; her
// hull is never drawn flat edge-on, it narrows to about her beam bow-on and widens again facing the other way
const TURN_T = .55, turnFx = (k, f0) => { const c = Math.cos(Math.PI * k); return f0 * Math.sign(c || -1) * (.3 + .7 * Math.abs(c)); };
// a little inertia for anything afloat (ships, raiders, far pirates): a hull takes a moment to follow the sea, heave a touch quicker than
// pitch, a big one (z = the square root of her size) slower than a small one. o keeps what it has (wY, wA), eased once a frame (the stamp
// wT) and started afresh when it first appears or after a gap (a new voyage, a clock jump); y, a: where the water would put it right now
function rideSea(o, y, a, z, h){
  if (o.wT !== SC.t){ const fresh = o.wY == null || !(SC.t - o.wT < .3) || SC.t < o.wT;
    o.wY = fresh ? y : lerp(o.wY, y, follow(13 / z, DT)); o.wA = fresh ? a : lerp(o.wA, a, follow(8 / z, DT)); o.wT = SC.t;
    // never far behind the sea, though: in a storm the lag is held to a few pixels and degrees so she never floats clear or buries a quarter
    o.wY = y + clamp(o.wY - y, -h * .045, h * .045); o.wA = a + clamp(o.wA - a, -.07, .07); }
  return [o.wY, o.wA];
}
function shipPose(s){
  const L = s.row ? 3 : 2, sc = s.row ? 1 : .74, bw = shipW() * sc * (s.sz || 1), h = bw * .7;
  if (s.state === "sail" || s.state === "dock"){ s.x = s.hx + Math.sin(SC.t * .5 + s.ph) * 6 * Math.min(1, shipW() / 122); s.sc0 = null; }   // (a sprite used again next voyage forgets where her last wreck lay)
  const hit = s.hitT > 0 ? Math.sin(s.hitT * 40) * .12 * s.hitT : 0;
  // the hull bridges short waves: its height and tilt come from the water along its length, not one point under the keel
  // a ship a rogue wave is taking only half rides its face: the giant crest buries her (the water in front of her row is drawn over her)
  const hl = bw * .32, swamp = s.state === "sink" && s.cause === "wave" && SC.rogues.length ? .62 : 0, wv = swamp ? xa => wy(L, xa) - swamp * rogueAt(L, xa) : xa => wy(L, xa);
  const seat = xa => [(wv(xa - hl * .6) + 2 * wv(xa) + wv(xa + hl * .6)) / 4, (wv(xa + hl) - wv(xa - hl)) / (2 * hl)], [y, dy] = seat(s.x), tilt = d => clamp(Math.atan(d) * .9, -.6, .6);
  let ang = Math.sin(SC.t * 1.3 + s.ph) * .03 * (1 + 2 * SC.storm), oy = 0, ox = 0, sq = 1, yW = y, aW = tilt(dy);   // yW/aW: what the water does to her
  if (s.state === "sink"){
    // a short, punchy sinking: the hit, a hard list, then under in about 1.6 seconds
    // (a rogue wave's victim waits, st below zero, until the giant crest reaches her; then it is quicker, she's already buried)
    const t = s.st, dir = s.ph > 3 ? 1 : -1, delay = s.cause === "pirates" ? .95 : s.cause === "kraken" ? .62 : s.cause === "iceberg" ? .45 : s.cause === "reef" ? .5 : s.cause === "wave" ? .15 : s.cause === "whale" ? .6 : .35, k = ease(clamp((t - delay) / (s.cause === "wave" ? 1.1 : 1.25), 0, 1));
    if (s.cause === "iceberg" && t > .38 && t < .7) ang += Math.sin(t * 46) * .09;
    if (s.cause === "pirates" && t > .8) ang += Math.sin(t * 30) * .03;
    // the giant breaks over her bow: thrown bow-up, carried astern and rolled over backwards, keel to the sky
    if (s.cause === "wave"){ const tw = Math.max(0, t), up = ease(clamp(tw / .3, 0, 1)), rd = -Math.sign(s.flip || 1) * (1.95 + (s.ph % 1) * .45);
      ang += rd * (.32 * up + .68 * ease(clamp((tw - .18) / .95, 0, 1))); oy -= up * (1 - k) * h * .14; ox -= ease(clamp(tw / 1.1, 0, 1)) * bw * .45; }
    // the whale throws her up on a true arc (its punch sends her up fast, she hangs at the top, then falls and lands hard at .64 s);
    // falling she stretches a little taller, landing she squashes flat and wobbles back (her volume kept: as wide as she is short)
    else if (s.cause === "whale"){ const u = t / .64; if (t < .64){ oy -= 4 * u * (1 - u) * h * 1.2; if (!calm()) sq = 1 - .1 * clamp(2 * u - 1, 0, 1); }
      else { const d = t - .64; oy += h * .12 * Math.sin(clamp(d / .3, 0, 1) * Math.PI); if (!calm()) sq = 1 + .22 * Math.exp(-d * 9) * Math.cos(d * 22); }   // she plunges in and bobs up
      ang += dir * Math.min(1.3, t * 2.4); }
    else if (s.cause === "kraken"){ const grip = clamp((t - .3) * 3, 0, 1); ang += Math.sin(t * 17) * .045 * grip; sq = 1 - (.05 + .035 * Math.sin(t * 13)) * grip * (1 - k); if (t < .34) oy -= Math.sin(t / .34 * Math.PI) * h * .09; }
    else if (s.cause === "reef"){ const lift = ease(clamp((t - .06) / .3, 0, 1)); ang -= Math.sign(s.flip || 1) * .22 * lift; oy -= h * .1 * lift * (1 - k); if (t < .45) ang += Math.sin(t * 50) * .06 * (1 - t / .45); }
    ang += s.cause === "kraken" ? dir * (.03 + k * .28) : s.cause === "reef" ? -Math.sign(s.flip || 1) * k * .5 : s.cause === "wave" ? 0 : dir * (.1 + k * .8);
    oy += k * h * 1.75;
  }
  let fx = s.flip * sq;
  // leaving harbour: each ship in turn surges off its berth and pitches into the swell
  if (R && R.t0 != null && (s.state === "sail" || s.state === "sink")){ const dk = clamp((SC.t - R.t0 - s.i * .22) / 2.4, 0, 1); if (dk > 0 && dk < 1){ ox += Math.sin(dk * Math.PI) * W * .035; ang += Math.sin(dk * Math.PI * 2) * .05; } }
  // cashed out: she comes about for home (turnFx, carrying her way through the turn and heeling into it), then gathers way to a top speed
  if (s.state === "leave"){ const k = ease(clamp(s.st / TURN_T, 0, 1)); fx = turnFx(k, s.flip); ox = Math.sin(Math.PI * k) * bw * .22 - runOff(s.st - TURN_T * .8, runTop()); ang -= Math.sin(Math.PI * k) * .09 + .04 * k; }
  // arriving: the ship glides in to its anchorage (the leading ships run further in, so the fleet fans out), dips its bow as it loses way, then rides at anchor
  if (s.state === "arrive"){ const k = clamp(s.st / 3, 0, 1), rank = SC.ships.filter(o => o.row === s.row && o.hx < s.hx).length, run = Math.min(W * (.13 + .05 * rank), Math.max(0, W - 10 - bw * .6 - s.x)); ox = ease(k) * run;
    s.gl = (1 - ease(k)) * run;   // how much further she will glide (her anchor is let go far enough ahead that she brings up short of it)
    ang += Math.sin(k * Math.PI) * .035 + (s.anch ? Math.sin(SC.t * 1.1 + s.ph) * .015 : 0); }
  // a wreck loses way: from the moment she is struck (WRECK_WAY[0] s into the sinking) the sea she lies in carries her astern, like her own
  // wreckage; a ship that still has way on keeps a little of it for a moment (WRECK_WAY[1] s), one held by a berg, an arm or a whale stops at once
  if (s.state === "sink" && s.cause !== "reef"){ const wk = WRECK_WAY[s.cause] || WRECK_WAY.lightning;
    if (s.sc0 == null && s.st >= wk[0]){ s.sc0 = SC.scroll; s.v0 = SC.speed; }
    if (s.sc0 != null){ const tau = wk[1], left = tau ? s.v0 * tau * (1 - Math.exp(-Math.max(0, s.st - wk[0]) / tau)) : 0; ox -= Math.max(0, SC.scroll - s.sc0 - left) * LAY[L].s; } }
  // a ship drawn away from its own spot (racing off, gliding in, surging off the berth, falling astern as a wreck) sits on and tilts with the water where it is drawn
  if (ox){ const [y2, dy2] = seat(s.x + ox); yW = y2; aW = tilt(dy2); }
  // a little inertia: a hull takes a moment to follow the sea (rideSea), a big ship slower than a small one
  [yW, aW] = rideSea(s, yW, aW, Math.sqrt(s.sz || 1), h); ang += aW;
  // aground: once she rides up onto a reef the rocks hold her, so she stops riding the swell (the rocks stand still too) and settles with them
  if (s.state === "sink" && s.cause === "reef"){ const g = ease(clamp((s.st - .05) / .3, 0, 1)); oy += (H * LAY[L].y - yW) * g; ang -= aW * g; if (s.sc0 != null) ox -= (SC.scroll - s.sc0) * LAY[L].s; }   // and she goes astern with them
  return { L, bw, h, x:s.x + ox, y:yW + oy, ang:ang + hit, fx, sy:1 / sq };   // sy: squeezed narrower (the kraken's grip) she stands taller, and the other way round
}
// a weathered copy of each ship: salt grime, sun-faded cloth, patched sails and weed at the waterline
const AGED = {};
function agedOf(design, src, yo = 0, seedKey = design){
  if (AGED[design] !== undefined) return AGED[design]; const img = src || SPR[design], isC = img && img.tagName === "CANVAS"; if (!img || (!isC && (!img.complete || !img.naturalWidth))) return null;
  const cw = isC ? img.width : 300, ch = isC ? img.height : 210;
  const c = document.createElement("canvas"); c.width = cw; c.height = ch; const g = c.getContext("2d"); g.drawImage(img, 0, 0, cw, ch);
  let data = null; try { data = g.getImageData(0, 0, cw, ch).data; } catch (e) { data = null; }
  const rnd = mulberry32(seedKey.length * 977 + seedKey.charCodeAt(0) * 31 + seedKey.charCodeAt(seedKey.length - 1));
  g.globalCompositeOperation = "source-atop";
  g.fillStyle = "rgba(96,74,40,.2)"; g.fillRect(0, 0, cw, ch);
  for (let i = 0; i < 320; i++){ g.fillStyle = rnd() < .55 ? "rgba(58,42,22,.22)" : "rgba(255,255,236,.16)"; g.beginPath(); g.arc(rnd() * cw, yo + rnd() * 210, .7 + rnd() * 1.8, 0, 7); g.fill(); }
  if (data){ const lum = (x, y) => { const i = ((y | 0) * cw + (x | 0)) * 4; return data[i + 3] > 200 ? data[i] * .3 + data[i + 1] * .59 + data[i + 2] * .11 : 0; };
    let placed = 0; for (let t = 0; t < 600 && placed < 4; t++){ const x = 20 + rnd() * (cw - 40), y = yo + 8 + rnd() * 120;
      if (lum(x, y) > 205 && lum(x - 10, y - 8) > 195 && lum(x + 10, y + 8) > 195 && lum(x + 10, y - 8) > 195 && lum(x - 10, y + 8) > 195){
        g.save(); g.translate(x, y); g.rotate((rnd() - .5) * .5); g.fillStyle = rnd() < .5 ? "#dccaa2" : "#cdb88e"; g.fillRect(-8, -6, 16, 12);
        g.strokeStyle = "rgba(96,64,30,.85)"; g.lineWidth = 1.4; g.setLineDash([2.5, 2]); g.strokeRect(-8, -6, 16, 12); g.restore(); placed++; } } }
  g.fillStyle = "rgba(62,96,52,.5)"; for (let i = 0; i < 46; i++){ g.beginPath(); g.arc(12 + rnd() * (cw - 24), yo + 152 + rnd() * 16, 1.4 + rnd() * 2.2, 0, 7); g.fill(); }
  return (AGED[design] = c);
}
// St. Elmo's fire: in a gale or a great storm a blue flame plays at each ship's masthead (Pigafetta saw it on Magellan's ships; Columbus's men saw it too)
function mastTop(rig){
  if (rig.top !== undefined) return rig.top; rig.top = null;
  // a ship that flies its flag from a masthead: the top of that mast (not a stern ensign, like the Bark's)
  if (rig.fb && rig.fb.y0 <= 32) return (rig.top = [rig.fb.hx, rig.fb.y0]);
  // otherwise the highest point of the whole ship (the tip of the tallest mast): the first solid run of pixels on the highest row
  try { const g = rcx1; g.globalAlpha = 1; g.clearRect(0, 0, 342, RIG_H); for (const l of ["back", "cloth", "front"]) if (rig.cv[l]) g.drawImage(rig.cv[l], 0, 0);
    const d = g.getImageData(0, 0, rig.w, RIG_H).data, op = (x, y) => d[(y * rig.w + x) * 4 + 3] > 140;
    for (let y = 0; y < RIG_H && !rig.top; y++) for (let x = 0; x < rig.w; x++) if (op(x, y)){ let b = x; while (b + 1 < rig.w && op(b + 1, y)) b++; rig.top = [(x + b) / 2, y]; break; } } catch (e) {}
  return rig.top;
}
function stElmo(s, rig, P, wide){
  if (!R || !R.inStorm || R.inStorm.kind.dark < .7 || s.state !== "sail" || SC.storm < .3) return;
  const tp = mastTop(rig); if (!tp) return;
  const x = -P.bw * wide / 2 + tp[0] * P.bw * wide / rig.w, y = -P.h * (.8 + RIG_PAD / 210) + (tp[1] + 2) * P.h / 210, f = P.bw * .05, a = clamp((SC.storm - .3) / .3, 0, 1) * s.alpha;
  const fl = calm() ? 1 : .78 + .22 * Math.sin(SC.t * 23 + s.ph * 5) * Math.sin(SC.t * 9.1 + s.ph), sway = calm() ? 0 : Math.sin(SC.t * 13 + s.ph) * f * .2;
  const g = cx.createRadialGradient(x, y, 0, x, y, f * 3.4); g.addColorStop(0, `rgba(190,220,255,${.7 * a * fl})`); g.addColorStop(1, "rgba(120,150,255,0)");
  cx.fillStyle = g; cx.beginPath(); cx.arc(x, y, f * 3.4, 0, 7); cx.fill();
  cx.fillStyle = `rgba(185,212,255,${.9 * a})`; cx.beginPath(); cx.moveTo(x - f * .55, y); cx.quadraticCurveTo(x - f * .5, y - f * 1.2 * fl, x + sway, y - f * 2.1 * fl); cx.quadraticCurveTo(x + f * .5, y - f * 1.2 * fl, x + f * .55, y); cx.closePath(); cx.fill();
  cx.fillStyle = `rgba(255,255,255,${.9 * a})`; cx.beginPath(); cx.arc(x, y - f * .35, f * .3, 0, 7); cx.fill();
}
function drawShip(s){
  if (s.state === "gone") return;
  const P = shipPose(s), vr = s.kind === "freight" ? SPRF[s.design] : null, img = vr && vr.complete ? vr : SPR[s.design]; if (!img || !img.complete) return;
  const wide = img === SPRF[s.design] ? 1.14 : 1;
  const br = s.state === "sail" || s.state === "dock" ? Math.sin(SC.t * 2.1 + s.ph) * .012 : 0;
  cx.save(); cx.globalAlpha = s.alpha; cx.translate(P.x, P.y); cx.rotate(P.ang); cx.scale((Math.abs(P.fx) < .08 ? .08 * Math.sign(P.fx || 1) : P.fx) * (1 + br), (1 - br * .6) * (P.sy || 1));
  if (s.state === "leave"){ cx.shadowColor = "#ffd36b"; cx.shadowBlur = 18 + 8 * Math.sin(SC.t * 10); }
  if (s.state === "sink" && s.cause === "lightning" && s.st < .7){ cx.shadowColor = "#ff8a3c"; cx.shadowBlur = 22 * (1 - s.st); }
  const wear = R && R.state !== "count" ? clamp((SC.p - .06) / .75, 0, 1) * .85 : 0, rig = rigOf(s.design, wide > 1 ? "F" : "");
  if (rigReady(rig)){ composeRig(rig, wear, sailMotion(s, rig), Math.sign(P.fx || 1)); cx.drawImage(RC, 0, 0, rig.w, RIG_H, -P.bw * wide / 2, -P.h * (.8 + RIG_PAD / 210), P.bw * wide, P.h * RIG_H / 210); stElmo(s, rig, P, wide); }
  else { cx.drawImage(img, -P.bw * wide / 2, -P.h * .8, P.bw * wide, P.h);
    if (wear > .02){ const ag = agedOf((wide > 1 ? "F" : "") + s.design, img); if (ag){ cx.globalAlpha = s.alpha * wear; cx.drawImage(ag, -P.bw * wide / 2, -P.h * .8, P.bw * wide, P.h); } } }
  cx.restore();
  // the anchor cable runs from the hawse at the bow (which pitches with the hull) to where the anchor went in, which stays put in the
  // water while she rides to it. The anchor falls with the cable running out taut behind it; then the cable hangs slack in a curve
  // that tightens when she drifts off or lifts on a swell (more cable runs out rather than it stretching)
  if ((s.state === "arrive" || s.state === "dock") && s.anch){   /* LIVE: she also rides at anchor while boarding */ const k = clamp((SC.t - s.anch) / .35, 0, 1), wd = wide, sg = Math.sign(P.fx || 1), lx = P.bw * wd * .42 * sg, ly = -P.h * .14, ca = Math.cos(P.ang), sa = Math.sin(P.ang), hx = P.x + lx * ca - ly * sa, hy = P.y + lx * sa + ly * ca;
    if (s.anT !== s.anch){ s.anT = s.anch; s.anX = hx + (P.bw * .12 + (s.gl || 0)) * sg; s.anL = 0; }   // where the anchor goes in (once per anchoring), ahead of where she will lie
    const ex = s.anX, ey = wy(P.L, ex) + 3;
    cx.strokeStyle = "rgba(10,15,40,.85)"; cx.lineWidth = 2; cx.setLineDash([3, 2]); cx.beginPath(); cx.moveTo(hx, hy);
    if (k < 1) cx.lineTo(lerp(hx, ex, k), lerp(hy, ey, k * k));   // the anchor falls ahead of her bow, gathering speed
    else { const d = Math.hypot(ex - hx, ey - hy); s.anL = Math.max(s.anL || d * 1.1, d);
      // a hanging cable's sag for its length and span (a shallow catenary), never dipping below the water where it goes in
      const sag = Math.sqrt(3 * d * (s.anL - d) / 8); cx.quadraticCurveTo((hx + ex) / 2, Math.min((hy + ey) / 2 + 2 * sag, Math.max(hy, ey)), ex, ey); }
    cx.stroke(); cx.setLineDash([]); }
  if (s.hitT > 0){ s.hitT -= DT; }
  // bow spray and wake while sailing
  if (((s.state === "leave" && s.st < 1.6) || (s.state === "arrive" && s.st < 2.8)) && !calm()) for (let n = nPer(.45); n > 0; n--){ const sx2 = P.x - Math.sign(P.fx || 1) * P.bw * .42; spawn({ k:"foam", z:P.L, x:sx2 + (Math.random() - .5) * 8, y:wy(P.L, sx2) + 1, vx:0, vy:0, life:1.1, max:1.1, r:3 + Math.random() * 3, L:P.L }); }
  if (s.state === "leave") for (let n = nPer(.7); n > 0; n--) spawn({ k:"spark", z:P.L, x:P.x + P.bw * .45 + (Math.random() - .5) * 10, y:P.y - P.h * (.1 + Math.random() * .5), vx:60 + Math.random() * 40, vy:-20 - Math.random() * 30, life:.8, max:.8, r:1.6 + Math.random() * 2 });
}
// convoy counts and number badges sit on top of the whole scene so waves and other ships never hide them
// the prize: a treasure chest bobs up ahead of the fleet, opens in a burst of gold, and sinks back once its gold is aboard
// she floats low in the water (the wave line covers her bottom), tilts with the wave she rides and splashes as she breaks the surface and goes back under
function drawPrizeFx(){
  const f = SC.prizeFx; if (!f) return; const t = SC.t - f.t0; if (t > 4.2){ SC.prizeFx = null; return; }
  const sc = clamp(W / 900, .6, 1.1), x = W * .8, wl = wy(3, x), slope = clamp(Math.atan2(wy(3, x + 24 * sc) - wy(3, x - 24 * sc), 48 * sc), -.6, .6), rise = ease(clamp(t / .6, 0, 1)) * (1 - ease(clamp((t - 3.4) / .8, 0, 1)));
  // fully under means below the lowest trough across her width too, so a steep storm sea never leaves her lid showing as she appears or vanishes
  const lo = Math.max(wy(3, x - 30 * sc), wl, wy(3, x + 30 * sc)), y = wl + 4 * sc + (1 - rise) * (lo - wl + 56 * sc), open = clamp((t - .7) / .35, 0, 1) * (1 - clamp((t - 3.25) / .3, 0, 1));   // lid shuts before she sinks
  cx.save();
  const gl = cx.createRadialGradient(x, y - 14 * sc, 2, x, y - 14 * sc, 90 * sc); gl.addColorStop(0, `rgba(255,214,100,${.55 * rise})`); gl.addColorStop(1, "rgba(255,214,100,0)");
  cx.fillStyle = gl; cx.fillRect(x - 100 * sc, y - 110 * sc, 200 * sc, 200 * sc);
  cx.translate(x, y); cx.scale(sc, sc); cx.rotate(slope * .7 + (calm() ? 0 : Math.sin(SC.t * 2.2) * .04)); cx.lineJoin = "round";
  cx.strokeStyle = INK; cx.lineWidth = 3;
  cx.fillStyle = "#8a4b26"; cx.fillRect(-26, -26, 52, 30); cx.strokeRect(-26, -26, 52, 30);
  cx.fillStyle = "#ffc93c"; cx.fillRect(-26, -16, 52, 6); cx.strokeRect(-26, -16, 52, 6); cx.fillRect(-5, -22, 10, 12); cx.strokeRect(-5, -22, 10, 12);
  if (open > 0){ cx.fillStyle = "#ffe07a"; cx.beginPath(); cx.ellipse(0, -26, 22, 7 * open, 0, Math.PI, 0); cx.fill(); cx.stroke(); }
  cx.save(); cx.translate(-26, -26); cx.rotate(-open * 1.9); cx.fillStyle = "#9c5a2e"; cx.beginPath(); cx.moveTo(0, 0); cx.lineTo(52, 0); cx.quadraticCurveTo(52, -14, 26, -16); cx.quadraticCurveTo(0, -14, 0, 0); cx.closePath(); cx.fill(); cx.stroke();
  cx.fillStyle = "#ffc93c"; cx.fillRect(22, -15, 8, 15); cx.strokeRect(22, -15, 8, 15); cx.restore();
  cx.restore();
  if (open > 0 && t < 1.2) for (let n = nPer(.8); n > 0; n--) for (let k = 0; k < 2; k++){ const a = -Math.PI * (.2 + .6 * Math.random()); spawn({ k:"coin", z:3, x, y:y - 26 * sc, vx:Math.cos(a) * (60 + Math.random() * 120), vy:Math.sin(a) * (160 + Math.random() * 120), life:1, max:1, r:3.5 + Math.random() * 2, ph:Math.random() * 6 }); }
  if (t > .5 && t < 3.6) ribbon(x, wl + 6 - 30 * sc * rise - 70 * sc, f.name, sc);
  // one splash as she breaks the surface, a smaller one as she goes back under
  if (!f.sp1 && t > .2){ f.sp1 = 1; spawn({ k:"ring", z:3, x, y:wl + 2, vx:0, vy:0, life:1, max:1, r:8 * sc, L:3 }); for (let q = 0; q < 6; q++) spawn({ k:"spray", z:3, x:x + (Math.random() - .5) * 40 * sc, y:wl, vx:(Math.random() - .5) * 60, vy:-70 - Math.random() * 60, life:.6, max:.6, r:1.4 + Math.random() * 1.4 }); }
  if (!f.sp2 && t > 3.5){ f.sp2 = 1; spawn({ k:"ring", z:3, x, y:wl + 2, vx:0, vy:0, life:1, max:1, r:8 * sc, L:3 }); for (let q = 0; q < 4; q++) spawn({ k:"spray", z:3, x:x + (Math.random() - .5) * 40 * sc, y:wl, vx:(Math.random() - .5) * 60, vy:-70 - Math.random() * 60, life:.6, max:.6, r:1.4 + Math.random() * 1.4 }); }
}
// the bow wave: a crest of foam thrown up at the stem, curling over and falling away aft until it melts into the sea, a few drops flung
// ahead of it, foam sliding back along the waterline and a wake streaming astern. It grows with the fleet's speed, swells each time the
// bow digs in, and fades when the ships slow (in harbour, at anchor)
// waves used to be steeper on a phone (shorter and relatively taller), so the bow's wave-face tests are scaled back to how the sea looks on a
// 1280x760 desktop (canvas 880x664 there): the lip, the dig and the slam spray then come on the bigger seas only, not on every wave
const NK_REF = 664 / 880;
function bowWave(s){
  // her shadow in the water: a soft darker patch just under the waterline, so she sits in the sea rather than on it
  // It falls away from the light: the sun (or, at night, the moon at .4 strength) is in the sky beyond the fleet, so the patch slips a little
  // toward the viewer and away from the light's side, more and longer the lower the sun (the moon counts as half-way down); under the moon
  // it is lighter (about .67), and with neither (a storm hides the sun) it is faintest (.45) and sits straight under her
  if (s.state === "sail" || s.state === "dock" || s.state === "leave" || s.state === "arrive"){ const Q = shipPose(s);
    if (Math.abs(Q.fx) >= .5){ const sun = SC.sunA || 0, moon = (SC.moonA || 0) * .4, lt = Math.max(sun, moon), lx = sun >= moon ? SC.sunX : SC.moonX,
        low = sun >= moon ? 1 - sunElev() / 55 : .5, side = lx == null ? 0 : clamp((Q.x - lx) / (W * .5), -1, 1) * lt;
      const rx = Q.bw * (s.kind === "freight" ? 1.14 : 1) * .46 * (1 + .25 * low * Math.abs(side)), yy = wy(Q.L, Q.x) + 3 + 1.5 * lt * (.4 + low);
      cx.save(); cx.globalAlpha = s.alpha * (.45 + .55 * lt); cx.translate(Q.x + side * Q.bw * (.08 + .14 * low), yy); cx.scale(1, .13); const sg = cx.createRadialGradient(0, 0, rx * .2, 0, 0, rx);
      sg.addColorStop(0, "rgba(6,16,44,.3)"); sg.addColorStop(1, "rgba(6,16,44,0)"); cx.fillStyle = sg; cx.beginPath(); cx.arc(0, 0, rx, 0, 7); cx.fill(); cx.restore(); } }
  if (s.state !== "sail" && s.state !== "leave" && s.state !== "arrive") return;
  const k = clamp(SC.speed / 80, 0, 1.4) * (s.state === "arrive" ? clamp(1 - s.st / 2.5, 0, 1) : 1); if (k < .06) return;
  const P = shipPose(s); if (Math.abs(P.fx) < .5) return;
  // (the swell's height now follows the width measure too, so a phone sea is as steep as the desktop one and this is 1 there;
  // it only eases the tests on a screen wider than the desktop, where the sea is gentler)
  const nk = clamp(NK_REF * Math.max(W, 420) / Math.min(H, NK_REF * Math.max(W, 420)), .4, 1.2);
  const d = Math.sign(P.fx), wide = s.kind === "freight" ? 1.14 : 1, k1 = Math.min(1, k), dig = clamp(P.ang * d * 5 * nk, -.5, 1), still = calm();
  const bx = P.x + d * P.bw * wide * .435 * Math.cos(P.ang), by = wy(P.L, bx) + 1, pulse = still ? .5 : .5 + .5 * Math.sin(SC.t * 6.3 + s.ph);
  // never twice the same: the crest swells and slackens on two slow, unrelated rhythms of its own, rears up when the bow meets the face of
  // a wave, and now and then a sea bursts over the stem
  const n1 = still ? .5 : .5 + .5 * Math.sin(SC.t * .83 + s.ph * 3.1) * Math.sin(SC.t * .29 + s.ph), n2 = still ? .5 : .5 + .5 * Math.sin(SC.t * .57 + s.ph * 1.7) * Math.cos(SC.t * .21 + s.ph * 2.3);
  const face = still ? 0 : clamp((wy(P.L, bx - d * 14) - wy(P.L, bx + d * 14)) / 10 * nk, -.4, 1);
  s.surge = Math.max(0, (s.surge || 0) - DT * 1.5);
  if (!still && s.state === "sail"){
    if (SC.speed > 30 && Math.random() < .2 * DT){ s.surge = 1; for (let q = 0; q < 5; q++) spawn({ k:"spray", z:P.L, x:bx + d * Math.random() * 5, y:by - P.h * .06, vx:d * (20 + Math.random() * 70), vy:-60 - Math.random() * 90, life:.65, max:.65, r:1.2 + Math.random() * 1.6 }); } }
  const sg = still ? 0 : s.surge || 0;
  const h = P.h * (.072 + .05 * k1) * (1 + .35 * dig) * (.72 + .5 * n1 + .35 * face + .55 * sg), len = P.bw * (.2 + .13 * k1) * (.82 + .36 * n2 + .15 * sg), al = Math.min(1, k * 1.4) * s.alpha;
  cx.save(); cx.lineCap = "round"; cx.lineJoin = "round"; cx.globalAlpha = al;
  // foam sliding aft along the waterline
  // (it moves with the water streaming past her: the sea's speed, plus her own when she runs for home or glides in to anchor)
  const span = P.bw * wide * .7; if (DT > 0){ const vx = s.fX == null ? 0 : (P.x - s.fX) / DT; s.fP = ((s.fP || 0) + clamp(d * (SC.speed * LAY[P.L].s + vx), 8, 1500) * DT / span) % 1; } s.fX = P.x;
  if (!still) for (let j = 0; j < 5; j++){ const ph = (s.fP + j / 5 + s.ph * .3) % 1, fx = bx - d * (len * .35 + ph * span), fy = wy(P.L, fx) + 2.5;
    cx.fillStyle = `rgba(255,255,255,${.6 * (1 - ph)})`; cx.beginPath(); cx.ellipse(fx, fy, 2.5 + 5 * ph, 1.3, 0, 0, 7); cx.fill(); }
  // the swell the bow pushes up: a pale mound of water under and ahead of the foam
  cx.fillStyle = "rgba(170,222,250,.5)"; cx.beginPath(); cx.moveTo(bx + d * len * .3, by + 2); cx.quadraticCurveTo(bx + d * len * .22, by - h * .7, bx - d * len * .02, by - h * .78);
  cx.quadraticCurveTo(bx - d * len * .6, by - h * .5, bx - d * len * 1.25, by + 2); cx.closePath(); cx.fill();
  // the crest: steep and rounded at the stem, a long soft slope aft that fades out instead of ending in a point
  const g = cx.createLinearGradient(bx + d * len * .12, 0, bx - d * len, 0); g.addColorStop(0, "rgba(255,255,255,.97)"); g.addColorStop(.45, "rgba(255,255,255,.9)"); g.addColorStop(1, "rgba(255,255,255,0)");
  cx.fillStyle = g; cx.beginPath(); cx.moveTo(bx + d * len * .13, by + 1.5);
  cx.quadraticCurveTo(bx + d * len * .17, by - h * .75, bx + d * len * .02, by - h * (1 + .14 * pulse));
  cx.quadraticCurveTo(bx - d * len * .15, by - h * 1.02, bx - d * len * .4, by - h * .36);
  cx.quadraticCurveTo(bx - d * len * .7, by - h * .1, bx - d * len, by + .5);
  cx.quadraticCurveTo(bx - d * len * .4, by + h * .24, bx + d * len * .13, by + 1.5); cx.closePath(); cx.fill();
  // a pale blue shadow under the lip gives the crest its roll
  cx.strokeStyle = "rgba(140,200,240,.75)"; cx.lineWidth = 1.3; cx.beginPath(); cx.moveTo(bx + d * len * .05, by - h * .5); cx.quadraticCurveTo(bx - d * len * .14, by - h * .55, bx - d * len * .46, by - h * .1); cx.stroke();
  // foam tumbling down the back of the crest: each lump is born at the lip, rolls aft and melts
  if (!still) for (let j = 0; j < 3; j++){ const ph = (SC.t * 1.35 + j / 3 + s.ph * .7) % 1; cx.fillStyle = `rgba(255,255,255,${.95 * Math.pow(1 - ph, .8)})`;
    cx.beginPath(); cx.arc(bx - d * len * (.04 + .66 * ph), by - h * (.92 - .8 * ph), h * (.1 + .2 * (1 - ph)), 0, 7); cx.fill(); }
  // no fixed hook at the stem any more (the user found it constant): a lip of water curls over only when a sea bursts on the bow or she
  // meets the face of a wave, and it grows, curls further and fades with that moment
  const curl = still ? 0 : Math.max(sg, clamp((face - .4) * 1.7, 0, 1));
  if (curl > .1){ const s0 = d > 0 ? Math.PI * .85 : Math.PI * .15, sw = Math.PI * (.45 + .75 * curl);
    cx.strokeStyle = `rgba(255,255,255,${Math.min(.95, curl * 1.4)})`; cx.lineWidth = 1.7; cx.beginPath(); cx.arc(bx + d * len * .19, by - h * .6, h * (.16 + .16 * curl), s0, d > 0 ? s0 + sw : s0 - sw, d < 0); cx.stroke(); }
  // drops flung ahead of the crest
  if (!still) for (let j = 0; j < 3; j++){ const ph = (SC.t * 1.6 + j / 3 + s.ph) % 1, dxp = bx + d * len * (.06 + .42 * ph), dyp = by - h * (.9 + 1.5 * ph - 2.6 * ph * ph);
    cx.fillStyle = `rgba(255,255,255,${.9 * (1 - ph)})`; cx.beginPath(); cx.arc(dxp, dyp, (.6 + 1.3 * (1 - ph)) * (.7 + .5 * k1), 0, 7); cx.fill(); }
  // the wake: white water boiling up under her counter, then foam lying on the sea. Each patch of foam belongs to one spot of water, so it
  // drifts astern at the sea's own speed and keeps its shape while it spreads, thins and breaks up; it rides the swell (no straight lines)
  const sx = P.x - d * P.bw * wide * .45, wl = P.bw * (.75 + .7 * k1), off = SC.scroll * LAY[P.L].s, gap = 5;
  const pg = cx.createLinearGradient(sx, 0, sx - d * wl, 0); pg.addColorStop(0, "rgba(205,242,255,.55)"); pg.addColorStop(1, "rgba(205,242,255,0)");
  cx.fillStyle = pg; cx.beginPath();
  for (let i = 0; i <= 12; i++){ const u = i / 12, x = sx - d * u * wl; cx.lineTo(x, wy(P.L, x) + 1 - (.5 + 2.5 * u) * k1); }
  for (let i = 12; i >= 0; i--){ const u = i / 12, x = sx - d * u * wl; cx.lineTo(x, wy(P.L, x) + 2.5 + (1 + 5.5 * u) * k1); }
  cx.closePath(); cx.fill();
  const m0 = d > 0 ? Math.floor((sx + off) / gap) : Math.ceil((sx + off) / gap);
  for (let j = 0; j < 60; j++){ const mm = m0 - d * j, x = mm * gap - off, u = Math.abs(x - sx) / wl; if (u > 1) break;
    for (const row of [-1, 1]){ const hh = hash1(mm * 1.7 + row * 5.3); if (hh < .18 + .42 * u) continue;
      const rx = (2 + 4.5 * u) * (.65 + .5 * hash1(mm + row)) * (.7 + .4 * k1), y = wy(P.L, x) + 1.6 + row * (.4 + (row > 0 ? 7 : 3) * u) * k1;
      cx.fillStyle = `rgba(255,255,255,${Math.pow(1 - u, 1.3) * (.5 + .45 * hash1(mm * .9 + 3)) * (row > 0 ? .95 : .7)})`; cx.beginPath(); cx.ellipse(x, y, rx, rx * (.32 + .1 * u), 0, 0, 7); cx.fill(); } }
  // the boil right under the stern: lumps of white water welling up and falling astern
  for (let j = 0; j < 5; j++){ const ph = still ? j / 5 : (SC.t * 1.8 + j / 5 + s.ph) % 1, x = sx + d * (3 - ph * 12), y = wy(P.L, x) + 1.8 - Math.sin(ph * Math.PI) * 1.4 * k1;
    cx.fillStyle = `rgba(255,255,255,${.85 * (1 - ph * .8)})`; cx.beginPath(); cx.ellipse(x, y, (2.4 + 3.2 * ph) * (.7 + .4 * k1), 1.3 + 1.1 * ph, 0, 0, 7); cx.fill(); }
  cx.restore();
  // when the bow has just dug into a sea, it throws spray
  if (s.state === "sail" && !still && DT > 0){ const rate = (P.ang - (s.pAng == null ? P.ang : s.pAng)) * d / DT;
    if (s.pRate > 0 && rate <= 0 && P.ang * d * nk > .075 && SC.speed > 30 && (s.slamT || 0) < SC.t){ s.slamT = SC.t + .8; const n = Math.round(clamp(P.ang * d * nk * 40, 3, 9));
      for (let q = 0; q < n; q++) spawn({ k:"spray", z:P.L, x:bx + d * Math.random() * 6, y:by - h * .5, vx:d * (30 + Math.random() * 90), vy:-70 - Math.random() * 110, life:.7, max:.7, r:1.3 + Math.random() * 1.8 }); }
    s.pRate = rate; s.pAng = P.ang; }
}
function drawBadges(){}   // LIVE: no convoy badges in the live game (one ship)
// the kraken: a dark shape rises under the ship, its head comes up behind her to glare over the deck, arms burst out on every side,
// two of them reach over from behind and come down across her hull, two more hook over the bow and stern, they squeeze, and she is hauled under
const easeBack = t => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
// a tapered arm along a list of points, from index i0 to i1: purple above, pale suckers along the inner edge, a wet highlight.
// open = the arm carries on behind something at i0, so no outline is drawn across the cut
function tentacle(pts, w0, side, back, i0 = 0, i1 = pts.length - 1, open = false){
  const n = pts.length, Lft = [], Rgt = [], nrm = [];
  for (let i = 0; i < n; i++){ const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d, wd = w0 * (1 - .87 * Math.pow(i / (n - 1), .85)) / 2;
    nrm.push([nx, ny, wd]); Lft.push([pts[i][0] + nx * wd, pts[i][1] + ny * wd]); Rgt.push([pts[i][0] - nx * wd, pts[i][1] - ny * wd]); }
  if (i1 - i0 < 1) return;
  const outline = () => { cx.beginPath(); for (let i = i0; i <= i1; i++) i > i0 ? cx.lineTo(Lft[i][0], Lft[i][1]) : cx.moveTo(Lft[i][0], Lft[i][1]); for (let i = i1; i >= i0; i--) cx.lineTo(Rgt[i][0], Rgt[i][1]); };
  outline(); cx.closePath(); cx.fillStyle = back ? "#7440b8" : "#9150dd"; cx.fill();
  cx.strokeStyle = INK; cx.lineWidth = 2.6; cx.lineJoin = "round"; cx.lineCap = "round"; outline(); if (!open) cx.closePath(); cx.stroke();
  // the paler underside runs along the inner edge, with suckers
  cx.fillStyle = back ? "#b48ae0" : "#d7b4f6";
  for (let i = Math.max(2, i0 + 1); i < Math.min(n - 2, i1); i += 2){ const [nx, ny, wd] = nrm[i], px = pts[i][0] + nx * wd * .55 * side, py = pts[i][1] + ny * wd * .55 * side, rr = Math.max(1.2, wd * .42);
    cx.beginPath(); cx.arc(px, py, rr, 0, 7); cx.fill(); cx.strokeStyle = "rgba(10,15,40,.55)"; cx.lineWidth = 1; cx.stroke(); }
  if (!back){ cx.strokeStyle = "rgba(255,255,255,.35)"; cx.lineWidth = 1.6; cx.beginPath(); let first = true; for (let i = Math.max(1, i0); i < Math.min(n * .7, i1); i++){ const [nx, ny, wd] = nrm[i], px = pts[i][0] - nx * wd * .5 * side, py = pts[i][1] - ny * wd * .5 * side; first ? cx.moveTo(px, py) : cx.lineTo(px, py); first = false; } cx.stroke(); }
}
// the head: a tall purple mantle with two yellow eyes whose lids tell the story (a glare, a strain as it squeezes, a satisfied squint)
function krakenHead(tn, P, L, t, out){
  const er = easeBack(clamp((t - .16) / .36, 0, 1)) * (1 - ease(out)); if (er < .02) return;
  const hr = tn.bw * .27, ex = tn.x + tn.side * tn.bw * .34, follow = P ? (P.y - wy(L, P.x)) * .6 : 0, still = calm();
  const cy = wy(L, ex) + hr * 1.1 - er * (tn.h * .66 + hr * 1.1) + follow + (still ? 0 : Math.sin(SC.t * 5 + tn.x) * hr * .03);
  const squeeze = clamp((t - .55) / .2, 0, 1) * (1 - clamp((t - 1.15) / .2, 0, 1)), glad = clamp((t - 1.25) / .25, 0, 1), blink = t > .98 && t < 1.1 ? 1 : 0;
  cx.save(); cx.translate(ex, cy); cx.rotate(-tn.side * .1 + (still ? 0 : Math.sin(SC.t * 2.6 + 1) * .04)); cx.scale(hr * (1 + .05 * squeeze), hr * (1 - .06 * squeeze)); cx.lineJoin = "round";
  cx.beginPath(); cx.moveTo(-1.05, 2.4); cx.bezierCurveTo(-1.25, .9, -1.45, -.25, -1, -1); cx.bezierCurveTo(-.6, -1.75, .6, -1.75, 1, -1); cx.bezierCurveTo(1.45, -.25, 1.25, .9, 1.05, 2.4); cx.closePath();
  cx.fillStyle = "#8a4cd6"; cx.fill(); cx.strokeStyle = INK; cx.lineWidth = 2.6 / hr; cx.stroke();
  cx.fillStyle = "#b07ae8"; [[-.5, -1.12, .12], [.42, -1.22, .1], [.05, -.95, .08], [-.82, -.6, .07], [.86, -.55, .08]].forEach(([x, y, r]) => { cx.beginPath(); cx.arc(x, y, r, 0, 7); cx.fill(); });
  cx.strokeStyle = "rgba(255,255,255,.3)"; cx.lineWidth = 2 / hr; cx.lineCap = "round"; cx.beginPath(); cx.arc(0, -.45, 1.05, Math.PI * 1.12, Math.PI * 1.42); cx.stroke();
  const look = P ? clamp((P.x - ex) / (tn.bw * .5), -1, 1) : -tn.side;
  for (const sd of [-1, 1]){ const x0 = sd * .47, y0 = .02, r = .34;
    // sd * -1 is the side of this eye nearer the middle of the face: the lid drops lower there for a scowl
    const inner = lerp(lerp(.5, .7, squeeze), .58, glad), outer = lerp(lerp(.12, .34, squeeze), .58, glad), lo = Math.max(blink, outer), li = Math.max(blink, inner);
    cx.beginPath(); cx.arc(x0, y0, r, 0, 7); cx.fillStyle = "#ffe066"; cx.fill();
    cx.save(); cx.clip();
    cx.fillStyle = INK; cx.beginPath(); cx.ellipse(x0 + look * .1, y0 + .03, .085, .25, 0, 0, 7); cx.fill();
    cx.fillStyle = "#fff"; cx.beginPath(); cx.arc(x0 - .1, y0 - .13, .065, 0, 7); cx.fill();
    const yo = y0 - r + 2 * r * lo, yi = y0 - r + 2 * r * li, xo = x0 + sd * r * 1.15, xi = x0 - sd * r * 1.15;
    cx.fillStyle = "#7a42c4"; cx.beginPath(); cx.moveTo(xo, y0 - r * 1.3); cx.lineTo(xi, y0 - r * 1.3); cx.lineTo(xi, yi); cx.lineTo(xo, yo); cx.closePath(); cx.fill();
    cx.strokeStyle = INK; cx.lineWidth = 2.2 / hr; cx.beginPath(); cx.moveTo(xi, yi); cx.lineTo(xo, yo); cx.stroke(); cx.restore();
    cx.strokeStyle = INK; cx.lineWidth = 2.2 / hr; cx.beginPath(); cx.arc(x0, y0, r, 0, 7); cx.stroke(); }
  cx.restore();
}
function drawTentacles(L, back){
  for (const tn of SC.tentacles){ if (tn.L !== L) continue;
    if (!back){ tn.t += DT; if (tn.ship) tn.x -= SC.speed * LAY[L].s * DT; }   // the kraken holds her and drifts astern with her in the water
    const t = tn.t, sh = tn.ship, P = sh && sh.state === "sink" ? shipPose(sh) : null, still = calm();
    if (back && !tn.lone) krakenHead(tn, P, L, t, clamp((t - 1.55) / .4, 0, 1));
    for (const a of tn.arms){
      const ta = t - a.delay; if (ta <= 0) continue;
      // an arm that reaches over the ship is drawn in both passes (its rising half behind her, the rest in front); the others in one
      if (a.ty === "wave" ? !back : a.ty === "end" ? back : false) continue;
      const rise = easeBack(clamp(ta / .32, 0, 1)), wrap = a.ty === "wave" || !P ? 0 : ease(clamp((ta - .26) / .36, 0, 1)), out = clamp((t - a.out) / .38, 0, 1);
      const bx = tn.x + a.bx * tn.bw, by = wy(L, bx) + 8, inw = a.bx < 0 ? 1 : -1, sway = still ? 0 : Math.sin(SC.t * 3.2 + a.ph) * tn.bw * (a.ty === "wave" ? .09 : .06) * (1 - wrap * .7);
      if (back === (a.ty !== "end") && !a.splashed){ a.splashed = true; spawn({ k:"ring", z:L, x:bx, y:by - 4, vx:0, vy:0, life:.7, max:.7, r:5, L }); for (let q = 0; q < 6; q++) spawn({ k:"spray", z:L, x:bx, y:by - 6, vx:(Math.random() - .5) * 90, vy:-90 - Math.random() * 90, life:.6, max:.6, r:1.6 + Math.random() * 1.6 }); }
      // reaching: up out of the sea, bowed outward, the tip hooking in over the ship. Gripping: the same arm bent over her, its tip on a point of the ship
      const loc = ([lx, ly]) => { const c = Math.cos(P.ang), sn = Math.sin(P.ang), X = lx * P.bw, Y = ly * P.h; return [P.x + X * c - Y * sn, P.y + X * sn + Y * c]; };
      const r1 = [bx - inw * tn.bw * .1, by - a.len * .5], r2 = [bx + inw * tn.bw * .04 + sway, by - a.len * .98], r3 = [bx + inw * tn.bw * .2 + sway * 1.4, by - a.len * .88];
      const g1 = [bx - inw * tn.bw * .05, by - a.len * .42], g2 = P && a.c2 ? loc(a.c2) : r2, g3 = P && a.tip ? loc(a.tip) : r3;
      const mix = (p, q) => [bx + (lerp(p[0], q[0], wrap) - bx) * Math.min(1, rise), by + (lerp(p[1], q[1], wrap) - by) * rise], c1 = mix(r1, g1), c2 = mix(r2, g2), c3 = mix(r3, g3), dn = out * a.len * 1.25;
      const N = 18, pts = []; let top = 0;
      for (let i = 0; i <= N; i++){ const u = i / N, q = 1 - u, wv = still ? 0 : Math.sin(u * 6.5 - SC.t * 8.5 + a.ph) * a.w * .3 * u * (1 - wrap * .65);
        const x = q * q * q * bx + 3 * q * q * u * c1[0] + 3 * q * u * u * c2[0] + u * u * u * c3[0], y = q * q * q * by + 3 * q * q * u * c1[1] + 3 * q * u * u * c2[1] + u * u * u * c3[1];
        pts.push([x + wv, y + dn * (1 - u * .2)]); if (pts[i][1] < pts[top][1]) top = i; }
      // the tip curls on the way the arm is already bending, tighter as it grips
      const end = pts[N], prev = pts[N - 1], pp = pts[N - 2], ang0 = Math.atan2(end[1] - prev[1], end[0] - prev[0]), bend = (prev[0] - pp[0]) * (end[1] - prev[1]) - (prev[1] - pp[1]) * (end[0] - prev[0]), turn = bend >= 0 ? 1 : -1, rc = a.w * (.55 - .2 * wrap);
      for (let i = 1; i <= 6; i++){ const an = ang0 + turn * i * (.35 + .45 * wrap), rr = rc * (1 - i / 9); pts.push([pts[pts.length - 1][0] + Math.cos(an) * rr, pts[pts.length - 1][1] + Math.sin(an) * rr]); }
      if (a.ty === "over"){ const m = top >= N ? pts.length - 1 : Math.max(2, top);   // while it only reaches, all of it is behind the ship
        if (back) tentacle(pts, a.w, turn, false, 0, Math.min(pts.length - 1, m + 1)); else if (m < pts.length - 1) tentacle(pts, a.w, turn, false, m, pts.length - 1, true); }
      else tentacle(pts, a.w, turn, back);
      if (!back && wrap > .5 && out < .5 && !still) for (let n = nPer(.12); n > 0; n--) spawn({ k:"spray", z:L, x:end[0], y:end[1], vx:(Math.random() - .5) * 20, vy:10, life:.5, max:.5, r:1.2 });
    }
  }
  if (!back) SC.tentacles = SC.tentacles.filter(t => t.t < 2.05);
}
// under the surface: the kraken's dark shape rising, and a boil of bubbles
function drawKrakenWater(L){
  for (const tn of SC.tentacles){ if (tn.L !== L || tn.t > .7) continue;
    const a = tn.t < .35 ? tn.t / .35 : 1 - (tn.t - .35) / .35, y = wy(L, tn.x) + 12, g2 = cx.createRadialGradient(tn.x, y, 2, tn.x, y, tn.bw * 1.1);
    g2.addColorStop(0, `rgba(36,14,58,${.5 * a})`); g2.addColorStop(1, "rgba(36,14,58,0)"); cx.save(); cx.translate(tn.x, y); cx.scale(1, .3); cx.translate(-tn.x, -y); cx.fillStyle = g2; cx.beginPath(); cx.arc(tn.x, y, tn.bw * 1.1, 0, 7); cx.fill(); cx.restore();
    for (let n = nPer(.5); n > 0; n--) spawn({ k:"bubble", z:L, x:tn.x + (Math.random() - .5) * tn.bw * 1.2, y:y - 2 + Math.random() * 6, vx:(Math.random() - .5) * 10, vy:-16, life:.9, max:.9, r:2 + Math.random() * 3 });
  }
}
// a rogue wave takes a ship: one set of crests for every ship lost in the same instant (a shared fate is one wave taking them all).
// It heaves up ahead of the fleet, and each ship it takes goes down as the giant crest reaches her (her sinking clock starts below zero)
function rogueHit(sh){
  const P = shipPose(sh), bw = shipW();
  let e = SC.rogues.find(r => r.t0 === SC.t);
  // (its height follows the ship's width, the same width measure the swell's height now uses (see seaTick), so it already stands as tall
  // over a phone sea, and over the ships, as on desktop; it needs no extra phone scaling)
  if (!e){ e = { t:0, t0:SC.t, x:-1e9, xEnd:1e9, A:bw * .7 * (calm() ? .75 : 1.2), wid:bw * 1.1, lam:bw * 3, c:bw * 3.8, kL:[0, 0, .82, .42, .22], hits:[], rode:{}, prev:null, life:3 };
    SC.rogues.push(e); sfx("surge"); }   // rocks already in sight stay put and roll out astern (user: rocks never sink back into the sea)
  if (sh.row) e.kL = [0, 0, .7, 1, .45];   // a ship in the front row: the set runs through both rows (the back one a little smaller)
  e.hits.push({ sh, at:0, hitAt:-1 });
  e.x = Math.max(e.x, P.x + bw * 1.3); e.xEnd = Math.min(e.xEnd, P.x);
  e.c = Math.max(bw * 3.8, (e.x - e.xEnd - bw * .15) / .8);   // however far apart, the last ship it takes goes within .8 s
  for (const h of e.hits){ h.at = clamp((e.x - shipPose(h.sh).x - bw * .15) / e.c, 0, 1); h.sh.st = -h.at; h.sh.rg = 1; h.sh.sc0 = null; }   // (she loses way when the crest reaches her)
  e.life = Math.min(3.4, (e.x + e.lam + e.wid * 2.6) / e.c);
}
function drawRogue(L){
  // an old-style wave hand-off (Fair Winds Live's adapter) becomes a wave set too
  if (SC.waves.length){ for (const w of SC.waves.splice(0)){ const sh = SC.ships.find(o => o.state === "sink" && o.cause === "wave" && !o.rg); if (sh) rogueHit(sh); } }
  for (const e of SC.rogues){ const kL = e.kL[L]; if (!kL) continue;
    const col = seaCol(L), lane = e.hits.filter(h => (h.sh.row ? 3 : 2) === L), still = calm();
    ROGUE_SET.forEach((c, n) => { const xc = e.x + c.d * e.lam - e.c * e.t, Hc = e.A * kL * c.a * rogueEnv(e, xc, c.d), w = e.wid;
      if (Hc < 3 || xc < -w * 2 || xc > W + w * 2) return;
      const yT = wy(L, xc), f = clamp(Hc / (e.A * kL), 0, 1);
      // how far the giant has broken: building as it nears the first ship it takes, curling over while it runs through them, spilling after
      let brk = 0;
      if (!c.d && lane.length){ const xs = lane.map(h => shipPose(h.sh).x), xR = Math.max(...xs), xL = Math.min(...xs);
        brk = xc > xR ? clamp(1 - (xc - xR - w * .25) / w, 0, 1) : xc >= xL ? 1 : clamp(1 - (xL - xc) / (w * 2.2), 0, 1); brk *= clamp(e.t / .3, 0, 1); }
      // the crest inked like everything else on the sea, with a foam line along its top
      cx.lineJoin = "round"; cx.lineCap = "round";
      const og = cx.createLinearGradient(xc - w * 1.1, 0, xc + w * 1.6, 0); og.addColorStop(0, "rgba(10,15,40,0)"); og.addColorStop(.3, `rgba(10,15,40,${.55 * f})`); og.addColorStop(.55, `rgba(10,15,40,${.45 * f})`); og.addColorStop(1, "rgba(10,15,40,0)");
      cx.beginPath(); for (let x = xc - w * 1.1; x <= xc + w * 1.6; x += 5){ const y = wy(L, x); x === xc - w * 1.1 ? cx.moveTo(x, y) : cx.lineTo(x, y); }
      cx.strokeStyle = og; cx.lineWidth = 2.6; cx.stroke();
      cx.beginPath(); for (let x = xc - w * .35; x <= xc + w * .7; x += 5){ const y = wy(L, x) + 2.5; x === xc - w * .35 ? cx.moveTo(x, y) : cx.lineTo(x, y); }
      cx.strokeStyle = `rgba(255,255,255,${.75 * f})`; cx.lineWidth = 3; cx.stroke();
      // sunlit green water just under the crest, where the wave is thin enough to see through
      const gl = cx.createLinearGradient(0, yT, 0, yT + Hc * .7); gl.addColorStop(0, `rgba(150,235,215,${.32 * f})`); gl.addColorStop(1, "rgba(150,235,215,0)");
      cx.beginPath(); for (let x = xc - w * .9; x <= xc + w * .9; x += 5) x === xc - w * .9 ? cx.moveTo(x, wy(L, x) + 3) : cx.lineTo(x, wy(L, x) + 3); cx.lineTo(xc + w * .9, yT + Hc * .8); cx.lineTo(xc - w * .9, yT + Hc * .8); cx.closePath();
      cx.save(); cx.clip(); cx.fillStyle = gl; cx.fillRect(xc - w, yT, w * 2, Hc * .8); cx.restore();
      if (brk > .12 && Hc > 12){
        // the lip: thrown forward off the crest and curling down, pale where it's thin, with the dark hollow of the barrel under it
        const k = brk, tipX = xc - w * .64 * k, tipY = yT + Hc * .42 * k, fy = x => wy(L, x);
        const top = () => { cx.moveTo(xc + w * .45, fy(xc + w * .45)); cx.quadraticCurveTo(xc + w * .12, yT - Hc * .2 * k, xc - w * .24 * k, yT - Hc * .14 * k); cx.quadraticCurveTo(xc - w * .64 * k, yT - Hc * .06 * k, tipX, tipY); };
        const under = () => { cx.quadraticCurveTo(xc - w * .5 * k, yT + Hc * .3 * k, xc - w * .34 * k, yT + Hc * .17 * k); cx.quadraticCurveTo(xc - w * .14, yT + Hc * .1, xc - w * .04, fy(xc - w * .04) + Hc * .08); };
        cx.fillStyle = rgb(mixC(col, "#04122e", .45), .92); cx.beginPath(); cx.moveTo(xc - w * .06, yT + Hc * .12);
        cx.quadraticCurveTo(xc - w * .44 * k, yT + Hc * .16 * k, tipX + w * .08 * k, tipY - Hc * .04 * k); cx.lineTo(tipX + w * .05, fy(tipX + w * .05)); cx.lineTo(xc - w * .12, fy(xc - w * .12)); cx.closePath(); cx.fill();
        cx.fillStyle = rgb(mixC(col, "#c8f7ec", .5)); cx.beginPath(); top(); under(); cx.lineTo(xc + w * .2, fy(xc + w * .2) + 2); cx.closePath(); cx.fill();
        cx.strokeStyle = INK; cx.lineWidth = 2.8; cx.beginPath(); top(); under(); cx.stroke();
        cx.strokeStyle = `rgba(255,255,255,${.95 * clamp(k * 2, 0, 1)})`; cx.lineWidth = 2 + 4 * k; cx.beginPath(); cx.moveTo(xc + w * .22, yT - Hc * .08 * k); cx.quadraticCurveTo(xc - w * .08 * k, yT - Hc * .19 * k, xc - w * .34 * k, yT - Hc * .12 * k);
        cx.quadraticCurveTo(xc - w * .56 * k, yT - Hc * .02 * k, tipX + 3, tipY - 6); cx.stroke();
        cx.fillStyle = `rgba(255,255,255,${.95 * k})`; for (let q = 0; q < 4; q++){ const ph = still ? q : SC.t * 9 + q * 1.7; cx.beginPath(); cx.arc(tipX - 3 - q * 3 + Math.sin(ph) * 2, tipY - 4 + q * 4 + Math.cos(ph) * 2, 3.4 - q * .6, 0, 7); cx.fill(); }
        // white water where the lip lands, and a curtain of spray thrown up ahead of it
        if (!still) for (let n = nPer(.7 * k); n > 0; n--){ const lx = tipX - Math.random() * w * .2; spawn({ k:"spray", z:L, x:lx, y:fy(lx), vx:-e.c * .6 / gK() - Math.random() * 80, vy:-90 - Math.random() * 150 * k, life:.7, max:.7, r:1.6 + Math.random() * 2.6 });
          spawn({ k:"foam", z:L, x:lx + Math.random() * w * .3, y:fy(lx) + 1, vx:0, vy:0, life:1.2, max:1.2, r:3 + Math.random() * 4, L }); } }
      // spindrift: the wind tears spray off the top of the big crests and streams it back
      if (!still && c.a > .55) for (let n = nPer(.55 * f); n > 0; n--) spawn({ k:"spray", z:L, x:xc + (Math.random() - .3) * w * .4, y:yT - 2, vx:60 + Math.random() * 90, vy:-40 - Math.random() * 50, life:.6, max:.6, r:1.1 + Math.random() * 1.6 });
      // a ship the crest runs into takes green water over her bow (the ones it sinks get the white water below)
      if (L === 3 && e.prev) for (const sp of SC.ships){ if (sp.state !== "sail") continue; const Ls = sp.row ? 3 : 2; if (!e.kL[Ls]) continue;
        const Pq = shipPose(sp), bx = Pq.x + Math.sign(Pq.fx || 1) * Pq.bw * .42, key = sp.i + ":" + n, xp = e.prev[n];
        if (e.rode[key] || !(xp > bx && xc <= bx)) continue; e.rode[key] = 1;
        const Hs = e.A * e.kL[Ls] * c.a * rogueEnv(e, xc, c.d); if (Hs < 6) continue; sp.hitT = Math.max(sp.hitT, .3 * c.a);
        if (!still) for (let q = 0; q < Math.round(10 * c.a); q++) spawn({ k:"spray", z:Ls, x:bx + (Math.random() - .5) * 10, y:wy(Ls, bx) - Pq.h * .1, vx:-40 - Math.random() * 150, vy:-110 - Math.random() * 170 * c.a, life:.8, max:.8, r:1.6 + Math.random() * 2.4 }); }
    });
    // the ships it takes vanish in a burst of white water as the giant breaks over them
    for (const h of e.hits){ if ((h.sh.row ? 3 : 2) !== L) continue; const Ph = shipPose(h.sh);
      if (h.hitAt < 0 && e.t >= h.at){ h.hitAt = e.t; sfx("splash"); SC.shake = Math.max(SC.shake, .9);
        if (!still) for (let q = 0; q < 26; q++) spawn({ k:"spray", z:L, x:Ph.x + (Math.random() - .3) * Ph.bw * .9, y:wy(L, Ph.x) - Ph.h * (.1 + Math.random() * .5), vx:-60 - Math.random() * 220, vy:-160 - Math.random() * 200, life:.9, max:.9, r:2 + Math.random() * 3.2 }); }
      const tt = h.hitAt < 0 ? -1 : e.t - h.hitAt; if (tt < 0 || tt > .85) continue;
      const a = 1 - tt / .85, gx = Ph.x - e.c * .3 * tt, gy = wy(L, gx) - Ph.h * .3, rnd = mulberry32(7 + h.sh.i * 13), grow = .55 + Math.min(1, tt * 3) * .6, puffs = [];
      for (let q = 0; q < 13; q++){ const qx = (rnd() - .45) * Ph.bw * 1.1, qy = -Math.abs(rnd() - .3) * Ph.h * .8 * grow + Ph.h * .12, r = Ph.bw * (.08 + rnd() * .09) * grow * (1 - Math.abs(qx) / Ph.bw * .5); puffs.push([gx + qx, gy + qy, r]); }
      const cloud = (dx, dy, kr) => { cx.beginPath(); for (const [px, py, r] of puffs){ cx.moveTo(px + dx + r * kr, py + dy); cx.arc(px + dx, py + dy, r * kr, 0, 7); } cx.fill(); };
      cx.fillStyle = `rgba(170,214,236,${.7 * a})`; cloud(1.5, 4, 1); cx.fillStyle = `rgba(255,255,255,${.95 * a})`; cloud(0, 0, .94); }
  }
  if (L === 3){ for (const e of SC.rogues){ e.prev = ROGUE_SET.map(c => e.x + c.d * e.lam - e.c * e.t); e.t += DT; } SC.rogues = SC.rogues.filter(e => e.t < e.life); }
}
// a great white whale bursts up under a ship and takes it down
function drawWhale(L){
  for (const wh of SC.whales) if (wh.L === L) drawOneWhale(wh);
  SC.whales = SC.whales.filter(wh => wh.t < wh.dur);
}
function drawOneWhale(wh){
  wh.t += DT; const f = wh.t / wh.dur; if (f >= 1) return; wh.x -= SC.speed * LAY[wh.L].s * DT;   // it rides astern with the water, carrying her
  // a little squash and stretch: long and lean as it bursts out and dives, fuller at the top of its leap
  const arc = Math.sin(f * Math.PI), x = wh.x, y = wh.y - arc * wh.h, ang = -1.1 + f * 2.2, s = wh.s, q = calm() ? 0 : Math.cos(f * Math.PI * 2) * .08;
  cx.save(); cx.translate(x, y); cx.rotate(ang); cx.scale(s * (1 + q), s * (1 - q)); cx.strokeStyle = INK; cx.lineWidth = 4; cx.lineJoin = "round";
  cx.fillStyle = "#f3f5f8"; cx.beginPath(); cx.moveTo(-90, 0); cx.quadraticCurveTo(-60, -44, 20, -40); cx.quadraticCurveTo(80, -36, 96, -6); cx.quadraticCurveTo(100, 20, 60, 26); cx.quadraticCurveTo(-20, 34, -90, 6); cx.closePath(); cx.fill(); cx.stroke();
  cx.beginPath(); cx.moveTo(-88, 2); cx.lineTo(-128, -26); cx.quadraticCurveTo(-118, -2, -132, 22); cx.closePath(); cx.fill(); cx.stroke();
  cx.fillStyle = "#cfd6e0"; cx.beginPath(); cx.moveTo(40, 18); cx.quadraticCurveTo(80, 14, 92, 0); cx.quadraticCurveTo(84, 22, 50, 26); cx.closePath(); cx.fill();
  cx.strokeStyle = "rgba(10,15,40,.45)"; cx.lineWidth = 2; [[-30, -28, -6, -20], [0, -30, 24, -24], [-50, -14, -30, -4], [10, -12, 36, -8]].forEach(([a, b, c, d]) => { cx.beginPath(); cx.moveTo(a, b); cx.lineTo(c, d); cx.stroke(); });
  cx.fillStyle = INK; cx.beginPath(); cx.arc(70, -10, 4, 0, 7); cx.fill();
  cx.restore();
  for (let n = nPer(.6); n > 0; n--) spawn({ k:"spray", z:wh.L, x:x + (Math.random() - .5) * 110 * s, y:wy(wh.L, x) - 4, vx:(Math.random() - .5) * 140, vy:-90 - Math.random() * 130, life:1, max:1, r:2 + Math.random() * 3 });
}
// wind streaks across the sky: barely there at the start, a gale of them deep into a voyage; like the breeze curls they overtake
// the fleet (the following wind is faster than the ships), so they run left to right
function drawWind(){
  if (!R || R.state !== "sailing" || calm()) return;
  // in a trade-wind or monsoon belt: a few cartoon breeze curls overtaking the fleet, light as a feather
  const tw = SC.trade || 0;
  if (tw > .03){ cx.lineCap = "round";
    for (let i = 0; i < 3; i++){ const span = W + 260, x = ((SC.t * (150 + i * 25) + i * span / 3) % span) - 130, y = H * (.1 + i * .085) + Math.sin(SC.t * 1.3 + i * 2) * 6, r = 7 + i * 1.5;
      // a soft blue under-stroke so the white curl reads against a pale sky too
      for (const [col, lw, dy] of [[`rgba(40,80,140,${.22 * tw})`, 3.6, 1.5], [`rgba(255,255,255,${.6 * tw})`, 2.4, 0]]){ cx.strokeStyle = col; cx.lineWidth = lw;
        cx.beginPath(); cx.moveTo(x - 70, y + 2 + dy); cx.quadraticCurveTo(x - 30, y - 5 + dy, x, y + dy); cx.arc(x, y - r + dy, r, Math.PI * .5, Math.PI * 1.9, true); cx.stroke();
        cx.beginPath(); cx.moveTo(x - 52, y + 12 + dy); cx.quadraticCurveTo(x - 24, y + 8 + dy, x - 8, y + 10 + dy); cx.stroke(); } } }
  const I = clamp(R.lnm / Math.log(R.v.max), 0, 1) * .7 + (R.boost > 1 ? .2 : 0), n = Math.round(1 + 5 * I), sp = 420 + 600 * I, len = 24 + 40 * I;
  cx.strokeStyle = `rgba(255,255,255,${.04 + .1 * I})`; cx.lineCap = "round";
  for (let i = 0; i < n; i++){ const y = H * (.06 + ((i * 0.381) % 1) * .38), ph = (i * 0.618) % 1, x = ((SC.t * sp * (.7 + ph * .6) + ph * W * 2) % (W + 200)) - 140;
    cx.lineWidth = 1 + (i % 2) * .4; cx.beginPath(); cx.moveTo(x, y); cx.lineTo(x + len * (.6 + ph * .8), y + 1); cx.stroke(); }
}
// a storm: its shadow runs ahead of it across the sky, rain hangs from it to the horizon (slanting harder the stronger the wind), and the
// cloud is a Storybook bank of inked billows: lower, bigger and blacker for a gale and for the great storms.
// It GATHERS (user, 2026-11-13: "cloud wont come in all at once like its not a mushroom"): it rolls in from ahead as a thin, ragged edge of
// separate dark puffs high in the sky, which swell, sink, darken and merge into a solid ceiling over a few seconds; fair clouds darken and
// are swallowed; rain falls from the whole underside, heaviest where the bank is thickest (never a stalk under a cap); it breaks up the
// same way as it goes.
// Everything here only draws (and sounds) the storms the voyage already has; none of it changes the speed or anyone's luck
const stormLvl = s => clamp((s.kind.dark - .55) / .4, 0, 1);   // 0 a squall, .5 a gale, 1 a hurricane / typhoon / cyclone / tempest
const stormBase = s => H * (.19 + .07 * stormLvl(s));             // the underside of the built-up cloud (low enough to show under the HUD)
// how built up a storm bank is: m = 0 a thin new puff high in the sky, 1 part of the solid ceiling. It grows with the storm's age (seconds
// since it came in over the right edge; STORM_GATHER to build) and with the distance behind its leading (left) edge, thins toward its
// trailing edge, and the whole bank breaks up in its last STORM_CLEAR seconds on screen. Worked out from where the storm is, so nothing has
// to be kept on it (Fair Winds Live makes its storms afresh every frame). h (0..1) roughs up a column so the edge is ragged
const STORM_GATHER = 4.5, STORM_CLEAR = 3;
function stormEnv(s){ const v = Math.max(1, -s.vx); return sstep((W + 20 - s.x) / v / STORM_GATHER) * sstep((s.x + s.w + 20) / v / STORM_CLEAR); }
function stormM(s, x, h, env = stormEnv(s)){
  const q = x - s.x, qb = s.x + s.w - x; if (q <= 0 || qb <= 0) return 0;
  const m = env * sstep(q / (s.w * .3)) * sstep(qb / (s.w * .2));
  return h == null ? m : clamp(m + (h - .5) * 1.2 * m * (1 - m), 0, 1);
}
// how far the storm banks have swallowed the sky at screen x (fair clouds there darken and fade under it)
function stormCover(x){ let m = 0; if (R && R.storms) for (const s of R.storms) m = Math.max(m, stormM(s, x)); return m; }
// the bank's shape this frame (user, 2026-11-14: "make the storm clouds better" / "clouds are not good enough", after the flat shelf
// read as a clip-art scallop border; never "mushroomy"). Two things are worked out:
// - cols: n evenly spaced samples of how built up the bank is (x, m), read by rainSheet, bankMAt, the lightning and the rain
// - the billows, in two layers that do NOT follow that even grid: a front row along the underside and a hazier back row higher up, each
//   walked across the bank with sizes from 2-3 classes picked by a seeded hash and spacing that follows the sizes, so there is no rhythm.
//   A solid ceiling joins them to above the top of the screen (no sky over it). As a part builds up (m) its billows lower from above the
//   screen to the cloud base, so a gathering storm comes in as a sloping front (low where it has built up, rising toward its leading
//   edge) with a few soft scud wisps drifting low ahead of it, and clears by lifting away
function stormCols(s, base, k, lvl){
  const Rr = (30 + 22 * lvl) * k, w = s.w, n = Math.max(6, Math.round(w / (Rr * 1.15))), top = -Rr * 2.4, env = stormEnv(s), cols = [], front = [], back = [], scud = [];
  for (let i = 0; i < n; i++){ const u = (i + .5) / n, x = s.x + Rr * .5 + u * (w - Rr), h = hash1(i * 7.31 + s.ph * 13.7); cols.push({ x, m:stormM(s, x, h, env), h }); }
  // where the underside hangs at x for a part built up m: from above the screen down to the base, with a slow swell along the bank
  const under = (x, m) => lerp(top, base + Math.sin(x / (Rr * 3.1) + s.ph * 4) * Rr * .12, Math.pow(m, .75));
  const walk = (list, seed, cls, gap, lift, rk) => { let x = s.x - Rr * .2, i = 0;
    while (x < s.x + w + Rr * .2 && i < 60){ const h = hash1(i * 3.17 + seed + s.ph * 11.3), h2 = hash1(i * 1.93 + seed * 2 + s.ph * 5.1);
      const r = Rr * cls[Math.floor(h * cls.length)] * (.9 + .2 * h2), m = stormM(s, x, h2, env);
      const ry = r * rk, y = under(x, m) - ry * (.62 + lift) + (h2 - .5) * Rr * .14;
      list.push({ x, y, r, ry, m, h, w:.8 + .5 * h2 });
      x += r * gap * (.75 + .5 * hash1(i * 5.7 + seed)); i++; } };
  walk(front, 1, [.75, 1.0, 1.35], 1.25, 0, .82);   // the underside: small, medium and big billows, a little wider than tall
  walk(back, 7, [1.2, 1.6], 1.35, 1.25, .9);        // the body behind them: bigger, higher, hazier
  // scud: where the bank has not built up yet, a few soft ragged wisps ride low ahead of it, and fade as the bank arrives over them
  for (let i = 0; i < n; i++){ const c = cols[i], hs = hash1(i * 4.1 + s.ph * 9.3); if (c.m > .35 || hs < .5 || env < .05) continue;
    scud.push({ x:c.x + (hs - .5) * Rr * 1.4, y:lerp(base * .55, base * 1.05, hash1(i * 1.3 + s.ph)), r:Rr * (.45 + .3 * hs), a:env * (1 - c.m / .35), h:hs }); }
  return { Rr, n, cols, front, back, scud, top, base, x0:s.x + Rr * .5, span:w - Rr };
}
// how built up the bank is at screen x (between its columns), 0 off its ends
function bankMAt(B, x){ const f = (x - B.x0) / B.span * B.n - .5, i = Math.floor(f); if (f < -.5 || f > B.n - .5) return 0;
  const A = B.cols[clamp(i, 0, B.n - 1)], C = B.cols[clamp(i + 1, 0, B.n - 1)]; return lerp(A.m, C.m, clamp(f - i, 0, 1)); }
// paint the bank, storybook style: one ink outline round the outer silhouette only (its weight varies a little from billow to billow), a
// deep shadowed ceiling, then the back row of big hazy billows and the front row over them. Each billow is shaded, not outlined: a soft
// gradient from a lit top to a heavy dark base, and a crisp lit rim on the side toward the light, so billows part from one another by
// light and shade alone. The front row's dark bases make the cloud's dark, nearly flat underside. A part that has hardly built up is
// paler (a haze of the sky's grey). Lightning (flash) lights it softly. The scud ahead of it is drawn last as soft wisps
function drawStormBank(B, lvl, k, flash, sunDir, col){
  const cols = B.cols; if (!cols.length) return;
  const all = [...B.back, ...B.front], vis = o => o.x + o.r * 1.6 > -8 && o.x - o.r * 1.6 < W + 8;
  if (!all.some(vis)) return;
  const ow = (2.3 + 1.1 * lvl) * k, fl = clamp(flash, 0, 1) * .6, night = clamp((SC.nightP - .7) / .2, 0, 1);
  const haze = mixC("#959bb8", "#323a5e", night), glow = (c, t) => mixC(c, "#ded8ff", t * fl);
  const deep = glow(mixC(col, "#191a33", .35), .4), lite0 = glow(mixC(col, "#b9b5e2", .62), .6), mid0 = glow(mixC(col, "#7d79ab", .45), .5),
        dark0 = glow(mixC(col, "#0f1024", .5), .35), out = rgb(mixC(INK, col, .12));
  const shape = (g = 0) => { cx.beginPath(); const f = B.front[0], l = B.front[B.front.length - 1], roof = Math.min(B.top - B.Rr * 3, -80);
    cx.moveTo(f.x, roof); for (const o of B.front) cx.lineTo(o.x, o.y); cx.lineTo(l.x, roof); cx.closePath();
    for (const o of all){ if (!vis(o)) continue; const gg = g * o.w, rx = o.r * 1.12 + gg, ry = o.ry + gg; cx.moveTo(o.x + rx, o.y); cx.ellipse(o.x, o.y, rx, ry, 0, 0, Math.PI * 2, true); } };   // (same winding as the ceiling, or they cancel)
  // one billow: a vertical gradient from its lit top to its dark base, and a lit rim on the light side (the billow minus itself nudged
  // away from the light and down, so the rim can only show on its upper edge)
  const billow = (o, front) => { const hz = (1 - o.m) * .5, rx = o.r * 1.12, ry = o.ry, x = o.x, y = o.y;
    const L = mixC(front ? mixC(lite0, mid0, .3) : mixC(mixC(lite0, mid0, .4), haze, .2), haze, hz), M = mixC(front ? mid0 : mixC(mid0, haze, .2), haze, hz), D = mixC(front ? dark0 : mixC(dark0, mid0, .45), haze, hz * .8);
    const g = cx.createLinearGradient(0, y - ry, 0, y + ry); g.addColorStop(0, rgb(M)); g.addColorStop(.45, rgb(mixC(M, D, .25))); g.addColorStop(.8, rgb(D)); g.addColorStop(1, rgb(mixC(D, deep, .3)));
    cx.save(); cx.beginPath(); cx.ellipse(x, y, rx, ry, 0, 0, 7); cx.clip();
    cx.fillStyle = rgb(L); cx.fillRect(x - rx, y - ry, rx * 2, ry * 2);
    cx.fillStyle = g; cx.beginPath(); cx.ellipse(x - sunDir * rx * .1, y + ry * .15, rx, ry, 0, 0, 7); cx.fill();
    cx.restore(); };
  cx.save();
  cx.fillStyle = out; shape(ow); cx.fill();
  shape(); cx.save(); cx.clip();
  const cg = cx.createLinearGradient(0, B.base - B.Rr * 4, 0, B.base); cg.addColorStop(0, rgb(mixC(mid0, deep, .55))); cg.addColorStop(1, rgb(deep));
  cx.fillStyle = cg; cx.fillRect(-10, -10, W + 20, B.base + B.Rr * 2);
  for (const o of B.back) if (vis(o)) billow(o, false);
  for (const o of B.front) if (vis(o)) billow(o, true);
  cx.restore();
  cx.restore();
  // scud: soft ragged wisps, no outline, a dark haze ahead of the front
  for (const q of B.scud){ if (q.x < -q.r * 4 || q.x > W + q.r * 4 || q.a < .03) continue; const r = q.r;
    cx.save(); cx.fillStyle = rgb(mixC(mixC(mid0, haze, .55), dark0, .2), .55 * q.a); cx.beginPath();
    for (let j = 0; j < 5; j++){ const hj = hash1(j * 2.3 + q.h * 17), ex = q.x + (j - 2) * r * .7 + (hj - .5) * r * .4, ey = q.y + (hj - .5) * r * .25 - (j === 2 ? r * .12 : 0), erx = r * (.55 + .4 * hj) * (j === 2 ? 1.3 : 1), ery = erx * .32;
      cx.moveTo(ex + erx, ey); cx.ellipse(ex, ey, erx, ery, 0, 0, 7); }
    cx.fill(); cx.restore(); }
}
// the rain under a bank: one soft sheet from the whole underside down to the horizon, as heavy under each part as that part is built up
// (none under the thin new puffs), fading toward the sea and leaning downwind. Painted into a tiny canvas and stretched, so it is one drawImage
let rainCv = null;
function rainSheet(B, s, y0, y1, slant, col, a){
  if (!rainCv){ rainCv = document.createElement("canvas"); rainCv.width = 64; rainCv.height = 8; rainCv.g = rainCv.getContext("2d", { willReadFrequently:true }); }   // (kept off the GPU: tiny, redrawn every frame)
  const g = rainCv.g, hg = g.createLinearGradient(0, 0, 64, 0);
  hg.addColorStop(0, rgb(col, 0));
  for (const c of B.cols) hg.addColorStop(clamp((c.x - s.x) / s.w, 0, 1), rgb(col, Math.pow(c.m, 1.5)));
  hg.addColorStop(1, rgb(col, 0));
  g.globalCompositeOperation = "copy"; g.fillStyle = hg; g.fillRect(0, 0, 64, 8);
  const vg = g.createLinearGradient(0, 0, 0, 8); vg.addColorStop(0, "rgba(0,0,0,1)"); vg.addColorStop(1, "rgba(0,0,0,.15)");
  g.globalCompositeOperation = "destination-in"; g.fillStyle = vg; g.fillRect(0, 0, 64, 8); g.globalCompositeOperation = "source-over";
  cx.save(); cx.globalAlpha = a; cx.transform(1, 0, slant, 1, -slant * y0, 0); cx.drawImage(rainCv, s.x, y0, s.w, y1 - y0); cx.restore();
}
function drawStorms(){
  if (!R){ weatherSound(0); return; }
  const over = R.state !== "sailing", fx = W * .43, k = clamp(W / 700, .7, 1.4), hz = H * LAY[0].y;
  if (over){ for (const s of R.storms) s.x += Math.min(-60, s.vx * 1.6) * DT; R.storms = R.storms.filter(s => s.x + s.w > -40); }
  let rainAmt = 0;
  for (const s of R.storms){
    const kind = s.kind, lvl = stormLvl(s), base = stormBase(s), col = mixC("#4a4f72", "#1f2238", kind.dark), slant = .1 + .32 * lvl, dx = slant * (hz - base);   // the rain leans downwind, ahead
    const B = stormCols(s, base, k, lvl), env = stormEnv(s);
    // the shadow it throws across the sky, arriving before the cloud does (and deepening as the bank builds)
    const e = W * .3 / (s.w + W * .6), sh = cx.createLinearGradient(s.x - W * .3, 0, s.x + s.w + W * .3, 0), sa = .26 * kind.dark * env;
    sh.addColorStop(0, "rgba(18,20,38,0)"); sh.addColorStop(e, `rgba(18,20,38,${sa})`); sh.addColorStop(1 - e, `rgba(18,20,38,${sa})`); sh.addColorStop(1, "rgba(18,20,38,0)");
    cx.fillStyle = sh; cx.fillRect(0, 0, W, H * .53);
    // the rain: a sheet from the whole underside, and streaks falling from where the bank is built up (fainter where it is thinner)
    const y0 = base - B.Rr * .3;
    rainSheet(B, s, y0, hz + 6, slant, col, .24 + .16 * lvl);
    cx.lineWidth = 1; cx.setLineDash([10 + 8 * lvl, 14]); cx.lineDashOffset = calm() ? 0 : -SC.t * (260 + 220 * lvl);
    for (const [lo, hi, f] of [[.62, 2, 1], [.3, .62, .5]]){ cx.strokeStyle = `rgba(215,225,255,${(.1 + .1 * lvl) * f})`; cx.beginPath();
      for (let i = 0; i < 16; i++){ const xa = lerp(s.x + s.w * .04, s.x + s.w * .96, (i + .5) / 16 + .015 * Math.sin(i * 3.1 + s.ph)), mm = bankMAt(B, xa);
        if (mm >= lo && mm < hi){ cx.moveTo(xa, base + 6); cx.lineTo(xa + dx, hz + 4); } }
      cx.stroke(); }
    cx.setLineDash([]); cx.lineDashOffset = 0;
    // the bank itself (a lightning flash lights it softly for a couple of frames; kept light, a hurricane flashes often)
    s.flash = Math.max(0, (s.flash || 0) - DT * 6);
    drawStormBank(B, lvl, k, s.flash, (SC.sunX || 0) > s.x + s.w / 2 ? 1 : -1, col);
    if (s.x - s.vx * DT >= W && s.x < W && !over) sfx("rumble", .1);   // it comes over the horizon with a far-off rumble
    if (over) continue;
    // lightning: bolts from the built-up underside down to the sea, and now and then a flicker inside the cloud with no bolt
    if (Math.random() < kind.bolts * DT && s.x < W && s.x + s.w > 0){ const bx = s.x + s.w * (.15 + .7 * Math.random());
      if (bankMAt(B, bx) > .5){ bolt(bx, base, bx + slant * 70 + (Math.random() - .5) * 70, wy(2, bx), { far:true, sea:true, cy:base - 18 * k, r:110 * k }); s.flash = .6; } }
    else if (Math.random() < .3 * DT && s.x + s.w * .2 < W && s.x + s.w * .8 > 0){ const gx = s.x + s.w * (.2 + .6 * Math.random());
      if (bankMAt(B, gx) > .4){ (SC.glows || (SC.glows = [])).push({ x:gx, y:base - 24 * k, r:85 * k, life:.28, max:.28 }); s.flash = .3;
        sfx("rumble", thunderLag(gx) + Math.random() * .4); } }   // the flicker's rumble comes as late as its distance says
    // rain driven by the wind (harder and more slanted in a gale), splashing on the sea under the cloud; the following wind slants it
    // ahead, toward the bows (it starts a little behind where it leaves the cloud so the slant still fills it). It falls only from the
    // parts of the bank that have built up, as heavily as they have
    const n = nPer(kind.dark * 7), vx = 90 + 380 * lvl, vy = 620 + 160 * lvl;
    for (let q = 0; q < n; q++){ const rx = s.x - s.w * .1 + Math.random() * s.w * 1.1; if (rx > -20 && rx < W + 80 && Math.random() < bankMAt(B, rx)) spawn({ k:"rain", x:rx, y:base + Math.random() * H * .12, vx, vy, life:.9, max:.9, r:1 }); }
    if (!calm()){ const m = (1.2 + 2.2 * lvl) * DT * 60; for (let q = 0; q < Math.floor(m) + (Math.random() < m % 1 ? 1 : 0); q++){ const L = 2 + Math.floor(Math.random() * 3), x0 = s.x + s.w * Math.random(), x = x0 + vx / vy * (H * LAY[L].y - base);
      if (x > 0 && x < W && Math.random() < bankMAt(B, x0)) spawn({ k:"drip", z:L, x, y:wy(L, x), vx:0, vy:0, life:.36, max:.36, r:1.2, L }); } }
    rainAmt = Math.max(rainAmt, bankMAt(B, fx) * (.5 + .5 * lvl));
    // just past the fleet: maybe a rainbow in the rain it leaves behind, if the sun is up and behind the fleet (a rainbow faces away from the sun)
    // (and only once the sun is low enough to leave a real arc above the horizon: see sunElev())
    if (s.x + s.w < fx && s.x + s.w - s.vx * DT * 1.5 >= fx && !SC.rainbow && SC.sunA > .35 && SC.sunX > W * .45 && sunElev() < 36 && Math.random() < .6) SC.rainbow = { t0:SC.t, x:W * (.12 + .1 * Math.random()) };
  }
  // the sky lit from inside the cloud where lightning leaves it
  const gl = SC.glows || [];
  for (const o of gl){ o.life -= DT; const a = clamp(o.life / o.max, 0, 1), g = cx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
    g.addColorStop(0, `rgba(255,250,228,${.5 * a})`); g.addColorStop(1, "rgba(225,228,255,0)"); cx.fillStyle = g; cx.fillRect(o.x - o.r, o.y - o.r, o.r * 2, o.r * 2); }
  SC.glows = gl.filter(o => o.life > 0);
  weatherSound(over ? 0 : rainAmt);
}
function weatherSound(amt){ if (AU.ctx && AU.rainG) AU.rainG.gain.setTargetAtTime(G.sound ? amt * .09 : 0, AU.ctx.currentTime, .4); }
// the sun's height above the horizon in degrees, read off where drawSky put it: about 55 at the start of a voyage, near 0 at sunset
const sunElev = () => SC.sunY == null ? 20 : clamp((H * LAY[0].y - SC.sunY) / (H * .38), 0, 1) * 55;
// a rainbow arching over the rain a storm has left behind; it stays where it is in the sky (the ships sail on beneath it) and fades.
// A rainbow is a ring 42 degrees round the point straight opposite the sun, which lies as far below the horizon as the sun is above it:
// a low sun gives a tall bow, nearly a half-circle at sunset; a higher sun sinks the ring so only a low, flat arc shows; above 42 there is none
function drawRainbow(){
  const rb = SC.rainbow; if (!rb) return; const t = SC.t - rb.t0, life = 7.5; if (t > life){ SC.rainbow = null; return; }
  const el = sunElev(), a = .22 * clamp(t / 1.2, 0, 1) * clamp((life - t) / 2.5, 0, 1) * clamp(SC.sunA / .35, 0, 1) * clamp((42 - el) / 8, 0, 1); if (a < .01) return;
  const hz = H * LAY[0].y + 4, r0 = Math.min(W * .36, H * .46), bw = Math.max(2.5, r0 * .024), cy = hz + r0 * el / 42;   // the ring's centre sits below the horizon
  cx.save(); cx.beginPath(); cx.rect(0, 0, W, hz); cx.clip(); cx.globalAlpha = a; cx.lineWidth = bw + .6;
  ["#ff5a4e", "#ffa23c", "#ffe066", "#7fdc6a", "#4fb4ff", "#6a6cff", "#b36bff"].forEach((c, i) => { cx.strokeStyle = c; cx.beginPath(); cx.arc(rb.x, cy, r0 - i * bw, Math.PI, Math.PI * 2); cx.stroke(); });
  cx.restore();
}
// ---------- wreckage: what a sinking leaves behind depends on the ship that sank and on what sank her ----------
// each ship's own paint and cloth: hull, trim, sailcloth, the mark on the sail, and the one thing only she carried
const WRK = { Carrack:{ hull:"#8b4a2b", trim:"#ffc93c", sail:"#fff4e0", mark:"#d6322f", relic:"pennant" }, Caravel:{ hull:"#a8652f", trim:"#ffe08a", sail:"#fff4e0", mark:"#d6322f", relic:"yard" },
  GalleonEN:{ hull:"#5a3420", trim:"#d9a54a", sail:"#fbf6ea", mark:"#d9a54a", relic:"flag" }, Bark:{ hull:"#2b2a33", trim:"#d9a54a", sail:"#f3ead6", mark:null, relic:"flag" },
  Longship:{ hull:"#9c4d2c", trim:"#ffc93c", sail:"#e8402f", mark:"#fffaf0", relic:"shield" }, Junk:{ hull:"#7a3b2a", trim:"#ffc93c", sail:"#ff7a3c", mark:"#0a0f28", relic:"jar" } };
// the list for one sinking: [kind, details, seconds into the sinking]. Lightning leaves her burning, the kraken leaves her crushed in an ink slick,
// a rogue wave leaves her keel-up, a reef leaves her bow standing on the rocks, the whale breaks her in two, ice leaves frost and floes,
// and pirates leave fire, arrows or shot holes and an emptied chest
function wreckFor(s){
  const c = WRK[s.design] || WRK.Carrack, fr = s.kind === "freight", cargo = fr ? ["crate", "sack", "barrel"] : ["barrel", "crate", "barrel"], rel = [c.relic || "plank"], arrows = s.shot === "arrow";
  let L;
  switch (s.cause){
    case "lightning": L = [["charred"], ["mast", { burn:1 }], rel, ["sail", { burn:1 }], ["charred"]]; break;
    case "kraken": L = [["ink"], ["hull", { part:"stern", sm:1 }, .75], ["plank", { suck:1 }], ["mast", { snap:1 }, .6], rel, ["hull", { part:"bow", sm:1 }, .9]]; break;
    case "wave": L = [["sail", {}, .7], ["keel", {}, 1.2], rel, [cargo[0]], ["plank"]]; break;
    case "reef": L = [["plank", { hole:1 }], [cargo[0]], ["hull", { part:"bow", up:1 }, .8], rel, [cargo[1]], ["plank"]]; break;
    case "whale": L = [["hull", { part:"stern" }, .75], ["sail"], rel, [cargo[0]], ["hull", { part:"bow" }, .75]]; break;
    case "iceberg": L = [["ice"], ["plank", { frost:1 }], ["hull", { part:"bow", frost:1 }, .8], ["ice"], rel, ["mast", { frost:1 }]]; break;
    case "pirates": L = [["charred"], ["chest"], ["plank", arrows ? { arrows:1 } : { hole:1 }], rel, ["hull", { part:"stern", sm:1, hole:!arrows }, 1], ["charred"]]; break;
    default: L = [["plank"], [cargo[0]], rel, ["plank"], [cargo[1]]];
  }
  if (fr) L.splice(2, 0, [cargo[2]]);
  const wide = s.cause === "whale" || s.cause === "reef" ? 1.15 : .92;
  return L.map(([d, f = {}, at = .5], i) => ({ d, f, at, dx:((i + .5) / L.length - .5) * wide }));
}
// smoke, bubbles, foam rings and the wreckage, piece by piece as she breaks up
function sinkFx(s){
  const P = shipPose(s), L = s.row ? 3 : 2, surf = wy(L, P.x);
  // the fire and its smoke burn on her deck only while the deck is above the water: once she goes under they stop (the smoke already
  // in the air drifts off), so no smoke rises out of the sea from a sunken hull
  const fireY = P.y - P.h * .45, smokeY = P.y - P.h * .6, afloat = fireY < surf - 3;
  if ((s.cause === "lightning" && s.st < 1.1 || s.cause === "pirates" && s.st > .85 && s.st < 1.8) && afloat) for (let n = nPer(.6); n > 0; n--){ spawn({ k:"fire", z:L, x:P.x + (Math.random() - .5) * P.bw * .4, y:fireY, vx:(Math.random() - .5) * 20, vy:-60, life:.5, max:.5, r:3 + Math.random() * 3, c:Math.random() < .5 ? "#ffb347" : "#ff5a3c" });
    { const sk = clamp(P.bw / 110, .6, 1.1); if (smokeY < surf - 3) spawn({ k:"smoke", z:L, x:P.x, y:smokeY, vx:(12 + Math.random() * 16) * sk, vy:-35 * sk, life:1.4, max:1.4, r:(6 + Math.random() * 6) * sk, g:14 * sk }); } }
  if (s.st > .3) for (let n = nPer((s.cause === "kraken" ? .25 : .5)); n > 0; n--) spawn({ k:"bubble", z:L, x:P.x + (Math.random() - .5) * P.bw * .5, y:surf + 7 + Math.random() * 7, vx:(Math.random() - .5) * 16, vy:-14, life:.9, max:.9, r:2 + Math.random() * 3 });
  // the kraken's grip splinters her
  if (s.cause === "kraken" && s.st > .5 && s.st < 1.2) for (let n = nPer(.35); n > 0; n--) spawn({ k:"chip", z:L, x:P.x + (Math.random() - .5) * P.bw * .6, y:P.y - P.h * (.1 + Math.random() * .3), vx:(Math.random() - .5) * 160, vy:-60 - Math.random() * 110, life:.7, max:.7, r:1 });
  // the whale drops her back on the sea: one hard splash where she lands (the frame her clock passes .64 s)
  if (s.cause === "whale" && s.st >= .64 && s.st - DT < .64){ spawn({ k:"ring", z:L, x:P.x, y:surf, vx:0, vy:0, life:1, max:1, r:9, L }); SC.shake = Math.max(SC.shake, .5); sfx("splash");
    for (let q = calm() ? 4 : 12; q > 0; q--){ const e = Math.random() - .5; spawn({ k:"spray", z:L, x:P.x + e * P.bw * .8, y:surf, vx:e * 240, vy:-100 - Math.random() * 120, life:.8, max:.8, r:1.6 + Math.random() * 2 }); } }
  if (!s.fx1 && s.st > .5){ s.fx1 = true; spawn({ k:"ring", z:L, x:P.x, y:surf, vx:0, vy:0, life:1.2, max:1.2, r:6, L }); }
  if (!s.wreck) s.wreck = wreckFor(s);
  for (const it of s.wreck){ if (it.done || s.st < it.at) continue; it.done = true; const d = it.d;
    spawn({ k:"debris", d, f:it.f, c:WRK[s.design] || WRK.Carrack, v:s.design, sz:clamp(P.bw / 105, .62, 1.15), z:L - .5, x:P.x + it.dx * P.bw + (Math.random() - .5) * 6, y:surf, vx:0, vy:0, life:7, max:7, r:1,
      w:d === "mast" || d === "yard" ? 58 : d === "keel" ? 66 : d === "hull" ? (it.f.sm ? 30 : 42) : 10 + Math.random() * 12, rot:d === "ink" || d === "keel" || d === "flag" ? 0 : (Math.random() - .5) * (d === "hull" ? .3 : 1.2), L, ph:Math.random() * 6 }); }
  if (!s.fx2 && s.st > 1.3){ s.fx2 = true; spawn({ k:"ring", z:L, x:P.x, y:surf, vx:0, vy:0, life:1.2, max:1.2, r:10, L }); sfx("splash"); }
}
// one piece of wreckage. p.c = the ship's colours, p.v = her design, p.f = what the disaster did to this piece
function drawDebris(p, a){
  const d = p.d || "plank", w2 = p.w, c = p.c || WRK.Carrack, f = p.f || {}, v = p.v, bob = calm() ? 0 : Math.sin(SC.t * 2 + p.ph);
  const flame = (x, y) => { if (a <= .5) return; const fk = .65 + .35 * Math.sin(SC.t * 22 + p.ph); cx.fillStyle = "#ff8a3c"; cx.beginPath(); cx.arc(x, y, 3.4 * fk, 0, 7); cx.fill(); cx.fillStyle = "#ffd36b"; cx.beginPath(); cx.arc(x, y, 1.7 * fk, 0, 7); cx.fill();
    for (let n = nPer(.06); n > 0; n--) spawn({ k:"smoke", z:p.z, x:p.x, y:p.y - 8, vx:12, vy:-26, life:1.2, max:1.2, r:3 + Math.random() * 3 }); };
  const frost = (x0, x1, y) => { cx.strokeStyle = "rgba(255,255,255,.95)"; cx.lineWidth = 1.8; cx.lineCap = "round"; cx.beginPath(); cx.moveTo(x0, y); cx.lineTo(x1, y); cx.stroke(); cx.lineCap = "butt"; cx.strokeStyle = INK; cx.lineWidth = 2; };
  // the mark this ship wore on her sails, drawn inside the current clip over a cloth spanning x0..x1, y0..y1
  const sailMark = (x0, x1, y0, y1) => { const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    if (v === "Carrack" || v === "Caravel"){ cx.strokeStyle = c.mark; cx.lineWidth = 3; cx.beginPath(); cx.moveTo(mx, y0); cx.lineTo(mx, y1); cx.moveTo(x0 + 4, my); cx.lineTo(x1 - 4, my); cx.stroke(); }
    else if (v === "Longship"){ cx.fillStyle = c.mark; for (let x = x0 + 4; x < x1; x += 9) cx.fillRect(x, y0 - 4, 4, y1 - y0 + 8); }
    else if (v === "Junk"){ cx.strokeStyle = INK; cx.lineWidth = 1.2; for (let x = x0 + 6; x < x1; x += 7){ cx.beginPath(); cx.moveTo(x, y0 - 4); cx.lineTo(x, y1 + 4); cx.stroke(); } }
    else if (v === "GalleonEN"){ cx.strokeStyle = c.mark; cx.lineWidth = 3; cx.beginPath(); cx.moveTo(x0, my); cx.lineTo(x1, my); cx.stroke(); }
    else { cx.strokeStyle = "rgba(10,15,40,.3)"; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(x0, my); cx.lineTo(x1, my); cx.stroke(); } };
  cx.save(); cx.globalAlpha = Math.min(1, a * 3); cx.translate(p.x, p.y); cx.rotate(p.rot); if (p.sz) cx.scale(p.sz, p.sz); cx.strokeStyle = INK; cx.lineWidth = 2; cx.lineJoin = "round";
  if (d === "ink"){ const rr = 12 + (1 - a) * 50, g2 = cx.createRadialGradient(0, 0, 2, 0, 0, rr); g2.addColorStop(0, `rgba(46,22,70,${.6 * a})`); g2.addColorStop(1, "rgba(46,22,70,0)"); cx.scale(1, .26); cx.fillStyle = g2; cx.beginPath(); cx.arc(0, 8, rr, 0, 7); cx.fill(); }
  else if (d === "shield"){ const red = p.ph > 3; cx.fillStyle = red ? "#e8402f" : "#ffc93c"; cx.beginPath(); cx.arc(0, -4, 7, 0, 7); cx.fill(); cx.stroke();
    if (red){ cx.strokeStyle = "#fffaf0"; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(-6, -4); cx.lineTo(6, -4); cx.moveTo(0, -10); cx.lineTo(0, 2); cx.stroke(); } cx.fillStyle = INK; cx.beginPath(); cx.arc(0, -4, 2, 0, 7); cx.fill(); }
  else if (d === "barrel" || d === "keg"){ cx.fillStyle = d === "keg" ? "#4a3a30" : "#a5532f"; cx.beginPath(); cx.ellipse(0, -4, 7, 9, 0, 0, 7); cx.fill(); cx.stroke(); cx.strokeStyle = "#ffc93c"; cx.beginPath(); cx.moveTo(-7, -4); cx.lineTo(7, -4); if (d === "keg"){ cx.moveTo(-5.5, -9); cx.lineTo(5.5, -9); cx.moveTo(-5.5, 1); cx.lineTo(5.5, 1); } cx.stroke(); }
  else if (d === "crate"){ cx.fillStyle = "#c08a50"; cx.fillRect(-6, -10, 12, 12); cx.strokeRect(-6, -10, 12, 12); cx.lineWidth = 1.4; cx.beginPath(); cx.moveTo(-6, -10); cx.lineTo(6, 2); cx.moveTo(6, -10); cx.lineTo(-6, 2); cx.stroke(); }
  else if (d === "sack"){ cx.fillStyle = "#d9c49a"; cx.beginPath(); cx.moveTo(-7, 2); cx.quadraticCurveTo(-9, -8, -2, -9); cx.lineTo(-3, -12); cx.lineTo(3, -12); cx.lineTo(2, -9); cx.quadraticCurveTo(9, -8, 7, 2); cx.closePath(); cx.fill(); cx.stroke(); cx.lineWidth = 1.2; cx.beginPath(); cx.moveTo(-3, -9); cx.lineTo(3, -9); cx.stroke(); }
  else if (d === "jar"){ cx.fillStyle = "#f4f7fb"; cx.beginPath(); cx.moveTo(-2.5, -14); cx.lineTo(2.5, -14); cx.lineTo(2.5, -11); cx.quadraticCurveTo(8, -8, 5.5, 1); cx.lineTo(-5.5, 1); cx.quadraticCurveTo(-8, -8, -2.5, -11); cx.closePath(); cx.fill(); cx.stroke();
    cx.strokeStyle = "#2f5d9e"; cx.lineWidth = 1.6; cx.beginPath(); cx.moveTo(-5.6, -6.5); cx.quadraticCurveTo(0, -4.5, 5.6, -6.5); cx.moveTo(-5.4, -2); cx.quadraticCurveTo(0, 0, 5.4, -2); cx.stroke(); cx.fillStyle = "#2f5d9e"; cx.beginPath(); cx.arc(0, -4, 1.3, 0, 7); cx.fill(); }
  else if (d === "chest"){ cx.fillStyle = "#3a2418"; cx.fillRect(-9, -8, 18, 4); cx.fillStyle = "#8a4b26"; cx.fillRect(-9, -5, 18, 8); cx.strokeRect(-9, -8, 18, 11); cx.fillStyle = "#ffc93c"; cx.fillRect(-9, -1.5, 18, 2.2);
    cx.save(); cx.translate(-9, -8); cx.rotate(-1.15); cx.fillStyle = "#9c5a2e"; cx.beginPath(); cx.moveTo(0, 0); cx.lineTo(18, 0); cx.quadraticCurveTo(18, -6, 9, -7); cx.quadraticCurveTo(0, -6, 0, 0); cx.closePath(); cx.fill(); cx.stroke(); cx.restore(); }
  else if (d === "pennant"){ cx.fillStyle = "#7a5230"; cx.fillRect(-10, -2, 14, 4); cx.strokeRect(-10, -2, 14, 4); cx.fillStyle = c.mark || "#d6322f"; cx.beginPath(); cx.moveTo(-6, -2); cx.lineTo(-4, -11 - bob); cx.lineTo(13, -6 + bob * 1.5); cx.lineTo(2, -2); cx.closePath(); cx.fill(); cx.stroke(); }
  else if (d === "flag"){ const x0 = -12, x1 = 12, wav = x => Math.sin(x * .35 + SC.t * 2.4 + p.ph) * 1.6 * (calm() ? 0 : 1);
    const o = new Path2D(); for (let x = x0; x <= x1; x += 3) x === x0 ? o.moveTo(x, -11 + wav(x)) : o.lineTo(x, -11 + wav(x)); for (let x = x1; x >= x0; x -= 3) o.lineTo(x, 1 + wav(x + 4)); o.closePath();
    cx.fillStyle = v === "Bark" ? "#24407a" : "#ffffff"; cx.fill(o); cx.save(); cx.clip(o);
    if (v === "Bark"){ cx.strokeStyle = "#fff"; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(x0, -11); cx.lineTo(x1, 1); cx.moveTo(x1, -11); cx.lineTo(x0, 1); cx.stroke(); cx.lineWidth = 4.5; cx.beginPath(); cx.moveTo(0, -13); cx.lineTo(0, 3); cx.moveTo(x0, -5); cx.lineTo(x1, -5); cx.stroke(); }
    cx.strokeStyle = "#d6322f"; cx.lineWidth = 2.6; cx.beginPath(); cx.moveTo(0, -13); cx.lineTo(0, 3); cx.moveTo(x0, -5); cx.lineTo(x1, -5); cx.stroke(); cx.restore(); cx.strokeStyle = INK; cx.lineWidth = 2; cx.stroke(o); }
  else if (d === "yard"){ cx.rotate(-.12); cx.fillStyle = c.sail; cx.beginPath(); cx.moveTo(-w2 * .4, -1); cx.lineTo(w2 * .42, -1); cx.lineTo(w2 * .3, -13 - bob * 1.5); cx.quadraticCurveTo(0, -9, -w2 * .4, -1); cx.closePath(); cx.fill(); cx.stroke();
    cx.strokeStyle = c.mark; cx.lineWidth = 2.4; cx.beginPath(); cx.moveTo(w2 * .2, -9); cx.lineTo(w2 * .2, -2); cx.moveTo(w2 * .1, -5.5); cx.lineTo(w2 * .3, -5.5); cx.stroke(); cx.strokeStyle = INK; cx.lineWidth = 2;
    cx.fillStyle = "#7a5230"; cx.fillRect(-w2 / 2, -2, w2, 4); cx.strokeRect(-w2 / 2, -2, w2, 4); }
  else if (d === "mast"){ cx.fillStyle = f.burn ? "#3a2a22" : v === "Junk" ? "#b58a4a" : "#7a5230"; cx.fillRect(-w2 / 2, -3, w2, 5); cx.strokeRect(-w2 / 2, -3, w2, 5);
    if (f.snap){ cx.fillStyle = "#e9c08a"; cx.beginPath(); cx.moveTo(w2 / 2, -3); cx.lineTo(w2 / 2 + 6, -2); cx.lineTo(w2 / 2 + 1, -.5); cx.lineTo(w2 / 2 + 7, 1); cx.lineTo(w2 / 2, 2); cx.closePath(); cx.fill(); cx.stroke(); }
    const fl = bob * 2, o = new Path2D(); o.moveTo(-w2 * .12, -3); o.lineTo(w2 * .3, -3); o.lineTo(w2 * .25, -13 - fl); o.lineTo(w2 * .12, -9); o.lineTo(-w2 * .03, -14 + fl); o.closePath();
    cx.fillStyle = f.burn ? "#6b5646" : c.sail; cx.fill(o); if (!f.burn){ cx.save(); cx.clip(o); sailMark(-w2 * .12, w2 * .3, -11, -5); cx.restore(); cx.strokeStyle = INK; cx.lineWidth = 2; } cx.stroke(o);
    if (f.burn) flame(w2 * .34, -6); if (f.frost) frost(-w2 / 2 + 3, w2 / 2 - 3, -3.6); }
  else if (d === "sail"){ const o = new Path2D(); o.moveTo(-19, 2); for (let i = 0; i <= 8; i++) o.lineTo(-19 + i * 4.75, -9 - (calm() ? 0 : Math.sin(i * 1.1 + SC.t * 2 + p.ph) * 2.5)); o.lineTo(19, 2); o.closePath();
    cx.fillStyle = f.burn ? "#8a7560" : c.sail; cx.fill(o); cx.save(); cx.clip(o); sailMark(-19, 19, -8, 1);
    if (f.burn){ cx.fillStyle = "#2a1e1a"; [[-9, -4, 3.2], [6, -2, 2.6], [13, -6, 2]].forEach(([x, y, r]) => { cx.beginPath(); cx.arc(x, y, r, 0, 7); cx.fill(); }); cx.strokeStyle = "#ff8a3c"; cx.lineWidth = 1.2; cx.beginPath(); cx.arc(-9, -4, 3.6, 0, 7); cx.stroke(); }
    cx.restore(); cx.strokeStyle = INK; cx.lineWidth = 2; cx.stroke(o); }
  else if (d === "keel"){ // capsized: the bottom of the hull, keel uppermost, weed along what was her waterline, rolling gently and settling
    cx.translate(0, (1 - a) * 9); cx.rotate(bob * .04); cx.beginPath(); cx.moveTo(-w2 * .5, 3); cx.quadraticCurveTo(-w2 * .46, -w2 * .3, -w2 * .12, -w2 * .32); cx.lineTo(w2 * .2, -w2 * .3); cx.quadraticCurveTo(w2 * .47, -w2 * .26, w2 * .5, 3); cx.closePath();
    cx.fillStyle = rgb(mixC(c.hull, "#1a1420", .25)); cx.fill(); cx.save(); cx.clip(); cx.fillStyle = "rgba(62,110,58,.55)"; cx.fillRect(-w2 * .5, -3, w2, 7); cx.restore(); cx.stroke();
    cx.lineWidth = 3; cx.beginPath(); cx.moveTo(-w2 * .22, -w2 * .32); cx.lineTo(w2 * .28, -w2 * .3); cx.stroke(); cx.lineWidth = 2;
    cx.fillStyle = rgb(mixC(c.hull, "#1a1420", .1)); cx.beginPath(); cx.moveTo(-w2 * .4, -w2 * .2); cx.lineTo(-w2 * .5, -w2 * .42); cx.lineTo(-w2 * .32, -w2 * .27); cx.closePath(); cx.fill(); cx.stroke(); }
  else if (d === "hull"){ const bow = f.part !== "stern", m = bow ? 1 : -1; cx.translate(0, (1 - a) * (f.up ? 5 : 12)); cx.rotate(m * (f.up ? -.8 : -.35) + bob * .03); cx.scale(m, 1);
    const o = new Path2D(); o.moveTo(-w2 * .5, 3);
    if (bow){ o.lineTo(w2 * .4, 3); o.quadraticCurveTo(w2 * .58, -w2 * .12, w2 * .5, -w2 * .52); o.lineTo(w2 * .3, -w2 * .34); o.lineTo(w2 * .08, -w2 * .22); o.lineTo(-w2 * .1, -w2 * .44); o.lineTo(-w2 * .3, -w2 * .2); }
    else { o.lineTo(w2 * .45, 3); o.lineTo(w2 * .5, -w2 * .56); o.lineTo(w2 * .2, -w2 * .56); o.lineTo(w2 * .2, -w2 * .34); o.lineTo(0, -w2 * .4); o.lineTo(-w2 * .16, -w2 * .18); o.lineTo(-w2 * .32, -w2 * .32); }
    o.closePath(); cx.fillStyle = c.hull; cx.fill(o); cx.save(); cx.clip(o);
    cx.strokeStyle = c.trim; cx.lineWidth = 2.5; cx.beginPath(); cx.moveTo(-w2 * .5, -w2 * .1); cx.lineTo(w2 * .56, -w2 * .16); cx.stroke();
    if (v === "GalleonEN"){ cx.strokeStyle = "#c9353f"; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(-w2 * .5, -w2 * .01); cx.lineTo(w2 * .56, -w2 * .06); cx.stroke(); }
    if (f.hole){ cx.fillStyle = "#1a1214"; cx.beginPath(); cx.arc(w2 * .12, -w2 * .04, w2 * .07, 0, 7); cx.fill(); }
    cx.restore(); cx.strokeStyle = INK; cx.lineWidth = 2; cx.stroke(o);
    // what marks her out: the junk's painted eye, the longship's shields, the carrack's and the bark's stern windows
    if (bow && v === "Junk"){ cx.fillStyle = "#fffaf0"; cx.beginPath(); cx.arc(w2 * .34, -w2 * .26, w2 * .075, 0, 7); cx.fill(); cx.lineWidth = 1.4; cx.stroke(); cx.fillStyle = INK; cx.beginPath(); cx.arc(w2 * .36, -w2 * .26, w2 * .035, 0, 7); cx.fill(); }
    else if (v === "Longship"){ cx.lineWidth = 1.4; for (const x of [-.2, .08]){ cx.fillStyle = "#ffc93c"; cx.beginPath(); cx.arc(w2 * x, -w2 * .04, w2 * .085, 0, 7); cx.fill(); cx.stroke(); } }
    else if (!bow && (v === "Carrack" || v === "Bark")){ cx.lineWidth = 1.2; cx.fillStyle = c.trim; for (const x of [.26, .38]){ cx.fillRect(w2 * x - 2, -w2 * .46, 4, 4); cx.strokeRect(w2 * x - 2, -w2 * .46, 4, 4); } }
    if (f.frost){ frost(w2 * .3, w2 * .5, -w2 * .5); frost(-w2 * .3, -w2 * .12, -w2 * .3); } }
  else if (d === "ice"){ cx.fillStyle = "#eef9ff"; cx.beginPath(); cx.moveTo(-10, 3); cx.lineTo(-7, -6); cx.lineTo(1, -10); cx.lineTo(8, -4); cx.lineTo(10, 3); cx.closePath(); cx.fill(); cx.stroke(); cx.fillStyle = "#b9e2f3"; cx.beginPath(); cx.moveTo(1, -10); cx.lineTo(8, -4); cx.lineTo(10, 3); cx.lineTo(3, 3); cx.closePath(); cx.fill(); }
  else if (d === "charred"){ cx.fillStyle = "#3a2a22"; cx.fillRect(-w2 / 2, -3, w2, 5); cx.strokeRect(-w2 / 2, -3, w2, 5); flame(0, -5); }
  else { cx.fillStyle = rgb(mixC(c.hull, "#e0b080", .45)); cx.fillRect(-w2 / 2, -3, w2, 5); cx.strokeRect(-w2 / 2, -3, w2, 5);
    if (f.hole){ cx.fillStyle = "#1a1214"; cx.beginPath(); cx.moveTo(-2, -3); cx.lineTo(0, 0); cx.lineTo(3, -3); cx.closePath(); cx.fill(); }
    if (f.suck){ cx.strokeStyle = "rgba(215,180,246,.95)"; cx.lineWidth = 1.2; for (const x of [-w2 * .22, w2 * .12]){ cx.beginPath(); cx.arc(x, -.5, 1.6, 0, 7); cx.stroke(); } }
    if (f.arrows){ for (const [x, an] of [[-w2 * .2, -1.2], [w2 * .15, -1.75]]){ cx.strokeStyle = "#5a3a1a"; cx.lineWidth = 1.5; cx.beginPath(); cx.moveTo(x, -2); cx.lineTo(x + Math.cos(an) * 11, -2 + Math.sin(an) * 11); cx.stroke(); cx.fillStyle = "#e8e8f0"; cx.beginPath(); cx.arc(x + Math.cos(an) * 11, -2 + Math.sin(an) * 11, 1.6, 0, 7); cx.fill(); } }
    if (f.frost) frost(-w2 / 2 + 2, w2 / 2 - 2, -3.6); }
  cx.restore();
}
function drawCoin(x, y, r, spin, al = 1){
  const c = Math.abs(Math.cos(spin)), w = Math.max(r * .2, r * c);
  cx.globalAlpha = al; cx.lineWidth = 1.5; cx.strokeStyle = INK; cx.fillStyle = "#c8860d"; cx.beginPath(); cx.ellipse(x, y, w, r, 0, 0, 7); cx.fill(); cx.stroke();
  if (c > .32){ cx.fillStyle = "#ffcf3f"; cx.beginPath(); cx.ellipse(x, y - r * .07, w * .8, r * .8, 0, 0, 7); cx.fill();
    cx.strokeStyle = "#e39e14"; cx.lineWidth = Math.max(.8, r * .15); cx.beginPath(); cx.ellipse(x, y - r * .07, w * .5, r * .5, 0, 0, 7); cx.stroke();
    cx.fillStyle = "rgba(255,251,222,.92)"; cx.beginPath(); cx.ellipse(x - w * .36, y - r * .42, w * .22, r * .15, -.5, 0, 7); cx.fill();
    if (c > .94){ const g = r * .75 * (c - .94) / .06, gx = x + w * .42, gy = y - r * .5; cx.fillStyle = "#fff"; cx.beginPath(); cx.moveTo(gx, gy - g); cx.lineTo(gx + g * .25, gy - g * .25); cx.lineTo(gx + g, gy); cx.lineTo(gx + g * .25, gy + g * .25); cx.lineTo(gx, gy + g); cx.lineTo(gx - g * .25, gy + g * .25); cx.lineTo(gx - g, gy); cx.lineTo(gx - g * .25, gy - g * .25); cx.closePath(); cx.fill(); } }
  else { cx.strokeStyle = "#ffe08a"; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(x, y - r * .7); cx.lineTo(x, y + r * .7); cx.stroke(); }
  cx.globalAlpha = 1;
}
// each particle belongs to a depth: the water layer it sits on (1 shore, 2 back row, 3 front row; 1.5 and 2.5 are wreckage, which floats
// just behind that row's ships) or 5 for the foreground
function drawParticles(z){
  const g = GRAV();
  for (const p of SC.parts){ if ((p.z || 5) !== z) continue;
    p.life -= DT;
    // aimed shots fly their exact arc and land on the frame they get there, whatever the frame rate
    if (p.k === "ball" || p.k === "arrow"){ if (p.ox == null){ p.ox = p.x; p.oy = p.y; p.ovy = p.vy; } const t = p.max - Math.max(0, p.life);
      p.vy = p.ovy + g * t; p.x = p.ox + p.vx * t; p.y = p.oy + p.ovy * t + .5 * g * t * t; }
    // plunder flies a true arc to a moving deck (p.dst.deck, the raider's, kept up each frame): the arc is worked out afresh every frame
    // for where the deck is now, so the coin lands on it exactly at the end of its flight, however she has pitched or moved meanwhile
    else if (p.dst){ if (p.ox == null){ p.ox = p.x; p.oy = p.y; } const T = p.max, t = Math.min(T, T - p.life), u = t / T, d = p.dst.deck || [p.ox, p.oy];
      p.x = p.ox + (d[0] + p.dx - p.ox) * u; p.y = p.oy + (d[1] - p.oy) * u + .5 * g * t * (t - T) - p.hop * 4 * u * (1 - u); }
    // everything else: speed first, then position (steadier than the other way round); bubbles float up
    else { if (!NOFALL[p.k]) p.vy += (p.z && p.z < 5 ? g : 260) * DT; else if (p.k === "bubble") p.vy -= 20 * DT; p.x += p.vx * DT; p.y += p.vy * DT; }
    if (p.k === "debris"){ p.x -= SC.speed * LAY[p.L].s * DT;   // wreckage drifts exactly with the water (and with the wreck it came from)
      p.y = wy(p.L, p.x) - 2; if (p.d !== "ink") p.rot += Math.sin(SC.t * 2 + p.x) * DT * .6; }
    else if (p.k === "foam"){ p.r += 9 * DT; p.x -= SC.speed * LAY[p.L].s * DT; p.y = wy(p.L, p.x) + 1; }
    else if (p.k === "ring" || p.k === "smoke"){ p.r += (p.k === "ring" ? p.g || 46 : p.g || 14) * DT; if (p.wob != null) p.x += Math.sin(SC.t * 2.3 + p.wob) * 5 * DT; if (p.k === "ring") p.x -= SC.speed * LAY[p.L].s * DT; }
    else if (p.k === "snow"){ p.x += Math.sin(SC.t * 2 + p.ph) * 12 * DT; }
    else if (p.k === "arrow"){ if (p.life <= 0){ for (let q = 0; q < 4; q++) spawn({ k:"fire", z:p.z, x:p.x, y:p.y, vx:(Math.random() - .5) * 60, vy:-30 - Math.random() * 50, life:.45, max:.45, r:2 + Math.random() * 2, c:Math.random() < .5 ? "#ffb347" : "#ff5a3c" }); continue; } }
    else if (p.k === "flash"){ }
    else if (p.k === "ball"){ if (p.life <= 0){   // it strikes where it lands (and isn't drawn again)
      if (p.miss){ for (let q = 0; q < 12; q++) spawn({ k:"spray", z:p.z, x:p.x + (Math.random() - .5) * 8, y:p.y, vx:(Math.random() - .5) * 40, vy:-90 - Math.random() * 100, life:.8, max:.8, r:1.6 + Math.random() * 2 }); spawn({ k:"ring", z:p.z, x:p.x, y:p.y + 2, vx:0, vy:0, life:.8, max:.8, r:6, L:p.z }); sfx("splash"); }
      else { for (let q = 0; q < 8; q++) spawn({ k:"fire", z:p.z, x:p.x, y:p.y, vx:(Math.random() - .5) * 160, vy:-40 - Math.random() * 100, life:.5, max:.5, r:2 + Math.random() * 3, c:Math.random() < .5 ? "#ffb347" : "#ff5a3c" });
        for (let q = 0; q < 8; q++) spawn({ k:"chip", z:p.z, x:p.x, y:p.y, vx:(Math.random() - .3) * 200, vy:-80 - Math.random() * 140, life:.8, max:.8, r:1 }); sfx("crack"); } continue; } }
    else if (p.k === "drip"){ p.r += 14 * DT; p.x -= SC.speed * LAY[p.L].s * DT; p.y = wy(p.L, p.x) + 1; }
    // a bubble rides the water astern and pops when it reaches the surface; it never climbs into the air
    else if (p.k === "bubble"){ p.x -= SC.speed * LAY[p.z].s * DT; if (p.y - p.r * .6 <= wy(p.z, p.x)){ p.life = 0; splashRing(p.z, p.x, p.r * .7); continue; } }
    // spray falls back into the sea and makes a tiny ring there (a drop still in the air stays faintly in sight until it lands);
    // a chip of wood that reaches the water is gone under it
    else if ((p.k === "spray" || p.k === "chip") && p.z && p.z < 5 && (p.z | 0) === p.z){ p.age = (p.age || 0) + DT;
      if (p.vy > 0 && p.y >= wy(p.z, p.x)){ p.life = 0; if (p.k === "spray") splashRing(p.z, p.x, 1 + p.r * .6); continue; }
      if (p.k === "spray" && p.life < p.max * .3 && p.age < 3) p.life = p.max * .3; }
    // coins, embers and sparks stop at the water too: a coin goes in with a tiny ring, an ember or a spark goes out on the surface (a quick
    // fade from where it was, riding the water astern) instead of falling on through the sea
    else if ((p.k === "coin" || p.k === "fire" || p.k === "spark") && p.z && p.z < 5 && (p.z | 0) === p.z && !p.dst){
      // (an ember thrown up from a deck already under water never reached the air: it goes out where it is, it isn't lifted to the surface)
      const sw = wy(p.z, p.x); if (p.y < sw) p.air = 1;
      if (p.wet){ p.x -= SC.speed * LAY[p.z].s * DT; p.y = wy(p.z, p.x) + p.dw; }
      else if (p.vy > 0 && p.y >= sw){ if (p.k === "coin" && p.air){ p.life = 0; splashRing(p.z, p.x, 1.5 + p.r * .4); continue; }
        p.wet = 1; p.dw = p.air ? 0 : p.y - sw; p.y = sw + p.dw; p.vx = p.vy = 0; const a0 = clamp(p.life / p.max, .05, 1); p.life = .15; p.max = .15 / a0; } }
    const a = clamp(p.life / p.max, 0, 1);
    if (p.k === "snow"){ cx.fillStyle = `rgba(255,255,255,${.85 * Math.min(1, a * 3)})`; cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 7); cx.fill(); }
    else if (p.k === "arrow"){ const an = Math.atan2(p.vy, p.vx), cs = Math.cos(an), sn = Math.sin(an); cx.strokeStyle = "#5a3a1a"; cx.lineWidth = 1.8; cx.beginPath(); cx.moveTo(p.x - cs * 11, p.y - sn * 11); cx.lineTo(p.x, p.y); cx.stroke();
      cx.fillStyle = "#ffb347"; cx.beginPath(); cx.arc(p.x, p.y, 2.6, 0, 7); cx.fill(); cx.fillStyle = "rgba(255,90,60,.6)"; cx.beginPath(); cx.arc(p.x - cs * 3, p.y - sn * 3, 3.2, 0, 7); cx.fill(); }
    else if (p.k === "flash"){ const g2 = cx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r); g2.addColorStop(0, `rgba(255,255,235,${a})`); g2.addColorStop(.35, `rgba(255,205,100,${.85 * a})`); g2.addColorStop(1, "rgba(255,140,60,0)"); cx.fillStyle = g2; cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 7); cx.fill(); }
    else if (p.k === "chip"){ cx.save(); cx.translate(p.x, p.y); cx.rotate(p.life * 14); cx.fillStyle = "#8b5a2b"; cx.strokeStyle = INK; cx.lineWidth = .8; cx.fillRect(-3.5, -1.3, 7, 2.6); cx.strokeRect(-3.5, -1.3, 7, 2.6); cx.restore(); }
    else if (p.k === "ball"){ cx.strokeStyle = "rgba(40,40,55,.3)"; cx.lineWidth = p.r * 1.3; cx.lineCap = "round"; cx.beginPath(); cx.moveTo(p.x - p.vx * .045, p.y - p.vy * .045); cx.lineTo(p.x, p.y); cx.stroke(); cx.fillStyle = INK; cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 7); cx.fill(); cx.fillStyle = "rgba(255,180,80,.6)"; cx.beginPath(); cx.arc(p.x + 3, p.y + 1, p.r * .9, 0, 7); cx.fill(); }
    else if (p.k === "rain"){ cx.strokeStyle = `rgba(210,225,255,${.6 * a})`; cx.lineWidth = 1.3; cx.beginPath(); cx.moveTo(p.x, p.y); cx.lineTo(p.x - p.vx * .025, p.y - p.vy * .025); cx.stroke(); }
    else if (p.k === "drip"){ cx.strokeStyle = `rgba(228,236,255,${.65 * a})`; cx.lineWidth = 1.1; cx.beginPath(); cx.ellipse(p.x, p.y, p.r * 1.7, p.r * .42, 0, 0, 7); cx.stroke();
      if (a > .35){ cx.fillStyle = `rgba(235,242,255,${.8 * a})`; cx.beginPath(); cx.arc(p.x, p.y - 2 - 9 * Math.sin((1 - a) * Math.PI * 1.4), .9 + p.L * .15, 0, 7); cx.fill(); } }
    else if (p.k === "foam"){ cx.fillStyle = `rgba(255,255,255,${.5 * a})`; cx.beginPath(); cx.ellipse(p.x, p.y, p.r * 1.7, p.r * .42, 0, 0, 7); cx.fill(); }
    else if (p.k === "spray"){ cx.fillStyle = `rgba(255,255,255,${.85 * a})`; cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 7); cx.fill(); }
    else if (p.k === "bubble"){ cx.strokeStyle = `rgba(255,255,255,${a})`; cx.lineWidth = 1.5; cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 7); cx.stroke(); }
    else if (p.k === "glint"){ const g = p.r * Math.sin(a * Math.PI); cx.fillStyle = `rgba(255,246,200,${Math.min(1, a * 2)})`; cx.beginPath(); cx.moveTo(p.x, p.y - g); cx.lineTo(p.x + g * .22, p.y - g * .22); cx.lineTo(p.x + g, p.y); cx.lineTo(p.x + g * .22, p.y + g * .22); cx.lineTo(p.x, p.y + g); cx.lineTo(p.x - g * .22, p.y + g * .22); cx.lineTo(p.x - g, p.y); cx.lineTo(p.x - g * .22, p.y - g * .22); cx.closePath(); cx.fill(); }
    else if (p.k === "spark" && p.gold){ const r = p.r * (1.6 * Math.sin(Math.PI * (1 - a)) + .4);   // a cash-out's gold glint: a 4-point twinkle that swells and shrinks
      cx.fillStyle = `rgba(255,212,90,${a})`; cx.beginPath(); cx.moveTo(p.x, p.y - r * 2); cx.lineTo(p.x + r * .45, p.y - r * .45); cx.lineTo(p.x + r * 2, p.y); cx.lineTo(p.x + r * .45, p.y + r * .45); cx.lineTo(p.x, p.y + r * 2); cx.lineTo(p.x - r * .45, p.y + r * .45); cx.lineTo(p.x - r * 2, p.y); cx.lineTo(p.x - r * .45, p.y - r * .45); cx.closePath(); cx.fill(); }
    else if (p.k === "spark"){ cx.fillStyle = `rgba(255,214,90,${a})`; cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 7); cx.fill(); }
    else if (p.k === "confetti"){ cx.save(); cx.translate(p.x, p.y); cx.rotate(p.life * 9); cx.fillStyle = p.c; cx.globalAlpha = a; cx.fillRect(-4, -2, 8, 4); cx.restore(); }
    else if (p.k === "debris") drawDebris(p, a);
    else if (p.k === "ring"){ cx.strokeStyle = p.gold ? `rgba(255,211,107,${a})` : `rgba(255,255,255,${.8 * a})`; cx.lineWidth = 2; cx.beginPath(); cx.ellipse(p.x, p.y, p.r, p.r * .28, 0, 0, 7); cx.stroke(); }
    else if (p.k === "coin") drawCoin(p.x, p.y, p.r, p.ph + p.life * 7, p.dst ? 1 : Math.min(1, a * 5));   // plunder stays bright till it lands
    else if (p.k === "smoke"){ cx.fillStyle = p.light ? `rgba(236,236,242,${.55 * a})` : `rgba(70,70,85,${.45 * a})`; cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 7); cx.fill(); }
    else if (p.k === "fire"){ cx.fillStyle = p.c; cx.globalAlpha = a; cx.beginPath(); cx.arc(p.x, p.y, p.r, 0, 7); cx.fill(); cx.globalAlpha = 1; }
  }
  if (z === 5){ SC.parts = SC.parts.filter(p => p.life > 0 && p.y < H + 40 && p.x > -60); SC.ambN = SC.parts.reduce((n, p) => n + (AMBIENT[p.k] ? 1 : 0), 0); }
}
function drawBolts(){
  const path = p => { cx.beginPath(); p.forEach(([x, y], i) => i ? cx.lineTo(x, y) : cx.moveTo(x, y)); };
  for (const b of SC.bolts){ b.life -= DT; const m = b.max || .32, t = 1 - b.life / m;
    // it flickers: a bright stroke, a dip, a second stroke down the same channel, then gone
    const a = clamp(b.life / m, 0, 1) * (t > .22 && t < .36 && !calm() ? .3 : 1);
    cx.lineJoin = "round"; cx.lineCap = "round"; cx.shadowColor = "#ffe08a"; cx.shadowBlur = 20;
    for (const p of b.br || []){ path(p); cx.strokeStyle = `rgba(255,230,140,${.7 * a})`; cx.lineWidth = 3.5; cx.stroke(); cx.strokeStyle = `rgba(255,255,255,${.85 * a})`; cx.lineWidth = 1.2; cx.stroke(); }
    path(b.pts); cx.strokeStyle = `rgba(255,230,140,${a})`; cx.lineWidth = 7; cx.stroke();
    cx.strokeStyle = `rgba(255,255,255,${a})`; cx.lineWidth = 2.5; cx.stroke(); cx.shadowBlur = 0;
    // where it meets the sea: a white-hot glint on the water
    if (b.sea){ const [x, y] = b.pts[b.pts.length - 1], g = cx.createRadialGradient(x, y, 0, x, y, 42); g.addColorStop(0, `rgba(255,252,230,${.85 * a})`); g.addColorStop(1, "rgba(210,220,255,0)");
      cx.fillStyle = g; cx.beginPath(); cx.ellipse(x, y, 42, 11, 0, 0, 7); cx.fill(); } }
  cx.lineCap = "butt";
  SC.bolts = SC.bolts.filter(b => b.life > 0);
}
function drawMist(){
  if (SC.mist < .02) return;
  for (let i = 0; i < 6; i++){ const x = ((i * .23 + SC.t * .02) % 1.3 - .15) * W, y = H * (.42 + .1 * Math.sin(i + SC.t * .3)), g = cx.createRadialGradient(x, y, 10, x, y, W * .35);
    g.addColorStop(0, `rgba(225,215,245,${.38 * SC.mist})`); g.addColorStop(1, "rgba(225,215,245,0)"); cx.fillStyle = g; cx.fillRect(x - W * .35, y - W * .35, W * .7, W * .7); }
}
let DT = 0;
// the horizon: the far sea melts into the sky's own colour (air between us and it), the sky is brightest just above the line, a low sun
// lights a glow on the horizon and lays a soft road of light across the far water, and a few faint swell streaks crowd together toward
// the line (perspective). It takes the hour's colours (warm at dusk, deep blue at night) and greys out in a storm
function drawHorizon(){
  const hy = H * LAY[0].y, bot = SC.skyBot || hex("#bfe6ff"), st = SC.storm || 0, night = clamp(((SC.nightP || 0) - .7) / .2, 0, 1);
  // air: the far sea fades toward the horizon's colour
  const air = cx.createLinearGradient(0, hy - 6, 0, hy + H * .07); air.addColorStop(0, rgb(bot, .62)); air.addColorStop(1, rgb(bot, 0));
  cx.fillStyle = air; cx.fillRect(0, hy - 6, W, H * .07 + 6);
  // the sky is brightest right above the line
  const lift = cx.createLinearGradient(0, hy - H * .07, 0, hy); lift.addColorStop(0, rgb(mixC(bot, "#ffffff", .35), 0)); lift.addColorStop(1, rgb(mixC(bot, "#ffffff", .35), .35 * (1 - st) * (1 - night * .7)));
  cx.fillStyle = lift; cx.fillRect(0, hy - H * .07, W, H * .07);
  // a low sun: a glow on the horizon below it and a road of light across the far water
  const sa = SC.sunA || 0, low = clamp(1 - (typeof sunElev === "function" ? sunElev() : 30) / 40, 0, 1) * sa * (1 - st);
  if (low > .03 && SC.sunX != null){ const gx = SC.sunX, gr = Math.max(W * .35, 160), g = cx.createRadialGradient(gx, hy, 4, gx, hy, gr);
    g.addColorStop(0, `rgba(255,214,150,${.42 * low})`); g.addColorStop(1, "rgba(255,190,130,0)"); cx.fillStyle = g; cx.fillRect(gx - gr, hy - gr * .5, gr * 2, gr);
    const rd = cx.createLinearGradient(0, hy, 0, hy + H * .12); rd.addColorStop(0, `rgba(255,232,180,${.38 * low})`); rd.addColorStop(1, "rgba(255,232,180,0)");
    cx.fillStyle = rd; cx.beginPath(); cx.moveTo(gx - 10, hy); cx.lineTo(gx + 10, hy); cx.lineTo(gx + 46, hy + H * .12); cx.lineTo(gx - 46, hy + H * .12); cx.closePath(); cx.fill(); }
  // far swell: thin streaks, closer together toward the horizon, drifting with the water
  const off = (SC.scroll || 0) * LAY[0].s, sw = Math.max(W, 420);
  cx.strokeStyle = rgb(mixC(bot, "#ffffff", .5), .16 * (1 - night * .5)); cx.lineWidth = 1; cx.lineCap = "round"; cx.beginPath();
  for (let r = 0; r < 4; r++){ const y = hy + 3 + r * r * 2.6 + r * 2, len = 14 + r * 9, gap = 70 + r * 40;
    for (let k = Math.floor(off / gap) - 1; k * gap - off < W + gap; k++){ const x = k * gap - off + hash1(k * 2.3 + r * 7.1) * gap * .6; cx.moveTo(x, y); cx.lineTo(x + len * (.6 + .6 * hash1(k + r * 3.3)), y); } }
  cx.stroke(); cx.lineCap = "butt";
  // the line itself: crisp, a touch lighter than the sky behind it
  cx.strokeStyle = rgb(mixC(bot, "#ffffff", .25), .5 * (1 - st * .6)); cx.lineWidth = 1.2; cx.beginPath();
  for (let x = -10; x <= W + 10; x += 16){ const y = wy(0, x); x === -10 ? cx.moveTo(x, y) : cx.lineTo(x, y); } cx.stroke();
  void sw;
}
function drawScene(){
  cx.setTransform(DPR, 0, 0, DPR, 0, 0);
  let sx = 0, sy = 0;
  if (SC.shake > 0 && !calm()){ sx = (Math.random() - .5) * SC.shake * 10; sy = (Math.random() - .5) * SC.shake * 8; }
  cx.save(); cx.translate(sx, sy);
  drawSky(); drawStorms(); drawWind();
  drawLayer(0); drawHorizon();
  drawFar(); drawLayer(1); drawPort(); drawDest(); drawParticles(1);
  // each row of ships, with whatever is attacking it, then the water in front of that row, then its spray and wreckage
  for (const L of [2, 3]){ const row = L === 3 ? 1 : 0;
    // a sinking ship goes down behind its neighbours in the row, so its listing hull never paints over a ship still afloat
    drawParticles(L - .5); drawNear(L - .5); drawRaiders(L); drawTentacles(L, true); drawReefs(L, true); const rs = SC.ships.filter(s => s.row === row);
    // a berg drifting astern with its wreck passes behind the ships still under way in that row (it never paints over a neighbour)
    rs.forEach(s => { if (s.state === "sink") drawShip(s); }); drawBergs(L); rs.forEach(s => { if (s.state !== "sink") drawShip(s); });
    drawTentacles(L, false); drawWhale(L); drawReefs(L); if (L === 3) drawPrizeFx();
    drawLayer(L); SC.ships.forEach(s => { if (s.row === row) bowWave(s); }); drawKrakenWater(L); drawRogue(L); drawParticles(L); }
  drawNear(3.5); drawLayer(4); drawParticles(4); drawParticles(5); drawBolts(); drawMist(); drawBadges();
  cx.restore();
  // vignette and lightning flash
  const v = cx.createRadialGradient(W / 2, H * .45, Math.min(W, H) * .35, W / 2, H * .5, Math.max(W, H) * .8);
  v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, `rgba(4,8,24,${.42 + SC.storm * .25})`); cx.fillStyle = v; cx.fillRect(0, 0, W, H);
  if (SC.winGlow > .01){ const wg = cx.createRadialGradient(W / 2, H * .31, 10, W / 2, H * .31, Math.max(W, H) * .62); wg.addColorStop(0, `rgba(255,220,120,${.34 * SC.winGlow})`); wg.addColorStop(1, "rgba(255,220,120,0)"); cx.fillStyle = wg; cx.fillRect(0, 0, W, H); SC.winGlow = Math.max(0, SC.winGlow - DT * .45); }
  if (SC.gloom > .01){ const gg = cx.createLinearGradient(0, 0, 0, H); gg.addColorStop(0, `rgba(255,170,90,${.12 * SC.gloom})`); gg.addColorStop(1, `rgba(40,20,50,${.12 * SC.gloom})`); cx.fillStyle = gg; cx.fillRect(0, 0, W, H); }
  if (SC.flash > 0){ cx.fillStyle = `rgba(255,255,255,${SC.flash * (calm() ? .3 : 1)})`; cx.fillRect(0, 0, W, H); SC.flash = Math.max(0, SC.flash - DT * 2.6); }
  SC.shake = Math.max(0, SC.shake - DT * 1.8);
  if (SC.fadeA > .01){ cx.fillStyle = `rgba(8,13,36,${Math.min(1, SC.fadeA)})`; cx.fillRect(0, 0, W, H); }   // the cut back to the home port
}

// ===== parchment helpers — src/game.html lines 3190–3218 =====
function tornPath(g, w, h, seed, m){
  const rnd = mulberry32(seed), pts = [], step = Math.max(3, Math.min(w, h) / 16), jag = () => m * (.25 + .75 * rnd()) + (rnd() < .07 ? m * 1.6 : 0);
  for (let x = 0; x < w; x += step) pts.push([x, jag()]);
  for (let y = 0; y < h; y += step) pts.push([w - jag(), y]);
  for (let x = w; x > 0; x -= step) pts.push([x, h - jag()]);
  for (let y = h; y > 0; y -= step) pts.push([jag(), y]);
  g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath();
}
// aged paper: a warm wash, darker toward the edges, foxing spots and a fold crease; drawn inside the torn outline, with a scorched rim
function parchment(g, w, h, seed){
  const d = DPR, m = 3.2 * d, rnd = mulberry32(seed * 7 + 3);
  g.save(); tornPath(g, w, h, seed, m); g.clip();
  g.fillStyle = "#ead7a6"; g.fillRect(0, 0, w, h);
  const vg = g.createRadialGradient(w * .48, h * .45, Math.min(w, h) * .2, w / 2, h / 2, Math.max(w, h) * .62); vg.addColorStop(0, "rgba(255,248,222,.5)"); vg.addColorStop(1, "rgba(120,72,24,.42)"); g.fillStyle = vg; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++){ g.fillStyle = `rgba(${rnd() < .5 ? "130,84,34" : "160,110,50"},${.05 + rnd() * .1})`; g.beginPath(); g.arc(rnd() * w, rnd() * h, (1 + rnd() * 5) * d, 0, 7); g.fill(); }
  const fx = w * (.38 + rnd() * .24); g.strokeStyle = "rgba(110,70,30,.18)"; g.lineWidth = d; g.beginPath(); g.moveTo(fx, 0); g.lineTo(fx + (rnd() - .5) * 6 * d, h); g.stroke();
  g.restore();
  g.save(); tornPath(g, w, h, seed, m); g.strokeStyle = "rgba(92,52,18,.85)"; g.lineWidth = 1.6 * d; g.lineJoin = "round"; g.stroke(); g.restore();
}
// a small compass rose in brown ink, north up
function compassRose(g, x, y, r){
  g.save(); g.translate(x, y); g.lineJoin = "round";
  g.strokeStyle = "rgba(92,52,18,.75)"; g.lineWidth = Math.max(.8, r * .07); g.beginPath(); g.arc(0, 0, r * .62, 0, 7); g.stroke();
  for (let k = 0; k < 8; k++){ const a = k * Math.PI / 4 - Math.PI / 2, L = k % 2 ? r * .55 : r, wdt = k % 2 ? r * .1 : r * .16;
    g.fillStyle = k === 0 ? "#b0302a" : k % 2 ? "rgba(92,52,18,.55)" : "rgba(92,52,18,.85)"; g.beginPath(); g.moveTo(Math.cos(a) * L, Math.sin(a) * L);
    g.lineTo(Math.cos(a + Math.PI / 2) * wdt, Math.sin(a + Math.PI / 2) * wdt); g.lineTo(0, 0); g.lineTo(Math.cos(a - Math.PI / 2) * wdt, Math.sin(a - Math.PI / 2) * wdt); g.closePath(); g.fill(); }
  g.fillStyle = "rgba(92,52,18,.9)"; g.font = `${Math.round(r * .55)}px 'Lilita One', serif`; g.textAlign = "center"; g.textBaseline = "bottom"; g.fillText("N", 0, -r * .98);
  g.restore();
}

// ===== fireworks — src/game.html lines 3716–3721 =====
function firework(x, y){
  const c = ["#ffc93c", "#ff5a5a", "#7fe6ff", "#b48cff", "#5ee0a0", "#ffffff"][Math.floor(Math.random() * 6)];
  for (let k = 0; k < 30; k++){ const a = k / 30 * 6.283, v = 70 + Math.random() * 150; spawn({ k:"fire", x, y, vx:Math.cos(a) * v, vy:Math.sin(a) * v - 40, life:1 + Math.random() * .5, max:1.5, r:2.2 + Math.random() * 1.5, c }); }
  SC.flash = Math.max(SC.flash, .12); if (AU.ctx && G.sound) noise(.35, { f:1800, type:"bandpass", g:.22 });
}
