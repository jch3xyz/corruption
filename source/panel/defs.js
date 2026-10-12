// The panel's control table: which knob, what range, which section, and the
// hover copy for every one of them. Kept apart from panel.js so the panel
// harness can import the definitions and the pure value helpers without
// booting the UI.
//
// Section membership is John's call (2026-08-20): the sort knobs that video
// and images genuinely SHARE live under Video — so their tooltips say so
// rather than the layout lying about it. The Images section went with image
// feedback (removed 2026-10-12, John): stills have no knobs of their own.
// `enabled`, `video` and `images` belong to no section: they are the global
// block above the first divider — the A/B (`enabled`) and two of the four
// medium chips. The other two chips drive `textScramble` and `audioEnabled`,
// whose canonical rows stay in their own sections.

import { DEFAULTS } from '../content/params.js';

export const SECTIONS = [
  {
    id: 'video',
    title: 'Video',
    tip: 'Videos — and the sorting grammar they share with images. Still images are one-shot sorted stills: every sort and flow knob here shapes them too; the feedback knobs and max videos are video only.',
  },
  {
    id: 'text',
    title: 'Text',
    tip: 'Page text: letters rearranged inside their own words, page-wide.',
  },
  {
    id: 'audio',
    title: 'Audio',
    tip: 'Sound: a process done to the audio, not a synth the audio drives. The source passes through a fixed resonant body and smears.',
  },
];

// Appended under every parameter's tooltip — the two gestures that are not
// discoverable from looking at the row.
export const ROW_HINT = 'Double-click the row to put it back to the marked preset.';
export const NUM_HINT = 'Type a value and press Enter; ↑/↓ steps (shift ×10). Out-of-range values clamp.';

