# DEFLECTION — browser extension (art installation)

Chrome MV3 extension that intercepts every video frame, image, and sound in
the browser and rearranges it (GPU pixel sorting; audio through a fixed
resonant body + smear layer). Paik's *Magnet TV* for the web: the bytes
arrive perfect, the rendering bends.

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
  text suite at `/test/harness/text.html` (pure DOM, deterministic).
- Params live in chrome.storage.local; stored values beat code defaults —
  use the panel's "restore defaults" after changing DEFAULTS.
- How both pipelines actually work: [documentation/how-it-works.md](documentation/how-it-works.md).
  Per-knob documentation: [documentation/parameters.md](documentation/parameters.md).
  Site quirks: [documentation/site-notes.md](documentation/site-notes.md).
- Discipline: one commit per verified iteration; run the relevant harness
  before committing; never break the page — every failure path must leave
  the original media untouched.
