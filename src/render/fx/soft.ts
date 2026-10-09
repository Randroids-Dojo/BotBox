// Soft billboard particles: smoke, dust, CO2 vapor (alpha blended) and flames, flashes and glows
// (additive). CPU-simulated in a pooled typed array, drawn as one instanced quad batch per
// system. Sprites come from a 2x2 atlas of generated textures.
import * as THREE from 'three';
import { mulberry } from './sparks';

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iColor;
attribute vec4 iMisc; // size, rotation, atlas cell, shade
varying vec2 vUv;
varying vec4 vColor;
varying float vShade;
void main() {
  // iMisc.w packs shade (0..1) plus 2 when the sprite should sit on the floor.
  float ground = step(1.5, iMisc.w);
  float shadeK = iMisc.w - 2.0 * ground;
  vec3 wp = iPos + vec3(0.0, ground * iMisc.x * 0.3, 0.0);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  // Pull sprites toward the camera so they do not slice into the floor or robots.
  mv.z += iMisc.x * (0.35 + ground * 0.9);
  float c = cos(iMisc.y);
  float s = sin(iMisc.y);
  vec2 corner = position.xy;
  vec2 r = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
  mv.xy += r * iMisc.x;
  gl_Position = projectionMatrix * mv;
  float cell = iMisc.z;
  vec2 uv = corner * 0.5 + 0.5;
  vUv = (uv + vec2(mod(cell, 2.0), 1.0 - floor(cell / 2.0))) * 0.5;
  vColor = iColor;
  // Lighter on the side facing up in screen space: cheap top lighting for smoke.
  vShade = mix(1.0 - shadeK, 1.0, uv.y);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uAdditive;
varying vec2 vUv;
varying vec4 vColor;
varying float vShade;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vColor.a;
  if (a < 0.003) discard;
  vec3 col = vColor.rgb * mix(vec3(1.0), t.rgb, 0.6) * vShade;
  if (uAdditive > 0.5) gl_FragColor = vec4(col * a, 1.0);
  else gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

export interface SoftEmit {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  size0: number;
  size1: number;
  /** Linear color at birth and death, alpha peak. */
  c0: [number, number, number];
  c1: [number, number, number];
  alpha: number;
  /** Upward acceleration (smoke rises, dust settles with negative). */
  buoy?: number;
  drag?: number;
  rot?: number;
  spin?: number;
  cell?: number;
  /** 0..1 how much darker the underside is. */
  shade?: number;
  /** Fraction of life spent fading in. */
  fadeIn?: number;
  /** Sit on the floor (dust): the sprite is lifted by half its size. */
  ground?: boolean;
}

const STRIDE = 22;
// px py pz vx vy vz age life s0 s1 r0 g0 b0 r1 g1 b1 alpha buoy drag rot spin cell(+shade*10 packed) fadeIn -> see below

export class SoftSystem {
  readonly mesh: THREE.Mesh;
  private data: Float32Array;
  private extra: Float32Array;
  private n = 0;
  private iPos: THREE.InstancedBufferAttribute;
  private iColor: THREE.InstancedBufferAttribute;
  private iMisc: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;
  private rnd = mulberry(17);
  /** Lateral wander strength, m/s^2. */
  turbulence = 0;

  constructor(
    readonly capacity: number,
    map: THREE.Texture,
    additive: boolean,
  ) {
    this.data = new Float32Array(capacity * STRIDE);
    this.extra = new Float32Array(capacity * 3); // cell, shade, fadeIn
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.iColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.iMisc = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    for (const a of [this.iPos, this.iColor, this.iMisc]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.iPos);
    geo.setAttribute('iColor', this.iColor);
    geo.setAttribute('iMisc', this.iMisc);
    geo.instanceCount = 0;
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uMap: { value: map }, uAdditive: { value: additive ? 1 : 0 } },
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 11 : 9;
  }

  get count(): number {
    return this.n;
  }

  emit(e: SoftEmit): void {
    if (this.n >= this.capacity) this.kill(0);
    const i = this.n++;
    const k = i * STRIDE;
    const d = this.data;
    const r = this.rnd;
    d[k] = e.x;
    d[k + 1] = e.y;
    d[k + 2] = e.z;
    d[k + 3] = e.vx;
    d[k + 4] = e.vy;
    d[k + 5] = e.vz;
    d[k + 6] = 0;
    d[k + 7] = e.life;
    d[k + 8] = e.size0;
    d[k + 9] = e.size1;
    d[k + 10] = e.c0[0];
    d[k + 11] = e.c0[1];
    d[k + 12] = e.c0[2];
    d[k + 13] = e.c1[0];
    d[k + 14] = e.c1[1];
    d[k + 15] = e.c1[2];
    d[k + 16] = e.alpha;
    d[k + 17] = e.buoy ?? 0;
    d[k + 18] = e.drag ?? 0.8;
    d[k + 19] = e.rot ?? r() * Math.PI * 2;
    d[k + 20] = e.spin ?? (r() - 0.5) * 1.2;
    d[k + 21] = 0;
    const x = i * 3;
    this.extra[x] = e.cell ?? Math.floor(r() * 4);
    this.extra[x + 1] = (e.shade ?? 0.35) + (e.ground ? 2 : 0);
    this.extra[x + 2] = e.fadeIn ?? 0.12;
  }

  private kill(i: number): void {
    const last = --this.n;
    if (i !== last) {
      this.data.copyWithin(i * STRIDE, last * STRIDE, last * STRIDE + STRIDE);
      this.extra.copyWithin(i * 3, last * 3, last * 3 + 3);
    }
  }

  update(dt: number): void {
    const d = this.data;
    let i = 0;
    while (i < this.n) {
      const k = i * STRIDE;
      d[k + 6] += dt;
      if (d[k + 6] >= d[k + 7]) {
        this.kill(i);
        continue;
      }
      const drag = Math.max(0, 1 - d[k + 18] * dt);
      // Gentle turbulence so plumes wander and billow instead of rising as a cone.
      const age = d[k + 6];
      const ph = d[k + 19] * 3.1;
      const turb = this.turbulence * Math.min(1, age);
      d[k + 3] = d[k + 3] * drag + Math.sin(age * 1.7 + ph) * turb * dt;
      d[k + 4] = d[k + 4] * drag + d[k + 17] * dt;
      d[k + 5] = d[k + 5] * drag + Math.cos(age * 1.3 + ph * 1.7) * turb * dt;
      d[k] += d[k + 3] * dt;
      d[k + 1] += d[k + 4] * dt;
      d[k + 2] += d[k + 5] * dt;
      // Smoke pools and spreads under the Lexan ceiling.
      if (d[k + 1] > 4.8) {
        d[k + 1] = 4.8;
        if (d[k + 4] > 0) {
          const h = Math.hypot(d[k + 3], d[k + 5]) || 1;
          d[k + 3] += (d[k + 3] / h) * d[k + 4] * 0.6;
          d[k + 5] += (d[k + 5] / h) * d[k + 4] * 0.6;
          d[k + 4] = 0;
        }
      }
      if (d[k + 1] < 0.02 && d[k + 4] < 0) {
        d[k + 1] = 0.02;
        d[k + 4] = 0;
      }
      d[k + 19] += d[k + 20] * dt;
      i++;
    }
    const P = this.iPos.array as Float32Array;
    const C = this.iColor.array as Float32Array;
    const M = this.iMisc.array as Float32Array;
    for (let j = 0; j < this.n; j++) {
      const k = j * STRIDE;
      const t = d[k + 6] / d[k + 7];
      const fi = this.extra[j * 3 + 2];
      const a = t < fi ? t / fi : Math.pow(1 - (t - fi) / (1 - fi), 1.3);
      const g = 1 - Math.pow(1 - t, 2.2);
      P[j * 3] = d[k];
      P[j * 3 + 1] = d[k + 1];
      P[j * 3 + 2] = d[k + 2];
      C[j * 4] = d[k + 10] + (d[k + 13] - d[k + 10]) * t;
      C[j * 4 + 1] = d[k + 11] + (d[k + 14] - d[k + 11]) * t;
      C[j * 4 + 2] = d[k + 12] + (d[k + 15] - d[k + 12]) * t;
      C[j * 4 + 3] = d[k + 16] * a;
      M[j * 4] = d[k + 8] + (d[k + 9] - d[k + 8]) * g;
      M[j * 4 + 1] = d[k + 19];
      M[j * 4 + 2] = this.extra[j * 3];
      M[j * 4 + 3] = this.extra[j * 3 + 1];
    }
    this.geo.instanceCount = this.n;
    for (const [a, n] of [
      [this.iPos, 3],
      [this.iColor, 4],
      [this.iMisc, 4],
    ] as const) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, Math.max(1, this.n * n));
      a.needsUpdate = true;
    }
  }

  clear(): void {
    this.n = 0;
    this.geo.instanceCount = 0;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
