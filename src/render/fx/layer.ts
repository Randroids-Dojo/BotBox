// The fx layer: everything that flies, glows and drifts. Sparks (streaked HDR), impact flashes
// (point light pulse plus a glow sprite), shrapnel and bolts, dust and chips, grinding sparks,
// killsaw fountains, pulverizer slams, CO2 puffs, smoke from damaged robots rising to the Lexan
// ceiling, fire with embers and a flickering light, landing dust and floor scorch marks.
import * as THREE from 'three';
import type { ArmorMaterialId, BotFrame, Component, HitEvent, MatchEvent, WorldFrame } from '../../contract';
import { KILLSAWS, PULVERIZERS, RAMRODS } from '../../data/arena';
import { ARMOR } from '../../data/parts';
import type { BotView, FxLayer, Quality } from '../types';
import { ShrapnelSystem, type ShardKind } from './shrapnel';
import { SoftSystem } from './soft';
import { SparkSystem, mulberry } from './sparks';
import { flameTexture, scorchTexture, smokeTexture } from './textures';

interface Tier {
  sparks: number;
  smoke: number;
  glow: number;
  shards: number;
  lights: number;
  decals: number;
  /** Multiplier on emission counts. */
  k: number;
}

const TIERS: Record<Quality, Tier> = {
  high: { sparks: 5000, smoke: 900, glow: 500, shards: 90, lights: 3, decals: 48, k: 1 },
  medium: { sparks: 2600, smoke: 500, glow: 300, shards: 50, lights: 2, decals: 32, k: 0.6 },
  low: { sparks: 1000, smoke: 200, glow: 140, shards: 24, lights: 1, decals: 16, k: 0.32 },
};

const SHARD_COLOR: Record<ArmorMaterialId, string> = {
  aluminum: '#c5c9ce',
  titanium: '#8a929c',
  steel: '#5d6166',
  uhmw: '#efede6',
  polycarb: '#d4e8f0',
};

/** Spark behavior per armor material. */
const SPARK: Record<ArmorMaterialId, { heat: number; speed: [number, number]; life: [number, number]; size: number; spit: number }> = {
  titanium: { heat: 1.3, speed: [4, 16], life: [0.45, 1.3], size: 0.011, spit: 2.2 },
  steel: { heat: 0.95, speed: [3, 12], life: [0.3, 0.9], size: 0.012, spit: 0 },
  aluminum: { heat: 0.72, speed: [2, 8], life: [0.18, 0.55], size: 0.01, spit: 0 },
  uhmw: { heat: 0.6, speed: [2, 5], life: [0.1, 0.3], size: 0.008, spit: 0 },
  polycarb: { heat: 0.6, speed: [2, 5], life: [0.1, 0.3], size: 0.008, spit: 0 },
};

// ------------------------------------------------------------------------------------ lights

interface LightSlot {
  light: THREE.PointLight;
  kind: 'idle' | 'flash' | 'fire' | 'saw';
  t: number;
  peak: number;
  tau: number;
  owner: string;
}

class LightPool {
  slots: LightSlot[] = [];
  constructor(parent: THREE.Object3D, n: number) {
    for (let i = 0; i < n; i++) {
      const light = new THREE.PointLight('#ffd9a8', 0, 7, 2);
      light.castShadow = false;
      parent.add(light);
      this.slots.push({ light, kind: 'idle', t: 0, peak: 0, tau: 0.08, owner: '' });
    }
  }

  flash(p: THREE.Vector3Like, peak: number, color: THREE.ColorRepresentation, tau = 0.07): void {
    // Steal the weakest slot (flashes beat fires for a moment).
    let best: LightSlot | null = null;
    let bestI = Infinity;
    for (const s of this.slots) {
      const cur = s.kind === 'idle' ? -1 : s.light.intensity;
      if (cur < bestI) {
        bestI = cur;
        best = s;
      }
    }
    if (!best || (best.kind === 'flash' && best.light.intensity > peak)) return;
    best.kind = 'flash';
    best.t = 0;
    best.peak = peak;
    best.tau = tau;
    best.owner = '';
    best.light.position.set(p.x, p.y, p.z);
    best.light.color.set(color);
  }

