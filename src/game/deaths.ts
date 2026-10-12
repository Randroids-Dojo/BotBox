// The montage's losses, one way to go down each: flipped onto its back with a srimech that keeps
// falling back, shoved sideways across the killsaws, axed through the lid until the radio dies,
// and rammed into the spikes until the battery catches fire and the team taps out. Choreographed
// on the sim alone (no stage), so a headless test can check that every one of them happens.

import type { BotCard, Entrant, Loadout, MatchEvent } from '../contract';
import { careerRivalById } from '../data/campaign';
import type { AiScript } from '../sim/ai';
import { Match } from '../sim/match';
import type { Rapier } from '../sim/rapier';
import { buildSpec } from '../sim/spec';
import type { Damage } from '../ui/types';

export type DeathKind = 'turtle' | 'saws' | 'axe' | 'fire';

/** Beats for the director's camera: the death lands, and later, the wreck afterwards. */
export type DeathCue = 'hit' | 'after';

interface Plan {
  jug: { x: number; z: number; yaw: number };
  foe: { x: number; z: number };
  hazards: boolean;
  script: AiScript;
  /** Seconds after the hit for the 'after' beat. */
  after: number;
}

const PLANS: Record<DeathKind, Plan> = {
  // Flapjack drives straight in and fires.
  turtle: { jug: { x: -0.6, z: 0.4, yaw: 0.5 }, foe: { x: 0.9, z: -0.35 }, hazards: false, script: 'strike', after: 1.5 },
  // Juggernaut faces north beside the west saws; Snowplow comes at its flank from the east.
  saws: { jug: { x: -2.05, z: 0, yaw: 0 }, foe: { x: -0.25, z: 0.05 }, hazards: true, script: 'charge', after: 2.2 },
  // Chop Suey drives up to the nose and swings.
  axe: { jug: { x: 0.45, z: 0.25, yaw: 0.25 }, foe: { x: -1.05, z: -0.2 }, hazards: false, script: 'strike', after: 1.3 },
  // Trash Panda comes from the south-west and rams it into the east spikestrip, leaving the
  // close-up from the north-west clear of it.
  fire: { jug: { x: 6.2, z: 0.2, yaw: 0 }, foe: { x: 4.6, z: -1.3 }, hazards: false, script: 'charge', after: 1.4 },
};

const JUG = 'juggernaut';

function face(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.atan2(-(b.x - a.x), -(b.z - a.z));
}

export class DeathClip {
  readonly match: Match;
  readonly entrants: Entrant[];
  readonly foeId: string;
  t = 0;
  hitAt = -1;
  /** What actually happened, for tests. */
  readonly seen = { sawHits: 0, axeHits: 0, srimechTries: 0, tappedOut: false };
  private plan: Plan;
  private slowUntil = 0;
  private slowScale = 1;
  private afterDone = false;

  constructor(R: Rapier, readonly kind: DeathKind, mine: Loadout, foeId: string, carried: Damage, card: BotCard) {
    const foe = careerRivalById(foeId);
    if (!foe) throw new Error(`no rival ${foeId}`);
    this.foeId = foe.id;
    const p = (this.plan = PLANS[kind]);
    this.entrants = [
      { id: JUG, corner: 'red', spec: buildSpec(mine), card, control: 'ai', skill: 0.4, carried },
      { id: foe.id, corner: 'blue', spec: buildSpec(foe.loadout), card: foe.card, control: 'ai', skill: 0.9 },
    ];
    this.match = new Match(R, {
      entrants: this.entrants,
      length: 60,
      seed: 11,
      positions: { [JUG]: { x: p.jug.x, z: p.jug.z, yaw: p.jug.yaw }, [foe.id]: { ...p.foe, yaw: face(p.foe, p.jug) } },
    });
    const m = this.match;
    m.hazardsOn = p.hazards;
    m.setAiScript(JUG, 'idle');
    m.setAiScript(foe.id, p.script);
    m.startFight();
    // Flipped, it stays flipped: the srimech fires and falls back.
    if (kind === 'turtle') this.jug.cannotRight = true;
  }

