// Shared materials for robot hardware (steel, aluminum, rubber, wiring, battery wrap...), cached
// per environment map and quality so dozens of robots reuse the same programs and uniforms.
// Per-robot armor materials are built from the robot's paint atlas.
import * as THREE from 'three';
import type { ArmorMaterialId, Paint } from '../../contract';
import type { Quality } from '../types';
import type { PaintAtlas } from './paint';

export type HardwareKey =
  | 'steel'
  | 'blued'
  | 'alu'
  | 'aluCast'
  | 'chrome'
  | 'brass'
  | 'copper'
  | 'rubber'
  | 'tread'
  | 'black'
  | 'blackPlastic'
  | 'frame'
  | 'interior'
  | 'wireRed'
  | 'wireBlack'
  | 'wireYellow'
  | 'wrapNicad'
  | 'wrapNimh'
  | 'sla'
  | 'label'
  | 'motorCan'
  | 'heatsink'
  | 'pcb'
  | 'red'
  | 'orange'
  | 'belt'
  | 'uhmwBlack'
  | 'co2'
  | 'weld'
  | 'disk'
  | 'tine';

interface Def {
  color: string;
  rough: number;
  metal: number;
}

const DEFS: Record<HardwareKey, Def> = {
  steel: { color: '#9a9ea3', rough: 0.42, metal: 1 },
  blued: { color: '#4a4f57', rough: 0.45, metal: 1 },
  alu: { color: '#c4c8cc', rough: 0.3, metal: 1 },
  aluCast: { color: '#a9adb1', rough: 0.55, metal: 1 },
  chrome: { color: '#f0f2f4', rough: 0.08, metal: 1 },
  brass: { color: '#c9a24a', rough: 0.3, metal: 1 },
  copper: { color: '#c06a3a', rough: 0.35, metal: 1 },
  rubber: { color: '#151515', rough: 0.88, metal: 0 },
  tread: { color: '#1b1b1a', rough: 0.95, metal: 0 },
  black: { color: '#121314', rough: 0.5, metal: 0.4 },
  blackPlastic: { color: '#141516', rough: 0.45, metal: 0 },
  frame: { color: '#3c3f44', rough: 0.6, metal: 0.7 },
  interior: { color: '#141517', rough: 0.85, metal: 0.3 },
  wireRed: { color: '#b3141b', rough: 0.45, metal: 0 },
  wireBlack: { color: '#101010', rough: 0.45, metal: 0 },
  wireYellow: { color: '#d6b11a', rough: 0.45, metal: 0 },
  wrapNicad: { color: '#1d56c7', rough: 0.28, metal: 0 },
  wrapNimh: { color: '#1b7a3c', rough: 0.28, metal: 0 },
  sla: { color: '#1a1a1b', rough: 0.6, metal: 0 },
  label: { color: '#e9c21c', rough: 0.4, metal: 0 },
  motorCan: { color: '#6d7176', rough: 0.4, metal: 1 },
  heatsink: { color: '#b8bcc1', rough: 0.45, metal: 1 },
  pcb: { color: '#1f5e2c', rough: 0.5, metal: 0 },
  red: { color: '#c4161c', rough: 0.4, metal: 0 },
  orange: { color: '#ff6a00', rough: 0.45, metal: 0 },
  belt: { color: '#1c1c1c', rough: 0.8, metal: 0 },
  uhmwBlack: { color: '#202122', rough: 0.6, metal: 0 },
  co2: { color: '#c9ccd0', rough: 0.22, metal: 1 },
  weld: { color: '#5d5a56', rough: 0.6, metal: 0.9 },
  disk: { color: '#a3a8ad', rough: 0.38, metal: 1 },
  tine: { color: '#8f959c', rough: 0.5, metal: 1 },
};

/** One swatch of the shared hardware atlas: every hardware part using it points its UVs at the
 *  swatch center, so all hardware on a robot merges into a single mesh and draw call. */
export interface Swatch {
  key: HardwareKey;
  material: THREE.MeshStandardMaterial;
  uv: [number, number];
}

const KEYS = Object.keys(DEFS) as HardwareKey[];
const BLOCK = 16;
const GRID = 8;
let atlasTex: { color: THREE.CanvasTexture; rm: THREE.CanvasTexture } | null = null;

