// Phase 1 harness: drives Registry/VideoJob/Overlay with captureStream
// videos (real decoded frames, real rVFC) and asserts lifecycle behavior.
// No extension loading required — these modules are chrome-free.
//
// Run: python3 -m http.server 8437  (from the repo root)
// then open http://localhost:8437/test/harness/index.html
// The page must stay visible: a hidden tab stops rendering, which stops
// frames, rVFC, and IntersectionObserver, and tests will time out.
import { Registry } from '../../source/content/registry.js';
import { DEFAULTS } from '../../source/content/params.js';

const status = document.getElementById('status');
let passCount = 0;
let failCount = 0;

function line(text, cls) {
  const div = document.createElement('div');
  if (cls) div.className = cls;
  div.textContent = text;
  status.appendChild(div);
}

function check(name, ok) {
  line(`${ok ? 'PASS' : 'FAIL'}: ${name}`, ok ? 'pass' : 'fail');
  ok ? passCount++ : failCount++;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 8000, step = 100) {
  const t0 = performance.now();
  for (;;) {
    try {
      if (fn()) return true;
    } catch {
      /* condition not ready yet */
    }
    if (performance.now() - t0 >= timeout) return false;
    await sleep(step);
  }
}

document.addEventListener('visibilitychange', () => {
  line(`note: page became ${document.visibilityState}`, '');
});

function makeVideo(label, hue) {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 180;
  const ctx = c.getContext('2d');
  let t = 0;
  setInterval(() => {
    t++;
    ctx.fillStyle = `hsl(${hue} 60% 22%)`;
    ctx.fillRect(0, 0, 320, 180);
    ctx.fillStyle = `hsl(${hue} 90% 60%)`;
    ctx.fillRect((t * 3) % 320, 20, 40, 120);
    ctx.fillStyle = '#fff';
    ctx.font = '20px monospace';
    ctx.fillText(label, 10, 170);
  }, 33);
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.srcObject = c.captureStream(30);
  v.play();
  return v;
}

