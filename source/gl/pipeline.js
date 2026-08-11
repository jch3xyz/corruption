// Programs, geometry, and per-job GPU resource bundles. Allocate-once
// discipline lives here: bundles are created via texStorage2D and reused
// every frame — the rVFC path performs zero GPU allocations.

import { VERT_FULLSCREEN } from './shaders/common.js';
import { FRAG_PASSTHROUGH } from './shaders/passthrough.js';

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

  function draw(program, tex, flipY, w, h) {
    gl.viewport(0, 0, w, h);
    gl.useProgram(program.handle);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(program.uniforms.uTex, 0);
    gl.uniform1f(program.uniforms.uFlipY, flipY);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
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

    // Phase 2 stand-in for the composite pass: frame → write accumulator,
    // then swap. Exercises the float FBO chain the feedback loop will use.
    runPassthrough(bundle) {
      const write = 1 - bundle.read;
      gl.bindFramebuffer(gl.FRAMEBUFFER, bundle.accum[write].fbo);
      draw(passthrough, bundle.frameTex, 0, bundle.w, bundle.h);
      bundle.read = write;
    },

    // Draw the current accumulator to the default framebuffer (bottom-left
    // region of the shared canvas), flipped upright for canvas display.
    present(bundle) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      draw(passthrough, bundle.accum[bundle.read].tex, 1, bundle.w, bundle.h);
    },
  };
}

// Per-job GPU resources. frameTex holds the upload at native video size;
// the RGBA16F accumulator pair runs at processing resolution (maxRes cap),
// so the first pass doubles as the downscale.
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
