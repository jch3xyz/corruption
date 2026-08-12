// The DEFLECTION audio processor: two complete engines behind one node,
// switched live by the `mode` param with an equal-power crossfade — the
// bake-off happens on real material, not in descriptions.
//
//   body     — a fixed resonant body struck by the stream. 48 modal
//              resonators (stretched partials over three just fundamentals);
//              the browsing only decides when and how hard it is struck.
//   timebase — the clock is deformed, not the signal. A 45 s reservoir read
//              by five heads whose lags bend under a slow shaped field.
//
// Discipline (from the multiple-perspectives run):
// - lag is the controlled variable, rate is derived (slew-clamped);
// - non-finite guards on everything entering recursive state;
// - silence in → silence out is enforced by an output gate, exact zeros;
// - process() must never throw: a dead processor is permanently silent
//   media, which violates "never break the page".

import {
  rms,
  modeTable,
  OnsetDetector,
  lagField,
  slewLag,
  HEAD_LAGS,
  HEAD_GAINS,
  HEAD_PANS,
  RING_S,
  LAG_MIN_S,
  panGains,
} from './dsp.js';

const XFADE_S = 0.1;
const PRESENCE_OPEN_DB = -55;
const PRESENCE_CLOSE_DB = -65;
const PRESENCE_CLOSE_S = 0.2;
const MUTE_FLOOR = 1e-4; // −80 dBFS
const BODY_STATE_CAP = 0.35; // per-mode amplitude bound (hard backstop)
const BODY_OUT_GAIN = 0.4;
const BODY_CONT_BOOST = 4; // continuous-path peak gain = amp × this

const DEFAULT_PARAMS = {
  mode: 'body',
  sustain: 6,
  drive: 0.5,
  exciter: 'gated',
  depth: 0.8,
  fieldRate: 1,
  tail: 1.5,
  fb: false,
  fbDecay: 0.96,
  fbClearS: 1, // keyframe clears fade the wash over ~this long; 0 = hard cut
  driftY: 0.0015, // |driftY|·100 = delay wobble depth, as the first audio phase had it
  resetMinS: 4,
  resetMaxS: 10,
};

// --- Engine: fixed resonant body ------------------------------------------

class BodyEngine {
  constructor(sr, channels, p) {
    this.sr = sr;
    this.channels = channels;
    this.sustain = p.sustain;
    this.modes = modeTable(sr, this.sustain);
    const n = this.modes.length;
    this.a1 = new Float64Array(n);
    this.a2 = new Float64Array(n);
    this.gGate = new Float64Array(n); // impulse-normalized: strikes ring
    this.gCont = new Float64Array(n); // peak-normalized (resonz): drones bounded
    this.y1 = []; // per channel per mode
    this.y2 = [];
    this.x1 = new Float64Array(channels); // exciter history for the resonz zeros
    this.x2 = new Float64Array(channels);
    for (let c = 0; c < channels; c++) {
      this.y1.push(new Float64Array(n));
      this.y2.push(new Float64Array(n));
    }
    this.coeffsDirty = true;
    this.onset = new OnsetDetector(sr);
    this.env = 0; // gated-exciter envelope
    this.envStage = 0; // samples left in hold
  }

  setSustain(s) {
    if (s === this.sustain) return;
    this.sustain = s;
    this.coeffsDirty = true;
  }

  // Two normalizations, one per exciter. Gated strikes want impulse
  // normalization (the ring is the point). Continuous drive wants the
  // constant-peak-gain resonz form — a plain two-pole's low-frequency
  // skirt lets one sustained tone pin all 48 modes at their caps and the
  // sum rails the clip (harness-caught). The (1 − z⁻²) zeros kill that
  // skirt, so continuous input excites only its sympathetic partials.
  refreshCoeffs() {
    const table = modeTable(this.sr, this.sustain);
    for (let i = 0; i < table.length; i++) {
      const m = table[i];
      const r = Math.pow(10, -3 / (m.t60 * this.sr));
      const w = (2 * Math.PI * m.f) / this.sr;
      this.a1[i] = 2 * r * Math.cos(w);
      this.a2[i] = r * r;
      this.gGate[i] = m.amp;
      this.gCont[i] = ((m.amp * (1 - r * r)) / 2) * BODY_CONT_BOOST;
    }
    this.coeffsDirty = false;
  }

  reset() {
    for (const y of this.y1) y.fill(0);
    for (const y of this.y2) y.fill(0);
    this.x1.fill(0);
    this.x2.fill(0);
    this.env = 0;
    this.envStage = 0;
  }

