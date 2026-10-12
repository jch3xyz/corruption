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

---

# Round 2: room evidence merged (2026-10-12)

John's observations from two art crawls and from his own use, including an
unplanned live use during a lecture performance, merged against round 1.
Room evidence outranks the heuristics; where it confirms a finding the
severity stands or rises, where it adds something the reviewers could not
see it is a new item, and where it answers a question the review had
deferred it is logged as a decision.

## Who the user turned out to be

- The people who **played** were synth-literate: music or video
  synthesizer users. Not technical people, but people who know what a
  wet/dry, a mix, a decay and a threshold do. Design language follows from
  this: **instrument conventions are allowed, programmer vocabulary is
  not.** This resolves round-1 finding 6 (vocabulary) toward synth terms,
  not toward plain English.
- The people who resonated with the **concept** read it as activism. That
  argues for portability and usability over everything: the extension as
  the release form, installable by anyone, and a first-run seam so they
  know what they have.
- The piece is also **a live performance tool with zero setup**: John
  played it through an Alan Watts video, subtle and intelligible at first,
  rising to fully washed out by the end. Smooth, continuous control over
  intensity across minutes is a real use, not a hypothetical one.

## The merged list, ranked

### M1. The on/off toggle is the piece's key gesture and it is a tiny checkbox

**Room evidence.** "The ability to instantly toggle it off, see the
original video, and toggle it back is what makes the piece click for
people." `enabled` is the most important control and it is extremely
small and hard to reach.
**Severity 4.** New; the reviewers rated `enabled` only for feedback, not
for size. The A/B is how strangers understand the work at all.
**Direction.** One large, unmistakable A/B control at the top of the
panel, a hold-to-bypass gesture as well as a latch, and the same control
reachable outside the panel (badge, shortcut shown on screen; see M3).

### M2. The preset system allowed the worst-case slip, and it happened

**Room evidence.** Settings drifted somewhere ugly over the night; John
went to restore defaults and pressed "set defaults". Round-1 finding 2,
confirmed in the room at the worst moment.
**Severity 4.**
**Direction.** Original is immutable and always one click away. Named
preset slots replace the single hidden snapshot. Every restore flashes
and has an undo. Save is visually secondary and reversible.

### M3. The panel does not say what it is, what it is for, or what to do

