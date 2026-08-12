// Single source of truth for effect parameters. chrome.storage.local holds
// the live values; the panel writes, every content script subscribes.

// Defaults = John's live-iterated settings (2026-08-11; sweet spot settled
// 2026-08-12). The piece rests on temporal feedback on VIDEOS — a fast
// decay (0.81) smearing through a half-blended FACET flow field (small
// slow swirls, every element seeded its own) — over straight-sorted image
// stills, with page-wide text scrambling ON at textMin 8, plus the audio
// smear. The two visual feedback toggles share every shaping knob below.
export const DEFAULTS = {
  enabled: true,
  feedbackVideo: true,  // temporal feedback on videos — the resting state
  feedbackImage: false, // temporal feedback animates images; off = one-shot stills
  threshold: 0.05,   // luma above this is eligible; near-zero = the whole
                     // frame sorts but true black holds as a barrier
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
  resetMinS: 30,     // feedback modes: accumulator "keyframe" reset window
  resetMaxS: 60,
  maxRes: 1920,      // processing resolution cap, long axis
  maxVideos: 12,     // concurrent video jobs, biggest visible first
  imageFps: 6,       // animated image tick rate
  imageAnimCap: 12,  // max concurrently animated images
  textScramble: true, // letters rearranged inside each word, page-wide —
                      // ON in the resting state (John's call, 2026-08-12)
  textMin: 8,        // shortest run of text that scrambles; short labels survive

  // --- audio (the body engine — bake-off verdict; timebase at tag audio-bakeoff) ---
  audioEnabled: true,
  audioMix: 1,       // wet/dry in the tap graph, not DSP
  audioFeedback: true,  // echo/smear layer on the engine output (either mode)
  audioFbDecay: 0.999,  // smear retention; maps to feedback gain 0.5–0.95
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
