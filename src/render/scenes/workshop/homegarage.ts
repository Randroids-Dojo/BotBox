// Tier 1: a real one-car garage. Painted drywall, a proper workbench under a pegboard of tools,
// a benchtop drill press, a boombox playing, a twin-tube shop light on chains, the sectional
// door down for the night, and the clutter of a house: a shop vac, paint cans, a stack of tires.

import * as THREE from 'three';
import { Rng } from '../../util/rng';
import { canvas, canvasTexture, noiseCanvas } from '../../util/tex';
import { concreteTexture, PropBatch, roomShell, type GarageLights, type WorkshopKit, type WorkshopTier } from './common';

const X0 = -3.4;
const X1 = 3.0;
const Z0 = -3.2;
const Z1 = 3.8;
const H = 2.7;

export function buildHomeGarage(kit: WorkshopKit): WorkshopTier {
  const root = new THREE.Group();
  root.name = 'tier1:garage';
  const rng = new Rng(5150);

  // ---------------------------------------------------------------- shell
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, Z1 - Z0), new THREE.MeshStandardMaterial({ map: concreteTexture(rng, '#6a665e', 8, 512), roughness: 0.78, metalness: 0.03 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
  floor.receiveShadow = true;
  root.add(floor);
  const wallMat = new THREE.MeshStandardMaterial({ map: drywallTexture(rng), roughness: 0.92 });
  root.add(roomShell(X0, X1, Z0, Z1, H, wallMat, 1 / 2.4));

  // ---------------------------------------------------------------- sectional door, down
  const doorX0 = -0.55;
  const doorX1 = 2.55;
  const door = new THREE.Mesh(new THREE.PlaneGeometry(doorX1 - doorX0, 2.15), new THREE.MeshStandardMaterial({ map: garageDoorTexture(), roughness: 0.55, metalness: 0.1 }));
  door.position.set((doorX0 + doorX1) / 2, 1.075, Z0 + 0.02);
  door.receiveShadow = true;
  root.add(door);
  // Night through the little windows.
  const win = new PropBatch();
  for (let i = 0; i < 4; i++) {
    const x = doorX0 + 0.25 + i * 0.75;
    win.box(x, 1.66, Z0 + 0.025, x + 0.55, 1.86, Z0 + 0.03, '#ffffff');
  }
  root.add(new THREE.Mesh(win.build(), kit.glow('#28406e', 0.9)));

  // ---------------------------------------------------------------- workbench and pegboard
  const bx0 = -3.3;
  const bx1 = -0.75;
  const bz0 = -3.15;
  const bz1 = -2.5;
  const top = 0.9;
  const wood = new PropBatch();
  wood.box(bx0, top - 0.05, bz0, bx1, top, bz1, '#ffffff');
  wood.box(bx0 + 0.05, 0.25, bz0 + 0.02, bx1 - 0.05, 0.28, bz1 - 0.05, '#ffffff');
  for (const x of [bx0 + 0.05, (bx0 + bx1) / 2, bx1 - 0.05]) for (const z of [bz0 + 0.05, bz1 - 0.05]) wood.box(x - 0.04, 0, z - 0.04, x + 0.04, top - 0.05, z + 0.04, '#ffffff');
  wood.box(bx0, top, bz0, bx1, top + 0.12, bz0 + 0.02, '#ffffff');
  const woodMesh = wood.mesh(kit.wood);
  root.add(woodMesh);
  const peg = new THREE.Mesh(new THREE.PlaneGeometry(bx1 - bx0, 1.15), kit.pegboard);
  peg.position.set((bx0 + bx1) / 2, top + 0.12 + 0.575, Z0 + 0.015);
  peg.receiveShadow = true;
  root.add(peg);

  const p = new PropBatch();
  const m = new PropBatch();
  const steel = '#b8bcc4';
  // Pegboard: wrenches, a hand saw, hammers, screwdrivers, an extension cord loop.
  for (let i = 0; i < 10; i++) {
    const x = bx0 + 0.15 + i * 0.075;
    const len = 0.16 + i * 0.022;
    m.box(x - 0.011, 1.45 - len, Z0 + 0.03, x + 0.011, 1.45, Z0 + 0.045, steel);
  }
  p.add(new THREE.BoxGeometry(0.5, 0.14, 0.01), '#c0c4ca', bx0 + 1.25, 1.35, Z0 + 0.035);
  p.add(new THREE.BoxGeometry(0.14, 0.09, 0.03), '#8a3a1a', bx0 + 1.03, 1.35, Z0 + 0.04);
  for (let i = 0; i < 2; i++) {
    const x = bx0 + 1.65 + i * 0.18;
    p.box(x - 0.014, 1.12, Z0 + 0.03, x + 0.014, 1.42, Z0 + 0.055, '#7a5232');
    m.box(x - 0.06, 1.42, Z0 + 0.03, x + 0.06, 1.47, Z0 + 0.07, '#5a5e64');
  }
  for (let i = 0; i < 7; i++) {
    const x = bx0 + 2.05 + i * 0.055;
    m.add(new THREE.CylinderGeometry(0.004, 0.004, 0.14, 4), steel, x, 1.17, Z0 + 0.045);
    p.add(new THREE.CylinderGeometry(0.014, 0.014, 0.09, 6), i % 3 ? '#d02020' : '#e8c020', x, 1.29, Z0 + 0.045);
  }
  p.add(new THREE.TorusGeometry(0.13, 0.012, 6, 20), '#e0620e', bx0 + 0.55, 1.2, Z0 + 0.04);
  // Bench top: a vise, coffee mug, a parts organizer, a work light, a box of fasteners.
  m.box(bx0 + 0.15, top, bz1 - 0.3, bx0 + 0.4, top + 0.12, bz1 - 0.08, '#2d4f8a');
  m.box(bx0 + 0.2, top + 0.12, bz1 - 0.26, bx0 + 0.35, top + 0.2, bz1 - 0.12, '#2d4f8a');
  p.add(new THREE.CylinderGeometry(0.04, 0.035, 0.1, 12), '#e8e4d8', bx0 + 0.75, top + 0.05, bz1 - 0.2);
  p.box(bx0 + 0.95, top, bz0 + 0.1, bx0 + 1.45, top + 0.28, bz0 + 0.3, '#3a6a9a');
  for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) p.box(bx0 + 0.97 + c * 0.08, top + 0.02 + r * 0.065, bz0 + 0.3, bx0 + 1.03 + c * 0.08, top + 0.07 + r * 0.065, bz0 + 0.305, '#b0c8e0');
  // A boombox: body, two speakers, a handle and a lit tuning window.
  const rx = bx0 + 2.05;
  const rz = bz0 + 0.25;
  p.box(rx - 0.25, top, rz - 0.08, rx + 0.25, top + 0.22, rz + 0.08, '#2a2b2e');
  for (const k of [-1, 1]) p.add(new THREE.CylinderGeometry(0.07, 0.07, 0.01, 18), '#111', rx + k * 0.15, top + 0.11, rz + 0.082, Math.PI / 2);
  m.add(new THREE.TorusGeometry(0.16, 0.01, 6, 14, Math.PI), '#9a9ea6', rx, top + 0.22, rz);
  m.rod(new THREE.Vector3(rx + 0.2, top + 0.22, rz), new THREE.Vector3(rx + 0.35, top + 0.62, rz - 0.05), 0.003, '#c0c0c0', 4);
  const dial = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.035), kit.glow('#ffb040', 3));
  dial.position.set(rx, top + 0.17, rz + 0.083);
  root.add(dial);
  // Benchtop drill press.
  const dx = bx1 - 0.35;
  const dz = bz0 + 0.3;
  m.box(dx - 0.14, top, dz - 0.12, dx + 0.14, top + 0.04, dz + 0.16, '#3a5a46');
  m.add(new THREE.CylinderGeometry(0.03, 0.03, 0.85, 12), '#c0c4ca', dx, top + 0.45, dz - 0.06);
  m.box(dx - 0.12, top + 0.3, dz - 0.08, dx + 0.12, top + 0.33, dz + 0.14, '#3a5a46');
  m.box(dx - 0.1, top + 0.72, dz - 0.14, dx + 0.1, top + 0.9, dz + 0.16, '#3a5a46');
  m.add(new THREE.CylinderGeometry(0.02, 0.012, 0.1, 10), '#c0c4ca', dx, top + 0.66, dz + 0.08);
  m.add(new THREE.CylinderGeometry(0.005, 0.005, 0.12, 6), '#c0c4ca', dx + 0.12, top + 0.78, dz + 0.1, 0, 0, 1.2);
  // Under the bench: paint cans and a battery charger.
  for (let i = 0; i < 5; i++) m.add(new THREE.CylinderGeometry(0.085, 0.085, 0.19, 14), rng.pick(['#c8ccd0', '#b0b4b8', '#8a8e92']), bx0 + 0.3 + i * 0.2, 0.37, bz0 + 0.25);
  p.box(bx0 + 1.5, 0.28, bz0 + 0.1, bx0 + 1.85, 0.48, bz0 + 0.4, '#c81e1e');

  // Floor: a shop vac, a stack of tires, a rolling stool, a trash can.
  p.add(new THREE.CylinderGeometry(0.2, 0.18, 0.42, 18), '#e8c020', -2.75, 0.21, -1.75);
  p.add(new THREE.CylinderGeometry(0.17, 0.2, 0.08, 18), '#1a1a1a', -2.75, 0.46, -1.75);
  p.addMatrix(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(-2.75, 0.5, -1.75), new THREE.Vector3(-2.5, 0.65, -1.5), new THREE.Vector3(-2.2, 0.05, -1.35), new THREE.Vector3(-1.8, 0.02, -1.6)]), 20, 0.022, 6), '#2a2a2a', new THREE.Matrix4());
  for (let i = 0; i < 3; i++) p.add(new THREE.TorusGeometry(0.27, 0.1, 10, 24), '#161616', 1.9, 0.1 + i * 0.2, -1.9, Math.PI / 2);
  p.add(new THREE.CylinderGeometry(0.2, 0.17, 0.62, 16), '#4a5a3a', -3.05, 0.31, 0.2);
  p.add(new THREE.CylinderGeometry(0.18, 0.18, 0.05, 16), '#202020', -1.55, 0.55, -1.9);
  m.add(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8), '#9a9ea6', -1.55, 0.28, -1.9);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    m.rod(new THREE.Vector3(-1.55, 0.04, -1.9), new THREE.Vector3(-1.55 + Math.cos(a) * 0.25, 0.04, -1.9 + Math.sin(a) * 0.25), 0.012, '#2a2a2a', 5);
  }
  // A calendar and a sign from the hardware store.
  const calendar = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.5), new THREE.MeshStandardMaterial({ map: calendarTexture(), roughness: 0.8 }));
  calendar.position.set(-0.65 - 0.2, 1.25, Z0 + 0.015);
  calendar.receiveShadow = true;
  root.add(calendar);

  root.add(p.mesh(kit.matte), m.mesh(kit.metal));

  // ---------------------------------------------------------------- shop light on chains
  const lamp = new PropBatch();
  lamp.box(-0.55, 2.28, -0.12, 0.65, 2.34, 0.12, '#d8d8d8');
  for (const x of [-0.45, 0.55]) lamp.rod(new THREE.Vector3(x, 2.34, 0), new THREE.Vector3(x, H, 0), 0.006, '#777', 4);
  root.add(lamp.mesh(kit.satin, false, false));
  const tubes = new PropBatch();
  for (const z of [-0.05, 0.05]) tubes.add(new THREE.CylinderGeometry(0.016, 0.016, 1.15, 8), '#ffffff', 0.05, 2.265, z, 0, 0, Math.PI / 2);
  root.add(new THREE.Mesh(tubes.build(), kit.glow('#eef4ff', 6)));

  // ---------------------------------------------------------------- the turntable
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.16, 40), new THREE.MeshStandardMaterial({ color: '#2a2c30', roughness: 0.6, metalness: 0.5 }));
  base.position.y = 0.08;
  base.castShadow = base.receiveShadow = true;
  root.add(base);
  const t = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(1.18, 1.18, 0.06, 56), new THREE.MeshStandardMaterial({ color: '#3e4246', roughness: 0.8, metalness: 0.1, envMapIntensity: 0.12 }));
  plate.position.y = 0.2;
  plate.castShadow = plate.receiveShadow = true;
  const edge = new THREE.Mesh(new THREE.CylinderGeometry(1.185, 1.185, 0.025, 56, 1, true), new THREE.MeshStandardMaterial({ color: '#e0b020', roughness: 0.5 }));
  edge.position.y = 0.215;
  t.add(plate, edge);

  const update = (time: number, _dt: number, L: GarageLights) => {
    // The boombox's level meter.
    L.prac.intensity = 0.35 + Math.abs(Math.sin(time * 6.3) * Math.sin(time * 2.1)) * 0.25;
  };

  return {
    root,
    top: t,
    update,
    look: {
      background: '#0b0a09',
      fog: ['#0b0a09', 10, 24],
      env: 0.4,
      hemi: ['#ece4d4', '#3a3228', 0.32],
      key: { pos: [0.05, 2.25, 0], target: [0, 0, 0], color: '#eef3ff', intensity: 9, angle: 1.0, penumbra: 0.7, distance: 0, decay: 1.6 },
      rim: { pos: [1.5, 2.2, -6], color: '#7d93c8', intensity: 0.55 },
      fillA: { pos: [-2.1, 1.75, -2.3], color: '#ffcc88', intensity: 3.2, distance: 4.5, decay: 1.6 },
      fillB: { pos: [2.2, 2.0, 2.2], color: '#ffe6c8', intensity: 2.2, distance: 7, decay: 1.4 },
      prac: { pos: [rx, top + 0.25, rz + 0.25], color: '#ffb040', intensity: 0.4, distance: 1.2, decay: 2 },
      fov: 34,
      aimY: 0.2,
      yaw: 0.6,
      pitch: 0.14,
      maxDist: 5.4,
    },
  };
}

