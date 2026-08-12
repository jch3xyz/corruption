// One compare-exchange pass over the working buffer, generalized odd-even
// transposition with a stride. True pixel sorting is sequential; stride-1
// passes alone move a pixel one step per pass, far too slow for visible
// ribbons at real-time budgets. Running the same brick pattern at
// descending strides (32→16→…→1 — the proposal's "partial bitonic" idea)
// moves pixels long distances in a handful of passes: locally sorted,
// globally streaky, which is the classic look.
//
// Compare-exchange only happens when both members (and, for strides > 1,
// the span midpoint) pass the threshold: sorting stays confined to bright
// spans and dark pixels act as barriers. In the classic grammar bright
// rises toward smaller y — the video's top.
//
// The pairing axis is a vector v, not an axiom (the flow field, John's
// 2026-08-12 pick). uUseFlow off: v = (0,1), the classic columns, bit-for-
// bit. On: v comes per-4×4-cell from uField, quantized to the 8 integer
// offsets so exchanges land on exact texels. Pairs are blocked by the
// projection floor(dot(p,v) / (s·|v|²)) — for v=(0,1) that is exactly the
// old y/s brick — and a pair only trades when BOTH endpoints read the same
// v, which is what keeps every pass a permutation: partner symmetry says
// that if q agrees with p's direction, q's own pairing arithmetic points
// straight back at p, and every refusal condition below is computed
// identically by both members. Where the field changes direction the
// disagreement seam simply refuses to trade — flow boundaries are
// barriers, like dark material.
//
// Two per-pair gates (2026-08-12), both exactly inert at 0:
//
// uTemp — stochastic swaps. With probability uTemp per pair per pass the
// comparison outcome is INVERTED, so the sort simmers at its equilibrium
// instead of settling. Keyed on the pair's shared identity, so the swap
// stays symmetric and the pass stays a permutation.
//
// uMotionGate — sorting requires motion. The accumulator's alpha carries a
// motion trail (composite pass: |incoming − prev frame|, decaying); a pair
// may only trade when BOTH members clear the gate, so damage stays inside
// what the transmission itself is changing.
import { GLSL_LUMA } from './common.js';

export const FRAG_SORT = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform sampler2D uField;
uniform float uUseFlow;
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
  ivec2 v = ivec2(0, 1);
  if (uUseFlow > 0.5) {
    vec2 f = texelFetch(uField, p >> 2, 0).rg;
    v = ivec2(round(f * 2.0 - 1.0));
    if (v == ivec2(0, 0)) v = ivec2(0, 1);
  }

  // Brick pairing along v. floor division (not truncation) keeps blocks
  // consistent when the projection goes negative under leftward/upward v.
  int t = p.x * v.x + p.y * v.y;
  int sd = s * (v.x * v.x + v.y * v.y);
  int block = int(floor(float(t) / float(sd)));
  bool isUpper = ((block + int(uParity)) & 1) == 0;
  ivec2 q = isUpper ? p + s * v : p - s * v;
  if (q.x < 0 || q.y < 0 || q.x >= size.x || q.y >= size.y) {
    outColor = self;
    return;
  }
  // The partner must read the SAME direction, or neither touches the other.
  if (uUseFlow > 0.5) {
    vec2 f2 = texelFetch(uField, q >> 2, 0).rg;
    if (ivec2(round(f2 * 2.0 - 1.0)) != v) {
      outColor = self;
      return;
    }
  }
  vec4 other = texelFetch(uTex, q, 0);

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
  // Both members compute the same midpoint texel, so refusal is symmetric.
  if (s > 1) {
    ivec2 m = isUpper ? p + (s / 2) * v : p - (s / 2) * v;
    vec4 mid = texelFetch(uTex, m, 0);
    if (luma(mid.rgb) < uThreshold) {
      outColor = self;
      return;
    }
    if (uMotionGate > 0.0 && mid.a < uMotionGate) {
      outColor = self;
      return;
    }
  }

  // Bright seeks the smaller projection along v (for columns: the video's
  // top). "swap" is symmetric: both members output the other's value.
  float lUpper = isUpper ? lSelf : lOther;
  float lLower = isUpper ? lOther : lSelf;
  bool swap = lUpper < lLower;

  // Temperature: invert the verdict for a hash-chosen fraction of pairs.
  // The hash is keyed on the UPPER member's coordinates — identical for
  // both partners — so the pair still agrees and the pass stays a
  // permutation.
  if (uTemp > 0.0) {
    ivec2 up = isUpper ? p : q;
    uint h = (uint(up.x) * 374761393u) ^ (uint(up.y) * 668265263u) ^
             (uint(uSeed) * 2246822519u);
    h = (h ^ (h >> 13u)) * 1274126177u;
    h = h ^ (h >> 16u);
    if (float(h & 0x00FFFFFFu) / 16777216.0 < uTemp) swap = !swap;
  }

  outColor = swap ? other : self;
}`;
