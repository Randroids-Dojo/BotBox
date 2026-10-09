// Sparks: CPU-simulated, GPU-drawn streaks. One instanced quad per spark, stretched in screen
// space between its position and where it was a moment ago, colored by temperature with HDR
// values well above 1 so bloom catches them. They fall, bounce off the floor, cool from white
// to orange to dark red, and titanium sparks spit into smaller sparks mid-air.
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iData; // heat, size (m), alpha, unused
uniform float uStreak;
uniform vec2 uRes;
varying vec2 vUv;
varying float vHeat;
varying float vAlpha;
void main() {
  vec3 head = iPos;
  vec3 tail = iPos - iVel * uStreak;
  vec4 ch = projectionMatrix * viewMatrix * vec4(head, 1.0);
  vec4 ct = projectionMatrix * viewMatrix * vec4(tail, 1.0);
  // Keep both ends in front of the camera.
  if (ct.w < 0.05) ct = ch;
  vec2 sh = ch.xy / max(ch.w, 0.05);
  vec2 st = ct.xy / max(ct.w, 0.05);
  vec2 d = (sh - st) * uRes * 0.5;
  float len = length(d);
  vec2 dir = len > 0.001 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float px = iData.y * projectionMatrix[1][1] * uRes.y * 0.5 / max(ch.w, 0.05);
  float w = max(px, 1.3);
  // Thin sparks keep their energy by getting dimmer, not vanishing.
  vAlpha = iData.z * clamp(px / 1.3, 0.35, 1.0);
  vHeat = iData.x;
  float t = position.y; // 0 tail, 1 head
  vec2 base = mix(st, sh, t);
  vec2 off = nrm * position.x * w * 0.5 + dir * (t * 2.0 - 1.0) * w * 0.5;
  float cw = mix(ct.w, ch.w, t);
  float cz = mix(ct.z / max(ct.w, 0.05), ch.z / max(ch.w, 0.05), t);
  vec2 ndc = base + off / (uRes * 0.5);
  gl_Position = vec4(ndc * cw, cz * cw, cw);
  vUv = vec2(position.x, t);
}
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying float vHeat;
varying float vAlpha;
vec3 heatColor(float h) {
  // Black body-ish ramp in linear HDR: dark red, orange, yellow, white-hot.
  vec3 c = mix(vec3(0.35, 0.03, 0.0), vec3(2.6, 0.55, 0.06), smoothstep(0.0, 0.35, h));
  c = mix(c, vec3(5.0, 2.3, 0.5), smoothstep(0.3, 0.7, h));
  c = mix(c, vec3(9.0, 8.0, 6.5), smoothstep(0.75, 1.15, h));
  return c;
}
void main() {
  float x = vUv.x;
  float core = 1.0 - x * x;
  core *= core;
  float along = mix(0.15, 1.0, vUv.y);
  float k = core * along * vAlpha;
  if (k < 0.004) discard;
  gl_FragColor = vec4(heatColor(vHeat) * k, 1.0);
}
`;

export interface SparkEmit {
  x: number;
  y: number;
  z: number;
  /** Main direction (unit). */
  dx: number;
  dy: number;
  dz: number;
  count: number;
  speed: [number, number];
  /** Cone half-angle around the direction, radians. */
  spread: number;
  /** Starting temperature: 1.2 white-hot, 0.8 orange, 0.5 dull. */
  heat: number;
  life: [number, number];
  size: number;
  /** Gravity multiplier (embers use negative). */
  gravity?: number;
  drag?: number;
  /** Chance per second of splitting (titanium). */
  spit?: number;
}

const STRIDE = 14; // px py pz vx vy vz age life heat0 size grav drag spit bounces

export class SparkSystem {
  readonly mesh: THREE.Mesh;
  private data: Float32Array;
  private n = 0;
  private iPos: THREE.InstancedBufferAttribute;
  private iVel: THREE.InstancedBufferAttribute;
  private iData: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;
  private rnd = mulberry(91);

  constructor(readonly capacity: number) {
    this.data = new Float32Array(capacity * STRIDE);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.iVel = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.iData = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    for (const a of [this.iPos, this.iVel, this.iData]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.iPos);
    geo.setAttribute('iVel', this.iVel);
    geo.setAttribute('iData', this.iData);
    geo.instanceCount = 0;
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uStreak: { value: 1 / 40 }, uRes: { value: new THREE.Vector2(1280, 720) } },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      transparent: true,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.name = 'sparks';
    this.mesh.onBeforeRender = (renderer) => {
      renderer.getDrawingBufferSize(this.mat.uniforms.uRes.value);
    };
  }

  get count(): number {
    return this.n;
  }

  emit(e: SparkEmit): void {
    const r = this.rnd;
    const dir = tmpDir.set(e.dx, e.dy, e.dz);
    if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
    dir.normalize();
    // Basis around the direction.
    const t1 = Math.abs(dir.y) < 0.9 ? tmpT.set(0, 1, 0).cross(dir).normalize() : tmpT.set(1, 0, 0).cross(dir).normalize();
    const t2 = tmpB.copy(dir).cross(t1);
    for (let i = 0; i < e.count; i++) {
      if (this.n >= this.capacity) this.kill(Math.floor(r() * this.n));
      const k = this.n++ * STRIDE;
      const a = r() * Math.PI * 2;
      const c = Math.cos(e.spread * Math.sqrt(r()));
      const s = Math.sqrt(1 - c * c);
      const sp = e.speed[0] + (e.speed[1] - e.speed[0]) * r() * r();
      const vx = (dir.x * c + (t1.x * Math.cos(a) + t2.x * Math.sin(a)) * s) * sp;
      const vy = (dir.y * c + (t1.y * Math.cos(a) + t2.y * Math.sin(a)) * s) * sp;
      const vz = (dir.z * c + (t1.z * Math.cos(a) + t2.z * Math.sin(a)) * s) * sp;
      const d = this.data;
      d[k] = e.x;
      d[k + 1] = e.y;
      d[k + 2] = e.z;
      d[k + 3] = vx;
      d[k + 4] = vy;
      d[k + 5] = vz;
      d[k + 6] = 0;
      d[k + 7] = e.life[0] + (e.life[1] - e.life[0]) * r();
      d[k + 8] = e.heat * (0.85 + 0.3 * r());
      d[k + 9] = e.size * (0.6 + 0.8 * r());
      d[k + 10] = e.gravity ?? 1;
      d[k + 11] = e.drag ?? 0.6;
      d[k + 12] = e.spit ?? 0;
      d[k + 13] = 0;
    }
  }

  private kill(i: number): void {
    const last = --this.n;
    if (i !== last) this.data.copyWithin(i * STRIDE, last * STRIDE, last * STRIDE + STRIDE);
  }

  update(dt: number): void {
    const d = this.data;
    const r = this.rnd;
    const g = 9.81;
    let i = 0;
    while (i < this.n) {
      const k = i * STRIDE;
      d[k + 6] += dt;
      if (d[k + 6] >= d[k + 7]) {
        this.kill(i);
        continue;
      }
      const drag = Math.max(0, 1 - d[k + 11] * dt);
      d[k + 3] *= drag;
      d[k + 4] = d[k + 4] * drag - g * d[k + 10] * dt;
      d[k + 5] *= drag;
      d[k] += d[k + 3] * dt;
      d[k + 1] += d[k + 4] * dt;
      d[k + 2] += d[k + 5] * dt;
      // Floor bounce, walls of the Box, the Lexan ceiling.
      if (d[k + 1] < 0.004) {
        d[k + 1] = 0.004;
        if (d[k + 4] < 0) {
          d[k + 4] = -d[k + 4] * (0.25 + 0.2 * r());
          d[k + 3] *= 0.55;
          d[k + 5] *= 0.55;
          d[k + 13]++;
          d[k + 8] *= 0.8;
          // Skitter: a little sideways kick.
          d[k + 3] += (r() - 0.5) * 0.8;
          d[k + 5] += (r() - 0.5) * 0.8;
        }
      }
      if (d[k + 1] > 4.95 && d[k + 4] > 0) d[k + 4] = -d[k + 4] * 0.3;
      if (Math.abs(d[k]) > 7.28) {
        d[k] = Math.sign(d[k]) * 7.28;
        d[k + 3] *= -0.3;
      }
      if (Math.abs(d[k + 2]) > 7.28) {
        d[k + 2] = Math.sign(d[k + 2]) * 7.28;
        d[k + 5] *= -0.3;
      }
      // Titanium sparks spit into smaller ones.
      if (d[k + 12] > 0 && r() < d[k + 12] * dt && this.n < this.capacity - 3 && d[k + 9] > 0.004) {
        const n = 2 + Math.floor(r() * 2);
        for (let j = 0; j < n; j++) {
          const c = this.n++ * STRIDE;
          d.copyWithin(c, k, k + STRIDE);
          d[c + 3] += (r() - 0.5) * 4;
          d[c + 4] += (r() - 0.3) * 4;
          d[c + 5] += (r() - 0.5) * 4;
          d[c + 6] = 0;
          d[c + 7] = 0.15 + r() * 0.25;
          d[c + 9] *= 0.55;
          d[c + 12] = 0;
        }
        d[k + 12] = 0;
      }
      i++;
    }
    // Upload.
    const P = this.iPos.array as Float32Array;
    const V = this.iVel.array as Float32Array;
    const D = this.iData.array as Float32Array;
    for (let j = 0; j < this.n; j++) {
      const k = j * STRIDE;
      const t = d[k + 6] / d[k + 7];
      P[j * 3] = d[k];
      P[j * 3 + 1] = d[k + 1];
      P[j * 3 + 2] = d[k + 2];
      V[j * 3] = d[k + 3];
      V[j * 3 + 1] = d[k + 4];
      V[j * 3 + 2] = d[k + 5];
      D[j * 4] = d[k + 8] * Math.pow(1 - t, 1.1);
      D[j * 4 + 1] = d[k + 9];
      D[j * 4 + 2] = t > 0.8 ? (1 - t) / 0.2 : 1;
      D[j * 4 + 3] = 0;
    }
    this.geo.instanceCount = this.n;
    for (const [a, n] of [
      [this.iPos, 3],
      [this.iVel, 3],
      [this.iData, 4],
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

const tmpDir = new THREE.Vector3();
const tmpT = new THREE.Vector3();
const tmpB = new THREE.Vector3();

export function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
