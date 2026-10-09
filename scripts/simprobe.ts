// Single-robot probes: npx tsx scripts/simprobe.ts <rivalId> <test>
// tests: drive, turn, spin, idle
import type { Entrant } from '../src/contract';
import { rivalById } from '../src/data/roster';
import { Match } from '../src/sim/match';
import { loadRapier } from '../src/sim/rapier';
import { buildSpec } from '../src/sim/spec';
import { yawOf } from '../src/sim/math';

const R = await loadRapier();
const [id = 'megahurtz', test = 'drive'] = process.argv.slice(2);
const r = rivalById(id)!;
const e: Entrant = { id, corner: 'red', spec: buildSpec(r.loadout), card: r.card, control: 'player', skill: 1 };
const m = new Match(R, { entrants: [e], length: 60, seed: 1 });
m.startFight();
const b = m.bots[0];
console.log('mass', b.spec.massKg.toFixed(1), 'g', b.spec.groundClearance.toFixed(3), 'start y', b.pos.y.toFixed(3));
for (let i = 0; i < 480; i++) {
  const t = i / 120;
  const cmd = { throttle: 0, turn: 0, weapon: false, weaponPressed: false, selfRight: false };
  if (test === 'drive') cmd.throttle = t < 2 ? 1 : 0;
  if (test === 'turn') cmd.turn = 1;
  if (test === 'arc') { cmd.throttle = 1; cmd.turn = 0.5; }
  if (test === 'spin') { cmd.weaponPressed = i === 1; }
  if (test === 'spinturn') { cmd.weaponPressed = i === 1; cmd.turn = t > 2.5 ? 1 : 0; }
  m.setCommand(id, cmd);
  m.step();
  m.drainEvents();
  if (i % 30 === 0) {
    const p = b.pos, v = b.body.linvel(), w = b.body.angvel();
    console.log(`t=${t.toFixed(2)} pos=(${p.x.toFixed(2)},${p.y.toFixed(3)},${p.z.toFixed(2)}) v=${Math.hypot(v.x, v.z).toFixed(2)} vy=${v.y.toFixed(2)} yaw=${yawOf(b.quat).toFixed(2)} wy=${w.y.toFixed(2)} up.y=${b.up.y.toFixed(3)} wheels=${b.wheelContact.map((c) => (c ? 1 : 0)).join('')} rpm=${(b.omega * 60 / 6.283).toFixed(0)}`);
  }
}
