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

## General / known limitations

- Videos using native browser controls (`controls` attribute) keep working
  under the overlay, but the controls themselves are invisible while
  mirrored (the original element is opacity:0). Custom-controls players
  (YouTube, Instagram) are unaffected. Revisit if a target site needs
  native controls.
- Shadow-DOM-hosted media is not discovered (`querySelectorAll` doesn't
  pierce shadow roots). No mainstream target does this for its main player
  today; log here if one appears.
- Hidden tabs stop rendering entirely (no rVFC, no IntersectionObserver).
  This is correct behavior — the kiosk tab is always visible — but it means
  the test harness must run in a visible tab.