  /** Keep a flickering light on a fire (or saw) this frame. */
  sustain(owner: string, kind: 'fire' | 'saw', p: THREE.Vector3Like, intensity: number, color: THREE.ColorRepresentation): void {
    let s = this.slots.find((x) => x.owner === owner && x.kind === kind);
    if (!s) s = this.slots.find((x) => x.kind === 'idle');
    if (!s) return;
    s.kind = kind;
    s.owner = owner;
    s.t = 0;
    s.light.position.set(p.x, p.y, p.z);
    s.light.color.set(color);
    s.light.intensity = intensity;
  }

  update(dt: number): void {
    for (const s of this.slots) {
      s.t += dt;
      if (s.kind === 'flash') {
        s.light.intensity = s.peak * Math.exp(-s.t / s.tau);
        if (s.t > s.tau * 6) this.idle(s);
      } else if (s.kind === 'fire' || s.kind === 'saw') {
        // Not sustained this frame: let it go.
        if (s.t > 0.1) this.idle(s);
      }
    }
  }

  idle(s: LightSlot): void {
    s.kind = 'idle';
    s.owner = '';
    s.light.intensity = 0;
  }

  clear(): void {
    for (const s of this.slots) this.idle(s);
  }
}

// ------------------------------------------------------------------------------------ decals

const DECAL_VERT = /* glsl */ `
varying vec2 vUv;
varying float vAlpha;
void main() {
  vUv = uv;
  // Per-decal opacity rides in the instance color.
  vAlpha = instanceColor.r;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const DECAL_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vec4 t = texture2D(uMap, vUv);
  gl_FragColor = vec4(t.rgb, t.a * vAlpha);
  #include <colorspace_fragment>
}
`;

