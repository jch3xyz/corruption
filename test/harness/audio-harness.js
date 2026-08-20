// Audio harness for the body engine + smear layer (the bake-off verdict;
// the timebase engine's checks left with it — tag `audio-bakeoff`). Tier 1
// tests the pure DSP modules with no audio API at all; tier 2 renders the
// real worklet deterministically through OfflineAudioContext (no gesture,
// no rendering pipeline — immune to the hidden-pane flakiness that plagues
// the visual harness); tier 3 taps a live <audio> element and runs behind
// a button so the click doubles as the autoplay gesture.
//
// Assertions are structural invariants, never golden files. Randomness is
// a fixed LCG so runs are byte-identical.
//
// Run: python3 test/serve.py  →  http://localhost:8437/test/harness/audio.html

import { createFFT } from '../../source/audio/fft.js';
import {
  rms,
  modeTable,
  OnsetDetector,
  BODY_FUNDAMENTALS,
  BODY_PARTIALS,
  BODY_STRETCH,
  CombLine,
  combDelaySamples,
  combLoopGain,
} from '../../source/audio/dsp.js';
import { acquireAudio, tapSafety, workletParams } from '../../source/audio/graph.js';
import { AudioJob } from '../../source/content/audio-job.js';

const status = document.getElementById('status');
let passCount = 0;
let failCount = 0;

function line(text, cls) {
  const div = document.createElement('div');
  if (cls) div.className = cls;
  div.textContent = text;
  status.appendChild(div);
}

function check(name, ok) {
  line(`${ok ? 'PASS' : 'FAIL'}: ${name}`, ok ? 'pass' : 'fail');
  ok ? passCount++ : failCount++;
}

const rmsOf = (arr, start, len) => rms(arr, Math.max(0, start | 0), len | 0);

let seed = 42;
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

// --- Tier 1: pure modules ---------------------------------------------------

function tier1() {
  // FFT roundtrip
  {
    const N = 2048;
    const fft = createFFT(N);
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    const orig = new Float32Array(N);
    for (let i = 0; i < N; i++) orig[i] = re[i] = rand() * 2 - 1;
    fft.forward(re, im);
    fft.inverse(re, im);
    let maxErr = 0;
    for (let i = 0; i < N; i++) maxErr = Math.max(maxErr, Math.abs(re[i] - orig[i]));
    check(`fft roundtrip (max err ${maxErr.toExponential(1)})`, maxErr < 1e-3);
  }

  // Mode table: 48 modes, stretched-partial formula, damping law, headroom.
  {
    const sr = 48000;
    const modes = modeTable(sr, 6);
    const kOfIdx = (i) => (i % BODY_PARTIALS) + 1;
    let formulaOk = true;
    for (let i = 0; i < modes.length; i++) {
      const f0 = BODY_FUNDAMENTALS[Math.floor(i / BODY_PARTIALS)];
      const k = kOfIdx(i);
      const expect = k * f0 * Math.sqrt(1 + BODY_STRETCH * k * k);
      if (Math.abs(modes[i].f - expect) > 1e-6) formulaOk = false;
    }
    const nyquistOk = modes.every((m) => m.f < 0.45 * sr);
    const t60ByF = [...modes].sort((a, b) => a.f - b.f);
    let dampOk = true;
    for (let i = 1; i < t60ByF.length; i++) {
      if (t60ByF[i].t60 > t60ByF[i - 1].t60 + 1e-9) dampOk = false;
    }
    check(
      `mode table: ${modes.length} modes, stretched formula, under 0.45·fs`,
      modes.length === BODY_FUNDAMENTALS.length * BODY_PARTIALS && formulaOk && nyquistOk
    );
    check('mode damping is monotone (higher always dies faster)', dampOk);
  }

  // Onset detector: catches a click train, ignores a steady sine.
  {
    const sr = 48000;
    const clicks = new Float32Array(2 * sr);
    let expected = 0;
    for (let t = 0.05; t < 2; t += 0.25) {
      clicks[Math.round(t * sr)] = 0.8;
      expected++;
    }
    const od1 = new OnsetDetector(sr);
    let found = 0;
    for (let i = 0; i < clicks.length; i += 128) {
      found += od1.process(clicks.subarray(i, i + 128));
    }
    check(
      `onset detector catches the click train (${found}/${expected})`,
      found >= expected - 2 && found <= expected + 1
    );

    const sine = new Float32Array(2 * sr);
    for (let i = 0; i < sine.length; i++) sine[i] = 0.4 * Math.sin((2 * Math.PI * 440 * i) / sr);
    const od2 = new OnsetDetector(sr);
    let falsePos = 0;
    for (let i = 0; i < sine.length; i += 128) {
      falsePos += od2.process(sine.subarray(i, i + 128));
    }
    check(`steady sine fires ≤1 onset (its own attack; got ${falsePos})`, falsePos <= 1);
  }

  // The detangle (2026-08-12): performing the video must never bend the
  // sound. The worklet's entire param surface is built from audio knobs;
  // the visual sliders that used to leak in (driftY → wobble depth,
  // resetMin/MaxS → clear rhythm) must be inert here.
  {
    const wp = workletParams({
      driftY: 0.01, // full-scale visual drift
      resetMinS: 2, // a tight visual keyframe window
      resetMaxS: 3,
      audioFbWobble: 0.2,
      audioFbClearMinS: 5,
      audioFbClearMaxS: 9,
    });
    const leaked = ['driftY', 'resetMinS', 'resetMaxS'].filter((k) => k in wp);
    check(
      'detangle: visual sliders never reach the worklet',
      leaked.length === 0 &&
        wp.wobble === 0.2 &&
        wp.clearMinS === 5 &&
        wp.clearMaxS === 9
    );
  }
}

