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

Threshold is a plain slider. It carried *more* / *less* captions at its
ends from round 3 until 2026-10-12, when John removed them: confusing for
anyone who knows what a threshold is. Its direction lives in its tip, and
the open question of showing it inverted as an *amount* stands.

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

**Gated rows hide, they do not grey** (John, 2026-10-11: a control that
waits on another switch should not be visible until that switch is on).
Feedback off hides every feedback knob beneath the *feedback* switch, which
stays as the group's header; flow at 0 hides the three flow-shape knobs;
smear off hides tail, return, wobble and smear clear under the *smear*
switch; clear off hides the clear timings; a modal body hides comb damp.
When a whole medium is off the section keeps its header and shows one
italic line instead of its groups — *off — switch video or images on
above*, *off — switch audio on above* — so the stranger is told where the
knobs went. Each hidden row records its reason in `data-gate` (`feedback`,
`flow`, `smear`, `clear`, `comb`, `video`, `video or images`, `audio`;
the outermost switch wins) and is disabled, so neither mouse nor keyboard
reaches it. Trade-off, made on purpose: recognition (you cannot see that
feedback *has* knobs until it is on) for minimalism and a surface that
unfolds like a patch — the switch is the header of what it reveals, the
same gesture as the engine folds.

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
and button — carries hover copy explaining what it is and what it does. The
copy appears in a **bubble beside the hovered control** (2026-10-11,
replacing the help strip under the column and the help column at the
strip's right edge, which John found took real estate and stayed even with
tooltips off): **nothing shows at rest**, so the panel's whole height is
controls. The bubble sits above the control when there is room, else
below, is clamped inside the panel, is at most 340 px wide, and ignores
the pointer so appearing beside the hovered row cannot steal the hover. A
click can also put a one-line message in it for a moment, anchored to what
was clicked (*switch ON to see it*, *images are shaped by SORT*). A
parameter's tip leads with what you will see or hear, then the precise
sentence, then the gesture hint, and ends with its storage key in muted
type (`key: audioFbReturn`) so the panel and this sheet stay
cross-referenced. The harness renders every tip into the bubble and checks
it fits a 340 × 150 budget — the most that can stand beside a row in the
shortest home. The `tooltips` switch at the bottom turns the layer off
entirely; it defaults on and the setting persists (storage key `tooltips`,
outside `DEFAULTS`). The aim John set is a panel so plain the bubbles are
never needed; they are the fallback, not the furniture.

**Outside the panel.** The toolbar icon carries a yellow **ON** badge while
`enabled` is on and none when off, and its hover title names the piece and
the shortcuts (the service worker updates both on every change). There is
no in-page mark; that is John's call.

The panel has its own harness: `test/harness/panel.html`.

### Where the panel lives (`panelHome`; the strip, John's pick 2026-10-11)

Design review M9: the room found a separate window odd, and a synth-literate
player expects a horizontal strip under the picture, like a mixer. Three
homes were built behind one stored preference; John played them and chose
the strip, which is the default in code. **Which home ships as the default
is open again** (John, 2026-10-12): testing the strip on YouTube he asked for
a detached window that answers to its own shape, and the call waits until
both the strip and that window have been judged on real use. `panelHome` is
a **panel preference, not a parameter**: it lives outside `DEFAULTS` beside
`tooltips`, so no content script's param filter sees it, and the harness's
"every stored key has a row" check excludes it. Its row is **panel lives
in**, in the prefs line. **A change applies the next time the panel opens**;
the panel you are using never moves out from under you.

| value | home | how it opens |
|---|---|---|
| `strip` (default in code) | a strip along the bottom of every page: a **40 px rail** at rest, a **240 px mixer** unfolded | always present; a click anywhere on the rail that is not a control, the `CORRUPTION ▴` tab above its right end, the ▴/▾ button, Ctrl+Shift+P and the toolbar icon unfold and fold it |
| `window` | its own popup window, **responsive by shape**: 400 × 720 the first time (the column), the mixer once dragged wide; it reopens at the size and place it was last left | toolbar icon, Ctrl+Shift+P; a second open focuses the window already open |
| `side` | Chrome's side panel, docked in the browser window (Chrome 114+); always narrow, so always the column | toolbar icon (Chrome opens it itself), Ctrl+Shift+P |

