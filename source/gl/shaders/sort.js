// One odd-even transposition pass over the accumulator's columns. True
// pixel sorting is sequential; running a few of these per frame lets the
// image visibly organize itself over time (the proposal's recommended
// approach) — sort progress lives in the accumulator and carries across
// frames.
//
// Each fragment pairs with its vertical neighbor (parity alternates per
// pass) and compare-exchanges on luma, but ONLY when both pixels pass the
// threshold: sorting is confined to bright spans, and any dark pixel acts
// as a barrier. Bright rises toward smaller y, which is the video's top —
// "bright pixels drawn upward into ribbons."
import { GLSL_LUMA } from './common.js';

export const FRAG_SORT = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uParity;
uniform float uThreshold;
in vec2 vUV;
out vec4 outColor;
${GLSL_LUMA}
void main() {
  ivec2 size = textureSize(uTex, 0);
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 self = texelFetch(uTex, p, 0);

  bool isUpper = ((p.y + int(uParity)) & 1) == 0;
  int partnerY = isUpper ? p.y + 1 : p.y - 1;
  if (partnerY < 0 || partnerY >= size.y) {
    outColor = self;
    return;
  }
  vec4 other = texelFetch(uTex, ivec2(p.x, partnerY), 0);

  float lSelf = luma(self.rgb);
  float lOther = luma(other.rgb);
  if (lSelf < uThreshold || lOther < uThreshold) {
    outColor = self;
    return;
  }

  // Want luma descending as y grows toward the video's bottom. "swap" is
  // symmetric: both members of the pair output the other's value.
  float lUpper = isUpper ? lSelf : lOther;
  float lLower = isUpper ? lOther : lSelf;
  outColor = (lUpper < lLower) ? other : self;
}`;