export const DEFS = [
  {
    key: 'enabled',
    label: 'enabled',
    type: 'toggle',
    tip: 'The A/B: the whole piece on or off — video, images, text and sound. Click to latch. Press and hold to see and hear the page untouched for as long as you hold; let go and the bending comes back. Ctrl+Shift+D flips it from any page without the panel.',
  },
  {
    key: 'video',
    label: 'video',
    type: 'toggle',
    tip: 'Video on/off. Off shows every video exactly as it arrived while images, text and sound keep bending. The Video section below shapes it.',
  },
  {
    key: 'images',
    label: 'images',
    type: 'toggle',
    tip: 'Images on/off. Off puts every still picture back as it arrived. Images take their look from the sort knobs in the Video section.',
  },

  // --- Video (plus the sort grammar images share) ---
  {
    key: 'feedbackVideo',
    label: 'video feedback',
    type: 'toggle',
    section: 'video',
    tip: 'Temporal feedback on videos — the resting state. The smear accumulates, drifts, decays, and clears at slow keyframes. Off = straight per-frame pixel sorting.',
  },
  {
    key: 'threshold',
    label: 'threshold',
    min: 0,
    max: 1,
    step: 0.01,
    section: 'video',
    tip: 'Luma above this is eligible for sorting. Near zero corrupts almost everything while true black holds as a barrier; 1 leaves the frame untouched. The single most expressive knob. Also applies to images.',
  },
  {
    key: 'passes',
    label: 'sort passes',
    min: 0,
    max: 64,
    step: 1,
    section: 'video',
    tip: 'Sort passes per frame. A full 256→1 stride ladder is 18 passes, so 64 runs about three and a half settling cycles. Also applies to images.',
  },
  {
    key: 'streak',
    label: 'streak',
    min: 1,
    max: 256,
    step: 1,
    section: 'video',
    tip: 'Longest compare-exchange stride, rounded down to a power of two — how far a pixel can travel in one frame. The ribbon-length knob. Also applies to images.',
  },
  {
    key: 'temperature',
    label: 'temperature',
    min: 0,
    max: 0.5,
    step: 0.005,
    section: 'video',
    tip: 'Fraction of pair verdicts inverted per pass: the sort simmers at its equilibrium instead of settling into it, so ribbons boil at their edges and the picture never rests. Barriers still hold. Also applies to images.',
  },
  {
    key: 'flowAmount',
    label: 'flow amount',
    min: 0,
    max: 1,
    step: 0.01,
    section: 'video',
    tip: '0 = the classic vertical grammar, bit for bit. Up = sorting follows a slowly morphing curl-noise field, so ribbons meander along streamlines instead of climbing columns. Every element draws its own seed. Also applies to images.',
  },
  {
    key: 'flowMode',
    label: 'flow mode',
    type: 'select',
    options: ['paths', 'facets'],
    section: 'video',
    tip: 'Flow only. facets = 8 fixed sectors: straight runs pooling at anchored seams. paths = 16 sectors with a boundary that dithers per pass, so ribbons round their curves.',
  },
  {
    key: 'flowScale',
    label: 'flow scale',
    min: 1,
    max: 12,
    step: 0.5,
    section: 'video',
    tip: 'Flow only. Noise cells across the frame: higher = tighter, busier swirls; lower = broad sweeping currents.',
  },
  {
    key: 'flowSpeed',
    label: 'flow speed',
    min: 0,
    max: 0.2,
    step: 0.005,
    section: 'video',
    tip: 'Flow only. How fast the field morphs — streamlines re-carve in place rather than marching. 0 = frozen geometry, flow without evolution.',
  },
  {
    key: 'decay',
    label: 'decay',
    min: 0.8,
    max: 0.999,
    step: 0.001,
    section: 'video',
    tip: 'Feedback only. Accumulator retention per frame: higher = the smear lingers longer.',
  },
  {
    key: 'driftX',
    label: 'drift x',
    min: -0.01,
    max: 0.01,
    step: 0.0005,
    section: 'video',
    tip: 'Feedback only. Horizontal smear in UV units per frame; negative drifts leftward.',
  },
  {
    key: 'driftY',
    label: 'drift y',
    min: -0.01,
    max: 0.01,
    step: 0.0005,
    section: 'video',
    tip: 'Feedback only. Vertical smear; positive drifts upward — the resting state climbs gently. Purely visual: the audio wobble this used to drive is now fb wobble.',
  },
  {
    key: 'resetMinS',
    label: 'reset min s',
    min: 1,
    max: 30,
    step: 1,
    section: 'video',
    tip: 'Feedback only. Floor of the keyframe window: the accumulator resets to a clean frame at a random interval in this range.',
  },
  {
    key: 'resetMaxS',
    label: 'reset max s',
    min: 2,
    max: 60,
    step: 1,
    section: 'video',
    tip: 'Feedback only. Ceiling of the keyframe window. Slow by default — damage accumulates for half a minute or more before it clears.',
  },
  {
    key: 'motionGate',
    label: 'motion gate',
    min: 0,
    max: 1,
    step: 0.01,
    section: 'video',
    tip: 'Feedback only. A pair trades only where the motion trail clears this, so damage stays inside what the transmission itself is changing: action smears, stillness holds and heals.',
  },
  {
    key: 'maxRes',
    label: 'max res',
    min: 480,
    max: 1920,
    step: 160,
    section: 'video',
    tip: 'Processing resolution cap on the long axis. Lower it on weak GPUs; the output upscales through the overlay. Applies to images too.',
  },
  {
    key: 'maxVideos',
    label: 'max videos',
    min: 1,
    max: 16,
    step: 1,
    section: 'video',
    tip: 'Concurrent video jobs, biggest visible first. Paused videos count — they get a one-shot sorted still, since the frame callback never fires for them.',
  },

  // --- Text ---
  {
    key: 'textScramble',
    label: 'text scramble',
    type: 'toggle',
    section: 'text',
    tip: 'Letters rearrange inside their own word, page-wide. Anything that is not a letter — space, punctuation, digit, emoji — is a barrier no glyph crosses, so every word keeps its length and the page keeps its shape.',
  },
  {
    key: 'textMin',
    label: 'text min chars',
    min: 1,
    max: 40,
    step: 1,
    section: 'text',
    tip: 'Text only. Shortest run of text that scrambles. At 8 prose and most labels dissolve while the shortest furniture (Home, OK) survives — the navigability dial.',
  },

  // --- Audio ---
  {
    key: 'audioEnabled',
    label: 'audio',
    type: 'toggle',
    section: 'audio',
    tip: 'Audio master. Off ramps every tap to dry — the tap itself is permanent by design and is never undone.',
  },
  {
    key: 'audioMix',
    label: 'audio mix',
    min: 0,
    max: 1,
    step: 0.01,
    section: 'audio',
    tip: 'Wet/dry in the tap graph, on 30 ms ramps. 0 = the internet as transmitted. Distinct from direct, which lives inside the DSP.',
  },
  {
    key: 'audioBody',
    label: 'body',
    type: 'select',
    options: ['modal', 'comb'],
    section: 'audio',
    tip: 'Which apparatus the sound passes through. modal = 48 stretched partials, struck metal. comb = three recirculating lines, exactly harmonic — tube, pipe, spring, and about a tenth of the cost.',
  },
  {
    key: 'audioDirect',
    label: 'direct',
    min: 0,
    max: 1,
    step: 0.01,
    section: 'audio',
    tip: 'Direct signal level inside the DSP. The engine sums its resonant part with this, so the source passes through the apparatus instead of only driving it. 0 = the old synth-like behaviour, kept reachable for comparison.',
  },
  {
    key: 'audioBodyMix',
    label: 'body mix',
    min: 0,
    max: 2,
    step: 0.01,
    section: 'audio',
    tip: 'The resonant part against the direct path — the identity dial. Up for more fixed voice, down for more of the video.',
  },
  {
    key: 'audioCombDamp',
    label: 'comb damp',
    min: 0,
    max: 0.9,
    step: 0.01,
    section: 'audio',
    tip: 'Comb only. Loop lowpass — the comb’s version of "higher partials die faster". Low = metallic and bright, high = woody and dark.',
  },
  {
    key: 'audioFeedback',
    label: 'audio fb',
    type: 'toggle',
    section: 'audio',
    tip: 'The smear: the engine’s output recirculates through a 0.35 s delay line, continuously.',
  },
  {
    key: 'audioFbDecay',
    label: 'fb tail',
    min: 0.8,
    max: 0.999,
    step: 0.001,
    section: 'audio',
    tip: 'Audio fb only. The smear’s tail length, and only that. Maps to loop gain 0.5–0.95, the same range as the visual decay knob, so it feels like the same control.',
  },
  {
    key: 'audioFbReturn',
    label: 'fb return',
    min: 0,
    max: 1,
    step: 0.01,
    section: 'audio',
    tip: 'Audio fb only. How loud the wash sits, as a fraction of the loop gain. Tail and level are two knobs on purpose: merged, the wash settled about twenty times over the direct sound and buried the source. 1 = that old behaviour exactly.',
  },
  {
    key: 'audioFbWobble',
    label: 'fb wobble',
    min: 0,
    max: 0.4,
    step: 0.005,
    section: 'audio',
    tip: 'Audio fb only. Delay wobble depth — tape warble on the echo stack. 0 = a static stack, the resting state. Audio-only since the detangle: performing the video never bends the sound.',
  },
  {
    key: 'audioFbClear',
    label: 'fb clear',
    type: 'toggle',
    section: 'audio',
    tip: 'Audio fb only. Whether the smear clears on its own rhythm at all. Off is the piece: a loop gain below 1 is already a decay, so unlike the video accumulator the wash never needs wiping.',
  },
  {
    key: 'audioFbClearS',
    label: 'fb clear s',
    min: 0,
    max: 4,
    step: 0.1,
    section: 'audio',
    tip: 'Audio fb clear only. Fade the wash out over about this long before the line wipes. 0 = the original hard cut; the video keyframe stays a hard cut by design.',
  },
  {
    key: 'audioFbClearMinS',
    label: 'fb clear min s',
    min: 1,
    max: 30,
    step: 1,
    section: 'audio',
    tip: 'Audio fb clear only. Floor of the smear’s own keyframe window — decoupled from the visual reset rhythm.',
  },
  {
    key: 'audioFbClearMaxS',
    label: 'fb clear max s',
    min: 2,
    max: 60,
    step: 1,
    section: 'audio',
    tip: 'Audio fb clear only. Ceiling of the smear’s own keyframe window — decoupled from the visual reset rhythm.',
  },
  {
    key: 'audioMaxTaps',
    label: 'max taps',
    min: 1,
    max: 8,
    step: 1,
    section: 'audio',
    tip: 'Concurrent engaged taps, most recently playing first — the audio sibling of max videos. Everything safe gets tapped; beyond the cap, elements play dry.',
  },
  {
    key: 'audioSustain',
    label: 'sustain s',
    min: 2,
    max: 12,
    step: 0.5,
    section: 'audio',
    tip: 'T60 at the lowest string (55 Hz), in seconds. Higher modes always die faster — the ring-length knob.',
  },
  {
    key: 'audioDrive',
    label: 'drive',
    min: 0,
    max: 1,
    step: 0.01,
    section: 'audio',
    tip: 'Strike force into the resonators. Per-mode caps bound runaway, so drive shapes the attack more than the loudness.',
  },
  {
    key: 'audioExciter',
    label: 'exciter',
    type: 'select',
    options: ['gated', 'continuous'],
    section: 'audio',
    tip: 'continuous drives the body always — that is the piece. gated opens a 60 ms window on onsets so the body is struck instead.',
  },
];

