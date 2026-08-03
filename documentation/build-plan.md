# DEFLECTION — Build Plan

## Context

DEFLECTION (Proposal B in [admin/DEFLECTION - proposal.md](admin/DEFLECTION%20-%20proposal.md)) is an art-installation browser extension: it intercepts every `<video>` and `<img>` on the live web and renders them through a WebGL2 pixel-sorting shader with temporal feedback, so corruption accumulates and clears the way codec failure does. The page underneath stays fully functional. It runs on a kiosk (Mac mini M4) for weeks unattended. The proposal specifies the aesthetic and the mechanism; this plan turns it into a concrete Manifest V3 implementation and corrects a few of its platform assumptions.

The project directory exists with empty `source/`, `documentation/`, `exports/` folders. Not yet a git repo — **step 1 is `git init`** at the project root.

## Corrections to the proposal (design decisions baked into this plan)

1. **Image path:** the proposal's snippet (SW fetches bytes → "transfer to the content script") doesn't work in MV3 — `chrome.runtime.sendMessage` JSON-serializes; no ArrayBuffer/ImageBitmap transfer, no `URL.createObjectURL` in service workers. **Primary route instead:** a static `declarativeNetRequest` rule that **sets** `Access-Control-Allow-Origin: *` on image/media responses, so `img.crossOrigin = "anonymous"` + src re-assign loads untainted. **Fallback:** SW fetch → base64 data URL → content script decodes. Try direct `texImage2D` first (many images are already clean).
2. **One shared WebGL2 context per page**, rendering into per-element 2D overlay canvases via same-task `drawImage`. Per-video contexts would hit Chrome's ~16-context cap on any feed page.
3. **Sort the accumulator, not the incoming frame.** Pipeline order per frame: composite incoming into accumulator → K odd-even transposition passes on the accumulator → result becomes the new accumulator and is displayed. Otherwise sort progress resets every frame and the "organizes itself over time" effect never appears.
4. **Content scripts can't be ES modules.** Classic `bootstrap.js` does `import(chrome.runtime.getURL('content/main.js'))`; module files listed in `web_accessible_resources`. No bundler, no package.json — vanilla JS, GLSL as template-literal modules, load-unpacked from `source/`.
5. **DRM:** primary signal is the `encrypted` event / `video.mediaKeys !== null` — never attach to EME video. Black-frame `readPixels` check (16×16 downsample every ~2 s) is the fallback net.
6. **Kiosk browser:** `--load-extension` was removed from branded Chrome (137+). Use **Chrome for Testing** at a pinned version (no auto-update, flag still works), plus a template-profile snapshot restored nightly.
7. **YouTube reuses its `<video>` element across SPA navigations** — jobs must survive src/resolution changes in place (reallocate textures on `videoWidth` change), not assume teardown.

## Repo layout

```
.gitignore                  # .DS_Store, exports/*.zip, *.crx, *.pem, node_modules
admin/                      # proposal (existing)
documentation/              # operator docs: kiosk-setup.md, parameters.md, soak-log.md, site-notes.md
exports/                    # zipped builds for the giveaway/takeaway idea
source/                     # ← "Load unpacked" target
├── manifest.json
├── rules/cors-media.json           # DNR ruleset (image path)
├── background/service-worker.js    # module SW: image-fetch fallback, panel open, memory log
├── content/
│   ├── bootstrap.js                # classic script → dynamic-imports main.js
│   ├── main.js                     # orchestrator: params, registry, observers
│   ├── registry.js                 # element lifecycle, IntersectionObserver, 2s sweep, job caps
│   ├── video-job.js                # per-video rVFC pipeline, DRM gating
│   ├── image-job.js                # 3-route CORS strategy, animated/still tiers
│   ├── overlay.js                  # sibling-canvas placement, object-fit mapping, fullscreen sync
│   ├── params.js                   # defaults + chrome.storage read/subscribe
│   ├── metrics.js                  # frame timing → adaptive pass count, memory watch
│   └── text-swap.js                # optional module (Phase 5)
├── gl/
│   ├── context.js                  # one shared GL2 context, caps check, context-loss recovery
│   ├── pipeline.js                 # programs, fullscreen triangle, allocate-once FBO/texture bundles
│   └── shaders/  common.js · passthrough.js · sort.js · composite.js
├── panel/    panel.html · panel.js · panel.css · midi.js
└── icons/
```

## Key architecture

