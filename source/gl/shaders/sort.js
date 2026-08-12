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
//
// Two dynamism extensions (John, 2026-08-12), both exactly inert at 0:
//
// uTemp — stochastic swaps. With probability uTemp per pair per pass the
// comparison outcome is INVERTED, so the sort simmers at its equilibrium
// instead of settling into it. The random draw is keyed on the pair's
// shared identity (upper member's coords + the pass seed), so both
// partners compute the same decision and the symmetric-swap property —
// what makes every pass a permutation — survives. Barriers still apply:
// temperature boils the material inside bright spans, never across dark.
//
// uMotionGate — sorting requires motion. The accumulator's alpha channel
// carries a motion trail (written by the composite pass: |incoming − prev
// frame|, decaying); a pair may only trade when BOTH members' motion
// clears the gate, so damage stays strictly inside what the transmission
// itself is changing. Static material holds still and heals; alpha is 1
// after a reset (and always, in straight-sort mode), which makes the gate
// inert wherever there is no history to judge motion against.
import { GLSL_LUMA } from './common.js';

export const FRAG_SORT = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uParity;
uniform float uStride;
uniform float uThreshold;
uniform float uTemp;
uniform float uMotionGate;
uniform int uSeed;
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

  // Motion gate: both members must be moving. min() keeps the containment
  // strict — a hot pixel cannot drag cold material into the churn, so the
  // damage boundary is the motion boundary.
  if (uMotionGate > 0.0 && min(self.a, other.a) < uMotionGate) {
    outColor = self;
    return;
  }

  // Long strides could teleport pixels across a dark gap; checking the
  // span midpoint keeps barriers honest at negligible cost. The motion
  // gate rides the same check so a span can't sort across still material.
  if (s > 1) {
    int midY = isUpper ? p.y + s / 2 : p.y - s / 2;
    vec4 mid = texelFetch(uTex, ivec2(p.x, midY), 0);
    if (luma(mid.rgb) < uThreshold) {
      outColor = self;
      return;
    }
    if (uMotionGate > 0.0 && mid.a < uMotionGate) {
      outColor = self;
      return;
    }
  }

  // Want luma descending as y grows toward the video's bottom. "swap" is
  // symmetric: both members of the pair output the other's value.
  float lUpper = isUpper ? lSelf : lOther;
  float lLower = isUpper ? lOther : lSelf;
  bool swap = lUpper < lLower;

  // Temperature: invert the verdict for a hash-chosen fraction of pairs.
  // The hash is keyed on the UPPER member's coordinates — identical for
  // both partners — so the pair still agrees and the pass stays a
  // permutation.
  if (uTemp > 0.0) {
    ivec2 up = isUpper ? p : ivec2(p.x, partnerY);
    uint h = (uint(up.x) * 374761393u) ^ (uint(up.y) * 668265263u) ^
             (uint(uSeed) * 2246822519u);
    h = (h ^ (h >> 13u)) * 1274126177u;
    h = h ^ (h >> 16u);
    if (float(h & 0x00FFFFFFu) / 16777216.0 < uTemp) swap = !swap;
  }

  outColor = swap ? other : self;
}`;
