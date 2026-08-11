// The single shared WebGL2 context for this page. One context serves every
// job (per-element contexts would hit Chrome's ~16-context cap on any feed
// page); jobs render into their own viewport region of a detached canvas and
// copy the result out with a same-task drawImage.

import { createPipeline } from './pipeline.js';

let instance = null;
let unavailable = false;

// Returns the shared GLContext, creating it on first use. Returns null when
// the machine can't run the pipeline (no WebGL2 / no float render targets) —
// callers must leave the page untouched in that case.
export function acquireGL() {
  if (instance) return instance;
  if (unavailable) return null;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) {
      unavailable = true;
      return null;
    }
    instance = new GLContext(canvas, gl);
  } catch {
    unavailable = true;
    return null;
  }
  return instance;
}

class GLContext {
  constructor(canvas, gl) {
    this.canvas = canvas;
    this.gl = gl;
    this.lost = false;
    this.restoreListeners = new Set();
    this.pipeline = createPipeline(gl);

    // Context loss WILL happen over a multi-week run; this is a rehearsed
    // path. Jobs skip GL work while lost; on restore the pipeline programs
    // are rebuilt here and every job drops its (now invalid) textures.
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault(); // required, or the context never restores
      this.lost = true;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      // Extension enables reset with the context. Without re-requesting
      // EXT_color_buffer_float, RGBA16F is no longer color-renderable and
      // every FBO draw fails with INVALID_FRAMEBUFFER_OPERATION (black
      // output). The harness caught this; do not remove.
      gl.getExtension('EXT_color_buffer_float');
      this.pipeline = createPipeline(gl);
      this.lost = false;
      for (const fn of this.restoreListeners) fn();
    });
  }

  // Grow-only: resizing clears the drawing buffer, so never shrink mid-run.
  ensureSize(w, h) {
    if (this.canvas.width < w) this.canvas.width = w;
    if (this.canvas.height < h) this.canvas.height = h;
  }

  onRestore(fn) {
    this.restoreListeners.add(fn);
  }

  offRestore(fn) {
    this.restoreListeners.delete(fn);
  }
}
