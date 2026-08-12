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
import { acquireGL } from '../../source/gl/context.js';
import { createBundle, destroyBundle } from '../../source/gl/pipeline.js';

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

// --- Tier 0: direct-pipeline micro-tests -----------------------------------
// Static canvas sources through the real GL pipeline, no rVFC and no
// observers, so unlike everything below these run identically in a hidden
// pane. They pin the sort's structural invariants: determinism, permutation
// (nothing added, nothing lost), and the temperature / motion-gate grammar.
function tier0() {
  const glc = acquireGL();
  if (!glc) {
    check('tier 0: WebGL2 available', false);
    return;
  }
  const gl = glc.gl;
  const W = 64;
  const H = 64;

  let s = 7;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const src = (paint) => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    paint(c.getContext('2d'));
    return c;
  };
  const noisy = src((x) => {
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        x.fillStyle = `rgb(${(rnd() * 256) | 0},${(rnd() * 256) | 0},${(rnd() * 256) | 0})`;
        x.fillRect(i, j, 1, 1);
      }
    }
  });

  // Run a step sequence on a bundle and read the presented pixels back.
  const run = (steps) => {
    const b = createBundle(gl, W, H, W, H);
    try {
      steps(glc.pipeline, b);
      glc.ensureSize(W, H);
      glc.pipeline.present(b);
      const px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return px;
    } finally {
      destroyBundle(gl, b);
    }
  };
  const lum = (px, x, y) => {
    const i = (y * W + x) * 4;
    return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  };
  // Ordered-ness, direction-agnostic: violations of monotonicity down each
  // column, taken in whichever direction has fewer (present() flips V, and
  // the invariant is "columns ordered", not which way readback runs).
  const inversions = (px) => {
    let asc = 0;
    let desc = 0;
    for (let x = 0; x < W; x++) {
      for (let y = 1; y < H; y++) {
        const a = lum(px, x, y - 1);
        const b2 = lum(px, x, y);
        if (b2 > a + 0.75) asc++;
        if (b2 < a - 0.75) desc++;
      }
    }
    return Math.min(asc, desc);
  };
  const colKey = (px, x) => {
    const rows = [];
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * 4;
      rows.push(`${px[i]},${px[i + 1]},${px[i + 2]}`);
    }
    return rows.sort().join('|');
  };
  const sameColumns = (a, b) => {
    for (let x = 0; x < W; x++) if (colKey(a, x) !== colKey(b, x)) return false;
    return true;
  };

  const sortSteps = (opts) => (p, b) => {
    p.uploadFrame(b, noisy);
    p.runReset(b);
    p.runSortPasses(b, 200, 0, 64, opts);
  };
  const unsorted = run((p, b) => {
    p.uploadFrame(b, noisy);
    p.runReset(b);
  });
  const s1 = run(sortSteps());
  const s2 = run(sortSteps());
  check(
    'pipeline: temperature 0 is deterministic',
    s1.length === s2.length && s1.every((v, i) => v === s2[i])
  );
  check(
    `pipeline: columns fully ordered at temperature 0 (${inversions(s1)} inversions)`,
    inversions(s1) === 0
  );

  const hot = run(sortSteps({ temperature: 0.45 }));
  check(
    'pipeline: temperature conserves every pixel in its column (permutation)',
    sameColumns(hot, unsorted)
  );
  check(
    `pipeline: temperature keeps the sort from settling (${inversions(hot)} inversions persist)`,
    inversions(hot) > 200
  );

  // Motion gate. f2 = f1 except rows 24–35, which hold displaced noise.
  // Sequence: reset on f1, then 10 still composites to cool the post-reset
  // trail flood (1 → 0.9¹⁰ ≈ 0.35 < the 0.5 gate), then the perturbed
  // frame arrives and only its band carries fresh motion.
  const f2 = src((x) => {
    x.drawImage(noisy, 0, 0);
    x.save();
    x.beginPath();
    x.rect(0, 24, W, 12);
    x.clip();
    x.drawImage(noisy, 5, 3);
    x.restore();
  });
  const motionSteps = (gate, passes) => (p, b) => {
    p.uploadFrame(b, noisy);
    p.runReset(b);
    const still = { driftX: 0, driftY: 0, decay: 0.5, threshold: 0 };
    for (let i = 0; i < 10; i++) p.runComposite(b, still);
    p.uploadFrame(b, f2);
    p.runComposite(b, still);
    if (passes > 0) p.runSortPasses(b, passes, 0, 64, { motionGate: gate });
  };
  const baseline = run(motionSteps(0.5, 0));
  const gated = run(motionSteps(0.5, 200));
  const open = run(motionSteps(0, 200));
  // Rows 24–35 in source space; present() flips V, so compare via column
  // multisets restricted to bands. Simplest robust split: count changed
  // pixels in each readback row against the no-sort baseline.
  const changedRows = (px) => {
    const rows = [];
    for (let y = 0; y < H; y++) {
      let changed = 0;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (
          px[i] !== baseline[i] ||
          px[i + 1] !== baseline[i + 1] ||
          px[i + 2] !== baseline[i + 2]
        ) {
          changed++;
        }
      }
      rows.push(changed);
    }
    return rows;
  };
  const bandRows = new Set();
  for (let y = 24; y < 36; y++) bandRows.add(H - 1 - y); // flipped readback
  const g = changedRows(gated);
  const insideChanged = [...bandRows].reduce((n, y) => n + g[y], 0);
  const outsideChanged = g.reduce((n, c, y) => (bandRows.has(y) ? n : n + c), 0);
  check(
    `pipeline: motion gate confines sorting to the moving band (inside ${insideChanged}, outside ${outsideChanged})`,
    insideChanged > 50 && outsideChanged === 0
  );
  const o = changedRows(open);
  const openOutside = o.reduce((n, c, y) => (bandRows.has(y) ? n : n + c), 0);
  check(
    `pipeline: gate 0 sorts regardless of motion (${openOutside} pixels moved outside the band)`,
    openOutside > 200
  );

  // The composite's core contract, pinned where pane visibility can't
  // interfere: history outlives its source through a composite (the trail),
  // and a reset wipes it (straight sort has no history). This is the
  // shader-level twin of the rVFC trail test below, which needs a visible
  // tab to adjudicate.
  const barA = src((x) => {
    x.fillStyle = '#000';
    x.fillRect(0, 0, W, H);
    x.fillStyle = '#fff';
    x.fillRect(10, 10, 8, 8);
  });
  const barB = src((x) => {
    x.fillStyle = '#000';
    x.fillRect(0, 0, W, H);
    x.fillStyle = '#fff';
    x.fillRect(40, 40, 8, 8);
  });
  const atA = (px) => lum(px, 14, H - 1 - 14); // readback is V-flipped
  const trailed = run((p, b) => {
    p.uploadFrame(b, barA);
    p.runReset(b);
    p.uploadFrame(b, barB);
    p.runComposite(b, { driftX: 0, driftY: 0, decay: 0.95, threshold: 0.1 });
  });
  const wiped = run((p, b) => {
    p.uploadFrame(b, barA);
    p.runReset(b);
    p.uploadFrame(b, barB);
    p.runReset(b);
  });
  check(
    `pipeline: composite trail outlives its source (luma ${atA(trailed).toFixed(0)} at the old bar)`,
    atA(trailed) > 100
  );
  check(
    `pipeline: reset wipes history (luma ${atA(wiped).toFixed(0)} at the old bar)`,
    atA(wiped) < 10
  );

  // The flow field: sorting along curl-noise streamlines. Time is a fixed
  // uniform here, so every render is exactly reproducible.
  const flowSteps = (amount, time) => (p, b) => {
    p.uploadFrame(b, noisy);
    p.runReset(b);
    if (amount > 0) {
      p.runFieldPass(b, { amount, scale: 4, speed: 0.05, time });
    }
    p.runSortPasses(b, 200, 0, 64, { flow: amount > 0 });
  };
  const globalKey = (px) => {
    const all = [];
    for (let i = 0; i < px.length; i += 4) {
      all.push(`${px[i]},${px[i + 1]},${px[i + 2]}`);
    }
    return all.sort().join('|');
  };
  const flowed = run(flowSteps(1, 12.5));
  const flowedAgain = run(flowSteps(1, 12.5));
  check(
    'pipeline: flow is deterministic at a fixed field time',
    flowed.every((v, i) => v === flowedAgain[i])
  );
  check(
    'pipeline: flow conserves every pixel globally (permutation along streamlines)',
    globalKey(flowed) === globalKey(unsorted)
  );
  check(
    'pipeline: flow diverges from the vertical grammar',
    flowed.some((v, i) => v !== s1[i])
  );
  const flowedLater = run(flowSteps(1, 30.0));
  check(
    'pipeline: the field evolves over time (streamlines re-carve)',
    flowed.some((v, i) => v !== flowedLater[i])
  );
  const flowZero = run(flowSteps(0, 99));
  check(
    'pipeline: flowAmount 0 is bit-identical to the vertical sort',
    flowZero.every((v, i) => v === s1[i])
  );
}

