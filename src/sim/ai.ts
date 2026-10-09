// Rival drivers. Each style plays its hardware the way a real team would: spinners spin up and
// hunt with the weapon edge, wedges and flippers get under, bullies shove toward the hazards,
// lifters carry robots to the Pulverizer. Skill sets reaction time, aim and patience.

import type { DriveCommand, Vec3 } from '../contract';
import { KILLSAWS, PULVERIZERS, RAMRODS, ARENA_HALF } from '../data/arena';
import type { AiStyle } from '../data/roster';
import type { BotSim } from './bot';
import { clamp, lerp, rotate, vec, wrapAngle, yawOf } from './math';
import type { Rng } from './rng';

type Mode = 'spinup' | 'attack' | 'circle' | 'retreat' | 'unstick' | 'carry' | 'push';

const HAZARD_SPOTS: { pos: Vec3; r: number; kind: 'pulv' | 'saw' | 'ram' }[] = [
  ...PULVERIZERS.map((p) => ({ pos: p.center, r: p.radius + 0.2, kind: 'pulv' as const })),
  ...KILLSAWS.map((k) => ({ pos: k.center, r: 0.75, kind: 'saw' as const })),
  ...RAMRODS.map((r) => ({ pos: r.center, r: Math.max(r.hx, r.hz) + 0.2, kind: 'ram' as const })),
];

export type AiScript = 'passive' | 'windup' | 'charge';

export class BotAi {
  mode: Mode = 'spinup';
  private think = 0;
  private aimNoise: Vec3 = vec();
  private unstickTimer = 0;
  private stuckFor = 0;
  private lastPos: Vec3 = vec();
  private carryTime = 0;
  private fireDelay = 0;
  private circleDir: 1 | -1 = 1;
  private selfRightTimer = 0;
  private modeTime = 0;
  private orbitTime = 0;
  private helplessHold = 0;

  constructor(
    private me: BotSim,
    private style: AiStyle,
    private skill: number,
    private rng: Rng,
  ) {
    this.circleDir = rng.chance(0.5) ? 1 : -1;
  }

  /** Cinematic override: 'passive' keeps its distance with the weapon off, 'windup' keeps its
   *  distance while the weapon comes up to speed, 'charge' goes straight for the target. */
  script: AiScript | null = null;

