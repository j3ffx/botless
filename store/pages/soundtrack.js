// Code-only soundtrack for the promo video (Web Audio). Everything is scheduled on the AudioContext clock from t0,
// so it stays in sync with the picture, which uses the same clock.
//   buildSoundtrack(ac, out, t0, { starts: [scene start times…], total })
window.buildSoundtrack = (ac, out, t0, { starts, total }) => {
  const BPM = 100, BEAT = 60 / BPM, BAR = BEAT * 4;
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const at = (t) => t0 + t;

  // Master: gentle compression, fade in and out.
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
  const master = ac.createGain();
  master.gain.setValueAtTime(0, at(0));
  master.gain.linearRampToValueAtTime(0.9, at(1.2));
  master.gain.setValueAtTime(0.9, at(total - 1.6));
  master.gain.linearRampToValueAtTime(0, at(total));
  comp.connect(master).connect(out);

  // Shared echo for the plucks and chimes.
  const echo = ac.createDelay(1); echo.delayTime.value = BEAT * 0.75;
  const fb = ac.createGain(); fb.gain.value = 0.32;
  const wet = ac.createGain(); wet.gain.value = 0.35;
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3500;
  echo.connect(lp).connect(fb).connect(echo); lp.connect(wet).connect(comp);

  const noise = (() => {
    const b = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  })();
  const env = (g, t, peak, a, hold, r) => {
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setValueAtTime(peak, t + a + hold); g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + r);
  };

  // Scene boundaries: 0 title, 1 problem, 2 badges, 3 fade/hide, 4 watch, 5 popup, 6 privacy, 7 end card.
  const S = starts;
  const CHORDS = [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]]; // Am F C G
  const ROOTS = [45, 41, 48, 43];
  const FINAL = [48, 55, 60, 64, 67]; // C major, open

  // Pad: detuned saws through a soft low-pass, one chord per bar until the end card, then a held C major.
  function pad(notes, t, dur, level) {
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1100; f.Q.value = 0.4;
    const g = ac.createGain(); env(g, at(t), level, 0.6, Math.max(0, dur - 0.6), 1.2);
    f.connect(g).connect(comp);
    for (const m of notes) for (const det of [-7, 7]) {
      const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det;
      o.connect(f); o.start(at(t)); o.stop(at(t + dur + 1.4));
    }
  }
  const endBar = Math.floor(S[7] / BAR);
  for (let i = 0; i < endBar; i++) pad(CHORDS[i % 4], i * BAR, BAR, 0.035);
  pad(FINAL, endBar * BAR, total - endBar * BAR, 0.04);

  // Bass: from the problem scene on, root on beats 1 and 3.
  for (let t = Math.ceil(S[1] / BAR) * BAR - BAR; t < S[7]; t += BEAT * 2) {
    if (t < S[1] - 0.01) continue;
    const root = ROOTS[Math.floor(t / BAR) % 4];
    const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = hz(root);
    const g = ac.createGain(); env(g, at(t), 0.22, 0.01, 0.25, 0.45);
    o.connect(g).connect(comp); o.start(at(t)); o.stop(at(t + 1));
  }

  // Beat: kick on every beat and off-beat hats while the product is shown (badges → popup), not in the privacy calm.
  const beatFrom = Math.ceil(S[2] / BEAT) * BEAT, beatTo = S[6];
  for (let t = beatFrom; t < beatTo; t += BEAT) {
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(130, at(t)); o.frequency.exponentialRampToValueAtTime(45, at(t + 0.14));
    const g = ac.createGain(); env(g, at(t), 0.55, 0.002, 0.04, 0.26);
    o.connect(g).connect(comp); o.start(at(t)); o.stop(at(t + 0.4));
    const n = ac.createBufferSource(); n.buffer = noise;
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7500;
    const hg = ac.createGain(); env(hg, at(t + BEAT / 2), 0.07, 0.002, 0.01, 0.06);
    n.connect(hp).connect(hg).connect(comp); n.start(at(t + BEAT / 2), Math.random(), 0.2);
  }

  // Plucks: eighth-note arpeggio in the privacy scene, through the echo.
  function pluck(m, t, level = 0.07) {
    const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = hz(m);
    const g = ac.createGain(); env(g, at(t), level, 0.005, 0.02, 0.35);
    o.connect(g); g.connect(comp); g.connect(echo); o.start(at(t)); o.stop(at(t + 0.5));
  }
  for (let t = Math.ceil(S[6] / (BEAT / 2)) * (BEAT / 2), i = 0; t < S[7] - 0.2; t += BEAT / 2, i++) {
    const ch = CHORDS[Math.floor(t / BAR) % 4];
    pluck(ch[[0, 1, 2, 1][i % 4]] + 12, t, 0.05);
  }

  // Sound effects, on the picture's cues.
  function whoosh(t, dur = 0.55, level = 0.09) {
    const n = ac.createBufferSource(); n.buffer = noise;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(350, at(t)); bp.frequency.exponentialRampToValueAtTime(3200, at(t + dur));
    const g = ac.createGain(); env(g, at(t), level, dur * 0.6, 0, dur * 0.5);
    n.connect(bp).connect(g).connect(comp); n.start(at(t), 0, dur + 0.5);
  }
  function pop(t, from = 700, to = 1400, level = 0.16) {
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(from, at(t)); o.frequency.exponentialRampToValueAtTime(to, at(t + 0.07));
    const g = ac.createGain(); env(g, at(t), level, 0.004, 0.03, 0.14);
    o.connect(g); g.connect(comp); g.connect(echo); o.start(at(t)); o.stop(at(t + 0.3));
  }
  function chime(t, notes, level = 0.09) {
    notes.forEach((m, i) => {
      const o = ac.createOscillator(); o.type = 'sine'; o.frequency.value = hz(m);
      const g = ac.createGain(); env(g, at(t + i * 0.09), level, 0.005, 0.05, 1.6);
      o.connect(g); g.connect(comp); g.connect(echo); o.start(at(t + i * 0.09)); o.stop(at(t + i * 0.09 + 2));
    });
  }
  for (const s of S.slice(1)) whoosh(s - 0.55);        // scene changes (the picture crossfades over the last 0.5 s)
  chime(S[0] + 0.15, [72, 76, 79], 0.07);                 // title
  pop(S[2] + 0.55); pop(S[2] + 0.8, 800, 1600);           // the two badges appear
  pop(S[3] + 0.3, 900, 500, 0.12);                        // fade
  whoosh(S[3] + 3.2, 0.5, 0.07);                          // hide
  pop(S[4] + 0.9, 600, 1200, 0.1);                        // zoom on the watch-page label
  [0.8, 1.7, 2.6].forEach((d) => pop(S[6] + d, 1000, 1500, 0.08)); // privacy lines
  chime(S[7] + 0.1, [72, 76, 79, 84], 0.09);               // end card
};
