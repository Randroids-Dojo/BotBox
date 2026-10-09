// Hazards, animated only from WorldFrame.hazards: the Pulverizers, the Killsaws, the Ramrods
// (the spikestrips are static and live in structure.ts), their warning beacons and the light
// tree.
//
// Pulverizer pose (shared with the sim): the arm swings in the vertical plane through `pivot`
// and the strike `center`. The head center sits `arm` meters from the pivot along the arm and
// the head cylinder's axis runs along the arm. State 1 points the arm at the strike center on
// the floor; state 0 is the raised pose, PULVERIZER_RAISED radians above horizontal, the head
// hanging over the strike zone just under the Lexan ceiling.

import * as THREE from 'three';
import type { HazardFrame } from '../../contract';
import { ARENA_HALF, KICK_WALL_H, KILLSAWS, LIGHT_TREE, PULVERIZERS, RAMRODS, type KillsawSpec, type PulverizerSpec, type RamrodPatchSpec } from '../../data/arena';
import { GeoBatch, UP, v3, worldUv } from '../util/geom';
import { canvas, canvasTexture } from '../util/tex';
import type { ArenaMaterials } from './materials';

export const PULVERIZER_RAISED = 0.55;

interface HazardView {
  update(h: HazardFrame, dt: number, time: number): void;
}

export interface Hazards {
  root: THREE.Group;
  update(hazards: HazardFrame[], dt: number, time: number): void;
  setLights(lights: number, time: number): void;
}

// ------------------------------------------------------------------ beacons

