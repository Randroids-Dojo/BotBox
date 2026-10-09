// The Box: one layout shared by the sim (colliders, hazard zones) and the renderer (meshes).
// World frame: +X east, +Z south, +Y up, floor at y = 0, center at the origin.

import type { Corner, Vec3 } from '../contract';

/** Inner floor half-size: a 48 ft square. */
export const ARENA_HALF = 7.3;
/** Steel kick wall height above the floor. */
export const KICK_WALL_H = 0.6;
/** Lexan wall top and the Lexan ceiling. */
export const LEXAN_TOP = 5.0;
/** Wall thickness (colliders sit outside the floor half-size). */
export const WALL_T = 0.3;

export interface StartSquare {
  corner: Corner;
  center: Vec3;
  /** Half-size of the painted square. */
  half: number;
  /** Heading the robot faces at the start (radians about +Y, 0 faces -Z / north). */
  yaw: number;
  color: string;
}

/** Yaw that faces from `from` toward the arena center. Robots face -Z at yaw 0. */
function faceCenter(x: number, z: number): number {
  return Math.atan2(x, z);
}

export const START_SQUARES: StartSquare[] = [
  { corner: 'red', center: { x: -4.7, y: 0, z: 4.7 }, half: 1.1, yaw: faceCenter(-4.7, 4.7), color: '#d81e1e' },
  { corner: 'blue', center: { x: 4.7, y: 0, z: -4.7 }, half: 1.1, yaw: faceCenter(4.7, -4.7), color: '#1e5bd8' },
  // Rumble only.
  { corner: 'green', center: { x: -4.7, y: 0, z: -1.6 }, half: 0.9, yaw: faceCenter(-4.7, -1.6), color: '#1fa83a' },
  { corner: 'yellow', center: { x: 4.7, y: 0, z: 1.6 }, half: 0.9, yaw: faceCenter(4.7, 1.6), color: '#e0b400' },
];

export interface PulverizerSpec {
  id: string;
  /** Strike center on the floor. */
  center: Vec3;
  /** Strike zone radius. */
  radius: number;
  /** Hammer pivot (on the gantry, up and toward the corner). */
  pivot: Vec3;
  /** Arm length from pivot to head center. */
  arm: number;
  /** Hammer head: cylinder radius and length. */
  headRadius: number;
  headLength: number;
}

const PULV_ARM = 2.6;
export const PULVERIZERS: PulverizerSpec[] = [
  {
    id: 'pulv-nw',
    center: { x: -5.6, y: 0, z: -5.6 },
    radius: 1.0,
    pivot: { x: -7.0, y: 2.7, z: -7.0 },
    arm: PULV_ARM,
    headRadius: 0.32,
    headLength: 0.8,
  },
  {
    id: 'pulv-se',
    center: { x: 5.6, y: 0, z: 5.6 },
    radius: 1.0,
    pivot: { x: 7.0, y: 2.7, z: 7.0 },
    arm: PULV_ARM,
    headRadius: 0.32,
    headLength: 0.8,
  },
];

export interface KillsawSpec {
  id: string;
  /** Slot center on the floor. Slots run north-south (along Z). */
  center: Vec3;
  /** Slot length (Z) and width (X). */
  length: number;
  width: number;
  bladeRadius: number;
  /** Blade height above the floor at full extension (blade center stays below the floor). */
  rise: number;
  /** Trigger zone half-size around the slot. */
  zone: { hx: number; hz: number };
}

function sawStrip(prefix: string, x: number): KillsawSpec[] {
  return [-2.0, 0, 2.0].map((z, i) => ({
    id: `${prefix}-${i}`,
    center: { x, y: 0, z },
    length: 1.1,
    width: 0.07,
    bladeRadius: 0.42,
    rise: 0.32,
    zone: { hx: 0.45, hz: 0.6 },
  }));
}

export const KILLSAWS: KillsawSpec[] = [...sawStrip('saw-w', -3.0), ...sawStrip('saw-e', 3.0)];

export interface RamrodPatchSpec {
  id: string;
  center: Vec3;
  /** Patch half-size. */
  hx: number;
  hz: number;
  /** Spike grid. */
  cols: number;
  rows: number;
  spikeRadius: number;
  /** Spike height at full extension. */
  rise: number;
}

export const RAMRODS: RamrodPatchSpec[] = [
  { id: 'ram-n', center: { x: 0, y: 0, z: -4.4 }, hx: 1.0, hz: 0.6, cols: 6, rows: 4, spikeRadius: 0.035, rise: 0.22 },
  { id: 'ram-s', center: { x: 0, y: 0, z: 4.4 }, hx: 1.0, hz: 0.6, cols: 6, rows: 4, spikeRadius: 0.035, rise: 0.22 },
];

export interface SpikestripSpec {
  id: string;
  /** Wall the strip is bolted to. */
  wall: 'east' | 'west';
  /** Z range along the wall. */
  z0: number;
  z1: number;
  /** Spike length out from the wall and spacing. */
  reach: number;
  spacing: number;
  height: number;
}

export const SPIKESTRIPS: SpikestripSpec[] = [
  { id: 'spike-w', wall: 'west', z0: -3.6, z1: 3.6, reach: 0.22, spacing: 0.3, height: 0.32 },
  { id: 'spike-e', wall: 'east', z0: -3.6, z1: 3.6, reach: 0.22, spacing: 0.3, height: 0.32 },
];

/** Light tree for the countdown, on the north wall above the kick plate, facing south. */
export const LIGHT_TREE = { pos: { x: 0, y: 2.2, z: -ARENA_HALF - 0.2 } };

/** Driver stations, outside the south wall. */
export const DRIVER_STATIONS = [
  { corner: 'red' as Corner, pos: { x: -3.2, y: 1.2, z: ARENA_HALF + 2.2 } },
  { corner: 'blue' as Corner, pos: { x: 3.2, y: 1.2, z: ARENA_HALF + 2.2 } },
];

/** Announcer booth and the main broadcast camera position (high south-east). */
export const BOOTH = { pos: { x: 9.5, y: 6.5, z: 12.5 } };
/** Big screen above the north stands. */
export const BIG_SCREEN = { pos: { x: 0, y: 9.5, z: -15.5 }, w: 8, h: 4.5 };
