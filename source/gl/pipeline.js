// Programs, geometry, and per-job GPU resource bundles. Allocate-once
// discipline lives here: bundles are created via texStorage2D and reused
// every frame — the rVFC path performs zero GPU allocations.
//
// Per-frame order (correction #3 in the build plan): composite the incoming
// frame INTO the accumulator, then run K sort passes ON the accumulator, so
// sort progress genuinely accumulates across frames. A reset replaces the
// composite with a clean copy of the frame — the keyframe rhythm.

import { VERT_FULLSCREEN } from './shaders/common.js';
import { FRAG_PASSTHROUGH } from './shaders/passthrough.js';
import { FRAG_COMPOSITE } from './shaders/composite.js';
import { FRAG_SORT } from './shaders/sort.js';
import { FRAG_FIELD } from './shaders/field.js';

export function createPipeline(gl) {
  // Fullscreen triangle.
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const passthrough = buildProgram(gl, VERT_FULLSCREEN, FRAG_PASSTHROUGH, [
    'uTex',
    'uFlipY',
  ]);
  const composite = buildProgram(gl, VERT_FULLSCREEN, FRAG_COMPOSITE, [
    'uFrame',
    'uAccum',
    'uPrev',
    'uDrift',
    'uDecay',
    'uThreshold',
  ]);
  const sort = buildProgram(gl, VERT_FULLSCREEN, FRAG_SORT, [
    'uTex',
    'uField',
    'uUseFlow',
    'uParity',
    'uStride',
    'uThreshold',
    'uTemp',
    'uMotionGate',
    'uSeed',
  ]);
  const field = buildProgram(gl, VERT_FULLSCREEN, FRAG_FIELD, [
    'uProcSize',
    'uScale',
    'uSpeed',
    'uTime',
    'uAmount',
  ]);

  // Advances once per sort pass so the temperature hash draws fresh pairs
  // every pass; wraps far below integer precision loss.
  let sortSeed = 0;

  function drawQuad() {
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  function bindWrite(bundle) {
    const write = 1 - bundle.read;
    gl.bindFramebuffer(gl.FRAMEBUFFER, bundle.accum[write].fbo);
    gl.viewport(0, 0, bundle.w, bundle.h);
    return write;
  }

  // Keep a clean downscaled copy of the frame just consumed — the motion
  // reference for the NEXT composite. Runs after every reset/composite so
  // the reference is always exactly one frame behind, whatever mode the
  // job is in.
  function snapshotPrev(bundle) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, bundle.prev.fbo);
    gl.viewport(0, 0, bundle.w, bundle.h);
    gl.useProgram(passthrough.handle);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, bundle.frameTex);
    gl.uniform1i(passthrough.uniforms.uTex, 0);
    gl.uniform1f(passthrough.uniforms.uFlipY, 0);
    drawQuad();
  }

  return {
    // Upload the current decoded frame. Throws SecurityError on a tainted
    // source — callers abandon the job so the original stays visible.
    uploadFrame(bundle, source) {
      gl.bindTexture(gl.TEXTURE_2D, bundle.frameTex);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        bundle.srcW,
        bundle.srcH,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source
      );
    },

    // Keyframe: overwrite the accumulator with a clean copy of the frame.
    // (Frame alpha is 1, so a reset also floods the motion trail hot for
    // one frame — a fresh keyframe is "all new material", which is right.)
    runReset(bundle) {
      const write = bindWrite(bundle);
      gl.useProgram(passthrough.handle);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, bundle.frameTex);
      gl.uniform1i(passthrough.uniforms.uTex, 0);
      gl.uniform1f(passthrough.uniforms.uFlipY, 0);
      drawQuad();
      bundle.read = write;
      snapshotPrev(bundle);
    },

    // Feedback: incoming frame composited against the drifted, decaying
    // accumulator (the proposal's shader), motion trail written to alpha
    // against the clean previous frame. The prev snapshot happens AFTER
    // the draw so the composite always sees the frame before this one.
    runComposite(bundle, { driftX, driftY, decay, threshold }) {
      const write = bindWrite(bundle);
      gl.useProgram(composite.handle);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, bundle.frameTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, bundle.accum[bundle.read].tex);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, bundle.prev.tex);
      gl.uniform1i(composite.uniforms.uFrame, 0);
      gl.uniform1i(composite.uniforms.uAccum, 1);
      gl.uniform1i(composite.uniforms.uPrev, 2);
      gl.uniform2f(composite.uniforms.uDrift, driftX, driftY);
      gl.uniform1f(composite.uniforms.uDecay, decay);
      gl.uniform1f(composite.uniforms.uThreshold, threshold);
      drawQuad();
      bundle.read = write;
      gl.activeTexture(gl.TEXTURE0);
      snapshotPrev(bundle);
    },

    // K compare-exchange passes ping-ponging over the working buffer.
    // Schedule: a descending stride ladder (largest power of two ≤ streak
    // down to 1, two passes per level for both parities), cycled until the
    // pass budget is spent. Long strides move pixels far fast; stride 1
    // settles the local order.
    // Renders the direction field for this frame (call once per frame,
    // before the sort passes, whenever flow is in play).
    runFieldPass(bundle, { amount, scale, speed, time }) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, bundle.field.fbo);
      gl.viewport(0, 0, bundle.fieldW, bundle.fieldH);
      gl.useProgram(field.handle);
      gl.uniform2f(field.uniforms.uProcSize, bundle.w, bundle.h);
      gl.uniform1f(field.uniforms.uScale, scale);
      gl.uniform1f(field.uniforms.uSpeed, speed);
      gl.uniform1f(field.uniforms.uTime, time);
      gl.uniform1f(field.uniforms.uAmount, amount);
      drawQuad();
    },

    runSortPasses(bundle, passes, threshold, streak, opts = {}) {
      if (passes <= 0) return;
      let top = 1;
      while (top * 2 <= Math.max(1, streak || 1)) top *= 2;
      const schedule = [];
      for (let s = top; s >= 1; s >>= 1) schedule.push([s, 0], [s, 1]);

      gl.useProgram(sort.handle);
      gl.uniform1f(sort.uniforms.uThreshold, threshold);
      gl.uniform1f(sort.uniforms.uTemp, opts.temperature ?? 0);
      gl.uniform1f(sort.uniforms.uMotionGate, opts.motionGate ?? 0);
      gl.uniform1f(sort.uniforms.uUseFlow, opts.flow ? 1 : 0);
      gl.uniform1i(sort.uniforms.uTex, 0);
      // Always bound (every bundle owns one) so samplers stay complete;
      // never sampled unless uUseFlow is on.
      gl.uniform1i(sort.uniforms.uField, 1);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, bundle.field.tex);
      gl.activeTexture(gl.TEXTURE0);
      for (let i = 0; i < passes; i++) {
        const [stride, parity] = schedule[i % schedule.length];
        const write = bindWrite(bundle);
        gl.bindTexture(gl.TEXTURE_2D, bundle.accum[bundle.read].tex);
        gl.uniform1f(sort.uniforms.uStride, stride);
        gl.uniform1f(sort.uniforms.uParity, parity);
        sortSeed = (sortSeed + 1) & 0x7fffffff;
        gl.uniform1i(sort.uniforms.uSeed, sortSeed);
        drawQuad();
        bundle.read = write;
      }
    },

    // Draw the current accumulator to the default framebuffer (bottom-left
    // region of the shared canvas), flipped upright for canvas display.
    present(bundle) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, bundle.w, bundle.h);
      gl.useProgram(passthrough.handle);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, bundle.accum[bundle.read].tex);
      gl.uniform1i(passthrough.uniforms.uTex, 0);
      gl.uniform1f(passthrough.uniforms.uFlipY, 1);
      drawQuad();
    },
  };
}

