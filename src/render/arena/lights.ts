// The light rig: real lights (a shadowed overhead key, a shadowed side key on high, colored
// pools) plus additive haze beams from the truss fixtures, merged into one draw call.

import * as THREE from 'three';
import type { Quality } from '../types';
import type { Fixture } from './structure';

export interface LightRig {
  root: THREE.Group;
  key: THREE.SpotLight;
  side: THREE.SpotLight;
  pools: THREE.SpotLight[];
  hemi: THREE.HemisphereLight;
  beams: THREE.Mesh;
  beamUniforms: { uTime: { value: number }; uIntensity: { value: number } };
  setQuality(q: Quality): void;
  /** 0 dark (title), 1 full fight lighting. */
  setLevel(level: number): void;
  /** Haze beam strength before the dressing's factor. */
  setBeams(intensity: number): void;
  /** Event dressing: a dim garage league, the normal show, or the finals. */
  setDressing(d: Dressing): void;
  /** Fixtures that currently draw a beam (the rest are dark in a qualifier). */
  litFixtures(): Fixture[];
}

export type Dressing = 'normal' | 'championship' | 'qualifier';

interface DressingLook {
  key: number;
  side: number;
  pool: number;
  /** Pools beyond this many are off. */
  pools: number;
  hemi: number;
  beams: number;
  beamCount: number;
}

const DRESS: Record<Dressing, DressingLook> = {
  normal: { key: 1, side: 1, pool: 1, pools: 8, hemi: 1, beams: 1, beamCount: 1 },
  // Tuesday night: work lights on the floor, most of the rig dark.
  qualifier: { key: 0.85, side: 0.55, pool: 0.8, pools: 2, hemi: 0.55, beams: 0.75, beamCount: 0.35 },
  // The finals: every can on, brighter and hotter.
  championship: { key: 1.12, side: 1.25, pool: 1.4, pools: 8, hemi: 1.1, beams: 1.3, beamCount: 1.7 },
};

const BEAM_VERT = /* glsl */ `
attribute float along;
attribute vec3 beamColor;
varying float vAlong;
varying vec3 vColor;
varying vec3 vNormalV;
varying vec3 vViewPos;
varying vec3 vWorld;
void main() {
  vAlong = along;
  vColor = beamColor;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vViewPos = mv.xyz;
  vNormalV = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}`;