// --- Tier 1b: the comb peer, as pure DSP ------------------------------------

function tier1Comb() {
  const sr = 48000;

  // Tuning: the impulse response must be periodic at sr/f0. Autocorrelation
  // rather than FFT peak-picking — it asserts the period directly and cannot
  // be fooled by window leakage.
  {
    const f0 = BODY_FUNDAMENTALS[0];
    const period = combDelaySamples(sr, f0);
    const line = new CombLine(sr, f0, 8, 0.2);
    const N = 1 << 14;
    const ir = new Float32Array(N);
    for (let i = 0; i < N; i++) ir[i] = line.step(i === 0 ? 1 : 0);
    const ac = (lag) => {
      let s = 0;
      for (let i = 0; i < N - lag; i++) s += ir[i] * ir[i + lag];
      return s;
    };
    let bestLag = 0;
    let best = -Infinity;
    for (let lag = Math.round(period) - 100; lag <= Math.round(period) + 100; lag++) {
      const v = ac(lag);
      if (v > best) {
        best = v;
        bestLag = lag;
      }
    }
    check(
      `comb: impulse response period ${bestLag} ≈ sr/f0 ${period.toFixed(1)}`,
      Math.abs(bestLag - period) <= 2
    );
  }

  // Loop gain maps to T60 the same way the modal bank's damping does, so
  // `audioSustain` means one thing across both engines.
  {
    const f0 = BODY_FUNDAMENTALS[1];
    const t60 = 3;
    const line = new CombLine(sr, f0, t60, 0); // damp 0 isolates the loop gain
    const N = Math.round(t60 * sr * 1.2);
    const ir = new Float32Array(N);
    for (let i = 0; i < N; i++) ir[i] = line.step(i === 0 ? 1 : 0);
    const early = rmsOf(ir, Math.round(0.05 * sr), Math.round(0.2 * sr));
    const atT60 = rmsOf(ir, Math.round(t60 * sr) - Math.round(0.2 * sr), Math.round(0.2 * sr));
    const dB = 20 * Math.log10(atT60 / (early || 1e-12));
    check(`comb: decays ≈60 dB by T60 (measured ${dB.toFixed(1)} dB)`, dB < -50 && dB > -75);
    check(`comb: loop gain < 1 (${combLoopGain(sr, f0, t60).toFixed(4)})`, combLoopGain(sr, f0, t60) < 1);
  }

  // Bounded under sustained full-scale drive, and reset() actually zeroes it —
  // the silence gate depends on the second, since the lines hold seconds of ring.
  {
    const line = new CombLine(sr, BODY_FUNDAMENTALS[2], 12, 0.45);
    let peak = 0;
    let finite = true;
    for (let i = 0; i < sr * 3; i++) {
      const y = line.step(Math.sin((2 * Math.PI * 137.5 * i) / sr));
      if (!Number.isFinite(y)) finite = false;
      peak = Math.max(peak, Math.abs(y));
    }
    check(`comb: sustained resonant drive stays bounded (peak ${peak.toFixed(3)}, finite)`, finite && peak <= 2);
    line.reset();
    const after = line.step(0);
    let bufZero = true;
    for (const v of line.buf) if (v !== 0) bufZero = false;
    check('comb: reset() zeroes the line (no stale ring can return)', after === 0 && bufZero);
  }
}

