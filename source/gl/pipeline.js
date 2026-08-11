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
    'uDrift',
    'uDecay',
    'uThreshold',
  ]);
  const sort = buildProgram(gl, VERT_FULLSCREEN, FRAG_SORT, [
    'uTex',
    'uParity',
    'uStride',
    'uThreshold',
  ]);

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
    runReset(bundle) {
      const write = bindWrite(bundle);
      gl.useProgram(passthrough.handle);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, bundle.frameTex);
      gl.uniform1i(passthrough.uniforms.uTex, 0);
      gl.uniform1f(passthrough.uniforms.uFlipY, 0);
      drawQuad();
      bundle.read = write;
    },

    // Feedback: incoming frame composited against the drifted, decaying
    // accumulator (the proposal's shader).
    runComposite(bundle, { driftX, driftY, decay, threshold }) {
      const write = bindWrite(bundle);
      gl.useProgram(composite.handle);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, bundle.frameTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, bundle.accum[bundle.read].tex);
      gl.uniform1i(composite.uniforms.uFrame, 0);
      gl.uniform1i(composite.uniforms.uAccum, 1);
      gl.uniform2f(composite.uniforms.uDrift, driftX, driftY);
      gl.uniform1f(composite.uniforms.uDecay, decay);
      gl.uniform1f(composite.uniforms.uThreshold, threshold);
      drawQuad();
      bundle.read = write;
    },

    // K compare-exchange passes ping-ponging over the working buffer.
    // Schedule: a descending stride ladder (largest power of two ≤ streak
    // down to 1, two passes per level for both parities), cycled until the
    // pass budget is spent. Long strides move pixels far fast; stride 1
    // settles the local order.
    runSortPasses(bundle, passes, threshold, streak) {
      if (passes <= 0) return;
      let top = 1;
      while (top * 2 <= Math.max(1, streak || 1)) top *= 2;
      const schedule = [];
      for (let s = top; s >= 1; s >>= 1) schedule.push([s, 0], [s, 1]);

      gl.useProgram(sort.handle);
      gl.uniform1f(sort.uniforms.uThreshold, threshold);
      gl.uniform1i(sort.uniforms.uTex, 0);
      gl.activeTexture(gl.TEXTURE0);
      for (let i = 0; i < passes; i++) {
        const [stride, parity] = schedule[i % schedule.length];
        const write = bindWrite(bundle);
        gl.bindTexture(gl.TEXTURE_2D, bundle.accum[bundle.read].tex);
        gl.uniform1f(sort.uniforms.uStride, stride);
        gl.uniform1f(sort.uniforms.uParity, parity);
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
  const accum = [0, 1].map(() => {
    const tex = createTex(gl, gl.RGBA16F, w, h);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      tex,
      0
    );
    return { tex, fbo };
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { srcW, srcH, w, h, frameTex, accum, read: 0 };
}

export function destroyBundle(gl, bundle) {
  gl.deleteTexture(bundle.frameTex);
  for (const { tex, fbo } of bundle.accum) {
    gl.deleteTexture(tex);
    gl.deleteFramebuffer(fbo);
  }
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
