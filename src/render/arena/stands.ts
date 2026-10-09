// Everything outside the Box: tiered stands with seats, sponsor banners on the stand fronts,
// aisle lights and exit signs, the driver stations, the announcer booth and the big screen.

import * as THREE from 'three';
import { BIG_SCREEN, BOOTH, DRIVER_STATIONS } from '../../data/arena';
import { GeoBatch, worldUv } from '../util/geom';
import { canvas, canvasTexture, roundRect } from '../util/tex';
import type { Seat } from './crowd';
import type { ArenaMaterials } from './materials';
import { personGeometry } from './people';

export const ROWS = 13;
const ROW_D = 0.82;
const ROW_H = 0.44;
const FRONT_H = 1.1;
const SIDE_W = 10.2;

interface Side {
  /** Unit normal pointing from the arena toward the stand. */
  n: THREE.Vector2;
  d0: number;
}

const SIDES: Side[] = [
  { n: new THREE.Vector2(0, -1), d0: 10.2 }, // north
  { n: new THREE.Vector2(0, 1), d0: 12.2 }, // south, behind the driver stations
  { n: new THREE.Vector2(-1, 0), d0: 10.2 }, // west
  { n: new THREE.Vector2(1, 0), d0: 10.2 }, // east
];

export interface Stands {
  root: THREE.Group;
  seats: Seat[];
  screen: THREE.Mesh;
  screenUniforms: { uFeed: { value: THREE.Texture | null }; uTime: { value: number }; uOn: { value: number } };
  /** Driver figures per corner, so the director can hide them in the driver camera. */
  drivers: Map<string, THREE.Object3D>;
}