class Beacons {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private col = new THREE.Color();
  constructor(max: number) {
    const g = new THREE.SphereGeometry(0.07, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(1, 1.4, 1);
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshBasicMaterial({ color: '#fff' }), max);
    this.mesh.count = 0;
  }
  add(pos: THREE.Vector3): number {
    const m = new THREE.Matrix4().makeTranslation(pos.x, pos.y, pos.z);
    this.mesh.setMatrixAt(this.n, m);
    this.mesh.setColorAt(this.n, this.col.setRGB(0.1, 0.02, 0));
    this.mesh.count = ++this.n;
    this.mesh.computeBoundingSphere();
    return this.n - 1;
  }
  set(i: number, warn: boolean, active: boolean, time: number): void {
    let k = 0.08;
    if (active) k = 10;
    else if (warn) k = Math.sin(time * 30) > 0 ? 14 : 0.2;
    this.mesh.setColorAt(i, this.col.setRGB(1.0 * k, 0.32 * k, 0.04 * k));
    this.mesh.instanceColor!.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ pulverizer

class Pulverizer implements HazardView {
  readonly root = new THREE.Group();
  private arm = new THREE.Group();
  private d: THREE.Vector3;
  private axle: THREE.Vector3;
  private base = new THREE.Quaternion();
  private tmpQ = new THREE.Quaternion();
  private barrel: THREE.Mesh;
  private rod: THREE.Mesh;
  private anchor: THREE.Vector3;
  private armPoint = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private beaconIds: number[] = [];
  private struckAngle: number;
  private shake = 0;
  private lastState = 0;

  constructor(readonly spec: PulverizerSpec, mats: ArenaMaterials, private beacons: Beacons) {
    const P = v3(spec.pivot);
    const C = v3(spec.center);
    this.d = new THREE.Vector3(C.x - P.x, 0, C.z - P.z).normalize();
    this.axle = new THREE.Vector3().crossVectors(UP, this.d).normalize();
    const horiz = Math.hypot(C.x - P.x, C.z - P.z);
    this.struckAngle = Math.atan2(C.y - P.y, horiz);
    const basis = new THREE.Matrix4().makeBasis(this.axle, new THREE.Vector3().crossVectors(this.d, this.axle), this.d);
    this.base.setFromRotationMatrix(basis);

    // Gantry: two I-beam columns flanking the swing plane, behind the pivot toward the corner.
    const g = new GeoBatch();
    const back = P.clone().addScaledVector(this.d, -0.15);
    const colH = P.y + 0.55;
    for (const s of [-1, 1]) {
      const c = back.clone().addScaledVector(this.axle, s * 0.62);
      const ry = Math.atan2(this.axle.x, this.axle.z) + Math.PI / 2;
      // Heavy box section column with a gusseted base.
      g.add(new THREE.BoxGeometry(0.34, colH, 0.34), c.x, colH / 2, c.z, 0, ry, 0);
      g.add(new THREE.BoxGeometry(0.42, 0.06, 0.42), c.x, colH * 0.55, c.z, 0, ry, 0);
      for (const k of [-1, 1]) {
        const gx = c.x + this.d.x * k * 0.24;
        const gz = c.z + this.d.z * k * 0.24;
        g.add(new THREE.BoxGeometry(0.03, 0.5, 0.18), gx, 0.29, gz, 0, ry + Math.PI / 2, 0);
      }
      // Foot plate.
      g.add(new THREE.BoxGeometry(0.5, 0.04, 0.5), c.x, 0.02, c.z, 0, Math.atan2(this.d.x, this.d.z), 0);
      // Diagonal brace back to the corner.
      const foot = c.clone().addScaledVector(this.d, -0.9);
      foot.y = 0.05;
      g.beam(new THREE.Vector3(c.x, colH * 0.6, c.z), foot, 0.05, 8);
      // Pivot bearing blocks.
      const b = P.clone().addScaledVector(this.axle, s * 0.5);
      g.add(new THREE.BoxGeometry(0.2, 0.34, 0.34), b.x, b.y, b.z, 0, Math.atan2(this.d.x, this.d.z), 0);
    }
    // Header beam across the top.
    const top = back.clone();
    top.y = colH + 0.08;
    g.add(new THREE.BoxGeometry(1.5, 0.16, 0.28), top.x, top.y, top.z, 0, Math.atan2(this.d.x, this.d.z), 0);
    // Hazard striped collars on the columns.
    const collars = new GeoBatch();
    for (const s of [-1, 1]) {
      const c = back.clone().addScaledVector(this.axle, s * 0.62);
      for (const y of [0.35, 1.35]) collars.add(new THREE.BoxGeometry(0.37, 0.26, 0.37), c.x, y, c.z, 0, Math.atan2(this.axle.x, this.axle.z), 0);
    }
    const collarMesh = new THREE.Mesh(worldUv(collars.build(), 2.5), mats.hazard);
    collarMesh.castShadow = true;
    this.root.add(collarMesh);
    const gantry = new THREE.Mesh(worldUv(g.build(), 1.5), mats.paintRed);
    gantry.castShadow = true;
    gantry.receiveShadow = true;
    this.root.add(gantry);

    // Axle.
    const axleGeo = new THREE.CylinderGeometry(0.09, 0.09, 1.2, 16);
    const axleMesh = new THREE.Mesh(axleGeo, mats.hydraulic);
    axleMesh.position.copy(P);
    axleMesh.quaternion.setFromUnitVectors(UP, this.axle);
    this.root.add(axleMesh);

    // Arm and head (local +Z along the arm).
    const ab = new GeoBatch();
    ab.add(new THREE.BoxGeometry(0.2, 0.24, spec.arm - spec.headRadius * 0.4), 0, 0, (spec.arm - spec.headRadius * 0.4) / 2);
    // Side plates at the hub.
    ab.add(new THREE.CylinderGeometry(0.22, 0.22, 0.34, 20), 0, 0, 0, 0, 0, Math.PI / 2);
    // Gusset straps.
    ab.box(-0.11, -0.13, 0.2, 0.11, -0.11, spec.arm - 0.5);
    ab.box(-0.11, 0.11, 0.2, 0.11, 0.13, spec.arm - 0.5);
    const armMesh = new THREE.Mesh(worldUv(ab.build(), 2), mats.hazard);
    armMesh.castShadow = true;
    this.arm.add(armMesh);
    const hb = new GeoBatch();
    hb.add(new THREE.CylinderGeometry(spec.headRadius, spec.headRadius, spec.headLength, 28), 0, 0, spec.arm, Math.PI / 2, 0, 0);
    hb.add(new THREE.CylinderGeometry(spec.headRadius + 0.03, spec.headRadius + 0.03, 0.08, 28), 0, 0, spec.arm - spec.headLength * 0.3, Math.PI / 2, 0, 0);
    hb.add(new THREE.CylinderGeometry(spec.headRadius + 0.03, spec.headRadius + 0.03, 0.08, 28), 0, 0, spec.arm + spec.headLength * 0.3, Math.PI / 2, 0, 0);
    // Strike face, slightly crowned.
    hb.add(new THREE.CylinderGeometry(spec.headRadius * 0.92, spec.headRadius, 0.06, 28), 0, 0, spec.arm + spec.headLength / 2 + 0.03, Math.PI / 2, 0, 0);
    const head = new THREE.Mesh(hb.build(), mats.darkSteel);
    head.castShadow = true;
    this.arm.add(head);
    this.arm.position.copy(P);
    this.root.add(this.arm);

    // Pneumatic ram: from an anchor low behind the pivot to a lug on the arm.
    this.anchor = P.clone().addScaledVector(this.d, -0.55);
    this.anchor.y = 0.7;
    const barrelGeo = new THREE.CylinderGeometry(0.11, 0.11, 1.15, 18);
    barrelGeo.translate(0, 0.575, 0);
    this.barrel = new THREE.Mesh(barrelGeo, mats.blackPaint);
    this.barrel.castShadow = true;
    const rodGeo = new THREE.CylinderGeometry(0.045, 0.045, 1, 12);
    rodGeo.translate(0, 0.5, 0);
    this.rod = new THREE.Mesh(rodGeo, mats.hydraulic);
    this.root.add(this.barrel, this.rod);
    // Hydraulic hoses from the floor manifold to the barrel.
    const manifold = this.anchor.clone().addScaledVector(this.d, -0.35);
    manifold.y = 0.12;
    const hoses = new GeoBatch();
    for (const s of [-1, 1]) {
      const end = this.anchor.clone().addScaledVector(this.axle, s * 0.08);
      end.y += 0.3;
      const mid = manifold.clone().addScaledVector(this.axle, s * 0.35);
      mid.y = 0.25;
      const curve = new THREE.CatmullRomCurve3([manifold.clone().addScaledVector(this.axle, s * 0.12), mid, end]);
      hoses.add(new THREE.TubeGeometry(curve, 20, 0.025, 6, false));
    }
    hoses.box(manifold.x - 0.18, 0, manifold.z - 0.18, manifold.x + 0.18, 0.22, manifold.z + 0.18);
    const hoseMesh = new THREE.Mesh(hoses.build(), mats.rubber);
    this.root.add(hoseMesh);

    // Beacons on the header.
    for (const s of [-1, 1]) {
      const p = top.clone().addScaledVector(this.axle, s * 0.65);
      p.y += 0.08;
      this.beaconIds.push(beacons.add(p));
    }
    this.pose(0);
  }

  private pose(state: number): void {
    const a = PULVERIZER_RAISED + (this.struckAngle - PULVERIZER_RAISED) * state;
    // Rotate about local X by -a so local +Z tilts up by a.
    this.tmpQ.setFromAxisAngle(this.tmp.set(1, 0, 0), -a);
    this.arm.quaternion.copy(this.base).multiply(this.tmpQ);
    // Ram lug 0.95 m along the arm, slightly below it.
    this.armPoint.set(0, -0.15, 0.95).applyQuaternion(this.arm.quaternion).add(this.arm.position);
    const dir = this.tmp.subVectors(this.armPoint, this.anchor);
    const len = dir.length();
    dir.normalize();
    this.barrel.position.copy(this.anchor);
    this.barrel.quaternion.setFromUnitVectors(UP, dir);
    this.rod.position.copy(this.anchor).addScaledVector(dir, 0.9);
    this.rod.quaternion.copy(this.barrel.quaternion);
    this.rod.scale.set(1, Math.max(0.05, len - 0.9), 1);
  }

  update(h: HazardFrame, dt: number, time: number): void {
    if (h.state > 0.95 && this.lastState <= 0.95) this.shake = 1;
    this.lastState = h.state;
    this.shake = Math.max(0, this.shake - dt * 4);
    this.pose(h.state);
    // Rebound jitter on impact.
    if (this.shake > 0) this.arm.rotateX(Math.sin(time * 90) * 0.015 * this.shake);
    for (const id of this.beaconIds) this.beacons.set(id, h.warn, h.state > 0.02, time);
  }
}

// ------------------------------------------------------------------ killsaws

function sawBladeGeometry(r: number, teeth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const a1 = ((i + 0.62) / teeth) * Math.PI * 2;
    const a2 = ((i + 1) / teeth) * Math.PI * 2;
    const ri = r * 0.88;
    const p0 = [Math.cos(a0) * ri, Math.sin(a0) * ri];
    const p1 = [Math.cos(a1) * r, Math.sin(a1) * r];
    const p2 = [Math.cos(a1 + 0.02) * ri * 0.97, Math.sin(a1 + 0.02) * ri * 0.97];
    if (i === 0) shape.moveTo(p0[0], p0[1]);
    else shape.lineTo(p0[0], p0[1]);
    shape.lineTo(p1[0], p1[1]);
    shape.lineTo(p2[0], p2[1]);
    shape.lineTo(Math.cos(a2) * ri, Math.sin(a2) * ri);
  }
  // Expansion slots and arbor hole.
  const hole = new THREE.Path();
  hole.absarc(0, 0, r * 0.08, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1, curveSegments: 4 });
  geo.translate(0, 0, -0.006);
  // Disc lies in XY; the blade spins about Z. Turn it so it spins about world X.
  geo.rotateY(Math.PI / 2);
  // Hub flange.
  const hub = new THREE.CylinderGeometry(r * 0.22, r * 0.22, 0.05, 20);
  hub.rotateZ(Math.PI / 2);
  const b = new GeoBatch();
  b.add(geo);
  b.add(hub);
  return b.build();
}

