// Weapon rigs: spinners (vertical disk, drum, horizontal bar, full-body shell) and arms
// (pneumatic flipper, pneumatic axe, electric lifter), plus the srimech. Each rig owns a group
// in the robot frame, animates from WeaponFrame and reports "cutter" volumes so armor panels can
// get slots and pockets where the weapon passes through them.
import * as THREE from 'three';
import type { ArmSpec, BotSpec, SpinnerSpec, WeaponFrame } from '../../contract';
import type { Quality } from '../types';
import { type HardwareKey, type Swatch, hardware, swatchMesh } from './materials';
import type { PaintAtlas } from './paint';
import { GeoBucket, bevelBox, segmentMatrix, v3 } from './util';

export interface RigCtx {
  spec: BotSpec;
  env: THREE.Texture | null;
  q: Quality;
  armor: THREE.MeshStandardMaterial;
  atlas: PaintAtlas;
}

export interface WeaponRig {
  group: THREE.Group;
  update(w: WeaponFrame, health: number, dt: number, inverted: boolean): void;
  /** Robot-frame point clouds: panels get holes where these cross them. */
  cutters: THREE.Vector3[][];
  /** For flippers: the pivot that carries the front armor (skin) and its rest angle. */
  armPivot?: THREE.Group;
  armRest?: number;
  /** For shells: the spinning skin, for dents and damage paint. */
  shell?: { mesh: THREE.Mesh; base: Float32Array; proxy: THREE.Mesh };
  dispose(): void;
}

const hw = (c: RigCtx, k: HardwareKey) => hardware(k, c.env, c.q);

// ------------------------------------------------------------------------------------ helpers

let blurAlpha: THREE.CanvasTexture | null = null;
/** Streaky alpha for spinning-weapon blur rings: u is angle, v is radius or height. */
function blurAlphaTexture(): THREE.CanvasTexture {
  if (blurAlpha) return blurAlpha;
  const W = 256;
  const H = 32;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = 'rgb(150,150,150)';
  ctx.fillRect(0, 0, W, H);
  let seed = 99;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      const len = 8 + rnd() * 60;
      const v = 90 + rnd() * 165;
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(x, y, len, 1);
      x += len;
    }
  }
  // Brighter rim where the teeth sweep.
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(255,255,255,0.0)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.15)');
  g.addColorStop(1, 'rgba(255,255,255,0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  blurAlpha = new THREE.CanvasTexture(cv);
  blurAlpha.wrapS = THREE.RepeatWrapping;
  blurAlpha.colorSpace = THREE.NoColorSpace;
  return blurAlpha;
}

/** Flat annulus in the XY plane with polar UVs (u angle, v radius). */
function polarRing(r0: number, r1: number, segs: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    pos.push(c * r0, s * r0, 0, c * r1, s * r1, 0);
    uv.push(i / segs, 0, i / segs, 1);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 3, a, a + 3, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function blurMaterial(c: RigCtx, color = '#aab0b6'): THREE.MeshStandardMaterial {
  const t = blurAlphaTexture();
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.45,
    roughness: 0.4,
    envMap: c.env,
    transparent: true,
    opacity: 0,
    alphaMap: t,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** Rail or arm plate in the YZ plane: a slot from zBack to zFront around an axle at (y, zFront). */
function railPlate(zBack: number, zFront: number, yc: number, half: number, thick: number): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  // Shape coords: x = -z (forward positive), y = y.
  const xb = -zBack;
  const xf = -zFront;
  sh.moveTo(xb, yc - half);
  sh.lineTo(xf, yc - half);
  sh.absarc(xf, yc, half, -Math.PI / 2, Math.PI / 2, false);
  sh.lineTo(xb, yc + half);
  sh.closePath();
  const hole = new THREE.Path();
  hole.absarc(xf, yc, half * 0.32, 0, Math.PI * 2, true);
  sh.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: true, bevelSize: thick * 0.15, bevelThickness: thick * 0.15, bevelSegments: 1, curveSegments: 10 });
  g.translate(0, 0, -thick / 2);
  // Map shape (x, y, z) to robot (x = z, y, z = -x).
  g.rotateY(Math.PI / 2);
  return g;
}

function boltCircle(b: GeoBucket, mat: Swatch, n: number, radius: number, boltR: number, len: number, place: (m: THREE.Matrix4) => THREE.Matrix4): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const g = new THREE.CylinderGeometry(boltR, boltR, len, 6);
    const m = new THREE.Matrix4().makeTranslation(0, Math.cos(a) * radius, Math.sin(a) * radius);
    m.multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
    b.add(g, mat, place(m));
  }
}

function sampleCylinderX(c: THREE.Vector3, r: number, halfX: number, step: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let x = -halfX; x <= halfX + 1e-6; x += step)
    for (let y = -r; y <= r; y += step)
      for (let z = -r; z <= r; z += step) if (y * y + z * z <= r * r) out.push(new THREE.Vector3(c.x + x, c.y + y, c.z + z));
  return out;
}

// ------------------------------------------------------------------------------------ spinners

interface SpinnerParts {
  group: THREE.Group;
  axis: THREE.Group;
  rotor: THREE.Group;
  slow: THREE.Object3D[];
  fast: THREE.Object3D[];
  blur: THREE.Mesh[];
  blurMats: THREE.MeshStandardMaterial[];
  glintMats: THREE.MeshBasicMaterial[];
  maxOpacity: number;
}

function spinnerShell(w: SpinnerSpec): SpinnerParts {
  const group = new THREE.Group();
  const axis = new THREE.Group();
  axis.position.copy(v3(w.center));
  const rotor = new THREE.Group();
  axis.add(rotor);
  group.add(axis);
  return { group, axis, rotor, slow: [], fast: [], blur: [], blurMats: [], glintMats: [], maxOpacity: 0.7 };
}

