# How DEFLECTION works

A technical description of the piece as built. For *what the knobs do* see
[parameters.md](parameters.md); for *status and what remains* see
[build-plan.md](build-plan.md); for per-site quirks see
[site-notes.md](site-notes.md).

The thesis in one line: **the transmission arrives perfect and the apparatus
of display bends it.** Nothing is fetched, injected, or generated — every
photon and every sample the visitor perceives derives from bytes the browser
already decoded. Both the visual and audio paths are strictly *interception
and deformation*, and both are built so that any failure returns the original
media untouched.

---

## 1. The shell

**Manifest V3 extension, no build step, no dependencies.** Vanilla ES modules
loaded from `source/` via "Load unpacked".

Content scripts can't be ES modules, so `content/bootstrap.js` is a classic
script whose only job is a dynamic `import()` of `content/main.js`. That
requires the module files to be listed in `web_accessible_resources`
(`content/*.js`, `gl/*.js`, `gl/shaders/*.js`, `audio/*.js`) — a missing entry
there is a silent no-op, not an error.

Injection is `<all_urls>`, `all_frames: true`, at `document_idle`. `main.js`
early-exits in subframes smaller than 200×150 so ad iframes are never
instrumented.

### Discovery and the job model

`content/registry.js` owns discovery. The design rule is **sweep-first**: no
site-specific selector is load-bearing anywhere in the codebase.

```
MutationObserver (100 ms debounce) ─┐
2 s interval sweep ─────────────────┼─→ scan(): querySelectorAll('video, img, audio')
'yt-navigate-finish' fast path ─────┘         │
                                              ├─→ VideoJob   ┐
IntersectionObserver → visibleArea            ├─→ ImageJob   ├─ this.jobs      (ranked by visible area)
ResizeObserver       → syncGeometry()         └─→ AudioJob   ┘  this.audioJobs (ranked by recency of playback)
'playing' (capture)  → rebalanceAudio()
```

The MutationObserver makes discovery *snappy*; the 2 s sweep makes it
*correct*, which is why observer edge cases never became site-specific
patches. The sweep also runs each job's `checkHealth()` — that's where a
dropped overlay gets re-inserted and a stalled rVFC chain gets rescheduled.

Two ranking policies, deliberately asymmetric:

- **Visual** jobs rank by on-screen area; the biggest `maxVideos` (default 12)
  visible videos activate, the rest suspend. Images activate whenever visible.
- **Audio** jobs rank by *most recently started playback*, capped at
  `audioMaxTaps` (default 8). Visibility is irrelevant — a `display:none`
  `<audio>` playing music is exactly the target.

A `<video>` therefore carries **two independent jobs**: a VideoJob in
`this.jobs` and an AudioJob in `this.audioJobs`, which can be in different
states (mirrored but not tapped, tapped but suspended, either abandoned alone).

### Parameters