function hardwareAtlas(): { color: THREE.CanvasTexture; rm: THREE.CanvasTexture } {
  if (atlasTex) return atlasTex;
  const S = BLOCK * GRID;
  const cc = document.createElement('canvas');
  const rc = document.createElement('canvas');
  cc.width = cc.height = rc.width = rc.height = S;
  const cx = cc.getContext('2d')!;
  const rx = rc.getContext('2d')!;
  KEYS.forEach((k, i) => {
    const d = DEFS[k];
    const x = (i % GRID) * BLOCK;
    const y = Math.floor(i / GRID) * BLOCK;
    cx.fillStyle = d.color;
    cx.fillRect(x, y, BLOCK, BLOCK);
    rx.fillStyle = `rgb(128,${Math.round(d.rough * 255)},${Math.round(d.metal * 255)})`;
    rx.fillRect(x, y, BLOCK, BLOCK);
  });
  const mk = (cv: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.generateMipmaps = false;
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    return t;
  };
  atlasTex = { color: mk(cc, true), rm: mk(rc, false) };
  return atlasTex;
}

const materials = new Map<string, THREE.MeshStandardMaterial>();
const swatches = new Map<string, Swatch>();

/** The shared hardware material for an environment and quality. */
export function hardwareMaterial(env: THREE.Texture | null, q: Quality): THREE.MeshStandardMaterial {
  const ck = `${env?.uuid ?? 'none'}:${q}`;
  let m = materials.get(ck);
  if (!m) {
    const a = hardwareAtlas();
    m = new THREE.MeshStandardMaterial({ map: a.color, roughnessMap: a.rm, metalnessMap: a.rm, roughness: 1, metalness: 1, envMap: env });
    m.name = 'hardware';
    materials.set(ck, m);
  }
  return m;
}

export function hardware(key: HardwareKey, env: THREE.Texture | null, q: Quality): Swatch {
  const ck = `${env?.uuid ?? 'none'}:${q}:${key}`;
  let sw = swatches.get(ck);
  if (!sw) {
    const i = KEYS.indexOf(key);
    const S = BLOCK * GRID;
    const u = ((i % GRID) * BLOCK + BLOCK / 2) / S;
    const v = 1 - (Math.floor(i / GRID) * BLOCK + BLOCK / 2) / S;
    sw = { key, material: hardwareMaterial(env, q), uv: [u, v] };
    swatches.set(ck, sw);
  }
  return sw;
}

/** Point every vertex of a geometry at a swatch. */
export function paintSwatch(g: THREE.BufferGeometry, sw: Swatch): THREE.BufferGeometry {
  const n = g.attributes.position.count;
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    uv[i * 2] = sw.uv[0];
    uv[i * 2 + 1] = sw.uv[1];
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** A standalone mesh using a swatch (for moving parts that cannot merge). */
export function swatchMesh(g: THREE.BufferGeometry, sw: Swatch): THREE.Mesh {
  const m = new THREE.Mesh(paintSwatch(g, sw), sw.material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

let grain: THREE.CanvasTexture | null = null;
/** Tileable grain used as a roughness and bump breakup on hardware. */
export function grainTexture(): THREE.CanvasTexture {
  if (grain) return grain;
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < S * S; i++) {
    const v = 150 + rnd() * 70;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  grain = new THREE.CanvasTexture(cv);
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.repeat.set(6, 6);
  grain.colorSpace = THREE.NoColorSpace;
  return grain;
}

/** The robot's armor material, reading paint, roughness, metalness and bump from its atlas. */
export function armorMaterial(atlas: PaintAtlas, paint: Paint, mat: ArmorMaterialId, env: THREE.Texture | null, q: Quality): THREE.MeshStandardMaterial {
  const physical = q !== 'low';
  const common = {
    map: atlas.colorTex,
    roughnessMap: atlas.rmTex,
    metalnessMap: atlas.rmTex,
    bumpMap: atlas.rmTex,
    bumpScale: 2.2,
    roughness: 1,
    metalness: 1,
    envMap: env,
  };
  let m: THREE.MeshStandardMaterial;
  if (mat === 'polycarb') {
    m = physical
      ? new THREE.MeshPhysicalMaterial({ ...common, transparent: true, clearcoat: 1, clearcoatRoughness: 0.05, specularIntensity: 1, depthWrite: true })
      : new THREE.MeshStandardMaterial({ ...common, transparent: true });
  } else if (physical && paint.finish === 'gloss' && mat !== 'uhmw') {
    m = new THREE.MeshPhysicalMaterial({ ...common, clearcoat: 0.9, clearcoatRoughness: 0.14 });
  } else if (physical && paint.finish === 'metal') {
    m = new THREE.MeshPhysicalMaterial({ ...common, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  } else if (physical && mat === 'uhmw') {
    m = new THREE.MeshPhysicalMaterial({ ...common, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new THREE.Color('#ffffff') });
  } else {
    m = new THREE.MeshStandardMaterial(common);
  }
  m.name = 'armor';
  return m;
}
