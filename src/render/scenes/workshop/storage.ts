// Tier 0: a rented storage unit in Oakland, at night. Corrugated steel, a roll-up door half
// open onto a sodium lit parking lot, one bare bulb swaying on its cord, a folding table, a
// camping lantern, an old CRT glowing on a milk crate, and what is left of Juggernaut in a
// pile on the floor.

import * as THREE from 'three';
import { Rng } from '../../util/rng';
import { canvas, canvasTexture, heightToNormal, noiseCanvas, roundRect } from '../../util/tex';
import { concreteTexture, PropBatch, roomShell, type GarageLights, type WorkshopKit, type WorkshopTier } from './common';

const X0 = -3.6;
const X1 = 2.6;
const Z0 = -3.2;
const Z1 = 3.6;
const H = 3.0;
const DOOR_X0 = -2.75;
const DOOR_X1 = -0.25;
/** Bottom edge of the half open door. */
const DOOR_GAP = 1.45;
const DOOR_TOP = 2.45;
const PIVOT = new THREE.Vector3(-0.45, H, -1.2);
const CORD = 1.55;
const _b = new THREE.Vector3();

export function buildStorageUnit(kit: WorkshopKit): WorkshopTier {
  const root = new THREE.Group();
  root.name = 'tier0:storage';
  const rng = new Rng(1201);

  // ---------------------------------------------------------------- shell
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(X1 - X0, Z1 - Z0),
    new THREE.MeshStandardMaterial({ map: concreteTexture(rng, '#4a4640', 22, 512), roughness: 0.86, metalness: 0.04 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
  floor.receiveShadow = true;
  floor.name = 'floor';
  root.add(floor);

  const ribs = corrugated(rng);
  const wallMat = new THREE.MeshStandardMaterial({ map: ribs.map, normalMap: ribs.normal, normalScale: new THREE.Vector2(1.6, 1.6), roughness: 0.55, metalness: 0.55 });
  root.add(roomShell(X0, X1, Z0, Z1, H, wallMat, 1 / 1.2, { back: false }));
  // Back wall around the door opening.
  const back = new PropBatchUv();
  back.quad(X0, DOOR_X0, 0, H, Z0);
  back.quad(DOOR_X1, X1, 0, H, Z0);
  back.quad(DOOR_X0, DOOR_X1, DOOR_TOP, H, Z0);
  const backMesh = new THREE.Mesh(back.build(1 / 1.2), wallMat);
  backMesh.receiveShadow = true;
  root.add(backMesh);

  // ---------------------------------------------------------------- roll-up door
  const doorMat = new THREE.MeshStandardMaterial({ map: doorTexture(rng), roughness: 0.65, metalness: 0.2, side: THREE.DoubleSide });
  const curtainH = DOOR_TOP - DOOR_GAP;
  const curtain = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_X1 - DOOR_X0, curtainH), doorMat);
  curtain.position.set((DOOR_X0 + DOOR_X1) / 2, DOOR_GAP + curtainH / 2, Z0 - 0.06);
  curtain.receiveShadow = true;
  curtain.name = 'curtain';
  root.add(curtain);
  const hw = new PropBatch();
  const steel = '#5d6168';
  // Coil drum above the opening, side tracks, bottom bar and a latch with a padlock.
  hw.add(new THREE.CylinderGeometry(0.2, 0.2, DOOR_X1 - DOOR_X0 + 0.1, 20), '#8a3f22', (DOOR_X0 + DOOR_X1) / 2, DOOR_TOP + 0.24, Z0 - 0.2, 0, 0, Math.PI / 2);
  for (const x of [DOOR_X0 - 0.04, DOOR_X1 + 0.04]) hw.box(x - 0.04, 0, Z0 - 0.12, x + 0.04, DOOR_TOP + 0.1, Z0 + 0.03, steel);
  hw.box(DOOR_X0, DOOR_GAP - 0.05, Z0 - 0.09, DOOR_X1, DOOR_GAP + 0.02, Z0 - 0.02, '#3a3c40');
  hw.box(DOOR_X0 + 0.9, DOOR_GAP - 0.02, Z0 - 0.02, DOOR_X0 + 1.2, DOOR_GAP + 0.06, Z0 + 0.03, '#2c2d30');
  hw.add(new THREE.TorusGeometry(0.03, 0.007, 6, 12), '#a8a8a8', DOOR_X0 + 1.33, DOOR_GAP - 0.07, Z0 + 0.01);
  hw.box(DOOR_X0 + 1.3, DOOR_GAP - 0.16, Z0 - 0.01, DOOR_X0 + 1.37, DOOR_GAP - 0.09, Z0 + 0.03, '#b08a3a');
  // Pull rope.
  hw.rod(new THREE.Vector3(DOOR_X0 + 1.05, DOOR_GAP, Z0 + 0.02), new THREE.Vector3(DOOR_X0 + 1.08, 0.6, Z0 + 0.06), 0.008, '#c8b88a', 5);
  // Threshold.
  hw.box(DOOR_X0 - 0.1, 0, Z0 - 0.08, DOOR_X1 + 0.1, 0.025, Z0 + 0.06, '#3b3a38');
  root.add(hw.mesh(kit.metal));

  // ---------------------------------------------------------------- outside: the lot at night
  const lot = new THREE.Mesh(new THREE.PlaneGeometry(40, 22), new THREE.MeshStandardMaterial({ map: asphaltTexture(rng), roughness: 0.8, metalness: 0, envMapIntensity: 0.05 }));
  lot.rotation.x = -Math.PI / 2;
  lot.position.set(-2, -0.012, Z0 - 11);
  lot.receiveShadow = true;
  lot.name = 'lot';
  root.add(lot);
  // The opposite row of units, doors down for the night.
  const facadeTex = facadeTexture();
  const facade = new THREE.Mesh(new THREE.PlaneGeometry(36, 3.4), new THREE.MeshStandardMaterial({ map: facadeTex, emissiveMap: facadeTex, emissive: '#ffffff', emissiveIntensity: 0.07, roughness: 0.75, metalness: 0.2 }));
  facade.position.set(-2, 1.7, Z0 - 19);
  root.add(facade);
  const out = new PropBatch();
  out.box(-20, 3.4, Z0 - 19.7, 16, 3.75, Z0 - 18.6, '#2e2b28');
  // Lamp post with a sodium head, a dumpster and a chain-link fence line.
  out.rod(new THREE.Vector3(-4.5, 0, Z0 - 8.5), new THREE.Vector3(-4.5, 6.2, Z0 - 8.5), 0.07, '#3a3a3a', 8);
  out.box(-4.5, 6.1, Z0 - 8.6, -3.3, 6.2, Z0 - 8.4, '#3a3a3a');
  out.box(2.6, 0, Z0 - 9, 4.4, 1.3, Z0 - 7.8, '#1f4a2c');
  out.box(2.5, 1.25, Z0 - 9.05, 4.5, 1.35, Z0 - 7.75, '#163620');
  root.add(out.mesh(kit.satin, false, true));
  const packs = new PropBatch();
  for (let i = 0; i < 12; i += 2) packs.box(-20 + (i + 0.5) * 3 - 0.15, 3.05, Z0 - 18.95, -20 + (i + 0.5) * 3 + 0.15, 3.2, Z0 - 18.85, '#ffffff');
  root.add(new THREE.Mesh(packs.build(), kit.glow('#ffb060', 6)));
  // The sodium lamp's pool on the asphalt outside the door, painted in light.
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(9, 7), new THREE.MeshBasicMaterial({ map: poolTexture(), color: new THREE.Color(0.55, 0.26, 0.08), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(-2.2, 0.0, Z0 - 4.6);
  pool.renderOrder = 1;
  root.add(pool);
  const sodium = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.24), kit.glow('#ff8a2a', 9));
  sodium.position.set(-3.4, 6.08, Z0 - 8.5);
  root.add(sodium);

  // ---------------------------------------------------------------- the bulb
  const bulbRig = new THREE.Group();
  bulbRig.position.copy(PIVOT);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, CORD, 4), new THREE.MeshBasicMaterial({ color: '#0b0b0b' }));
  cord.position.y = -CORD / 2;
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.07, 10), new THREE.MeshStandardMaterial({ color: '#1b1b1b', roughness: 0.5 }));
  socket.position.y = -CORD - 0.02;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 10), kit.glow('#ffc880', 16));
  bulb.scale.set(1, 1.25, 1);
  bulb.position.y = -CORD - 0.09;
  bulbRig.add(cord, socket, bulb);
  root.add(bulbRig);
  // Ceiling hook and the cord running off to the wall.
  const hook = new PropBatch();
  hook.box(PIVOT.x - 0.04, H - 0.03, PIVOT.z - 0.04, PIVOT.x + 0.04, H, PIVOT.z + 0.04, '#222');
  hook.rod(new THREE.Vector3(PIVOT.x, H - 0.02, PIVOT.z), new THREE.Vector3(X0 + 0.02, H - 0.15, -1.2), 0.005, '#0b0b0b', 4);
  hook.rod(new THREE.Vector3(X0 + 0.02, H - 0.15, -1.2), new THREE.Vector3(X0 + 0.02, 1.2, -1.25), 0.005, '#0b0b0b', 4);
  root.add(hook.mesh(kit.matte, false, false));

  // ---------------------------------------------------------------- folding table and its clutter
  const props = new PropBatch();
  const metal = new PropBatch();
  const tx = X0 + 0.42;
  const tz0 = -2.95;
  const tz1 = -1.15;
  const ty = 0.74;
  props.box(tx - 0.37, ty - 0.035, tz0, tx + 0.37, ty, tz1, '#c9c2b0');
  for (const z of [tz0 + 0.08, tz1 - 0.08]) {
    metal.rod(new THREE.Vector3(tx - 0.3, 0, z), new THREE.Vector3(tx + 0.25, ty - 0.04, z), 0.012, '#5c5f63', 6);
    metal.rod(new THREE.Vector3(tx + 0.3, 0, z), new THREE.Vector3(tx - 0.25, ty - 0.04, z), 0.012, '#5c5f63', 6);
  }
  // A multimeter, a roll of duct tape, a coffee can of screwdrivers, zip ties, a notebook.
  props.box(tx - 0.1, ty, -1.75, tx + 0.02, ty + 0.04, -1.55, '#e2b11a');
  props.box(tx - 0.08, ty + 0.04, -1.72, tx, ty + 0.045, -1.62, '#1c2a1c');
  props.add(new THREE.TorusGeometry(0.05, 0.022, 8, 16), '#9a9ea6', tx + 0.15, ty + 0.025, -1.5, Math.PI / 2);
  props.add(new THREE.CylinderGeometry(0.055, 0.055, 0.15, 12), '#8a2a1c', tx - 0.18, ty + 0.075, -2.15);
  for (let i = 0; i < 5; i++) props.add(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 5), rng.pick(['#d02020', '#e0c020', '#2040c0']), tx - 0.18 + rng.range(-0.02, 0.02), ty + 0.2, -2.15 + rng.range(-0.02, 0.02), rng.range(-0.2, 0.2), 0, rng.range(-0.2, 0.2));
  props.box(tx + 0.02, ty, -2.45, tx + 0.24, ty + 0.012, -2.15, '#e8e4d8');
  props.box(tx + 0.05, ty + 0.012, -2.4, tx + 0.2, ty + 0.014, -2.2, '#4a5aa0');
  // Camping lantern: base, globe (glow, below), cap and handle.
  const lx = tx - 0.05;
  const lz = -2.65;
  props.add(new THREE.CylinderGeometry(0.07, 0.08, 0.08, 14), '#2a5a34', lx, ty + 0.04, lz);
  props.add(new THREE.CylinderGeometry(0.05, 0.065, 0.04, 14), '#2a5a34', lx, ty + 0.26, lz);
  props.add(new THREE.TorusGeometry(0.06, 0.006, 6, 16, Math.PI), '#888', lx, ty + 0.28, lz);
  const globe = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.14, 14), kit.glow('#ffb860', 6));
  globe.position.set(lx, ty + 0.15, lz);
  root.add(globe);
  // Cardboard boxes: under the table, and stacked by the door.
  const boxes = new PropBatchUv();
  boxes.cube(tx - 0.15, 0, -2.6, 0.42, 0.34, 0.4, 0.1);
  boxes.cube(tx - 0.1, 0, -1.7, 0.4, 0.3, 0.45, -0.15);
  boxes.cube(0.35, 0, -2.8, 0.55, 0.45, 0.5, 0.08);
  boxes.cube(0.38, 0.45, -2.82, 0.45, 0.35, 0.42, -0.12);
  boxes.cube(1.05, 0, -2.85, 0.5, 0.38, 0.45, 0.25);
  const boxMesh = new THREE.Mesh(boxes.buildBoxes(), kit.cardboard);
  boxMesh.castShadow = boxMesh.receiveShadow = true;
  root.add(boxMesh);

  // ---------------------------------------------------------------- the CRT on a crate
  const crate = crateMaterial('#1d4fa6');
  const tvX = -0.08;
  const tvZ = -2.75;
  const tvYaw = 0.35;
  const crates = new THREE.Group();
  crates.add(milkCrate(crate, tvX, 0, tvZ, tvYaw));
  const redCrate = crateMaterial('#b3241c');
  crates.add(milkCrate(redCrate, 0.62, 0, -2.05, -0.3));
  root.add(crates);
  const tv = new THREE.Group();
  tv.position.set(tvX, 0.31, tvZ);
  tv.rotation.y = tvYaw;
  const tvBody = new PropBatch();
  tvBody.box(-0.26, 0, -0.24, 0.26, 0.42, 0.2, '#2b2a28');
  tvBody.box(-0.2, 0.05, -0.36, 0.2, 0.37, -0.24, '#252422');
  tvBody.box(-0.25, 0.01, 0.2, 0.25, 0.41, 0.215, '#1c1b1a');
  for (const s of [-1, 1]) tvBody.rod(new THREE.Vector3(s * 0.04, 0.42, -0.05), new THREE.Vector3(s * 0.22, 0.78, -0.12), 0.004, '#aaa', 4);
  tvBody.box(-0.06, 0.42, -0.1, 0.06, 0.45, 0.0, '#1a1a1a');
  // Knobs.
  for (const y of [0.3, 0.2]) tvBody.add(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 10), '#666', 0.21, y, 0.215, Math.PI / 2);
  const tvMesh = tvBody.mesh(kit.satin);
  tv.add(tvMesh);
  const screenTex = broadcastTexture();
  const screenMat = new THREE.MeshBasicMaterial({ map: screenTex, color: new THREE.Color(1.4, 1.4, 1.5) });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.29), screenMat);
  screen.position.set(-0.03, 0.21, 0.217);
  tv.add(screen);
  root.add(tv);

  // ---------------------------------------------------------------- what is left of Juggernaut
  // A heap on the floor left of the turntable: bent armor leaning on armor, a loose wheel, a
  // coil of wire, a snapped flipper arm, and the cracked disk propped against it all.
  const scrap = new PropBatch();
  const black = '#1a1c21';
  const gold = '#b8901c';
  const raw = '#8a8f96';
  const SX = -1.95;
  const SZ = -0.95;
  /** A plate folded across its middle, standing up at `tilt` from the floor. */
  const bent = (x: number, z: number, ry: number, tilt: number, w: number, l: number, fold: number, color: string, y = 0) => {
    const base = new THREE.Matrix4().compose(new THREE.Vector3(SX + x, y, SZ + z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, tilt, 'YXZ')), new THREE.Vector3(1, 1, 1));
    const half = l / 2;
    const a = new THREE.Matrix4().makeTranslation(half / 2, 0, 0);
    const b = new THREE.Matrix4().makeTranslation(half, 0, 0).multiply(new THREE.Matrix4().makeRotationZ(fold)).multiply(new THREE.Matrix4().makeTranslation(half / 2, 0, 0));
    scrap.addMatrix(new THREE.BoxGeometry(half, 0.008, w), color, base.clone().multiply(a));
    scrap.addMatrix(new THREE.BoxGeometry(half, 0.008, w), color, base.clone().multiply(b));
  };
  bent(-0.35, -0.1, 0.3, 0.05, 0.5, 0.95, 0.25, black);
  bent(-0.3, 0.05, 0.2, 0.75, 0.42, 0.8, -0.35, black, 0.01);
  bent(0.1, -0.2, 2.6, 0.95, 0.36, 0.7, -0.5, gold, 0.02);
  bent(0.25, 0.2, 1.9, 0.55, 0.3, 0.6, 0.6, raw, 0.0);
  bent(-0.1, 0.35, -0.6, 0.3, 0.28, 0.5, 0.9, black, 0.0);
  // A stripe offcut sticking out of the top.
  scrap.add(new THREE.BoxGeometry(0.45, 0.008, 0.12), gold, SX - 0.05, 0.42, SZ - 0.05, 0.2, 0.4, 1.0);
  // A loose wheel leaning on the heap, and its hub.
  scrap.add(new THREE.TorusGeometry(0.13, 0.055, 10, 22), '#151515', SX + 0.42, 0.19, SZ + 0.12, 0.25, 1.1, 0);
  scrap.add(new THREE.CylinderGeometry(0.09, 0.09, 0.07, 16), '#9a9ea6', SX + 0.42, 0.19, SZ + 0.12, Math.PI / 2 + 0.25, 1.1, 0, 1, 1, 1);
  // Coil of red and black wire on top.
  for (let i = 0; i < 7; i++)
    scrap.add(new THREE.TorusGeometry(0.12 + rng.range(-0.01, 0.01), 0.006, 5, 24), i % 2 ? '#b31818' : '#141414', SX - 0.15, 0.36 + i * 0.011, SZ + 0.05, Math.PI / 2 + 0.35 + rng.range(-0.06, 0.06), 0, rng.range(-0.06, 0.06));
  // The snapped flipper arm, sticking up.
  scrap.add(new THREE.BoxGeometry(0.7, 0.045, 0.07), '#4a4d52', SX + 0.15, 0.3, SZ - 0.25, 0, 0.5, 0.6);
  // Bolts scattered around.
  for (let i = 0; i < 16; i++) scrap.add(new THREE.CylinderGeometry(0.009, 0.009, 0.05, 6), '#8a8e94', SX + rng.range(-0.6, 0.6), 0.01, SZ + rng.range(-0.4, 0.5), Math.PI / 2, rng.next() * 6, 0);
  const scrapMesh = scrap.mesh(kit.satin);
  root.add(scrapMesh);
  // The disk that ended it all, cracked, propped against the heap facing the room.
  const disk = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.026, 40, 1, false, 0.3, Math.PI * 2 - 0.42), new THREE.MeshStandardMaterial({ color: '#a3a8ad', roughness: 0.34, metalness: 1 }));
  disk.rotation.set(Math.PI / 2 - 0.28, 0.85, 0, 'YXZ');
  disk.position.set(SX + 0.05, 0.33, SZ + 0.38);
  disk.castShadow = disk.receiveShadow = true;
  root.add(disk);
  // Motors in a red milk crate next to the TV.
  for (let i = 0; i < 3; i++) props.add(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 12), '#6d7176', 0.62 + (i - 1) * 0.09, 0.3, -2.05, Math.PI / 2, 0, 0.3);
  props.add(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 18), '#b8bcc1', 0.65, 0.36, -2.0, 0.3, 0, 0.4);

  // A faded championship poster taped up beside the door.
  const poster = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), new THREE.MeshStandardMaterial({ map: posterTexture(), roughness: 0.8, alphaTest: 0.5 }));
  poster.position.set(X0 + 0.45, 1.25, Z0 + 0.012);
  poster.rotation.z = 0.03;
  poster.receiveShadow = true;
  root.add(poster);
  // An orange extension cord from the wall to the table.
  const cordPts = [new THREE.Vector3(X0 + 0.02, 0.3, -0.6), new THREE.Vector3(X0 + 0.1, 0.01, -0.5), new THREE.Vector3(-2.9, 0.01, -0.8), new THREE.Vector3(-2.6, 0.01, -1.1), new THREE.Vector3(-2.95, 0.3, -1.3), new THREE.Vector3(tx, ty, -1.35)];
  props.addMatrix(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cordPts), 30, 0.009, 5), '#e0620e', new THREE.Matrix4());
  root.add(props.mesh(kit.matte));
  root.add(metal.mesh(kit.metal));

  // ---------------------------------------------------------------- pallet and the homemade turntable
  const pallet = new THREE.Mesh(palletGeometry(), kit.wood);
  pallet.castShadow = pallet.receiveShadow = true;
  root.add(pallet);
  const top = new THREE.Group();
  const plyMat = new THREE.MeshStandardMaterial({ map: plywoodTexture(rng), roughness: 0.8, envMapIntensity: 0.15 });
  const ply = new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.12, 0.03, 48), plyMat);
  ply.position.y = 0.215;
  ply.castShadow = ply.receiveShadow = true;
  const bearing = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.045, 24), new THREE.MeshStandardMaterial({ color: '#6a6e74', roughness: 0.4, metalness: 0.9 }));
  bearing.position.y = 0.18;
  top.add(ply, bearing);

  // ---------------------------------------------------------------- animation
  let flick = 1;
  let flickT = 0;
  const update = (time: number, dt: number, L: GarageLights) => {
    // The bulb swings a little on its cord, as if someone brushed it a while ago.
    const ax = Math.sin(time * 2.6) * 0.03 + Math.sin(time * 0.9 + 1.3) * 0.012;
    const az = Math.sin(time * 2.45 + 0.6) * 0.022;
    bulbRig.rotation.set(ax, 0, az);
    _b.set(0, -CORD - 0.09, 0).applyEuler(bulbRig.rotation).add(PIVOT);
    L.key.position.copy(_b);
    L.key.target.position.set(_b.x, 0, _b.z);
    // The TV flickers with the cuts of whatever rerun is on.
    flickT -= dt;
    if (flickT <= 0) {
      flickT = 0.08 + rng.next() * 0.5;
      flick = 0.65 + rng.next() * 0.45;
    }
    const k = flick * (0.96 + Math.sin(time * 50) * 0.04);
    screenMat.color.setRGB(1.4 * k, 1.4 * k, 1.55 * k);
    L.fillA.intensity = 0.6 * k;
    // The lantern breathes a little.
    L.prac.intensity = 2.4 * (0.94 + Math.sin(time * 2.3) * 0.03 + Math.sin(time * 7.1) * 0.02);
  };

  // Light from the TV screen sits just in front of it.
  const tvFront = new THREE.Vector3(Math.sin(tvYaw) * 0.45, 0.52, Math.cos(tvYaw) * 0.45).add(new THREE.Vector3(tvX, 0, tvZ));

  return {
    root,
    top,
    update,
    look: {
      background: '#04060b',
      fog: ['#05070c', 11, 38],
      env: 0.16,
      hemi: ['#3a4660', '#2a1c12', 0.16],
      key: { pos: [PIVOT.x, PIVOT.y - CORD - 0.09, PIVOT.z], target: [PIVOT.x, 0, PIVOT.z], color: '#ffb877', intensity: 8, angle: 1.2, penumbra: 0.9, distance: 0, decay: 2 },
      rim: { pos: [-2.2, 2.4, -7], color: '#8ea6e6', intensity: 0.45 },
      fillA: { pos: [tvFront.x, tvFront.y, tvFront.z], color: '#7d9fff', intensity: 0.6, distance: 2.4, decay: 2 },
      fillB: { pos: [1.0, 0.7, 1.7], color: '#ffad6a', intensity: 1.3, distance: 4.5, decay: 1.5 },
      prac: { pos: [lx + 0.25, ty + 0.2, lz + 0.35], color: '#ffa458', intensity: 2.4, distance: 4, decay: 1.6 },
      fov: 40,
      aimY: 0.1,
      yaw: 0.62,
      pitch: 0.12,
      maxDist: 4.7,
    },
  };
}

