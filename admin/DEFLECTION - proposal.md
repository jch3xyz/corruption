# DEFLECTION

**Proposal B of 3**
Installation proposal, working draft
New Media Nashville

---

## Premise

A browser extension that intercepts every video frame and every image on the live web and runs them through a GPU shader before they reach the screen. Pixel sorting, with temporal feedback so the damage accumulates and clears the way codec failure does.

The bytes arrive perfectly. The rendering is what bends.

---

## Statement

Nam June Paik put a magnet on the outside of a television in 1965. The broadcast reached the set intact. What Paik altered was the electron beam, meaning the apparatus of display rather than the channel of transmission. *Magnet TV* is not a piece about broadcasting. It is a piece about the fact that seeing is mediated by a machine, and machines can be reached.

DEFLECTION is the same gesture translated to a screen with no electron beam to bend. The magnet becomes a fragment shader, and the gap it exploits is the moment between decode and display, which on modern hardware is roughly four milliseconds wide and completely programmable.

Pixel sorting is the specific operation because it is a rearrangement rather than a destruction. Every pixel that was in the frame is still in the frame. Nothing is added, nothing is lost, and the image becomes unreadable anyway. That is an argument about what images are made of, and it is a more precise argument than noise would be.

---

## What the visitor encounters

A terminal running an ordinary browser session on the live internet. The visitor browses YouTube, Instagram, a news site, whatever they came in already using.

Thumbnails bleed vertically, their bright pixels drawn upward into ribbons while the dark regions hold still. A video plays and the frame is intact for a moment, then sorting begins in the regions of highest contrast and spreads. Because each frame is composited against the previous one, the smear persists past the frames that caused it, drifting and stretching, until a reset clears the accumulator and the picture returns.

The interface underneath stays completely functional. Text is legible, buttons work, scrolling behaves. The visitor can navigate anywhere, and everywhere they go looks like this.

---

## Technical architecture

### Why an extension rather than a proxy

This piece operates after decode, on pixels, which means nothing can fail closed. There is no certificate to install, no encrypted channel to break into, and no possibility that a player abandons a stream because the data was malformed. It runs on the live web at full reliability, and it costs total control over the aesthetic in exchange for total predictability of the mechanism.

That is the right trade for a piece whose entire content is the visual result.

### Video path

A content script locates each `<video>` element and attaches a `requestVideoFrameCallback` loop, which fires in sync with decoded frames rather than with the display refresh. This matters: `requestAnimationFrame` will hand you the same frame twice at 60 Hz on a 30 fps video and produce judder in the feedback buffer.

Each frame is uploaded as a WebGL2 texture, run through the sorting pass, composited with the accumulator, and drawn to a canvas layered over the original video, which is set to zero opacity.

Canvas tainting is not an issue. YouTube feeds its video element through Media Source Extensions from a same-origin blob URL, so `texImage2D` on that element is permitted. This is the same mechanism that YouTube screenshot extensions rely on.

**DRM caveat.** Rented or purchased films use Widevine and will produce black frames. Ordinary uploads are unaffected. If the piece needs to survive a visitor wandering into YouTube Movies, detect black output and fall back to leaving the video untouched.

### The sorting pass

True pixel sorting is a sequential algorithm and fragment shaders are not sequential. The standard solution is a **bitonic sort** implemented as multiple ping-pong passes over the texture, sorting columns by luminance within thresholded spans. For a 1920-tall frame this needs roughly `log2(1920)^2 ≈ 121` passes for a full sort, which is too many at 60 fps.

Two practical approximations, either of which reads correctly:

**Partial bitonic.** Run only the first 20 to 30 passes. The result is locally sorted and globally streaky, which is visually closer to the classic effect than a complete sort anyway.

**Iterative odd-even transposition across frames.** Run 4 passes per frame and let the sort progress over time. The image visibly organizes itself while you watch, which is a stronger effect than an instantaneous one and costs almost nothing.

The second option is the recommendation.

### Temporal feedback

This is the component that separates a convincing result from an obvious filter. Real codec corruption persists because motion vectors keep referencing a damaged reference frame, and it only clears at a keyframe.

Reproduce it with a ping-pong framebuffer pair:

```glsl
// composite pass
vec4 incoming = texture(uFrame, vUV);
vec4 history  = texture(uAccum, vUV + uDrift);
float mask    = step(uThreshold, luma(incoming));
vec4 result   = mix(incoming, max(history * uDecay, incoming), mask);
```

`uDrift` gives the smear direction, `uDecay` sets how long it lingers, and `uThreshold` decides which regions are eligible. A periodic reset of the accumulator, every 4 to 10 seconds with jitter, supplies the keyframe rhythm.

### Image path

Images on Instagram and elsewhere are served from CDNs that do not reliably send CORS headers, so drawing an `<img>` straight to a canvas will taint it.

The reliable route runs through the extension's service worker, which has host permissions and is not subject to page CORS:

```js
const bytes = await (await fetch(src)).arrayBuffer();
const bitmap = await createImageBitmap(new Blob([bytes]));
// transfer to the content script, upload as texture, sort, replace
```

A `MutationObserver` catches images added by infinite scroll.

### Optional module: text scrambling

You flagged this as possibly too much. My assessment is that you are right about the naive version and there is a restrained version worth building.

