# CORRUPTION — Build Plan, Status & Handoff

## Context

CORRUPTION (Proposal B in [admin/DEFLECTION - proposal.md](../admin/DEFLECTION%20-%20proposal.md))
is an art-installation Chrome extension: Nam June Paik's *Magnet TV* restated
for the browser. The transmission arrives perfect; the apparatus of display
bends. It intercepts every video frame, image, and sound between decode and
output: pixels sort on the GPU; audio drives a fixed resonant body (48
stretched-partial modal resonators) whose output smears through a
recirculating delay. Nothing added, nothing lost, unreadable anyway.

Conceptually the project has grown from "codec-corruption aesthetic" into a
device that turns the live internet into a generative artwork with code
aesthetics. **The piece's resting state** (John, 2026-08-11; sweet spot
settled 2026-08-12): **temporal feedback on videos** — a fast decay
(0.81) smearing through a **half-blended facet flow field** (small slow
swirls, flowScale 2.5 / flowSpeed 0.045, every element seeded its own),
threshold 0.05 so true black still bars the sort, slow 30–60 s
keyframes — over **straight-sorted image stills**, with **page-wide text
scrambling ON at textMin 8** (the call the proposal deferred to the
room: made), plus **the body engine continuously driven + a
never-clearing audio smear** whose loop gain is its own decay. Visual
feedback is video only (`feedbackVideo` on) and owns every shaping knob;
images are always one-shot sorted stills (image feedback removed
2026-10-12). The audio smear is independent (`audioFeedback`), and since
the detangle no visual slider reaches it.

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
| split feedback | Visual feedback became **two toggles sharing one knob set**: `feedbackVideo` (**on** — the resting state flipped, John 2026-08-12) and `feedbackImage` (**off** — stills stay one-shot; the ticker rides this toggle alone). New shared defaults: driftY +0.0020 (upward), reset window 30–60 s. Visual suite +2 ticker checks (pane-immune). |
| dynamism 1/2 | **`temperature`** (stochastic pair-verdict inversion — the sort simmers instead of settling; hash keyed on the pair so every pass stays a permutation) and **`motionGate`** (pairs trade only where the motion trail — |frame − prev frame|, carried in accumulator alpha against a new per-bundle `prev` snapshot — clears the gate: damage follows the action, stillness heals). Both inert at 0, both barrier-preserving. New tier 0 in the visual harness: direct-pipeline micro-tests (static sources, pane-immune) pinning determinism, permutation, disorder persistence, and strict gate containment. |
| dynamism 2/2 — flow | **The pairing axis became a parameter.** `flowAmount` blends the sort's direction from vertical toward a curl-noise flow field (¼-res RG8 per bundle, rendered once per frame, quantized to the 8 integer offsets); `flowScale`/`flowSpeed` shape it. Pairs trade only when both endpoints agree on direction — flow seams are barriers — which is what keeps every pass a permutation along arbitrary streamlines. Tier 0 pins: bit-identity at 0, global conservation at 1, determinism at fixed field time, field evolution. |
| sweet spot | **John's settled defaults from live iteration** (2026-08-12): threshold 0.05, decay 0.81, flow ON at 0.5 in facets mode (scale 2.5, speed 0.045), temperature/motionGate parked at 0, **text scramble ON at textMin 8** — the room-call the proposal deferred, now made. Visual harness pins textScramble off for its own boot (it would scramble the suite's output). |
| flow seeds | **Each element is its own instrument** (John: "each element should be unique... not just offset, they're all also flowing exactly the same way"): per-job seeds derive five characters in the field shader — noise home, phase, morph rate, swirl size, handedness (half the magnets poled opposite). Seeds key to CONTENT, not element (rerolled on src change), because YouTube reuses one <video> across navigations. Pipeline stays pure (seed is an input); tier 0 18/18 incl. seed differentiation + conservation under any seed. |
| flow modes | The 8-direction facet grammar came back as a peer, not a casualty: `flowMode` selects **paths** (16 dithered sectors, curving — default) or **facets** (8 fixed sectors, anchored seams — the first cut, which John liked on sight). One field texture (continuous directions), two quantizers in the sort pass. Tier 0 16/16: facet determinism + global conservation + the two modes provably differ. |
| flow paths | The flow field's promise made good (John: "I would still like to see flow-field paths"): directions now quantize to **16 sectors with a per-pass dithered boundary** instead of 8 fixed ones. Fixed quantization anchored refusal seams and material pooled at them instead of rounding curves; with the boundary wandering (golden-ratio sweep, keyed on pass index so runs stay reproducible), average motion follows the true continuous angle — ribbons meander and curl. Field texture now stores the continuous direction; tier 0 still 13/13 incl. global conservation and bit-identity at 0. |
| audio: a process, not a synth | **The audio path got a conservation law.** John, 2026-08-13: "no discernible change of sound between 2 different videos… it was probably lost in translation that I wanted the audio effect to be *a process done to the audio*." Measured on the real worklet: envelope correlation with the source **0.22 avg, −0.01 on speech** — timbral contrast survived at 84%, so it was never colour, it was *time*. Two causes, both fixed: (1) the engine output was `sum(modes)` alone, so the input never appeared in the output — both engines now output `direct·x + bodyMix·resonant` and the bank is a **filter**; (2) the smear's single gain set both tail length *and* level, so at loop gain 0.95 the wash sat ~20× over the direct sound — `audioFbDecay` now owns the tail alone and `audioFbReturn` the level. New **comb** engine (`audioBody`) as a peer for the A/B John called for. Result: envelope correlation 0.94 both engines, 91% of a bright source's energy above 2.3 kHz (was ~0). Audio suite 34 auto + 9 live = 43/43, incl. a conservation check the suite never had. |
| audio detangle | **The visual sliders no longer reach the audio** (John's request: performing the video must never bend the sound). The smear's wobble left `driftY` for its own `audioFbWobble` (0–0.4, default 0 = the resting state unchanged); the optional clear rhythm left `resetMinS`/`resetMaxS` for `audioFbClearMinS`/`audioFbClearMaxS` (1/60). Harness asserts the detangle structurally (no visual key in the worklet's param surface) and behaviorally (the wobble knob moves the echoes). Audio suite 27/27 incl. live tier. |
| **named** | **The piece became CORRUPTION** (John, 2026-08-20): *if the signal is corrupting us, we take back power by corrupting the signal.* The rename covers the user-facing surfaces only — manifest name and description, panel title, harness titles, these documents. **Internal identifiers deliberately keep `deflection`** (John's call): `__deflection`, `data-deflection`, the `deflection-audio` worklet, the `[DEFLECTION]` log prefix. Every console trick in this file still works verbatim. The repo folder and `admin/DEFLECTION - proposal.md` keep their names too — the proposal is the archival record of what was proposed. |
| panel rebuild | **The panel became an instrument** (John, 2026-08-20). A global block (`enabled`, `tooltips`, the defaults buttons), then four sections behind dividers — Video / Images / Text / Audio, with the sort+feedback knobs that video and images share filed under **Video** (John's call over giving them sections of their own). Numeric readouts became **editable fields**: typed values track the knob live, clamp to the range and snap to the step. **Double-click a row** restores that one parameter. **`set defaults`** captures the live panel as the default set (storage `userDefaults`), so a configuration found by ear during install becomes the resting state with no source edit; **`clear saved`** drops it back to `params.js`. A **tooltip layer** explains every control, toggled by `tooltips` (default on). New suite: `test/harness/panel.html`, 62/62. |

Audio lineage: the first phase (spectral/granular sorting) was removed for
mirroring the pixel-sort grammar — tag `audio-v1`. The bake-off's two
engines came from a multiple-perspectives run (5 isolated probes, 5 blind
critics); body won on John's ears, and the losing timebase engine is tag
`audio-bakeoff`. The run's corrections are baked into the implementation —
see "The audio engine" in parameters.md.

**John's live-chosen settings are now the DEFAULTS** (2026-08-11; sweet
spot 2026-08-12): **video feedback on** (images: one-shot stills) (decay 0.81,
threshold 0.05, driftX −0.0025, driftY +0.0020, reset 30–60 s, flow at
0.5 in **facets** mode, scale 2.5, speed 0.045, temperature and motion
gate at 0, text scramble ON at textMin 8); audio fb on at fbDecay 0.999 with
**clears off** (`audioFbClear` — his call: the smear's gain < 1 is its own
decay, continuous sounds nicer; the video keyframe still clears), maxTaps 8,
body at sustain 12 / drive 1.0 / continuous exciter.

**Audio defaults moved 2026-08-13** with the rework above: `audioBody` modal,
`audioDirect` 1, `audioBodyMix` 1, `audioFbReturn` 0.25, `audioCombDamp` 0.45.
These are measured starting points, **not John's ears yet** — the A/B and the
balance are the open item below. The previous sound is exactly reachable at
`audioDirect` 0 + `audioFbReturn` 1, which is how to compare.

**Remaining:**

- **Audio A/B — the aesthetic call, open.** The rework is built and
  harness-verified; what the numbers cannot settle is which apparatus wins and
  where the balance sits. In real Chrome: browse a talking-head video and a
  music video back to back, flip `audioBody` modal ↔ comb (modal = struck
  metal, comb = tube/spring), and ride `audioBodyMix` and `audioFbReturn`.
  The specific risk to listen for is **coherence over a long session**: making
  the bank a filter dropped lattice salience 25 → ~6.6 (raw audio is 5.6), so
  the fixed chord that unified eight hours is largely gone. If it stops
  cohering, the fallback is a fixed transmission colour (a permanent EQ
  signature — resonant peak, notch, band limit) which adds identity at no cost
  to specificity because it ignores content entirely. Log the verdict here.
- **Phase 5 — text mode**: built, harness-verified, and **decided**:
  `textScramble` defaults ON at `textMin` 8 (John, 2026-08-12 — the call
  the proposal deferred to the room). The earlier swap design remains tag
  `text-swap`; the toggle remains for performance and for the kill switch.
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
- **Packaging — decided (John, 2026-10-12): the standard browser extension
  stays the release form.** The options were weighed once, in chat, and had
  never been written down; this is the record so they aren't re-derived.
  What any host has to supply: the CORS rewrite (`rules/cors-media.json`
  keeps canvases and audio taps untainted — leave the extension model and
  this becomes a proxy, i.e. the rejected Proposal A), WebGL2 with float
  colour buffers, and AudioWorklet on cross-origin media.

  | Form | What it is | Mobile | Cost |
  |---|---|---|---|
  | Chrome extension (current) | Web Store or sideload; the kiosk form | no | built |
  | Firefox port | same MV3 code, manifest tweaks | Android (add-ons) | days |
  | Safari web extension | Xcode converter wraps `source/` in a Mac/iOS app | iPhone/iPad | days + review |
  | Electron shell | own Chromium, extension loaded; DNR unsupported → header hook | no | 1–2 weeks |
  | Tauri / WKWebView app | system webview, injected scripts, own proxy for CORS | iOS/Android | longest; Phase 6 redone |

  The bounded-app case was interface control; John chose to keep the
  extension and put that effort into the extension's own UI instead. If
  mobile comes up again, the cheapest probe is the Safari conversion (same
  source; the open question is the media tap under Safari). Nothing here
  reopens unprompted.
- **Next stage — design iteration (John, 2026-10-12).** The work after
  packaging is the interface. **Primary goal: usability**, as defined by
  Nielsen's ten heuristics — John's working copy is
  `~/Reference/Usability Heuristics/nielsen-usability-heuristics.md` (also
  in Dropbox at the same path), read it before touching the panel. Its
  framing for this project: the heuristics are lenses, not a checklist;
  they conflict (status vs minimalism, control vs error prevention,
  flexibility vs consistency) and the trade-offs are made on purpose and
  stated; severity outranks count. Hold each panel change against the
  ten-question pass at the end of that document. Expect the UI work to
  feed back into the effects themselves — refinements and possibly new
  layers will surface from designing the controls; log those as they
  appear rather than folding them silently into panel commits. The
  CSS-scramble toggle above is the first candidate in that queue.

  **Who the user is (John, 2026-10-12): the stranger, not John.** The
  panel was built for John tuning a preset he could leave on a kiosk and
  forget. That framing is retired. The piece is now **an instrument, and
  the interactivity is integral to it**: the person who installed it from
  the store, or walked up at an art crawl, is meant to play it, with no
  mental model of sort passes or resonators. John's expert surface stays
  reachable but is the second user. Method, in order: (1) a Nielsen
  heuristic evaluation by several independent reviewers against the
  shipped panel, findings ranked by severity, logged in
  `documentation/design-review.md`; (2) a think-aloud test with real
  people on a fixed task list — John already holds first-hand observations
  from two art crawls, which go into that round as evidence that outranks
  the heuristics; (3) merge both into one ranked list, fix the painful
  items first, re-run the heuristic pass on the revised panel. The panel
  harness stays the regression net throughout. **Rounds 1 and 2 are done
  (2026-10-12)** and live in `design-review.md` with the order of work.
  Decisions taken there: **`feedbackImage` is removed** (John: pointless,
  always off); the user avatar is synth-literate, so instrument vocabulary
  is the target language; the four medium toggles and a large A/B get the
  top of the panel; Video and Audio each regroup into effect / effect /
  engine; a whole-video toggle is added. The feedback composite's
  brighter-wins rule is now an open effects question (M5), as is a
  source-following audio apparatus (M8). Comb body and gated exciter are
  removal candidates pending a deliberate A/B, John's call.
  **Global block redesign landed (M1, M2, M3, M7):** title line with the
  shortcuts, a large A/B on `enabled` (click latches, hold bypasses), four
  medium chips (new params `video`/`images`, gated in `registry.rebalance()`),
  presets original · A · B · C behind a save mode with ten-second undo,
  toolbar badge/title; the legacy `userDefaults` migrates to preset slot A.
  **M6 landed 2026-10-12:** image feedback is gone — its toggle, the image
  animation ticker and the two knobs only it read, the panel's Images
  section, and the visual suite's two ticker checks. Images are one-shot
  sorted stills; git history keeps the old path.
  **M4 + M8 UI landed 2026-10-12:** Video regrouped into sort · feedback ·
  engine and Audio into body · smear · engine (engines folded, `engineOpen`),
  labels in synth vocabulary with keys unchanged, an audio status line fed
  by `deflection:stats` messages, plus round-1 findings 6–10 (tips lead with
  what you see/hear and end with the key, in a bottom strip; inert rows name
  their gate; ⊙ hidden until a MIDI device; slider out of the double-click;
  clamps flash). The effects questions (M4's distortion handle, M5, M8's
  source-following apparatus) stay open.
  **Round 3 fixes landed 2026-10-12** (three heuristic reviewers): the A/B
  latches on any press under 600 ms and only a longer hold compares;
  *original* is now *default* under a PRESETS caption, base marked by a dot;
  the help strip rests at one line and grows over the rows on hover without
  reflow; mix leads the audio body, dry moved to the engine; save mode says
  *replace A*, a save-over can be undone, saving marks the base, cancelling
  flashes; loads and chips while OFF say *switch ON to see it*; chip jumps
  flash where they land (images → SORT); Video rows read *needs video* /
  *needs video or images*; the MIDI learn line hides with no device.

  **M9 prototypes built, pending John's choice:** the panel can open in its
  window (default), Chrome's side panel, or an in-page bottom strip, chosen
  by the panel preference `panelHome` (row "panel lives in"); see
  [parameters.md](parameters.md#where-the-panel-lives-panelhome-prototypes-pending-johns-choice)
  for what is verified and what needs a real Chrome. Strip suite:
  `test/harness/strip.html`.

For a full technical description of both pipelines — the GL sort/composite
path and the resonant-body audio path, with the reasoning behind each —
see [how-it-works.md](how-it-works.md).

## Architecture map

```
source/
├── manifest.json                  # MV3; DNR ruleset ENABLED (browser-wide ACAO on image/media)
├── rules/cors-media.json
├── background/service-worker.js   # opens the panel in its home (window / side panel / strip), image-fetch base64 fallback (route 3)
├── content/
│   ├── bootstrap.js               # classic script → dynamic import (content scripts can't be modules)
│   ├── main.js                    # boot, params flow, tiny-iframe early-exit
│   ├── params.js                  # DEFAULTS; chrome.storage.local is the single source of truth
│   ├── registry.js                # discovery (video/img/audio), caps, sweep, audio ranking
│   ├── video-job.js               # rVFC → GL pipeline; DRM gate; black-output probe; governor
│   ├── image-job.js               # 3-route CORS; one-shot stills
│   ├── audio-job.js               # playback-driven tap lifecycle; safety gate; bypass semantics
│   ├── text-scramble.js           # optional text mode: letters rearranged inside words (off)
│   ├── strip.js                   # M9 prototype: the panel as an in-page bottom strip (iframe of panel.html?layout=strip)
│   ├── overlay.js                 # sibling canvas; object-fit/position replication
│   └── metrics.js                 # FrameGovernor (rVFC presentedFrames deltas)
├── gl/  context.js · pipeline.js · shaders/{common,passthrough,composite,sort}.js
├── audio/ graph.js · worklet.js · dsp.js · fft.js   # worklet = body engine + smear layer
└── panel/ panel.html · panel.js · panel.css · midi.js  # extension page, popup window
    └── defs.js                    # the control table (sections, ranges, hover copy)
                                   # + the pure value helpers, shared with its harness
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
8. **Stored params beat code defaults**: after changing DEFAULTS, press
   **default** in the panel's preset row or the old values persist from
   storage. "default" (labelled "original" until round 3) is never stored,
   so it always reaches freshly edited code defaults. (Until 2026-10-12 a saved "set defaults" snapshot,
   `userDefaults`, stood in front of them; it now migrates to preset slot A.
   A row double-click returns to the last-loaded preset, `presetBase`.)
9. **An effect must be a process done to the audio, not a synth the audio
   drives.** The engine used to output `sum(modes)` — the input never appeared
   in the output — while the visual side is a permutation with harness-asserted
   conservation. Anything that resynthesises rather than filters will sound the
   same on every source; the tell is envelope correlation with the input, which
   was −0.01 on speech. Both engines now sum a direct path, and the harness
   gates that correlation.
10. **In a recirculating loop, decay time and wet level are not the same
    number.** A loop at gain *g* settles at ~`1/(1−g)` × its input, so the
    0.95 smear sat ~20× over the direct sound and erased whatever the engine
    preserved. Tail (`audioFbDecay`) and level (`audioFbReturn`) are separate
    knobs; don't re-merge them.
11. **Allpass dispersion does not stretch a comb's partials in the audible
    range** — measured at K = 0, 6, 12 sections, all identical (0.06–0.08% at
    partial 10 vs the modal table's 1.98%), because a first-order allpass only
    disperses near Nyquist. The comb engine is a peer with its own character,
    not a modal bank to be repaired. Don't re-try this.

## Dev workflow

```bash
python3 test/serve.py        # :8437, no-store + ACAO (mimics the DNR rule)
python3 test/serve.py 8439   # second origin for the image CORS-route test
```

- Visual/lifecycle suite: `http://localhost:8437/test/harness/index.html`
  (32 checks; +2 more with the :8439 server up for the cross-origin image
  route). **Must run in a visible tab** — hidden tabs starve frames and
  produce false timeouts (documented in harness header). Last full run
  **50/50 (2026-08-20, embedded pane, visible)**; 32/32 at 2026-08-12
  before the tier-0 additions. Two latent test bugs fixed
  that day: the disable check iterated `j.video` over image jobs (TypeError
  read as timeout since Phase 4), and the still-re-render check nudged
  `threshold` 0→0.05, which changes nothing now that the default is 0 —
  both were masked when global feedback animated images under the tests.
- Audio suite: `http://localhost:8437/test/harness/audio.html` — tier 1 (pure
  DSP, incl. the comb's tuning/decay/reset) + tier 2 (both engines + feedback
  layer through OfflineAudioContext) are fully deterministic, 34 checks; tier 3
  ("run live tap tests" button) adds 9 live-tap checks incl. tap permanence and
  re-tap reuse. Last full run: **43/43 (2026-08-13)**. Unlike the visual suite
  it is immune to pane visibility (offline rendering). Tier 2b is the set that
  matters most now: it pins **conservation** (`bodyMix 0` → the apparatus is a
  wire, corr 0.9999) and **envelope correlation ≥ 0.7** at the defaults, so the
  failure that produced "it sounds like a synth" can't recur silently.
- Text suite: `http://localhost:8437/test/harness/text.html` — 35 checks,
  pure DOM (no rVFC, no GL, no AudioContext), so it is deterministic and
  likewise immune to pane visibility. Tier 1 checks the scramble grammar as
  a pure function (glyph conservation, barrier integrity, grapheme
  handling); tier 2 drives the module page-wide against a synthetic
  document (prose, navigation, form values, live CSS, contenteditable);
  tier 3 asserts the registry calls it on the sweep, both toggles, and the
  debounced `textMin` drag. Last run: 35/35.
- Panel suite: `http://localhost:8437/test/harness/panel.html` — 62 checks,
  pure DOM and likewise pane-immune. Tier 1 is the control table and the
  value helpers as pure functions (every stored param has exactly one row,
  every row has hover copy, every numeric default sits on its own slider
  grid, clamping/snapping/format, how saved defaults resolve). Tier 2 drives
  the **shipped** panel inside an iframe: `panel-frame.html` *fetches*
  `source/panel/panel.html` rather than copying it, so the markup under test
  can never drift, and stubs `chrome.storage.local` so the suite reads
  exactly what the panel wrote. Last run: **62/62 (2026-08-20)**.
- Extension: chrome://extensions → Load unpacked → `source/`. Reload after
  edits; Chrome writes `source/_metadata/` (gitignored).
- Proof-of-interception tricks: invert/hide `canvas[data-deflection]`;
  `__deflection.registry.stats()` from the CORRUPTION console context
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
