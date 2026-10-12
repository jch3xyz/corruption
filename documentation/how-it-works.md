# How CORRUPTION works

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
`DEFAULTS`, press the panel's **default** preset or the old values persist
from storage. Presets (`presets`, slots A/B/C) and the double-click base
(`presetBase`) live in storage outside `DEFAULTS`; "default" is never
stored, so it always means the code as it stands.

The registry gates jobs in `rebalance()`: `enabled` off suspends every job
(and restores text); with it on, `video: false` suspends the video jobs and
`images: false` the image jobs at the same point, each reactivating on the
next rebalance once switched back. Audio and text answer to their own keys.

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
vec3 prev     = texture(uPrev, vUV).rgb;
vec3 decayed  = history.rgb * uDecay;
vec3 kept     = max(decayed, incoming.rgb);                 // brighter (uBlend 0)
if (uBlend == 1) {
  kept = mix(incoming.rgb, decayed, uMix);                  // mix: the crossfade
} else {
  if (uBlend == 2) kept = 1.0 - (1.0 - incoming.rgb) * (1.0 - decayed);  // screen
  else if (uBlend == 3) kept = clamp(incoming.rgb + decayed, 0.0, 1.0);  // add
  if (uMix < 1.0) kept = mix(incoming.rgb, kept, uMix);
}
float mask    = step(uThreshold, luma(kept));
float motion  = clamp(distance(incoming.rgb, prev) * 3.0, 0.0, 1.0);
outColor = vec4(mix(incoming.rgb, kept, mask), max(motion, history.a * 0.90));
```

Four behaviors fall out of those lines: history **drifts** (sampling the
accumulator at an offset UV), **decays** (multiplied by `uDecay` each frame),
**meets the incoming frame by a blend rule**, and **is confined** to regions
clearing the luma threshold.

**The blend** (`feedbackBlend` → `uBlend`, `feedbackMix` → `uMix`; design
review M5) is how the decayed history meets the new frame:

| Rule | `kept` | What you see |
|---|---|---|
| brighter (0, the resting state) | `max(decayed, incoming)` | the trail only where it outshines the frame — codec-faithful, hidden over bright motion |
| mix (1) | `mix(incoming, decayed, amount)` | a straight crossfade with history, the video-feedback classic |
| screen (2) | `1 − (1 − incoming)(1 − decayed)` | the trail lightens the frame, over light material too, without clipping |
| add (3) | `clamp(incoming + decayed, 0, 1)` | the trail piles on and burns to white |

For brighter, screen and add the amount then lerps from the incoming frame
(0: every frame fresh) to the full rule (1); for mix the amount *is* the
crossfade. **Brighter-wins stays the default for the reason it was built:**
real codec corruption persists because a damaged reference frame keeps
being referenced, and the damage shows where the new picture does not
overwrite it — in the dark. That makes the trail subtle over bright moving
footage, which is exactly what the room found (M5); the other rules trade
that fidelity for a trail that shows everywhere. At brighter and amount 1
the shader evaluates the original `max()` and skips the lerp, so the
resting state is the pre-blend expression, unchanged (tier 0 checks it
against `max(decayed, incoming)` on the read-back accumulator). The branch
is `if/else` on a uniform `int` — uniform control flow, no `switch` — which
compiles under ANGLE (verified on its SwiftShader backend headless). Two edges to know: **add burns** — on still
footage at decay 0.81 any channel above ~0.19 converges to white, since
`k = i + 0.81k` saturates; **mix at 1 is history alone**, so the frame
enters only where the decayed trail falls under the barrier, and the
picture freezes, fades and snaps back (~1/3 s at decay 0.81).

The masking term is a deliberate deviation from the original proposal, and the
reason is instructive. Masking on `luma(incoming)` discards history the instant
a bright object moves off a pixel, so no smear ever outlives its source —
which defeats the entire point. Masking on `kept` lets smear persist over
newly-dark regions, decay on its own schedule, and self-clear once it falls
below threshold. The harness's trail test exists to catch a regression here.
The mask reads `kept` after the blend, so true black stays a barrier in every
rule.

Because texture *v* grows toward the video's bottom, **positive `driftY` makes
trails climb upward**.

The alpha channel carries a **motion trail** for the sort pass's motion gate:
`|incoming − previous frame|`, amplified, decaying at ~0.90 per frame. The
reference is `uPrev` — a clean RGBA8 copy of the last frame, snapshotted into
the bundle after every composite/reset — never the accumulator, because the
accumulator holds *sorted* material and diffing against it would measure our
own damage and read the whole frame as motion. The blend never touches alpha:
the trail is the same in every rule at every amount. Alpha never reaches the screen
(the shared context is `alpha: false`), and it swaps along with its pixel, so
motion tags travel with their material.

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
2. **The higher key rises toward smaller *y***, i.e. the video's top. Fixed
   direction. The key is **luma** at rest — bright rises — and `sortKey`
   (*sort by*, round 8 part 2) swaps it for hue, saturation or one channel:
   `float key(vec3 c)` on `uKey`, plain if-chains on the int. Only the
   *ordering* reads the key (`lUpper < lLower` compares keys); the barrier
   tests — both members and the span midpoint — still read `luma()`, so
   amount means the same under every key and a dark but vivid pixel still
   walls the sort off under hue. The permutation argument is untouched:
   both members compute the same pair of keys and the same refusals. Key 0
   is the very same `luma()` expression, so the resting picture is
   bit-identical, and equal keys never trade.
3. **The stride ladder** is what produces ribbons rather than mush:

The pairing axis itself became a parameter with the **flow field**
(`flowAmount`, John's pick from the dynamism survey): a per-bundle ¼-res
RG8 texture, rendered once per frame, holding the curl of value noise as
a CONTINUOUS unit direction. The sort pass quantizes it to one of 16
integer offsets — axes, diagonals, knight moves — because exchanges must
land on exact texels to stay permutations, and the quantization boundary
is **dithered per pass** (a golden-ratio sweep of ±half a sector). That
dither is the difference between facets and paths: a fixed quantization
anchors refusal seams wherever the field crosses a sector edge and
material pools there; with the boundary wandering, a cell near an edge
trades along one neighbor direction on some passes and the other on the
rest, so the average motion follows the true angle and ribbons genuinely
round their curves. Both grammars survive as **`flowMode`** — **paths**
(16 dithered sectors, the default) and **facets** (8 fixed sectors, no
dither: the first cut's look, straight faceted runs pooling at anchored
seams) — kept as peers because John liked both once he saw them. One
field texture, two quantizers in the sort pass.
Pairs are blocked by the projection `floor(dot(p,v) / (s·|v|²))` — for
v=(0,1) exactly the old y/s brick — and a pair only trades when both
endpoints quantize to the same v this pass. Partner symmetry survives
because the jitter is shared: if q agrees with p's direction, q's own
blocking arithmetic points straight back at p, and every refusal
condition is computed identically by both members. The curl is
divergence-free (streamlines swirl rather than draining), and the field
morphs in place over `flowSpeed`, so the ribbon geometry itself
re-carves over time. **Each element is its own instrument**: every job
draws a flow seed (rerolled when the element's SOURCE changes — YouTube
reuses one `<video>` across navigations, so the seed keys to content,
not element) from which the field shader derives five characters —
noise-domain home, phase, morph rate, swirl size, and handedness. Feeds
become a wall of distinct instruments and every clicked video deflects
its own way; the pipeline itself stays a pure function (the seed is an
input), which is what keeps the harness byte-reproducible. At `flowAmount 0` the sort is bit-identical to the
vertical grammar — harness-pinned, along with global pixel conservation
at full flow.

Two per-pair gates extend the grammar (John, 2026-08-12), both exactly inert
at 0 and both preserving the symmetric-swap/permutation property:

- **`temperature`** inverts the comparison verdict for a hash-chosen fraction
  of pairs each pass. The hash keys on the pair's shared identity (the upper
  member's coordinates + a per-pass seed), so both partners reach the same
  verdict and every pass remains a permutation. The sort simmers at its
  equilibrium; barriers still confine the boil to bright spans.
- **`motionGate`** requires BOTH members (and the span midpoint, at strides
  > 1) to carry a motion trail above the gate. min(), not max(), keeps the
  containment strict: a hot pixel cannot drag cold material into the churn,
  so the damage boundary IS the motion boundary. Harness-pinned: with the
  gate up, a moving band sorts while pixels outside it stay byte-identical.


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
source/params change and immediately releases its GPU bundle. Images never
animate: image feedback and its registry-owned animation ticker were removed
2026-10-12 (John's call, design review M6 — git history keeps them). The
feedback knobs shape video only.

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
unnavigable one — is answered by a **minimum run length** rather than by
containment: only runs of at least `TEXT_MIN` (8) characters are eligible,
interface labels are short, and prose is long. It was the `textMin` slider
until 2026-10-11, when John retired it as a knob (the mode is on/off) and
his setting became the constant. Form *values* aren't text nodes at all, so
search keeps working regardless.

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

**The apparatus has one permanent voice, and the transmission passes through
it.** The identity lives in the resonator, not the source — that is the answer
to the hardest problem in the piece, how eight hours of unrelated internet
audio cohere as one work.

> **Corrected 2026-08-13.** That sentence used to end "…and the browsing only
> decides how hard it is driven," and the code matched: the engine output was
> `sum(modes)` alone, so the input never appeared in the output. That made the
> source a scalar — a drive amount — and the result a resynthesis on a fixed
> 48-line basis. Meanwhile the *visual* side is a permutation whose global
> conservation the harness asserts. The audio path had no conservation law at
> all, and the audible consequence was exactly what you would predict: every
> video sounded like the same synth.
>
> Measured on the real worklet over four dissimilar probes, before the fix:
> envelope correlation with the source **0.22 average, −0.01 on speech-like
> material** — the output's loudness contour was statistically unrelated to the
> video's. Third-octave timbral contrast survived at 84%, so it was never a
> colour problem; it was a *time* problem, and source recognition is
> overwhelmingly temporal. Output energy above 2.3 kHz was 1.5%, since the bank
> stops at 2310 Hz and its 48 high-Q modes accept 54.3 Hz of the 24 kHz band —
> 0.23% of the spectrum.
>
> Both engines now output `direct·x + bodyMix·resonant`. The bank is a
> **filter** — bandpasses in parallel with a direct path, a resonating body the
> signal goes *through* — rather than a synth the signal triggers. Everything
> below (the stretch, the resonz normalization, the caps, the damping law) is
> unchanged; only the output sum is. Harness-asserted after: envelope
> correlation 0.94 on both engines, and `bodyMix 0` must reduce the whole
> apparatus to a wire.
>
> The cost, accepted knowingly: lattice salience falls from 25.2 to ~6.6, where
> raw unprocessed audio is 5.6. The fixed chord that unified the piece is
> mostly gone, and `audioBodyMix` is the knob that buys it back. If long
> sessions stop cohering, the fallback is a fixed transmission colour — a
> permanent EQ signature that costs no specificity because it does not depend
> on the content at all.

**48 modal resonators.** Three fundamentals in just intonation
(55 / 82.5 / 137.5 Hz) × 16 partials, with a stretch:

```
f_k  = k · f₀ · √(1 + 4e-4·k²)      stretched partials — an object, not a comb
T60  = sustain · (55/f)^0.7          higher modes always die faster
amp  = 1/√k                          natural spectral tilt
```

The stretch is what makes the bank read as a struck *object* rather than a
harmonic comb. Modal resonators (not waveguides) were chosen precisely so the
stretch survives — a comb drags in its own integer harmonics and swamps it.

That last claim was tested rather than inherited (2026-08-13), because a comb
became attractive once the engine had to be a filter: allpass dispersion in the
loop is the standard stiff-string trick for inharmonic partials, so it looked
like the objection might be answerable. It is not. K = 0, 6 and 12 first-order
allpass sections moved the partials **identically** — 0.06–0.08% deviation at
partial 10, where this table gives 1.98% — because a first-order allpass only
disperses near Nyquist and does nothing across 55–1500 Hz. So the comb engine
(§3.3b) is a peer with a different character, not a modal bank with a bug.
Don't re-try allpass stretch on it.

#### Following the source (`audioFollow`, design review M8)

The one permanent voice has a cost the room named: every source excites the
same chord, so the piece sounds the same all night, and the only way to make
one video differ from the next was to let the direct signal back in — which
defeats the point once it is intelligible. So something in the apparatus has
to follow the source, without the source becoming a control signal for a
synth. The answer that landed (round 7, 2026-10-12) is the body's *tuning*
tracking the source's dominant pitch, by an amount the player sets.

```
hz      = PitchFollower(mono)                 0 when unsure
r       = hz / 55 · 2^−k,  r ∈ [1, 2)          the octave fold (sticky by a semitone)
target  = r^follow                             geometric: follow 0 → exactly 1
ratio  += (target − ratio) on log, τ ≈ 200 ms  per block; unsure → target 1
f_mode  = ratio · k · f₀ · √(1 + 4e-4·k²)      every mode, both engines
```

**The follower** (`PitchFollower` in `dsp.js` — pure, chrome-free, tier-1
tested like the onset detector) keeps a 2048-sample ring of the mono feed
and every 1024 samples takes a Hann-windowed FFT, finds the strongest local
peak between 55 and 1000 Hz and interpolates it on the log magnitude (a Hann
main lobe is near-Gaussian, so the log-parabola is the accurate form). Two
gates make it say *unsure* rather than guess: the peak must stand 8× over
the band's median magnitude, and the window must be above −55 dBFS, the
shell's presence floor. White noise never passes the first (0 confident
blocks in 60 s measured); silence and a −83 dBFS tone never pass the second.
When a voice's or a horn's 2nd or 3rd harmonic outweighs its fundamental,
a subharmonic check takes the lowest of peak/3, peak/2 that is itself a
peak at ≥ 0.1 of the main one. A harmonic product spectrum was the obvious
alternative and was not used: it scores a plain sine no higher at its own
pitch than an octave below, so it would fail the simplest case. The /2 case
barely matters after the fold; the /3 case would put the chord a fifth off,
so it does. The reading is smoothed with a one-pole on log2(Hz) (~300 ms)
and the last confident value is held through ~1 s of unsure blocks before
the follower lets go.

**The fold** puts the source's pitch class on the chord's lowest note. Two
side effects are deliberate: octave errors cost nothing (110 and 220 Hz land
on the same ratio), and the chord moves at most an octave, so it stays in
the register it was voiced for. The fold is *sticky*: a male voice lives
around 110 Hz, exactly on the fold's edge, and a plain fold would throw the
chord most of an octave (108 Hz → 1.96, 112 Hz → 1.02) every time the voice
crossed it. With the previous octave remembered, the ratio may stray a
semitone past either edge before it refolds.

**Retuning** happens per block, never per sample, and only once the glided
ratio has moved 0.2 % since the last retune (or to land exactly on 1, so the
resting chord is the same doubles as ever). In the modal bank only the pole
angles move: `a1 = 2r·cos(2π·f·ratio/sr)`; the radii `r`, and with them each
mode's T60, the gains and the `y1/y2` state are untouched, so a ringing
partial glides to its new pitch instead of clicking. `modeTable` takes the
ratio as an optional third argument and computes the damping law on the
untuned frequency, which is the same statement: following the source moves
the pitches and nothing else. The comb (§3.3b) re-derives each line's delay
and loop gain (`CombLine.setFreq`); its read is already fractional, so there
is no whole-sample rounding, and its rings are allocated for half the base
pitch so retuning can never read past them.

**Why this is still a process, not a synth.** Nothing about the output sum
changes: it is still `direct·x + bodyMix·resonant`, the source still passes
through untouched, and with `bodyMix` 0 the apparatus is still a wire at
follow 1 (harness-asserted, both engines). The source does become a control
signal here — but for *where the body rings*, not for what is heard. That is
the line between this and the rejected designs: `audio-v1` re-sorted the
source's spectrum and `audio-bakeoff` re-read it in time; this leaves the
signal alone and moves the object it passes through.

**What it costs and buys.** At follow 0 the follower is never built and no
retune runs, so the resting state costs nothing and is bit-identical to the
fixed chord (verified sample for sample against the pre-follow worklet). At
follow 1, two plucked sources a fifth apart (220 and 330 Hz) come out less
alike: spectral correlation on the body alone 0.029 → 0.017 (modal) and
0.178 → 0.151 (comb), energy on the moved chord's new 123.75 Hz string ×950
(modal) — while each output keeps envelope correlation 0.94 with its own
source. In the shipped mix the body is quiet beside the direct path, so the
difference there is modest (0.171 → 0.159). And the pair is conservative:
220 Hz folds to ratio 1, and 330 Hz to 1.5, whose root is the fixed chord's
own 82.5 Hz string. The open question is the old one from §3.3's
correction: whether eight hours still cohere as one apparatus when the
apparatus retunes to every video. The fallback is unchanged — a fixed
transmission colour, which adds identity without following anything.

### 3.3b The comb engine

Three recirculating lines on the same fundamentals, added as a peer 2026-08-13
so the character question could be settled by ear rather than by argument:

```
v    = interpolated read at sr/f0        fractional delay, power-of-two ring
v    = (1−d)·v + d·v_prev                loop damping: high partials die first
fbk  = g·v                               g = 10^(−3·D_sec/t60), same T60 as modal
line ← tanh(x + fbk)                     write-back bounds the line absolutely
out  ← fbk·(1−g)                         level-normalised; the caller adds x
```

`step()` returns the resonant contribution *only*, exactly as the modal bank
returns its summed resonator outputs, so `audioDirect`/`audioBodyMix` mean the
same thing in both engines and the A/B stays level-matched. Exactly-harmonic
partials read as tube/pipe/spring; it rings harder than the filtered modal bank
(lattice salience ~12 against ~6.6) and costs roughly a tenth as much per
sample. Because the lines hold seconds of ring, `reset()` clearing them is
load-bearing for silence-in/silence-out, and the harness asserts it.

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
line ← tanh(in + loopGain · echo)   the TAIL; soft-clipped write-back bounds it
out   = in + return · echo          the LEVEL, independent of the tail
loopGain = 0.5 … 0.95   from fbDecay 0.8 … 0.999
return   = loopGain · audioFbReturn  0.25 default; 1 = the pre-2026-08-13 layer
depth    = audioFbWobble             its own knob (0–0.4) since 2026-08-12
```