The naive version walks text nodes and permutes characters. It is about fifteen lines of code and it destroys the piece, because an unreadable interface is an unnavigable interface, and a visitor who cannot find the search box leaves after ninety seconds.

The restrained version scrambles **only glyphs inside elements that also contain a corrupted image**, meaning video titles and captions rather than navigation and buttons. Chrome, menus, and search stay clean. The visitor can always get somewhere, and everything descriptive is unreliable.

Better still, and cheaper: **swap text between elements rather than scrambling within them.** Every title remains a real title, correctly spelled, attached to the wrong thing. That is more unsettling than noise and it preserves legibility completely.

Build it as a module with a runtime toggle. Decide during install, in the room, with the actual wall behind it.

---

## Minimum hardware specification

This piece is GPU-bound. The budget per frame is a texture upload, 4 to 30 sorting passes, and a composite, at 1080p and 30 to 60 fps. That is modest for a discrete GPU and meaningful for weak integrated graphics running alongside video decode.

### Minimum viable

| Component | Specification |
|---|---|
| CPU | 4 cores, Intel 11th gen / AMD Zen 2 or newer |
| GPU | Integrated Intel Iris Xe, AMD Vega 8, or Apple Silicon. Must support WebGL2 with `EXT_color_buffer_float` |
| RAM | 16 GB |
| Storage | 256 GB SSD |
| Display | 1080p at 60 Hz |
| Network | 25 Mbps, wired preferred |

Intel N100 graphics will technically run this at 1080p30 with the 4-pass iterative sort. It will not hold 60 fps with a full-frame feedback buffer. If the N100 is what you have, lock the piece to 30 fps and it is fine.

### Recommended

| Component | Specification |
|---|---|
| Machine | Mac mini M4, base configuration |
| RAM | 16 GB unified |
| Storage | 256 GB |
| Display | 1440p or 4K at 60 Hz |

The Mac mini is the right answer for this one. Its GPU handles the shader work without effort, it is silent, it draws very little power, and it runs for weeks without intervention. Roughly $600.

The x86 equivalent is any machine with a discrete GTX 1650, RTX 3050, or better, which will also do the job at higher cost and higher noise.

### For 4K

4K pixel sorting quadruples the fragment work. Budget for an RTX 4060 or Apple M4 Pro, or render the shader at 1080p and upscale, which is visually acceptable because the output is already abstracted.

### Additional hardware

- Wired keyboard and mouse
- Second identical machine as cold spare for runs beyond two weeks
- No UPS strictly required, since there is no proxy state to corrupt, though it is cheap insurance against profile damage

---

## Build phases

**Phase 1, roughly 2 days.** Manifest V3 skeleton, content script injection, locate video and image elements on YouTube and Instagram, confirm canvas capture works without tainting.

**Phase 2, roughly 4 days.** WebGL2 pipeline. Texture upload, framebuffer ping-pong, a pass-through shader that proves the plumbing before any effect exists.

**Phase 3, roughly 5 days.** The sorting shader. This is the aesthetic work and it will take longer than the estimate because it is the part worth iterating on. Build a control panel with live sliders for threshold, decay, drift, and pass count, and drive them from a MIDI controller if you want to perform the piece during an opening.

**Phase 4, roughly 3 days.** Image path through the service worker, MutationObserver for infinite scroll, DRM black-frame detection and fallback.

**Phase 5, roughly 2 days.** Optional text module, built behind a toggle.

**Phase 6, roughly 2 days.** Kiosk hardening and a 1 week soak test.

---

## Failure modes

**YouTube re-renders and drops your canvas.** Their components rebuild the DOM on navigation. Mitigation is a MutationObserver that reattaches, plus a periodic sweep.

**Memory growth over a long run.** WebGL textures leak easily if framebuffers are recreated per frame. Allocate once, reuse, and test with a 72 hour run watching memory.

**Frame rate collapse on a heavy page.** Cap pass count adaptively from measured frame time.

**Widevine content.** Detect and bypass rather than showing black.

**Extension disabled by a Chrome update.** Pin the browser version and disable auto-update on the installation machine.

---

## Consent and signage

Simpler than Proposal A in every respect. No certificate authority, no proxy, no interception of encrypted traffic. The extension only alters what is drawn in its own tab.

Wall text should still note that the terminal is instrumented and that visitors should not log in to personal accounts. Session data wipes nightly.

If a visitor wants the extension, it can be given away. That is not true of Proposal A, and it may be worth building into the piece as a takeaway.

---

## Cost estimate

| Item | Approximate |
|---|---|
| Mac mini M4 | $600 |
| 1440p monitor | $250 |
| Keyboard, mouse, cabling | $60 |
| Cold spare machine | $600 |
| **Hardware total** | **≈ $1,510** |

A budget build on an N100 at 1080p30 brings the hardware to roughly $500 including a spare.

Development time is estimated at three weeks, with the sorting shader consuming most of it.

---

## References

Nam June Paik, *Magnet TV*, 1965, Whitney Museum collection
Kim Asendorf, *Pixel Sorting*, 2010, and the ASDF Pixel Sort processing sketch
Rosa Menkman, *The Glitch Moment(um)*, 2011
WebGL2 specification, `EXT_color_buffer_float`
