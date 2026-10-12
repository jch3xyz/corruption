# Parameters

Every effect parameter, its range, and what it does. This doubles as the
MIDI mapping sheet — tape it to the desk during install. All values live in
`chrome.storage.local`; the panel writes them, every tab follows within a
frame or two.

Open the panel: click the toolbar icon, or Ctrl+Shift+P.
Kill switch: Ctrl+Shift+D toggles `enabled` without the panel.
How the panel itself works — sections, typed values, saved defaults,
tooltips — is [below](#the-panel).

| Param | Default | Range | What it does |
|---|---|---|---|
| `enabled` | on | on/off | Master switch. Off restores every video/image untouched. |
| `feedbackVideo` | **on** | on/off | Temporal feedback on videos — **the resting state** (John, 2026-08-12; previously off): smear accumulates, drifts, decays, clears at slow 30–60 s keyframes. Off = straight per-frame pixel sorting. |
| `threshold` | **0.05** | 0–1 | Luma above this is eligible for sorting (and feedback). Near-zero corrupts almost everything while true black holds as a barrier; 1 = untouched. The single most expressive knob. |
| `passes` | **64** | 0–64 | Sort passes per frame. A full 256→1 stride ladder is 18 passes, so 64 runs ~3.5 settling cycles. |
| `streak` | **256** | 1–256 | Longest compare-exchange stride (rounded down to a power of two). Directly sets how far pixels can travel per frame — the ribbon-length knob. 1 = classic single-step odd-even. |
| `temperature` | **0** | 0–0.5 | Fraction of pair-verdicts inverted per pass. The sort simmers at its equilibrium instead of settling into it: ribbons boil at their edges and the picture never comes to rest. Applies in straight sort and feedback alike; barriers still hold (the boil stays inside bright spans). 0.5 = a pure random walk, no net sorting. |
| `motionGate` | **0** | 0–1 | *Video feedback only.* A pair may only trade when BOTH members' motion trail clears this, so damage stays strictly inside what the transmission itself is changing: action smears, stillness holds and heals. The trail decays ~1 s; each keyframe floods it hot, so a reset briefly sorts everywhere before confinement returns. 0 = sort regardless of motion. |
| `flowAmount` | **0.5** | 0–1 | **The resting state flows** (John's sweet spot, 2026-08-12). 0 = the classic vertical grammar, bit-identical. Up = sorting follows a slowly morphing **curl-noise flow field**: ribbons meander and curl along streamlines instead of climbing columns. Directions quantize to 16 sectors with a per-pass dithered boundary, so material rounds curves instead of pooling at fixed seams. Still a permutation — nothing added, nothing lost, harness-pinned. **Every element draws its own seed, rerolled when its content changes** (a new video in YouTube's reused player is new content): pattern, phase, morph rate, swirl size, and handedness all differ per medium — no two screens show the same corruption, and no knob controls this (it is identity, not a parameter). |
| `flowMode` | **facets** | paths / facets | *Flow only.* Two quantizers, both kept (John liked both; facets is his resting pick). **facets**: 8 fixed sectors, no dither — straight runs inside each patch, pooling at anchored seams where the field bends. **paths**: 16 sectors, boundary dithered per pass — seams wander, material rounds curves, ribbons meander. |
| `flowScale` | **2.5** | 1–12 | *Flow only.* Noise cells across the frame: higher = tighter, busier swirls; lower = broad sweeping currents. |
| `flowSpeed` | **0.045** | 0–0.2 | *Flow only.* How fast the field morphs (streamlines re-carve in place rather than marching). 0 = frozen geometry — flow without evolution. |
| `decay` | **0.81** | 0.8–0.999 | *Video feedback only.* Accumulator retention per frame. Higher = smear lingers longer. |
| `driftX` | **−0.0025** | ±0.01 | *Video feedback only.* Horizontal smear, UV units per frame (negative = leftward). |
| `driftY` | **0.0020** | ±0.01 | *Video feedback only.* Vertical smear; **positive = upward** — the resting state climbs gently. Purely visual — the audio wobble it used to drive is now `audioFbWobble`. |
| `resetMinS` / `resetMaxS` | **30 / 60** | 1–30 / 2–60 | *Video feedback only.* Keyframe rhythm: the accumulator resets to a clean frame at a random interval in this window. Slow by default — damage accumulates for half a minute or more before clearing. |
| `maxRes` | 1920 | 480–1920 | Processing resolution cap, long axis. Lower it on weak GPUs; output upscales through the overlay. |
| `maxVideos` | **12** | 1–16 | Concurrent video jobs, biggest visible first. Paused videos count too — they get a one-shot sorted still (rVFC never fires for them). Raised from 8 for grid feeds (Instagram explore) where a dozen previews are on screen at once. |
| `textScramble` | **on** | on/off | The text mode — **on in the resting state** (the call the proposal deferred to the room; John made it 2026-08-12). Letters rearrange inside each word, page-wide; anything that isn't a letter (space, punctuation, digit, emoji) is a barrier no glyph crosses, so every word keeps its length and the page keeps its shape. Off restores every run. |
| `textMin` | **8** | 1–40 | *Text only.* Shortest run of text that scrambles. At 8 (John's setting) prose and most labels dissolve while the shortest furniture (Home, OK) survives — the navigability dial. |
| `audioEnabled` | on | on/off | Audio master. Off ramps every tap to dry — the tap itself is permanent by design. |
| `audioMix` | 1 | 0–1 | Wet/dry in the tap graph (30 ms ramps). 0 = the internet as transmitted. Distinct from `audioDirect`, which is inside the DSP. |
| `audioBody` | **modal** | modal / comb | Which apparatus the signal passes through. **modal** = the 48 stretched partials, struck metal. **comb** = three recirculating lines on the same fundamentals, exactly harmonic — tube/pipe/spring, and about a tenth of the cost. The A/B John called for (2026-08-13); the character difference is inherent, not a defect (see below). |
| `audioDirect` | **1** | 0–1 | Direct signal level *inside* the DSP: both engines sum their resonant part with this, so the source passes through the apparatus instead of only driving it. **0 = the pre-2026-08-13 behaviour**, where the output never contained the input and every video sounded alike. |
| `audioBodyMix` | **1** | 0–2 | Resonant part against the direct path — the identity dial. Up for more fixed voice, down for more of the video. Making the bank a filter costs lattice salience (25 → ~7 measured, raw audio being 5.6); this is the knob that buys some back. |
| `audioCombDamp` | **0.45** | 0–0.9 | *Comb only.* Loop lowpass: the comb's version of "higher partials die faster". Low = metallic and bright, high = woody and dark. |
| `audioFeedback` | **on** | on/off | The smear: the engine's output recirculates through a 0.35 s delay line (0.1 Hz wobble, tanh-clipped write-back), continuously — see `audioFbClear`. |
| `audioFbDecay` | **0.999** | 0.8–0.999 | *Audio fb only.* The smear's **tail length** — and only that since 2026-08-13. Maps to loop gain 0.5–0.95, the visual `decay` knob's range, so it feels like the same knob. |
| `audioFbReturn` | **0.25** | 0–1 | *Audio fb only.* How loud the wash sits, as a **fraction of the loop gain**. Tail and level used to be one number, which is why nothing survived it: at loop gain 0.95 the wash settles ~1/(1−g) ≈ 20× above whatever just arrived and buries it. **1 = the old behaviour exactly.** Measured: dropping to 0.25 takes envelope correlation with the source from 0.22 to 0.89 with the 47 s tail untouched. |
| `audioFbWobble` | **0** | 0–0.4 | *Audio fb only.* Delay wobble depth — the tape-warble on the echo stack. **0 = no wobble, a static echo stack** (the resting state). Until 2026-08-12 this rode the visual `driftY` slider; detangled so performing the video never bends the sound. |
| `audioFbClear` | **off** | on/off | *Audio fb only.* Whether the smear clears on its own `audioFbClearMinS`/`audioFbClearMaxS` rhythm at all (its own window since 2026-08-12 — the visual `resetMinS`/`resetMaxS` no longer reach the audio). **Off is the piece**: the loop gain (< 1) is already a natural decay, so unlike the video accumulator the smear needs no clearing — it stays continuous. |
| `audioFbClearS` | 1 | 0–4 | *Audio fb clear only.* When clearing is on, the keyframe fades the wash out over ~this many seconds before the line wipes, instead of cutting in one sample. **0 = the original hard cut.** The video keyframe stays a hard cut by design — one frame hides in a glitching image; a vanished wash doesn't. |
| `audioFbClearMinS` / `audioFbClearMaxS` | 1 / 60 | 1–30 / 2–60 | *Audio fb clear only.* The smear's own keyframe window: when clearing is on, the wash clears at a random interval in this range — the audio sibling of the visual `resetMinS`/`resetMaxS`, and no longer the same sliders. |
| `audioMaxTaps` | **8** | 1–8 | Concurrent *engaged* taps, most recently playing first — the audio sibling of `maxVideos`. Everything safe gets tapped; beyond the cap, elements play dry (idle processors cost ~nothing). Matters on feed pages with several sounding videos; each engaged tap is its own worklet. |
| `audioSustain` | **12** | 2–12 | T60 at the lowest string (55 Hz), seconds. Higher modes always die faster ((55/f)^0.7) — the ring-length knob. |
| `audioDrive` | **1.0** | 0–1 | Strike force into the resonators. Per-mode caps bound runaway, so drive shapes attack more than loudness. |
| `audioExciter` | **continuous** | gated / continuous | **Continuous is the piece**: the stream drives the body always, bounded by resonz normalization and per-mode caps. Gated = onsets open a 60 ms window and the body is *struck* instead. |

## The audio engine — a process done to the audio (reworked 2026-08-13)

Both engines now output `direct·x + bodyMix·resonant`. **The source passes
through the apparatus rather than merely driving it**, which is the whole
change: until 2026-08-13 the output was `resonant` alone, a resynthesis on a
fixed 48-line basis that never contained the input. The video side is a
permutation with harness-asserted conservation; the audio side had no
conservation law at all, and that asymmetry is what made every video sound
like the same synth.

Measured before the change (four dissimilar 10 s probes, real worklet run
offline): envelope correlation with the source **0.22 average — −0.01 on
speech**, i.e. the output's loudness contour was statistically unrelated to
the video's. Third-octave timbral contrast survived at 84%, so colour was
never the problem; *time* was. Output energy above 2.3 kHz was 1.5%, because
the bank tops out at 2310 Hz and its 48 modes accept 54.3 Hz of the 24 kHz
band — 0.23%. After: envelope correlation 0.94 (harness-asserted, both
engines), 91% of a bright source's energy above 2.3 kHz.

**modal** — 48 modal resonators, three just-intonation fundamentals
(55/82.5/137.5 Hz) × 16 stretched partials (`f_k = k·f₀·√(1+4e-4k²)`). The
stretch is what makes it read as a struck object. Continuous excitation uses
constant-peak-gain (resonz) normalization so the stream excites only its
sympathetic partials; gated excitation is impulse-normalized so strikes ring.

**comb** — three recirculating lines on the same fundamentals, same `sustain`
meaning (loop gain `g = 10^(−3·D/t60)`), one-pole damping in the loop, tanh on
the write-back. Its partials are **exactly harmonic** and that cannot be fixed:
allpass dispersion was measured at K = 0, 6 and 12 first-order sections and
moved them identically (0.06–0.08% at partial 10, where the modal table gives
1.98%), because a first-order allpass only disperses near Nyquist. So the comb
is a peer with a different character — tube/pipe/spring — not a broken modal
bank. It rings harder (lattice salience ~12 against the filtered modal bank's
~6.6) and costs about a tenth as much per sample.

Identity lives in the apparatus: tuning is fixed in source and never on a knob.
Latency ≈ 0 — the sound coincides with the visual event.

The losing **timebase** engine (a 45 s reservoir read by lag-controlled
heads) is preserved at tag `audio-bakeoff` with its harness checks — judged
on live browsing, removed 2026-08-11.

The feedback layer smears the engine's output continuously — its loop gain
(< 1) is a built-in decay, so unlike the video accumulator it never needs a
clear to stay clean. **Its tail and its level are now two knobs**
(`audioFbDecay` / `audioFbReturn`): one number used to set both, and at loop
gain 0.95 the wash settles ~20× over the direct sound, which erased whatever
the front end preserved. At high `audioFbDecay` the tail can still outlive
input by tens of seconds; the output gate at the floor is what keeps
silence-in/silence-out honest, and `audioFbClear` restores the keyframe
rhythm if the piece ever wants it back.

Rules the implementation lives by: safety is predicted before tapping
(same-origin / blob / data / MediaStream / `crossorigin="anonymous"` only);
taps are permanent, disable is a gain bypass; every input sample is
finiteness-checked before recursive state; the output gate snaps to exact
zeros once input is absent and the engines reach the floor; `process()`
never throws (a dead processor is permanently silent media).

## The text mode (`textScramble`, ON in the resting state)

The sorting grammar applied to language, page-wide. Letters rearrange
**inside their own word**; anything that isn't a letter — space,
punctuation, digit, emoji — is a barrier no glyph crosses, exactly as
sub-threshold pixels refuse to be traded through in the sort shader. Word
count, word lengths, and every mark stay where they were: the page keeps
its shape and loses its sense. Nothing added, nothing lost, unreadable
anyway.

(John's calls, 2026-08-12, superseding the proposal's recommendation: first
scrambling over swapping-between-cards — the swap version is complete at
tag `text-swap` — then the whole page over captions-only.)

Reach is one dial, `textMin`: only runs of at least that many characters
scramble. The proposal's worry about scrambling — an unreadable interface
is an unnavigable one — is answered by that dial rather than by a
containment rule: interface labels are short, prose is long, and 12 sits
comfortably between them. Search inputs survive at any setting because
form *values* aren't text nodes — the one lifeline that is free.

What never scrambles, regardless of `textMin` (these are data-loss, not
aesthetics): `script`/`style` (live CSS — scrambling it wrecks layout
rather than bending rendering), `input`/`textarea`/contenteditable (the
visitor's own words, which a site might save), `aria-hidden` text, and
media fallback text.

Grapheme-aware: a combining accent travels with its base letter. Records
are per-text-node and self-invalidating — a node the site re-renders is
dropped, never restored over live content. Turning the mode off — or the
`enabled` kill switch — puts every run back.

## Image pipeline (Phase 4)

Every on-screen `<img>` ≥48 px gets a sorted still (re-rendered when the
effect params change; the panel debounces at ~200 ms). The texture source
resolves through three routes, counted in `__deflection.registry.stats().images`:

1. **direct** — same-origin or already CORS-clean (Wikipedia, YouTube
   thumbnails).
2. **cors** — a detached `crossorigin` re-fetch; works because the
   extension's declarativeNetRequest rule sets `Access-Control-Allow-Origin: *`
   on image/media responses **browser-wide while the extension is enabled**.
3. **sw** — bytes fetched by the service worker, returned as a base64 data
   URL (rare; signed CDNs that reject Origin-bearing requests).

All three fail → the image is left untouched. The page's own `<img>` src is
never mutated. Videos also carry a black-output probe: 2 consecutive black
reads (2 s apart) while playback advances → the original shows through;
recovers automatically when real content returns.

## Shader mapping

- `threshold` → `uThreshold` in the sort pass (both members of a compare
  pair — plus the span midpoint at strides > 1 — must exceed it, so dark
  pixels are barriers and sorting stays inside bright spans) and in the
  composite mask when feedback is on.
- `streak`/`passes` → the stride ladder in `runSortPasses`: two passes per
  stride level (both parities), largest power of two ≤ `streak` down to 1,
  cycled until the pass budget is spent.
- `decay` → `uDecay`, `driftX/Y` → `uDrift`. The composite keeps
  `kept = max(history * decay, incoming)` wherever `luma(kept)` clears the
  threshold — masking on the kept value (not incoming, as the proposal's
  sketch had it) is what lets smear persist past the frames that caused it
  and self-clear as it decays below threshold.
- Sort direction is fixed: bright rises toward the video's top.

## Adaptive governor (metrics.js)

Per-video. When rVFC reports dropped frames for ~15 consecutive callbacks,
it steps down: first halves `passes` (floor 2), then processing resolution
×0.75, then ×0.5. After 10 s clean it steps back up. You'll see softer
resolution before you ever see judder. It never touches storage — the panel
always shows your requested values.

## The panel

Rebuilt 2026-08-20 for performing rather than for reading source. Three
sections under a global block, and the whole thing explains itself on hover.

**Layout.** The global block at the top is `enabled`, the `tooltips` switch,
and the two defaults buttons — everything that governs all four mediums at
once. Below it, a divider and a left-aligned title open each section:
**Video**, **Text**, **Audio**. (An **Images** section held the image
feedback rows until image feedback was removed, 2026-10-12.)

The sort knobs genuinely belong to video *and* images — one shader, two
callers — and John's call (2026-08-20) is that they live under **Video**,
with the tooltips saying so, rather than being duplicated or given a
section of their own. Images are one-shot sorted stills with no knobs of
their own (image feedback and its animation ticker were removed
2026-10-12, John); the feedback knobs shape video only.
So: if a knob shapes images at all, it is under Video.

**Typing values.** Every numeric row's readout is an editable field. Type a
number and the knob follows as you type; press Enter (or click away) and the
text settles at the parameter's own precision. Values outside the range
**clamp to the limit** rather than being rejected, and off-grid values snap
to the parameter's step, so the field, the knob and storage can never
disagree. ↑/↓ step by one increment, shift+↑/↓ by ten; Escape abandons the
edit. A field that has your caret in it is never reformatted mid-keystroke,
but a value arriving from elsewhere — MIDI, a restore, the other panel
window — does update it.

**Defaults, two layers.** `restore defaults` puts every parameter back;
`set defaults` saves the panel exactly as it stands right now as the set it
goes back to. That is the point of it: find a configuration by ear and eye
during install, press `set defaults`, and it is the resting state without a
source edit or a reload. The snapshot lives in `chrome.storage.local` under
`userDefaults` (outside `DEFAULTS`, so no content script ever sees it) and
survives restarts. A third button, `clear saved`, appears only once a set
exists and drops it — after which `restore defaults` goes back to the
`DEFAULTS` compiled into `params.js`.

**One parameter at a time.** Double-click any row to restore just that
parameter — to the saved set if there is one, otherwise to the code default.
The row flashes to confirm. Double-clicking inside a value field selects the
text instead, as it should.

**Tooltips.** Everything in the panel — every row, every value field, every
section header, every button, the MIDI block — carries hover copy explaining
what it is and what it does. The `tooltips` switch in the global block turns
the layer off entirely; it defaults on and the setting persists (storage key
`tooltips`, also outside `DEFAULTS`).

The panel has its own harness: `test/harness/panel.html`.

## MIDI

1. Open the panel on the kiosk once and grant the MIDI permission (it
   persists in the profile).
2. Click a param's ⊙ button (it arms, highlighted), move a knob — that CC
   is now bound and the button shows its number. Mappings persist in
   storage; re-learn to change, one CC per param.
3. Toggle params (`enabled`) treat CC value ≥64 as on.

Any class-compliant controller works. Suggested performance set: threshold,
decay, driftY, passes. For audio: `audioMix`, `audioSustain`,
`audioBodyMix` and `audioFbReturn` (the two that move the balance between
the apparatus and the video), `audioFbDecay`, `audioFbWobble`.
