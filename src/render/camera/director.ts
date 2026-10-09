// The automatic TV director: a set of camera rigs around the Box and cut rules like a live
// sports truck. Minimum shot length, tighter cuts on big hits, both robots in frame, the
// 180 degree line respected, smooth pans and zooms within a shot.

import * as THREE from 'three';
import type { HitEvent } from '../../contract';
import { ARENA_HALF, BOOTH, PULVERIZERS, WALL_T } from '../../data/arena';
import { PULVERIZER_RAISED } from '../arena/hazards';
import { TRUSS_Y } from '../arena/structure';
import { Rng } from '../util/rng';
import { clampCamera } from './gameplay';
import { actionOf, clamp, fovForWidth, noise1, Pose, type CamCtx } from './types';

type RigKind = 'wide' | 'corner' | 'handheld' | 'jib' | 'floor';

interface Rig {
  id: string;
  kind: RigKind;
  /** Base position (handheld and jib move from here). */
  pos: THREE.Vector3;
  tight: boolean;
  lastUsed: number;
}

const MIN_SHOT = 2.5;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _line = new THREE.Vector3();

export class BroadcastDirector {
  readonly pose = new Pose();
  private want = new Pose();
  private rigs: Rig[] = [];
  private cur: Rig;
  private shotStart = 0;
  private shotLen = 5;
  private side = 1;
  private action = new THREE.Vector3();
  private spread = 2;
  private aim = new THREE.Vector3();
  private rng: Rng;
  private pendingHit = 0;
  private handheldAlong = 0;
  private cutFlag = true;
  private zoomBias = 1;
  private blockedFor = 0;

  constructor(seed = 1, private exclude: RigKind[] = []) {
    this.rng = new Rng(seed);
    const H = ARENA_HALF;
    this.rigs.push({ id: 'booth', kind: 'wide', pos: new THREE.Vector3(BOOTH.pos.x, BOOTH.pos.y, BOOTH.pos.z), tight: false, lastUsed: -99 });
    // High corner cams outside the Lexan, set between posts so a post never splits the frame.
    for (const [x, z, alongX] of [
      [-1, -1, true],
      [1, -1, false],
      [-1, 1, false],
      [1, 1, true],
    ] as const) {
      const pos = alongX ? new THREE.Vector3(x * 5.7, 4.3, z * (H + 2.0)) : new THREE.Vector3(x * (H + 2.0), 4.3, z * 5.7);
      this.rigs.push({ id: `corner${x}${z}`, kind: 'corner', pos, tight: false, lastUsed: -99 });
    }
    this.rigs.push({ id: 'handheld', kind: 'handheld', pos: new THREE.Vector3(0, 1.85, H + 1.0), tight: true, lastUsed: -99 });
    this.rigs.push({ id: 'jib', kind: 'jib', pos: new THREE.Vector3(0, 8.6, 0), tight: false, lastUsed: -99 });
    // Protected floor cams: two corners clear of the hammers, and the north and south walls.
    for (const [x, z] of [
      [1, -1],
      [-1, 1],
    ]) {
      this.rigs.push({ id: `floor${x}${z}`, kind: 'floor', pos: new THREE.Vector3(x * (H - 0.35), 0.32, z * (H - 0.35)), tight: true, lastUsed: -99 });
    }
    this.rigs.push({ id: 'floorN', kind: 'floor', pos: new THREE.Vector3(-2.4, 0.32, -H + 0.3), tight: true, lastUsed: -99 });
    this.rigs.push({ id: 'floorS', kind: 'floor', pos: new THREE.Vector3(2.4, 0.32, H - 0.3), tight: true, lastUsed: -99 });
    this.rigs = this.rigs.filter((r) => !this.exclude.includes(r.kind));
    this.cur = this.rigs[0];
  }

  /** Force a fresh cut on the next update. */
  reset(): void {
    this.cutFlag = true;
    this.shotStart = -99;
  }

  /** True on the frame a cut happened (no smoothing from the previous pose). */
  get justCut(): boolean {
    return this.cutFlag;
  }

  hit(e: HitEvent): void {
    this.pendingHit = Math.max(this.pendingHit, e.severity);
  }

