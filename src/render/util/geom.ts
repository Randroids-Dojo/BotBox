// Geometry helpers: transform-and-merge builders for static meshes.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

/** Collects transformed geometries and merges them into one draw call. */
export class GeoBatch {
  private parts: THREE.BufferGeometry[] = [];

  add(g: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): this {
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    const c = toStandard(g).applyMatrix4(_m);
    this.parts.push(c);
    return this;
  }

  addMatrix(g: THREE.BufferGeometry, m: THREE.Matrix4): this {
    this.parts.push(toStandard(g).applyMatrix4(m));
    return this;
  }

  /** A box from min to max corners. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): this {
    const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
    return this.add(g, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  }

  /** A cylinder between two points. */
  beam(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 6): this {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
    const dir = _p.subVectors(b, a).normalize();
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    _m.compose(mid, _q, _s.set(1, 1, 1));
    this.parts.push(toStandard(g).applyMatrix4(_m));
    return this;
  }

  get count(): number {
    return this.parts.length;
  }

  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Non-indexed with position, normal and uv so different primitives merge. */
function toStandard(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let c = g.index ? g.toNonIndexed() : g.clone();
  for (const name of Object.keys(c.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') c.deleteAttribute(name);
  }
  if (!c.attributes.uv) {
    const n = c.attributes.position.count;
    c.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  }
  if (!c.attributes.normal) c.computeVertexNormals();
  g.dispose();
  return c;
}

/** Simple box-projected UVs in world meters (for tiling textures on merged geometry). */
export function worldUv(g: THREE.BufferGeometry, scale = 1): THREE.BufferGeometry {
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    let u: number;
    let v: number;
    if (ny >= nx && ny >= nz) {
      u = pos.getX(i);
      v = pos.getZ(i);
    } else if (nx >= nz) {
      u = pos.getZ(i);
      v = pos.getY(i);
    } else {
      u = pos.getX(i);
      v = pos.getY(i);
    }
    uv[i * 2] = u * scale;
    uv[i * 2 + 1] = v * scale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

export const UP = new THREE.Vector3(0, 1, 0);

export function v3(p: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(p.x, p.y, p.z);
}
