// An eight-robot bracket for one weight class: the rookie, plus the class's seven seeds.

import type { Loadout, WeightClass } from '../contract';
import { rivalById, rivalsFor } from '../data/roster';
import type { BracketView } from '../ui/types';
import type { BracketMatchSave, SeasonSave } from './save';

export const PLAYER = 'player';
export const ROUND_IDS = ['quarter', 'semi', 'final'] as const;
const ROUND_NAMES = ['Quarterfinals', 'Semifinals', 'Final'];

export function newSeason(cls: WeightClass, loadout: Loadout): SeasonSave {
  const seeds = rivalsFor(cls).map((r) => r.id); // index 0 is seed 1
  const s = (n: number) => seeds[n - 1];
  const m = (a: string, b: string): BracketMatchSave => ({ a, b, winner: null, result: null });
  const empty = (): BracketMatchSave => ({ a: null, b: null, winner: null, result: null });
  return {
    cls,
    rounds: [
      [m(PLAYER, s(7)), m(s(4), s(5)), m(s(1), s(6)), m(s(2), s(3))],
      [empty(), empty()],
      [empty()],
    ],
    damage: null,
    loadout,
    done: false,
    champion: false,
  };
}

/** The player's next fight, or null when the season is over. */
export function nextFight(s: SeasonSave): { round: number; match: number; opponent: string } | null {
  if (s.done) return null;
  for (let r = 0; r < s.rounds.length; r++) {
    for (let i = 0; i < s.rounds[r].length; i++) {
      const m = s.rounds[r][i];
      if (m.winner) continue;
      if (m.a === PLAYER && m.b) return { round: r, match: i, opponent: m.b };
      if (m.b === PLAYER && m.a) return { round: r, match: i, opponent: m.a };
    }
  }
  return null;
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function resultText(method: string, time: number, totals?: Record<string, number>, winner?: string | null): string {
  if (method === 'decision' && totals && winner) {
    const w = totals[winner];
    const l = Object.entries(totals).find(([id]) => id !== winner)?.[1] ?? 0;
    return `${w}-${l}`;
  }
  if (method === 'tapout') return `Tap out ${fmtTime(time)}`;
  return `KO ${fmtTime(time)}`;
}

/** Record a finished match and push its winner into the next round. */
export function record(s: SeasonSave, round: number, match: number, winner: string, result: string): void {
  const m = s.rounds[round][match];
  m.winner = winner;
  m.result = result;
  if (round + 1 < s.rounds.length) {
    const next = s.rounds[round + 1][Math.floor(match / 2)];
    if (match % 2 === 0) next.a = winner;
    else next.b = winner;
  }
}

/** Settle every rival-only match in a round (the ones the player does not fight). */
export function simulateRound(s: SeasonSave, round: number): void {
  s.rounds[round].forEach((m, i) => {
    if (m.winner || !m.a || !m.b || m.a === PLAYER || m.b === PLAYER) return;
    const ra = rivalById(m.a)!;
    const rb = rivalById(m.b)!;
    const edge = (ra.skill - rb.skill) * 5 + (rb.seed - ra.seed) * 0.12;
    const pA = 1 / (1 + Math.exp(-edge));
    const aWins = Math.random() < pA;
    const winner = aWins ? m.a : m.b;
    let text: string;
    if (Math.random() < 0.62) text = `KO ${fmtTime(25 + Math.random() * 150)}`;
    else {
      const w = 23 + Math.floor(Math.random() * 18);
      text = `${w}-${45 - w}`;
    }
    record(s, round, i, winner, text);
  });
}

export function bracketView(s: SeasonSave, playerName: string): BracketView {
  const slot = (id: string | null) =>
    id ? { id, name: id === PLAYER ? playerName : rivalById(id)?.card.name ?? id, player: id === PLAYER } : null;
  const next = nextFight(s);
  return {
    cls: s.cls,
    rounds: s.rounds.map((matches, r) => ({
      label: ROUND_NAMES[r],
      matches: matches.map((m) => ({ a: slot(m.a), b: slot(m.b), winner: m.winner, result: m.result })),
    })),
    next: next ? { round: next.round, match: next.match } : null,
  };
}

export function describeSeason(s: SeasonSave): string {
  const n = nextFight(s);
  if (!n) return s.champion ? 'Champion' : 'Season over';
  const opp = rivalById(n.opponent)?.card.name ?? n.opponent;
  const cls = s.cls === 'super' ? 'Super heavyweight' : s.cls[0].toUpperCase() + s.cls.slice(1) + 'weight';
  return `${cls} ${ROUND_IDS[n.round] === 'final' ? 'final' : ROUND_IDS[n.round] + 'final'} vs ${opp}`;
}
