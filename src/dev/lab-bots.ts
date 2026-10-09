// Bots lab: ?lab=bots
//   Lineup and carousel of every roster robot plus odd player builds on turntables, damage and
//   debris tests, an fx bench and a mock fight. Driven by buttons, arrow keys, or window.__lab
//   for scripted screenshots. Query: mode=lineup|carousel|fx|mock, sel=<id or index>,
//   q=high|medium|low, cam=close|broadcast|top|front|side.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { BloomEffect, EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import {
  COMPONENTS,
  FACETS,
  type ArmorMaterialId,
  type BotFrame,
  type BotSpec,
  type Component,
  type Facet,
  type HitEvent,
  type HitKind,
  type Loadout,
  type MatchEvent,
  type WorldFrame,
} from '../contract';
import { CLASS_LABEL, WEAPONS } from '../data/parts';
import { ROSTER } from '../data/roster';
import { KILLSAWS, PULVERIZERS } from '../data/arena';
import { buildSpec } from '../sim/spec';
import { MockWorld } from './mock';
import { createBotView } from '../render/bots';
import { createDebrisLayer, createFxLayer } from '../render/fx';
import { createNutTrophy } from '../render/props/nut';
import type { BotView, DebrisLayer, FxLayer, Quality } from '../render/types';
import { flameTexture, scorchTexture, smokeTexture } from '../render/fx/textures';

type Mode = 'lineup' | 'carousel' | 'fx' | 'mock' | 'nut';

const params = new URLSearchParams(location.search);
let quality: Quality = (params.get('q') as Quality) ?? 'high';
let mode: Mode = (params.get('mode') as Mode) ?? 'carousel';

// ------------------------------------------------------------------------------------ builds

const P = (primary: string, secondary: string, accent: string, pattern: Loadout['paint']['pattern'], finish: Loadout['paint']['finish'], decal?: string): Loadout['paint'] => ({
  primary,
  secondary,
  accent,
  pattern,
  finish,
  decal,
});

const CUSTOM: (Omit<Loadout, 'cls'> & { cls?: Loadout['cls'] })[] = [
  { name: 'Rust Bucket', chassis: 'box', drive: 'drill2', power: 'sla', weapon: 'none', armor: { material: 'steel', grade: 1 }, extras: ['wedgeplate', 'spikes'], paint: P('#8a4b2a', '#d9d2c5', '#ffb000', 'solid', 'raw', 'RUST') },
  { name: 'Sledge', chassis: 'wedge', drive: 'mag2', power: 'nicad', weapon: 'axe', armor: { material: 'aluminum', grade: 2 }, extras: ['srimech'], paint: P('#ffd000', '#151515', '#ff3d00', 'hazard', 'gloss', 'SLEDGE') },
  { name: 'Torque', chassis: 'invertible', drive: 'skid6', power: 'nimh', weapon: 'drum', armor: { material: 'titanium', grade: 1 }, extras: [], paint: P('#2b2f36', '#ff7300', '#ffffff', 'stripes', 'metal', 'TQ') },
  { name: 'Mayhem', chassis: 'box', drive: 'mag2', power: 'nicad', weapon: 'hbar', armor: { material: 'polycarb', grade: 2 }, extras: ['wheelguards'], paint: P('#3a3f4a', '#ff2266', '#ffe000', 'flames', 'gloss', 'MAYHEM') },
  { name: 'Havoc', chassis: 'wedge', drive: 'chair4', power: 'nicad', weapon: 'vdisk', armor: { material: 'uhmw', grade: 2 }, extras: ['skirts'], paint: P('#1c1c1c', '#e8e8e8', '#ff3b30', 'number', 'matte', '13') },
  { name: 'Brickhouse', chassis: 'invertible', drive: 'chair4', power: 'sla', weapon: 'lifter', armor: { material: 'steel', grade: 1 }, extras: [], paint: P('#9b2d20', '#e7dcc8', '#202020', 'checker', 'matte', 'BRICK') },
  { name: 'Juggernaut', chassis: 'box', drive: 'skid6', power: 'sla', weapon: 'flipper', armor: { material: 'aluminum', grade: 3 }, extras: ['wheelguards', 'srimech'], paint: P('#1d3fa8', '#f2f2f2', '#ffcc00', 'stripes', 'gloss', 'JUGG') },
  { name: 'Gearhead', chassis: 'shell', drive: 'chair4', power: 'nimh', weapon: 'shell', armor: { material: 'titanium', grade: 1 }, extras: [], paint: P('#202020', '#f2f2f2', '#ff5a00', 'checker', 'raw', 'GEAR') },
  { name: 'Scrapper', chassis: 'invertible', drive: 'mag2', power: 'nicad', weapon: 'flipper', armor: { material: 'titanium', grade: 1 }, extras: [], paint: P('#5d7f2b', '#1a1a1a', '#e6e600', 'camo', 'matte', 'SCRAP') },
  { name: 'Bulldozer', chassis: 'box', drive: 'chair4', power: 'sla', weapon: 'none', armor: { material: 'polycarb', grade: 3 }, extras: ['skirts', 'wedgeplate'], paint: P('#ffb400', '#111111', '#ffffff', 'hazard', 'gloss', 'DOZER') },
  { name: 'Payload', chassis: 'wedge', drive: 'skid6', power: 'nicad', weapon: 'lifter', armor: { material: 'uhmw', grade: 2 }, extras: ['srimech'], paint: P('#f4f4f0', '#1452a8', '#e8231c', 'stripes', 'matte', 'PAYLOAD') },
  { name: 'Hot Rod', chassis: 'box', drive: 'mag2', power: 'nimh', weapon: 'axe', armor: { material: 'titanium', grade: 2 }, extras: ['spikes'], paint: P('#141414', '#ff3c00', '#ffd400', 'flames', 'gloss', 'HOT ROD') },
];

