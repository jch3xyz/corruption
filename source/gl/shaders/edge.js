// The edge pass (round 8 part 3, `edgeGate`, the panel's "edges"): a
// per-frame map of the picture's own outlines, read by the sort's edge gate.
//
// Measured on the CLEAN frame (uFrame, the upload), never on the working
// buffer — for the same reason the motion trail diffs against the clean
// previous frame: the buffer holds sorted material, and measuring our own
// damage would light every ribbon up as an edge and the gate would feed on
// itself. One texel per accumulator texel (processing resolution); the
// upload is sampled at processing-texel offsets, so the bilinear fetch is
// also the downscale.
//
// Sobel on luma, magnitude normalised by the kernel's weight (÷ 8, so a hard
// 0 → 1 step reads 0.5), then the gain: × 4, clamped. A hard black/white
// edge saturates at 1 (any step of half the luma range or more does); a
// gradient of 1/32 per pixel — a soft sky, a blurred background — reads
// about 0.12; flat colour reads 0. Output in R (an R8 target).
import { GLSL_LUMA } from './common.js';

export const FRAG_EDGE = `#version 300 es
precision highp float;
uniform sampler2D uFrame;
uniform vec2 uTexel;
in vec2 vUV;
out vec4 outColor;
${GLSL_LUMA}
float L(float dx, float dy) {
  return luma(texture(uFrame, vUV + vec2(dx, dy) * uTexel).rgb);
}
void main() {
  float tl = L(-1.0, -1.0), tc = L(0.0, -1.0), tr = L(1.0, -1.0);
  float ml = L(-1.0, 0.0), mr = L(1.0, 0.0);
  float bl = L(-1.0, 1.0), bc = L(0.0, 1.0), br = L(1.0, 1.0);
  float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  float gy = (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr);
  float m = length(vec2(gx, gy)) / 8.0;
  outColor = vec4(clamp(m * 4.0, 0.0, 1.0), 0.0, 0.0, 1.0);
}`;