  update(dt: number, bots: BotSim[]): DriveCommand {
    const me = this.me;
    const cmd: DriveCommand = { throttle: 0, turn: 0, weapon: false, weaponPressed: false, selfRight: false };
    if (me.disabled) return cmd;
    if (this.script) return this.scripted(dt, bots, cmd);

    // Upside down and not invertible: right yourself.
    if (me.helpless) {
      this.helplessHold = 1.5;
      this.selfRightTimer -= dt;
      if (this.selfRightTimer <= 0) {
        this.selfRightTimer = lerp(1.4, 0.6, this.skill);
        cmd.selfRight = true;
      }
      cmd.throttle = Math.sin(me.body.translation().x * 7 + this.modeTime * 9) * 0.8;
      this.modeTime += dt;
      return cmd;
    }

    const foes = bots.filter((b) => b !== me && !b.disabled);
    if (foes.length === 0) return cmd;
    const pos = me.pos;
    const foe = foes.reduce((a, b) => (dist(a.pos, pos) < dist(b.pos, pos) ? a : b));
    const fp = foe.pos;
    const d = dist(fp, pos);
    const yaw = yawOf(me.quat);
    const sp = me.spinnerSpec;
    const arm = me.armSpec;
    this.modeTime += dt;

    // Stuck detection.
    const moved = dist(pos, this.lastPos);
    this.lastPos = { x: pos.x, y: pos.y, z: pos.z };
    if (this.mode !== 'unstick') {
      if (moved / Math.max(dt, 1e-3) < 0.12 && Math.abs(me.driveL) + Math.abs(me.driveR) > 0.8) this.stuckFor += dt;
      else this.stuckFor = Math.max(0, this.stuckFor - dt * 2);
      if (this.stuckFor > lerp(1.6, 0.9, this.skill)) {
        this.setMode('unstick');
        this.unstickTimer = 0.8;
        this.stuckFor = 0;
      }
    }

    // Spinners keep the weapon armed, once back on their wheels for a moment.
    this.helplessHold = Math.max(0, this.helplessHold - dt);
    if (sp && !me.armed && me.parts.weapon > 0 && this.helplessHold <= 0) cmd.weaponPressed = true;

    this.think -= dt;
    if (this.think <= 0) {
      this.think = lerp(0.5, 0.12, this.skill) * this.rng.range(0.8, 1.2);
      const spread = lerp(0.55, 0.08, this.skill);
      this.aimNoise = vec(this.rng.gauss() * spread, 0, this.rng.gauss() * spread);
      this.plan(foe, d);
    }

    // Lead the target a little.
    const fv = foe.body.linvel();
    const lead = lerp(0.05, 0.35, this.skill);
    const target = vec(fp.x + fv.x * lead + this.aimNoise.x, 0, fp.z + fv.z * lead + this.aimNoise.z);

    let goal = target;
    let speed = 1;
    let reverseOk = true;
    switch (this.mode) {
      case 'unstick': {
        this.unstickTimer -= dt;
        cmd.throttle = -0.9;
        cmd.turn = this.circleDir * 0.8;
        if (this.unstickTimer <= 0) this.setMode('attack');
        return this.finish(cmd, me);
      }
      case 'spinup': {
        // Keep the opponent at arm's length while the weapon winds up.
        const away = norm2(vec(pos.x - fp.x, 0, pos.z - fp.z));
        const side = vec(-away.z * this.circleDir, 0, away.x * this.circleDir);
        goal = vec(pos.x + (away.x * 0.6 + side.x) * 2, 0, pos.z + (away.z * 0.6 + side.z) * 2);
        speed = d < 2.5 ? 0.9 : 0.5;
        if (me.spin01 > lerp(0.92, 0.7, this.skill) || d > 4.5) this.setMode('attack');
        break;
      }
      case 'circle': {
        const away = norm2(vec(pos.x - fp.x, 0, pos.z - fp.z));
        const side = vec(-away.z * this.circleDir, 0, away.x * this.circleDir);
        const want = 2.2;
        goal = vec(fp.x + away.x * want + side.x * 1.5, 0, fp.z + away.z * want + side.z * 1.5);
        speed = 0.75;
        // Pounce when the opponent shows its side or back.
        const fyaw = yawOf(foe.quat);
        const toMe = Math.atan2(-(pos.x - fp.x), -(pos.z - fp.z));
        const facing = Math.abs(wrapAngle(toMe - fyaw));
        if (facing > 1.4 || this.modeTime > lerp(5, 2.5, this.skill)) this.setMode('attack');
        break;
      }
      case 'retreat': {
        const away = norm2(vec(pos.x - fp.x, 0, pos.z - fp.z));
        goal = vec(pos.x + away.x * 3, 0, pos.z + away.z * 3);
        speed = 1;
        if (this.modeTime > 1.6) this.setMode(sp && me.spin01 < 0.6 ? 'spinup' : 'attack');
        break;
      }
      case 'push': {
        // Get behind the opponent relative to the nearest hazard, then drive through it.
        const hz = nearestHazard(fp);
        const dir = norm2(vec(hz.x - fp.x, 0, hz.z - fp.z));
        const behind = vec(fp.x - dir.x * 1.0, 0, fp.z - dir.z * 1.0);
        const lineUp = dist(pos, behind);
        if (lineUp > 0.9 && d > 0.8) goal = behind;
        else goal = vec(hz.x, 0, hz.z);
        speed = 1;
        reverseOk = false;
        if (this.modeTime > 6) this.setMode('attack');
        break;
      }
      case 'carry': {
        cmd.weapon = true;
        this.carryTime += dt;
        const hz = nearestHazard(pos, 'pulv');
        goal = vec(hz.x, 0, hz.z);
        speed = 0.8;
        reverseOk = false;
        if (this.carryTime > 7.5 || d > 1.6 || me.holdTime === null && this.carryTime > 1.2) {
          this.carryTime = 0;
          this.setMode('retreat');
        }
        break;
      }
      case 'attack':
      default: {
        goal = target;
        speed = 1;
        reverseOk = d < 1.2;
        // Chasing tails: if the opponent stays off the nose at close range, back off and re-aim.
        const want = Math.atan2(-(target.x - pos.x), -(target.z - pos.z));
        const off = Math.abs(wrapAngle(want - yaw));
        if (d < 1.8 && off > 0.9) this.orbitTime += dt;
        else this.orbitTime = Math.max(0, this.orbitTime - dt * 2);
        if (this.orbitTime > lerp(2.2, 1.0, this.skill)) {
          this.orbitTime = 0;
          this.setMode('unstick');
          this.unstickTimer = this.rng.range(0.35, 0.7);
          this.circleDir = this.rng.chance(0.5) ? 1 : -1;
        }
        break;
      }
    }

    goal = this.avoid(goal, pos, this.mode === 'push' || this.mode === 'carry');
    this.steer(cmd, pos, yaw, goal, speed, reverseOk);

    // Weapons.
    const local = toLocal(me, fp);
    const front = -me.half.z;
    if (arm) {
      this.fireDelay -= dt;
      if (arm.kind === 'flipper') {
        const inZone = local.z < front + 0.1 && local.z > front - foe.spec.length * 0.6 - 0.35 * me.spec.scale && Math.abs(local.x) < arm.width / 2 + 0.15;
        if (inZone && me.armPhase === 'rest' && me.cooldown <= 0 && this.fireDelay <= 0) {
          if (this.rng.chance(lerp(0.35, 0.95, this.skill))) cmd.weaponPressed = true;
          this.fireDelay = lerp(0.35, 0.05, this.skill);
        }
      } else if (arm.kind === 'axe') {
        const tipZ = arm.hinge.z - Math.cos(arm.maxAngle) * arm.length;
        const inZone = Math.abs(local.z - tipZ) < 0.32 * me.spec.scale + foe.spec.length * 0.3 && Math.abs(local.x) < 0.35 * me.spec.scale;
        if (inZone && me.armPhase === 'rest' && me.cooldown <= 0 && this.fireDelay <= 0) {
          if (this.rng.chance(lerp(0.4, 0.95, this.skill))) cmd.weaponPressed = true;
          this.fireDelay = lerp(0.4, 0.08, this.skill);
        }
      } else if (arm.kind === 'lifter') {
        const inZone = local.z < front + 0.05 && local.z > front - foe.spec.length * 0.7 - 0.3 * me.spec.scale && Math.abs(local.x) < arm.width / 2 + 0.1;
        if (inZone) {
          cmd.weapon = true;
          if (this.mode !== 'carry' && me.arm > 0.6) this.setMode('carry');
        } else if (this.mode === 'carry') cmd.weapon = true;
      }
    }
    return this.finish(cmd, me);
  }