class Decals {
  readonly mesh: THREE.InstancedMesh;
  private next = 0;
  private c = new THREE.Color();
  private used = 0;
  private m = new THREE.Matrix4();
  constructor(private cap: number) {
    const g = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      vertexShader: DECAL_VERT,
      fragmentShader: DECAL_FRAG,
      uniforms: { uMap: { value: scorchTexture() } },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.InstancedMesh(g, mat, cap);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }
  add(x: number, z: number, size: number, alpha: number, rot: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    this.used = Math.min(this.cap, this.used + 1);
    this.m.compose(new THREE.Vector3(x, 0.003, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(size, 1, size));
    this.mesh.setMatrixAt(i, this.m);
    this.mesh.setColorAt(i, this.c.setRGB(alpha, 0, 0));
    this.mesh.instanceColor!.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.count = this.used;
  }
  clear(): void {
    this.used = 0;
    this.next = 0;
    this.mesh.count = 0;
  }
  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

// ------------------------------------------------------------------------------------ layer

interface Fountain {
  x: number;
  z: number;
  len: number;
  until: number;
  id: string;
  rate: number;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

export class Fx implements FxLayer {
  readonly root = new THREE.Group();
  private tier: Tier;
  private sparks: SparkSystem;
  private smoke: SoftSystem;
  private glow: SoftSystem;
  private shards: ShrapnelSystem;
  private lights: LightPool;
  private decals: Decals;
  private rnd = mulberry(777);
  private t = 0;
  private queued: MatchEvent[] = [];
  private fountains: Fountain[] = [];
  private pendingSlams: { id: string; at: number }[] = [];
  private lastSlam = new Map<string, number>();
  private hazardState = new Map<string, number>();
  private smokeAcc = new Map<string, number>();
  private fireAcc = new Map<string, number>();
  private emberAcc = new Map<string, number>();
  private scorchAcc = new Map<string, number>();
  private grindAcc = 0;

  constructor(quality: Quality) {
    this.tier = TIERS[quality];
    this.root.name = 'fx';
    this.sparks = new SparkSystem(this.tier.sparks);
    this.smoke = new SoftSystem(this.tier.smoke, smokeTexture(), false);
    this.smoke.turbulence = 0.9;
    this.glow = new SoftSystem(this.tier.glow, flameTexture(), true);
    this.shards = new ShrapnelSystem(this.tier.shards);
    this.shards.trail = (x, y, z, vx, vy, vz) =>
      this.sparks.emit({ x, y, z, dx: vx, dy: vy, dz: vz, count: 1, speed: [0.2, 1], spread: 0.8, heat: 0.85, life: [0.12, 0.3], size: 0.007, drag: 2 });
    this.lights = new LightPool(this.root, this.tier.lights);
    this.decals = new Decals(this.tier.decals);
    this.root.add(this.decals.mesh, this.shards.root, this.smoke.mesh, this.sparks.mesh, this.glow.mesh);
  }

  // ---------------------------------------------------------------------------------- events

  event(e: MatchEvent, world: WorldFrame): void {
    switch (e.type) {
      case 'hit':
        this.hit(e);
        break;
      case 'grind':
        this.grind(e.point, e.dir, e.intensity, e.material);
        break;
      case 'shrapnel':
        this.shrapnel(e.point, e.dir, e.count, e.material);
        break;
      case 'hazard':
        if (e.action === 'strike') this.hazardStrike(e.hazard, e.kind, e.target !== null);
        break;
      case 'landed': {
        const b = world.bots.find((x) => x.id === e.bot);
        if (b) this.dustRing(b.pos.x, b.pos.z, Math.min(1, e.speed / 6), 0.8);
        if (b && e.speed > 3.5) this.sparks.emit({ x: b.pos.x, y: 0.02, z: b.pos.z, dx: 0, dy: 1, dz: 0, count: Math.round(14 * this.tier.k), speed: [1.5, 5], spread: 1.3, heat: 0.85, life: [0.15, 0.45], size: 0.01 });
        break;
      }
      case 'panel_off':
      case 'wheel_off':
      case 'weapon_fire':
      case 'component_down':
      case 'fire_start':
      case 'smoke_start':
        // Need the robot's view for positions: handled on the next update.
        this.queued.push(e);
        break;
      default:
        break;
    }
  }

  private hit(e: HitEvent): void {
    const mat = e.material;
    const e01 = THREE.MathUtils.clamp(Math.log10(Math.max(1, e.energy)) / 4.3, 0, 1);
    const big = THREE.MathUtils.clamp(e.energy / 12000, 0, 1);
    const sp = SPARK[mat];
    const factor = ARMOR[mat].sparks;
    const k = this.tier.k;
    const p = e.point;
    // Spray mostly along the push and up, like a tooth dragging across plate.
    const dx = e.dir.x * 0.8;
    const dy = Math.max(0.35, e.dir.y) + 0.4;
    const dz = e.dir.z * 0.8;
    const kindBoost = e.kind === 'spinner' ? 1.2 : e.kind === 'killsaw' || e.kind === 'pulverizer' ? 1.4 : e.kind === 'wall' || e.kind === 'floor' ? 0.5 : e.kind === 'flip' || e.kind === 'lift' ? 0.35 : 0.8;
    if (factor > 0) {
      const n = Math.round(THREE.MathUtils.clamp(e.energy / 45, 8, 200) * factor * kindBoost * k);
      this.sparks.emit({ x: p.x, y: p.y, z: p.z, dx, dy, dz, count: n, speed: [sp.speed[0], sp.speed[1] * (0.6 + 0.6 * e01)], spread: 0.95, heat: sp.heat, life: sp.life, size: sp.size, spit: sp.spit });
      // A tight hot core shooting straight out.
      this.sparks.emit({ x: p.x, y: p.y, z: p.z, dx: e.dir.x, dy: e.dir.y + 0.3, dz: e.dir.z, count: Math.round(n * 0.25), speed: [sp.speed[1] * 0.6, sp.speed[1] * 1.1], spread: 0.25, heat: sp.heat * 1.1, life: [0.12, 0.35], size: sp.size * 0.8 });
    } else {
      // Plastic: chips and a puff of shavings, no sparks.
      const chips = Math.round(THREE.MathUtils.clamp(e.energy / 500, 2, 14) * Math.max(0.5, k));
      for (let i = 0; i < chips; i++) {
        const r = this.rnd;
        this.shards.spawn('chip', p.x, p.y, p.z, dx * 3 + (r() - 0.5) * 4, 1.5 + r() * 3, dz * 3 + (r() - 0.5) * 4, 0.012 + 0.02 * r(), SHARD_COLOR[mat]);
      }
      this.puff(p.x, p.y, p.z, 4, [0.85, 0.85, 0.83], 0.3, 0.15, 0.5, 1.2);
    }
    // Flash: light pulse and a glow sprite.
    if (e.energy > 150) {
      const col = mat === 'titanium' ? '#e9f0ff' : '#ffcf8a';
      this.lights.flash({ x: p.x, y: p.y + 0.35, z: p.z }, (15 + 110 * e01 * e01) * (factor > 0 ? 1 : 0.4), col, 0.05 + 0.05 * big);
      const g = factor > 0 ? 1 : 0.35;
      this.glow.emit({ x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0, life: 0.09 + 0.06 * big, size0: 0.06 + 0.16 * e01, size1: 0.12 + 0.32 * e01, c0: [5 * g, 4.2 * g, 3.2 * g], c1: [2 * g, 0.8 * g, 0.2 * g], alpha: 1, cell: 3, rot: 0, spin: 0, fadeIn: 0.01 });
    }
    // Big hits kick dust off the floor and leave a mark.
    if (e.energy > 5000 && p.y < 0.6) {
      this.dustRing(p.x, p.z, big * 0.5, 0.45);
      if (factor > 0) this.decals.add(p.x + e.dir.x * 0.2, p.z + e.dir.z * 0.2, 0.25 + 0.4 * big, 0.5, this.rnd() * 6);
    }
  }

  private grind(p: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, intensity: number, mat: ArmorMaterialId): void {
    const sp = SPARK[mat];
    const factor = Math.max(0.35, ARMOR[mat].sparks);
    const n = Math.round((4 + 14 * intensity) * factor * this.tier.k);
    this.sparks.emit({ x: p.x, y: p.y, z: p.z, dx: dir.x, dy: Math.max(0.25, dir.y) + 0.35, dz: dir.z, count: n, speed: [2, 6 + 4 * intensity], spread: 0.6, heat: Math.max(0.85, sp.heat * 0.95), life: [0.15, 0.5], size: 0.009, spit: sp.spit * 0.5 });
    this.grindAcc += intensity * 0.05;
    if (this.grindAcc > 1) {
      this.grindAcc = 0;
      this.decals.add(p.x, p.z, 0.15, 0.3, this.rnd() * 6);
    }
  }

  private shrapnel(p: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, count: number, mat: ArmorMaterialId): void {
    const r = this.rnd;
    const n = Math.max(1, Math.round(count * Math.max(0.5, this.tier.k)));
    const plastic = mat === 'uhmw' || mat === 'polycarb';
    for (let i = 0; i < n; i++) {
      const kind: ShardKind = plastic ? 'chip' : r() < 0.25 ? 'bolt' : r() < 0.7 ? 'shard' : 'chunk';
      const speed = 2.5 + r() * 6;
      const vx = (dir.x + (r() - 0.5) * 1.2) * speed;
      const vy = (Math.max(0.3, dir.y) + r() * 0.9) * speed;
      const vz = (dir.z + (r() - 0.5) * 1.2) * speed;
      const size = kind === 'bolt' ? 0.022 : kind === 'chunk' ? 0.025 + r() * 0.02 : 0.03 + r() * 0.04;
      this.shards.spawn(kind, p.x, p.y, p.z, vx, vy, vz, size, kind === 'bolt' ? '#8f8c84' : SHARD_COLOR[mat], plastic ? 0 : 1);
    }
  }

  private hazardStrike(id: string, kind: string, target: boolean): void {
    if (kind === 'killsaw') {
      const k = KILLSAWS.find((x) => x.id === id);
      if (k) this.fountains.push({ x: k.center.x, z: k.center.z, len: k.length, until: this.t + (target ? 1.4 : 1.0), id, rate: target ? 1 : 0.6 });
    } else if (kind === 'pulverizer') {
      // The hammer lands a moment after the strike starts; hazard frames refine it when present.
      this.pendingSlams.push({ id, at: this.t + 0.22 });
    } else if (kind === 'ramrod') {
      const r = RAMRODS.find((x) => x.id === id);
      if (r) for (let i = 0; i < 6; i++) this.puff(r.center.x + (this.rnd() - 0.5) * r.hx * 2, 0.05, r.center.z + (this.rnd() - 0.5) * r.hz * 2, 1, [0.3, 0.28, 0.26], 0.35, 0.2, 0.6, 1.0);
    }
  }

  private slam(id: string): void {
    const last = this.lastSlam.get(id) ?? -10;
    if (this.t - last < 0.6) return;
    this.lastSlam.set(id, this.t);
    const p = PULVERIZERS.find((x) => x.id === id);
    if (!p) return;
    const c = p.center;
    const r = this.rnd;
    this.dustRing(c.x, c.z, 0.8, 1.2);
    this.sparks.emit({ x: c.x, y: 0.05, z: c.z, dx: 0, dy: 0.5, dz: 0, count: Math.round(160 * this.tier.k), speed: [3, 11], spread: 1.45, heat: 1.0, life: [0.25, 0.9], size: 0.012 });
    this.lights.flash({ x: c.x, y: 0.6, z: c.z }, 140, '#ffd8a0', 0.09);
    this.glow.emit({ x: c.x, y: 0.15, z: c.z, vx: 0, vy: 0, vz: 0, life: 0.12, size0: 0.3, size1: 0.7, c0: [5, 4, 3], c1: [2, 0.8, 0.2], alpha: 1, cell: 3, rot: 0, spin: 0, fadeIn: 0.01 });
    for (let i = 0; i < Math.round(8 * Math.max(0.5, this.tier.k)); i++) {
      const a = r() * Math.PI * 2;
      const sp = 2 + r() * 4;
      this.shards.spawn(r() < 0.5 ? 'chunk' : 'shard', c.x, 0.08, c.z, Math.cos(a) * sp, 2 + r() * 3, Math.sin(a) * sp, 0.02 + r() * 0.02, '#4c4f53', 1);
    }
    this.decals.add(c.x, c.z, 1.0, 0.55, r() * 6);
  }

  private dustRing(x: number, z: number, strength: number, radius: number): void {
    const r = this.rnd;
    const n = Math.round((4 + 10 * strength) * Math.max(0.45, this.tier.k));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.3;
      const sp = (1.2 + r() * 1.8) * (0.6 + strength) * radius;
      this.smoke.emit({
        x: x + Math.cos(a) * 0.15,
        y: 0.06 + r() * 0.05,
        z: z + Math.sin(a) * 0.15,
        vx: Math.cos(a) * sp,
        vy: 0.2 + r() * 0.5,
        vz: Math.sin(a) * sp,
        life: 1.2 + r() * 1.2,
        size0: 0.12 + 0.1 * strength,
        size1: 0.6 + 0.6 * strength * radius,
        c0: [0.42, 0.4, 0.37],
        c1: [0.3, 0.29, 0.28],
        alpha: 0.14 + 0.16 * strength,
        buoy: 0.05,
        drag: 2.5,
        shade: 0.3,
        ground: true,
      });
    }
  }

  private puff(x: number, y: number, z: number, n: number, c: [number, number, number], alpha: number, s0: number, s1: number, life: number): void {
    const r = this.rnd;
    for (let i = 0; i < n; i++) {
      this.smoke.emit({ x: x + (r() - 0.5) * 0.08, y: y + (r() - 0.5) * 0.05, z: z + (r() - 0.5) * 0.08, vx: (r() - 0.5) * 0.8, vy: 0.2 + r() * 0.5, vz: (r() - 0.5) * 0.8, life: life * (0.7 + 0.6 * r()), size0: s0, size1: s1, c0: c, c1: c, alpha, buoy: 0.2, drag: 1.5 });
    }
  }

  // ---------------------------------------------------------------------------------- update

  update(world: WorldFrame, dt: number, _camera: THREE.Camera, bots: (id: string) => BotView | undefined): void {
    this.t += dt;
    for (const e of this.queued) this.viewEvent(e, world, bots);
    this.queued.length = 0;

    // Hazards from frames: pulverizer impacts and killsaw blades.
    for (const h of world.hazards) {
      const prev = this.hazardState.get(h.id) ?? 0;
      this.hazardState.set(h.id, h.state);
      if (h.kind === 'pulverizer' && prev < 0.95 && h.state >= 0.95) this.slam(h.id);
      if (h.kind === 'killsaw' && h.state > 0.2) {
        const k = KILLSAWS.find((x) => x.id === h.id);
        if (k && !this.fountains.some((f) => f.id === h.id && f.until > this.t)) this.sawSparks(k.center.x, k.center.z, k.length, 0.25 * h.state, dt, h.id);
      }
    }
    for (let i = this.pendingSlams.length - 1; i >= 0; i--) {
      if (this.t >= this.pendingSlams[i].at) {
        this.slam(this.pendingSlams[i].id);
        this.pendingSlams.splice(i, 1);
      }
    }
    for (let i = this.fountains.length - 1; i >= 0; i--) {
      const f = this.fountains[i];
      if (this.t > f.until) {
        this.fountains.splice(i, 1);
        continue;
      }
      this.sawSparks(f.x, f.z, f.len, f.rate, dt, f.id);
    }

    // Robots: smoke and fire.
    for (const b of world.bots) this.botEffects(b, dt, bots(b.id));

    this.lights.update(dt);
    this.sparks.update(dt);
    this.smoke.update(dt);
    this.glow.update(dt);
    this.shards.update(dt);
  }

  private sawSparks(x: number, z: number, len: number, rate: number, dt: number, id: string): void {
    const r = this.rnd;
    const n = Math.max(1, Math.round(rate * 900 * dt * this.tier.k));
    const dirZ = r() < 0.5 ? 1 : -1;
    const batches = Math.min(4, n);
    for (let i = 0; i < batches; i++) {
      const pz = z + (r() - 0.5) * len * 0.6;
      this.sparks.emit({ x: x + (r() - 0.5) * 0.04, y: 0.06, z: pz, dx: (r() - 0.5) * 0.2, dy: 1, dz: dirZ * 0.7, count: Math.ceil(n / batches), speed: [3, 10], spread: 0.35, heat: 1.05, life: [0.25, 0.8], size: 0.011 });
    }
    if (r() < dt * 12 * rate) this.glow.emit({ x, y: 0.08, z, vx: 0, vy: 0, vz: 0, life: 0.08, size0: 0.12, size1: 0.22, c0: [3, 1.8, 0.6], c1: [1, 0.3, 0.05], alpha: 1, cell: 3, rot: 0, spin: 0, fadeIn: 0.01 });
    this.lights.sustain(`saw:${id}`, 'saw', { x, y: 0.35, z }, 25 + 30 * rate * (0.6 + 0.4 * r()), '#ffb060');
  }

  private viewEvent(e: MatchEvent, world: WorldFrame, bots: (id: string) => BotView | undefined): void {
    if (!('bot' in e)) return;
    const view = bots(e.bot);
    const frame = world.bots.find((b) => b.id === e.bot);
    if (!view) return;
    const spec = view.spec;
    const r = this.rnd;
    view.root.updateMatrixWorld();
    view.root.getWorldQuaternion(_q);
    switch (e.type) {
      case 'panel_off': {
        const idx = spec.panels.findIndex((p) => p.facet === e.facet);
        const p = spec.panels[idx];
        if (!p) return;
        view.root.localToWorld(_v.set(p.center.x, p.center.y, p.center.z));
        _w.set(0, 0, 1).applyQuaternion(new THREE.Quaternion(p.rot.x, p.rot.y, p.rot.z, p.rot.w)).applyQuaternion(_q);
        // Bolts pop out of their holes.
        const n = Math.round(6 * Math.max(0.5, this.tier.k));
        for (let i = 0; i < n; i++) {
          const sp = 2 + r() * 3;
          this.shards.spawn('bolt', _v.x + (r() - 0.5) * p.w * 0.6, _v.y, _v.z + (r() - 0.5) * p.h * 0.4, _w.x * sp + (r() - 0.5) * 2, 2 + r() * 3, _w.z * sp + (r() - 0.5) * 2, 0.02, '#8f8c84', 1);
        }
        this.sparks.emit({ x: _v.x, y: _v.y, z: _v.z, dx: _w.x, dy: _w.y + 0.5, dz: _w.z, count: Math.round(40 * this.tier.k), speed: [2, 8], spread: 1.0, heat: 0.95, life: [0.2, 0.6], size: 0.01 });
        break;
      }
      case 'wheel_off': {
        const w = spec.wheels[e.index];
        if (!w) return;
        view.root.localToWorld(_v.set(w.pos.x, w.pos.y, w.pos.z));
        this.sparks.emit({ x: _v.x, y: _v.y, z: _v.z, dx: w.side, dy: 0.6, dz: 0, count: Math.round(50 * this.tier.k), speed: [2, 9], spread: 1.1, heat: 1, life: [0.2, 0.7], size: 0.011 });
        for (let i = 0; i < 4; i++) this.shards.spawn(i % 2 ? 'chunk' : 'bolt', _v.x, _v.y, _v.z, (r() - 0.5) * 4, 2 + r() * 3, (r() - 0.5) * 4, 0.022, '#77736c', 1);
        this.puff(_v.x, 0.05, _v.z, 4, [0.18, 0.18, 0.18], 0.4, 0.1, 0.5, 1.2);
        break;
      }
      case 'weapon_fire': {
        // CO2 vents with a white blast; electric lifters just whir.
        if (e.kind === 'lifter') return;
        const L = spec.length;
        const local =
          e.kind === 'flipper'
            ? _v.set(0, spec.height * 0.25, -L * 0.3)
            : e.kind === 'axe'
              ? _v.set(0, spec.height + 0.04, L * 0.25)
              : _v.set(0, spec.height + 0.03, L * 0.3);
        view.root.localToWorld(local);
        const out = _w.set(0, 0.6, e.kind === 'flipper' ? -0.6 : 0.6).applyQuaternion(_q);
        for (let i = 0; i < Math.round(10 * Math.max(0.5, this.tier.k)); i++) {
          const sp = 1.5 + r() * 2.5;
          this.smoke.emit({
            x: local.x,
            y: local.y,
            z: local.z,
            vx: (out.x + (r() - 0.5) * 1.4) * sp,
            vy: (out.y + r() * 0.6) * sp,
            vz: (out.z + (r() - 0.5) * 1.4) * sp,
            life: 0.5 + r() * 0.5,
            size0: 0.08,
            size1: 0.45 + r() * 0.3,
            c0: [0.95, 0.96, 0.98],
            c1: [0.85, 0.86, 0.88],
            alpha: 0.5,
            buoy: -0.2,
            drag: 4.5,
            shade: 0.15,
            fadeIn: 0.03,
          });
        }
        break;
      }
      case 'component_down': {
        view.componentWorld(e.component, _v);
        this.sparks.emit({ x: _v.x, y: _v.y, z: _v.z, dx: 0, dy: 1, dz: 0, count: Math.round(30 * this.tier.k), speed: [1, 5], spread: 1.2, heat: 1.0, life: [0.1, 0.4], size: 0.008 });
        this.puff(_v.x, _v.y + 0.1, _v.z, 5, [0.2, 0.2, 0.21], 0.5, 0.12, 0.6, 1.6);
        this.lights.flash(_v, 60, '#bcd4ff', 0.04);
        break;
      }
      case 'fire_start': {
        view.componentWorld('battery', _v);
        _v.y += spec.height * 0.5;
        for (let i = 0; i < 14; i++) this.flame(_v.x, _v.y, _v.z, 1.6);
        this.lights.flash(_v, 160, '#ff9a40', 0.25);
        break;
      }
      case 'smoke_start': {
        const c = frame ? worstComponent(frame) : 'electronics';
        view.componentWorld(c, _v);
        this.puff(_v.x, _v.y + spec.height * 0.4, _v.z, 6, [0.25, 0.25, 0.26], 0.5, 0.15, 0.9, 2.2);
        break;
      }
    }
  }

  private flame(x: number, y: number, z: number, big = 1): void {
    const r = this.rnd;
    this.glow.emit({
      x: x + (r() - 0.5) * 0.14,
      y: y + r() * 0.03,
      z: z + (r() - 0.5) * 0.14,
      vx: (r() - 0.5) * 0.2,
      vy: 0.8 + r() * 0.8,
      vz: (r() - 0.5) * 0.2,
      life: (0.28 + r() * 0.3) * big,
      size0: (0.07 + r() * 0.05) * big,
      size1: (0.14 + r() * 0.1) * big,
      c0: [2.6, 1.0, 0.2],
      c1: [0.9, 0.12, 0.02],
      alpha: 0.75,
      buoy: 1.2,
      drag: 1.2,
      rot: (r() - 0.5) * 0.4,
      spin: (r() - 0.5) * 0.6,
      cell: Math.floor(r() * 3),
      fadeIn: 0.08,
    });
  }

  private botEffects(b: BotFrame, dt: number, view: BotView | undefined): void {
    if (!view) return;
    const r = this.rnd;
    const k = this.tier.k;
    if (b.smoke > 0.02) {
      const acc = (this.smokeAcc.get(b.id) ?? 0) + dt * b.smoke * 16 * Math.max(0.4, k);
      let n = Math.floor(acc);
      this.smokeAcc.set(b.id, acc - n);
      while (n-- > 0) {
        const c = r() < 0.7 ? worstComponent(b) : pick(r, ['driveL', 'driveR', 'electronics', 'weapon', 'battery'] as Component[]);
        view.componentWorld(c, _v);
        const battery = c === 'battery' || b.fire > 0.05;
        const gray = c === 'electronics' ? [0.26, 0.27, 0.3] : [0.34, 0.33, 0.32];
        const col: [number, number, number] = battery ? [0.035, 0.032, 0.03] : (gray as [number, number, number]);
        const top = view.spec.height * 0.6;
        this.smoke.emit({
          x: _v.x + (r() - 0.5) * 0.1,
          y: _v.y + top,
          z: _v.z + (r() - 0.5) * 0.1,
          vx: b.vel.x * 0.3 + (r() - 0.5) * 0.3,
          vy: 0.4 + r() * 0.5,
          vz: b.vel.z * 0.3 + (r() - 0.5) * 0.3,
          life: 3 + r() * 2.5,
          size0: 0.08 + r() * 0.06,
          size1: (battery ? 1.0 : 0.75) + r() * 0.6,
          c0: col,
          c1: battery ? [0.08, 0.08, 0.08] : [0.38, 0.38, 0.39],
          alpha: (battery ? 0.7 : 0.5) * (0.6 + 0.5 * r()),
          buoy: battery ? 0.5 : 0.3,
          drag: 0.5,
          shade: 0.45,
          fadeIn: 0.08,
        });
      }
    }
    if (b.fire > 0.02) {
      view.componentWorld('battery', _v);
      _v.addScaledVector(UP, view.spec.height * 0.45);
      const acc = (this.fireAcc.get(b.id) ?? 0) + dt * b.fire * 40 * Math.max(0.45, k);
      let n = Math.floor(acc);
      this.fireAcc.set(b.id, acc - n);
      while (n-- > 0) this.flame(_v.x, _v.y, _v.z, 0.8 + b.fire * 0.5);
      const eacc = (this.emberAcc.get(b.id) ?? 0) + dt * b.fire * 14 * k;
      const ne = Math.floor(eacc);
      this.emberAcc.set(b.id, eacc - ne);
      if (ne > 0) this.sparks.emit({ x: _v.x, y: _v.y + 0.1, z: _v.z, dx: 0, dy: 1, dz: 0, count: ne, speed: [0.5, 1.8], spread: 0.7, heat: 0.75, life: [0.8, 1.8], size: 0.006, gravity: -0.12, drag: 1.2 });
      // Thick black smoke over the flames.
      if (r() < dt * 10 * b.fire)
        this.smoke.emit({ x: _v.x, y: _v.y + 0.25, z: _v.z, vx: (r() - 0.5) * 0.3, vy: 0.7, vz: (r() - 0.5) * 0.3, life: 4, size0: 0.2, size1: 1.5, c0: [0.03, 0.028, 0.026], c1: [0.07, 0.07, 0.07], alpha: 0.65, buoy: 0.6, drag: 0.4, shade: 0.5 });
      const flick = 0.75 + 0.25 * Math.sin(this.t * 31 + b.id.length) * Math.sin(this.t * 17.3) + (r() - 0.5) * 0.2;
      this.lights.sustain(`fire:${b.id}`, 'fire', { x: _v.x, y: _v.y + 0.35, z: _v.z }, 16 * b.fire * flick, '#ff7a28');
      // Scorch under a burning robot.
      const sacc = (this.scorchAcc.get(b.id) ?? 0) + dt;
      if (sacc > 1.5) {
        this.scorchAcc.set(b.id, 0);
        this.decals.add(b.pos.x + (r() - 0.5) * 0.3, b.pos.z + (r() - 0.5) * 0.3, 0.5 + r() * 0.3, 0.35, r() * 6);
      } else this.scorchAcc.set(b.id, sacc);
    }
  }

  clear(): void {
    this.sparks.clear();
    this.smoke.clear();
    this.glow.clear();
    this.shards.clear();
    this.lights.clear();
    this.decals.clear();
    this.fountains.length = 0;
    this.pendingSlams.length = 0;
    this.queued.length = 0;
    this.hazardState.clear();
    this.lastSlam.clear();
  }

  dispose(): void {
    this.clear();
    this.sparks.dispose();
    this.smoke.dispose();
    this.glow.dispose();
    this.shards.dispose();
    this.decals.dispose();
    this.root.removeFromParent();
  }

  /** Live particle counts, for the lab. */
  stats(): { sparks: number; smoke: number; glow: number } {
    return { sparks: this.sparks.count, smoke: this.smoke.count, glow: this.glow.count };
  }
}

function worstComponent(b: BotFrame): Component {
  let worst: Component = 'electronics';
  let v = Infinity;
  for (const c of ['driveL', 'driveR', 'weapon', 'battery', 'electronics'] as Component[]) {
    if (b.parts[c] < v) {
      v = b.parts[c];
      worst = c;
    }
  }
  return worst;
}

function pick<T>(r: () => number, xs: T[]): T {
  return xs[Math.floor(r() * xs.length) % xs.length];
}
