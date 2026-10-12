# CORRUPTION — browser extension (art installation)

Chrome MV3 extension that intercepts every video frame, image, and sound in
the browser and rearranges it (GPU pixel sorting; audio through a fixed
resonant body + smear layer). Paik's *Magnet TV* for the web: the bytes
arrive perfect, the rendering bends. *If the signal is corrupting us, we
take back power by corrupting the signal.*

**Named CORRUPTION 2026-08-20** (was DEFLECTION). John's call: the rename
covers user-facing surfaces only — manifest, panel, harness titles, docs.
**Internal identifiers keep `deflection` on purpose** (`__deflection`,
`data-deflection`, the `deflection-audio` worklet, `[DEFLECTION]` logs), as
do the repo folder and the archival proposal in `admin/`. Don't "finish" the
rename in code unprompted.

**Read [documentation/build-plan.md](documentation/build-plan.md) first** —
it is the handoff document: current status (all committed work is
harness-verified), architecture map, the list of hard-won corrections (do not
relearn those), dev workflow, and what remains.

**The audio is a process done to the audio, not a synth it drives**
(reworked 2026-08-13 on John's report that two videos sounded alike). Both
engines output `direct·x + bodyMix·resonant`, so the source passes *through*
the apparatus — before this the output was `sum(modes)` alone and never
contained the input, which measured as −0.01 envelope correlation on speech.
The smear's tail (`audioFbDecay`) and level (`audioFbReturn`) are now separate
knobs; merged, the wash sat ~20× over the direct sound. `audioFollow`
(design review M8; 0 at rest = the fixed chord, bit-identical, follower
idle) retunes the chord toward the source's own pitch — only where the
body rings moves, the source still passes through. `audioBody` selects
**modal** (48 stretched partials, struck metal) or **comb** (three
recirculating lines, exactly harmonic, tube/spring) — **the A/B is open and is
John's call**; don't argue it in code. Two rejected designs live in tags —
`audio-v1` (spectral sorting, mirrored the pixel-sort grammar) and
`audio-bakeoff` (the timebase engine, lost on John's ears). Do not resurrect
either.

**The text mode is built and defaults ON** (`textScramble`, John's call
2026-08-12 — the decision the proposal deferred to the room): page-wide
word scrambling, letters never crossing a non-letter barrier, runs shorter
than `TEXT_MIN` (8, a constant since John retired the `textMin` slider on
2026-10-11) left alone for navigability. John chose scrambling over the proposal's
swap design — the complete swap implementation is tag `text-swap`; don't
resurrect it unprompted, and don't argue the toggle on or off in code.

Quick facts:

- Load unpacked from `source/`. Vanilla JS, no build step, no dependencies.
- Dev server for harnesses: `python3 test/serve.py` (no-store — plain
  http.server serves stale modules). Visual suite at
  `/test/harness/index.html` (a visible tab, or headless:
  `node test/headless.mjs index`), audio suite at
  `/test/harness/audio.html` (deterministic offline tiers + live-tap button),
  text suite at `/test/harness/text.html` (pure DOM, deterministic), panel
  suite at `/test/harness/panel.html` (pure DOM; drives the shipped panel in
  an iframe against a stubbed chrome.storage).
  Strip suite at `/test/harness/strip.html` (mock video page; mounts the
  in-page bottom strip directly, no extension needed). **Run the pure-DOM
  suites headless: `node test/headless.mjs panel strip text audio`** — a
  background tab in the app's browser pane reports hidden and fails checks
  for nothing.
- Params live in chrome.storage.local; stored values beat code defaults —
  press the panel's **default** preset after changing DEFAULTS (it is never stored).
  Presets A/B/C (`presets`) are snapshots; a row double-click returns to the last-loaded one (`presetBase`).
- The panel is an instrument, not a form (rebuilt 2026-08-20): two sections
  (Video, Audio) behind dividers, sort and feedback knobs filed under
  **Video** (John's call), typed values that clamp and snap, double-click a
  row to restore one parameter, and a hover bubble on everything (nothing
  at rest). **Video has four groups (sort · feedback · where · engine),
  Audio three (body · smear · engine), and each effect group holds only
  its handles** (John's handles round, 2026-10-12): sort
  = amount · sort by (`sortKey`, round 8: the ordering key; the barrier
  stays on luma) · direction (`angle`, degrees clockwise from up, a
  **knob**) · flow · jitter · ribbons — exactly the mixer's eight cells; feedback = the switch · trail · drift
  pad · blend · blend amount (`feedbackBlend`/`feedbackMix`); where (round
  8 part 3, group id `gate`) = the gates, each a condition both pixels must
  meet, stacking, all inert at 0: follow motion (`motionGate`, still gated
  by feedback — it reads the trail) · edges (`edgeGate`, from the CLEAN
  frame's edge map) · span (walls along the sort direction) · soft barrier
  (`barrierSoft`); five effect columns, in view from 1440 px, the lane
  scrolling sideways at 1280;
  body = mix · body amount · follow · ring time · drive; smear = the switch · tail ·
  level · wobble. Everything that shapes rather than
  steers is in the **engines**, folded by default (Video: clear buffer —
  `keyframe`, a **trigger** row, a counter the button writes up by one,
  never in a preset — then sort passes, max res, max videos, the flow's
  shape, the clear rhythm; Audio: body type,
  dry, max sources, exciter, comb damp, the smear clears). Gates are keyed,
  not grouped. **Three control forms the table drives:** **amount** is
  `threshold` shown inverted (`invert: true`, `toView`/`fromView`; the
  stored key, presets and MIDI maps stay `threshold`), and **the drift
  pad** plays `driftX`/`driftY` as one 2-D surface (`pad: 'drift'`,
  `PADS`), and **the knob** plays `angle` as a rotary (`type: 'knob'`,
  `wrap: true`: 0–359, wrapping; `settle` in defs.js). **The four chips are the four masters** (video, images, text,
  audio — text has no knobs). **Gated rows hide**, they do not grey.
  **Labels are the stranger's words, named for the result; keys never
  change** (storage, MIDI maps, docs), and every tip ends with its key.
  Rows, groups and hover copy live in `source/panel/defs.js`; **add a row
  there when you add a param, with its `group`** — the panel harness
  fails if a stored param has no row, a row has no tip, or a row leaves
  its group.
- **The panel's layout follows its shape, in every home** (2026-10-12):
  the **rail** (one transport line), the **mixer** (a cluster plus the
  effect columns) or the **column**. The strip's frame is always the mixer,
  or the rail when 40 px tall; the window and side panel are the mixer at
  ≥ 900 px wide and 2:1, else the column (the layout value is `mixer`; the
  strip is a home). The **window** — responsive by shape, remembering its
  bounds (`panelBounds`) — **is the default home** (John, 2026-10-12, after
  both were built); the **strip** — a 40 px rail with the CORRUPTION tab, a
  240 px mixer — is opt-in under *panel lives in*. The default lives in
  `defs.js`, the service worker and `initStrip`; the harness checks they
  agree. MIDI is a feature, not the primary mode: its block hides until a
  device; the window and side panel ask at boot, **the strip only when
  its MIDI… button is clicked** (the host page's permissions policy
  answers a frame's request).
- How both pipelines actually work: [documentation/how-it-works.md](documentation/how-it-works.md).
  Per-knob documentation: [documentation/parameters.md](documentation/parameters.md).
  Site quirks: [documentation/site-notes.md](documentation/site-notes.md).
- **Version.** `source/manifest.json`'s minor number is the design-review
  round in progress (0.8.x during round 8), the patch number counts fixes
  inside a round, 1.0.0 is the first release form put in front of
  strangers. Bump with a round's first commit.
- **Release form is the browser extension** (John, 2026-10-12; options
  logged in build-plan.md — don't re-derive them). **Current stage is design
  iteration of the panel, and the yardstick is usability per Nielsen's ten
  heuristics** (John's copy: `~/Reference/Usability Heuristics/`). Read it
  before changing the interface; state the heuristic trade-offs you make.
- Discipline: one commit per verified iteration; run the relevant harness
  before committing; never break the page — every failure path must leave
  the original media untouched.
