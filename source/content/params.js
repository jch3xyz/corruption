// Single source of truth for effect parameters. chrome.storage.local holds
// the live values; the panel writes, every content script subscribes.

// Defaults = John's live-iterated settings, 2026-08-11: temporal feedback ON
// is the piece now (it had been the toggle; straight sorting is now the
// toggle-off state).
export const DEFAULTS = {
  enabled: true,
  feedback: true,    // ON is the piece; off = straight per-frame pixel sorting
  threshold: 0,      // luma above this is eligible; 0 = the whole frame sorts
  passes: 64,        // sort passes per frame (~3.5 cycles of a 256→1 ladder)
  streak: 256,       // max compare-exchange stride: longer = longer ribbons
  decay: 0.906,      // feedback only: accumulator retention per frame
  driftX: -0.0025,   // feedback only: smear direction, UV units per frame
  driftY: 0,         // feedback only: 0 = purely horizontal drift (and no smear wobble)
  resetMinS: 1,      // feedback only: accumulator "keyframe" reset window
  resetMaxS: 60,
  maxRes: 1920,      // processing resolution cap, long axis
  maxVideos: 8,      // concurrent video jobs, biggest visible first
  imageFps: 6,       // animated image tick rate
  imageAnimCap: 12,  // max concurrently animated images
  textSwap: false,

  // --- audio (two engines under live A/B; the loser is removed) ---
  audioEnabled: true,
  audioMode: 'body', // 'body' = struck resonant body · 'timebase' = bent clock
  audioMix: 1,       // wet/dry in the tap graph, not DSP
  audioFeedback: true,  // echo/smear layer on the engine output (either mode)
  audioFbDecay: 0.999,  // smear retention; maps to feedback gain 0.5–0.95
  audioFbClear: false,  // the smear never clears by default: gain < 1 IS its decay
  audioFbClearS: 1,     // when clearing is on: fade the wash over ~this long; 0 = hard cut
  audioMaxTaps: 8,   // concurrent taps, most recently playing first
  audioSustain: 12,  // body: T60 at the lowest fundamental, seconds
  audioDrive: 1.0,   // body: strike force into the resonators
  audioExciter: 'continuous', // 'continuous' drives always · 'gated' strikes on onsets
  audioDepth: 0.8,   // timebase: lag bend, octaves of the field's swing
  audioFieldRate: 1, // timebase: deflection field speed multiplier
  audioTail: 1.5,    // timebase: seconds the heads may speak after input stops
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
