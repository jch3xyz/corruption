// Element discovery and job lifecycle. Design rule: no site-specific
// selector is load-bearing — the debounced MutationObserver makes discovery
// snappy, and the 2 s sweep makes it correct regardless of what a site's
// framework does to the DOM.

import { VideoJob } from './video-job.js';
import { ImageJob } from './image-job.js';

const SCAN_DEBOUNCE_MS = 100;
const SWEEP_MS = 2000;
const IMG_MIN_SIZE = 48; // icons and spacers are never worth touching

export class Registry {
  constructor(params) {
    this.params = params;
    this.jobs = new Map(); // element → VideoJob | ImageJob
    this.visibleArea = new Map(); // element → px² in viewport
    this.routeStats = { direct: 0, cors: 0, sw: 0, failed: 0 };
    this.scanTimer = 0;
    this.sweepTimer = 0;
    this.imageDirtyTimer = 0;
    this.imageTicker = 0;
    this.imageTickerFps = 0;

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
    // prompt activation for videos gaining metadata and lazy-loaded images.
    document.addEventListener(
      'loadedmetadata',
      (e) => {
        if (this.jobs.has(e.target)) this.rebalance();
      },
      true
    );
    document.addEventListener(
      'load',
      (e) => {
        if (e.target?.tagName === 'IMG') this.scheduleScan();
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
    for (const el of document.querySelectorAll('video, img')) {
      if (this.jobs.has(el)) continue;
      if (el.tagName === 'IMG') {
        // Undersized now ≠ undersized forever (lazy placeholders); later
        // sweeps re-evaluate once layout gives them real size.
        if (el.clientWidth < IMG_MIN_SIZE || el.clientHeight < IMG_MIN_SIZE) {
          continue;
        }
        this.jobs.set(el, new ImageJob(el, this.params, this.routeStats));
      } else {
        this.jobs.set(el, new VideoJob(el, this.params));
      }
      this.io.observe(el);
      this.ro.observe(el);
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
    this.ensureImageTicker();
  }

  syncAll() {
    for (const job of this.jobs.values()) {
      if (job.active) job.syncGeometry();
    }
  }

  // Videos: activate the biggest visible up to maxVideos. Images: render
  // whatever is visible (stills are one-shot; cost is bounded by decode).
  rebalance() {
    if (!this.params.enabled) {
      for (const job of this.jobs.values()) job.suspend();
      this.ensureImageTicker();
      return;
    }

    const videos = [];
    const images = [];
    for (const [el, job] of this.jobs) {
      if (job.abandoned || job.destroyed) continue;
      const area = this.visibleArea.get(el) ?? 0;
      (job.kind === 'image' ? images : videos).push([area, job]);
    }

    videos.sort((a, b) => b[0] - a[0]);
    let slots = Math.max(1, this.params.maxVideos ?? 8);
    for (const [area, job] of videos) {
      if (area > 0 && slots > 0) {
        job.activate();
        if (job.active) slots--;
      } else {
        job.suspend();
      }
    }

    for (const [area, job] of images) {
      if (area > 0) job.activate();
    }

    this.ensureImageTicker();
  }

  // Called on chrome.storage changes: re-rank, and if an effect-shaping
  // param moved, re-render stills (debounced — panel drags write at 30 Hz).
  paramsChanged(changed) {
    this.rebalance();
    const effectKeys = ['threshold', 'passes', 'streak', 'feedback', 'maxRes'];
    if (Object.keys(changed).some((k) => effectKeys.includes(k))) {
      clearTimeout(this.imageDirtyTimer);
      this.imageDirtyTimer = setTimeout(() => {
        for (const job of this.jobs.values()) {
          if (job.kind === 'image') job.markDirty();
        }
        this.rebalance();
      }, 200);
    }
  }

  refresh() {
    this.rebalance();
  }

  // Feedback mode animates big on-screen images at imageFps; straight-sort
  // stills need no ticker at all.
  ensureImageTicker() {
    const want = this.params.enabled && this.params.feedback;
    const fps = Math.min(30, Math.max(1, this.params.imageFps ?? 12));
    if (!want) {
      if (this.imageTicker) {
        clearInterval(this.imageTicker);
        this.imageTicker = 0;
      }
      return;
    }
    if (this.imageTicker && this.imageTickerFps === fps) return;
    if (this.imageTicker) clearInterval(this.imageTicker);
    this.imageTickerFps = fps;
    this.imageTicker = setInterval(() => this.tickImages(), 1000 / fps);
  }

  tickImages() {
    const cap = this.params.imageAnimCap ?? 12;
    if (cap <= 0) return;
    const ranked = [];
    for (const [el, job] of this.jobs) {
      if (job.kind !== 'image' || job.abandoned || !job.active) continue;
      const area = this.visibleArea.get(el) ?? 0;
      if (area > 0 && job.animEligible()) ranked.push([area, job]);
    }
    ranked.sort((a, b) => b[0] - a[0]);
    const now = performance.now();
    for (let i = 0; i < ranked.length && i < cap; i++) {
      ranked[i][1].tick(now);
    }
  }

  stats() {
    let active = 0; // video jobs only; images have their own counter
    let activeImages = 0;
    let abandoned = 0;
    let imageJobs = 0;
    for (const j of this.jobs.values()) {
      if (j.active) j.kind === 'image' ? activeImages++ : active++;
      if (j.abandoned) abandoned++;
      if (j.kind === 'image') imageJobs++;
    }
    return {
      tracked: this.jobs.size,
      active,
      activeImages,
      abandoned,
      imageJobs,
      images: { ...this.routeStats },
    };
  }
}
