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
| `feedback` | **off** | on/off | Off = straight per-frame pixel sorting (each frame sorted independently). On = temporal feedback: smear accumulates, drifts, decays, clears at keyframe resets. |
| `threshold` | **0** | 0–1 | Luma above this is eligible for sorting (and feedback). 0 = whole frame corrupts; 1 = untouched. The single most expressive knob. |
| `passes` | **64** | 0–64 | Sort passes per frame. A full 256→1 stride ladder is 18 passes, so 64 runs ~3.5 settling cycles. |
| `streak` | **256** | 1–256 | Longest compare-exchange stride (rounded down to a power of two). Directly sets how far pixels can travel per frame — the ribbon-length knob. 1 = classic single-step odd-even. |
| `decay` | 0.96 | 0.8–0.999 | *Feedback only.* Accumulator retention per frame. Higher = smear lingers longer. |
| `driftX` | 0 | ±0.01 | *Feedback only.* Horizontal smear, UV units per frame. |
| `driftY` | +0.0015 | ±0.01 | *Feedback only.* Vertical smear. **Positive = upward** (texture v grows toward the video's bottom). |
| `resetMinS` / `resetMaxS` | 4 / 10 | 1–30 / 2–60 | *Feedback only.* Keyframe rhythm: the accumulator resets to a clean frame at a random interval in this window. |
| `maxRes` | 1920 | 480–1920 | Processing resolution cap, long axis. Lower it on weak GPUs; output upscales through the overlay. |
| `audioEnabled` | on | on/off | Master switch for the audio pipeline (effective only while `enabled` is also on — the kill switch restores everything). |
| `audioAlgorithm` | **spectral** | spectral / granular | Spectral: STFT magnitude spectrum gets the stride-ladder sort, phases stay — smeared, organ-like, ~43 ms latency. Granular: 20–100 ms grains reordered by loudness within a window — stuttered, shuffled, latency = the window. |
| `audioMix` | 1 | 0–1 | Wet/dry. Under granular latency, mid values read as an echo against the original rather than a blend. |
| `audioThreshold` | 0 | 0–1 | Loudness gate (normalized per window/frame). Quiet grains/bins are barriers, like dark pixels. 0 = everything participates. |
| `audioSortPasses` | 8 | 0–64 | Stride-ladder passes over grains or spectral bins. 0 = passthrough (latency only). |
| `audioGrainMs` | 60 | 20–100 | *Granular only.* Grain length. |
| `audioWindowS` | 1 | 0.25–2 | *Granular only.* Sort window — equals the added audio latency, so A/V desync ≈ this. The window boundary is the audio keyframe rhythm. |
| `audioMaxTaps` | 4 | 1–8 | Concurrent processed elements, most-recently-playing first. |
| `maxVideos` | 8 | 1–16 | Concurrent video jobs, biggest visible first. Paused videos count too — they get a one-shot sorted still (rVFC never fires for them). |
| `imageFps` | 12 | 1–30 | *Feedback only.* Tick rate for animated images. Straight-sort stills don't animate at all. |
| `imageAnimCap` | 12 | 0–24 | *Feedback only.* Max concurrently animated images (≥200 px side, biggest visible first); the rest stay stills. |

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

## Audio pipeline

Every `<video>` and `<audio>` element gets an audio job; playing elements
are tapped via `createMediaElementSource` into one shared AudioContext and
routed through the DEFLECTION worklet (an `AudioWorkletProcessor` — the
fragment shader for sound). Sorting semantics mirror the video shader:
stride-ladder compare-exchange, loud rises toward the start/low end, quiet
material is a barrier.

**The feedback toggle is audiovisual.** When `feedback` is on, audio gains a
decaying, slowly drifting delay line (`decay` → feedback gain, `|driftY|` →
drift depth) that hard-clears on the same jittered `resetMinS`/`resetMaxS`
keyframe rhythm as the video accumulator.

Rules the implementation lives by:

- **Taps are permanent** (a Web Audio limitation): disable is a click-free
  wet/dry bypass inside the graph. Bypassed processors idle at ~zero cost.
- **CORS silence is predicted, never repaired**: tapping a cross-origin
  element without proper CORS silences it unrecoverably (both wet AND dry),
  so unsafe elements are never tapped — their original audio plays
  untouched. Safe: same-origin, `blob:`/`data:`/MediaStream (YouTube's MSE
  is `blob:`), or `crossorigin="anonymous"`. Everything else stays clean.
- **DRM (`mediaKeys`/`encrypted`) is never tapped.** If a tapped element
  later swaps to a DRM source, that title's audio is lost until the next
  src swap — logged, unrecoverable, rare.
- **Autoplay policy**: the context may start suspended; engagement queues
  until the first user gesture. The kiosk flag
  `--autoplay-policy=no-user-gesture-required` removes the wait entirely.
- A page that runs its own Web Audio on an element wins: the tap attempt
  throws, we abandon with `page-web-audio`, sound stays intact.
- Element `volume`/`muted` sit upstream of the tap — page mute buttons keep
  working through our chain.

Latency: spectral ≈ 43 ms (imperceptible); granular = `audioWindowS`
(0.25–2 s of A/V desync — the displaced soundtrack reads as part of the
corruption; lower the window if it bothers you).

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
decay, driftY, passes.
