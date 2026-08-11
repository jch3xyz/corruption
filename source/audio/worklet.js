// The DEFLECTION audio processor — the fragment shader for sound. Runs on
// the audio rendering thread in 128-sample quanta. One registration serves
// every tap; the algorithm switches live via params.
//
// Modes:
//   spectral — STFT (N=2048, 50% overlap, sqrt-Hann both sides); magnitude
//     spectrum gets the stride-ladder compare-exchange with quiet bins as
//     barriers; phases stay put. Latency = N samples (~43 ms @ 48 kHz).
//   granular — double-buffered window: record window k while playing the
//     reordered window k−1. Grains sorted by RMS, loud toward the window
//     start, threshold-gated. Latency = the window (0.25–2 s); the window
//     boundary is the keyframe rhythm. Passthrough while the first window
//     fills so engagement never opens with silence.
//
// The feedback accumulator is a LAYER, not a mode: when params.feedback is
// on it runs after either mode — a decaying, slowly drifting delay line
// that hard-clears on the same jittered reset rhythm as the video
// accumulator (decay → feedback gain, |driftY| → delay drift depth).
//
// Allocate-once discipline applies verbatim: mode state allocates on first
// use or param change, never inside process().

import { ladderSchedule, sortIndicesPass, sortValuesPass, rms } from './dsp.js';
import { createFFT } from './fft.js';

const N = 2048; // spectral frame
const HOP = N / 2;