interface Entry {
  id: string;
  name: string;
  label: string;
  spec: BotSpec;
}

const ENTRIES: Entry[] = [
  ...ROSTER.map((r) => {
    const spec = buildSpec(r.loadout);
    return { id: r.id, name: r.card.name, label: `${CLASS_LABEL[r.loadout.cls]} . ${WEAPONS[r.loadout.weapon].short}`, spec };
  }),
  ...CUSTOM.map((c) => {
    const spec = buildSpec({ cls: 'heavy', ...c } as Loadout);
    return { id: c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: c.name, label: `Player build . ${WEAPONS[c.weapon].short}`, spec };
  }),
];

// ------------------------------------------------------------------------------------ scene

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'low' ? 1.25 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = quality !== 'low';
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NoToneMapping;
renderer.info.autoReset = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#07080a');
scene.fog = new THREE.Fog('#07080a', 18, 46);
const pmrem = new THREE.PMREMGenerator(renderer);
const env = pmrem.fromScene(params.get('env') === 'room' ? new RoomEnvironment() : studioEnvironment(), 0.03).texture;
scene.environment = env;

/** A lit studio: gray walls, a grid of truss lights overhead, strip lights at the sides. */
function studioEnvironment(): THREE.Scene {
  const s = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(30, 14, 30), new THREE.MeshBasicMaterial({ color: '#4a4e55', side: THREE.BackSide }));
  room.position.y = 5;
  s.add(room);
  const floorM = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshBasicMaterial({ color: '#17181a' }));
  floorM.rotation.x = -Math.PI / 2;
  floorM.position.y = -1.9;
  s.add(floorM);
  const box = (w: number, h: number, color: string, k: number, pos: [number, number, number], look: [number, number, number]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(...look);
    s.add(m);
  };
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) box(1.6, 1.6, '#f4f6ff', 1.9, [i * 4, 11.5, j * 4], [i * 4, 0, j * 4]);
  box(12, 1.2, '#cfe0ff', 3, [-14, 5, -2], [0, 2, 0]);
  box(12, 1.2, '#ffd2a0', 2.6, [14, 4, -6], [0, 2, 0]);
  box(10, 1, '#ffffff', 2, [0, 6, -14], [0, 2, 0]);
  box(14, 0.6, '#ff8a3a', 1.2, [0, 1, 14], [0, 1, 0]);
  return s;
}

const camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.05, 200);
camera.position.set(2.6, 1.6, 3.2);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0.2, 0);

// Hard key from the truss, cool fill, warm rim.
const key = new THREE.DirectionalLight('#eef3ff', 3.2);
key.position.set(4, 9, 5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 1;
key.shadow.camera.far = 30;
key.shadow.camera.left = -3;
key.shadow.camera.right = 3;
key.shadow.camera.top = 3;
key.shadow.camera.bottom = -3;
key.shadow.bias = -0.0006;
key.shadow.normalBias = 0.035;
scene.add(key, key.target);
const rim = new THREE.DirectionalLight('#ffb070', 1.6);
rim.position.set(-5, 3, -6);
scene.add(rim);
const fill = new THREE.HemisphereLight('#9fb4d6', '#1a1714', 0.35);
scene.add(fill);

// Studio floor: dark scuffed steel.
const floorTex = floorTexture();
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 120),
  new THREE.MeshStandardMaterial({ color: '#2b2d30', roughness: 0.82, metalness: 0.1, map: floorTex, envMapIntensity: 0.12 }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

function floorTexture(): THREE.CanvasTexture {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, S, S);
  let seed = 7;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 1600; i++) {
    const v = 100 + r() * 70;
    ctx.strokeStyle = `rgba(${v},${v},${v},0.35)`;
    ctx.lineWidth = r() * 1.5;
    ctx.beginPath();
    const x = r() * S;
    const y = r() * S;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (r() - 0.5) * 60, y + (r() - 0.5) * 8);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(40,40,40,0.8)';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(30, 30);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Post: bloom so HDR sparks glow, then AgX tone mapping.
const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: quality === 'low' ? 0 : 4 });
composer.addPass(new RenderPass(scene, camera));
const bloom = new BloomEffect({ intensity: 1.4, luminanceThreshold: 1.4, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.7 });
const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
composer.addPass(params.get('bloom') === '0' ? new EffectPass(camera, tone) : new EffectPass(camera, bloom, tone));

// ------------------------------------------------------------------------------------ bots

interface Slot {
  entry: Entry;
  view: BotView;
  frame: BotFrame;
  pos: THREE.Vector3;
  yaw: number;
  spin: boolean;
  armTimer: number;
  turntable: THREE.Object3D;
  labelEl: HTMLDivElement;
}

function healthy<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((k) => [k, 1])) as Record<T, number>;
}

function makeFrame(id: string, spec: BotSpec): BotFrame {
  const w = spec.weapon;
  const arm = w.kind === 'flipper' || w.kind === 'axe' || w.kind === 'lifter';
  return {
    id,
    pos: { x: 0, y: spec.groundClearance, z: 0 },
    quat: { x: 0, y: 0, z: 0, w: 1 },
    vel: { x: 0, y: 0, z: 0 },
    angVel: { x: 0, y: 0, z: 0 },
    wheelSpin: spec.wheels.map(() => 0),
    wheelContact: spec.wheels.map(() => true),
    wheelLost: spec.wheels.map(() => false),
    driveL: 0,
    driveR: 0,
    weapon: { angle: arm ? (w as { restAngle: number }).restAngle : 0, rpm: 0, spin01: 0, armed: false, arm: 0, ready: true, shotsLeft: 10 },
    facets: healthy(FACETS),
    parts: healthy(COMPONENTS),
    charge: 1,
    smoke: 0,
    fire: 0,
    inverted: false,
    disabled: false,
    koCount: null,
    holdTime: null,
  };
}