// --- Tier 2: both engines through the real worklet --------------------------

const SR = 48000;

const BODY = {
  sustain: 2,
  drive: 0.5,
  exciter: 'continuous',
  fb: false, // engine tests isolate the engine; DEFAULT_PARAMS has fb on
  direct: 0, // …and isolate the RESONATORS: since 2026-08-13 the engines sum
  bodyMix: 1, // the direct signal in, which these checks are not about
};

// The smear checks are about tail and clear semantics, not level, so they pin
// the return at the loop gain — the behaviour they were written against.
const FB_RETURN_LEGACY = 1;

async function renderThrough(wparams, buildInput, seconds) {
  const frames = Math.ceil(seconds * SR);
  const ctx = new OfflineAudioContext(1, frames, SR);
  await ctx.audioWorklet.addModule('/source/audio/worklet.js');
  const node = new AudioWorkletNode(ctx, 'deflection-audio', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    processorOptions: { params: wparams },
  });
  // Full-length buffer (silence is explicit zeros): the source must keep
  // the input connected to the end or ring-down/tail semantics can't render.
  const buf = ctx.createBuffer(1, frames, SR);
  buildInput(buf.getChannelData(0));
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(node);
  node.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  return { out: rendered.getChannelData(0), input: buf.getChannelData(0) };
}

const fillNoise = (amp) => (data) => {
  for (let i = 0; i < data.length; i++) data[i] = amp * (rand() * 2 - 1);
};