All three run the same `panel.html`, `panel.js` and `panel.css`; there is
one source of truth for every control, tip and gesture.

**The layout follows the shape** (2026-10-12). The panel has three layouts —
the **column** (sections stacked in a narrow scroll), the **mixer** (the
global block as a cluster at the left, the sections as columns in a lane)
and the **rail** (one transport line) — and picks one from the space it is
given, in every home. Inside the strip's iframe (`?layout=strip`, `HOSTED`
in `panel.js`) it is always the mixer, or the rail when the frame is under
60 px tall (`RAIL`, `max-height: 60px`). Everywhere else it is the mixer
when the page is at least 900 px wide and at least 2:1 (`MIXER`,
`(min-width: 900px) and (min-aspect-ratio: 2/1)`), else the column. So the
side panel is the column; the window at 400 × 720 is the column; a window
dragged to 900 px wide and 2:1 is the mixer; the strip's frame is the mixer,
or the rail at 40 px. `paintLayout()` sets `data-layout='mixer'` on the root
or clears it, and moves each engine's `engine ▸` disclosure onto its
section's title line (mixer) or back to the head of its group (column); it
runs after the build and on every change, so a window dragged across the
line re-lays itself live, both ways. The layout value was `strip` until this
change; it is `mixer` now (`:root[data-layout='mixer']`) — the strip is a
home, the mixer is a layout. Only the hosted panel has the fold button and
talks to the strip (`toggle`, `ready`).

