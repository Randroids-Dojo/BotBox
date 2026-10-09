// Gameplay cameras: chase (default) and the driver station view.

import * as THREE from 'three';
import { ARENA_HALF, DRIVER_STATIONS, LEXAN_TOP } from '../../data/arena';
import { actionOf, clamp, fovForWidth, Pose, type CamBot, type CamCtx } from './types';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _mid = new THREE.Vector3();

/** Behind and above the player, keeping the opponent framed, like a fighting game camera. */
export class ChaseCam {
  private yaw = 0;
  private sep = 3;
  private init = false;
  private want = new Pose();
  readonly pose = new Pose();

  reset(): void {
    this.init = false;
  }

  update(ctx: CamCtx, dt: number, aspect: number): Pose {
    const me = ctx.player();
    if (!me) return this.spectate(ctx, dt, aspect);
    const foe = nearestFoe(ctx.bots, me);
    let desiredYaw = this.yaw;
    let sep = 0;
    if (foe) {
      _v.subVectors(foe.pos, me.pos);
      _v.y = 0;
      sep = _v.length();
      // Too close and the bearing is unstable as robots circle: hold the current heading.
      if (sep > 1.1) desiredYaw = Math.atan2(-_v.x, -_v.z);
    } else {
      desiredYaw = me.yaw;
    }
    if (!this.init) {
      this.yaw = foe ? desiredYaw : me.yaw;
      this.sep = sep;
    }
    // Limited turn rate plus easing: never whips around.
    let dy = desiredYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const ease = dy * (1 - Math.exp(-2.4 * dt));
    const maxStep = 1.7 * dt;
    this.yaw += clamp(ease, -maxStep, maxStep);
    this.sep += (sep - this.sep) * (1 - Math.exp(-2 * dt));

    const s = this.sep;
    const dist = clamp(3.4 + s * 0.5, 3.8, 8.5) * (0.8 + me.scale * 0.2);
    const height = clamp(1.9 + s * 0.26, 2.1, 4.4) * (0.85 + me.scale * 0.15);
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const w = this.want;
    w.pos.set(me.pos.x - fx * dist, height, me.pos.z - fz * dist);
    if (foe) w.target.lerpVectors(me.pos, foe.pos, 0.4);
    else w.target.set(me.pos.x + fx * 1.5, 0, me.pos.z + fz * 1.5);
    w.target.y = 0.25;
    clampInside(w.pos);
    // Fit both robots horizontally.
    const camDist = w.pos.distanceTo(w.target);
    w.fov = clamp(fovForWidth(Math.max(1.6, s * 0.62 + 1.0), camDist, aspect), 46, 68);
    w.roll = 0;
    if (!this.init) {
      this.pose.copy(w);
      this.init = true;
    }
    this.pose.damp(w, 4.5, 6, 3, dt);
    return this.pose;
  }

  /** No player robot: follow the action from behind the south wall line. */
  private spectate(ctx: CamCtx, dt: number, aspect: number): Pose {
    const spread = actionOf(ctx.bots, _mid);
    const w = this.want;
    w.target.copy(_mid).setY(0.25);
    w.pos.set(_mid.x * 0.6, 3.8 + spread * 0.25, _mid.z + 6.5 + spread * 0.5);
    clampCamera(w.pos);
    w.fov = clamp(fovForWidth(spread + 1.5, w.pos.distanceTo(w.target), aspect), 40, 65);
    w.roll = 0;
    if (!this.init) {
      this.pose.copy(w);
      this.init = true;
    }
    this.pose.damp(w, 2.5, 4, 2, dt);
    return this.pose;
  }

  /** Camera heading for robot-relative controls. */
  get heading(): number {
    return this.yaw;
  }
}

/** Fixed at the player's station outside the south wall, gently tracking the robot. */
export class DriverCam {
  readonly pose = new Pose();
  private want = new Pose();
  private init = false;

  reset(): void {
    this.init = false;
  }

  update(ctx: CamCtx, dt: number): Pose {
    const me = ctx.player() ?? ctx.bots[0];
    const corner = me?.corner ?? 'red';
    const station = DRIVER_STATIONS.find((d) => d.corner === corner) ?? DRIVER_STATIONS[me && me.pos.x > 0 ? 1 : 0];
    const w = this.want;
    w.pos.set(station.pos.x, station.pos.y + 1.62, station.pos.z + 0.15);
    if (me) w.target.lerpVectors(me.pos, _w.set(0, 0, 0), 0.3);
    else w.target.set(0, 0, 0);
    w.target.y = 0;
    w.fov = 52;
    w.roll = 0;
    if (!this.init) {
      this.pose.copy(w);
      this.init = true;
    }
    this.pose.pos.copy(w.pos);
    this.pose.damp(w, 0, 1.6, 1, dt);
    return this.pose;
  }
}

export function nearestFoe(bots: CamBot[], me: CamBot): CamBot | undefined {
  let best: CamBot | undefined;
  let bd = Infinity;
  for (const b of bots) {
    if (b === me) continue;
    // Prefer robots still in the fight.
    const d = b.pos.distanceToSquared(me.pos) + (b.alive ? 0 : 400);
    if (d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

/** Keep a camera inside the Box, off the walls and under the ceiling. */
export function clampInside(p: THREE.Vector3, margin = 0.45): void {
  const lim = ARENA_HALF - margin;
  p.x = clamp(p.x, -lim, lim);
  p.z = clamp(p.z, -lim, lim);
  p.y = clamp(p.y, 0.15, LEXAN_TOP - 0.35);
}

/** Keep cameras out of the stands and under the Lexan ceiling when inside the Box. */
export function clampCamera(p: THREE.Vector3): void {
  const lim = ARENA_HALF + 2.6;
  p.x = clamp(p.x, -lim, lim);
  p.z = clamp(p.z, -lim, lim);
  const inside = Math.abs(p.x) < ARENA_HALF + 0.2 && Math.abs(p.z) < ARENA_HALF + 0.2;
  if (inside) p.y = clamp(p.y, 0.15, LEXAN_TOP - 0.3);
}
