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

// The bottom strip (design review M9): the panel's in-page home, top frame
// only, independent of `enabled` — the panel has to be there to switch the
// piece back on. Loaded lazily and fenced off: any failure leaves the page
// exactly as it was and the panel reachable through its window. An
// extension reloaded under the page leaves this context without a runtime
// id, and the import would only throw (bootstrap.js says why): skip it.
if (isTopFrame && globalThis.chrome?.runtime?.id) {
  import('./strip.js')
    .then((m) => m.initStrip())
    .catch((err) => console.warn('[DEFLECTION] strip unavailable', err));
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
    registry.paramsChanged(next);
  });

  // Inspectable from the extension's isolated world in DevTools.
  self.__deflection = { params, registry };

  reportStats(registry);
}

// The panel's audio status line (design review finding 7): this frame's
// audio counts go to the service worker on change, and every ~2 s while
// there are taps, so a frame that disappears goes stale there. Fire and
// forget; any failure — no runtime, the extension reloaded under the page —
// stops the reporter and touches nothing else.
const STATS_TYPE = 'deflection:stats';
const STATS_TICK_MS = 1000;
const STATS_REPEAT_MS = 2000;

function reportStats(registry) {
  const runtime = globalThis.chrome?.runtime;
  if (!runtime?.sendMessage) return;
  let last = '0/0'; // a frame with no media never posts at all
  let lastAt = 0;
  const timer = setInterval(() => {
    try {
      if (!runtime.id) throw new Error('context invalidated');
      const { taps, engaged } = registry.stats().audio;
      const sig = `${taps}/${engaged}`;
      const now = Date.now();
      if (sig === last && !(taps > 0 && now - lastAt >= STATS_REPEAT_MS)) return;
      last = sig;
      lastAt = now;
      const sent = runtime.sendMessage({ type: STATS_TYPE, op: 'put', audio: { taps, engaged } });
      sent?.catch?.(() => {});
    } catch {
      clearInterval(timer);
    }
  }, STATS_TICK_MS);
}
