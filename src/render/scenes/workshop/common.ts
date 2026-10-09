// Shared pieces for the workshop tiers: the light rig every tier re-tunes (so switching tiers
// never changes the light count and never recompiles a shader), a vertex colored prop batch that
// merges a room's clutter into a few draw calls, and the generated textures the rooms share.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../../util/rng';
import { canvas, canvasTexture, hazardPattern, noiseCanvas } from '../../util/tex';

export type V3 = [number, number, number];

export interface PointLook {
  pos: V3;
  color: THREE.ColorRepresentation;
  intensity: number;
  distance: number;
  decay: number;
}

/** Everything a tier sets on the shared rig and scene. */
export interface TierLook {
  background: THREE.ColorRepresentation;
  fog: [THREE.ColorRepresentation, number, number];
  env: number;
  hemi: [THREE.ColorRepresentation, THREE.ColorRepresentation, number];
  key: { pos: V3; target: V3; color: THREE.ColorRepresentation; intensity: number; angle: number; penumbra: number; distance: number; decay: number };
  rim: { pos: V3; color: THREE.ColorRepresentation; intensity: number };
  fillA: PointLook;
  fillB: PointLook;
  prac: PointLook;
  /** Camera: vertical field of view, default orbit and the farthest it may back away. */
  fov: number;
  /** Where the robot's center sits on a landscape screen, in NDC (default 0.28, a little high). */
  aimY?: number;
  yaw: number;
  pitch: number;
  maxDist: number;
}

export interface GarageLights {
  hemi: THREE.HemisphereLight;
  key: THREE.SpotLight;
  rim: THREE.DirectionalLight;
  fillA: THREE.PointLight;
  fillB: THREE.PointLight;
  prac: THREE.PointLight;
}

export interface WorkshopTier {
  /** Room and props, static. */
  root: THREE.Group;
  /** The top of the turntable for this tier (rides on the spinning group), top face at y 0.23. */
  top: THREE.Object3D;
  look: TierLook;
  /** Per frame animation (a swaying bulb, a flickering TV). Runs only while the tier shows. */
  update?(time: number, dt: number, lights: GarageLights): void;
  /** Team or robot name for banners. */
  setName?(name: string): void;
}

/** Shared textures and materials, built once for all tiers. */
export interface WorkshopKit {
  env: THREE.Texture;
  /** Vertex colored materials for merged clutter. */
  matte: THREE.MeshStandardMaterial;
  satin: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  wood: THREE.MeshStandardMaterial;
  cardboard: THREE.MeshStandardMaterial;
  pegboard: THREE.MeshStandardMaterial;
  block: THREE.MeshStandardMaterial;
  diamond: THREE.Texture;
  hazard: THREE.Texture;
  /** Emissive helper: a basic material bright enough to bloom. */
  glow(color: THREE.ColorRepresentation, k: number): THREE.MeshBasicMaterial;
}

export function createKit(env: THREE.Texture): WorkshopKit {
  const rng = new Rng(4242);
  const glowCache = new Map<string, THREE.MeshBasicMaterial>();
  return {
    env,
    matte: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 }),
    satin: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.9 }),
    chrome: new THREE.MeshStandardMaterial({ color: '#e0e2e6', roughness: 0.14, metalness: 1 }),
    rubber: new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.9, metalness: 0 }),
    wood: new THREE.MeshStandardMaterial({ map: woodTexture(rng), roughness: 0.72 }),
    cardboard: new THREE.MeshStandardMaterial({ map: cardboardTexture(rng), roughness: 0.9 }),
    pegboard: new THREE.MeshStandardMaterial({ map: pegboardTexture(), roughness: 0.85 }),
    block: new THREE.MeshStandardMaterial({ map: blockTexture(), roughness: 0.9 }),
    diamond: diamondPlate(),
    hazard: hazardRing(),
    glow(color, k) {
      const key = `${new THREE.Color(color).getHexString()}:${k}`;
      let m = glowCache.get(key);
      if (!m) {
        m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) });
        glowCache.set(key, m);
      }
      return m;
    },
  };
}

// ------------------------------------------------------------------------------ prop batch

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

/** Merges many small colored parts into one geometry with a color attribute. */
export class PropBatch {
  private parts: THREE.BufferGeometry[] = [];

  /** Add a geometry placed at (x, y, z) with euler rotation and scale, in one color. */
  add(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): this {
    _q.setFromEuler(_e.set(rx, ry, rz));
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    return this.addMatrix(g, color, _m);
  }

  addMatrix(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, m: THREE.Matrix4): this {
    const c = g.index ? g.toNonIndexed() : g.clone();
    g.dispose();
    for (const name of Object.keys(c.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') c.deleteAttribute(name);
    if (!c.attributes.normal) c.computeVertexNormals();
    if (!c.attributes.uv) c.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(c.attributes.position.count * 2), 2));
    c.applyMatrix4(m);
    _c.set(color);
    const n = c.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([_c.r, _c.g, _c.b], i * 3);
    c.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts.push(c);
    return this;
  }

