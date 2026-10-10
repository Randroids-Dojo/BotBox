// Handling metrics per loadout: acceleration, stopping, spin rate and overshoot, straight-line
// wobble, turning radius, pitch/roll bounce, with the weapon off and on.
import type { DriveCommand, Entrant, Loadout } from '../../src/contract';
import { JUGGERNAUT_PRIME, NEMESIS, SCRAP_LOADOUT } from '../../src/data/campaign';
import { rivalById } from '../../src/data/roster';
import { Match } from '../../src/sim/match';
import { yawOf } from '../../src/sim/math';
import { loadRapier } from '../../src/sim/rapier';
import { buildSpec } from '../../src/sim/spec';
const R = await loadRapier();
const C = (o: Partial<DriveCommand> = {}): DriveCommand => ({ throttle: 0, turn: 0, weapon: false, weaponPressed: false, selfRight: false, ...o });
const deg = (r: number) => (r * 180) / Math.PI;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
function setup(l: Loadout, armed: boolean) {
  const e: Entrant[] = [
    { id: 'p', corner: 'red', spec: buildSpec(l), card: { name: 'x', team: '', hometown: '', builders: '', blurb: '' }, control: 'player', skill: 1 },
    { id: 'dummy', corner: 'blue', spec: buildSpec(SCRAP_LOADOUT), card: { name: 'y', team: '', hometown: '', builders: '', blurb: '' }, control: 'player', skill: 1 },
  ];
  const m = new Match(R, { entrants: e, length: 300, seed: 1, positions: { p: { x: 0, z: 3, yaw: 0 }, dummy: { x: 6, z: 6, yaw: 0 } } });
  m.hazardsOn = false;
  m.startFight();
  const b = m.bot('p')!;
  for (let i = 0; i < 60; i++) m.step();
  if (armed && b.isSpinner) { b.armed = true; for (let i = 0; i < 120 * 3; i++) m.step(); }
  return { m, b };
}
function run(m: Match, _b: unknown, cmd: DriveCommand, sec: number, each?: (t: number) => void) {
  m.setCommand('p', cmd);
  for (let i = 0; i < sec * 120; i++) { m.step(); each?.(i / 120); }
}
const planar = (b: { body: { linvel(): { x: number; z: number } } }) => Math.hypot(b.body.linvel().x, b.body.linvel().z);
function tilt(b: { up: { x: number; y: number; z: number } }) { return deg(Math.acos(Math.max(-1, Math.min(1, b.up.y)))); }
const loadouts: [string, Loadout][] = [
  ['scrap', SCRAP_LOADOUT],
  ['prime', JUGGERNAUT_PRIME],
  ['nemesis', NEMESIS.loadout],
  ['flapjack', rivalById('flapjack')!.loadout],
  ['snowplow', rivalById('snowplow')!.loadout],
];
for (const [name, l] of loadouts) for (const armed of [false, true]) {
  const spec = buildSpec(l);
  if (armed && !['vdisk', 'drum', 'hbar', 'shell'].includes(l.weapon)) continue;
  const row: string[] = [`${name}${armed ? '+spin' : ''}`.padEnd(14), `top ${spec.stats.topSpeed.toFixed(1)}m/s`];
  // 1. acceleration
  let { m, b } = setup(l, armed);
  const v: number[] = [];
  let maxTilt = 0;
  run(m, b, C({ throttle: 1 }), 2, (t) => { if ([0.25, 0.5, 1, 2 - 1 / 120].some((x) => Math.abs(t - x) < 0.005)) v.push(planar(b)); maxTilt = Math.max(maxTilt, tilt(b)); });
  row.push(`v@.25/.5/1/2s ${v.map((x) => x.toFixed(2)).join('/')}`);
  row.push(`accel tilt ${maxTilt.toFixed(1)}deg`);
  // 2. stop from speed (release)
  const p0 = { ...b.pos };
  let stopT = 0;
  run(m, b, C(), 2, (t) => { if (!stopT && planar(b) < 0.05) stopT = t; });
  row.push(`coast stop ${Math.hypot(b.pos.x - p0.x, b.pos.z - p0.z).toFixed(2)}m in ${stopT ? stopT.toFixed(2) : '>2'}s`);
  m.dispose();
  // 3. spin in place and overshoot
  ({ m, b } = setup(l, armed));
  const yaws: number[] = [];
  let y0 = yawOf(b.quat), acc = 0, prev = y0;
  maxTilt = 0;
  run(m, b, C({ turn: 1 }), 1, (t) => { const y = yawOf(b.quat); acc += wrap(y - prev); prev = y; if ([0.25, 0.5, 1 - 1 / 120].some((x) => Math.abs(t - x) < 0.005)) yaws.push(acc); maxTilt = Math.max(maxTilt, tilt(b)); });
  const atRelease = acc;
  const drift0 = { ...b.pos };
  run(m, b, C(), 1.5, () => { const y = yawOf(b.quat); acc += wrap(y - prev); prev = y; });
  row.push(`spin deg@.25/.5/1 ${yaws.map((x) => deg(Math.abs(x)).toFixed(0)).join('/')}`);
  row.push(`overshoot ${deg(Math.abs(acc - atRelease)).toFixed(0)}deg`);
  row.push(`spin drift ${Math.hypot(b.pos.x - drift0.x, b.pos.z - drift0.z).toFixed(2)}m tilt ${maxTilt.toFixed(1)}`);
  m.dispose();
  // 4. straight line wobble
  ({ m, b } = setup(l, armed));
  y0 = yawOf(b.quat);
  let maxDev = 0;
  const yr: number[] = [];
  run(m, b, C({ throttle: 1 }), 2.5, (t) => { if (t > 0.5) { maxDev = Math.max(maxDev, Math.abs(wrap(yawOf(b.quat) - y0))); yr.push(b.body.angvel().y); } });
  const mean = yr.reduce((s, x) => s + x, 0) / yr.length;
  const sd = Math.sqrt(yr.reduce((s, x) => s + (x - mean) ** 2, 0) / yr.length);
  row.push(`straight drift ${deg(maxDev).toFixed(1)}deg yawjit ${deg(sd).toFixed(1)}deg/s`);
  m.dispose();
  // 5. turning radius at full throttle + full turn
  ({ m, b } = setup(l, armed));
  const pts: { x: number; z: number }[] = [];
  run(m, b, C({ throttle: 1, turn: 0.6 }), 3, (t) => { if (t > 1) pts.push({ ...b.pos }); });
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
  const rad = pts.reduce((s, p) => s + Math.hypot(p.x - cx, p.z - cz), 0) / pts.length;
  row.push(`radius(t=.6) ${rad.toFixed(2)}m`);
  m.dispose();
  console.log(row.join(' | '));
}
