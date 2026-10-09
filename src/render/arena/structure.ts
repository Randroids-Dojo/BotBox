// The Box structure: kick walls, bolts, spikestrips, Lexan walls and ceiling, steel posts and
// frames, the overhead truss and its light fixtures.

import * as THREE from 'three';
import { ARENA_HALF, KICK_WALL_H, LEXAN_TOP, SPIKESTRIPS, WALL_T } from '../../data/arena';
import { GeoBatch, worldUv } from '../util/geom';
import type { ArenaMaterials } from './materials';

export const TRUSS_Y = 6.3;
export const TRUSS_HALF = ARENA_HALF + 0.75;
const LEXAN_X = ARENA_HALF + WALL_T / 2;
const PANELS = 4;

export interface Fixture {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  /** Beam half angle. */
  angle: number;
  color: THREE.Color;
  beam: boolean;
}

export interface Structure {
  root: THREE.Group;
  fixtures: Fixture[];
  /** Lens meshes (instanced) for dimming in the title scene. */
  lenses: THREE.InstancedMesh;
}

export function buildStructure(mats: ArenaMaterials): Structure {
  const root = new THREE.Group();
  root.name = 'structure';
  const H = ARENA_HALF;

  // ------------------------------------------------------------------ kick walls
  const kb = new GeoBatch();
  const t = WALL_T;
  const h = KICK_WALL_H;
  kb.box(-H - t, 0, -H - t, H + t, h, -H); // north
  kb.box(-H - t, 0, H, H + t, h, H + t); // south
  kb.box(-H - t, 0, -H, -H, h, H); // west
  kb.box(H, 0, -H, H + t, h, H); // east
  const kickGeo = worldUv(kb.build(), 1);
  const kick = new THREE.Mesh(kickGeo, mats.kick);
  kick.castShadow = true;
  kick.receiveShadow = true;
  root.add(kick);

  // Angle iron caps on top of the kick walls and a base skirt.
  const cap = new GeoBatch();
  for (const s of [-1, 1]) {
    cap.box(-H - t - 0.03, h, s * H - 0.05 * s, H + t + 0.03, h + 0.05, s * (H + t + 0.03));
    cap.box(s * H - 0.05 * s, h, -H - t, s * (H + t + 0.03), h + 0.05, H + t);
    // Inside lip.
    cap.box(-H, h - 0.08, s * H - 0.012 * s, H, h, s * H);
    cap.box(s * H - 0.012 * s, h - 0.08, -H, s * H, h, H);
  }
  const caps = new THREE.Mesh(worldUv(cap.build(), 1), mats.darkSteel);
  caps.castShadow = true;
  caps.receiveShadow = true;
  root.add(caps);

  // Bolts on the inside faces.
  const boltGeo = new THREE.CylinderGeometry(0.02, 0.022, 0.014, 6);
  boltGeo.rotateX(Math.PI / 2);
  const boltMats: THREE.Matrix4[] = [];
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  const walls: { n: THREE.Vector3; along: 'x' | 'z'; c: number }[] = [
    { n: new THREE.Vector3(0, 0, 1), along: 'x', c: -H },
    { n: new THREE.Vector3(0, 0, -1), along: 'x', c: H },
    { n: new THREE.Vector3(1, 0, 0), along: 'z', c: -H },
    { n: new THREE.Vector3(-1, 0, 0), along: 'z', c: H },
  ];
  for (const w of walls) {
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), w.n);
    for (let s = -H + 0.15; s <= H - 0.1; s += 0.36) {
      for (const y of [0.09, 0.47]) {
        if (w.along === 'x') p.set(s, y, w.c + w.n.z * 0.007);
        else p.set(w.c + w.n.x * 0.007, y, s);
        boltMats.push(new THREE.Matrix4().compose(p, q, one));
      }
    }
  }
  const bolts = new THREE.InstancedMesh(boltGeo, mats.bolt, boltMats.length);
  boltMats.forEach((bm, i) => bolts.setMatrixAt(i, bm));
  bolts.computeBoundingSphere();
  root.add(bolts);

  // ------------------------------------------------------------------ spikestrips
  const spikeGeo = new THREE.ConeGeometry(0.035, 1, 8);
  spikeGeo.translate(0, 0.5, 0);
  spikeGeo.rotateZ(-Math.PI / 2); // point along +X
  const spikeMats: THREE.Matrix4[] = [];
  const rail = new GeoBatch();
  for (const s of SPIKESTRIPS) {
    const sign = s.wall === 'west' ? 1 : -1;
    const wx = s.wall === 'west' ? -H : H;
    rail.box(wx, s.height - 0.09, s.z0 - 0.15, wx + sign * 0.06, s.height + 0.09, s.z1 + 0.15);
    const n = Math.floor((s.z1 - s.z0) / s.spacing + 1e-6) + 1;
    for (let i = 0; i < n; i++) {
      const z = s.z0 + i * s.spacing;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.wall === 'west' ? 0 : Math.PI);
      p.set(wx + sign * 0.05, s.height, z);
      spikeMats.push(new THREE.Matrix4().compose(p, q, new THREE.Vector3(s.reach - 0.05, 1, 1)));
    }
  }
  const spikes = new THREE.InstancedMesh(spikeGeo, mats.brightSteel, spikeMats.length);
  spikeMats.forEach((sm, i) => spikes.setMatrixAt(i, sm));
  spikes.castShadow = true;
  spikes.computeBoundingSphere();
  root.add(spikes);
  const railMesh = new THREE.Mesh(worldUv(rail.build(), 2.5), mats.hazard);
  railMesh.castShadow = true;
  root.add(railMesh);

  // ------------------------------------------------------------------ Lexan
  const lx = new GeoBatch();
  const span = H * 2 + t * 2;
  const lh = LEXAN_TOP - h - 0.05;
  for (const s of [-1, 1]) {
    const pz = new THREE.PlaneGeometry(span, lh);
    lx.add(pz, 0, h + 0.05 + lh / 2, s * LEXAN_X);
    const px = new THREE.PlaneGeometry(span, lh);
    lx.add(px, s * LEXAN_X, h + 0.05 + lh / 2, 0, 0, Math.PI / 2, 0);
  }
  const lexGeo = worldUv(lx.build(), 1);
  const lexan = new THREE.Mesh(lexGeo, mats.lexan);
  lexan.renderOrder = 2;
  lexan.name = 'lexan';
  root.add(lexan);
  const ceilGeo = new THREE.PlaneGeometry(span, span);
  ceilGeo.rotateX(Math.PI / 2);
  ceilGeo.translate(0, LEXAN_TOP, 0);
  const ceiling = new THREE.Mesh(worldUv(ceilGeo, 1), mats.lexanCeiling);
  ceiling.renderOrder = 2;
  ceiling.name = 'ceiling';
  root.add(ceiling);

  // Polycarbonate edges glint along the panel seams.
  const edge = new GeoBatch();
  const et = 0.03;
  for (const s of [-1, 1]) {
    for (let i = 0; i <= PANELS; i++) {
      const a = -H - t + (i / PANELS) * span;
      edge.box(a - et / 2, h, s * LEXAN_X - et / 2, a + et / 2, LEXAN_TOP, s * LEXAN_X + et / 2);
      edge.box(s * LEXAN_X - et / 2, h, a - et / 2, s * LEXAN_X + et / 2, LEXAN_TOP, a + et / 2);
    }
    edge.box(-H - t, LEXAN_TOP - et, s * LEXAN_X - et / 2, H + t, LEXAN_TOP, s * LEXAN_X + et / 2);
    edge.box(s * LEXAN_X - et / 2, LEXAN_TOP - et, -H - t, s * LEXAN_X + et / 2, LEXAN_TOP, H + t);
  }
  const edges = new THREE.Mesh(edge.build(), mats.lexanEdge);
  edges.renderOrder = 3;
  root.add(edges);

  // ------------------------------------------------------------------ posts and frames
  const fr = new GeoBatch();
  const postX = LEXAN_X + 0.12;
  const pw = 0.09;
  for (const s of [-1, 1]) {
    for (let i = 0; i <= PANELS; i++) {
      const a = -H - t + (i / PANELS) * span;
      // Square tube posts outside the Lexan, from the floor up to the truss.
      fr.box(a - pw, 0, s * postX - pw, a + pw, TRUSS_Y, s * postX + pw);
      fr.box(s * postX - pw, 0, a - pw, s * postX + pw, TRUSS_Y, a + pw);
      // Lexan clamp strips over the seams, inside face.
      fr.box(a - 0.04, h, s * (LEXAN_X - 0.03) - 0.012, a + 0.04, LEXAN_TOP, s * (LEXAN_X - 0.03) + 0.012);
      fr.box(s * (LEXAN_X - 0.03) - 0.012, h, a - 0.04, s * (LEXAN_X - 0.03) + 0.012, LEXAN_TOP, a + 0.04);
    }
    // Top rails at the ceiling line.
    fr.box(-postX - pw, LEXAN_TOP, s * postX - pw * 1.5, postX + pw, LEXAN_TOP + 0.2, s * postX + pw * 1.5);
    fr.box(s * postX - pw * 1.5, LEXAN_TOP, -postX - pw, s * postX + pw * 1.5, LEXAN_TOP + 0.2, postX + pw);
  }
  // Ceiling grid beams.
  for (let i = 1; i < PANELS; i++) {
    const a = -H - t + (i / PANELS) * span;
    fr.box(a - 0.05, LEXAN_TOP + 0.002, -postX, a + 0.05, LEXAN_TOP + 0.12, postX);
    fr.box(-postX, LEXAN_TOP + 0.002, a - 0.05, postX, LEXAN_TOP + 0.12, a + 0.05);
  }
  const frames = new THREE.Mesh(worldUv(fr.build(), 1), mats.frame);
  frames.castShadow = false;
  frames.receiveShadow = true;
  root.add(frames);

  // Outer ground.
  const groundGeo = new THREE.PlaneGeometry(90, 90);
  groundGeo.rotateX(-Math.PI / 2);
  groundGeo.translate(0, -0.005, 0);
  const ground = new THREE.Mesh(groundGeo, mats.concrete);
  ground.receiveShadow = true;
  root.add(ground);

  // ------------------------------------------------------------------ truss
  const tr = new GeoBatch();
  const TS = 0.42;
  const trussRun = (a: THREE.Vector3, b: THREE.Vector3) => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    dir.normalize();
    const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const corners = [
      side.clone().multiplyScalar(TS / 2).addScaledVector(up, TS / 2),
      side.clone().multiplyScalar(-TS / 2).addScaledVector(up, TS / 2),
      side.clone().multiplyScalar(-TS / 2).addScaledVector(up, -TS / 2),
      side.clone().multiplyScalar(TS / 2).addScaledVector(up, -TS / 2),
    ];
    for (const c of corners) tr.beam(a.clone().add(c), b.clone().add(c), 0.026, 6);
    const n = Math.max(1, Math.round(len / TS));
    for (let i = 0; i < n; i++) {
      const p0 = a.clone().addScaledVector(dir, (i / n) * len);
      const p1 = a.clone().addScaledVector(dir, ((i + 1) / n) * len);
      for (let f = 0; f < 4; f++) {
        const c0 = corners[f];
        const c1 = corners[(f + 1) % 4];
        const flip = i % 2 === 0;
        tr.beam(p0.clone().add(flip ? c0 : c1), p1.clone().add(flip ? c1 : c0), 0.011, 4);
      }
    }
  };
  const ty = TRUSS_Y;
  const T = TRUSS_HALF;
  trussRun(new THREE.Vector3(-T, ty, -T), new THREE.Vector3(T, ty, -T));
  trussRun(new THREE.Vector3(-T, ty, T), new THREE.Vector3(T, ty, T));
  trussRun(new THREE.Vector3(-T, ty, -T), new THREE.Vector3(-T, ty, T));
  trussRun(new THREE.Vector3(T, ty, -T), new THREE.Vector3(T, ty, T));
  for (const z of [-2.6, 2.6]) trussRun(new THREE.Vector3(-T, ty, z), new THREE.Vector3(T, ty, z));
  // Chain hoists up into the dark.
  for (const x of [-T, T]) for (const z of [-T, -2.6, 2.6, T]) tr.beam(new THREE.Vector3(x, ty + TS / 2, z), new THREE.Vector3(x, ty + 9, z), 0.012, 4);
  const truss = new THREE.Mesh(tr.build(), mats.truss);
  truss.castShadow = false;
  root.add(truss);

  // ------------------------------------------------------------------ fixtures
  const fixtures: Fixture[] = [];
  const cool = new THREE.Color(0.85, 0.92, 1.0);
  const blue = new THREE.Color(0.45, 0.62, 1.0);
  const amber = new THREE.Color(1.0, 0.62, 0.25);
  const lowY = ty - TS / 2 - 0.25;
  // Over the floor on the cross trusses, aimed at a grid of floor targets.
  const xs = [-5.2, -2.6, 0, 2.6, 5.2];
  for (const z of [-2.6, 2.6]) {
    xs.forEach((x, i) => {
      fixtures.push({
        pos: new THREE.Vector3(x, lowY, z),
        target: new THREE.Vector3(x * 1.05, 0, z * 1.6 + (i % 2 ? 0.6 : -0.6)),
        angle: 0.27,
        color: i % 2 ? blue : cool,
        beam: true,
      });
    });
  }
  // Perimeter cans aimed inward and down.
  for (const s of [-1, 1]) {
    for (const a of [-4.5, 0, 4.5]) {
      fixtures.push({ pos: new THREE.Vector3(a, lowY, s * T), target: new THREE.Vector3(a * 0.7, 0, s * 2.2), angle: 0.25, color: Math.abs(a) < 1 ? amber : blue, beam: true });
      fixtures.push({ pos: new THREE.Vector3(s * T, lowY, a), target: new THREE.Vector3(s * 2.2, 0, a * 0.7), angle: 0.25, color: Math.abs(a) < 1 ? amber : cool, beam: true });
    }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) fixtures.push({ pos: new THREE.Vector3(sx * T, lowY, sz * T), target: new THREE.Vector3(sx * 4.5, 0, sz * 4.5), angle: 0.3, color: amber, beam: true });

  const can = new GeoBatch();
  const canBody = new THREE.CylinderGeometry(0.17, 0.14, 0.42, 14, 1, true);
  can.add(canBody, 0, 0, 0);
  can.add(new THREE.CylinderGeometry(0.14, 0.14, 0.02, 14), 0, 0.21, 0);
  // Yoke.
  can.box(-0.21, -0.05, -0.02, -0.19, 0.4, 0.02);
  can.box(0.19, -0.05, -0.02, 0.21, 0.4, 0.02);
  can.box(-0.21, 0.38, -0.02, 0.21, 0.42, 0.02);
  const canGeo = can.build();
  canGeo.rotateX(Math.PI); // open end down
  const lensGeo = new THREE.CircleGeometry(0.155, 16);
  lensGeo.rotateX(Math.PI / 2);
  lensGeo.translate(0, -0.2, 0);
  const cans = new THREE.InstancedMesh(canGeo, mats.blackPaint, fixtures.length);
  const lensMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: true });
  const lenses = new THREE.InstancedMesh(lensGeo, lensMat, fixtures.length);
  const down = new THREE.Vector3(0, -1, 0);
  const col = new THREE.Color();
  fixtures.forEach((f, i) => {
    const dir = new THREE.Vector3().subVectors(f.target, f.pos).normalize();
    q.setFromUnitVectors(down, dir);
    m.compose(f.pos, q, one);
    cans.setMatrixAt(i, m);
    lenses.setMatrixAt(i, m);
    col.copy(f.color).multiplyScalar(14);
    lenses.setColorAt(i, col);
  });
  cans.castShadow = true;
  cans.computeBoundingSphere();
  lenses.computeBoundingSphere();
  root.add(cans, lenses);

  return { root, fixtures, lenses };
}
