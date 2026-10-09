// BotView: a procedural robot built from a BotSpec. Armor panels follow spec.panels (one group
// each, same order), wheels follow spec.wheels, the weapon animates from WeaponFrame, and hits
// leave dents, scratches, gouges, cracks and scorch.
import * as THREE from 'three';
import type { BotFrame, BotSpec, Component, HitEvent, PanelSpec } from '../../contract';
import type { BotView, BotViewOptions, Quality } from '../types';
import { buildFrame, buildInternals } from './internals';
import { armorMaterial, hardware } from './materials';
import { PaintAtlas, type PaintItem, type PanelRole } from './paint';
import { type Outline, buildPlate, dentPlate } from './plate';
import { type WeaponRig, buildSrimech, buildWeapon } from './weapons';
import { GeoBucket, hashString, quat, v3 } from './util';
import { buildWheel } from './wheel';

interface QualitySettings {
  atlas: number;
  seg: number;
  boltSides: number;
  boltSpacing: number;
}

const QS: Record<Quality, QualitySettings> = {
  high: { atlas: 1024, seg: 0.022, boltSides: 6, boltSpacing: 0.1 },
  medium: { atlas: 768, seg: 0.035, boltSides: 6, boltSpacing: 0.12 },
  low: { atlas: 512, seg: 0.06, boltSides: 4, boltSpacing: 0.17 },
};

interface PanelView {
  index: number;
  spec: PanelSpec;
  role: PanelRole;
  group: THREE.Group;
  mesh: THREE.Mesh;
  base: Float32Array;
  /** Panel-local to robot frame (panel center, not the outer face). */
  matrix: THREE.Matrix4;
  inverse: THREE.Matrix4;
  /** Rest transform relative to its parent when it rides on an arm. */
  onArm: boolean;
}

const ROT_FRONT = new THREE.Quaternion(0, 1, 0, 0);

// ------------------------------------------------------------------------------- 2D helpers

type P2 = THREE.Vector2;

function convexHull2(pts: P2[]): P2[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: P2, a: P2, b: P2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: P2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 1e-12) lower.pop();
    lower.push(q);
  }
  const upper: P2[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 1e-12) upper.pop();
    upper.push(q);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Sutherland-Hodgman: clip polygon `subject` by convex CCW polygon `clip`. */
function clipPoly(subject: P2[], clip: P2[]): P2[] {
  let out = subject;
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const inside = (p: P2) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= -1e-9;
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const cur = input[j];
      const prev = input[(j + input.length - 1) % input.length];
      const ci = inside(cur);
      const pi = inside(prev);
      if (ci) {
        if (!pi) out.push(intersect(prev, cur, a, b));
        out.push(cur);
      } else if (pi) out.push(intersect(prev, cur, a, b));
    }
    if (!out.length) break;
  }
  return out;
}

function intersect(p1: P2, p2: P2, a: P2, b: P2): P2 {
  const d = (p1.x - p2.x) * (a.y - b.y) - (p1.y - p2.y) * (a.x - b.x);
  if (Math.abs(d) < 1e-12) return p1.clone();
  const t = ((p1.x - a.x) * (a.y - b.y) - (p1.y - a.y) * (a.x - b.x)) / d;
  return new THREE.Vector2(p1.x + t * (p2.x - p1.x), p1.y + t * (p2.y - p1.y));
}

function polyArea(p: P2[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i].x * q.y - q.x * p[i].y;
  }
  return a / 2;
}

