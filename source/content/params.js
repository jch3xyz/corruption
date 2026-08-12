// Single source of truth for effect parameters. chrome.storage.local holds
// the live values; the panel writes, every content script subscribes.

// Defaults = John's live-iterated settings, 2026-08-11. The piece rests on
// straight visual sorting + the audio smear; visual temporal feedback is a
// toggle whose values below are live-tuned for when it's on.
export const DEFAULTS = {
  enabled: true,
  feedback: false,   // off = straight per-frame pixel sorting (the resting state)
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

  // --- audio (the body engine — bake-off verdict; timebase at tag audio-bakeoff) ---
  audioEnabled: true,
  audioMix: 1,       // wet/dry in the tap graph, not DSP
  audioFeedback: true,  // echo/smear layer on the engine output (either mode)
  audioFbDecay: 0.999,  // smear retention; maps to feedback gain 0.5–0.95
  audioFbClear: false,  // the smear never clears by default: gain < 1 IS its decay
  audioFbClearS: 1,     // when clearing is on: fade the wash over ~this long; 0 = hard cut
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
