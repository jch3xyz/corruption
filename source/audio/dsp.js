// Pure DSP for the two audio engines — chrome-free on purpose, importable
// by the worklet, the harness, and any plain page. Everything here is
// deterministic given its inputs; that is what makes tier-1 testing real.

import { createFFT } from './fft.js';

export function rms(buf, start, len) {
  let sum = 0;
  for (let i = start; i < start + len; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / Math.max(1, len));
}

// --- Body engine: the fixed modal table -----------------------------------
//
// Three fundamentals in just intonation × 16 stretched partials → 48 modes.
// The stretch is what makes the bank read as a struck *object*: a comb drags
// in its own integer harmonics and cannot hold it. That is measured, not
// assumed — allpass dispersion in a comb loop was tried (2026-08-13) at K = 0,
// 6 and 12 first-order sections and moved the partials identically, 0.06–0.08 %
// at partial 10 where this table gives 1.98 %, because a first-order allpass
// only disperses near Nyquist and does nothing across 55–1500 Hz. So the comb
// below is NOT a failed modal bank; it is a peer with a different character
// (tube/pipe/spring against struck metal), kept for the A/B. Damping
// references the lowest fundamental so high modes always die faster, one
// global physical law.

export const BODY_FUNDAMENTALS = [55, 82.5, 137.5];
export const BODY_PARTIALS = 16;
export const BODY_STRETCH = 4e-4;
export const BODY_DAMP_EXP = 0.7;

// `ratio` (optional, default 1) multiplies all three fundamentals — the
// source-following body retunes the chord this way. The stretch table and
// the ring are unchanged by it: each mode keeps the T60 it has at ratio 1
// (the damping law is computed on the untuned frequency), so following the
// source moves the pitches and nothing else. `f * 1` is exact, so the
// default reproduces the fixed chord bit for bit.
export function modeTable(sampleRate, t60Base, ratio = 1) {
  const fLow = BODY_FUNDAMENTALS[0];
  const modes = [];
  for (const f0 of BODY_FUNDAMENTALS) {
    for (let k = 1; k <= BODY_PARTIALS; k++) {
      const fBase = k * f0 * Math.sqrt(1 + BODY_STRETCH * k * k);
      const f = fBase * ratio;
      if (f >= 0.45 * sampleRate) continue; // safety, not expected to fire
      modes.push({
        f,
        t60: t60Base * Math.pow(fLow / fBase, BODY_DAMP_EXP),
        amp: 1 / Math.sqrt(k), // natural spectral tilt: high partials quieter
      });
    }
  }
  return modes;
}

// --- The source-following body: where the chord sits ----------------------
//
// Design review M8: a fixed chord means every source excites the same metal.
// The follower below measures the source's dominant pitch; these fold it into
// the chord's lowest octave and decide how far the chord moves toward it.
//
// The fold makes octave errors harmless — 110 and 220 Hz land on the same
// ratio — which is why the follower only has to get the pitch CLASS right.
// `octave` makes the fold sticky: a voice hovering at 108–112 Hz straddles
// the 110 Hz fold edge, and a plain fold would throw the chord across a whole
// octave each time it crossed. With the previous octave passed in, the ratio
// may stray FOLD_HYSTERESIS octaves past either edge before it refolds.

export const FOLD_HYSTERESIS = 1 / 12; // a semitone, in octaves

export function foldSticky(hz, octave = null) {
  const base = BODY_FUNDAMENTALS[0];
  if (!(hz > 0) || !Number.isFinite(hz)) return { ratio: 1, octave: null };
  if (Number.isInteger(octave)) {
    const r = hz / base / Math.pow(2, octave);
    const l = Math.log2(r);
    if (l >= -FOLD_HYSTERESIS && l < 1 + FOLD_HYSTERESIS) return { ratio: r, octave };
  }
  let k = Math.floor(Math.log2(hz / base));
  let r = hz / base / Math.pow(2, k);
  if (r >= 2) {
    r /= 2;
    k++;
  } else if (r < 1) {
    r *= 2;
    k--;
  }
  return { ratio: r, octave: k };
}

// The plain fold: r = hz / 55 reduced by powers of two into [1, 2).
export function foldToChord(hz) {
  return foldSticky(hz, null).ratio;
}

