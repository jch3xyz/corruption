// The panel's control table: which knob, what range, which section, and the
// hover copy for every one of them. Kept apart from panel.js so the panel
// harness can import the definitions and the pure value helpers without
// booting the UI.
//
// Section membership is John's call (2026-08-20): the sort knobs that video
// and images genuinely SHARE live under Video — so their tooltips say so
// rather than the layout lying about it. The Images section went with image
// feedback (removed 2026-10-12, John): stills have no knobs of their own.
// `enabled`, `video`, `images`, `textScramble` and `audioEnabled` belong to
// no section: they are the global block above the first divider — the A/B
// (`enabled`) and the four medium chips, which are the only face of their
// keys (since 2026-10-11; before that text and audio also had a row in their
// section). Text is an on/off effect with no knobs — its slider went with its
// section (John, 2026-10-11) — so the sections are Video and Audio.

import { DEFAULTS } from '../content/params.js';

export const SECTIONS = [
  {
    id: 'video',
    title: 'Video',
    tip: 'Videos, and the sorting they share with images. Sort is what you see, Feedback is the trail it leaves, Engine is setup and stays folded away. Still images take every sort knob; feedback and the engine’s max videos are video only.',
  },
  {
    id: 'audio',
    title: 'Audio',
    tip: 'Sound: a process done to the audio, not a synth the audio drives. The source passes through a fixed resonant body, then a long smear. The line beneath says what is passing through right now.',
  },
];

// Groups inside a section (design review M4/M8, 2026-10-12): effect, effect,
// engine. A row names its group with `group`; rows without one (the audio
// master, the text rows) sit directly under the section header, above any
// group. An `engine` group is folded away behind a disclosure; its open
// state is panel furniture (storage key `engineOpen`), not a parameter.
export const GROUPS = [
  {
    id: 'sort',
    section: 'video',
    title: 'sort',
    tip: 'The visible effect: bright runs of the picture rearranged into ribbons. These knobs shape where and how — and they shape every image too.',
  },
  {
    id: 'feedback',
    section: 'video',
    title: 'feedback',
    tip: 'The trail: each frame laid over the last, so damage builds, drifts and fades, then wipes clean at slow random moments. Video only.',
  },
  {
    id: 'engine',
    section: 'video',
    title: 'engine',
    collapsible: true,
    tip: 'Setup rather than look: how hard the sort works, at what detail, on how many videos. Folded away until you open it.',
  },
  {
    id: 'body',
    section: 'audio',
    title: 'body',
    tip: 'The apparatus: a fixed resonant object every sound passes through and rings. Mix sets how much of the process you hear at all; body amount is the identity dial.',
  },
  {
    id: 'smear',
    section: 'audio',
    title: 'smear',
    tip: 'A long echo wash laid over the body. Its own switch, then how long it hangs, how loud it sits and how much it warbles.',
  },
  {
    id: 'engine',
    section: 'audio',
    title: 'engine',
    collapsible: true,
    tip: 'Setup rather than sound: the dry source inside the process, how many sources, how the body is driven, and whether the smear ever wipes itself. Folded away until you open it.',
  },
];

// Appended under every parameter's tooltip — the two gestures that are not
// discoverable from looking at the row.
export const ROW_HINT = 'Double-click the name to put it back to the marked preset.';
export const NUM_HINT = 'Type + Enter; ↑/↓ steps (shift ×10); out of range clamps.';

