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
// The stretch is what makes the bank read as an *object* rather than a comb
// (modal resonators, not waveguide combs: a comb would drag in its own
// integer harmonics and swamp the stretch). Damping references the lowest
// fundamental so high modes always die faster, one global physical law.

export const BODY_FUNDAMENTALS = [55, 82.5, 137.5];
export const BODY_PARTIALS = 16;
export const BODY_STRETCH = 4e-4;
export const BODY_DAMP_EXP = 0.7;

export function modeTable(sampleRate, t60Base) {
  const fLow = BODY_FUNDAMENTALS[0];
  const modes = [];
  for (const f0 of BODY_FUNDAMENTALS) {
    for (let k = 1; k <= BODY_PARTIALS; k++) {
      const f = k * f0 * Math.sqrt(1 + BODY_STRETCH * k * k);
      if (f >= 0.45 * sampleRate) continue; // safety, not expected to fire
      modes.push({
        f,
        t60: t60Base * Math.pow(fLow / f, BODY_DAMP_EXP),
        amp: 1 / Math.sqrt(k), // natural spectral tilt: high partials quieter
      });
    }
  }
  return modes;
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

// (The timebase engine's deflection-field DSP lived here until the bake-off
// verdict — body won. See tag `audio-bakeoff` for lagField/slewLag/heads.)
