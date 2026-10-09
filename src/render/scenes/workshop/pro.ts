// Tier 3: a pro facility. A clean epoxy floor with painted bay lines, light walls with a team
// stripe, a team banner, matched rolling tool chests, a lit trophy case with three small Giant
// Nut replicas from the championship years, and bright LED high bays over a black turntable
// with a glowing ring.

import * as THREE from 'three';
import { createNutTrophy } from '../../props/nut';
import { Rng } from '../../util/rng';
import { canvas, canvasTexture, noiseCanvas } from '../../util/tex';
import { bannerCanvas, PropBatch, roomShell, type GarageLights, type WorkshopKit, type WorkshopTier } from './common';

const X0 = -5;
const X1 = 4.2;
const Z0 = -3.4;
const Z1 = 5;
const H = 3.8;

export function buildProFacility(kit: WorkshopKit): WorkshopTier {
  const root = new THREE.Group();
  root.name = 'tier3:pro';
  const rng = new Rng(777);

  // ---------------------------------------------------------------- shell
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(X1 - X0, Z1 - Z0), new THREE.MeshStandardMaterial({ map: epoxyTexture(rng), roughness: 0.3, metalness: 0.05, envMapIntensity: 0.7 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((X0 + X1) / 2, 0, (Z0 + Z1) / 2);
  floor.receiveShadow = true;
  root.add(floor);
  const wallMat = new THREE.MeshStandardMaterial({ map: proWallTexture(), roughness: 0.7 });
  root.add(roomShell(X0, X1, Z0, Z1, H, wallMat, 1 / H, {}));

  // ---------------------------------------------------------------- team banner and sponsor wall
  const bc = canvas(1024, 256);
  const bannerTex = canvasTexture(bc.c);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.05), new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.65, emissiveMap: bannerTex, emissive: '#ffffff', emissiveIntensity: 0.12 }));
  banner.position.set(-0.4, 1.76, Z0 + 0.02);
  root.add(banner);
  const sponsorMat = (name: string, tag: string, bg: [string, string], ink: string, stroke: string) =>
    new THREE.MeshStandardMaterial({ map: canvasTexture(bannerCanvas(512, 160, name, tag, bg, ink, stroke)), roughness: 0.5 });
  const s1 = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.39), sponsorMat('TORQUE MASTER', 'Motors with attitude', ['#202020', '#000000'], '#e8e8e8', '#ff2a00'));
  s1.position.set(0.6, 2.2, Z0 + 0.02);
  const s2 = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.39), sponsorMat('DynaCell', 'Battery packs that hit back', ['#ffd21a', '#d28a00'], '#111111', '#ffffff'));
  s2.position.set(2.0, 2.2, Z0 + 0.02);
  root.add(s1, s2);

  // ---------------------------------------------------------------- trophy case
  const cx = -3.0;
  const cz = Z0 + 0.32;
  const caseB = new PropBatch();
  caseB.box(cx - 1.0, 0, cz - 0.3, cx + 1.0, 0.85, cz + 0.3, '#1b1c20');
  caseB.box(cx - 1.0, 0.85, cz - 0.3, cx + 1.0, 0.88, cz + 0.3, '#2a2c30');
  caseB.box(cx - 1.0, 1.55, cz - 0.3, cx + 1.0, 1.62, cz + 0.3, '#1b1c20');
  for (const x of [cx - 0.98, cx + 0.98]) caseB.box(x - 0.02, 0.85, cz - 0.3, x + 0.02, 1.55, cz + 0.3, '#1b1c20');
  // Little brass plates for each year.
  for (let i = 0; i < 3; i++) caseB.box(cx - 0.7 + i * 0.7 - 0.12, 0.62, cz + 0.301, cx - 0.7 + i * 0.7 + 0.12, 0.7, cz + 0.305, '#c9a24a');
  root.add(caseB.mesh(kit.satin));
  const strip = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.015, 0.04), kit.glow('#fff2dc', 8));
  strip.position.set(cx, 1.54, cz + 0.2);
  root.add(strip);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(1.92, 0.67), new THREE.MeshStandardMaterial({ color: '#9ab', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.12, depthWrite: false }));
  glass.position.set(cx, 1.215, cz + 0.3);
  glass.renderOrder = 2;
  root.add(glass);
  root.add(nutReplicas(kit.env, [cx - 0.62, cx, cx + 0.62], 0.88, cz, 0.3));

  // ---------------------------------------------------------------- rolling tool chests
  const chests = new PropBatch();
  const trim = new PropBatch();
  const chest = (x: number, z: number, w: number, h: number, ry: number) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    g.updateMatrixWorld();
    const M = g.matrixWorld;
    const put = (b: PropBatch, geo: THREE.BufferGeometry, color: string, px: number, py: number, pz: number) => b.addMatrix(geo, color, M.clone().multiply(new THREE.Matrix4().makeTranslation(px, py, pz)));
    put(chests, new THREE.BoxGeometry(w, h - 0.12, 0.55), '#16171a', 0, 0.12 + (h - 0.12) / 2, 0);
    const n = Math.round((h - 0.2) / 0.13);
    for (let d = 0; d < n; d++) {
      const y = 0.18 + d * ((h - 0.24) / n);
      put(trim, new THREE.BoxGeometry(w * 0.7, 0.018, 0.03), '#e8eaee', 0, y + 0.07, 0.29);
      put(chests, new THREE.BoxGeometry(w - 0.02, 0.006, 0.01), '#ff6a00', 0, y, 0.278);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(trim, new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12).rotateZ(Math.PI / 2), '#2a2a2a', sx * (w / 2 - 0.08), 0.05, sz * 0.2);
  };
  chest(-0.65, Z0 + 0.4, 0.95, 1.1, 0);
  chest(0.4, Z0 + 0.4, 0.95, 1.1, 0);
  chest(1.45, Z0 + 0.4, 0.75, 0.85, 0);
  root.add(chests.mesh(kit.satin), trim.mesh(kit.metal));

  // ---------------------------------------------------------------- floor kit
  const kitB = new PropBatch();
  // A robot cart with a lift, a laptop on a stand, a charging station with packs glowing green.
  kitB.box(-3.3, 0.55, -1.0, -2.5, 0.6, -0.4, '#16171a');
  kitB.box(-3.27, 0.0, -0.97, -3.22, 0.55, -0.92, '#9a9ea6');
  kitB.box(-2.58, 0.0, -0.97, -2.53, 0.55, -0.92, '#9a9ea6');
  kitB.box(-3.27, 0.0, -0.48, -3.22, 0.55, -0.43, '#9a9ea6');
  kitB.box(-2.58, 0.0, -0.48, -2.53, 0.55, -0.43, '#9a9ea6');
  kitB.box(-3.15, 0.6, -0.85, -2.75, 0.62, -0.55, '#2a2c30');
  kitB.box(-3.13, 0.62, -0.85, -2.77, 0.86, -0.83, '#2a2c30');
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.21), new THREE.MeshBasicMaterial({ map: canvasTexture(telemetryCanvas()), color: new THREE.Color(1.6, 1.6, 1.6) }));
  screen.position.set(-2.95, 0.74, -0.824);
  root.add(screen);
  root.add(kitB.mesh(kit.satin));

  // ---------------------------------------------------------------- the turntable
  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.08, 0.16, 56), new THREE.MeshStandardMaterial({ color: '#b8bcc2', roughness: 0.25, metalness: 1 }));
  base.position.y = 0.08;
  base.castShadow = base.receiveShadow = true;
  root.add(base);
  const t = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 0.06, 72), new THREE.MeshStandardMaterial({ color: '#0e0f11', roughness: 0.55, metalness: 0.1, envMapIntensity: 0.25 }));
  plate.position.y = 0.2;
  plate.castShadow = plate.receiveShadow = true;
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.305, 1.305, 0.018, 72, 1, true), kit.glow('#ff4a00', 2.2));
  ring.position.y = 0.2;
  t.add(plate, ring);

  const setName = (name: string) => {
    const g = bc.g;
    const W = 1024;
    const Hh = 256;
    g.fillStyle = '#0d0e10';
    g.fillRect(0, 0, W, Hh);
    g.fillStyle = '#ff6a00';
    g.beginPath();
    g.moveTo(0, Hh);
    g.lineTo(150, 0);
    g.lineTo(210, 0);
    g.lineTo(60, Hh);
    g.fill();
    g.fillRect(0, Hh - 16, W, 8);
    let size = 112;
    const text = `TEAM ${name.toUpperCase()}`;
    const font = (s: number) => `italic 900 ${s}px "Arial Black", Impact, sans-serif`;
    g.font = font(size);
    while (g.measureText(text).width > W * 0.72 && size > 40) g.font = font((size -= 6));
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#f4f4f4';
    g.fillText(text, W * 0.58, Hh * 0.42);
    g.font = 'bold 30px Arial, sans-serif';
    g.fillStyle = '#ff8a30';
    g.fillText('OAKLAND, CALIFORNIA   .   3X HEAVYWEIGHT CHAMPIONS', W * 0.58, Hh * 0.78);
    bannerTex.needsUpdate = true;
  };
  setName('YOUR ROBOT');

  const update = (time: number, _dt: number, L: GarageLights) => {
    void time;
    void L;
  };

  return {
    root,
    top: t,
    update,
    setName,
    look: {
      background: '#16181c',
      fog: ['#16181c', 14, 32],
      env: 0.75,
      hemi: ['#f0f2f8', '#4a4c50', 0.6],
      key: { pos: [0.3, 3.5, 0.6], target: [0, 0, 0], color: '#f6f8ff', intensity: 30, angle: 0.8, penumbra: 0.55, distance: 0, decay: 1.4 },
      rim: { pos: [-3, 4, -5], color: '#dce8ff', intensity: 1.4 },
      fillA: { pos: [-2.6, 3.2, -1.6], color: '#ffffff', intensity: 9, distance: 10, decay: 1.3 },
      fillB: { pos: [2.6, 3.2, 1.8], color: '#ffffff', intensity: 9, distance: 10, decay: 1.3 },
      prac: { pos: [cx, 1.4, cz + 0.6], color: '#fff0d8', intensity: 2.2, distance: 2.6, decay: 2 },
      fov: 36,
      aimY: 0.1,
      yaw: 0.6,
      pitch: 0.16,
      maxDist: 7,
    },
  };
}

