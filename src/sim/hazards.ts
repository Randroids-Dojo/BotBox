// The Box's hazards: Pulverizers, killsaws and ramrods. Spikestrips are wall colliders handled by
// the match's contact processing. Each hazard reads robot positions and applies scripted
// impulses and damage; HazardFrame state drives the renderer.

import type { HazardFrame, HazardKind, Vec3 } from '../contract';
import { KILLSAWS, PULVERIZERS, RAMRODS, SPIKESTRIPS } from '../data/arena';
import type { BotSim, SimHost } from './bot';
import { add, clamp01, norm, sub, vec } from './math';

type Phase = 'idle' | 'warn' | 'strike' | 'hold' | 'retract' | 'cool';

interface HazardState {
  id: string;
  kind: HazardKind;
  phase: Phase;
  timer: number;
  state: number;
  spin: number;
  /** Seconds a robot has been in the zone. */
  dwell: number;
  target: BotSim | null;
  lastHit: Map<string, number>;
  /** Next idle flourish when nobody is nearby (killsaws only). */
  flourish: number;
}

export class Hazards {
  private list: HazardState[] = [];

  constructor(private host: SimHost) {
    const mk = (id: string, kind: HazardKind): HazardState => ({
      id,
      kind,
      phase: kind === 'spikestrip' ? 'hold' : 'idle',
      timer: 0,
      state: kind === 'spikestrip' ? 1 : 0,
      spin: 0,
      dwell: 0,
      target: null,
      lastHit: new Map(),
      flourish: host.rng.range(6, 14),
    });
    for (const p of PULVERIZERS) this.list.push(mk(p.id, 'pulverizer'));
    for (const k of KILLSAWS) this.list.push(mk(k.id, 'killsaw'));
    for (const r of RAMRODS) this.list.push(mk(r.id, 'ramrod'));
    for (const s of SPIKESTRIPS) this.list.push(mk(s.id, 'spikestrip'));
  }

  frames(): HazardFrame[] {
    return this.list.map((h) => ({ id: h.id, kind: h.kind, state: h.state, spin: h.spin, warn: h.phase === 'warn' }));
  }

  step(dt: number, active: boolean): void {
    for (const h of this.list) {
      if (h.kind === 'pulverizer') this.pulverizer(h, dt, active);
      else if (h.kind === 'killsaw') this.killsaw(h, dt, active);
      else if (h.kind === 'ramrod') this.ramrod(h, dt, active);
    }
  }

  private emit(h: HazardState, action: 'warn' | 'strike' | 'retract'): void {
    this.host.emit({ type: 'hazard', t: this.host.t, hazard: h.id, kind: h.kind, action, target: h.target ? h.target.id : null });
  }

  /** Robots whose footprint overlaps a circle on the floor. */
  private inCircle(c: Vec3, r: number): BotSim[] {
    return this.host.bots.filter((b) => {
      const p = b.pos;
      const reach = r + b.spec.width * 0.3;
      return Math.hypot(p.x - c.x, p.z - c.z) < reach && p.y < 0.8;
    });
  }

  /** Robots whose footprint overlaps a rectangle on the floor and sit low enough to be bitten. */
  private inRect(c: Vec3, hx: number, hz: number, maxY: number): BotSim[] {
    return this.host.bots.filter((b) => {
      const p = b.pos;
      const ex = b.spec.width * 0.4;
      const ez = b.spec.length * 0.4;
      return Math.abs(p.x - c.x) < hx + ex && Math.abs(p.z - c.z) < hz + ez && p.y < maxY;
    });
  }

