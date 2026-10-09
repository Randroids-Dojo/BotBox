// Loadout -> BotSpec. Pure and deterministic: used by the sim for colliders, by the renderer for
// meshes and by the garage for stats, so all three always agree.

import {
  COMPONENTS,
  FACETS,
  type ArmSpec,
  type BotSpec,
  type BotStats,
  type Component,
  type Facet,
  type InternalSpec,
  type Loadout,
  type PanelSpec,
  type Quat,
  type SpinnerSpec,
  type Vec3,
  type WeaponSpec,
  type WheelSpec,
} from '../contract';
import {
  ARMOR,
  ARMOR_BASE_HP,
  ARMOR_BASE_LB,
  ARMOR_GRADE,
  CHASSIS,
  CLASS_LIMIT_LB,
  DRIVES,
  ELECTRONICS_LB,
  EXTRAS,
  LB_TO_KG,
  POWER,
  WEAPONS,
  massScale,
  sizeScale,
} from '../data/parts';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Rotations that turn a panel's local +Z (outward normal) to face each facet. */
const S = Math.SQRT1_2;
const ROT: Record<Facet, Quat> = {
  front: { x: 0, y: 1, z: 0, w: 0 },
  rear: { x: 0, y: 0, z: 0, w: 1 },
  left: { x: 0, y: -S, z: 0, w: S },
  right: { x: 0, y: S, z: 0, w: S },
  top: { x: -S, y: 0, z: 0, w: S },
  belly: { x: S, y: 0, z: 0, w: S },
};

/** Rotation about local X by `a` (radians), composed after a facet rotation. */
function pitchedFront(a: number): Quat {
  // Front plate tilted back so its normal points forward and up: rotate 180 about Y, then about X.
  const half = a / 2;
  const qx = { x: Math.sin(half), y: 0, z: 0, w: Math.cos(half) };
  const qy = ROT.front;
  // q = qy * qx
  return {
    w: qy.w * qx.w - qy.x * qx.x - qy.y * qx.y - qy.z * qx.z,
    x: qy.w * qx.x + qy.x * qx.w + qy.y * qx.z - qy.z * qx.y,
    y: qy.w * qx.y - qy.x * qx.z + qy.y * qx.w + qy.z * qx.x,
    z: qy.w * qx.z + qy.x * qx.y - qy.y * qx.x + qy.z * qx.w,
  };
}

function boxPoints(c: Vec3, hx: number, hy: number, hz: number): Vec3[] {
  const pts: Vec3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push(v(c.x + sx * hx, c.y + sy * hy, c.z + sz * hz));
  return pts;
}

/** Share of armor HP per facet. */
const FACET_SHARE: Record<Facet, number> = { front: 0.22, rear: 0.14, left: 0.16, right: 0.16, top: 0.18, belly: 0.14 };

/** Heavyweight component HP. */
const COMPONENT_HP: Record<Component, number> = { driveL: 80, driveR: 80, weapon: 90, battery: 70, electronics: 60 };

export interface WeightLine {
  label: string;
  lb: number;
}

export function weightBreakdown(l: Loadout): WeightLine[] {
  const m = massScale(l.cls);
  const ch = CHASSIS[l.chassis];
  const mat = ARMOR[l.armor.material];
  const g = ARMOR_GRADE[l.armor.grade];
  const lines: WeightLine[] = [
    { label: ch.label, lb: ch.lb * m },
    { label: DRIVES[l.drive].label, lb: DRIVES[l.drive].lb * m },
    { label: POWER[l.power].label, lb: POWER[l.power].lb * m },
    { label: 'Radio and speed controllers', lb: ELECTRONICS_LB * m },
  ];
  if (l.weapon !== 'none') lines.push({ label: WEAPONS[l.weapon].label, lb: WEAPONS[l.weapon].lb * m });
  lines.push({ label: `${g.label} ${mat.label} armor`, lb: ARMOR_BASE_LB * ch.armorArea * mat.weight * g.weight * m });
  for (const e of l.extras) lines.push({ label: EXTRAS[e].label, lb: EXTRAS[e].lb * m });
  return lines;
}

export function loadoutWeight(l: Loadout): number {
  return weightBreakdown(l).reduce((s, x) => s + x.lb, 0);
}