// ------------------------------------------------------------------------------ geometry

/** Wall quads and cardboard boxes with UVs in meters. */
class PropBatchUv {
  private parts: THREE.BufferGeometry[] = [];

  /** A back wall quad facing +Z. */
  quad(x0: number, x1: number, y0: number, y1: number, z: number): void {
    const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    const pos = g.attributes.position as THREE.BufferAttribute;
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, z);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i), pos.getY(i));
    this.parts.push(g);
  }

  /** A box sitting on y, turned by ry. Keeps BoxGeometry's per face UVs. */
  cube(x: number, y: number, z: number, w: number, h: number, d: number, ry: number): void {
    const g = new THREE.BoxGeometry(w, h, d);
    g.rotateY(ry);
    g.translate(x, y + h / 2, z);
    this.parts.push(g.toNonIndexed());
  }

  build(scale: number): THREE.BufferGeometry {
    const g = mergeAll(this.parts);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * scale, uv.getY(i) * scale);
    return g;
  }

  buildBoxes(): THREE.BufferGeometry {
    return mergeAll(this.parts);
  }
}

function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const list = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  let n = 0;
  for (const p of list) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  let o = 0;
  for (const p of list) {
    pos.set(p.attributes.position.array as Float32Array, o * 3);
    nor.set(p.attributes.normal.array as Float32Array, o * 3);
    uv.set(p.attributes.uv.array as Float32Array, o * 2);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}

function palletGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const bx = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    parts.push(g);
  };
  // Three runners, a slatted deck: a 1.2 m pallet with a plywood disc on top.
  for (const z of [-0.55, 0, 0.55]) bx(1.2, 0.09, 0.1, 0, 0.045, z);
  for (let i = 0; i < 7; i++) bx(0.13, 0.022, 1.2, -0.54 + i * 0.18, 0.1, 0);
  for (const x of [-0.54, 0.54]) bx(0.13, 0.022, 1.2, x, 0.0, 0);
  return mergeAll(parts);
}

function milkCrate(mat: THREE.Material, x: number, y: number, z: number, ry: number): THREE.Mesh {
  const w = 0.33;
  const h = 0.28;
  const g = new THREE.BoxGeometry(w, h, w);
  // Open top: drop the top face (group 2 in BoxGeometry order px, nx, py, ny, pz, nz).
  const idx = g.index!.array as Uint16Array;
  const keep: number[] = [];
  for (let i = 0; i < idx.length; i += 3) if (i < 12 || i >= 18) keep.push(idx[i], idx[i + 1], idx[i + 2]);
  g.setIndex(keep);
  g.clearGroups();
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y + h / 2, z);
  m.rotation.y = ry;
  m.castShadow = m.receiveShadow = true;
  return m;
}

