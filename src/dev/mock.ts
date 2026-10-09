// A scripted stand-in for the real simulation so the renderer, audio and UI can be built and
// tested before (and independently of) src/sim. It produces plausible WorldFrames and events:
// robots circling and colliding, spinners spinning, arms firing, damage piling up, panels flying
// off, hazards cycling, a countdown and a clock. Not physics.

import {
  COMPONENTS,
  FACETS,
  type BotFrame,
  type BotSpec,
  type DebrisFrame,
  type Facet,
  type HazardFrame,
  type HitKind,
  type MatchEvent,
  type Quat,
  type Vec3,
  type WorldFrame,
} from '../contract';
import { KILLSAWS, PULVERIZERS, RAMRODS, SPIKESTRIPS } from '../data/arena';
import { ARMOR } from '../data/parts';

function yawQuat(yaw: number, roll = 0, pitch = 0): Quat {
  // yaw about Y, then pitch about X, then roll about Z (intrinsic).
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
  const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  const cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
  return {
    w: cy * cp * cr + sy * sp * sr,
    x: cy * sp * cr + sy * cp * sr,
    y: sy * cp * cr - cy * sp * sr,
    z: cy * cp * sr - sy * sp * cr,
  };
}

class Rng {
  constructor(private s: number) {}
  next(): number {
    this.s = (this.s * 1664525 + 1013904223) >>> 0;
    return this.s / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.next() * xs.length)];
  }
}

interface MockBot {
  id: string;
  spec: BotSpec;
  phase: number;
  radius: number;
  speed: number;
  pos: Vec3;
  yaw: number;
  wheelSpin: number;
  weaponAngle: number;
  spin01: number;
  arm: number;
  armTimer: number;
  facets: Record<Facet, number>;
  parts: Record<(typeof COMPONENTS)[number], number>;
  airborne: number;
  roll: number;
  inverted: boolean;
}

interface MockDebris extends DebrisFrame {
  vel: Vec3;
  spinRate: number;
  age: number;
}

export interface MockOptions {
  seed?: number;
  /** Seconds of countdown before the fight. 0 starts in the fight. */
  countdown?: number;
  /** Fight length. */
  length?: number;
  /** How often robots meet, seconds. */
  clashEvery?: number;
}

export class MockWorld {
  t = 0;
  private rng: Rng;
  private bots: MockBot[];
  private debris: MockDebris[] = [];
  private nextDebris = 1;
  private clashTimer: number;
  private hazards: HazardFrame[];
  private hazardTimers = new Map<string, number>();
  private countdown: number;
  private clock: number;
  private lights: 0 | 1 | 2 | 3 | 4 = 0;
  private koFor: string | null = null;
  private koCount = 0;

  constructor(specs: { id: string; spec: BotSpec }[], private opts: MockOptions = {}) {
    this.rng = new Rng(opts.seed ?? 7);
    this.countdown = opts.countdown ?? 4;
    this.clock = opts.length ?? 180;
    this.clashTimer = opts.clashEvery ?? 2.5;
    this.bots = specs.map((s, i) => ({
      id: s.id,
      spec: s.spec,
      phase: (i / specs.length) * Math.PI * 2,
      radius: 3.2 + i * 0.6,
      speed: 0.45 + i * 0.07,
      pos: { x: 0, y: 0, z: 0 },
      yaw: 0,
      wheelSpin: 0,
      weaponAngle: 0,
      spin01: 0,
      arm: 0,
      armTimer: 1 + i,
      facets: Object.fromEntries(FACETS.map((f) => [f, 1])) as Record<Facet, number>,
      parts: Object.fromEntries(COMPONENTS.map((c) => [c, 1])) as MockBot['parts'],
      airborne: 0,
      roll: 0,
      inverted: false,
    }));
    this.hazards = [
      ...PULVERIZERS.map((p) => ({ id: p.id, kind: 'pulverizer' as const, state: 0, spin: 0, warn: false })),
      ...KILLSAWS.map((k) => ({ id: k.id, kind: 'killsaw' as const, state: 0, spin: 0, warn: false })),
      ...RAMRODS.map((r) => ({ id: r.id, kind: 'ramrod' as const, state: 0, spin: 0, warn: false })),
      ...SPIKESTRIPS.map((s) => ({ id: s.id, kind: 'spikestrip' as const, state: 1, spin: 0, warn: false })),
    ];
    for (const h of this.hazards) this.hazardTimers.set(h.id, this.rng.range(1, 6));
  }

