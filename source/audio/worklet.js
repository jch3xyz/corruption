// The DEFLECTION audio processor: a fixed resonant body struck by the
// stream, smeared by a recirculating feedback layer. The bake-off verdict
// (John, 2026-08-11): body + continuous exciter won; the timebase engine is
// preserved at tag `audio-bakeoff`, never resurrected by accident.
//
//   body — 48 modal resonators (stretched partials over three just
//          fundamentals); the browsing only decides when and how hard the
//          body is driven. Identity lives in the apparatus, not the source.
//          With `follow` up, the chord retunes toward the source's own
//          pitch (design review M8) — the source still passes through; only
//          where the apparatus rings moves. follow 0 is the fixed chord.
//
// Discipline (from the multiple-perspectives run):
// - non-finite guards on everything entering recursive state;
// - silence in → silence out is enforced by an output gate, exact zeros;
// - process() must never throw: a dead processor is permanently silent
//   media, which violates "never break the page".

import {
  rms,
  modeTable,
  OnsetDetector,
  CombLine,
  BODY_FUNDAMENTALS,
  PitchFollower,
  foldSticky,
  followRatio,
} from './dsp.js';

const PRESENCE_OPEN_DB = -55;
const PRESENCE_CLOSE_DB = -65;
const PRESENCE_CLOSE_S = 0.2;
const MUTE_FLOOR = 1e-4; // −80 dBFS
const BODY_STATE_CAP = 0.35; // per-mode amplitude bound (hard backstop)
const BODY_OUT_GAIN = 0.4;
const BODY_CONT_BOOST = 4; // continuous-path peak gain = amp × this
const COMB_OUT_GAIN = 0.5; // three lines, each level-normalised by (1 − g)
// The source-following body (design review M8). Retuning is per block, and
// only once the glided ratio has moved this far since the last retune — the
// step is far below what the ear resolves on a ringing partial.
const TUNE_EPS = 0.002; // 0.2 %
const FOLLOW_GLIDE_S = 0.2; // one-pole on log(ratio): the chord never jumps
const TUNE_MIN = 0.5; // backstop only: the sticky fold keeps the ratio in
const TUNE_MAX = 4; //   [2^(−1/12), 2^(13/12)); the comb rings are sized for 0.5