  /** Axis aligned box from min to max corners. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: THREE.ColorRepresentation): this {
    return this.add(new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)), color, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  }

  /** A box of size (w, h, d) centered at (x, y, z) turned by ry about Y and rz, rx. */
  block(w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, ry = 0, rx = 0, rz = 0): this {
    return this.add(new THREE.BoxGeometry(w, h, d), color, x, y, z, rx, ry, rz);
  }

  /** A cylinder between two points. */
  rod(a: THREE.Vector3, b: THREE.Vector3, r: number, color: THREE.ColorRepresentation, seg = 8): this {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _p.subVectors(b, a).normalize());
    _m.compose(a.clone().add(b).multiplyScalar(0.5), _q, _s.set(1, 1, 1));
    return this.addMatrix(g, color, _m);
  }

  get count(): number {
    return this.parts.length;
  }

  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    g.computeBoundingSphere();
    return g;
  }

  /** Build into a mesh with shadows. */
  mesh(mat: THREE.Material, cast = true, receive = true): THREE.Mesh {
    const m = new THREE.Mesh(this.build(), mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    return m;
  }
}

/** A plane of size w by h centered at (x, y, z), facing +Z then turned by ry (and rx). */
export function plane(w: number, h: number, mat: THREE.Material, x: number, y: number, z: number, ry = 0, rx = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, 0, 'YXZ');
  m.receiveShadow = true;
  return m;
}

/** Inward facing room walls as one mesh (back faces cull, so a camera outside a wall sees
 *  through it). `uvScale` is texture repeats per meter. */
export function roomShell(x0: number, x1: number, z0: number, z1: number, h: number, mat: THREE.Material, uvScale: number, opts: { back?: boolean; left?: boolean; right?: boolean; front?: boolean; ceiling?: boolean } = {}): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  const wall = (w: number, hh: number, x: number, y: number, z: number, ry: number, rx = 0) => {
    const g = new THREE.PlaneGeometry(w, hh);
    const uv = g.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w * uvScale, uv.getY(i) * hh * uvScale);
    g.rotateX(rx);
    g.rotateY(ry);
    g.translate(x, y, z);
    parts.push(g);
  };
  const W = x1 - x0;
  const D = z1 - z0;
  if (opts.back !== false) wall(W, h, (x0 + x1) / 2, h / 2, z0, 0);
  if (opts.front !== false) wall(W, h, (x0 + x1) / 2, h / 2, z1, Math.PI);
  if (opts.left !== false) wall(D, h, x0, h / 2, (z0 + z1) / 2, Math.PI / 2);
  if (opts.right !== false) wall(D, h, x1, h / 2, (z0 + z1) / 2, -Math.PI / 2);
  if (opts.ceiling !== false) wall(W, D, (x0 + x1) / 2, h, (z0 + z1) / 2, 0, Math.PI / 2);
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------------------------ textures

export function concreteTexture(rng: Rng, base = '#4e4b47', stains = 14, size = 1024): THREE.CanvasTexture {
  const S = size;
  const { c, g } = canvas(S);
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = 0.6;
  g.drawImage(noiseCanvas(128, 4, rng.int(1, 999), 4), 0, 0, S, S);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  for (let i = 0; i < stains; i++) {
    const x = rng.next() * S;
    const y = rng.next() * S;
    const r = rng.range(20, 110) * (S / 1024);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(15,12,8,0.6)');
    grd.addColorStop(1, 'rgba(15,12,8,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(x, y, r, r * rng.range(0.5, 1), rng.next() * 3, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = 'rgba(20,18,15,0.7)';
  g.lineWidth = 3;
  for (const t of [S / 3, (2 * S) / 3]) {
    g.beginPath();
    g.moveTo(t, 0);
    g.lineTo(t, S);
    g.moveTo(0, t);
    g.lineTo(S, t);
    g.stroke();
  }
  return canvasTexture(c, { repeat: [2, 2] });
}

export function blockTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(512);
  g.fillStyle = '#8a8378';
  g.fillRect(0, 0, 512, 512);
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = 0.5;
  g.drawImage(noiseCanvas(128, 8, 7, 4), 0, 0, 512, 512);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = 'rgba(40,36,30,0.8)';
  g.lineWidth = 4;
  for (let row = 0; row < 8; row++) {
    const y = row * 64;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(512, y);
    g.stroke();
    for (let col = 0; col < 4; col++) {
      const x = col * 128 + (row % 2) * 64;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y + 64);
      g.stroke();
    }
  }
  return canvasTexture(c, { repeat: [9, 3.6] });
}

export function pegboardTexture(): THREE.CanvasTexture {
  const { c, g } = canvas(1024, 456);
  g.fillStyle = '#a07a50';
  g.fillRect(0, 0, 1024, 456);
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = 0.35;
  g.drawImage(noiseCanvas(128, 8, 9, 3), 0, 0, 1024, 456);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#1a120a';
  for (let y = 10; y < 456; y += 19)
    for (let x = 10; x < 1024; x += 19) {
      g.beginPath();
      g.arc(x, y, 3.2, 0, Math.PI * 2);
      g.fill();
    }
  g.strokeStyle = 'rgba(30,30,30,0.6)';
  g.lineWidth = 3;
  for (let i = 0; i < 9; i++) g.strokeRect(30 + i * 28, 60, 10, 50 + i * 7);
  return canvasTexture(c);
}

