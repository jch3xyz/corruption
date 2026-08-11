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
  audioEnabled: true,      // master switch for the audio pipeline
  audioAlgorithm: 'spectral', // 'spectral' | 'granular'
  audioMix: 1,             // wet/dry; mid values read as echo under granular latency
  audioThreshold: 0,       // normalized RMS/magnitude gate; 0 = everything participates
  audioSortPasses: 8,      // stride-ladder passes (grains or spectral bins)
  audioGrainMs: 60,        // granular: grain length
  audioWindowS: 1,         // granular: sort window = added latency (seconds)
  audioMaxTaps: 4,         // concurrent engaged audio taps
  imageFps: 12,      // animated image tick rate
  imageAnimCap: 12,  // max concurrently animated images
  textSwap: false,
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