  update(ctx: CamCtx, dt: number, aspect: number): Pose {
    const t = ctx.time;
    const spread = actionOf(ctx.bots, _a);
    this.action.lerp(_a, 1 - Math.exp(-3 * dt));
    this.spread += (spread - this.spread) * (1 - Math.exp(-2 * dt));
    // Line of action: through the two robots nearest each other.
    if (ctx.bots.length >= 2) _line.subVectors(ctx.bots[1].pos, ctx.bots[0].pos).setY(0);
    else _line.set(1, 0, 0);
    if (_line.lengthSq() < 1e-4) _line.set(1, 0, 0);
    _line.normalize();

    const age = t - this.shotStart;
    let cut = false;
    let wantTight = false;
    if (this.pendingHit > 0) {
      const sev = this.pendingHit;
      if ((sev >= 0.45 && age >= MIN_SHOT) || (sev >= 0.8 && age >= 1.2)) {
        cut = true;
        wantTight = true;
      }
      this.pendingHit = Math.max(0, this.pendingHit - dt * 0.8);
      if (cut) this.pendingHit = 0;
    }
    if (age >= this.shotLen) cut = true;
    // A hammer or a post drifted into the line of sight: cut away soon.
    if (blocked(this.pose.pos, this.action)) this.blockedFor += dt;
    else this.blockedFor = 0;
    if (this.blockedFor > 0.7 && age > 1.5) cut = true;
    this.cutFlag = false;
    if (cut) this.cutTo(this.choose(t, wantTight), t, wantTight);

    this.frame(ctx, dt, aspect, t - this.shotStart);
    if (this.cutFlag) this.pose.copy(this.want);
    else this.pose.damp(this.want, 3.5, 4.5, 2.5, dt);
    return this.pose;
  }

  private sideOf(p: THREE.Vector3): number {
    const dx = p.x - this.action.x;
    const dz = p.z - this.action.z;
    return Math.sign(_line.x * dz - _line.z * dx) || 1;
  }

  private choose(t: number, tight: boolean): Rig {
    let best = this.cur;
    let bestScore = -Infinity;
    for (const r of this.rigs) {
      if (r === this.cur) continue;
      const rp = this.rigPosition(r, _b);
      const d = rp.distanceTo(this.action);
      let s = this.rng.range(-0.6, 0.6);
      // Angular spread of the robots from here: tight rigs need them both in frame.
      const ang = 2 * Math.atan((this.spread + 0.6) / Math.max(0.5, d));
      if (r.tight && ang > 1.3) s -= 4;
      if (r.kind === 'floor') s += d < 6 ? 1.5 : -3;
      if (blocked(rp, this.action)) s -= 6;
      if (r.kind === 'handheld') s += 0.8;
      if (r.kind === 'wide') s += 0.6;
      if (tight) s += r.tight ? 3 + (r.kind === 'floor' ? 1 : 0) : -2;
      // Respect the line unless a neutral overhead resets it.
      if (r.kind !== 'jib' && this.cur.kind !== 'jib') s += this.sideOf(rp) === this.side ? 1.6 : -1.6;
      // Variety.
      s += Math.min(3, (t - r.lastUsed) * 0.12);
      if (r.kind === this.cur.kind) s -= 1.2;
      if (s > bestScore) {
        bestScore = s;
        best = r;
      }
    }
    return best;
  }

  private cutTo(r: Rig, t: number, tight: boolean): void {
    this.cur = r;
    r.lastUsed = t;
    this.shotStart = t;
    this.shotLen = tight ? this.rng.range(2.6, 3.6) : r.kind === 'wide' ? this.rng.range(5, 8) : this.rng.range(3.5, 6.5);
    const rp = this.rigPosition(r, _b);
    if (r.kind !== 'jib') this.side = this.sideOf(rp);
    this.aim.copy(this.action);
    this.cutFlag = true;
    this.zoomBias = this.rng.range(0.85, 1.15);
    if (r.kind === 'handheld') this.handheldAlong = this.perimeterAlong(this.action);
  }

  /** Map a point to a position along the outside perimeter (0..4, one unit per wall). */
  private perimeterAlong(p: THREE.Vector3): number {
    // Prefer the wall on the current side of the line.
    const H = ARENA_HALF + 1.0;
    const cands = [
      { a: 0 + (p.x / H + 1) / 2, pos: new THREE.Vector3(p.x, 0, H) },
      { a: 1 + (-p.z / H + 1) / 2, pos: new THREE.Vector3(H, 0, p.z) },
      { a: 2 + (-p.x / H + 1) / 2, pos: new THREE.Vector3(p.x, 0, -H) },
      { a: 3 + (p.z / H + 1) / 2, pos: new THREE.Vector3(-H, 0, p.z) },
    ];
    let best = cands[0];
    let bs = -Infinity;
    for (const c of cands) {
      const s = (this.sideOf(c.pos) === this.side ? 2 : 0) - c.pos.distanceTo(p) * 0.3 + (c.a < 1 ? 0.6 : 0);
      if (s > bs) {
        bs = s;
        best = c;
      }
    }
    return clamp(best.a, 0, 3.999);
  }

  private perimeterPoint(a: number, out: THREE.Vector3): THREE.Vector3 {
    const H = ARENA_HALF + 1.0;
    const w = Math.floor(((a % 4) + 4) % 4);
    const f = (((a % 4) + 4) % 4) - w;
    const s = -H + f * 2 * H;
    if (w === 0) out.set(s, 0, H);
    else if (w === 1) out.set(H, 0, -s);
    else if (w === 2) out.set(-s, 0, -H);
    else out.set(-H, 0, s);
    return out;
  }

  private rigPosition(r: Rig, out: THREE.Vector3): THREE.Vector3 {
    if (r.kind === 'handheld') return this.perimeterPoint(this.perimeterAlong(this.action), out).setY(r.pos.y);
    if (r.kind === 'jib') return out.set(this.action.x * 0.5, r.pos.y, this.action.z * 0.5 + 3);
    return out.copy(r.pos);
  }

