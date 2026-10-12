// The shared audio pipeline for this page — the audio twin of gl/context.js.
// One AudioContext, one worklet module load, and a permanent tap per media
// element. Taps are permanent because createMediaElementSource() is
// irreversible for the element's lifetime; "off" is therefore a wet/dry
// bypass inside the graph, never an un-tap.
//
// The critical asymmetry vs the video path: CORS taint CANNOT be detected
// after tapping — an element whose current resource fails CORS outputs
// silence through BOTH the wet and dry paths, unrecoverably. So safety is
// predicted BEFORE tapping (tapSafety), and unsafe elements are never
// touched. (The DNR ACAO rule does not help here: media elements without a
// crossorigin attribute fetch in no-cors mode, and the response headers are
// never consulted.)

let instance = null;
let unavailable = false;

const WORKLET_URL = new URL('./worklet.js', import.meta.url).href;

export function acquireAudio() {
  if (instance) return instance;
  if (unavailable) return null;
  try {
    if (
      typeof AudioContext === 'undefined' ||
      typeof AudioWorkletNode === 'undefined'
    ) {
      unavailable = true;
      return null;
    }
    instance = new AudioGraph();
  } catch {
    unavailable = true;
    return null;
  }
  return instance;
}

// Pre-tap gate. Anything not provably safe stays untapped: the original
// audio plays untouched, which is always the right failure mode.
export function tapSafety(el) {
  if (el.mediaKeys) return 'drm';
  if (el.srcObject) return 'safe'; // MediaStream: origin-clean
  const src = el.currentSrc || el.src || '';
  if (!src) return 'no-src';
  if (src.startsWith('blob:') || src.startsWith('data:')) return 'safe';
  try {
    if (new URL(src, location.href).origin === location.origin) return 'safe';
  } catch {
    return 'cors';
  }
  // Cross-origin is safe only under an actual CORS fetch; 'use-credentials'
  // is NOT safe with our wildcard ACAO header.
  return el.crossOrigin === 'anonymous' ? 'safe' : 'cors';
}

// Subset of app params the processor cares about, renamed for the worklet.
// audioMix is deliberately absent: mix is the graph-side wet/dry, not DSP.
export function workletParams(p) {
  return {
    body: p.audioBody ?? 'modal',
    direct: p.audioDirect ?? 1,
    bodyMix: p.audioBodyMix ?? 1,
    combDamp: p.audioCombDamp ?? 0.45,
    sustain: p.audioSustain ?? 12,
    drive: p.audioDrive ?? 1.0,
    exciter: p.audioExciter ?? 'continuous',
    follow: p.audioFollow ?? 0, // the source-following body; 0 = the fixed chord
    // Smear layer: fully self-contained since 2026-08-12. The wobble and the
    // clear rhythm used to ride the visual driftY/resetMin/MaxS sliders (an
    // inheritance from the first audio phase); John asked for the detangle —
    // performing the video must never bend the sound. No visual param may
    // appear below this line. Clears default OFF: gain < 1 is already the
    // smear's decay.
    fb: p.audioFeedback ?? true,
    fbDecay: p.audioFbDecay ?? 0.999,
    fbReturn: p.audioFbReturn ?? 0.25,
    fbClear: !!p.audioFbClear,
    fbClearS: p.audioFbClearS ?? 1,
    wobble: p.audioFbWobble ?? 0,
    clearMinS: p.audioFbClearMinS ?? 1,
    clearMaxS: p.audioFbClearMaxS ?? 60,
  };
}

