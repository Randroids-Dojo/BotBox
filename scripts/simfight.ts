// Headless fights for tuning: npx tsx scripts/simfight.ts [rivalA] [rivalB] [seconds] [seed]
// With no args, runs every heavyweight pairing once.
import type { Entrant } from '../src/contract';
import { ROSTER, rivalById, rivalsFor } from '../src/data/roster';
import { Match } from '../src/sim/match';
import { loadRapier } from '../src/sim/rapier';
import { buildSpec } from '../src/sim/spec';

const R = await loadRapier();

function entrant(id: string, corner: 'red' | 'blue'): Entrant {
  const r = rivalById(id)!;
  return { id, corner, spec: buildSpec(r.loadout), card: r.card, control: 'ai', skill: r.skill };
}

function fight(a: string, b: string, length: number, seed: number, verbose: boolean) {
  const m = new Match(R, { entrants: [entrant(a, 'red'), entrant(b, 'blue')], length, seed });
  m.startFight();
  const counts: Record<string, number> = {};
  let maxSev = 0;
  let lastKo = '';
  let steps = 0;
  const t0 = performance.now();
  while (m.phase !== 'over' && steps < (length + 2) * 120) {
    m.step();
    steps++;
    for (const e of m.drainEvents()) {
      counts[e.type] = (counts[e.type] ?? 0) + 1;
      if (e.type === 'hit') {
        counts[`hit:${e.kind}`] = (counts[`hit:${e.kind}`] ?? 0) + 1;
        maxSev = Math.max(maxSev, e.severity);
        if (verbose && e.severity > 0.3) console.log(`  ${e.t.toFixed(1)}s ${e.kind} ${e.attacker ?? 'arena'} -> ${e.victim} ${e.facet} E=${e.energy.toFixed(0)} dmg=${e.damage.toFixed(1)} sev=${e.severity.toFixed(2)}`);
      } else if (e.type === 'ko') {
        const kb = m.bot(e.bot)!;
        const why = kb.disabledReason === 'ko' ? (kb.inverted ? 'inverted' : kb.onSide ? 'on side' : !kb.driveCapable ? (kb.wheelsDown === 0 ? 'no wheels down' : 'drive dead') : 'stuck') : kb.disabledReason;
        counts[`ko:${why}`] = 1;
        lastKo = `${e.bot} ${why}`;
      } else if (verbose && ['panel_off', 'wheel_off', 'component_down', 'fire_start', 'flipped', 'ko', 'release', 'righted'].includes(e.type)) {
        console.log(`  ${e.t.toFixed(1)}s ${e.type} ${JSON.stringify(e).slice(0, 120)}`);
      }
    }
  }
  const ms = performance.now() - t0;
  const r = m.result;
  const f = m.frame();
  const hp = (id: string) => {
    const b = f.bots.find((x) => x.id === id)!;
    const facets = Object.values(b.facets).reduce((s, x) => s + x, 0) / 6;
    const parts = Object.values(b.parts).reduce((s, x) => s + x, 0) / 5;
    return `armor ${(facets * 100).toFixed(0)}% parts ${(parts * 100).toFixed(0)}%`;
  };
  console.log(
    `${a} vs ${b}: ${r ? `${r.winner} by ${r.method} at ${r.time.toFixed(1)}s${r.totals ? ` (${Object.values(r.totals).join('-')})` : ''}` : 'no result'} | ${a} ${hp(a)} | ${b} ${hp(b)} | ${lastKo} | hits ${counts.hit ?? 0} maxSev ${maxSev.toFixed(2)} | ${(ms / steps).toFixed(3)} ms/step`,
  );
  if (verbose) console.log('  events', counts);
  m.dispose();
}

const [a, b, len, seed] = process.argv.slice(2);
if (a && b) fight(a, b, Number(len ?? 180), Number(seed ?? 1), true);
else {
  const cls = (a as never) || 'heavy';
  const rs = rivalsFor(cls).map((r) => r.id);
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) fight(rs[i], rs[j], 180, i * 7 + j, false);
}
void ROSTER;
