// The parts catalog. Weights are heavyweight pounds and scale with the class limit.
// Physical numbers here feed src/sim/spec.ts; copy feeds the garage.

import type {
  ArmorGrade,
  ArmorMaterialId,
  ChassisId,
  DriveId,
  ExtraId,
  PowerId,
  WeaponId,
  WeightClass,
} from '../contract';

export const CLASS_LIMIT_LB: Record<WeightClass, number> = { light: 60, middle: 120, heavy: 220, super: 340 };
export const CLASS_LABEL: Record<WeightClass, string> = {
  light: 'Lightweight',
  middle: 'Middleweight',
  heavy: 'Heavyweight',
  super: 'Super heavyweight',
};
export const CLASSES: readonly WeightClass[] = ['light', 'middle', 'heavy', 'super'];
export const LB_TO_KG = 0.45359237;

/** Weight multiplier relative to a heavyweight. */
export function massScale(cls: WeightClass): number {
  return CLASS_LIMIT_LB[cls] / CLASS_LIMIT_LB.heavy;
}
/** Linear size multiplier relative to a heavyweight. */
export function sizeScale(cls: WeightClass): number {
  return Math.cbrt(massScale(cls));
}

/** Radio receiver, speed controllers, wiring, switch. Every robot carries it. */
export const ELECTRONICS_LB = 8;

export interface PartBase {
  label: string;
  /** One line for the garage. */
  blurb: string;
  /** Heavyweight pounds. */
  lb: number;
}

export interface ChassisPart extends PartBase {
  /** Frame dimensions at heavyweight, meters. */
  length: number;
  width: number;
  height: number;
  /** Relative armor area: scales armor weight and facet HP. */
  armorArea: number;
  invertible: boolean;
}

export const CHASSIS: Record<ChassisId, ChassisPart> = {
  box: {
    label: 'Box frame',
    blurb: 'Welded steel tube box. Room for anything, armor on every side.',
    lb: 30,
    length: 0.9,
    width: 0.6,
    height: 0.3,
    armorArea: 1.0,
    invertible: false,
  },
  wedge: {
    label: 'Full wedge',
    blurb: 'The whole robot is a ramp. Gets under spinners and deflects hits off the front.',
    lb: 34,
    length: 0.98,
    width: 0.62,
    height: 0.32,
    armorArea: 1.05,
    invertible: false,
  },
  invertible: {
    label: 'Low-profile invertible',
    blurb: 'Thinner than its wheels. Drives the same on its back. Hard to get under.',
    lb: 26,
    length: 0.92,
    width: 0.66,
    height: 0.17,
    armorArea: 0.8,
    invertible: true,
  },
  shell: {
    label: 'Shell base',
    blurb: 'Round base for a full-body spinner. The spinning shell is the armor.',
    lb: 22,
    length: 0.86,
    width: 0.86,
    height: 0.28,
    armorArea: 0.55,
    invertible: false,
  },
};

export interface DrivePart extends PartBase {
  wheels: 2 | 4 | 6;
  wheelRadius: number;
  wheelWidth: number;
  /** m/s at full throttle on a healthy battery. */
  topSpeed: number;
  /** Total tractive force, N, at heavyweight. */
  force: number;
  /** Share of weight on driven wheels (2WD robots ride on a skid at the back). */
  driveLoad: number;
  /** Lateral scrub resistance when skid steering, higher turns slower. */
  scrub: number;
  /** Average draw in watts when driving hard (heavyweight). */
  watts: number;
}

export const DRIVES: Record<DriveId, DrivePart> = {
  drill2: {
    label: '2WD drill motors',
    blurb: 'Two cordless drill motors and gearboxes. Light and cheap. Gets shoved around.',
    lb: 20,
    wheels: 2,
    wheelRadius: 0.09,
    wheelWidth: 0.06,
    topSpeed: 3.8,
    force: 640,
    driveLoad: 0.72,
    scrub: 0.6,
    watts: 450,
  },
  mag2: {
    label: '2WD Magmotors',
    blurb: 'Two big permanent-magnet motors. Fast and twitchy, middling push.',
    lb: 34,
    wheels: 2,
    wheelRadius: 0.1,
    wheelWidth: 0.07,
    topSpeed: 6.2,
    force: 820,
    driveLoad: 0.75,
    scrub: 0.7,
    watts: 900,
  },
  chair4: {
    label: '4WD wheelchair motors',
    blurb: 'Four geared wheelchair motors. Torquey, sure-footed, never quick.',
    lb: 52,
    wheels: 4,
    wheelRadius: 0.1,
    wheelWidth: 0.07,
    topSpeed: 3.6,
    force: 1150,
    driveLoad: 1.0,
    scrub: 1.0,
    watts: 700,
  },
  skid6: {
    label: '6WD skid steer',
    blurb: 'Six wheels, chain driven. Wins every shoving match and turns like a truck.',
    lb: 62,
    wheels: 6,
    wheelRadius: 0.085,
    wheelWidth: 0.07,
    topSpeed: 4.2,
    force: 1350,
    driveLoad: 1.0,
    scrub: 1.35,
    watts: 950,
  },
};

