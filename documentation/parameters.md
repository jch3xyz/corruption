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
| `threshold` | 0.55 | 0–1 | Luma above this is eligible for feedback and sorting. 0 = whole frame corrupts; 1 = image passes through untouched. The single most expressive knob. |
| `decay` | 0.96 | 0.8–0.999 | Accumulator retention per frame. Higher = smear lingers longer. 0.999 barely clears; 0.8 is a short ghost. |
| `driftX` | 0 | ±0.01 | Horizontal smear, UV units per frame. |
| `driftY` | +0.0015 | ±0.01 | Vertical smear. **Positive = upward** (texture v grows toward the video's bottom). |
| `passes` | 4 | 0–16 | Odd-even sort passes per frame. 0 disables sorting (pure feedback). More passes = the image organizes itself faster. |
| `resetMinS` / `resetMaxS` | 4 / 10 | 1–30 / 2–60 | Keyframe rhythm: the accumulator resets to a clean frame at a random interval in this window. |
| `maxRes` | 1920 | 480–1920 | Processing resolution cap, long axis. Lower it on weak GPUs; output upscales through the overlay. |

## Shader mapping

- `threshold` → `uThreshold` in both the composite mask and the sort pass
  (both members of a compare pair must exceed it — dark pixels are
  barriers, so sorting stays inside bright spans).
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
