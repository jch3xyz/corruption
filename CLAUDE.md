# DEFLECTION — browser extension (art installation)

Chrome MV3 extension that intercepts every video frame, image, and sound in
the browser and rearranges it (GPU pixel sorting, audio spectral/granular
sorting). Paik's *Magnet TV* for the web: the bytes arrive perfect, the
rendering bends.

**Read [documentation/build-plan.md](documentation/build-plan.md) first** —
it is the handoff document: current status (all committed work is
harness-verified through the audio pipeline), architecture map, the list of
hard-won corrections (do not relearn those), dev workflow, and what remains
(Phase 5 text swap is ON HOLD; Phase 6 kiosk hardening is next).

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