  private frame(ctx: CamCtx, dt: number, aspect: number, age: number): void {
    const r = this.cur;
    const w = this.want;
    // Operators pan smoothly after the action.
    this.aim.lerp(this.action, 1 - Math.exp(-2.2 * dt));
    w.target.copy(this.aim).setY(0.3);
    w.roll = 0;
    const fit = (this.spread + 1.4) * this.zoomBias;
    if (r.kind === 'handheld') {
      // Walk along the perimeter toward the action.
      const goal = this.perimeterAlong(this.action);
      let d = goal - this.handheldAlong;
      if (d > 2) d -= 4;
      if (d < -2) d += 4;
      this.handheldAlong += clamp(d, -dt * 0.12, dt * 0.12);
      this.perimeterPoint(this.handheldAlong, w.pos).setY(r.pos.y);
      const tt = ctx.time;
      // Operator shake: breathing plus footsteps.
      w.pos.x += noise1(tt * 0.9, 1) * 0.06;
      w.pos.y += noise1(tt * 1.3, 2) * 0.05 + Math.sin(tt * 7) * 0.008;
      w.target.x += noise1(tt * 1.7, 3) * 0.12;
      w.target.y += noise1(tt * 2.1, 4) * 0.08;
      w.roll = noise1(tt * 0.7, 5) * 0.025;
      w.fov = clamp(fovForWidth(fit, w.pos.distanceTo(w.target), aspect), 30, 62);
    } else if (r.kind === 'jib') {
      const sw = Math.sin(age * 0.18) * 2.5;
      w.pos.set(this.aim.x * 0.5 + sw, r.pos.y - age * 0.08, this.aim.z * 0.5 + 3.2);
      w.fov = clamp(fovForWidth(fit + 0.8, w.pos.distanceTo(w.target), aspect), 30, 60);
    } else if (r.kind === 'floor') {
      w.pos.copy(r.pos);
      w.fov = clamp(fovForWidth(fit, w.pos.distanceTo(w.target), aspect), 42, 78);
      w.target.y = 0.22;
    } else {
      w.pos.copy(r.pos);
      // Slow push on wide shots.
      const push = 1 - Math.min(0.12, age * 0.012);
      w.fov = clamp(fovForWidth(fit * push, w.pos.distanceTo(w.target), aspect), 14, 52);
      return;
    }
    clampCamera(w.pos);
  }

  get rigName(): string {
    return this.cur.id;
  }
}

// ------------------------------------------------------------------ line of sight

const POSTS: THREE.Vector2[] = [];
{
  const span = ARENA_HALF * 2 + WALL_T * 2;
  const px = ARENA_HALF + WALL_T / 2 + 0.12;
  for (const s of [-1, 1]) {
    for (let i = 0; i <= 4; i++) {
      const a = -ARENA_HALF - WALL_T + (i / 4) * span;
      POSTS.push(new THREE.Vector2(a, s * px), new THREE.Vector2(s * px, a));
    }
  }
}
/** Raised hammer heads, where they hang most of the fight. */
const HEADS = PULVERIZERS.map((p) => {
  const d = new THREE.Vector3(p.center.x - p.pivot.x, 0, p.center.z - p.pivot.z).normalize();
  return new THREE.Vector3(p.pivot.x, p.pivot.y, p.pivot.z)
    .addScaledVector(d, Math.cos(PULVERIZER_RAISED) * p.arm)
    .add(new THREE.Vector3(0, Math.sin(PULVERIZER_RAISED) * p.arm, 0));
});
const _s = new THREE.Vector3();
const _ab = new THREE.Vector3();

/** True when a post or a raised hammer sits between the camera and the action. */
export function blocked(cam: THREE.Vector3, target: THREE.Vector3): boolean {
  _ab.subVectors(target, cam);
  const len2 = _ab.lengthSq();
  if (len2 < 1e-4) return false;
  for (const h of HEADS) {
    const t = clamp(_s.subVectors(h, cam).dot(_ab) / len2, 0, 1);
    _s.copy(cam).addScaledVector(_ab, t);
    if (t > 0.05 && t < 0.95 && _s.distanceTo(h) < 0.75) return true;
  }
  const outside = Math.abs(cam.x) > ARENA_HALF + 0.3 || Math.abs(cam.z) > ARENA_HALF + 0.3;
  if (!outside) return false;
  const lx = _ab.x;
  const lz = _ab.z;
  const l2 = lx * lx + lz * lz;
  for (const p of POSTS) {
    const t = clamp(((p.x - cam.x) * lx + (p.y - cam.z) * lz) / l2, 0, 1);
    const x = cam.x + lx * t;
    const z = cam.z + lz * t;
    const y = cam.y + _ab.y * t;
    if (y < TRUSS_Y && (x - p.x) * (x - p.x) + (z - p.y) * (z - p.y) < 0.45 * 0.45) return true;
  }
  return false;
}