- **manifest.json:** `host_permissions: ["<all_urls>"]`; permissions `storage`, `declarativeNetRequest`; content script at `document_idle`, `all_frames: true` (YouTube embeds — early-exit tiny iframes), default ISOLATED world; `commands` for toggle-effect and open-panel hotkeys.
- **Video:** `requestVideoFrameCallback` loop per job (fires per decoded frame — no 30/60 judder), `texSubImage2D` upload into allocate-once RGBA8 + two RGBA16F accumulator FBOs (`EXT_color_buffer_float` required; absent → extension silently no-ops, page stays functional). Composite shader is the proposal's: `mix(incoming, max(history * uDecay, incoming), step(uThreshold, luma))` with `uDrift` offset. Accumulator reset every 4–10 s with jitter = copy current frame over accumulator (keyframe restores picture, not black). Cap 3–4 active video jobs by visible area; off-screen jobs suspend.
- **Overlay:** canvas inserted as the media element's **next sibling**, `position:absolute; inset:0; pointer-events:none`, parent forced `relative` if static. Survives scroll for free and — decisively — survives fullscreen (sibling lives inside the fullscreened player container). Original element set to `opacity:0` only after first rendered frame. Replicate `object-fit` so letterboxing aligns.
- **Images:** big on-screen images (≥ ~200 px) get a live animated job off a global ~12–15 fps ticker, capped ~12 concurrent; the rest get a one-shot ~30-pass sorted still, GL resources released immediately.
- **Control panel:** extension page opened as popup window (Web MIDI permission is per-origin — extension page grants once and persists; injected overlay would prompt per-site). `chrome.storage.local` is the single source of truth; panel writes throttled, content scripts subscribe via `onChanged`. Params: enabled, threshold, decay, driftX/Y, passes, reset min/max, maxRes, imageFps, imageAnimCap, textSwap.
- **SPA resilience:** debounced MutationObserver + **2 s full sweep** as backstop (no site-specific selectors as load-bearing paths); `yt-navigate-finish` listener for instant YouTube resync; orphaned-overlay re-insertion check rides the sweep.
- **Long-run stability:** zero allocations in the frame path; adaptive pass count with hysteresis (drop K, then maxRes, on sustained overage); SW memory log with tab-reload backstop; rehearsed `webglcontextlost` recovery; nightly launchd wipe (rsync template profile → relaunch); LaunchAgent KeepAlive + `caffeinate`.

## Phases (each ends with a verification gate)

**Phase 0 — repo + skeleton (half day).** `git init`, `.gitignore`, scaffold `source/` (manifest, stub SW, bootstrap + logging main.js), first commit. *Verify:* loads unpacked with zero errors; boot log appears on youtube.com, a news article, and inside an embedded YouTube iframe.

**Phase 1 — discovery + overlay, no WebGL (~2 days).** registry, overlay, observers; prove overlay with plain 2D `drawImage` mirror. *Verify:* overlay pixel-tracks a YouTube video through scroll/theater/fullscreen/quality changes; controls stay clickable; 5 SPA navigations leave no orphaned canvases; DRM gate leaves a YouTube Movies trailer untouched.

**Phase 2 — GL plumbing (~4 days).** Shared context, pipeline helpers, passthrough shader, ping-pong wired. *Verify:* video identical through GL path at 60 fps; 10-video page uses exactly one WebGL context with job cap engaging; 30-min run with flat GPU memory; forced context loss (`WEBGL_lose_context`) recovers.

**Phase 3 — the aesthetic (~5 days, the real work).** Sort + composite shaders, reset jitter, control panel, MIDI map. *Verify:* bright regions ribbon upward while dark holds; smear outlives its source frames; resets read as keyframes; panel sliders alter a running video in <100 ms; MIDI sweep is smooth.

**Phase 4 — image path + hardening (~3 days).** DNR ruleset, image-job tiers, SW base64 fallback, black-frame net. *Verify:* Wikipedia / YouTube thumbnails / Instagram feed each take the expected route (debug counter); zero taint errors after 10 min of infinite scroll; frame rate holds on an image grid.

**Phase 5 — optional text swap (~2 days, behind toggle).** Swap (not scramble) titles/captions between elements containing processed media; nav/inputs/aria untouched; toggle-off restores exactly. *Verify:* YouTube home shows real titles on wrong videos; search and buttons work; SPA navigation re-swaps cleanly.

**Phase 6 — kiosk + soak (~2 days + 1 week).** Chrome for Testing pinned, template profile, launchd nightly wipe, flags, `kiosk-setup.md` complete enough to build the cold spare from. *Verify:* `kill -9` Chrome → piece back in 10 s; nightly wipe clears a test login; 72 h soak flat memory, then 7-day soak against `soak-log.md`.

## Risks

- **The sort aesthetic is the schedule risk** (the proposal says so too). Build the panel *before* polishing the shader — it compresses the iteration loop.
- Site DOM drift (YouTube renames things): the sweep-first design is the hedge; log quirks in `site-notes.md`.
- DNR header injection is browser-wide — fine for the kiosk; note it in the README if the extension is given away as the takeaway.
- Instagram logged-out is nearly unusable; decide at install whether the template profile bakes in a burner account (nightly wipe restores it) or the kiosk leans on YouTube/news.