export function buildStands(mats: ArenaMaterials): Stands {
  const root = new THREE.Group();
  root.name = 'stands';
  const seats: Seat[] = [];
  const steps = new GeoBatch();
  const seatMats: THREE.Matrix4[] = [];
  const aisle: THREE.Vector3[] = [];
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();

  // Local frame per side: `along` runs left to right as seen from the arena, `out` away.
  const toWorld = (s: Side, along: number, out: number, y: number, target: THREE.Vector3) => {
    const nx = s.n.x;
    const nz = s.n.y;
    // Tangent: rotate normal by 90 degrees.
    const tx = -nz;
    const tz = nx;
    return target.set(tx * along + nx * out, y, tz * along + nz * out);
  };
  for (const s of SIDES) {
    const yaw = Math.atan2(s.n.x, s.n.y); // faces back toward the center
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const W = SIDE_W + (s.d0 - 10.2) * 0.5;
    // Fascia wall at the front.
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    toWorld(s, -W, s.d0, 0, a);
    toWorld(s, W, s.d0 + 0.2, FRONT_H, b);
    steps.box(Math.min(a.x, b.x), 0, Math.min(a.z, b.z), Math.max(a.x, b.x), FRONT_H, Math.max(a.z, b.z));
    for (let r = 0; r < ROWS; r++) {
      const y = FRONT_H + r * ROW_H;
      toWorld(s, -W - r * 0.25, s.d0 + 0.2 + r * ROW_D, 0, a);
      toWorld(s, W + r * 0.25, s.d0 + 0.2 + (r + 1) * ROW_D, y, b);
      steps.box(Math.min(a.x, b.x), 0, Math.min(a.z, b.z), Math.max(a.x, b.x), y, Math.max(a.z, b.z));
      // Seats every 0.56 m with aisles every 12 seats.
      const len = (W + r * 0.25) * 2;
      const n = Math.floor(len / 0.56);
      for (let i = 0; i < n; i++) {
        if (i % 13 === 6) {
          if (r % 2 === 0) aisle.push(toWorld(s, -len / 2 + (i + 0.5) * 0.56, s.d0 + 0.25 + r * ROW_D, y + 0.03, new THREE.Vector3()));
          continue;
        }
        const along = -len / 2 + (i + 0.5) * 0.56;
        const seatPos = toWorld(s, along, s.d0 + 0.2 + r * ROW_D + ROW_D * 0.62, y + 0.45, new THREE.Vector3());
        seats.push({ pos: seatPos, yaw, row: r });
        p.copy(seatPos);
        p.y = y;
        seatMats.push(new THREE.Matrix4().compose(p, q, one));
      }
    }
    // Back wall up into the dark.
    const backOut = s.d0 + 0.2 + ROWS * ROW_D;
    toWorld(s, -W - ROWS * 0.25, backOut, 0, a);
    toWorld(s, W + ROWS * 0.25, backOut + 0.3, FRONT_H + ROWS * ROW_H + 3, b);
    steps.box(Math.min(a.x, b.x), 0, Math.min(a.z, b.z), Math.max(a.x, b.x), FRONT_H + ROWS * ROW_H + 3, Math.max(a.z, b.z));
  }
  const standMat = new THREE.MeshStandardMaterial({ color: '#1e1f24', roughness: 0.85, metalness: 0.05, envMapIntensity: 0.12 });
  const standMesh = new THREE.Mesh(worldUv(steps.build(), 0.5), standMat);
  standMesh.receiveShadow = true;
  root.add(standMesh);

  // Seats: faded blue plastic.
  const seatGeoB = new GeoBatch();
  seatGeoB.box(-0.22, 0.4, -0.2, 0.22, 0.45, 0.18);
  seatGeoB.box(-0.22, 0.45, 0.14, 0.22, 0.85, 0.18);
  seatGeoB.box(-0.03, 0, -0.05, 0.03, 0.4, 0.05);
  const seatMesh = new THREE.InstancedMesh(seatGeoB.build(), new THREE.MeshStandardMaterial({ color: '#142a52', roughness: 0.6, envMapIntensity: 0.12 }), seatMats.length);
  seatMats.forEach((m, i) => seatMesh.setMatrixAt(i, m));
  seatMesh.computeBoundingSphere();
  root.add(seatMesh);

  // Aisle step lights: small amber dots that bloom a little.
  const dotGeo = new THREE.BoxGeometry(0.12, 0.03, 0.05);
  const dots = new THREE.InstancedMesh(dotGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.1, 0.3) }), aisle.length);
  aisle.forEach((a, i) => dots.setMatrixAt(i, new THREE.Matrix4().makeTranslation(a.x, a.y, a.z)));
  dots.computeBoundingSphere();
  root.add(dots);

  // ------------------------------------------------------------------ banners
  root.add(buildBanners());
  root.add(buildExitSigns());

  // ------------------------------------------------------------------ driver stations
  const drivers = new Map<string, THREE.Object3D>();
  const person = personGeometry(false);
  for (const ds of DRIVER_STATIONS) {
    const g = new THREE.Group();
    const color = ds.corner === 'red' ? '#c81e1e' : '#1e52c8';
    const b = new GeoBatch();
    const top = ds.pos.y;
    // Platform, steps and railing.
    b.box(-1.1, 0, -0.8, 1.1, top, 0.8);
    for (let i = 0; i < 4; i++) b.box(1.1, 0, 0.2, 1.1 + (4 - i) * 0.22, (top * (i + 1)) / 5, 0.8);
    for (const x of [-1.05, 1.05]) b.box(x - 0.03, top, -0.75, x + 0.03, top + 1.05, -0.69);
    b.box(-1.1, top + 1.0, -0.78, 1.1, top + 1.06, -0.7);
    for (const x of [-1.05, 1.05]) b.box(x - 0.03, top, 0.69, x + 0.03, top + 1.05, 0.75);
    // Console desk.
    b.box(-0.6, top, -0.55, 0.6, top + 0.95, -0.25);
    const plat = new THREE.Mesh(worldUv(b.build(), 1), mats.frame);
    plat.castShadow = true;
    plat.receiveShadow = true;
    g.add(plat);
    // Painted skirt in the corner color.
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.24, 0.35, 1.64), new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
    skirt.position.y = top - 0.25;
    g.add(skirt);
    // Glowing corner strip on the front edge.
    const strip = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.05, 0.02), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(5) }));
    strip.position.set(0, top - 0.05, -0.83);
    g.add(strip);
    // Small Lexan shield in front of the drivers.
    const shieldGeo = new THREE.PlaneGeometry(2.1, 1.2);
    const shield = new THREE.Mesh(worldUv(shieldGeo, 1), mats.lexan);
    shield.position.set(0, top + 1.65, -0.74);
    shield.renderOrder = 2;
    g.add(shield);
    // Driver and spotter.
    const team = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
    const crew = new THREE.Group();
    for (const [x, s] of [
      [-0.3, 1],
      [0.45, 0.97],
    ] as const) {
      const fig = new THREE.Mesh(person, team);
      fig.position.set(x, top, 0.05);
      fig.scale.setScalar(s);
      fig.castShadow = true;
      crew.add(fig);
    }
    const ctl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.18), mats.blackPaint);
    ctl.position.set(-0.3, top + 1.1, -0.15);
    crew.add(ctl);
    g.add(crew);
    drivers.set(ds.corner, crew);
    g.position.set(ds.pos.x, 0, ds.pos.z);
    root.add(g);
  }

  // ------------------------------------------------------------------ booth
  root.add(buildBooth(mats, person));

  // ------------------------------------------------------------------ big screen
  const screenUniforms = { uFeed: { value: null as THREE.Texture | null }, uTime: { value: 0 }, uOn: { value: 1 } };
  const sw = BIG_SCREEN.w;
  const sh = BIG_SCREEN.h;
  const frame = new GeoBatch();
  frame.box(-sw / 2 - 0.3, -sh / 2 - 0.3, -0.5, sw / 2 + 0.3, sh / 2 + 0.3, -0.05);
  frame.box(-sw / 2 - 0.3, sh / 2 + 0.3, -0.5, sw / 2 + 0.3, sh / 2 + 1.1, -0.1);
  for (const x of [-sw / 3, sw / 3]) frame.box(x - 0.08, sh / 2 + 1.1, -0.35, x + 0.08, sh / 2 + 9, -0.2);
  const frameMesh = new THREE.Mesh(frame.build(), mats.blackPaint);
  frameMesh.position.set(BIG_SCREEN.pos.x, BIG_SCREEN.pos.y, BIG_SCREEN.pos.z);
  root.add(frameMesh);
  const header = new THREE.Mesh(new THREE.PlaneGeometry(sw + 0.5, 0.75), new THREE.MeshBasicMaterial({ map: headerTexture(), color: new THREE.Color(2.2, 2.2, 2.2) }));
  header.position.set(BIG_SCREEN.pos.x, BIG_SCREEN.pos.y + sh / 2 + 0.7, BIG_SCREEN.pos.z - 0.09);
  root.add(header);
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(sw, sh),
    new THREE.ShaderMaterial({
      uniforms: screenUniforms,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */ `
        uniform sampler2D uFeed;
        uniform float uTime;
        uniform float uOn;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(uFeed, vUv).rgb;
          c = c / (1.0 + c);
          // LED cells and a faint scan roll.
          vec2 cell = fract(vUv * vec2(320.0, 180.0));
          float grid = 0.72 + 0.28 * step(0.18, cell.x) * step(0.18, cell.y);
          float roll = 0.94 + 0.06 * sin(vUv.y * 40.0 - uTime * 3.0);
          gl_FragColor = vec4(c * grid * roll * 2.4 * uOn + vec3(0.004), 1.0);
        }`,
    }),
  );
  screen.position.set(BIG_SCREEN.pos.x, BIG_SCREEN.pos.y, BIG_SCREEN.pos.z - 0.04);
  screen.name = 'bigscreen';
  root.add(screen);
  return { root, seats, screen, screenUniforms, drivers };
}