  private pulverizer(h: HazardState, dt: number, active: boolean): void {
    const spec = PULVERIZERS.find((p) => p.id === h.id)!;
    const inZone = active ? this.inCircle(spec.center, spec.radius) : [];
    switch (h.phase) {
      case 'idle':
        h.state = 0;
        if (inZone.length) {
          h.dwell += dt;
          if (h.dwell > 0.45) {
            h.phase = 'warn';
            h.timer = 0.55;
            h.target = inZone[0];
            this.emit(h, 'warn');
          }
        } else h.dwell = Math.max(0, h.dwell - dt);
        break;
      case 'warn':
        h.timer -= dt;
        h.state = 0;
        if (h.timer <= 0) {
          h.phase = 'strike';
          h.timer = 0;
          this.emit(h, 'strike');
        }
        break;
      case 'strike':
        h.timer += dt;
        h.state = Math.min(1, (h.timer / 0.16) ** 2);
        if (h.state >= 1) {
          for (const b of this.inCircle(spec.center, spec.radius * 0.95)) this.slam(b, spec.center);
          h.phase = 'hold';
          h.timer = 0.35;
        }
        break;
      case 'hold':
        h.timer -= dt;
        if (h.timer <= 0) {
          h.phase = 'retract';
          h.timer = 1.1;
          this.emit(h, 'retract');
        }
        break;
      case 'retract':
        h.timer -= dt;
        h.state = clamp01(h.timer / 1.1);
        if (h.timer <= 0) {
          h.phase = 'cool';
          h.timer = 2.2;
          h.target = null;
        }
        break;
      case 'cool':
        h.timer -= dt;
        h.state = 0;
        if (h.timer <= 0) {
          h.phase = 'idle';
          h.dwell = 0;
        }
        break;
    }
  }

  private slam(b: BotSim, center: Vec3): void {
    const host = this.host;
    const m = b.spec.massKg;
    const p = b.pos;
    const point = vec(p.x, p.y + b.half.y * 2, p.z);
    const away = norm(vec(p.x - center.x, 0, p.z - center.z));
    b.body.applyImpulseAtPoint(add(vec(0, -m * 3.2, 0), vec(away.x * m * 1.2, 0, away.z * m * 1.2)), point, true);
    // The rebound: robots hop after the hammer lifts.
    b.body.applyImpulse(vec(0, m * 2.2, 0), true);
    b.body.applyTorqueImpulse(vec(host.rng.range(-1, 1) * m * 0.4, 0, host.rng.range(-1, 1) * m * 0.4), true);
    const energy = 9000 * b.mScale;
    b.damage({
      amount: 52 * b.mScale,
      facet: b.inverted ? 'belly' : 'top',
      kind: 'pulverizer',
      attacker: null,
      point,
      dir: vec(0, -1, 0),
      energy,
      threat: 'blunt',
      severity: 0.85,
    });
  }

  private killsaw(h: HazardState, dt: number, active: boolean): void {
    const spec = KILLSAWS.find((k) => k.id === h.id)!;
    const over = active ? this.inRect(spec.center, spec.zone.hx, spec.zone.hz, 0.35) : [];
    h.spin += dt * (h.state > 0 || h.phase === 'warn' ? 55 : 8);
    switch (h.phase) {
      case 'idle':
        h.state = 0;
        if (over.length) {
          h.dwell += dt;
          if (h.dwell > 0.15) {
            h.phase = 'warn';
            h.timer = 0.22;
            h.target = over[0];
            this.emit(h, 'warn');
          }
        } else {
          h.dwell = 0;
          if (active) {
            h.flourish -= dt;
            if (h.flourish <= 0) {
              h.flourish = this.host.rng.range(9, 18);
              h.phase = 'warn';
              h.timer = 0.3;
              h.target = null;
              this.emit(h, 'warn');
            }
          }
        }
        break;
      case 'warn':
        h.timer -= dt;
        if (h.timer <= 0) {
          h.phase = 'strike';
          h.timer = 0;
          this.emit(h, 'strike');
        }
        break;
      case 'strike':
        h.timer += dt;
        h.state = clamp01(h.timer / 0.12);
        if (h.state >= 1) {
          h.phase = 'hold';
          h.timer = 0.75;
        }
        this.sawBite(h, spec, over);
        break;
      case 'hold':
        h.timer -= dt;
        this.sawBite(h, spec, over);
        if (h.timer <= 0) {
          h.phase = 'retract';
          h.timer = 0.35;
          this.emit(h, 'retract');
        }
        break;
      case 'retract':
        h.timer -= dt;
        h.state = clamp01(h.timer / 0.35);
        if (h.timer <= 0) {
          h.phase = 'cool';
          h.timer = 1.4;
          h.target = null;
        }
        break;
      case 'cool':
        h.timer -= dt;
        h.state = 0;
        if (h.timer <= 0) {
          h.phase = 'idle';
          h.dwell = 0;
        }
        break;
    }
  }