export const BEAM_FRAG = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
varying float vAlong;
varying vec3 vColor;
varying vec3 vNormalV;
varying vec3 vViewPos;
varying vec3 vWorld;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
void main() {
  vec3 v = normalize(-vViewPos);
  float facing = abs(dot(normalize(vNormalV), v));
  float soft = pow(facing, 2.2);
  float fall = pow(1.0 - vAlong, 1.4) * smoothstep(0.0, 0.06, vAlong);
  float floorFade = 1.0 - smoothstep(0.82, 1.0, vAlong);
  float near = smoothstep(0.6, 3.0, -vViewPos.z);
  float dust = 0.65 + 0.7 * noise(vWorld * 1.3 + vec3(0.0, uTime * 0.15, uTime * 0.07));
  float a = soft * fall * floorFade * near * dust * uIntensity;
  gl_FragColor = vec4(vColor * a, 1.0);
}`;

export function buildLightRig(fixtures: Fixture[], quality: Quality): LightRig {
  const root = new THREE.Group();
  root.name = 'lights';

  const hemi = new THREE.HemisphereLight(0x6a7d9c, 0x0b0b0e, 0.12);
  root.add(hemi);

  // Overhead key: cool white, high above the center, hard shadows.
  const key = new THREE.SpotLight(0xe6efff, 230, 40, 0.62, 0.35, 1.2);
  key.position.set(0.6, 17, 1.2);
  key.target.position.set(0, 0, 0);
  key.castShadow = true;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.02;
  key.shadow.camera.near = 8;
  key.shadow.camera.far = 22;
  root.add(key, key.target);

  // Side key from the booth corner: steel blue, raking, long shadows.
  const side = new THREE.SpotLight(0x9bb8ff, 150, 45, 0.42, 0.5, 1.2);
  side.position.set(12, 12.5, 13);
  side.target.position.set(-1, 0, -1);
  side.shadow.bias = -0.0003;
  side.shadow.normalBias = 0.03;
  side.shadow.camera.near = 8;
  side.shadow.camera.far = 32;
  root.add(side, side.target);

  // Colored pools from a few truss fixtures (no shadows).
  const pools: THREE.SpotLight[] = [];
  const picks = [0, 4, 5, 9, 12, 16, 22, 25];
  for (const i of picks) {
    const f = fixtures[i % fixtures.length];
    const s = new THREE.SpotLight(f.color, 90, 18, f.angle * 1.3, 0.55, 1.5);
    s.position.copy(f.pos);
    s.target.position.copy(f.target);
    pools.push(s);
    root.add(s, s.target);
  }

  // Beams.
  const beamUniforms = { uTime: { value: 0 }, uIntensity: { value: 0.11 } };
  const beamMat = new THREE.ShaderMaterial({
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    uniforms: beamUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  let dress: Dressing = 'normal';
  let level = 1;
  let beamBase = 0.11;
  let q0: Quality = quality;
  const beamFixtures = fixtures.filter((f) => f.beam).length;
  const count = () => Math.max(2, Math.round(Math.min(beamCount(q0), beamFixtures) * DRESS[dress].beamCount));
  let beams = new THREE.Mesh(buildBeams(fixtures, beamCount(quality)), beamMat);
  beams.renderOrder = 4;
  beams.frustumCulled = false;
  root.add(beams);

  const rig: LightRig = {
    root,
    key,
    side,
    pools,
    hemi,
    beams,
    beamUniforms,
    setQuality(q) {
      const size = q === 'high' ? 2048 : 1024;
      for (const l of [key, side]) {
        if (l.shadow.mapSize.x !== size) {
          l.shadow.mapSize.set(size, size);
          l.shadow.map?.dispose();
          l.shadow.map = null;
        }
      }
      side.castShadow = q === 'high';
      const poolCount = q === 'high' ? 8 : q === 'medium' ? 4 : 2;
      pools.forEach((p, i) => (p.visible = i < poolCount));
      q0 = q;
      beams.geometry.dispose();
      beams.geometry = buildBeams(fixtures, count());
      rig.beams = beams;
    },
    setLevel(l) {
      level = l;
      const k = DRESS[dress];
      key.intensity = 230 * (0.05 + level * 0.95) * k.key;
      side.intensity = 150 * (0.25 + level * 0.75) * k.side;
      // Pools past the dressing's count go dark by intensity, so no shader recompiles.
      pools.forEach((p, i) => (p.intensity = i < k.pools ? 90 * (0.5 + level * 0.5) * k.pool : 0));
      hemi.intensity = 0.12 * (0.4 + level * 0.6) * k.hemi;
    },
    setBeams(i) {
      beamBase = i;
      beamUniforms.uIntensity.value = beamBase * DRESS[dress].beams;
    },
    setDressing(d) {
      if (d === dress) return;
      dress = d;
      beams.geometry.dispose();
      beams.geometry = buildBeams(fixtures, count());
      rig.setLevel(level);
      rig.setBeams(beamBase);
    },
    litFixtures() {
      return pickBeams(fixtures, count());
    },
  };
  rig.setQuality(quality);
  return rig;
}

function beamCount(q: Quality): number {
  return q === 'high' ? 99 : q === 'medium' ? 14 : 6;
}

/** Spread a selection of `max` beams evenly over the fixture list. */
function pickBeams(fixtures: Fixture[], max: number): Fixture[] {
  const list = fixtures.filter((f) => f.beam);
  const stride = Math.max(1, list.length / Math.min(max, list.length));
  const out: Fixture[] = [];
  for (let s = 0; s < list.length; s += stride) out.push(list[Math.floor(s)]);
  return out;
}

function buildBeams(fixtures: Fixture[], max: number): THREE.BufferGeometry {
  const seg = 18;
  const pos: number[] = [];
  const nor: number[] = [];
  const along: number[] = [];
  const color: number[] = [];
  const idx: number[] = [];
  const down = new THREE.Vector3(0, -1, 0);
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (const f of pickBeams(fixtures, max)) {
    const dir = new THREE.Vector3().subVectors(f.target, f.pos);
    const len = dir.length() * 1.02;
    dir.normalize();
    q.setFromUnitVectors(down, dir);
    const r0 = 0.15;
    const r1 = Math.tan(f.angle) * len;
    const base = pos.length / 3;
    for (let j = 0; j <= 1; j++) {
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const r = j === 0 ? r0 : r1;
        p.set(Math.cos(a) * r, -j * len, Math.sin(a) * r).applyQuaternion(q).add(f.pos);
        n.set(Math.cos(a), (r1 - r0) / len, Math.sin(a)).normalize().applyQuaternion(q);
        pos.push(p.x, p.y, p.z);
        nor.push(n.x, n.y, n.z);
        along.push(j);
        color.push(f.color.r, f.color.g, f.color.b);
      }
    }
    for (let i = 0; i < seg; i++) {
      const a = base + i;
      const b = base + i + 1;
      const c = base + seg + 1 + i;
      const d = base + seg + 2 + i;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
  g.setAttribute('beamColor', new THREE.Float32BufferAttribute(color, 3));
  g.setIndex(idx);
  return g;
}
