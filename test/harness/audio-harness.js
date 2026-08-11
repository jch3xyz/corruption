// Audio pipeline harness. Tier 1 tests the pure DSP modules with no audio
// API at all; tier 2 renders the actual worklet deterministically through
// OfflineAudioContext (no gesture, no rendering pipeline — immune to the
// hidden-pane flakiness that plagues the visual harness); tier 3 taps a
// live <audio> element and runs behind a button so the click doubles as
// the autoplay gesture.
//
// Run: python3 test/serve.py  →  http://localhost:8437/test/harness/audio.html

import { createFFT } from '../../source/audio/fft.js';
import {
  ladderSchedule,
  sortIndicesPass,
  sortValuesPass,
  rms,
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

// --- Tier 1: pure modules ---------------------------------------------------

function tier1() {
  // FFT roundtrip
  const N = 2048;
  const fft = createFFT(N);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const orig = new Float32Array(N);
  let seed = 42;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < N; i++) orig[i] = re[i] = rand() * 2 - 1;
  fft.forward(re, im);
  fft.inverse(re, im);
  let maxErr = 0;
  for (let i = 0; i < N; i++) maxErr = Math.max(maxErr, Math.abs(re[i] - orig[i]));
  check(`fft roundtrip (max err ${maxErr.toExponential(1)})`, maxErr < 1e-3);

  // Ladder shape
  const ladder = ladderSchedule(256);
  check(
    'ladder schedule 256→1, both parities',
    ladder.length === 18 &&
      ladder[0][0] === 256 &&
      ladder[1][1] === 1 &&
      ladder[16][0] === 1
  );

  // Full sort, descending
  const keys = Float32Array.from({ length: 32 }, () => rand());
  const order = Uint16Array.from({ length: 32 }, (_, i) => i);
  for (let p = 0; p < 128; p++) {
    const [s, par] = ladder[p % ladder.length];
    sortIndicesPass(keys, order, s, par, 0);
  }
  let sorted = true;
  for (let i = 1; i < order.length; i++) {
    if (keys[order[i]] > keys[order[i - 1]] + 1e-9) sorted = false;
  }
  check('full ladder sorts indices descending', sorted);

  // Quiet keys never move (barrier semantics: pairs involving them skip)
  const bKeys = Float32Array.from([0.9, 0.7, 0.1, 0.8, 0.6, 0.05, 0.95]);
  const bOrder = Uint16Array.from({ length: 7 }, (_, i) => i);
  for (let p = 0; p < 64; p++) {
    const [s, par] = ladder[p % ladder.length];
    sortIndicesPass(bKeys, bOrder, s, par, 0.5);
  }
  check(
    'sub-threshold grains hold position',
    bOrder[2] === 2 && bOrder[5] === 5
  );

  // Value pass with subrange
  const vals = Float32Array.from([9, 0.2, 0.9, 0.5, 0.7, 0.1, 9]);
  for (let p = 0; p < 64; p++) {
    const [s, par] = ladder[p % ladder.length];
    sortValuesPass(vals, s, par, 0.3, 1, 6);
  }
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  check(
    'value sort respects range and cutoff',
    vals[0] === 9 &&
      vals[6] === 9 &&
      near(vals[1], 0.2) && // below cutoff: anchored
      near(vals[5], 0.1) &&
      vals[2] >= vals[3] &&
      vals[3] >= vals[4]
  );
}

// --- Tier 2: OfflineAudioContext through the real worklet -------------------

const SR = 48000;

async function renderThrough(wparams, buildInput, seconds) {
  const ctx = new OfflineAudioContext(1, Math.ceil(seconds * SR), SR);
  await ctx.audioWorklet.addModule('/source/audio/worklet.js');
  const node = new AudioWorkletNode(ctx, 'deflection-audio', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    processorOptions: { params: wparams },
  });
  const buf = ctx.createBuffer(1, Math.ceil(seconds * SR), SR);
  buildInput(buf.getChannelData(0));
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(node);
  node.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  return { out: rendered.getChannelData(0), input: buf.getChannelData(0) };
}

