# DEFLECTION — Build Plan, Status & Handoff

## Context

DEFLECTION (Proposal B in [admin/DEFLECTION - proposal.md](../admin/DEFLECTION%20-%20proposal.md))
is an art-installation Chrome extension: Nam June Paik's *Magnet TV* restated
for the browser. The transmission arrives perfect; the apparatus of display
bends. It intercepts every video frame, image, and sound between decode and
output: pixels sort on the GPU; audio drives a fixed resonant body (48
stretched-partial modal resonators) whose output smears through a
recirculating delay. Nothing added, nothing lost, unreadable anyway.

Conceptually the project has grown from "codec-corruption aesthetic" into a
device that turns the live internet into a generative artwork with code
aesthetics. **The piece's resting state** (John, 2026-08-11, settled live
during the audio bake-off): **straight visual sorting + the body engine
continuously driven + a never-clearing audio smear** whose loop gain is its
own decay. The visual and audio feedback are decoupled: `audioFeedback` on,
visual `feedback` off — the visual temporal-feedback mode survives as a
toggle whose knobs (decay 0.906, leftward drift, 1–60 s keyframes) are
live-tuned for when it's flipped on. The text mode (page-wide word
scrambling, John's choice over the proposal's swap design) is **off** in
that resting state: built and verified, awaiting the call the proposal
always deferred to the room.

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
| audio bake-off | Two complete engines behind one worklet, live-switchable via `audioMode`: **body** (48 modal resonators) and **timebase** (45 s reservoir, 5 lag-controlled heads). Plumbing restored from `audio-v1` with its latent bugs fixed. |
| audio fb layer | The first phase's feedback/smear layer ported intact (`audioFeedback` + `audioFbDecay`; wobble from `driftY`): 0.35 s modulated delay on the engine output. Clears optional (`audioFbClear`, off) with a smooth fade (`audioFbClearS`). |
| verdict | **Body won** (John, on live browsing: body + continuous exciter + smear). Timebase engine, `audioMode`, and its knobs removed; the two-engine state is tag `audio-bakeoff`. DEFAULTS = John's live-iterated settings. Audio harness 25/25. |
| tainted-video mirror | The Phase 4 IOU paid: videos whose GL upload throws SecurityError (direct cross-origin src, no-cors — Instagram explore reel previews) recover via a detached `crossorigin` mirror element riding the DNR ACAO rule; page element untouched, mirror failure abandons as before. Harness check behind the :8439 gate. |
| Phase 5 — text mode | **Built, defaulted off, undecided.** First landed as caption-swapping between cards (the proposal's recommendation — complete at tag `text-swap`, its suite was 26/26); John then chose **scrambling, page-wide**: letters rearrange inside their own word, non-letters are barriers, `textMin` (default 12) is the navigability dial. Character-data writes only, self-invalidating records, restore on either toggle. Suite rewritten for the scramble grammar: 35/35. |
| audio detangle | **The visual sliders no longer reach the audio** (John's request: performing the video must never bend the sound). The smear's wobble left `driftY` for its own `audioFbWobble` (0–0.4, default 0 = the resting state unchanged); the optional clear rhythm left `resetMinS`/`resetMaxS` for `audioFbClearMinS`/`audioFbClearMaxS` (1/60). Harness asserts the detangle structurally (no visual key in the worklet's param surface) and behaviorally (the wobble knob moves the echoes). Audio suite 27/27 incl. live tier. |

Audio lineage: the first phase (spectral/granular sorting) was removed for
mirroring the pixel-sort grammar — tag `audio-v1`. The bake-off's two
engines came from a multiple-perspectives run (5 isolated probes, 5 blind
critics); body won on John's ears, and the losing timebase engine is tag
`audio-bakeoff`. The run's corrections are baked into the implementation —
see "The audio engine" in parameters.md.

**John's live-chosen settings are now the DEFAULTS** (2026-08-11): visual
feedback **off** (his final call — its knobs stay live-tuned: decay 0.906,
driftX −0.0025, driftY 0, reset
1–60 s, imageFps 6); audio fb on at fbDecay 0.999 with
**clears off** (`audioFbClear` — his call: the smear's gain < 1 is its own
decay, continuous sounds nicer; the video keyframe still clears), maxTaps 8,
body at sustain 12 / drive 1.0 / continuous exciter.

**Remaining:**

- **Phase 5 — text mode**: built and harness-verified, `textScramble` **off**
  by default (page-wide scrambling; `textMin` is the navigability dial; the
  earlier swap design is tag `text-swap`). What remains is not code but
  John's call, and the proposal always said so: *"decide during install, in
  the room, with the actual wall behind it."* Flip it on in the panel and
  browse. The knob is a toggle because that decision was deferred, not
  because the mode is unfinished.
- **Floated, undecided (John, 2026-08-12): a separate CSS-scramble toggle**
  — deforming the page's own stylesheets as a distinct layer. Not built;
  needs a feasibility read first (cross-origin stylesheets are the
  question). Log the verdict here when it's taken up.
- **Phase 6 — kiosk hardening + soak**: not started. Chrome for Testing at a
  pinned version (branded Chrome ≥137 removed `--load-extension`), template
  profile restored nightly via launchd (doubles as the consent-signage
  session wipe), flags incl. `--autoplay-policy=no-user-gesture-required`
  (any audio work will need it to skip the first-gesture wait), `--start-fullscreen` vs
  `--kiosk` decision (popup panel conflicts with `--kiosk`), 72 h + 7-day
  soak, `kiosk-setup.md` written well enough to build the cold spare from.

For a full technical description of both pipelines — the GL sort/composite
path and the resonant-body audio path, with the reasoning behind each —
see [how-it-works.md](how-it-works.md).

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
│   ├── text-scramble.js           # optional text mode: letters rearranged inside words (off)
│   ├── overlay.js                 # sibling canvas; object-fit/position replication
│   └── metrics.js                 # FrameGovernor (rVFC presentedFrames deltas)
├── gl/  context.js · pipeline.js · shaders/{common,passthrough,composite,sort}.js
├── audio/ graph.js · worklet.js · dsp.js · fft.js   # worklet = body engine + smear layer
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
  DSP) + tier 2 (body engine + feedback layer through OfflineAudioContext)
  are fully deterministic, 18 checks; tier 3 ("run live tap tests" button)
  adds 9 live-tap checks incl. tap permanence and re-tap reuse. Last full
  run: 27/27. Unlike the visual suite it is immune to pane visibility
  (offline rendering).
- Text suite: `http://localhost:8437/test/harness/text.html` — 35 checks,
  pure DOM (no rVFC, no GL, no AudioContext), so it is deterministic and
  likewise immune to pane visibility. Tier 1 checks the scramble grammar as
  a pure function (glyph conservation, barrier integrity, grapheme
  handling); tier 2 drives the module page-wide against a synthetic
  document (prose, navigation, form values, live CSS, contenteditable);
  tier 3 asserts the registry calls it on the sweep, both toggles, and the
  debounced `textMin` drag. Last run: 35/35.
- Extension: chrome://extensions → Load unpacked → `source/`. Reload after
  edits; Chrome writes `source/_metadata/` (gitignored).
- Proof-of-interception tricks: invert/hide `canvas[data-deflection]`;
  `__deflection.registry.stats()` from the DEFLECTION console context
  (route counters, audio tap counts, swapped-caption count).

## John's manual checklist (needs real Chrome; not yet all exercised)

- Visual suite re-run in real Chrome (the embedded pane starves rVFC and
  can't adjudicate it — verified identical at baseline).
- Audio plumbing: page mute/volume through the chain; a cross-origin-audio
  site stays untouched w/ console log; MIDI sweep.
- Visual: fullscreen/theater tracking, 5× SPA navigation canvas-leak check,
  DRM trailer untouched, 30-min GPU-memory flatness (rides Phase 6 soak).
- Text mode — **the aesthetic call is the only thing left**: flip
  `textScramble` on and browse, and ride `textMin` up and down. The grammar
  is covered by the synthetic suite, and the write mechanism was checked
  against live YouTube (zero childList mutations from a `nodeValue` write,
  no Polymer revert within 2 s — see site-notes). What remains for real
  Chrome is a signed-in home feed and an Instagram feed: watch for text
  flickering between real and scrambled on re-render, confirm typing in
  search stays clean, and confirm the toggle and Ctrl+Shift+D put
  everything back.

## Conventions

- Vanilla JS ES modules, no bundler, no dependencies. GLSL as template
  literals; any DSP as pure chrome-free modules (that's what makes it testable).
- Every phase/iteration = one commit, made only after its harness gate runs.
  Commit messages explain the *why* and record verification results.
- documentation/: parameters.md (knobs, shader/DSP mapping, MIDI),
  site-notes.md (per-site quirks), this file (plan/status/handoff).
