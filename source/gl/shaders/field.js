// The flow field (John's pick from the dynamism survey, 2026-08-12): a
// per-bundle direction texture the sort pass follows instead of straight
// columns. Curl of morphing value noise — divergence-free, so streamlines
// swirl and meander rather than converging or draining. This pass stores
// the CONTINUOUS unit direction; the sort pass quantizes it to 16 integer
// offsets per pass with a dithered sector boundary (compare-exchange must
// land on exact texels to remain a permutation, but a FIXED quantization
// anchors refusal seams and material pools there instead of rounding the
// curve — the lesson of the first, 8-direction cut).
//
// Rendered at 1/4 the processing resolution once per frame (not per sort
// pass): the field is low-frequency by construction, and this keeps the
// sort's per-pass cost at two texelFetches plus an atan.
//
// uAmount blends the direction from vertical (0) toward the curl (1). At
// 0 every cell stores exact vertical, which the sort quantizes to (0,1)
// under any jitter — bit-identical to the classic grammar, harness-pinned.
export const FRAG_FIELD = `#version 300 es
precision highp float;
uniform vec2 uProcSize;
uniform float uScale;
uniform float uSpeed;
uniform float uTime;
uniform float uAmount;
out vec4 outColor;

float hash(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float vnoise(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
             u.y);
}
// Two octaves scrolling against each other: the field morphs in place
// rather than translating, so streamlines re-carve instead of marching.
float n2(vec2 p, float t) {
  return vnoise(p + vec2(t, 0.0)) + 0.5 * vnoise(p * 1.7 - vec2(0.0, t * 0.7));
}
void main() {
  // Each field texel covers a 4x4 cell of the accumulator.
  vec2 uv = (gl_FragCoord.xy * 4.0 + 2.0) / uProcSize;
  vec2 q = uv * uScale;
  float t = uTime * uSpeed * 10.0;
  float e = 0.35;
  float dx = n2(q + vec2(e, 0.0), t) - n2(q - vec2(e, 0.0), t);
  float dy = n2(q + vec2(0.0, e), t) - n2(q - vec2(0.0, e), t);
  vec2 curl = vec2(dy, -dx);
  float len = length(curl);
  vec2 dir = len > 1e-5 ? curl / len : vec2(0.0, 1.0);
  // The epsilon keeps normalize() defined when the mix cancels exactly.
  dir = normalize(mix(vec2(0.0, 1.0), dir, uAmount) + vec2(1e-4));
  // The CONTINUOUS direction ships to the sort pass, which quantizes it
  // per pass with a dithered sector boundary — that is what lets material
  // round a curve instead of pooling at a fixed quantization seam.
  outColor = vec4((dir + 1.0) * 0.5, 0.0, 1.0);
}`;