function headerTexture(): THREE.Texture {
  const { c, g } = canvas(1024, 96);
  const grd = g.createLinearGradient(0, 0, 0, 96);
  grd.addColorStop(0, '#1a1a1a');
  grd.addColorStop(1, '#050505');
  g.fillStyle = grd;
  g.fillRect(0, 0, 1024, 96);
  g.font = 'italic 900 64px "Arial Black", Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ff6a00';
  g.fillText('BOTBOX  VISION', 512, 50);
  return canvasTexture(c);
}

// ------------------------------------------------------------------ sponsors

interface Sponsor {
  name: string;
  tag: string;
  bg: [string, string];
  ink: string;
  stroke: string;
  style: 'swoosh' | 'burst' | 'stripes' | 'dotcom';
}

const SPONSORS: Sponsor[] = [
  { name: 'KILOWATT COLA', tag: 'Drink the power', bg: ['#c8100c', '#5a0402'], ink: '#ffffff', stroke: '#1a0000', style: 'swoosh' },
  { name: 'DynaCell', tag: 'Battery packs that hit back', bg: ['#ffd21a', '#d28a00'], ink: '#111111', stroke: '#ffffff', style: 'burst' },
  { name: 'GRIPLOCK TOOLS', tag: 'Builder tough since 1987', bg: ['#123c9c', '#06153c'], ink: '#ff8a1a', stroke: '#000000', style: 'stripes' },
  { name: 'zapnet.com', tag: 'Get online. Get loud.', bg: ['#4a1a8a', '#12062a'], ink: '#7dff3a', stroke: '#000000', style: 'dotcom' },
  { name: 'TORQUE MASTER', tag: 'Motors with attitude', bg: ['#202020', '#000000'], ink: '#e8e8e8', stroke: '#ff2a00', style: 'swoosh' },
  { name: 'IRONCLAD', tag: 'Fasteners that never quit', bg: ['#6a6e74', '#2a2c30'], ink: '#ffd400', stroke: '#000000', style: 'stripes' },
  { name: 'HyperByte 56K', tag: 'Twice the dial-up. Half the wait.', bg: ['#0a7ad8', '#022a5a'], ink: '#ffffff', stroke: '#002050', style: 'dotcom' },
  { name: 'MEGA CRUNCH', tag: 'Extreme cheese flavor', bg: ['#ff7a00', '#b02a00'], ink: '#fff23a', stroke: '#5a1000', style: 'burst' },
];