  step(dt: number): { frame: WorldFrame; events: MatchEvent[] } {
    const ev: MatchEvent[] = [];
    this.t += dt;
    let phase: WorldFrame['match']['phase'] = 'fight';
    if (this.countdown > 0) {
      phase = 'countdown';
      const before = this.countdown;
      this.countdown -= dt;
      const lit = (n: number) => before > n && this.countdown <= n;
      if (lit(3)) this.light(1, ev);
      if (lit(2)) this.light(2, ev);
      if (lit(1)) this.light(3, ev);
      if (this.countdown <= 0) {
        this.light(4, ev);
        ev.push({ type: 'fight_start', t: this.t });
      }
    } else {
      const before = Math.ceil(this.clock);
      this.clock = Math.max(0, this.clock - dt);
      if (Math.ceil(this.clock) !== before) ev.push({ type: 'clock', t: this.t, remaining: Math.ceil(this.clock) });
      if (this.clock <= 0) phase = 'over';
    }
    const fighting = phase === 'fight';

    for (const b of this.bots) this.moveBot(b, dt, fighting, ev);
    if (fighting) {
      this.clashTimer -= dt;
      if (this.clashTimer <= 0 && this.bots.length >= 2) {
        this.clashTimer = (this.opts.clashEvery ?? 2.5) * this.rng.range(0.6, 1.4);
        const a = this.rng.pick(this.bots);
        const v = this.rng.pick(this.bots.filter((x) => x !== a));
        this.clash(a, v, ev);
      }
      this.updateHazards(dt, ev);
      this.updateKo(dt, ev);
    }
    this.updateDebris(dt);

    return {
      frame: {
        t: this.t,
        bots: this.bots.map((b) => this.botFrame(b)),
        debris: this.debris.map(({ vel: _v, spinRate: _s, age: _a, ...d }) => d),
        hazards: this.hazards.map((h) => ({ ...h })),
        match: { phase, clock: this.clock, lights: this.lights, timeScale: 1 },
      },
      events: ev,
    };
  }

  private light(n: 1 | 2 | 3 | 4, ev: MatchEvent[]): void {
    this.lights = n;
    ev.push({ type: 'lights', t: this.t, lights: n });
  }

  private moveBot(b: MockBot, dt: number, fighting: boolean, ev: MatchEvent[]): void {
    const w = b.spec.weapon;
    if (fighting) {
      b.phase += (b.speed * dt * 3.2) / b.radius;
      const x = Math.cos(b.phase) * b.radius;
      const z = Math.sin(b.phase * 1.0) * b.radius * 0.8;
      const dx = x - b.pos.x;
      const dz = z - b.pos.z;
      if (Math.hypot(dx, dz) > 1e-4) b.yaw = Math.atan2(-dx, -dz);
      b.wheelSpin += (Math.hypot(dx, dz) / Math.max(0.05, b.spec.wheels[0]?.radius ?? 0.1));
      b.pos = { x, y: 0, z };
    } else if (this.t < 0.05 || b.pos.x === 0) {
      b.pos = { x: Math.cos(b.phase) * b.radius, y: 0, z: Math.sin(b.phase) * b.radius * 0.8 };
      b.yaw = Math.atan2(b.pos.x, b.pos.z);
    }
    if (w.kind === 'vdisk' || w.kind === 'drum' || w.kind === 'hbar' || w.kind === 'shell') {
      const target = fighting ? 1 : 0;
      const prev = b.spin01;
      b.spin01 += (target - b.spin01) * Math.min(1, dt / (w.spinupSec * 0.45));
      if (prev < 0.05 && b.spin01 >= 0.05) ev.push({ type: 'weapon_arm', t: this.t, bot: b.id, on: true });
      b.weaponAngle += ((w.maxRpm * b.spin01 * Math.PI * 2) / 60) * dt * w.direction;
    } else if (w.kind === 'flipper' || w.kind === 'axe' || w.kind === 'lifter') {
      b.armTimer -= dt;
      if (fighting && b.armTimer <= 0) {
        b.armTimer = w.kind === 'lifter' ? 3 : 2.2;
        b.arm = 1;
        ev.push({ type: 'weapon_fire', t: this.t, bot: b.id, kind: w.kind });
      }
      const down = w.kind === 'lifter' ? 0.8 : 3.5;
      b.arm = Math.max(0, b.arm - dt * down);
      b.weaponAngle = w.restAngle + (w.maxAngle - w.restAngle) * Math.min(1, b.arm * 1.4);
    }
    if (b.airborne > 0) {
      b.airborne -= dt;
      b.roll += dt * 9;
      b.pos.y = Math.max(0, Math.sin(Math.max(0, b.airborne) * Math.PI) * 1.4);
      if (b.airborne <= 0) {
        b.pos.y = 0;
        b.inverted = !b.inverted && this.rng.next() < 0.5 ? true : false;
        b.roll = b.inverted ? Math.PI : 0;
        ev.push({ type: 'landed', t: this.t, bot: b.id, speed: 5 });
        if (b.inverted) ev.push({ type: 'flipped', t: this.t, bot: b.id });
      }
    }
  }

