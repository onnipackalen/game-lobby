/* Nuclear Summit v2: audio. Placeholder sound, synthesised with Web Audio (no files to load).
   A drop-in for v1's inline SFX: SummitAudio.SFX keeps every v1 cue name.

   Signal chain: cues -> sfx bus ----\
                 music loops -> music bus (ducked under big cues) -> limiter -> volume -> speakers
   The limiter sits before the volume control, so loud moments are held the same way at any volume.

   AUDIO CUE SHEET (event -> cue). Levels are matched: every cue is trimmed (TRIM below) to a loudness
   target for its group, measured by rendering it offline (SummitAudio._measure()).
     Group     Target (short-term RMS)   Cues
     UI        about -30 dBFS            click, bet
     Reels     about -24 dBFS            spinStart, thud, pop, tease, fallout, rollup ticks
     Trigger   about -20 dBFS            clank (Nuke lands: the only cue with the Geiger crackle;
                                         nothing else uses it), airRaid, fanfare, retrigger
     Blasts    about -18 dBFS            boom, tsar, doom (the limiter holds stacked booms)
     Wins      -24 (small) up to -16     win('small'|'nice'|'big'|'mega'|'epic'|'max'),
                                         featureEnd, featureEndQuiet
     Music     about -30 dBFS            music('base'): the summit, a pompous anthem over a ticking
                                         Doomsday clock; music('feature'): the bunker, a pulsing
                                         ostinato whose filter opens with intensity()
   Rules for the caller (market rules, not optional):
   - Never call win() or featureEnd for a return at or below the stake. In a bought feature the
     stake is the buy cost: use featureEndQuiet when the feature paid no more than it cost.
   - Pick the win tier from win / stake: small > 1x, nice >= 5x, big >= 15x, mega >= 50x,
     epic >= 250x, max = the max-win cap. Celebrations then scale with the win.
   - Call tease only for a column that can still land the trigger.
   Durations: click 0.05 s, thud 0.1 s, clank 0.25 s, tease 0.7 s, boom 0.9 s, tsar 1.6 s,
   doom 1.6 s, airRaid 2.2 s, fanfare 0.9 s, win small 0.5 s / nice 0.8 s / big 1.8 s / mega 2.8 s /
   epic 3.8 s / max 4.6 s, featureEnd 1.8 s, featureEndQuiet 0.7 s.

   API
     SummitAudio.init()             call from a tap or key press (browsers start audio only then)
     SummitAudio.play(name, ...a)   any cue below, e.g. play('fallout', 8)
     SummitAudio.SFX.<name>()       the same cues as functions (v1 names: click thud clank pop tease
                                    chime boom doom fanfare siren airRaid)
     SummitAudio.win(tier)          'small' | 'nice' | 'big' | 'mega' | 'epic' | 'max'
     SummitAudio.rollup(seconds)    count-up ticks for the WIN display; returns stop()
     SummitAudio.music(name)        'base' | 'feature' | null, cross-faded
     SummitAudio.intensity(x)       0..1, tension of the feature loop (drive it from the DEFCON gauge)
     SummitAudio.volume(v?)         get or set 0..1 (remembered between visits)
     SummitAudio.muted(b?)          get or set (remembered between visits)
   Sound pauses while the tab is hidden and resumes when it is shown.
   No Math.random: noise comes from crypto.getRandomValues, everything else is deterministic. */
