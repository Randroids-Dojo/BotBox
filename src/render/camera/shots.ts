// Cinematic shots requested by the game director. Each runs on real time and then holds its
// last framing until another shot or `live`.

import * as THREE from 'three';
import { ARENA_HALF, BOOTH, LIGHT_TREE, START_SQUARES } from '../../data/arena';
import type { ShotRequest } from '../types';
import { clampCamera } from './gameplay';
import { actionOf, clamp, fovForWidth, Pose, smooth, type CamBot, type CamCtx } from './types';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export interface ActiveShot {
  req: Exclude<ShotRequest, { kind: 'live' }>;
  start: number;
  /** Per shot random choices fixed at the start. */
  side: number;
  base: THREE.Vector3;
  dir: THREE.Vector3;
  angle: number;
}

export function startShot(req: Exclude<ShotRequest, { kind: 'live' }>, ctx: CamCtx, cam: Pose): ActiveShot {
  const s: ActiveShot = { req, start: ctx.time, side: 1, base: new THREE.Vector3(), dir: new THREE.Vector3(1, 0, 0), angle: 0 };
  if (req.kind === 'impact' || req.kind === 'replay') {
    s.base.set(req.point.x, req.point.y, req.point.z);
    // Look across the line of the robots, from the side the viewer is already on.
    const bots = req.bots.map((id) => ctx.get(id)).filter((b): b is CamBot => !!b);
    if (bots.length >= 2) _a.subVectors(bots[1].pos, bots[0].pos).setY(0);
    else _a.set(1, 0, 0);
    if (_a.lengthSq() < 1e-4) _a.set(1, 0, 0);
    _a.normalize();
    s.dir.set(-_a.z, 0, _a.x);
    _b.subVectors(cam.pos, s.base).setY(0);
    if (s.dir.dot(_b) < 0) s.dir.negate();
    // Keep the camera inside the walls: flip if the point is near a wall on that side.
    _c.copy(s.base).addScaledVector(s.dir, 2);
    if (Math.abs(_c.x) > ARENA_HALF - 0.4 || Math.abs(_c.z) > ARENA_HALF - 0.4) s.dir.negate();
    s.angle = Math.atan2(s.dir.x, s.dir.z);
  }
  if (req.kind === 'winner' || req.kind === 'loser' || req.kind === 'bot_intro') {
    const b = ctx.get(req.bot);
    if (b) s.base.copy(b.pos);
    // Start the orbit from the side toward the center so the Box fills the background.
    s.angle = Math.atan2(-s.base.x, -s.base.z) + 0.5;
  }
  return s;
}

