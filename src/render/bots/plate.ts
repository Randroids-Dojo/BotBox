// Armor plate geometry: a subdivided slab with a chamfered outer edge, built from one or more
// outlines (quads or discs) in panel-local meters. The outer face is +Z. The grid is dense
// enough that dents can be pushed into it by moving vertices, and bolts ride along.
import * as THREE from 'three';

export type Outline = { kind: 'quad'; pts: THREE.Vector2[] } | { kind: 'disc'; r: number; cx: number; cy: number };

export type UvFn = (x: number, y: number, out: [number, number]) => [number, number];

export interface PlateBuildOpts {
  t: number;
  bevel: number;
  /** Target segment length in meters. */
  seg: number;
  uv: UvFn;
  boltUV: [number, number];
  /** Constant uv for the inner face (bare metal), or null to mirror the paint (clear plastic). */
  backUV?: [number, number] | null;
}

class Builder {
  pos: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  private tmp: [number, number] = [0, 0];
  constructor(private o: PlateBuildOpts) {}

  vert(x: number, y: number, z: number, ux: number, uy: number): number {
    this.pos.push(x, y, z);
    this.o.uv(ux, uy, this.tmp);
    this.uv.push(this.tmp[0], this.tmp[1]);
    return this.pos.length / 3 - 1;
  }

  rawVert(x: number, y: number, z: number, u: number, v: number): number {
    this.pos.push(x, y, z);
    this.uv.push(u, v);
    return this.pos.length / 3 - 1;
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }
}

function bilerp(p: THREE.Vector2[], u: number, v: number, out = new THREE.Vector2()): THREE.Vector2 {
  const a = (1 - u) * (1 - v);
  const b = u * (1 - v);
  const c = u * v;
  const d = (1 - u) * v;
  return out.set(a * p[0].x + b * p[1].x + c * p[2].x + d * p[3].x, a * p[0].y + b * p[1].y + c * p[2].y + d * p[3].y);
}

/** Inset a convex CCW quad by `b` along its edge normals. */
function inset(p: THREE.Vector2[], b: number): THREE.Vector2[] {
  const n = p.length;
  const normals = p.map((a, i) => {
    const c = p[(i + 1) % n];
    const e = new THREE.Vector2(c.x - a.x, c.y - a.y).normalize();
    return new THREE.Vector2(-e.y, e.x); // inward for CCW
  });
  return p.map((a, i) => {
    const n0 = normals[(i + n - 1) % n];
    const n1 = normals[i];
    const k = b / Math.max(0.2, 1 + n0.dot(n1));
    return new THREE.Vector2(a.x + (n0.x + n1.x) * k, a.y + (n0.y + n1.y) * k);
  });
}

function ensureCCW(p: THREE.Vector2[]): THREE.Vector2[] {
  let area = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area < 0 ? [...p].reverse() : p;
}