export interface LoadoutCheck {
  ok: boolean;
  weightLb: number;
  limitLb: number;
  problems: string[];
}

export function checkLoadout(l: Loadout): LoadoutCheck {
  const problems: string[] = [];
  const weightLb = loadoutWeight(l);
  const limitLb = CLASS_LIMIT_LB[l.cls];
  if (weightLb > limitLb + 1e-6) problems.push(`Overweight by ${(weightLb - limitLb).toFixed(1)} lb`);
  if (WEAPONS[l.weapon].notOn.includes(l.chassis)) {
    problems.push(`${WEAPONS[l.weapon].label} does not fit a ${CHASSIS[l.chassis].label.toLowerCase()}`);
  }
  for (const e of l.extras) {
    const x = EXTRAS[e];
    if (x.notOn.includes(l.chassis)) problems.push(`${x.label} does not fit a ${CHASSIS[l.chassis].label.toLowerCase()}`);
    if (x.notWithWeapon.includes(l.weapon)) problems.push(`${x.label} is in the way of the ${WEAPONS[l.weapon].label.toLowerCase()}`);
  }
  if (new Set(l.extras).size !== l.extras.length) problems.push('Duplicate extras');
  if (!l.name.trim()) problems.push('Your robot needs a name');
  return { ok: problems.length === 0, weightLb, limitLb, problems };
}

/** True if the extra can be fitted alongside the current chassis and weapon. */
export function extraAllowed(l: Loadout, e: Loadout['extras'][number]): boolean {
  const x = EXTRAS[e];
  return !x.notOn.includes(l.chassis) && !x.notWithWeapon.includes(l.weapon);
}