async function tier2() {
  // Exact silence in → exact silence out.
  try {
    const { out } = await renderThrough(BODY, () => {}, 1.5);
    let maxAbs = 0;
    for (let i = 0; i < out.length; i++) maxAbs = Math.max(maxAbs, Math.abs(out[i]));
    check('body: digital silence in → exact zeros out', maxAbs === 0);
  } catch (e) {
    check(`body silence render (${e.message})`, false);
  }

  // NaN in the stream must never reach the output or kill the processor.
  try {
    const { out } = await renderThrough(
      BODY,
      (data) => {
        fillNoise(0.1)(data);
        data[1000] = NaN;
        data[2000] = Infinity;
      },
      2
    );
    const finite = out.every(Number.isFinite);
    const alive = rmsOf(out, 1.0 * SR, 0.5 * SR) > 1e-6;
    check('body: injected NaN/Inf → finite output, processor alive', finite && alive);
  } catch (e) {
    check(`body NaN render (${e.message})`, false);
  }

  // Body: a short burst rings down monotonically and actually decays.
  try {
    const burst = (data) => {
      const start = Math.round(0.1 * SR);
      for (let i = 0; i < Math.round(0.01 * SR); i++) {
        data[start + i] = 0.8 * Math.sin((2 * Math.PI * 1000 * i) / SR);
      }
    };
    const { out } = await renderThrough(BODY, burst, 3.5);
    const w = (t) => rmsOf(out, t * SR, 0.4 * SR);
    const windows = [w(0.3), w(0.8), w(1.3), w(1.8), w(2.3)];
    let monotone = windows[0] > 1e-5;
    for (let i = 1; i < windows.length; i++) {
      if (windows[i] > windows[i - 1] * 1.05) monotone = false;
    }
    const decayed = windows[4] < windows[0] * 0.05;
    check(
      `body: burst rings down monotonically (${windows.map((v) => v.toFixed(4)).join(' → ')})`,
      monotone && decayed
    );
  } catch (e) {
    check(`body ring-down render (${e.message})`, false);
  }

  // Body: the gated exciter strikes on an onset and the ring outlives it.
  try {
    const p = { ...BODY, exciter: 'gated', sustain: 4 };
    const { out } = await renderThrough(
      p,
      (data) => {
        const start = Math.round(0.5 * SR);
        for (let i = 0; i < Math.round(0.1 * SR); i++) {
          data[start + i] = 0.5 * (rand() * 2 - 1);
        }
      },
      2.5
    );
    const during = rmsOf(out, 0.5 * SR, 0.1 * SR);
    const after = rmsOf(out, 0.7 * SR, 0.4 * SR);
    const before = rmsOf(out, 0.1 * SR, 0.3 * SR);
    check(
      `body gated: onset strikes, ring outlives the burst (before ${before.toFixed(4)}, after ${after.toFixed(4)})`,
      before < 1e-6 && (during > 1e-4 || after > 1e-4) && after > 1e-4
    );
  } catch (e) {
    check(`body gated render (${e.message})`, false);
  }

  // Body: sustained near-resonant tone stays bounded (the near-singular case).
  try {
    const { out, input } = await renderThrough(
      BODY,
      (data) => {
        for (let i = 0; i < data.length; i++) {
          data[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / SR);
        }
      },
      3
    );
    const outR = rmsOf(out, 2 * SR, 1 * SR);
    const inR = rmsOf(input, 2 * SR, 1 * SR);
    check(
      `body: sustained tone bounded (out ${outR.toFixed(3)} ≤ in+6dB ${(inR * 2).toFixed(3)})`,
      Number.isFinite(outR) && outR <= inR * 2
    );
  } catch (e) {
    check(`body tone render (${e.message})`, false);
  }

  // Body drone test, made structural: on crest-poor limited noise (the
  // "loudness-war ad"), gated mode must show materially more dynamic shape
  // than continuous mode (which is allowed to drone, boundedly).
  try {
    const ad = (data) => {
      for (let i = 0; i < Math.round(2.4 * SR); i++) {
        const v = (rand() * 2 - 1) * 3;
        data[i] = Math.max(-0.3, Math.min(0.3, v));
      }
    };
    const cv = (out) => {
      const ws = [];
      for (let t = 0.3; t < 2.2; t += 0.2) ws.push(rmsOf(out, t * SR, 0.2 * SR));
      const mean = ws.reduce((a, b) => a + b, 0) / ws.length;
      const varr = ws.reduce((a, b) => a + (b - mean) ** 2, 0) / ws.length;
      return mean > 1e-6 ? Math.sqrt(varr) / mean : 0;
    };
    const { out: outC } = await renderThrough(BODY, ad, 2.6);
    const { out: outG } = await renderThrough({ ...BODY, exciter: 'gated' }, ad, 2.6);
    const cvC = cv(outC);
    const cvG = cv(outG);
    check(
      `body drone test: gated CV ${cvG.toFixed(2)} > continuous CV ${cvC.toFixed(2)} × 1.5`,
      cvG > cvC * 1.5
    );
  } catch (e) {
    check(`body drone render (${e.message})`, false);
  }

  // Feedback/smear layer: silence stays exact zeros; echoes recirculate at
  // 0.35 s and decay; the keyframe reset hard-clears the line. wobble 0
  // pins the delay (no LFO) and clearMin=Max removes the jitter, so every
  // window lands deterministically.
  try {
    const FB = {
      ...BODY,
      fb: true,
      fbDecay: 0.96,
      fbReturn: FB_RETURN_LEGACY,
      fbClear: true, // the clear tests exercise the optional clear path
      fbClearS: 0, // hard-cut clears; the smooth path has its own check
      wobble: 0,
      clearMinS: 1000,
      clearMaxS: 1000,
    };
    const { out: zout } = await renderThrough(FB, () => {}, 1.2);
    let maxAbs = 0;
    for (let i = 0; i < zout.length; i++) maxAbs = Math.max(maxAbs, Math.abs(zout[i]));
    check('feedback: digital silence in → exact zeros out', maxAbs === 0);

    const burst = (data) => {
      const start = Math.round(0.05 * SR);
      for (let i = 0; i < Math.round(0.01 * SR); i++) {
        data[start + i] = 0.8 * Math.sin((2 * Math.PI * 1000 * i) / SR);
      }
    };
    const { out } = await renderThrough(FB, burst, 1.6);
    const at = (sec) => rmsOf(out, sec * SR, 0.03 * SR);
    const pre = at(0.28); // gap: body ring has faded, first echo not yet due
    const e1 = at(0.05 + 0.35);
    const e2 = at(0.05 + 0.7);
    check(
      `feedback: echoes present and decaying (pre ${pre.toFixed(4)}, e1 ${e1.toFixed(4)}, e2 ${e2.toFixed(4)})`,
      e1 > Math.max(0.002, 3 * pre) && e2 < e1 && e2 > 0.2 * e1
    );

    const { out: outR } = await renderThrough(
      { ...FB, clearMinS: 0.6, clearMaxS: 0.6 },
      burst,
      1.6
    );
    const r1 = rmsOf(outR, (0.05 + 0.35) * SR, 0.03 * SR);
    const r2 = rmsOf(outR, (0.05 + 0.7) * SR, 0.03 * SR);
    check(
      `feedback: hard keyframe reset clears the line (${r1.toFixed(4)} → ${r2.toFixed(4)})`,
      r1 > 0.002 && r2 < r1 * 0.15
    );

    // Smooth clear: with fbClearS 0.8 the echo at reset+0.15 s must be
    // partially faded — audibly reduced but NOT gone (that partial value is
    // the smoothness) — and the envelope dead well before the next echo.
    const { out: outS } = await renderThrough(
      { ...FB, clearMinS: 0.6, clearMaxS: 0.6, fbClearS: 0.8 },
      burst,
      1.6
    );
    const s1 = rmsOf(outS, (0.05 + 0.35) * SR, 0.03 * SR); // pre-reset: full
    const s2 = rmsOf(outS, (0.05 + 0.7) * SR, 0.03 * SR); // mid-fade
    const s3 = rmsOf(outS, 1.1 * SR, 0.03 * SR); // envelope floor
    check(
      `feedback: smooth clear fades instead of cutting (${s1.toFixed(4)} → ${s2.toFixed(4)} → ${s3.toFixed(4)})`,
      s1 > 0.002 && s2 > 0.03 * s1 && s2 < 0.75 * s1 && s3 < 0.1 * s1
    );

    // Clears OFF (the default): the reset rhythm must not touch the smear —
    // echoes ride through the same 0.6 s reset window at full strength,
    // decaying only by their own loop gain.
    const { out: outC } = await renderThrough(
      { ...FB, fbClear: false, clearMinS: 0.6, clearMaxS: 0.6 },
      burst,
      1.6
    );
    const c1 = rmsOf(outC, (0.05 + 0.35) * SR, 0.03 * SR);
    const c2 = rmsOf(outC, (0.05 + 0.7) * SR, 0.03 * SR);
    check(
      `feedback: clears off → smear is continuous through the reset window (${c1.toFixed(4)} → ${c2.toFixed(4)})`,
      c1 > 0.002 && c2 > 0.5 * c1
    );

    // The wobble knob is real: at depth 0.4 the delay line drifts, so the
    // echoes leave the pinned 0.35 s slots they occupy in outC (wobble 0).
    // Same input, same engine, both renders deterministic — the difference
    // is the LFO alone.
    const { out: outW } = await renderThrough(
      { ...FB, fbClear: false, clearMinS: 0.6, clearMaxS: 0.6, wobble: 0.4 },
      burst,
      1.6
    );
    let dsum = 0;
    for (let i = 0; i < outW.length; i++) dsum += (outW[i] - outC[i]) ** 2;
    const drms = Math.sqrt(dsum / outW.length);
    check(
      `feedback: the wobble knob moves the echoes (delta rms ${drms.toFixed(5)})`,
      drms > 1e-3
    );
  } catch (e) {
    check(`feedback render (${e.message})`, false);
  }

  await tier2Specificity();
}

