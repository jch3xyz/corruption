// One compare-exchange pass over the working buffer's columns, generalized
// odd-even transposition with a stride. True pixel sorting is sequential;
// stride-1 passes alone move a pixel one row per pass, far too slow for
// visible ribbons at real-time budgets. Running the same brick pattern at
// descending strides (32→16→…→1 — the proposal's "partial bitonic" idea)
// moves pixels long distances in a handful of passes: locally sorted,
// globally streaky, which is the classic look.
//
// Compare-exchange only happens when both members (and, for strides > 1,
// the span midpoint) pass the threshold: sorting stays confined to bright
// spans and dark pixels act as barriers. Bright rises toward smaller y,
// which is the video's top — "bright pixels drawn upward into ribbons."
import { GLSL_LUMA } from './common.js';

export const FRAG_SORT = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uParity;
uniform float uStride;
uniform float uThreshold;
in vec2 vUV;
out vec4 outColor;
${GLSL_LUMA}
void main() {
  ivec2 size = textureSize(uTex, 0);
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 self = texelFetch(uTex, p, 0);

  int s = int(uStride);
  int block = p.y / s;
  bool isUpper = ((block + int(uParity)) & 1) == 0;
  int partnerY = isUpper ? p.y + s : p.y - s;
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

  // Long strides could teleport pixels across a dark gap; checking the
  // span midpoint keeps barriers honest at negligible cost.
  if (s > 1) {
    int midY = isUpper ? p.y + s / 2 : p.y - s / 2;
    vec4 mid = texelFetch(uTex, ivec2(p.x, midY), 0);
    if (luma(mid.rgb) < uThreshold) {
      outColor = self;
      return;
    }
  }

  // Want luma descending as y grows toward the video's bottom. "swap" is
  // symmetric: both members of the pair output the other's value.
  float lUpper = isUpper ? lSelf : lOther;
  float lLower = isUpper ? lOther : lSelf;
  outColor = (lUpper < lLower) ? other : self;
}`;
