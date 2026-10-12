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
// bit. On: the field ships a CONTINUOUS direction per 4×4 cell, and this
// pass quantizes it to one of 16 integer offsets (axes, diagonals, and the
// knight moves) so exchanges land on exact texels. Pairs are blocked by
// the projection floor(dot(p,v) / (s·|v|²)) — for v=(0,1) that is exactly
// the old y/s brick — and a pair only trades when BOTH endpoints quantize
// to the same v, which is what keeps every pass a permutation: partner
// symmetry says that if q agrees with p's direction, q's own pairing
// arithmetic points straight back at p, and every refusal condition below
// is computed identically by both members.
//
// The sector boundary is DITHERED per pass (uSectorJitter, a golden-ratio
// sweep of ±half a sector). A fixed quantization would anchor refusal
// seams wherever the field crosses a sector edge, and material would pool
// there instead of rounding the curve — the first cut of this shader did
// exactly that, quantizing to 8 fixed directions. With the boundary
// wandering, a cell near a sector edge trades along one neighbor
// direction on some passes and the other on the rest, so the AVERAGE
// motion follows the true continuous angle: ribbons genuinely meander
// and curl instead of running straight and faceting at seams.
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
//
// uKey — the comparison key (`sortKey`, "sort by", round 8 part 2). Which
// pixel climbs is decided by key(): 0 luma (the classic, and the very same
// expression, so the default is bit-identical), 1 hue, 2 saturation, 3/4/5
// one channel. Only the ORDERING reads the key. The BARRIER stays on luma —
// threshold tests and the span midpoint read luma(), never key() — so
// amount keeps its meaning under every key (dark material always holds the
// picture together) and the permutation argument is untouched: both
// members still compute the same key pair and the same refusals.
//
// uAngle — the direction (`angle`, round 8 part 2), radians, applied AFTER
// the field: the angle is added to the field's own angle before it is
// quantized, so with flow on the whole streamline pattern turns at any
// flow amount. With flow off every pixel shares one direction, π/2 +
// uAngle, through the SAME quantizer the mode uses — facets: 8 fixed
// sectors, so the sort turns in 45° steps; paths: 16 sectors under the
// per-pass jitter, so the single direction dithers pass to pass and the
// average motion follows the true angle (the paths grammar, applied to the
// whole frame). At 0 with flow off v stays exactly (0,1): bit-identical.
// One shared v per pass needs no partner check; with flow on the check is
// unchanged, and both members' fieldDir now includes the same angle.
// Sense: v points AWAY from where the higher key goes (it seeks the smaller
// projection), and texel y grows toward the video's bottom, so a growing
// angle turns the climb clockwise on screen: 0 up, 90 right, 180 down.
import { GLSL_LUMA } from './common.js';

export const FRAG_SORT = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform sampler2D uField;
uniform float uUseFlow;
uniform float uFacets;
uniform float uSectorJitter;
uniform float uParity;
uniform float uStride;
uniform float uThreshold;
uniform float uTemp;
uniform float uMotionGate;
uniform int uSeed;
uniform int uKey;
uniform float uAngle;
in vec2 vUV;
out vec4 outColor;
${GLSL_LUMA}
// The ordering key. Plain if-chains on the int (ANGLE-safe); anything
// unknown falls through to luma.
float key(vec3 c) {
  if (uKey == 1) {
    // Hue in [0,1): red 0, green 1/3, blue 2/3. Grey has none: 0.
    float mx = max(c.r, max(c.g, c.b));
    float d = mx - min(c.r, min(c.g, c.b));
    if (d <= 0.0) return 0.0;
    float h;
    if (mx == c.r) h = (c.g - c.b) / d;
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    return fract(h / 6.0);
  }
  if (uKey == 2) {
    // Saturation (HSV): (max - min) / max; black has none.
    float mx = max(c.r, max(c.g, c.b));
    if (mx <= 0.0) return 0.0;
    return (mx - min(c.r, min(c.g, c.b))) / mx;
  }
  if (uKey == 3) return c.r;
  if (uKey == 4) return c.g;
  if (uKey == 5) return c.b;
  return luma(c);
}
const float SECTOR = 0.39269908169872414; // pi/8: 16 sectors of 22.5 deg
const float SECTOR8 = 0.7853981633974483; // pi/4: the facet grammar's 8
const ivec2 DIRS[16] = ivec2[16](
  ivec2(1, 0), ivec2(2, 1), ivec2(1, 1), ivec2(1, 2),
  ivec2(0, 1), ivec2(-1, 2), ivec2(-1, 1), ivec2(-2, 1),
  ivec2(-1, 0), ivec2(-2, -1), ivec2(-1, -1), ivec2(-1, -2),
  ivec2(0, -1), ivec2(1, -2), ivec2(1, -1), ivec2(2, -1)
);
const ivec2 DIRS8[8] = ivec2[8](
  ivec2(1, 0), ivec2(1, 1), ivec2(0, 1), ivec2(-1, 1),
  ivec2(-1, 0), ivec2(-1, -1), ivec2(0, -1), ivec2(1, -1)
);
// Two quantizers, both kept by John's call — he liked both behaviors.
// paths (uFacets 0): 16 sectors, boundary dithered per pass — seams
// wander, average motion follows the true angle, ribbons curve.
// facets (uFacets 1): 8 fixed sectors, no dither — the first cut's
// grammar, where sector edges are anchored seams and ribbons run
// straight inside each patch and pool where the field bends.
ivec2 quantizeDir(float a) {
  if (uFacets > 0.5) {
    int k = int(round(a / SECTOR8));
    return DIRS8[((k % 8) + 8) % 8];
  }
  int k = int(round(a / SECTOR + uSectorJitter));
  return DIRS[((k % 16) + 16) % 16];
}
// The field's direction, turned by the angle before it is quantized.
ivec2 fieldDir(ivec2 cell) {
  vec2 d = texelFetch(uField, cell, 0).rg * 2.0 - 1.0;
  return quantizeDir(atan(d.y, d.x) + uAngle);
}
void main() {
  ivec2 size = textureSize(uTex, 0);
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 self = texelFetch(uTex, p, 0);

  int s = int(uStride);
  ivec2 v = ivec2(0, 1);
  if (uUseFlow > 0.5) v = fieldDir(p >> 2);
  else if (uAngle != 0.0) v = quantizeDir(1.5707963267948966 + uAngle);

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
  // The partner must quantize to the SAME direction this pass, or neither
  // touches the other. The jitter is shared, so refusal stays symmetric —
  // and next pass the boundary has moved, so the seam does not anchor.
  if (uUseFlow > 0.5 && fieldDir(q >> 2) != v) {
    outColor = self;
    return;
  }
  vec4 other = texelFetch(uTex, q, 0);

  // The barrier reads luma whatever the key.
  if (luma(self.rgb) < uThreshold || luma(other.rgb) < uThreshold) {
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

  // The higher key seeks the smaller projection along v (for columns: the
  // video's top; under luma, bright climbs). "swap" is symmetric: both
  // members output the other's value. Equal keys do not trade (until
  // temperature flips the verdict).
  float lSelf = key(self.rgb);
  float lOther = key(other.rgb);
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
