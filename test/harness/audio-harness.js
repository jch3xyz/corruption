// Audio bake-off harness. Tier 1 tests the pure DSP modules with no audio
// API at all; tier 2 renders BOTH engines deterministically through
// OfflineAudioContext (no gesture, no rendering pipeline — immune to the
// hidden-pane flakiness that plagues the visual harness); tier 3 taps a
// live <audio> element and runs behind a button so the click doubles as
// the autoplay gesture.
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
  lagField,
  slewLag,
  LAG_MAX_SLOPE,
  HEAD_LAGS,
  HEAD_GAINS,
  RING_S,
  LAG_MIN_S,
  BODY_FUNDAMENTALS,
  BODY_PARTIALS,
  BODY_STRETCH,
} from '../../source/audio/dsp.js';
import { acquireAudio, tapSafety } from '../../source/audio/graph.js';
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

  // Deflection field: excursion floor holds, no parking at zero.
  {
    let nearZero = 0;
    let sumAbs = 0;
    let maxAbs = 0;
    const nSamples = 3 * 3600;
    for (let i = 0; i < nSamples; i++) {
      const s = lagField(i, 2);
      const a = Math.abs(s);
      if (a < 0.2) nearZero++;
      sumAbs += a;
      if (a > maxAbs) maxAbs = a;
      if (a > 1.0001) maxAbs = 99; // out of range = fail below
    }
    const dwell = nearZero / nSamples;
    check(
      `field excursion: dwell |S|<0.2 is ${(dwell * 100).toFixed(1)}% (<20%), mean |S| ${(sumAbs / nSamples).toFixed(2)} (>0.35), max ≤1`,
      dwell < 0.2 && sumAbs / nSamples > 0.35 && maxAbs <= 1.0001
    );
  }

  // Lag control: slew clamp holds exactly; a worst-case head trajectory
  // stays inside the ring and its derived rate inside [0.25, 1.75].
  {
    const dt = 128 / 48000;
    let slewOk = true;
    let lag = 5;
    for (let i = 0; i < 5000; i++) {
      const target = rand() * 40;
      const next = slewLag(lag, target, dt);
      if (Math.abs(next - lag) > LAG_MAX_SLOPE * dt + 1e-9) slewOk = false;
      lag = next;
    }
    check('slewLag never exceeds the slope clamp', slewOk);

    const base = HEAD_LAGS[HEAD_LAGS.length - 1]; // 30 s, the worst case
    const depth = 1.5;
    let l = base;
    let boundsOk = true;
    let rateOk = true;
    const steps = Math.round(600 / dt); // 10 simulated minutes
    for (let i = 0; i < steps; i++) {
      const s = lagField((i * dt) / 1, 5);
      let target = base * Math.pow(2, depth * s);
      if (target < LAG_MIN_S) target = LAG_MIN_S;
      if (target > RING_S - 1) target = RING_S - 1;
      const next = slewLag(l, target, dt);
      const rate = 1 - (next - l) / dt;
      if (next < LAG_MIN_S - 1e-9 || next > RING_S - 1 + 1e-9) boundsOk = false;
      if (rate < 0.25 - 1e-9 || rate > 1.75 + 1e-9) rateOk = false;
      l = next;
    }
    check('worst-case head trajectory stays inside the ring', boundsOk);
    check('derived read rate stays inside [0.25, 1.75]', rateOk);
  }
}

// --- Tier 2: both engines through the real worklet --------------------------

const SR = 48000;

const BODY = {
  mode: 'body',
  sustain: 2,
  drive: 0.5,
  exciter: 'continuous',
  depth: 0.8,
  fieldRate: 1,
  tail: 1.5,
};
const TIMEBASE = { ...BODY, mode: 'timebase' };

