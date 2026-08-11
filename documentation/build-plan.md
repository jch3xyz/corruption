# DEFLECTION — Build Plan, Status & Handoff

## Context

DEFLECTION (Proposal B in [admin/DEFLECTION - proposal.md](../admin/DEFLECTION%20-%20proposal.md))
is an art-installation Chrome extension: Nam June Paik's *Magnet TV* restated
for the browser. The transmission arrives perfect; the apparatus of display
bends. It intercepts every video frame and image between decode and display
and rearranges the material by pixel-sorting on the GPU. Nothing added,
nothing lost, unreadable anyway. Sound is intended to receive the same
treatment but the effect is **not yet chosen** — see below.

Conceptually the project has grown from "codec-corruption aesthetic" into a
device that turns the live internet into a generative artwork with code
aesthetics. **Straight sorting (no feedback) is the piece's resting state**,
chosen by John on real footage; the temporal-feedback mode survives as a
single toggle.

Runs on a kiosk (Mac mini M4) for weeks unattended. Vanilla JS, Manifest V3,
no build step — "Load unpacked" points at `source/`.

## Status — everything below is committed and harness-verified

| Commit | What landed |
|---|---|
| Phase 0 | Repo, MV3 skeleton (bootstrap → dynamic-import modules), icons |
| Phase 1 | Registry (MutationObserver + 2 s sweep + IntersectionObserver), sibling-canvas Overlay with object-fit math, VideoJob rVFC loop, DRM gate, self-healing |
| Phase 2 | One shared WebGL2 context, allocate-once bundles, float ping-pong, passthrough; **context-restore bug found & fixed: extension enables reset with the context — re-request EXT_color_buffer_float on `webglcontextrestored`** |
| Phase 3 | Sort + composite shaders, keyframe resets, FrameGovernor (adaptive passes/res), control panel + Web MIDI learn |
| straight-sort pivot | Per-frame sorting default; stride-ladder (brick odd-even, 256→1) for long ribbons; `feedback` demoted to toggle |
| maxVideos | Cap became a param (default 8); paused videos get one-shot sorted stills (rVFC never fires for them) |
| Phase 4 | Image path: DNR ACAO rule enabled + 3-route CORS strategy (direct / detached-crossorigin / SW base64), still re-render on param change, feedback-mode image ticker; video black-output probe |
| defaults | threshold 0, passes 64, streak 256 (full-frame sorting), feedback off |
| audio bake-off | Two complete engines behind one worklet, live-switchable via `audioMode` (100 ms crossfade): **body** (48 modal resonators, struck) and **timebase** (45 s reservoir, 5 lag-controlled heads). Plumbing restored from `audio-v1` with its latent bugs fixed. Audio harness 31/31 (tiers 1–3). **Verdict pending — John judges on live browsing and the loser is removed.** |

The first audio phase (spectral/granular sorting) was built, verified, then
removed for mirroring the pixel-sort grammar; it survives at tag `audio-v1`.
The current two engines came out of a multiple-perspectives run (5 isolated
probes, 5 blind critics); the corrections that run produced are baked into
the implementations — see "Audio engines (bake-off)" in parameters.md.

**Remaining:**

- **Audio verdict.** Browse real sites, flip `audioMode` live (panel or MIDI
  CC), keep the winner, remove the loser. Criteria: body wins if unrelated
  sources cohere as one struck object without fusing into an unbroken chord;
  timebase wins if material acquires a form that is not the browsing's form
  (bent time, not an echo plugin). Either loses the spine test: if you can't
  connect what you hear to what you just played, it's ambient music near a
  computer.
- **Phase 5 — text swap** (titles/captions swapped between elements, behind a
  toggle): **ON HOLD by John's instruction.** Don't build unprompted.
- **Phase 6 — kiosk hardening + soak**: not started. Chrome for Testing at a
  pinned version (branded Chrome ≥137 removed `--load-extension`), template
  profile restored nightly via launchd (doubles as the consent-signage
  session wipe), flags incl. `--autoplay-policy=no-user-gesture-required`
  (any audio work will need it to skip the first-gesture wait), `--start-fullscreen` vs
  `--kiosk` decision (popup panel conflicts with `--kiosk`), 72 h + 7-day
  soak, `kiosk-setup.md` written well enough to build the cold spare from.

## Architecture map

```
source/
├── manifest.json                  # MV3; DNR ruleset ENABLED (browser-wide ACAO on image/media)
├── rules/cors-media.json
├── background/service-worker.js   # panel window mgmt, image-fetch base64 fallback (route 3)
├── content/
│   ├── bootstrap.js               # classic script → dynamic import (content scripts can't be modules)
│   ├── main.js                    # boot, params flow, tiny-iframe early-exit
│   ├── params.js                  # DEFAULTS; chrome.storage.local is the single source of truth
│   ├── registry.js                # discovery (video/img/audio), caps, sweep, image ticker, audio ranking
│   ├── video-job.js               # rVFC → GL pipeline; DRM gate; black-output probe; governor
│   ├── image-job.js               # 3-route CORS; one-shot stills; feedback-mode animation
│   ├── audio-job.js               # playback-driven tap lifecycle; safety gate; bypass semantics
│   ├── overlay.js                 # sibling canvas; object-fit/position replication
│   └── metrics.js                 # FrameGovernor (rVFC presentedFrames deltas)
├── gl/  context.js · pipeline.js · shaders/{common,passthrough,composite,sort}.js
├── audio/ graph.js · worklet.js · dsp.js · fft.js   # worklet holds BOTH engines (mode-switched)
└── panel/ panel.html · panel.js · panel.css · midi.js  # extension page, popup window
```