class DeflectionAudio extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.p = {
      algorithm: 'spectral',
      threshold: 0,
      passes: 8,
      grainMs: 60,
      windowS: 1,
      feedback: false,
      decay: 0.96,
      driftY: 0.0015,
      resetMinS: 4,
      resetMaxS: 10,
    };
    Object.assign(this.p, options?.processorOptions?.params ?? {});

    this.spec = null; // per-channel spectral state
    this.gran = null; // granular state
    this.fb = null; // feedback state
    this.ladder = ladderSchedule(256);
    this.statsAtFrame = 0;
    this.lastLoudFrame = 0;

    this.port.onmessage = (e) => {
      const m = e.data;
      if (m?.type === 'params') {
        const prev = { grainMs: this.p.grainMs, windowS: this.p.windowS };
        Object.assign(this.p, m.params);
        if (
          this.gran &&
          (prev.grainMs !== this.p.grainMs || prev.windowS !== this.p.windowS)
        ) {
          this.gran = null; // realloc lazily; refills via passthrough
        }
      }
      if (m?.type === 'reset' && this.fb) {
        for (const line of this.fb.lines) line.fill(0);
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !input[0]) return true; // bypassed: idle

    const channels = Math.min(input.length, output.length);
    if (this.p.algorithm === 'granular') {
      this.processGranular(input, output, channels);
    } else {
      this.processSpectral(input, output, channels);
    }
    if (this.p.feedback) this.processFeedback(output, channels);

    // Lightweight telemetry ~1/s: lets the page side log silent taps
    // (CORS/DRM silence is unrecoverable — see graph.js gate).
    if (currentFrame - this.statsAtFrame >= sampleRate) {
      this.statsAtFrame = currentFrame;
      const r = rms(input[0], 0, input[0].length);
      if (r > 1e-4) this.lastLoudFrame = currentFrame;
      this.port.postMessage({
        type: 'stats',
        rms: r,
        silentMs: ((currentFrame - this.lastLoudFrame) / sampleRate) * 1000,
      });
    }
    return true;
  }

  // --- spectral -----------------------------------------------------------

  ensureSpectral(channels) {
    if (this.spec && this.spec.channels === channels) return;
    const win = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N)); // sqrt-Hann
    }
    this.spec = {
      channels,
      win,
      fft: createFFT(N),
      ch: Array.from({ length: channels }, () => ({
        buf: new Float32Array(N), // sliding analysis history
        pos: 0,
        ola: new Float32Array(2 * N), // overlap-add ring
        re: new Float32Array(N),
        im: new Float32Array(N),
        mags: new Float32Array(N / 2),
        t: 0, // absolute sample counter for ring addressing
      })),
    };
  }

  processSpectral(input, output, channels) {
    this.ensureSpectral(channels);
    const s = this.spec;
    for (let c = 0; c < channels; c++) {
      const st = s.ch[c];
      const inC = input[c];
      const outC = output[c];
      for (let i = 0; i < inC.length; i++) {
        st.buf[st.pos++] = inC[i];
        // Emit (delayed by N), then clear the consumed ring cell.
        const rp = st.t % (2 * N);
        outC[i] = st.ola[rp];
        st.ola[rp] = 0;
        st.t++;
        if (st.pos === N) {
          this.spectralFrame(st);
          st.buf.copyWithin(0, HOP); // slide by one hop
          st.pos = N - HOP;
        }
      }
    }
  }

  spectralFrame(st) {
    const { win, fft } = this.spec;
    const { re, im, mags } = st;
    for (let i = 0; i < N; i++) {
      re[i] = st.buf[i] * win[i];
      im[i] = 0;
    }
    fft.forward(re, im);

    // Sort magnitudes over bins 1..N/2-1 (leave DC and Nyquist anchored);
    // phases stay with their bins — the classic smeared-organ variant.
    let maxMag = 0;
    for (let k = 1; k < N / 2; k++) {
      const m = Math.hypot(re[k], im[k]);
      mags[k] = m;
      if (m > maxMag) maxMag = m;
    }
    const passes = this.p.passes | 0;
    if (passes > 0 && maxMag > 0) {
      const sorted = mags; // in place
      const cutoff = this.p.threshold * maxMag;
      for (let i = 0; i < passes; i++) {
        const [stride, parity] = this.ladder[i % this.ladder.length];
        sortValuesPass(sorted, stride, parity, cutoff, 1, N / 2);
      }
      for (let k = 1; k < N / 2; k++) {
        const m = Math.hypot(re[k], im[k]);
        const scale = m > 1e-12 ? sorted[k] / m : 0;
        re[k] = m > 1e-12 ? re[k] * scale : sorted[k];
        im[k] = m > 1e-12 ? im[k] * scale : 0;
        // Hermitian mirror so the inverse transform stays real.
        re[N - k] = re[k];
        im[N - k] = -im[k];
      }
    }

    fft.inverse(re, im);
    const base = st.t; // this frame starts playing N samples after its input began
    for (let i = 0; i < N; i++) {
      st.ola[(base + i) % (2 * N)] += re[i] * win[i];
    }
  }

  // --- granular ------------------------------------------------------------

  ensureGranular(channels) {
    if (this.gran && this.gran.channels === channels) return;
    const gs = Math.max(64, Math.round((this.p.grainMs / 1000) * sampleRate));
    const grains = Math.max(
      2,
      Math.floor((this.p.windowS * sampleRate) / gs)
    );
    const ws = grains * gs;
    this.gran = {
      channels,
      gs,
      grains,
      ws,
      rec: Array.from({ length: channels }, () => new Float32Array(ws)),
      play: Array.from({ length: channels }, () => new Float32Array(ws)),
      keys: new Float32Array(grains),
      order: new Uint16Array(grains),
      fade: Math.min(Math.round(0.005 * sampleRate), gs >> 2),
      recPos: 0,
      playPos: 0,
      filled: false,
    };
  }

  processGranular(input, output, channels) {
    this.ensureGranular(channels);
    const g = this.gran;
    const len = input[0].length;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < channels; c++) {
        g.rec[c][g.recPos] = input[c][i];
        // Passthrough until the first window is banked — engagement must
        // never open with a window of silence.
        output[c][i] = g.filled ? g.play[c][g.playPos] : input[c][i];
      }
      g.recPos++;
      if (g.filled) g.playPos++;
      if (g.recPos === g.ws) {
        this.granularWindow(channels);
        g.recPos = 0;
        g.playPos = 0;
        g.filled = true;
      }
    }
  }

  granularWindow(channels) {
    const g = this.gran;
    // Grain loudness from the channel mix; one permutation for all channels
    // keeps the stereo image coherent.
    let maxKey = 0;
    for (let k = 0; k < g.grains; k++) {
      let sum = 0;
      for (let c = 0; c < channels; c++) {
        const r = rms(g.rec[c], k * g.gs, g.gs);
        sum += r;
      }
      g.keys[k] = sum / channels;
      if (g.keys[k] > maxKey) maxKey = g.keys[k];
      g.order[k] = k;
    }
    const passes = this.p.passes | 0;
    if (passes > 0 && maxKey > 0) {
      const cutoff = this.p.threshold * maxKey;
      for (let i = 0; i < passes; i++) {
        const [stride, parity] = this.ladder[i % this.ladder.length];
        sortIndicesPass(g.keys, g.order, stride, parity, cutoff);
      }
    }
    const F = g.fade;
    for (let c = 0; c < channels; c++) {
      const rec = g.rec[c];
      const play = g.play[c];
      for (let slot = 0; slot < g.grains; slot++) {
        const src = g.order[slot] * g.gs;
        const dst = slot * g.gs;
        play.set(rec.subarray(src, src + g.gs), dst);
        // Raised-cosine edge fades kill boundary clicks; the faint
        // grain-rate shimmer that remains suits the piece.
        for (let f = 0; f < F; f++) {
          const w = 0.5 - 0.5 * Math.cos((Math.PI * f) / F);
          play[dst + f] *= w;
          play[dst + g.gs - 1 - f] *= w;
        }
      }
    }
  }

  // --- feedback layer -------------------------------------------------------

  ensureFeedback(channels) {
    if (this.fb && this.fb.channels === channels) return;
    const len = Math.ceil(2 * sampleRate);
    this.fb = {
      channels,
      len,
      lines: Array.from({ length: channels }, () => new Float32Array(len)),
      w: 0,
      phase: 0,
      nextResetAt: this.scheduleReset(),
    };
  }

  scheduleReset() {
    const minS = this.p.resetMinS ?? 4;
    const maxS = Math.max(minS, this.p.resetMaxS ?? 10);
    return currentFrame + (minS + Math.random() * (maxS - minS)) * sampleRate;
  }

  processFeedback(output, channels) {
    this.ensureFeedback(channels);
    const fb = this.fb;
    const len = output[0].length;
    // decay 0.8..0.999 → feedback gain 0.5..0.95
    const gain = Math.min(
      0.95,
      0.5 + ((this.p.decay - 0.8) / 0.199) * 0.45
    );
    const base = 0.35 * sampleRate;
    const modDepth = Math.min(0.4, Math.abs(this.p.driftY) * 100);
    const phaseInc = (2 * Math.PI * 0.1) / sampleRate;

    if (currentFrame >= fb.nextResetAt) {
      for (const line of fb.lines) line.fill(0); // the keyframe: hard clear
      fb.nextResetAt = this.scheduleReset();
    }

    for (let i = 0; i < len; i++) {
      fb.phase += phaseInc;
      const delay = base * (1 + modDepth * Math.sin(fb.phase));
      for (let c = 0; c < channels; c++) {
        const line = fb.lines[c];
        const readPos = fb.w - delay;
        const r0 = Math.floor(readPos);
        const frac = readPos - r0;
        const a = line[((r0 % fb.len) + fb.len) % fb.len];
        const b = line[(((r0 + 1) % fb.len) + fb.len) % fb.len];
        const echo = a + (b - a) * frac;
        const y = output[c][i] + gain * echo;
        line[fb.w % fb.len] = Math.tanh(y);
        output[c][i] = y;
      }
      fb.w++;
    }
  }
}

registerProcessor('deflection-audio', DeflectionAudio);