const slots: Slot[] = [];
let selected = 0;
let turning = params.get('turn') !== '0';
/** Hold arms at a fixed deployment (0..1) for screenshots, or null to cycle. */
let armHold: number | null = null;
const labelLayer = document.createElement('div');
labelLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;font:600 12px/1.2 system-ui,sans-serif;';
document.body.appendChild(labelLayer);

const turntableGeo = new THREE.CylinderGeometry(0.85, 0.9, 0.04, 64);
const turntableMat = new THREE.MeshStandardMaterial({ color: '#16181b', roughness: 0.6, metalness: 0.3, envMapIntensity: 0.4 });
const ringMat = new THREE.MeshStandardMaterial({ color: '#ff6a00', emissive: '#ff6a00', emissiveIntensity: 0.6, roughness: 0.4 });

function layoutPos(i: number): THREE.Vector3 {
  if (mode === 'fx') return new THREE.Vector3(0, 0, 0);
  if (mode === 'lineup') {
    const cols = 8;
    const col = i % cols;
    const row = Math.floor(i / cols);
    return new THREE.Vector3((col - (cols - 1) / 2) * 1.9, 0, row * 2.2 - 3);
  }
  return new THREE.Vector3(i * 2.2, 0, 0);
}

function buildSlots(): void {
  for (const s of slots) {
    s.view.dispose();
    s.turntable.removeFromParent();
    s.labelEl.remove();
  }
  slots.length = 0;
  if (mode !== 'lineup' && mode !== 'carousel' && mode !== 'fx') return;
  const list = mode === 'fx' ? [ENTRIES.find((e) => e.id === (params.get('sel') ?? 'megahurtz')) ?? ENTRIES[0]] : ENTRIES;
  list.forEach((entry, i) => {
    const view = createBotView(entry.spec, { envMap: env, quality });
    const pos = layoutPos(i);
    const tt = new THREE.Group();
    const disc = new THREE.Mesh(turntableGeo, turntableMat);
    disc.position.y = -0.02;
    disc.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.006, 6, 64), ringMat);
    ring.rotation.x = Math.PI / 2;
    tt.add(disc, ring);
    tt.position.copy(pos);
    scene.add(tt);
    scene.add(view.root);
    const labelEl = document.createElement('div');
    labelEl.style.cssText = 'position:absolute;transform:translate(-50%,0);text-align:center;color:#fff;text-shadow:0 1px 3px #000;white-space:nowrap';
    labelEl.innerHTML = `<div style="font:800 italic 15px system-ui;letter-spacing:.04em">${entry.name.toUpperCase()}</div><div style="opacity:.7">${entry.label}</div>`;
    labelLayer.appendChild(labelEl);
    slots.push({ entry, view, frame: makeFrame(entry.id, entry.spec), pos, yaw: i * 0.7 + 0.6, spin: true, armTimer: 1 + (i % 5) * 0.4, turntable: tt, labelEl });
  });
}

// ------------------------------------------------------------------------------------ fx

let fx: FxLayer = createFxLayer({ quality });
let debris: DebrisLayer = createDebrisLayer();
scene.add(fx.root, debris.root);
const pendingEvents: MatchEvent[] = [];
let simT = 0;

function viewById(id: string): BotView | undefined {
  if (mode === 'mock') return mockViews.get(id);
  return slots.find((s) => s.entry.id === id)?.view;
}

function worldFrame(): WorldFrame {
  return {
    t: simT,
    bots: mode === 'mock' ? mockFrame?.bots ?? [] : slots.map((s) => s.frame),
    debris: mode === 'mock' ? mockFrame?.debris ?? [] : labDebris.map((d) => d.frame),
    hazards: mode === 'mock' ? mockFrame?.hazards ?? [] : [],
    match: { phase: 'fight', clock: 120, lights: 4, timeScale: 1 },
  };
}

// Simple local debris for knocked-off panels in the lineup and carousel.
interface LabDebris {
  frame: WorldFrame['debris'][number];
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  rot: THREE.Euler;
  age: number;
}
const labDebris: LabDebris[] = [];
let nextDebrisId = 1;

// ------------------------------------------------------------------------------------ mock fight

let mock: MockWorld | null = null;
let mockFrame: WorldFrame | null = null;
const mockViews = new Map<string, BotView>();

function startMock(a = 'megahurtz', b = 'tax-audit'): void {
  stopMock();
  const ids = [a, b, ...(params.get('more') ?? '').split(',').filter(Boolean)];
  const list = ids.map((id, i) => ENTRIES.find((e) => e.id === id) ?? ENTRIES[i]);
  mock = new MockWorld(
    list.map((e) => ({ id: e.id, spec: e.spec })),
    { countdown: 0, clashEvery: Number(params.get('clash') ?? 1.6), seed: 11 },
  );
  for (const e of list) {
    const v = createBotView(e.spec, { envMap: env, quality });
    scene.add(v.root);
    mockViews.set(e.id, v);
  }
  arenaProps(true);
}