// Geometric interpolation between the fixed chord (follow 0 → exactly 1)
// and the source's folded fundamental (follow 1 → r).
export function followRatio(r, follow) {
  if (!(follow > 0) || !(r > 0) || !Number.isFinite(r)) return 1;
  const v = Math.pow(r, Math.min(1, follow));
  return Number.isFinite(v) ? v : 1;
}

// --- The pitch follower ---------------------------------------------------
//
// Hann-windowed FFT of the last `size` samples every `hop`, peak-picked in
// [minHz, maxHz] with parabolic interpolation on the log magnitude. A peak
// counts only if it stands `peakOverMedian`× over the band's median magnitude
// (a tone, not noise) and the window is above the shell's presence floor;
// anything else is "unsure" and reports 0.
//
// Fundamental over harmonic: NOT a harmonic product spectrum — HPS scores a
// pure sine no higher at its own pitch than an octave below, so it cannot
// pass the plain-sine check. Instead a subharmonic check: if the spectrum
// also peaks at peak/3 or peak/2 (≥ `subRatio` of the peak's magnitude, and
// itself over the noise gate), the lowest such is taken as the fundamental.
// That catches the voice and brass case where the 2nd or 3rd harmonic
// outweighs the fundamental. The /2 case barely matters after the octave
// fold; the /3 case moves the chord by a fifth, so it does.
//
// The reported pitch is smoothed with a one-pole on log2(Hz) (`smoothS`),
// and the last confident value is held for `holdS` of unsure blocks before
// falling back to 0, so a pause between words does not drop the chord home.
// Pure and chrome-free: never throws on any input once constructed.

export class PitchFollower {
  constructor(
    sampleRate,
    {
      size = 2048,
      minHz = 55,
      maxHz = 1000,
      hop = size >> 1,
      smoothS = 0.3,
      holdS = 1,
      gateDb = -55,
      peakOverMedian = 8,
      subRatio = 0.1,
    } = {}
  ) {
    this.sr = sampleRate;
    this.n = size;
    this.hop = Math.max(1, Math.min(size, hop | 0));
    this.fft = createFFT(size);
    this.ring = new Float32Array(size);
    this.w = 0; // write index into the ring
    this.sinceHop = 0;
    this.seen = 0; // samples pushed, saturating at size
    this.re = new Float32Array(size);
    this.im = new Float32Array(size);
    this.win = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size);
    }
    this.binHz = sampleRate / size;
    this.kMin = Math.max(2, Math.floor(minHz / this.binHz));
    this.kMax = Math.min((size >> 1) - 2, Math.ceil(maxHz / this.binHz));
    this.minHz = minHz;
    this.mag = new Float32Array(size >> 1);
    this.sorted = new Float32Array(this.kMax - this.kMin + 1);
    this.gate = Math.pow(10, gateDb / 20);
    this.peakOverMedian = peakOverMedian;
    this.subRatio = subRatio;
    const hopS = this.hop / sampleRate;
    this.smoothA = 1 - Math.exp(-hopS / smoothS);
    this.hopS = hopS;
    this.holdS = holdS;
    this.logHz = null; // smoothed log2(Hz); null = nothing held
    this.unsureS = 0;
    this.conf = 0;
    this.lastRaw = 0; // the last block's unsmoothed estimate (0 = unsure)
  }

  get hz() {
    return this.logHz === null ? 0 : Math.pow(2, this.logHz);
  }

  // 0 when the last estimate was unsure; else how far the peak stood over the
  // noise gate, 0..1 (1 − gate / (peak / median)).
  get confidence() {
    return this.conf;
  }

  reset() {
    this.ring.fill(0);
    this.w = 0;
    this.sinceHop = 0;
    this.seen = 0;
    this.logHz = null;
    this.unsureS = 0;
    this.conf = 0;
    this.lastRaw = 0;
  }

  push(mono) {
    if (!mono) return;
    const { n } = this;
    for (let i = 0; i < mono.length; i++) {
      const v = mono[i];
      this.ring[this.w] = Number.isFinite(v) ? v : 0;
      this.w = (this.w + 1) % n;
      if (this.seen < n) this.seen++;
      if (++this.sinceHop >= this.hop) {
        this.sinceHop = 0;
        if (this.seen >= n) this.update(this.estimate());
      }
    }
  }

  update(raw) {
    this.lastRaw = raw;
    if (raw > 0 && Number.isFinite(raw)) {
      const l = Math.log2(raw);
      this.logHz = this.logHz === null ? l : this.logHz + this.smoothA * (l - this.logHz);
      if (!Number.isFinite(this.logHz)) this.logHz = null;
      this.unsureS = 0;
    } else {
      this.conf = 0;
      this.unsureS += this.hopS;
      if (this.unsureS > this.holdS) this.logHz = null;
    }
  }

  // Interpolated peak frequency at bin k (log-parabolic: a Hann main lobe is
  // close to Gaussian, so this is the accurate form).
  refine(k) {
    const { mag } = this;
    const a = Math.log(mag[k - 1] + 1e-20);
    const b = Math.log(mag[k] + 1e-20);
    const c = Math.log(mag[k + 1] + 1e-20);
    const den = a - 2 * b + c;
    let d = den < 0 ? (0.5 * (a - c)) / den : 0;
    if (!(Math.abs(d) <= 0.5)) d = 0;
    return (k + d) * this.binHz;
  }

  estimate() {
    const { n, re, im, win, ring, mag, kMin, kMax } = this;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = ring[(this.w + i) % n]; // oldest first
      sum += v * v;
      re[i] = v * win[i];
      im[i] = 0;
    }
    if (Math.sqrt(sum / n) < this.gate) return 0;
    this.fft.forward(re, im);
    for (let k = kMin - 1; k <= kMax + 1; k++) mag[k] = Math.hypot(re[k], im[k]);

    let kp = -1;
    let peak = 0;
    for (let k = kMin; k <= kMax; k++) {
      if (mag[k] > peak && mag[k] >= mag[k - 1] && mag[k] >= mag[k + 1]) {
        peak = mag[k];
        kp = k;
      }
    }
    if (kp < 0 || !(peak > 0)) return 0;
    const s = this.sorted;
    for (let k = kMin; k <= kMax; k++) s[k - kMin] = mag[k];
    s.sort();
    const median = s[s.length >> 1];
    const floor = this.peakOverMedian * median;
    if (!(peak > floor)) return 0;
    this.conf = Math.max(0, Math.min(1, 1 - floor / peak));

    let f = this.refine(kp);
    // Subharmonic check, lowest candidate first.
    for (const d of [3, 2]) {
      const fc = f / d;
      if (fc < this.minHz) continue;
      const kc = Math.round(fc / this.binHz);
      if (kc < kMin || kc > kMax) continue;
      let kb = kc;
      if (kc - 1 >= kMin && mag[kc - 1] > mag[kb]) kb = kc - 1;
      if (kc + 1 <= kMax && mag[kc + 1] > mag[kb]) kb = kc + 1;
      const m = mag[kb];
      if (m >= this.subRatio * peak && m > floor && m >= mag[kb - 1] && m >= mag[kb + 1]) {
        f = this.refine(kb);
        break;
      }
    }
    return Number.isFinite(f) && f > 0 ? f : 0;
  }
}

