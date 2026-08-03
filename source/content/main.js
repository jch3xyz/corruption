// Orchestrator. Phase 0: prove the plumbing — module load, params, frame
// gating — with a boot log. Registry/observers/jobs arrive in Phase 1.

import { loadParams, onParamsChanged } from './params.js';

const isTopFrame = window === window.top;

// Ad-sized and invisible iframes are never worth instrumenting. A sweep can
// still promote a frame later if real media shows up; for now, just bail.
const MIN_FRAME_W = 200;
const MIN_FRAME_H = 150;
if (!isTopFrame && (innerWidth < MIN_FRAME_W || innerHeight < MIN_FRAME_H)) {
  // Intentionally silent — tiny frames are the common case on ad-heavy pages.
} else {
  boot();
}

async function boot() {
  const params = await loadParams();

  console.log(
    '[DEFLECTION] boot',
    JSON.stringify({
      url: location.href.slice(0, 120),
      topFrame: isTopFrame,
      viewport: `${innerWidth}x${innerHeight}`,
      enabled: params.enabled,
    })
  );

  onParamsChanged((next) => {
    Object.assign(params, next);
    console.log('[DEFLECTION] params changed', JSON.stringify(next));
  });
}
