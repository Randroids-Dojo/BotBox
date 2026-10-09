// Trophy: the Giant Nut on a riser in the center of the Box, the winning robot beside it,
// confetti falling and the crowd on its feet.

import * as THREE from 'three';
import type { BotFrame, BotSpec } from '../../contract';
import { COMPONENTS, FACETS } from '../../contract';
import { LEXAN_TOP } from '../../data/arena';
import { createBotView } from '../bots';
import { createNutTrophy } from '../props/nut';
import { Pose } from '../camera';
import type { BotView, Quality } from '../types';

const CONFETTI_VERT = /* glsl */ `
attribute vec4 iSeed;
attribute vec3 iColor;
uniform float uTime;
varying vec3 vColor;
varying float vShade;
mat3 rot(vec3 a) {
  float cx = cos(a.x), sx = sin(a.x), cy = cos(a.y), sy = sin(a.y), cz = cos(a.z), sz = sin(a.z);
  return mat3(cy * cz, cy * sz, -sy, sx * sy * cz - cx * sz, sx * sy * sz + cx * cz, sx * cy, cx * sy * cz + sx * sz, cx * sy * sz - sx * cz, cx * cy);
}
void main() {
  float fall = 0.55 + iSeed.w * 0.5;
  float h = ${LEXAN_TOP.toFixed(1)} - 0.1;
  float y = h - mod(uTime * fall + iSeed.z * h, h);
  vec3 c = vec3(iSeed.x, y, iSeed.y);
  c.x += sin(uTime * 1.3 + iSeed.z * 20.0) * 0.25;
  c.z += cos(uTime * 1.1 + iSeed.w * 20.0) * 0.25;
  vec3 a = vec3(uTime * (2.0 + iSeed.z * 4.0), uTime * (1.0 + iSeed.w * 3.0), iSeed.x * 6.0);
  mat3 r = rot(a);
  vec3 p = r * position;
  vShade = 0.35 + 0.65 * abs((r * vec3(0.0, 0.0, 1.0)).y);
  vColor = iColor;
  gl_Position = projectionMatrix * viewMatrix * vec4(c + p, 1.0);
}`;

const CONFETTI_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vShade;
void main() { gl_FragColor = vec4(vColor * vShade * 1.6, 1.0); }`;

export class TrophyScene {
  readonly root = new THREE.Group();
  readonly pose = new Pose();
  private nut: THREE.Object3D;
  private view: BotView | null = null;
  private confettiU = { uTime: { value: 0 } };
  private yaw = 0.5;
  private pitch = 0.22;
  private spots: THREE.SpotLight[] = [];
  private frame: BotFrame | null = null;

  constructor(private env: THREE.Texture, private quality: () => Quality) {
    this.root.name = 'trophy';
    // Riser.
    const riser = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.8, 0.24, 48), new THREE.MeshStandardMaterial({ color: '#0d0e10', roughness: 0.4, metalness: 0.6 }));
    riser.position.y = 0.12;
    riser.receiveShadow = true;
    riser.castShadow = true;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.03, 8, 64), new THREE.MeshStandardMaterial({ color: '#e8e8e8', metalness: 1, roughness: 0.15 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.24;
    const glow = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.02, 6, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 1.4, 0.1) }));
    glow.rotation.x = Math.PI / 2;
    glow.position.y = 0.05;
    this.root.add(riser, rim, glow);
    this.nut = createNutTrophy(env);
    this.nut.position.set(-0.35, 0.24, 0);
    this.nut.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.root.add(this.nut);
    // Two narrow spots on the Nut.
    for (const [x, z, c] of [
      [-4, 5, 0xfff2e0],
      [4, 4, 0xbfd4ff],
    ] as const) {
      const s = new THREE.SpotLight(c, 400, 20, 0.16, 0.4, 1.3);
      s.position.set(x, 4.8, z);
      s.target.position.set(-0.35, 0.8, 0);
      this.spots.push(s);
      this.root.add(s, s.target);
    }
    // Confetti.
    const n = 1400;
    const geo = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(0.035, 0.05);
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    const seed = new Float32Array(n * 4);
    const col = new Float32Array(n * 3);
    const palette = ['#ff6a00', '#2a7fff', '#ffd400', '#ffffff', '#e81e3a', '#c0c0c8'].map((c) => new THREE.Color(c).convertSRGBToLinear());
    for (let i = 0; i < n; i++) {
      const r = Math.sqrt(Math.random()) * 5.5;
      const a = Math.random() * Math.PI * 2;
      seed.set([Math.cos(a) * r, Math.sin(a) * r, Math.random(), Math.random()], i * 4);
      const c = palette[i % palette.length];
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(col, 3));
    geo.instanceCount = n;
    const confetti = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: CONFETTI_VERT, fragmentShader: CONFETTI_FRAG, uniforms: this.confettiU, side: THREE.DoubleSide }));
    confetti.frustumCulled = false;
    this.root.add(confetti);
  }

  setRobot(spec: BotSpec): void {
    if (this.view) {
      this.root.remove(this.view.root);
      this.view.dispose();
    }
    this.view = createBotView(spec, { envMap: this.env, quality: this.quality() });
    this.view.root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = true;
    });
    this.root.add(this.view.root);
    const yaw = -0.7;
    this.frame = restingFrame(spec, { x: 1.0, y: 0.24, z: 0.35 }, yaw);
    this.view.update(this.frame, 0);
  }

  orbit(dx: number, dy: number): void {
    this.yaw -= dx * 0.006;
    this.pitch = Math.max(0.02, Math.min(0.9, this.pitch + dy * 0.004));
  }

  update(time: number, dt: number): void {
    this.confettiU.uTime.value = time;
    this.yaw += dt * 0.08;
    const r = 4.6;
    this.pose.pos.set(Math.sin(this.yaw) * r * Math.cos(this.pitch), 0.9 + Math.sin(this.pitch) * r, Math.cos(this.yaw) * r * Math.cos(this.pitch));
    this.pose.target.set(0.2, 0.75, 0);
    this.pose.fov = 42;
    this.pose.roll = 0;
    if (this.view && this.frame) this.view.update(this.frame, dt);
  }
}

/** A healthy robot sitting on its wheels at `pos`. */
export function restingFrame(spec: BotSpec, pos: { x: number; y: number; z: number }, yaw: number): BotFrame {
  const half = yaw / 2;
  return {
    id: 'display',
    pos: { x: pos.x, y: pos.y + spec.groundClearance, z: pos.z },
    quat: { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) },
    vel: { x: 0, y: 0, z: 0 },
    angVel: { x: 0, y: 0, z: 0 },
    wheelSpin: spec.wheels.map(() => 0),
    wheelContact: spec.wheels.map(() => true),
    wheelLost: spec.wheels.map(() => false),
    driveL: 0,
    driveR: 0,
    weapon: { angle: spec.weapon.kind === 'flipper' || spec.weapon.kind === 'axe' || spec.weapon.kind === 'lifter' ? spec.weapon.restAngle : 0, rpm: 0, spin01: 0, armed: false, arm: 0, ready: true, shotsLeft: 0 },
    facets: Object.fromEntries(FACETS.map((f) => [f, 1])) as BotFrame['facets'],
    parts: Object.fromEntries(COMPONENTS.map((c) => [c, 1])) as BotFrame['parts'],
    charge: 1,
    smoke: 0,
    fire: 0,
    inverted: false,
    disabled: false,
    koCount: null,
    holdTime: null,
  };
}
