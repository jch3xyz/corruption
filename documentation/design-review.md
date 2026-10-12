# CORRUPTION — Design review, round 1 (heuristic evaluation)

**Date:** 2026-10-12. **Method:** Nielsen heuristic evaluation, four
independent reviewers, each walking ten stranger tasks against the shipped
panel (screenshots at the 400×720 popup size, `source/panel/defs.js`,
`source/panel/panel.js`, `documentation/parameters.md`). Reviewers did not
see each other's reports; walk order was varied to reduce anchoring. The
yardstick is John's copy of Nielsen's ten heuristics
(`~/Reference/Usability Heuristics/`). Severity is Nielsen's 0–4 scale.
**Agreement** counts how many of the four reviewers raised the finding
independently; it is the strongest signal in this document.

**The user:** the stranger, not John (decided 2026-10-12). The panel is an
instrument and the interactivity is integral to the piece. John's expert
surface stays reachable but is the second user.

**The tasks walked:** (1) install, open YouTube, understand this thing is
the cause; (2) find the panel; (3) calmer without turning off; (4) wilder,
find the knobs that change the most; (5) turn off only the text; (6)
something went wrong, put it back; (7) learn what one knob does unaided;
(8) make an audible change and connect gesture to result; (9) save a
setting, later return to shipped defaults; (10) leave, and know it is off.

**Status of every finding below: open.** Nothing has been changed yet. The
next round is John's think-aloud evidence from two art crawls, which
outranks any heuristic here, then one merged list, then fixes.

---

## Findings, ranked

### 1. Nothing outside the panel says the piece exists, is the cause, or is on

**Heuristics** 1, 2, 10 · **Tasks** 1, 2, 10 · **Severity 4** · **Agreement 4/4**

Every stranger meets this on first contact, and there is no workaround
short of already knowing what they installed. A store installer sees
YouTube broken and the words unreadable and blames the site or their GPU.
After Ctrl+Shift+D nothing confirms the off state except the page itself.

*Evidence.* `manifest.json` has `"action": {}` with no `default_title`;
nothing in `source/` calls `setBadgeText`, `setIcon` or `setTitle`, so the
toolbar icon is identical on and off. No first-run screen, no in-page UI.
The master switch is a row labelled `enabled` whose only readout is
"on"/"off" inside a window the stranger has not found. The panel's title
is the only attribution anywhere. Chrome parks new extensions behind the
puzzle-piece menu; Ctrl+Shift+P appears only in parameters.md.

*Proposed fix.* Put state on the action icon (badge "ON" or a dimmed icon
when off) and a `default_title` that names the piece and says "click to
play, Ctrl+Shift+D pauses". On the first page after install, one
dismissible in-page mark: "CORRUPTION is bending this page. Click the icon
to play it." Never repeated. At the kiosk, open the panel alongside on
launch rather than behind the browser.

*Trade-off.* Against minimalism (8) and the piece's purity, which wants the
page to appear simply broken with no seam. The one-time mark and the badge
are the smallest intrusion that makes tasks 1, 2 and 10 possible at all.

### 2. "set defaults" sits beside "restore defaults", same word, opposite effect, no confirmation, and silently redefines the only way back

**Heuristics** 3, 5, 9 · **Tasks** 6, 9 · **Severity 4** · **Agreement 4/4**

One click the brief invites the stranger to make ("save a setting I like")
makes every later "put it back" gesture, including double-click-a-row and
the tooltip copy, return to their own state. The way to the shipped piece
becomes a two-step (clear saved, then restore defaults) through a button
that only appears after the damage and whose label does not say what it
clears. A stranger also reads "set defaults" as "set to defaults", so the
panic click on the wrong twin locks the wreck in.