// --- Tier 2b: does the source survive? --------------------------------------
//
// The suite had no check that could fail when the output stopped tracking the
// input, which is exactly how the piece came to sound the same on every video
// (measured 2026-08-13: envelope correlation with the source was −0.01 on
// speech-like material). These make "a process done to the audio" a number the
// suite defends — the audio counterpart of the visual suite's conservation
// assertions.

const ENV_SR = 200;

function envelopeOf(buf, skipS = 0.5) {
  const step = SR / ENV_SR;
  const n = Math.floor((buf.length - skipS * SR) / step);
  const e = new Float32Array(Math.max(0, n));
  for (let i = 0; i < e.length; i++) {
    let s = 0;
    const o = Math.round(skipS * SR + i * step);
    for (let j = 0; j < step; j++) s += buf[o + j] * buf[o + j];
    e[i] = Math.sqrt(s / step);
  }
  return e;
}

function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 8) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return num / (Math.sqrt(da * db) || 1e-12);
}

// Fraction of output energy above `hz` — the bank tops out at 2310 Hz, so
// before the direct path this was ~0 for every source on earth.
function bandShare(buf, hz, skipS = 0.5) {
  const N = 8192;
  const fft = createFFT(N);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const acc = new Float64Array(N / 2);
  let frames = 0;
  for (let off = Math.round(skipS * SR); off + N <= buf.length; off += N / 2) {
    for (let i = 0; i < N; i++) {
      re[i] = buf[off + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
      im[i] = 0;
    }
    fft.forward(re, im);
    for (let k = 0; k < N / 2; k++) acc[k] += Math.hypot(re[k], im[k]);
    frames++;
  }
  if (!frames) return 0;
  const k0 = Math.round(hz / (SR / N));
  let hi = 0;
  let all = 0;
  for (let k = 1; k < N / 2; k++) {
    const p = (acc[k] / frames) ** 2;
    all += p;
    if (k >= k0) hi += p;
  }
  return hi / (all || 1);
}

// Syllabic probe: 4 Hz amplitude envelope over a voice-ish band, plus
// fricative bursts. Deterministic (fixed LCG).
const syllabic = (amp) => (data) => {
  for (let i = 0; i < data.length; i++) {
    const t = i / SR;
    const syl = Math.max(0, Math.sin(2 * Math.PI * 4 * t)) ** 2;
    const fric = Math.sin(2 * Math.PI * 0.7 * t) > 0.6 ? 0.5 * (rand() * 2 - 1) : 0;
    let v = 0;
    for (const f of [220, 540, 1250]) v += Math.sin(2 * Math.PI * f * t) / 3;
    data[i] = amp * (syl * v + syl * fric);
  }
};

const bright = (amp) => (data) => {
  let p = 0;
  let q = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / SR;
    const ph = (t * 6) % 1;
    const x = (rand() * 2 - 1) * Math.exp(-ph * 20);
    const y = x - p + 0.99 * q; // crude high-pass, twice
    p = x;
    q = y;
    data[i] = amp * y;
  }
};