const BLUR_FRAG = /* glsl */ `
uniform float uAmount;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float rim = smoothstep(0.7, 0.98, r) * (1.0 - smoothstep(0.98, 1.0, r));
  float body = smoothstep(0.2, 0.3, r) * 0.25;
  float a = (rim * 1.4 + body) * uAmount;
  gl_FragColor = vec4(vec3(0.75, 0.78, 0.82) * a, a * 0.5);
}`;

class Killsaw implements HazardView {
  readonly blade: THREE.Mesh;
  private blur: THREE.Mesh;
  private lastSpin = 0;
  private speed = 0;
  private blurUniform = { value: 0 };
  constructor(readonly spec: KillsawSpec, geo: THREE.BufferGeometry, mats: ArenaMaterials, parent: THREE.Object3D) {
    this.blade = new THREE.Mesh(geo, mats.brightSteel);
    this.blade.castShadow = true;
    this.blade.position.set(spec.center.x, -spec.bladeRadius - 0.05, spec.center.z);
    const blurGeo = new THREE.PlaneGeometry(spec.bladeRadius * 2.02, spec.bladeRadius * 2.02);
    blurGeo.rotateY(Math.PI / 2);
    this.blur = new THREE.Mesh(
      blurGeo,
      new THREE.ShaderMaterial({
        uniforms: { uAmount: this.blurUniform },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: BLUR_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      }),
    );
    this.blade.add(this.blur);
    parent.add(this.blade);
  }
  update(h: HazardFrame, dt: number): void {
    const s = this.spec;
    const hidden = -s.bladeRadius - 0.05;
    const up = s.rise - s.bladeRadius;
    this.blade.position.y = hidden + (up - hidden) * h.state;
    this.blade.rotation.x = -h.spin;
    if (dt > 0) {
      const w = Math.abs(h.spin - this.lastSpin) / dt;
      this.speed += (Math.min(w, 80) - this.speed) * Math.min(1, dt * 8);
    }
    this.lastSpin = h.spin;
    this.blurUniform.value = Math.min(1, this.speed / 30);
    this.blade.visible = h.state > 0.001 || this.blade.position.y > hidden;
  }
}