function stopMock(): void {
  for (const v of mockViews.values()) v.dispose();
  mockViews.clear();
  mock = null;
  mockFrame = null;
  fx.clear();
  debris.clear();
  arenaProps(false);
}

let arena: THREE.Group | null = null;
function arenaProps(on: boolean): void {
  if (arena) {
    arena.removeFromParent();
    arena = null;
  }
  if (!on) return;
  arena = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: '#3a3d41', roughness: 0.5, metalness: 0.8 });
  for (const [x, z, w, d] of [
    [0, -7.4, 14.8, 0.2],
    [0, 7.4, 14.8, 0.2],
    [-7.4, 0, 0.2, 14.8],
    [7.4, 0, 0.2, 14.8],
  ]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.6, d), wallMat);
    m.position.set(x, 0.3, z);
    m.receiveShadow = true;
    arena.add(m);
  }
  const hz = new THREE.MeshStandardMaterial({ color: '#d4a400', roughness: 0.6 });
  for (const p of PULVERIZERS) {
    const m = new THREE.Mesh(new THREE.RingGeometry(p.radius - 0.08, p.radius, 48), hz);
    m.rotation.x = -Math.PI / 2;
    m.position.set(p.center.x, 0.003, p.center.z);
    arena.add(m);
  }
  const slot = new THREE.MeshBasicMaterial({ color: '#000' });
  for (const k of KILLSAWS) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(k.width, k.length), slot);
    m.rotation.x = -Math.PI / 2;
    m.position.set(k.center.x, 0.003, k.center.z);
    arena.add(m);
  }
  scene.add(arena);
}

// ------------------------------------------------------------------------------------ actions

function sel(): Slot | undefined {
  return slots[selected];
}

const rng = (() => {
  let s = 12345;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
})();

/** Fire a hit at the selected robot's facet. */
function hitSelected(opts: { facet?: Facet; energy?: number; kind?: HitKind } = {}): void {
  const s = sel();
  if (!s) return;
  const spec = s.entry.spec;
  const facet = opts.facet ?? FACETS[Math.floor(rng() * 5)];
  const energy = opts.energy ?? 400 + rng() * 9000;
  const kind = opts.kind ?? (rng() < 0.6 ? 'spinner' : 'axe');
  // Find the panel for the facet and aim at a point on its outer face.
  const panels = spec.panels.filter((p) => p.facet === facet);
  const p = panels[Math.floor(rng() * panels.length)] ?? spec.panels[0];
  const local = new THREE.Vector3((rng() - 0.5) * p.w * 0.7, (rng() - 0.5) * p.h * 0.6, p.t / 2);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(p.center.x, p.center.y, p.center.z), new THREE.Quaternion(p.rot.x, p.rot.y, p.rot.z, p.rot.w), new THREE.Vector3(1, 1, 1));
  local.applyMatrix4(m);
  s.view.root.updateMatrixWorld();
  const world = s.view.root.localToWorld(local.clone());
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(p.rot.x, p.rot.y, p.rot.z, p.rot.w)).applyQuaternion(s.view.root.quaternion);
  const dir = normal.clone().negate().add(new THREE.Vector3((rng() - 0.5) * 0.6, 0.3, (rng() - 0.5) * 0.6)).normalize();
  simT += 0.001;
  const e: HitEvent = {
    type: 'hit',
    t: simT,
    kind,
    attacker: null,
    victim: s.entry.id,
    point: { x: world.x, y: world.y, z: world.z },
    dir: { x: dir.x, y: dir.y, z: dir.z },
    energy,
    facet,
    damage: energy / 100,
    severity: Math.min(1, energy / 12000),
    material: spec.loadout.armor.material,
  };
  s.view.hit(e);
  pendingEvents.push(e);
  if (energy > 1500) pendingEvents.push({ type: 'shrapnel', t: simT, bot: s.entry.id, point: e.point, dir: e.dir, count: Math.round(3 + (energy / 12000) * 10), material: e.material });
  s.frame.facets[facet] = Math.max(0.05, s.frame.facets[facet] - energy / 80000);
}

function knockPanel(facet?: Facet): void {
  const s = sel();
  if (!s) return;
  const f = facet ?? FACETS.find((x) => s.frame.facets[x] > 0 && x !== 'belly') ?? 'top';
  const index = s.entry.spec.panels.findIndex((p) => p.facet === f);
  if (index < 0) return;
  hitSelected({ facet: f, energy: 8000, kind: 'spinner' });
  s.frame.facets[f] = 0;
  const p = s.entry.spec.panels[index];
  const wp = new THREE.Vector3(p.center.x, p.center.y, p.center.z);
  s.view.root.localToWorld(wp);
  const id = nextDebrisId++;
  labDebris.push({
    frame: { id, bot: s.entry.id, kind: 'panel', facet: f, index, pos: { x: wp.x, y: wp.y, z: wp.z }, quat: { x: 0, y: 0, z: 0, w: 1 }, size: { x: p.w, y: p.h, z: p.t } },
    vel: new THREE.Vector3((rng() - 0.5) * 2, 4.5, 1.5 + rng()),
    spin: new THREE.Vector3(rng() * 6, rng() * 4, rng() * 6),
    rot: new THREE.Euler(),
    age: 0,
  });
  pendingEvents.push({ type: 'panel_off', t: simT, bot: s.entry.id, facet: f, debris: id });
}

function setSmoke(v: number): void {
  const s = sel();
  if (!s) return;
  s.frame.smoke = v;
  s.frame.parts.driveL = v > 0 ? 0.2 : 1;
}