export interface PowerPart extends PartBase {
  /** Usable energy, kJ, at heavyweight. */
  capacityKJ: number;
  /** Peak power multiplier (spin-up and acceleration). */
  punch: number;
  /** Component HP multiplier for the battery. */
  toughness: number;
  /** Chance per heavy battery hit of catching fire once the battery is below 40%. */
  fireRisk: number;
}

export const POWER: Record<PowerId, PowerPart> = {
  sla: {
    label: 'Sealed lead-acid',
    blurb: 'Heavy bricks. Robust, never catches fire, a little sluggish.',
    lb: 32,
    capacityKJ: 300,
    punch: 0.85,
    toughness: 1.4,
    fireRisk: 0,
  },
  nicad: {
    label: 'NiCad packs',
    blurb: 'The builder favorite. Punchy and light. Puncture one and it burns.',
    lb: 21,
    capacityKJ: 260,
    punch: 1.0,
    toughness: 1.0,
    fireRisk: 0.35,
  },
  nimh: {
    label: 'NiMH packs',
    blurb: 'Cutting edge for 2001. Lightest option, fragile, fades late in a fight.',
    lb: 15,
    capacityKJ: 200,
    punch: 0.95,
    toughness: 0.75,
    fireRisk: 0.12,
  },
};

export interface WeaponPart extends PartBase {
  /** Short weapon type for cards. */
  short: string;
  /** Chassis this weapon cannot mount on. */
  notOn: ChassisId[];
  /** Weapons that let the robot self-right without a srimech, with success odds. */
  selfRight: number;
  /** Watts the weapon motor draws while working. */
  watts: number;
}

export const WEAPONS: Record<WeaponId, WeaponPart> = {
  none: {
    label: 'No active weapon',
    short: 'Pusher',
    blurb: 'All drive and armor. Shove them into the saws and let the Box do the work.',
    lb: 0,
    notOn: ['shell'],
    selfRight: 0,
    watts: 0,
  },
  vdisk: {
    label: 'Vertical disk',
    short: 'Vertical spinner',
    blurb: 'A toothed steel disk spinning up and over. Throws robots at the ceiling.',
    lb: 48,
    notOn: ['shell'],
    selfRight: 0,
    watts: 1800,
  },
  drum: {
    label: 'Drum spinner',
    short: 'Drum spinner',
    blurb: 'A short heavy drum with two teeth. Bites reliably, hard to stop.',
    lb: 44,
    notOn: ['shell'],
    selfRight: 0,
    watts: 1600,
  },
  hbar: {
    label: 'Horizontal bar',
    short: 'Horizontal spinner',
    blurb: 'A long steel bar sweeping flat. Rips off wheels and side armor. Hates wedges.',
    lb: 52,
    notOn: ['shell'],
    selfRight: 0,
    watts: 2000,
  },
  shell: {
    label: 'Full-body shell',
    short: 'Shell spinner',
    blurb: 'The whole robot spins. Enormous stored energy, slow to spin up, hard to steer.',
    lb: 70,
    notOn: ['box', 'wedge', 'invertible'],
    selfRight: 0,
    watts: 2200,
  },
  flipper: {
    label: 'Pneumatic flipper',
    short: 'Flipper',
    blurb: 'A CO2 ram under a wedge plate. Launches robots and rights itself. Limited gas.',
    lb: 46,
    notOn: ['shell'],
    selfRight: 0.9,
    watts: 0,
  },
  axe: {
    label: 'Pneumatic axe',
    short: 'Overhead axe',
    blurb: 'A pickaxe on a swing arm. Punches through top armor. Slow to recock.',
    lb: 42,
    notOn: ['shell'],
    selfRight: 0.55,
    watts: 0,
  },
  lifter: {
    label: 'Electric lifter',
    short: 'Lifter',
    blurb: 'Forks on a geared arm. Pick them up, carry them to a hazard, keep them there.',
    lb: 34,
    notOn: ['shell'],
    selfRight: 0.65,
    watts: 900,
  },
};

