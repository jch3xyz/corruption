// The temporal feedback pass — the component that separates a convincing
// result from an obvious filter. Real codec corruption persists because
// motion vectors keep referencing a damaged reference frame; this
// reproduces that by compositing each incoming frame against the drifted,
// decaying accumulator.
//
// Deliberate deviation from the proposal's snippet: the mask is computed on
// the KEPT value (brighter of decayed history and incoming), not on
// incoming alone. Masking on incoming discards the history the moment a
// bright object moves off a pixel, so no smear ever outlives its source —
// the harness's trail test caught exactly that. Masking on kept lets the
// smear persist over newly-dark regions, decay, and self-clear once it
// falls below threshold, which is the behavior the proposal describes.
//
// uDrift is in texture UV units per frame. Texture v grows toward the
// video's bottom, so POSITIVE uDrift.y makes trails climb upward.
import { GLSL_LUMA } from './common.js';

export const FRAG_COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D uFrame;
uniform sampler2D uAccum;
uniform vec2 uDrift;
uniform float uDecay;
uniform float uThreshold;
in vec2 vUV;
out vec4 outColor;
${GLSL_LUMA}
void main() {
  vec4 incoming = texture(uFrame, vUV);
  vec4 history  = texture(uAccum, vUV + uDrift);
  vec4 kept     = max(history * uDecay, incoming);
  float mask    = step(uThreshold, luma(kept.rgb));
  outColor = mix(incoming, kept, mask);
}`;