  energy() {
    let e = 0;
    for (const y of this.y1) for (let i = 0; i < y.length; i++) e += y[i] * y[i];
    return e;
  }

  process(inBufs, outBufs, channels, n, p, monoIn) {
    if (this.coeffsDirty) this.refreshCoeffs();
    const gated = p.exciter === 'gated';
    if (gated && this.onset.process(monoIn) > 0) {
      this.envStage = Math.round(0.06 * this.sr); // 60 ms hold
    }
    const nModes = this.a1.length;
    const attack = 1 - Math.exp(-1 / (0.005 * this.sr));
    const release = 1 - Math.exp(-1 / (0.05 * this.sr));
    const drive = p.drive;
    for (let s = 0; s < n; s++) {
      // Gated: a raised-cosine-ish AR envelope opened by onsets, so the
      // body is *struck*, never continuously driven (the drone kill
      // condition). Continuous: the honest comparison, bounded by caps.
      if (gated) {
        const target = this.envStage > 0 ? 1 : 0;
        if (this.envStage > 0) this.envStage--;
        this.env += (target - this.env) * (target > this.env ? attack : release);
      }
      const exc = gated ? this.env * drive : drive;
      for (let c = 0; c < channels; c++) {
        const x = inBufs[c][s] * exc;
        const xz = x - this.x2[c]; // resonz numerator (1 − z⁻²)
        this.x2[c] = this.x1[c];
        this.x1[c] = x;
        const y1 = this.y1[c];
        const y2 = this.y2[c];
        const g = gated ? this.gGate : this.gCont;
        const inj = gated ? x : xz;
        let sum = 0;
        for (let i = 0; i < nModes; i++) {
          // The cap is per-sample: a resonantly driven mode grows several
          // × per 128-sample block, so a block-rate cap would let the
          // output rail the clip between checks (harness-caught).
          let y = this.a1[i] * y1[i] - this.a2[i] * y2[i] + g[i] * inj;
          if (y > BODY_STATE_CAP) y = BODY_STATE_CAP;
          else if (y < -BODY_STATE_CAP) y = -BODY_STATE_CAP;
          y2[i] = y1[i];
          y1[i] = y;
          sum += y;
        }
        outBufs[c][s] = sum * BODY_OUT_GAIN;
      }
    }
    // Block-rate state hygiene: flush denormals, purge non-finite.
    for (let c = 0; c < channels; c++) {
      const y1 = this.y1[c];
      const y2 = this.y2[c];
      for (let i = 0; i < nModes; i++) {
        const a = y1[i];
        const b = y2[i];
        if (!Number.isFinite(a) || !Number.isFinite(b)) {
          y1[i] = 0;
          y2[i] = 0;
        } else if (Math.abs(a) < 1e-18 && Math.abs(b) < 1e-18) {
          y1[i] = 0;
          y2[i] = 0;
        }
      }
    }
  }
}

// --- Engine: time-base deflection -----------------------------------------

class TimebaseEngine {
  constructor(sr, channels) {
    this.sr = sr;
    this.channels = channels;
    this.n = Math.ceil(RING_S * sr);
    this.ring = new Float32Array(this.n);
    this.writeAbs = this.n; // start one ring in: reads never go negative
    this.heads = HEAD_LAGS.map((base, i) => ({
      base,
      lag: base,
      target: base,
      gain: HEAD_GAINS[i],
      pans: panGains(HEAD_PANS[i], channels),
      lp: 0, // anti-alias one-pole state (engaged when rate > 1)
      alpha: 1,
      initialized: false,
    }));
    this.tailEnv = 0;
  }

  reset() {
    // Envelopes only — the reservoir IS the piece's memory; silence must
    // not erase it, only gate it.
    this.tailEnv = 0;
    for (const h of this.heads) h.lp = 0;
  }

  energy() {
    return this.tailEnv;
  }

  read(pos) {
    const n = this.n;
    const i0 = Math.floor(pos);
    const u = pos - i0;
    const r = this.ring;
    const im1 = (((i0 - 1) % n) + n) % n;
    const i1 = (im1 + 1) % n;
    const i2 = (im1 + 2) % n;
    const i3 = (im1 + 3) % n;
    const p0 = r[im1];
    const p1 = r[i1];
    const p2 = r[i2];
    const p3 = r[i3];
    // Catmull-Rom
    return (
      p1 +
      0.5 *
        u *
        (p2 -
          p0 +
          u * (2 * p0 - 5 * p1 + 4 * p2 - p3 + u * (3 * (p1 - p2) + p3 - p0)))
    );
  }