function addQuad(B: Builder, pts: THREE.Vector2[], o: PlateBuildOpts): void {
  const p = ensureCCW(pts);
  const len = (i: number) => p[i].distanceTo(p[(i + 1) % 4]);
  const nA = Math.max(1, Math.min(48, Math.ceil(Math.max(len(0), len(2)) / o.seg)));
  const nB = Math.max(1, Math.min(48, Math.ceil(Math.max(len(1), len(3)) / o.seg)));
  const b = Math.min(o.bevel, Math.min(len(0), len(1), len(2), len(3)) * 0.2);
  const q = inset(p, b);
  const zf = o.t / 2;
  const zc = o.t / 2 - b;
  const zb = -o.t / 2;
  const tmp = new THREE.Vector2();
  const centroid = new THREE.Vector2();
  for (const c of p) centroid.add(c);
  centroid.multiplyScalar(0.25);

  // Front grid on the inset quad.
  const front: number[] = [];
  for (let j = 0; j <= nB; j++)
    for (let i = 0; i <= nA; i++) {
      bilerp(q, i / nA, j / nB, tmp);
      front.push(B.vert(tmp.x, tmp.y, zf, tmp.x, tmp.y));
    }
  const F = (i: number, j: number) => front[j * (nA + 1) + i];
  for (let j = 0; j < nB; j++) for (let i = 0; i < nA; i++) B.quad(F(i, j), F(i + 1, j), F(i + 1, j + 1), F(i, j + 1));

  // Boundary parameter loop (u, v) in CCW order.
  const loop: [number, number][] = [];
  for (let i = 0; i < nA; i++) loop.push([i / nA, 0]);
  for (let j = 0; j < nB; j++) loop.push([1, j / nB]);
  for (let i = nA; i > 0; i--) loop.push([i / nA, 1]);
  for (let j = nB; j > 0; j--) loop.push([0, j / nB]);
  const L = loop.length;
  const pull = (x: number, y: number) => {
    // Sample edge pixels slightly inside the cell so edges carry the chipped paint.
    const dx = centroid.x - x;
    const dy = centroid.y - y;
    const d = Math.hypot(dx, dy) || 1;
    const k = Math.min(0.004, d * 0.5) / d;
    return [x + dx * k, y + dy * k] as const;
  };
  // Chamfer and side wall, one strip per loop segment with its own vertices (crisp edges).
  for (let k = 0; k < L; k++) {
    const [u0, v0] = loop[k];
    const [u1, v1] = loop[(k + 1) % L];
    const a0 = bilerp(q, u0, v0, new THREE.Vector2());
    const a1 = bilerp(q, u1, v1, new THREE.Vector2());
    const o0 = bilerp(p, u0, v0, new THREE.Vector2());
    const o1 = bilerp(p, u1, v1, new THREE.Vector2());
    const [s0x, s0y] = pull(o0.x, o0.y);
    const [s1x, s1y] = pull(o1.x, o1.y);
    if (b > 0) {
      const i0 = B.vert(o0.x, o0.y, zc, s0x, s0y);
      const i1 = B.vert(o1.x, o1.y, zc, s1x, s1y);
      const i2 = B.vert(a1.x, a1.y, zf, s1x, s1y);
      const i3 = B.vert(a0.x, a0.y, zf, s0x, s0y);
      B.quad(i0, i1, i2, i3);
    }
    const w0 = B.vert(o0.x, o0.y, zb, s0x, s0y);
    const w1 = B.vert(o1.x, o1.y, zb, s1x, s1y);
    const w2 = B.vert(o1.x, o1.y, zc, s1x, s1y);
    const w3 = B.vert(o0.x, o0.y, zc, s0x, s0y);
    B.quad(w0, w1, w2, w3);
  }

  // Back face (reversed), same grid on the full outline.
  const back: number[] = [];
  for (let j = 0; j <= nB; j++)
    for (let i = 0; i <= nA; i++) {
      bilerp(p, i / nA, j / nB, tmp);
      back.push(o.backUV ? B.rawVert(tmp.x, tmp.y, zb, o.backUV[0], o.backUV[1]) : B.vert(tmp.x, tmp.y, zb, tmp.x, tmp.y));
    }
  const K = (i: number, j: number) => back[j * (nA + 1) + i];
  for (let j = 0; j < nB; j++) for (let i = 0; i < nA; i++) B.quad(K(i, j), K(i, j + 1), K(i + 1, j + 1), K(i + 1, j));
}

function addDisc(B: Builder, d: { r: number; cx: number; cy: number }, o: PlateBuildOpts): void {
  const segs = Math.max(24, Math.min(72, Math.ceil((Math.PI * 2 * d.r) / o.seg)));
  const rings = Math.max(2, Math.min(24, Math.ceil(d.r / o.seg)));
  const b = Math.min(o.bevel, d.r * 0.1);
  const ri = d.r - b;
  const zf = o.t / 2;
  const zc = o.t / 2 - b;
  const zb = -o.t / 2;
  const disc = (r: number, z: number, flip: boolean) => {
    const raw = flip && o.backUV;
    const V = (x: number, y: number) => (raw ? B.rawVert(x, y, z, raw[0], raw[1]) : B.vert(x, y, z, x, y));
    const c = V(d.cx, d.cy);
    const ringIdx: number[][] = [];
    for (let k = 1; k <= rings; k++) {
      const rr = (k / rings) * r;
      const row: number[] = [];
      for (let s = 0; s <= segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        const x = d.cx + Math.cos(a) * rr;
        const y = d.cy + Math.sin(a) * rr;
        row.push(V(x, y));
      }
      ringIdx.push(row);
    }
    for (let s = 0; s < segs; s++) {
      if (flip) B.idx.push(c, ringIdx[0][s + 1], ringIdx[0][s]);
      else B.idx.push(c, ringIdx[0][s], ringIdx[0][s + 1]);
    }
    for (let k = 0; k < rings - 1; k++)
      for (let s = 0; s < segs; s++) {
        const a = ringIdx[k][s];
        const bb = ringIdx[k][s + 1];
        const cc = ringIdx[k + 1][s + 1];
        const dd = ringIdx[k + 1][s];
        if (flip) B.quad(a, dd, cc, bb);
        else B.quad(a, bb, cc, dd);
      }
  };
  disc(ri, zf, false);
  disc(d.r, zb, true);
  for (let s = 0; s < segs; s++) {
    const a0 = (s / segs) * Math.PI * 2;
    const a1 = ((s + 1) / segs) * Math.PI * 2;
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const ur = d.r - 0.004;
    const u0x = d.cx + c0 * ur;
    const u0y = d.cy + s0 * ur;
    const u1x = d.cx + c1 * ur;
    const u1y = d.cy + s1 * ur;
    if (b > 0) {
      const i0 = B.vert(d.cx + c0 * d.r, d.cy + s0 * d.r, zc, u0x, u0y);
      const i1 = B.vert(d.cx + c1 * d.r, d.cy + s1 * d.r, zc, u1x, u1y);
      const i2 = B.vert(d.cx + c1 * ri, d.cy + s1 * ri, zf, u1x, u1y);
      const i3 = B.vert(d.cx + c0 * ri, d.cy + s0 * ri, zf, u0x, u0y);
      B.quad(i0, i1, i2, i3);
    }
    const w0 = B.vert(d.cx + c0 * d.r, d.cy + s0 * d.r, zb, u0x, u0y);
    const w1 = B.vert(d.cx + c1 * d.r, d.cy + s1 * d.r, zb, u1x, u1y);
    const w2 = B.vert(d.cx + c1 * d.r, d.cy + s1 * d.r, zc, u1x, u1y);
    const w3 = B.vert(d.cx + c0 * d.r, d.cy + s0 * d.r, zc, u0x, u0y);
    B.quad(w0, w1, w2, w3);
  }
}