- **The strip.** `source/content/strip.js`, top frame only, independent of
  `enabled`. A `<deflection-strip>` element on `<html>` with its geometry
  set inline `!important` and a closed shadow root, so page CSS cannot move
  it or reach inside. It hosts `panel.html?layout=strip` in an iframe that
  is always there while the tab is visible, at one of two heights:
  - **The rail (40 px), the transport line.** One row: the title, the A/B
    (30 px tall with 13 px state; click latches, hold compares), the four
    medium chips (28 px pills), the presets (~26 px buttons), and the fold
    button ▴ (26 × 26) at the right end, 16 px apart. The rail was 28 px
    until John found it, and its targets, too small (2026-10-12); these are
    targets a stranger can hit. **A click anywhere on the rail that is not
    a control unfolds it** — the title and the gaps included; a chip, the
    A/B, a preset or ▴ does only its own job, and while the preset row is in
    save mode a click elsewhere only cancels the save. Above the rail's
    right end stands the **`CORRUPTION ▴` tab** (▾ while open), back from
    before the rail because it helped the strip stand out from the page: a
    click toggles, it never takes focus, it hides with the rest in
    fullscreen. No hover help on the rail (the bubble is suppressed and the
    title is plain). The transport line is what John chose over a
    fold-to-tab (the key gesture would have been two clicks away) and over
    always-open (it would always cover the player's controls). The rail
    covers the bottom 40 px of the page, fixed footers included; there is
    deliberately **no hover-to-unfold**, because the rail sits where a
    player's scrubber often is and the pointer crosses it constantly.
    Trade-offs: the bigger rail covers 12 px more of the page (minimalism)
    for targets a stranger can hit (user control, error prevention);
    click-anywhere is the flexible path, with the tab and ▴ kept as the
    explicit affordances (recognition over recall).
  - **The mixer (240 px).** The panel's mixer layout: the global block as a
    260 px cluster at the left (title, A/B, chips, presets, the prefs line,
    and the MIDI line only when a controller is present; both lines wrap
    inside the cluster), then the sections as columns in a lane — **sort ·
    feedback · body · smear, all four in view with no sideways scroll at
    every width checked, 1280 to 1920 px** (John: video and audio controls
    at hand without horizontal scrolling). The lane is eight rows of 28 px:
    12 px type, a 6 px slider track with a 16 px thumb, 58 px value fields
    (so *-0.0025* fits). **The columns spread with the width** (John,
    2026-10-12: the mixer left most of a wide screen empty):
    `grid-auto-columns: minmax(220px, 340px)`, measured for the sort column
    at 224.5 px at 1280, 264.5 at 1440, 282.5 at 1512, 336.5 at 1728 and
    340 at 1920, where the cap leaves ~230 px empty at the right. Each lane
    row is a size container: in a column under 250 px (the 1280 window)
    selects drop to 11 px. A section
    header starts a column, its first group's caption sits beneath it, and
    every later group starts a fresh column. A folded engine costs no
    column: its `engine ▸` disclosure sits on the section's title line;
    unfolded, its rows take a column of their own under an *ENGINE* caption
    (the lane scrolls sideways only then). Gated rows hide here too, so a
    column closes up to its switch. The fold button ▾ sits in the top-right
    corner.
  The panel reads which it is from its own height (the `max-height: 60px`
  media query), so no state travels down; the fold button, a click on the
  rail and the tab all end in the strip resizing (the panel posts `toggle`
  up). The fold state is `stripOpen` (written by the strip, followed by
  every tab). The iframe is out of the page's tab order (`tabindex="-1"`)
  and nothing in the housing ever takes focus; it is dropped while the tab
  is hidden, so only the visible tab runs a panel. The strip hides while
  anything is fullscreen (the panel keeps running, so a MIDI controller
  still plays). If the panel inside does not report that it booted within
  8 s, the strip removes itself and the page is as it was; the toolbar and
  shortcut then open the window instead.
- **The window.** `openWindow()` in the service worker. The first time it
  opens 400 × 720, the column; the panel inside follows the window's shape
  as above, so the player sizes and places it — tall for the column, wide
  for the mixer. **It remembers its bounds**: `panelBounds`
  `{width, height, left, top}` in chrome.storage.local (panel furniture
  outside `DEFAULTS`, like `tooltips`; in the panel harness's `PANEL_ONLY`
  list, so the parameter checks leave it alone), written 400 ms after a
  move or resize settles and only while the window is in its normal state
  (maximised, minimised and fullscreen are not shapes to come back to). A
  value that is not four integers with width ≥ 320 and height ≥ 200 is
  ignored, and a remembered position Chrome refuses (a screen since
  unplugged) falls back to 400 × 720, so a bad value never costs the panel.
  An MV3 worker sleeps after ~30 s idle; it keeps `panelWindowId` in
  `chrome.storage.session` as well, so after it wakes a drag is still
  recognised as the panel's and a second open focuses the window instead
  of making another. The window on a second screen is the performer's home
  (as in the lecture performance), out of reach of a page's fullscreen.
- **Side panel.** Uses the manifest's `side_panel.default_path` and the
  `sidePanel` permission. With `side` chosen the service worker sets
  `openPanelOnActionClick`, so the toolbar click is Chrome's own; the
  shortcut calls `chrome.sidePanel.open()` inside the key's gesture. It is
  always the column. Below 380 px wide the panel tightens its gutters and
  lets the shortcuts line and the preset row wrap (the harness checks 320,
  360 and 420 px for overflow and for every tip fitting the bubble).
- **Fallbacks.** Every side-panel and strip call is guarded. A Chrome without
  `chrome.sidePanel`, a page with no content script (chrome:// pages, the Web
  Store), or a strip that failed all fall through to the window.

**Verified** (headless Chrome, `node test/headless.mjs panel strip text`,
2026-10-12: panel 299/299, strip 52/52, text 35/35): the prefs row, its
three options and its storage; the mixer at 240 px tall and 1280, 1440,
1512, 1728 and 1920 wide (four effect columns in view, each its own column,
no sideways scroll, rows fitting, the sort column more than 40 px wider at
1920 than at 1280 and never narrower as the width grows, the cluster in
view, and **no descendant of the cluster crossing the lane's left edge** —
the guard the *panel lives in* / *flow scale* overlap escaped, because the
old check measured only the four containers, whose own boxes never crossed;
with the old prefs rules put back it fails at every width), and at 1280 the
engine disclosure on the title line, an unfolded engine adding a captioned
column, gates closing a column up, the bubble beside a row inside the frame,
and a MIDI-device boot whose MIDI line joins the cluster without crossing;
the rail at 40 px tall and the same five widths (one aligned line, every
target there and at least 26 px tall, nothing spilling out, the fold button
26 × 26 at the right, sections and prefs hidden, no bubble, the A/B
latching), and at 1280 the click-anywhere relay (the background and the
title toggle once; a chip pill and a chip name do not; a save-mode cancel
does not; the fold button toggles once); the layout by shape in a frame
with no `?layout` (1000 × 320 is the mixer with the disclosure in the Video
header, 700 × 700 the column with it in its group, the same frame resized
each way flips both, and the disclosure still folds and unfolds after); the
side-panel widths 320–420 px; the strip's housing on a mock page with
hostile CSS (`test/harness/strip.html`: the rail's geometry, isolation, the
tab — named, riding the rail's top edge folded and open, taking the pointer
there, never taking focus, a click folding and a second unfolding —, a
click on the panel's background unfolding and a chip pill not, unfold by
the panel's button, fold by keyboard and message, focus kept, fullscreen,
browser-tab visibility at both heights, the failure path leaving the page
untouched).

**Not verified without a real Chrome** (the extension cannot load in
headless Playwright, and nothing headless runs the service worker): the
window's remembered bounds (drag it wide and it is the mixer; close and
reopen and it comes back in the same place and shape; a second icon click
after a minute idle focuses it rather than opening another); that
`sidePanel.open()` from the shortcut is accepted as a gesture, including
when the shortcut is what woke the service worker (the code falls back to
the window if it is refused); whether a second toolbar click closes the
side panel; that the MIDI grant from the window carries to the side panel
(same origin, so it should); MIDI inside the strip at all (the iframe
carries `allow="midi"`, but the permission prompt in a cross-origin frame
and a page's own Permissions-Policy may refuse it); MIDI rows in the mixer
at 1280 (known: with a device the ⊙ column squeezes the lane's sliders to
~30 px and truncates the selects — too little width for MIDI rows at 1280;
not addressed); that Chrome's command takes Ctrl+Shift+P before a page that
binds it; a site with a strict Content Security Policy, which could refuse
the extension's iframe (untested; the 8 s failure path should then open the
window — github.com is the checklist case); how the rail and the mixer sit
over real players' controls and fixed footers at John's width.