  process(inBufs, outBufs, channels, n, p, monoIn, present) {
    const sr = this.sr;
    const dt = 1 / sr;
    const blockS = n / sr;
    // Field time scales with fieldRate; targets computed at block rate,
    // slewed per sample — lag is the controlled variable, always.
    const tField = (currentFrame / sr) * p.fieldRate;
    const lagMax = RING_S - 1;
    for (const [i, h] of this.heads.entries()) {
      const s = lagField(tField, i + 1);
      let target = h.base * Math.pow(2, p.depth * s);
      if (target < LAG_MIN_S) target = LAG_MIN_S;
      if (target > lagMax) target = lagMax;
      if (!h.initialized) {
        h.lag = target;
        h.initialized = true;
      }
      h.target = target;
      const rate = Math.min(
        1.75,
        Math.max(0.25, 1 - (target - h.lag) / Math.max(blockS, 1e-6))
      );
      h.alpha = rate <= 1 ? 1 : Math.min(1, 1.2 / rate);
    }
    // Tail: presence-open pulls the heads up fast; presence-closed lets
    // them speak for `tail` seconds — the silence-semantics knob.
    const tailTau = present ? 0.05 : Math.max(0.005, p.tail / 3);
    const tailCoef = 1 - Math.exp(-1 / (tailTau * sr));
    const tailTarget = present ? 1 : 0;

    for (let s = 0; s < n; s++) {
      if (present) {
        const x = monoIn[s];
        this.ring[this.writeAbs % this.n] = Number.isFinite(x) ? x : 0;
        this.writeAbs++;
      }
      this.tailEnv += (tailTarget - this.tailEnv) * tailCoef;
      for (let c = 0; c < channels; c++) outBufs[c][s] = 0;
      for (const h of this.heads) {
        h.lag = slewLag(h.lag, h.target, dt);
        // writeAbs already counts this sample, so "lag seconds ago" is
        // writeAbs − 1 − lag·sr (the off-by-one decorrelates the identity
        // check on noise — harness-caught).
        let y = this.read(this.writeAbs - 1 - h.lag * this.sr);
        if (h.alpha < 1) {
          h.lp += (y - h.lp) * h.alpha;
          y = h.lp;
        } else {
          h.lp = y;
        }
        const v = y * h.gain * this.tailEnv;
        for (let c = 0; c < channels; c++) {
          outBufs[c][s] += v * h.pans[Math.min(c, h.pans.length - 1)];
        }
      }
    }
  }
}

// --- Feedback/smear layer ---------------------------------------------------
//
// A LAYER, not a mode (ported intact from the first audio phase): the mixed
// engine output recirculates through a 0.35 s delay line whose read point
// wobbles on a 0.1 Hz LFO, tanh-clipped on write-back, hard-cleared on the
// same jittered keyframe rhythm as the video accumulator. It sits after the
// mode crossfade, so it smears whichever engine is speaking — and the smear
// itself carries across a live A/B switch.

class FeedbackLayer {
  constructor(sr, channels) {
    this.sr = sr;
    this.channels = channels;
    this.len = Math.ceil(2 * sr);
    this.lines = Array.from({ length: channels }, () => new Float32Array(this.len));
    this.w = 0;
    this.phase = 0;
    this.nextResetAt = -1; // scheduled on first process (needs params)
    this.clearEnv = 1; // keyframe fade: echo return × this while clearing
    this.clearing = false;
    this.pendingFill = false;
  }

  reset() {
    for (const line of this.lines) line.fill(0);
    this.nextResetAt = -1;
    this.clearEnv = 1;
    this.clearing = false;
    this.pendingFill = false;
  }

  scheduleReset(p) {
    const minS = p.resetMinS ?? 4;
    const maxS = Math.max(minS, p.resetMaxS ?? 10);
    return currentFrame + (minS + Math.random() * (maxS - minS)) * this.sr;
  }