function bannerAtlas(): THREE.Texture {
  const W = 1024;
  const H = 256;
  const { c, g } = canvas(W * 2, H * 4);
  SPONSORS.forEach((s, i) => {
    const x0 = (i % 2) * W;
    const y0 = Math.floor(i / 2) * H;
    g.save();
    g.beginPath();
    g.rect(x0, y0, W, H);
    g.clip();
    const grd = g.createLinearGradient(x0, y0, x0, y0 + H);
    grd.addColorStop(0, s.bg[0]);
    grd.addColorStop(1, s.bg[1]);
    g.fillStyle = grd;
    g.fillRect(x0, y0, W, H);
    // Decorations in the era style.
    g.globalAlpha = 0.35;
    if (s.style === 'swoosh') {
      g.strokeStyle = '#ffffff';
      g.lineWidth = 26;
      g.beginPath();
      g.moveTo(x0 - 40, y0 + H * 0.9);
      g.quadraticCurveTo(x0 + W * 0.5, y0 + H * 0.15, x0 + W + 40, y0 + H * 0.55);
      g.stroke();
    } else if (s.style === 'burst') {
      g.fillStyle = '#ffffff';
      for (let k = 0; k < 18; k++) {
        const a = (k / 18) * Math.PI * 2;
        g.beginPath();
        g.moveTo(x0 + 140, y0 + H / 2);
        g.lineTo(x0 + 140 + Math.cos(a) * 400, y0 + H / 2 + Math.sin(a) * 400);
        g.lineTo(x0 + 140 + Math.cos(a + 0.12) * 400, y0 + H / 2 + Math.sin(a + 0.12) * 400);
        g.fill();
      }
    } else if (s.style === 'stripes') {
      g.fillStyle = '#ffffff';
      for (let k = -4; k < 30; k++) {
        g.beginPath();
        g.moveTo(x0 + k * 60, y0 + H);
        g.lineTo(x0 + k * 60 + 24, y0 + H);
        g.lineTo(x0 + k * 60 + 24 + 90, y0);
        g.lineTo(x0 + k * 60 + 90, y0);
        g.fill();
      }
      g.globalAlpha = 0.12;
    } else {
      g.strokeStyle = '#ffffff';
      g.lineWidth = 3;
      for (let k = 0; k < 8; k++) {
        g.beginPath();
        g.arc(x0 + W - 120, y0 + H / 2, 30 + k * 26, 0, Math.PI * 2);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
    // Wordmark with a chunky outline and drop shadow.
    const italic = s.style !== 'stripes';
    let size = 132;
    g.font = `${italic ? 'italic ' : ''}900 ${size}px "Arial Black", Impact, sans-serif`;
    while (g.measureText(s.name).width > W * 0.88) {
      size -= 6;
      g.font = `${italic ? 'italic ' : ''}900 ${size}px "Arial Black", Impact, sans-serif`;
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const cx = x0 + W / 2;
    const cy = y0 + H * 0.43;
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillText(s.name, cx + 8, cy + 8);
    g.lineJoin = 'round';
    g.lineWidth = 14;
    g.strokeStyle = s.stroke;
    g.strokeText(s.name, cx, cy);
    const tg = g.createLinearGradient(0, cy - size / 2, 0, cy + size / 2);
    tg.addColorStop(0, '#ffffff');
    tg.addColorStop(0.45, s.ink);
    tg.addColorStop(1, s.ink);
    g.fillStyle = tg;
    g.fillText(s.name, cx, cy);
    g.font = 'italic bold 34px Verdana, Arial, sans-serif';
    g.fillStyle = s.ink;
    g.fillText(s.tag, cx, y0 + H * 0.84);
    // Bevel frame.
    g.strokeStyle = 'rgba(255,255,255,0.4)';
    g.lineWidth = 6;
    roundRect(g, x0 + 6, y0 + 6, W - 12, H - 12, 10);
    g.stroke();
    g.restore();
  });
  return canvasTexture(c, { aniso: 8 });
}

function buildBanners(): THREE.Mesh {
  const tex = bannerAtlas();
  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];
  const quad = (center: THREE.Vector3, tangent: THREE.Vector3, normal: THREE.Vector3, w: number, h: number, cell: number) => {
    const u0 = (cell % 2) / 2;
    const v1 = 1 - Math.floor(cell / 2) / 4;
    const v0 = v1 - 0.25;
    const corners: [number, number, number, number][] = [
      [-1, -1, u0, v0],
      [1, -1, u0 + 0.5, v0],
      [1, 1, u0 + 0.5, v1],
      [-1, -1, u0, v0],
      [1, 1, u0 + 0.5, v1],
      [-1, 1, u0, v1],
    ];
    for (const [sx, sy, u, v] of corners) {
      pos.push(center.x + tangent.x * sx * w * 0.5, center.y + sy * h * 0.5, center.z + tangent.z * sx * w * 0.5);
      uv.push(u, v);
      nor.push(normal.x, normal.y, normal.z);
    }
  };
  let cell = 0;
  for (const s of SIDES) {
    const n = new THREE.Vector3(-s.n.x, 0, -s.n.y);
    // Tangent so the banner reads left to right from the arena.
    const t = new THREE.Vector3(s.n.y, 0, -s.n.x).multiplyScalar(-1);
    for (const a of [-6.5, 0, 6.5]) {
      const c = new THREE.Vector3(-t.x * -a + s.n.x * (s.d0 - 0.02), FRONT_H * 0.5, -t.z * -a + s.n.y * (s.d0 - 0.02));
      quad(c, t, n, 4.2, 1.05, cell++ % SPONSORS.length);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // Backlit vinyl: a little self light so it reads in the dark.
  const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.35, roughness: 0.5 });
  return new THREE.Mesh(g, mat);
}

function buildExitSigns(): THREE.Object3D {
  const { c, g } = canvas(128, 48);
  g.fillStyle = '#031a06';
  g.fillRect(0, 0, 128, 48);
  g.font = 'bold 36px Arial, sans-serif';
  g.fillStyle = '#3aff6a';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('EXIT', 64, 26);
  const mat = new THREE.MeshBasicMaterial({ map: canvasTexture(c), color: new THREE.Color(2, 2, 2) });
  const grp = new THREE.Group();
  const geo = new THREE.PlaneGeometry(0.6, 0.22);
  for (const [x, z, ry] of [
    [-11.5, -12, Math.PI / 4],
    [11.5, -12, -Math.PI / 4],
    [-11.5, 13, (Math.PI * 3) / 4],
  ] as const) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, 3.2, z);
    m.rotation.y = ry;
    grp.add(m);
  }
  return grp;
}