  private sawBite(h: HazardState, spec: (typeof KILLSAWS)[number], over: BotSim[]): void {
    if (h.state < 0.4) return;
    const host = this.host;
    for (const b of over) {
      const last = h.lastHit.get(b.id) ?? -9;
      if (host.t - last < 0.35) continue;
      h.lastHit.set(b.id, host.t);
      const m = b.spec.massKg;
      const p = b.pos;
      const point = vec(spec.center.x, 0.03, Math.max(spec.center.z - spec.length / 2, Math.min(spec.center.z + spec.length / 2, p.z)));
      // The blade runs along Z, so it throws robots along the slot and up.
      const along = host.rng.chance(0.5) ? 1 : -1;
      const under = vec((point.x + p.x) / 2, 0.03, (point.z + p.z) / 2);
      b.body.applyImpulseAtPoint(vec(host.rng.range(-0.3, 0.3) * m, m * 2.1, along * m * 1.0), under, true);
      b.damage({
        amount: 30 * b.mScale,
        facet: b.inverted ? 'top' : 'belly',
        kind: 'killsaw',
        attacker: null,
        point,
        dir: vec(0, 1, 0),
        energy: 5000 * b.mScale,
        threat: 'saw',
        severity: 0.7,
      });
      this.host.emit({ type: 'grind', t: host.t, point, dir: vec(0, 1, along * 0.4), intensity: 1, material: b.spec.loadout.armor.material });
    }
  }

  private ramrod(h: HazardState, dt: number, active: boolean): void {
    const spec = RAMRODS.find((r) => r.id === h.id)!;
    const over = active ? this.inRect(spec.center, spec.hx, spec.hz, 0.4) : [];
    switch (h.phase) {
      case 'idle':
        h.state = 0;
        if (over.length) {
          h.dwell += dt;
          if (h.dwell > 0.25) {
            h.phase = 'warn';
            h.timer = 0.3;
            h.target = over[0];
            this.emit(h, 'warn');
          }
        } else h.dwell = 0;
        break;
      case 'warn':
        h.timer -= dt;
        if (h.timer <= 0) {
          h.phase = 'strike';
          h.timer = 0;
          this.emit(h, 'strike');
        }
        break;
      case 'strike':
        h.timer += dt;
        h.state = clamp01(h.timer / 0.07);
        if (h.state >= 1) {
          for (const b of this.inRect(spec.center, spec.hx, spec.hz, 0.4)) this.punch(b, spec.center);
          h.phase = 'hold';
          h.timer = 0.25;
        }
        break;
      case 'hold':
        h.timer -= dt;
        if (h.timer <= 0) {
          h.phase = 'retract';
          h.timer = 0.5;
          this.emit(h, 'retract');
        }
        break;
      case 'retract':
        h.timer -= dt;
        h.state = clamp01(h.timer / 0.5);
        if (h.timer <= 0) {
          h.phase = 'cool';
          h.timer = 1.2;
          h.target = null;
        }
        break;
      case 'cool':
        h.timer -= dt;
        h.state = 0;
        if (h.timer <= 0) {
          h.phase = 'idle';
          h.dwell = 0;
        }
        break;
    }
  }

  private punch(b: BotSim, center: Vec3): void {
    const host = this.host;
    const m = b.spec.massKg;
    const p = b.pos;
    // Spikes hit one side harder, so robots tip.
    const off = vec(host.rng.range(-0.15, 0.15) * b.spec.width, 0, host.rng.range(-0.15, 0.15) * b.spec.length);
    const point = add(vec(p.x, 0.02, p.z), off);
    b.body.applyImpulseAtPoint(vec(0, m * 1.9, 0), point, true);
    const dir = norm(sub(p, center));
    b.damage({
      amount: 16 * b.mScale,
      facet: b.inverted ? 'top' : 'belly',
      kind: 'ramrod',
      attacker: null,
      point,
      dir: vec(dir.x * 0.2, 1, dir.z * 0.2),
      energy: 2500 * b.mScale,
      threat: 'blunt',
      severity: 0.45,
    });
  }
}