function crateMaterial(color: string): THREE.MeshStandardMaterial {
  const { c, g } = canvas(128);
  g.clearRect(0, 0, 128, 128);
  g.fillStyle = color;
  g.fillRect(0, 0, 128, 128);
  // Grid of open slots.
  g.globalCompositeOperation = 'destination-out';
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 5; x++) {
      roundRect(g, 8 + x * 23, 14 + y * 26, 16, 18, 3);
      g.fill();
    }
  g.globalCompositeOperation = 'source-over';
  return new THREE.MeshStandardMaterial({ map: canvasTexture(c), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.55 });
}

// ------------------------------------------------------------------------------ textures

function corrugated(rng: Rng): { map: THREE.Texture; normal: THREE.Texture } {
  const S = 256;
  // Ribs every 32 px across a tile of 1.2 m: about 15 cm pitch.
  const hc = canvas(S);
  for (let x = 0; x < S; x++) {
    const v = 0.5 + 0.5 * Math.sin((x / 32) * Math.PI * 2);
    const k = Math.round(Math.pow(v, 0.8) * 255);
    hc.g.fillStyle = `rgb(${k},${k},${k})`;
    hc.g.fillRect(x, 0, 1, S);
  }
  const normal = heightToNormal(hc.c, 3.2);
  const { c, g } = canvas(S);
  g.fillStyle = '#7d8187';
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = 0.5;
  g.drawImage(noiseCanvas(64, 4, rng.int(1, 999), 4), 0, 0, S, S);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  // Rust runs from the fasteners and a water line along the bottom.
  for (let i = 0; i < 9; i++) {
    const x = rng.next() * S;
    const grd = g.createLinearGradient(0, 0, 0, S);
    grd.addColorStop(0, 'rgba(120,60,25,0)');
    grd.addColorStop(rng.range(0.3, 0.8), `rgba(120,60,25,${rng.range(0.15, 0.35)})`);
    grd.addColorStop(1, 'rgba(120,60,25,0)');
    g.fillStyle = grd;
    g.fillRect(x, 0, rng.range(2, 6), S);
  }
  g.fillStyle = 'rgba(40,30,20,0.25)';
  g.fillRect(0, S - 18, S, 18);
  return { map: canvasTexture(c, { repeat: [1, 1] }), normal };
}