function setFire(v: number): void {
  const s = sel();
  if (!s) return;
  s.frame.fire = v;
  s.frame.parts.battery = v > 0 ? 0.15 : 1;
  if (v > 0) s.frame.smoke = Math.max(s.frame.smoke, 0.7);
}

function flipSelected(): void {
  const s = sel();
  if (!s) return;
  s.frame.inverted = !s.frame.inverted;
}

function resetSelected(): void {
  const s = sel();
  if (!s) return;
  s.view.resetDamage();
  s.frame = makeFrame(s.entry.id, s.entry.spec);
}

function damageHeavy(): void {
  const s = sel();
  if (!s) return;
  for (let i = 0; i < 14; i++) hitSelected({ energy: 3000 + rng() * 9000 });
  knockPanel('top');
  knockPanel('left');
  s.frame.parts.weapon = 0.25;
  setSmoke(0.8);
}

// ------------------------------------------------------------------------------------ camera

function focus(i: number, preset = params.get('cam') ?? 'close', instant = false): void {
  selected = (i + slots.length) % Math.max(1, slots.length);
  const s = slots[selected];
  if (!s) return;
  const t = s.pos.clone().setY(0.2);
  const presets: Record<string, THREE.Vector3> = {
    close: new THREE.Vector3(1.7, 0.95, 2.1),
    hero: new THREE.Vector3(1.75, 0.85, -2.0),
    rear: new THREE.Vector3(-1.2, 0.9, 2.2),
    front: new THREE.Vector3(0.4, 0.55, -2.4),
    side: new THREE.Vector3(2.6, 0.5, 0.1),
    top: new THREE.Vector3(0.1, 3.2, 0.6),
    broadcast: new THREE.Vector3(4.5, 3.6, 6.5),
    low: new THREE.Vector3(1.4, 0.25, 1.6),
  };
  const off = presets[preset] ?? presets.close;
  camTarget.copy(t);
  camPos.copy(t).add(off);
  if (instant) {
    controls.target.copy(camTarget);
    camera.position.copy(camPos);
  }
  flying = !instant;
  updateHud();
}
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
let flying = false;

function overview(): void {
  const n = Math.ceil(ENTRIES.length / 8);
  controls.target.set(0, 0, (n - 1) * 1.1 - 3);
  camera.position.set(0, 9.5, (n - 1) * 1.1 + 9);
  flying = false;
}

// ------------------------------------------------------------------------------------ UI

const hud = document.createElement('div');
hud.style.cssText = 'position:fixed;left:10px;top:10px;color:#eee;font:12px system-ui;background:rgba(0,0,0,.55);padding:8px 10px;border-radius:6px;max-width:330px;z-index:5';
document.body.appendChild(hud);
const bar = document.createElement('div');
bar.style.cssText = 'position:fixed;left:10px;bottom:10px;right:10px;display:flex;flex-wrap:wrap;gap:6px;z-index:5';
document.body.appendChild(bar);

function button(label: string, fn: () => void): void {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = 'font:600 12px system-ui;padding:7px 10px;border-radius:5px;border:1px solid #555;background:#1c1e22;color:#eee;cursor:pointer';
  b.onclick = fn;
  bar.appendChild(b);
}

function updateHud(): void {
  const s = slots[selected];
  const info = renderer.info.render;
  hud.innerHTML = `<b>BOTBOX bots lab</b> . mode ${mode} . q ${quality}<br>${s ? `<b>${s.entry.name}</b> (${selected + 1}/${slots.length})<br>${s.entry.label}<br>${s.entry.spec.loadout.chassis}, ${s.entry.spec.loadout.armor.material}, ${s.entry.spec.loadout.drive}` : ''}<br><span style="opacity:.6">calls ${info.calls} . tris ${(info.triangles / 1000).toFixed(0)}k . ${fpsText}</span><br><span style="opacity:.6">arrows: prev/next . 1-6 cams</span>`;
}

function setMode(m: Mode): void {
  mode = m;
  stopMock();
  nut?.removeFromParent();
  nut = null;
  labDebris.length = 0;
  buildSlots();
  const wide = m === 'lineup' || m === 'mock';
  const ext = wide ? 13 : 3;
  key.shadow.camera.left = key.shadow.camera.bottom = -ext;
  key.shadow.camera.right = key.shadow.camera.top = ext;
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.normalBias = wide ? 0.06 : 0.035;
  if (m === 'lineup') overview();
  else if (m === 'carousel') focus(selected, 'close', true);
  else if (m === 'mock') {
    startMock(params.get('a') ?? 'megahurtz', params.get('b') ?? 'tax-audit');
    controls.target.set(0, 0.3, 0);
    camera.position.set(7, 7.5, 11);
  } else if (m === 'fx') {
    selected = 0;
    arenaProps(true);
    controls.target.set(0, 0.3, 0);
    camera.position.set(2.8, 1.8, 4.2);
  } else if (m === 'nut') {
    nut = createNutTrophy(env);
    scene.add(nut);
    controls.target.set(0, 0.55, 0);
    camera.position.set(1.4, 1.1, 2.2);
  }
  updateHud();
}
let nut: THREE.Object3D | null = null;

