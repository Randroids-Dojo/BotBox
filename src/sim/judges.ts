// Judges' decision: three judges each split 5 points per category between two robots.
// Totals are out of 45, so there is never a tie.

import type { JudgeCard, MatchStats } from '../contract';
import { clamp } from './math';
import type { Rng } from './rng';

export const JUDGES = [
  { name: 'Dr. Elaine Park', bias: { aggression: 0.9, strategy: 1.2, damage: 1.0 } },
  { name: 'Rick Darrow', bias: { aggression: 1.0, strategy: 0.85, damage: 1.25 } },
  { name: 'Gus Feldman', bias: { aggression: 1.2, strategy: 1.0, damage: 0.9 } },
];

function share(a: number, b: number): number {
  const s = a + b;
  return s <= 1e-6 ? 0.5 : a / s;
}

/** Split 5 points by share, with a little per-judge noise. */
function split(shareA: number, noise: number): [number, number] {
  const a = clamp(Math.round(shareA * 5 + noise), 0, 5);
  return [a, 5 - a];
}

export function judge(idA: string, a: MatchStats, idB: string, b: MatchStats, rng: Rng): { cards: JudgeCard[]; totals: Record<string, number> } {
  const aggA = a.attackTime + a.hits * 1.5 + a.controlTime * 0.5;
  const aggB = b.attackTime + b.hits * 1.5 + b.controlTime * 0.5;
  const strA = a.controlTime * 2 + a.hazardDamageDealt * 0.4 + a.flips * 6 + Math.max(0, b.damageTaken - a.damageTaken) * 0.15 + 4;
  const strB = b.controlTime * 2 + b.hazardDamageDealt * 0.4 + b.flips * 6 + Math.max(0, a.damageTaken - b.damageTaken) * 0.15 + 4;
  const dmgA = a.damageDealt + a.bigHits * 10 + 1;
  const dmgB = b.damageDealt + b.bigHits * 10 + 1;
  const cards: JudgeCard[] = [];
  const totals: Record<string, number> = { [idA]: 0, [idB]: 0 };
  for (const j of JUDGES) {
    const sharp = (x: number, bias: number) => clamp(0.5 + (x - 0.5) * 1.35 * bias, 0, 1);
    const [ag1, ag2] = split(sharp(share(aggA, aggB), j.bias.aggression), rng.gauss() * 0.35);
    const [st1, st2] = split(sharp(share(strA, strB), j.bias.strategy), rng.gauss() * 0.35);
    const [dm1, dm2] = split(sharp(share(dmgA, dmgB), j.bias.damage), rng.gauss() * 0.3);
    cards.push({
      judge: j.name,
      aggression: { [idA]: ag1, [idB]: ag2 },
      strategy: { [idA]: st1, [idB]: st2 },
      damage: { [idA]: dm1, [idB]: dm2 },
    });
    totals[idA] += ag1 + st1 + dm1;
    totals[idB] += ag2 + st2 + dm2;
  }
  return { cards, totals };
}
