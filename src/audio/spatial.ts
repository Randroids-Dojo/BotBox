// Cheap listener-relative placement: equal-power stereo pan and a gentle distance roll-off.

import type { Quat, Vec3 } from '../contract';

export interface Placement {
  pan: number;
  gain: number;
  /** Low-pass cutoff for distance air absorption. */
  lp: number;
  dist: number;
}

export class Listener {
  pos: Vec3 = { x: 0, y: 6, z: 12 };
  /** Inverse orientation, cached per frame. */
  private iq: Quat = { x: 0, y: 0, z: 0, w: 1 };

  set(pos: Vec3, quat: Quat): void {
    this.pos = pos;
    this.iq = { x: -quat.x, y: -quat.y, z: -quat.z, w: quat.w };
  }

  /** Position in listener space: +x right, -z ahead. */
  local(p: Vec3): Vec3 {
    const vx = p.x - this.pos.x;
    const vy = p.y - this.pos.y;
    const vz = p.z - this.pos.z;
    const { x, y, z, w } = this.iq;
    // v' = q v q*, expanded.
    const tx = 2 * (y * vz - z * vy);
    const ty = 2 * (z * vx - x * vz);
    const tz = 2 * (x * vy - y * vx);
    return {
      x: vx + w * tx + (y * tz - z * ty),
      y: vy + w * ty + (z * tx - x * tz),
      z: vz + w * tz + (x * ty - y * tx),
    };
  }

  place(p: Vec3): Placement {
    const l = this.local(p);
    const dist = Math.hypot(l.x, l.y, l.z);
    const flat = Math.max(1.5, Math.hypot(l.x, l.z));
    const pan = Math.max(-1, Math.min(1, l.x / flat)) * 0.85;
    // Broadcast mix: the camera is often 10 to 20 m out, and hits still have to land.
    const ref = 6;
    const gain = Math.pow(ref / Math.max(ref, dist), 0.6);
    // Behind the camera sounds a little duller.
    const behind = l.z > 0 ? 0.6 : 1;
    const lp = Math.max(2500, 18000 / (1 + dist / 25)) * behind;
    return { pan, gain, lp, dist };
  }
}
