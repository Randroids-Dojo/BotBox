// A 2001 standard definition feed: soft, a touch of chroma bleed, interlace lines and grain. And,
// for the prologue montage, old film: a faded warm print at 24 frames a second with grain,
// flicker, gate weave, hairline scratches and dust.

import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import * as THREE from 'three';

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uAmount;
uniform float uFilm;
uniform vec2 uRes;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // Film changes once per film frame, not per screen frame.
  float fr = mod(floor(uTime * 24.0), 997.0);
  // Gate weave: the frame drifts a hair in the projector.
  vec2 st = uv + (vec2(hash(vec2(fr, 1.7)), hash(vec2(fr, 9.1))) - 0.5) * vec2(0.0012, 0.0018) * uFilm;
  vec3 src = texture2D(inputBuffer, st).rgb;

  // Sample at roughly SD resolution: horizontal softness and a little vertical.
  vec2 px = vec2(1.0 / 720.0, 1.0 / 540.0) * 0.9;
  vec3 c = src * 0.4;
  c += texture2D(inputBuffer, st + vec2(px.x, 0.0)).rgb * 0.2;
  c += texture2D(inputBuffer, st - vec2(px.x, 0.0)).rgb * 0.2;
  c += texture2D(inputBuffer, st + vec2(0.0, px.y)).rgb * 0.1;
  c += texture2D(inputBuffer, st - vec2(0.0, px.y)).rgb * 0.1;
  // Chroma bleeds right, like composite video.
  float cr = texture2D(inputBuffer, st - vec2(px.x * 2.2, 0.0)).r;
  float cb = texture2D(inputBuffer, st + vec2(px.x * 1.4, 0.0)).b;
  c.r = mix(c.r, cr, 0.5);
  c.b = mix(c.b, cb, 0.4);
  // Interlace lines.
  float line = 0.94 + 0.06 * sin(uv.y * uRes.y * 3.14159);
  // Grain.
  float g = hash(floor(uv * vec2(720.0, 486.0)) + fract(uTime * 13.7) * 100.0) - 0.5;
  vec3 tv = c * line + g * 0.022;
  // Slight lift and saturation drop.
  float tl = dot(tv, vec3(0.299, 0.587, 0.114));
  tv = mix(vec3(tl), tv, 0.88) * 0.97 + 0.012;
  vec3 base = mix(src, tv, uAmount);

  // ---- old film
  vec3 f = clamp(base, 0.0, 1.0);
  float l = dot(f, vec3(0.299, 0.587, 0.114));
  // A faded, warm print: most of the color gone, blacks lifted, whites rolled off.
  // Opened up a little first: the Box and the garage are dark, and a print loses the shadows.
  f = clamp(mix(vec3(l), f, 0.22) * vec3(1.06, 0.96, 0.8), 0.0, 1.0);
  f = sqrt(f) * 0.55 + f * 0.45;
  f = f * f * (3.0 - 2.0 * f);
  f = 0.07 + f * 0.85;
  // Flicker.
  f *= 1.0 + (hash(vec2(fr, 3.3)) - 0.5) * 0.1;
  // Grain: clumps about 960 across whatever the screen, strongest in the mids.
  vec2 gp = floor(uv * vec2(960.0, 540.0));
  float gr = hash(gp + fr * 37.0) + hash(gp * 1.7 + fr * 11.0) - 1.0;
  f += gr * (0.045 + 0.06 * (1.0 - abs(l * 2.0 - 1.0)));
  // A bright hairline scratch or two, jumping every frame.
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    float on = step(0.55, hash(vec2(fr, 20.0 + fi)));
    float d = abs(uv.x - hash(vec2(fr, 30.0 + fi))) * uRes.x;
    float wob = 0.6 + 0.4 * sin(uv.y * 23.0 + fr * 1.3 + fi * 4.0);
    f += on * (1.0 - smoothstep(0.0, 1.4, d)) * 0.16 * wob;
  }
  // Dust: a few dark specks per frame.
  vec2 cell = uv * vec2(48.0, 27.0);
  vec2 id = floor(cell);
  float has = step(0.992, hash(id + fr * 7.0));
  vec2 at = vec2(hash(id + fr * 3.0), hash(id + fr * 5.0)) * 0.7 + 0.15;
  float r = mix(0.05, 0.14, hash(id + fr * 9.0));
  f *= 1.0 - has * (1.0 - smoothstep(r * 0.5, r, length(fract(cell) - at))) * 0.8;
  // The projector's hot spot: darker toward the corners.
  vec2 q = uv - 0.5;
  float v = clamp(1.0 - dot(q, q) * 1.6, 0.0, 1.0);
  f *= 0.72 + 0.28 * v * v;

  outputColor = vec4(mix(base, clamp(f, 0.0, 1.0), uFilm), inputColor.a);
}`;

export class BroadcastEffect extends Effect {
  constructor() {
    super('BroadcastEffect', FRAG, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['uTime', new THREE.Uniform(0)],
        ['uAmount', new THREE.Uniform(1)],
        ['uFilm', new THREE.Uniform(0)],
        ['uRes', new THREE.Uniform(new THREE.Vector2(1280, 720))],
      ]),
    });
  }
  setTime(t: number): void {
    this.uniforms.get('uTime')!.value = t;
  }
  /** 0 is a clean picture, 1 the full SD broadcast look. */
  setAmount(a: number): void {
    this.uniforms.get('uAmount')!.value = a;
  }
  /** 0 is off, 1 is old film. */
  setFilm(a: number): void {
    this.uniforms.get('uFilm')!.value = a;
  }
  override setSize(w: number, h: number): void {
    (this.uniforms.get('uRes')!.value as THREE.Vector2).set(w, h);
  }
}
