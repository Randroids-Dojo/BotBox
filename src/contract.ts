// Shared contracts between the simulation, the renderer, the audio engine, the broadcast UI
// and the game director. Owned by the lead. Module agents read this file; they never edit it.
//
// Frames and units
//   World: meters, kilograms, seconds, radians. +Y up. Arena floor is y = 0, arena center is the
//   origin, +X is east, +Z is south (toward the driver stations and the main broadcast camera).
//   Robot local frame: forward is -Z, right is +X, up is +Y. Origin is the center of the chassis
//   footprint at the belly plane (the underside of the hull). The belly sits `groundClearance`
//   above the floor when the robot rests on its wheels.

export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

// ---------------------------------------------------------------------------------------------
// Hardware

export type WeightClass = 'light' | 'middle' | 'heavy' | 'super';
export type ChassisId = 'box' | 'wedge' | 'invertible' | 'shell';
export type DriveId = 'drill2' | 'mag2' | 'chair4' | 'skid6';
export type PowerId = 'sla' | 'nicad' | 'nimh';
export type WeaponId = 'none' | 'vdisk' | 'drum' | 'hbar' | 'shell' | 'flipper' | 'axe' | 'lifter';
export type ArmorMaterialId = 'aluminum' | 'titanium' | 'uhmw' | 'polycarb' | 'steel';
/** 1 light, 2 medium, 3 heavy. */
export type ArmorGrade = 1 | 2 | 3;
export type ExtraId = 'wedgeplate' | 'skirts' | 'srimech' | 'wheelguards' | 'spikes';

export type Facet = 'front' | 'rear' | 'left' | 'right' | 'top' | 'belly';
export const FACETS: readonly Facet[] = ['front', 'rear', 'left', 'right', 'top', 'belly'];
export type Component = 'driveL' | 'driveR' | 'weapon' | 'battery' | 'electronics';
export const COMPONENTS: readonly Component[] = ['driveL', 'driveR', 'weapon', 'battery', 'electronics'];

export type PaintPattern = 'solid' | 'stripes' | 'flames' | 'checker' | 'hazard' | 'camo' | 'splatter' | 'number';
export type PaintFinish = 'gloss' | 'matte' | 'metal' | 'raw';

export interface Paint {
  /** CSS hex colors. */
  primary: string;
  secondary: string;
  accent: string;
  pattern: PaintPattern;
  finish: PaintFinish;
  /** Short text painted on the top panel (team initials, a number, a slogan). Max 10 chars. */
  decal?: string;
}

/** What a builder chooses. Everything physical is derived from this by `buildSpec`. */
export interface Loadout {
  name: string;
  cls: WeightClass;
  chassis: ChassisId;
  drive: DriveId;
  power: PowerId;
  weapon: WeaponId;
  armor: { material: ArmorMaterialId; grade: ArmorGrade };
  extras: ExtraId[];
  paint: Paint;
}

// ---------------------------------------------------------------------------------------------
// Physical spec, derived from a Loadout by src/sim/spec.ts. Shared by sim colliders and render
// meshes so what you see is what collides.

/** An armor plate: a box of size w (local X) by h (local Y) by t (local Z, the thickness),
 *  placed at `center` with rotation `rot` in the robot frame. Local +Z of the plate is its
 *  outward normal. */
export interface PanelSpec {
  facet: Facet;
  center: Vec3;
  rot: Quat;
  w: number;
  h: number;
  t: number;
}

export interface WheelSpec {
  /** Hub center in robot frame. */
  pos: Vec3;
  radius: number;
  width: number;
  /** -1 left, +1 right. */
  side: -1 | 1;
}

/** Internal component placement, for rendering exposed internals and for hit routing. */
export interface InternalSpec {
  component: Component;
  center: Vec3;
  size: Vec3;
}

export type SpinnerKind = 'vdisk' | 'drum' | 'hbar' | 'shell';

