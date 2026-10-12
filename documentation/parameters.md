# Parameters

Every effect parameter, its range, and what it does. This doubles as the
MIDI mapping sheet — tape it to the desk during install. All values live in
`chrome.storage.local`; the panel writes them, every tab follows within a
frame or two.

Open the panel: click the toolbar icon, or Ctrl+Shift+P.
Kill switch: Ctrl+Shift+D toggles `enabled` without the panel.
How the panel itself works — the A/B, the medium chips, presets, sections
and their groups, typed values, tooltips — is [below](#the-panel).

**Keys and labels.** The `Param` column is the key: what storage, MIDI
maps, presets and the code use, and what every tooltip names on its last
line. It never changes. The *panel label* is the player's word for the same
knob — synth vocabulary (wet/dry, decay, gate, ring time), relabelled
2026-10-12 for the stranger (design review M4/M8, finding 6). The table is
in panel order, group by group.

| Param | Panel label | Default | Range | What it does |
|---|---|---|---|---|
| **Global block (above the first divider)** | | | | |
| `enabled` | the A/B (big button) | on | on/off | Master switch — the panel's big **A/B** button (a press under 600 ms latches; a hold past 600 ms is a momentary compare that returns on release). Off restores every video/image/word untouched and ramps audio dry. The toolbar badge reads **ON** while it is on. |
| `video` | video chip | on | on/off | Video on/off (the **video** chip, 2026-10-12). Off suspends every video job exactly as `enabled: false` does — overlay dropped, the video shown as transmitted — while images, text and audio carry on. |
| `images` | images chip | on | on/off | Images on/off (the **images** chip, 2026-10-12). Off suspends every image job — the still shown as it arrived. Image look comes from the sort knobs under Video. |
| **Video · sort** | | | | |
| `threshold` | threshold | **0.05** | 0–1 | Luma above this is eligible for sorting (and feedback). Near-zero corrupts almost everything while true black holds as a barrier; 1 = untouched. The single most expressive knob. |
| `flowAmount` | flow | **0.5** | 0–1 | **The resting state flows** (John's sweet spot, 2026-08-12). 0 = the classic vertical grammar, bit-identical. Up = sorting follows a slowly morphing **curl-noise flow field**: ribbons meander and curl along streamlines instead of climbing columns. Directions quantize to 16 sectors with a per-pass dithered boundary, so material rounds curves instead of pooling at fixed seams. Still a permutation — nothing added, nothing lost, harness-pinned. **Every element draws its own seed, rerolled when its content changes** (a new video in YouTube's reused player is new content): pattern, phase, morph rate, swirl size, and handedness all differ per medium — no two screens show the same corruption, and no knob controls this (it is identity, not a parameter). |
| `flowMode` | flow mode | **facets** | paths / facets | *Flow only.* Two quantizers, both kept (John liked both; facets is his resting pick). **facets**: 8 fixed sectors, no dither — straight runs inside each patch, pooling at anchored seams where the field bends. **paths**: 16 sectors, boundary dithered per pass — seams wander, material rounds curves, ribbons meander. |
| `flowScale` | flow scale | **2.5** | 1–12 | *Flow only.* Noise cells across the frame: higher = tighter, busier swirls; lower = broad sweeping currents. |
| `flowSpeed` | flow speed | **0.045** | 0–0.2 | *Flow only.* How fast the field morphs (streamlines re-carve in place rather than marching). 0 = frozen geometry — flow without evolution. |
| `temperature` | jitter | **0** | 0–0.5 | Fraction of pair-verdicts inverted per pass. The sort simmers at its equilibrium instead of settling into it: ribbons boil at their edges and the picture never comes to rest. Applies in straight sort and feedback alike; barriers still hold (the boil stays inside bright spans). 0.5 = a pure random walk, no net sorting. |
| **Video · feedback** | | | | |
| `feedbackVideo` | feedback | **on** | on/off | Temporal feedback on videos — **the resting state** (John, 2026-08-12; previously off): smear accumulates, drifts, decays, clears at slow 30–60 s keyframes. Off = straight per-frame pixel sorting. |
| `motionGate` | motion gate | **0** | 0–1 | *Video feedback only.* A pair may only trade when BOTH members' motion trail clears this, so damage stays strictly inside what the transmission itself is changing: action smears, stillness holds and heals. The trail decays ~1 s; each keyframe floods it hot, so a reset briefly sorts everywhere before confinement returns. 0 = sort regardless of motion. |
| `decay` | decay | **0.81** | 0.8–0.999 | *Video feedback only.* Accumulator retention per frame. Higher = smear lingers longer. |
| `driftX` | drift x | **−0.0025** | ±0.01 | *Video feedback only.* Horizontal smear, UV units per frame (negative = leftward). |
| `driftY` | drift y | **0.0020** | ±0.01 | *Video feedback only.* Vertical smear; **positive = upward** — the resting state climbs gently. Purely visual — the audio wobble it used to drive is now `audioFbWobble`. |
| `resetMinS` / `resetMaxS` | clear min s / clear max s | **30 / 60** | 1–30 / 2–60 | *Video feedback only.* Keyframe rhythm: the accumulator resets to a clean frame at a random interval in this window. Slow by default — damage accumulates for half a minute or more before clearing. |
| **Video · engine (folded)** | | | | |
| `passes` | sort passes | **64** | 0–64 | Sort passes per frame. A full 256→1 stride ladder is 18 passes, so 64 runs ~3.5 settling cycles. |
| `streak` | streak | **256** | 1–256 | Longest compare-exchange stride (rounded down to a power of two). Directly sets how far pixels can travel per frame — the ribbon-length knob. 1 = classic single-step odd-even. |
| `maxRes` | max res | 1920 | 480–1920 | Processing resolution cap, long axis. Lower it on weak GPUs; output upscales through the overlay. |
| `maxVideos` | max videos | **12** | 1–16 | Concurrent video jobs, biggest visible first. Paused videos count too — they get a one-shot sorted still (rVFC never fires for them). Raised from 8 for grid feeds (Instagram explore) where a dozen previews are on screen at once. |
| `textScramble` | text chip | **on** | on/off | The text mode — **on in the resting state** (the call the proposal deferred to the room; John made it 2026-08-12). Letters rearrange inside each word, page-wide; anything that isn't a letter (space, punctuation, digit, emoji) is a barrier no glyph crosses, so every word keeps its length and the page keeps its shape. Off restores every run. **An on/off effect with no knobs** (John, 2026-10-11): the former `textMin` slider is gone and the minimum run length is the constant `TEXT_MIN` = 8 in `text-scramble.js` — prose and most labels dissolve, the shortest furniture (Home, OK) survives. A `textMin` left in an older profile is ignored. |
| `audioEnabled` | audio chip | on | on/off | Audio master — the **audio** chip (its section row went 2026-10-11; chip and key are one control). Off ramps every tap to dry — the tap itself is permanent by design. |
| **Audio · body** | | | | |
| `audioMix` | mix | 1 | 0–1 | Wet/dry for the whole sound, in the tap graph after everything else (30 ms ramps). 0 = the internet as transmitted, 1 = all apparatus. Leads the body group since round 3: it is the first level a player reaches for. Distinct from `audioDirect`, which is inside the DSP. |
| `audioBodyMix` | body amount | **1** | 0–2 | Resonant part against the direct path — the identity dial. Up for more fixed voice, down for more of the video. Making the bank a filter costs lattice salience (25 → ~7 measured, raw audio being 5.6); this is the knob that buys some back. |
| `audioBody` | body type | **modal** | modal / comb | Which apparatus the signal passes through. **modal** = the 48 stretched partials, struck metal. **comb** = three recirculating lines on the same fundamentals, exactly harmonic — tube/pipe/spring, and about a tenth of the cost. The A/B John called for (2026-08-13); the character difference is inherent, not a defect (see below). |
| `audioSustain` | ring time | **12** | 2–12 | T60 at the lowest string (55 Hz), seconds. Higher modes always die faster ((55/f)^0.7) — the ring-length knob. |
| `audioDrive` | drive | **1.0** | 0–1 | Strike force into the resonators. Per-mode caps bound runaway, so drive shapes attack more than loudness. |
| **Audio · smear** | | | | |
| `audioFeedback` | smear | **on** | on/off | The smear: the engine's output recirculates through a 0.35 s delay line (0.1 Hz wobble, tanh-clipped write-back), continuously — see `audioFbClear`. |
| `audioFbDecay` | tail | **0.999** | 0.8–0.999 | *Audio fb only.* The smear's **tail length** — and only that since 2026-08-13. Maps to loop gain 0.5–0.95, the visual `decay` knob's range, so it feels like the same knob. |
| `audioFbReturn` | return | **0.25** | 0–1 | *Audio fb only.* How loud the wash sits, as a **fraction of the loop gain**. Tail and level used to be one number, which is why nothing survived it: at loop gain 0.95 the wash settles ~1/(1−g) ≈ 20× above whatever just arrived and buries it. **1 = the old behaviour exactly.** Measured: dropping to 0.25 takes envelope correlation with the source from 0.22 to 0.89 with the 47 s tail untouched. |
| `audioFbWobble` | wobble | **0** | 0–0.4 | *Audio fb only.* Delay wobble depth — the tape-warble on the echo stack. **0 = no wobble, a static echo stack** (the resting state). Until 2026-08-12 this rode the visual `driftY` slider; detangled so performing the video never bends the sound. |
| **Audio · engine (folded)** | | | | |
| `audioDirect` | dry | **1** | 0–1 | Direct signal level *inside* the DSP: both engines sum their resonant part with this, so the source passes through the apparatus instead of only driving it. **0 = the pre-2026-08-13 behaviour**, where the output never contained the input and every video sounded alike. |
| `audioMaxTaps` | max sources | **8** | 1–8 | Concurrent *engaged* taps, most recently playing first — the audio sibling of `maxVideos`. Everything safe gets tapped; beyond the cap, elements play dry (idle processors cost ~nothing). Matters on feed pages with several sounding videos; each engaged tap is its own worklet. |
| `audioExciter` | exciter | **continuous** | gated / continuous | **Continuous is the piece**: the stream drives the body always, bounded by resonz normalization and per-mode caps. Gated = onsets open a 60 ms window and the body is *struck* instead. |
| `audioCombDamp` | comb damp | **0.45** | 0–0.9 | *Comb only.* Loop lowpass: the comb's version of "higher partials die faster". Low = metallic and bright, high = woody and dark. |
| `audioFbClear` | smear clear | **off** | on/off | *Audio fb only.* Whether the smear clears on its own `audioFbClearMinS`/`audioFbClearMaxS` rhythm at all (its own window since 2026-08-12 — the visual `resetMinS`/`resetMaxS` no longer reach the audio). **Off is the piece**: the loop gain (< 1) is already a natural decay, so unlike the video accumulator the smear needs no clearing — it stays continuous. |
| `audioFbClearS` | clear fade s | 1 | 0–4 | *Audio fb clear only.* When clearing is on, the keyframe fades the wash out over ~this many seconds before the line wipes, instead of cutting in one sample. **0 = the original hard cut.** The video keyframe stays a hard cut by design — one frame hides in a glitching image; a vanished wash doesn't. |
| `audioFbClearMinS` / `audioFbClearMaxS` | clear min s / clear max s | 1 / 60 | 1–30 / 2–60 | *Audio fb clear only.* The smear's own keyframe window: when clearing is on, the wash clears at a random interval in this range — the audio sibling of the visual `resetMinS`/`resetMaxS`, and no longer the same sliders. |

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

Reach is one number, `TEXT_MIN` (8): only runs of at least that many
characters scramble. The proposal's worry about scrambling — an unreadable
interface is an unnavigable one — is answered by that minimum rather than
by a containment rule: interface labels are short, prose is long, and 8
sits between them. It was a panel slider (`textMin`) until 2026-10-11; John
retired it — the mode is an on/off effect — and his setting became the
constant. Search inputs survive because form *values* aren't text nodes —
the one lifeline that is free.

What never scrambles, regardless of the minimum (these are data-loss, not
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

Rebuilt 2026-08-20 for performing rather than for reading source; the global
block redesigned 2026-10-12 for the stranger (design review M1, M2, M3, M7).
Three sections under a global block — Video and Audio each in three groups
(effect, effect, engine; regrouped 2026-10-12, M4/M8) — and the whole thing
explains itself on hover.

**The global block** is everything above the first divider, in order:

- **Title line.** CORRUPTION, one plain sentence saying what it does, and
  the two shortcuts. The shortcut line reads the real bindings from
  `chrome.commands.getAll()` (so a rebind at chrome://extensions/shortcuts
  shows), falling back to the manifest's suggested keys.
- **The A/B** — one large button bound to `enabled`. Yellow *ON — bending
  the page* or dark *OFF — page untouched*. **Any press shorter than 600 ms
  latches** (`LATCH_MS`), however slow and deliberate the click. **A press
  held past 600 ms is a momentary compare**: the face reads *holding … let
  go to return*, and release (or pointer-leave, or cancel) puts the piece
  back exactly where the press began, so a stranger can hold to see the
  page untouched and let go to return. The flip itself shows under the
  finger at 250 ms, so a compare is seen before the latch window closes; a
  release before 600 ms keeps it. Space/Enter latch. Its ⊙ MIDI learn sits
  beside it. Loading a preset or *default* while the piece is OFF puts
  *switch ON to see it* on the face for ~1.5 s, since the load landed but
  nothing shows.
- **The four medium chips** — video · images · text · audio. The pill
  switches the medium (`video`, `images`, `textScramble`, `audioEnabled`);
  the caption above it (underlined on hover) jumps to the section that
  shapes it, and the header it lands on flashes. **images** lands on the
  **sort** caption under Video — the only knobs that shape a still — and
  the help strip says *images are shaped by SORT*. **The chips are the only
  face of all four keys** (2026-10-11): text has no knobs, so its caption is
  a plain label and there is no Text section, and audio's master row went
  the same way. Each chip carries its own ⊙ MIDI learn, shown with a
  controller connected. Chips dim while the A/B is off, because it governs
  all four; a chip still switches then, and the strip says *switch ON to
  see it*.
- **Presets** (below), under a small muted *PRESETS* caption.

The sort knobs genuinely belong to video *and* images — one shader, two
callers — and John's call (2026-08-20) is that they live under **Video**,
with the tooltips saying so, rather than being duplicated or given a
section of their own. Images are one-shot sorted stills with no knobs of
their own (image feedback and its animation ticker were removed
2026-10-12, John); the feedback knobs shape video only.
So: if a knob shapes images at all, it is under Video. Each section header
is a jump target (`#section-video`, `#section-audio`).

**Groups: effect, effect, engine** (2026-10-12, design review M4/M8). Video
and Audio each split into three groups under small captions, so the effect
you can see or hear comes first and the setup folds away:

- **Video** — **sort** (threshold, flow, flow mode, flow scale, flow speed,
  jitter), **feedback** (its own switch, then motion gate, which reads the
  feedback trail, decay, drift x/y, clear min/max s), **engine** (sort
  passes, streak, max res, max videos).
- **Audio** — **body** (mix, the whole-sound wet/dry, then body amount,
  the identity dial, body type, ring time, drive), **smear** (its own
  switch, tail, return, wobble), **engine** (dry, max sources, exciter,
  comb damp, smear clear, clear fade s, clear min/max s). Mix leads body
  and dry sits in the engine since round 3: mix is the level a player
  reaches for; dry is setup. The `audio` master is the chip above.
- **Text** has no section: it is the chip and nothing else.

Both **engine** groups start folded behind a disclosure (`engine ▸`; click
for `engine ▾`). The folded rows still exist — presets, MIDI and storage
reach them exactly as before; they are only out of sight. The open state is
remembered per section in the storage key `engineOpen` (`{video, audio}`),
panel furniture outside `DEFAULTS` like `tooltips`.

Threshold, the inverted knob, carries tiny captions at its slider ends —
*more* on the left, *less* on the right — so its direction reads without
hovering.

**Audio status line.** One muted line under the Audio header says what the
tab you are looking at is putting through the body: *3 sources through the
body*, *2 sources on this page, none reaching the body* (paused, past the
cap, or out of the browser's reach), *nothing on this page to tap*, or
*audio off* / *piece off*. Every content-script frame posts its
`registry.stats().audio` counts (`taps`, `engaged`) to the service worker
on change and every ~2 s while it has taps (message type
`deflection:stats`, op `put`); the worker sums them per tab; the panel asks
for the active tab of the last-focused normal window on open and every 2 s
(op `get`) and takes pushes between asks (op `push`). Outside the extension
— the dev preview, the panel harness — there is no runtime and the line
stays empty. Nothing about it can touch the page: every call is guarded and
a failure only stops the reporter.

**Greyed rows say why.** A row that cannot act right now dims, and its knob
cell shows the switch that would wake it, in muted italics: *needs
video*, *needs video or images*, *needs feedback*, *needs flow*, *needs
text*, *needs audio*, *needs smear*, *needs clear*, *comb only*. When
several apply, the outermost switch is named. The medium gates come from
the chips: with `video` off every feedback row (its switch included) reads
*needs video*; with `video` and `images` both off every sort row reads
*needs video or images*.

**Typing values.** Every numeric row's readout is an editable field. Type a
number and the knob follows as you type; press Enter (or click away) and the
text settles at the parameter's own precision. Values outside the range
**clamp to the limit** rather than being rejected, and off-grid values snap
to the parameter's step, so the field, the knob and storage can never
disagree. ↑/↓ step by one increment, shift+↑/↓ by ten; Escape abandons the
edit. A field that has your caret in it is never reformatted mid-keystroke,
but a value arriving from elsewhere — MIDI, a preset load, the other panel
window — does update it.

**Presets.** Every move is already kept (storage persists across restarts);
presets are snapshots to jump between. Under a small *PRESETS* caption the
row is **default · A · B · C · save…** (*default* was labelled *original*
until round 3; a stored `presetBase` of `"original"` still reads as
default):

- **default** puts every parameter back to the `DEFAULTS` compiled into
  `params.js`. Nothing in the UI can redefine it, so the way back to the
  shipped piece always exists.
- **A · B · C** are slots. Clicking one **loads** it; an empty slot is
  dashed and only says "empty".
- **save…** is deliberately secondary and two clicks: it puts the row in a
  visible save mode (an empty slot reads *save → B*, a filled one *replace
  A*; a Cancel appears), the next slot click writes the current settings
  there, flashes "saved to A", **marks that slot as the base**, and the row
  returns to load mode. Escape or a click anywhere else cancels, and the
  save button flashes "cancelled" so the exit is seen. This is the fix for
  the room slip (meaning to restore, pressing save).
- **Every load and every default restore** flashes ("loaded" /
  "restored") and offers **undo** for ten seconds, which puts back exactly
  the settings — and the base — from before.
- **Saving over a filled slot** offers the same ten-second **undo**, which
  puts the slot's previous contents back (the knobs are left as they are).
- Presets never capture or load the A/B (`enabled`): loading a look while
  comparing must not switch the page back on.

Storage: one key `presets` (`{A, B, C}`, each a values object or null) and
`presetBase`, both outside `DEFAULTS`, so no content script sees them. The
old single snapshot (`userDefaults`, from the "set defaults" button) is
migrated on panel boot: if slot A is empty it moves into A, A becomes the
base, and `userDefaults` is removed.

**One parameter at a time.** Double-click a row's name (or anywhere on the
row but its slider and value field) to put just that parameter back to the
**base preset** — the last one loaded or saved (default, or a slot;
stored as `presetBase`). The base is marked with a small yellow dot before
its name — a mark, not a pressed look, so nothing in the row reads as
selected — and its tooltip says so. The row flashes to confirm. Double-clicking inside a value
field selects the text instead, as it should, and two quick clicks on a
slider thumb are a nudge, never a reset. A typed value that had to clamp
flashes its row the same way, so the clamp is visible.

**Tooltips.** Everything in the panel — the title line, the A/B, the chips,
the presets caption, every row, value field, section header, group caption
and button, the MIDI block — carries hover copy explaining what it is and
what it does. The copy appears in a **help strip pinned to the bottom
edge** of the panel, full width. At rest it is **one line** (~40 px)
reading *Hover to read a knob · double-click a name to reset it*, in room
the panel column keeps free below the scroller, so at rest it covers no
row. On hover it **grows to fit the tip** (at most 136 px, ~120 ms)
upward **as an overlay** over the bottom of the scroller: no row moves, and
the scroller's height and scroll length never change. The strip ignores
the pointer, so growing over the hovered row cannot steal the hover; the
cost is that a tip can briefly cover the lowest rows while it is read. A
click can also put a one-line message there for a moment (*switch ON to
see it*, *images are shaped by SORT*). A parameter's tip leads with what
you will see or hear, then the precise sentence, then the gesture hint, and
ends with its storage key in muted type (`key: audioFbReturn`) so the panel
and this sheet stay cross-referenced. The harness checks every tip fits
the 136 px cap and that hovering moves no row. The `tooltips` switch at the
bottom, under the MIDI block, turns the layer off entirely (the strip goes
and gives its line back to the scroller); it defaults on and the setting
persists (storage key `tooltips`, also outside `DEFAULTS`).

**Outside the panel.** The toolbar icon carries a yellow **ON** badge while
`enabled` is on and none when off, and its hover title names the piece and
the shortcuts (the service worker updates both on every change). There is
no in-page mark; that is John's call.

The panel has its own harness: `test/harness/panel.html`.

### Where the panel lives (`panelHome`, prototypes pending John's choice)

Design review M9: the room found a separate window odd, and a synth-literate
player expects a horizontal strip under the picture, like a mixer. Two
candidates are built beside the window, behind one stored preference, so
John can play all three and choose. `panelHome` is a **panel preference, not
a parameter**: it lives outside `DEFAULTS` beside `tooltips`, so no content
script's param filter sees it, and the harness's "every stored key has a
row" check excludes it. Its row is **panel lives in**, under `tooltips` at
the bottom of the panel. **A change applies the next time the panel opens**;
the panel you are using never moves out from under you.

| value | home | how it opens |
|---|---|---|
| `window` (default) | its own 400 × 720 popup window, as before | toolbar icon, Ctrl+Shift+P |
| `side` | Chrome's side panel, docked in the browser window (Chrome 114+) | toolbar icon (Chrome opens it itself), Ctrl+Shift+P |
| `strip` | a strip about 150 px tall along the bottom of every page, folding down to a thin **CORRUPTION ▴** tab | the tab, Ctrl+Shift+P, toolbar icon (all toggle) |

All three run the same `panel.html`, `panel.js` and `panel.css`; there is
one source of truth for every control and tip.

- **Side panel.** Uses the manifest's `side_panel.default_path` and the
  `sidePanel` permission. With `side` chosen the service worker sets
  `openPanelOnActionClick`, so the toolbar click is Chrome's own; the
  shortcut calls `chrome.sidePanel.open()` inside the key's gesture. Below
  380 px wide the panel tightens its gutters, lets the shortcuts line and
  the preset row wrap, and grows the help strip to 188 px so every tip still
  fits (the harness checks 320, 360 and 420 px for overflow and clipped
  tips). The side panel stays listed in Chrome's side-panel menu in every
  home; nothing is gained by hiding it.
- **Strip.** `source/content/strip.js`, top frame only, independent of
  `enabled`. A `<deflection-strip>` element on `<html>` with its geometry set
  inline `!important` and a closed shadow root, so page CSS cannot move it or
  reach inside. It hosts `panel.html?layout=strip` in an iframe:
  `panel.css` lays that out as the A/B, chips and presets in a cluster at
  the left, the sections as five-row columns in a lane that scrolls
  sideways (each section starts a fresh column; an unfolded engine adds
  columns, never height), MIDI and the panel prefs to the right, and the
  help copy as a full-height column at the right edge. Folded, there is no
  iframe at all, so nothing can take the page's keyboard focus; the tab is
  out of the tab order and pressing it does not take focus. The fold state
  is `stripOpen` (written by the strip, followed by every tab). The iframe
  is dropped while the tab is hidden, so only the visible tab runs a panel.
  The strip hides while anything is fullscreen (the panel keeps running, so
  a MIDI controller still plays). If the panel inside does not report that
  it booted within 8 s, the strip removes itself and the page is as it was;
  the toolbar and shortcut then open the window instead.
- **Fallbacks.** Every side-panel and strip call is guarded. A Chrome without
  `chrome.sidePanel`, a page with no content script (chrome:// pages, the Web
  Store), or a strip that failed all fall through to the window.

**Verified** (headless Chromium, harness): the prefs row, its three options
and its storage; the strip layout at 1280 × 150 (sections side by side, no
overflow, every tip fits); the side-panel widths 320–420 px; the strip's
housing on a mock page with hostile CSS (`test/harness/strip.html`: geometry,
isolation, fold by tab / keyboard / message, focus kept, fullscreen, tab
visibility, the failure path leaving the page untouched).

**Not verified without a real Chrome** (the extension cannot load in
headless Playwright): that `sidePanel.open()` from the shortcut is accepted
as a gesture, including when the shortcut is what woke the service worker
(the code falls back to the window if it is refused); whether a second
toolbar click closes the side panel; that the MIDI grant from the window
carries to the side panel (same origin, so it should); MIDI inside the
strip at all (the iframe carries `allow="midi"`, but the permission prompt
in a cross-origin frame and a page's own Permissions-Policy may refuse it);
that Chrome's command takes Ctrl+Shift+P before a page that binds it;
that page CSP never blocks the extension iframe on real sites (the 8 s
failure path covers it if it does).

**Known costs of the strip.** Expanded, it covers the bottom ~150 px of the
page, fixed footers and players' own controls included; it does not push
the page up, because that means restyling the page. `panel.html` is
web-accessible so pages can host it, which also means any page can detect
that the extension is installed.

## MIDI

1. Open the panel on the kiosk once and grant the MIDI permission (it
   persists in the profile).
2. With a controller connected, every row shows a ⊙ button (they stay
   hidden while the MIDI block reads "no device", and so does the block's
   "click a param's ⊙" instruction). Click one (it arms,
   highlighted), move a knob — that CC is now bound and the button shows
   its number. Folded engine rows have theirs too: unfold the engine first. Mappings persist in
   storage; re-learn to change, one CC per param.
3. Toggle params (`enabled`, the A/B) treat CC value ≥64 as on.

Any class-compliant controller works. Suggested performance set (panel
labels in brackets): threshold, `decay`, `driftY` (drift y), `passes` (sort
passes). For audio: `audioMix` (mix), `audioSustain` (ring time),
`audioBodyMix` (body amount) and `audioFbReturn` (return) — the two that
move the balance between the apparatus and the video — `audioFbDecay`
(tail), `audioFbWobble` (wobble).
