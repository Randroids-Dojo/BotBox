// Bloom spreads a single bad pixel across the whole frame: one NaN or half-float overflow from an
// additive spark pile-up or a camera flash turned an entire frame black every few seconds. This
// pass runs between the scene and bloom, replaces invalid values and caps extreme brightness.
//
// A bad pixel is filled from its valid neighbours rather than zeroed: zeroing turned whatever
// produced it (a particle quad, a point sprite) into a black square. `?nan` paints them magenta
// (NaN), cyan (overflow) and negative light yellow, to find the source.

import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';

const FRAG = /* glsl */ `
// Read the bits: with fast math (ANGLE on Metal) isnan() and the "NaN fails every comparison"
// test are both optimised away, and one NaN pixel got through to bloom as a black square.
bool badf(float x) { return (floatBitsToUint(x) & 0x7f800000u) == 0x7f800000u; }
bool nanf(float x) { uint u = floatBitsToUint(x); return (u & 0x7f800000u) == 0x7f800000u && (u & 0x007fffffu) != 0u; }
bool badv(vec3 c) {
  return badf(c.r) || badf(c.g) || badf(c.b) || max(abs(c.r), max(abs(c.g), abs(c.b))) > 6.0e4;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb;
  if (badv(c)) {
#ifdef DEBUG_NAN
    c = nanf(c.r) || nanf(c.g) || nanf(c.b) ? vec3(40.0, 0.0, 40.0) : vec3(0.0, 40.0, 40.0);
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
#ifdef DEBUG_NAN
  // Negative light clamps to black: paint it yellow.
  else if (min(c.r, min(c.g, c.b)) < -0.001) c = vec3(40.0, 40.0, 0.0);
#endif
  // Keep HDR headroom for sparks and lamps, but nowhere near half-float overflow.
  c = clamp(c, 0.0, 96.0);
  outputColor = vec4(c, inputColor.a);
}`;

export class SanitizeEffect extends Effect {
  constructor() {
    const debug = typeof location !== 'undefined' && new URLSearchParams(location.search).has('nan');
    super('SanitizeEffect', FRAG, {
      // The default NORMAL blend is mix(input, output, 1): input * 0 is still NaN, so the bad pixel
      // came straight back. SRC writes the cleaned color alone.
      blendFunction: BlendFunction.SRC,
      attributes: EffectAttribute.CONVOLUTION,
      defines: debug ? new Map([['DEBUG_NAN', '1']]) : undefined,
    });
  }
}
