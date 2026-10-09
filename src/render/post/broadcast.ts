// A 2001 standard definition feed: soft, a touch of chroma bleed, interlace lines and grain.

import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import * as THREE from 'three';

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uAmount;
uniform vec2 uRes;

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  // Sample at roughly SD resolution: horizontal softness and a little vertical.
  vec2 px = vec2(1.0 / 720.0, 1.0 / 540.0) * 0.9;
  vec3 c = texture2D(inputBuffer, uv).rgb * 0.4;
  c += texture2D(inputBuffer, uv + vec2(px.x, 0.0)).rgb * 0.2;
  c += texture2D(inputBuffer, uv - vec2(px.x, 0.0)).rgb * 0.2;
  c += texture2D(inputBuffer, uv + vec2(0.0, px.y)).rgb * 0.1;
  c += texture2D(inputBuffer, uv - vec2(0.0, px.y)).rgb * 0.1;
  // Chroma bleeds right, like composite video.
  float cr = texture2D(inputBuffer, uv - vec2(px.x * 2.2, 0.0)).r;
  float cb = texture2D(inputBuffer, uv + vec2(px.x * 1.4, 0.0)).b;
  c.r = mix(c.r, cr, 0.5);
  c.b = mix(c.b, cb, 0.4);
  // Interlace lines.
  float line = 0.94 + 0.06 * sin(uv.y * uRes.y * 3.14159);
  // Grain.
  float g = hash(floor(uv * vec2(720.0, 486.0)) + fract(uTime * 13.7) * 100.0) - 0.5;
  vec3 outc = c * line + g * 0.022;
  // Slight lift and saturation drop.
  float l = dot(outc, vec3(0.299, 0.587, 0.114));
  outc = mix(vec3(l), outc, 0.88) * 0.97 + 0.012;
  outputColor = vec4(mix(inputColor.rgb, outc, uAmount), inputColor.a);
}`;

export class BroadcastEffect extends Effect {
  constructor() {
    super('BroadcastEffect', FRAG, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['uTime', new THREE.Uniform(0)],
        ['uAmount', new THREE.Uniform(1)],
        ['uRes', new THREE.Uniform(new THREE.Vector2(1280, 720))],
      ]),
    });
  }
  setTime(t: number): void {
    this.uniforms.get('uTime')!.value = t;
  }
  override setSize(w: number, h: number): void {
    (this.uniforms.get('uRes')!.value as THREE.Vector2).set(w, h);
  }
}
