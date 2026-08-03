// Per-video job. Phase 1 renders a plain 2D mirror of each decoded frame —
// proving discovery, overlay geometry, lifecycle, and DRM gating before any
// WebGL exists. The rVFC loop and state machine carry over unchanged when
// the GL pipeline replaces drawImage.

import { Overlay, objectFitRect } from './overlay.js';

export class VideoJob {
  constructor(video) {
    this.video = video;
    this.overlay = null;
    this.ctx = null;
    this.active = false;
    this.abandoned = false; // DRM or unattachable: leave the element alone
    this.destroyed = false;
    this.mirrored = false; // original hidden, canvas showing
    this.rvfcId = 0;
    this.lastFrameAt = 0;
    this.savedOpacity = null;
    this.natW = 0;
    this.natH = 0;
    this.fitRect = null;

    this.onFrame = this.onFrame.bind(this);
    this.onEncrypted = () => this.abandon('drm');
    video.addEventListener('encrypted', this.onEncrypted);
  }

  activate() {
    if (this.active || this.abandoned || this.destroyed) return;
    const video = this.video;
    if (video.mediaKeys) return this.abandon('drm');
    if (!('requestVideoFrameCallback' in video)) return this.abandon('no-rvfc');
    if (video.videoWidth === 0) return; // retried on loadedmetadata / sweep
    if (!this.ensureOverlay()) return;

    this.active = true;
    this.natW = 0; // force fit-rect recompute on first frame
    this.syncGeometry();
    this.scheduleFrame();
  }

  suspend() {
    if (!this.active) return;
    this.video.cancelVideoFrameCallback(this.rvfcId);
    this.active = false;
    this.unmirror();
  }

  ensureOverlay() {
    if (this.overlay && this.overlay.canvas.isConnected) return true;
    if (this.overlay) {
      // Element was re-parented and our canvas dropped; rebuild in place.
      this.overlay.destroy();
      this.overlay = null;
    }
    try {
      this.overlay = new Overlay(this.video);
      this.ctx = this.overlay.canvas.getContext('2d');
      return true;
    } catch {
      this.abandon('no-parent');
      return false;
    }
  }

  scheduleFrame() {
    this.rvfcId = this.video.requestVideoFrameCallback(this.onFrame);
  }

  onFrame() {
    if (!this.active || this.destroyed) return;
    const video = this.video;
    this.lastFrameAt = performance.now();

    if (video.mediaKeys) return this.abandon('drm');

    // Src/quality swaps change resolution in place (YouTube reuses its
    // <video> across SPA navigations) — recompute, don't tear down.
    if (video.videoWidth !== this.natW || video.videoHeight !== this.natH) {
      this.natW = video.videoWidth;
      this.natH = video.videoHeight;
      this.syncGeometry();
    }

    if (this.natW > 0 && this.fitRect) {
      const { x, y, w, h } = this.fitRect;
      try {
        this.ctx.drawImage(video, x, y, w, h);
        if (!this.mirrored) this.mirror();
      } catch {
        // Decoder hiccup; skip the frame, keep the loop alive.
      }
    }

    this.scheduleFrame();
  }

  syncGeometry() {
    if (!this.overlay) return;
    if (!this.overlay.sync()) return;
    const { width, height } = this.overlay.lastGeom;
    if (this.natW > 0) {
      this.fitRect = objectFitRect(this.video, width, height, this.natW, this.natH);
    }
  }

  // Hide the original only after a frame is actually on the canvas.
  mirror() {
    this.savedOpacity = this.video.style.opacity;
    this.video.style.opacity = '0';
    this.overlay.show();
    this.mirrored = true;
  }

  unmirror() {
    if (!this.mirrored) return;
    this.video.style.opacity = this.savedOpacity ?? '';
    if (this.overlay) this.overlay.hide();
    this.mirrored = false;
  }

  // Called from the registry sweep: self-heal a dropped overlay (YouTube
  // re-parents its player) and a stalled rVFC chain (some src swaps).
  checkHealth(now) {
    if (!this.active) return;

    if (!this.overlay || !this.overlay.canvas.isConnected) {
      this.unmirror();
      if (this.ensureOverlay()) {
        this.natW = 0; // recompute fit rect on next frame
        this.syncGeometry();
      }
      return;
    }

    const v = this.video;
    const stalled =
      !v.paused && !v.ended && v.readyState >= 2 && now - this.lastFrameAt > 2000;
    if (stalled) {
      v.cancelVideoFrameCallback(this.rvfcId);
      this.scheduleFrame();
    }
  }

  abandon(reason) {
    if (this.abandoned) return;
    this.suspend();
    this.abandoned = true;
    if (this.overlay) {
      this.overlay.destroy();
      this.overlay = null;
    }
    console.log('[DEFLECTION] video left untouched:', reason);
  }

  destroy() {
    if (this.destroyed) return;
    this.suspend();
    this.destroyed = true;
    this.video.removeEventListener('encrypted', this.onEncrypted);
    if (this.overlay) {
      this.overlay.destroy();
      this.overlay = null;
    }
  }
}
