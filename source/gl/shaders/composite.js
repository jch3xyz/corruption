// The temporal feedback pass — the component that separates a convincing
// result from an obvious filter. Real codec corruption persists because
// motion vectors keep referencing a damaged reference frame; this
// reproduces that by compositing each incoming frame against the drifted,
// decaying accumulator.
//
// Deliberate deviation from the proposal's snippet: the mask is computed on
// the KEPT value (decayed history blended with incoming), not on
// incoming alone. Masking on incoming discards the history the moment a
// bright object moves off a pixel, so no smear ever outlives its source —
// the harness's trail test caught exactly that. Masking on kept lets the
// smear persist over newly-dark regions, decay, and self-clear once it
// falls below threshold, which is the behavior the proposal describes.
//
// The blend (design review M5): how the decayed history meets the incoming
// frame. uBlend 0 = brighter (max — the codec-faithful rule, and the resting
// state), 1 = mix (a straight crossfade with history, where uMix IS the
// crossfade), 2 = screen, 3 = add. For brighter/screen/add, uMix then lerps
// incoming → blended, so 0 is a wire and 1 is the full rule. Brighter-wins
// is invisible over bright moving footage — the trail only survives where
// the frame goes dark — so the other rules let the trail show over light
// material. At uBlend 0 / uMix 1 the kept value is the original
// max(history·decay, incoming) expression, untouched: no lerp runs, so the
// resting state is bit-identical to the shader before the blend existed.
// The branch is if/else on a uniform int (uniform control flow, safe on
// ANGLE). The mask still reads luma(kept), so true black stays a barrier
// in every mode; the alpha trail never reads the blend.
//
// uDrift is in texture UV units per frame. Texture v grows toward the
// video's bottom, so POSITIVE uDrift.y makes trails climb upward.
//
// The alpha channel is the MOTION TRAIL (for the sort pass's motion gate):
// |incoming − previous frame|, amplified, decaying at ~0.90/frame so brief
// motion lingers for about a second. It must be measured against uPrev — a
// clean copy of the last frame — never against the accumulator, which holds
// sorted material: diffing against the accumulator would measure our own
// damage and light the whole frame up as "motion". Alpha never reaches the
// screen (the shared context is alpha:false), and it rides along with
// swapped pixels, so motion tags travel with their material.
import { GLSL_LUMA } from './common.js';

export const FRAG_COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D uFrame;
uniform sampler2D uAccum;
uniform sampler2D uPrev;
uniform vec2 uDrift;
uniform float uDecay;
uniform float uThreshold;
uniform int uBlend;
uniform float uMix;
in vec2 vUV;
out vec4 outColor;
${GLSL_LUMA}
void main() {
  vec4 incoming = texture(uFrame, vUV);
  vec4 history  = texture(uAccum, vUV + uDrift);
  vec3 prev     = texture(uPrev, vUV).rgb;
  vec3 decayed  = history.rgb * uDecay;
  vec3 kept     = max(decayed, incoming.rgb);
  if (uBlend == 1) {
    kept = mix(incoming.rgb, decayed, uMix);
  } else {
    if (uBlend == 2) {
      kept = 1.0 - (1.0 - incoming.rgb) * (1.0 - decayed);
    } else if (uBlend == 3) {
      kept = clamp(incoming.rgb + decayed, 0.0, 1.0);
    }
    if (uMix < 1.0) kept = mix(incoming.rgb, kept, uMix);
  }
  float mask    = step(uThreshold, luma(kept));
  float motion  = clamp(distance(incoming.rgb, prev) * 3.0, 0.0, 1.0);
  float trail   = max(motion, history.a * 0.90);
  outColor = vec4(mix(incoming.rgb, kept, mask), trail);
}`;