export function woodTexture(rng: Rng, base = '#7a5532'): THREE.CanvasTexture {
  const { c, g } = canvas(512, 128);
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 80; i++) {
    g.strokeStyle = `rgba(40,22,10,${rng.range(0.1, 0.3)})`;
    g.lineWidth = rng.range(1, 3);
    g.beginPath();
    const y = rng.next() * 128;
    g.moveTo(0, y);
    g.bezierCurveTo(170, y + rng.range(-8, 8), 340, y + rng.range(-8, 8), 512, y + rng.range(-5, 5));
    g.stroke();
  }
  for (let i = 0; i < 12; i++) {
    g.fillStyle = 'rgba(15,8,2,0.5)';
    g.beginPath();
    g.arc(rng.next() * 512, rng.next() * 128, rng.range(3, 12), 0, Math.PI * 2);
    g.fill();
  }
  return canvasTexture(c, { repeat: [1, 1] });
}

function cardboardTexture(rng: Rng): THREE.CanvasTexture {
  const { c, g } = canvas(256);
  g.fillStyle = '#9b7748';
  g.fillRect(0, 0, 256, 256);
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = 0.25;
  g.drawImage(noiseCanvas(64, 4, 31, 3), 0, 0, 256, 256);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  // Corrugation lines, tape and a scrawled label.
  g.strokeStyle = 'rgba(70,50,25,0.18)';
  for (let x = 0; x < 256; x += 5) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 256);
    g.stroke();
  }
  g.fillStyle = 'rgba(200,170,110,0.55)';
  g.fillRect(0, 112, 256, 30);
  g.fillStyle = 'rgba(25,20,15,0.75)';
  g.font = 'bold 26px "Marker Felt", "Comic Sans MS", cursive';
  g.save();
  g.translate(128, 200);
  g.rotate(rng.range(-0.08, 0.08));
  g.textAlign = 'center';
  g.fillText(rng.pick(['PARTS', 'MISC', 'WIRES', 'JUGG', 'KEEP']), 0, 0);
  g.restore();
  return canvasTexture(c);
}

export function diamondPlate(): THREE.CanvasTexture {
  const { c, g } = canvas(256);
  g.fillStyle = '#9aa0a8';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#c8ccd2';
  for (let y = 0; y < 256; y += 32) {
    for (let x = 0; x < 256; x += 32) {
      for (const [dx, dy, a] of [
        [8, 8, 0.785],
        [24, 24, -0.785],
      ]) {
        g.save();
        g.translate(x + dx, y + dy);
        g.rotate(a);
        g.fillRect(-9, -2, 18, 4);
        g.restore();
      }
    }
  }
  return canvasTexture(c, { repeat: [6, 6] });
}

export function hazardRing(): THREE.CanvasTexture {
  const { c, g } = canvas(512, 32);
  g.fillStyle = hazardPattern(g, 16);
  g.fillRect(0, 0, 512, 32);
  return canvasTexture(c, { repeat: [8, 1] });
}

/** A vinyl banner with a gradient, a wordmark and a tagline. */
export function bannerCanvas(w: number, h: number, name: string, tag: string, bg: [string, string], ink: string, stroke: string): HTMLCanvasElement {
  const { c, g } = canvas(w, h);
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, bg[0]);
  grd.addColorStop(1, bg[1]);
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  g.globalAlpha = 0.3;
  g.strokeStyle = '#ffffff';
  g.lineWidth = h * 0.08;
  g.beginPath();
  g.moveTo(-20, h * 0.95);
  g.quadraticCurveTo(w * 0.5, h * 0.1, w + 20, h * 0.6);
  g.stroke();
  g.globalAlpha = 1;
  let size = h * 0.5;
  const font = (s: number) => `italic 900 ${s}px "Arial Black", Impact, sans-serif`;
  g.font = font(size);
  while (g.measureText(name).width > w * 0.88 && size > 10) g.font = font((size -= 4));
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.lineWidth = size * 0.12;
  g.strokeStyle = stroke;
  g.strokeText(name, w / 2, h * 0.42);
  g.fillStyle = ink;
  g.fillText(name, w / 2, h * 0.42);
  g.font = `italic bold ${Math.round(h * 0.13)}px Verdana, Arial, sans-serif`;
  g.fillText(tag, w / 2, h * 0.82);
  // Grommets.
  g.fillStyle = '#d0d0d0';
  for (const [x, y] of [
    [14, 14],
    [w - 14, 14],
    [14, h - 14],
    [w - 14, h - 14],
  ]) {
    g.beginPath();
    g.arc(x, y, 6, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

/** Hex nut silhouette for hanging tools, scrap and decals. */
export function hexPrism(r: number, t: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r, t, 6);
}
