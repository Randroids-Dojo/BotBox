// Records the fight as it is drawn and plays the best moments back for "Bot Replay".

import type { BotFrame, DebrisFrame, MatchEvent, Quat, Vec3, WorldFrame } from '../contract';

interface Sample {
  frame: WorldFrame;
  events: MatchEvent[];
}

export interface Highlight {
  t: number;
  score: number;
  point: Vec3;
  bots: string[];
  label: string;
}

const KEEP_SEC = 60;

export class Recorder {
  private samples: Sample[] = [];
  readonly highlights: Highlight[] = [];

  clear(): void {
    this.samples = [];
    this.highlights.length = 0;
  }

  push(frame: WorldFrame, events: MatchEvent[]): void {
    this.samples.push({ frame, events });
    while (this.samples.length > 2 && frame.t - this.samples[0].frame.t > KEEP_SEC) this.samples.shift();
    for (const e of events) this.score(e, frame);
  }

  private score(e: MatchEvent, f: WorldFrame): void {
    const at = (id: string): Vec3 => f.bots.find((b) => b.id === id)?.pos ?? { x: 0, y: 0, z: 0 };
    let h: Highlight | null = null;
    switch (e.type) {
      case 'hit':
        if (e.severity >= 0.45) h = { t: e.t, score: e.severity, point: e.point, bots: [e.victim, ...(e.attacker ? [e.attacker] : [])], label: e.kind };
        if (e.kind === 'pulverizer' || e.kind === 'killsaw') h = { t: e.t, score: 0.8, point: e.point, bots: [e.victim], label: e.kind };
        break;
      case 'flipped':
        h = { t: e.t - 0.6, score: 0.8, point: at(e.bot), bots: [e.bot], label: 'flip' };
        break;
      case 'airborne':
        if (e.height > 0.7) h = { t: e.t, score: 0.6 + Math.min(0.3, e.height / 8), point: at(e.bot), bots: [e.bot], label: 'air' };
        break;
      case 'panel_off':
      case 'wheel_off':
        h = { t: e.t, score: 0.7, point: at(e.bot), bots: [e.bot], label: e.type };
        break;
      case 'fire_start':
        h = { t: e.t, score: 0.65, point: at(e.bot), bots: [e.bot], label: 'fire' };
        break;
      case 'ko':
        h = { t: e.t - 1.5, score: 0.75, point: at(e.bot), bots: [e.bot], label: 'ko' };
        break;
      default:
        break;
    }
    if (!h) return;
    // Merge with a nearby highlight instead of stacking.
    const near = this.highlights.find((x) => Math.abs(x.t - h!.t) < 2.5);
    if (near) {
      if (h.score > near.score) Object.assign(near, h, { score: Math.min(1.2, h.score + 0.1) });
      else near.score = Math.min(1.2, near.score + 0.1);
      return;
    }
    this.highlights.push(h);
  }

  /** Best moments still in the buffer, in time order. */
  best(n: number): Highlight[] {
    const first = this.samples[0]?.frame.t ?? 0;
    const pool = this.highlights.filter((h) => h.t - 1.8 >= first).sort((a, b) => b.score - a.score).slice(0, n);
    return pool.sort((a, b) => a.t - b.t);
  }

  get length(): number {
    return this.samples.length;
  }

  /** Interpolated world at sim time t, plus the events between t0 (exclusive) and t (inclusive). */
  at(t: number, t0: number): { frame: WorldFrame; events: MatchEvent[] } | null {
    const s = this.samples;
    if (s.length < 2) return null;
    let i = 0;
    let lo = 0;
    let hi = s.length - 1;
    if (t <= s[0].frame.t) i = 0;
    else if (t >= s[hi].frame.t) i = hi - 1;
    else {
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (s[mid].frame.t <= t) lo = mid;
        else hi = mid;
      }
      i = lo;
    }
    const a = s[i].frame;
    const b = s[Math.min(i + 1, s.length - 1)].frame;
    const span = b.t - a.t;
    const k = span > 1e-6 ? Math.max(0, Math.min(1, (t - a.t) / span)) : 0;
    const events: MatchEvent[] = [];
    for (const smp of s) {
      if (smp.frame.t <= t0) continue;
      if (smp.frame.t > t) break;
      for (const e of smp.events) if (e.t > t0 && e.t <= t) events.push(e);
    }
    return { frame: lerpWorld(a, b, k), events };
  }
}

function lerpV(a: Vec3, b: Vec3, k: number): Vec3 {
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k };
}

function slerp(a: Quat, b: Quat, k: number): Quat {
  let d = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  if (d < 0) {
    d = -d;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (d > 0.9995) {
    const x = a.x + (bx - a.x) * k, y = a.y + (by - a.y) * k, z = a.z + (bz - a.z) * k, w = a.w + (bw - a.w) * k;
    const l = Math.hypot(x, y, z, w) || 1;
    return { x: x / l, y: y / l, z: z / l, w: w / l };
  }
  const th = Math.acos(d);
  const s = Math.sin(th);
  const wa = Math.sin((1 - k) * th) / s;
  const wb = Math.sin(k * th) / s;
  return { x: a.x * wa + bx * wb, y: a.y * wa + by * wb, z: a.z * wa + bz * wb, w: a.w * wa + bw * wb };
}

function lerpAngle(a: number, b: number, k: number): number {
  // Spinner angles can jump a lot between samples; never interpolate backward.
  return a + (b - a) * k;
}

function lerpBot(a: BotFrame, b: BotFrame | undefined, k: number): BotFrame {
  if (!b) return a;
  const near = k < 0.5 ? a : b;
  return {
    ...near,
    pos: lerpV(a.pos, b.pos, k),
    quat: slerp(a.quat, b.quat, k),
    wheelSpin: a.wheelSpin.map((w, i) => w + ((b.wheelSpin[i] ?? w) - w) * k),
    weapon: { ...near.weapon, angle: lerpAngle(a.weapon.angle, b.weapon.angle, k), arm: a.weapon.arm + (b.weapon.arm - a.weapon.arm) * k },
  };
}

function lerpDebris(a: DebrisFrame, b: DebrisFrame | undefined, k: number): DebrisFrame {
  if (!b) return a;
  return { ...a, pos: lerpV(a.pos, b.pos, k), quat: slerp(a.quat, b.quat, k) };
}

export function lerpWorld(a: WorldFrame, b: WorldFrame, k: number): WorldFrame {
  return {
    t: a.t + (b.t - a.t) * k,
    bots: a.bots.map((x) => lerpBot(x, b.bots.find((y) => y.id === x.id), k)),
    debris: a.debris.map((x) => lerpDebris(x, b.debris.find((y) => y.id === x.id), k)),
    hazards: (k < 0.5 ? a : b).hazards.map((h, i) => {
      const ha = a.hazards[i];
      const hb = b.hazards[i];
      return ha && hb ? { ...h, state: ha.state + (hb.state - ha.state) * k, spin: ha.spin + (hb.spin - ha.spin) * k } : h;
    }),
    match: { ...(k < 0.5 ? a : b).match },
  };
}