  private clash(a: MockBot, v: MockBot, ev: MatchEvent[]): void {
    const point = { x: (a.pos.x + v.pos.x) / 2, y: 0.18 * v.spec.scale, z: (a.pos.z + v.pos.z) / 2 };
    const dirLen = Math.hypot(v.pos.x - a.pos.x, v.pos.z - a.pos.z) || 1;
    const dir = { x: (v.pos.x - a.pos.x) / dirLen, y: 0.3, z: (v.pos.z - a.pos.z) / dirLen };
    const w = a.spec.weapon;
    let kind: HitKind = 'ram';
    let energy = 300;
    if (w.kind === 'vdisk' || w.kind === 'drum' || w.kind === 'hbar' || w.kind === 'shell') {
      kind = 'spinner';
      const om = (w.maxRpm * a.spin01 * Math.PI * 2) / 60;
      energy = 0.5 * w.inertia * om * om * this.rng.range(0.15, 0.6);
      a.spin01 *= 0.55;
    } else if (w.kind === 'flipper') {
      kind = 'flip';
      energy = 2500;
      v.airborne = 1.0;
      ev.push({ type: 'airborne', t: this.t, bot: v.id, height: 1.4 });
    } else if (w.kind === 'axe') {
      kind = 'axe';
      energy = 3000;
    } else if (w.kind === 'lifter') {
      kind = 'lift';
      energy = 400;
    }
    const facet = this.rng.pick(FACETS);
    const mat = v.spec.loadout.armor.material;
    const damage = (energy / 100) * this.rng.range(0.6, 1.2);
    const hpFrac = damage / v.spec.facetHp[facet];
    const before = v.facets[facet];
    v.facets[facet] = Math.max(0, before - hpFrac);
    const severity = Math.min(1, energy / 12000);
    ev.push({ type: 'hit', t: this.t, kind, attacker: a.id, victim: v.id, point, dir, energy, facet, damage, severity, material: mat });
    if (ARMOR[mat].sparks > 0 && energy > 800) {
      ev.push({ type: 'shrapnel', t: this.t, bot: v.id, point, dir, count: Math.round(3 + severity * 10), material: mat });
    }
    if (before > 0 && v.facets[facet] <= 0) {
      const index = v.spec.panels.findIndex((p) => p.facet === facet);
      if (index >= 0) {
        const p = v.spec.panels[index];
        const id = this.nextDebris++;
        this.debris.push({
          id,
          bot: v.id,
          kind: 'panel',
          facet,
          index,
          pos: { ...point, y: point.y + 0.2 },
          quat: { x: 0, y: 0, z: 0, w: 1 },
          size: { x: p.w, y: p.h, z: p.t },
          vel: { x: dir.x * 4, y: 5, z: dir.z * 4 },
          spinRate: 8,
          age: 0,
        });
        ev.push({ type: 'panel_off', t: this.t, bot: v.id, facet, debris: id });
      }
    }
    // Damage spills into components once armor is thin.
    if (v.facets[facet] < 0.5) {
      const c = this.rng.pick(COMPONENTS);
      const before = v.parts[c];
      v.parts[c] = Math.max(0, before - this.rng.range(0.1, 0.35));
      if (before >= 0.35 && v.parts[c] < 0.35) ev.push({ type: 'smoke_start', t: this.t, bot: v.id });
      if (c === 'battery' && v.parts[c] < 0.3 && before >= 0.3) ev.push({ type: 'fire_start', t: this.t, bot: v.id });
      if (before > 0 && v.parts[c] <= 0) ev.push({ type: 'component_down', t: this.t, bot: v.id, component: c });
    }
  }

