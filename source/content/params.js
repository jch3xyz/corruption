// Single source of truth for effect parameters. chrome.storage.local holds
// the live values; the panel writes, every content script subscribes.

export const DEFAULTS = {
  enabled: true,
  feedback: false,   // off = straight per-frame pixel sorting; on = temporal feedback
  threshold: 0,      // luma above this is eligible; 0 = the whole frame sorts
  passes: 64,        // sort passes per frame (~3.5 cycles of a 256→1 ladder)
  streak: 256,       // max compare-exchange stride: longer = longer ribbons
  decay: 0.96,       // feedback only: accumulator retention per frame
  driftX: 0.0,       // feedback only: smear direction, UV units per frame
  driftY: 0.0015,    // feedback only: positive = upward smear
  resetMinS: 4,      // feedback only: accumulator "keyframe" reset window
  resetMaxS: 10,
  maxRes: 1920,      // processing resolution cap, long axis
  maxVideos: 8,      // concurrent video jobs, biggest visible first
  imageFps: 12,      // animated image tick rate
  imageAnimCap: 12,  // max concurrently animated images
  textSwap: false,

  // --- audio (two engines under live A/B; the loser is removed) ---
  audioEnabled: true,
  audioMode: 'body', // 'body' = struck resonant body · 'timebase' = bent clock
  audioMix: 1,       // wet/dry in the tap graph, not DSP
  audioFeedback: false, // echo/smear layer on the engine output (either mode)
  audioFbDecay: 0.96,   // smear retention; maps to feedback gain 0.5–0.95
  audioFbClearS: 1,     // keyframe clears fade the wash over ~this long; 0 = hard cut
  audioMaxTaps: 4,   // concurrent taps, most recently playing first
  audioSustain: 6,   // body: T60 at the lowest fundamental, seconds
  audioDrive: 0.5,   // body: strike force into the resonators
  audioExciter: 'gated', // body: 'gated' strikes on onsets · 'continuous' drives always
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