async function run() {
  // Boot the registry FIRST so all videos arrive via MutationObserver.
  // feedback:true so the trail test exercises the temporal path; a later
  // check flips it off and asserts straight sorting leaves no trail.
  // maxVideos pinned to 4 so the cap/promotion tests stay meaningful.
  const params = { ...DEFAULTS, enabled: true, feedback: true, maxVideos: 4 };
  const registry = new Registry(params);
  registry.start();
  window.__deflection = { params, registry };

  const activeJobs = () =>
    [...registry.jobs.values()].filter((j) => j.active && j.kind !== 'image');

  // 6 visible videos (one with a 4:3 box to test object-fit letterboxing),
  // 1 offscreen video far below the fold.
  const grid = document.getElementById('grid');
  const videos = [];
  for (let i = 0; i < 6; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    const v = makeVideo(`v${i}`, i * 55);
    if (i === 3) v.style.height = '240px'; // 16:9 source in 4:3 box → letterbox
    cell.appendChild(v);
    grid.appendChild(cell);
    videos.push(v);
  }
  const far = makeVideo('far', 300);
  document.getElementById('farcell').appendChild(far);

  // --- Discovery, cap, mirroring ---
  check(
    'MutationObserver discovered all 7 videos',
    await waitFor(() => registry.stats().tracked === 7)
  );
  check(
    'active capped at 4',
    await waitFor(() => registry.stats().active === 4)
  );
  check(
    '4 overlay canvases in DOM',
    await waitFor(() => document.querySelectorAll('canvas[data-deflection]').length === 4)
  );
  check(
    'active videos mirrored and hidden (opacity 0)',
    await waitFor(() =>
      activeJobs().length === 4 &&
      activeJobs().every((j) => j.mirrored && j.video.style.opacity === '0')
    )
  );
  check(
    'mirror pixels actually drawn',
    await waitFor(() =>
      activeJobs().every((j) => {
        const c = j.overlay.canvas;
        const px = j.ctx.getImageData(
          Math.floor(c.width / 2),
          Math.floor(c.height / 2),
          1,
          1
        ).data;
        return px[3] > 0 && px[0] + px[1] + px[2] > 0;
      })
    )
  );
  check(
    'offscreen video untouched',
    !registry.jobs.get(far).active && far.style.opacity !== '0'
  );

  // --- Temporal feedback (Phase 3): the moving bright bar leaves a
  // decaying trail, so a row through the bar carries far more bright
  // pixels than the bar's own ~40px width. v1 (hue 55, yellow) sits well
  // above the default luma threshold; its background sits below it.
  const brightRowCount = () => {
    const j = registry.jobs.get(videos[1]);
    if (!j?.active || !j.mirrored) return -1;
    const c = j.overlay.canvas;
    const d = j.ctx.getImageData(0, Math.floor(c.height / 3), c.width, 1).data;
    let bright = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 100 || d[i + 1] > 100 || d[i + 2] > 100) bright++;
    }
    return bright;
  };
  check(
    'temporal feedback leaves trails',
    await waitFor(() => brightRowCount() > 55)
  );

  // Straight-sort mode: no history, so the trail must vanish and the row
  // returns to roughly the bar's own width. (The bar is uniform brightness,
  // so sorting it is invisible — this isolates the absence of feedback.)
  params.feedback = false;
  check(
    'straight sort mode leaves no trail',
    await waitFor(() => {
      const n = brightRowCount();
      return n > 20 && n < 55;
    })
  );
  params.feedback = true;

  // --- Images (Phase 4): route resolution + sorted stills ---
  // Direct route: a data-URL image (origin-clean by definition).
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = 240;
  srcCanvas.height = 160;
  const sctx = srcCanvas.getContext('2d');
  sctx.fillStyle = '#1c1c22';
  sctx.fillRect(0, 0, 240, 160);
  for (let i = 0; i < 12; i++) {
    sctx.fillStyle = `hsl(${i * 30} 90% 65%)`;
    sctx.fillRect(10 + i * 19, 20 + (i % 4) * 30, 12, 60);
  }
  const sameImg = document.createElement('img');
  sameImg.src = srcCanvas.toDataURL('image/png');
  sameImg.style.width = '240px';
  const sameCell = document.createElement('div');
  sameCell.className = 'cell';
  sameCell.appendChild(sameImg);
  grid.appendChild(sameCell);

  // Tiny image: must never get a job.
  const tinyImg = document.createElement('img');
  tinyImg.src = srcCanvas.toDataURL('image/png');
  tinyImg.style.width = '24px';
  tinyImg.style.height = '24px';
  grid.appendChild(tinyImg);

  check(
    'same-origin image sorted via direct route',
    await waitFor(() => {
      const j = registry.jobs.get(sameImg);
      if (!j?.mirrored || j.route !== 'direct') return false;
      const c = j.overlay.canvas;
      const d = j.ctx.getImageData((c.width / 2) | 0, (c.height / 2) | 0, 1, 1).data;
      return d[3] > 0;
    })
  );
  check('route counter: direct >= 1', registry.stats().images.direct >= 1);
  check(
    'tiny image ignored',
    await waitFor(() => !registry.jobs.has(tinyImg) && registry.jobs.has(sameImg))
  );

  // CORS route: same file served from another port = cross-origin. Needs a
  // second dev server: python3 test/serve.py 8439 (it sends ACAO like the
  // extension's DNR rule does). Skipped gracefully when it isn't running.
  let xoUp = false;
  try {
    await fetch('http://localhost:8439/source/manifest.json', { method: 'HEAD' });
    xoUp = true;
  } catch {
    line('note: :8439 not running — skipping cross-origin image route test');
  }
  if (xoUp) {
    const xoImg = document.createElement('img');
    xoImg.src = 'http://localhost:8439/source/icons/icon128.png';
    xoImg.style.width = '128px';
    const xoCell = document.createElement('div');
    xoCell.className = 'cell';
    xoCell.appendChild(xoImg);
    grid.appendChild(xoCell);
    check(
      'cross-origin image sorted via CORS route',
      await waitFor(() => {
        const j = registry.jobs.get(xoImg);
        return !!j?.mirrored && j.route === 'cors';
      }, 10000)
    );
    check('route counter: cors >= 1', registry.stats().images.cors >= 1);
  }

  // Params change re-renders stills (debounced 200 ms).
  {
    const j = registry.jobs.get(sameImg);
    const snap = j.ctx.getImageData(0, ((j.overlay.canvas.height / 2) | 0), j.overlay.canvas.width, 1).data.join();
    params.threshold = 0.05; // sort nearly everything → different output
    registry.paramsChanged({ threshold: 0.05 });
    check(
      'param change re-renders image stills',
      await waitFor(() => {
        const now = j.ctx.getImageData(0, ((j.overlay.canvas.height / 2) | 0), j.overlay.canvas.width, 1).data.join();
        return now !== snap;
      })
    );
    params.threshold = DEFAULTS.threshold;
    registry.paramsChanged({ threshold: params.threshold });
  }


  check(
    'static parents patched to relative',
    activeJobs().every(
      (j) => getComputedStyle(j.video.parentElement).position === 'relative'
    )
  );

  // Raising maxVideos live should activate every visible video. (Runs
  // after the overlay-count check: suspended jobs keep their hidden
  // canvases by design, so this permanently adds two to the DOM.)
  params.maxVideos = 8;
  registry.refresh();
  check(
    'raised maxVideos activates all 6 visible',
    await waitFor(() => registry.stats().active === 6)
  );
  params.maxVideos = 4;
  registry.refresh();
  check(
    'lowered maxVideos suspends back to 4',
    await waitFor(() => registry.stats().active === 4)
  );

  // --- Shared GL context (Phase 2) ---
  const glcs = new Set(activeJobs().map((j) => j.glc));
  const glc = [...glcs][0];
  check(
    'all jobs share one WebGL2 context',
    glcs.size === 1 && !!glc && glc.gl instanceof WebGL2RenderingContext
  );
  check('GL canvas is detached from the DOM', !!glc && !glc.canvas.isConnected);
  check(
    'bundles allocated at processing resolution',
    activeJobs().every(
      (j) =>
        j.bundle &&
        j.bundle.srcW === 320 &&
        j.bundle.srcH === 180 &&
        j.bundle.w === 320 &&
        j.bundle.h === 180
    )
  );

  // --- object-fit: contain letterbox (320×180 source in 320×240 box) ---
  check(
    'object-fit contain letterbox rect (0,30 320x180)',
    await waitFor(() => {
      const fr = registry.jobs.get(videos[3])?.fitRect;
      return !!fr && fr.x === 0 && fr.y === 30 && fr.w === 320 && fr.h === 180;
    })
  );

  // --- Removal teardown + slot promotion ---
  const victimJob = activeJobs()[0];
  const victim = victimJob.video;
  const victimCanvas = victimJob.overlay.canvas;
  victim.parentElement.remove();
  check(
    'removed video torn down',
    await waitFor(() => !registry.jobs.has(victim) && !victimCanvas.isConnected)
  );
  check(
    'freed slot promoted another video',
    await waitFor(() => registry.stats().active === 4)
  );

  // --- Orphaned overlay reattach (YouTube re-parent simulation) ---
  const healJob = activeJobs()[0];
  healJob.overlay.canvas.remove();
  check(
    'orphaned overlay reattached and re-mirrored by sweep',
    await waitFor(() => healJob.overlay.canvas.isConnected && healJob.mirrored)
  );

  // --- Disable / enable ---
  params.enabled = false;
  registry.refresh();
  check(
    'disable suspends all and restores videos',
    await waitFor(
      () =>
        registry.stats().active === 0 &&
        registry.stats().activeImages === 0 &&
        [...registry.jobs.values()].every((j) => j.video.style.opacity !== '0') &&
        [...document.querySelectorAll('canvas[data-deflection]')].every(
          (c) => c.style.display === 'none'
        )
    )
  );

  params.enabled = true;
  registry.refresh();
  check(
    're-enable restores 4 mirrored jobs',
    await waitFor(
      () => registry.stats().active === 4 && activeJobs().every((j) => j.mirrored)
    )
  );

  // --- Scroll: IntersectionObserver hands the slot to the far video ---
  window.scrollTo(0, document.body.scrollHeight);
  check(
    'scrolled-into-view video activated and mirrored',
    await waitFor(() => {
      const j = registry.jobs.get(far);
      return j.active && j.mirrored;
    })
  );
  check(
    'scrolled-out videos suspended',
    await waitFor(() =>
      videos
        .filter((v) => v.isConnected)
        .every((v) => !registry.jobs.get(v).active && v.style.opacity !== '0')
    )
  );
  window.scrollTo(0, 0);

  // --- Paused video gets a one-shot sorted still (no rVFC fires) ---
  await waitFor(() => registry.stats().active === 4);
  const pausedVid = videos[2];
  params.enabled = false;
  registry.refresh();
  await waitFor(() => registry.stats().active === 0);
  pausedVid.pause();
  params.enabled = true;
  registry.refresh();
  check(
    'paused video mirrored via one-shot render',
    await waitFor(() => {
      const j = registry.jobs.get(pausedVid);
      return !!j?.active && j.mirrored;
    })
  );
  pausedVid.play();

  // --- Context loss / restore (Phase 2) ---
  const mirroredJob = () =>
    [...registry.jobs.values()].find((j) => j.active && j.mirrored);
  await waitFor(() => registry.stats().active === 4 && !!mirroredJob());
  const lossGlc = mirroredJob()?.glc;
  const loseExt = lossGlc?.gl.getExtension('WEBGL_lose_context');
  if (!loseExt) {
    check('WEBGL_lose_context available for recovery test', false);
  } else {
    loseExt.loseContext();
    check('context loss detected', await waitFor(() => lossGlc.lost, 4000));
    loseExt.restoreContext();
    check(
      'context restored, pipeline rebuilt',
      await waitFor(() => !lossGlc.lost, 4000)
    );
    const j = mirroredJob();
    const sample = () => {
      const c = j.overlay.canvas;
      const row = Math.floor(c.height / 2);
      const d = j.ctx.getImageData(0, row, c.width, 1).data;
      let s = '';
      for (let i = 0; i < d.length; i += 48) s += d[i] + ',';
      return s;
    };
    // Content must CHANGE and be NON-BLACK: a restore bug (e.g. extension
    // enables resetting with the context) renders black, which a plain
    // change-detection check would wrongly pass.
    const before = sample();
    const nonBlack = (s) => s.split(',').some((v) => Number(v) > 20);
    check(
      'frames render real content after restore (bundle realloc)',
      await waitFor(() => {
        const now = sample();
        return now !== before && nonBlack(now);
      })
    );
  }

  // --- Tainted-source recovery: cross-origin video via detached CORS mirror ---
  // A no-cors cross-origin src taints the GL upload (SecurityError); the job
  // must recover by re-fetching the same URL through a crossorigin mirror
  // (:8439 sends ACAO the way the extension's DNR rule does). Instagram
  // explore reel previews are exactly this case; clicked reels are MSE blobs.
  if (xoUp) {
    const xv = document.createElement('video');
    xv.src = 'http://localhost:8439/test/fixtures/tiny.webm'; // deliberately NO crossorigin
    xv.muted = true;
    xv.loop = true;
    xv.playsInline = true;
    const xvCell = document.createElement('div');
    xvCell.className = 'cell';
    xvCell.appendChild(xv);
    grid.appendChild(xvCell);
    await xv.play().catch(() => {});
    params.maxVideos = 8; // make room: the grid still holds 5 visible videos
    registry.refresh();
    check(
      'tainted cross-origin video recovers via CORS mirror',
      await waitFor(() => {
        const j = registry.jobs.get(xv);
        return !!j && !j.abandoned && !!j.srcMirror && j.mirrored;
      }, 10000)
    );
    check(
      'mirror-fed canvas draws real content (non-black)',
      await waitFor(() => {
        const j = registry.jobs.get(xv);
        if (!j?.mirrored) return false;
        const c = j.overlay.canvas;
        const d = j.ctx.getImageData((c.width / 2) | 0, (c.height / 2) | 0, 1, 1).data;
        return d[3] > 0 && d[0] + d[1] + d[2] > 30;
      }, 8000)
    );
    params.maxVideos = 4;
    registry.refresh();
  }

  const done = document.createElement('div');
  done.id = 'done';
  done.textContent = `HARNESS COMPLETE: ${passCount} passed, ${failCount} failed`;
  done.className = failCount === 0 ? 'pass' : 'fail';
  status.appendChild(done);
}

run();