const ENGINES = ['modal', 'comb'];

async function tier2Specificity() {
  // 1. Conservation: with the resonators muted the apparatus must be a wire.
  // Small amplitude keeps the output soft-clip in its linear region.
  for (const body of ENGINES) {
    try {
      const { out, input } = await renderThrough(
        { ...BODY, body, direct: 1, bodyMix: 0, fb: false },
        syllabic(0.05),
        2
      );
      const a = out.subarray(Math.round(0.5 * SR));
      const b = input.subarray(Math.round(0.5 * SR));
      const c = correlation(a, b);
      const ratio = rmsOf(out, 0.5 * SR, SR) / (rmsOf(input, 0.5 * SR, SR) || 1e-12);
      check(
        `${body}: direct path is a wire — bodyMix 0 → out ≈ in (corr ${c.toFixed(4)}, level ${ratio.toFixed(3)})`,
        c > 0.999 && ratio > 0.9 && ratio < 1.1
      );
    } catch (e) {
      check(`${body} conservation render (${e.message})`, false);
    }
  }

  // 2. The gate: at the shipped defaults the output must follow the source.
  // This is the check whose absence let the piece drift into sounding the same
  // on every video.
  for (const body of ENGINES) {
    try {
      const { out, input } = await renderThrough(
        { body, direct: 1, bodyMix: 1, sustain: 12, drive: 1, exciter: 'continuous',
          fb: true, fbDecay: 0.999, fbReturn: 0.25, wobble: 0, fbClear: false },
        syllabic(0.25),
        6
      );
      const c = correlation(envelopeOf(input, 1), envelopeOf(out, 1));
      check(`${body}: output follows the source at defaults (envelope corr ${c.toFixed(2)} ≥ 0.7)`, c >= 0.7);
    } catch (e) {
      check(`${body} envelope-tracking render (${e.message})`, false);
    }
  }

  // 3. The return knob's direction, and that the old behaviour is still
  // reachable: fbReturn 1 with no direct path is what the piece used to be.
  try {
    const base = { body: 'modal', direct: 1, bodyMix: 1, sustain: 12, drive: 1,
      exciter: 'continuous', fb: true, fbDecay: 0.999, wobble: 0, fbClear: false };
    const quiet = await renderThrough({ ...base, fbReturn: 0.1 }, syllabic(0.25), 6);
    const loud = await renderThrough({ ...base, fbReturn: 1 }, syllabic(0.25), 6);
    const cq = correlation(envelopeOf(quiet.input, 1), envelopeOf(quiet.out, 1));
    const cl = correlation(envelopeOf(loud.input, 1), envelopeOf(loud.out, 1));
    check(
      `feedback: a quieter wash tracks the source better (return 0.1 → ${cq.toFixed(2)} > return 1 → ${cl.toFixed(2)})`,
      cq > cl
    );

    const old = await renderThrough({ ...base, direct: 0, fbReturn: 1 }, syllabic(0.25), 6);
    const co = correlation(envelopeOf(old.input, 1), envelopeOf(old.out, 1));
    check(
      `feedback: the pre-2026-08-13 sound is still reachable (direct 0, return 1 → corr ${co.toFixed(2)} ≤ 0.5)`,
      co <= 0.5
    );
  } catch (e) {
    check(`feedback return-level render (${e.message})`, false);
  }

  // 4. Bandwidth: the modal bank stops at 2310 Hz, so bright material used to
  // vanish. The direct path is what gives consonants and cymbals somewhere to go.
  for (const body of ENGINES) {
    try {
      const { out } = await renderThrough(
        { body, direct: 1, bodyMix: 1, sustain: 12, drive: 1, exciter: 'continuous',
          fb: true, fbDecay: 0.999, fbReturn: 0.25, wobble: 0, fbClear: false },
        bright(0.3),
        4
      );
      const share = bandShare(out, 2300, 1);
      check(`${body}: bright source survives above the bank (${(100 * share).toFixed(1)}% > 10% over 2.3 kHz)`, share > 0.1);
    } catch (e) {
      check(`${body} bandwidth render (${e.message})`, false);
    }
  }

  // 5. The comb through the full chain: silence stays exactly silent, loud
  // input stays bounded and finite, and two identical renders are identical.
  try {
    const P = { ...BODY, body: 'comb', direct: 1, sustain: 12, combDamp: 0.45 };
    const { out: z } = await renderThrough(P, () => {}, 1.5);
    let maxAbs = 0;
    for (let i = 0; i < z.length; i++) maxAbs = Math.max(maxAbs, Math.abs(z[i]));
    check('comb: digital silence in → exact zeros out', maxAbs === 0);

    const loud = (data) => {
      for (let i = 0; i < data.length; i++) data[i] = Math.sin((2 * Math.PI * 55 * i) / SR);
    };
    const r1 = await renderThrough({ ...P, fb: true, fbDecay: 0.999, fbReturn: 0.25 }, loud, 4);
    let peak = 0;
    let finite = true;
    for (let i = 0; i < r1.out.length; i++) {
      const v = r1.out[i];
      if (!Number.isFinite(v)) finite = false;
      peak = Math.max(peak, Math.abs(v));
    }
    check(`comb: full-scale resonant drive bounded and finite (peak ${peak.toFixed(3)})`, finite && peak <= 1);

    const r2 = await renderThrough({ ...P, fb: true, fbDecay: 0.999, fbReturn: 0.25 }, loud, 4);
    let identical = r1.out.length === r2.out.length;
    for (let i = 0; identical && i < r1.out.length; i++) if (r1.out[i] !== r2.out[i]) identical = false;
    check('comb: two identical renders are bit-identical', identical);
  } catch (e) {
    check(`comb worklet render (${e.message})`, false);
  }
}

