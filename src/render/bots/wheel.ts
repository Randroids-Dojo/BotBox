// Wheels: a rubber carcass with rounded shoulders and chunky chevron lugs, a metal rim with lug
// bolts and an inner sprocket. Built around the X axis, outer face toward +X.
import * as THREE from 'three';
import type { DriveId, WheelSpec } from '../../contract';
import type { Quality } from '../types';
import { hardware, hardwareMaterial } from './materials';
import { GeoBucket } from './util';

const cache = new Map<string, THREE.BufferGeometry>();

function carcass(r: number, w: number, segs: number): THREE.BufferGeometry {
  // Profile from inner sidewall to outer sidewall, in (x across, radius).
  const prof: [number, number][] = [];
  const bead = r * 0.6;
  const sh = Math.min(w * 0.22, r * 0.18);
  const steps = 5;
  prof.push([-w / 2, bead]);
  prof.push([-w / 2, r - sh]);
  for (let i = 1; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2);
    prof.push([-w / 2 + sh - Math.cos(a) * sh, r - sh + Math.sin(a) * sh]);
  }
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2);
    prof.push([w / 2 - sh + Math.sin(a) * sh, r - sh + Math.cos(a) * sh]);
  }
  prof.push([w / 2, bead]);
  // Lathe around X: LatheGeometry revolves around Y, so build in (radius, y) then rotate.
  const pts = prof.map(([x, rr]) => new THREE.Vector2(rr, x));
  const g = new THREE.LatheGeometry(pts, segs);
  g.rotateZ(-Math.PI / 2);
  return g;
}

function lugs(r: number, w: number, count: number, depth: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const blockW = w * 0.36;
  const arc = (Math.PI * 2 * r) / count;
  for (let row = 0; row < 2; row++) {
    const side = row === 0 ? -1 : 1;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + (row ? Math.PI / count : 0);
      const g = new THREE.BoxGeometry(blockW, depth * 2, arc * 0.42);
      // Chevron: angle the block a little.
      g.rotateY(side * 0.35);
      g.translate(side * w * 0.22, r - depth * 0.35, 0);
      g.rotateX(a);
      out.push(g);
    }
  }
  return out;
}

function rim(r: number, w: number, segs: number, kind: DriveId): { rim: THREE.BufferGeometry[]; dark: THREE.BufferGeometry[] } {
  const rimR = r * 0.6;
  const rimParts: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  // Dish profile: lip, dish down to the hub face, hub boss.
  const prof: [number, number][] = [
    [rimR * 1.02, -w * 0.46],
    [rimR * 1.04, -w * 0.4],
    [rimR * 0.98, -w * 0.36],
    [rimR * 0.96, w * 0.36],
    [rimR * 1.04, w * 0.42],
    [rimR * 1.0, w * 0.47],
    [rimR * 0.9, w * 0.47],
    [rimR * 0.75, w * 0.3],
    [rimR * 0.4, w * 0.28],
    [rimR * 0.36, w * 0.38],
    [rimR * 0.22, w * 0.42],
    [rimR * 0.001, w * 0.42],
  ];
  const lathe = new THREE.LatheGeometry(
    prof.map(([rr, x]) => new THREE.Vector2(rr, x)),
    Math.max(16, Math.round(segs * 0.6)),
  );
  lathe.rotateZ(-Math.PI / 2);
  rimParts.push(lathe);
  // Lug bolts on the hub face.
  const nLug = kind === 'skid6' ? 4 : 5;
  for (let i = 0; i < nLug; i++) {
    const a = (i / nLug) * Math.PI * 2;
    const b = new THREE.CylinderGeometry(rimR * 0.08, rimR * 0.08, w * 0.12, 6);
    b.rotateZ(Math.PI / 2);
    b.translate(w * 0.32, Math.cos(a) * rimR * 0.5, Math.sin(a) * rimR * 0.5);
    rimParts.push(b);
  }
  // Axle nut.
  const nut = new THREE.CylinderGeometry(rimR * 0.16, rimR * 0.16, w * 0.16, 6);
  nut.rotateZ(Math.PI / 2);
  nut.translate(w * 0.46, 0, 0);
  dark.push(nut);
  // Inner sprocket for chain drive, or a plain flange.
  if (kind === 'skid6' || kind === 'chair4') {
    const teeth = 18;
    const shape = new THREE.Shape();
    const ro = rimR * 0.78;
    const ri = rimR * 0.68;
    for (let i = 0; i <= teeth * 2; i++) {
      const a = (i / (teeth * 2)) * Math.PI * 2;
      const rr = i % 2 === 0 ? ro : ri;
      if (i === 0) shape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else shape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    const hole = new THREE.Path();
    hole.absarc(0, 0, rimR * 0.3, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const sp = new THREE.ExtrudeGeometry(shape, { depth: w * 0.08, bevelEnabled: false, curveSegments: 2 });
    sp.rotateY(Math.PI / 2);
    sp.translate(-w * 0.62, 0, 0);
    dark.push(sp);
  }
  return { rim: rimParts, dark };
}

export function wheelGeometry(spec: WheelSpec, drive: DriveId, env: THREE.Texture | null, q: Quality): THREE.BufferGeometry {
  const key = `${spec.radius.toFixed(4)}:${spec.width.toFixed(4)}:${drive}:${q}`;
  let g = cache.get(key);
  if (!g) {
    const segs = q === 'high' ? 64 : q === 'medium' ? 44 : 28;
    const r = spec.radius;
    const w = spec.width;
    const depth = r * 0.07;
    const b = new GeoBucket();
    const tread = hardware('tread', env, q);
    for (const part of [carcass(r - depth * 0.6, w, segs), ...lugs(r - depth * 0.6, w, q === 'low' ? 14 : 20, depth)]) b.add(part, tread);
    const rp = rim(r, w, segs, drive);
    const rimSw = hardware(drive === 'mag2' ? 'alu' : drive === 'drill2' ? 'blackPlastic' : 'aluCast', env, q);
    for (const part of rp.rim) b.add(part, rimSw);
    for (const part of rp.dark) b.add(part, hardware('blued', env, q));
    const holder = new THREE.Group();
    g = b.build(holder, false)[0].geometry;
    cache.set(key, g);
  }
  return g;
}

/** One wheel: outer group (positioned, spun about X) holding a mesh that faces outward. */
export function buildWheel(spec: WheelSpec, drive: DriveId, env: THREE.Texture | null, q: Quality): THREE.Group {
  const g = wheelGeometry(spec, drive, env, q);
  const spin = new THREE.Group();
  const mesh = new THREE.Mesh(g, hardwareMaterial(env, q));
  if (spec.side < 0) mesh.rotation.y = Math.PI;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  spin.add(mesh);
  spin.position.set(spec.pos.x, spec.pos.y, spec.pos.z);
  spin.name = 'wheel';
  return spin;
}
