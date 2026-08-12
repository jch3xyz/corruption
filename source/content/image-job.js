// Per-image job. Images arrive from CDNs with unpredictable CORS, so the
// texture source resolves through three routes: (1) direct upload — same
// origin or already CORS-clean; (2) a detached crossorigin re-fetch backed
// by the extension's DNR header rule; (3) bytes through the service worker
// as a data URL. The page's own <img> is never mutated — mutating src
// would fight site lazy-loaders.
//
// Straight-sort mode renders once per source/params change (the sort is
// deterministic, so a still image has a stable still result). Feedback
// mode animates big on-screen images from the registry's ticker.

import { Overlay, objectFitRect } from './overlay.js';
import { acquireGL } from '../gl/context.js';
import { createBundle, destroyBundle } from '../gl/pipeline.js';

const ANIM_MIN_SIZE = 200; // feedback-mode animation tier

export class ImageJob {
  constructor(img, params, routeStats) {
    this.kind = 'image';
    this.img = img;
    this.params = params;
    this.routeStats = routeStats;
    this.overlay = null;
    this.ctx = null;
    this.glc = null;
    this.bundle = null; // retained only while animating (feedback mode)
    this.source = null; // upload-safe source (the img itself or a detached Image)
    this.route = null; // 'direct' | 'cors' | 'sw'
    this.resolving = false;
    this.corsTried = false;
    this.swTried = false;
    this.rendered = false;
    this.dirty = true;
    this.active = false;
    this.abandoned = false;
    this.destroyed = false;
    this.mirrored = false;
    this.savedOpacity = null;
    this.natW = 0;
    this.natH = 0;
    this.fitRect = null;
    this.nextResetAt = 0;
    this.flowSeed = Math.random() * 1024; // per-content; onLoad rerolls

    this.onGLRestore = () => {
      this.bundle = null;
      this.dirty = true;
    };
    // src swap (carousels, lazy-load upgrades): re-resolve and re-render.
    this.onLoad = () => {
      this.flowSeed = Math.random() * 1024; // new content, new deflection
      this.source = null;
      this.route = null;
      this.corsTried = false;
      this.swTried = false;
      this.dirty = true;
      if (this.active) this.render();
    };
    img.addEventListener('load', this.onLoad);
  }

  activate() {
    if (this.abandoned || this.destroyed) return;
    this.active = true;
    if (this.rendered && !this.dirty) {
      if (!this.mirrored) this.mirror(); // canvas still holds the result
      return;
    }
    this.render();
  }

  suspend() {
    this.active = false;
    this.unmirror();
  }

  markDirty() {
    this.dirty = true;
  }

  animEligible() {
    return (
      this.img.clientWidth >= ANIM_MIN_SIZE ||
      this.img.clientHeight >= ANIM_MIN_SIZE
    );
  }

  render() {
    if (!this.active || this.destroyed || this.abandoned) return;
    const img = this.img;
    if (!(img.complete && img.naturalWidth > 0)) return; // load listener retries

    if (!this.glc) {
      this.glc = acquireGL();
      if (!this.glc) return this.abandon('no-webgl2');
      this.glc.onRestore(this.onGLRestore);
    }
    if (this.glc.lost) return; // restore handler marks dirty
    if (!this.ensureOverlay()) return;

    const src = this.source ?? img;
    try {
      this.draw(src);
      if (!this.route) {
        this.route = 'direct';
        this.routeStats.direct++;
      }
      this.rendered = true;
      this.dirty = false;
      if (!this.mirrored) this.mirror();
    } catch (err) {
      if (err?.name === 'SecurityError') this.resolveSource();
      // anything else is transient; dirty stays set and the sweep retries
    }
  }

  // Upload → clean copy → stride-ladder sort → present → copy out.
  draw(src) {
    const glc = this.glc;
    const gl = glc.gl;
    const params = this.params;

    this.natW = src.naturalWidth;
    this.natH = src.naturalHeight;
    this.syncGeometry();
    if (!this.fitRect) throw new Error('no-geometry');

    const maxRes = params.maxRes || 1920;
    const scale = Math.min(1, maxRes / Math.max(this.natW, this.natH));
    const w = Math.max(1, Math.round(this.natW * scale));
    const h = Math.max(1, Math.round(this.natH * scale));

    let b = this.bundle;
    if (!b || b.srcW !== this.natW || b.srcH !== this.natH || b.w !== w || b.h !== h) {
      if (b) destroyBundle(gl, b);
      b = this.bundle = createBundle(gl, this.natW, this.natH, w, h);
    }

    const p = glc.pipeline;
    p.uploadFrame(b, src);
    p.runReset(b);
    const flowAmount = params.flowAmount ?? 0;
    if (flowAmount > 0) {
      p.runFieldPass(b, {
        amount: flowAmount,
        scale: params.flowScale ?? 4,
        speed: params.flowSpeed ?? 0.02,
        time: performance.now() / 1000,
        seed: this.flowSeed,
      });
    }
    p.runSortPasses(b, params.passes ?? 12, params.threshold ?? 0.55, params.streak ?? 32, {
      temperature: params.temperature ?? 0,
      motionGate: params.motionGate ?? 0,
      flow: flowAmount > 0,
      facets: params.flowMode === 'facets',
    });
    glc.ensureSize(w, h);
    p.present(b);

    const { x, y, w: dw, h: dh } = this.fitRect;
    this.ctx.drawImage(glc.canvas, 0, glc.canvas.height - h, w, h, x, y, dw, dh);

    // Stills release GPU resources immediately; animated jobs keep them.
    if (!params.feedbackImage) {
      destroyBundle(gl, b);
      this.bundle = null;
    }
  }