// Labels are the player's words (synth vocabulary: wet/dry, decay, gate,
// ring time); keys are the machine's and never change — storage, MIDI maps
// and parameters.md all speak in keys, and every tooltip ends with its key.
// Tips lead with what you see or hear, then the author's precise sentence.
// Order here is render order within each section and group.
export const DEFS = [
  {
    key: 'enabled',
    label: 'enabled',
    type: 'toggle',
    tip: 'The A/B: the whole piece on or off — video, images, text and sound. Click to latch. Press and hold past half a second to see and hear the page untouched for as long as you hold; let go and the bending comes back. Ctrl+Shift+D flips it from any page without the panel.',
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

  // --- Video · sort ---
  {
    key: 'threshold',
    label: 'threshold',
    min: 0,
    max: 1,
    step: 0.01,
    section: 'video',
    group: 'sort',
    ends: ['more', 'less'],
    tip: 'Lower = more of the picture is sorted. 0 tears everything but true black; 1 leaves it untouched. The most expressive knob. Brighter pixels may move; darker ones hold as barriers. Shapes images too.',
  },
  {
    key: 'flowAmount',
    label: 'flow',
    min: 0,
    max: 1,
    step: 0.01,
    section: 'video',
    group: 'sort',
    tip: 'How much the ribbons wander. 0 = straight vertical climbs; up = they curl along a slowly changing current. Sorting follows a morphing curl-noise field, and every video and image draws its own. Shapes images too.',
  },
  {
    key: 'flowMode',
    label: 'flow mode',
    type: 'select',
    options: ['paths', 'facets'],
    section: 'video',
    group: 'sort',
    tip: 'The shape of the current. facets = straight runs pooling at fixed seams; paths = ribbons that round their curves. facets uses 8 fixed directions; paths uses 16 with a boundary that dithers every pass.',
  },
  {
    key: 'flowScale',
    label: 'flow scale',
    min: 1,
    max: 12,
    step: 0.5,
    section: 'video',
    group: 'sort',
    tip: 'Size of the swirls. Higher = tighter and busier; lower = broad sweeping currents. Counts noise cells across the frame.',
  },
  {
    key: 'flowSpeed',
    label: 'flow speed',
    min: 0,
    max: 0.2,
    step: 0.005,
    section: 'video',
    group: 'sort',
    tip: 'How fast the current changes. 0 = frozen shapes. The field re-forms in place rather than marching across the frame.',
  },
  {
    key: 'temperature',
    label: 'jitter',
    min: 0,
    max: 0.5,
    step: 0.005,
    section: 'video',
    group: 'sort',
    tip: 'Random swaps on top of the sort. 0 = clean ribbons; up = grain and shimmer. A fraction of each pass’s decisions is flipped, so ribbons boil at their edges and never settle; dark barriers still hold. Shapes images too.',
  },

  // --- Video · feedback ---
  {
    key: 'feedbackVideo',
    label: 'feedback',
    type: 'toggle',
    section: 'video',
    group: 'feedback',
    tip: 'A trail: each frame is laid over the last, so damage builds up, drifts and fades. Off = every frame sorted fresh. The trail wipes to a clean frame at a random moment between clear min s and clear max s.',
  },
  {
    key: 'motionGate',
    label: 'motion gate',
    min: 0,
    max: 1,
    step: 0.01,
    section: 'video',
    group: 'feedback',
    tip: 'Only moving parts get sorted. 0 = everything; 1 = only what moves. A wet/dry for motion. Pixels trade only where the motion trail clears this, so action smears and stillness heals. Reads the feedback trail.',
  },
  {
    key: 'decay',
    label: 'decay',
    min: 0.8,
    max: 0.999,
    step: 0.001,
    section: 'video',
    group: 'feedback',
    tip: 'How long the trail lingers. Up = longer. How much of the trail each frame keeps.',
  },
  {
    key: 'driftX',
    label: 'drift x',
    min: -0.01,
    max: 0.01,
    step: 0.0005,
    section: 'video',
    group: 'feedback',
    tip: 'The trail slides sideways. Negative = left, positive = right. Measured in fractions of the frame per frame.',
  },
  {
    key: 'driftY',
    label: 'drift y',
    min: -0.01,
    max: 0.01,
    step: 0.0005,
    section: 'video',
    group: 'feedback',
    tip: 'The trail slides up or down. Positive = up; the resting state climbs gently. Fractions of the frame per frame, picture only — it never moves the sound.',
  },
  {
    key: 'resetMinS',
    label: 'clear min s',
    min: 1,
    max: 30,
    step: 1,
    section: 'video',
    group: 'feedback',
    tip: 'Shortest wait, in seconds, before the trail wipes clean. It clears at a random moment between clear min s and clear max s.',
  },
  {
    key: 'resetMaxS',
    label: 'clear max s',
    min: 2,
    max: 60,
    step: 1,
    section: 'video',
    group: 'feedback',
    tip: 'Longest wait, in seconds, before the trail wipes clean. Slow by default: damage builds for half a minute or more before it clears.',
  },

  // --- Video · engine ---
  {
    key: 'passes',
    label: 'sort passes',
    min: 0,
    max: 64,
    step: 1,
    section: 'video',
    group: 'engine',
    tip: 'How settled the ribbons get each frame. Fewer = rough and half-formed; more = fully sorted, at more cost to the graphics card. 18 passes complete one full cycle; 64 run about three and a half. Shapes images too.',
  },
  {
    key: 'streak',
    label: 'streak',
    min: 1,
    max: 256,
    step: 1,
    section: 'video',
    group: 'engine',
    tip: 'Ribbon length: how far a pixel can travel in one frame. Short = fine grain; long = streaks across the frame. The longest swap distance, rounded down to a power of two. Shapes images too.',
  },
  {
    key: 'maxRes',
    label: 'max res',
    min: 480,
    max: 1920,
    step: 160,
    section: 'video',
    group: 'engine',
    tip: 'The detail the sort works at. Lower it if video stutters; the result is scaled back up to fit. A cap in pixels on the long side. Shapes images too.',
  },
  {
    key: 'maxVideos',
    label: 'max videos',
    min: 1,
    max: 16,
    step: 1,
    section: 'video',
    group: 'engine',
    tip: 'How many videos bend at once, biggest on screen first; the rest play untouched. Paused videos count, and each gets one sorted still.',
  },

  {
    key: 'textScramble',
    label: 'text',
    type: 'toggle',
    tip: 'Text on/off. Letters rearrange inside their own word, page-wide; anything that is not a letter — space, punctuation, digit, emoji — is a barrier no glyph crosses, so every word keeps its length and the page keeps its shape. Runs shorter than eight characters are left alone, so the shortest furniture (Home, OK) survives.',
  },
  {
    key: 'audioEnabled',
    label: 'audio',
    type: 'toggle',
    tip: 'Sound on/off. Off = every source plays exactly as it arrived. The Audio section below shapes it. The tap on each source stays in place by design; off routes it around the process.',
  },

  // --- Audio · body (the level first: mix, then the apparatus) ---
  {
    key: 'audioMix',
    label: 'mix',
    min: 0,
    max: 1,
    step: 0.01,
    section: 'audio',
    group: 'body',
    tip: 'Wet/dry for the whole sound. 0 = the sound exactly as transmitted, 1 = all apparatus. Applied after everything else, on 30 ms ramps — unlike dry (under engine), which lives inside the process.',
  },
  {
    key: 'audioBodyMix',
    label: 'body amount',
    min: 0,
    max: 2,
    step: 0.01,
    section: 'audio',
    group: 'body',
    tip: 'How much of the resonant body you hear against the source. 0 = source only, 2 = all body. The identity dial: up for more of the fixed voice, down for more of the video.',
  },
  {
    key: 'audioBody',
    label: 'body type',
    type: 'select',
    options: ['modal', 'comb'],
    section: 'audio',
    group: 'body',
    tip: 'What the sound rings through. modal = struck metal; comb = tube, pipe or spring. modal is 48 slightly stretched partials; comb is three exactly harmonic delay loops at about a tenth of the cost.',
  },
  {
    key: 'audioSustain',
    label: 'ring time',
    min: 2,
    max: 12,
    step: 0.5,
    section: 'audio',
    group: 'body',
    tip: 'How long the body rings after a sound strikes it. Up = longer. Seconds for the lowest note (55 Hz) to fall away by 60 dB; higher notes always die faster.',
  },
  {
    key: 'audioDrive',
    label: 'drive',
    min: 0,
    max: 1,
    step: 0.01,
    section: 'audio',
    group: 'body',
    tip: 'How hard the sound strikes the body. Shapes the attack more than the loudness, because every partial is capped.',
  },

  // --- Audio · smear ---
  {
    key: 'audioFeedback',
    label: 'smear',
    type: 'toggle',
    section: 'audio',
    group: 'smear',
    tip: 'A long echo wash over the body. Off = the body alone. The output recirculates through a 0.35 s delay line, continuously.',
  },
  {
    key: 'audioFbDecay',
    label: 'tail',
    min: 0.8,
    max: 0.999,
    step: 0.001,
    section: 'audio',
    group: 'smear',
    tip: 'How long the wash hangs on. Up = longer — tens of seconds at the top. Tail length only, over the same range as the picture’s decay, so the two feel alike.',
  },
  {
    key: 'audioFbReturn',
    label: 'return',
    min: 0,
    max: 1,
    step: 0.01,
    section: 'audio',
    group: 'smear',
    tip: 'How loud the wash sits under the sound. Up = the wash takes over. A fraction of the loop gain, kept apart from tail on purpose: at 1 the wash settles about twenty times over the sound and buries it.',
  },
  {
    key: 'audioFbWobble',
    label: 'wobble',
    min: 0,
    max: 0.4,
    step: 0.005,
    section: 'audio',
    group: 'smear',
    tip: 'Tape warble on the echoes. 0 = a steady wash, the resting state. Depth of the delay-time wobble; no picture knob ever moves it.',
  },

  // --- Audio · engine ---
  {
    key: 'audioDirect',
    label: 'dry',
    min: 0,
    max: 1,
    step: 0.01,
    section: 'audio',
    group: 'engine',
    tip: 'The untouched source mixed back in. Up = intelligible again, which defeats the piece; kept for comparison. The source’s level inside the process, summed with the body; 0 = only the body is heard, struck by the source.',
  },
  {
    key: 'audioMaxTaps',
    label: 'max sources',
    min: 1,
    max: 8,
    step: 1,
    section: 'audio',
    group: 'engine',
    tip: 'How many sources sound through the body at once, most recently started first; beyond that they play untouched. Each one is its own processor.',
  },
  {
    key: 'audioExciter',
    label: 'exciter',
    type: 'select',
    options: ['gated', 'continuous'],
    section: 'audio',
    group: 'engine',
    tip: 'How the sound reaches the body. continuous = it drives the body all the time — the piece. gated = only onsets strike it, through a 60 ms window.',
  },
  {
    key: 'audioCombDamp',
    label: 'comb damp',
    min: 0,
    max: 0.9,
    step: 0.01,
    section: 'audio',
    group: 'engine',
    tip: 'Brightness of the comb body. Low = metallic and bright; high = woody and dark. A lowpass inside each loop, so higher partials die faster. Comb only.',
  },
  {
    key: 'audioFbClear',
    label: 'smear clear',
    type: 'toggle',
    section: 'audio',
    group: 'engine',
    tip: 'Whether the wash wipes itself clean now and then. Off is the piece: the wash already fades on its own. On = it clears at a random moment between clear min s and clear max s.',
  },
  {
    key: 'audioFbClearS',
    label: 'clear fade s',
    min: 0,
    max: 4,
    step: 0.1,
    section: 'audio',
    group: 'engine',
    tip: 'How long, in seconds, the wash fades before it wipes. 0 = a hard cut. The picture’s own clear is always a hard cut, by design.',
  },
  {
    key: 'audioFbClearMinS',
    label: 'clear min s',
    min: 1,
    max: 30,
    step: 1,
    section: 'audio',
    group: 'engine',
    tip: 'Shortest wait, in seconds, before the wash wipes clean. Its own rhythm, separate from the picture’s.',
  },
  {
    key: 'audioFbClearMaxS',
    label: 'clear max s',
    min: 2,
    max: 60,
    step: 1,
    section: 'audio',
    group: 'engine',
    tip: 'Longest wait, in seconds, before the wash wipes clean. Its own rhythm, separate from the picture’s.',
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
// last loaded (A/B/C), or null when the base is "default" — then the code
// DEFAULTS. "default" is never stored, so the compiled DEFAULTS are always
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
// gesture, not part of a look: loading a preset (or "default") while the
// page is switched off must not switch it back on, and a save made mid-hold
// must not capture the bypass.
export const PRESET_EXCLUDED = ['enabled'];

// Where the panel lives (design review M9): a panel preference, not a
// parameter — stored as `panelHome` beside `tooltips`, outside DEFAULTS, so
// no content script's param filter ever sees it. The service worker reads it
// to decide what the toolbar icon and Ctrl+Shift+P open; the content script
// reads it to decide whether to put the strip on the page. A change applies
// on the next open: a live panel is never moved out from under the player.
export const PANEL_HOME = {
  key: 'panelHome',
  label: 'panel lives in',
  default: 'window',
  options: [
    ['window', 'window'],
    ['side', 'side panel'],
    ['strip', 'bottom strip'],
  ],
  tip: 'Where this panel opens: its own window, docked in Chrome’s side panel, or a mixer strip along the bottom of every page (collapse it to a tab with a click or Ctrl+Shift+P). Takes effect the next time the panel opens.',
  hint: 'A panel preference, not a parameter of the piece — the panel you are using stays where it is.',
};
export const PANEL_HOMES = PANEL_HOME.options.map(([value]) => value);