  private scripted(dt: number, bots: BotSim[], cmd: DriveCommand): DriveCommand {
    const me = this.me;
    const foe = bots.find((b) => b !== me && !b.disabled);
    const pos = me.pos;
    const yaw = yawOf(me.quat);
    const wantArmed = this.script !== 'passive' && me.parts.weapon > 0;
    if (me.spinnerSpec && me.armed !== wantArmed) cmd.weaponPressed = true;
    if (!foe) return cmd;
    const fp = foe.pos;
    if (this.script === 'charge') {
      this.steer(cmd, pos, yaw, vec(fp.x, 0, fp.z), 1, false);
      return cmd;
    }
    // Passive: a slow, wide orbit around the middle, never closing in. Easy to catch.
    this.modeTime += dt;
    const a = this.modeTime * 0.32;
    const goal = vec(Math.cos(a) * 2.6, 0, Math.sin(a) * 2.6);
    const away = Math.hypot(pos.x - fp.x, pos.z - fp.z);
    if (away < 1.6) {
      const dx = pos.x - fp.x;
      const dz = pos.z - fp.z;
      goal.x = pos.x + dx;
      goal.z = pos.z + dz;
    }
    this.steer(cmd, pos, yaw, goal, 0.42, true);
    return cmd;
  }

  private finish(cmd: DriveCommand, me: BotSim): DriveCommand {
    // Mild throttle smoothing for weaker drivers.
    const s = lerp(0.6, 1, this.skill);
    cmd.throttle = clamp(cmd.throttle * s + (1 - s) * ((me.driveL + me.driveR) / 2), -1, 1);
    return cmd;
  }