**Room evidence.** First glance reads as visual clutter. Round-1 findings 1
and 5 confirmed.
**Severity 4.**
**Direction.** A title line that names the piece and the gesture ("bend
the page, A/B to compare"), sections with far fewer rows in view, and the
seam outside the panel (badge, one-time mark) so the panel is found at
all.

### M4. Video mixes two effects and their setup into one list, and the visible effect has the least control

**Room evidence.** Two effects are going on: the pixel sort (the visible
one) and the temporal feedback. Their controls are interleaved with
engine setup (sort passes, streak, reset min/max, max res, max videos).
The sort offers density, speed and type, which are not what people reach
for; people want direct control over the distortion. The most responsive
controls are `threshold` and `motion gate` because they act as wet/dry.
There is a feedback toggle but no toggle for the whole video effect, unlike
text and audio.
**Severity 3**, confirmed and sharpened from round-1 findings 3, 4 and 5.
**Direction.** Video becomes three groups: **Sort** (front: threshold as
the wet/dry it already is, motion gate, then flow), **Feedback** (its own
toggle, decay, drift, reset), and **Engine** (collapsed: passes, streak,
res, max videos). Add a whole-video toggle beside the text and audio ones.
**Effects queue (not UI).** More direct handles on the sort itself: what a
"distortion amount" knob would be is an effects question, logged below.

### M5. Feedback reads as subtle because it only survives where the frame goes dark

**Room evidence.** People reach for feedback expecting something drastic
and see little; it mostly smooths harshness. John would not mind it being
intense and does not remember the original intent.
**What the code says.** The composite keeps history only where
`history × decay` is brighter than the incoming frame (how-it-works 2.4),
by design: it was built to persist damage the way a corrupted codec
reference frame does, clearing at keyframes (proposal, "Temporal
feedback"). So it is invisible over bright, moving footage and dramatic
only over dark regions, which is what "requires transparent sections"
describes.
**Severity 3**, an effects finding surfaced by the UI work, exactly the
feedback loop build-plan predicted.
**Effects queue.** Give feedback a blend the player can push: a mix amount
that is not brighter-wins (additive, screen, or a straight crossfade with
history), so intensity is a knob rather than a property of the footage.
The codec-faithful brighter-wins mode stays as one setting.

### M6. Image feedback is removed

**Room evidence.** "Basically pointless, I always have it off."
**Decision (John, 2026-10-12): remove `feedbackImage`.** Images keep
straight sorted stills. Remove the param, its row, its harness checks and
its documentation in one commit; the dead code path in image-job.js goes
with it. Image fps and anim cap go with it if nothing else uses them.

### M7. Text scramble needs a fast, obvious toggle

**Room evidence.** People like it, and they need to switch it off to read
and navigate, then back on. Round-1 finding 5 (below the fold) confirmed.
**Severity 3.**
**Direction.** The four medium toggles (video, images, text, audio) in a
row at the top under the A/B, each also a shortcut.

### M8. Audio has the same mixing problem, and sounds the same all night

**Room evidence.** An electronic musician read some of the audio knobs
intuitively, but effects and setup are interleaved as in video. Audio is
John's favourite part and still offers little control: it is a resonator
and a delay by design, and the result is one ambient sound regardless of
the video. The only way to make it differ is to let the direct signal back
in, which defeats the point once it becomes intelligible. John uses only
the modal body and the continuous exciter; the gated exciter "sounds like
distortion"; he does not remember the comb.
**Severity 3**, confirmed from round-1 findings 6 and 7, plus the
coherence-versus-specificity tension build-plan already names in the
audio A/B.
**Direction (UI).** Audio becomes **Body** (front: body mix as the
identity dial, sustain, drive), **Smear** (its own toggle, tail, return,
wobble), **Engine** (collapsed: taps, clears, exciter, comb damp). A
status line saying what is tapped (round-1 finding 7).
**Effects queue.** The body is fixed, so every source excites the same
chord. For it to sound different per video without re-admitting the direct
signal, something in the apparatus has to follow the source: the body's
tuning tracking the source's dominant pitch, the exciter's drive following
the source envelope more strongly, or a small set of bodies the player
chooses between. This is the A/B's successor question.
**Pending A/B, John's call:** comb body and gated exciter are candidates
for removal, but on a deliberate listen, not on memory of one night.

### M9. The panel is a separate window, and vertical

**Room evidence.** It is weird that the panel opens as another browser
window; is that how extensions work? A horizontal strip under the browser
window might be more intuitive than a vertical column beside it.
**What the code says.** An extension's UI is web pages, and Chrome gives
them several homes: an action popup (closes on blur, so useless as an
instrument), a separate window (what ships; chosen because Web MIDI
permission is per-origin and persists there), a **side panel** (docked
inside the browser window, Chrome 114+, same origin so MIDI persists too),
or an overlay the content script injects into the page itself.
**Severity 2** for the window itself; the layout question is bigger.
**Direction.** Two candidates to prototype: a side panel (docked, vertical,
no window management), and an in-page bottom strip laid out horizontally
like a mixer, which is the synth-user's expectation and the only way to
get "underneath the video". The strip has costs: it lives inside the page,
so fullscreen and page CSS can fight it. Prototype both against the same
tasks.

### M10. A body-tracking control surface

**Room evidence.** One visitor suggested MediaPipe: no knobs, people just
move. John's read: it trades understandability and control for novelty,
and if the user cannot do the specific thing they want, it is not an
instrument.
**Logged, not scheduled.** If it comes, it comes as another controller
beside MIDI, mapping pose to the same macros, never as the only surface.

## Findings from round 1 the room did not touch

Findings 8 (hidden gestures, slider double-click resets), 9 (greyed rows
without reason), 10 (⊙ on every row with no device) and 11 (nothing says
settings persist) stand at severity 2 and ride along with the
restructure.

## The effects queue (surfaced by the UI work)

1. A feedback blend the player can push (M5).
2. More direct handles on the sort's distortion (M4).
3. An audio apparatus that follows the source without re-admitting it
   (M8).
4. A performance ramp: one intensity macro that moves smoothly over
   seconds to minutes, for the Alan Watts case.

## Order of work

1. **M6**, image feedback removal: small, decided, clears a section.
2. **M1 + M2 + M3 + M7** together: the top of the panel becomes the A/B,
   the four medium toggles, and a sane preset row. This is one redesign of
   the global block and resolves four severity-4/3 items.
3. **M4 + M8**: regroup Video and Audio into effect / effect / engine.
4. **M9**: prototype side panel vs bottom strip on the regrouped controls.
5. Effects queue items as John picks them.
6. Re-run the heuristic pass on the result; next room test on the fixed
   task list.

---

# Round 3: heuristic pass on the revised panel (2026-10-12)

Three independent reviewers re-walked the ten stranger tasks against the
panel after M6, the global block redesign and the regrouping landed
(commits "Remove image feedback", "Panel global block", "Panel sections
regrouped"). Same method and yardstick as round 1.

## Round-1 findings, re-judged (consensus of three)

| # | Finding | Verdict |
|---|---|---|
| 1 | No seam outside the panel | **improved**: badge, title, lede and shortcuts; no in-page mark (John's call, open) |
| 2 | set/restore defaults twins | **closed** |
| 3 | No "how much" handle, threshold backwards | **improved**: caps make direction legible; no macro |
| 4 | Sliders pinned at ceilings | **improved**: caps folded into engine; headline knobs still at the rail |
| 5 | Forty rows of equal weight | **improved**: groups, folds, chips; Text and Audio below the fold |
| 6 | Author's vocabulary | **closed** (synth terms) |
| 7 | Audio "on" while untapped | **closed in code**, unverified in a real Chrome |
| 8 | Hidden gestures, slider double-click | **closed** |
| 9 | Greyed rows without reason | **closed** |
| 10 | ⊙ on every row | **closed** |
| 11 | "set defaults" means save | **closed** |

## New findings and what was done

Fixed in the commit "Panel round 3":

- **A slow deliberate click on the A/B did not latch** (3/3 reviewers,
  severity 3). Any press over 250 ms became a momentary compare that
  restored on release. Now any release under 600 ms latches; only a
  longer hold is the compare.
- **`original` beside an A/B that is about the original page** (3/3,
  severity 2). Renamed `default`, row captioned PRESETS, base shown as a
  dot rather than a pressed button.
- **The help strip cost 136 px at rest** (3/3, severity 2). Idle at one
  line; grows on hover as an overlay, never reflowing rows.
- **Audio's wet/dry was folded away as "output" while `dry` led the
  Body group** (2/3, severity 2–3). `mix` now leads Body; `dry` moved to
  Engine.
- Saving over a filled slot reads `replace A` and has undo; saving marks
  the slot as base; cancelling save mode flashes; loading while OFF says
  "switch ON to see it"; chip captions underline on hover and the landed
  header flashes; the images jump lands on SORT; `video` off gates the
  Feedback rows and both mediums off gate Sort; the MIDI hint hides
  without a device.

Held for John (they change what a knob means or put a seam on the page):

- **Threshold shown inverted as an `amount`** (1 − threshold, default
  0.95) so "wilder" has travel and the caps go away. The value cell would
  diverge from the stored key.
- **An intensity macro** driving threshold inversely and jitter or flow
  forwardly, the single "how much" handle the stranger reaches for. A
  second route to the same state; the raw rows stay canonical.
- **The in-page first-run mark.** The remaining half of finding 1.
- **Headline knobs at the rail** (ring time 12/12, drive 1, tail 0.999):
  widening ranges or moving defaults is an effects decision.

## Closing (consensus)

A synth-literate stranger can now find the piece, play it, break it and
recover in thirty seconds, in an instrument's words. What remains is the
"how much" handle and the seam on the page, both John's calls, and the
effects queue from round 2.

---

# Round 4: John tests the branch in real Chrome (2026-10-11)

The first local pass after the cloud session. John loaded the branch, played
the three homes and sent notes; each decided item landed the same day as
its own verified commit. Room evidence outranks the heuristics, as before.

## Decisions taken

- **The strip is the home** (M9 closed). "I prefer the bottom strip to the
  separate webpage approach." Its recorded concerns, re-weighed: covering
  the bottom of the page (the real cost — answered by resting as a 28 px
  rail), fullscreen hiding it (open; a keyboard-summoned overlay is the
  direction if it matters), MIDI in a cross-origin iframe (demoted with
  MIDI itself), CSP/CSP-like refusal (the 8 s failure path), Ctrl+Shift+P
  contention and extension detectability (footnotes). At rest the strip is
  a **transport line** — John's pick over fold-to-tab (the key gesture two
  clicks away) and over always-open-translucent (always over the player's
  controls). No hover-to-unfold, on purpose: the rail sits where a scrubber
  often is. Unfolded, it is a 208 px mixer with sort · feedback · body ·
  smear in view at 1280 px and no sideways scroll (John: video and audio at
  hand without horizontal scrolling; the strip free to grow taller). A
  folded engine costs no column: its disclosure sits on the section's
  title line.
- **Text is a switch.** "Get rid of the text slider and just leave the
  toggle. It's more of an on/off effect anyway." `textMin` is gone; 8 is a
  constant; the Text section went with it; the four chips are the four
  masters, each with its own ⊙. Trade-off: one less control against a
  navigability dial the stranger never understood.
- **Gated controls hide; they do not grey.** "If controls are greyed out
  contingent on a different toggle being on, then those controls shouldn't
  be visible at all until the toggle is on." The gating switch stays as the
  header of the knobs it hides, so the surface unfolds as it is patched (the
  engine-fold gesture everywhere); a switched-off medium's section keeps
  its header and says which chip brings it back. Trade-off: recognition
  (you cannot see that feedback *has* knobs until it is on) for minimalism
  and the instrument feel; mitigated by the switch-as-header.
- **Help is a bubble, nothing at rest.** The help column "is very large,
  takes up a lot of real-estate, and stays present even with tooltips
  off"; "in an ideal world our control panel will be so intuitive that
  tooltips would be unnecessary." John's pick over a single help toggle
  with captions and over no help at all. Heuristic 10 (help at the moment
  of need) and 8 over an always-visible legend (6); the two hidden gestures
  are now only discoverable by hovering.
- **MIDI hides until a controller connects.** "While MIDI should still be
  a feature, it will by far not be the primary mode of operation. Primary
  mode of operation is keyboard and mouse." Its block and every ⊙ wait for
  a device; the chips carry a ⊙ each so every medium stays mappable.

## The finding that is still open: the controls themselves

John, verbatim in substance: the effects were separated from the engines,
but the controls were neither simplified nor changed in how they work; they
were given no more hold over the effect and no more intuitive handles;
the existing list was only made easier to navigate. And: *which* controls a
player needs *when*, and *what* they need to know about them then, should
be re-asked — keeping the feeling of an instrument rather than a control
panel, with the honest caveat that a synthesizer is an instrument with a
control panel.

A first cut, for John to argue with (it is an effects decision, not a
panel one — each line changes what a handle means):

| Effect | Handles, named for the result | Demoted to engine |
|---|---|---|
| Sort | amount (threshold, inverted), flow, wildness (jitter) | flow mode, flow scale, flow speed |
| Feedback | trail (decay), drift (one 2-D pad for drift x/y), follow motion (motion gate) | clear window |
| Body | ring (ring time), drive, mix | body type, exciter, comb damp |
| Smear | tail, level (return), wobble | clears and their timings |

The 2-D drift pad is the one new control form: two sliders become a
direction you push. This sits with open items 2–5 from round 3 (amount,
macro, headline knobs) and the effects queue from round 2; they are one
piece of work.

## Outside the box (John: "think of this extension like a harness on the
internet… it could be a whole overlay")

Logged, not scheduled:

- **A keyboard-summoned overlay** over the page (Ctrl+Shift+P in
  fullscreen): large handles, survives fullscreen, where the strip cannot.
- **Handles on the media itself**: hover a corrupted video and its own
  overlay appears — drag sets drift direction, scroll sets amount. The
  harness idea taken literally; a content-script surface, so a spike, not
  a commit.

## Verification

Headless Chrome via `node test/headless.mjs` (new this round; a background
tab in the app's pane reports hidden and fails a dozen checks for
nothing): panel 218/218, strip 41/41, text 35/35, audio tiers 34/34. Real
Chrome: John's checklist in build-plan.md, rewritten for the strip.

## Round 4b: John's notes on the strip (2026-10-12)

John played the strip on YouTube at ~2000 px wide and sent notes. Each
landed the same day as its own verified commit (four in all; build-plan.md
round 4b). His direction for the round: a detached window that answers to
its own shape, so the player sizes and places it.

### What he reported, and what landed

- **The rail is too small, and so are its targets.** The rail is 40 px (was
  28): the A/B 30 px tall with 13 px state, chip pills 28 px, preset
  buttons ~26 px, the fold button 26 × 26, gaps of 16 px. The harness holds
  every rail target at 26 px or more, at five widths.
- **A click anywhere on the rail should unfold it.** A click on the rail
  that is not on a control unfolds it, the title included; a chip, the
  A/B, a preset or ▴ does only its own job; while the preset row is in save
  mode the click only cancels the save, so one press never does two things.
- **The old CORRUPTION tab helped the strip stand out.** It is back,
  standing on the rail's top edge at its right end: *CORRUPTION ▴* folded,
  *▾* open; a click toggles, it never takes focus, it hides with the rest
  in fullscreen.
- **The mixer leaves most of the width empty; the controls could spread
  out and grow.** The mixer is 240 px (was 208): rows of 28 px, 12 px type,
  a 6 px slider track with a 16 px thumb, 58 px value fields. The effect
  columns spread with the width, `minmax(220px, 340px)`: the sort column
  measures 224.5 px at 1280, 264.5 at 1440, 282.5 at 1512, 336.5 at 1728
  and 340 at 1920, the cap.
- **Bug: *panel lives in* overlaps *flow scale*.** The prefs line
  overflowed the 228 px cluster into the lane. The cluster is 260 px and
  the prefs and MIDI lines wrap inside it. The guard that let it through
  measured only the four containers, whose own boxes never crossed; the
  new one checks that no descendant of the cluster crosses the lane's left
  edge, and with the old rules put back it fails at every width.
- **1280 is not a typical laptop; test wider.** The mixer and rail checks
  loop 1280, 1440, 1512, 1728 and 1920. Not anticipated: at 1280 the
  columns are ~225 px, and with 58 px value fields the threshold slider was
  no wider than its thumb once its *more · less* end captions were in. The
  agent hid the captions below 250 px; John then removed them everywhere
  (below). Each lane row stays a size container, where selects drop to
  11 px under 250 px.
- **A window responsive to its own shape.** Built. The layout follows the
  shape in every home: the strip's frame is the mixer, or the rail at
  40 px; the window and the side panel are the mixer at 900 px wide and
  2:1 or more, else the column, re-laid live as the window is dragged, the
  engine disclosures moving with it. The window remembers its size and
  place (`panelBounds`), and a second open focuses it, even after the
  service worker has slept.

### John's questions, answered (2026-10-12)

- **Could the strip push the page up instead of covering it?** Possible:
  bottom padding on the page root, undone when the strip is removed. It
  fails on apps with their own scroll container, where padding the root
  moves nothing. Declined; the strip keeps covering.
- **Fullscreen hides the strip.** It only matters for the performer, and
  the performer's home is the window on a second screen, as in the lecture
  performance.
- **What is CSP?** Content Security Policy: a header a site sends listing
  what its page may load, including which origins may be iframed. A strict
  one could refuse the extension's iframe. The strip's 8 s failure path
  then removes it, leaves the page as it was, and the icon and shortcut
  open the window instead. Untested on a strict site; github.com is on the
  checklist.
- **Can a page detect the extension?** Yes, because `panel.html` is
  web-accessible — but that is fingerprinting only, not a concern for an
  art piece, and it was already true before the strip: the content
  scripts are web-accessible for their dynamic import.
- **A responsive window.** Built as above: tall is the column, wide is the
  mixer, and it remembers its bounds.

### Trade-offs, stated

- The bigger rail covers 12 px more of the page (minimalism) for targets a
  stranger can hit (user control, error prevention).
- Click-anywhere on the rail is the flexible path; the tab and ▴ stay as
  explicit affordances (recognition over recall).
- Covering, not pushing: the page loses its bottom 40 px at rest and
  240 px open, in exchange for never restyling a page and never breaking
  an app that scrolls its own container.
- **Threshold's *more · less* captions are gone** (John, 2026-10-12: "it's
  confusing for people who know what a threshold is"). Round 3's "caps make
  direction legible" is withdrawn; the direction lives in the tip, and the
  *amount* question (round 3, held for John) is the real answer.

### Open visual notes

- With a MIDI device at 1280 the ⊙ column squeezes the lane's sliders to
  ~30 px and truncates the selects: too little width for MIDI rows at
  1280. Not addressed.
- *CORRUPTION* reads twice at rest: the rail's title and the tab.
- At 1920 the rail's controls end around x = 840 and the rest of the line
  is empty; the mixer's columns stop at the 340 px cap and leave ~230 px
  empty at the right.

### Decisions

Cover, do not push. The default home is deferred until both homes — the
strip and the responsive window — are judged on real use; the strip stays
the default in code meanwhile. The rail is ~40 px with large targets.

### Verification

Headless Chrome, `node test/headless.mjs panel strip text`: panel 299/299,
strip 52/52, text 35/35; audio 34/34 unchanged. Mixer and rail at 1280,
1440, 1512, 1728 and 1920; the window's shapes at 1000 × 320 (mixer) and
700 × 700 (column), with a live resize each way. The remembered bounds and
a strict-CSP site need a real Chrome: John's checklist in build-plan.md.

---

# Round 5: handles (2026-10-12)

## The decision

John's call: **handles first.** Of the candidates for the next step — the
feedback blend (M5), the source-following audio body (M8), an intensity
macro — he chose to answer his own round-4 note before adding a layer: the
groups had been made easier to navigate, but the controls were neither
simplified nor given more hold over the effect. The round-4 table above
was the brief, and it landed in four commits: amount (`1acd69b`), the
drift pad (`8ae1306`), the regroup and rename (`b7b1d34`), and these docs.

## The handles, as they landed

Each effect column now holds only its handles — three or four controls
named for what they do to the picture or the sound. Whatever shapes
rather than steers is filed in the engine, one fold away. Keys, storage,
`DEFAULTS`, presets and MIDI maps did not change; only labels, group
membership, order and tips.

| Column | Handles, in order (key where the label changed) | Moved to the engine |
|---|---|---|
| Video · sort | amount (`threshold`, inverted) · flow · jitter · ribbons (`streak`, promoted from the engine) | flow mode · flow scale · flow speed |
| Video · feedback | feedback (the switch) · trail (`decay`) · drift (pad: `driftX` + `driftY`) · follow motion (`motionGate`) | clear min s · clear max s |
| Audio · body | mix · body amount · ring time · drive | body type |
| Audio · smear | smear (the switch) · tail · level (`audioFbReturn`) · wobble | — (the clears were already there) |

The engines, in order: **Video** — sort passes, max res, max videos, flow
mode, flow scale, flow speed, clear min s, clear max s. **Audio** — body
type, dry, max sources, exciter, comb damp, smear clear, clear fade s,
clear min s, clear max s.

Where it departs from the round-4 cut: *wildness* stayed *jitter*;
`streak` was promoted as **ribbons** (the table had no length handle, and
ribbon length is what you see); trail and the pad now come before follow
motion, so the column reads switch → how long → which way → where; ring
and mix kept their round-3 labels (ring time, mix). Gating stayed keyed, so
a demoted row answers to the same switch as before: the flow shape hides
while flow is 0 and the clear timings while feedback is off, even inside
an unfolded engine.

## The two control forms

Both are driven by the control table in `defs.js`, not special-cased:

- **amount** — an inverted view (`invert: true`). The row shows and takes
  `max + min − v` through the pure `toView` / `fromView` helpers, so for
  threshold it reads amount = 1 − threshold (0.95 at rest) and up is more
  of the picture sorted. The slider, the typed value cell, the arrow keys
  and a MIDI sweep all speak the view; presets, storage, MIDI maps and
  `DEFAULTS` keep `threshold`. This answers the question round 4b left
  open when the *more · less* captions went.
- **the drift pad** (`pad: 'drift'`, `PADS.drift`) — `driftX` and `driftY`
  as one 2-D surface. Push the point and the trail slides that way, faster
  the further out; the cross is (0, 0); up on the pad is up on the
  picture. Drag it, or focus it and nudge with the arrows (shift ×10); two
  small typed fields take exact values; double-click the name or the pad
  restores both; each key keeps its own ⊙. In the mixer it spans two lane
  rows, the two cells its rows used to take.

## Trade-offs, stated

- **A fold away, for columns that read at a glance.** The flow's shape and
  the clear rhythm cost one click now (they are still recognised, not
  recalled, but behind a disclosure) so that every column is three or
  four handles named for the result (aesthetic and minimalist design;
  match between system and the real world: ribbons, trail, follow motion,
  level).
- **Amount agrees with its direction; the value cell no longer matches
  the stored key.** The number now climbs as the effect does (match with
  the real world); the tip says *stored inverted, as threshold* and its
  key line keeps it honest for storage and the MIDI sheet.
- **A new control form.** Two numbers become one gesture — a direction you
  push — at the cost of a form the stranger has not met on this panel; the
  cross, the two fields and per-axis learn keep it legible and playable
  from a controller.
- **The engines grew** to 8 and 9 rows, so an unfolded engine spills a row
  or two into a second column and the lane scrolls sideways only then. The
  effect columns still fit their eight cells (sort 6, feedback 6, body 7,
  smear 5) and stay in view, with no sideways scroll, from 1280 px.
- **A wider label column.** *follow motion* is the widest lane label, so
  the mixer's label column went 88 → 98 px and the sliders give up 10 px.

## Open visual notes

- An unfolded engine's spilled row sits at the top of its own column,
  level with the section titles and with no caption over it.
- With a MIDI device at 1280 the ⊙ column now squeezes the lane's sliders
  to ~20 px (round 4b noted ~30), and the drift pad's square is wider than
  its knob cell, so its fields crowd the pad and the ⊙ beside them. Too
  little width for MIDI rows at 1280, as before; not addressed.

## What is left

- **Headline knobs at the rail** (ring time, drive, tail) and the
  **intensity macro** — still John's, and the *which controls when*
  question rides with them.
- **The layers, in the order John accepted:** the feedback blend (M5)
  next, then the source-following audio body (M8), then the performance
  ramp, then the CSS-scramble toggle, which needs its feasibility read
  first.

## Verification

Headless Chrome, `node test/headless.mjs panel strip text`: panel 348/348
(299 before the round; 312 after amount, 335 after the pad), strip 52/52,
text 35/35. The panel suite pins the new group membership and labels, the
renamed handles' tips, the engines' exact contents in the table and the
DOM, the pad between trail and follow motion with follow motion ending the
feedback column at every strip width, no effect column spilling, and every
lane label on one line. Screenshots checked by eye: the mixer at 1512 and
at 1280 with a MIDI device, both engines unfolded at 1512 and 1920, and the
400 px column.
