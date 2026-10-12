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
knobs; merged, the wash sat ~20× over the direct sound. `audioBody` selects
**modal** (48 stretched partials, struck metal) or **comb** (three
recirculating lines, exactly harmonic, tube/spring) — **the A/B is open and is
John's call**; don't argue it in code. Two rejected designs live in tags —
`audio-v1` (spectral sorting, mirrored the pixel-sort grammar) and
`audio-bakeoff` (the timebase engine, lost on John's ears). Do not resurrect
either.

**The text mode is built and defaults ON** (`textScramble`, John's call
2026-08-12 — the decision the proposal deferred to the room): page-wide
word scrambling, letters never crossing a non-letter barrier, `textMin`
(8) as the navigability dial. John chose scrambling over the proposal's
swap design — the complete swap implementation is tag `text-swap`; don't
resurrect it unprompted, and don't argue the toggle on or off in code.

Quick facts:

- Load unpacked from `source/`. Vanilla JS, no build step, no dependencies.
- Dev server for harnesses: `python3 test/serve.py` (no-store — plain
  http.server serves stale modules). Visual suite at
  `/test/harness/index.html` (needs a visible tab), audio suite at
  `/test/harness/audio.html` (deterministic offline tiers + live-tap button),
  text suite at `/test/harness/text.html` (pure DOM, deterministic), panel
  suite at `/test/harness/panel.html` (pure DOM; drives the shipped panel in
  an iframe against a stubbed chrome.storage).
- Params live in chrome.storage.local; stored values beat code defaults —
  press the panel's **default** preset after changing DEFAULTS (it is never stored).
  Presets A/B/C (`presets`) are snapshots; a row double-click returns to the last-loaded one (`presetBase`).
- The panel is an instrument, not a form (rebuilt 2026-08-20): three sections
  behind dividers, sort and feedback knobs filed under **Video** (John's
  call), typed values that clamp and snap, double-click a row to restore one
  parameter, and a tooltip on everything. **Video and Audio each have three
  groups** (sort · feedback · engine; body · smear · engine — engines folded
  by default). **Labels are synth vocabulary for the stranger; keys never
  change** (storage, MIDI maps, docs), and every tip ends with its key.
  Rows, groups and hover copy live in `source/panel/defs.js`; **add a row
  there when you add a param, with its `group`** — the panel harness fails if
  a stored param has no row, a row has no tip, or a row leaves its group.
- How both pipelines actually work: [documentation/how-it-works.md](documentation/how-it-works.md).
  Per-knob documentation: [documentation/parameters.md](documentation/parameters.md).
  Site quirks: [documentation/site-notes.md](documentation/site-notes.md).
- **Release form is the browser extension** (John, 2026-10-12; options
  logged in build-plan.md — don't re-derive them). **Current stage is design
  iteration of the panel, and the yardstick is usability per Nielsen's ten
  heuristics** (John's copy: `~/Reference/Usability Heuristics/`). Read it
  before changing the interface; state the heuristic trade-offs you make.
- Discipline: one commit per verified iteration; run the relevant harness
  before committing; never break the page — every failure path must leave
  the original media untouched.