button('Lineup', () => setMode('lineup'));
button('Carousel', () => setMode('carousel'));
button('FX bench', () => setMode('fx'));
button('Mock fight', () => setMode('mock'));
button('Nut', () => setMode('nut'));
button('Hit', () => hitSelected());
button('Big hit', () => hitSelected({ energy: 15000 }));
button('Knock panel', () => knockPanel());
button('Smoke', () => setSmoke(sel()?.frame.smoke ? 0 : 0.8));
button('Fire', () => setFire(sel()?.frame.fire ? 0 : 1));
button('Flip', () => flipSelected());
button('Spin', () => {
  const s = sel();
  if (s) s.spin = !s.spin;
});
button('Wreck it', () => damageHeavy());
button('Reset', () => resetSelected());
for (const m of ['titanium', 'steel', 'aluminum', 'uhmw', 'polycarb'] as ArmorMaterialId[]) button(`Sparks ${m}`, () => benchHit(m));
button('Shrapnel', () => benchEvent('shrapnel'));
button('Grind', () => benchEvent('grind'));
button('Killsaw', () => benchEvent('killsaw'));
button('Pulverizer', () => benchEvent('pulverizer'));
button('CO2', () => benchEvent('co2'));
button('Landing', () => benchEvent('landed'));
for (const q of ['high', 'medium', 'low'] as Quality[])
  button(`q ${q}`, () => {
    quality = q;
    fx.dispose();
    fx.root.removeFromParent();
    debris.clear();
    debris.root.removeFromParent();
    fx = createFxLayer({ quality });
    debris = createDebrisLayer();
    scene.add(fx.root, debris.root);
    setMode(mode);
  });

window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') focus(selected + 1);
  if (e.key === 'ArrowLeft') focus(selected - 1);
  const cams = ['close', 'front', 'side', 'top', 'broadcast', 'low'];
  const n = Number(e.key);
  if (n >= 1 && n <= cams.length) focus(selected, cams[n - 1]);
  if (e.key === 'h') hitSelected();
  if (e.key === 'k') knockPanel();
  if (e.key === 'f') flipSelected();
});

// ------------------------------------------------------------------------------------ fx bench

/** A fake bench robot target for fx triggers when no robot is selected. */
function benchPoint(): THREE.Vector3 {
  const s = sel();
  return s ? s.pos.clone().setY(0.25) : new THREE.Vector3(0, 0.25, 0);
}

function benchHit(material: ArmorMaterialId, energy = 9000): void {
  const p = benchPoint();
  simT += 0.001;
  const dir = new THREE.Vector3(rng() - 0.5, 0.4, rng() - 0.5).normalize();
  const e: HitEvent = {
    type: 'hit',
    t: simT,
    kind: 'spinner',
    attacker: null,
    victim: 'bench',
    point: { x: p.x, y: p.y, z: p.z },
    dir: { x: dir.x, y: dir.y, z: dir.z },
    energy,
    facet: 'front',
    damage: 20,
    severity: Math.min(1, energy / 12000),
    material,
  };
  pendingEvents.push(e);
  pendingEvents.push({ type: 'shrapnel', t: simT, bot: 'bench', point: e.point, dir: e.dir, count: 8, material });
}

let grindUntil = 0;
function benchEvent(kind: 'shrapnel' | 'grind' | 'killsaw' | 'pulverizer' | 'co2' | 'landed'): void {
  const p = benchPoint();
  simT += 0.001;
  if (kind === 'shrapnel') pendingEvents.push({ type: 'shrapnel', t: simT, bot: 'bench', point: { x: p.x, y: p.y, z: p.z }, dir: { x: 0.3, y: 0.6, z: 0.5 }, count: 16, material: 'steel' });
  if (kind === 'grind') grindUntil = simT + 2.5;
  if (kind === 'killsaw') {
    const k = KILLSAWS[1];
    camera.position.set(k.center.x + 1.8, 1.1, k.center.z + 2.2);
    controls.target.set(k.center.x, 0.3, k.center.z);
    pendingEvents.push({ type: 'hazard', t: simT, hazard: k.id, kind: 'killsaw', action: 'strike', target: 'bench' });
  }
  if (kind === 'pulverizer') {
    const pv = PULVERIZERS[0];
    camera.position.set(pv.center.x + 2.6, 1.6, pv.center.z + 3.2);
    controls.target.set(pv.center.x, 0.3, pv.center.z);
    pendingEvents.push({ type: 'hazard', t: simT, hazard: pv.id, kind: 'pulverizer', action: 'strike', target: 'bench' });
  }
  if (kind === 'co2') {
    const s = sel();
    if (s) pendingEvents.push({ type: 'weapon_fire', t: simT, bot: s.entry.id, kind: 'flipper' });
  }
  if (kind === 'landed') {
    const s = sel();
    if (s) pendingEvents.push({ type: 'landed', t: simT, bot: s.entry.id, speed: 6 });
  }
}

// ------------------------------------------------------------------------------------ loop

const clock = new THREE.Timer();
let fpsText = '';
let timeScale = 1;
const stress = params.get('stress') === '1';
let frames = 0;
let fpsAcc = 0;
const frameTimes: number[] = [];
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

function tick(): void {
  clock.update();
  const dt = Math.min(0.05, clock.getDelta()) * timeScale;
  const t0 = performance.now();
  advance(dt);
  const t1 = performance.now();
  key.target.position.copy(controls.target);
  key.position.copy(controls.target).add(new THREE.Vector3(4, 9, 5));
  renderer.info.reset();
  composer.render(dt);
  cpuTimes.push([t1 - t0, performance.now() - t1]);
  if (cpuTimes.length > 600) cpuTimes.shift();
  requestAnimationFrame(tick);
}
const cpuTimes: [number, number][] = [];