export interface SpinnerSpec {
  kind: SpinnerKind;
  /** Rotor center in robot frame. */
  center: Vec3;
  /** Spin axis in robot frame: 'x' for vertical disks and drums, 'y' for bars and shells. */
  axis: 'x' | 'y';
  /** Tip radius. For a bar, half its length. */
  radius: number;
  /** Extent along the axis (disk thickness, drum width, bar height, shell height). */
  width: number;
  /** Bar chord (for hbar: width of the bar seen from above). */
  chord: number;
  teeth: number;
  /** Tooth protrusion beyond the body of the rotor. */
  toothHeight: number;
  massKg: number;
  /** Moment of inertia about the spin axis, kg m^2. */
  inertia: number;
  maxRpm: number;
  /** Seconds from rest to 90% of max rpm with a healthy weapon motor and battery. */
  spinupSec: number;
  /** Positive spins so the leading edge at the front of the robot moves up (vertical) or
   *  toward the robot's right (horizontal). */
  direction: 1 | -1;
}

export interface ArmSpec {
  kind: 'flipper' | 'axe' | 'lifter';
  /** Hinge line center in robot frame. The hinge runs along local X. */
  hinge: Vec3;
  /** Arm or plate length from the hinge. */
  length: number;
  /** Plate or arm width along X. */
  width: number;
  /** Rest angle and fully deployed angle, radians, measured from the robot's forward axis
   *  rotating upward (positive pitches the arm's tip up). For an axe the arm rests pointing
   *  back over the robot (about +pi) and swings forward and down to about 0.1. */
  restAngle: number;
  maxAngle: number;
  /** Axe head size (box) at the arm tip, for axes. */
  head?: Vec3;
  /** Seconds to fully deploy. */
  deploySec: number;
  /** Seconds before it can fire again. */
  rechargeSec: number;
  /** Pneumatic shots in the tank, or Infinity for electric. */
  shots: number;
  /** Peak impulse delivered to a target, N s (flipper and axe), or lift force N (lifter). */
  power: number;
}

export interface WeaponSpecNone {
  kind: 'none';
}

export type WeaponSpec = SpinnerSpec | ArmSpec | WeaponSpecNone;

export interface BotStats {
  weightLb: number;
  limitLb: number;
  topSpeed: number; // m/s
  pushN: number; // N, total tractive force
  turnRate: number; // rad/s at full turn
  weaponEnergyKJ: number; // stored kJ at max rpm, or equivalent for arms
  weaponLabel: string;
  armorHp: number; // sum over facets
  runtimeSec: number; // at typical draw
  selfRight: boolean;
  invertible: boolean;
}

export interface BotSpec {
  loadout: Loadout;
  /** Linear scale for the weight class (heavyweight 1). */
  scale: number;
  massKg: number;
  /** Hull as one or more convex pieces in robot frame. The render hull must match within 2 cm. */
  hull: Vec3[][];
  /** Overall bounds of the hull in robot frame. */
  length: number;
  width: number;
  height: number;
  groundClearance: number;
  /** Lowest leading edge height above the floor at the front, for wedge contests. */
  frontEdgeHeight: number;
  panels: PanelSpec[];
  wheels: WheelSpec[];
  internals: InternalSpec[];
  weapon: WeaponSpec;
  /** Wheels reach the floor whichever side is up. */
  invertible: boolean;
  selfRight: boolean;
  /** Hit points per facet at full health. */
  facetHp: Record<Facet, number>;
  /** Hit points per component at full health. */
  componentHp: Record<Component, number>;
  stats: BotStats;
}

// ---------------------------------------------------------------------------------------------
// Simulation output, read every rendered frame. Plain data, safe to record for replays.

export interface WeaponFrame {
  /** Spinner rotor angle (rad), or arm angle (rad, same convention as ArmSpec). */
  angle: number;
  rpm: number;
  /** Spinner speed as a fraction of max rpm, 0..1. */
  spin01: number;
  /** Spinner motor on, or lifter being held up. */
  armed: boolean;
  /** Arm deployment 0 (rest) to 1 (full). */
  arm: number;
  /** Can fire now. */
  ready: boolean;
  shotsLeft: number;
}

