// Shared GLSL sources as template literals — no fetch, no build step.

// Fullscreen triangle: three verts covering clip space, UV derived in the
// vertex shader. One triangle beats a quad (no diagonal seam, fewer verts).
export const VERT_FULLSCREEN = `#version 300 es
layout(location = 0) in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// Rec. 709 luma — the sort key and threshold input for later phases.
export const GLSL_LUMA = `
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }`;
