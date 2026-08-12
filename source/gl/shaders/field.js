// The flow field (John's pick from the dynamism survey, 2026-08-12): a
// per-bundle direction texture the sort pass follows instead of straight
// columns. Curl of morphing value noise — divergence-free, so streamlines
// swirl and meander rather than converging or draining — quantized to the
// 8 integer offset directions, because compare-exchange must land on exact
// texels to remain a permutation.
//
// Rendered at 1/4 the processing resolution once per frame (not per sort
// pass): the field is low-frequency by construction, and this keeps the
// sort's per-pass cost at two cheap texelFetches.
//
// uAmount blends the underlying direction from vertical (0) toward the
// curl (1) BEFORE quantization. Quantization gives the blend a character
// worth knowing: small amounts snap back to exact vertical until the mixed
// angle crosses a 22.5° sector boundary, so raising the knob makes columns
// defect to the flow patch by patch rather than leaning uniformly. At 0
// every cell is exactly (0,1) and the sort is bit-identical to the classic
// vertical grammar.
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
  float a = atan(dir.y, dir.x);
  float qa = round(a / 0.7853981633974483) * 0.7853981633974483;
  vec2 v = vec2(round(cos(qa)), round(sin(qa)));
  outColor = vec4((v + 1.0) * 0.5, 0.0, 1.0);
}`;