/** Bolt template (non-indexed), standing on +Z. */
let boltTemplate: { size: number; sides: number; pos: Float32Array } | null = null;
function boltPositions(size: number, sides: number): Float32Array {
  if (boltTemplate && boltTemplate.size === size && boltTemplate.sides === sides) return boltTemplate.pos;
  const head = new THREE.CylinderGeometry(size * 0.5, size * 0.5, size * 0.36, sides, 1).toNonIndexed();
  head.translate(0, size * 0.18 + size * 0.07, 0);
  const washer = new THREE.CylinderGeometry(size * 0.75, size * 0.75, size * 0.07, Math.max(10, sides * 2), 1, true).toNonIndexed();
  washer.translate(0, size * 0.035, 0);
  const washerTop = new THREE.CircleGeometry(size * 0.75, Math.max(10, sides * 2)).toNonIndexed();
  washerTop.rotateX(-Math.PI / 2);
  washerTop.translate(0, size * 0.07, 0);
  const parts = [head, washer, washerTop];
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const out = new Float32Array(n * 3);
  let o = 0;
  const m = new THREE.Matrix4().makeRotationX(Math.PI / 2); // +Y up to +Z out
  const v = new THREE.Vector3();
  for (const g of parts) {
    const a = g.attributes.position;
    for (let i = 0; i < a.count; i++) {
      v.fromBufferAttribute(a, i).applyMatrix4(m);
      out[o++] = v.x;
      out[o++] = v.y;
      out[o++] = v.z;
    }
    g.dispose();
  }
  boltTemplate = { size, sides, pos: out };
  return out;
}

export interface PlateGeometry {
  geometry: THREE.BufferGeometry;
  base: Float32Array;
}

export function buildPlate(outlines: Outline[], bolts: THREE.Vector2[], boltSize: number, boltSides: number, o: PlateBuildOpts): PlateGeometry {
  const B = new Builder(o);
  for (const ol of outlines) {
    if (ol.kind === 'quad') addQuad(B, ol.pts, o);
    else addDisc(B, ol, o);
  }
  if (bolts.length) {
    const tpl = boltPositions(boltSize, boltSides);
    for (const b of bolts) {
      for (let i = 0; i < tpl.length; i += 9) {
        const a = B.rawVert(tpl[i] + b.x, tpl[i + 1] + b.y, tpl[i + 2] + o.t / 2, o.boltUV[0], o.boltUV[1]);
        B.rawVert(tpl[i + 3] + b.x, tpl[i + 4] + b.y, tpl[i + 5] + o.t / 2, o.boltUV[0], o.boltUV[1]);
        B.rawVert(tpl[i + 6] + b.x, tpl[i + 7] + b.y, tpl[i + 8] + o.t / 2, o.boltUV[0], o.boltUV[1]);
        B.idx.push(a, a + 1, a + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(B.pos);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(B.uv), 2));
  g.setIndex(B.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(B.idx, 1) : new THREE.Uint16BufferAttribute(B.idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return { geometry: g, base: pos.slice() };
}

/** Cheap 2D value noise for crumpled dents. */
function hashNoise(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Push a dent into the plate at panel-local (x, y). */
export function dentPlate(g: THREE.BufferGeometry, x: number, y: number, depth: number, radius: number, seed: number): void {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const a = pos.array as Float32Array;
  const s2 = 2 * radius * radius;
  const lim = 9 * radius * radius;
  for (let i = 0; i < a.length; i += 3) {
    const dx = a[i] - x;
    const dy = a[i + 1] - y;
    const d2 = dx * dx + dy * dy;
    if (d2 > lim) continue;
    const crumple = 0.75 + 0.5 * hashNoise(Math.round(a[i] * 60) + seed, Math.round(a[i + 1] * 60));
    a[i + 2] -= depth * Math.exp(-d2 / s2) * crumple;
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
}

/** Bend a plate (for debris): curl along x and twist a little. */
export function bendPlate(g: THREE.BufferGeometry, curl: number, twist: number): void {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const a = pos.array as Float32Array;
  for (let i = 0; i < a.length; i += 3) {
    a[i + 2] += curl * a[i] * a[i] + twist * a[i] * a[i + 1];
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
}