`chrome.storage.local` is the single source of truth. The panel writes
(batched at ~30 Hz so knob sweeps don't flood storage); every content script
subscribes via `chrome.storage.onChanged`, filtered against a whitelist of
`DEFAULTS` keys. `main.js` mutates the live params object **in place** and then
notifies the registry, so jobs read `this.params.x` and always see current
values; `paramsChanged(changed)` exists purely for side effects (re-ranking,
still invalidation, pushing params to worklets).

Consequence worth knowing: **stored values beat code defaults.** After editing
`DEFAULTS`, the panel's "restore defaults" is required or the old values
persist from storage.

Web MIDI maps one CC per parameter, learned in the panel and persisted under a
`midiMap` key that is deliberately *not* in `DEFAULTS` (which is what keeps it
from leaking into content scripts through the whitelist).

---

## 2. The visual side

### 2.1 One context, many jobs

Per-element WebGL contexts would hit Chrome's ~16-context cap on any feed page,
so there is **one shared WebGL2 context per page**, on a detached canvas
(`gl/context.js`). Jobs render into their own viewport region of it and copy
the result out.

WebGL2 plus `EXT_color_buffer_float` is required — the accumulator is RGBA16F
so smear can decay smoothly below 8-bit quantization. If either is missing,
`acquireGL()` latches `unavailable` and every job leaves its media alone.

Context loss is treated as a rehearsed path, not an exception: `webglcontextlost`
is `preventDefault()`ed (or the context never comes back), jobs skip GL work
while `lost`, and on restore the programs are rebuilt and every job drops its
now-invalid textures. **Extension enables reset with the context**, so
`EXT_color_buffer_float` is re-requested inside the restore handler — without
that, RGBA16F stops being color-renderable and every FBO draw fails silently to
black. The harness guards this specifically.

### 2.2 The per-job GPU bundle

```
frameTex   RGBA8    native video size      ← texSubImage2D target
accum[0]   RGBA16F  processing resolution  ┐ ping-pong pair,
accum[1]   RGBA16F  processing resolution  ┘ each with an FBO
```

Allocated once via `texStorage2D` and reused every frame — **the rVFC path
performs zero GPU allocations.** Processing resolution is native, capped at
`maxRes` on the long axis and scaled further by the governor, so the first
composite doubles as the downscale.

### 2.3 The per-frame sequence

Driven by `requestVideoFrameCallback`, which fires only on newly *presented*
frames. (Paused videos therefore never tick — they get one-shot renders on
`activate`, `seeked`, and `loadeddata`.)

```
uploadFrame(bundle, source)            texSubImage2D — throws SecurityError if tainted
   │
   ├── straight sort:  runReset()      passthrough copy of the frame → accumulator
   │
   └── feedback:       runComposite()  incoming vs drifted, decayed accumulator
                       runReset()      …except at a keyframe, which clears the damage
   │
runSortPasses(bundle, passes, threshold, streak)    K compare-exchange passes, ping-ponging
   │
present(bundle)                        → default framebuffer, bottom-left region, flipped
   │
ctx.drawImage(glc.canvas, …fitRect)    same-task copy into the overlay 2D canvas
```

The `drawImage` is valid without `preserveDrawingBuffer` precisely because it
happens in the same task as the `present` — nothing composites in between.

**Order matters and was a hard-won correction:** composite *into* the
accumulator, then sort *on* the accumulator, so sort progress genuinely
accumulates across frames rather than restarting each frame.

### 2.4 The composite shader (temporal feedback)

```glsl
vec4 incoming = texture(uFrame, vUV);
vec4 history  = texture(uAccum, vUV + uDrift);
vec4 kept     = max(history * uDecay, incoming);
float mask    = step(uThreshold, luma(kept.rgb));
outColor = mix(incoming, kept, mask);
```

Four behaviors fall out of those five lines: history **drifts** (sampling the
accumulator at an offset UV), **decays** (multiplied by `uDecay` each frame),
**wins where it is brighter** than the incoming frame, and **is confined** to
regions clearing the luma threshold.

The masking term is a deliberate deviation from the original proposal, and the
reason is instructive. Masking on `luma(incoming)` discards history the instant
a bright object moves off a pixel, so no smear ever outlives its source —
which defeats the entire point. Masking on `kept` lets smear persist over
newly-dark regions, decay on its own schedule, and self-clear once it falls
below threshold. The harness's trail test exists to catch a regression here.

Because texture *v* grows toward the video's bottom, **positive `driftY` makes
trails climb upward**.

### 2.5 The sort shader (the pixel sorting proper)

True pixel sorting is sequential and unshippable at frame rate. What runs here
is **generalized odd-even transposition with a stride** — a data-parallel
compare-exchange where every pixel decides its own output by looking at exactly
one partner.

```glsl
int s = int(uStride);
int block = p.y / s;
bool isUpper = ((block + int(uParity)) & 1) == 0;
int partnerY = isUpper ? p.y + s : p.y - s;
...
if (lSelf < uThreshold || lOther < uThreshold) { outColor = self; return; }  // barrier
if (s > 1) { /* span-midpoint threshold check keeps barriers honest */ }
outColor = (lUpper < lLower) ? other : self;                                 // symmetric swap
```

The swap is *symmetric*: both members of a pair independently compute the same
comparison and each outputs the other's value, which is what makes the pass
correct without any write coordination.

Three properties define the look:

1. **The threshold is a barrier, not a filter.** Sub-threshold pixels don't
   merely decline to sort — they refuse to be traded through, so sorting stays
   confined inside bright spans and dark material holds the image together. At
   strides > 1 the span midpoint is also checked, so a long stride can't
   teleport a pixel across a dark gap.
2. **Bright rises toward smaller *y***, i.e. the video's top. Fixed direction.
3. **The stride ladder** is what produces ribbons rather than mush:

```
top = largest power of two ≤ streak
schedule = [(top,0),(top,1),(top/2,0),(top/2,1), … ,(1,0),(1,1)]   cycled
```

At `streak: 256` that's 9 levels × 2 parities = 18 passes per full ladder, and
the default 64 passes runs about 3.5 complete cycles per frame. Long strides
move pixels far, fast; the stride-1 passes settle local order. This is the
"partial bitonic" shape: locally sorted, globally streaky.

### 2.6 The overlay

The output canvas is inserted as an **immediate sibling** of the media element,
absolutely positioned against the parent (patched to `position: relative` if it
computed to `static`), `pointer-events: none`. Sibling placement means it
survives scrolling with zero per-frame work and survives fullscreen because it
lives inside the fullscreened subtree.

Geometry sync is event-driven only (ResizeObserver, `fullscreenchange`, the
sweep) — never per frame. `objectFitRect()` replicates the element's *computed*
`object-fit` and `object-position` so letterboxing lines up exactly; Blink's UA
stylesheet gives `<video>` `object-fit: contain`, which is why this is needed
even on sites that never set it.

The original element is hidden (`opacity: 0`) **only after a frame is actually
on the canvas**, and restored the moment anything goes wrong. That ordering is
the whole "never break the page" guarantee in one line.

### 2.7 Getting the pixels at all: CORS

A cross-origin texture upload taints the context and throws `SecurityError`.
The extension's declarativeNetRequest rule sets `Access-Control-Allow-Origin: *`
on **image and media responses browser-wide while the extension is enabled**,
which makes recovery possible — but only for fetches that actually perform a
CORS check.

**Images** resolve through three routes, counted in
`__deflection.registry.stats().images`:

1. `direct` — same-origin or already clean.
2. `cors` — a detached `Image` with `crossOrigin = 'anonymous'` re-fetching the
   same URL; the DNR rule supplies the header.
3. `sw` — bytes fetched in the service worker and returned as a base64 data
   URL (MV3 messaging can't transfer binary, and service workers have no
   `URL.createObjectURL`). Rare; for signed CDNs that reject `Origin`-bearing
   requests.

All three failing leaves the image untouched. The page's own `src` is **never**
mutated — that would fight site lazy-loaders.

**Videos** were the gap until recently, and the reason is a genuine asymmetry:
*a media element without a `crossorigin` attribute fetches in no-cors mode and
never consults response headers*, so the DNR rule cannot help it. The fix is the
video sibling of image route 2 — on `SecurityError`, spawn a **detached
`<video crossorigin="anonymous">` on the same URL**, which does perform a CORS
check, does see the ACAO header, and is therefore origin-clean. The pipeline
reads from that mirror; the page's element is never touched and keeps playing.
The mirror follows it loosely (src swaps, play/pause, 0.3 s drift correction) —
loose is fine, because the output is smear, not broadcast.

This is what makes Instagram explore work: clicked reels are MSE (`blob:`,
origin-clean, always worked); grid previews are direct cross-origin mp4s that
used to abandon on taint.

### 2.8 Two safety nets

**The adaptive governor** (`metrics.js`, one per video) reads
`presentedFrames` deltas from rVFC metadata — a jump of 2+ means the compositor
presented frames the pipeline never processed. After 15 consecutive dropped
callbacks it steps down a ladder: first halve the sort passes (cheapest lever),
then processing resolution ×0.75, then ×0.5. Ten clean seconds steps back up.
It never touches storage, so the panel always shows the *requested* values, not
the degraded ones.

**The black-output probe** catches DRM and broken pipelines that slip past the
`encrypted`/`mediaKeys` gate and upload as pure black while the element itself
shows content. Every 2 s an 8×8 `readPixels` samples the center of the output;
two consecutive black reads *while playback is advancing* → unmirror and show
the original. It recovers automatically, so a legitimate fade-to-black only
ever swaps between two black rectangles.

### 2.9 Images specifically

Straight-sort mode is deterministic, so a still image gets **one** render per
source/params change and immediately releases its GPU bundle. Feedback mode
animates images ≥200 px from a registry-owned ticker at `imageFps`, capped at
`imageAnimCap` biggest-visible — those jobs retain their bundles.

### 2.10 The text mode (optional, off by default)

The sorting grammar applied to language, page-wide (`text-scramble.js`).
Letters rearrange **inside their own word**; anything that isn't a letter —
space, punctuation, digit, emoji — is a barrier no glyph crosses, exactly
as sub-threshold pixels refuse to be traded through in the sort shader.
Word count, word lengths, and every mark hold position, so the page keeps
its shape and loses its sense. Nothing added, nothing lost, unreadable
anyway.

This supersedes the proposal's recommendation (swap captions between
cards; that version is complete at tag `text-swap`) by John's call. The
proposal's objection to scrambling — an unreadable interface is an
unnavigable one — is answered by **`textMin`** rather than by containment:
only runs of at least that many characters are eligible, interface labels
are short, and prose is long. Form *values* aren't text nodes at all, so
search keeps working at any setting.

