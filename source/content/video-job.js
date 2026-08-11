// Per-video job. Phase 2 routes every decoded frame through the shared
// WebGL2 pipeline — upload, passthrough into the float accumulator
// ping-pong, present, then a same-task drawImage into the overlay canvas.
// Output is still a pixel-exact mirror; the sorting and feedback shaders
// replace the passthrough stage in Phase 3.

import { Overlay, objectFitRect } from './overlay.js';
import { acquireGL } from '../gl/context.js';
import { createBundle, destroyBundle } from '../gl/pipeline.js';
import { FrameGovernor } from './metrics.js';

export class VideoJob {
  constructor(video, params) {
    this.video = video;
    this.params = params;
    this.overlay = null;
    this.ctx = null;
    this.glc = null;
    this.bundle = null;
    this.active = false;
    this.abandoned = false; // DRM, taint, or unattachable: leave it alone
    this.destroyed = false;
    this.mirrored = false; // original hidden, canvas showing
    this.rvfcId = 0;
    this.lastFrameAt = 0;
    this.savedOpacity = null;
    this.natW = 0;
    this.natH = 0;
    this.fitRect = null;
    this.governor = new FrameGovernor();
    this.nextResetAt = 0;

    this.onFrame = this.onFrame.bind(this);
    // GPU objects die with the context; drop them and realloc next frame.
    this.onGLRestore = () => {
      this.bundle = null;
    };
    this.onEncrypted = () => this.abandon('drm');
    video.addEventListener('encrypted', this.onEncrypted);
  }

  activate() {
    if (this.active || this.abandoned || this.destroyed) return;
    const video = this.video;
    if (video.mediaKeys) return this.abandon('drm');
    if (!('requestVideoFrameCallback' in video)) return this.abandon('no-rvfc');
    if (video.videoWidth === 0) return; // retried on loadedmetadata / sweep

    if (!this.glc) {
      this.glc = acquireGL();
      if (!this.glc) return this.abandon('no-webgl2');
      this.glc.onRestore(this.onGLRestore);
    }
    if (!this.ensureOverlay()) return;

    this.active = true;
    this.natW = 0; // force fit-rect recompute on first frame
    this.nextResetAt = 0; // first frame after (re)activation is a clean keyframe
    this.syncGeometry();
    this.scheduleFrame();
  }

  suspend() {
    if (!this.active) return;
    this.video.cancelVideoFrameCallback(this.rvfcId);
    this.active = false;
    this.unmirror();
    // GPU bundle is kept: suspended jobs resume cheaply (plan: allocate
    // once, reuse). Disconnected elements release it via destroy().
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

  onFrame(now, metadata) {
    if (!this.active || this.destroyed) return;
    const video = this.video;
    this.lastFrameAt = performance.now();
    this.governor.sample(now, metadata);

    if (video.mediaKeys) return this.abandon('drm');

    // Context lost: keep the loop alive but do no GL work until restore.
    if (this.glc.lost) {
      this.scheduleFrame();
      return;
    }

    // Src/quality swaps change resolution in place (YouTube reuses its
    // <video> across SPA navigations) — recompute, don't tear down.
    if (video.videoWidth !== this.natW || video.videoHeight !== this.natH) {
      this.natW = video.videoWidth;
      this.natH = video.videoHeight;
      this.syncGeometry();
    }

    if (this.natW > 0 && this.fitRect) {
      try {
        this.renderFrame(video, now);
        if (!this.mirrored) this.mirror();
      } catch (err) {
        if (err && err.name === 'SecurityError') {
          // Cross-origin source without CORS taints the upload. Phase 4
          // adds the DNR-backed recovery; until then, leave it alone.
          return this.abandon('tainted-source');
        }
        // Transient GL/decoder hiccup: skip the frame, keep the loop alive.
      }
    }

    this.scheduleFrame();
  }

  renderFrame(video, now) {
    const glc = this.glc;
    const gl = glc.gl;
    const params = this.params;

    // Processing resolution: native capped at maxRes on the long axis,
    // further scaled down by the governor when the pipeline falls behind.
    const maxRes = (params.maxRes || 1920) * this.governor.resScale();
    const scale = Math.min(1, maxRes / Math.max(this.natW, this.natH));
    const procW = Math.max(1, Math.round(this.natW * scale));
    const procH = Math.max(1, Math.round(this.natH * scale));

    let b = this.bundle;
    if (!b || b.srcW !== this.natW || b.srcH !== this.natH || b.w !== procW || b.h !== procH) {
      if (b) destroyBundle(gl, b);
      b = this.bundle = createBundle(gl, this.natW, this.natH, procW, procH);
    }

    const p = glc.pipeline;
    p.uploadFrame(b, video);

    // Keyframe rhythm: every resetMinS..resetMaxS seconds (with jitter) the
    // accumulator is overwritten with a clean frame and the damage clears,
    // the way codec corruption clears at a keyframe.
    if (now >= this.nextResetAt) {
      p.runReset(b);
      const minS = params.resetMinS ?? 4;
      const maxS = Math.max(minS, params.resetMaxS ?? 10);
      this.nextResetAt = now + 1000 * (minS + Math.random() * (maxS - minS));
    } else {
      p.runComposite(b, {
        driftX: params.driftX ?? 0,
        driftY: params.driftY ?? 0,
        decay: params.decay ?? 0.96,
        threshold: params.threshold ?? 0.55,
      });
    }
    p.runSortPasses(
      b,
      this.governor.effectivePasses(params.passes ?? 4),
      params.threshold ?? 0.55
    );

    glc.ensureSize(procW, procH);
    p.present(b);

    // Same-task copy out of the shared GL canvas — valid without
    // preserveDrawingBuffer because nothing composites in between. The
    // present lands at the bottom-left of the (grow-only) canvas, which in
    // drawImage's top-left coordinates starts at canvas.height - procH.
    const { x, y, w, h } = this.fitRect;
    this.ctx.drawImage(
      glc.canvas,
      0,
      glc.canvas.height - procH,
      procW,
      procH,
      x,
      y,
      w,
      h
    );
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

  releaseGL() {
    if (!this.glc) return;
    this.glc.offRestore(this.onGLRestore);
    if (this.bundle && !this.glc.lost) {
      destroyBundle(this.glc.gl, this.bundle);
    }
    this.bundle = null;
    this.glc = null;
  }

  abandon(reason) {
    if (this.abandoned) return;
    this.suspend();
    this.abandoned = true;
    this.releaseGL();
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
    this.releaseGL();
    if (this.overlay) {
      this.overlay.destroy();
      this.overlay = null;
    }
  }
}
