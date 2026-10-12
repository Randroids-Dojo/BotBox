import { beforeAll, describe, expect, it } from 'vitest';
import type { Entrant, Loadout } from '../src/contract';
import { JUGGERNAUT_PRIME, NEMESIS } from '../src/data/campaign';
import { DeathClip, type DeathKind } from '../src/game/deaths';
import { CHAMP_CARD, wear } from '../src/game/prologue';
import { yawOf } from '../src/sim/math';
import { Match } from '../src/sim/match';
import { loadRapier, type Rapier } from '../src/sim/rapier';
import { buildSpec } from '../src/sim/spec';

let R: Rapier;
beforeAll(async () => {
  R = await loadRapier();
});

const tired: Loadout = { ...JUGGERNAUT_PRIME, armor: { material: 'steel', grade: 1 } };
const worn: Loadout = { ...tired, drive: 'drill2', power: 'sla', extras: ['srimech'] };

/** Run a montage death for five seconds of uneven frames. */
function play(kind: DeathKind, mine: Loadout, foe: string, fps: number): DeathClip {
  const c = new DeathClip(R, kind, mine, foe, wear(0.7), CHAMP_CARD);
  for (let i = 0; i < fps * 5; i++) c.tick((1 / fps) * (1 + 0.15 * Math.sin(i * 1.7)));
  return c;
}

describe('montage deaths', () => {
  for (const fps of [30, 60, 120]) {
    it(`each loss goes down its own way (${fps} fps)`, () => {
      const turtle = play('turtle', tired, 'flapjack', fps);
      expect(turtle.hitAt).toBeGreaterThan(0);
      expect(turtle.hitAt).toBeLessThan(1.5);
      // On its back, and the srimech tried and fell back.
      expect(turtle.jug.inverted).toBe(true);
      expect(turtle.seen.srimechTries).toBeGreaterThan(0);
      turtle.dispose();

      const saws = play('saws', worn, 'snowplow', fps);
      expect(saws.seen.sawHits).toBeGreaterThan(0);
      saws.dispose();

      const axe = play('axe', worn, 'chop-suey', fps);
      expect(axe.seen.axeHits).toBeGreaterThan(0);
      expect(axe.jug.disabledReason).toBe('radio');
      axe.dispose();

      const fire = play('fire', worn, 'trash-panda', fps);
      expect(fire.jug.fire).toBeGreaterThan(0);
      expect(fire.seen.tappedOut).toBe(true);
      expect(fire.match.phase).toBe('over');
      fire.dispose();
    });
  }
});

describe('the side hit', () => {
  it('rolls the champion onto its back and tears it apart', () => {
    for (let run = 0; run < 6; run++) {
      const pAt = { x: -1.5 + run * 0.5, z: 1.0 - run * 0.4 };
      const entrants: Entrant[] = [
        { id: 'player', corner: 'red', spec: buildSpec(JUGGERNAUT_PRIME), card: CHAMP_CARD, control: 'player', skill: 1 },
        { id: NEMESIS.id, corner: 'blue', spec: buildSpec(NEMESIS.loadout), card: NEMESIS.card, control: 'ai', skill: NEMESIS.skill },
      ];
      const m = new Match(R, { entrants, length: 45, seed: 7 + run, positions: { player: { ...pAt, yaw: run * 0.9 }, [NEMESIS.id]: { x: 3, z: -3, yaw: 0 } } });
      m.hazardsOn = false;
      m.startFight();
      const me = m.bot('player')!;
      const tv = m.bot(NEMESIS.id)!;
      for (let i = 0; i < 60; i++) m.step();
      // Lined up on the left flank, as the prologue does it.
      const y = yawOf(me.quat);
      const at = { x: me.pos.x - Math.cos(y) * 2.8, z: me.pos.z + Math.sin(y) * 2.8 };
      tv.body.setTranslation({ x: at.x, y: tv.pos.y + 0.03, z: at.z }, true);
      const ty = Math.atan2(-(me.pos.x - at.x), -(me.pos.z - at.z));
      tv.body.setRotation({ x: 0, y: Math.sin(ty / 2), z: 0, w: Math.cos(ty / 2) }, true);
      m.setAiScript(NEMESIS.id, 'windup');
      for (let i = 0; i < 240; i++) m.step();
      m.setAiScript(NEMESIS.id, 'charge');
      // Until first contact, as the prologue does: a hit event or touching distance.
      let struck = false;
      for (let i = 0; i < 600 && !struck; i++) {
        m.step();
        struck = m.drainEvents().some((e) => e.type === 'hit' && e.attacker === NEMESIS.id && e.victim === 'player');
        if (Math.hypot(me.pos.x - tv.pos.x, me.pos.z - tv.pos.z) <= 1.05) struck = true;
      }
      expect(me.facetAt({ x: tv.pos.x, y: me.pos.y + 0.1, z: tv.pos.z })).toBe('left');
      m.finisher(NEMESIS.id, 'player', 'broadside', { kill: true, tear: true, power: 0.82 });
      m.setAiScript(NEMESIS.id, 'passive');
      for (let i = 0; i < 120 * 4; i++) {
        m.step();
        me.koCount = null;
      }
      const w = m.frame();
      const mine = w.bots.find((b) => b.id === 'player')!;
      expect(me.inverted).toBe(true);
      expect(mine.wheelLost.filter(Boolean).length).toBe(2);
      expect(w.debris.some((d) => d.kind === 'weapon' && d.bot === 'player')).toBe(true);
      m.dispose();
    }
  });
});