async function renderThrough(wparams, buildInput, seconds, opts = {}) {
  const frames = Math.ceil(seconds * SR);
  const ctx = new OfflineAudioContext(1, frames, SR);
  await ctx.audioWorklet.addModule('/source/audio/worklet.js');
  const node = new AudioWorkletNode(ctx, 'deflection-audio', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    processorOptions: { params: wparams, script: opts.script },
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
  // Exact silence in → exact silence out, both engines.
  for (const [name, p] of [['body', BODY], ['timebase', TIMEBASE]]) {
    try {
      const { out } = await renderThrough(p, () => {}, 1.5);
      let maxAbs = 0;
      for (let i = 0; i < out.length; i++) maxAbs = Math.max(maxAbs, Math.abs(out[i]));
      check(`${name}: digital silence in → exact zeros out`, maxAbs === 0);
    } catch (e) {
      check(`${name} silence render (${e.message})`, false);
    }
  }

  // NaN in the stream must never reach the output or kill the processor.
  for (const [name, p] of [['body', BODY], ['timebase', TIMEBASE]]) {
    try {
      const { out } = await renderThrough(
        p,
        (data) => {
          fillNoise(0.1)(data);
          data[1000] = NaN;
          data[2000] = Infinity;
        },
        2
      );
      const finite = out.every(Number.isFinite);
      const alive = rmsOf(out, 1.0 * SR, 0.5 * SR) > 1e-6;
      check(`${name}: injected NaN/Inf → finite output, processor alive`, finite && alive);
    } catch (e) {
      check(`${name} NaN render (${e.message})`, false);
    }
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

  // Timebase: depth 0 is a transparent multi-tap at exactly the base lags.
  try {
    const { out, input } = await renderThrough(
      { ...TIMEBASE, depth: 0 },
      fillNoise(0.1),
      3.5
    );
    const g0 = HEAD_GAINS[0] * Math.SQRT1_2;
    const g1 = HEAD_GAINS[1] * Math.SQRT1_2;
    const d0 = Math.round(HEAD_LAGS[0] * SR);
    const d1 = Math.round(HEAD_LAGS[1] * SR);
    let errSum = 0;
    let n = 0;
    for (let i = Math.round(1.6 * SR); i < Math.round(3.4 * SR); i += 7) {
      const expect = g0 * input[i - d0] + g1 * input[i - d1];
      errSum += Math.abs(out[i] - expect);
      n++;
    }
    const avgErr = errSum / n;
    check(`timebase depth 0 = multi-tap identity (avg err ${avgErr.toFixed(4)})`, avgErr < 0.02);
  } catch (e) {
    check(`timebase identity render (${e.message})`, false);
  }

  // Timebase: depth bends audibly away from the identity, stays finite/bounded.
  try {
    const { out, input } = await renderThrough(
      { ...TIMEBASE, depth: 1.2, fieldRate: 4 },
      fillNoise(0.1),
      3.5
    );
    const g0 = HEAD_GAINS[0] * Math.SQRT1_2;
    const g1 = HEAD_GAINS[1] * Math.SQRT1_2;
    const d0 = Math.round(HEAD_LAGS[0] * SR);
    const d1 = Math.round(HEAD_LAGS[1] * SR);
    let errSum = 0;
    let n = 0;
    for (let i = Math.round(1.6 * SR); i < Math.round(3.4 * SR); i += 7) {
      errSum += Math.abs(out[i] - (g0 * input[i - d0] + g1 * input[i - d1]));
      n++;
    }
    const outR = rmsOf(out, 1.6 * SR, 1.8 * SR);
    const inR = rmsOf(input, 1.6 * SR, 1.8 * SR);
    check(
      `timebase depth 1.2 diverges from identity (avg err ${(errSum / n).toFixed(4)} > 0.005), bounded`,
      errSum / n > 0.005 && out.every(Number.isFinite) && outR <= inR * 2
    );
  } catch (e) {
    check(`timebase depth render (${e.message})`, false);
  }

  // Timebase silence semantics: tail 0 gates hard; tail 3 speaks then
  // decays. depth 0 pins the lags so the checks don't depend on where the
  // deflection field happens to sit (the 1 s head reads the noise; the
  // 0.15 s head reads the 200 ms of zeros the presence-close delay wrote).
  try {
    const stopAt = (data) => {
      for (let i = 0; i < Math.round(1.2 * SR); i++) data[i] = 0.1 * (rand() * 2 - 1);
    };
    const { out: out0 } = await renderThrough({ ...TIMEBASE, depth: 0, tail: 0 }, stopAt, 5);
    const gated = rmsOf(out0, 2.0 * SR, 0.5 * SR);
    check(`timebase tail 0: silent within gate time of input stop (${gated.toExponential(1)})`, gated < 1e-4);

    const { out: out3 } = await renderThrough({ ...TIMEBASE, depth: 0, tail: 3 }, stopAt, 5);
    const speaking = rmsOf(out3, 1.8 * SR, 0.5 * SR);
    const decayed = rmsOf(out3, 4.5 * SR, 0.4 * SR);
    check(
      `timebase tail 3: still speaking after stop (${speaking.toExponential(1)}), decayed by 4.5 s (${decayed.toExponential(1)})`,
      speaking > 1e-3 && decayed < speaking * 0.2
    );
  } catch (e) {
    check(`timebase tail render (${e.message})`, false);
  }

  // Feedback/smear layer: silence stays exact zeros; echoes recirculate at
  // 0.35 s and decay; the keyframe reset hard-clears the line. driftY 0
  // pins the delay (no LFO wobble) and resetMin=Max removes the jitter, so
  // every window lands deterministically.
  try {
    const FB = {
      ...BODY,
      fb: true,
      fbDecay: 0.96,
      driftY: 0,
      resetMinS: 1000,
      resetMaxS: 1000,
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
      { ...FB, resetMinS: 0.6, resetMaxS: 0.6 },
      burst,
      1.6
    );
    const r1 = rmsOf(outR, (0.05 + 0.35) * SR, 0.03 * SR);
    const r2 = rmsOf(outR, (0.05 + 0.7) * SR, 0.03 * SR);
    check(
      `feedback: keyframe reset clears the line (${r1.toFixed(4)} → ${r2.toFixed(4)})`,
      r1 > 0.002 && r2 < r1 * 0.15
    );
  } catch (e) {
    check(`feedback render (${e.message})`, false);
  }

  // Live A/B: a scripted mid-render mode switch must not click. Gated
  // exciter keeps the body side quiet enough that the delta threshold
  // means something (continuous body on broadband noise lives near the
  // clip, where max-delta saturates and the check is vacuous).
  try {
    const { out } = await renderThrough(
      { ...BODY, exciter: 'gated' },
      fillNoise(0.1),
      4,
      { script: [{ atS: 2, params: { mode: 'timebase' } }] }
    );
    const maxDelta = (from, to) => {
      let m = 0;
      for (let i = Math.round(from * SR) + 1; i < Math.round(to * SR); i++) {
        m = Math.max(m, Math.abs(out[i] - out[i - 1]));
      }
      return m;
    };
    const steady = maxDelta(1.0, 1.9);
    const around = maxDelta(1.95, 2.2);
    check(
      `mode switch is click-free (Δ ${around.toFixed(3)} ≤ max(4×${steady.toFixed(3)}, 0.05))`,
      around <= Math.max(4 * steady, 0.05) && out.every(Number.isFinite)
    );
  } catch (e) {
    check(`mode switch render (${e.message})`, false);
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
    audioMode: 'body',
    audioMix: 1,
    audioMaxTaps: 4,
    audioSustain: 4,
    audioDrive: 0.5,
    audioExciter: 'continuous',
    audioDepth: 0.8,
    audioFieldRate: 1,
    audioTail: 1.5,
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

  // Live mode flip — the bake-off gesture itself.
  params.audioMode = 'timebase';
  job1.applyParams();
  stats = null;
  check(
    'live mode flip to timebase: worklet alive, no error',
    (await waitFor(() => stats && stats.rms > 0.01, 4000)) && !workletError
  );
  params.audioMode = 'body';
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
  line('tier 3 done — for the real verdict: load unpacked, browse, flip audio mode.', '');
}

// --- run ---------------------------------------------------------------------

(async () => {
  status.innerHTML = '';
  try {
    tier1();
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
