// Single source of truth for effect parameters. chrome.storage.local holds
// the live values; the panel writes, every content script subscribes.

export const DEFAULTS = {
  enabled: true,
  threshold: 0.55,   // luma above this is eligible for sorting/feedback
  decay: 0.96,       // accumulator retention per frame
  driftX: 0.0,       // smear direction, UV units per frame
  driftY: 0.0015,    // positive = upward smear (texture v grows downward)
  passes: 4,         // odd-even transposition passes per frame
  resetMinS: 4,      // accumulator "keyframe" reset window
  resetMaxS: 10,
  maxRes: 1920,      // processing resolution cap, long axis
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
