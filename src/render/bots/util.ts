// Small helpers shared by the robot builders: seeded random numbers, colors, and a geometry
// bucket that merges many small parts into one mesh per material to keep draw calls down.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { type Swatch, paintSwatch } from './materials';

export class Rand {
  private s: number;
  constructor(seed: number | string) {
    this.s = typeof seed === 'number' ? seed >>> 0 || 1 : hashString(seed);
  }
  next(): number {
    // mulberry32
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.next() * xs.length) % xs.length];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0 || 1;
}

export function luminance(hex: string): number {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

export function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  if (k >= 0) c.lerp(new THREE.Color(1, 1, 1), k);
  else c.multiplyScalar(1 + k);
  return `#${c.getHexString()}`;
}

export function mix(a: string, b: string, t: number): string {
  const c = new THREE.Color(a).lerp(new THREE.Color(b), t);
  return `#${c.getHexString()}`;
}

/** Collects geometries keyed by material and merges them into one mesh each. Every geometry
 *  is converted to non-indexed position, normal and uv so they merge cleanly. */
export class GeoBucket {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(geo: THREE.BufferGeometry, matOrSwatch: THREE.Material | Swatch, m?: THREE.Matrix4): void {
    // Input geometries are never uploaded, so they need no dispose; the bucket copies them.
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    let mat: THREE.Material;
    if ('uv' in matOrSwatch && 'key' in matOrSwatch) {
      paintSwatch(g, matOrSwatch);
      mat = matOrSwatch.material;
    } else mat = matOrSwatch as THREE.Material;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) {
      const n = g.attributes.position.count;
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    }
    if (m) g.applyMatrix4(m);
    let list = this.parts.get(mat);
    if (!list) this.parts.set(mat, (list = []));
    list.push(g);
  }

  /** Add a geometry placed by position, rotation (euler) and scale. */
  place(geo: THREE.BufferGeometry, mat: THREE.Material | Swatch, pos: THREE.Vector3Like, rot?: THREE.Euler | THREE.Quaternion, scale?: THREE.Vector3Like): void {
    const q = rot instanceof THREE.Quaternion ? rot : new THREE.Quaternion().setFromEuler(rot ?? new THREE.Euler());
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(pos.x, pos.y, pos.z),
      q,
      new THREE.Vector3(scale?.x ?? 1, scale?.y ?? 1, scale?.z ?? 1),
    );
    this.add(geo, mat, m);
  }

  get empty(): boolean {
    return this.parts.size === 0;
  }

  /** Build meshes into `parent`. */
  build(parent: THREE.Object3D, shadows = true): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [mat, list] of this.parts) {
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (list.length > 1) for (const g of list) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = shadows;
      mesh.receiveShadow = shadows;
      parent.add(mesh);
      out.push(mesh);
    }
    this.parts.clear();
    return out;
  }
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Matrix that maps a unit Y-axis cylinder (height 1, centered) onto the segment a..b. */
export function segmentMatrix(a: THREE.Vector3Like, b: THREE.Vector3Like, radiusScale = 1): THREE.Matrix4 {
  tmpA.set(a.x, a.y, a.z);
  tmpB.set(b.x, b.y, b.z);
  const len = tmpA.distanceTo(tmpB);
  const dir = tmpB.clone().sub(tmpA).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
  const mid = tmpA.clone().add(tmpB).multiplyScalar(0.5);
  return new THREE.Matrix4().compose(mid, q, new THREE.Vector3(radiusScale, len, radiusScale));
}

export function v3(p: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(p.x, p.y, p.z);
}

export function quat(q: { x: number; y: number; z: number; w: number }): THREE.Quaternion {
  return new THREE.Quaternion(q.x, q.y, q.z, q.w);
}

/** A rounded, beveled box: good for bearing blocks, controllers and other small parts. */
export function bevelBox(w: number, h: number, d: number, r = Math.min(w, h, d) * 0.12, seg = 2): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const hw = w / 2 - r;
  const hh = h / 2 - r;
  shape.moveTo(-hw, -h / 2);
  shape.lineTo(hw, -h / 2);
  shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -hh);
  shape.lineTo(w / 2, hh);
  shape.quadraticCurveTo(w / 2, h / 2, hw, h / 2);
  shape.lineTo(-hw, h / 2);
  shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, hh);
  shape.lineTo(-w / 2, -hh);
  shape.quadraticCurveTo(-w / 2, -h / 2, -hw, -h / 2);
  const depth = Math.max(0.0005, d - 2 * r);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: r * 0.6, bevelThickness: r, bevelSegments: seg, curveSegments: seg });
  g.translate(0, 0, -depth / 2);
  // ExtrudeGeometry bevel grows the outline by bevelSize; shrink back so the box is w x h.
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  g.scale(w / (bb.max.x - bb.min.x), h / (bb.max.y - bb.min.y), d / (bb.max.z - bb.min.z));
  return g;
}

/** Hex bolt head with a washer, standing on +Y from y = 0. */
export function boltGeometry(size: number, sides = 6): THREE.BufferGeometry {
  const head = new THREE.CylinderGeometry(size * 0.5, size * 0.5, size * 0.38, sides, 1);
  head.translate(0, size * 0.19 + size * 0.06, 0);
  const washer = new THREE.CylinderGeometry(size * 0.72, size * 0.72, size * 0.08, Math.max(8, sides * 2), 1);
  washer.translate(0, size * 0.04, 0);
  const g = mergeGeometries([head.toNonIndexed(), washer.toNonIndexed()], false)!;
  head.dispose();
  washer.dispose();
  return g;
}

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