// --- Tier 3: live tap (button = autoplay gesture) ----------------------------

function wavUrl(freq = 440, seconds = 2, sr = 22050) {
  const n = (seconds * sr) | 0;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (off, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  w(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 2, Math.sin((2 * Math.PI * freq * i) / sr) * 0.5 * 32767, true);
  }
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

const waitFor = async (fn, timeout = 5000) => {
  const t0 = performance.now();
  for (;;) {
    try {
      if (fn()) return true;
    } catch {
      /* retry */
    }
    if (performance.now() - t0 >= timeout) return false;
    await new Promise((r) => setTimeout(r, 100));
  }
};

async function tier3() {
  const el = document.createElement('audio');
  el.src = wavUrl();
  el.loop = true;
  document.body.appendChild(el);
  await el.play();

  check('blob-source element gates as safe', tapSafety(el) === 'safe');

  const params = {
    enabled: true,
    audioEnabled: true,
    audioMix: 1,
    audioMaxTaps: 4,
    audioSustain: 4,
    audioDrive: 0.5,
    audioExciter: 'continuous',
    audioFeedback: false,
  };

  const graph = acquireAudio();
  check('audio graph available', !!graph);
  await graph.ctx.resume();

  const job1 = new AudioJob(el, params);
  job1.setAllowed(true);
  check('job engages a playing element', await waitFor(() => job1.tap?.engaged));

  let stats = null;
  let workletError = null;
  const watch = (job) => {
    if (!job.tap?.worklet) return;
    const prev = job.tap.worklet.port.onmessage;
    job.tap.worklet.port.onmessage = (e) => {
      if (e.data?.type === 'stats') stats = e.data;
      if (e.data?.type === 'error') workletError = e.data.message;
      prev?.(e);
    };
  };
  watch(job1);
  check('worklet reports signal (rms > 0)', await waitFor(() => stats && stats.rms > 0.01, 4000));

  // Live smear flip — params reach the worklet without error.
  params.audioFeedback = true;
  job1.applyParams();
  stats = null;
  check(
    'live smear toggle: worklet alive, no error',
    (await waitFor(() => stats && stats.rms > 0.01, 4000)) && !workletError
  );
  params.audioFeedback = false;
  job1.applyParams();

  // Permanence: a second direct tap must throw; our graph must reuse.
  let threw = false;
  try {
    graph.ctx.createMediaElementSource(el);
  } catch {
    threw = true;
  }
  check('second raw tap throws (permanence)', threw);

  const tapBefore = job1.tap;
  job1.destroy();
  const job2 = new AudioJob(el, params);
  job2.setAllowed(true);
  check(
    'job recreate reuses the tap (no InvalidStateError)',
    (await waitFor(() => job2.tap?.engaged)) && job2.tap === tapBefore
  );

  job2.params = { ...params, enabled: false };
  job2.applyParams();
  check('disable bypasses cleanly', await waitFor(() => !job2.tap.engaged));

  check('no worklet errors across the live tier', !workletError);

  el.pause();
  line('tier 3 done.', '');
}

// --- run ---------------------------------------------------------------------

(async () => {
  status.innerHTML = '';
  try {
    tier1();
    tier1Comb();
  } catch (e) {
    check(`tier 1 crashed (${e.message})`, false);
  }
  await tier2();
  const done = document.createElement('div');
  done.id = 'done';
  done.textContent = `AUTO TIERS COMPLETE: ${passCount} passed, ${failCount} failed`;
  done.className = failCount === 0 ? 'pass' : 'fail';
  status.appendChild(done);
})();

document.getElementById('live').addEventListener('click', async () => {
  try {
    await tier3();
  } catch (e) {
    check(`tier 3 crashed (${e.message})`, false);
  }
  const done = document.createElement('div');
  done.id = 'live-done';
  done.textContent = `LIVE TIER COMPLETE: ${passCount} passed, ${failCount} failed (cumulative)`;
  done.className = failCount === 0 ? 'pass' : 'fail';
  status.appendChild(done);
});