// Per-job GPU resources. frameTex holds the upload at native video size;
// the RGBA16F accumulator pair runs at processing resolution (maxRes cap),
// so the composite doubles as the downscale.
export function createBundle(gl, srcW, srcH, w, h) {
  const frameTex = createTex(gl, gl.RGBA8, srcW, srcH);
  const target = () => {
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    return fbo;
  };
  const accum = [0, 1].map(() => {
    const tex = createTex(gl, gl.RGBA16F, w, h);
    const fbo = target();
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      tex,
      0
    );
    return { tex, fbo };
  });
  // Clean copy of the last-consumed frame: the motion reference. RGBA8 —
  // the diff needs no float precision.
  const prev = (() => {
    const tex = createTex(gl, gl.RGBA8, w, h);
    const fbo = target();
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      tex,
      0
    );
    return { tex, fbo };
  })();
  // The flow field's direction texture: one texel per 4×4 accumulator
  // cell, RG8 holding the quantized offset vector as (v+1)/2.
  const fieldW = Math.max(1, Math.ceil(w / 4));
  const fieldH = Math.max(1, Math.ceil(h / 4));
  const fieldT = (() => {
    const tex = createTex(gl, gl.RG8, fieldW, fieldH);
    const fbo = target();
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      tex,
      0
    );
    return { tex, fbo };
  })();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { srcW, srcH, w, h, frameTex, accum, prev, field: fieldT, fieldW, fieldH, read: 0 };
}

export function destroyBundle(gl, bundle) {
  gl.deleteTexture(bundle.frameTex);
  for (const { tex, fbo } of bundle.accum) {
    gl.deleteTexture(tex);
    gl.deleteFramebuffer(fbo);
  }
  gl.deleteTexture(bundle.prev.tex);
  gl.deleteFramebuffer(bundle.prev.fbo);
  gl.deleteTexture(bundle.field.tex);
  gl.deleteFramebuffer(bundle.field.fbo);
}

function createTex(gl, internalFormat, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function buildProgram(gl, vertSrc, fragSrc, uniformNames) {
  const compile = (type, src) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`[DEFLECTION] shader compile failed: ${log}`);
    }
    return shader;
  };
  const vs = compile(gl.VERTEX_SHADER, vertSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
  const handle = gl.createProgram();
  gl.attachShader(handle, vs);
  gl.attachShader(handle, fs);
  gl.linkProgram(handle);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(handle);
    gl.deleteProgram(handle);
    throw new Error(`[DEFLECTION] program link failed: ${log}`);
  }
  const uniforms = {};
  for (const name of uniformNames) {
    uniforms[name] = gl.getUniformLocation(handle, name);
  }
  return { handle, uniforms };
}