  process(bufs, channels, n, p) {
    // fbDecay 0.8..0.999 → feedback gain 0.5..0.95 (the visual decay
    // knob's range, so the knob feels like the same knob).
    const gain = Math.min(0.95, 0.5 + (((p.fbDecay ?? 0.96) - 0.8) / 0.199) * 0.45);
    const base = 0.35 * this.sr;
    const modDepth = Math.min(0.4, Math.abs(p.driftY ?? 0) * 100);
    const phaseInc = (2 * Math.PI * 0.1) / this.sr;

    // The keyframe. Hard cut works for video (one frame in an already
    // glitching image) but audio hears the wash vanish in a sample, so the
    // clear fades the echo return over ~fbClearS seconds first, then wipes
    // the line while it is inaudible. fbClearS 0 = the original hard cut.
    const clearS = Math.max(0, p.fbClearS ?? 1);
    if (this.nextResetAt < 0) this.nextResetAt = this.scheduleReset(p);
    if (!this.clearing && currentFrame >= this.nextResetAt) {
      if (clearS < 0.01) {
        for (const line of this.lines) line.fill(0);
      } else {
        this.clearing = true; // rhythm counts from the start of the fade
      }
      this.nextResetAt = this.scheduleReset(p);
    }
    // τ = clearS/7 → the envelope reaches its floor in ≈ clearS seconds.
    const clearCoef = clearS >= 0.01 ? 1 - Math.exp(-7 / (clearS * this.sr)) : 1;

    for (let i = 0; i < n; i++) {
      this.phase += phaseInc;
      const delay = base * (1 + modDepth * Math.sin(this.phase));
      if (this.clearing) {
        this.clearEnv -= this.clearEnv * clearCoef;
        if (this.clearEnv < 1e-3) {
          this.clearing = false;
          this.pendingFill = true; // wipe at block end, off the hot path
        }
      }
      const env = this.clearing || this.pendingFill ? this.clearEnv : 1;
      for (let c = 0; c < channels; c++) {
        const line = this.lines[c];
        const readPos = this.w - delay;
        const r0 = Math.floor(readPos);
        const frac = readPos - r0;
        const a = line[((r0 % this.len) + this.len) % this.len];
        const b = line[(((r0 + 1) % this.len) + this.len) % this.len];
        const echo = (a + (b - a) * frac) * env;
        const y = bufs[c][i] + gain * echo;
        line[this.w % this.len] = Math.tanh(y);
        bufs[c][i] = y;
      }
      this.w++;
    }

    if (this.pendingFill) {
      for (const line of this.lines) line.fill(0);
      this.pendingFill = false;
      this.clearEnv = 1;
    }
  }
}

// --- The shared shell ------------------------------------------------------

