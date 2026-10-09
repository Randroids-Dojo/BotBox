// The rookie's first robot and helpers for player loadouts.

import type { Loadout, WeightClass } from '../contract';
import { CLASS_LIMIT_LB } from '../data/parts';
import { checkLoadout } from '../sim/spec';

export function starterLoadout(cls: WeightClass = 'heavy'): Loadout {
  return {
    name: 'Rust Bucket',
    cls,
    chassis: 'box',
    drive: 'chair4',
    power: 'nicad',
    weapon: 'vdisk',
    armor: { material: 'aluminum', grade: 2 },
    extras: ['wheelguards', 'srimech'],
    paint: { primary: '#c2531b', secondary: '#2b2b2b', accent: '#f2d16b', pattern: 'stripes', finish: 'matte', decal: 'ROOKIE' },
  };
}

/** Move a loadout to another class, dropping extras until it makes weight. */
export function toClass(l: Loadout, cls: WeightClass): Loadout {
  const out: Loadout = { ...l, cls, extras: [...l.extras] };
  while (!checkLoadout(out).ok && out.extras.length) out.extras.pop();
  if (checkLoadout(out).weightLb > CLASS_LIMIT_LB[cls] && out.armor.grade > 1) out.armor = { ...out.armor, grade: 1 };
  return out;
}