/** Three small Giant Nut replicas, instanced: one draw per trophy part. */
function nutReplicas(env: THREE.Texture, xs: number[], y: number, z: number, scale: number): THREE.Object3D {
  const g = new THREE.Group();
  const src = createNutTrophy(env);
  src.updateMatrixWorld(true);
  const place = new THREE.Matrix4();
  const m = new THREE.Matrix4();
  src.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    // Skip the tiny plaque screws.
    if ((mesh.geometry as THREE.BufferGeometry & { parameters?: { radius?: number } }).parameters?.radius === 0.006) return;
    const inst = new THREE.InstancedMesh(mesh.geometry, mesh.material, xs.length);
    xs.forEach((x, i) => {
      place.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (i - 1) * -0.25), new THREE.Vector3(scale, scale, scale));
      inst.setMatrixAt(i, m.multiplyMatrices(place, mesh.matrixWorld));
    });
    inst.castShadow = false;
    inst.receiveShadow = true;
    inst.computeBoundingSphere();
    g.add(inst);
  });
  return g;
}

function epoxyTexture(rng: Rng): THREE.Texture {
  const S = 1024;
  const { c, g } = canvas(S);
  g.fillStyle = '#8c9096';
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = 0.12;
  g.drawImage(noiseCanvas(128, 8, rng.int(1, 999), 3), 0, 0, S, S);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  // Flecks.
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = rng.pick(['rgba(20,20,20,0.5)', 'rgba(240,240,240,0.5)', 'rgba(90,100,120,0.5)']);
    g.fillRect(rng.next() * S, rng.next() * S, 2, 2);
  }
  // A painted bay: a yellow square around the turntable and a walkway line.
  g.strokeStyle = '#d8b020';
  g.lineWidth = 10;
  g.strokeRect(S * 0.3, S * 0.32, S * 0.4, S * 0.4);
  g.beginPath();
  g.moveTo(0, S * 0.18);
  g.lineTo(S, S * 0.18);
  g.stroke();
  return canvasTexture(c);
}

