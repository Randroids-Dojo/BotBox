// Bloom spreads a single bad pixel across the whole frame: one NaN or half-float overflow from an
// additive spark pile-up or a camera flash turned an entire frame black every few seconds. This
// pass runs between the scene and bloom, replaces invalid values and caps extreme brightness.

import { Effect } from 'postprocessing';

const FRAG = /* glsl */ `
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0);
  // Keep HDR headroom for sparks and lamps, but nowhere near half-float overflow.
  c = clamp(c, 0.0, 96.0);
  outputColor = vec4(c, inputColor.a);
}`;

export class SanitizeEffect extends Effect {
  constructor() {
    super('SanitizeEffect', FRAG);
  }
}
