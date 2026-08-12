// Per-video job. Phase 2 routes every decoded frame through the shared
// WebGL2 pipeline — upload, passthrough into the float accumulator
// ping-pong, present, then a same-task drawImage into the overlay canvas.
// Output is still a pixel-exact mirror; the sorting and feedback shaders
// replace the passthrough stage in Phase 3.

import { Overlay, objectFitRect } from './overlay.js';
import { acquireGL } from '../gl/context.js';
import { createBundle, destroyBundle } from '../gl/pipeline.js';
import { FrameGovernor } from './metrics.js';

// Detached CORS mirror for tainted sources — the video sibling of image
// route 2. A cross-origin src without `crossorigin` fetches in no-cors mode
// and taints the GL upload (the DNR ACAO rule never helps a no-cors media
// fetch — correction 4), so we re-fetch the SAME url through a detached
// element WITH crossorigin="anonymous"; the DNR rule stamps ACAO on that
// response browser-wide, making the mirror origin-clean. The page's element
// is never touched, keeps playing, and stays visible until the mirror's
// first successful frame. Loose sync is fine: the output is smear, not
// broadcast. Instagram explore reel previews (direct scontent mp4s, vs the
// clicked reel's origin-clean MSE blob) are the motivating case.
class SrcMirror {
  constructor(pageVideo, onFail, onReady) {
    this.dead = false;
    const el = (this.el = document.createElement('video'));
    el.crossOrigin = 'anonymous';
    el.muted = true;
    el.playsInline = true;
    el.preload = 'auto';
    el.addEventListener('error', () => {
      if (this.dead) return;
      this.dead = true;
      onFail(); // CORS re-fetch rejected: leave the original alone
    });
    // A paused page video presents no frames; render once we have data.
    el.addEventListener('loadeddata', onReady);
    el.addEventListener('seeked', onReady);
    this.srcFor = '';
    this.retarget(pageVideo);
  }

  retarget(v) {
    this.srcFor = v.currentSrc;
    this.el.loop = v.loop;
    this.el.src = this.srcFor;
  }

  ready() {
    return !this.dead && this.el.readyState >= 2 && this.el.videoWidth > 0;
  }

  // Follow the page element: src swaps, play/pause, and coarse time drift.
  sync(v) {
    if (this.dead) return;
    const src = v.currentSrc || '';
    if (src !== this.srcFor && /^https?:/i.test(src)) this.retarget(v);
    if (v.paused || v.ended) {
      if (!this.el.paused) this.el.pause();
    } else if (this.el.paused) {
      this.el.play().catch(() => {});
    }
    if (
      this.el.seekable.length > 0 &&
      Math.abs(this.el.currentTime - v.currentTime) > 0.3
    ) {
      try {
        this.el.currentTime = v.currentTime;
      } catch {
        /* not seekable yet */
      }
    }
  }

  destroy() {
    this.dead = true;
    this.el.pause();
    this.el.removeAttribute('src');
    try {
      this.el.load(); // release the network connection
    } catch {
      /* nothing to release */
    }
  }
}

export class VideoJob {
  constructor(video, params) {
    this.kind = 'video';
    this.video = video;
    this.params = params;
    this.srcMirror = null; // detached CORS re-fetch for tainted sources
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
    // Black-output net (DRM that slips past the EME gate, broken pipelines).
    this.nextProbeAt = 0;
    this.probeTime = -1;
    this.blackStreak = 0;
    this.blackOut = false;
    this.probeBuf = null;

    this.onFrame = this.onFrame.bind(this);
    // GPU objects die with the context; drop them and realloc next frame.
    this.onGLRestore = () => {
      this.bundle = null;
    };
    this.onEncrypted = () => this.abandon('drm');
    video.addEventListener('encrypted', this.onEncrypted);
    // rVFC only fires on newly presented frames, so paused videos would
    // never be touched. Render the still frame on seeks and initial load.
    this.onStillFrame = () => {
      if (this.active && this.video.paused) this.renderNow();
    };
    video.addEventListener('seeked', this.onStillFrame);
    video.addEventListener('loadeddata', this.onStillFrame);
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
    // A paused video presents no frames; sort its current still once.
    if (video.paused && video.readyState >= 2) this.renderNow();
  }

  suspend() {
    if (!this.active) return;
    this.video.cancelVideoFrameCallback(this.rvfcId);
    this.active = false;
    this.unmirror();
    this.srcMirror?.el.pause(); // stop decoding offscreen; sync() resumes it
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
    this.governor.sample(now, metadata);
    this.renderTick(now);
    if (this.active) this.scheduleFrame(); // renderTick may have abandoned
  }

  // One-shot render outside the rVFC loop (paused videos: activation,
  // seeks). Deterministic in straight-sort mode, so re-renders are stable.
  renderNow() {
    if (!this.active || this.destroyed) return;
    this.renderTick(performance.now());
  }