let glintTex: THREE.CanvasTexture | null = null;
/** Bright arcs that streak around a spinning weapon: an additive companion to the blur. */
function glintTexture(): THREE.CanvasTexture {
  if (glintTex) return glintTex;
  const W = 256;
  const H = 32;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 26; i++) {
    const y = Math.floor(rnd() * H);
    const x = rnd() * W;
    const len = 20 + rnd() * 90;
    const g = ctx.createLinearGradient(x, 0, x + len, 0);
    const v = Math.floor(120 + rnd() * 135);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.8, `rgb(${v},${v},${v})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, len, 1 + Math.floor(rnd() * 2));
  }
  glintTex = new THREE.CanvasTexture(cv);
  glintTex.wrapS = THREE.RepeatWrapping;
  glintTex.colorSpace = THREE.SRGBColorSpace;
  return glintTex;
}

/** Add a blur surface plus its additive glint twin to a spinner. */
function addBlur(c: RigCtx, p: SpinnerParts, geo: THREE.BufferGeometry, maxOpacity: number): THREE.MeshStandardMaterial {
  const bm = blurMaterial(c);
  const mesh = new THREE.Mesh(geo, bm);
  mesh.visible = false;
  mesh.renderOrder = 2;
  p.axis.add(mesh);
  p.blur.push(mesh);
  p.blurMats.push(bm);
  const gm = new THREE.MeshBasicMaterial({ map: glintTexture(), color: new THREE.Color(0.55, 0.55, 0.58), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const glint = new THREE.Mesh(geo, gm);
  glint.visible = false;
  glint.renderOrder = 3;
  p.axis.add(glint);
  p.blur.push(glint);
  p.glintMats.push(gm);
  p.maxOpacity = maxOpacity;
  return bm;
}

function animateSpinner(p: SpinnerParts, w: SpinnerSpec, f: WeaponFrame, health: number, t: number): void {
  if (w.axis === 'x') p.rotor.rotation.x = f.angle;
  else p.rotor.rotation.y = -f.angle;
  const fast = f.spin01 > 0.42;
  for (const o of p.slow) o.visible = !fast;
  for (const o of p.fast) o.visible = fast;
  const op = THREE.MathUtils.smoothstep(f.spin01, 0.25, 0.75) * p.maxOpacity;
  for (const b of p.blur) {
    b.visible = op > 0.01;
    if (w.axis === 'x') b.rotation.x = f.angle * 0.013 + t * 0.7;
    else b.rotation.y = -(f.angle * 0.013 + t * 0.7);
  }
  for (const m of p.blurMats) m.opacity = op;
  for (const m of p.glintMats) m.opacity = op * 1.1;
  // A bent rotor wobbles once the weapon is hurt.
  const wob = health < 0.6 ? ((0.6 - health) / 0.6) * 0.075 : 0;
  const a = f.angle;
  if (w.axis === 'x') {
    p.axis.rotation.y = wob * Math.sin(a);
    p.axis.rotation.z = wob * Math.cos(a);
  } else {
    p.axis.rotation.x = wob * Math.sin(a);
    p.axis.rotation.z = wob * Math.cos(a);
  }
}

function toothedDiskShape(R: number, teeth: number, toothH: number, holes: boolean): THREE.Shape {
  const sh = new THREE.Shape();
  const N = 96;
  const ramp = 0.6;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    // Distance (radians) behind the next tooth face in the direction of rotation.
    let r = R;
    for (let k = 0; k < teeth; k++) {
      const face = (k / teeth) * Math.PI * 2 + 0.3;
      let d = face - a;
      while (d < 0) d += Math.PI * 2;
      while (d > Math.PI * 2) d -= Math.PI * 2;
      if (d < ramp) r = Math.max(r, R + toothH * (1 - d / ramp) ** 0.7);
    }
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) sh.moveTo(x, y);
    else sh.lineTo(x, y);
  }
  if (holes) {
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 1.1;
      const h = new THREE.Path();
      h.absarc(Math.cos(a) * R * 0.56, Math.sin(a) * R * 0.56, R * 0.14, 0, Math.PI * 2, true);
      sh.holes.push(h);
    }
  }
  const bore = new THREE.Path();
  bore.absarc(0, 0, R * 0.06, 0, Math.PI * 2, true);
  sh.holes.push(bore);
  return sh;
}

function buildVDisk(c: RigCtx, w: SpinnerSpec): WeaponRig {
  let clock = 0;
  const s = c.spec.scale;
  const L = c.spec.length;
  const H = topHeight(c.spec);
  const p = spinnerShell(w);
  const R = w.radius;
  const th = w.width;
  // Disk with teeth and lightening holes.
  const shape = toothedDiskShape(R, w.teeth, w.toothHeight, true);
  const disk = new THREE.ExtrudeGeometry(shape, { depth: th, bevelEnabled: true, bevelSize: 0.0025 * s, bevelThickness: 0.002 * s, bevelSegments: 1, curveSegments: 12 });
  disk.translate(0, 0, -th / 2);
  disk.rotateY(Math.PI / 2);
  const rotorB = new GeoBucket();
  rotorB.add(disk, hw(c, 'disk'));
  // Hub plates and bolts.
  const hubR = R * 0.24;
  for (const sx of [-1, 1]) {
    const hub = new THREE.CylinderGeometry(hubR, hubR, 0.012 * s, 24);
    hub.rotateZ(Math.PI / 2);
    hub.translate(sx * (th / 2 + 0.006 * s), 0, 0);
    rotorB.add(hub, hw(c, 'steel'));
    boltCircle(rotorB, hw(c, 'black'), 6, hubR * 0.7, 0.006 * s, 0.01 * s, (m) => new THREE.Matrix4().makeTranslation(sx * (th / 2 + 0.014 * s), 0, 0).multiply(m));
  }
  const slowGroup = new THREE.Group();
  rotorB.build(slowGroup);
  // Plain disk (no holes) for when it spins fast.
  const plain = new THREE.ExtrudeGeometry(toothedDiskShape(R, 0, 0, false), { depth: th, bevelEnabled: false, curveSegments: 16 });
  plain.translate(0, 0, -th / 2);
  plain.rotateY(Math.PI / 2);
  const fastB = new GeoBucket();
  fastB.add(plain, hw(c, 'disk'));
  for (const sx of [-1, 1]) {
    const hub = new THREE.CylinderGeometry(hubR, hubR, 0.012 * s, 24);
    hub.rotateZ(Math.PI / 2);
    hub.translate(sx * (th / 2 + 0.006 * s), 0, 0);
    fastB.add(hub, hw(c, 'steel'));
  }
  const fastGroup = new THREE.Group();
  fastB.build(fastGroup);
  fastGroup.visible = false;
  p.rotor.add(slowGroup, fastGroup);
  p.slow.push(slowGroup);
  p.fast.push(fastGroup);
  // Axle pulley spins with the disk.
  const gap = 0.012 * s;
  const railT = 0.018 * s;
  const railX = th / 2 + gap + railT / 2;
  const pulleyX = railX + railT / 2 + 0.045 * s;
  const pulleyR = 0.045 * s;
  const pul = swatchMesh(new THREE.CylinderGeometry(pulleyR, pulleyR, 0.03 * s, 24).rotateZ(Math.PI / 2), hw(c, 'alu'));
  pul.position.x = pulleyX;
  pul.castShadow = true;
  p.rotor.add(pul);
  // Blur: a translucent ring where the teeth sweep, on both faces of the disk.
  // Blur on both faces of the disk, from the hub out past the teeth.
  for (const sx of [-1, 1]) addBlur(c, p, polarRing(R * 0.3, R + w.toothHeight, 64).rotateY(Math.PI / 2).translate(sx * (th / 2 + 0.0035 * s), 0, 0), 0.7);

  // Static mount: fork rails, axle, bearing blocks, motor, belt.
  const st = new GeoBucket();
  const zBack = -L / 2 + 0.2 * s + Math.max(0, -w.center.z - L / 2) * 0.2;
  const yc = w.center.y - 0.0;
  const zc = w.center.z;
  const half = 0.06 * s;
  for (const sx of [-1, 1]) {
    const rail = railPlate(zBack, zc, yc, half, railT);
    rail.translate(sx * railX, 0, 0);
    st.add(rail, hw(c, 'frame'));
    const blk = bevelBox(0.03 * s, 0.1 * s, 0.075 * s);
    blk.translate(sx * (railX + railT / 2 + 0.016 * s), yc, zc);
    st.add(blk, hw(c, 'aluCast'));
    for (const by of [-1, 1]) {
      const bolt = new THREE.CylinderGeometry(0.007 * s, 0.007 * s, 0.012 * s, 6).rotateZ(Math.PI / 2);
      bolt.translate(sx * (railX + railT / 2 + 0.034 * s), yc + by * 0.034 * s, zc);
      st.add(bolt, hw(c, 'black'));
    }
  }
  const axle = new THREE.CylinderGeometry(0.016 * s, 0.016 * s, (railX + railT) * 2 + 0.06 * s, 16).rotateZ(Math.PI / 2);
  axle.translate(0.02 * s, yc, zc);
  st.add(axle, hw(c, 'steel'));
  // Motor on the deck beside the slot.
  const mR = 0.045 * s;
  const mz = -L / 2 + 0.25 * s;
  const my = H + mR + 0.004 * s;
  const motor = new THREE.CylinderGeometry(mR, mR, 0.14 * s, 20).rotateZ(Math.PI / 2);
  motor.translate(pulleyX + 0.085 * s, my, mz);
  st.add(motor, hw(c, 'motorCan'));
  const bell = new THREE.CylinderGeometry(mR * 0.9, mR * 0.9, 0.025 * s, 20).rotateZ(Math.PI / 2);
  bell.translate(pulleyX + 0.165 * s, my, mz);
  st.add(bell, hw(c, 'black'));
  const mpul = new THREE.CylinderGeometry(0.022 * s, 0.022 * s, 0.03 * s, 16).rotateZ(Math.PI / 2);
  mpul.translate(pulleyX, my, mz);
  st.add(mpul, hw(c, 'alu'));
  const bracket = bevelBox(0.16 * s, 0.012 * s, 0.1 * s);
  bracket.translate(pulleyX + 0.07 * s, H + 0.006 * s, mz);
  st.add(bracket, hw(c, 'frame'));
  // Belt: two straight runs between the pulleys.
  const a = new THREE.Vector2(zc, yc);
  const b = new THREE.Vector2(mz, my);
  const d = b.clone().sub(a).normalize();
  const n = new THREE.Vector2(-d.y, d.x);
  for (const sg of [-1, 1]) {
    const p0 = new THREE.Vector3(pulleyX, a.y + n.y * pulleyR * sg, a.x + n.x * pulleyR * sg);
    const p1 = new THREE.Vector3(pulleyX, b.y + n.y * 0.022 * s * sg, b.x + n.x * 0.022 * s * sg);
    st.add(new THREE.BoxGeometry(1, 1, 1), hw(c, 'belt'), segmentBox(p0, p1, 0.026 * s, 0.006 * s));
  }
  const stat = new THREE.Group();
  st.build(stat);
  p.group.add(stat);

  const cut = sampleCylinderX(v3(w.center), R + w.toothHeight + 0.012 * s, railX + railT / 2 + 0.004 * s, 0.012 * s);
  return {
    group: p.group,
    cutters: [cut],
    update(f, health, dt) {
      clock += dt;
      animateSpinner(p, w, f, health, clock);
    },
    dispose() {
      for (const m of [...p.blurMats, ...p.glintMats]) m.dispose();
    },
  };
}
/** Box geometry (unit) placed between two points with a width (x) and thickness. */
function segmentBox(a: THREE.Vector3, b: THREE.Vector3, width: number, thick: number): THREE.Matrix4 {
  const len = a.distanceTo(b);
  const dir = b.clone().sub(a).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  const mid = a.clone().add(b).multiplyScalar(0.5);
  return new THREE.Matrix4().compose(mid, q, new THREE.Vector3(width, thick, len));
}

function buildDrum(c: RigCtx, w: SpinnerSpec): WeaponRig {
  let clock = 0;
  const s = c.spec.scale;
  const L = c.spec.length;
  const p = spinnerShell(w);
  const R = w.radius;
  const wd = w.width;
  const rb = new GeoBucket();
  const body = new THREE.CylinderGeometry(R, R, wd, 40, 1).rotateZ(Math.PI / 2);
  rb.add(body, hw(c, 'disk'));
  for (const sx of [-1, 1]) {
    const cap = new THREE.CylinderGeometry(R * 1.04, R * 1.04, 0.012 * s, 40).rotateZ(Math.PI / 2);
    cap.translate(sx * (wd / 2 - 0.006 * s), 0, 0);
    rb.add(cap, hw(c, 'steel'));
    boltCircle(rb, hw(c, 'black'), 8, R * 0.75, 0.006 * s, 0.01 * s, (m) => new THREE.Matrix4().makeTranslation(sx * (wd / 2 + 0.002 * s), 0, 0).multiply(m));
  }
  // Weld seam rings and flats on the drum body.
  for (let i = 0; i < 4; i++) {
    const flat = new THREE.BoxGeometry(wd * 0.9, 0.004 * s, R * 0.5);
    flat.translate(0, R + 0.001 * s, 0);
    flat.rotateX((i / 4) * Math.PI * 2 + Math.PI / 4);
    rb.add(flat, hw(c, 'steel'));
  }
  const bodyGroup = new THREE.Group();
  rb.build(bodyGroup);
  p.rotor.add(bodyGroup);
  // Teeth: hooked blocks bolted to the drum, offset along the axis.
  const tb = new GeoBucket();
  for (let k = 0; k < w.teeth; k++) {
    const sh = new THREE.Shape();
    const h = w.toothHeight;
    // Hooked face toward the direction of travel (shape -x is robot +z at the top).
    sh.moveTo(0.05 * s, R - 0.01 * s);
    sh.lineTo(-0.03 * s, R - 0.01 * s);
    sh.lineTo(-0.03 * s, R + h);
    sh.lineTo(-0.005 * s, R + h);
    sh.lineTo(0.05 * s, R + h * 0.2);
    sh.closePath();
    const tw = wd * 0.36;
    const g = new THREE.ExtrudeGeometry(sh, { depth: tw, bevelEnabled: true, bevelSize: 0.002 * s, bevelThickness: 0.002 * s, bevelSegments: 1 });
    g.translate(0, 0, -tw / 2);
    // Shape x is tangential, y radial; extrude along drum axis.
    g.rotateY(Math.PI / 2);
    g.translate((k % 2 === 0 ? -1 : 1) * wd * 0.22, 0, 0);
    g.rotateX((k / w.teeth) * Math.PI * 2);
    tb.add(g, hw(c, 'steel'));
  }
  const teeth = new THREE.Group();
  tb.build(teeth);
  p.rotor.add(teeth);
  p.slow.push(teeth);
  addBlur(c, p, new THREE.CylinderGeometry(R + w.toothHeight * 0.85, R + w.toothHeight * 0.85, wd * 0.8, 48, 1, true).rotateZ(Math.PI / 2), 0.6);
  // Side arms, bearings, pulley and belt into the hull.
  const st = new GeoBucket();
  const armT = 0.02 * s;
  const armX = wd / 2 + 0.014 * s + armT / 2;
  const zBack = -L / 2 + 0.16 * s;
  for (const sx of [-1, 1]) {
    const arm = railPlate(zBack, w.center.z, w.center.y, R * 0.62, armT);
    arm.translate(sx * armX, 0, 0);
    st.add(arm, hw(c, 'frame'));
    const blk = bevelBox(0.03 * s, 0.085 * s, 0.07 * s);
    blk.translate(sx * (armX + armT / 2 + 0.015 * s), w.center.y, w.center.z);
    st.add(blk, hw(c, 'aluCast'));
  }
  const axle = new THREE.CylinderGeometry(0.018 * s, 0.018 * s, armX * 2 + 0.07 * s, 16).rotateZ(Math.PI / 2);
  axle.translate(0, w.center.y, w.center.z);
  st.add(axle, hw(c, 'steel'));
  const pulX = -(armX + armT / 2 + 0.045 * s);
  const pul = swatchMesh(new THREE.CylinderGeometry(0.04 * s, 0.04 * s, 0.025 * s, 20).rotateZ(Math.PI / 2), hw(c, 'alu'));
  pul.position.x = pulX;
  p.rotor.add(pul);
  for (const sg of [-1, 1]) {
    const p0 = new THREE.Vector3(pulX, w.center.y + sg * 0.04 * s, w.center.z);
    const p1 = new THREE.Vector3(pulX, w.center.y + sg * 0.025 * s + 0.02 * s, -L / 2 + 0.12 * s);
    st.add(new THREE.BoxGeometry(1, 1, 1), hw(c, 'belt'), segmentBox(p0, p1, 0.022 * s, 0.006 * s));
  }
  const stat = new THREE.Group();
  st.build(stat);
  p.group.add(stat);
  const cut = sampleCylinderX(v3(w.center), R + w.toothHeight + 0.012 * s, armX + armT / 2 + 0.004 * s, 0.012 * s);
  return {
    group: p.group,
    cutters: [cut],
    update(f, health, dt) {
      clock += dt;
      animateSpinner(p, w, f, health, clock);
    },
    dispose() {
      for (const m of [...p.blurMats, ...p.glintMats]) m.dispose();
    },
  };
}

function buildHBar(c: RigCtx, w: SpinnerSpec): WeaponRig {
  let clock = 0;
  const s = c.spec.scale;
  const p = spinnerShell(w);
  const R = w.radius;
  const ch = w.chord;
  const bh = w.width;
  const H = w.center.y - 0.04 * s;
  const bar = new GeoBucket();
  // Main bar: tapered toward the tips, with impactor blocks at both ends.
  const bodyLen = (R - 0.07 * s) * 2;
  const bg = new THREE.BoxGeometry(bodyLen, bh, ch, 8, 1, 1);
  const pa = bg.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i);
    const k = 1 - 0.35 * Math.min(1, Math.abs(x) / (bodyLen / 2));
    pa.setZ(i, pa.getZ(i) * k);
  }
  bg.computeVertexNormals();
  bar.add(bg, hw(c, 'disk'));
  for (const sx of [-1, 1]) {
    // Impactor: a hardened block with an angled striking face.
    const sh = new THREE.Shape();
    const len = 0.08 * s;
    const wdt = ch * 0.8;
    sh.moveTo(0, -wdt / 2);
    sh.lineTo(len, -wdt / 2 - w.toothHeight * 0.4);
    sh.lineTo(len + w.toothHeight * 0.3, 0);
    sh.lineTo(len, wdt / 2);
    sh.lineTo(0, wdt / 2);
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: bh * 1.25, bevelEnabled: true, bevelSize: 0.002 * s, bevelThickness: 0.002 * s, bevelSegments: 1 });
    g.translate(0, 0, -bh * 0.625);
    g.rotateX(-Math.PI / 2);
    if (sx < 0) g.rotateY(Math.PI);
    g.translate(sx * (bodyLen / 2 - 0.01 * s), 0, 0);
    bar.add(g, hw(c, 'steel'));
    for (const bz of [-1, 1]) {
      const bolt = new THREE.CylinderGeometry(0.006 * s, 0.006 * s, bh * 1.4, 6);
      bolt.translate(sx * (bodyLen / 2 + 0.03 * s), 0, bz * ch * 0.22);
      bar.add(bolt, hw(c, 'black'));
    }
  }
  const barGroup = new THREE.Group();
  bar.build(barGroup);
  p.rotor.add(barGroup);
  p.slow.push(barGroup);
  // Hub stays visible.
  const hub = new GeoBucket();
  const hubR = 0.075 * s;
  hub.add(new THREE.CylinderGeometry(hubR, hubR, bh * 1.5, 24), hw(c, 'steel'));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const bolt = new THREE.CylinderGeometry(0.007 * s, 0.007 * s, bh * 1.7, 6);
    bolt.translate(Math.cos(a) * hubR * 0.65, 0, Math.sin(a) * hubR * 0.65);
    hub.add(bolt, hw(c, 'black'));
  }
  const hubGroup = new THREE.Group();
  hub.build(hubGroup);
  p.rotor.add(hubGroup);
  addBlur(c, p, polarRing(hubR, R + w.toothHeight * 0.3, 72).rotateX(-Math.PI / 2), 0.5);
  // Bearing tower on the deck.
  const st = new GeoBucket();
  const tower = new THREE.CylinderGeometry(0.03 * s, 0.03 * s, w.center.y - H, 16);
  tower.translate(w.center.x, H + (w.center.y - H) / 2, w.center.z);
  st.add(tower, hw(c, 'steel'));
  const flange = new THREE.CylinderGeometry(0.075 * s, 0.08 * s, 0.012 * s, 24);
  flange.translate(w.center.x, H + 0.006 * s, w.center.z);
  st.add(flange, hw(c, 'aluCast'));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const bolt = new THREE.CylinderGeometry(0.006 * s, 0.006 * s, 0.02 * s, 6);
    bolt.translate(w.center.x + Math.cos(a) * 0.06 * s, H + 0.01 * s, w.center.z + Math.sin(a) * 0.06 * s);
    st.add(bolt, hw(c, 'black'));
  }
  const stat = new THREE.Group();
  st.build(stat);
  p.group.add(stat);
  return {
    group: p.group,
    cutters: [],
    update(f, health, dt) {
      clock += dt;
      animateSpinner(p, w, f, health, clock);
    },
    dispose() {
      for (const m of [...p.blurMats, ...p.glintMats]) m.dispose();
    },
  };
}

function buildShell(c: RigCtx, w: SpinnerSpec): WeaponRig {
  let clock = 0;
  const s = c.spec.scale;
  const p = spinnerShell(w);
  const R = w.radius;
  const top = c.spec.panels.find((x) => x.facet === 'top')!;
  const H = top.center.y + top.t / 2;
  const capR = top.w / 2;
  const y0 = -w.width / 2;
  const y1 = w.width / 2;
  const yTop = H - w.center.y - top.t * 0.6;
  // Profile (radius, y) relative to the rotor center, from the bottom lip up over the roof.
  const prof: [number, number][] = [
    [R * 0.9, y0 + 0.004 * s],
    [R * 0.97, y0],
    [R, y0 + 0.02 * s],
    [R, y1 - 0.025 * s],
    [R * 0.985, y1 - 0.006 * s],
    [R * 0.95, y1 + 0.004 * s],
  ];
  const roofSteps = 6;
  for (let i = 1; i <= roofSteps; i++) {
    const k = i / roofSteps;
    const r = R * 0.95 + (capR + 0.01 * s - R * 0.95) * k;
    const y = y1 + 0.004 * s + (yTop - y1 - 0.004 * s) * Math.sin((k * Math.PI) / 2);
    prof.push([r, y]);
  }
  // Arc length along the profile for v.
  const lens = [0];
  for (let i = 1; i < prof.length; i++) lens.push(lens[i - 1] + Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]));
  const total = lens[lens.length - 1];
  const segs = c.q === 'low' ? 48 : 96;
  const cellW = Math.PI * 2 * R;
  const pos: number[] = [];
  const uv: number[] = [];
  const puv: number[] = [];
  const idx: number[] = [];
  const tmp: [number, number] = [0, 0];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    for (let j = 0; j < prof.length; j++) {
      const [r, y] = prof[j];
      pos.push(Math.cos(a) * r, y, -Math.sin(a) * r);
      c.atlas.uv('shell', (i / segs - 0.5) * cellW, total / 2 - lens[j], tmp);
      uv.push(tmp[0], tmp[1]);
      puv.push(0.5, 1 - lens[j] / total);
    }
  }
  const P = prof.length;
  for (let i = 0; i < segs; i++)
    for (let j = 0; j < P - 1; j++) {
      const a = i * P + j;
      const b = (i + 1) * P + j;
      idx.push(a, b + 1, a + 1, a, b, b + 1);
    }
  const geo = new THREE.BufferGeometry();
  const posArr = new Float32Array(pos);
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const shellMesh = new THREE.Mesh(geo, c.armor);
  shellMesh.castShadow = shellMesh.receiveShadow = true;
  p.rotor.add(shellMesh);
  p.slow.push(shellMesh);
  // Blurred stand-in: the same shell sampling a row-averaged copy of its paint.
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute('position', geo.attributes.position);
  pgeo.setAttribute('normal', geo.attributes.normal);
  pgeo.setAttribute('uv', new THREE.Float32BufferAttribute(puv, 2));
  pgeo.setIndex(idx);
  const blurTex = rowAverage(c.atlas, 'shell');
  const pm = (c.armor as THREE.MeshStandardMaterial).clone();
  pm.map = blurTex;
  pm.roughnessMap = null;
  pm.metalnessMap = null;
  pm.bumpMap = null;
  pm.roughness = c.spec.loadout.paint.finish === 'matte' ? 0.7 : 0.35;
  pm.metalness = c.spec.loadout.paint.finish === 'metal' || c.spec.loadout.paint.finish === 'raw' ? 0.8 : 0.1;
  const proxy = new THREE.Mesh(pgeo, pm);
  proxy.visible = false;
  proxy.castShadow = true;
  p.rotor.add(proxy);
  p.fast.push(proxy);
  // Teeth on the rim and welded ribs.
  const tb = new GeoBucket();
  for (let k = 0; k < w.teeth; k++) {
    const a = (k / w.teeth) * Math.PI * 2;
    const th = w.toothHeight;
    const sh = new THREE.Shape();
    sh.moveTo(-0.06 * s, 0);
    sh.lineTo(0.03 * s, 0);
    sh.lineTo(0.03 * s, th + 0.006 * s);
    sh.lineTo(-0.01 * s, th + 0.006 * s);
    sh.closePath();
    const hgt = w.width * 0.7;
    const g = new THREE.ExtrudeGeometry(sh, { depth: hgt, bevelEnabled: true, bevelSize: 0.002 * s, bevelThickness: 0.002 * s, bevelSegments: 1 });
    g.translate(0, 0, -hgt / 2);
    // Shape x tangential, y radial outward, z up.
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, -R + 0.004 * s);
    g.rotateY(a);
    tb.add(g, hw(c, 'steel'));
  }
  const teeth = new THREE.Group();
  tb.build(teeth);
  p.rotor.add(teeth);
  p.slow.push(teeth);
  const ribs = new GeoBucket();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const g = new THREE.BoxGeometry(0.012 * s, w.width * 0.82, 0.008 * s);
    g.translate(0, 0, -R - 0.003 * s);
    g.rotateY(a);
    ribs.add(g, hw(c, 'weld'));
  }
  const ribG = new THREE.Group();
  ribs.build(ribG);
  p.rotor.add(ribG);
  p.slow.push(ribG);
  addBlur(c, p, new THREE.CylinderGeometry(R + w.toothHeight * 0.6, R + w.toothHeight * 0.6, w.width * 0.7, 64, 1, true), 0.5);
  return {
    group: p.group,
    cutters: [],
    shell: { mesh: shellMesh, base: posArr.slice(), proxy },
    update(f, health, dt) {
      clock += dt;
      animateSpinner(p, w, f, health, clock);
    },
    dispose() {
      for (const m of [...p.blurMats, ...p.glintMats]) m.dispose();
      pm.dispose();
      blurTex.dispose();
    },
  };
}

/** A 4 x N texture holding each row of a cell averaged across its width. */
function rowAverage(atlas: PaintAtlas, id: string): THREE.CanvasTexture {
  const cell = atlas.cells.get(id)!;
  const ctx = atlas.color.getContext('2d')!;
  const img = ctx.getImageData(cell.x, cell.y, cell.pw, cell.ph);
  const out = document.createElement('canvas');
  out.width = 4;
  out.height = cell.ph;
  const o = out.getContext('2d')!;
  const row = o.createImageData(4, cell.ph);
  for (let y = 0; y < cell.ph; y++) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let x = 0; x < cell.pw; x++) {
      const i = (y * cell.pw + x) * 4;
      // Average in linear-ish space.
      r += img.data[i] ** 2;
      g += img.data[i + 1] ** 2;
      b += img.data[i + 2] ** 2;
    }
    for (let x = 0; x < 4; x++) {
      const i = (y * 4 + x) * 4;
      row.data[i] = Math.sqrt(r / cell.pw);
      row.data[i + 1] = Math.sqrt(g / cell.pw);
      row.data[i + 2] = Math.sqrt(b / cell.pw);
      row.data[i + 3] = 255;
    }
  }
  o.putImageData(row, 0, 0);
  const tex = new THREE.CanvasTexture(out);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ------------------------------------------------------------------------------------ arms

/** A pneumatic ram (barrel and rod) between a fixed mount and a point that moves with an arm. */
class Ram {
  barrel: THREE.Mesh;
  rod: THREE.Mesh;
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  constructor(
    c: RigCtx,
    parent: THREE.Object3D,
    private mount: THREE.Vector3,
    private attachLocal: THREE.Vector3,
    private pivot: THREE.Object3D,
    private barrelLen: number,
    radius: number,
  ) {
    this.barrel = swatchMesh(new THREE.CylinderGeometry(radius, radius, 1, 16), hardware('co2', c.env, c.q));
    this.rod = swatchMesh(new THREE.CylinderGeometry(radius * 0.4, radius * 0.4, 1, 10), hardware('chrome', c.env, c.q));
    this.barrel.castShadow = this.rod.castShadow = true;
    parent.add(this.barrel, this.rod);
  }
  update(): void {
    // Pivot matrices are relative to the rig group, which shares the robot frame.
    this.pivot.updateMatrix();
    this.a.copy(this.mount);
    this.b.copy(this.attachLocal).applyMatrix4(this.pivot.matrix);
    const len = this.a.distanceTo(this.b);
    const bl = Math.min(this.barrelLen, len * 0.92);
    const dir = this.b.clone().sub(this.a).normalize();
    const mid = this.a.clone().addScaledVector(dir, bl);
    const m1 = segmentMatrix(this.a, mid);
    m1.decompose(this.barrel.position, this.barrel.quaternion, this.barrel.scale);
    const m2 = segmentMatrix(mid.clone().addScaledVector(dir, -0.01), this.b);
    m2.decompose(this.rod.position, this.rod.quaternion, this.rod.scale);
  }
}

/** CO2 bottle lying on the deck with straps, a brass valve and a hose into the hull. */
function co2Tank(c: RigCtx, b: GeoBucket, center: THREE.Vector3, len: number, r: number, alongZ: boolean): void {
  const s = c.spec.scale;
  const rot = alongZ ? new THREE.Euler(Math.PI / 2, 0, 0) : new THREE.Euler(0, 0, Math.PI / 2);
  const body = new THREE.CapsuleGeometry(r, len - 2 * r, 6, 20);
  b.place(body, hw(c, 'co2'), center, rot);
  const band = new THREE.CylinderGeometry(r * 1.01, r * 1.01, len * 0.3, 20, 1, true);
  b.place(band, hw(c, 'red'), center, rot);
  for (const k of [-0.3, 0.3]) {
    const strap = new THREE.TorusGeometry(r * 1.03, 0.004 * s, 4, 20);
    const off = alongZ ? new THREE.Vector3(0, 0, k * len) : new THREE.Vector3(k * len, 0, 0);
    b.place(strap, hw(c, 'black'), center.clone().add(off), alongZ ? new THREE.Euler(0, 0, 0) : new THREE.Euler(0, Math.PI / 2, 0));
  }
  const end = alongZ ? new THREE.Vector3(0, 0, -len / 2 - 0.015 * s) : new THREE.Vector3(len / 2 + 0.015 * s, 0, 0);
  const valve = bevelBox(0.035 * s, 0.035 * s, 0.035 * s);
  b.place(valve, hw(c, 'brass'), center.clone().add(end), new THREE.Euler());
  const gauge = new THREE.CylinderGeometry(0.014 * s, 0.014 * s, 0.01 * s, 16);
  b.place(gauge, hw(c, 'chrome'), center.clone().add(end).add(new THREE.Vector3(0, 0.024 * s, 0)), new THREE.Euler());
  const hoseStart = center.clone().add(end).add(new THREE.Vector3(0, -0.01 * s, 0));
  const curve = new THREE.CatmullRomCurve3([
    hoseStart,
    hoseStart.clone().add(new THREE.Vector3(alongZ ? 0.03 * s : 0.04 * s, -0.01 * s, alongZ ? -0.04 * s : 0.02 * s)),
    hoseStart.clone().add(new THREE.Vector3(alongZ ? 0.05 * s : 0.06 * s, -r - 0.02 * s, alongZ ? -0.05 * s : 0.04 * s)),
  ]);
  b.add(new THREE.TubeGeometry(curve, 10, 0.006 * s, 6), hw(c, 'black'));
}

function topHeight(spec: BotSpec): number {
  const top = spec.panels.find((x) => x.facet === 'top');
  return top ? top.center.y + top.t / 2 : spec.height;
}

function buildFlipper(c: RigCtx, w: ArmSpec): WeaponRig {
  const s = c.spec.scale;
  const L = c.spec.length;
  const H = topHeight(c.spec);
  const group = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.position.copy(v3(w.hinge));
  pivot.rotation.x = w.restAngle;
  group.add(pivot);
  // Skeleton under the skin: two arms, a cross tube at the tip, and the hinge tube.
  const sk = new GeoBucket();
  const armX = w.width / 2 - 0.05 * s;
  for (const sx of [-1, 1]) {
    const arm = new THREE.BoxGeometry(0.02 * s, 0.04 * s, w.length * 0.96);
    arm.translate(sx * armX, -0.03 * s, -w.length * 0.48);
    sk.add(arm, hw(c, 'frame'));
  }
  for (const k of [0.45, 0.9]) {
    const cross = new THREE.CylinderGeometry(0.013 * s, 0.013 * s, armX * 2, 12).rotateZ(Math.PI / 2);
    cross.translate(0, -0.03 * s, -w.length * k);
    sk.add(cross, hw(c, 'frame'));
  }
  const lip = new THREE.BoxGeometry(w.width, 0.006 * s, 0.05 * s);
  lip.translate(0, -0.012 * s, -w.length + 0.02 * s);
  sk.add(lip, hw(c, 'steel'));
  const hingeTube = new THREE.CylinderGeometry(0.018 * s, 0.018 * s, w.width * 0.9, 16).rotateZ(Math.PI / 2);
  sk.add(hingeTube, hw(c, 'steel'));
  sk.build(pivot);
  // Static: hinge blocks, tank on the deck.
  const st = new GeoBucket();
  for (const sx of [-1, 1]) {
    const blk = bevelBox(0.03 * s, 0.06 * s, 0.06 * s);
    blk.translate(sx * (w.width * 0.45 + 0.02 * s), w.hinge.y, w.hinge.z);
    st.add(blk, hw(c, 'aluCast'));
  }
  const tankLen = Math.min(0.34 * s, c.spec.width * 0.5);
  const tankR = 0.045 * s;
  co2Tank(c, st, new THREE.Vector3(-0.02 * s, H + tankR + 0.003 * s, L / 2 - 0.13 * s), tankLen, tankR, false);
  const stat = new THREE.Group();
  st.build(stat);
  group.add(stat);
  const ram = new Ram(c, group, new THREE.Vector3(0, 0.05 * s, w.hinge.z + 0.18 * s), new THREE.Vector3(0, -0.04 * s, -w.length * 0.42), pivot, 0.16 * s, 0.032 * s);
  ram.update();
  return {
    group,
    cutters: [],
    armPivot: pivot,
    armRest: w.restAngle,
    update(f) {
      pivot.rotation.x = f.angle;
      ram.update();
    },
    dispose() {},
  };
}

function buildAxe(c: RigCtx, w: ArmSpec): WeaponRig {
  const s = c.spec.scale;
  const L = c.spec.length;
  const H = topHeight(c.spec);
  const group = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.position.copy(v3(w.hinge));
  pivot.rotation.x = w.restAngle;
  group.add(pivot);
  const ab = new GeoBucket();
  // Box-tube arm with a lever stub behind the hinge.
  const arm = bevelBox(0.05 * s, 0.06 * s, w.length + 0.08 * s, 0.006 * s);
  arm.translate(0, 0, -w.length / 2 + 0.04 * s);
  ab.add(arm, hw(c, 'frame'));
  const head = w.head ?? v3({ x: 0.05 * s, y: 0.16 * s, z: 0.07 * s });
  const hb = bevelBox(head.x * 1.3, 0.075 * s, head.z * 1.2, 0.005 * s);
  hb.translate(0, 0, -w.length);
  ab.add(hb, hw(c, 'steel'));
  // Pick: a four-sided spike pointing down (arm-local -Y), slightly curved forward.
  const pick = new THREE.ConeGeometry(head.z * 0.42, head.y - 0.04 * s, 4, 1);
  pick.rotateY(Math.PI / 4);
  pick.rotateX(Math.PI);
  pick.translate(0, -0.035 * s - (head.y - 0.04 * s) / 2, -w.length);
  ab.add(pick, hw(c, 'chrome'));
  const back = new THREE.CylinderGeometry(0.03 * s, 0.034 * s, 0.035 * s, 12);
  back.translate(0, 0.05 * s, -w.length);
  ab.add(back, hw(c, 'steel'));
  for (const bz of [-1, 1]) {
    const bolt = new THREE.CylinderGeometry(0.006 * s, 0.006 * s, head.x * 1.5, 6).rotateZ(Math.PI / 2);
    bolt.translate(0, 0.015 * s, -w.length + bz * 0.02 * s);
    ab.add(bolt, hw(c, 'black'));
  }
  const axle = new THREE.CylinderGeometry(0.016 * s, 0.016 * s, 0.14 * s, 12).rotateZ(Math.PI / 2);
  ab.add(axle, hw(c, 'steel'));
  ab.build(pivot);
  const st = new GeoBucket();
  // Uprights holding the axle.
  for (const sx of [-1, 1]) {
    const sh = new THREE.Shape();
    sh.moveTo(-0.11 * s, 0);
    sh.lineTo(0.11 * s, 0);
    sh.lineTo(0.03 * s, w.hinge.y - H + 0.035 * s);
    sh.lineTo(-0.03 * s, w.hinge.y - H + 0.035 * s);
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.014 * s, bevelEnabled: false });
    g.rotateY(Math.PI / 2);
    g.translate(sx * 0.045 * s - 0.007 * s, H, w.hinge.z);
    st.add(g, hw(c, 'frame'));
  }
  const tankR = 0.042 * s;
  co2Tank(c, st, new THREE.Vector3(c.spec.width / 2 - 0.12 * s, H + tankR + 0.003 * s, -L * 0.12), Math.min(0.3 * s, L * 0.35), tankR, true);
  const stat = new THREE.Group();
  st.build(stat);
  group.add(stat);
  const ram = new Ram(c, group, new THREE.Vector3(0, H + 0.03 * s, w.hinge.z - 0.22 * s), new THREE.Vector3(0, -0.05 * s, -0.12 * s), pivot, 0.12 * s, 0.026 * s);
  ram.update();
  return {
    group,
    cutters: [],
    update(f) {
      pivot.rotation.x = f.angle;
      ram.update();
    },
    dispose() {},
  };
}

function buildLifter(c: RigCtx, w: ArmSpec): WeaponRig {
  const s = c.spec.scale;
  const group = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.position.copy(v3(w.hinge));
  pivot.rotation.x = w.restAngle;
  group.add(pivot);
  const fb = new GeoBucket();
  const tineX = w.width / 2 - 0.03 * s;
  const tineW = 0.045 * s;
  const tineT = 0.022 * s;
  for (const sx of [-1, 1]) {
    // Tine: thick at the root, tapering to a sharp scoop at the tip.
    const g = new THREE.BoxGeometry(tineW, tineT, w.length, 1, 1, 6);
    const pa = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) {
      const z = pa.getZ(i); // -L/2 tip side after translate below
      const k = (z + w.length / 2) / w.length; // 0 tip .. 1 root
      const y = pa.getY(i);
      if (y > 0) pa.setY(i, y * (0.25 + 0.75 * Math.min(1, k * 1.6)));
    }
    g.computeVertexNormals();
    g.translate(sx * tineX, 0, -w.length / 2);
    fb.add(g, hw(c, 'tine'));
    const gus = new THREE.BoxGeometry(0.012 * s, 0.05 * s, 0.1 * s);
    gus.translate(sx * tineX, 0.025 * s, -0.06 * s);
    fb.add(gus, hw(c, 'frame'));
  }
  const cross = new THREE.CylinderGeometry(0.022 * s, 0.022 * s, tineX * 2 + tineW, 16).rotateZ(Math.PI / 2);
  fb.add(cross, hw(c, 'frame'));
  const backbar = new THREE.BoxGeometry(tineX * 2, 0.03 * s, 0.025 * s);
  backbar.translate(0, 0.01 * s, -0.11 * s);
  fb.add(backbar, hw(c, 'frame'));
  const spr = new THREE.CylinderGeometry(0.06 * s, 0.06 * s, 0.01 * s, 24).rotateZ(Math.PI / 2);
  spr.translate(-tineX + 0.05 * s, 0, 0);
  fb.add(spr, hw(c, 'blued'));
  fb.build(pivot);
  // Gearmotor on the hinge axle.
  const st = new GeoBucket();
  const gm = bevelBox(0.07 * s, 0.09 * s, 0.09 * s);
  gm.translate(-tineX + 0.05 * s, w.hinge.y, w.hinge.z + 0.08 * s);
  st.add(gm, hw(c, 'aluCast'));
  const can = new THREE.CylinderGeometry(0.04 * s, 0.04 * s, 0.13 * s, 18);
  can.rotateX(Math.PI / 2);
  can.translate(-tineX + 0.05 * s, w.hinge.y, w.hinge.z + 0.19 * s);
  st.add(can, hw(c, 'motorCan'));
  const stat = new THREE.Group();
  st.build(stat);
  group.add(stat);
  // Cutters: each tine swept from rest to full lift.
  const cutters: THREE.Vector3[][] = [];
  const m = new THREE.Matrix4();
  for (const sx of [-1, 1]) {
    const pts: THREE.Vector3[] = [];
    for (let a = w.restAngle; a <= w.maxAngle + 1e-6; a += 0.05) {
      m.makeRotationX(a).setPosition(v3(w.hinge));
      for (let d = 0; d <= w.length; d += 0.01 * s)
        for (const ox of [-tineW / 2 - 0.006 * s, 0, tineW / 2 + 0.006 * s])
          for (const oy of [-tineT, tineT]) pts.push(new THREE.Vector3(sx * tineX + ox, oy, -d).applyMatrix4(m));
    }
    cutters.push(pts);
  }
  return {
    group,
    cutters,
    update(f) {
      pivot.rotation.x = f.angle;
    },
    dispose() {},
  };
}

// ------------------------------------------------------------------------------------ srimech

export function buildSrimech(c: RigCtx): { group: THREE.Group; update(inverted: boolean, dt: number): void } {
  const s = c.spec.scale;
  const H = topHeight(c.spec);
  const L = c.spec.length;
  const group = new THREE.Group();
  const hingeZ = L / 2 - 0.08 * s;
  const pivot = new THREE.Group();
  pivot.position.set(0, H + 0.02 * s, hingeZ);
  group.add(pivot);
  const len = Math.min(0.42 * s, L * 0.5);
  const b = new GeoBucket();
  const arm = bevelBox(0.07 * s, 0.014 * s, len, 0.004 * s);
  arm.translate(0, 0, -len / 2);
  b.add(arm, hw(c, 'steel'));
  const pad = new THREE.CylinderGeometry(0.035 * s, 0.035 * s, 0.016 * s, 16);
  pad.translate(0, 0.008 * s, -len + 0.03 * s);
  b.add(pad, hw(c, 'uhmwBlack'));
  const ax = new THREE.CylinderGeometry(0.012 * s, 0.012 * s, 0.11 * s, 12).rotateZ(Math.PI / 2);
  b.add(ax, hw(c, 'steel'));
  b.build(pivot);
  const st = new GeoBucket();
  for (const sx of [-1, 1]) {
    const blk = bevelBox(0.016 * s, 0.035 * s, 0.05 * s);
    blk.translate(sx * 0.05 * s, H + 0.017 * s, hingeZ);
    st.add(blk, hw(c, 'aluCast'));
  }
  st.build(group);
  const ram = new Ram(c, group, new THREE.Vector3(0, H + 0.012 * s, hingeZ - len * 0.75), new THREE.Vector3(0, -0.008 * s, -len * 0.45), pivot, 0.1 * s, 0.016 * s);
  ram.update();
  let ext = 0;
  return {
    group,
    update(inverted, dt) {
      const target = inverted ? 1 : 0;
      ext += (target - ext) * Math.min(1, dt * (inverted ? 6 : 3));
      // Positive angle about +X pitches the free end (toward -Z) up.
      pivot.rotation.x = ext * 1.3;
      ram.update();
    },
  };
}

// ------------------------------------------------------------------------------------ entry

export function buildWeapon(c: RigCtx): WeaponRig | null {
  const w = c.spec.weapon;
  switch (w.kind) {
    case 'vdisk':
      return buildVDisk(c, w);
    case 'drum':
      return buildDrum(c, w);
    case 'hbar':
      return buildHBar(c, w);
    case 'shell':
      return buildShell(c, w);
    case 'flipper':
      return buildFlipper(c, w);
    case 'axe':
      return buildAxe(c, w);
    case 'lifter':
      return buildLifter(c, w);
    default:
      return null;
  }
}