  get jug() {
    return this.match.bot(JUG)!;
  }

  get foe() {
    return this.match.bot(this.foeId)!;
  }

  private slow(scale: number, hold: number): void {
    this.slowScale = scale;
    this.slowUntil = this.t + hold;
    this.match.timeScale = scale;
  }

  private apart(): number {
    return Math.hypot(this.jug.pos.x - this.foe.pos.x, this.jug.pos.z - this.foe.pos.z);
  }

  /** Advance one real-time frame. */
  tick(dt: number): { events: MatchEvent[]; cue: DeathCue | null } {
    const m = this.match;
    this.t += dt;
    if (this.t < this.slowUntil) m.timeScale = this.slowScale;
    else m.timeScale = Math.min(1, m.timeScale + dt * 1.1);
    // Nobody is counted out mid-clip: the clip ends the fight, not the ten count.
    for (const b of [this.jug, this.foe]) {
      b.koCount = null;
      b.immobileTime = 0;
      b.stuckTime = 0;
    }
    m.advance(dt);
    const events = m.drainEvents();
    let cue: DeathCue | null = null;
    const landed = this.hitAt < 0 && this.trigger(events);
    if (landed) {
      this.hitAt = this.t;
      cue = 'hit';
    }
    for (const e of events) {
      if (e.type === 'hit' && e.victim === JUG && e.kind === 'killsaw') this.seen.sawHits++;
      if (e.type === 'hit' && e.victim === JUG && e.kind === 'axe') this.seen.axeHits++;
      if (e.type === 'weapon_fire' && e.bot === JUG && e.kind === 'srimech') this.seen.srimechTries++;
    }
    if (this.hitAt >= 0 && !this.afterDone && this.t - this.hitAt > this.plan.after) {
      this.afterDone = true;
      cue = cue ?? 'after';
    }
    // The fire: the crew watches it burn for a moment, then throws the towel.
    if (this.kind === 'fire' && this.hitAt >= 0 && !this.seen.tappedOut && this.t - this.hitAt > 2.6) {
      this.seen.tappedOut = true;
      m.tapOut(JUG);
    }
    return { events, cue };
  }

  /** The death itself, on contact (or a little late, so a clip never waits on a miss). */
  private trigger(events: MatchEvent[]): boolean {
    const m = this.match;
    const struck = events.some((e) => e.type === 'hit' && e.attacker === this.foeId && e.victim === JUG);
    switch (this.kind) {
      case 'turtle': {
        const fired = events.some((e) => e.type === 'weapon_fire' && e.bot === this.foeId);
        if (!((fired && this.apart() < 1.4) || struck || this.t > 2.4)) return false;
        m.finisher(this.foeId, JUG, 'flip', { power: 1 });
        m.setAiScript(this.foeId, 'idle');
        this.slow(0.3, 1.1);
        return true;
      }
      case 'saws': {
        if (!events.some((e) => e.type === 'hit' && e.victim === JUG && e.kind === 'killsaw') && this.t < 3.5) return false;
        this.slow(0.35, 1.2);
        return true;
      }
      case 'axe': {
        const axed = events.some((e) => e.type === 'hit' && e.attacker === this.foeId && e.victim === JUG && e.kind === 'axe');
        if (!axed && this.t < 3) return false;
        m.finisher(this.foeId, JUG, 'axe', { kill: true });
        this.slow(0.3, 0.9);
        return true;
      }
      case 'fire': {
        if (!(struck || this.apart() < 1.05 || this.t > 2.5)) return false;
        m.finisher(this.foeId, JUG, 'slam', { power: 0.3, fire: true });
        // Backs off, so the fire is in plain view.
        m.setAiScript(this.foeId, 'passive');
        this.slow(0.4, 0.8);
        return true;
      }
    }
  }

  dispose(): void {
    this.match.dispose();
  }
}