// ------------------------------------------------------------------ ramrods

class Ramrod implements HazardView {
  readonly mesh: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private last = -1;
  constructor(readonly spec: RamrodPatchSpec, mats: ArenaMaterials) {
    const b = new GeoBatch();
    b.add(new THREE.CylinderGeometry(spec.spikeRadius, spec.spikeRadius * 1.1, spec.rise * 0.7, 10), 0, -spec.rise * 0.35 - spec.rise * 0.3, 0);
    b.add(new THREE.ConeGeometry(spec.spikeRadius, spec.rise * 0.3, 10), 0, -spec.rise * 0.15, 0);
    const geo = b.build();
    this.mesh = new THREE.InstancedMesh(geo, mats.brightSteel, spec.cols * spec.rows);
    this.mesh.castShadow = true;
    this.set(0);
    this.mesh.computeBoundingSphere();
  }
  private set(state: number): void {
    const s = this.spec;
    let i = 0;
    for (let c = 0; c < s.cols; c++) {
      for (let r = 0; r < s.rows; r++) {
        const x = s.center.x - s.hx + ((c + 0.5) / s.cols) * s.hx * 2;
        const z = s.center.z - s.hz + ((r + 0.5) / s.rows) * s.hz * 2;
        this.m.makeTranslation(x, state * s.rise - 0.004, z);
        this.mesh.setMatrixAt(i++, this.m);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = state > 0.001;
  }
  update(h: HazardFrame): void {
    if (h.state !== this.last) {
      this.last = h.state;
      this.set(h.state);
    }
  }
}

// ------------------------------------------------------------------ light tree

class LightTree {
  readonly root = new THREE.Group();
  private lamps: THREE.MeshBasicMaterial[] = [];
  private glows: THREE.Sprite[] = [];
  private colors = [new THREE.Color(1, 0.06, 0.03), new THREE.Color(1, 0.06, 0.03), new THREE.Color(1, 0.06, 0.03), new THREE.Color(0.1, 1, 0.2)];
  private shown = -1;
  constructor(mats: ArenaMaterials) {
    const p = v3(LIGHT_TREE.pos);
    const b = new GeoBatch();
    // Housing and mount post down to the kick wall.
    b.box(-0.22, -0.78, -0.12, 0.22, 0.78, 0.08);
    b.box(-0.05, -p.y, -0.06, 0.05, -0.78, 0.04);
    const housing = new THREE.Mesh(b.build(), mats.blackPaint);
    housing.castShadow = true;
    this.root.add(housing);
    const visor = new GeoBatch();
    const lensGeo = new THREE.SphereGeometry(0.13, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    lensGeo.rotateX(Math.PI / 2);
    const glowTex = glowTexture();
    for (let i = 0; i < 4; i++) {
      const y = 0.57 - i * 0.38;
      visor.add(new THREE.CylinderGeometry(0.17, 0.17, 0.12, 20, 1, true, -Math.PI * 0.5, Math.PI), 0, y + 0.02, 0.12, Math.PI / 2, 0, 0);
      const mat = new THREE.MeshBasicMaterial({ color: this.colors[i].clone().multiplyScalar(0.05) });
      const lens = new THREE.Mesh(lensGeo, mat);
      lens.position.set(0, y, 0.08);
      this.root.add(lens);
      this.lamps.push(mat);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: this.colors[i], blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }));
      glow.scale.set(0.75, 0.75, 1);
      glow.position.set(0, y, 0.2);
      glow.visible = false;
      this.root.add(glow);
      this.glows.push(glow);
    }
    this.root.add(new THREE.Mesh(visor.build(), mats.blackPaint));
    this.root.position.copy(p);
  }
  set(lights: number): void {
    if (lights === this.shown) return;
    this.shown = lights;
    for (let i = 0; i < 4; i++) {
      const on = i < 3 ? lights >= i + 1 && lights < 4 : lights === 4;
      this.lamps[i].color.copy(this.colors[i]).multiplyScalar(on ? 12 : 0.05);
      this.glows[i].visible = on;
    }
  }
}