// --- Body engine: onset detection (the gated exciter's trigger) -----------
//
// Half-wave-rectified spectral flux over 512-pt frames (hop 256) against an
// adaptive running mean, with a refractory period so one physical event is
// one onset. Feed it audio in arbitrary block sizes; it returns how many
// onsets the block contained.

export class OnsetDetector {
  constructor(sampleRate, fftSize = 512) {
    this.sr = sampleRate;
    this.n = fftSize;
    this.hop = fftSize >> 1;
    this.fft = createFFT(fftSize);
    this.buf = new Float32Array(fftSize);
    this.filled = 0;
    this.re = new Float32Array(fftSize);
    this.im = new Float32Array(fftSize);
    this.win = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      this.win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / fftSize);
    }
    this.prevMag = new Float32Array(fftSize >> 1);
    this.fluxMean = 0;
    this.refractory = 0; // samples until the next onset may fire
    this.warmup = 2; // first frames establish the baseline, never fire
  }

  // Returns the number of onsets detected while consuming this block.
  process(samples) {
    let onsets = 0;
    for (let i = 0; i < samples.length; i++) {
      this.buf[this.filled++] = samples[i];
      if (this.refractory > 0) this.refractory--;
      if (this.filled === this.n) {
        if (this.analyze()) onsets++;
        this.buf.copyWithin(0, this.hop);
        this.filled = this.n - this.hop;
      }
    }
    return onsets;
  }

  analyze() {
    const { n, re, im, win, buf, prevMag } = this;
    for (let i = 0; i < n; i++) {
      re[i] = buf[i] * win[i];
      im[i] = 0;
    }
    this.fft.forward(re, im);
    let flux = 0;
    for (let k = 0; k < n >> 1; k++) {
      const mag = Math.hypot(re[k], im[k]);
      const d = mag - prevMag[k];
      if (d > 0) flux += d;
      prevMag[k] = mag;
    }
    // One-pole mean (~1 s at hop rate); onset = flux well above it.
    this.fluxMean += 0.05 * (flux - this.fluxMean);
    const fired =
      this.warmup === 0 &&
      this.refractory === 0 &&
      flux > 2.5 * this.fluxMean + 0.01;
    if (this.warmup > 0) this.warmup--;
    if (fired) this.refractory = Math.round(0.08 * this.sr);
    return fired;
  }
}