function doorTexture(rng: Rng): THREE.Texture {
  const { c, g } = canvas(512, 256);
  g.fillStyle = '#a4502c';
  g.fillRect(0, 0, 512, 256);
  for (let y = 0; y < 256; y += 16) {
    const grd = g.createLinearGradient(0, y, 0, y + 16);
    grd.addColorStop(0, 'rgba(255,220,190,0.18)');
    grd.addColorStop(0.5, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = grd;
    g.fillRect(0, y, 512, 16);
  }
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = 0.45;
  g.drawImage(noiseCanvas(64, 4, rng.int(1, 999), 4), 0, 0, 512, 256);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  // Scuffs along the bottom from years of boots.
  g.fillStyle = 'rgba(30,20,15,0.35)';
  for (let i = 0; i < 40; i++) g.fillRect(rng.next() * 512, 200 + rng.next() * 56, rng.range(4, 20), 2);
  return canvasTexture(c);
}

function asphaltTexture(rng: Rng): THREE.Texture {
  const S = 1024;
  const { c, g } = canvas(S);
  g.fillStyle = '#1e1f22';
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = 0.7;
  g.drawImage(noiseCanvas(256, 32, rng.int(1, 999), 3), 0, 0, S, S);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  // Damp patches, parking lines and a crack or two.
  for (let i = 0; i < 18; i++) {
    const x = rng.next() * S;
    const y = rng.next() * S;
    const r = rng.range(30, 120);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(8,8,10,0.6)');
    grd.addColorStop(1, 'rgba(8,8,10,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.fillStyle = 'rgba(210,190,90,0.55)';
  for (let i = 0; i < 6; i++) g.fillRect(80 + i * 160, 520, 10, 300);
  g.strokeStyle = 'rgba(10,10,10,0.8)';
  g.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    let x = rng.next() * S;
    let y = rng.next() * S;
    g.beginPath();
    g.moveTo(x, y);
    for (let k = 0; k < 8; k++) g.lineTo((x += rng.range(-30, 30)), (y += rng.range(5, 30)));
    g.stroke();
  }
  return canvasTexture(c, { repeat: [4, 2.2] });
}

function facadeTexture(): THREE.Texture {
  const W = 2048;
  const Hh = 192;
  const { c, g } = canvas(W, Hh);
  g.fillStyle = '#6e665c';
  g.fillRect(0, 0, W, Hh);
  const doors = 12;
  for (let i = 0; i < doors; i++) {
    const x = i * (W / doors) + 22;
    const w = W / doors - 44;
    g.fillStyle = i === 7 ? '#2e4668' : '#7e4026';
    g.fillRect(x, 40, w, Hh - 40);
    g.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = 44; y < Hh; y += 9) g.fillRect(x, y, w, 2);
    g.fillStyle = '#f2ead8';
    g.font = 'bold 22px Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText(String(140 + i), x + w / 2, 30);
  }
  return canvasTexture(c);
}

function poolTexture(): THREE.Texture {
  const { c, g } = canvas(256);
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  return canvasTexture(c, { mips: false });
}

function plywoodTexture(rng: Rng): THREE.Texture {
  const { c, g } = canvas(512);
  g.fillStyle = '#7a6448';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = `rgba(90,60,30,${rng.range(0.08, 0.22)})`;
    g.lineWidth = rng.range(2, 6);
    g.beginPath();
    const y = rng.next() * 512;
    g.moveTo(0, y);
    g.bezierCurveTo(170, y + rng.range(-30, 30), 340, y + rng.range(-30, 30), 512, y + rng.range(-20, 20));
    g.stroke();
  }
  // Paint marker lines, scorch from a grinder, a spilled coffee ring.
  g.strokeStyle = 'rgba(20,20,20,0.6)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(256, 30);
  g.lineTo(256, 482);
  g.moveTo(30, 256);
  g.lineTo(482, 256);
  g.stroke();
  g.strokeStyle = 'rgba(60,35,15,0.45)';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(360, 150, 26, 0, Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 20; i++) {
    g.fillStyle = 'rgba(20,12,6,0.3)';
    g.beginPath();
    g.arc(140 + rng.range(-40, 40), 360 + rng.range(-40, 40), rng.range(2, 8), 0, Math.PI * 2);
    g.fill();
  }
  return canvasTexture(c);
}