  private updateHazards(dt: number, ev: MatchEvent[]): void {
    for (const h of this.hazards) {
      if (h.kind === 'spikestrip') continue;
      let timer = (this.hazardTimers.get(h.id) ?? 3) - dt;
      if (h.kind === 'killsaw') h.spin += dt * 40;
      if (timer <= 0.8 && timer > 0 && !h.warn) {
        h.warn = true;
        ev.push({ type: 'hazard', t: this.t, hazard: h.id, kind: h.kind, action: 'warn', target: null });
      }
      if (timer <= 0) {
        if (h.state === 0) ev.push({ type: 'hazard', t: this.t, hazard: h.id, kind: h.kind, action: 'strike', target: null });
        const speed = h.kind === 'pulverizer' ? 5 : 6;
        h.state = Math.min(1, h.state + dt * speed);
        if (timer < -1.0) {
          h.state = 0;
          h.warn = false;
          ev.push({ type: 'hazard', t: this.t, hazard: h.id, kind: h.kind, action: 'retract', target: null });
          timer = this.rng.range(3, 8);
        }
      }
      this.hazardTimers.set(h.id, timer);
    }
  }

  private updateKo(dt: number, ev: MatchEvent[]): void {
    const dead = this.bots.find((b) => b.inverted || b.parts.electronics <= 0);
    if (!dead) {
      if (this.koFor) ev.push({ type: 'ko_clear', t: this.t, bot: this.koFor });
      this.koFor = null;
      return;
    }
    if (this.koFor !== dead.id) {
      this.koFor = dead.id;
      this.koCount = 10;
    }
    const before = Math.ceil(this.koCount);
    this.koCount -= dt;
    if (Math.ceil(this.koCount) !== before && this.koCount > 0) ev.push({ type: 'ko_count', t: this.t, bot: dead.id, n: Math.ceil(this.koCount) });
    if (this.koCount <= 0) {
      // The mock never ends a fight: flip the robot back over instead.
      dead.inverted = false;
      dead.roll = 0;
      ev.push({ type: 'righted', t: this.t, bot: dead.id, how: 'luck' });
      this.koFor = null;
    }
  }

  private updateDebris(dt: number): void {
    for (const d of this.debris) {
      d.age += dt;
      d.vel.y -= 9.81 * dt;
      d.pos = { x: d.pos.x + d.vel.x * dt, y: d.pos.y + d.vel.y * dt, z: d.pos.z + d.vel.z * dt };
      if (d.pos.y < d.size.z / 2) {
        d.pos.y = d.size.z / 2;
        d.vel = { x: d.vel.x * 0.5, y: Math.abs(d.vel.y) * 0.3, z: d.vel.z * 0.5 };
        d.spinRate *= 0.5;
      }
      d.quat = yawQuat(d.age * d.spinRate * 0.3, d.age * d.spinRate, 0);
    }
  }

  private botFrame(b: MockBot): BotFrame {
    const w = b.spec.weapon;
    const spinner = w.kind === 'vdisk' || w.kind === 'drum' || w.kind === 'hbar' || w.kind === 'shell';
    const minPart = Math.min(...COMPONENTS.map((c) => b.parts[c]));
    return {
      id: b.id,
      pos: { ...b.pos },
      quat: yawQuat(b.yaw, b.roll),
      vel: { x: 0, y: 0, z: 0 },
      angVel: { x: 0, y: 0, z: 0 },
      wheelSpin: b.spec.wheels.map(() => b.wheelSpin),
      wheelContact: b.spec.wheels.map(() => b.airborne <= 0),
      wheelLost: b.spec.wheels.map(() => false),
      driveL: 0.8,
      driveR: 0.7,
      weapon: {
        angle: b.weaponAngle,
        rpm: spinner ? w.maxRpm * b.spin01 : 0,
        spin01: spinner ? b.spin01 : 0,
        armed: spinner,
        arm: b.arm,
        ready: b.arm <= 0,
        shotsLeft: w.kind === 'flipper' || w.kind === 'axe' ? w.shots : 0,
      },
      facets: { ...b.facets },
      parts: { ...b.parts },
      charge: Math.max(0, 1 - this.t / 240),
      smoke: minPart < 0.35 ? 1 - minPart / 0.35 : 0,
      fire: b.parts.battery < 0.3 ? 1 : 0,
      inverted: b.inverted,
      disabled: false,
      koCount: this.koFor === b.id ? this.koCount : null,
      holdTime: null,
    };
  }
}