function advance(dt: number): void {
  simT += dt;
  frames++;
  fpsAcc += dt;
  if (fpsAcc > 0.5) {
    fpsText = `${(frames / fpsAcc).toFixed(0)} fps`;
    frames = 0;
    fpsAcc = 0;
    updateHud();
  }
  frameTimes.push(dt);
  if (frameTimes.length > 600) frameTimes.shift();

  if (flying) {
    controls.target.lerp(camTarget, Math.min(1, dt * 4));
    camera.position.lerp(camPos, Math.min(1, dt * 4));
    if (camera.position.distanceTo(camPos) < 0.01) flying = false;
  }
  controls.update();

  // Turntables.
  for (const s of slots) {
    const spec = s.entry.spec;
    if (turning) s.yaw += dt * 0.25;
    const f = s.frame;
    const lift = f.inverted ? spec.height + spec.groundClearance : spec.groundClearance;
    tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
    if (f.inverted) tmpQ.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI));
    f.pos = { x: s.pos.x, y: lift, z: s.pos.z };
    f.quat = { x: tmpQ.x, y: tmpQ.y, z: tmpQ.z, w: tmpQ.w };
    s.turntable.rotation.y = s.yaw;
    const w = spec.weapon;
    if (w.kind === 'vdisk' || w.kind === 'drum' || w.kind === 'hbar' || w.kind === 'shell') {
      const target = s.spin ? 1 : 0;
      f.weapon.spin01 += (target - f.weapon.spin01) * Math.min(1, dt / (w.spinupSec * 0.4));
      f.weapon.angle += ((w.maxRpm * f.weapon.spin01 * Math.PI * 2) / 60) * dt * w.direction;
      f.weapon.armed = s.spin;
    } else if (w.kind === 'flipper' || w.kind === 'axe' || w.kind === 'lifter') {
      s.armTimer -= dt;
      if (s.armTimer <= 0 && s.spin) {
        s.armTimer = w.kind === 'lifter' ? 4 : 3;
        f.weapon.arm = 1;
        if (w.kind !== 'lifter') pendingEvents.push({ type: 'weapon_fire', t: simT, bot: s.entry.id, kind: w.kind });
      }
      f.weapon.arm = Math.max(0, f.weapon.arm - dt * (w.kind === 'lifter' ? 0.5 : 2.2));
      if (armHold !== null) f.weapon.arm = armHold;
      const k = Math.min(1, f.weapon.arm * (armHold !== null ? 1 : 1.4));
      f.weapon.angle = w.restAngle + (w.maxAngle - w.restAngle) * k;
    }
    for (let i = 0; i < f.wheelSpin.length; i++) f.wheelSpin[i] += dt * 1.5;
    s.view.update(f, dt);
    // Labels.
    tmpV.copy(s.pos).setY(-0.05).project(camera);
    const vis = tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1 && camera.position.distanceTo(s.pos) < 16;
    s.labelEl.style.display = vis ? 'block' : 'none';
    if (vis) {
      s.labelEl.style.left = `${((tmpV.x + 1) / 2) * window.innerWidth}px`;
      s.labelEl.style.top = `${((1 - tmpV.y) / 2) * window.innerHeight + 8}px`;
    }
  }

  // Lab debris physics.
  for (const d of labDebris) {
    d.age += dt;
    d.vel.y -= 9.81 * dt;
    const p = d.frame.pos;
    p.x += d.vel.x * dt;
    p.y += d.vel.y * dt;
    p.z += d.vel.z * dt;
    const rest = Math.min(d.frame.size.z, d.frame.size.y, d.frame.size.x) / 2;
    if (p.y < rest) {
      p.y = rest;
      d.vel.y = Math.abs(d.vel.y) * 0.3;
      d.vel.x *= 0.6;
      d.vel.z *= 0.6;
      d.spin.multiplyScalar(0.5);
    }
    if (p.y <= rest + 0.01 && Math.abs(d.vel.y) < 0.5) {
      // Settle flat on the floor (a panel's thin axis is its local Z).
      d.spin.set(0, 0, 0);
      d.vel.multiplyScalar(0.9);
      const target = Math.round((d.rot.x + Math.PI / 2) / Math.PI) * Math.PI - Math.PI / 2;
      d.rot.x += (target - d.rot.x) * 0.2;
      d.rot.z *= 0.8;
    }
    // Panels lie flat: their thin axis is local Z, so rest with x rotated by +-pi/2.
    const q = new THREE.Quaternion().setFromEuler(d.rot);
    d.frame.quat = { x: q.x, y: q.y, z: q.z, w: q.w };
  }

  // Mock fight.
  if (mode === 'mock' && mock) {
    const out = mock.step(dt);
    // The mock puts robots with the belly on the floor; lift them onto their wheels.
    for (const b of out.frame.bots) {
      const v = mockViews.get(b.id);
      if (v) b.pos.y += v.spec.groundClearance;
    }
    mockFrame = out.frame;
    if (stress) for (const b of out.frame.bots) Object.assign(b, { smoke: 1, fire: 1, facets: { ...b.facets, top: 0, left: 0 } });
    for (const e of out.events) {
      if (e.type === 'hit') mockViews.get(e.victim)?.hit(e);
      pendingEvents.push(e);
    }
    for (const b of out.frame.bots) mockViews.get(b.id)?.update(b, dt);
  }

  // Stress: a constant barrage of big titanium hits and grinding on mock robots.
  if (stress && mode === 'mock' && mockFrame && Math.floor(simT * 5) !== Math.floor((simT - dt) * 5)) {
    for (const b of mockFrame.bots) {
      const p = { x: b.pos.x, y: 0.25, z: b.pos.z };
      pendingEvents.push({ type: 'hit', t: simT, kind: 'spinner', attacker: null, victim: b.id, point: p, dir: { x: rng() - 0.5, y: 0.4, z: rng() - 0.5 }, energy: 15000, facet: 'front', damage: 0, severity: 1, material: 'titanium' });
      pendingEvents.push({ type: 'shrapnel', t: simT, bot: b.id, point: p, dir: { x: 0, y: 1, z: 0 }, count: 10, material: 'steel' });
      pendingEvents.push({ type: 'grind', t: simT, point: p, dir: { x: 1, y: 0, z: 0 }, intensity: 1, material: 'steel' });
    }
  }

  // Bench grinding.
  if (simT < grindUntil && Math.floor(simT * 30) !== Math.floor((simT - dt) * 30)) {
    const p = benchPoint();
    pendingEvents.push({ type: 'grind', t: simT, point: { x: p.x, y: 0.05, z: p.z }, dir: { x: 1, y: 0, z: 0 }, intensity: 0.8, material: 'steel' });
  }

  const wf = worldFrame();
  for (const e of pendingEvents) fx.event(e, wf);
  pendingEvents.length = 0;
  fx.update(wf, dt, camera, viewById);
  debris.update(wf.debris, viewById);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ------------------------------------------------------------------------------------ script API