// --- Pure value helpers (shared with the panel harness) ---

export const decimals = (step) => {
  const s = String(step ?? 1);
  return s.includes('.') ? s.split('.')[1].length : 0;
};

const round = (v, d) => Number(v.toFixed(d));

// A typed number lands on the same grid the slider can produce, so field,
// slider and storage never disagree: clamp, snap to the step from `min`,
// clamp again (a max that is off-grid must still be reachable).
export function quantize(def, n) {
  const step = Number(def.step) || 1;
  const min = Number(def.min);
  const max = Number(def.max);
  const d = decimals(step);
  let v = Math.min(max, Math.max(min, n));
  v = min + Math.round((v - min) / step) * step;
  v = Math.min(max, Math.max(min, v));
  return round(v, d);
}

export const fmtNumber = (def, v) => Number(v).toFixed(decimals(def.step));

export const fmtValue = (def, v) => {
  if (def.type === 'toggle') return v ? 'on' : 'off';
  if (def.type === 'select') return String(v);
  return fmtNumber(def, v);
};

// A row's restore value resolves through the BASE preset first — the slot
// last loaded (A/B/C), or null when the base is "original" — then the code
// DEFAULTS. "original" is never stored, so the compiled DEFAULTS are always
// one click away (correction #8: edit DEFAULTS in source and the panel can
// still reach them). A partial preset falls through per key.
export function defaultFor(key, base) {
  if (base && Object.prototype.hasOwnProperty.call(base, key)) {
    return base[key];
  }
  return DEFAULTS[key];
}

// The preset slots, in display order. Stored together under `presets`
// ({A, B, C}, each a values object or null), with `presetBase` naming the
// last-loaded one — both outside DEFAULTS, so no content script sees them.
export const PRESET_SLOTS = ['A', 'B', 'C'];

// Keys a preset neither captures nor loads. The A/B is the comparison
// gesture, not part of a look: loading a preset (or "original") while the
// page is switched off must not switch it back on, and a save made mid-hold
// must not capture the bypass.
export const PRESET_EXCLUDED = ['enabled'];