// --- Comb engine: the same tuning as a filter, not a bank -----------------
//
// One recirculating line per fundamental. The distinction that matters is not
// comb-vs-modal, it is that BOTH engines now return only their resonant part
// and the caller adds the direct signal — the source passes through the
// apparatus instead of merely driving it. `step()` therefore returns the
// feedback contribution alone, exactly as the modal bank returns its summed
// resonator outputs.
//
// Loop gain comes from the same T60 the modal bank uses, so `audioSustain`
// means the same thing in both engines and the A/B stays level-matched. The
// one-pole in the loop is the comb's version of the damping law (high partials
// lose gain every pass, so they always die first); tanh on the write-back
// bounds the line absolutely, the same discipline as the smear layer.

export function combDelaySamples(sampleRate, f0) {
  return sampleRate / f0;
}

// g such that the line decays 60 dB in t60 seconds: one pass costs D/sr.
export function combLoopGain(sampleRate, f0, t60) {
  const passSec = combDelaySamples(sampleRate, f0) / sampleRate;
  const g = Math.pow(10, (-3 * passSec) / Math.max(1e-3, t60));
  return Math.min(0.999, Math.max(0, g));
}

export class CombLine {
  constructor(sampleRate, f0, t60, damp = 0.45, minF = f0) {
    this.sr = sampleRate;
    this.f0 = f0;
    this.minF = Math.min(f0, minF); // the lowest pitch the ring can hold
    this.delay = combDelaySamples(sampleRate, f0);
    // Power-of-two ring so the read/write index is a mask, never a modulo.
    const need = Math.ceil(combDelaySamples(sampleRate, this.minF)) + 4;
    this.len = 1 << Math.ceil(Math.log2(need));
    this.mask = this.len - 1;
    this.buf = new Float32Array(this.len);
    this.w = 0;
    this.lp = 0;
    this.damp = damp;
    this.setSustain(t60);
  }

  setSustain(t60) {
    this.t60 = t60;
    this.g = combLoopGain(this.sr, this.f0, t60);
  }

  // Retune the line (the source-following body). The read is already
  // fractional — linear interpolation between taps — so no rounding to whole
  // samples; the loop gain is recomputed for the new pass length so the T60
  // holds. The ring was sized for `minF` (constructor), so a lower pitch is
  // clamped there rather than reading past the buffer.
  setFreq(f) {
    if (!(f > 0) || !Number.isFinite(f)) return;
    const fc = Math.max(this.minF, f);
    if (fc === this.f0) return;
    this.f0 = fc;
    this.delay = combDelaySamples(this.sr, fc);
    this.g = combLoopGain(this.sr, fc, this.t60);
  }

  setDamp(d) {
    this.damp = Math.min(0.95, Math.max(0, d));
  }

  reset() {
    this.buf.fill(0);
    this.lp = 0;
    this.w = 0;
  }

  // Returns the resonant contribution only; the caller adds the direct path.
  step(x) {
    const read = this.w - this.delay;
    const i0 = Math.floor(read);
    const frac = read - i0;
    const a = this.buf[i0 & this.mask];
    const b = this.buf[(i0 + 1) & this.mask];
    let v = a + (b - a) * frac;
    this.lp = (1 - this.damp) * v + this.damp * this.lp;
    v = this.lp;
    const fbk = this.g * v;
    const write = x + fbk;
    this.buf[this.w & this.mask] = Number.isFinite(write) ? Math.tanh(write) : 0;
    this.w++;
    return Number.isFinite(fbk) ? fbk : 0;
  }
}

// (The timebase engine's deflection-field DSP lived here until the bake-off
// verdict — body won. See tag `audio-bakeoff` for lagField/slewLag/heads.)