export function buildSpec(l: Loadout): BotSpec {
  const s = sizeScale(l.cls);
  const m = massScale(l.cls);
  const ch = CHASSIS[l.chassis];
  const dr = DRIVES[l.drive];
  const pw = POWER[l.power];
  const wp = WEAPONS[l.weapon];
  const mat = ARMOR[l.armor.material];
  const grade = ARMOR_GRADE[l.armor.grade];
  const has = (e: Loadout['extras'][number]) => l.extras.includes(e);
  // Smaller rotors spin faster so stored energy tracks robot mass across classes.
  const rpm = (base: number) => Math.round(base / s / 10) * 10;

  const r = dr.wheelRadius * s;
  const ww = dr.wheelWidth * s;
  const L = ch.length * s;
  const W = ch.width * s;
  let H = ch.height * s;
  let g = 0.02 * s;
  if (l.chassis === 'invertible') {
    H = Math.min(H, 2 * r - 0.03 * s);
    g = r - H / 2;
  }
  if (l.chassis === 'shell') g = 0.035 * s;
  const lipY = -g + 0.008 * s; // a wedge lip scrapes 8 mm above the floor (scaled)
  const t = Math.max(0.004, (grade.mm / 1000) * 1.6 * s); // visual and debris thickness

  // ---- wheels
  const wheelZ: number[] =
    dr.wheels === 2 ? [0.15 * L] : dr.wheels === 4 ? [-0.3 * L, 0.3 * L] : [-0.36 * L, 0, 0.36 * L];
  const wheels: WheelSpec[] = [];
  let wheelX: number;
  if (l.chassis === 'invertible') wheelX = W / 2 - ww / 2 - 0.03 * s;
  else if (l.chassis === 'shell') wheelX = 0.26 * s;
  else wheelX = W / 2 + ww / 2 + 0.012 * s;
  const wheelY = r - g;
  const zs = l.chassis === 'shell' ? wheelZ.map((z) => z * 0.62) : wheelZ;
  for (const side of [-1, 1] as const) for (const z of zs) wheels.push({ pos: v(side * wheelX, wheelY, z), radius: r, width: ww, side });

  // ---- weapon
  let weapon: WeaponSpec = { kind: 'none' };
  // Flippers and lifters ride on a sloped front; the hull follows the plate.
  let slopeTopZ: number | null = l.chassis === 'wedge' ? L / 2 - 0.26 * s : null;
  if (l.weapon === 'vdisk') {
    const R = 0.25 * s;
    const mass = 14 * m;
    const sp: SpinnerSpec = {
      kind: 'vdisk',
      center: v(0, R + 0.04 * s - g + 0.012 * s, -L / 2 - 0.05 * s),
      axis: 'x',
      radius: R,
      width: 0.035 * s,
      chord: 0,
      teeth: 2,
      toothHeight: 0.04 * s,
      massKg: mass,
      inertia: 0.5 * mass * R * R,
      maxRpm: rpm(2800),
      spinupSec: 3.0,
      direction: 1,
    };
    weapon = sp;
  } else if (l.weapon === 'drum') {
    const R = 0.11 * s;
    const mass = 18 * m;
    weapon = {
      kind: 'drum',
      center: v(0, R + 0.03 * s - g + 0.012 * s, -L / 2 - 0.08 * s),
      axis: 'x',
      radius: R,
      width: Math.min(0.4 * s, W * 0.68),
      chord: 0,
      teeth: 2,
      toothHeight: 0.03 * s,
      massKg: mass,
      inertia: 0.5 * mass * R * R,
      maxRpm: rpm(4800),
      spinupSec: 1.8,
      direction: 1,
    } satisfies SpinnerSpec;
  } else if (l.weapon === 'hbar') {
    const R = 0.46 * s;
    const mass = 17 * m;
    weapon = {
      kind: 'hbar',
      center: v(0, H + 0.04 * s, -L / 2 + 0.12 * s),
      axis: 'y',
      radius: R,
      width: 0.05 * s,
      chord: 0.09 * s,
      teeth: 2,
      toothHeight: 0.03 * s,
      massKg: mass,
      inertia: (mass * (2 * R) * (2 * R)) / 12,
      maxRpm: rpm(1700),
      spinupSec: 4.0,
      direction: 1,
    } satisfies SpinnerSpec;
  } else if (l.weapon === 'shell') {
    const R = (ch.width / 2) * s;
    const mass = 30 * m;
    weapon = {
      kind: 'shell',
      center: v(0, 0.14 * s, 0),
      axis: 'y',
      radius: R,
      width: 0.22 * s,
      chord: 0,
      teeth: 2,
      toothHeight: 0.025 * s,
      massKg: mass,
      inertia: 0.8 * mass * R * R,
      maxRpm: rpm(800),
      spinupSec: 5.5,
      direction: 1,
    } satisfies SpinnerSpec;
  } else if (l.weapon === 'flipper') {
    const hinge = v(0, H * 0.85, -L / 2 + 0.42 * s);
    const drop = hinge.y - lipY;
    const run = hinge.z + L / 2;
    const length = Math.hypot(drop, run);
    weapon = {
      kind: 'flipper',
      hinge,
      length,
      width: W * 0.92,
      restAngle: -Math.atan2(drop, run),
      maxAngle: 1.2,
      deploySec: 0.12,
      rechargeSec: 1.4,
      shots: 14,
      power: 560 * m,
    } satisfies ArmSpec;
    slopeTopZ = hinge.z;
  } else if (l.weapon === 'axe') {
    const hinge = v(0, H + 0.02 * s, L / 2 - 0.25 * s);
    weapon = {
      kind: 'axe',
      hinge,
      length: 0.95 * s,
      width: 0.07 * s,
      restAngle: Math.PI - 0.2,
      maxAngle: -0.15,
      head: v(0.05 * s, 0.16 * s, 0.07 * s),
      deploySec: 0.22,
      rechargeSec: 1.8,
      shots: 18,
      power: 380 * m,
    } satisfies ArmSpec;
  } else if (l.weapon === 'lifter') {
    const hinge = v(0, 0.12 * s, -L / 2 + 0.12 * s);
    const length = 0.42 * s;
    const drop = hinge.y - lipY;
    weapon = {
      kind: 'lifter',
      hinge,
      length,
      width: W * 0.8,
      restAngle: -Math.asin(Math.min(0.95, drop / length)),
      maxAngle: 0.75,
      deploySec: 0.9,
      rechargeSec: 0,
      shots: Number.POSITIVE_INFINITY,
      power: 2600 * m,
    } satisfies ArmSpec;
  }

  // ---- hull
  const hull: Vec3[][] = [];
  const panels: PanelSpec[] = [];
  let frontEdgeHeight = g;
  if (l.chassis === 'shell') {
    // Inner stationary base: a 12-sided prism. The rotor is the weapon.
    const rb = 0.36 * s;
    const pts: Vec3[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      pts.push(v(Math.cos(a) * rb, 0, Math.sin(a) * rb), v(Math.cos(a) * rb * 0.8, H, Math.sin(a) * rb * 0.8));
    }
    hull.push(pts);
    // The shell spins, so only the top cap and belly are separate armor.
    panels.push({ facet: 'top', center: v(0, H - t / 2, 0), rot: ROT.top, w: rb * 1.4, h: rb * 1.4, t });
    panels.push({ facet: 'belly', center: v(0, t / 2, 0), rot: ROT.belly, w: rb * 1.6, h: rb * 1.6, t });
    // Front, rear, left and right are inner bulkheads behind the shell.
    const bh = H * 0.7;
    panels.push({ facet: 'front', center: v(0, bh / 2, -rb * 0.75), rot: ROT.front, w: rb, h: bh, t });
    panels.push({ facet: 'rear', center: v(0, bh / 2, rb * 0.75), rot: ROT.rear, w: rb, h: bh, t });
    panels.push({ facet: 'left', center: v(-rb * 0.75, bh / 2, 0), rot: ROT.left, w: rb, h: bh, t });
    panels.push({ facet: 'right', center: v(rb * 0.75, bh / 2, 0), rot: ROT.right, w: rb, h: bh, t });
    frontEdgeHeight = g + 0.02 * s;
  } else if (slopeTopZ !== null) {
    // Sloped front from a floor-scraping lip up to the flat rear deck.
    const hx = W / 2;
    hull.push([
      v(-hx, lipY, -L / 2),
      v(hx, lipY, -L / 2),
      v(-hx, 0, L / 2),
      v(hx, 0, L / 2),
      v(-hx, H, L / 2),
      v(hx, H, L / 2),
      v(-hx, H, slopeTopZ),
      v(hx, H, slopeTopZ),
      v(-hx, 0, -L / 2 + 0.02 * s),
      v(hx, 0, -L / 2 + 0.02 * s),
    ]);
    const run = slopeTopZ + L / 2;
    const rise = H - lipY;
    const slope = Math.atan2(rise, run);
    const len = Math.hypot(run, rise);
    // Outward normal tilts forward and up. Pitch the front-facing plate back by (90 - slope).
    panels.push({
      facet: 'front',
      center: v(0, (lipY + H) / 2, (-L / 2 + slopeTopZ) / 2),
      rot: pitchedFront(-(Math.PI / 2 - slope)),
      w: W,
      h: len,
      t,
    });
    panels.push({ facet: 'top', center: v(0, H - t / 2, (slopeTopZ + L / 2) / 2), rot: ROT.top, w: W, h: L / 2 - slopeTopZ, t });
    panels.push({ facet: 'rear', center: v(0, H / 2, L / 2 - t / 2), rot: ROT.rear, w: W, h: H, t });
    panels.push({ facet: 'left', center: v(-W / 2 + t / 2, H / 2, 0), rot: ROT.left, w: L, h: H, t });
    panels.push({ facet: 'right', center: v(W / 2 - t / 2, H / 2, 0), rot: ROT.right, w: L, h: H, t });
    panels.push({ facet: 'belly', center: v(0, t / 2, 0), rot: ROT.belly, w: W, h: L, t });
    frontEdgeHeight = lipY + g;
  } else {
    hull.push(boxPoints(v(0, H / 2, 0), W / 2, H / 2, L / 2));
    panels.push({ facet: 'front', center: v(0, H / 2, -L / 2 + t / 2), rot: ROT.front, w: W, h: H, t });
    panels.push({ facet: 'rear', center: v(0, H / 2, L / 2 - t / 2), rot: ROT.rear, w: W, h: H, t });
    panels.push({ facet: 'left', center: v(-W / 2 + t / 2, H / 2, 0), rot: ROT.left, w: L, h: H, t });
    panels.push({ facet: 'right', center: v(W / 2 - t / 2, H / 2, 0), rot: ROT.right, w: L, h: H, t });
    panels.push({ facet: 'top', center: v(0, H - t / 2, 0), rot: ROT.top, w: W, h: L, t });
    panels.push({ facet: 'belly', center: v(0, t / 2, 0), rot: ROT.belly, w: W, h: L, t });
    frontEdgeHeight = g;
  }

  // ---- extras that add geometry
  const outerX = l.chassis === 'invertible' || l.chassis === 'shell' ? W / 2 : wheelX + ww / 2;
  if (has('wedgeplate')) {
    const reach = 0.16 * s;
    const top = Math.min(H * 0.6, 0.15 * s);
    const hx = outerX;
    hull.push([
      v(-hx, lipY + 0.003 * s, -L / 2 - reach),
      v(hx, lipY + 0.003 * s, -L / 2 - reach),
      v(-hx, top, -L / 2),
      v(hx, top, -L / 2),
      v(-hx, lipY + 0.003 * s, -L / 2),
      v(hx, lipY + 0.003 * s, -L / 2),
    ]);
    const run = reach;
    const rise = top - lipY;
    const slope = Math.atan2(rise, run);
    panels.push({
      facet: 'front',
      center: v(0, (lipY + top) / 2, -L / 2 - reach / 2),
      rot: pitchedFront(-(Math.PI / 2 - slope)),
      w: hx * 2,
      h: Math.hypot(run, rise),
      t,
    });
    frontEdgeHeight = Math.min(frontEdgeHeight, lipY + 0.003 * s + g);
  }
  if (has('wheelguards')) {
    const zMin = Math.min(...zs) - r - 0.02 * s;
    const zMax = Math.max(...zs) + r + 0.02 * s;
    for (const side of [-1, 1] as const) {
      const x = side * (wheelX + ww / 2 + 0.02 * s);
      const c = v(x, wheelY, (zMin + zMax) / 2);
      hull.push(boxPoints(c, 0.006 * s, r * 0.9, (zMax - zMin) / 2));
      panels.push({ facet: side < 0 ? 'left' : 'right', center: c, rot: side < 0 ? ROT.left : ROT.right, w: zMax - zMin, h: r * 1.8, t });
    }
  }
  if (has('skirts')) {
    const skH = g + 0.06 * s;
    const yC = -g + 0.006 * s + skH / 2;
    const sx = outerX + 0.015 * s;
    for (const side of [-1, 1] as const) {
      const c = v(side * sx, yC, 0);
      hull.push(boxPoints(c, 0.004 * s, skH / 2, L / 2));
      panels.push({ facet: side < 0 ? 'left' : 'right', center: c, rot: side < 0 ? ROT.left : ROT.right, w: L, h: skH, t: 0.006 * s });
    }
    const c = v(0, yC, L / 2 + 0.015 * s);
    hull.push(boxPoints(c, sx, skH / 2, 0.004 * s));
    panels.push({ facet: 'rear', center: c, rot: ROT.rear, w: sx * 2, h: skH, t: 0.006 * s });
  }

  // ---- internals
  const zDrive = zs.reduce((a, b) => a + b, 0) / zs.length;
  const internals: InternalSpec[] = [
    { component: 'battery', center: v(0, H * 0.35, L * 0.18), size: v(W * 0.5, H * 0.45, L * 0.2) },
    { component: 'electronics', center: v(0, H * 0.45, -L * 0.06), size: v(W * 0.3, H * 0.25, L * 0.12) },
    { component: 'driveL', center: v(-Math.min(wheelX, W / 2) + 0.09 * s, Math.max(0.05 * s, wheelY), zDrive), size: v(0.1 * s, 0.1 * s, 0.18 * s) },
    { component: 'driveR', center: v(Math.min(wheelX, W / 2) - 0.09 * s, Math.max(0.05 * s, wheelY), zDrive), size: v(0.1 * s, 0.1 * s, 0.18 * s) },
    { component: 'weapon', center: v(0, H * 0.4, l.weapon === 'axe' ? L * 0.3 : -L * 0.3), size: v(0.12 * s, Math.min(0.12 * s, H * 0.6), 0.16 * s) },
  ];

  // ---- health
  const area = ch.armorArea;
  const facetHp = {} as Record<Facet, number>;
  for (const f of FACETS) facetHp[f] = ARMOR_BASE_HP * area * mat.hp * grade.hp * FACET_SHARE[f] * m;
  if (l.chassis === 'shell') {
    // The shell absorbs side hits itself; bulkheads are lighter but the rotor soaks damage first.
    for (const f of ['front', 'rear', 'left', 'right'] as Facet[]) facetHp[f] *= 1.6;
  }
  if (has('wheelguards')) {
    facetHp.left *= 1.25;
    facetHp.right *= 1.25;
  }
  if (has('skirts')) {
    facetHp.left *= 1.1;
    facetHp.right *= 1.1;
    facetHp.rear *= 1.1;
  }
  if (has('wedgeplate')) facetHp.front *= 1.2;
  const componentHp = {} as Record<Component, number>;
  for (const c of COMPONENTS) componentHp[c] = COMPONENT_HP[c] * m;
  componentHp.battery *= pw.toughness;

  // ---- totals and stats
  const check = checkLoadout(l);
  const massKg = check.weightLb * LB_TO_KG;
  // Invertible only if the weapon stays inside the wheels' reach on both sides.
  let weaponTop = 0;
  if (weapon.kind === 'vdisk' || weapon.kind === 'drum') weaponTop = weapon.center.y + weapon.radius + weapon.toothHeight;
  else if (weapon.kind === 'hbar' || weapon.kind === 'shell') weaponTop = weapon.center.y + weapon.width / 2;
  else if (weapon.kind === 'axe' || weapon.kind === 'flipper' || weapon.kind === 'lifter') weaponTop = weapon.hinge.y;
  const invertible = ch.invertible && weaponTop <= wheelY + r + 0.004 * s;
  const selfRight = has('srimech') || wp.selfRight > 0;
  const trackWidth = 2 * Math.max(wheelX, 0.15 * s);
  const topSpeed = dr.topSpeed * (0.85 + 0.15 * s);
  let weaponEnergyKJ = 0;
  let weaponLabel = 'None';
  if (weapon.kind === 'vdisk' || weapon.kind === 'drum' || weapon.kind === 'hbar' || weapon.kind === 'shell') {
    const w = (weapon.maxRpm * Math.PI * 2) / 60;
    weaponEnergyKJ = (0.5 * weapon.inertia * w * w) / 1000;
    weaponLabel = `${weaponEnergyKJ.toFixed(1)} kJ at ${weapon.maxRpm} rpm`;
  } else if (weapon.kind === 'flipper' || weapon.kind === 'axe') {
    // Energy equivalent of the impulse into a robot of equal mass.
    weaponEnergyKJ = (weapon.power * weapon.power) / (2 * massKg) / 1000;
    weaponLabel = `${Math.round(weapon.power)} N s, ${weapon.shots} shots`;
  } else if (weapon.kind === 'lifter') {
    weaponEnergyKJ = 0;
    weaponLabel = `${Math.round(weapon.power)} N lift`;
  }
  const watts = (dr.watts + wp.watts * 0.4) * m;
  const stats: BotStats = {
    weightLb: check.weightLb,
    limitLb: check.limitLb,
    topSpeed,
    pushN: dr.force * m,
    turnRate: (2 * topSpeed) / trackWidth / dr.scrub,
    weaponEnergyKJ,
    weaponLabel,
    armorHp: FACETS.reduce((a, f) => a + facetHp[f], 0),
    runtimeSec: (pw.capacityKJ * 1000 * m) / watts,
    selfRight,
    invertible,
  };

  let height = H;
  if (weapon.kind === 'vdisk') height = Math.max(H, weapon.center.y + weapon.radius);
  if (weapon.kind === 'hbar') height = Math.max(H, weapon.center.y + weapon.width / 2);
  if (invertible) height = Math.max(H, wheelY + r);
  let length = L;
  if (weapon.kind === 'vdisk' || weapon.kind === 'drum') length = L / 2 - (weapon.center.z - weapon.radius - weapon.toothHeight) ;
  const width = l.chassis === 'shell' ? W : Math.max(W, 2 * (wheelX + ww / 2));

  return {
    loadout: l,
    scale: s,
    massKg,
    hull,
    length,
    width,
    height,
    groundClearance: g,
    frontEdgeHeight,
    panels,
    wheels,
    internals,
    weapon,
    invertible,
    selfRight,
    facetHp,
    componentHp,
    stats,
  };
}