Hard exclusions, which are data-integrity rather than aesthetics:
`script`/`style`/`noscript` (a page's CSS is live text — scrambling it
wrecks layout rather than bending rendering), `input`/`textarea`/
contenteditable (the visitor's own words, which a site might save),
`aria-hidden` text, media fallback text, and our own overlays.

Two structural rules, both harness-guarded:

1. **Only `Text.nodeValue` is written.** Character data is not a childList
   mutation, so the registry's MutationObserver cannot see the write and
   cannot loop on it. Writing `textContent` or replacing nodes would.
2. **Records are self-invalidating.** If a site re-renders a node we hold,
   the value we wrote is gone, so the record is dropped rather than
   restored — stale text can never be written back over live content.
   This is the case that matters on YouTube, which reuses the same DOM
   nodes for the next video.

Scrambling is grapheme-aware (`Intl.Segmenter`) so combining accents travel
with their base letters, and a word is re-shuffled until it differs — a
short word that happens to shuffle into itself would otherwise read as a
skip. The walk reads no layout, so a pass costs no reflow; it rides the 2 s
sweep rather than the 100 ms scan, which both bounds its cost on busy feeds
and gives arriving text a moment of legibility before it dissolves —
the same rhythm as a video frame arriving intact and then sorting.

---

## 3. The audio side

Same philosophy, entirely different mechanism — and deliberately **not** the
pixel-sorting grammar transposed into the spectral domain. (That was the first
audio attempt; it worked and was removed for being derivative. Tag `audio-v1`.)

### 3.1 The tap, and why it's irreversible

```
                      ┌─→ dry gain ─────────────┐
<video>/<audio> ──────┤                         ├─→ destination
   (page element)     └─→ AudioWorklet → wet ───┘
```

Two facts drive the entire design:

**`createMediaElementSource()` is permanent.** Once an element is tapped, its
audio routes through the graph for the element's lifetime, a second tap throws
`InvalidStateError`, and there is no un-tap. So taps live in a `WeakMap` keyed
by element that **survives job destroy/recreate** (YouTube re-parents its
`<video>` across navigations, destroying and rebuilding the job), and "off" is
always a wet/dry gain bypass — 30 ms `setTargetAtTime` ramps, click-free.

**Taint cannot be detected after the fact.** A cross-origin element without
CORS outputs *silence* through both the wet and dry paths, unrecoverably —
and unlike the video path there is no re-fetch trick, because the tap is on the
element itself. So safety is **predicted before tapping**:

```
mediaKeys present            → 'drm'   (never tap)
srcObject (MediaStream)      → 'safe'  (origin-clean by construction)
blob: or data:               → 'safe'  (YouTube/Instagram MSE lands here)
same-origin URL              → 'safe'
crossOrigin === 'anonymous'  → 'safe'
anything else                → 'cors'  (never tap — original plays untouched)
```

Bypassing also **disconnects the worklet's input** 150 ms after the ramp, so
`process()` sees an empty input array and returns immediately. N bypassed
processors on a feed page cost essentially nothing.

The AudioContext is created with `latencyHint: 'playback'` — a bigger buffer,
more DSP headroom, worse latency, which is the correct trade for an
installation. Because a page's context may start suspended under autoplay
policy, engagement is queued behind a `whenRunning()` gate that any real user
gesture drains (and the kiosk flag `--autoplay-policy=no-user-gesture-required`
makes moot).

### 3.2 Inside the worklet: the shared shell

One processor, `'deflection-audio'`, running on 128-sample render quanta. Every
block:

```
input → finiteness sanitize (non-finite → 0)
      → DC block            y[n] = x[n] − x[n−1] + 0.9995·y[n−1]
      → mono sum (for onset detection)
      → presence gate       open above −55 dBFS · close after 200 ms below −65 dBFS
      → BodyEngine
      → FeedbackLayer       (if enabled)
      → soft clip           0.5·tanh(2x)   ≈ −6 dBFS knee
      → silence gate        exact zeros once input is absent and the engine hits the floor
```

`process()` is wrapped in a try/catch that reports the error over the port and
outputs silence for that quantum — because **an uncaught throw permanently
kills the processor**, and since taps are irreversible, a dead processor means
permanently silent media. That would violate "never break the page" in the one
way that can't be undone.

A 1 Hz stats message (input RMS, silence duration) goes back to the page,
where it's used to detect unpredicted CORS silence.

### 3.3 The body engine

**The apparatus has one permanent voice, and the browsing only decides how hard
it is driven.** This is the most literal Magnet-TV reading available for sound:
a fixed physical deformation the transmission passes through. It's also the
answer to the hardest problem in the piece — how do eight hours of unrelated
internet audio cohere as one work? — because the identity lives in the
resonator, not the source.

**48 modal resonators.** Three fundamentals in just intonation
(55 / 82.5 / 137.5 Hz) × 16 partials, with a stretch:

```
f_k  = k · f₀ · √(1 + 4e-4·k²)      stretched partials — an object, not a comb
T60  = sustain · (55/f)^0.7          higher modes always die faster
amp  = 1/√k                          natural spectral tilt
```

The stretch is what makes the bank read as a struck *object* rather than a
harmonic comb. Modal resonators (not waveguides) were chosen precisely so the
stretch survives — a comb would drag in its own integer harmonics and swamp it.

Each mode is a two-pole resonator, `y[n] = a₁y[n−1] − a₂y[n−2] + g·x[n]`, with
`r = 10^(−3/(T60·fs))`, `a₁ = 2r·cos(ω)`, `a₂ = r²`.

**Two exciter modes, two different normalizations** — and this distinction was
found by the harness, not by theory:

- **`gated`** — an onset detector (512-pt FFT, half-wave-rectified spectral
  flux against an adaptive mean, 80 ms refractory) opens a ~60 ms envelope, so
  the body is genuinely *struck* and then rings. Impulse-normalized: `g = amp`.
- **`continuous`** *(the piece's chosen state)* — the stream drives the bank
  continuously. This requires the constant-peak-gain **resonz** form: gain
  `amp·(1−r²)/2` with a `(1 − z⁻²)` numerator, i.e. injecting `x[n] − x[n−2]`.
  Without those zeros, a plain two-pole's low-frequency skirt lets a single
  sustained tone pin all 48 modes at their limits and the sum rails the clip —
  the harness caught exactly that (output flat at 0.498 RMS). The zeros kill
  the skirt, so continuous input excites only its *sympathetic* partials.

A per-sample amplitude cap (±0.35) is the hard backstop. It has to be
per-sample: a resonantly driven mode grows several-fold within one 128-sample
block, so a block-rate cap would let the output rail between checks — also
harness-caught.

### 3.4 The smear layer

A recirculating delay line on the body's output — a *layer*, not a mode:

```
echo  = interpolated read at 0.35 s · (1 + depth·sin(2π·0.1t))
out   = in + gain · echo
line ← tanh(out)                    soft-clipped write-back bounds it absolutely
gain  = 0.5 … 0.95   from fbDecay 0.8 … 0.999
depth = min(0.4, |driftY| · 100)    ← the visual drift knob, inherited coupling
```

**It never clears, by design.** The video accumulator needs its keyframe reset
against mud buildup; the audio loop doesn't, because its gain is capped strictly
below 1 — every echo generation decays geometrically — and the `tanh` bounds the
line absolutely. Clearing was only ever the aesthetic mirror of the video
keyframe, and continuous sounds better. The optional `audioFbClear` restores
the keyframe rhythm, in which case the clear *fades* the echo return over
`audioFbClearS` and wipes the line only once it's inaudible (a one-sample cut is
invisible in a glitching image but very audible in a wash).

Note the live coupling: `driftY: 0` — the current default — means the audio
smear has **no wobble**, a static echo stack rather than a tape-warble.

### 3.5 Silence in, silence out

The constraint that keeps the piece honest: **the process may never generate
sound independently.** With memory in the system (a delay line at 0.999 decay
rings for tens of seconds) that isn't automatic, so it's enforced rather than
assumed: once the presence gate closes and output peak sits below −80 dBFS for
five consecutive blocks, the processor snaps to **exact zeros** and resets both
the resonator state and the delay lines — so stale echoes can never resurface
with the next sound. The harness asserts bit-exact zeros on silent input.

---

## 4. Invariants that hold everywhere

- **One shared expensive resource per page** (the GL context, the AudioContext);
  per-element jobs hold allocate-once buffers; the frame and audio paths perform
  zero allocations.
- **Never break the page.** Every failure path abandons to untouched original —
  visible video, audible audio. Ctrl+Shift+D restores everything instantly.
- **Predict, don't detect, for audio safety** (taint is undetectable post-tap
  and unrecoverable); **detect and recover for video** (taint throws, and a
  crossorigin mirror is available).