declare global {
  interface Window {
    __lab: unknown;
  }
}

window.__lab = {
  entries: ENTRIES.map((e) => e.id),
  select: (idOrIndex: string | number, cam?: string) => {
    const i = typeof idOrIndex === 'number' ? idOrIndex : slots.findIndex((s) => s.entry.id === idOrIndex);
    focus(i, cam, true);
  },
  cam: (pos: number[], target: number[]) => {
    camera.position.set(pos[0], pos[1], pos[2]);
    controls.target.set(target[0], target[1], target[2]);
    flying = false;
  },
  mode: (m: Mode) => setMode(m),
  hit: (facet?: Facet, energy?: number, kind?: HitKind) => hitSelected({ facet, energy, kind }),
  knock: (facet?: Facet) => knockPanel(facet),
  smoke: (v: number) => setSmoke(v),
  fire: (v: number) => setFire(v),
  flip: () => flipSelected(),
  wreck: () => damageHeavy(),
  reset: () => resetSelected(),
  spin: (on: boolean) => slots.forEach((s) => (s.spin = on)),
  setYaw: (yaw: number) => {
    const s = sel();
    if (s) s.yaw = yaw;
  },
  turn: (on: boolean) => (turning = on),
  arm: (k: number | null) => (armHold = k),
  /** Frame the camera on a mock-fight robot from a broadcast-ish distance. */
  follow: (id: string, dist = 3, height = 1.6) => {
    const b = mockFrame?.bots.find((x) => x.id === id);
    if (!b) return;
    controls.target.set(b.pos.x, 0.25, b.pos.z);
    camera.position.set(b.pos.x + dist * 0.6, height, b.pos.z + dist * 0.8);
    flying = false;
  },
  part: (c: Component, v: number) => {
    const s = sel();
    if (s) s.frame.parts[c] = v;
  },
  wheelOff: (i: number) => {
    const s = sel();
    if (s) s.frame.wheelLost[i] = true;
  },
  sparks: (m: ArmorMaterialId, energy?: number) => benchHit(m, energy),
  bench: (k: Parameters<typeof benchEvent>[0]) => benchEvent(k),
  stats: () => {
    const sorted = [...frameTimes].sort((a, b) => a - b);
    const avg = frameTimes.reduce((a, b) => a + b, 0) / Math.max(1, frameTimes.length);
    const upd = cpuTimes.reduce((a, b) => a + b[0], 0) / Math.max(1, cpuTimes.length);
    const sub = cpuTimes.reduce((a, b) => a + b[1], 0) / Math.max(1, cpuTimes.length);
    return { fps: 1 / avg, updateMs: +upd.toFixed(2), submitMs: +sub.toFixed(2), p95ms: (sorted[Math.floor(sorted.length * 0.95)] ?? 0) * 1000, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures };
  },
  resetStats: () => {
    frameTimes.length = 0;
    cpuTimes.length = 0;
  },
  timeScale: (k: number) => (timeScale = k),
  /** Debug: show only parts whose name starts with a prefix (panel, wheel, frame...). */
  only: (prefix: string | null) => {
    const s = sel();
    if (!s) return;
    s.view.root.traverse((o) => {
      if (o === s.view.root) return;
      if (o.parent === s.view.root) o.visible = !prefix || o.name.startsWith(prefix);
    });
  },
  names: () => sel()?.view.root.children.map((c) => c.name || c.type),
  texture: (name: 'scorch' | 'smoke' | 'flame') => ((name === 'scorch' ? scorchTexture() : name === 'smoke' ? smokeTexture() : flameTexture()).image as HTMLCanvasElement).toDataURL(),
  /** Advance the simulation by fixed steps (for deterministic screenshots). */
  step: (seconds: number, fps = 60) => {
    const prev = timeScale;
    timeScale = 0;
    for (let t = 0; t < seconds; t += 1 / fps) advance(1 / fps);
    timeScale = prev;
  },
  fxStats: () => (fx as unknown as { stats?: () => unknown }).stats?.(),
  hideUi: (on: boolean) => {
    hud.style.display = on ? 'none' : 'block';
    bar.style.display = on ? 'none' : 'flex';
    labelLayer.style.display = on ? 'none' : 'block';
  },
};

setMode(mode);
const pre = params.get('sel');
if (pre && (mode === 'carousel' || mode === 'lineup')) {
  const i = /^\d+$/.test(pre) ? Number(pre) : slots.findIndex((s) => s.entry.id === pre);
  if (mode === 'carousel') focus(i, params.get('cam') ?? 'close', true);
}
requestAnimationFrame(tick);
