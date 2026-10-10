// Bloom spreads a single bad pixel across the whole frame: one NaN or half-float overflow from an
// additive spark pile-up or a camera flash turned an entire frame black every few seconds. This
// pass runs between the scene and bloom, replaces invalid values and caps extreme brightness.
//
// A bad pixel is filled from its valid neighbours rather than zeroed: zeroing turned whatever
// produced it (a particle quad, a point sprite) into a black square on GPUs that make NaNs where
// this Mac does not. `?nan` paints them magenta (NaN) and cyan (overflow) to find the source.

import { Effect, EffectAttribute } from 'postprocessing';

const FRAG = /* glsl */ `
bool badv(vec3 c) {
  // isnan can be optimised away; a NaN also fails every comparison.
  return any(isnan(c)) || any(isinf(c)) || !(c.r >= -1e9 && c.g >= -1e9 && c.b >= -1e9) || max(abs(c.r), max(abs(c.g), abs(c.b))) > 6.0e4;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  if (badv(c)) {
#ifdef DEBUG_NAN
    c = any(isnan(c)) || !(c.r >= -1e9) ? vec3(40.0, 0.0, 40.0) : vec3(0.0, 40.0, 40.0);
#else
    vec3 sum = vec3(0.0);
    float n = 0.0;
    for (int ring = 0; ring < 3; ring++) {
      float r = ring == 0 ? 2.0 : (ring == 1 ? 7.0 : 18.0);
      for (int k = 0; k < 8; k++) {
        float a = float(k) * 0.785398 + float(ring) * 0.39;
        vec3 s = texture2D(inputBuffer, uv + vec2(cos(a), sin(a)) * r * texelSize).rgb;
        if (!badv(s)) {
          sum += clamp(s, 0.0, 96.0);
          n += 1.0;
        }
      }
      if (n >= 3.0) break;
    }
    c = n > 0.0 ? sum / n : vec3(0.0);
#endif
  }
  // Keep HDR headroom for sparks and lamps, but nowhere near half-float overflow.
  c = clamp(c, 0.0, 96.0);
  outputColor = vec4(c, inputColor.a);
}`;

export class SanitizeEffect extends Effect {
  constructor() {
    const debug = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nan');
    super('SanitizeEffect', FRAG, {
      attributes: EffectAttribute.CONVOLUTION,
      defines: debug ? new Map([['DEBUG_NAN', '1']]) : undefined,
    });
  }
}