  renderTick(now) {
    const video = this.video;
    this.lastFrameAt = performance.now();

    if (video.mediaKeys) return this.abandon('drm');

    // Context lost: do no GL work until restore rebuilds the pipeline.
    if (this.glc.lost) return;

    // While blacked out, drop to probe cadence only.
    if (this.blackOut && now < this.nextProbeAt) return;

    // Texture source: the page element, or the CORS mirror once a tainted
    // source forced the re-fetch route. The mirror reports videoWidth 0
    // until it has data, which simply skips frames below.
    if (this.srcMirror) this.srcMirror.sync(video);
    const source = this.srcMirror ? this.srcMirror.el : video;

    // Src/quality swaps change resolution in place (YouTube reuses its
    // <video> across SPA navigations) — recompute, don't tear down.
    if (source.videoWidth !== this.natW || source.videoHeight !== this.natH) {
      this.natW = source.videoWidth;
      this.natH = source.videoHeight;
      this.syncGeometry();
    }

    if (this.natW > 0 && this.fitRect) {
      try {
        if (this.renderFrame(source, now) && !this.mirrored) this.mirror();
      } catch (err) {
        if (err && err.name === 'SecurityError') {
          // Cross-origin source without CORS taints the upload — the
          // DNR-backed recovery: re-fetch through a crossorigin mirror.
          if (!this.srcMirror && this.startSrcMirror()) return;
          return this.abandon('tainted-source');
        }
        // Transient GL/decoder hiccup: skip the frame, keep the loop alive.
      }
    }
  }

  startSrcMirror() {
    const src = this.video.currentSrc || '';
    // blob:/data:/MediaStream sources are origin-clean by construction; a
    // SecurityError from one of those is not a CORS problem we can fix.
    if (!/^https?:/i.test(src)) return false;
    console.log(
      '[DEFLECTION] tainted video, re-fetching through CORS mirror:',
      src.slice(0, 100)
    );
    this.srcMirror = new SrcMirror(
      this.video,
      () => this.abandon('tainted-source'),
      this.onStillFrame
    );
    this.natW = 0; // dims now come from the mirror; recompute when it loads
    return true;
  }

  renderFrame(source, now) {
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
    p.uploadFrame(b, source);

    if (!params.feedbackVideo) {
      // Straight pixel sorting: every frame starts from a clean copy of
      // itself — no history, no drift, no keyframe rhythm. All the motion
      // comes from the stride-ladder sort below.
      p.runReset(b);
    } else if (now >= this.nextResetAt) {
      // Keyframe rhythm: every resetMinS..resetMaxS seconds (with jitter)
      // the accumulator is overwritten with a clean frame and the damage
      // clears, the way codec corruption clears at a keyframe.
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
      this.governor.effectivePasses(params.passes ?? 12),
      params.threshold ?? 0.55,
      params.streak ?? 32
    );

    glc.ensureSize(procW, procH);
    p.present(b);

    // Black-output net: the EME gate catches declared DRM, but some
    // protected or broken pipelines upload as pure black while the element
    // itself shows content. Probe the rendered output every 2 s; two
    // consecutive black probes while playback advances → show the original
    // instead. Recovers on its own when content returns, so a legitimate
    // fade-to-black only ever swaps between two black rectangles.
    if (now >= this.nextProbeAt) {
      this.nextProbeAt = now + 2000;
      const black = this.probeBlack(gl, b);
      // Playback progress is the PAGE element's; the mirror follows it.
      const advancing = this.video.currentTime > this.probeTime + 0.25;
      this.probeTime = this.video.currentTime;
      if (black && advancing) {
        this.blackStreak++;
        if (this.blackStreak >= 2 && !this.blackOut) {
          this.blackOut = true;
          this.unmirror();
          console.log('[DEFLECTION] black output, showing original video');
        }
      } else if (!black) {
        this.blackStreak = 0;
        this.blackOut = false;
      }
    }
    if (this.blackOut) return false;

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
    return true;
  }

  probeBlack(gl, b) {
    this.probeBuf ||= new Uint8Array(8 * 8 * 4);
    const x = Math.max(0, (b.w >> 1) - 4);
    const y = Math.max(0, (b.h >> 1) - 4);
    gl.readPixels(x, y, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, this.probeBuf);
    for (let i = 0; i < this.probeBuf.length; i += 4) {
      if (
        this.probeBuf[i] > 3 ||
        this.probeBuf[i + 1] > 3 ||
        this.probeBuf[i + 2] > 3
      ) {
        return false;
      }
    }
    return true;
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
    this.srcMirror?.destroy();
    this.srcMirror = null;
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
    this.srcMirror?.destroy();
    this.srcMirror = null;
    this.video.removeEventListener('encrypted', this.onEncrypted);
    this.video.removeEventListener('seeked', this.onStillFrame);
    this.video.removeEventListener('loadeddata', this.onStillFrame);
    this.releaseGL();
    if (this.overlay) {
      this.overlay.destroy();
      this.overlay = null;
    }
  }
}
