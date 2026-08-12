# DEFLECTION — browser extension (art installation)

Chrome MV3 extension that intercepts every video frame, image, and sound in
the browser and rearranges it (GPU pixel sorting; audio through a fixed
resonant body + smear layer). Paik's *Magnet TV* for the web: the bytes
arrive perfect, the rendering bends.

**Read [documentation/build-plan.md](documentation/build-plan.md) first** —
it is the handoff document: current status (all committed work is
harness-verified), architecture map, the list of hard-won corrections (do not
relearn those), dev workflow, and what remains.

**The audio design is settled** (bake-off verdict, 2026-08-11): the body
engine, continuously driven, smeared by a never-clearing feedback layer.
Two rejected designs live in tags — `audio-v1` (spectral sorting, mirrored
the pixel-sort grammar) and `audio-bakeoff` (the timebase engine, lost on
John's ears). Do not resurrect either.

Quick facts:

- Load unpacked from `source/`. Vanilla JS, no build step, no dependencies.
- Dev server for harnesses: `python3 test/serve.py` (no-store — plain
  http.server serves stale modules). Visual suite at
  `/test/harness/index.html` (needs a visible tab), audio suite at
  `/test/harness/audio.html` (deterministic offline tiers + live-tap button).
- Params live in chrome.storage.local; stored values beat code defaults —
  use the panel's "restore defaults" after changing DEFAULTS.
- Per-knob documentation: [documentation/parameters.md](documentation/parameters.md).
  Site quirks: [documentation/site-notes.md](documentation/site-notes.md).
- Discipline: one commit per verified iteration; run the relevant harness
  before committing; never break the page — every failure path must leave
  the original media untouched.
