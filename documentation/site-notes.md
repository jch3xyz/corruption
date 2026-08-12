# Site notes

Per-site quirks observed during development. The sweep-first design means
nothing here is load-bearing — these are hints and known limitations.

## YouTube

- `yt-navigate-finish` fires on `window` after SPA navigation; the registry
  sweeps immediately on it rather than waiting for the observer.
- The player reuses the same `<video>` element across navigations and
  re-parents it between miniplayer / theater / fullscreen. Jobs survive both:
  resolution changes are handled in place per rVFC tick, and the sweep's
  health check re-inserts an orphaned overlay.
- Blink's UA stylesheet gives `<video>` `object-fit: contain`; YouTube
  positions the video with inline left/top/width/height inside
  `.html5-video-container`. The overlay replicates computed object-fit, so
  letterboxing aligns.
- YouTube Movies / anything EME-encrypted: the `encrypted` event /
  `mediaKeys` gate abandons the job and leaves the video untouched.
- Text mode, checked against live search results (2026-08-12): video titles
  live in the light DOM (`yt-formatted-string` wraps the text but does not
  hide it in a shadow root). Writing `nodeValue` produced **zero** childList
  mutations (the character-data rule holds against Polymer) and the
  framework did not revert the write within 2 s. Grid feeds on a signed-in
  home page are still John's to confirm.

## Instagram

- The main player (clicked reels/posts, home feed) is MSE — `blob:` src,
  origin-clean, works directly. That's why clicked reels always distorted.
- **Explore-grid reel previews are direct cross-origin mp4s** from the
  scontent CDN with no `crossorigin` attribute → no-cors fetch → tainted GL
  upload → the job used to abandon (`tainted-source`) and the preview played
  untouched. Recovered now by the detached CORS mirror in video-job.js: the
  same URL re-fetched with `crossorigin="anonymous"` (the DNR rule stamps
  ACAO on it), pipeline fed from the mirror, page element never touched.
  Loose sync (0.3 s drift correction) — invisible under the smear.
- Reel-tile thumbnails are plain `<img>`s (image route 2); when a tile looks
  untouched it is usually the preview *video* stacked above the (distorted)
  thumbnail, so fixing the video fixes the tile.
- (Historical: the swap-mode card rule this stack forced — overlap detection
  plus once-per-pass claiming — lives at tag `text-swap`. The page-wide
  scramble has no card concept, so the stack is irrelevant to it.)

## General / known limitations

- Videos using native browser controls (`controls` attribute) keep working
  under the overlay, but the controls themselves are invisible while
  mirrored (the original element is opacity:0). Custom-controls players
  (YouTube, Instagram) are unaffected. Revisit if a target site needs
  native controls.
- Shadow-DOM-hosted media is not discovered (`querySelectorAll` doesn't
  pierce shadow roots). No mainstream target does this for its main player
  today; log here if one appears. The text mode inherits this: the walker
  starts at document.body and does not descend into shadow roots, so text
  inside one stays legible.
- Hidden tabs stop rendering entirely (no rVFC, no IntersectionObserver).
  This is correct behavior — the kiosk tab is always visible — but it means
  the test harness must run in a visible tab.