class DeflectionAudio extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.p = { ...DEFAULT_PARAMS, ...(options?.processorOptions?.params ?? {}) };
    // Test affordance: deterministic mid-render param changes for the
    // offline harness ({ atS, params } list; postMessage can't be
    // sample-accurate against an offline render).
    this.script = (options?.processorOptions?.script ?? [])
      .slice()
      .sort((a, b) => a.atS - b.atS);
    this.body = null;
    this.timebase = null;
    this.channels = 0;
    this.inBufs = null;
    this.outA = null;
    this.outB = null;
    this.monoIn = null;
    this.dcX = null;
    this.dcY = null;
    this.prevMode = null;
    this.xfadeLeft = 0;
    this.present = false;
    this.closeBlocks = 0;
    this.quietBlocks = 0;
    this.muted = false;
    this.statsAtFrame = 0;
    this.lastLoudFrame = 0;

    this.port.onmessage = (e) => {
      const m = e.data;
      if (m?.type === 'params' && m.params) this.applyParams(m.params);
    };
  }

  applyParams(params) {
    const prev = this.p.mode;
    Object.assign(this.p, params);
    if (this.p.mode !== prev) {
      this.prevMode = prev;
      this.xfadeLeft = Math.round(XFADE_S * sampleRate);
    }
    this.body?.setSustain(this.p.sustain);
  }

  ensure(channels, n) {
    if (this.channels === channels && this.inBufs && this.inBufs[0].length >= n)
      return;
    this.channels = channels;
    this.inBufs = [];
    this.outA = [];
    this.outB = [];
    for (let c = 0; c < channels; c++) {
      this.inBufs.push(new Float32Array(n));
      this.outA.push(new Float32Array(n));
      this.outB.push(new Float32Array(n));
    }
    this.monoIn = new Float32Array(n);
    this.dcX = new Float32Array(channels);
    this.dcY = new Float32Array(channels);
    this.body = new BodyEngine(sampleRate, channels, this.p);
    this.timebase = new TimebaseEngine(sampleRate, channels);
    this.fbLayer = new FeedbackLayer(sampleRate, channels);
  }

  engine(name) {
    return name === 'timebase' ? this.timebase : this.body;
  }

  renderEngine(name, out, channels, n) {
    this.engine(name).process(
      this.inBufs,
      out,
      channels,
      n,
      this.p,
      this.monoIn,
      this.present
    );
  }

  process(inputs, outputs) {
    try {
      const input = inputs[0];
      const output = outputs[0];
      if (!input || input.length === 0 || !input[0]) return true; // bypassed: idle

      const n = input[0].length;
      const channels = Math.min(input.length, output.length);
      this.ensure(channels, n);

      while (this.script.length && currentFrame / sampleRate >= this.script[0].atS) {
        this.applyParams(this.script.shift().params);
      }

      // Sanitize + DC-block into scratch; derive the mono feed.
      for (let c = 0; c < channels; c++) {
        const src = input[c];
        const dst = this.inBufs[c];
        let x1 = this.dcX[c];
        let y1 = this.dcY[c];
        for (let s = 0; s < n; s++) {
          const raw = src[s];
          const x = Number.isFinite(raw) ? raw : 0;
          y1 = x - x1 + 0.9995 * y1;
          x1 = x;
          dst[s] = y1;
        }
        this.dcX[c] = x1;
        this.dcY[c] = Number.isFinite(y1) ? y1 : 0;
      }
      for (let s = 0; s < n; s++) {
        let m = 0;
        for (let c = 0; c < channels; c++) m += this.inBufs[c][s];
        this.monoIn[s] = m / channels;
      }

      // Presence: opens instantly, closes after 200 ms below the floor.
      const inR = rms(this.monoIn, 0, n);
      const inDb = 20 * Math.log10(inR + 1e-12);
      if (inDb > PRESENCE_OPEN_DB) {
        this.present = true;
        this.closeBlocks = 0;
        this.muted = false;
        this.quietBlocks = 0;
      } else if (this.present && inDb < PRESENCE_CLOSE_DB) {
        this.closeBlocks++;
        if (this.closeBlocks * n >= PRESENCE_CLOSE_S * sampleRate) {
          this.present = false;
          this.closeBlocks = 0;
        }
      }

      if (this.muted) {
        for (let c = 0; c < output.length; c++) output[c].fill(0);
        this.tickStats(inR);
        return true;
      }

      this.renderEngine(this.p.mode, this.outA, channels, n);
      if (this.xfadeLeft > 0 && this.prevMode) {
        this.renderEngine(this.prevMode, this.outB, channels, n);
        const w = this.xfadeLeft / (XFADE_S * sampleRate); // 1 → 0
        const gNew = Math.cos((w * Math.PI) / 2);
        const gOld = Math.sin((w * Math.PI) / 2);
        for (let c = 0; c < channels; c++) {
          const a = this.outA[c];
          const b = this.outB[c];
          for (let s = 0; s < n; s++) a[s] = a[s] * gNew + b[s] * gOld;
        }
        this.xfadeLeft = Math.max(0, this.xfadeLeft - n);
        if (this.xfadeLeft === 0) this.prevMode = null;
      }

      // The smear layer runs on the mixed engine output, pre-clip.
      if (this.p.fb) this.fbLayer.process(this.outA, channels, n, this.p);

      // Soft clip at −6 dBFS and write out; the gate below may still zero it.
      let outPeak = 0;
      for (let c = 0; c < channels; c++) {
        const dst = output[c];
        const a = this.outA[c];
        for (let s = 0; s < n; s++) {
          const clipped = 0.5 * Math.tanh(a[s] * 2);
          dst[s] = clipped;
          const abs = Math.abs(clipped);
          if (abs > outPeak) outPeak = abs;
        }
      }
      for (let c = channels; c < output.length; c++) output[c].set(output[0]);

      // Silence gate: with input absent and the engines at the floor, snap
      // to exact zeros and reset ring-down state (silence in, silence out —
      // enforced, not asymptotic).
      if (!this.present) {
        if (outPeak < MUTE_FLOOR) this.quietBlocks++;
        else this.quietBlocks = 0;
        if (this.quietBlocks > 5) {
          this.muted = true;
          this.body?.reset();
          this.timebase?.reset();
          this.fbLayer?.reset(); // stale echoes must not return with presence
          for (let c = 0; c < output.length; c++) output[c].fill(0);
        }
      }

      this.tickStats(inR);
      return true;
    } catch (err) {
      // A throw would kill the processor permanently (and with it the
      // element's audio, since taps are irreversible). Report, output
      // silence for this quantum, keep living.
      try {
        this.port.postMessage({ type: 'error', message: String(err) });
        for (const ch of outputs[0] ?? []) ch.fill(0);
      } catch {
        /* nothing left to do */
      }
      return true;
    }
  }

  tickStats(inR) {
    if (inR > 1e-4) this.lastLoudFrame = currentFrame;
    if (currentFrame - this.statsAtFrame >= sampleRate) {
      this.statsAtFrame = currentFrame;
      this.port.postMessage({
        type: 'stats',
        rms: inR,
        silentMs: ((currentFrame - this.lastLoudFrame) / sampleRate) * 1000,
      });
    }
  }
}

registerProcessor('deflection-audio', DeflectionAudio);