class AudioGraph {
  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'playback' });
    this.moduleReady = this.ctx.audioWorklet.addModule(WORKLET_URL);
    this.moduleReady.catch((err) =>
      console.warn('[DEFLECTION] audio worklet failed to load', err)
    );
    this.pending = [];

    // Autoplay policy: the context may start suspended. Engagement is
    // queued until it runs; any real user gesture resumes it. Under the
    // kiosk flag --autoplay-policy=no-user-gesture-required it starts
    // running and taps proceed immediately.
    const tryResume = () => {
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    };
    window.addEventListener('pointerdown', tryResume, true);
    window.addEventListener('keydown', tryResume, true);
    this.ctx.addEventListener('statechange', () => {
      if (this.ctx.state === 'running') {
        const q = this.pending.splice(0);
        for (const fn of q) {
          try {
            fn();
          } catch {
            /* job died meanwhile */
          }
        }
      }
    });

    // element → tap, surviving job destroy/recreate (YouTube re-parents its
    // <video>; a second createMediaElementSource on it would throw).
    this.taps = new WeakMap();
  }

  running() {
    return this.ctx.state === 'running';
  }

  whenRunning(fn) {
    if (this.running()) fn();
    else {
      this.pending.push(fn);
      this.ctx.resume().catch(() => {}); // works pre-gesture under kiosk flag
    }
  }

  // Returns the permanent tap for an element, creating it on first use.
  // null means the page's own Web Audio graph owns this element.
  getTap(el) {
    let tap = this.taps.get(el);
    if (tap) return tap;
    let source;
    try {
      source = this.ctx.createMediaElementSource(el);
    } catch {
      return null; // InvalidStateError: someone tapped it before us
    }
    const dry = this.ctx.createGain();
    dry.gain.value = 1;
    source.connect(dry);
    dry.connect(this.ctx.destination);
    tap = { source, dry, wet: null, worklet: null, engaged: false, bypassTimer: 0 };
    this.taps.set(el, tap);
    return tap;
  }

  async engage(tap, params, onMessage) {
    // A failed module load must degrade to untouched audio, not an
    // unhandled rejection (sync() fires engage without awaiting it).
    try {
      await this.moduleReady;
    } catch {
      return;
    }
    if (tap.engaged) return;
    clearTimeout(tap.bypassTimer); // a stale bypass must not cut our input
    if (!tap.worklet) {
      // No outputChannelCount: with 1-in/1-out the output channel count
      // follows the input dynamically, so mono elements stay mono instead
      // of losing their right channel to a hardcoded stereo output.
      tap.worklet = new AudioWorkletNode(this.ctx, 'deflection-audio', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        processorOptions: { params: workletParams(params) },
      });
      tap.wet = this.ctx.createGain();
      tap.wet.gain.value = 0;
      tap.worklet.connect(tap.wet);
      tap.wet.connect(this.ctx.destination);
    } else {
      this.sendParams(tap, params);
    }
    tap.worklet.port.onmessage = onMessage ?? null;
    tap.source.connect(tap.worklet);
    tap.engaged = true;
    this.setMix(tap, params.audioMix ?? 1);
  }

  // Bypass ≠ un-tap: ramp to dry, then disconnect the worklet's input so
  // its process() sees no input and idles (N engaged processors on a feed
  // page would otherwise burn audio-thread CPU for nothing).
  bypass(tap) {
    if (!tap.engaged) return;
    tap.engaged = false;
    const t = this.ctx.currentTime;
    tap.dry.gain.setTargetAtTime(1, t, 0.03);
    if (tap.wet) tap.wet.gain.setTargetAtTime(0, t, 0.03);
    clearTimeout(tap.bypassTimer);
    tap.bypassTimer = setTimeout(() => {
      if (!tap.engaged && tap.worklet) {
        try {
          tap.source.disconnect(tap.worklet);
        } catch {
          /* already disconnected */
        }
      }
    }, 150);
  }

  setMix(tap, mix) {
    if (!tap.engaged || !tap.wet) return;
    const t = this.ctx.currentTime;
    tap.dry.gain.setTargetAtTime(1 - mix, t, 0.03);
    tap.wet.gain.setTargetAtTime(mix, t, 0.03);
  }

  sendParams(tap, params) {
    tap.worklet?.port.postMessage({ type: 'params', params: workletParams(params) });
  }
}
