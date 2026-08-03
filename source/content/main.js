// Orchestrator. Phase 1: params + registry driving per-video 2D mirror
// jobs. The GL pipeline replaces the mirror in Phase 2.

import { loadParams, onParamsChanged } from './params.js';
import { Registry } from './registry.js';

const isTopFrame = window === window.top;

// Ad-sized and invisible iframes are never worth instrumenting.
const MIN_FRAME_W = 200;
const MIN_FRAME_H = 150;

if (isTopFrame || (innerWidth >= MIN_FRAME_W && innerHeight >= MIN_FRAME_H)) {
  boot();
}

async function boot() {
  const params = await loadParams();
  const registry = new Registry(params);
  registry.start();

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
    registry.refresh();
  });

  // Inspectable from the extension's isolated world in DevTools.
  self.__deflection = { params, registry };
}