export interface BotFrame {
  id: string;
  pos: Vec3;
  quat: Quat;
  vel: Vec3;
  angVel: Vec3;
  /** Rolling angle per wheel, same order as spec.wheels. */
  wheelSpin: number[];
  wheelContact: boolean[];
  /** Missing wheels (knocked off), same order as spec.wheels. */
  wheelLost: boolean[];
  /** Drive effort applied this step, -1..1 per side (audio motor load). */
  driveL: number;
  driveR: number;
  weapon: WeaponFrame;
  /** Facet health fraction 0..1. A facet at 0 has lost its panel. */
  facets: Record<Facet, number>;
  /** Component health fraction 0..1. */
  parts: Record<Component, number>;
  /** Battery charge remaining 0..1. */
  charge: number;
  smoke: number; // 0..1
  fire: number; // 0..1
  inverted: boolean;
  /** Counted out, dead electronics or tapped out. */
  disabled: boolean;
  /** Seconds left on the knockout count, or null when not counting. */
  koCount: number | null;
  /** Seconds this robot has been holding an opponent, or null. */
  holdTime: number | null;
}

export interface DebrisFrame {
  id: number;
  /** Robot id that shed it. */
  bot: string;
  kind: 'panel' | 'wheel' | 'tooth' | 'chunk';
  /** For panels, which facet it was. */
  facet?: Facet;
  /** For panels, index into spec.panels. For wheels, index into spec.wheels. */
  index?: number;
  pos: Vec3;
  quat: Quat;
  size: Vec3;
}

export type HazardKind = 'pulverizer' | 'killsaw' | 'ramrod' | 'spikestrip';

export interface HazardFrame {
  id: string;
  kind: HazardKind;
  /** 0..1 extension. Killsaw blade height, ramrod spike height, pulverizer hammer swing
   *  (0 raised, 1 struck floor). Spikestrips are always 1. */
  state: number;
  /** Saw blade rotation angle (rad). */
  spin: number;
  /** Armed and about to act (warning lights). */
  warn: boolean;
}

export type MatchPhase = 'idle' | 'countdown' | 'fight' | 'over';

export interface MatchFrame {
  phase: MatchPhase;
  /** Fight seconds remaining. */
  clock: number;
  /** Light tree: 0 off, 1..3 red lamps lit, 4 green. */
  lights: 0 | 1 | 2 | 3 | 4;
  /** Global time scale currently applied (slow motion beats). */
  timeScale: number;
}

export interface WorldFrame {
  /** Sim time in seconds since the world was created. */
  t: number;
  bots: BotFrame[];
  debris: DebrisFrame[];
  hazards: HazardFrame[];
  match: MatchFrame;
}

// ---------------------------------------------------------------------------------------------
// Simulation events. Emitted once each; renderer, audio, UI and commentary react to them.

export type HitKind =
  | 'spinner' // a spinner tooth bit
  | 'flip' // flipper launch
  | 'axe' // axe or hammer strike
  | 'lift' // lifter got under
  | 'ram' // chassis to chassis
  | 'wall' // robot into a wall
  | 'spikestrip'
  | 'killsaw'
  | 'pulverizer'
  | 'ramrod'
  | 'floor'; // landing after a flip

export interface HitEvent {
  type: 'hit';
  t: number;
  kind: HitKind;
  /** Robot that dealt it, or null for walls and hazards. */
  attacker: string | null;
  victim: string;
  point: Vec3;
  /** Unit direction the victim was pushed. */
  dir: Vec3;
  /** Energy delivered, joules. */
  energy: number;
  facet: Facet;
  /** Hit points removed (facet plus components). */
  damage: number;
  /** 0..1 how dramatic this was, for camera, crowd and commentary. 1 is a season highlight. */
  severity: number;
  /** Material of the struck facet (sparks color and sound). */
  material: ArmorMaterialId;
}

