import { beforeAll, describe, expect, it } from 'vitest';
import type { Entrant } from '../src/contract';
import { ARENA_HALF } from '../src/data/arena';
import { rivalById, rivalsFor } from '../src/data/roster';
import { judge } from '../src/sim/judges';
import { Match } from '../src/sim/match';
import { loadRapier, type Rapier } from '../src/sim/rapier';
import { Rng } from '../src/sim/rng';
import { buildSpec } from '../src/sim/spec';
import { newSeason, nextFight, record, simulateRound, PLAYER } from '../src/game/season';
import { starterLoadout } from '../src/game/starter';

let R: Rapier;
beforeAll(async () => {
  R = await loadRapier();
});

const ent = (id: string, corner: 'red' | 'blue', control: 'ai' | 'player' = 'ai'): Entrant => {
  const r = rivalById(id)!;
  return { id, corner, spec: buildSpec(r.loadout), card: r.card, control, skill: r.skill };
};

describe('sim', () => {
  it('a robot drives forward at close to its rated top speed', () => {
    const m = new Match(R, { entrants: [ent('undertow', 'red', 'player')], length: 60, seed: 1 });
    m.startFight();
    for (let i = 0; i < 180; i++) {
      m.setCommand('undertow', { throttle: 1, turn: 0, weapon: false, weaponPressed: false, selfRight: false });
      m.step();
    }
    const v = m.bots[0].body.linvel();
    const speed = Math.hypot(v.x, v.z);
    expect(speed).toBeGreaterThan(m.bots[0].spec.stats.topSpeed * 0.8);
    expect(m.bots[0].up.y).toBeGreaterThan(0.99);
    m.dispose();
  });

  it('a spinner reaches most of its rpm within its spin-up time', () => {
    const m = new Match(R, { entrants: [ent('megahurtz', 'red', 'player')], length: 60, seed: 1 });
    m.startFight();
    const b = m.bots[0];
    const sp = b.spinnerSpec!;
    m.setCommand('megahurtz', { throttle: 0, turn: 0, weapon: true, weaponPressed: true, selfRight: false });
    m.step();
    m.setCommand('megahurtz', { throttle: 0, turn: 0, weapon: false, weaponPressed: false, selfRight: false });
    for (let i = 0; i < sp.spinupSec * 120; i++) m.step();
    expect(b.spin01).toBeGreaterThan(0.8);
    m.dispose();
  });

  it('AI fights stay inside the Box and produce a result', () => {
    const rivals = rivalsFor('heavy');
    const m = new Match(R, { entrants: [ent(rivals[0].id, 'red'), ent(rivals[4].id, 'blue')], length: 40, seed: 7 });
    m.startFight();
    let hits = 0;
    for (let i = 0; i < 42 * 120 && m.phase !== 'over'; i++) {
      m.step();
      for (const e of m.drainEvents()) if (e.type === 'hit') hits++;
      for (const b of m.bots) {
        const p = b.pos;
        expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
        expect(Math.abs(p.x)).toBeLessThan(ARENA_HALF + 0.5);
        expect(Math.abs(p.z)).toBeLessThan(ARENA_HALF + 0.5);
      }
    }
    expect(m.phase).toBe('over');
    expect(m.result).not.toBeNull();
    expect(hits).toBeGreaterThan(0);
    m.dispose();
  });
});

describe('judges', () => {
  it('scores add up to 45 and never tie', () => {
    const rng = new Rng(3);
    const z = { damageDealt: 0, damageTaken: 0, hits: 0, bigHits: 0, attackTime: 0, controlTime: 0, hazardDamageDealt: 0, flips: 0 };
    for (let i = 0; i < 50; i++) {
      const a = { ...z, damageDealt: rng.range(0, 200), attackTime: rng.range(0, 90), hits: Math.floor(rng.range(0, 30)) };
      const b = { ...z, damageDealt: rng.range(0, 200), attackTime: rng.range(0, 90), hits: Math.floor(rng.range(0, 30)) };
      const { totals } = judge('a', a, 'b', b, rng);
      expect(totals.a + totals.b).toBe(45);
      expect(totals.a).not.toBe(totals.b);
    }
  });
});

describe('season', () => {
  it('runs a bracket to a champion', () => {
    const s = newSeason('heavy', starterLoadout('heavy'));
    for (let round = 0; round < 3; round++) {
      const n = nextFight(s)!;
      expect(n.round).toBe(round);
      record(s, n.round, n.match, PLAYER, 'KO 1:00');
      simulateRound(s, n.round);
    }
    expect(nextFight(s)).toBeNull();
    expect(s.rounds[2][0].winner).toBe(PLAYER);
  });
});