/** A rerun on the old TV: the Box from the high camera, a score bug, scanlines. */
function broadcastTexture(): THREE.Texture {
  const { c, g } = canvas(256, 192);
  const grd = g.createLinearGradient(0, 0, 0, 192);
  grd.addColorStop(0, '#1a2440');
  grd.addColorStop(1, '#0a0e18');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 192);
  // The Box floor in perspective with two robots and a beam of light.
  g.fillStyle = '#3a3f4a';
  g.beginPath();
  g.moveTo(40, 170);
  g.lineTo(216, 170);
  g.lineTo(180, 90);
  g.lineTo(76, 90);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(255,200,120,0.25)';
  g.beginPath();
  g.moveTo(110, 0);
  g.lineTo(150, 0);
  g.lineTo(175, 150);
  g.lineTo(85, 150);
  g.fill();
  g.fillStyle = '#d4a017';
  g.fillRect(96, 128, 30, 14);
  g.fillStyle = '#c03018';
  g.fillRect(146, 116, 26, 14);
  g.fillStyle = '#ffffff';
  g.font = 'italic 900 16px "Arial Black", Impact, sans-serif';
  g.fillText('BOTBOX', 10, 22);
  g.fillStyle = '#ff6a00';
  g.fillRect(10, 160, 70, 18);
  g.fillStyle = '#fff';
  g.font = 'bold 11px Arial, sans-serif';
  g.fillText('REPLAY', 18, 173);
  g.fillStyle = 'rgba(0,0,0,0.3)';
  for (let y = 0; y < 192; y += 3) g.fillRect(0, y, 256, 1);
  // Tube vignette.
  const v = g.createRadialGradient(128, 96, 40, 128, 96, 150);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.75)');
  g.fillStyle = v;
  g.fillRect(0, 0, 256, 192);
  return canvasTexture(c, { mips: false });
}

