// Stat formatting, garage stat bars, plain-language advice and scouting tips, all derived from
// BotSpec so the garage, scouting card and lower thirds agree with the sim.

import type { BotSpec, BotStats, Loadout, WeightClass } from '../contract';
import { ARMOR, ARMOR_GRADE, CHASSIS, DRIVES, POWER, WEAPONS, massScale } from '../data/parts';

export const MPH = 2.23694;
export const LBF = 0.224809;

export function fmtRuntime(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface StatDef {
  id: string;
  label: string;
  /** Value for comparing (higher is better). */
  value(s: BotStats, cls: WeightClass): number;
  /** Bar fill 0..1. */
  bar(s: BotStats, cls: WeightClass): number;
  text(s: BotStats): string;
  /** Format a difference. */
  delta(d: number): string;
}

const sign = (d: number, digits = 0) => `${d > 0 ? '+' : ''}${d.toFixed(digits)}`;

export const STAT_DEFS: StatDef[] = [
  {
    id: 'speed',
    label: 'Top speed',
    value: (s) => s.topSpeed * MPH,
    bar: (s) => (s.topSpeed * MPH) / 15,
    text: (s) => `${(s.topSpeed * MPH).toFixed(1)} mph`,
    delta: (d) => sign(d, 1),
  },
  {
    id: 'push',
    label: 'Push',
    value: (s) => s.pushN * LBF,
    bar: (s, c) => s.pushN / (1450 * massScale(c)),
    text: (s) => `${Math.round(s.pushN * LBF)} lbf`,
    delta: (d) => sign(d),
  },
  {
    id: 'weapon',
    label: 'Weapon',
    value: (s) => s.weaponEnergyKJ,
    bar: (s, c) => s.weaponEnergyKJ / (22 * massScale(c)),
    text: (s) => (s.weaponLabel === 'None' ? 'None' : s.weaponEnergyKJ > 0 ? `${s.weaponEnergyKJ.toFixed(1)} kJ` : s.weaponLabel),
    delta: (d) => `${sign(d, 1)} kJ`,
  },
  {
    id: 'armor',
    label: 'Armor',
    value: (s) => s.armorHp,
    bar: (s, c) => s.armorHp / (2100 * massScale(c)),
    text: (s) => `${Math.round(s.armorHp)} hp`,
    delta: (d) => sign(d),
  },
  {
    id: 'runtime',
    label: 'Runtime',
    value: (s) => s.runtimeSec,
    bar: (s) => s.runtimeSec / 420,
    text: (s) => fmtRuntime(s.runtimeSec),
    delta: (d) => `${d > 0 ? '+' : '-'}${fmtRuntime(Math.abs(d))}`,
  },
];

/** Advice that is not a hard rule (checkLoadout covers those). */
export function advice(spec: BotSpec): string[] {
  const s = spec.stats;
  const out: string[] = [];
  if (s.runtimeSec < 180) out.push(`Battery runs flat at ${fmtRuntime(s.runtimeSec)}. The fight is 3:00.`);
  if (!s.selfRight && !s.invertible) out.push('No way back over. One flip and you get counted out.');
  const spare = s.limitLb - s.weightLb;
  if (spare > s.limitLb * 0.12) out.push(`${spare.toFixed(0)} lb to spare. Bolt on more armor.`);
  if (spec.loadout.weapon === 'none' && !spec.loadout.extras.includes('wedgeplate') && spec.loadout.chassis !== 'wedge')
    out.push('No weapon and no wedge. You will need the hazards.');
  return out;
}

function isSpinner(w: Loadout['weapon']): boolean {
  return w === 'vdisk' || w === 'drum' || w === 'hbar' || w === 'shell';
}

/** A short tactical read on an opponent, optionally tuned to the player's own robot. */
export function scoutTip(opp: BotSpec, mine?: Loadout | null): string {
  const o = opp.loadout;
  const lines: string[] = [];
  const low = o.chassis === 'wedge' || o.extras.includes('wedgeplate') || o.weapon === 'flipper' || o.weapon === 'lifter';
  const myWeapon = mine?.weapon;
  const mySpin = myWeapon ? isSpinner(myWeapon) : false;

  switch (o.weapon) {
    case 'vdisk':
    case 'drum':
      lines.push(o.weapon === 'vdisk' ? 'Big vertical disk.' : 'Heavy drum up front.');
      if (mine && (mine.chassis === 'wedge' || mine.extras.includes('wedgeplate'))) lines.push('Meet it wedge first and it bites the floor.');
      else lines.push('Never take it head on. Hit it from the side.');
      break;
    case 'hbar':
      lines.push('Horizontal bar at knee height.');
      lines.push(mine && (mine.chassis === 'wedge' || mine.extras.includes('wedgeplate')) ? 'Your wedge throws that bar up. Charge it.' : 'Rush it before it spins up.');
      break;
    case 'shell':
      lines.push('Full-body shell. Slow to spin up.');
      lines.push('Hit it in the first ten seconds and pin it on a wall.');
      break;
    case 'flipper':
      lines.push(`Flipper with ${opp.weapon.kind === 'flipper' ? opp.weapon.shots : 14} shots of gas.`);
      lines.push(mine && (mine.chassis === 'invertible' || mine.extras.includes('srimech')) ? 'You can take a flip. Bait it, then hit it while it recharges.' : 'Bait a shot, then attack while it recharges.');
      break;
    case 'axe':
      lines.push('Overhead axe. Slow to recock.');
      lines.push('Let it swing and miss, then get in close.');
      break;
    case 'lifter':
      lines.push('Lifter with forks.');
      lines.push('Keep it off your front edge and away from the Pulverizers.');
      break;
    default:
      lines.push(low ? 'Low wedge, no weapon.' : 'Pure pusher.');
      lines.push(o.drive === 'skid6' || o.drive === 'chair4' ? 'Do not get in a shoving match. Stay off the walls.' : 'It wants you in the saws. Stay off the walls.');
  }

  // One hardware weakness.
  if (o.armor.material === 'polycarb') lines.push('Polycarbonate armor shatters. Every hit counts.');
  else if (o.armor.material === 'uhmw') lines.push(mySpin ? 'UHMW soaks spinners. Drag it over the killsaws.' : 'UHMW hates saws. Drag it over the killsaws.');
  else if (o.power === 'nicad' && o.armor.grade === 1) lines.push('Thin armor over NiCads. Hit the rear and it may burn.');
  else if (!opp.selfRight && !opp.invertible) lines.push('It cannot self-right. Flip it and it is over.');
  else if (o.drive === 'drill2') lines.push('Weak drill motors. Push it around.');
  else if (o.armor.material === 'steel') lines.push('Steel armor. Go for the wheels.');

  if (low && myWeapon && mySpin && o.weapon !== 'vdisk' && o.weapon !== 'drum') {
    return `Low wedge. Keep your ${myWeapon === 'hbar' ? 'bar' : myWeapon === 'drum' ? 'drum' : myWeapon === 'shell' ? 'shell' : 'disk'} spinning and hit it from the side.`;
  }
  return lines.slice(0, 3).join(' ');
}

/** One-line hardware rundown for cards. */
export function hardwareLine(l: Loadout): string {
  return `${CHASSIS[l.chassis].label}, ${DRIVES[l.drive].label}, ${POWER[l.power].label}, ${ARMOR_GRADE[l.armor.grade].label.toLowerCase()} ${ARMOR[l.armor.material].label}`;
}

export function weaponShort(l: Loadout): string {
  return WEAPONS[l.weapon].short;
}