**The tail and the level were one number until 2026-08-13, and that is the
second reason nothing survived this layer.** A recirculating loop at gain *g*
settles at roughly `1/(1−g)` times its input, so at 0.95 the wash sat about
**20× above the direct sound** and buried it — which is why fixing the engine
alone (§3.3) was not enough: with the old smear in front of it, speech envelope
correlation fell straight back to −0.01. Splitting them keeps the 47 s tail John
settled on and only decides how loudly it sits: at return 0.25, measured
correlation goes 0.22 → 0.89 with the tail untouched. `audioFbReturn` 1
reproduces the old layer exactly, and the harness pins both that and the
knob's direction.

**It never clears, by design.** The video accumulator needs its keyframe reset
against mud buildup; the audio loop doesn't, because its gain is capped strictly
below 1 — every echo generation decays geometrically — and the `tanh` bounds the
line absolutely. Clearing was only ever the aesthetic mirror of the video
keyframe, and continuous sounds better. The optional `audioFbClear` restores
the keyframe rhythm, in which case the clear *fades* the echo return over
`audioFbClearS` and wipes the line only once it's inaudible (a one-sample cut is
invisible in a glitching image but very audible in a wash).

The wobble depth and the clear rhythm were originally inherited from the
visual sliders (`driftY` and `resetMinS`/`resetMaxS`, exactly as the first
audio phase had them). That coupling was **detangled on John's request**
(2026-08-12): `audioFbWobble` and `audioFbClearMinS`/`audioFbClearMaxS` own
those behaviors now, and no visual parameter reaches the worklet at all —
the harness asserts this structurally. At the default `audioFbWobble: 0`
the smear is a static echo stack rather than a tape-warble, which is
unchanged from the resting state the coupling produced.

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
│   ├── registry.js        discovery, ranking, caps, sweep
│   ├── video-job.js       rVFC loop, DRM gate, CORS mirror, black probe, governor
│   ├── image-job.js       3-route CORS resolution, one-shot stills
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