function glowTexture(): THREE.Texture {
  const { c, g } = canvas(128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return canvasTexture(c, { mips: false });
}

// ------------------------------------------------------------------ assembly

export function buildHazards(mats: ArenaMaterials): Hazards {
  const root = new THREE.Group();
  root.name = 'hazards';
  const beacons = new Beacons(32);
  const views = new Map<string, HazardView>();

  for (const p of PULVERIZERS) {
    const v = new Pulverizer(p, mats, beacons);
    root.add(v.root);
    views.set(p.id, v);
  }

  const bladeGeo = sawBladeGeometry(KILLSAWS[0].bladeRadius, 28);
  const frames = new GeoBatch();
  for (const s of KILLSAWS) {
    views.set(s.id, new Killsaw(s, bladeGeo, mats, root));
    // Slot frame: steel plate with the slot cut, flush mounted.
    const x = s.center.x;
    const z = s.center.z;
    const hw = 0.16;
    const hl = s.length / 2 + 0.12;
    const sw = s.width / 2 + 0.008;
    frames.box(x - hw, 0, z - hl, x - sw, 0.008, z + hl);
    frames.box(x + sw, 0, z - hl, x + hw, 0.008, z + hl);
    frames.box(x - sw, 0, z - hl, x + sw, 0.008, z - s.length / 2);
    frames.box(x - sw, 0, z + s.length / 2, x + sw, 0.008, z + hl);
  }
  // Strip warning beacons on the north and south kick wall caps.
  const stripBeacons = new Map<number, number[]>();
  for (const x of [...new Set(KILLSAWS.map((s) => s.center.x))]) {
    stripBeacons.set(x, [-1, 1].map((sz) => beacons.add(new THREE.Vector3(x, KICK_WALL_H + 0.05, sz * (ARENA_HALF + 0.15)))));
  }
  for (const r of RAMRODS) {
    const view = new Ramrod(r, mats);
    root.add(view.mesh);
    views.set(r.id, view);
    const x0 = r.center.x - r.hx - 0.1;
    const x1 = r.center.x + r.hx + 0.1;
    const z0 = r.center.z - r.hz - 0.1;
    const z1 = r.center.z + r.hz + 0.1;
    const t = 0.006;
    frames.box(x0, 0, z0, x1, t, z0 + 0.05);
    frames.box(x0, 0, z1 - 0.05, x1, t, z1);
    frames.box(x0, 0, z0, x0 + 0.05, t, z1);
    frames.box(x1 - 0.05, 0, z0, x1, t, z1);
  }
  const ramBeacons = new Map<string, number[]>();
  for (const r of RAMRODS) {
    const sz = Math.sign(r.center.z);
    ramBeacons.set(r.id, [-1, 1].map((sx) => beacons.add(new THREE.Vector3(r.center.x + sx * (r.hx + 0.3), KICK_WALL_H + 0.05, sz * (ARENA_HALF + 0.15)))));
  }
  const frameMesh = new THREE.Mesh(worldUv(frames.build(), 1), mats.darkSteel);
  frameMesh.receiveShadow = true;
  root.add(frameMesh);
  root.add(beacons.mesh);

  const tree = new LightTree(mats);
  root.add(tree.root);
  tree.set(0);

  // Per strip warn state, combined over its saws each frame.
  const stripWarn = new Map<number, { warn: boolean; active: boolean }>();
  const sawX = new Map(KILLSAWS.map((s) => [s.id, s.center.x]));

  return {
    root,
    update(hazards, dt, time) {
      for (const s of stripWarn.values()) {
        s.warn = false;
        s.active = false;
      }
      for (const h of hazards) {
        views.get(h.id)?.update(h, dt, time);
        if (h.kind === 'killsaw') {
          const x = sawX.get(h.id)!;
          let s = stripWarn.get(x);
          if (!s) stripWarn.set(x, (s = { warn: false, active: false }));
          s.warn ||= h.warn;
          s.active ||= h.state > 0.05;
        } else if (h.kind === 'ramrod') {
          for (const id of ramBeacons.get(h.id) ?? []) beacons.set(id, h.warn, h.state > 0.05, time);
        }
      }
      for (const [x, s] of stripWarn) for (const id of stripBeacons.get(x) ?? []) beacons.set(id, s.warn, s.active, time);
    },
    setLights(lights) {
      tree.set(lights);
    },
  };
}