/** Reduce a convex polygon to 4 corners by dropping the least significant vertices. */
function toQuad(p: P2[]): P2[] {
  const pts = [...p];
  while (pts.length > 4) {
    let best = 0;
    let bestA = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
      if (area < bestA) {
        bestA = area;
        best = i;
      }
    }
    pts.splice(best, 1);
  }
  while (pts.length < 4) pts.push(pts[pts.length - 1].clone());
  return pts;
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Split a rectangle minus holes into as few solid rectangles as a grid merge gives. */
function rectMinusHoles(r: Rect, holes: Rect[]): Rect[] {
  const xs = [...new Set([r.x0, r.x1, ...holes.flatMap((h) => [h.x0, h.x1])].map((v) => Math.min(r.x1, Math.max(r.x0, v))))].sort((a, b) => a - b);
  const ys = [...new Set([r.y0, r.y1, ...holes.flatMap((h) => [h.y0, h.y1])].map((v) => Math.min(r.y1, Math.max(r.y0, v))))].sort((a, b) => a - b);
  const solid = (i: number, j: number) => {
    const cx = (xs[i] + xs[i + 1]) / 2;
    const cy = (ys[j] + ys[j + 1]) / 2;
    return !holes.some((h) => cx > h.x0 && cx < h.x1 && cy > h.y0 && cy < h.y1);
  };
  const tryMerge = (rowMajor: boolean): Rect[] => {
    const out: Rect[] = [];
    const nA = rowMajor ? ys.length - 1 : xs.length - 1;
    const nB = rowMajor ? xs.length - 1 : ys.length - 1;
    let prev: Rect[] = [];
    for (let a = 0; a < nA; a++) {
      const runs: Rect[] = [];
      let start = -1;
      for (let b = 0; b <= nB; b++) {
        const ok = b < nB && (rowMajor ? solid(b, a) : solid(a, b));
        if (ok && start < 0) start = b;
        if (!ok && start >= 0) {
          runs.push(
            rowMajor
              ? { x0: xs[start], x1: xs[b], y0: ys[a], y1: ys[a + 1] }
              : { x0: xs[a], x1: xs[a + 1], y0: ys[start], y1: ys[b] },
          );
          start = -1;
        }
      }
      const next: Rect[] = [];
      for (const run of runs) {
        const m = prev.find((p) => (rowMajor ? p.x0 === run.x0 && p.x1 === run.x1 && p.y1 === run.y0 : p.y0 === run.y0 && p.y1 === run.y1 && p.x1 === run.x0));
        if (m) {
          if (rowMajor) m.y1 = run.y1;
          else m.x1 = run.x1;
          next.push(m);
        } else {
          out.push(run);
          next.push(run);
        }
      }
      prev = next;
    }
    return out.filter((q) => q.x1 - q.x0 > 0.004 && q.y1 - q.y0 > 0.004);
  };
  const a = tryMerge(true);
  const b = tryMerge(false);
  return a.length <= b.length ? a : b;
}

function rectQuad(r: Rect): THREE.Vector2[] {
  return [new THREE.Vector2(r.x0, r.y0), new THREE.Vector2(r.x1, r.y0), new THREE.Vector2(r.x1, r.y1), new THREE.Vector2(r.x0, r.y1)];
}

// ------------------------------------------------------------------------------- the view

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

class ProceduralBotView implements BotView {
  readonly root = new THREE.Group();
  private atlas: PaintAtlas;
  private armor: THREE.MeshStandardMaterial;
  private panels: PanelView[] = [];
  private wheels: THREE.Group[] = [];
  private rig: WeaponRig | null;
  private srimech: ReturnType<typeof buildSrimech> | null = null;
  private internals: THREE.Group;
  private frame: THREE.Group;
  private lastHit = -Infinity;
  private comp = new Map<Component, THREE.Vector3>();
  private ownGeos: THREE.BufferGeometry[] = [];
  private sootTimer = 0;
  private sootDone = 0;
  private alwaysInternals: boolean;
  private lastInverted = false;
  private q: QualitySettings;