- **Sweep-first discovery**; no site-specific selector is load-bearing.
- **The sorting grammar is visual only.** The audio path deliberately does not
  mirror it — that mirroring was the first audio attempt's mistake.
- **Deterministic tests where possible**: pure DSP with no audio API, then
  `OfflineAudioContext` renders of the real worklet, with live taps quarantined
  behind an explicit button. Assertions are structural invariants, never golden
  files.

## 5. Reading the code

```
source/
├── content/bootstrap.js   classic script → dynamic import (content scripts can't be modules)
│   ├── main.js            boot, params flow, tiny-iframe early-exit
│   ├── registry.js        discovery, ranking, caps, sweep, image ticker
│   ├── video-job.js       rVFC loop, DRM gate, CORS mirror, black probe, governor
│   ├── image-job.js       3-route CORS resolution, one-shot stills, animation
│   ├── audio-job.js       playback-driven tap lifecycle, safety gate, bypass
│   ├── text-scramble.js   optional text mode: letters rearranged inside words, page-wide
│   ├── overlay.js         sibling canvas, object-fit replication
│   └── metrics.js         FrameGovernor
├── gl/    context.js · pipeline.js · shaders/{common,passthrough,composite,sort}.js
├── audio/ graph.js · worklet.js · dsp.js · fft.js
└── panel/ panel.html · panel.js · panel.css · midi.js
```

Three rejected designs are preserved as tags and should not be resurrected:
`audio-v1` (spectral/granular sorting — mirrored the pixel-sort grammar),
`audio-bakeoff` (the time-base deflection engine: a 45 s reservoir read by
lag-controlled heads, which lost the live A/B), and `text-swap` (captions
traded whole between cards — John chose scrambling over it).
