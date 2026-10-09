// Structure and guts. The frame (welded box tube along the hull edges, a dark inner liner, wheel
// wells, skids, antenna, master switch) is always shown. Internals (battery packs, speed
// controllers, receiver, drive motors and gearboxes, weapon motor or valves, wiring) are shown
// only when an armor panel is missing or the armor is see-through.
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import type { BotSpec, InternalSpec } from '../../contract';
import type { Quality } from '../types';
import { type HardwareKey, hardware } from './materials';
import { GeoBucket, bevelBox, v3 } from './util';

interface Ctx {
  spec: BotSpec;
  env: THREE.Texture | null;
  q: Quality;
}

const hw = (c: Ctx, k: HardwareKey) => hardware(k, c.env, c.q);

function topH(spec: BotSpec): number {
  const top = spec.panels.find((p) => p.facet === 'top');
  return top ? top.center.y + top.t / 2 : spec.height;
}

function hullBox(spec: BotSpec): THREE.Box3 {
  const b = new THREE.Box3();
  for (const p of spec.hull[0]) b.expandByPoint(v3(p));
  return b;
}

export function buildFrame(c: Ctx): THREE.Group {
  const { spec } = c;
  const s = spec.scale;
  const group = new THREE.Group();
  group.name = 'frame';
  const b = new GeoBucket();
  const t = spec.panels[0]?.t ?? 0.006;
  const chassis = spec.loadout.chassis;
  const pts = spec.hull[0].map(v3);
  const H = topH(spec);

  if (chassis === 'shell') {
    // The round base is visible under the shell: a dark welded drum.
    const g = new ConvexGeometry(pts);
    b.add(g, hw(c, 'frame'));
  } else {
    // Inner liner so slots and pockets look into a dark box, not the void.
    const box = hullBox(spec);
    const center = box.getCenter(new THREE.Vector3());
    const liner = new ConvexGeometry(pts.map((p) => p.clone().sub(center).multiplyScalar(0.985).add(center)));
    // Flip it inside out so its faces look inward.
    flipWinding(liner);
    b.add(liner, hw(c, 'interior'));
    // Box-tube frame along the hull edges, inset under the armor.
    const tube = Math.max(0.018, 0.025 * s);
    const d = t + tube / 2 + 0.003;
    const inset = (p: THREE.Vector3) => {
      const o = p.clone();
      for (const k of ['x', 'y', 'z'] as const) {
        const rel = p[k] - center[k];
        if (Math.abs(rel) > d) o[k] = p[k] - Math.sign(rel) * d;
      }
      return o;
    };
    const edges = new THREE.EdgesGeometry(new ConvexGeometry(pts), 20);
    const ea = edges.attributes.position as THREE.BufferAttribute;
    const joints: THREE.Vector3[] = [];
    for (let i = 0; i < ea.count; i += 2) {
      const a = inset(new THREE.Vector3().fromBufferAttribute(ea, i));
      const e = inset(new THREE.Vector3().fromBufferAttribute(ea, i + 1));
      if (a.distanceTo(e) < 0.02) continue;
      const m = boxAlong(a, e, tube, tube);
      b.add(new THREE.BoxGeometry(1, 1, 1), hw(c, 'frame'), m);
      for (const p of [a, e]) if (!joints.some((j) => j.distanceTo(p) < 0.01)) joints.push(p);
    }
    edges.dispose();
    // Weld beads at the joints.
    if (c.q !== 'low')
      for (const j of joints) {
        const g = new THREE.IcosahedronGeometry(tube * 0.62, 1);
        b.place(g, hw(c, 'weld'), j, new THREE.Euler(), { x: 1, y: 0.85, z: 1 });
      }
    // Cross members under the deck.
    const yTop = H - d;
    for (const z of [-spec.length * 0.12, spec.length * 0.22]) {
      if (z < box.min.z + 0.05 || z > box.max.z - 0.05) continue;
      const a = new THREE.Vector3(box.min.x + d, yTop, z);
      const e = new THREE.Vector3(box.max.x - d, yTop, z);
      b.add(new THREE.BoxGeometry(1, 1, 1), hw(c, 'frame'), boxAlong(a, e, tube, tube));
    }
  }

  // Wheel wells for invertibles: wheels pass through the deck and the belly.
  if (chassis === 'invertible') {
    for (const w of spec.wheels) {
      const zr = w.radius + 0.015 * s;
      for (const sx of [-1, 1]) {
        const x = w.pos.x + sx * (w.width / 2 + 0.008 * s);
        b.add(new THREE.BoxGeometry(0.004 * s, H - 0.004, zr * 2), hw(c, 'frame'), new THREE.Matrix4().makeTranslation(x, H / 2, w.pos.z));
      }
      for (const sz of [-1, 1]) {
        b.add(new THREE.BoxGeometry(w.width + 0.016 * s, H - 0.004, 0.004 * s), hw(c, 'frame'), new THREE.Matrix4().makeTranslation(w.pos.x, H / 2, w.pos.z + sz * zr));
      }
      // Axle stub and bearing.
      const ax = new THREE.CylinderGeometry(0.012 * s, 0.012 * s, w.width + 0.03 * s, 10).rotateZ(Math.PI / 2);
      b.add(ax, hw(c, 'steel'), new THREE.Matrix4().makeTranslation(w.pos.x, w.pos.y, w.pos.z));
    }
  } else if (chassis !== 'shell') {
    // Axle stubs and bearing blocks between the hull and each wheel.
    for (const w of spec.wheels) {
      const inner = w.pos.x - w.side * (w.width / 2);
      const hullX = w.side * (spec.width / 2 - w.width - 0.012 * s) ;
      const len = Math.abs(inner - hullX) + 0.01;
      const ax = new THREE.CylinderGeometry(0.014 * s, 0.014 * s, len, 10).rotateZ(Math.PI / 2);
      b.add(ax, hw(c, 'steel'), new THREE.Matrix4().makeTranslation((inner + hullX) / 2, w.pos.y, w.pos.z));
    }
  }

  // 2WD robots ride on a skid at the front.
  if (spec.wheels.length === 2 && chassis !== 'shell') {
    const g = spec.groundClearance;
    const sk = bevelBox(0.12 * s, g + 0.006, 0.07 * s, 0.003);
    b.add(sk, hw(c, 'uhmwBlack'), new THREE.Matrix4().makeTranslation(0, -g / 2 + 0.003, -spec.length * 0.36));
    if (spec.invertible) {
      const wheelTop = spec.wheels[0].pos.y + spec.wheels[0].radius;
      const h = Math.max(0.006, wheelTop - H);
      const sk2 = bevelBox(0.12 * s, h + 0.004, 0.07 * s, 0.002);
      b.add(sk2, hw(c, 'uhmwBlack'), new THREE.Matrix4().makeTranslation(0, H + h / 2 - 0.002, -spec.length * 0.36));
    }
  }

  // Antenna whip and master switch on the deck (not on invertibles or shells).
  if (chassis !== 'invertible' && chassis !== 'shell') {
    const axe = spec.weapon.kind === 'axe';
    const L = spec.length;
    const W = spec.panels.find((p) => p.facet === 'top')?.w ?? spec.width;
    const ax = -W / 2 + 0.05 * s;
    const az = axe ? -L * 0.12 : L / 2 - 0.06 * s;
    const base = new THREE.CylinderGeometry(0.012 * s, 0.016 * s, 0.025 * s, 10);
    b.add(base, hw(c, 'black'), new THREE.Matrix4().makeTranslation(ax, H + 0.012 * s, az));
    const whip = new THREE.CylinderGeometry(0.0035 * s, 0.005 * s, 0.17 * s, 6);
    b.add(whip, hw(c, 'orange'), new THREE.Matrix4().makeTranslation(ax, H + 0.025 * s + 0.085 * s, az));
    const tip = new THREE.SphereGeometry(0.008 * s, 8, 6);
    b.add(tip, hw(c, 'black'), new THREE.Matrix4().makeTranslation(ax, H + 0.025 * s + 0.17 * s, az));
    // Master switch: a red removable link on a black base.
    const sx = W / 2 - 0.07 * s;
    const sz = axe ? -L * 0.28 : L / 2 - 0.07 * s;
    const plate = bevelBox(0.05 * s, 0.008 * s, 0.05 * s, 0.002);
    b.add(plate, hw(c, 'black'), new THREE.Matrix4().makeTranslation(sx, H + 0.004 * s, sz));
    const key = bevelBox(0.016 * s, 0.03 * s, 0.04 * s, 0.003);
    b.add(key, hw(c, 'red'), new THREE.Matrix4().makeTranslation(sx, H + 0.022 * s, sz));
  }

  // Wedge plate hinge barrel and skirt hinges.
  const extras = spec.loadout.extras;
  spec.panels.forEach((p, i) => {
    if (i < 6) return;
    const isWedgePlate = p.facet === 'front' && extras.includes('wedgeplate');
    const isSkirt = p.h < 0.12 * s && (p.facet === 'left' || p.facet === 'right' || p.facet === 'rear') && extras.includes('skirts');
    if (!isWedgePlate && !isSkirt) return;
    const m = new THREE.Matrix4().compose(v3(p.center), new THREE.Quaternion(p.rot.x, p.rot.y, p.rot.z, p.rot.w), new THREE.Vector3(1, 1, 1));
    // Hinge along the panel's top edge (local +y), running along local x.
    const hinge = new THREE.CylinderGeometry(0.01 * s, 0.01 * s, p.w * 0.96, 10).rotateZ(Math.PI / 2);
    hinge.translate(0, p.h / 2, -p.t);
    b.add(hinge, hw(c, 'steel'), m);
  });

  b.build(group);
  return group;
}

