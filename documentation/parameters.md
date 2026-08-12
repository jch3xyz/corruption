# Parameters

Every effect parameter, its range, and what it does. This doubles as the
MIDI mapping sheet — tape it to the desk during install. All values live in
`chrome.storage.local`; the panel writes them, every tab follows within a
frame or two.

Open the panel: click the toolbar icon, or Ctrl+Shift+P.
Kill switch: Ctrl+Shift+D toggles `enabled` without the panel.

| Param | Default | Range | What it does |
|---|---|---|---|
| `enabled` | on | on/off | Master switch. Off restores every video/image untouched. |
| `feedback` | **off** | on/off | Off = straight per-frame pixel sorting — the resting state (John's final call; the audio smear runs independently of this). On = temporal feedback — smear accumulates, drifts, decays, clears at keyframe resets; the values below are live-tuned for it. |
| `threshold` | **0** | 0–1 | Luma above this is eligible for sorting (and feedback). 0 = whole frame corrupts; 1 = untouched. The single most expressive knob. |
| `passes` | **64** | 0–64 | Sort passes per frame. A full 256→1 stride ladder is 18 passes, so 64 runs ~3.5 settling cycles. |
| `streak` | **256** | 1–256 | Longest compare-exchange stride (rounded down to a power of two). Directly sets how far pixels can travel per frame — the ribbon-length knob. 1 = classic single-step odd-even. |
| `decay` | **0.906** | 0.8–0.999 | *Feedback only.* Accumulator retention per frame. Higher = smear lingers longer. |
| `driftX` | **−0.0025** | ±0.01 | *Feedback only.* Horizontal smear, UV units per frame (negative = leftward). |
| `driftY` | **0** | ±0.01 | *Feedback only.* Vertical smear; **positive = upward**. 0 = purely horizontal drift — and no audio smear wobble (the coupling below). |
| `resetMinS` / `resetMaxS` | **1 / 60** | 1–30 / 2–60 | *Feedback only.* Keyframe rhythm: the accumulator resets to a clean frame at a random interval in this window. |
| `maxRes` | 1920 | 480–1920 | Processing resolution cap, long axis. Lower it on weak GPUs; output upscales through the overlay. |
| `maxVideos` | **12** | 1–16 | Concurrent video jobs, biggest visible first. Paused videos count too — they get a one-shot sorted still (rVFC never fires for them). Raised from 8 for grid feeds (Instagram explore) where a dozen previews are on screen at once. |
| `imageFps` | **6** | 1–30 | *Feedback only.* Tick rate for animated images. Straight-sort stills don't animate at all. |
| `imageAnimCap` | 12 | 0–24 | *Feedback only.* Max concurrently animated images (≥200 px side, biggest visible first); the rest stay stills. |
| `textScramble` | **off** | on/off | The text mode. On = letters rearrange inside each word, page-wide; anything that isn't a letter (space, punctuation, digit, emoji) is a barrier no glyph crosses, so every word keeps its length and the page keeps its shape. Off restores every run. **Decide in the room** — see the text mode below. |
| `textMin` | **12** | 1–40 | *Text only.* Shortest run of text that scrambles. At 12 prose dissolves while short interface labels (Home, Subscribe) survive — the navigability dial. Wind it down and the furniture goes too. |
| `audioEnabled` | on | on/off | Audio master. Off ramps every tap to dry — the tap itself is permanent by design. |
| `audioMix` | 1 | 0–1 | Wet/dry in the tap graph (30 ms ramps). 0 = the internet as transmitted. |
| `audioFeedback` | **on** | on/off | The smear: the body's output recirculates through a 0.35 s delay line (0.1 Hz wobble, tanh-clipped write-back), continuously — see `audioFbClear`. |
| `audioFbDecay` | **0.999** | 0.8–0.999 | *Audio fb only.* Echo retention (maps to feedback gain 0.5–0.95) — the visual `decay` knob's range, so it feels like the same knob. `driftY` sets the delay wobble depth (×100), exactly as the first audio phase had it — **`driftY` 0 = no wobble, a static echo stack**. |
| `audioFbClear` | **off** | on/off | *Audio fb only.* Whether the smear clears on the `resetMinS`/`resetMaxS` keyframe rhythm at all. **Off is the piece**: the loop gain (< 1) is already a natural decay, so unlike the video accumulator the smear needs no clearing — it stays continuous. |
| `audioFbClearS` | 1 | 0–4 | *Audio fb clear only.* When clearing is on, the keyframe fades the wash out over ~this many seconds before the line wipes, instead of cutting in one sample. **0 = the original hard cut.** The video keyframe stays a hard cut by design — one frame hides in a glitching image; a vanished wash doesn't. |
| `audioMaxTaps` | **8** | 1–8 | Concurrent *engaged* taps, most recently playing first — the audio sibling of `maxVideos`. Everything safe gets tapped; beyond the cap, elements play dry (idle processors cost ~nothing). Matters on feed pages with several sounding videos; each engaged tap is its own worklet. |
| `audioSustain` | **12** | 2–12 | T60 at the lowest string (55 Hz), seconds. Higher modes always die faster ((55/f)^0.7) — the ring-length knob. |
| `audioDrive` | **1.0** | 0–1 | Strike force into the resonators. Per-mode caps bound runaway, so drive shapes attack more than loudness. |
| `audioExciter` | **continuous** | gated / continuous | **Continuous is the piece**: the stream drives the body always, bounded by resonz normalization and per-mode caps. Gated = onsets open a 60 ms window and the body is *struck* instead. |

## The audio engine (bake-off settled: body won)

**body** — a fixed resonant body driven by the stream: 48 modal resonators,
three just-intonation fundamentals (55/82.5/137.5 Hz) × 16 stretched
partials (`f_k = k·f₀·√(1+4e-4k²)`) — the stretch is what makes it read as
an object, not a comb. Identity lives in the apparatus: tuning is fixed in
source and never on a knob. Latency ≈ 0 — the sound coincides with the
visual event. Continuous excitation uses constant-peak-gain (resonz)
normalization so the stream excites only its sympathetic partials; gated
excitation is impulse-normalized so strikes ring.

The losing **timebase** engine (a 45 s reservoir read by lag-controlled
heads) is preserved at tag `audio-bakeoff` with its harness checks — judged
on live browsing, removed 2026-08-11.

The feedback layer (ported intact from the first audio phase) smears the
body's output continuously — its loop gain (< 1) is a built-in decay, so
unlike the video accumulator it never needs a clear to stay clean. At high
`audioFbDecay` its tail can outlive input by tens of seconds; the output
gate at the floor is what keeps silence-in/silence-out honest, and
`audioFbClear` restores the keyframe rhythm if the piece ever wants it back.

Rules the implementation lives by: safety is predicted before tapping
(same-origin / blob / data / MediaStream / `crossorigin="anonymous"` only);
taps are permanent, disable is a gain bypass; every input sample is
finiteness-checked before recursive state; the output gate snaps to exact
zeros once input is absent and the engines reach the floor; `process()`
never throws (a dead processor is permanently silent media).

## The text mode (`textScramble`, off by default)

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

## MIDI

1. Open the panel on the kiosk once and grant the MIDI permission (it
   persists in the profile).
2. Click a param's ⊙ button (it arms, highlighted), move a knob — that CC
   is now bound and the button shows its number. Mappings persist in
   storage; re-learn to change, one CC per param.
3. Toggle params (`enabled`) treat CC value ≥64 as on.

Any class-compliant controller works. Suggested performance set: threshold,
decay, driftY, passes. For audio: `audioMix`, `audioSustain`, `audioFbDecay`.