function posterTexture(): THREE.Texture {
  const { c, g } = canvas(256, 360);
  g.fillStyle = '#e8dcc0';
  g.fillRect(0, 0, 256, 360);
  g.fillStyle = '#16181c';
  g.fillRect(14, 14, 228, 250);
  // Gold stripes, the champ's colors.
  g.fillStyle = '#d4a017';
  g.fillRect(14, 150, 228, 18);
  g.fillRect(14, 176, 228, 6);
  g.fillStyle = '#e8e8e8';
  g.font = 'italic 900 38px "Arial Black", Impact, sans-serif';
  g.textAlign = 'center';
  g.fillText('JUGGERNAUT', 128, 70, 220);
  g.font = 'bold 22px Arial, sans-serif';
  g.fillStyle = '#d4a017';
  g.fillText('3X HEAVYWEIGHT', 128, 112);
  g.fillText('CHAMPION', 128, 136);
  g.fillStyle = '#16181c';
  g.font = 'italic 900 30px "Arial Black", Impact, sans-serif';
  g.fillText('BOTBOX', 128, 310);
  g.font = 'bold 14px Arial, sans-serif';
  g.fillText('SEASON FINALS . SAN FRANCISCO', 128, 336);
  // Sun fade and a torn corner.
  const f = g.createLinearGradient(0, 0, 256, 360);
  f.addColorStop(0, 'rgba(240,225,190,0.45)');
  f.addColorStop(1, 'rgba(240,225,190,0.1)');
  g.fillStyle = f;
  g.fillRect(0, 0, 256, 360);
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  g.moveTo(256, 360);
  g.lineTo(200, 360);
  g.lineTo(256, 300);
  g.fill();
  return canvasTexture(c);
}