Design invariants that hold everywhere:

- **One shared expensive resource per page** (GL context, AudioContext),
  per-element jobs with allocate-once buffers; zero allocations in frame paths.
- **Sweep-first**: no site-specific selector is load-bearing; the 2 s sweep
  makes observer edge cases irrelevant. `yt-navigate-finish` is a fast-path.
- **Never break the page**: every failure abandons to untouched original
  (visible video, audible audio). The kill switch (Ctrl+Shift+D) restores
  everything instantly.
- **Sorting grammar (visual)**: stride-ladder odd-even compare-exchange;
  threshold gates participation; dark material is a barrier; bright rises
  toward top. The audio engines deliberately do NOT mirror this grammar —
  that mirroring was the first audio attempt's mistake (tag `audio-v1`).
- Params: panel writes chrome.storage.local (throttled ~30 Hz), content
  scripts subscribe; MIDI learn maps one CC per param.

## Hard-won corrections (do not relearn these)

1. **Proposal's composite shader was wrong**: masking feedback on
   `luma(incoming)` kills persistence the moment a bright object moves. Mask
   on `kept = max(history*decay, incoming)` instead (composite.js).
2. **WebGL context restore resets extension enables** — re-request
   `EXT_color_buffer_float` in `webglcontextrestored` or all float FBOs render
   black (gl/context.js; the harness's non-black assertion guards this).
3. **MV3 messaging can't transfer bytes** (JSON-serialized) and SWs have no
   `URL.createObjectURL` — image route 3 ships base64 data URLs.
4. **The DNR ACAO rule helps images/fetches, NOT media elements**: media
   without `crossorigin` fetches in no-cors mode and never consults response
   headers. Audio safety must therefore be **predicted pre-tap** (same-origin /
   blob (YouTube MSE) / data / MediaStream / `crossorigin="anonymous"` only).
   *(Binds any future audio effect.)*
5. **`createMediaElementSource` is permanent and re-tapping throws** — taps
   must live in a WeakMap that survives job destroy (YouTube re-parents its
   <video>); disable has to be a wet/dry gain bypass, never an un-tap. Tapping
   an unsafe element silences it unrecoverably (both paths) — never tap unsafe.
   *(Binds any future audio effect.)*
6. **rVFC only fires on new frames**: paused videos need one-shot renders;
   hidden tabs stop rVFC/IO/rAF entirely (correct for kiosk, brutal for the
   in-session test pane — see Dev workflow).
7. **Chrome heuristic-caches old-mtime modules for hours** — always test
   through `test/serve.py` (sends no-store), never a plain http.server.
8. **Stored params beat code defaults**: after changing DEFAULTS, hit
   "restore defaults" in the panel or the old values persist from storage.

## Dev workflow

```bash
python3 test/serve.py        # :8437, no-store + ACAO (mimics the DNR rule)
python3 test/serve.py 8439   # second origin for the image CORS-route test
```

- Visual/lifecycle suite: `http://localhost:8437/test/harness/index.html`
  (~26 checks). **Must run in a visible tab** — hidden tabs starve frames and
  produce false timeouts (documented in harness header). In John's Chrome it
  runs clean; in Claude's embedded pane expect visibility roulette.
- Audio suite: `http://localhost:8437/test/harness/audio.html` — tier 1 (pure
  DSP) + tier 2 (both engines through OfflineAudioContext) are fully
  deterministic, 22 checks; tier 3 ("run live tap tests" button) adds 9
  live-tap checks incl. tap permanence, re-tap reuse, and a live mode flip.
  Last full run: 31/31. Unlike the visual suite it is immune to pane
  visibility (offline rendering).
- Extension: chrome://extensions → Load unpacked → `source/`. Reload after
  edits; Chrome writes `source/_metadata/` (gitignored).
- Proof-of-interception tricks: invert/hide `canvas[data-deflection]`;
  `__deflection.registry.stats()` from the DEFLECTION console context
  (route counters, audio tap counts).

## John's manual checklist (needs real Chrome; not yet all exercised)

- **The bake-off verdict** (see Remaining): YouTube music video, news
  autoplay, an ad, a quiet documentary — flip `audioMode` on the same
  material. Also: visual suite re-run in real Chrome (the embedded pane
  starves rVFC and can't adjudicate it — verified identical at baseline).
- Audio plumbing: page mute/volume through the chain; a cross-origin-audio
  site stays untouched w/ console log; MIDI sweep incl. `audioMode` on a CC.
- Visual: fullscreen/theater tracking, 5× SPA navigation canvas-leak check,
  DRM trailer untouched, 30-min GPU-memory flatness (rides Phase 6 soak).

## Conventions

- Vanilla JS ES modules, no bundler, no dependencies. GLSL as template
  literals; any DSP as pure chrome-free modules (that's what makes it testable).
- Every phase/iteration = one commit, made only after its harness gate runs.
  Commit messages explain the *why* and record verification results.
- documentation/: parameters.md (knobs, shader/DSP mapping, MIDI),
  site-notes.md (per-site quirks), this file (plan/status/handoff).
