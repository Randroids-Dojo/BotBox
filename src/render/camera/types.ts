// Camera system shared types.

import * as THREE from 'three';
import type { Corner } from '../../contract';

export interface CamBot {
  id: string;
  pos: THREE.Vector3;
  /** Heading, radians about +Y, 0 faces -Z. */
  yaw: number;
  /** Footprint length, meters. */
  length: number;
  scale: number;
  alive: boolean;
  corner: Corner;
  player: boolean;
}

export interface CamCtx {
  bots: CamBot[];
  /** Real seconds since the stage started. */
  time: number;
  get(id: string): CamBot | undefined;
  player(): CamBot | undefined;
}

export class Pose {
  pos = new THREE.Vector3(0, 5, 12);
  target = new THREE.Vector3();
  fov = 50;
  roll = 0;
  copy(p: Pose): this {
    this.pos.copy(p.pos);
    this.target.copy(p.target);
    this.fov = p.fov;
    this.roll = p.roll;
    return this;
  }
  /** Exponential smoothing toward `p` with rates per second. */
  damp(p: Pose, kPos: number, kTarget: number, kFov: number, dt: number): this {
    const a = 1 - Math.exp(-kPos * dt);
    const b = 1 - Math.exp(-kTarget * dt);
    const c = 1 - Math.exp(-kFov * dt);
    this.pos.lerp(p.pos, a);
    this.target.lerp(p.target, b);
    this.fov += (p.fov - this.fov) * c;
    this.roll += (p.roll - this.roll) * c;
    return this;
  }
}

export const smooth = (t: number) => t * t * (3 - 2 * t);
export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

/** Vertical fov (degrees) needed to fit a horizontal half width at a distance. */
export function fovForWidth(halfWidth: number, dist: number, aspect: number): number {
  const h = 2 * Math.atan(halfWidth / Math.max(0.1, dist) / Math.max(0.5, aspect));
  return THREE.MathUtils.radToDeg(h);
}

/** Midpoint and spread of a set of robots. */
export function actionOf(bots: CamBot[], out: THREE.Vector3): number {
  let n = 0;
  out.set(0, 0, 0);
  for (const b of bots) {
    if (!b.alive && bots.length > 1) continue;
    out.add(b.pos);
    n++;
  }
  if (n === 0) {
    for (const b of bots) out.add(b.pos);
    n = bots.length;
  }
  if (n === 0) return 0;
  out.multiplyScalar(1 / n);
  let spread = 0;
  for (const b of bots) spread = Math.max(spread, b.pos.distanceTo(out));
  return spread;
}

/** 1D value noise for camera operator shake. */
export function noise1(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const h = (n: number) => {
    const x = Math.sin((n + seed * 57.13) * 127.1) * 43758.5453;
    return x - Math.floor(x);
  };
  const u = f * f * (3 - 2 * f);
  return (h(i) * (1 - u) + h(i + 1) * u) * 2 - 1;
}
