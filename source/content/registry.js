// Element discovery and job lifecycle. Design rule: no site-specific
// selector is load-bearing — the debounced MutationObserver makes discovery
// snappy, and the 2 s sweep makes it correct regardless of what a site's
// framework does to the DOM.

import { VideoJob } from './video-job.js';

const SCAN_DEBOUNCE_MS = 100;
const SWEEP_MS = 2000;

export class Registry {
  constructor(params) {
    this.params = params;
    this.jobs = new Map(); // video element → VideoJob
    this.visibleArea = new Map(); // video element → px² in viewport
    this.scanTimer = 0;
    this.sweepTimer = 0;

    this.io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          this.visibleArea.set(
            e.target,
            e.isIntersecting
              ? e.intersectionRect.width * e.intersectionRect.height
              : 0
          );
        }
        this.rebalance();
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] }
    );

    this.ro = new ResizeObserver((entries) => {
      for (const e of entries) this.jobs.get(e.target)?.syncGeometry();
    });

    this.mo = new MutationObserver(() => this.scheduleScan());
  }

  start() {
    this.mo.observe(document.documentElement, { childList: true, subtree: true });
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_MS);

    // Media events don't bubble, but they do capture through the document —
    // this is how a job waiting on metadata gets activated promptly.
    document.addEventListener(
      'loadedmetadata',
      (e) => {
        if (this.jobs.has(e.target)) this.rebalance();
      },
      true
    );

    document.addEventListener('fullscreenchange', () => this.syncAll());

    // YouTube announces SPA navigation; sweep immediately instead of waiting.
    window.addEventListener('yt-navigate-finish', () => this.sweep());

    this.scan();
  }

  scheduleScan() {
    if (this.scanTimer) return;
    this.scanTimer = setTimeout(() => {
      this.scanTimer = 0;
      this.scan();
    }, SCAN_DEBOUNCE_MS);
  }

  // Discover new media, purge disconnected elements, re-rank.
  scan() {
    for (const video of document.querySelectorAll('video')) {
      if (!this.jobs.has(video)) {
        this.jobs.set(video, new VideoJob(video, this.params));
        this.io.observe(video);
        this.ro.observe(video);
      }
    }
    for (const [el, job] of this.jobs) {
      if (!el.isConnected) {
        job.destroy();
        this.io.unobserve(el);
        this.ro.unobserve(el);
        this.jobs.delete(el);
        this.visibleArea.delete(el);
      }
    }
    this.rebalance();
  }

  // The backstop that makes observer edge cases irrelevant.
  sweep() {
    this.scan();
    const now = performance.now();
    for (const job of this.jobs.values()) job.checkHealth(now);
    this.syncAll();
  }

  syncAll() {
    for (const job of this.jobs.values()) {
      if (job.active) job.syncGeometry();
    }
  }

  // Activate the biggest visible videos up to the cap; suspend the rest.
  // Instagram-style feeds autoplay many videos at once — process the ones
  // that matter, leave the rest untouched rather than degrade everything.
  rebalance() {
    if (!this.params.enabled) {
      for (const job of this.jobs.values()) job.suspend();
      return;
    }

    const ranked = [...this.jobs.entries()]
      .filter(([, job]) => !job.abandoned && !job.destroyed)
      .map(([el, job]) => [this.visibleArea.get(el) ?? 0, job])
      .sort((a, b) => b[0] - a[0]);

    let slots = Math.max(1, this.params.maxVideos ?? 8);
    for (const [area, job] of ranked) {
      if (area > 0 && slots > 0) {
        job.activate();
        if (job.active) slots--;
      } else {
        job.suspend();
      }
    }
  }

  refresh() {
    this.rebalance();
  }

  stats() {
    let active = 0;
    let abandoned = 0;
    for (const j of this.jobs.values()) {
      if (j.active) active++;
      if (j.abandoned) abandoned++;
    }
    return { tracked: this.jobs.size, active, abandoned };
  }
}