export interface ArmorMaterial {
  label: string;
  blurb: string;
  /** Weight per unit area relative to aluminum. */
  weight: number;
  /** HP per unit relative to aluminum. */
  hp: number;
  /** Damage divisors by threat (higher shrugs it off). */
  vsSpinner: number;
  vsBlunt: number;
  vsSaw: number;
  /** Sparks emitted when struck, 0..1.5. */
  sparks: number;
}

export const ARMOR: Record<ArmorMaterialId, ArmorMaterial> = {
  aluminum: {
    label: 'Aluminum 6061',
    blurb: 'Light, easy to machine, dents instead of cracking.',
    weight: 1,
    hp: 1,
    vsSpinner: 1,
    vsBlunt: 1,
    vsSaw: 1,
    sparks: 0.6,
  },
  titanium: {
    label: 'Titanium',
    blurb: 'Strong for its weight. Throws white sparks everywhere.',
    weight: 1.15,
    hp: 1.7,
    vsSpinner: 1.2,
    vsBlunt: 1.1,
    vsSaw: 1.25,
    sparks: 1.5,
  },
  uhmw: {
    label: 'UHMW plastic',
    blurb: 'Slick plastic that soaks up spinner hits. Saws eat it alive.',
    weight: 0.75,
    hp: 0.9,
    vsSpinner: 1.6,
    vsBlunt: 0.9,
    vsSaw: 0.5,
    sparks: 0,
  },
  polycarb: {
    label: 'Polycarbonate',
    blurb: 'See-through and very light. Flexes, then shatters.',
    weight: 0.55,
    hp: 0.65,
    vsSpinner: 0.9,
    vsBlunt: 1.1,
    vsSaw: 0.6,
    sparks: 0,
  },
  steel: {
    label: 'Hardened steel',
    blurb: 'AR400 plate. Nearly indestructible and brutally heavy.',
    weight: 2.2,
    hp: 2.4,
    vsSpinner: 1,
    vsBlunt: 1.2,
    vsSaw: 1.3,
    sparks: 1.1,
  },
};

export const ARMOR_GRADE: Record<ArmorGrade, { label: string; weight: number; hp: number; mm: number }> = {
  1: { label: 'Light', weight: 1, hp: 1, mm: 3 },
  2: { label: 'Medium', weight: 2, hp: 2.1, mm: 6 },
  3: { label: 'Heavy', weight: 3, hp: 3.3, mm: 10 },
};

/** Heavyweight armor pounds for aluminum, light grade, armorArea 1. */
export const ARMOR_BASE_LB = 14;
/** Heavyweight facet HP for aluminum, light grade, armorArea 1, before facet share. */
export const ARMOR_BASE_HP = 260;

export interface ExtraPart extends PartBase {
  notWithWeapon: WeaponId[];
  notOn: ChassisId[];
}

export const EXTRAS: Record<ExtraId, ExtraPart> = {
  wedgeplate: {
    label: 'Front wedge plate',
    blurb: 'A hinged plate that scrapes the floor. Gets under almost anything.',
    lb: 8,
    notWithWeapon: ['vdisk', 'drum', 'flipper', 'lifter', 'shell'],
    notOn: ['shell'],
  },
  skirts: {
    label: 'Ground skirts',
    blurb: 'Hinged skirts on the sides and back. Wedges slide off instead of under.',
    lb: 10,
    notWithWeapon: [],
    notOn: ['shell'],
  },
  srimech: {
    label: 'Srimech',
    blurb: 'Self-righting mechanism. A pneumatic arm on the roof that pushes you back over.',
    lb: 12,
    notWithWeapon: [],
    notOn: ['invertible'],
  },
  wheelguards: {
    label: 'Wheel guards',
    blurb: 'Steel guards over exposed wheels. Spinners stop tearing your wheels off.',
    lb: 9,
    notWithWeapon: [],
    notOn: ['invertible', 'shell'],
  },
  spikes: {
    label: 'Ram spikes',
    blurb: 'Hardened spikes on the nose. Every shove becomes a stab.',
    lb: 5,
    notWithWeapon: ['vdisk', 'drum', 'flipper', 'lifter', 'shell'],
    notOn: ['shell'],
  },
};

export const CHASSIS_IDS = Object.keys(CHASSIS) as ChassisId[];
export const DRIVE_IDS = Object.keys(DRIVES) as DriveId[];
export const POWER_IDS = Object.keys(POWER) as PowerId[];
export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];
export const ARMOR_IDS = Object.keys(ARMOR) as ArmorMaterialId[];
export const EXTRA_IDS = Object.keys(EXTRAS) as ExtraId[];