**Known costs of the strip.** The rail covers the bottom 40 px of every
page and the mixer 240 px, fixed footers and players' own controls
included. It does not push the page up: that is possible (bottom padding on
the page root, undone on removal) but fails on apps with their own scroll
container, and John declined it (2026-10-12) — the strip covers. Fullscreen
hides it, so a mouse user has no controls in fullscreen; that matters for
the performer, whose home is the window on a second screen (a
keyboard-summoned overlay is the direction if it matters more).
`panel.html` is web-accessible so pages can host it, which also means any
page can detect that the extension is installed — already true before the
strip, since the content scripts are web-accessible for their dynamic
import; it is fingerprinting only, and not a concern for an art piece.
Open visual notes: *CORRUPTION* reads twice at rest (the rail's title and
the tab); at 1920 the rail's controls end around x = 840 and the rest of the
line is empty, and the mixer's capped columns leave ~230 px empty at the
right.

## MIDI

1. Open the panel on the kiosk once and grant the MIDI permission (it
   persists in the profile).
2. With a controller connected, the MIDI block appears at the bottom of
   the panel and every row, the A/B and the four chips show a ⊙ button
   (without a controller the block and every ⊙ are out of sight — MIDI is a
   feature, not the primary mode, John 2026-10-11). Click one (it arms,
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