(function (global) {
  'use strict';

  // Per-cue loudness trims, set from offline measurements so the cue groups above line up.
  // Measured with a 400 ms window (momentary loudness). UI blips are set by peak (about -19 dBFS)
  // because a 50 ms blip reads low on a 400 ms window.
  const TRIM = {
    click: 1, bet: 1, // UI: peak about -19
    spinStart: 3.2, thud: 0.8, pop: 1.75, tease: 2.5, fallout: 2.0, tick: 1.4, // reels: about -32 (tick by peak, about -20)
    clank: 1.6, airRaid: 7.0, siren: 6.8, fanfare: 2.06, retrigger: 2.34, // trigger: about -24 (air raid -22)
    boom: 0.96, tsar: 0.86, doom: 1.1, // blasts: -20 to -17
    chime: 1.1, winSmall: 1.1, winNice: 1.35, winBig: 1.76, winMega: 1.7, winEpic: 1.25, winMax: 1.4, // wins: -26 rising to -16
    featureEnd: 1.84, featureEndQuiet: 1, // -21; the quiet one stays at -30, below any celebration
    musicBase: 0.63, musicFeature: 0.54, // music: about -30, under every cue
  };

  let AC = null, sfxBus, musicBus, limiter, out, pendingMusic = null;
  let vol = 0.6, mute = false, tension = 0.3;
  const STORE = 'nuclearSummit.audio';
  try { const s = JSON.parse(localStorage.getItem(STORE) || '{}'); if (typeof s.vol === 'number') vol = s.vol; if (typeof s.muted === 'boolean') mute = s.muted; } catch (e) { /* no storage */ }
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify({ vol, muted: mute })); } catch (e) { /* no storage */ } };
  const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

  // ===== Building blocks. A = { ctx, out, t }: where and when a cue plays (live or offline). =====
  const NOISE = new WeakMap();
  function noiseBuf(ctx) {
    let b = NOISE.get(ctx); if (b) return b;
    const len = ctx.sampleRate * 2, r = new Uint32Array(len);
    for (let i = 0; i < len; i += 16384) crypto.getRandomValues(r.subarray(i, Math.min(len, i + 16384)));
    b = ctx.createBuffer(1, len, ctx.sampleRate); const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = r[i] / 2147483648 - 1;
    NOISE.set(ctx, b); return b;
  }
  function env(g, t, peak, attack, dur) {
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  function tone(A, f, dur, type = 'sine', g = 0.2, when = 0, slide = 0, attack = 0.01) {
    const t = A.t + when, o = A.ctx.createOscillator(), gn = A.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    env(gn, t, g, Math.min(attack, dur / 3), dur); o.connect(gn); gn.connect(A.out); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(A, dur, g, type = 'lowpass', freq = 800, when = 0, q = 0.7, sweepTo = 0, attack = 0.01) {
    const t = A.t + when, src = A.ctx.createBufferSource(), f = A.ctx.createBiquadFilter(), gn = A.ctx.createGain();
    src.buffer = noiseBuf(A.ctx); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    env(gn, t, g, Math.min(attack, dur / 3), dur); src.connect(f); f.connect(gn); gn.connect(A.out);
    src.start(t, (when * 7.3) % 1.5); src.stop(t + dur + 0.05);
  }
  // A swell that rises to its peak and cuts (cymbal swell before a big hit).
  function swell(A, dur, g, when = 0) {
    const t = A.t + when, src = A.ctx.createBufferSource(), f = A.ctx.createBiquadFilter(), gn = A.ctx.createGain();
    src.buffer = noiseBuf(A.ctx); f.type = 'highpass'; f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(8000, t + dur);
    gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(g, t + dur); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
    src.connect(f); f.connect(gn); gn.connect(A.out); src.start(t); src.stop(t + dur + 0.15);
  }
  // Brass-ish stab: two detuned saws per note through a lowpass that opens on the attack.
  function brass(A, notes, dur, g = 0.08, when = 0, bright = 2400) {
    const t = A.t + when, f = A.ctx.createBiquadFilter(), gn = A.ctx.createGain();
    f.type = 'lowpass'; f.Q.value = 1; f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(bright, t + 0.06); f.frequency.exponentialRampToValueAtTime(900, t + dur);
    env(gn, t, g, 0.03, dur); f.connect(gn); gn.connect(A.out);
    for (const n of notes) for (const det of [-7, 7]) {
      const o = A.ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(n); o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + dur + 0.05);
    }
  }
  function timpaniRoll(A, dur, g, when = 0) {
    for (let x = 0, i = 0; x < dur; x += 0.055, i++) tone(A, 98 - (i % 2) * 6, 0.18, 'sine', g * (0.25 + 0.75 * x / dur), when + x, 80, 0.004);
  }
  function geiger(A, when = 0) {
    for (const x of [0, 0.018, 0.041, 0.07, 0.083, 0.121, 0.163, 0.177, 0.215]) noise(A, 0.008, 0.3, 'highpass', 2500, when + x, 0.7, 0, 0.001);
  }
  function arp(A, root, steps, len, g, type = 'sine', when = 0, gap = 0.07) {
    steps.forEach((s, i) => tone(A, hz(root + s), len, type, g, when + i * gap));
  }

  // ===== Cues =====
  const CUES = {
    click: { duck: 0, fn: (A) => tone(A, 880, 0.05, 'triangle', 0.12) },
    bet: { duck: 0, fn: (A, d = 1) => tone(A, d > 0 ? 990 : 740, 0.06, 'triangle', 0.12) },
    spinStart: { duck: 0, fn: (A) => noise(A, 0.32, 0.3, 'bandpass', 500, 0, 1.2, 2400) },
    thud: { duck: 0, fn: (A) => { tone(A, 170, 0.1, 'sine', 0.35, 0, 70); noise(A, 0.04, 0.08, 'lowpass', 1200); } },
    clank: { duck: 0, fn: (A) => { geiger(A); tone(A, 880, 0.18, 'triangle', 0.3, 0.02, 440); tone(A, 1320, 0.12, 'triangle', 0.1, 0.02, 660); } },
    tease: { duck: 0, fn: (A) => { tone(A, 260, 0.7, 'sawtooth', 0.05, 0, 620, 0.15); tone(A, 263, 0.7, 'sawtooth', 0.04, 0, 627, 0.15); } },
    pop: { duck: 0, fn: (A) => tone(A, 700, 0.09, 'triangle', 0.16, 0, 1300) },
    fallout: { duck: 0, fn: (A, m = 2) => { const f = 330 * 2 ** (Math.log2(Math.max(2, m)) / 3); noise(A, 0.18, 0.08, 'highpass', 4000); tone(A, f, 0.22, 'square', 0.05, 0, f * 1.5); } },
    boom: { duck: 0.5, fn: (A) => { noise(A, 0.9, 0.7, 'lowpass', 500, 0, 0.7, 120); tone(A, 90, 0.7, 'sine', 0.45, 0, 32); } },
    tsar: { duck: 0.4, fn: (A) => { noise(A, 1.6, 0.8, 'lowpass', 380, 0, 0.7, 80); tone(A, 70, 1.4, 'sine', 0.5, 0, 24); tone(A, 140, 0.4, 'sawtooth', 0.06, 0, 50); } },
    doom: { duck: 0.35, fn: (A) => { noise(A, 1.4, 0.5, 'lowpass', 260); tone(A, 60, 1.3, 'sine', 0.4, 0.1, 24); tone(A, 900, 0.9, 'sawtooth', 0.05, 0.15, 110); arp(A, 76, [0, 3, 7, 10], 0.5, 0.04, 'triangle', 0.5, 0.09); } },
    airRaid: { duck: 0.3, fn: (A) => { for (let i = 0; i < 2; i++) { const t = i * 1.1; tone(A, 260, 0.55, 'sawtooth', 0.05, t, 720); tone(A, 720, 0.55, 'sawtooth', 0.05, t + 0.55, 260); tone(A, 266, 0.55, 'square', 0.025, t, 735); tone(A, 735, 0.55, 'square', 0.025, t + 0.55, 266); } } },
    siren: { duck: 0.5, fn: (A) => { tone(A, 480, 0.45, 'sawtooth', 0.05, 0, 900); tone(A, 900, 0.45, 'sawtooth', 0.05, 0.45, 480); } },
    fanfare: { duck: 0.35, fn: (A) => { [0, 4, 7, 12].forEach((s, i) => brass(A, [67 + s], 0.22, 0.06, i * 0.11)); brass(A, [67, 71, 74, 79], 0.5, 0.07, 0.44); } },
    retrigger: { duck: 0.4, fn: (A) => { brass(A, [72], 0.16, 0.06); brass(A, [76], 0.16, 0.06, 0.12); brass(A, [72, 76, 79, 84], 0.45, 0.07, 0.24); } },
    chime: { duck: 0, fn: (A) => arp(A, 72, [0, 4, 7, 12], 0.3, 0.14) },
    winSmall: { duck: 0, fn: (A) => arp(A, 72, [0, 4, 7, 12], 0.3, 0.14) },
    winNice: { duck: 0.6, fn: (A) => { arp(A, 72, [0, 4, 7, 12], 0.3, 0.14); arp(A, 84, [0, 4, 7, 12], 0.25, 0.07, 'triangle', 0.3, 0.06); } },
    winBig: { duck: 0.35, fn: (A) => { swell(A, 0.6, 0.12); brass(A, [60, 64, 67, 72], 0.9, 0.08, 0.6); arp(A, 84, [0, 4, 7, 12, 16], 0.3, 0.06, 'triangle', 0.7, 0.07); } },
    winMega: { duck: 0.3, fn: (A) => { swell(A, 0.7, 0.12); brass(A, [60, 64, 67], 0.3, 0.07, 0.7); brass(A, [65, 69, 72], 0.3, 0.07, 1.0); brass(A, [67, 71, 74], 0.3, 0.07, 1.3); brass(A, [60, 64, 67, 72, 76], 1.3, 0.085, 1.6); arp(A, 84, [0, 4, 7, 12, 16, 19], 0.3, 0.05, 'triangle', 1.65, 0.06); } },
    winEpic: { duck: 0.25, fn: (A) => { timpaniRoll(A, 1.2, 0.3); swell(A, 1.2, 0.13); [67, 72, 76, 79].forEach((n, i) => brass(A, [n, n - 12], 0.26, 0.07, 1.2 + i * 0.2)); brass(A, [60, 64, 67, 72, 76, 84], 2.0, 0.09, 2.0); tone(A, 65, 0.8, 'sine', 0.35, 2.0, 40); arp(A, 84, [0, 4, 7, 12, 16, 19, 24], 0.3, 0.05, 'triangle', 2.05, 0.06); } },
    winMax: { duck: 0.2, fn: (A) => { CUES.winEpic.fn(A); noise(A, 1.2, 0.5, 'lowpass', 600, 2.0, 0.7, 120); brass(A, [48, 60, 64, 67, 72], 1.6, 0.09, 3.0); swell(A, 0.5, 0.1, 2.5); } },
    featureEnd: { duck: 0.35, fn: (A) => { swell(A, 0.5, 0.1); brass(A, [67, 71, 74], 0.4, 0.07, 0.5); brass(A, [60, 64, 67, 72], 1.2, 0.08, 0.9); } },
    featureEndQuiet: { duck: 0.7, fn: (A) => { tone(A, hz(64), 0.45, 'sine', 0.1); tone(A, hz(60), 0.6, 'sine', 0.1, 0.22); } },
    tick: { duck: 0, fn: (A, k = 0) => tone(A, 600 * 2 ** k, 0.035, 'triangle', 0.08) },
  };
  const TIERS = { small: 'winSmall', nice: 'winNice', big: 'winBig', mega: 'winMega', epic: 'winEpic', max: 'winMax' };

  // ===== Music: step sequencers on the 16th note. step(A, i, tension) schedules one 16th. =====
  const LOOPS = {
    // The summit: a pompous minor anthem over the Doomsday clock's tick-tock. 100 BPM, 8 bars.
    base: {
      bpm: 100, steps: 128, trim: 'musicBase',
      roots: [38, 43, 45, 38, 46, 43, 45, 45],
      chords: [[50, 53, 57], [55, 58, 62], [57, 61, 64], [50, 53, 57], [58, 62, 65], [55, 58, 62], [57, 61, 64], [57, 61, 64]],
      motif: { 0: [62, 4], 4: [57, 3], 7: [62, 1], 8: [65, 4], 12: [64, 4] },
      step(A, i) {
        const bar = i >> 4, s = i & 15, root = this.roots[bar], d = 60 / this.bpm / 4;
        if (s % 4 === 0) { tone(A, s % 8 === 0 ? 2200 : 1650, 0.03, 'triangle', 0.06); noise(A, 0.02, 0.03, 'highpass', 5000); }
        if (s === 0 || s === 8) tone(A, hz(root), d * 4.5, 'triangle', 0.22, 0, 0, 0.01);
        if (s === 6 || s === 14) tone(A, hz(root + 7), d * 1.2, 'triangle', 0.16);
        if (s === 0) brass(A, this.chords[bar], d * 15, 0.025, 0, 900);
        if ((bar === 0 || bar === 4) && this.motif[s]) { const [n, len] = this.motif[s]; brass(A, [n], d * len * 0.95, 0.04, 0, 1600); }
      },
    },
    // The bunker: a pulsing ostinato, sub kicks and hats; the filter opens with tension. 124 BPM, 8 bars.
    feature: {
      bpm: 124, steps: 128, trim: 'musicFeature',
      roots: [40, 40, 36, 38, 40, 40, 36, 35],
      step(A, i, k) {
        const bar = i >> 4, s = i & 15, root = this.roots[bar], d = 60 / this.bpm / 4;
        if (s === 0 || s === 8) tone(A, 110, 0.25, 'sine', 0.4, 0, 40, 0.003);
        if (s % 2 === 0 || k > 0.6) noise(A, 0.03, 0.025 + 0.02 * k, 'highpass', 7000);
        if (s % 2 === 0) {
          const n = root + ([0, 0, 12, 0, 0, 0, 10, 0][(s >> 1) & 7]);
          const f = A.ctx.createBiquadFilter(), g = A.ctx.createGain(), o = A.ctx.createOscillator();
          f.type = 'lowpass'; f.frequency.value = 300 + 1500 * k; f.Q.value = 4;
          o.type = 'sawtooth'; o.frequency.value = hz(n); env(g, A.t, 0.12, 0.005, d * 1.6);
          o.connect(f); f.connect(g); g.connect(A.out); o.start(A.t); o.stop(A.t + d * 1.7);
        }
        if (s === 0) tone(A, hz(root + 12), d * 15, 'sawtooth', 0.015, 0, 0, 0.3);
        if ((bar === 3 || bar === 7) && s % 4 === 0) tone(A, s % 8 === 0 ? 880 : 660, d * 2, 'square', 0.015 + 0.015 * k);
      },
    },
  };

  // ===== Live graph =====
  function init() {
    if (AC) { if (AC.state === 'suspended' && !document.hidden) AC.resume(); return; }
    try {
      AC = new (global.AudioContext || global.webkitAudioContext)();
      sfxBus = AC.createGain(); musicBus = AC.createGain(); musicBus.gain.value = 1;
      limiter = AC.createDynamicsCompressor();
      limiter.threshold.value = -6; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.002; limiter.release.value = 0.15;
      out = AC.createGain(); out.gain.value = mute ? 0 : vol;
      sfxBus.connect(limiter); musicBus.connect(limiter); limiter.connect(out); out.connect(AC.destination);
      document.addEventListener('visibilitychange', () => { if (!AC) return; if (document.hidden) AC.suspend(); else AC.resume(); });
      if (pendingMusic) { const m = pendingMusic; pendingMusic = null; music(m); }
    } catch (e) { AC = null; }
  }
  let duckUntil = 0;
  function duck(level, sec) {
    if (!AC || !level) return;
    const t = AC.currentTime; duckUntil = Math.max(duckUntil, t + sec);
    musicBus.gain.cancelScheduledValues(t); musicBus.gain.setTargetAtTime(level, t, 0.04);
    musicBus.gain.setTargetAtTime(1, duckUntil, 0.3);
  }
  function play(name, ...args) {
    const c = CUES[name]; if (!c || !AC) return;
    const g = AC.createGain(); g.gain.value = TRIM[name] ?? 1; g.connect(sfxBus);
    c.fn({ ctx: AC, out: g, t: AC.currentTime }, ...args);
    if (c.duck) duck(c.duck, 1.2);
    setTimeout(() => g.disconnect(), 8000);
  }
  function win(tier) { play(TIERS[tier] || 'winSmall'); }
  function rollup(seconds) {
    if (!AC) return () => {};
    const g = AC.createGain(); g.gain.value = TRIM.tick; g.connect(sfxBus);
    const t0 = AC.currentTime, n = Math.max(1, Math.floor(seconds / 0.07));
    for (let i = 0; i < n; i++) CUES.tick.fn({ ctx: AC, out: g, t: t0 + i * 0.07 }, i / n);
    let stopped = false;
    return () => { if (stopped) return; stopped = true; g.gain.setTargetAtTime(0, AC.currentTime, 0.01); setTimeout(() => g.disconnect(), 200); };
  }

  let loop = null;
  function music(name) {
    if (!AC) { pendingMusic = name; return; }
    if (loop && loop.name === name) return;
    if (loop) { const old = loop; clearInterval(old.timer); old.gain.gain.setTargetAtTime(0.0001, AC.currentTime, 0.2); setTimeout(() => old.gain.disconnect(), 2000); loop = null; }
    if (!name || !LOOPS[name]) return;
    const L = LOOPS[name], g = AC.createGain(), d = 60 / L.bpm / 4;
    g.gain.setValueAtTime(0.0001, AC.currentTime); g.gain.setTargetAtTime(TRIM[L.trim], AC.currentTime, 0.25); g.connect(musicBus);
    const l = { name, i: 0, next: AC.currentTime + 0.05, gain: g };
    l.timer = setInterval(() => {
      if (AC.state !== 'running') return;
      if (l.next < AC.currentTime - 0.1) l.next = AC.currentTime + 0.05; // fell behind (tab was hidden): skip ahead, no burst
      while (l.next < AC.currentTime + 0.15) { L.step({ ctx: AC, out: g, t: l.next }, l.i % L.steps, tension); l.next += d; l.i++; }
    }, 25);
    loop = l;
  }

  // ===== Dev: render a cue (or 8 bars of a loop) offline and measure it =====
  async function measureOne(name, args = [], seconds = 5) {
    const sr = 44100, off = new OfflineAudioContext(1, sr * seconds, sr), g = off.createGain();
    g.connect(off.destination);
    if (LOOPS[name]) {
      const L = LOOPS[name], d = 60 / L.bpm / 4; g.gain.value = TRIM[L.trim];
      for (let i = 0; i * d < seconds - 0.5; i++) L.step({ ctx: off, out: g, t: i * d }, i % L.steps, tension);
    } else { g.gain.value = TRIM[name] ?? 1; CUES[name].fn({ ctx: off, out: g, t: 0 }, ...args); }
    const x = (await off.startRendering()).getChannelData(0);
    let peak = 0, best = 0, win = Math.floor(sr * 0.4), acc = 0;
    for (let i = 0; i < x.length; i++) { const v = x[i] * x[i]; peak = Math.max(peak, Math.abs(x[i])); acc += v; if (i >= win) acc -= x[i - win] * x[i - win]; if (i >= win - 1) best = Math.max(best, acc / win); }
    const db = (v) => Math.round(20 * Math.log10(Math.max(v, 1e-9)) * 10) / 10;
    return { cue: name, peakDb: db(peak), rmsDb: db(Math.sqrt(best)) };
  }
  async function _measure() {
    const list = Object.keys(CUES).map((n) => [n, n === 'fallout' ? [8] : []]).concat([['base'], ['feature']]);
    const rows = []; for (const [n, a] of list) rows.push(await measureOne(n, a || [], LOOPS[n] ? 12 : 5));
    return rows;
  }

  const SFX = {}; for (const n of Object.keys(CUES)) SFX[n] = (...a) => play(n, ...a);
  global.SummitAudio = {
    init, play, SFX, win, rollup, music,
    intensity(x) { if (typeof x === 'number') tension = Math.max(0, Math.min(1, x)); return tension; },
    volume(v) { if (typeof v === 'number') { vol = Math.max(0, Math.min(1, v)); if (out && !mute) out.gain.setTargetAtTime(vol, AC.currentTime, 0.02); save(); } return vol; },
    muted(b) { if (typeof b === 'boolean') { mute = b; if (out) out.gain.setTargetAtTime(mute ? 0 : vol, AC.currentTime, 0.02); save(); } return mute; },
    cues: Object.keys(CUES), TRIM, _measure,
  };
})(typeof window !== 'undefined' ? window : globalThis);
