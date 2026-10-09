// A fight in the Box: Rapier world, robots, hazards, the rules (countdown, knockout count, holds,
// clock) and the judges. Steps at a fixed 120 Hz; output is plain WorldFrames and MatchEvents.

import type { Collider, EventQueue, RigidBody, World } from '@dimforge/rapier3d-compat';
import type {
  DebrisFrame,
  DriveCommand,
  Entrant,
  Facet,
  MatchEvent,
  MatchPhase,
  MatchResult,
  MatchStats,
  Vec3,
  WorldFrame,
} from '../contract';
import { ARENA_HALF, LEXAN_TOP, SPIKESTRIPS, START_SQUARES, WALL_T } from '../data/arena';
import { careerRivalById } from '../data/campaign';
import type { AiStyle } from '../data/roster';
import { BotAi, type AiScript } from './ai';
import { BotSim, type SimHost } from './bot';
import { Hazards } from './hazards';
import { judge } from './judges';
import { add, clamp01, dot, len, norm, rotate, scale, sub, vec } from './math';
import type { Rapier } from './rapier';
import { Rng } from './rng';

export const SIM_DT = 1 / 120;
const MAX_DEBRIS = 24;

type ArenaKind = 'floor' | 'wall' | 'ceiling' | 'spikestrip';

interface Debris {
  id: number;
  bot: string;
  kind: DebrisFrame['kind'];
  facet?: Facet;
  index?: number;
  size: Vec3;
  body: RigidBody;
  born: number;
}

export interface MatchOptions {
  entrants: Entrant[];
  /** Fight length in seconds. */
  length: number;
  seed: number;
  /** AI styles by entrant id (defaults from the roster or 'aggressive'). */
  styles?: Record<string, AiStyle>;
  /** Start positions by entrant id (scripted scenes); otherwise each corner's square. */
  positions?: Record<string, { x: number; z: number; yaw: number }>;
}

export class Match implements SimHost {
  readonly world: World;
  readonly rng: Rng;
  readonly bots: BotSim[] = [];
  t = 0;
  phase: MatchPhase = 'idle';
  clock: number;
  lights: 0 | 1 | 2 | 3 | 4 = 0;
  timeScale = 1;
  result: MatchResult | null = null;

  private events: MatchEvent[] = [];
  private queue: EventQueue;
  private arenaKind = new Map<number, ArenaKind>();
  private bodyBot = new Map<number, BotSim>();
  private hazards: Hazards;
  private ai = new Map<string, BotAi>();
  private debris: Debris[] = [];
  private nextDebris = 1;
  private countdownT = 0;
  private acc = 0;
  private fightStart = 0;
  private touching = new Map<string, number>();
  private preVel = new Map<string, { lin: Vec3; ang: Vec3; pos: Vec3 }>();
  private clockSec = -1;
  private stats: Record<string, MatchStats> = {};
  private overTimer = -1;

  constructor(
    readonly R: Rapier,
    private opts: MatchOptions,
  ) {
    this.rng = new Rng(opts.seed);
    this.clock = opts.length;
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = SIM_DT;
    this.world.numSolverIterations = 6;
    this.queue = new R.EventQueue(true);
    this.buildArena();
    for (const e of opts.entrants) {
      const sq = START_SQUARES.find((s) => s.corner === e.corner) ?? START_SQUARES[0];
      const at = opts.positions?.[e.id];
      const start = at ? { pos: { x: at.x, y: 0, z: at.z }, yaw: at.yaw } : { pos: sq.center, yaw: sq.yaw };
      const bot = new BotSim(this, e.id, e.spec, e.corner, e.control, start, e.carried);
      this.bots.push(bot);
      this.bodyBot.set(bot.body.handle, bot);
      this.stats[e.id] = bot.stats;
      if (e.control === 'ai') {
        const style = opts.styles?.[e.id] ?? careerRivalById(e.id)?.style ?? 'aggressive';
        this.ai.set(e.id, new BotAi(bot, style, e.skill, new Rng(opts.seed * 31 + this.bots.length)));
      }
    }
    this.hazards = new Hazards(this);
  }

  // ------------------------------------------------------------------ SimHost

  emit(e: MatchEvent): void {
    this.events.push(e);
  }

  botOfBody(body: RigidBody | null): BotSim | undefined {
    return body ? this.bodyBot.get(body.handle) : undefined;
  }

