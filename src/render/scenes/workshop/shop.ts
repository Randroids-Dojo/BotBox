// Tier 2: a sponsored shop. The classic builder's pit: block walls, pegboard and tools, a long
// workbench, red rolling toolboxes, a hanging work lamp and the team banner, plus the sponsor
// money showing: vinyl banners, a neon sign, a welding cart, a grinder and more tools.

import * as THREE from 'three';
import { Rng } from '../../util/rng';
import { canvas, canvasTexture } from '../../util/tex';
import { bannerCanvas, concreteTexture, PropBatch, type GarageLights, type WorkshopKit, type WorkshopTier } from './common';

export function buildShop(kit: WorkshopKit): WorkshopTier {
  const root = new THREE.Group();
  root.name = 'tier2:shop';
  const rng = new Rng(88);
  const s = root;

  // ---------------------------------------------------------------- room
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 12), new THREE.MeshStandardMaterial({ map: concreteTexture(rng), roughness: 0.82, metalness: 0.05 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  s.add(floor);
  const walls = new THREE.Group();
  const back = new THREE.Mesh(new THREE.PlaneGeometry(14, 5), kit.block);
  back.position.set(0, 2.5, -3.2);
  const left = new THREE.Mesh(new THREE.PlaneGeometry(12, 5), kit.block);
  left.position.set(-4.6, 2.5, 1);
  left.rotation.y = Math.PI / 2;
  back.receiveShadow = left.receiveShadow = true;
  walls.add(back, left);
  s.add(walls);

  const peg = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.6), kit.pegboard);
  peg.position.set(-1.6, 1.85, -3.17);
  peg.receiveShadow = true;
  s.add(peg);
  s.add(pegTools(kit, -3.2));

  // Workbench along the back wall.
  const wood = new PropBatch();
  wood.box(-3.5, 0.9, -3.15, 0.3, 0.96, -2.45, '#ffffff');
  const benchTop = wood.mesh(kit.wood);
  s.add(benchTop);
  const steel = new PropBatch();
  for (const x of [-3.4, -1.6, 0.2]) for (const z of [-3.1, -2.5]) steel.box(x - 0.03, 0, z - 0.03, x + 0.03, 0.9, z + 0.03, '#4a4e55');
  steel.box(-3.45, 0.25, -3.12, 0.25, 0.28, -2.48, '#4a4e55');
  // Bench clutter: a vise, battery packs, a drill, a parts bin.
  steel.box(-3.2, 0.96, -2.9, -2.95, 1.1, -2.65, '#2a2c30');
  steel.box(-3.15, 1.1, -2.85, -3.0, 1.2, -2.7, '#2a2c30');
  for (let i = 0; i < 3; i++) steel.box(-2.3 + i * 0.28, 0.96, -2.95, -2.08 + i * 0.28, 1.1, -2.75, '#2a2c30');
  steel.box(-0.9, 0.96, -3.0, -0.4, 1.08, -2.6, '#2a2c30');
  // Bench grinder with two wheels and a guard.
  steel.add(new THREE.CylinderGeometry(0.07, 0.07, 0.22, 16), '#2d5a8a', -1.25, 1.06, -2.8, 0, 0, Math.PI / 2);
  for (const k of [-1, 1]) steel.add(new THREE.CylinderGeometry(0.085, 0.085, 0.03, 18), '#6a6a6a', -1.25 + k * 0.15, 1.06, -2.8, 0, 0, Math.PI / 2);
  steel.box(-1.36, 0.96, -2.88, -1.14, 0.99, -2.72, '#2d5a8a');
  // Welding cart and its gas bottle in front of the bench.
  steel.box(-3.25, 0.1, -2.25, -2.75, 0.14, -1.85, '#3b3f45');
  steel.box(-3.25, 0.55, -2.25, -2.75, 0.58, -1.85, '#3b3f45');
  steel.box(-3.2, 0.58, -2.2, -2.8, 0.88, -1.9, '#1d4f9c');
  steel.box(-3.18, 0.6, -1.9, -2.82, 0.84, -1.89, '#141414');
  steel.add(new THREE.CylinderGeometry(0.11, 0.11, 1.1, 16), '#3a6a3a', -3.15, 0.66, -2.35);
  steel.add(new THREE.CylinderGeometry(0.05, 0.08, 0.1, 12), '#3a6a3a', -3.15, 1.25, -2.35);
  for (const [x, z] of [
    [-3.22, -2.2],
    [-2.78, -2.2],
    [-3.22, -1.9],
    [-2.78, -1.9],
  ])
    steel.add(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 10), '#141414', x, 0.04, z, Math.PI / 2);
  const steelMesh = steel.mesh(kit.satin);
  s.add(steelMesh);
  const packs = new PropBatch();
  for (let i = 0; i < 3; i++) packs.box(-2.28 + i * 0.28, 1.1, -2.93, -2.1 + i * 0.28, 1.13, -2.77, '#d8a010');
  s.add(packs.mesh(kit.satin, false));

  // Rolling toolboxes, the classic red, and a smaller cart.
  const red = new THREE.MeshStandardMaterial({ color: '#b3140e', roughness: 0.35, metalness: 0.5 });
  const tb = new PropBatch();
  const handles = new PropBatch();
  for (const [x, z, h] of [
    [1.4, -2.75, 1.05],
    [2.3, -2.75, 0.75],
  ] as const) {
    tb.box(x - 0.42, 0.1, z - 0.3, x + 0.42, h, z + 0.3, '#ffffff');
    for (let d = 0; d < 5; d++) {
      const y = 0.2 + (d * (h - 0.25)) / 5;
      handles.box(x - 0.25, y + 0.08, z + 0.3, x + 0.25, y + 0.1, z + 0.33, '#e0e0e0');
      handles.box(x - 0.41, y + 0.01, z + 0.3, x + 0.41, y + 0.015, z + 0.305, '#e0e0e0');
    }
    for (const cx of [-0.35, 0.35]) for (const cz of [-0.22, 0.22]) handles.add(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 10), '#e0e0e0', x + cx, 0.05, z + cz, Math.PI / 2);
  }
  const tbm = tb.mesh(red);
  s.add(tbm, handles.mesh(kit.metal, false));

  // Fire extinguisher by the door.
  const ext = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 16), red);
  ext.position.set(-4.4, 0.25, 0.5);
  s.add(ext);

  // Cables snaking across the floor.
  const cables = new PropBatch();
  for (let i = 0; i < 4; i++) {
    const pts: THREE.Vector3[] = [];
    let x = -3 + i * 0.6;
    let z = -2.4;
    for (let k = 0; k < 7; k++) {
      pts.push(new THREE.Vector3(x, 0.015, z));
      x += rng.range(-0.5, 0.7);
      z += rng.range(0.3, 0.7);
    }
    cables.addMatrix(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.012 + i * 0.002, 5, false), i === 1 ? '#c8a010' : '#141414', new THREE.Matrix4());
  }
  s.add(cables.mesh(kit.matte, false));

  // ---------------------------------------------------------------- sponsors
  const bench = new THREE.Mesh(
    new THREE.PlaneGeometry(2.1, 0.52),
    new THREE.MeshStandardMaterial({ map: canvasTexture(bannerCanvas(1024, 256, 'GRIPLOCK TOOLS', 'Builder tough since 1987', ['#123c9c', '#06153c'], '#ff8a1a', '#000000')), roughness: 0.6, side: THREE.DoubleSide }),
  );
  bench.position.set(-2.25, 0.62, -2.43);
  bench.rotation.x = 0.04;
  bench.receiveShadow = true;
  s.add(bench);
  // Pull-up banner stand from the battery sponsor.
  const stand = new THREE.Group();
  const standMat = new THREE.MeshStandardMaterial({ map: canvasTexture(pullUpCanvas()), roughness: 0.55 });
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 2), standMat);
  sheet.position.y = 1.08;
  sheet.receiveShadow = true;
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.08, 0.2), kit.chrome);
  foot.position.y = 0.04;
  stand.add(sheet, foot);
  stand.position.set(-3.65, 0, -1.0);
  stand.rotation.y = 0.75;
  s.add(stand);
  // Neon sign on the wall above the toolboxes: the cola people pay for the pizza.
  const neon = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.24), new THREE.MeshBasicMaterial({ map: canvasTexture(neonCanvas()), color: new THREE.Color(3.2, 3.2, 3.2), transparent: true, depthWrite: false }));
  neon.position.set(-0.05, 1.16, -3.12);
  s.add(neon);

  // Team banner on the back wall.
  const bc = canvas(1024, 256);
  const bannerTex = canvasTexture(bc.c);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.8, side: THREE.DoubleSide }));
  banner.position.set(-1.3, 3.15, -3.12);
  s.add(banner);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.5), new THREE.MeshStandardMaterial({ map: safetySign(), roughness: 0.6 }));
  sign.position.set(-4.58, 1.7, -1.4);
  sign.rotation.y = Math.PI / 2;
  s.add(sign);

  // ---------------------------------------------------------------- turntable
  const plateMat = new THREE.MeshStandardMaterial({ color: '#6e737a', roughness: 0.35, metalness: 0.9, map: kit.diamond });
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.05, 64), plateMat);
  plate.position.y = 0.205;
  plate.receiveShadow = plate.castShadow = true;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.05, 0.18, 48), new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.5, metalness: 0.6 }));
  base.position.y = 0.09;
  base.receiveShadow = true;
  s.add(base);
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(1.255, 1.255, 0.03, 64, 1, true), new THREE.MeshStandardMaterial({ map: kit.hazard, roughness: 0.5 }));
  stripe.position.y = 0.205;
  const top = new THREE.Group();
  top.add(plate, stripe);

  // ---------------------------------------------------------------- lamp and tube
  const lamp = new THREE.Group();
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.3, 24, 1, true), new THREE.MeshStandardMaterial({ color: '#2d4a2a', roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide }));
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 8), kit.glow('#ffffff', 1).clone());
  (bulb.material as THREE.MeshBasicMaterial).color.setRGB(12, 8, 4);
  bulb.position.y = -0.1;
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 2, 4), new THREE.MeshBasicMaterial({ color: '#050505' }));
  cord.position.y = 1.15;
  lamp.add(shade, bulb, cord);
  lamp.position.set(0.25, 2.85, 0.3);
  s.add(lamp);
  const tube = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.12), kit.glow('#e6eeff', 5.4));
  tube.position.set(-1.6, 3.6, -2.6);
  s.add(tube);

  const setName = (name: string) => {
    const g = bc.g;
    const W = 1024;
    const Hh = 256;
    const grd = g.createLinearGradient(0, 0, 0, Hh);
    grd.addColorStop(0, '#13306e');
    grd.addColorStop(1, '#081633');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, Hh);
    g.fillStyle = '#ff6a00';
    g.fillRect(0, Hh - 34, W, 12);
    g.fillRect(0, 22, W, 6);
    let size = 120;
    const text = `TEAM ${name.toUpperCase()}`;
    g.font = `italic 900 ${size}px "Arial Black", Impact, sans-serif`;
    while (g.measureText(text).width > W * 0.9 && size > 40) {
      size -= 6;
      g.font = `italic 900 ${size}px "Arial Black", Impact, sans-serif`;
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 10;
    g.strokeStyle = '#000';
    g.strokeText(text, W / 2, Hh / 2);
    g.fillStyle = '#f4f4f4';
    g.fillText(text, W / 2, Hh / 2);
    bannerTex.needsUpdate = true;
  };
  setName('YOUR ROBOT');

  const update = (time: number, _dt: number, L: GarageLights) => {
    lamp.rotation.z = Math.sin(time * 0.6) * 0.02;
    // A neon tube that never quite settles.
    L.prac.intensity = 1.2 * (Math.sin(time * 37) > 0.97 ? 0.6 : 1);
  };

  return {
    root,
    top,
    update,
    setName,
    look: {
      background: '#030302',
      fog: ['#0a0806', 9, 20],
      env: 0.55,
      hemi: ['#ffd8b0', '#201810', 0.35],
      key: { pos: [0.25, 2.7, 0.3], target: [0, 0, 0], color: '#ffc890', intensity: 34, angle: 0.9, penumbra: 0.6, distance: 12, decay: 1.4 },
      rim: { pos: [-4, 3, 4], color: '#9fb8ff', intensity: 1.3 },
      fillA: { pos: [2.8, 1.6, -1.8], color: '#ff9a50', intensity: 6, distance: 8, decay: 1.5 },
      fillB: { pos: [-1.6, 3.3, -2.4], color: '#dfe8ff', intensity: 5, distance: 6, decay: 1.5 },
      prac: { pos: [-0.05, 1.2, -2.8], color: '#ff2a3a', intensity: 1.2, distance: 2, decay: 2 },
      fov: 30,
      yaw: 0.6,
      pitch: 0.14,
      maxDist: 8,
    },
  };
}