/** Fill `out` with the pose for this shot at real time `ctx.time`. */
export function runShot(s: ActiveShot, ctx: CamCtx, aspect: number, out: Pose, dt: number): void {
  const req = s.req;
  const raw = (ctx.time - s.start) / Math.max(0.01, req.duration);
  const t = clamp(raw, 0, 1);
  const e = smooth(t);
  out.roll = 0;
  switch (req.kind) {
    case 'flyover': {
      // Sweep from high over the north-west outside the Box, across the ceiling, and settle
      // low on the south-east side.
      const a = THREE.MathUtils.lerp(-2.4, -0.6, e);
      const r = THREE.MathUtils.lerp(14, 10.5, e);
      const y = THREE.MathUtils.lerp(10.5, 3.2, smooth(e));
      out.pos.set(Math.sin(a) * r, y, Math.cos(a) * r);
      out.target.set(Math.sin(a + Math.PI) * 1.5 * (1 - e), THREE.MathUtils.lerp(-1, 0.4, e), Math.cos(a + Math.PI) * 1.5 * (1 - e));
      out.fov = THREE.MathUtils.lerp(55, 44, e);
      break;
    }
    case 'bot_intro': {
      const b = ctx.get(req.bot);
      if (b) s.base.lerp(b.pos, 1 - Math.exp(-6 * dt));
      const L = b?.length ?? 0.9;
      const yaw = b?.yaw ?? 0;
      // In front of the robot, slightly to its left, pushing in.
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const dist = THREE.MathUtils.lerp(2.2 + L * 1.6, 1.4 + L * 1.1, e);
      const sx = -fz;
      const sz = fx;
      out.pos.set(s.base.x + fx * dist + sx * dist * 0.35, 0.35 + L * 0.35 + (1 - e) * 0.25, s.base.z + fz * dist + sz * dist * 0.35);
      out.target.copy(s.base).setY(0.12 + L * 0.12);
      // Frame the robot right of center and up, so the lower third has room bottom left.
      _a.subVectors(out.target, out.pos).normalize();
      _b.crossVectors(_a, UP).normalize();
      out.target.addScaledVector(_b, -dist * 0.22).addScaledVector(UP, -dist * 0.09);
      out.fov = 40;
      clampCamera(out.pos);
      break;
    }
    case 'faceoff': {
      const red = START_SQUARES[0].center;
      const blue = START_SQUARES[1].center;
      const mid = _a.set((red.x + blue.x) / 2, 0, (red.z + blue.z) / 2);
      const perp = _b.set(1, 0, 1).normalize();
      const dist = THREE.MathUtils.lerp(13.6, 12.6, e);
      out.pos.copy(mid).addScaledVector(perp, dist).setY(THREE.MathUtils.lerp(0.95, 1.05, e));
      out.pos.x += THREE.MathUtils.lerp(-0.6, 0.6, e);
      out.pos.z -= THREE.MathUtils.lerp(-0.6, 0.6, e);
      out.target.copy(mid).setY(0.3);
      out.fov = fovForWidth(7.4, dist, aspect);
      break;
    }
    case 'lights': {
      const p = LIGHT_TREE.pos;
      const k = THREE.MathUtils.lerp(1, 0.82, e);
      out.pos.set(p.x + 0.9 * k, p.y - 0.55 * k, p.z + 2.6 * k);
      out.target.set(p.x, p.y, p.z);
      out.fov = 30;
      break;
    }
    case 'impact': {
      const dist = THREE.MathUtils.lerp(2.1, 1.7, e);
      out.pos.copy(s.base).addScaledVector(s.dir, dist).setY(0.3);
      _a.crossVectors(s.dir, UP);
      out.pos.addScaledVector(_a, 0.5);
      clampCamera(out.pos);
      out.target.copy(s.base).setY(0.22);
      out.fov = THREE.MathUtils.lerp(54, 48, e);
      out.roll = 0.06;
      break;
    }
    case 'replay': {
      // Track the robots involved as the recorded frames play back.
      const bots = req.bots.map((id) => ctx.get(id)).filter((b): b is CamBot => !!b);
      const spread = bots.length ? actionOf(bots, _c) : 1;
      if (bots.length) s.base.lerp(_c, 1 - Math.exp(-4 * dt));
      const v = ((req.seed % 4) + 4) % 4;
      const elapsed = ctx.time - s.start;
      if (v === 0) {
        // Low ground level, across the line.
        out.pos.copy(s.base).addScaledVector(s.dir, 2.4 + spread * 0.6).setY(0.16);
        clampCamera(out.pos);
        out.target.copy(s.base).setY(0.25);
        out.fov = clamp(fovForWidth(spread + 0.9, out.pos.distanceTo(out.target), aspect), 42, 70);
      } else if (v === 1) {
        const a = s.angle + elapsed * 0.4;
        const r = 2.8 + spread * 0.6;
        out.pos.set(s.base.x + Math.sin(a) * r, 1.1, s.base.z + Math.cos(a) * r);
        clampCamera(out.pos);
        out.target.copy(s.base).setY(0.25);
        out.fov = 50;
      } else if (v === 2) {
        // Long lens from outside the Lexan, the corner nearest the action.
        const sx = s.base.x >= 0 ? 1 : -1;
        const sz = s.base.z >= 0 ? 1 : -1;
        out.pos.set(sx * (ARENA_HALF + 3.2), 2.0, sz * (ARENA_HALF + 3.2));
        out.target.copy(s.base).setY(0.25);
        out.fov = clamp(fovForWidth(spread + 0.9, out.pos.distanceTo(out.target), aspect), 8, 24);
      } else {
        out.pos.set(s.base.x + 0.01, 8.5 - elapsed * 0.1, s.base.z + 1.2);
        out.target.copy(s.base);
        out.fov = clamp(fovForWidth(spread + 1.5, 8, aspect), 22, 50);
        out.roll = elapsed * 0.05;
      }
      break;
    }
    case 'winner': {
      const b = ctx.get(req.bot);
      if (b) s.base.lerp(b.pos, 1 - Math.exp(-4 * dt));
      const L = b?.length ?? 0.9;
      const elapsed = ctx.time - s.start;
      const a = s.angle + elapsed * 0.28;
      const r = 1.6 + L * 1.6;
      out.pos.set(s.base.x + Math.sin(a) * r, 0.7 + L * 0.5, s.base.z + Math.cos(a) * r);
      clampCamera(out.pos);
      out.target.copy(s.base).setY(0.2 + L * 0.1);
      out.fov = 46;
      break;
    }
    case 'loser': {
      const b = ctx.get(req.bot);
      if (b) s.base.lerp(b.pos, 1 - Math.exp(-4 * dt));
      const L = b?.length ?? 0.9;
      const drift = (ctx.time - s.start) * 0.03;
      out.pos.set(s.base.x + Math.sin(s.angle) * (1.4 + L), 0.45 + drift, s.base.z + Math.cos(s.angle) * (1.4 + L));
      clampCamera(out.pos);
      out.target.copy(s.base).setY(0.25 + drift * 0.5);
      out.fov = 42;
      break;
    }
    case 'booth': {
      out.pos.set(BOOTH.pos.x, BOOTH.pos.y, BOOTH.pos.z);
      out.target.set(-0.5, 0, -0.5);
      out.fov = THREE.MathUtils.lerp(46, 40, e);
      break;
    }
  }
}

export function shotMoving(s: ActiveShot, time: number): boolean {
  return time - s.start < s.req.duration;
}