  private plan(_foe: BotSim, d: number): void {
    const me = this.me;
    const health = Math.min(...(['driveL', 'driveR', 'electronics', 'battery'] as const).map((c) => me.frac(c)));
    if (this.mode === 'carry' || this.mode === 'unstick') return;
    if (me.isSpinner) {
      if (me.spin01 < 0.4 && me.parts.weapon > 0 && d < 3) return this.setMode('spinup');
      if (this.mode === 'attack' && me.spin01 < 0.3 && me.parts.weapon > 0) return this.setMode('retreat');
      if (this.mode === 'spinup') return;
      return this.setMode('attack');
    }
    switch (this.style) {
      case 'bully':
        if (d < 2.2 && this.mode !== 'push') return this.setMode('push');
        if (this.mode !== 'push') return this.setMode('attack');
        return;
      case 'tactical':
        if (health < 0.35 && d < 2) return this.setMode('retreat');
        if (this.mode === 'attack' && this.modeTime > 3) return this.setMode('circle');
        if (this.mode !== 'circle' && this.mode !== 'attack') return this.setMode('circle');
        return;
      case 'wedger':
        if (me.spec.weapon.kind === 'none' && d < 2) return this.setMode('push');
        if (this.mode !== 'attack' && this.mode !== 'push') return this.setMode('attack');
        return;
      default:
        if (this.mode !== 'attack') this.setMode('attack');
    }
  }

  private setMode(m: Mode): void {
    if (m !== this.mode) {
      this.mode = m;
      this.modeTime = 0;
      if (m === 'circle' || m === 'spinup') this.circleDir = this.rng.chance(0.5) ? 1 : -1;
    }
  }

  /** Steer away from hazards and walls unless we mean to use them. */
  private avoid(goal: Vec3, pos: Vec3, aggressive: boolean): Vec3 {
    let gx = goal.x;
    let gz = goal.z;
    if (!aggressive) {
      for (const h of HAZARD_SPOTS) {
        const dx = pos.x - h.pos.x;
        const dz = pos.z - h.pos.z;
        const dd = Math.hypot(dx, dz);
        const r = h.r + 0.6;
        if (dd < r) {
          const push = ((r - dd) / r) * lerp(1.2, 3.5, this.skill);
          gx += (dx / Math.max(0.1, dd)) * push;
          gz += (dz / Math.max(0.1, dd)) * push;
        }
      }
    }
    const lim = ARENA_HALF - 0.9;
    gx = clamp(gx, -lim, lim);
    gz = clamp(gz, -lim, lim);
    return vec(gx, 0, gz);
  }

  private steer(cmd: DriveCommand, pos: Vec3, yaw: number, goal: Vec3, speed: number, reverseOk: boolean): void {
    const dx = goal.x - pos.x;
    const dz = goal.z - pos.z;
    const want = Math.atan2(-dx, -dz);
    let err = wrapAngle(want - yaw);
    let dir = 1;
    if (reverseOk && Math.abs(err) > 2.3 && Math.hypot(dx, dz) < 1.6) {
      err = wrapAngle(err + Math.PI);
      dir = -1;
    }
    const gain = lerp(1.4, 2.6, this.skill);
    cmd.turn = clamp(-err * gain, -1, 1);
    const align = Math.cos(err);
    cmd.throttle = dir * speed * (Math.abs(err) < 1.3 ? Math.max(0.2, align) : 0.05);
  }
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function norm2(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.z) || 1;
  return vec(v.x / l, 0, v.z / l);
}

function toLocal(me: BotSim, p: Vec3): Vec3 {
  const q = me.quat;
  const rel = vec(p.x - me.pos.x, p.y - me.pos.y, p.z - me.pos.z);
  return rotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, rel);
}

function nearestHazard(p: Vec3, kind?: 'pulv' | 'saw' | 'ram'): Vec3 {
  let best = HAZARD_SPOTS[0].pos;
  let bd = Infinity;
  for (const h of HAZARD_SPOTS) {
    if (kind && h.kind !== kind) continue;
    const d = dist(p, h.pos);
    if (d < bd) {
      bd = d;
      best = h.pos;
    }
  }
  // Walls with spikestrips are hazards too.
  const wallD = ARENA_HALF - Math.abs(p.x);
  if (!kind && wallD < bd && Math.abs(p.z) < 3.6) return vec(Math.sign(p.x) * ARENA_HALF, 0, p.z);
  return best;
}
