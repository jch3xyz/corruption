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

An audio phase (spectral/granular sorting + feedback delay line) was built and
harness-verified, then **removed from main on 2026-08-11 by John's
instruction** — the effect was not the one he wants, and starting from a clean
slate beats working around the existing pipeline. It is preserved at tag
`audio-v1` (`git show audio-v1`) and reverted by the commit that follows
58a9bd2. Consult it for Chrome facts, not as a template.

**Remaining:**

- **Audio — effect undecided, to be built from scratch.** The `source/audio/`
  tree, `content/audio-job.js`, the panel's audio section and the audio
  harness are all gone; `registry.js` no longer discovers `<audio>`. Corrections
  4 and 5 below still bind any future implementation (they are Chrome
  behaviours, not choices of the old effect). Nothing else in the codebase
  assumes audio.
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
│   ├── registry.js                # discovery (video/img), caps, sweep, image ticker
│   ├── video-job.js               # rVFC → GL pipeline; DRM gate; black-output probe; governor
│   ├── image-job.js               # 3-route CORS; one-shot stills; feedback-mode animation
│   ├── overlay.js                 # sibling canvas; object-fit/position replication
│   └── metrics.js                 # FrameGovernor (rVFC presentedFrames deltas)
├── gl/  context.js · pipeline.js · shaders/{common,passthrough,composite,sort}.js
└── panel/ panel.html · panel.js · panel.css · midi.js  # extension page, popup window
```

An audio implementation would add `source/audio/` plus a `content/audio-job.js`
alongside `video-job.js`, and a panel section. That was the previous shape; the
next one is free to differ.

Design invariants that hold everywhere:

- **One shared expensive resource per page** (the GL context today; an
  AudioContext if audio returns), per-element jobs with allocate-once buffers;
  zero allocations in frame paths.
- **Sweep-first**: no site-specific selector is load-bearing; the 2 s sweep
  makes observer edge cases irrelevant. `yt-navigate-finish` is a fast-path.
- **Never break the page**: every failure abandons to untouched original
  (visible video, audible audio). The kill switch (Ctrl+Shift+D) restores
  everything instantly.
- **Sorting grammar (visual)**: stride-ladder odd-even compare-exchange;
  threshold gates participation; dark material is a barrier; bright rises
  toward top. The removed audio phase mirrored this grammar in the spectral
  domain — an assumption the next audio effect is explicitly free to drop.
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
- Audio suite: removed with the audio phase. The pattern it proved is worth
  repeating for whatever replaces it — deterministic tiers first (pure DSP,
  then OfflineAudioContext), live taps behind an explicit button, because live
  audio in a harness is not reproducible. See `git show audio-v1:test/harness/audio-harness.js`.
- Extension: chrome://extensions → Load unpacked → `source/`. Reload after
  edits; Chrome writes `source/_metadata/` (gitignored).
- Proof-of-interception tricks: invert/hide `canvas[data-deflection]`;
  `__deflection.registry.stats()` from the DEFLECTION console context
  (route counters).

## John's manual checklist (needs real Chrome; not yet all exercised)

- Visual: fullscreen/theater tracking, 5× SPA navigation canvas-leak check,
  DRM trailer untouched, 30-min GPU-memory flatness (rides Phase 6 soak).

## Conventions

- Vanilla JS ES modules, no bundler, no dependencies. GLSL as template
  literals; any DSP as pure chrome-free modules (that's what makes it testable).
- Every phase/iteration = one commit, made only after its harness gate runs.
  Commit messages explain the *why* and record verification results.
- documentation/: parameters.md (knobs, shader/DSP mapping, MIDI),
  site-notes.md (per-site quirks), this file (plan/status/handoff).