*Evidence.* `panel.html` footer: two adjacent, identically styled buttons.
`panel.js` `btnSet` writes `userDefaults` immediately and flashes "saved"
for 900 ms; `btnRestore` then resolves every row through the saved set;
`btnClear.hidden = !saved`. parameters.md documents the ritual ("hit
'clear saved' first, then 'restore defaults'"). `btnRestore` is the only
one of the three buttons that does not flash, and nothing captures the
pre-restore state, so the global restore has no feedback and no undo.

*Proposed fix.* Two always-visible, plainly named actions, "back to my
saved" and "back to original", with original never redefinable. Demote
"save as my default" visually (secondary style, bottom of the block) and
have it show when it was saved. Flash "restored" on restore and offer a
transient undo for about ten seconds using the existing `flash()` helper
and a pre-restore snapshot.

*Trade-off.* One more button against minimalism (8), and a reversible
save rather than a modal confirmation, because a confirmation on a routine
action trains click-through (5 resolved by reversibility, per 3).

### 3. There is no "how much" handle, and the one expressive knob runs backwards under a programmer's name

**Heuristics** 2, 6, 7 · **Tasks** 3, 4 · **Severity 3** · **Agreement 4/4**

Every stranger's first intent is "less" or "more". Today calmer means
three knobs in three directions: `threshold` right (inverted), `audio mix`
left, `text min chars` right. The layout gives no cue which rows are the
dials; the claim that threshold is "the single most expressive knob" lives
only in its tooltip, on the third of seventeen identical rows.

*Evidence.* `threshold` at 0.05, handle hard left, tip "1 leaves the frame
untouched", so pushing right calms it and "wilder" has 5% of travel.
`temperature` (the other strongly visible knob) is explained as "fraction
of pair verdicts inverted per pass".

*Proposed fix.* One `intensity` macro row at the top of Video (and a
global one under `enabled`), right = more, driving threshold inversely and
temperature or flow forwardly. Leave the raw rows beneath for John.
Alternatively, a direction cue on threshold ("← more").

*Trade-off.* A macro can disagree with its underlying knobs (4) and adds a
row (8). Without it the gesture-to-result link, the core of the instrument
framing, does not exist.

### 4. The resting state pins most sliders at their ceilings, so "wilder" has nowhere to go

**Heuristics** 7, 3 · **Tasks** 4, 8 · **Severity 3** · **Agreement 3/4**

Handed an instrument, the stranger can only turn it down.

*Evidence.* At maximum in the shipped defaults: `sort passes` 64/64,
`streak` 256/256, `max res` 1920, `reset min s` 30, `reset max s` 60,
`audio mix` 1.00, `direct` 1.00, `fb tail` 0.999, `max taps` 8,
`sustain s` 12, `drive` 1.00. What remains to push (`temperature`,
`flow amount`, `body mix`) is not marked as the playable set.

*Proposed fix.* For the two or three performance knobs, either widen the
range so the default sits mid-travel, or mark them visually as the front
panel and accept that the rest are caps. Caps and timing rows (`max res`,
`max videos`, `reset min/max s`, `image anim cap`, `max taps`) belong in a
collapsed "engine" group.

*Trade-off.* A wider range invites values John never tuned (5); the clamp
and per-row restore fence it.

### 5. Forty-plus rows of equal weight; the four playable knobs look like `reset min s`

**Heuristics** 8, 6 · **Tasks** 3, 4, 5, 7 · **Severity 3** · **Agreement 4/4**

The first view ends at `max res`; Text and Audio, two of the four mediums,
are below the fold with no indication they exist. `text scramble`, the one
toggle a reader needs in a hurry, sits around 950 px down a 1737 px page
in a 720 px window.

*Evidence.* `02-full-page.png`; `DEFS` has no primary flag; no section
index, jump links or scroll cue.

*Proposed fix.* Collapse each section to its toggle plus two or three
primary rows with "more" disclosing the rest; put the four section master
toggles (video feedback, image feedback, text scramble, audio) in the
global block beside `enabled`, each jumping to its section; or a sticky
section strip at the top.

*Trade-off.* Duplicated controls (4) and John's full surface one click
further (7); the harness still sees every row.

### 6. The vocabulary is the author's, in labels and in tips

**Heuristics** 2, 10 · **Tasks** 3, 4, 7, 8 · **Severity 3** · **Agreement 4/4**

Task 7 technically passes (hover and read), but what the stranger learns
is machinery, and with thirty seconds and no hover habit the labels read as
a synth service menu.

*Evidence.* Labels: `streak`, `temperature`, `exciter`, `fb tail`,
`fb return`, `fb wobble`, `comb damp`, `drive`, `direct`, `body`. Tips:
"Longest compare-exchange stride, rounded down to a power of two"; "T60 at
the lowest string (55 Hz)"; "Maps to loop gain 0.5–0.95". Several tips
carry changelog ("since the detangle", "the pre-2026-08-13 behaviour")
that means nothing to a visitor. The tooltip box covers the three
neighbouring rows' values.

*Proposed fix.* Lead every tip with one plain sentence of what you will
see or hear ("lower = more of the picture melts"), the author's sentence
second, changelog removed. Plainer labels where cheap (`streak` → ribbon
length, `sustain s` → ring time, `fb tail` → echo length). Render the tip
in a fixed strip at the panel bottom instead of over rows.

*Trade-off.* Consistency with parameters.md and the MIDI sheet (4), and
some author precision (7); keep the internal key as the tip's last line.

### 7. Audio shows "on" even when nothing is being processed

**Heuristics** 1 · **Task** 8 · **Severity 3** · **Agreement 2/4**

On many sites the tap never engages (cross-origin media, past the cap), so
the stranger drags six sliders, hears nothing, and cannot tell "no effect"
from "not tapped". Silence with no cause is the most disorienting failure
an instrument can have.

*Evidence.* `max taps` tip: "beyond the cap, elements play dry"; no status
row for engaged taps anywhere. The MIDI block's "no device" line proves the
status pattern already exists in the panel. Three stacked gains
(`audio mix`, `direct`, `body mix`, all at 1.00) with overlapping meaning
compound it.

*Proposed fix.* One status line under the Audio divider ("2 sources
tapped" / "this page's audio can't be reached"), sourced from the registry
stats the console already exposes. Demote `direct` (kept "for comparison")
and give `body mix` a plain name.

*Trade-off.* Status copy is noise for John (8); one line earns its place
because it changes what the user does next.

### 8. The panel's gestures are hidden, and a double-click on the slider silently resets the row

**Heuristics** 6, 5, 3 · **Task** 7 · **Severity 2** · **Agreement 2/4**

*Evidence.* Double-click-to-restore, typed values, arrow stepping and the
MIDI ⊙ exist only in hover copy (`ROW_HINT`, `NUM_HINT`). The `dblclick`
handler excludes only the number field, so two quick clicks on a thumb to
nudge it reset the parameter. With `tooltips` off (persisted) there is no
help at all. Typed out-of-range values clamp with no notice.

*Proposed fix.* Exclude the slider from the row double-click; a one-line
legend under the title ("hover for help, double-click a label to reset");
flash the row when a typed value clamps.

*Trade-off.* One legend line (8).

### 9. Greyed rows give no reason

**Heuristics** 1, 6 · **Tasks** 7, 8 · **Severity 2** · **Agreement 3/4**

*Evidence.* `comb damp`, `fb clear s/min/max`, `image fps`,
`image anim cap` render at 0.35 opacity (`.row.inert`); nothing says that
`body` → comb or `fb clear` → on revives them.

*Proposed fix.* Indent dependent rows under their trigger, or show the
gating condition as a muted suffix in the value cell ("comb only").

*Trade-off.* One more row look (4).

### 10. Forty-plus ⊙ buttons with no MIDI device present

**Heuristics** 8, 6 · **All tasks** · **Severity 2** · **Agreement 2/4**

*Evidence.* ⊙ on every row while the MIDI block reads "no device"; one
click arms a learn that waits forever.

*Proposed fix.* Hide the ⊙ column until `midi-status` reports a device or
an "assign MIDI" mode is entered.

*Trade-off.* John plugs in before mapping (7); trivial.

### 11. "set defaults" is the wrong word for "save", and nothing says settings already persist

**Heuristics** 2, 1 · **Task** 9 · **Severity 2** · **Agreement 1/4**

The stranger looking for "save" will not find it under "defaults", and
does not know the panel already remembers every move, so may fear closing
it. Folded into finding 2's rename, plus one status line ("changes are kept
automatically").

---

## What the four reviewers agreed the stranger most needs

All four closings converged on the same three things, in their own words:

1. **A seam.** Somewhere outside the panel, a sign that a thing called
   CORRUPTION is doing this, with a name, a way in, and a way off. Today the
   instrument begins playing before anyone knows there is an instrument.
2. **A handle.** Three or four knobs that visibly are the piece, sitting
   mid-travel so they can be pushed both ways, whose direction matches
   intuition, and which answer within a second. Everything else behind a
   fold John still owns.
3. **A safe way to break it.** One primary restore that cannot be
   redefined by a misclick, a clearly secondary and reversible save, and a
   reply from the panel about what it is acting on, so that silence or a
   black frame is never a mystery.

## Trade-offs this review takes on purpose

- **Seam vs purity.** The piece's concept wants no in-page UI. The review
  recommends the smallest seam (badge, one-time mark) rather than none,
  because without it the stranger cannot complete the first task. This is
  John's call to make, and it is the one finding where the concept might
  legitimately overrule the heuristic.
- **Macro vs honesty.** An intensity macro is a second route to the same
  state. It is recommended because it is the only route the first user
  will take; the raw rows stay canonical.
- **Front panel vs full surface.** Collapsing sections costs John a click.
  The harness continues to assert every row exists, so the expert layer
  cannot silently rot.

## Next

1. John brings the two art-crawl observations as evidence against this
   list: anything observed in the room outranks anything inferred here.
2. Merge into one ranked list; fix the painful items first (findings 1–3
   are the release blockers), re-run the panel harness after each, and
   re-run this heuristic pass on the revised panel.
3. Log verdicts here as findings close, with the trade-off chosen.
