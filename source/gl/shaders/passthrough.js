// Identity shader. Phase 2 uses it for both pipeline stages (composite
// stand-in and present); it stays useful later as a debug bypass.
//
// uFlipY: GL renders with y=0 at the bottom, so the final present into the
// default framebuffer flips V to come out upright on the canvas. FBO-to-FBO
// passes keep uFlipY at 0 so texture space stays consistent throughout.
export const FRAG_PASSTHROUGH = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uFlipY;
in vec2 vUV;
out vec4 outColor;
void main() {
  vec2 uv = vec2(vUV.x, mix(vUV.y, 1.0 - vUV.y, uFlipY));
  outColor = texture(uTex, uv);
}`;
