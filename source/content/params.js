// Single source of truth for effect parameters. chrome.storage.local holds
// the live values; the panel writes, every content script subscribes.

// Defaults = John's live-iterated settings (2026-08-11; sweet spot settled
// 2026-08-12). The piece rests on temporal feedback on VIDEOS — a fast
// decay (0.81) smearing through a half-blended FACET flow field (small
// slow swirls, every element seeded its own) — over straight-sorted image
// stills, with page-wide text scrambling ON (its minimum run length is a
// constant in text-scramble.js, not a knob — John, 2026-10-11), plus the
// audio smear. Images never animate (image feedback removed 2026-10-12, John).
export const DEFAULTS = {
  enabled: true,
  video: true,       // per-medium switches under the master (the panel's
  images: true,      // chips, 2026-10-12): off suspends that medium's jobs
                     // exactly as `enabled: false` does — originals shown
  feedbackVideo: true,  // temporal feedback on videos — the resting state
  threshold: 0.05,   // luma above this is eligible; near-zero = the whole
                     // frame sorts but true black holds as a barrier
  sortKey: 'luma',   // what decides which pixel climbs ("sort by", round 8):
                     // the ordering key only — the barrier stays on luma.
                     // See SORT_BY; 'luma' is the classic, bit for bit
  angle: 0,          // which way the sort climbs ("direction", round 8),
                     // degrees clockwise from up: 0 = the classic (bright
                     // to the top), 90 = right, 180 = down. Turns the flow's
                     // whole pattern too. 0–359, wrapping (the panel's knob)
  passes: 64,        // sort passes per frame (~3.5 cycles of a 256→1 ladder)
  streak: 256,       // max compare-exchange stride: longer = longer ribbons
  temperature: 0,    // fraction of pair-verdicts inverted per pass: the sort
                     // simmers at its equilibrium instead of settling into it
  motionGate: 0,     // feedback modes: a pair trades only when both members'
                     // motion trail clears this; 0 = sort regardless of motion
  flowAmount: 0.5,   // the resting state flows: half-blend toward the field
                     // (0 = classic vertical columns, 1 = full field)
  flowMode: 'facets', // John's resting pick: 8 fixed sectors, straight runs
                     // pooling at anchored seams · 'paths' = 16 dithered
                     // sectors, ribbons curve
  flowScale: 2.5,    // flow only: noise cells across the frame — bigger = tighter swirls
  flowSpeed: 0.045,  // flow only: how fast the field morphs; 0 = frozen streamlines
  decay: 0.81,       // feedback modes: accumulator retention per frame
  driftX: -0.0025,   // feedback modes: smear direction, UV units per frame
  driftY: 0.0020,    // feedback modes: positive = upward smear
  feedbackBlend: 'brighter', // feedback modes: how the trail meets the new
                     // frame (design review M5) · 'brighter' = max, the
                     // codec-faithful rule and the resting state · 'mix' =
                     // crossfade · 'screen' · 'add'. See FEEDBACK_BLENDS.
  feedbackMix: 1,    // feedback modes: how much of the trail survives against
                     // the new frame; 0 = every frame fresh, 1 = the full rule
  resetMinS: 30,     // feedback modes: accumulator "keyframe" reset window
  resetMaxS: 60,
  keyframe: 0,       // the clear-buffer trigger: a COUNTER, not a value. Each
                     // increment asks every video job to wipe its trail to a
                     // clean frame on its next tick (the reset the random
                     // clock above takes). Jobs remember the value they were
                     // built with, so a counter stored last session never
                     // fires on load. Presets never capture or load it.
  maxRes: 1920,      // processing resolution cap, long axis
  maxVideos: 12,     // concurrent video jobs, biggest visible first
  textScramble: true, // letters rearranged inside each word, page-wide —
                      // ON in the resting state (John's call, 2026-08-12).
                      // An on/off effect: the former textMin slider is gone
                      // (2026-10-11) and the reach is TEXT_MIN in the module.

  // --- audio (a process done to the audio, since 2026-08-13: both engines
  // sum their resonant part with the DIRECT signal, so the source passes
  // through the apparatus instead of merely driving it. Before that the
  // output never contained the input and every video sounded alike.) ---
  audioEnabled: true,
  audioMix: 1,       // wet/dry in the tap graph, not DSP
  audioBody: 'modal', // which apparatus: 'modal' = 48 stretched partials,
                      // struck metal · 'comb' = three recirculating lines,
                      // tube/pipe/spring. The A/B John called for.
  audioDirect: 1,    // direct signal level inside the DSP; 0 = the old
                     // synth-like behaviour, kept reachable for comparison
  audioBodyMix: 1,   // resonant part against the direct path — the identity
                     // dial: up for more fixed voice, down for more video
  audioFollow: 0,    // the source-following body (design review M8): how far
                     // the chord retunes toward the source's own pitch, 0–1.
                     // 0 = the fixed chord, bit-identical; the follower idles
  audioCombDamp: 0.45, // comb only: loop lowpass, metallic ↔ woody
  audioFeedback: true,  // echo/smear layer on the engine output (either mode)
  audioFbDecay: 0.999,  // smear TAIL only; maps to loop gain 0.5–0.95
  audioFbReturn: 0.25,  // how loud the wash sits, as a fraction of the loop
                        // gain. 1 = pre-2026-08-13, where the wash settled
                        // ~20× over the direct sound and buried the source.
  audioFbWobble: 0,     // delay wobble depth 0–0.4 (tape warble); 0 = static echo stack.
                        // Was coupled to driftY; detangled 2026-08-12 — audio knobs
                        // only, so performing the video never bends the sound.
  audioFbClear: false,  // the smear never clears by default: gain < 1 IS its decay
  audioFbClearS: 1,     // when clearing is on: fade the wash over ~this long; 0 = hard cut
  audioFbClearMinS: 1,  // when clearing is on: the smear's own keyframe window,
  audioFbClearMaxS: 60, // decoupled from the visual resetMinS/resetMaxS rhythm
  audioMaxTaps: 8,   // concurrent taps, most recently playing first
  audioSustain: 12,  // T60 at the lowest fundamental, seconds
  audioDrive: 1.0,   // drive into the resonators
  audioExciter: 'continuous', // 'continuous' drives always · 'gated' strikes on onsets
};

// The feedback blends, in the order of the composite shader's uBlend int.
export const FEEDBACK_BLENDS = ['brighter', 'mix', 'screen', 'add'];

// The sort keys, in the order of the sort shader's uKey int.
export const SORT_BY = ['luma', 'hue', 'saturation', 'red', 'green', 'blue'];
// A name onto the shader's int; anything unknown sorts by luma.
export const sortKeyIndex = (name) => Math.max(0, SORT_BY.indexOf(name));

// The stored direction (degrees) onto the shader's radians.
export const angleRadians = (deg) => ((Number(deg) || 0) * Math.PI) / 180;

export async function loadParams() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
}

export function onParamsChanged(callback) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const next = {};
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in DEFAULTS) next[key] = newValue;
    }
    if (Object.keys(next).length > 0) callback(next);
  });
}
