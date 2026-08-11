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
| `threshold` | 0.55 | 0–1 | Luma above this is eligible for sorting (and feedback). 0 = whole frame corrupts; 1 = untouched. The single most expressive knob. |
| `passes` | 12 | 0–64 | Sort passes per frame. 12 covers one full 32→1 stride ladder. More = deeper, more settled sorting per frame. |
| `streak` | 32 | 1–256 | Longest compare-exchange stride (rounded down to a power of two). Directly sets how far pixels can travel per frame — the ribbon-length knob. 1 = classic single-step odd-even. |
| `decay` | 0.96 | 0.8–0.999 | *Feedback only.* Accumulator retention per frame. Higher = smear lingers longer. |
| `driftX` | 0 | ±0.01 | *Feedback only.* Horizontal smear, UV units per frame. |
| `driftY` | +0.0015 | ±0.01 | *Feedback only.* Vertical smear. **Positive = upward** (texture v grows toward the video's bottom). |
| `resetMinS` / `resetMaxS` | 4 / 10 | 1–30 / 2–60 | *Feedback only.* Keyframe rhythm: the accumulator resets to a clean frame at a random interval in this window. |
| `maxRes` | 1920 | 480–1920 | Processing resolution cap, long axis. Lower it on weak GPUs; output upscales through the overlay. |
| `maxVideos` | 8 | 1–16 | Concurrent video jobs, biggest visible first. Paused videos count too — they get a one-shot sorted still (rVFC never fires for them). |

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