function pegTools(kit: WorkshopKit, x0: number): THREE.Object3D {
  const g = new PropBatch();
  const c = '#b8bcc4';
  for (let i = 0; i < 9; i++) {
    const x = x0 + 0.12 + i * 0.1;
    const len = 0.18 + i * 0.025;
    g.box(x - 0.012, 2.5 - len, -3.14, x + 0.012, 2.5, -3.12, c);
    g.add(new THREE.TorusGeometry(0.025, 0.008, 4, 10, Math.PI * 1.4), c, x, 2.5 + 0.02, -3.13);
  }
  for (let i = 0; i < 3; i++) {
    const x = x0 + 1.2 + i * 0.22;
    g.box(x - 0.015, 1.7, -3.14, x + 0.015, 2.05, -3.11, '#7a5232');
    g.box(x - 0.07, 2.05, -3.14, x + 0.07, 2.1, -3.1, c);
  }
  for (let i = 0; i < 6; i++) {
    const x = x0 + 1.95 + i * 0.07;
    g.add(new THREE.CylinderGeometry(0.004, 0.004, 0.16, 4), c, x, 2.25, -3.13);
    g.add(new THREE.CylinderGeometry(0.015, 0.015, 0.1, 6), i % 2 ? '#c81e1e' : '#e8c020', x, 2.38, -3.13);
  }
  for (let i = 0; i < 4; i++) {
    const x = x0 + 2.55 + i * 0.16;
    g.add(new THREE.BoxGeometry(0.015, 0.2, 0.02), c, x - 0.02, 1.55, -3.13, 0, 0, 0.12);
    g.add(new THREE.BoxGeometry(0.015, 0.2, 0.02), c, x + 0.02, 1.55, -3.13, 0, 0, -0.12);
  }
  // A second run of sockets and a row of clamps lower down, where the camera sees them.
  for (let i = 0; i < 12; i++) g.add(new THREE.CylinderGeometry(0.014 + i * 0.0012, 0.014 + i * 0.0012, 0.05, 8), c, x0 + 0.1 + i * 0.07, 1.2, -3.12, Math.PI / 2);
  for (let i = 0; i < 4; i++) {
    const x = x0 + 1.1 + i * 0.2;
    g.box(x - 0.01, 1.08, -3.14, x + 0.01, 1.32, -3.11, '#e06a10');
    g.box(x - 0.05, 1.3, -3.14, x + 0.03, 1.33, -3.11, '#e06a10');
  }
  const m = g.mesh(kit.metal);
  return m;
}

