// One robot in the Box: a Rapier rigid body with raycast wheels, a DC-motor drive model, a
// weapon with real stored energy, armor facets and internal components.

import type { Collider, RigidBody, World } from '@dimforge/rapier3d-compat';
import {
  COMPONENTS,
  FACETS,
  type ArmSpec,
  type BotFrame,
  type BotSpec,
  type Component,
  type Corner,
  type DriveCommand,
  type Facet,
  type HitKind,
  type MatchEvent,
  type MatchStats,
  type SpinnerSpec,
  type Vec3,
} from '../contract';
import { ARMOR, CHASSIS, DRIVES, POWER, WEAPONS, massScale } from '../data/parts';
import { add, clamp, clamp01, cross, dot, len, norm, rotate, scale, sub, unrotate, vec } from './math';
import type { Rapier } from './rapier';
import type { Rng } from './rng';

export const GRAVITY = 9.81;
const MU = 1.05; // rubber on steel
const MU_LAT = 0.95;
/** Global damage tuning: fights should often go the distance, as on the show. */
export const DAMAGE_SCALE = 0.5;

/** What a robot needs from the match around it. */
export interface SimHost {
  R: Rapier;
  world: World;
  rng: Rng;
  t: number;
  emit(e: MatchEvent): void;
  bots: BotSim[];
  botOfBody(body: RigidBody | null): BotSim | undefined;
  spawnDebris(d: {
    bot: string;
    kind: 'panel' | 'wheel' | 'tooth' | 'chunk';
    facet?: Facet;
    index?: number;
    pos: Vec3;
    quat: { x: number; y: number; z: number; w: number };
    size: Vec3;
    vel: Vec3;
    spin: Vec3;
  }): number;
  /** Damage bookkeeping for judges. */
  credit(attacker: BotSim | null, victim: BotSim, damage: number, hazard: boolean): void;
}

export type Threat = 'spinner' | 'blunt' | 'saw';

/** Components sitting behind each facet; the first takes most of the damage. */
const BEHIND: Record<Facet, Component[]> = {
  front: ['weapon', 'electronics'],
  rear: ['battery', 'electronics'],
  left: ['driveL', 'battery'],
  right: ['driveR', 'weapon'],
  top: ['electronics', 'weapon', 'battery'],
  belly: ['driveL', 'driveR', 'battery'],
};

interface Support {
  local: Vec3;
  /** Rest distance from the ray origin to the floor. */
  rest: number;
  /** -1 left, 1 right, 0 caster. */
  side: -1 | 0 | 1;
  wheel: number; // index into spec.wheels, -1 for casters
  radius: number;
}

export type ArmPhase = 'rest' | 'deploy' | 'hold' | 'return';

export class BotSim {
  readonly body: RigidBody;
  readonly colliders: Collider[] = [];
  readonly hull: Collider[] = [];
  weaponCollider: Collider | null = null;
  readonly wheelColliders: (Collider | null)[] = [];

  readonly mScale: number;
  readonly half: Vec3;
  readonly comY: number;
  private readonly supports: Support[] = [];
  private readonly kSpring: number;
  private readonly cDamp: number;
  private readonly fStallSide: number;
  private readonly vFree: number;
  private readonly turnGain: number;
  private yawInertia = 1;
  /** Track half width, for the turning torque the motors can make. */
  private trackHalf = 0.3;
  private readonly chargeMax: number;

  // ---- state
  facets: Record<Facet, number>;
  parts: Record<Component, number>;
  charge: number;
  omega = 0; // spinner rad/s
  spinAngle = 0;
  armed = false;
  arm = 0; // 0..1
  armPhase: ArmPhase = 'rest';
  armTimer = 0;
  cooldown = 0;
  shots: number;
  srimechShots = 6;
  srimechCooldown = 0;
  wheelSpin: number[];
  wheelContact: boolean[];
  wheelLost: boolean[];
  driveL = 0;
  driveR = 0;
  fire = 0;
  fireTimer = 0;
  smoke = 0;
  inverted = false;
  invertedTime = 0;
  onSide = false;
  /** Seconds tilted with no wheel on the floor (perched on an edge or a shell rim). */
  teeterTime = 0;
  disabled = false;
  disabledReason: 'radio' | 'battery' | 'ko' | 'tapout' | null = null;
  koCount: number | null = null;
  holdTime: number | null = null;
  cutUntil = 0;
  airborne = false;
  airPeak = 0;
  lastVy = 0;
  biteCooldown = new Map<string, number>();
  grindCooldown = 0;
  lastTouchBy: BotSim | null = null;
  lastTouchT = -99;
  cmd: DriveCommand = { throttle: 0, turn: 0, weapon: false, weaponPressed: false, selfRight: false };
  righting: { t: number; success: boolean; axisLocal: Vec3 } | null = null;
  weaponPrev = false;
  /** Movement tracking for the knockout rule. */
  stuckTime = 0;
  stillAnchor: Vec3 = vec();
  immobileTime = 0;
  readonly stats: MatchStats = {
    damageDealt: 0,
    damageTaken: 0,
    hits: 0,
    bigHits: 0,
    attackTime: 0,
    controlTime: 0,
    hazardDamageDealt: 0,
    flips: 0,
  };