  constructor(
    readonly spec: BotSpec,
    private opts: BotViewOptions,
  ) {
    const s = spec.scale;
    const L = spec.loadout;
    this.q = QS[opts.quality];
    this.root.name = `bot:${L.name}`;
    const env = opts.envMap;
    const chassis = L.chassis;

    // ---- paint items and panel geometry plans
    const H = (() => {
      const top = spec.panels.find((p) => p.facet === 'top');
      return top ? top.center.y + top.t / 2 : spec.height;
    })();
    const items: PaintItem[] = [];
    const plans = spec.panels.map((p, i) => {
      const m = new THREE.Matrix4().compose(v3(p.center), quat(p.rot), new THREE.Vector3(1, 1, 1));
      const face = m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, p.t / 2));
      const role = this.roleOf(p, i);
      items.push({ id: `p${i}`, w: p.w, h: p.h, role, facet: p.facet, matrix: face });
      return { p, i, m, role };
    });
    if (spec.weapon.kind === 'shell') {
      const w = spec.weapon;
      items.push({ id: 'shell', w: Math.PI * 2 * w.radius, h: w.width + w.radius * 0.75, role: 'shell', matrix: new THREE.Matrix4() });
    }
    this.atlas = new PaintAtlas(items, L.paint, L.armor.material, L.name, this.q.atlas, s, spec.length, H);
    this.armor = armorMaterial(this.atlas, L.paint, L.armor.material, env, opts.quality);
    this.alwaysInternals = L.armor.material === 'polycarb';

    // ---- weapon first: it decides slots in the armor and may carry the front panel
    this.rig = buildWeapon({ spec, env, q: opts.quality, armor: this.armor, atlas: this.atlas });
    if (this.rig) this.root.add(this.rig.group);
    if (L.extras.includes('srimech') && chassis !== 'invertible') {
      this.srimech = buildSrimech({ spec, env, q: opts.quality, armor: this.armor, atlas: this.atlas });
      this.root.add(this.srimech.group);
    }

    const cutters: THREE.Vector3[][] = [...(this.rig?.cutters ?? [])];
    if (chassis === 'invertible') {
      for (const w of spec.wheels) {
        const pts: THREE.Vector3[] = [];
        const r = w.radius + 0.012 * s;
        const step = 0.01;
        for (let x = -w.width / 2 - 0.008; x <= w.width / 2 + 0.008; x += step)
          for (let y = -r; y <= r; y += step) for (let z = -r; z <= r; z += step) if (y * y + z * z <= r * r) pts.push(new THREE.Vector3(w.pos.x + x, w.pos.y + y, w.pos.z + z));
        cutters.push(pts);
      }
    }

    // ---- panels
    for (const plan of plans) this.buildPanel(plan.p, plan.i, plan.m, plan.role, cutters);

    // ---- wheels
    for (const w of spec.wheels) {
      const g = buildWheel(w, L.drive, env, opts.quality);
      this.root.add(g);
      this.wheels.push(g);
    }

    // ---- structure and guts
    this.frame = buildFrame({ spec, env, q: opts.quality });
    this.root.add(this.frame);
    this.internals = buildInternals({ spec, env, q: opts.quality });
    this.internals.visible = this.alwaysInternals;
    this.root.add(this.internals);
    for (const c of spec.internals) this.comp.set(c.component, v3(c.center));
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry) this.ownGeos.push(m.geometry);
    });
  }

  /** Half width of the main hull (outer face of the side armor). */
  private hullHalfWidth(): number {
    let m = 0;
    for (const q of this.spec.hull[0]) m = Math.max(m, Math.abs(q.x));
    return m;
  }

  private roleOf(p: PanelSpec, i: number): PanelRole {
    const chassis = this.spec.loadout.chassis;
    const s = this.spec.scale;
    if (chassis === 'shell') return p.facet === 'top' ? 'top' : p.facet === 'belly' ? 'belly' : 'bulkhead';
    if (i < 6) {
      switch (p.facet) {
        case 'front':
          return Math.abs(quat(p.rot).angleTo(ROT_FRONT)) > 0.05 ? 'slope' : 'front';
        case 'rear':
          return 'rear';
        case 'left':
        case 'right':
          return 'side';
        case 'top':
          return 'top';
        default:
          return 'belly';
      }
    }
    if (p.facet === 'front') return 'wedgeplate';
    if ((p.facet === 'left' || p.facet === 'right') && p.h > 0.12 * s) return 'guard';
    return 'skirt';
  }

  private buildPanel(p: PanelSpec, i: number, m: THREE.Matrix4, role: PanelRole, cutters: THREE.Vector3[][]): void {
    const spec = this.spec;
    const s = spec.scale;
    const inv = m.clone().invert();
    const hw = p.w / 2;
    const hh = p.h / 2;
    const rect: Rect = { x0: -hw, y0: -hh, x1: hw, y1: hh };
    const onArm = !!this.rig?.armPivot && p.facet === 'front' && i === 0;
    let outlines: Outline[];
    let boltPath: THREE.Vector2[] | null = null;
    let solids: Rect[] = [rect];
    if (spec.loadout.chassis === 'shell' && (p.facet === 'top' || p.facet === 'belly')) {
      outlines = [{ kind: 'disc', r: Math.min(hw, hh), cx: 0, cy: 0 }];
    } else {
      // Holes where the weapon or wheels pass through.
      const holes: Rect[] = [];
      if (!onArm)
        for (const pts of cutters) {
          const slab = p.t / 2 + 0.011;
          let any = false;
          const h: Rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
          for (const q of pts) {
            _v.copy(q).applyMatrix4(inv);
            if (Math.abs(_v.z) > slab) continue;
            any = true;
            h.x0 = Math.min(h.x0, _v.x);
            h.x1 = Math.max(h.x1, _v.x);
            h.y0 = Math.min(h.y0, _v.y);
            h.y1 = Math.max(h.y1, _v.y);
          }
          if (!any) continue;
          const c = 0.006 * s;
          h.x0 -= c;
          h.x1 += c;
          h.y0 -= c;
          h.y1 += c;
          if (h.x1 < -hw || h.x0 > hw || h.y1 < -hh || h.y0 > hh) continue;
          // Holes that reach near an edge open up to it (a slot, not a window).
          const snap = 0.03 * s;
          if (h.x0 - -hw < snap) h.x0 = -hw - 0.01;
          if (hw - h.x1 < snap) h.x1 = hw + 0.01;
          if (h.y0 - -hh < snap) h.y0 = -hh - 0.01;
          if (hh - h.y1 < snap) h.y1 = hh + 0.01;
          holes.push(h);
        }
      if (holes.length) {
        solids = rectMinusHoles(rect, holes);
        outlines = solids.map((r) => ({ kind: 'quad' as const, pts: rectQuad(r) }));
      } else if (i < 6) {
        // Trim body panels to the hull silhouette (wedge sides follow the slope).
        const proj = spec.hull[0].map((q) => {
          _v.copy(v3(q)).applyMatrix4(inv);
          return new THREE.Vector2(_v.x, _v.y);
        });
        const hull2 = convexHull2(proj);
        const clipped = polyArea(hull2) > 1e-6 ? clipPoly(rectQuad(rect), hull2) : rectQuad(rect);
        const quadPts = clipped.length >= 3 && Math.abs(polyArea(clipped)) > p.w * p.h * 0.2 ? toQuad(clipped) : rectQuad(rect);
        outlines = [{ kind: 'quad', pts: quadPts }];
        boltPath = quadPts;
      } else {
        outlines = [{ kind: 'quad', pts: rectQuad(rect) }];
      }
    }

    // Bolts around the edge.
    const bolts: THREE.Vector2[] = [];
    if (role !== 'bulkhead') {
      const inset = Math.min(0.022 * s, Math.min(hw, hh) * 0.4);
      const spacing = this.q.boltSpacing * s;
      const ol = outlines[0];
      if (ol.kind === 'disc') {
        const r = ol.r - inset;
        const n = Math.max(6, Math.round((Math.PI * 2 * r) / spacing));
        for (let k = 0; k < n; k++) bolts.push(new THREE.Vector2(Math.cos((k / n) * Math.PI * 2) * r, Math.sin((k / n) * Math.PI * 2) * r));
      } else {
        const path = boltPath ?? rectQuad(rect);
        const cx = path.reduce((a, q) => a + q.x, 0) / path.length;
        const cy = path.reduce((a, q) => a + q.y, 0) / path.length;
        const inner = path.map((q) => {
          const d = new THREE.Vector2(cx - q.x, cy - q.y);
          // Move each corner inward along both edges by `inset`.
          return new THREE.Vector2(q.x + Math.sign(d.x) * inset, q.y + Math.sign(d.y) * inset);
        });
        for (let e = 0; e < inner.length; e++) {
          const a = inner[e];
          const b = inner[(e + 1) % inner.length];
          const len = a.distanceTo(b);
          const n = Math.max(1, Math.round(len / spacing));
          for (let k = 0; k < n; k++) bolts.push(a.clone().lerp(b, k / n));
        }
        const margin = inset * 0.8;
        for (let k = bolts.length - 1; k >= 0; k--) {
          const b = bolts[k];
          const ok = solids.some((r) => b.x > r.x0 + margin * 0.5 && b.x < r.x1 - margin * 0.5 && b.y > r.y0 + margin * 0.5 && b.y < r.y1 - margin * 0.5);
          if (!ok) bolts.splice(k, 1);
        }
      }
    }

    const id = `p${i}`;
    const atlas = this.atlas;
    const plate = buildPlate(outlines, bolts, 0.016 * s, this.q.boltSides, {
      t: p.t,
      bevel: Math.min(p.t * 0.45, 0.003 * s),
      seg: this.q.seg * s,
      uv: (x, y, out) => atlas.uv(id, x, y, out),
      boltUV: atlas.swatchUV('bolt'),
    });
    const mesh = new THREE.Mesh(plate.geometry, this.armor);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const group = new THREE.Group();
    group.name = `panel:${i}:${p.facet}`;
    group.add(mesh);

    // Wheel guards get a fender lip over the wheels, back to the hull side.
    if (role === 'guard') {
      const d = Math.max(0.04 * s, Math.abs(p.center.x) - this.hullHalfWidth() + p.t);
      const lip = buildPlate([{ kind: 'quad', pts: rectQuad({ x0: -hw, y0: -d / 2, x1: hw, y1: d / 2 }) }], [], 0, 4, {
        t: p.t,
        bevel: Math.min(p.t * 0.45, 0.003 * s),
        seg: this.q.seg * s * 2,
        uv: (x, y, out) => atlas.uv(id, x, hh - 0.012 * s - Math.abs(y) * 0.1, out),
        boltUV: atlas.swatchUV('bolt'),
      });
      const lm = new THREE.Mesh(lip.geometry, this.armor);
      lm.rotation.x = -Math.PI / 2;
      // Sit the lip just above the tallest tire.
      const tireTop = Math.max(...spec.wheels.map((w) => w.pos.y + w.radius)) - p.center.y;
      const ly = Math.max(hh - p.t / 2, tireTop + 0.008 * s + p.t / 2);
      lm.position.set(0, ly, -d / 2 + p.t / 2);
      if (ly > hh) {
        // A short upstand joins the guard to the raised lip.
        const up = buildPlate([{ kind: 'quad', pts: rectQuad({ x0: -hw, y0: hh - 0.01 * s, x1: hw, y1: ly + p.t / 2 }) }], [], 0, 4, {
          t: p.t,
          bevel: Math.min(p.t * 0.45, 0.003 * s),
          seg: this.q.seg * s * 2,
          uv: (x, y, out) => atlas.uv(id, x, Math.min(y, hh - 0.012 * s), out),
          boltUV: atlas.swatchUV('bolt'),
        });
        const um = new THREE.Mesh(up.geometry, this.armor);
        um.castShadow = um.receiveShadow = true;
        group.add(um);
      }
      lm.castShadow = lm.receiveShadow = true;
      group.add(lm);
    }

    // Ram spikes ride on the main front panel.
    if (this.spec.loadout.extras.includes('spikes') && p.facet === 'front' && i === 0) {
      const b = new GeoBucket();
      const fwd = new THREE.Vector3(0, 0, -1).transformDirection(inv).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), fwd);
      const n = 4;
      const len = 0.11 * s;
      for (let k = 0; k < n; k++) {
        const x = -hw + p.w * ((k + 0.5) / n);
        const y = role === 'slope' ? hh * 0.1 : 0;
        const cone = new THREE.ConeGeometry(0.022 * s, len, 8);
        cone.translate(0, len / 2 + 0.012 * s, 0);
        b.add(cone, hardware('chrome', this.opts.envMap, this.opts.quality), new THREE.Matrix4().compose(new THREE.Vector3(x, y, p.t / 2), q, new THREE.Vector3(1, 1, 1)));
        const collar = new THREE.CylinderGeometry(0.03 * s, 0.032 * s, 0.014 * s, 6);
        collar.translate(0, 0.007 * s, 0);
        b.add(collar, hardware('blued', this.opts.envMap, this.opts.quality), new THREE.Matrix4().compose(new THREE.Vector3(x, y, p.t / 2), q, new THREE.Vector3(1, 1, 1)));
      }
      b.build(group);
    }

    if (onArm && this.rig?.armPivot) {
      const w = this.spec.weapon as { hinge: { x: number; y: number; z: number } };
      const rest = new THREE.Matrix4().compose(v3(w.hinge), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.rig.armRest ?? 0), new THREE.Vector3(1, 1, 1));
      const local = rest.invert().multiply(m);
      local.decompose(group.position, group.quaternion, group.scale);
      this.rig.armPivot.add(group);
    } else {
      m.decompose(group.position, group.quaternion, group.scale);
      this.root.add(group);
    }
    this.panels.push({ index: i, spec: p, role, group, mesh, base: plate.base, matrix: m, inverse: inv, onArm });
  }

  // ------------------------------------------------------------------------------- per frame

  update(frame: BotFrame, dt: number): void {
    this.root.position.set(frame.pos.x, frame.pos.y, frame.pos.z);
    this.root.quaternion.set(frame.quat.x, frame.quat.y, frame.quat.z, frame.quat.w);
    let missing = false;
    for (const pv of this.panels) {
      const vis = frame.facets[pv.spec.facet] > 0;
      pv.group.visible = vis;
      if (!vis) missing = true;
    }
    this.internals.visible = missing || this.alwaysInternals;
    for (let i = 0; i < this.wheels.length; i++) {
      const w = this.wheels[i];
      w.rotation.x = -(frame.wheelSpin[i] ?? 0);
      w.visible = !frame.wheelLost[i];
    }
    this.rig?.update(frame.weapon, frame.parts.weapon, dt, frame.inverted);
    this.srimech?.update(frame.inverted, dt);
    this.lastInverted = frame.inverted;
    if (frame.fire > 0.05) {
      this.sootTimer += dt * frame.fire;
      if (this.sootTimer > 0.5 && this.sootDone < 24) {
        this.sootTimer = 0;
        this.sootDone++;
        this.applySoot();
      }
    }
    this.atlas.flush();
    this.root.updateMatrixWorld();
  }

  private applySoot(): void {
    const bat = this.comp.get('battery') ?? new THREE.Vector3();
    for (const pv of this.panels) {
      if (pv.role !== 'top' && pv.role !== 'side' && pv.role !== 'rear' && pv.role !== 'slope') continue;
      _v.copy(bat).applyMatrix4(pv.inverse);
      // Soot climbs: bias toward the top edge on vertical panels.
      const y = pv.role === 'top' ? _v.y : Math.min(pv.spec.h / 2, _v.y + pv.spec.h * 0.3);
      const x = THREE.MathUtils.clamp(_v.x, -pv.spec.w / 2, pv.spec.w / 2);
      this.atlas.soot(`p${pv.index}`, x, y, 0.8, this.sootDone * 31 + pv.index);
    }
  }

  hit(e: HitEvent): void {
    if (e.t <= this.lastHit) return;
    this.lastHit = e.t;
    const s = this.spec.scale;
    this.root.updateWorldMatrix(true, false);
    _m.copy(this.root.matrixWorld).invert();
    const pLocal = _v.set(e.point.x, e.point.y, e.point.z).applyMatrix4(_m);
    this.root.getWorldQuaternion(_q).invert();
    const dLocal = _v2.set(e.dir.x, e.dir.y, e.dir.z).applyQuaternion(_q);
    const mat = this.spec.loadout.armor.material;
    const e01 = THREE.MathUtils.clamp(Math.log10(Math.max(1, e.energy)) / 4.3, 0, 1);
    const kind: 'spinner' | 'blunt' | 'saw' = e.kind === 'spinner' ? 'spinner' : e.kind === 'killsaw' ? 'saw' : 'blunt';
    const seed = hashString(`${e.t.toFixed(4)}:${e.kind}`);

    // Shell robots take side hits on the spinning shell.
    if (this.rig?.shell && (e.facet === 'front' || e.facet === 'rear' || e.facet === 'left' || e.facet === 'right')) {
      this.dentShell(e01, seed, kind, e.energy);
      return;
    }

    let best: PanelView | null = null;
    let bestD = Infinity;
    for (const pv of this.panels) {
      if (pv.spec.facet !== e.facet || !pv.group.visible) continue;
      const lp = pLocal.clone().applyMatrix4(pv.inverse);
      const cx = THREE.MathUtils.clamp(lp.x, -pv.spec.w / 2, pv.spec.w / 2);
      const cy = THREE.MathUtils.clamp(lp.y, -pv.spec.h / 2, pv.spec.h / 2);
      const d = Math.hypot(lp.x - cx, lp.y - cy, lp.z);
      if (d < bestD) {
        bestD = d;
        best = pv;
      }
    }
    if (!best) return;
    const pv = best;
    const lp = pLocal.clone().applyMatrix4(pv.inverse);
    const margin = 0.03 * s;
    const x = THREE.MathUtils.clamp(lp.x, -pv.spec.w / 2 + margin, pv.spec.w / 2 - margin);
    const y = THREE.MathUtils.clamp(lp.y, -pv.spec.h / 2 + margin, pv.spec.h / 2 - margin);
    const dl = dLocal.clone().transformDirection(pv.inverse);
    // Dent: deeper for soft metals and big energy, wider for blunt hits.
    const soft = { aluminum: 1, titanium: 0.55, steel: 0.35, uhmw: 0.75, polycarb: 0.3 }[mat];
    const blunt = kind === 'blunt';
    const depth = (0.002 + 0.034 * e01 * e01) * s * soft * (e.kind === 'axe' || e.kind === 'pulverizer' ? 1.5 : 1) * (0.6 + 0.6 * e.severity);
    const radius = (blunt ? 0.05 + 0.09 * e01 : 0.03 + 0.06 * e01) * s;
    if (e.energy > 120) this.dentPanel(pv, x, y, depth, radius, seed);
    this.atlas.damage(`p${pv.index}`, x, y, dl.x || 1, dl.y, e.energy, kind, seed);
  }

  private dentPanel(pv: PanelView, x: number, y: number, depth: number, radius: number, seed: number): void {
    const g = pv.mesh.geometry;
    dentPlate(g, x, y, depth, radius, seed % 97);
    // Keep the plate from folding through itself.
    const a = (g.attributes.position as THREE.BufferAttribute).array as Float32Array;
    const max = 0.07 * this.spec.scale;
    for (let i = 2; i < a.length; i += 3) if (pv.base[i] - a[i] > max) a[i] = pv.base[i] - max;
  }

  private dentShell(e01: number, seed: number, kind: 'spinner' | 'blunt' | 'saw', energy: number): void {
    const sh = this.rig!.shell!;
    const w = this.spec.weapon as { radius: number; width: number };
    const g = sh.mesh.geometry;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    const ang = ((seed % 1000) / 1000) * Math.PI * 2;
    const cx = Math.cos(ang) * w.radius;
    const cz = -Math.sin(ang) * w.radius;
    const rad = (0.05 + 0.08 * e01) * this.spec.scale;
    const depth = (0.002 + 0.02 * e01 * e01) * this.spec.scale;
    for (let i = 0; i < a.length; i += 3) {
      const dx = a[i] - cx;
      const dz = a[i + 2] - cz;
      const dy = a[i + 1];
      const d2 = dx * dx + dz * dz + dy * dy * 0.5;
      if (d2 > rad * rad * 9) continue;
      const k = depth * Math.exp(-d2 / (2 * rad * rad));
      const r = Math.hypot(a[i], a[i + 2]) || 1;
      a[i] -= (a[i] / r) * k;
      a[i + 2] -= (a[i + 2] / r) * k;
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    const cellW = Math.PI * 2 * w.radius;
    const u = ang / (Math.PI * 2);
    this.atlas.damage('shell', (u - 0.5) * cellW, 0.03 * this.spec.scale, 1, 0.1, energy, kind, seed);
  }

  resetDamage(): void {
    for (const pv of this.panels) {
      const pos = pv.mesh.geometry.attributes.position as THREE.BufferAttribute;
      (pos.array as Float32Array).set(pv.base);
      pos.needsUpdate = true;
      pv.mesh.geometry.computeVertexNormals();
    }
    const sh = this.rig?.shell;
    if (sh) {
      const pos = sh.mesh.geometry.attributes.position as THREE.BufferAttribute;
      (pos.array as Float32Array).set(sh.base);
      pos.needsUpdate = true;
      sh.mesh.geometry.computeVertexNormals();
    }
    this.atlas.repaint();
    this.lastHit = -Infinity;
    this.sootDone = 0;
    this.sootTimer = 0;
  }

  panelMesh(index: number): THREE.Object3D {
    const pv = this.panels[index];
    const g = new THREE.Group();
    if (!pv) return g;
    for (const child of pv.group.children) {
      const c = child.clone() as THREE.Mesh;
      if (c.isMesh) c.geometry = c.geometry.clone();
      g.add(c);
    }
    g.name = `debris-panel:${index}`;
    return g;
  }

  wheelMesh(index: number): THREE.Object3D {
    const w = this.wheels[index];
    const g = w ? w.clone() : new THREE.Group();
    g.position.set(0, 0, 0);
    g.rotation.set(0, 0, 0);
    g.visible = true;
    return g;
  }

  componentWorld(c: Component, out: THREE.Vector3): THREE.Vector3 {
    const p = this.comp.get(c);
    if (p) out.copy(p);
    else out.set(0, this.spec.height / 2, 0);
    return this.root.localToWorld(out);
  }

  /** Whether the last frame showed the robot upside down. */
  get inverted(): boolean {
    return this.lastInverted;
  }

  dispose(): void {
    this.root.removeFromParent();
    const shared = new Set<THREE.BufferGeometry>();
    for (const w of this.wheels) w.traverse((o) => (o as THREE.Mesh).isMesh && shared.add((o as THREE.Mesh).geometry));
    for (const g of this.ownGeos) if (!shared.has(g)) g.dispose();
    this.armor.dispose();
    this.atlas.dispose();
    this.rig?.dispose();
  }
}

export function createProceduralBotView(spec: BotSpec, opts: BotViewOptions): BotView {
  return new ProceduralBotView(spec, opts);
}