const DEFAULT_PARAMS = {
  body: 'modal', // which apparatus the signal passes through: modal | comb
  direct: 1, // the direct signal INSIDE the DSP. 0 = the pre-2026-08-13
  //           behaviour, where the output never contained the input at all
  bodyMix: 1, // resonant part against the direct path — the identity dial
  combDamp: 0.45, // comb only: loop lowpass, metallic ↔ woody
  sustain: 12,
  drive: 1.0,
  exciter: 'continuous',
  fb: true,
  fbDecay: 0.999,
  fbReturn: 0.25, // wash level as a FRACTION OF THE LOOP GAIN, so 1 is
  //                 exactly the pre-2026-08-13 behaviour. Split out because
  //                 one number used to set both the tail length and the wash
  //                 level: at loop gain 0.95 the wash settles ~1/(1−g) ≈ 20×
  //                 over the direct sound and buries whatever is playing.
  fbClear: false, // smear runs continuous by default: gain < 1 IS its decay
  fbClearS: 1, // when clearing: fade the wash over ~this long; 0 = hard cut
  wobble: 0, // delay wobble depth, 0..0.4; 0 = a static echo stack
  clearMinS: 1, // when clearing: the smear's own keyframe window —
  clearMaxS: 60, // decoupled from the visual reset rhythm (2026-08-12)
  follow: 0, // how far the chord retunes toward the source's pitch, 0..1;
  //            0 = the fixed chord, bit for bit, and the follower never runs
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
    this.pole = new Float64Array(n); // r per mode, kept for retuning
    this.baseF = new Float64Array(n); // each mode's frequency at ratio 1
    this.ratio = 1; // the tuning asked for
    this.tunedRatio = 1; // the tuning the coefficients hold
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

  // The source-following body: multiply all three fundamentals by `ratio`.
  // Only the pole angles move (a1); the radii, so the ring, and the gains
  // stay, and the y1/y2 state is kept, so a ringing partial glides to its new
  // pitch instead of clicking. Recomputed only past TUNE_EPS, or to land
  // exactly on 1 — the resting chord is then the same doubles as ever.
  setTuning(ratio) {
    const r = ratio > 0 && Number.isFinite(ratio) ? ratio : 1;
    this.ratio = r;
    if (r === this.tunedRatio || this.coeffsDirty) return; // refresh will apply it
    if (r === 1 || Math.abs(r / this.tunedRatio - 1) > TUNE_EPS) this.retune();
  }

  retune() {
    const nyq = 0.45 * this.sr;
    for (let i = 0; i < this.a1.length; i++) {
      const f = Math.min(nyq, this.baseF[i] * this.ratio);
      const w = (2 * Math.PI * f) / this.sr;
      this.a1[i] = 2 * this.pole[i] * Math.cos(w);
    }
    this.tunedRatio = this.ratio;
  }

  // Two normalizations, one per exciter. Gated strikes want impulse
  // normalization (the ring is the point). Continuous drive wants the
  // constant-peak-gain resonz form — a plain two-pole's low-frequency
  // skirt lets one sustained tone pin all 48 modes at their caps and the
  // sum rails the clip (harness-caught). The (1 − z⁻²) zeros kill that
  // skirt, so continuous input excites only its sympathetic partials.
  refreshCoeffs() {
    const table = modeTable(this.sr, this.sustain); // ratio 1: the base chord
    for (let i = 0; i < table.length; i++) {
      const m = table[i];
      const r = Math.pow(10, -3 / (m.t60 * this.sr));
      this.pole[i] = r;
      this.baseF[i] = m.f;
      this.a2[i] = r * r;
      this.gGate[i] = m.amp;
      this.gCont[i] = ((m.amp * (1 - r * r)) / 2) * BODY_CONT_BOOST;
    }
    this.coeffsDirty = false;
    this.retune(); // a1 at the current tuning (ratio 1: exactly as before)
  }

  reset() {
    for (const y of this.y1) y.fill(0);
    for (const y of this.y2) y.fill(0);
    this.x1.fill(0);
    this.x2.fill(0);
    this.env = 0;
    this.envStage = 0;
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
    // The bank is a FILTER, not a synth: the direct signal is summed with the
    // resonators, so the source passes through the apparatus instead of only
    // driving it. `direct` is deliberately not scaled by `drive` — drive is
    // strike force into the modes, not a level for the transmission.
    const direct = p.direct ?? 1;
    const bodyMix = p.bodyMix ?? 1;
    for (let s = 0; s < n; s++) {
      // Gated: a raised-cosine-ish AR envelope opened by onsets, so the
      // body is *struck*, never continuously driven. Continuous (the
      // piece's chosen state): the stream drives it always, bounded by
      // resonz normalization + caps.
      if (gated) {
        const target = this.envStage > 0 ? 1 : 0;
        if (this.envStage > 0) this.envStage--;
        this.env += (target - this.env) * (target > this.env ? attack : release);
      }
      const exc = gated ? this.env * drive : drive;
      for (let c = 0; c < channels; c++) {
        const xin = inBufs[c][s];
        const x = xin * exc;
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
        outBufs[c][s] = direct * xin + bodyMix * sum * BODY_OUT_GAIN;
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

// --- Engine: the same tuning as recirculating lines -------------------------
//
// The comb peer (John's proposal, 2026-08-13). Same fundamentals, same
// `sustain` meaning, same direct/bodyMix mixing as the modal bank, so the A/B
// is level-matched and only the character differs: exactly-harmonic partials
// read as tube/pipe/spring where the stretched modal bank reads as struck
// metal. That difference is inherent, not a bug — see the note in dsp.js.
// About a tenth of the modal bank's per-sample cost.

class CombEngine {
  constructor(sr, channels, p) {
    this.sr = sr;
    this.channels = channels;
    this.sustain = p.sustain;
    this.damp = p.combDamp ?? 0.45;
    this.lines = [];
    for (let c = 0; c < channels; c++) {
      this.lines.push(
        // Rings sized for TUNE_MIN so retuning down never reads past them.
        BODY_FUNDAMENTALS.map((f) => new CombLine(sr, f, this.sustain, this.damp, f * TUNE_MIN))
      );
    }
    this.ratio = 1;
    this.tunedRatio = 1;
  }

  // Same contract as the modal bank's: past TUNE_EPS, or landing on 1. The
  // delays stay fractional (the line already interpolates), the loop gains
  // follow the new pass length so the T60 holds, and the lines keep their
  // contents, so what is ringing is re-pitched rather than dropped.
  setTuning(ratio) {
    const r = ratio > 0 && Number.isFinite(ratio) ? ratio : 1;
    this.ratio = r;
    if (r === this.tunedRatio) return;
    if (r !== 1 && Math.abs(r / this.tunedRatio - 1) <= TUNE_EPS) return;
    for (const ch of this.lines) {
      for (let i = 0; i < ch.length; i++) ch[i].setFreq(BODY_FUNDAMENTALS[i] * r);
    }
    this.tunedRatio = r;
  }

  setSustain(s) {
    if (s === this.sustain) return;
    this.sustain = s;
    for (const ch of this.lines) for (const l of ch) l.setSustain(s);
  }

  setDamp(d) {
    if (d === this.damp) return;
    this.damp = d;
    for (const ch of this.lines) for (const l of ch) l.setDamp(d);
  }

  reset() {
    // Called by the silence gate: stale ringing must never return with the
    // next sound, and the lines hold seconds of it.
    for (const ch of this.lines) for (const l of ch) l.reset();
  }

  process(inBufs, outBufs, channels, n, p) {
    this.setSustain(p.sustain);
    this.setDamp(p.combDamp ?? 0.45);
    const direct = p.direct ?? 1;
    const bodyMix = p.bodyMix ?? 1;
    const drive = p.drive ?? 1;
    for (let c = 0; c < channels; c++) {
      const lines = this.lines[c];
      const src = inBufs[c];
      const dst = outBufs[c];
      for (let s = 0; s < n; s++) {
        const xin = src[s];
        const x = xin * drive;
        let sum = 0;
        for (let i = 0; i < lines.length; i++) {
          // (1 − g) normalisation: a line settles at ≈ x·g/(1−g), so this
          // brings the resonant part back to the order of the input and keeps
          // `bodyMix` meaning the same thing in both engines.
          sum += lines[i].step(x) * (1 - lines[i].g);
        }
        dst[s] = direct * xin + bodyMix * sum * COMB_OUT_GAIN;
      }
    }
  }
}

// --- Feedback/smear layer ---------------------------------------------------
//
// A LAYER, not a mode (ported intact from the first audio phase): the body's
// output recirculates through a 0.35 s delay line whose read point wobbles
// on a 0.1 Hz LFO, tanh-clipped on write-back. Continuous by default — its
// loop gain (< 1) is its own decay; the optional keyframe clear rides the
// shared visual reset rhythm when enabled.

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
    const minS = p.clearMinS ?? 1;
    const maxS = Math.max(minS, p.clearMaxS ?? 60);
    return currentFrame + (minS + Math.random() * (maxS - minS)) * this.sr;
  }

  process(bufs, channels, n, p) {
    // fbDecay 0.8..0.999 → loop gain 0.5..0.95 (the visual decay knob's
    // range, so the knob feels like the same knob). The loop gain sets the
    // TAIL and nothing else since 2026-08-13; how loud the wash sits under the
    // direct sound is `fbReturn`, a fraction of it. They were one number, and
    // that is why the piece sounded the same on every video: at gain 0.95 the
    // recirculating wash settles ~1/(1−g) ≈ 20× above whatever just arrived.
    // fbReturn 1 reproduces the old behaviour exactly.
    const gain = Math.min(0.95, 0.5 + (((p.fbDecay ?? 0.96) - 0.8) / 0.199) * 0.45);
    const ret = gain * Math.min(1, Math.max(0, p.fbReturn ?? 0.25));
    const base = 0.35 * this.sr;
    const modDepth = Math.min(0.4, Math.abs(p.wobble ?? 0));
    const phaseInc = (2 * Math.PI * 0.1) / this.sr;

    // The keyframe — optional for audio, and OFF by default (John's call:
    // the loop gain < 1 is already a natural decay, so unlike the video
    // accumulator the smear needs no clearing to stay clean; continuous
    // sounds nicer). When on: hard cut works for video (one frame in an
    // already glitching image) but audio hears the wash vanish in a sample,
    // so the clear fades the echo return over ~fbClearS seconds first, then
    // wipes the line while it is inaudible. fbClearS 0 = a hard cut.
    const clearS = Math.max(0, p.fbClearS ?? 1);
    if (p.fbClear) {
      if (this.nextResetAt < 0) this.nextResetAt = this.scheduleReset(p);
      if (!this.clearing && currentFrame >= this.nextResetAt) {
        if (clearS < 0.01) {
          for (const line of this.lines) line.fill(0);
        } else {
          this.clearing = true; // rhythm counts from the start of the fade
        }
        this.nextResetAt = this.scheduleReset(p);
      }
    } else {
      this.nextResetAt = -1; // clears re-enabled → rhythm restarts fresh
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
        const dry = bufs[c][i];
        // The loop keeps its own long tail; the return decides how loud it is.
        line[this.w % this.len] = Math.tanh(dry + gain * echo);
        bufs[c][i] = dry + ret * echo;
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

// --- The shell --------------------------------------------------------------

class DeflectionAudio extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.p = { ...DEFAULT_PARAMS, ...(options?.processorOptions?.params ?? {}) };
    this.body = null;
    this.fbLayer = null;
    this.channels = 0;
    this.inBufs = null;
    this.out = null;
    this.monoIn = null;
    this.dcX = null;
    this.dcY = null;
    this.present = false;
    this.closeBlocks = 0;
    this.quietBlocks = 0;
    this.muted = false;
    this.statsAtFrame = 0;
    this.lastLoudFrame = 0;
    this.follower = null; // built the first time follow > 0
    this.tuneRatio = 1; // the glided ratio the engine is tuned to
    this.foldOctave = null; // the sticky fold's octave (see foldSticky)

    this.port.onmessage = (e) => {
      const m = e.data;
      if (m?.type === 'params' && m.params) this.applyParams(m.params);
    };
  }

  applyParams(params) {
    Object.assign(this.p, params);
    this.body?.setSustain(this.p.sustain);
  }

  // The source-following body (design review M8). The follower listens to
  // the mono feed; its pitch, folded into the chord's lowest octave, sets
  // where the chord should sit, `follow` how far toward it (geometric, so 0
  // is exactly the fixed chord), and a one-pole on log(ratio) glides there.
  // Unsure → glide home to 1. With follow 0 and the chord home, nothing here
  // runs at all: no FFT, no retune — the resting state costs nothing.
  followSource(n) {
    const raw = Number(this.p.follow);
    const follow = raw > 0 ? Math.min(1, raw) : 0;
    let target = 1;
    if (follow > 0) {
      if (!this.follower) this.follower = new PitchFollower(sampleRate);
      this.follower.push(this.monoIn.length === n ? this.monoIn : this.monoIn.subarray(0, n));
      const hz = this.follower.hz;
      if (hz > 0) {
        const fold = foldSticky(hz, this.foldOctave);
        this.foldOctave = fold.octave;
        target = followRatio(fold.ratio, follow);
      } else {
        this.foldOctave = null;
      }
    } else {
      this.follower = null; // a fresh follower next time: no stale held pitch
      this.foldOctave = null;
      if (this.tuneRatio === 1) return;
    }
    const a = 1 - Math.exp(-n / (FOLLOW_GLIDE_S * sampleRate));
    const l = Math.log(this.tuneRatio);
    let r = Math.exp(l + a * (Math.log(target) - l));
    if (Math.abs(r - target) < 1e-5) r = target; // land exactly: 1 is the rest
    if (!Number.isFinite(r)) r = 1;
    r = Math.min(TUNE_MAX, Math.max(TUNE_MIN, r));
    this.tuneRatio = r;
    this.body.setTuning(r);
  }

  // Swapping engines rebuilds state, so it clicks — acceptable for a bake-off
  // switch, which is what this is. Everything else about the two paths is
  // shared, including the mix knobs, so the comparison stays honest.
  ensureEngine() {
    const kind = this.p.body === 'comb' ? 'comb' : 'modal';
    if (this.engineKind === kind && this.body) return;
    this.engineKind = kind;
    this.body =
      kind === 'comb'
        ? new CombEngine(sampleRate, this.channels, this.p)
        : new BodyEngine(sampleRate, this.channels, this.p);
  }

  ensure(channels, n) {
    if (this.channels === channels && this.inBufs && this.inBufs[0].length >= n)
      return;
    this.channels = channels;
    this.inBufs = [];
    this.out = [];
    for (let c = 0; c < channels; c++) {
      this.inBufs.push(new Float32Array(n));
      this.out.push(new Float32Array(n));
    }
    this.monoIn = new Float32Array(n);
    this.dcX = new Float32Array(channels);
    this.dcY = new Float32Array(channels);
    this.body = null;
    this.engineKind = null;
    this.ensureEngine();
    this.fbLayer = new FeedbackLayer(sampleRate, channels);
  }

  process(inputs, outputs) {
    try {
      const input = inputs[0];
      const output = outputs[0];
      if (!input || input.length === 0 || !input[0]) return true; // bypassed: idle

      const n = input[0].length;
      const channels = Math.min(input.length, output.length);
      this.ensure(channels, n);
      this.ensureEngine(); // the engine can be switched live from the panel

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

      this.followSource(n);
      this.body.process(this.inBufs, this.out, channels, n, this.p, this.monoIn);

      // The smear layer runs on the body's output, pre-clip.
      if (this.p.fb) this.fbLayer.process(this.out, channels, n, this.p);

      // Soft clip at −6 dBFS and write out; the gate below may still zero it.
      let outPeak = 0;
      for (let c = 0; c < channels; c++) {
        const dst = output[c];
        const a = this.out[c];
        for (let s = 0; s < n; s++) {
          const clipped = 0.5 * Math.tanh(a[s] * 2);
          dst[s] = clipped;
          const abs = Math.abs(clipped);
          if (abs > outPeak) outPeak = abs;
        }
      }
      for (let c = channels; c < output.length; c++) output[c].set(output[0]);

      // Silence gate: with input absent and the engine at the floor, snap
      // to exact zeros and reset ring-down state (silence in, silence out —
      // enforced, not asymptotic).
      if (!this.present) {
        if (outPeak < MUTE_FLOOR) this.quietBlocks++;
        else this.quietBlocks = 0;
        if (this.quietBlocks > 5) {
          this.muted = true;
          this.body?.reset();
          this.fbLayer?.reset(); // stale echoes must not return with presence
          this.follower?.reset(); // nor a held pitch from before the silence
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