  constructor(
    private host: SimHost,
    readonly id: string,
    readonly spec: BotSpec,
    readonly corner: Corner,
    readonly control: 'player' | 'ai',
    start: { pos: Vec3; yaw: number },
    carried?: { facets: Record<Facet, number>; parts: Record<Component, number> },
  ) {
    const { R, world } = host;
    const l = spec.loadout;
    const s = spec.scale;
    this.mScale = massScale(l.cls);
    const ch = CHASSIS[l.chassis];
    this.half = vec((ch.width * s) / 2, spec.panels.find((p) => p.facet === 'rear')?.h ?? 0.3 * s, (ch.length * s) / 2);
    this.half.y = Math.max(0.05, this.topOfHull() / 2);

    const q = { x: 0, y: Math.sin(start.yaw / 2), z: 0, w: Math.cos(start.yaw / 2) };
    const bodyDesc = R.RigidBodyDesc.dynamic()
      .setTranslation(start.pos.x, spec.groundClearance + 0.002, start.pos.z)
      .setRotation(q)
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setLinearDamping(0.05)
      .setAngularDamping(0.25);
    this.body = world.createRigidBody(bodyDesc);

    // Hull pieces: low friction so chassis slide like skids; drive comes from the wheel model.
    for (const piece of spec.hull) {
      const pts = new Float32Array(piece.flatMap((p) => [p.x, p.y, p.z]));
      const desc = R.ColliderDesc.convexHull(pts);
      if (!desc) continue;
      desc
        .setDensity(0)
        .setFriction(0.32)
        .setFrictionCombineRule(R.CoefficientCombineRule.Min)
        .setRestitution(0.12)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
      const c = world.createCollider(desc, this.body);
      this.hull.push(c);
      this.colliders.push(c);
    }

    // Exposed wheels collide with robots and walls (they sit just above the floor).
    const exposed = l.chassis === 'box' || l.chassis === 'wedge';
    for (const w of spec.wheels) {
      if (!exposed) {
        this.wheelColliders.push(null);
        continue;
      }
      const desc = R.ColliderDesc.cylinder(w.width / 2, w.radius * 0.88)
        .setTranslation(w.pos.x, w.pos.y, w.pos.z)
        .setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 })
        .setDensity(0)
        .setFriction(0.5)
        .setRestitution(0.1)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
      const c = world.createCollider(desc, this.body);
      this.wheelColliders.push(c);
      this.colliders.push(c);
    }

    // Weapon volume.
    const wp = spec.weapon;
    if (wp.kind === 'vdisk' || wp.kind === 'drum' || wp.kind === 'hbar' || wp.kind === 'shell') {
      const r = wp.radius + wp.toothHeight * 0.6;
      const desc = R.ColliderDesc.cylinder(wp.width / 2, r)
        .setTranslation(wp.center.x, wp.center.y, wp.center.z)
        .setDensity(0)
        .setFriction(0.15)
        .setRestitution(0.35)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
      if (wp.axis === 'x') desc.setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 });
      this.weaponCollider = world.createCollider(desc, this.body);
      this.colliders.push(this.weaponCollider);
    } else if (wp.kind === 'lifter') {
      // Forks at rest act as a low wedge.
      const a = wp.restAngle;
      const mid = add(wp.hinge, vec(0, (Math.sin(a) * wp.length) / 2, (-Math.cos(a) * wp.length) / 2));
      const desc = R.ColliderDesc.cuboid(wp.width / 2, 0.008 * s, wp.length / 2)
        .setTranslation(mid.x, mid.y, mid.z)
        .setRotation({ x: Math.sin(-a / 2), y: 0, z: 0, w: Math.cos(-a / 2) })
        .setDensity(0)
        .setFriction(0.3)
        .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
      this.weaponCollider = world.createCollider(desc, this.body);
      this.colliders.push(this.weaponCollider);
    }

    // Mass properties: a box approximation centered on the wheelbase. (Shifting the center of mass
    // toward a front weapon made skid steering orbit instead of pivot.)
    const m = spec.massKg;
    const comZ = 0;
    this.comY = Math.min(this.topOfHull() * 0.42, 0.14 * s);
    const W = spec.width;
    const L = ch.length * s;
    const H = this.topOfHull();
    const inertia = {
      x: (m / 12) * (H * H + L * L),
      y: (m / 12) * (W * W + L * L),
      z: (m / 12) * (W * W + H * H),
    };
    this.body.setAdditionalMassProperties(m, { x: 0, y: this.comY, z: comZ }, inertia, { x: 0, y: 0, z: 0, w: 1 }, true);
    this.yawInertia = inertia.y;

    // Supports: wheels plus a front caster for 2WD robots.
    const dr = DRIVES[l.drive];
    spec.wheels.forEach((w, i) => this.supports.push({ local: w.pos, rest: w.radius, side: w.side, wheel: i, radius: w.radius }));
    if (dr.wheels === 2) {
      const ro = 0.05 * s;
      this.supports.push({ local: vec(0, ro, -L * 0.38), rest: ro + spec.groundClearance, side: 0, wheel: -1, radius: 0.02 * s });
    }
    const nSupport = this.supports.length;
    const preload = 0.012 * s;
    this.kSpring = (m * GRAVITY) / nSupport / preload;
    this.cDamp = 2 * 0.7 * Math.sqrt(this.kSpring * (m / nSupport));
    this.fStallSide = (dr.force * this.mScale) / 2;
    this.vFree = spec.stats.topSpeed;
    this.turnGain = clamp(0.95 / Math.sqrt(dr.scrub), 0.55, 1);
    this.trackHalf = Math.max(0.12, ...spec.wheels.map((w) => Math.abs(w.pos.x)));

    const pw = POWER[l.power];
    this.chargeMax = pw.capacityKJ * 1000 * this.mScale;
    this.charge = this.chargeMax;

    this.facets = {} as Record<Facet, number>;
    for (const f of FACETS) this.facets[f] = spec.facetHp[f] * (carried?.facets[f] ?? 1);
    this.parts = {} as Record<Component, number>;
    for (const c of COMPONENTS) this.parts[c] = spec.componentHp[c] * (carried?.parts[c] ?? 1);
    this.shots = wp.kind === 'flipper' || wp.kind === 'axe' ? wp.shots : 0;
    this.wheelSpin = spec.wheels.map(() => 0);
    this.wheelContact = spec.wheels.map(() => false);
    this.wheelLost = spec.wheels.map(() => false);
    this.stillAnchor = vec(start.pos.x, 0, start.pos.z);
  }

  /** Height of the lowest hull or wheel point above the floor. */
  lowestPoint(): number {
    const q = this.body.rotation();
    const p = this.body.translation();
    let low = Infinity;
    for (const piece of this.spec.hull) {
      for (const v of piece) {
        const y = p.y + rotate(q, v).y;
        if (y < low) low = y;
      }
    }
    for (let i = 0; i < this.spec.wheels.length; i++) {
      if (this.wheelLost[i]) continue;
      const w = this.spec.wheels[i];
      const c = p.y + rotate(q, w.pos).y;
      // A wheel's lowest point depends on its axle tilt; this is close enough.
      const axle = rotate(q, vec(1, 0, 0));
      const low2 = c - w.radius * Math.sqrt(Math.max(0, 1 - axle.y * axle.y));
      if (low2 < low) low = low2;
    }
    return low;
  }

  private topOfHull(): number {
    let top = 0;
    for (const piece of this.spec.hull) for (const p of piece) top = Math.max(top, p.y);
    return top;
  }

  // ------------------------------------------------------------------ queries

  get pos(): Vec3 {
    return this.body.translation();
  }
  get quat() {
    return this.body.rotation();
  }
  get up(): Vec3 {
    return rotate(this.body.rotation(), vec(0, 1, 0));
  }
  get forward(): Vec3 {
    return rotate(this.body.rotation(), vec(0, 0, -1));
  }
  /** World position of a robot-local point. */
  toWorld(p: Vec3): Vec3 {
    return add(this.body.translation(), rotate(this.body.rotation(), p));
  }
  toLocal(p: Vec3): Vec3 {
    return unrotate(this.body.rotation(), sub(p, this.body.translation()));
  }
  frac(c: Component): number {
    return this.parts[c] / this.spec.componentHp[c];
  }
  facetFrac(f: Facet): number {
    return this.facets[f] / this.spec.facetHp[f];
  }
  get isSpinner(): boolean {
    const k = this.spec.weapon.kind;
    return k === 'vdisk' || k === 'drum' || k === 'hbar' || k === 'shell';
  }
  get spinnerSpec(): SpinnerSpec | null {
    return this.isSpinner ? (this.spec.weapon as SpinnerSpec) : null;
  }
  get armSpec(): ArmSpec | null {
    const k = this.spec.weapon.kind;
    return k === 'flipper' || k === 'axe' || k === 'lifter' ? (this.spec.weapon as ArmSpec) : null;
  }
  get omegaMax(): number {
    const sp = this.spinnerSpec;
    return sp ? (sp.maxRpm * Math.PI * 2) / 60 : 0;
  }
  get spin01(): number {
    const om = this.omegaMax;
    return om > 0 ? clamp01(this.omega / om) : 0;
  }
  /** Stored spinner energy, joules. */
  get weaponEnergy(): number {
    const sp = this.spinnerSpec;
    return sp ? 0.5 * sp.inertia * this.omega * this.omega : 0;
  }
  /** Power available from the battery, 0..1. */
  get power(): number {
    const health = 0.45 + 0.55 * this.frac('battery');
    const c = this.charge / this.chargeMax;
    const charge = c > 0.12 ? 1 : 0.3 + (c / 0.12) * 0.7;
    return (this.disabled ? 0 : 1) * health * charge * POWER[this.spec.loadout.power].punch;
  }
  get wheelsDown(): number {
    let n = 0;
    for (let i = 0; i < this.wheelContact.length; i++) if (this.wheelContact[i] && !this.wheelLost[i]) n++;
    return n;
  }
  /** Can drive under its own power right now. */
  get driveCapable(): boolean {
    if (this.disabled) return false;
    if (this.parts.driveL <= 0 && this.parts.driveR <= 0) return false;
    return this.wheelsDown > 0;
  }

  // ------------------------------------------------------------------ step

  /** Before the physics step: drive, weapon and arms. */
  prestep(dt: number, fighting: boolean): void {
    const host = this.host;
    const t = host.t;
    const cut = t < this.cutUntil;
    const cmd = fighting && !this.disabled && !cut ? this.cmd : { throttle: 0, turn: 0, weapon: false, weaponPressed: false, selfRight: false };

    this.updateOrientation(dt);
    this.drive(dt, cmd);
    this.weaponStep(dt, cmd, fighting && !this.disabled, cut);
    this.selfRightStep(dt, cmd);
    this.rightingStep(dt);
    this.drain(dt, cmd);
    this.burn(dt);
    this.weaponPrev = cmd.weapon;
  }

  private updateOrientation(dt: number): void {
    const upY = this.up.y;
    if (!this.inverted && upY < -0.35) {
      this.invertedTime += dt;
      if (this.invertedTime > 0.35) {
        this.inverted = true;
        this.stats.flips += 0; // counted for the attacker in the match
        this.host.emit({ type: 'flipped', t: this.host.t, bot: this.id });
      }
    } else if (this.inverted && upY > 0.35) {
      this.inverted = false;
      this.invertedTime = 0;
    } else if (!this.inverted) {
      this.invertedTime = 0;
    }
    this.onSide = Math.abs(upY) < 0.35;
    if (this.wheelsDown === 0 && upY < 0.85 && !this.airborne && len(this.body.linvel()) < 2.5) this.teeterTime += dt;
    else this.teeterTime = 0;
    // Nothing balances on its edge for long: protruding wheels and weapons tip it one way.
    if (this.onSide && len(this.body.linvel()) < 0.6) {
      const up = this.up;
      const axis = norm(cross(up, vec(0, upY >= -0.05 ? 1 : -1, 0)));
      this.body.applyTorqueImpulse(scale(axis, this.spec.massKg * GRAVITY * 0.06 * this.spec.scale * dt), true);
    }
  }

  private drive(dt: number, cmd: DriveCommand): void {
    const { R, world } = this.host;
    const body = this.body;
    const q = body.rotation();
    const pos = body.translation();
    const upW = rotate(q, vec(0, 1, 0));
    const down = upW.y >= 0 ? scale(upW, -1) : upW; // toward the floor along the robot's vertical
    const flipSteer = this.inverted ? -1 : 1;
    const fwdW = rotate(q, vec(0, 0, -1));
    const rightW = rotate(q, vec(1, 0, 0));

    let throttle = clamp(cmd.throttle, -1, 1);
    let turn = clamp(cmd.turn, -1, 1) * this.turnGain * flipSteer;
    // Turning is gentler at speed, like a real driver feathering sticks.
    turn *= 1 - 0.25 * Math.abs(throttle);
    let cl = throttle + turn;
    let cr = throttle - turn;
    const mx = Math.max(1, Math.abs(cl), Math.abs(cr));
    cl /= mx;
    cr /= mx;
    const p = this.power;
    const hpL = this.parts.driveL > 0 ? 0.35 + 0.65 * this.frac('driveL') : 0;
    const hpR = this.parts.driveR > 0 ? 0.35 + 0.65 * this.frac('driveR') : 0;
    this.driveL = cl * (hpL > 0 ? 1 : 0);
    this.driveR = cr * (hpR > 0 ? 1 : 0);

    const nSide = { [-1]: 0, [1]: 0 } as Record<number, number>;
    for (const s of this.supports) if (s.side !== 0 && !this.wheelLost[s.wheel]) nSide[s.side]++;
    const travel = 0.035 * this.spec.scale;
    const massShare = this.spec.massKg / this.supports.length;

    for (const s of this.supports) {
      if (s.wheel >= 0 && this.wheelLost[s.wheel]) continue;
      const origin = add(pos, rotate(q, s.local));
      const ray = new R.Ray(origin, down);
      const maxToi = s.rest + travel;
      const hit = world.castRayAndGetNormal(ray, maxToi, true, undefined, undefined, undefined, body);
      if (s.wheel >= 0) this.wheelContact[s.wheel] = false;
      const cmdSide = s.side < 0 ? cl : s.side > 0 ? cr : 0;
      const hpSide = s.side < 0 ? hpL : s.side > 0 ? hpR : 0;
      if (!hit) {
        if (s.wheel >= 0) this.wheelSpin[s.wheel] += ((cmdSide * hpSide * this.vFree) / s.radius) * dt * (p > 0 ? 1 : 0);
        continue;
      }
      const d = hit.timeOfImpact;
      const contact = add(origin, scale(down, d));
      const other = this.host.botOfBody(hit.collider.parent());
      // A wheel buried in another robot or a hazard is not standing on it.
      if (d < s.rest * 0.55) continue;
      const otherBody = other ? other.body : hit.collider.parent();
      const vMe = body.velocityAtPoint(contact);
      const vOther = otherBody && otherBody.isDynamic() ? otherBody.velocityAtPoint(contact) : vec();
      const vRel = sub(vMe, vOther);
      const n = norm(hit.normal);
      const comp = s.rest + 0.012 * this.spec.scale - d;
      const vInto = dot(vRel, down);
      let fn = this.kSpring * comp + this.cDamp * vInto;
      fn = clamp(fn, 0, massShare * GRAVITY * (other ? 2.5 : 5));
      if (fn <= 0) continue;
      const upImp = scale(n, fn * dt);
      body.applyImpulseAtPoint(upImp, add(origin, scale(down, Math.min(d, s.rest * 0.5))), true);
      if (other) other.body.applyImpulseAtPoint(scale(upImp, -1), contact, true);

      // Ground-plane directions.
      const f = norm(sub(fwdW, scale(n, dot(fwdW, n))));
      const r = norm(sub(rightW, scale(n, dot(rightW, n))));
      const vLong = dot(vRel, f);
      const vLat = dot(vRel, r);
      let fLong = 0;
      let fLat: number;
      const grip = MU * fn;
      if (s.wheel >= 0) {
        this.wheelContact[s.wheel] = true;
        const perWheel = this.fStallSide / Math.max(1, nSide[s.side]);
        // Brushed DC motor under PWM: force falls off linearly toward free speed. With the stick
        // centred the speed controller brakes hard (shorted windings), so robots stop instead of
        // coasting across the Box.
        const brake = Math.abs(cmdSide) < 0.08 ? 4 : 1;
        const drive = hpSide > 0 ? clamp(cmdSide * p - (brake * vLong) / this.vFree, -1, 1) : 0;
        fLong = perWheel * hpSide * drive;
        if (hpSide <= 0) fLong = -vLong * massShare * 0.6; // dead side drags
        fLat = clamp(-vLat * (massShare / dt) * 0.35, -MU_LAT * fn, MU_LAT * fn);
        const total = Math.hypot(fLong, fLat);
        if (total > grip) {
          fLong *= grip / total;
          fLat *= grip / total;
        }
        const slip = Math.abs(fLong) >= grip * 0.98 ? 0.6 : 0;
        const wheelV = vLong + slip * (cmdSide * this.vFree - vLong);
        this.wheelSpin[s.wheel] += (wheelV / s.radius) * dt;
      } else {
        // Caster: rolls freely, a little scrub.
        fLat = clamp(-vLat * (massShare / dt) * 0.04, -0.1 * fn, 0.1 * fn);
        fLong = clamp(-vLong * massShare * 0.05, -0.05 * fn, 0.05 * fn);
      }
      const imp = add(scale(f, fLong * dt), scale(r, fLat * dt));
      body.applyImpulseAtPoint(imp, contact, true);
      if (other) other.body.applyImpulseAtPoint(scale(imp, -1), contact, true);
    }
    this.yawAssist(dt, clamp(cmd.turn, -1, 1) * (1 - 0.25 * Math.abs(throttle)), upW);
  }

  /**
   * The driver's hands on the sticks: chase a yaw rate set by the turn command so a turn starts
   * crisply and stops where it was let go, instead of fighting tyre scrub on the way in and
   * sliding on the way out. Limited to what the motors could plausibly do, so big hits still
   * spin a robot around.
   */
  private yawAssist(dt: number, turn: number, upW: Vec3): void {
    const down = this.wheelsDown;
    if (down === 0 || this.disabled) return;
    const hp = (this.parts.driveL > 0 ? 0.5 : 0) + (this.parts.driveR > 0 ? 0.5 : 0);
    if (hp <= 0) return;
    const grounded = down / Math.max(1, this.spec.wheels.length);
    const sign = upW.y >= 0 ? 1 : -1;
    // Turning right spins clockwise seen from above, the right way up or not (the wheel commands
    // are already swapped for an upside-down robot).
    const maxRate = 2.4 + 2.2 * this.turnGain;
    const want = -turn * maxRate * Math.min(1, this.power + 0.25);
    const have = dot(this.body.angvel(), upW) * sign;
    // A robot spun by a hit spins: the driver cannot catch that, so the assist lets it go.
    if (Math.abs(have) > maxRate * 1.3) return;
    const tauMax = this.fStallSide * 2 * this.trackHalf * 3 * hp * grounded;
    const tau = clamp(this.yawInertia * 22 * (want - have), -tauMax, tauMax);
    this.body.applyTorqueImpulse(scale(upW, tau * sign * dt), true);
  }

  // ------------------------------------------------------------------ weapons

  private weaponStep(dt: number, cmd: DriveCommand, live: boolean, cut: boolean): void {
    const sp = this.spinnerSpec;
    const host = this.host;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (sp) {
      if (live && cmd.weaponPressed) {
        this.armed = !this.armed;
        host.emit({ type: 'weapon_arm', t: host.t, bot: this.id, on: this.armed });
      }
      if (!live) this.armed = false;
      // Builders kill the weapon while the robot is on its back or side so it can right itself.
      if (this.helpless && this.armed && this.control === 'ai') {
        this.armed = false;
        host.emit({ type: 'weapon_arm', t: host.t, bot: this.id, on: false });
      }
      const health = this.frac('weapon');
      const omMax = this.omegaMax * (health > 0 ? 0.55 + 0.45 * health : 0) * Math.min(1, 0.55 + 0.45 * this.power);
      const tauMax = (sp.inertia * this.omegaMax * 2.3) / sp.spinupSec;
      let tau = 0;
      if (this.armed && this.parts.weapon > 0 && this.power > 0) {
        tau = tauMax * this.power * clamp01(1 - this.omega / Math.max(1, omMax));
        if (this.omega > omMax) tau = -tauMax * 0.2;
      } else {
        // Coast down: bearing drag plus air. A helpless robot's builder brakes the weapon.
        const brake = this.helpless ? 1.2 : 1 / 9;
        tau = -sp.inertia * this.omega * brake - sp.inertia * 2;
        if (this.omega <= 0) tau = 0;
      }
      this.omega = Math.max(0, this.omega + (tau / sp.inertia) * dt);
      this.spinAngle += this.omega * dt * sp.direction;
      if (this.spinAngle > 1e4) this.spinAngle -= Math.PI * 2 * 1000;
      // Reaction torque on the chassis and gyroscopic precession.
      const axisL = sp.axis === 'x' ? vec(sp.direction, 0, 0) : vec(0, sp.direction, 0);
      const axisW = rotate(this.body.rotation(), axisL);
      this.body.applyTorqueImpulse(scale(axisW, -tau * dt), true);
      const L = scale(axisW, sp.inertia * this.omega);
      const gyro = cross(L, this.body.angvel());
      // Vertical disks and drums visibly hop and lean when turning. Flat rotors (bars, shells)
      // would precess like tops on their rims, which real ones rarely do, so they get less.
      this.body.applyTorqueImpulse(scale(gyro, dt * (sp.axis === 'x' ? 0.55 : 0.12)), true);
      // Electrical draw while spinning up.
      this.charge = Math.max(0, this.charge - (Math.max(0, tau) * this.omega * dt) / 0.7);
      return;
    }
    const arm = this.armSpec;
    if (!arm) return;
    if (arm.kind === 'lifter') {
      const want = live && !cut && cmd.weapon && this.parts.weapon > 0;
      const rate = (1 / arm.deploySec) * (0.4 + 0.6 * this.frac('weapon')) * Math.min(1, this.power + 0.2);
      const before = this.arm;
      if (want) this.arm = Math.min(1, this.arm + rate * dt);
      else this.arm = Math.max(0, this.arm - rate * 1.5 * dt);
      this.armed = want;
      if (want && before === 0) host.emit({ type: 'weapon_fire', t: host.t, bot: this.id, kind: 'lifter' });
      this.armPhase = this.arm > 0 ? (want ? 'deploy' : 'return') : 'rest';
      if (want && this.arm > before) {
        this.liftStep(arm, dt);
        this.charge = Math.max(0, this.charge - WEAPONS.lifter.watts * this.mScale * dt);
      }
      return;
    }
    // Pneumatic flipper and axe.
    if (this.armPhase === 'rest' && live && !cut && cmd.weaponPressed && this.cooldown <= 0 && this.shots > 0 && this.parts.weapon > 0) {
      if (!this.inverted || arm.kind === 'axe') {
        this.armPhase = 'deploy';
        this.armTimer = 0;
        this.shots--;
        host.emit({ type: 'weapon_fire', t: host.t, bot: this.id, kind: arm.kind });
        if (arm.kind === 'flipper') this.flipFire(arm);
      } else if (arm.kind === 'flipper') {
        this.armPhase = 'deploy';
        this.armTimer = 0;
        this.shots--;
        host.emit({ type: 'weapon_fire', t: host.t, bot: this.id, kind: arm.kind });
        this.tryRight('weapon', WEAPONS.flipper.selfRight);
      }
    }
    if (this.armPhase === 'deploy') {
      this.armTimer += dt;
      this.arm = clamp01(this.armTimer / arm.deploySec);
      if (this.arm >= 1) {
        this.armPhase = 'return';
        this.armTimer = 0;
        if (arm.kind === 'axe') this.axeStrike(arm);
      }
    } else if (this.armPhase === 'return') {
      this.armTimer += dt;
      this.arm = clamp01(1 - this.armTimer / (arm.kind === 'axe' ? 0.6 : 0.45));
      if (this.arm <= 0) {
        this.armPhase = 'rest';
        this.cooldown = arm.rechargeSec * (1.4 - 0.4 * this.frac('weapon'));
      }
    }
  }

  /** Bots whose colliders intersect a box in this robot's frame. */
  private botsInZone(center: Vec3, half: Vec3): { bot: BotSim; point: Vec3 }[] {
    const { R, world } = this.host;
    const c = this.toWorld(center);
    const shape = new R.Cuboid(half.x, half.y, half.z);
    const found = new Map<string, BotSim>();
    world.intersectionsWithShape(c, this.body.rotation(), shape, (col) => {
      const b = this.host.botOfBody(col.parent());
      if (b && b !== this) found.set(b.id, b);
      return true;
    });
    const out: { bot: BotSim; point: Vec3 }[] = [];
    for (const b of found.values()) {
      const proj = world.projectPoint(c, true, undefined, undefined, undefined, undefined, (col) => col.parent() === b.body);
      out.push({ bot: b, point: proj ? proj.point : b.pos });
    }
    return out;
  }

  private flipFire(arm: ArmSpec): void {
    const host = this.host;
    const zoneLen = arm.length * 0.9 + 0.12 * this.spec.scale;
    const center = vec(0, arm.hinge.y * 0.6 + 0.08 * this.spec.scale, arm.hinge.z - zoneLen / 2 + 0.04 * this.spec.scale);
    const half = vec(arm.width / 2 + 0.04, arm.hinge.y * 0.6 + 0.12 * this.spec.scale, zoneLen / 2);
    const targets = this.botsInZone(center, half);
    const up = this.up;
    const fwd = this.forward;
    const health = 0.5 + 0.5 * this.frac('weapon');
    for (const { bot, point } of targets) {
      const dir = norm(add(scale(up, 1), scale(fwd, 0.42)));
      // Further toward the tip means less leverage.
      const local = this.toLocal(point);
      const reach = clamp01((arm.hinge.z - local.z) / arm.length);
      const J = arm.power * health * (1.05 - 0.35 * reach) * Math.min(1, 0.6 + 0.4 * this.power + 0.3);
      // Lift at the near edge so the target tips over backward.
      const lift = add(point, scale(fwd, 0.05));
      bot.body.applyImpulseAtPoint(scale(dir, J), lift, true);
      bot.body.applyTorqueImpulse(scale(cross(fwd, up), -J * 0.18 * bot.spec.scale), true);
      const energy = (J * J) / (2 * bot.spec.massKg);
      const facet = bot.facetAt(point);
      bot.damage({ amount: 5 * this.mScale + energy / 400, facet, kind: 'flip', attacker: this, point, dir, energy, threat: 'blunt', severity: clamp01(J / (bot.spec.massKg * 7)) });
      bot.lastTouchBy = this;
      bot.lastTouchT = host.t;
      this.stats.flips++;
    }
  }

  private axeStrike(arm: ArmSpec): void {
    const host = this.host;
    const a = arm.maxAngle;
    const tip = add(arm.hinge, vec(0, Math.sin(a) * arm.length, -Math.cos(a) * arm.length));
    const head = arm.head ?? vec(0.05, 0.16, 0.07);
    const center = vec(0, Math.max(0.12, tip.y) * 0.6, tip.z);
    const half = vec(0.16 * this.spec.scale + head.x, Math.max(0.15, tip.y) * 0.6 + 0.05, 0.16 * this.spec.scale);
    const targets = this.botsInZone(center, half);
    const health = 0.5 + 0.5 * this.frac('weapon');
    const down = scale(this.up, -1);
    if (targets.length === 0) {
      // Pick hits the floor: a hop and sparks.
      const p = this.toWorld(vec(0, 0, tip.z));
      p.y = 0.01;
      this.body.applyImpulseAtPoint(scale(this.up, arm.power * 0.05), this.toWorld(vec(0, 0, -this.half.z * 0.6)), true);
      host.emit({ type: 'grind', t: host.t, point: p, dir: vec(0, 1, 0), intensity: 0.7, material: 'steel' });
      return;
    }
    for (const { bot, point } of targets) {
      const J = arm.power * health * (0.75 + 0.25 * this.power);
      bot.body.applyImpulseAtPoint(scale(add(down, scale(this.forward, 0.2)), J), point, true);
      // The strike bounces the axe robot's nose a little.
      this.body.applyImpulseAtPoint(scale(this.up, J * 0.07), this.toWorld(vec(0, 0, -this.half.z * 0.6)), true);
      const energy = 0.5 * J * J / Math.max(5, bot.spec.massKg * 0.35);
      // Axes punch through the top. Upside down, the belly faces up.
      const facet: Facet = bot.inverted ? 'belly' : bot.facetAt(point) === 'belly' ? 'top' : 'top';
      bot.damage({ amount: J * 0.13, facet, kind: 'axe', attacker: this, point, dir: down, energy, threat: 'blunt', severity: clamp01(J / (bot.spec.massKg * 4.5)) });
      bot.lastTouchBy = this;
      bot.lastTouchT = host.t;
    }
  }

  private liftStep(arm: ArmSpec, dt: number): void {
    const s = this.spec.scale;
    const ang = arm.restAngle + (arm.maxAngle - arm.restAngle) * this.arm;
    const tip = add(arm.hinge, vec(0, Math.sin(ang) * arm.length * 0.7, -Math.cos(ang) * arm.length * 0.7));
    const center = vec(0, tip.y + 0.06 * s, tip.z);
    const half = vec(arm.width / 2, 0.12 * s, arm.length * 0.4);
    const targets = this.botsInZone(center, half);
    const health = 0.4 + 0.6 * this.frac('weapon');
    for (const { bot, point } of targets) {
      const F = arm.power * health * Math.min(1, this.power + 0.2);
      bot.body.applyImpulseAtPoint(scale(this.up, F * dt), point, true);
      this.body.applyImpulseAtPoint(scale(this.up, -F * dt * 0.8), this.toWorld(tip), true);
      bot.lastTouchBy = this;
      bot.lastTouchT = this.host.t;
    }
  }

  /** Bite resolution for a spinner touching another robot (called by the match after a step). */
  spinnerContact(other: BotSim, point: Vec3, otherIsWeapon: boolean, closing: number): void {
    const sp = this.spinnerSpec;
    if (!sp || this.omega < this.omegaMax * 0.08) return;
    const host = this.host;
    const t = host.t;
    const cd = this.biteCooldown.get(other.id) ?? -1;
    const center = this.toWorld(sp.center);
    const axisL = sp.axis === 'x' ? vec(sp.direction, 0, 0) : vec(0, sp.direction, 0);
    const axisW = rotate(this.body.rotation(), axisL);
    const radial = sub(point, center);
    let tangent = norm(cross(scale(axisW, this.omega), radial));
    if (len(tangent) < 0.5) tangent = this.forward;
    const material = other.spec.loadout.armor.material;
    if (t < cd) {
      // Between bites the teeth skate and grind.
      if (t >= this.grindCooldown && this.spin01 > 0.15) {
        this.grindCooldown = t + 0.05;
        host.emit({ type: 'grind', t, point, dir: tangent, intensity: this.spin01, material });
        const e = this.weaponEnergy * 0.012;
        this.omega = Math.sqrt(Math.max(0, (2 * (this.weaponEnergy - e)) / sp.inertia));
      }
      return;
    }
    const tipSpeed = this.omega * (sp.radius + sp.toothHeight);
    // Bite depth: how far the target closes between tooth passes.
    const passTime = (Math.PI * 2) / Math.max(1, this.omega * sp.teeth);
    const bite = clamp01((Math.max(0.4, closing) * passTime) / Math.max(0.005, sp.toothHeight));
    const eff = (0.18 + 0.52 * Math.sqrt(bite)) * host.rng.range(0.8, 1.15);
    let E = this.weaponEnergy * clamp(eff, 0.1, 0.75);
    if (tipSpeed < 6) E *= tipSpeed / 6;
    if (E < 30 * this.mScale) return;
    this.biteCooldown.set(other.id, t + clamp(passTime * 2.5, 0.08, 0.2));
    this.omega = Math.sqrt(Math.max(0, (2 * (this.weaponEnergy - E)) / sp.inertia));

    // Throw direction: along the tooth's motion, plus a little outward and, for verticals, up.
    const out = norm(sub(radial, scale(axisW, dot(radial, axisW))));
    let dir = add(scale(tangent, 1), scale(out, 0.35));
    if (sp.axis === 'x') dir = add(dir, vec(0, 0.35, 0));
    else dir = add(dir, vec(0, 0.12, 0));
    dir = norm(dir);
    const mT = other.spec.massKg;
    let J = Math.sqrt(2 * mT * 0.26 * E);
    J = Math.min(J, mT * 7.5);
    other.body.applyImpulseAtPoint(scale(dir, J), point, true);
    // Recoil through the weapon bearings. Most of it shoves the chassis back; the floor under the
    // wheels soaks the twisting part, so only a little of it pitches the robot.
    const recoil = otherIsWeapon ? 0.9 : 0.5;
    const back = scale(dir, -J * recoil);
    const com = this.toWorld(vec(0, this.comY, 0));
    this.body.applyImpulseAtPoint(vec(back.x, back.y * 0.35, back.z), com, true);
    this.body.applyImpulseAtPoint(scale(back, 0.12), center, true);

    const severity = clamp01(Math.pow(E / (11000 * this.mScale), 0.75));
    if (otherIsWeapon && other.isSpinner) {
      // Weapon on weapon: both rotors take the hit.
      const E2 = other.weaponEnergy * 0.5;
      other.omega *= 0.6;
      this.damagePart('weapon', (E + E2) / 100 * 0.12, this);
      other.damagePart('weapon', (E + E2) / 100 * 0.12, this);
      host.emit({
        type: 'hit', t, kind: 'spinner', attacker: this.id, victim: other.id, point, dir, energy: E + E2, facet: 'front',
        damage: 0, severity: clamp01(severity + 0.25), material: 'steel',
      });
      host.emit({ type: 'shrapnel', t, bot: other.id, point, dir, count: 10 + Math.round(severity * 16), material: 'steel' });
      other.body.applyImpulseAtPoint(scale(dir, J * 0.4), point, true);
      return;
    }
    const facet = other.facetAt(point);
    const typeMul = sp.kind === 'hbar' ? 1.05 : sp.kind === 'drum' ? 1.1 : sp.kind === 'shell' ? 0.95 : 1;
    other.damage({ amount: (E / 100) * typeMul, facet, kind: 'spinner', attacker: this, point, dir, energy: E, threat: 'spinner', severity });
    this.damagePart('weapon', (E / 100) * 0.035, this);
    other.lastTouchBy = this;
    other.lastTouchT = t;
    // Exposed wheels get torn off by heavy side hits.
    if ((facet === 'left' || facet === 'right') && other.wheelsExposed) {
      const p = clamp01((E - 2500 * other.mScale) / (14000 * other.mScale)) * (sp.kind === 'hbar' ? 1.6 : 1);
      if (host.rng.chance(p * 0.6)) other.knockWheel(facet === 'left' ? -1 : 1, point, dir, J);
    }
    if (severity > 0.55 && host.rng.chance(0.5)) {
      const p = add(point, scale(dir, 0.05));
      host.spawnDebris({
        bot: other.id,
        kind: 'chunk',
        pos: p,
        quat: { x: 0, y: 0, z: 0, w: 1 },
        size: vec(0.07 * other.spec.scale, 0.012 * other.spec.scale, 0.05 * other.spec.scale),
        vel: add(scale(dir, 6 + severity * 6), vec(0, 3, 0)),
        spin: vec(host.rng.range(-30, 30), host.rng.range(-30, 30), host.rng.range(-30, 30)),
      });
    }
  }

  /** A spinner touching the arena (wall, floor, spikes). */
  spinnerArena(point: Vec3, normal: Vec3, floor: boolean): void {
    const sp = this.spinnerSpec;
    if (!sp || this.spin01 < 0.12) return;
    const host = this.host;
    const t = host.t;
    const key = floor ? 'floor' : 'arena';
    const cd = this.biteCooldown.get(key) ?? -1;
    if (t < cd) return;
    const center = this.toWorld(sp.center);
    if (floor) {
      // Teeth scraping the floor: sparks, a little drag, a little hop for vertical weapons.
      this.biteCooldown.set(key, t + 0.06);
      const E = this.weaponEnergy * 0.02;
      this.omega = Math.sqrt(Math.max(0, (2 * (this.weaponEnergy - E)) / sp.inertia));
      if (sp.axis === 'x') this.body.applyImpulseAtPoint(vec(0, Math.min(this.spec.massKg * 0.6, Math.sqrt(2 * this.spec.massKg * 0.1 * E)), 0), center, true);
      host.emit({ type: 'grind', t, point, dir: vec(0, 1, 0), intensity: this.spin01 * 0.6, material: 'steel' });
      return;
    }
    // Walls: a spinner bounces off hard.
    this.biteCooldown.set(key, t + 0.25);
    const E = this.weaponEnergy * 0.16;
    this.omega = Math.sqrt(Math.max(0, (2 * (this.weaponEnergy - E)) / sp.inertia));
    const n = norm(vec(normal.x, Math.max(0, normal.y) * 0.3, normal.z));
    const J = Math.min(Math.sqrt(2 * this.spec.massKg * 0.25 * E), this.spec.massKg * 2.2);
    this.body.applyImpulseAtPoint(scale(n, J), center, true);
    host.emit({ type: 'grind', t, point, dir: n, intensity: clamp01(E / (2500 * this.mScale)), material: 'steel' });
  }

  /** Cannot drive as it sits: on its back (not invertible), on its side, or teetering on an edge. */
  get helpless(): boolean {
    return (this.inverted && !this.spec.invertible) || this.onSide || this.teeterTime > 0.6;
  }

  get wheelsExposed(): boolean {
    const l = this.spec.loadout;
    return (l.chassis === 'box' || l.chassis === 'wedge') && !l.extras.includes('wheelguards');
  }

  knockWheel(side: -1 | 1, point: Vec3, dir: Vec3, J: number): void {
    const idx = this.spec.wheels
      .map((w, i) => ({ w, i }))
      .filter(({ w, i }) => w.side === side && !this.wheelLost[i])
      .sort((a, b) => len(sub(this.toWorld(a.w.pos), point)) - len(sub(this.toWorld(b.w.pos), point)))[0];
    if (!idx) return;
    this.wheelLost[idx.i] = true;
    const c = this.wheelColliders[idx.i];
    if (c) c.setEnabled(false);
    const w = idx.w;
    const host = this.host;
    const debris = host.spawnDebris({
      bot: this.id,
      kind: 'wheel',
      index: idx.i,
      pos: this.toWorld(w.pos),
      quat: this.body.rotation(),
      size: vec(w.width, w.radius * 2, w.radius * 2),
      vel: add(scale(dir, Math.min(9, J / 8)), vec(0, 3.5, 0)),
      spin: vec(host.rng.range(-20, 20), host.rng.range(-20, 20), host.rng.range(-20, 20)),
    });
    host.emit({ type: 'wheel_off', t: host.t, bot: this.id, index: idx.i, debris });
    this.damagePart(side < 0 ? 'driveL' : 'driveR', this.spec.componentHp.driveL * 0.25, null);
  }

  // ------------------------------------------------------------------ self-righting

  private selfRightStep(dt: number, cmd: DriveCommand): void {
    this.srimechCooldown = Math.max(0, this.srimechCooldown - dt);
    if (!this.helpless || !cmd.selfRight || this.disabled) return;
    if (this.spec.loadout.extras.includes('srimech') && this.srimechShots > 0 && this.srimechCooldown <= 0) {
      this.srimechShots--;
      this.srimechCooldown = 2.2;
      this.host.emit({ type: 'weapon_fire', t: this.host.t, bot: this.id, kind: 'srimech' });
      this.tryRight('srimech', 0.85);
      return;
    }
    const arm = this.armSpec;
    if (arm && this.cooldown <= 0 && this.srimechCooldown <= 0) {
      if (arm.kind === 'flipper' && this.shots <= 0) return;
      this.srimechCooldown = 2.4;
      if (arm.kind === 'flipper' || arm.kind === 'axe') {
        if (this.armPhase === 'rest') {
          this.armPhase = 'deploy';
          this.armTimer = 0;
          if (this.shots > 0) this.shots--;
        }
        this.host.emit({ type: 'weapon_fire', t: this.host.t, bot: this.id, kind: arm.kind });
      }
      this.tryRight('weapon', WEAPONS[arm.kind].selfRight);
    }
  }

  /** Push off the floor to roll back onto the wheels. The arm pushes for a moment; on a good
   *  push it carries the robot all the way over, on a bad one it falls back. */
  private tryRight(how: 'srimech' | 'weapon', odds: number): void {
    const host = this.host;
    const success = host.rng.chance(odds);
    const m = this.spec.massKg;
    this.righting = { t: 0.65, success, axisLocal: how === 'srimech' || !this.inverted ? vec(0, 0, 1) : vec(1, 0, 0) };
    this.body.applyImpulse(vec(0, m * 1.3, 0), true);
    if (success) host.emit({ type: 'righted', t: host.t + 0.5, bot: this.id, how });
  }

  private rightingStep(dt: number): void {
    const r = this.righting;
    if (!r) return;
    r.t -= dt;
    const up = this.up;
    if (r.t <= 0 || up.y > 0.92) {
      this.righting = null;
      return;
    }
    const angle = Math.acos(clamp(up.y, -1, 1));
    let axis = cross(up, vec(0, 1, 0));
    if (len(axis) < 0.25) axis = rotate(this.body.rotation(), r.axisLocal);
    axis = norm(axis);
    const w = this.body.angvel();
    const wAlong = dot(w, axis);
    const m = this.spec.massKg;
    const I = (m / 12) * (this.spec.width * this.spec.width + 4 * this.half.y * this.half.y);
    const strength = r.success ? 1 : 0.45;
    const torque = I * (55 * angle * strength - 9 * wAlong);
    this.body.applyTorqueImpulse(scale(axis, clamp(torque, -I * 120, I * 120) * dt), true);
  }

  // ------------------------------------------------------------------ damage

  /** Which facet a world point is on, in this robot's frame. */
  facetAt(p: Vec3): Facet {
    const l = this.toLocal(p);
    const cy = this.half.y;
    const nx = Math.abs(l.x) / Math.max(0.05, this.spec.width / 2);
    const ny = Math.abs(l.y - cy) / Math.max(0.05, this.half.y);
    const nz = Math.abs(l.z) / Math.max(0.05, this.half.z);
    if (ny >= nx && ny >= nz) return l.y > cy ? 'top' : 'belly';
    if (nx >= nz) return l.x > 0 ? 'right' : 'left';
    return l.z < 0 ? 'front' : 'rear';
  }

  damage(o: {
    amount: number;
    facet: Facet;
    kind: HitKind;
    attacker: BotSim | null;
    point: Vec3;
    dir: Vec3;
    energy: number;
    threat: Threat;
    severity: number;
  }): number {
    const host = this.host;
    const mat = ARMOR[this.spec.loadout.armor.material];
    const resist = o.threat === 'spinner' ? mat.vsSpinner : o.threat === 'saw' ? mat.vsSaw : mat.vsBlunt;
    let amount = (o.amount * DAMAGE_SCALE) / resist;
    let total = 0;
    const f = o.facet;
    const before = this.facets[f];
    if (before > 0) {
      const absorbed = Math.min(before, amount);
      this.facets[f] = before - absorbed;
      total += absorbed;
      amount -= absorbed;
      // A little shock always gets through.
      amount += absorbed * 0.1;
      if (this.facets[f] <= 0) this.panelOff(f, o.point, o.dir, o.energy);
    } else {
      amount *= 1.15;
    }
    if (amount > 0.01) {
      const behind = BEHIND[f];
      const primary = host.rng.chance(0.7) ? behind[0] : host.rng.pick(behind);
      total += this.damagePart(primary, amount * 0.75, o.attacker);
      const other = behind.find((c) => c !== primary) ?? primary;
      total += this.damagePart(other, amount * 0.25, o.attacker);
      if (primary === 'battery' || other === 'battery') this.maybeIgnite(amount);
    }
    this.stats.damageTaken += total;
    host.credit(o.attacker, this, total, o.attacker === null);
    host.emit({
      type: 'hit',
      t: host.t,
      kind: o.kind,
      attacker: o.attacker ? o.attacker.id : null,
      victim: this.id,
      point: o.point,
      dir: o.dir,
      energy: o.energy,
      facet: f,
      damage: total,
      severity: o.severity,
      material: this.spec.loadout.armor.material,
    });
    if (o.energy > 600 * this.mScale && mat.sparks > 0) {
      host.emit({ type: 'shrapnel', t: host.t, bot: this.id, point: o.point, dir: o.dir, count: Math.round(2 + o.severity * 12), material: this.spec.loadout.armor.material });
    }
    return total;
  }

  damagePart(c: Component, amount: number, _by: BotSim | null): number {
    const host = this.host;
    const max = this.spec.componentHp[c];
    const before = this.parts[c];
    if (before <= 0) return 0;
    const after = Math.max(0, before - amount);
    this.parts[c] = after;
    const b = before / max;
    const a = after / max;
    if (b >= 0.35 && a < 0.35 && c !== 'electronics') host.emit({ type: 'smoke_start', t: host.t, bot: this.id });
    if (after <= 0) {
      host.emit({ type: 'component_down', t: host.t, bot: this.id, component: c });
      if (c === 'electronics') this.disable('radio');
      if (c === 'battery') this.disable('battery');
      if (c === 'weapon') {
        this.armed = false;
      }
    }
    return before - after;
  }

  private maybeIgnite(amount: number): void {
    const pw = POWER[this.spec.loadout.power];
    if (this.fire > 0 || pw.fireRisk <= 0) return;
    if (this.frac('battery') > 0.45) return;
    const p = pw.fireRisk * clamp01(amount / (25 * this.mScale));
    if (this.host.rng.chance(p)) {
      this.fire = 1;
      this.fireTimer = this.host.rng.range(7, 14);
      this.host.emit({ type: 'fire_start', t: this.host.t, bot: this.id });
    }
  }

  private panelOff(f: Facet, point: Vec3, dir: Vec3, energy: number): void {
    const host = this.host;
    const panels = this.spec.panels.map((p, i) => ({ p, i })).filter(({ p }) => p.facet === f);
    let first = -1;
    for (const { p, i } of panels) {
      const pos = this.toWorld(p.center);
      const rot = this.body.rotation();
      const pr = p.rot;
      const quat = {
        w: rot.w * pr.w - rot.x * pr.x - rot.y * pr.y - rot.z * pr.z,
        x: rot.w * pr.x + rot.x * pr.w + rot.y * pr.z - rot.z * pr.y,
        y: rot.w * pr.y - rot.x * pr.z + rot.y * pr.w + rot.z * pr.x,
        z: rot.w * pr.z + rot.x * pr.y - rot.y * pr.x + rot.z * pr.w,
      };
      const speed = clamp(Math.sqrt(energy / Math.max(1, this.spec.massKg)) * 2.2, 2, 11);
      const id = host.spawnDebris({
        bot: this.id,
        kind: 'panel',
        facet: f,
        index: i,
        pos,
        quat,
        size: vec(p.w, p.h, Math.max(0.006, p.t)),
        vel: add(add(scale(norm(dir), speed), vec(0, speed * 0.5, 0)), this.body.linvel()),
        spin: vec(host.rng.range(-14, 14), host.rng.range(-14, 14), host.rng.range(-14, 14)),
      });
      if (first < 0) first = id;
      void point;
    }
    host.emit({ type: 'panel_off', t: host.t, bot: this.id, facet: f, debris: first });
  }

  disable(reason: 'radio' | 'battery' | 'ko' | 'tapout'): void {
    if (this.disabled) return;
    this.disabled = true;
    this.disabledReason = reason;
    this.armed = false;
  }

  private burn(dt: number): void {
    if (this.fire > 0) {
      this.fireTimer -= dt;
      this.damagePart('battery', 1.2 * this.mScale * dt, null);
      this.damagePart('electronics', 0.35 * this.mScale * dt, null);
      if (this.fireTimer <= 0 || this.parts.battery <= 0) this.fire = Math.max(0, this.fire - dt * 0.5);
    }
    let smoke = 0;
    for (const c of ['driveL', 'driveR', 'weapon'] as Component[]) {
      const f = this.frac(c);
      if (f < 0.35) smoke = Math.max(smoke, (0.35 - f) / 0.35);
    }
    if (this.frac('battery') < 0.3) smoke = Math.max(smoke, 0.7);
    if (this.fire > 0) smoke = 1;
    this.smoke = smoke;
  }

  private drain(dt: number, _cmd: DriveCommand): void {
    const dr = DRIVES[this.spec.loadout.drive];
    const effort = (Math.abs(this.driveL) + Math.abs(this.driveR)) / 2;
    const w = (dr.watts * effort + 25) * this.mScale;
    this.charge = Math.max(0, this.charge - w * dt);
  }

  // ------------------------------------------------------------------ output

  frame(): BotFrame {
    const b = this.body;
    const fac = {} as Record<Facet, number>;
    for (const f of FACETS) fac[f] = this.facetFrac(f);
    const parts = {} as Record<Component, number>;
    for (const c of COMPONENTS) parts[c] = this.frac(c);
    const arm = this.armSpec;
    const sp = this.spinnerSpec;
    return {
      id: this.id,
      pos: b.translation(),
      quat: b.rotation(),
      vel: b.linvel(),
      angVel: b.angvel(),
      wheelSpin: this.wheelSpin.slice(),
      wheelContact: this.wheelContact.slice(),
      wheelLost: this.wheelLost.slice(),
      driveL: this.driveL,
      driveR: this.driveR,
      weapon: {
        angle: sp ? this.spinAngle : arm ? arm.restAngle + (arm.maxAngle - arm.restAngle) * this.arm : 0,
        rpm: (this.omega * 60) / (Math.PI * 2),
        spin01: this.spin01,
        armed: this.armed,
        arm: this.arm,
        ready: sp ? this.parts.weapon > 0 : this.armPhase === 'rest' && this.cooldown <= 0 && (arm?.kind === 'lifter' || this.shots > 0) && this.parts.weapon > 0,
        shotsLeft: this.shots,
      },
      facets: fac,
      parts,
      charge: this.charge / this.chargeMax,
      smoke: this.smoke,
      fire: this.fire,
      inverted: this.inverted,
      disabled: this.disabled,
      koCount: this.koCount,
      holdTime: this.holdTime,
    };
  }

  /** Damage fractions to carry into the next fight. */
  carried(): { facets: Record<Facet, number>; parts: Record<Component, number> } {
    const facets = {} as Record<Facet, number>;
    for (const f of FACETS) facets[f] = this.facetFrac(f);
    const parts = {} as Record<Component, number>;
    for (const c of COMPONENTS) parts[c] = this.frac(c);
    return { facets, parts };
  }
}