function buildBooth(mats: ArenaMaterials, person: THREE.BufferGeometry): THREE.Object3D {
  const g = new THREE.Group();
  // Booth sits just behind and above the main camera position, facing the Box.
  const dir = new THREE.Vector3(BOOTH.pos.x, 0, BOOTH.pos.z).normalize();
  const base = new THREE.Vector3(BOOTH.pos.x, BOOTH.pos.y - 1.1, BOOTH.pos.z).addScaledVector(dir, 1.6);
  const b = new GeoBatch();
  b.box(-1.9, -0.1, -1.3, 1.9, 0, 1.3); // floor
  b.box(-1.9, 2.4, -1.3, 1.9, 2.55, 1.3); // roof
  b.box(-1.9, 0, 1.2, 1.9, 2.4, 1.3); // back
  b.box(-1.9, 0, -1.3, -1.8, 2.4, 1.3);
  b.box(1.8, 0, -1.3, 1.9, 2.4, 1.3);
  b.box(-1.9, 0, -1.3, 1.9, 0.9, -1.2); // front wall below the glass
  b.box(-1.5, 0, -0.9, 1.5, 0.78, -0.5); // desk
  // Support legs down to the floor.
  for (const x of [-1.6, 1.6]) for (const z of [-1.0, 1.0]) b.box(x - 0.08, -base.y, z - 0.08, x + 0.08, 0, z + 0.08);
  const shell = new THREE.Mesh(b.build(), mats.frame);
  g.add(shell);
  // Warm interior glow.
  const inner = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.55, 0.25) }));
  inner.position.set(0, 1.4, 1.19);
  inner.rotation.y = Math.PI;
  g.add(inner);
  const host = new THREE.MeshStandardMaterial({ color: '#202020', roughness: 0.9 });
  for (const x of [-0.6, 0.6]) {
    const f = new THREE.Mesh(person, host);
    f.position.set(x, 0, -0.2);
    f.rotation.y = 0;
    g.add(f);
  }
  // Booth sign.
  const { c, g: cg } = canvas(512, 96);
  cg.fillStyle = '#0a0a0a';
  cg.fillRect(0, 0, 512, 96);
  cg.font = 'italic 900 58px "Arial Black", Impact, sans-serif';
  cg.fillStyle = '#ff6a00';
  cg.textAlign = 'center';
  cg.textBaseline = 'middle';
  cg.fillText('BOTBOX LIVE', 256, 50);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.6), new THREE.MeshBasicMaterial({ map: canvasTexture(c), color: new THREE.Color(1.8, 1.8, 1.8) }));
  sign.position.set(0, 2.85, -1.32);
  sign.rotation.y = Math.PI;
  g.add(sign);
  g.position.copy(base);
  // Face the Box: local -Z toward the center.
  g.rotation.y = Math.atan2(dir.x, dir.z);
  return g;
}