  // Feedback-mode animation step, driven by the registry ticker.
  tick(now) {
    if (!this.active || this.destroyed || this.abandoned) return;
    if (!this.params.feedbackImage || !this.rendered || !this.mirrored) return;
    const glc = this.glc;
    if (!glc || glc.lost) return;

    try {
      if (!this.bundle) {
        this.draw(this.source ?? this.img); // rebuild after toggle/restore
        return;
      }
      const p = glc.pipeline;
      const b = this.bundle;
      const params = this.params;
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
      const flowAmount = params.flowAmount ?? 0;
      if (flowAmount > 0) {
        p.runFieldPass(b, {
          amount: flowAmount,
          scale: params.flowScale ?? 4,
          speed: params.flowSpeed ?? 0.02,
          time: now / 1000,
          seed: this.flowSeed,
        });
      }
      p.runSortPasses(b, params.passes ?? 12, params.threshold ?? 0.55, params.streak ?? 32, {
        temperature: params.temperature ?? 0,
        motionGate: params.motionGate ?? 0,
        flow: flowAmount > 0,
        facets: params.flowMode === 'facets',
      });
      glc.ensureSize(b.w, b.h);
      p.present(b);
      const { x, y, w, h } = this.fitRect;
      this.ctx.drawImage(glc.canvas, 0, glc.canvas.height - b.h, b.w, b.h, x, y, w, h);
    } catch {
      /* transient; next tick retries */
    }
  }

  // Route 2 then route 3. Each fires render() again on success.
  resolveSource() {
    if (this.resolving) return;
    const url = this.img.currentSrc || this.img.src;
    if (!url) return this.fail();

    if (!this.corsTried) {
      this.corsTried = true;
      this.resolving = true;
      const im = new Image();
      im.crossOrigin = 'anonymous'; // DNR rule supplies the ACAO header
      im.onload = () => {
        this.resolving = false;
        this.source = im;
        this.route = 'cors';
        this.routeStats.cors++;
        this.dirty = true;
        this.render();
      };
      im.onerror = () => {
        this.resolving = false;
        this.resolveViaSW(url);
      };
      im.src = url;
      return;
    }
    this.resolveViaSW(url);
  }

  resolveViaSW(url) {
    if (this.swTried) return this.fail();
    this.swTried = true;
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      return this.fail(); // dev harness: no extension context
    }
    this.resolving = true;
    chrome.runtime.sendMessage({ type: 'fetch-image', url }, (resp) => {
      this.resolving = false;
      if (!resp?.ok) return this.fail();
      const im = new Image();
      im.onload = () => {
        this.source = im;
        this.route = 'sw';
        this.routeStats.sw++;
        this.dirty = true;
        this.render();
      };
      im.onerror = () => this.fail();
      im.src = resp.dataUrl;
    });
  }

  fail() {
    this.routeStats.failed++;
    this.abandon('image-unreadable');
  }

  ensureOverlay() {
    if (this.overlay && this.overlay.canvas.isConnected) return true;
    if (this.overlay) {
      this.overlay.destroy();
      this.overlay = null;
    }
    try {
      this.overlay = new Overlay(this.img);
      this.ctx = this.overlay.canvas.getContext('2d');
      return true;
    } catch {
      this.abandon('no-parent');
      return false;
    }
  }

  syncGeometry() {
    if (!this.overlay) return;
    const g = this.overlay.lastGeom;
    const before = `${g.width}x${g.height}`;
    if (!this.overlay.sync()) return;
    const { width, height } = this.overlay.lastGeom;
    if (this.natW > 0) {
      this.fitRect = objectFitRect(this.img, width, height, this.natW, this.natH);
    }
    // A backing-store resize clears the canvas; the drawn still is gone.
    if (this.rendered && `${width}x${height}` !== before) {
      this.dirty = true;
      if (this.active) this.render();
    }
  }

  // Sweep self-heal: re-insert a dropped overlay (site re-rendered around us).
  checkHealth() {
    if (!this.active || this.abandoned || this.destroyed) return;
    if (this.mirrored && (!this.overlay || !this.overlay.canvas.isConnected)) {
      this.unmirror();
      if (this.ensureOverlay()) {
        this.dirty = true;
        this.render();
      }
    }
  }

  mirror() {
    this.savedOpacity = this.img.style.opacity;
    this.img.style.opacity = '0';
    this.overlay.show();
    this.mirrored = true;
  }

  unmirror() {
    if (!this.mirrored) return;
    this.img.style.opacity = this.savedOpacity ?? '';
    if (this.overlay) this.overlay.hide();
    this.mirrored = false;
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
    if (reason !== 'image-unreadable') {
      console.log('[DEFLECTION] image left untouched:', reason);
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.suspend();
    this.destroyed = true;
    this.img.removeEventListener('load', this.onLoad);
    this.releaseGL();
    if (this.overlay) {
      this.overlay.destroy();
      this.overlay = null;
    }
  }
}