  spawnDebris(d: Parameters<SimHost['spawnDebris']>[0]): number {
    const { R, world } = this;
    const id = this.nextDebris++;
    const body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(d.pos.x, Math.max(d.pos.y, 0.05), d.pos.z)
        .setRotation(d.quat)
        .setLinvel(d.vel.x, d.vel.y, d.vel.z)
        .setAngvel(d.spin)
        .setLinearDamping(0.15)
        .setAngularDamping(0.4)
        .setCcdEnabled(true),
    );
    const desc =
      d.kind === 'wheel'
        ? R.ColliderDesc.cylinder(d.size.x / 2, d.size.y / 2).setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 })
        : R.ColliderDesc.cuboid(Math.max(0.004, d.size.x / 2), Math.max(0.004, d.size.y / 2), Math.max(0.003, d.size.z / 2));
    const density = d.kind === 'chunk' ? 2700 : d.kind === 'wheel' ? 900 : 1600;
    desc.setDensity(density).setFriction(0.5).setRestitution(0.25);
    world.createCollider(desc, body);
    this.debris.push({ id, bot: d.bot, kind: d.kind, facet: d.facet, index: d.index, size: d.size, body, born: this.t });
    while (this.debris.length > MAX_DEBRIS) {
      const old = this.debris.shift()!;
      world.removeRigidBody(old.body);
    }
    return id;
  }

  credit(attacker: BotSim | null, victim: BotSim, damage: number, hazard: boolean): void {
    let by = attacker;
    if (!by && hazard && victim.lastTouchBy && this.t - victim.lastTouchT < 2.5) by = victim.lastTouchBy;
    if (!by || by === victim) return;
    by.stats.damageDealt += damage;
    if (hazard) by.stats.hazardDamageDealt += damage;
    else by.stats.hits++;
  }

  // ------------------------------------------------------------------ setup

  private buildArena(): void {
    const { R, world } = this;
    const ground = world.createRigidBody(R.RigidBodyDesc.fixed());
    const add = (desc: InstanceType<Rapier['ColliderDesc']>, kind: ArenaKind) => {
      desc.setFriction(0.6).setRestitution(0.15);
      const c = world.createCollider(desc, ground);
      this.arenaKind.set(c.handle, kind);
      return c;
    };
    const H = ARENA_HALF;
    add(R.ColliderDesc.cuboid(H + WALL_T * 2, 0.5, H + WALL_T * 2).setTranslation(0, -0.5, 0), 'floor');
    const wallH = LEXAN_TOP / 2;
    add(R.ColliderDesc.cuboid(WALL_T / 2, wallH, H + WALL_T).setTranslation(H + WALL_T / 2, wallH, 0), 'wall');
    add(R.ColliderDesc.cuboid(WALL_T / 2, wallH, H + WALL_T).setTranslation(-H - WALL_T / 2, wallH, 0), 'wall');
    add(R.ColliderDesc.cuboid(H + WALL_T, wallH, WALL_T / 2).setTranslation(0, wallH, H + WALL_T / 2), 'wall');
    add(R.ColliderDesc.cuboid(H + WALL_T, wallH, WALL_T / 2).setTranslation(0, wallH, -H - WALL_T / 2), 'wall');
    add(R.ColliderDesc.cuboid(H + WALL_T, 0.2, H + WALL_T).setTranslation(0, LEXAN_TOP + 0.2, 0), 'ceiling');
    for (const s of SPIKESTRIPS) {
      const x = (s.wall === 'east' ? 1 : -1) * (H - s.reach / 2);
      add(
        R.ColliderDesc.cuboid(s.reach / 2, s.height / 2, (s.z1 - s.z0) / 2).setTranslation(x, s.height / 2, (s.z0 + s.z1) / 2),
        'spikestrip',
      ).setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
    }
  }

  // ------------------------------------------------------------------ control

  startCountdown(): void {
    if (this.phase !== 'idle') return;
    this.phase = 'countdown';
    this.countdownT = 0;
  }

  /** Skip straight into the fight (tests and quick starts). */
  startFight(): void {
    this.phase = 'fight';
    this.lights = 4;
    this.fightStart = this.t;
    this.emit({ type: 'fight_start', t: this.t });
  }

  setCommand(id: string, cmd: DriveCommand): void {
    const b = this.bots.find((x) => x.id === id);
    if (b && b.control === 'player') b.cmd = cmd;
  }

  /** Script an AI driver for a cinematic (see AiScript), or null to hand it back to the AI. */
  setAiScript(id: string, script: AiScript | null): void {
    const ai = this.ai.get(id);
    if (ai) ai.script = script;
  }

  /**
   * A scripted, catastrophic hit for cinematics: the victim is thrown (launched high, flipped
   * over, or slammed sideways), loses armor and parts, and catches fire. Uses the same damage
   * and impulse paths as a real hit, so every effect, sound and camera beat follows.
   */
  finisher(attackerId: string, victimId: string, style: 'launch' | 'flip' | 'slam', opts: { fire?: boolean; kill?: boolean } = {}): void {
    const a = this.bot(attackerId);
    const v = this.bot(victimId);
    if (!a || !v) return;
    const m = v.spec.massKg;
    const ap = a.pos;
    const vp = v.pos;
    let dir = norm(vec(vp.x - ap.x, 0, vp.z - ap.z));
    if (len(dir) < 0.5) dir = vec(1, 0, 0);
    const point = vec(vp.x - dir.x * v.half.z * 0.8, vp.y + v.half.y * 0.6, vp.z - dir.z * v.half.z * 0.8);
    const side = vec(-dir.z, 0, dir.x);
    if (style === 'launch') {
      v.body.applyImpulseAtPoint(vec(dir.x * m * 3.2, m * 8.8, dir.z * m * 3.2), point, true);
      v.body.applyTorqueImpulse(scale(side, m * 1.6), true);
    } else if (style === 'flip') {
      v.body.applyImpulseAtPoint(vec(dir.x * m * 1.6, m * 6.2, dir.z * m * 1.6), point, true);
      v.body.applyTorqueImpulse(scale(side, m * 1.1), true);
    } else {
      v.body.applyImpulseAtPoint(vec(dir.x * m * 8.5, m * 1.6, dir.z * m * 8.5), point, true);
      v.body.applyTorqueImpulse(vec(0, m * 0.8, 0), true);
    }
    const energy = 30000 * v.mScale;
    const facing = v.facetAt(point);
    v.damage({ amount: v.spec.facetHp[facing] * 3, facet: facing, kind: style === 'flip' ? 'flip' : 'spinner', attacker: a, point, dir, energy, threat: 'spinner', severity: 1 });
    v.damage({ amount: v.spec.facetHp.top * 2, facet: 'top', kind: 'spinner', attacker: a, point: vec(vp.x, vp.y + v.half.y * 2, vp.z), dir, energy: energy * 0.4, threat: 'spinner', severity: 0.6 });
    const flank: Facet = this.rng.chance(0.5) ? 'left' : 'right';
    v.damage({ amount: v.spec.facetHp[flank] * 2, facet: flank, kind: 'spinner', attacker: a, point, dir, energy: energy * 0.3, threat: 'spinner', severity: 0.5 });
    if (opts.kill) {
      v.damagePart('weapon', 1e6, a);
      v.damagePart('electronics', 1e6, a);
    }
    if (opts.fire && v.fire <= 0) {
      v.fire = 1;
      v.fireTimer = 30;
      this.emit({ type: 'fire_start', t: this.t, bot: v.id });
    }
    v.lastTouchBy = a;
    v.lastTouchT = this.t;
  }

  /** End the fight now: this robot is counted out. */
  forceKo(id: string): void {
    const b = this.bot(id);
    if (!b || this.phase === 'over') return;
    b.koCount = null;
    b.disabled = false;
    b.disable('ko');
    this.emit({ type: 'ko', t: this.t, bot: b.id });
    this.checkEnd();
  }

  tapOut(id: string): void {
    const b = this.bots.find((x) => x.id === id);
    if (!b || this.phase !== 'fight') return;
    b.disable('tapout');
    this.finish(this.bots.find((x) => x !== b && !x.disabled)?.id ?? null, 'tapout');
  }

  bot(id: string): BotSim | undefined {
    return this.bots.find((b) => b.id === id);
  }

  /** Advance by real seconds; steps the sim at a fixed rate scaled by timeScale. */
  advance(realDt: number): void {
    this.acc += Math.min(0.1, realDt) * this.timeScale;
    let n = 0;
    while (this.acc >= SIM_DT && n < 16) {
      this.step();
      this.acc -= SIM_DT;
      n++;
    }
  }

  drainEvents(): MatchEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ------------------------------------------------------------------ step

  step(): void {
    const dt = SIM_DT;
    this.t += dt;
    this.updatePhase(dt);
    const fighting = this.phase === 'fight';

    for (const b of this.bots) {
      this.preVel.set(b.id, { lin: b.body.linvel(), ang: b.body.angvel(), pos: b.body.translation() });
      if (fighting) {
        const ai = this.ai.get(b.id);
        if (ai) b.cmd = ai.update(dt, this.bots);
      }
    }
    for (const b of this.bots) {
      b.prestep(dt, fighting);
      // Button presses are edges: one step consumes them, even when a frame runs several steps.
      if (b.control === 'player' && b.cmd.weaponPressed) b.cmd = { ...b.cmd, weaponPressed: false };
    }
    this.hazards.step(dt, fighting);

    this.world.step(this.queue);

    this.queue.drainCollisionEvents((h1, h2, started) => this.onCollision(h1, h2, started));
    if (fighting || this.phase === 'over') this.weaponContacts();
    this.rules(dt, fighting);
    this.cleanupDebris();
  }

  private updatePhase(dt: number): void {
    if (this.phase === 'countdown') {
      const before = this.countdownT;
      this.countdownT += dt;
      const lit = (n: number) => before < n && this.countdownT >= n;
      if (lit(0.5)) this.setLights(1);
      if (lit(1.5)) this.setLights(2);
      if (lit(2.5)) this.setLights(3);
      if (lit(3.5)) {
        this.setLights(4);
        this.phase = 'fight';
        this.fightStart = this.t;
        this.emit({ type: 'fight_start', t: this.t });
      }
    } else if (this.phase === 'fight') {
      this.clock = Math.max(0, this.opts.length - (this.t - this.fightStart));
      const sec = Math.ceil(this.clock);
      if (sec !== this.clockSec) {
        this.clockSec = sec;
        this.emit({ type: 'clock', t: this.t, remaining: sec });
      }
      if (this.clock <= 0) {
        this.emit({ type: 'time_up', t: this.t });
        this.decide();
      }
    }
  }

  private setLights(n: 1 | 2 | 3 | 4): void {
    this.lights = n;
    this.emit({ type: 'lights', t: this.t, lights: n });
  }

  // ------------------------------------------------------------------ contacts

  private colliderOwner(h: number): { bot?: BotSim; arena?: ArenaKind; collider: Collider } | null {
    const c = this.world.getCollider(h);
    if (!c) return null;
    const arena = this.arenaKind.get(h);
    if (arena) return { arena, collider: c };
    const bot = this.botOfBody(c.parent());
    return bot ? { bot, collider: c } : null;
  }

  /** World contact point and normal (from c1 toward c2) for a touching pair. */
  private contact(c1: Collider, c2: Collider): { point: Vec3; normal: Vec3; depth: number } | null {
    let out: { point: Vec3; normal: Vec3; depth: number } | null = null;
    this.world.contactPair(c1, c2, (m, flipped) => {
      if (out || m.numContacts() === 0) return;
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < m.numContacts(); i++) {
        const d = m.contactDist(i);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      const n = m.normal();
      const first = flipped ? c2 : c1;
      const lp = m.localContactPoint1(best);
      if (!lp) return;
      const p = add(first.translation(), rotate(first.rotation(), lp));
      out = { point: p, normal: flipped ? scale(n, -1) : n, depth: -bestD };
    });
    return out;
  }

  private pairKey(a: BotSim, b: BotSim): string {
    return a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
  }

  private onCollision(h1: number, h2: number, started: boolean): void {
    const o1 = this.colliderOwner(h1);
    const o2 = this.colliderOwner(h2);
    if (!o1 || !o2) return;
    if (o1.bot && o2.bot && o1.bot !== o2.bot) {
      const key = this.pairKey(o1.bot, o2.bot);
      this.touching.set(key, Math.max(0, (this.touching.get(key) ?? 0) + (started ? 1 : -1)));
      if (!started) return;
      o1.bot.lastTouchBy = o2.bot;
      o1.bot.lastTouchT = this.t;
      o2.bot.lastTouchBy = o1.bot;
      o2.bot.lastTouchT = this.t;
      if (o1.collider === o1.bot.weaponCollider && o1.bot.isSpinner) return;
      if (o2.collider === o2.bot.weaponCollider && o2.bot.isSpinner) return;
      this.ram(o1.bot, o1.collider, o2.bot, o2.collider);
      return;
    }
    if (!started) return;
    const bot = o1.bot ?? o2.bot;
    const arena = o1.arena ?? o2.arena;
    const bc = o1.bot ? o1.collider : o2.collider;
    const ac = o1.arena ? o1.collider : o2.collider;
    if (!bot || !arena || arena === 'floor') return;
    if (bc === bot.weaponCollider && bot.isSpinner) return;
    this.wallHit(bot, bc, ac, arena);
  }

  private ram(a: BotSim, ca: Collider, b: BotSim, cb: Collider): void {
    const c = this.contact(ca, cb);
    if (!c || this.phase !== 'fight') return;
    const pa = this.preVel.get(a.id)!;
    const pb = this.preVel.get(b.id)!;
    const n = norm(c.normal); // from a toward b
    const va = dot(pa.lin, n);
    const vb = dot(pb.lin, n);
    const closing = va - vb;
    if (closing < 0.9) return;
    const mRed = (a.spec.massKg * b.spec.massKg) / (a.spec.massKg + b.spec.massKg);
    const E = 0.5 * mRed * closing * closing;
    // The faster robot is the rammer.
    const attacker = va >= -vb ? a : b;
    const victim = attacker === a ? b : a;
    const dir = attacker === a ? n : scale(n, -1);
    const spikes = attacker.spec.loadout.extras.includes('spikes') ? 3 : 1;
    const sev = clamp01(E / (2500 * victim.mScale)) * 0.6;
    victim.damage({ amount: (E / 100) * 0.55 * spikes, facet: victim.facetAt(c.point), kind: 'ram', attacker, point: c.point, dir, energy: E, threat: 'blunt', severity: sev });
    attacker.damagePart('electronics', (E / 100) * 0.02, null);
    if (E > 300 * victim.mScale) victim.stats.damageTaken += 0;
  }

  private wallHit(bot: BotSim, bc: Collider, ac: Collider, kind: ArenaKind): void {
    if (this.phase !== 'fight') return;
    const c = this.contact(bc, ac);
    if (!c) return;
    const pre = this.preVel.get(bot.id)!;
    const n = norm(c.normal); // bot toward wall
    const v = dot(pre.lin, n);
    if (v < 1.1) return;
    const E = 0.5 * bot.spec.massKg * v * v;
    const spikes = kind === 'spikestrip';
    const amount = (E / 100) * (spikes ? 1.3 : 0.3) + (spikes ? 7 * bot.mScale : 0);
    const sev = clamp01(E / (2200 * bot.mScale)) * (spikes ? 0.8 : 0.5);
    bot.damage({
      amount,
      facet: bot.facetAt(c.point),
      kind: spikes ? 'spikestrip' : 'wall',
      attacker: null,
      point: c.point,
      dir: scale(n, -1),
      energy: E,
      threat: spikes ? 'saw' : 'blunt',
      severity: sev,
    });
  }

  /** Spinner bites: check every spinning weapon against everything it touches. */
  private weaponContacts(): void {
    for (const a of this.bots) {
      const wc = a.weaponCollider;
      if (!wc || !a.isSpinner || a.omega <= 1) continue;
      const pa = this.preVel.get(a.id)!;
      for (const b of this.bots) {
        if (b === a) continue;
        for (const cb of b.colliders) {
          if (!cb.isEnabled()) continue;
          const c = this.contact(wc, cb);
          if (!c || c.depth < -0.004) continue;
          const pb = this.preVel.get(b.id)!;
          const toB = norm(sub(b.pos, a.toWorld(a.spinnerSpec!.center)));
          const closing = Math.max(0, dot(sub(pa.lin, pb.lin), toB));
          a.spinnerContact(b, c.point, cb === b.weaponCollider, closing);
          break;
        }
      }
      // Walls, spikes and floor.
      this.world.contactPairsWith(wc, (other) => {
        const kind = this.arenaKind.get(other.handle);
        if (!kind) return;
        const c = this.contact(wc, other);
        if (!c || c.depth < -0.004) return;
        a.spinnerArena(c.point, scale(norm(c.normal), -1), kind === 'floor');
      });
    }
  }

  // ------------------------------------------------------------------ rules

  private rules(dt: number, fighting: boolean): void {
    for (const b of this.bots) {
      const p = b.pos;
      const v = b.body.linvel();
      // Airborne and landing.
      const height = b.lowestPoint();
      if (!b.airborne && height > 0.25 * b.spec.scale + 0.1 && b.wheelsDown === 0) {
        b.airborne = true;
        b.airPeak = height;
        this.emit({ type: 'airborne', t: this.t, bot: b.id, height });
      }
      if (b.airborne) {
        b.airPeak = Math.max(b.airPeak, height);
        if (height < 0.03 && v.y > -0.5) {
          b.airborne = false;
          const speed = Math.abs(b.lastVy);
          this.emit({ type: 'landed', t: this.t, bot: b.id, speed });
          if (fighting && speed > 3.5) {
            const E = 0.5 * b.spec.massKg * speed * speed;
            b.damage({
              amount: (E / 100) * 0.12,
              facet: b.inverted ? 'top' : 'belly',
              kind: 'floor',
              attacker: null,
              point: vec(p.x, 0.02, p.z),
              dir: vec(0, 1, 0),
              energy: E,
              threat: 'blunt',
              severity: clamp01(speed / 12),
            });
          }
        }
      }
      b.lastVy = v.y;
      if (!fighting) continue;
      this.knockout(b, dt);
      // Aggression: closing on an opponent.
      const foe = this.nearestFoe(b);
      if (foe) {
        const to = sub(foe.pos, p);
        const d = len(to);
        if (d < 3.2 && dot(v, norm(to)) > 0.4) b.stats.attackTime += dt;
        if (b.isSpinner && b.spin01 > 0.6 && d < 3.2) b.stats.attackTime += dt * 0.3;
      }
    }
    if (fighting) this.holds(dt);
    if (fighting) this.checkEnd();
    if (this.phase === 'over' && this.overTimer >= 0) this.overTimer += dt;
  }

  private nearestFoe(b: BotSim): BotSim | undefined {
    let best: BotSim | undefined;
    let bd = Infinity;
    for (const o of this.bots) {
      if (o === b || o.disabled) continue;
      const d = len(sub(o.pos, b.pos));
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  /** The 10 count: a robot that cannot move under its own power gets counted out. */
  private knockout(b: BotSim, dt: number): void {
    if (b.disabledReason === 'ko' || b.disabledReason === 'tapout') return;
    const held = this.bots.some((o) => o !== b && o.holdTime !== null && this.isTouching(o, b));
    const p = b.pos;
    let immobile = !b.driveCapable || b.helpless;
    // Trying to drive but not going anywhere (high-centered, wedged on a wall).
    const commanding = Math.abs(b.cmd.throttle) > 0.3 || Math.abs(b.cmd.turn) > 0.3 || b.control === 'ai';
    const speed = len(b.body.linvel());
    if (!immobile && commanding && speed < 0.06 && Math.abs(b.body.angvel().y) < 0.15) {
      b.stuckTime += dt;
      if (b.stuckTime > 3) immobile = true;
    } else if (speed > 0.2) b.stuckTime = 0;
    if (held || b.airborne) immobile = false;

    if (b.koCount === null) {
      if (immobile) {
        b.immobileTime += dt;
        if (b.immobileTime > (b.disabled ? 0.4 : 1.2)) {
          b.koCount = 10;
          b.stillAnchor = { x: p.x, y: 0, z: p.z };
          this.emit({ type: 'ko_count', t: this.t, bot: b.id, n: 10 });
        }
      } else b.immobileTime = 0;
      return;
    }
    // Counting: moving half a meter under power clears it.
    const movedAway = Math.hypot(p.x - b.stillAnchor.x, p.z - b.stillAnchor.z) > 0.5;
    if (!immobile && b.driveCapable && movedAway) {
      b.koCount = null;
      b.immobileTime = 0;
      b.stuckTime = 0;
      this.emit({ type: 'ko_clear', t: this.t, bot: b.id });
      return;
    }
    const before = Math.ceil(b.koCount);
    b.koCount = Math.max(0, b.koCount - dt);
    const now = Math.ceil(b.koCount);
    if (now !== before && now > 0) this.emit({ type: 'ko_count', t: this.t, bot: b.id, n: now });
    if (b.koCount <= 0) {
      b.disabled = false;
      b.disable('ko');
      b.koCount = null;
      this.emit({ type: 'ko', t: this.t, bot: b.id });
    }
  }

  private isTouching(a: BotSim, b: BotSim): boolean {
    return (this.touching.get(this.pairKey(a, b)) ?? 0) > 0;
  }

  /** Lifts and pins are limited to 10 seconds. */
  private holds(dt: number): void {
    for (const a of this.bots) {
      let holding = false;
      for (const b of this.bots) {
        if (a === b || !this.isTouching(a, b)) continue;
        const lifted = b.wheelsDown < Math.max(1, b.spec.wheels.length / 2) && !b.airborne;
        const lifter = a.armSpec?.kind === 'lifter' && a.arm > 0.4;
        if (lifted && (lifter || a.wheelsDown > 0) && !(b.inverted && !b.spec.invertible)) holding = true;
      }
      if (holding) {
        a.holdTime = (a.holdTime ?? 0) + dt;
        a.stats.controlTime += dt;
        if (a.holdTime > 8 && a.holdTime - dt <= 8) {
          const victim = this.nearestFoe(a);
          this.emit({ type: 'hold_warn', t: this.t, bot: a.id, victim: victim?.id ?? '' });
        }
        if (a.holdTime >= 10) {
          a.cutUntil = this.t + 2;
          a.holdTime = null;
          a.arm = a.armSpec?.kind === 'lifter' ? 0 : a.arm;
          this.emit({ type: 'release', t: this.t, bot: a.id });
        }
      } else if (a.holdTime !== null) {
        a.holdTime = Math.max(0, a.holdTime - dt * 2);
        if (a.holdTime <= 0) a.holdTime = null;
      }
    }
  }

  private checkEnd(): void {
    if (this.phase !== 'fight') return;
    // Dead robots still get counted out; only the count or a tap out ends a fight.
    const alive = this.bots.filter((b) => b.disabledReason !== 'ko' && b.disabledReason !== 'tapout');
    if (this.bots.length >= 2 && alive.length <= 1) {
      const method = this.bots.length > 2 ? 'last_standing' : 'ko';
      this.finish(alive[0]?.id ?? null, method);
    }
  }

  private decide(): void {
    const alive = this.bots.filter((b) => !b.disabled);
    const standing = this.bots.filter((b) => b.disabledReason !== 'ko' && b.disabledReason !== 'tapout');
    if (alive.length === 1 && standing.length === 2) {
      this.finish(alive[0].id, 'ko');
      return;
    }
    if (alive.length === 2) {
      const [a, b] = alive;
      const { cards, totals } = judge(a.id, a.stats, b.id, b.stats, this.rng);
      const winner = totals[a.id] > totals[b.id] ? a.id : b.id;
      this.finish(winner, 'decision', cards, totals);
      return;
    }
    // Rumble at time: most damage dealt among those still moving.
    const best = alive.sort((x, y) => y.stats.damageDealt + y.stats.attackTime - (x.stats.damageDealt + x.stats.attackTime))[0];
    this.finish(best?.id ?? null, 'decision');
  }

  private finish(winner: string | null, method: MatchResult['method'], judges?: MatchResult['judges'], totals?: Record<string, number>): void {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.overTimer = 0;
    for (const b of this.bots) b.armed = false;
    this.result = {
      winner,
      method,
      time: Math.min(this.opts.length, this.t - this.fightStart),
      judges,
      totals,
      stats: this.stats,
    };
    this.emit({ type: 'match_over', t: this.t, result: this.result });
  }

  // ------------------------------------------------------------------ output

  private cleanupDebris(): void {
    // Debris that leaves the arena (it should not, but tunneling happens) is removed.
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      const p = d.body.translation();
      if (Math.abs(p.x) > ARENA_HALF + 2 || Math.abs(p.z) > ARENA_HALF + 2 || p.y < -2) {
        this.world.removeRigidBody(d.body);
        this.debris.splice(i, 1);
      }
    }
  }

  frame(): WorldFrame {
    return {
      t: this.t,
      bots: this.bots.map((b) => b.frame()),
      debris: this.debris.map((d) => ({
        id: d.id,
        bot: d.bot,
        kind: d.kind,
        facet: d.facet,
        index: d.index,
        pos: d.body.translation(),
        quat: d.body.rotation(),
        size: d.size,
      })),
      hazards: this.hazards.frames(),
      match: { phase: this.phase, clock: this.clock, lights: this.lights, timeScale: this.timeScale },
    };
  }

  dispose(): void {
    this.queue.free();
    this.world.free();
  }
}
