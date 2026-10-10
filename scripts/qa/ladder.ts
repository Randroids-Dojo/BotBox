// Career balance: a plausible player build at each rung vs that rung's rival, AI driven.
import type { Entrant, Loadout } from '../../src/contract';
import { FIGHTS, JUGGERNAUT_PRIME, fightLoadout, SCRAP_LOADOUT, careerRivalById } from '../../src/data/campaign';
import { Match } from '../../src/sim/match';
import { loadRapier } from '../../src/sim/rapier';
import { buildSpec, checkLoadout } from '../../src/sim/spec';
const R = await loadRapier();
const N = Number(process.argv[2] ?? 8);
const scrap = SCRAP_LOADOUT;
const wedge: Loadout = { ...scrap, chassis: 'wedge', armor: { material: 'uhmw', grade: 1 }, extras: ['spikes'] };
const regional: Loadout = { ...scrap, chassis: 'box', drive: 'chair4', power: 'nicad', weapon: 'drum', armor: { material: 'uhmw', grade: 2 }, extras: ['wheelguards'] };
const entry: Loadout = { ...scrap, power: 'nicad', weapon: 'vdisk', armor: { material: 'uhmw', grade: 1 }, extras: [] };
const entry2: Loadout = { ...entry, armor: { material: 'uhmw', grade: 3 } };
const entry3: Loadout = { ...entry, armor: { material: 'aluminum', grade: 3 } };
const core: Loadout = { ...entry, drive: 'chair4', armor: { material: 'aluminum', grade: 2 } };
const core3: Loadout = { ...entry, extras: ['srimech'] };
const core4: Loadout = { ...entry, drive: 'chair4', extras: ['srimech'] };
const core2: Loadout = { ...entry, drive: 'chair4', armor: { material: 'uhmw', grade: 2 }, extras: ['wheelguards'] };
const regional2: Loadout = { ...regional, weapon: 'vdisk', armor: { material: 'steel', grade: 1 }, extras: ['wheelguards', 'srimech'] };
const show: Loadout = { ...regional, weapon: 'vdisk', armor: { material: 'titanium', grade: 1 }, extras: ['wheelguards', 'srimech'] };
const champ: Loadout = { ...JUGGERNAUT_PRIME };
const only = process.argv[4];
const all: [string, Loadout, number[]][] = [
  ['scrap', scrap, [0, 1, 2, 3]],
  ['wedge', wedge, [0, 1, 2, 3]],
  ['regional', regional, [4, 5, 6, 7]],
  ['regional2', regional2, [4, 5, 6, 7]],
  ['entry', entry, [4, 5, 6, 7]],
  ['entry2', entry2, [4, 5, 6, 7]],
  ['entry3', entry3, [4, 5, 6, 7]],
  ['core', core, [4, 5, 6, 7]],
  ['core2', core2, [4, 5, 6, 7]],
  ['core3', core3, [4, 5, 6, 7]],
  ['core4', core4, [4, 5, 6, 7]],
  ['show', show, [8, 9, 10, 11]],
  ['champ', champ, [4, 8, 10, 11, 12]],
];
const builds = only ? all.filter((b) => only.split(',').includes(b[0])) : all;
const PSKILL = Number(process.argv[3] ?? 0.7);
for (const [name, l, rungs] of builds) {
  const chk = checkLoadout(l);
  if (!chk.ok) { console.log(name, 'ILLEGAL', chk.weightLb, JSON.stringify(chk)); continue; }
  for (const i of rungs) {
    const f = FIGHTS[i];
    const r = careerRivalById(f.opponent)!;
    let wins = 0;
    for (let s = 0; s < N; s++) {
      const e: Entrant[] = [
        { id: 'player', corner: 'red', spec: buildSpec(l), card: r.card, control: 'ai', skill: PSKILL },
        { id: r.id, corner: 'blue', spec: buildSpec(fightLoadout(f)), card: r.card, control: 'ai', skill: f.skill },
      ];
      const m = new Match(R, { entrants: e, length: i < 4 ? 120 : 180, seed: 100 + s * 17, styles: { player: l.weapon === 'none' ? 'bully' : 'aggressive' } });
      m.startFight();
      let steps = 0;
      while (m.phase !== 'over' && steps < 200 * 120) { m.step(); steps++; m.drainEvents(); }
      if (m.result?.winner === 'player') wins++;
      m.dispose();
    }
    console.log(`${name.padEnd(9)} ${chk.weightLb.toFixed(0)}lb  c${i + 1} ${f.opponent.padEnd(18)} skill ${f.skill}  win ${wins}/${N}`);
  }
}