function pullUpCanvas(): HTMLCanvasElement {
  const { c, g } = canvas(256, 640);
  const grd = g.createLinearGradient(0, 0, 0, 640);
  grd.addColorStop(0, '#ffd21a');
  grd.addColorStop(1, '#d28a00');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 640);
  g.fillStyle = '#111';
  g.font = 'italic 900 52px "Arial Black", Impact, sans-serif';
  g.textAlign = 'center';
  g.fillText('Dyna', 128, 110);
  g.fillText('Cell', 128, 166);
  g.font = 'bold 22px Arial, sans-serif';
  g.fillText('BATTERY PACKS', 128, 214);
  g.fillText('THAT HIT BACK', 128, 242);
  // A big battery graphic and the call to action at eye level for the camera.
  g.fillStyle = '#111';
  g.fillRect(70, 290, 116, 200);
  g.fillRect(105, 272, 46, 20);
  g.fillStyle = '#ffd21a';
  for (let i = 0; i < 4; i++) g.fillRect(84, 300 + i * 46, 88, 34);
  g.fillStyle = '#111';
  g.font = 'italic 900 34px "Arial Black", Impact, sans-serif';
  g.fillText('OFFICIAL', 128, 548);
  g.font = 'bold 20px Arial, sans-serif';
  g.fillText('BATTERY OF BOTBOX', 128, 580);
  return c;
}

function neonCanvas(): HTMLCanvasElement {
  const { c, g } = canvas(512, 160);
  g.clearRect(0, 0, 512, 160);
  g.font = 'italic 900 64px "Arial Black", Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = '#ff2030';
  g.shadowBlur = 18;
  g.strokeStyle = '#ff5060';
  g.lineWidth = 5;
  g.strokeText('KILOWATT', 256, 62);
  g.fillStyle = '#ffd0d0';
  g.font = 'italic 700 38px Arial, sans-serif';
  g.fillText('COLA', 256, 122);
  return c;
}

function safetySign(): THREE.Texture {
  const { c, g } = canvas(256, 180);
  g.fillStyle = '#f2f2ea';
  g.fillRect(0, 0, 256, 180);
  g.fillStyle = '#d01818';
  g.fillRect(0, 0, 256, 56);
  g.fillStyle = '#fff';
  g.font = 'bold 40px Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText('DANGER', 128, 44);
  g.fillStyle = '#111';
  g.font = 'bold 24px Arial, sans-serif';
  g.fillText('WEAPONS LIVE', 128, 100);
  g.fillText('SAFETY GLASSES', 128, 136);
  g.fillText('ON AT ALL TIMES', 128, 164);
  return canvasTexture(c);
}