function flipWinding(g: THREE.BufferGeometry): void {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nrm = g.attributes.normal as THREE.BufferAttribute | undefined;
  if (g.index) {
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      for (let k = 0; k < pos.itemSize; k++) {
        const t = pos.array[(i + 1) * 3 + k];
        pos.array[(i + 1) * 3 + k] = pos.array[(i + 2) * 3 + k];
        pos.array[(i + 2) * 3 + k] = t;
      }
    }
  }
  if (nrm) for (let i = 0; i < nrm.array.length; i++) nrm.array[i] = -nrm.array[i];
}

function boxAlong(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number): THREE.Matrix4 {
  const len = a.distanceTo(b);
  const dir = b.clone().sub(a).normalize();
  const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const m = new THREE.Matrix4().lookAt(a, b, up);
  const q = new THREE.Quaternion().setFromRotationMatrix(m);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  return new THREE.Matrix4().compose(mid, q, new THREE.Vector3(w, h, len + w));
}

function find(spec: BotSpec, comp: InternalSpec['component']): InternalSpec {
  return spec.internals.find((i) => i.component === comp)!;
}

export function buildInternals(c: Ctx): THREE.Group {
  const { spec } = c;
  const s = spec.scale;
  const group = new THREE.Group();
  group.name = 'internals';
  const b = new GeoBucket();
  const lowQ = c.q === 'low';

  // ---- battery
  const bat = find(spec, 'battery');
  const bc = v3(bat.center);
  const power = spec.loadout.power;
  const bx = bat.size.x;
  const by = bat.size.y;
  const bz = bat.size.z;
  if (power === 'sla') {
    const n = 2;
    const bw = bx / n - 0.008;
    for (let i = 0; i < n; i++) {
      const x = bc.x - bx / 2 + bw / 2 + i * (bw + 0.008) + 0.004;
      const brick = bevelBox(bw, by * 0.9, bz * 0.95, 0.004);
      b.add(brick, hw(c, 'sla'), new THREE.Matrix4().makeTranslation(x, bc.y - by * 0.05, bc.z));
      const label = new THREE.BoxGeometry(bw * 0.7, by * 0.35, 0.001);
      b.add(label, hw(c, 'label'), new THREE.Matrix4().makeTranslation(x, bc.y, bc.z - bz * 0.476));
      for (const [k, mat] of [
        [-1, 'red'],
        [1, 'wireBlack'],
      ] as const) {
        const term = new THREE.BoxGeometry(0.012 * s, 0.012 * s, 0.012 * s);
        b.add(term, hw(c, mat), new THREE.Matrix4().makeTranslation(x + k * bw * 0.3, bc.y + by * 0.4 + 0.006 * s, bc.z + bz * 0.3));
      }
    }
  } else {
    const wrap: HardwareKey = power === 'nicad' ? 'wrapNicad' : 'wrapNimh';
    const d = Math.max(0.016, 0.023 * Math.min(1, s * 1.05));
    const nx = Math.max(2, Math.floor(bx / d));
    const nz = Math.max(2, Math.floor(bz / d));
    const layers = by > d * 4 ? 2 : 1;
    const hc = Math.min(by / layers - 0.003, 0.046);
    if (lowQ) {
      const pack = bevelBox(nx * d, hc * layers, nz * d, 0.006);
      b.add(pack, hw(c, wrap), new THREE.Matrix4().makeTranslation(bc.x, bc.y - by / 2 + (hc * layers) / 2, bc.z));
    } else {
      const cell = new THREE.CylinderGeometry(d * 0.47, d * 0.47, hc, 8, 1);
      const packW = 5;
      for (let l = 0; l < layers; l++)
        for (let i = 0; i < nx; i++)
          for (let k = 0; k < nz; k++) {
            const gapX = Math.floor(i / packW) * 0.004;
            const x = bc.x - (nx * d) / 2 + d / 2 + i * d + gapX - (Math.floor((nx - 1) / packW) * 0.004) / 2;
            const z = bc.z - (nz * d) / 2 + d / 2 + k * d;
            const y = bc.y - by / 2 + hc / 2 + l * (hc + 0.002);
            b.add(cell, hw(c, wrap), new THREE.Matrix4().makeTranslation(x, y, z));
          }
    }
    // Pack labels and a velcro strap over the top.
    const topY = bc.y - by / 2 + layers * (hc + 0.002);
    for (let p = 0; p < Math.ceil(nx / 5); p++) {
      const w = Math.min(5, nx - p * 5) * d;
      const x = bc.x - (nx * d) / 2 + p * (5 * d + 0.004) + w / 2;
      b.add(new THREE.BoxGeometry(w * 0.8, 0.0015, nz * d * 0.4), hw(c, 'label'), new THREE.Matrix4().makeTranslation(x, topY, bc.z));
    }
    b.add(new THREE.BoxGeometry(nx * d + 0.02, 0.004, 0.025 * s), hw(c, 'black'), new THREE.Matrix4().makeTranslation(bc.x, topY + 0.002, bc.z + nz * d * 0.3));
  }

  // ---- electronics: two speed controllers with heat sinks, a receiver, a relay
  const el = find(spec, 'electronics');
  const ec = v3(el.center);
  const ex = el.size.x;
  const ey = el.size.y;
  const ez = el.size.z;
  for (const k of [-1, 1]) {
    const w = ex * 0.45;
    const x = ec.x + k * ex * 0.25;
    const esc = bevelBox(w, ey * 0.55, ez * 0.9, 0.003);
    b.add(esc, hw(c, 'black'), new THREE.Matrix4().makeTranslation(x, ec.y - ey * 0.2, ec.z));
    const fins = lowQ ? 3 : 7;
    for (let f = 0; f < fins; f++) {
      const fx = x - w * 0.4 + (f / (fins - 1)) * w * 0.8;
      b.add(new THREE.BoxGeometry(0.0025, ey * 0.35, ez * 0.85), hw(c, 'heatsink'), new THREE.Matrix4().makeTranslation(fx, ec.y + ey * 0.25, ec.z));
    }
    b.add(new THREE.BoxGeometry(w, 0.004, ez * 0.88), hw(c, 'heatsink'), new THREE.Matrix4().makeTranslation(x, ec.y + ey * 0.08, ec.z));
  }
  const rx = bevelBox(0.05 * s, 0.022 * s, 0.035 * s, 0.003);
  b.add(rx, hw(c, 'blackPlastic'), new THREE.Matrix4().makeTranslation(ec.x - ex * 0.5 - 0.03 * s, ec.y - ey * 0.3, ec.z + ez * 0.2));
  const pcb = new THREE.BoxGeometry(0.04 * s, 0.002, 0.03 * s);
  b.add(pcb, hw(c, 'pcb'), new THREE.Matrix4().makeTranslation(ec.x - ex * 0.5 - 0.03 * s, ec.y - ey * 0.3 + 0.012 * s, ec.z + ez * 0.2));
  // Relay (contactor) with copper studs.
  const relay = new THREE.CylinderGeometry(0.022 * s, 0.022 * s, 0.05 * s, 14);
  b.add(relay, hw(c, 'blackPlastic'), new THREE.Matrix4().makeTranslation(ec.x + ex * 0.5 + 0.03 * s, ec.y - ey * 0.15, ec.z - ez * 0.1));
  for (const k of [-1, 1]) {
    const stud = new THREE.CylinderGeometry(0.005 * s, 0.005 * s, 0.014 * s, 6);
    b.add(stud, hw(c, 'copper'), new THREE.Matrix4().makeTranslation(ec.x + ex * 0.5 + 0.03 * s + k * 0.01 * s, ec.y - ey * 0.15 + 0.03 * s, ec.z - ez * 0.1));
  }

  // ---- drive motors and gearboxes
  for (const comp of ['driveL', 'driveR'] as const) {
    const dv = find(spec, comp);
    const side = comp === 'driveL' ? -1 : 1;
    const wheels = spec.wheels.filter((w) => w.side === side);
    const perWheel = spec.loadout.drive === 'chair4' ? wheels : [wheels[Math.floor(wheels.length / 2)] ?? wheels[0]];
    for (const w of perWheel) {
      if (!w) continue;
      const cx = dv.center.x;
      const cy = Math.max(dv.center.y, 0.045 * s);
      const cz = w.pos.z;
      const r = Math.min(dv.size.x, dv.size.y) * 0.42;
      const gb = bevelBox(dv.size.x * 0.75, dv.size.y * 0.85, dv.size.z * 0.38, 0.004);
      b.add(gb, hw(c, 'aluCast'), new THREE.Matrix4().makeTranslation(cx, cy, cz));
      const dirZ = cz > 0 ? -1 : 1;
      const canLen = dv.size.z * 0.7;
      const can = new THREE.CylinderGeometry(r, r, canLen, 16).rotateX(Math.PI / 2);
      const canZ = cz + dirZ * (dv.size.z * 0.19 + canLen / 2);
      b.add(can, hw(c, 'motorCan'), new THREE.Matrix4().makeTranslation(cx, cy, canZ));
      const bell = new THREE.CylinderGeometry(r * 0.92, r * 0.92, 0.02 * s, 16).rotateX(Math.PI / 2);
      const bellZ = canZ + dirZ * (canLen / 2 + 0.01 * s);
      b.add(bell, hw(c, 'black'), new THREE.Matrix4().makeTranslation(cx, cy, bellZ));
      for (const k of [-1, 1]) {
        const brush = new THREE.CylinderGeometry(0.008 * s, 0.008 * s, 0.014 * s, 8).rotateZ(Math.PI / 2);
        b.add(brush, hw(c, 'blackPlastic'), new THREE.Matrix4().makeTranslation(cx + k * (r + 0.004 * s), cy, bellZ - dirZ * 0.01 * s));
      }
      // Output shaft to the wheel.
      const shaftLen = Math.abs(w.pos.x - cx);
      if (shaftLen > 0.02) {
        const sh = new THREE.CylinderGeometry(0.01 * s, 0.01 * s, shaftLen, 8).rotateZ(Math.PI / 2);
        b.add(sh, hw(c, 'steel'), new THREE.Matrix4().makeTranslation((w.pos.x + cx) / 2, w.pos.y, w.pos.z));
      }
    }
    // Chain along the side for skid steer.
    if (spec.loadout.drive === 'skid6' && wheels.length > 1) {
      const zs = wheels.map((w) => w.pos.z);
      const z0 = Math.min(...zs);
      const z1 = Math.max(...zs);
      const x = wheels[0].pos.x - side * (wheels[0].width / 2 + 0.035 * s);
      const y = wheels[0].pos.y;
      const sr = 0.035 * s;
      for (const k of [-1, 1]) {
        b.add(new THREE.BoxGeometry(0.008 * s, 0.008 * s, z1 - z0), hw(c, 'blued'), new THREE.Matrix4().makeTranslation(x, y + k * sr, (z0 + z1) / 2));
      }
      for (const z of zs) {
        const sp = new THREE.CylinderGeometry(sr, sr, 0.01 * s, 14).rotateZ(Math.PI / 2);
        b.add(sp, hw(c, 'blued'), new THREE.Matrix4().makeTranslation(x, y, z));
      }
    }
  }

  // ---- weapon drive
  const wp = find(spec, 'weapon');
  const wc = v3(wp.center);
  const kind = spec.weapon.kind;
  if (kind === 'vdisk' || kind === 'drum' || kind === 'hbar' || kind === 'shell') {
    const r = Math.min(wp.size.x, wp.size.y) * 0.45;
    const x = kind === 'vdisk' ? wc.x - 0.08 * s : wc.x;
    const can = new THREE.CylinderGeometry(r, r, wp.size.z * 0.8, 18).rotateX(Math.PI / 2);
    b.add(can, hw(c, 'motorCan'), new THREE.Matrix4().makeTranslation(x, wc.y, wc.z));
    const bell = new THREE.CylinderGeometry(r * 0.9, r * 0.9, 0.02 * s, 18).rotateX(Math.PI / 2);
    b.add(bell, hw(c, 'black'), new THREE.Matrix4().makeTranslation(x, wc.y, wc.z + wp.size.z * 0.42));
    const strap = new THREE.TorusGeometry(r * 1.02, 0.004 * s, 4, 18);
    b.add(strap, hw(c, 'black'), new THREE.Matrix4().makeTranslation(x, wc.y, wc.z));
  } else if (kind === 'flipper' || kind === 'axe') {
    const valve = bevelBox(0.06 * s, 0.04 * s, 0.05 * s, 0.004);
    b.add(valve, hw(c, 'brass'), new THREE.Matrix4().makeTranslation(wc.x + 0.05 * s, wc.y, wc.z));
    const buffer = new THREE.CapsuleGeometry(0.03 * s, 0.08 * s, 4, 14).rotateZ(Math.PI / 2);
    b.add(buffer, hw(c, 'co2'), new THREE.Matrix4().makeTranslation(wc.x - 0.04 * s, wc.y, wc.z));
    const gauge = new THREE.CylinderGeometry(0.015 * s, 0.015 * s, 0.01 * s, 14).rotateX(Math.PI / 2);
    b.add(gauge, hw(c, 'chrome'), new THREE.Matrix4().makeTranslation(wc.x + 0.05 * s, wc.y + 0.03 * s, wc.z - 0.026 * s));
  } else if (kind === 'lifter') {
    const ctl = bevelBox(0.07 * s, 0.035 * s, 0.06 * s, 0.003);
    b.add(ctl, hw(c, 'black'), new THREE.Matrix4().makeTranslation(wc.x + 0.06 * s, wc.y, wc.z + 0.05 * s));
  }

  // ---- wiring: red and black runs from the battery to the controllers and motors
  const run = (from: THREE.Vector3, to: THREE.Vector3, sag: number) => {
    for (const [k, mat] of [
      [-1, 'wireRed'],
      [1, 'wireBlack'],
    ] as const) {
      const off = new THREE.Vector3(k * 0.006 * s, 0, 0);
      const a = from.clone().add(off);
      const e = to.clone().add(off);
      const mid = a.clone().lerp(e, 0.5);
      mid.y += sag;
      const curve = new THREE.CatmullRomCurve3([a, a.clone().lerp(mid, 0.5).setY(a.y + sag * 0.8), mid, e.clone().lerp(mid, 0.5).setY(e.y + sag * 0.8), e]);
      b.add(new THREE.TubeGeometry(curve, lowQ ? 6 : 14, 0.0045 * s, 5), hw(c, mat));
    }
  };
  const batTop = bc.clone().setY(bc.y + by * 0.3);
  run(batTop, ec.clone().setY(ec.y + ey * 0.1), 0.03 * s);
  for (const comp of ['driveL', 'driveR'] as const) {
    const dv = find(spec, comp);
    run(ec.clone().add(new THREE.Vector3(0, 0, ez * 0.4)), v3(dv.center).setY(Math.max(dv.center.y, 0.045 * s) + 0.03 * s), 0.02 * s);
  }
  run(ec.clone().add(new THREE.Vector3(0, 0, -ez * 0.4)), wc.clone().setY(wc.y + 0.02 * s), 0.025 * s);
  // A yellow signal lead to the receiver.
  const sig = new THREE.CatmullRomCurve3([
    ec.clone().add(new THREE.Vector3(-ex * 0.3, ey * 0.2, 0)),
    ec.clone().add(new THREE.Vector3(-ex * 0.45, ey * 0.35, ez * 0.1)),
    ec.clone().add(new THREE.Vector3(-ex * 0.5 - 0.03 * s, -ey * 0.25, ez * 0.2)),
  ]);
  b.add(new THREE.TubeGeometry(sig, 8, 0.002 * s, 4), hw(c, 'wireYellow'));

  b.build(group);
  return group;
}