const sine = (freq, amp) => (data) => {
  for (let i = 0; i < data.length; i++) {
    data[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  }
};

async function tier2() {
  const base = {
    algorithm: 'spectral',
    threshold: 0,
    passes: 0,
    grainMs: 50,
    windowS: 0.5,
    feedback: false,
    decay: 0.96,
    driftY: 0,
    resetMinS: 1000,
    resetMaxS: 1000,
  };

  // Spectral passthrough: delayed identity at exactly N=2048.
  try {
    const { out, input } = await renderThrough(base, sine(440, 0.5), 1.5);
    let err = 0;
    let count = 0;
    for (let i = 24000; i < 48000; i += 97) {
      err += Math.abs(out[i] - input[i - 2048]);
      count++;
    }
    err /= count;
    check(`spectral passes=0 is delayed identity (avg err ${err.toFixed(4)})`, err < 0.02);
  } catch (e) {
    check(`spectral passthrough render (${e.message})`, false);
  }

  // Spectral sort: energy migrates toward low bins → centroid drops.
  try {
    const twoTone = (data) => {
      for (let i = 0; i < data.length; i++) {
        data[i] =
          0.5 * Math.sin((2 * Math.PI * 3000 * i) / SR) +
          0.15 * Math.sin((2 * Math.PI * 8000 * i) / SR);
      }
    };
    const { out, input } = await renderThrough({ ...base, passes: 64 }, twoTone, 1.5);
    const centroid = (arr, start) => {
      const n = 2048;
      const fft = createFFT(n);
      const re = Float32Array.from(arr.subarray(start, start + n));
      const im = new Float32Array(n);
      fft.forward(re, im);
      let num = 0;
      let den = 0;
      for (let k = 1; k < n / 2; k++) {
        const m = Math.hypot(re[k], im[k]);
        num += k * m;
        den += m;
      }
      return num / (den || 1);
    };
    const cIn = centroid(input, 48000);
    const cOut = centroid(out, 48000);
    check(
      `spectral sort drops centroid (${cIn.toFixed(0)} → ${cOut.toFixed(0)} bins)`,
      cOut < cIn * 0.8
    );
  } catch (e) {
    check(`spectral sort render (${e.message})`, false);
  }

  // Granular passthrough: delayed identity at mid-grain points.
  try {
    const g = { ...base, algorithm: 'granular', passes: 0 };
    const { out, input } = await renderThrough(g, sine(220, 0.5), 2);
    const gs = Math.round(0.05 * SR); // 2400
    const ws = Math.floor((0.5 * SR) / gs) * gs; // 24000
    let err = 0;
    let count = 0;
    for (let grain = 0; grain < 8; grain++) {
      const t = ws + grain * gs + (gs >> 1);
      err += Math.abs(out[t] - input[t - ws]);
      count++;
    }
    err /= count;
    check(`granular passes=0 is delayed identity (avg err ${err.toFixed(4)})`, err < 0.03);
  } catch (e) {
    check(`granular passthrough render (${e.message})`, false);
  }

  // Granular sort: staircase-loudness grains come out loud-first, energy kept.
  try {
    const amps = [0.1, 0.9, 0.3, 1.0, 0.05, 0.6, 0.8, 0.2, 0.7, 0.4];
    const gs = Math.round(0.1 * SR); // 4800
    const ws = gs * 10; // 48000 = the 1s window
    const staircase = (data) => {
      for (let i = 0; i < data.length; i++) {
        const grain = Math.floor((i % ws) / gs);
        data[i] = amps[grain] * Math.sin((2 * Math.PI * 330 * i) / SR);
      }
    };
    const g = { ...base, algorithm: 'granular', passes: 64, grainMs: 100, windowS: 1 };
    const { out } = await renderThrough(g, staircase, 2);
    const outRms = [];
    for (let slot = 0; slot < 10; slot++) {
      outRms.push(rmsOf(out, ws + slot * gs + 300, gs - 600)); // skip fades
    }
    let descending = true;
    for (let i = 1; i < outRms.length; i++) {
      if (outRms[i] > outRms[i - 1] + 0.02) descending = false;
    }
    const inSorted = amps
      .map((a) => a * Math.SQRT1_2 * 0.999)
      .sort((a, b) => b - a);
    let multiset = true;
    for (let i = 0; i < 10; i++) {
      if (Math.abs(outRms[i] - inSorted[i]) > inSorted[i] * 0.1 + 0.01) multiset = false;
    }
    check(`granular sort orders grains loud-first (${outRms.map((r) => r.toFixed(2)).join(',')})`, descending);
    check('granular sort preserves grain energy (multiset)', multiset);
  } catch (e) {
    check(`granular sort render (${e.message})`, false);
  }

  // Feedback layer: decaying echoes at ~0.35s spacing; self-reset clears them.
  try {
    const burst = (data) => {
      const start = Math.round(0.05 * SR);
      for (let i = 0; i < Math.round(0.01 * SR); i++) {
        data[start + i] = 0.8 * Math.sin((2 * Math.PI * 1000 * i) / SR);
      }
    };
    const f = { ...base, feedback: true, resetMinS: 1000, resetMaxS: 1000 };
    const { out } = await renderThrough(f, burst, 1.6);
    const at = (sec) => rmsOf(out, sec * SR, 0.03 * SR);
    const d = 2048 / SR; // spectral latency
    const e1 = at(0.05 + d + 0.35);
    const e2 = at(0.05 + d + 0.7);
    check(
      `feedback echoes present and decaying (${e1.toFixed(3)}, ${e2.toFixed(3)})`,
      e1 > 0.01 && e2 > 0.005 && e2 < e1
    );

    const fr = { ...f, resetMinS: 0.6, resetMaxS: 0.6 };
    const { out: outR } = await renderThrough(fr, burst, 1.6);
    const r1 = rmsOf(outR, (0.05 + d + 0.35) * SR, 0.03 * SR);
    const r2 = rmsOf(outR, (0.05 + d + 0.7) * SR, 0.03 * SR);
    check(
      `keyframe reset clears the delay line (${r1.toFixed(3)} → ${r2.toFixed(4)})`,
      r1 > 0.01 && r2 < 0.005
    );
  } catch (e) {
    check(`feedback render (${e.message})`, false);
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
    audioAlgorithm: 'spectral',
    audioSortPasses: 8,
    audioThreshold: 0,
    audioMix: 1,
    audioMaxTaps: 4,
    feedback: false,
  };

  const graph = acquireAudio();
  check('audio graph available', !!graph);
  await graph.ctx.resume();

  const job1 = new AudioJob(el, params);
  job1.setAllowed(true);
  check('job engages a playing element', await waitFor(() => job1.tap?.engaged));

  let stats = null;
  if (job1.tap?.worklet) {
    job1.tap.worklet.port.addEventListener?.('message', () => {});
    const prev = job1.tap.worklet.port.onmessage;
    job1.tap.worklet.port.onmessage = (e) => {
      if (e.data?.type === 'stats') stats = e.data;
      prev?.(e);
    };
  }
  check('worklet reports signal (rms > 0)', await waitFor(() => stats && stats.rms > 0.01, 4000));

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

  el.pause();
  line('tier 3 done — listen test: unmute a real page and A/B audioMix.', '');
}

// --- run ---------------------------------------------------------------------

(async () => {
  status.innerHTML = '';
  tier1();
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
  done.textContent = `LIVE TIER COMPLETE: ${passCount} passed, ${failCount} failed (cumulative)`;
  done.className = failCount === 0 ? 'pass' : 'fail';
  status.appendChild(done);
});