function proWallTexture(): THREE.Texture {
  // u along the wall, v from the floor (0) to the ceiling (1).
  const { c, g } = canvas(256, 512);
  g.fillStyle = '#c9ccd1';
  g.fillRect(0, 0, 256, 512);
  const yAt = (m: number) => 512 - (m / H) * 512;
  g.fillStyle = '#2a2c31';
  g.fillRect(0, yAt(0.9), 256, (0.9 / H) * 512);
  g.fillStyle = '#ff6a00';
  g.fillRect(0, yAt(1.05), 256, (0.1 / H) * 512);
  g.fillStyle = '#1a1b1e';
  g.fillRect(0, yAt(0.12), 256, (0.12 / H) * 512);
  // Panel seams.
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0, 0, 2, 512);
  return canvasTexture(c, { repeat: [1, 1] });
}

function telemetryCanvas(): HTMLCanvasElement {
  const { c, g } = canvas(256, 160);
  g.fillStyle = '#05080c';
  g.fillRect(0, 0, 256, 160);
  g.strokeStyle = '#30d070';
  g.lineWidth = 2;
  g.beginPath();
  for (let x = 0; x < 256; x += 4) g.lineTo(x, 90 + Math.sin(x * 0.07) * 20 + Math.sin(x * 0.23) * 8);
  g.stroke();
  g.fillStyle = '#ff8a30';
  g.font = 'bold 16px monospace';
  g.fillText('WPN 2850 RPM', 10, 24);
  g.fillStyle = '#9fd0ff';
  g.fillText('BAT 48.2V', 10, 146);
  return c;
}