export type MatchEvent =
  | HitEvent
  | { type: 'grind'; t: number; point: Vec3; dir: Vec3; intensity: number; material: ArmorMaterialId }
  | { type: 'panel_off'; t: number; bot: string; facet: Facet; debris: number }
  | { type: 'wheel_off'; t: number; bot: string; index: number; debris: number }
  | { type: 'shrapnel'; t: number; bot: string; point: Vec3; dir: Vec3; count: number; material: ArmorMaterialId }
  | { type: 'component_down'; t: number; bot: string; component: Component }
  | { type: 'smoke_start'; t: number; bot: string }
  | { type: 'fire_start'; t: number; bot: string }
  | { type: 'flipped'; t: number; bot: string }
  | { type: 'righted'; t: number; bot: string; how: 'srimech' | 'weapon' | 'luck' }
  | { type: 'airborne'; t: number; bot: string; height: number }
  | { type: 'landed'; t: number; bot: string; speed: number }
  | { type: 'weapon_fire'; t: number; bot: string; kind: 'flipper' | 'axe' | 'lifter' | 'srimech' }
  | { type: 'weapon_arm'; t: number; bot: string; on: boolean }
  | { type: 'hazard'; t: number; hazard: string; kind: HazardKind; action: 'warn' | 'strike' | 'retract'; target: string | null }
  | { type: 'ko_count'; t: number; bot: string; n: number }
  | { type: 'ko_clear'; t: number; bot: string }
  | { type: 'ko'; t: number; bot: string }
  | { type: 'hold_warn'; t: number; bot: string; victim: string }
  | { type: 'release'; t: number; bot: string }
  | { type: 'lights'; t: number; lights: 1 | 2 | 3 | 4 }
  | { type: 'fight_start'; t: number }
  | { type: 'clock'; t: number; remaining: number }
  | { type: 'time_up'; t: number }
  | { type: 'match_over'; t: number; result: MatchResult };

export type MatchEventType = MatchEvent['type'];

// ---------------------------------------------------------------------------------------------
// Match setup and results

export type Corner = 'red' | 'blue' | 'green' | 'yellow';

export interface Entrant {
  id: string;
  corner: Corner;
  spec: BotSpec;
  /** Team and copy for the broadcast package. */
  card: BotCard;
  /** Damage carried in from earlier fights (fractions 0..1, 1 healthy). */
  carried?: { facets: Record<Facet, number>; parts: Record<Component, number> };
  control: 'player' | 'ai';
  /** 0..1 AI skill. */
  skill: number;
}

export interface BotCard {
  name: string;
  team: string;
  hometown: string;
  builders: string;
  /** One-liner for the lower third and scouting card. */
  blurb: string;
  record?: string;
  /** Voice id for this robot, if it has recorded lines (vic.bot.<voiceId> and vic.name.<voiceId>). */
  voiceId?: string;
}

export interface JudgeCard {
  judge: string;
  /** Points per entrant id, each category out of 5 split between two robots. */
  aggression: Record<string, number>;
  strategy: Record<string, number>;
  damage: Record<string, number>;
}

export interface MatchStats {
  damageDealt: number;
  damageTaken: number;
  hits: number;
  bigHits: number;
  attackTime: number; // seconds spent closing on or pushing the opponent
  controlTime: number; // seconds holding, pinning or carrying
  hazardDamageDealt: number; // damage the opponent took from hazards
  flips: number;
}

export interface MatchResult {
  winner: string | null;
  method: 'ko' | 'decision' | 'tapout' | 'last_standing';
  /** Fight time elapsed at the end, seconds. */
  time: number;
  judges?: JudgeCard[];
  /** Total points per entrant id, out of 45. */
  totals?: Record<string, number>;
  stats: Record<string, MatchStats>;
}

// ---------------------------------------------------------------------------------------------
// Player input, produced by src/input and consumed by the sim for player-controlled robots.

export interface DriveCommand {
  /** -1..1 forward. */
  throttle: number;
  /** -1..1, positive turns right. */
  turn: number;
  /** Weapon button held. */
  weapon: boolean;
  /** Weapon button pressed this frame. */
  weaponPressed: boolean;
  selfRight: boolean;
}

export type MenuNav = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'tabPrev' | 'tabNext';