function drywallTexture(rng: Rng): THREE.Texture {
  const { c, g } = canvas(512);
  g.fillStyle = '#b8b0a0';
  g.fillRect(0, 0, 512, 512);
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = 0.18;
  g.drawImage(noiseCanvas(64, 4, rng.int(1, 999), 4), 0, 0, 512, 512);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  // Taped seams and a few scuffs at bumper height.
  g.fillStyle = 'rgba(255,255,250,0.12)';
  g.fillRect(0, 0, 12, 512);
  g.fillStyle = 'rgba(60,50,40,0.16)';
  for (let i = 0; i < 14; i++) g.fillRect(rng.next() * 512, 380 + rng.next() * 90, rng.range(8, 40), rng.range(2, 5));
  return canvasTexture(c, { repeat: [1, 1] });
}

function garageDoorTexture(): THREE.Texture {
  const { c, g } = canvas(512, 384);
  g.fillStyle = '#d8d6d0';
  g.fillRect(0, 0, 512, 384);
  // Four sections with raised panels.
  for (let s = 0; s < 4; s++) {
    const y = s * 96;
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, y, 512, 3);
    for (let k = 0; k < 4; k++) {
      const x = 16 + k * 124;
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(x, y + 14, 108, 4);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(x, y + 78, 108, 4);
    }
  }
  return canvasTexture(c);
}

function calendarTexture(): THREE.Texture {
  const { c, g } = canvas(170, 250);
  g.fillStyle = '#f4f0e6';
  g.fillRect(0, 0, 170, 250);
  g.fillStyle = '#3a6a9a';
  g.fillRect(8, 8, 154, 100);
  g.fillStyle = '#e8c020';
  g.beginPath();
  g.arc(85, 58, 30, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#222';
  g.font = 'bold 16px Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText('OCTOBER', 85, 128);
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  for (let r = 0; r < 5; r++) for (let k = 0; k < 7; k++) g.strokeRect(10 + k * 21.5, 138 + r * 21, 21.5, 21);
  g.strokeStyle = '#d01010';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(10 + 4 * 21.5 + 10, 138 + 2 * 21 + 10, 11, 0, Math.PI * 2);
  g.stroke();
  return canvasTexture(c);
}