async function run() {
  try {
    tier0();
  } catch (e) {
    check(`tier 0 crashed (${e.message})`, false);
  }
  // Boot the registry FIRST so all videos arrive via MutationObserver.
  // feedbackVideo:true (the default, pinned here anyway) so the trail test
  // exercises the temporal path; a later check flips it off and asserts
  // straight sorting leaves no trail. feedbackImage stays off — the image
  // tests are route/still tests, and the ticker check flips it itself.
  // maxVideos pinned to 4 so the cap/promotion tests stay meaningful.
  const params = { ...DEFAULTS, enabled: true, feedbackVideo: true, maxVideos: 4 };
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
  params.feedbackVideo = false;
  check(
    'straight sort mode leaves no trail',
    await waitFor(() => {
      const n = brightRowCount();
      return n > 20 && n < 55;
    })
  );
  params.feedbackVideo = true;

  // --- Split feedback toggles: the image ticker rides feedbackImage alone,
  // regardless of the video toggle. (Pure timer state — pane-immune.)
  params.feedbackImage = true;
  registry.paramsChanged({ feedbackImage: true });
  check('image ticker starts with image feedback', registry.imageTicker !== 0);
  params.feedbackImage = false;
  registry.paramsChanged({ feedbackImage: false });
  check(
    'image ticker ignores the video toggle',
    registry.imageTicker === 0 && params.feedbackVideo === true
  );

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

  // Params change re-renders stills (debounced 200 ms). threshold 0.9 bars
  // all but the brightest pixels from sorting, so the re-render provably
  // differs from the default full sort. (0.05 was used when the default was
  // 0.55; against today's default 0 both values sort everything and the
  // still is pixel-identical — masked for a while by image feedback
  // animating underneath this test.)
  {
    const j = registry.jobs.get(sameImg);
    // Guard, don't dereference: in a starved pane the image never rendered
    // and ctx is null — an unguarded read here threw OUTSIDE waitFor's
    // try and silently killed the whole run (no COMPLETE line, ever).
    if (j?.ctx) {
      const snap = j.ctx.getImageData(0, ((j.overlay.canvas.height / 2) | 0), j.overlay.canvas.width, 1).data.join();
      params.threshold = 0.9;
      registry.paramsChanged({ threshold: 0.9 });
      check(
        'param change re-renders image stills',
        await waitFor(() => {
          const now = j.ctx.getImageData(0, ((j.overlay.canvas.height / 2) | 0), j.overlay.canvas.width, 1).data.join();
          return now !== snap;
        })
      );
      params.threshold = DEFAULTS.threshold;
      registry.paramsChanged({ threshold: params.threshold });
    } else {
      check('param change re-renders image stills (no render to test — starved pane)', false);
    }
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
  // Guarded like the image-still check above: in a starved pane no job is
  // active, and an unguarded [0].video deref here killed the whole run.
  const victimJob = activeJobs()[0];
  if (victimJob?.overlay) {
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
  } else {
    check('removed video torn down (no active job — starved pane)', false);
    check('freed slot promoted another video (no active job — starved pane)', false);
  }

  // --- Orphaned overlay reattach (YouTube re-parent simulation) ---
  const healJob = activeJobs()[0];
  if (healJob?.overlay) {
    healJob.overlay.canvas.remove();
    check(
      'orphaned overlay reattached and re-mirrored by sweep',
      await waitFor(() => healJob.overlay.canvas.isConnected && healJob.mirrored)
    );
  } else {
    check('orphaned overlay reattached (no active job — starved pane)', false);
  }

  // --- Disable / enable ---
  params.enabled = false;
  registry.refresh();
  check(
    'disable suspends all and restores videos',
    await waitFor(
      () =>
        registry.stats().active === 0 &&
        registry.stats().activeImages === 0 &&
        // The right element per kind: VideoJob carries .video, ImageJob .img.
        // (j.video for an image job threw and read as a silent timeout.)
        [...registry.jobs.values()].every(
          (j) => (j.video ?? j.img).style.opacity !== '0'
        ) &&
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
    if (j?.ctx) {
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
    } else {
      check('frames render real content after restore (no mirrored job — starved pane)', false);
    }
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
