// The crowd: thousands of instanced people animated in a vertex shader, handmade signs and
// camera flashes. One draw call each.

import * as THREE from 'three';
import { ROSTER } from '../../data/roster';
import { Rng } from '../util/rng';
import { canvas, canvasTexture } from '../util/tex';
import { personGeometry } from './people';

export interface Seat {
  pos: THREE.Vector3;
  yaw: number;
  /** Row index from the front, for lighting falloff. */
  row: number;
}

export interface Crowd {
  root: THREE.Group;
  uniforms: { uTime: { value: number }; uExcite: { value: number }; uLight: { value: number } };
  /** Rebuild for a density (0..1 occupancy). */
  setDensity(d: number): void;
}

const CROWD_VERT = /* glsl */ `
attribute float part;
attribute vec3 iOffset;
attribute float iYaw;
attribute vec4 iSeed;
attribute vec3 iShirt;
attribute vec3 iSkin;
uniform float uTime;
uniform float uExcite;
varying vec3 vColor;
varying vec3 vN;
varying vec3 vWorld;
varying float vRow;

mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }

void main() {
  float seed = iSeed.x;
  float ex = clamp(uExcite, 0.0, 1.0);
  // Some people stand when it gets loud.
  float standT = smoothstep(iSeed.y, iSeed.y + 0.25, ex * 1.15);
  float t = uTime * (1.6 + seed * 1.2 + ex * 3.0) + seed * 40.0;
  float bob = (0.01 + ex * 0.06 * iSeed.z) * max(0.0, sin(t));
  vec3 p = position;
  vec3 n = normal;
  if (part >= 2.0) {
    float side = part == 2.0 ? -1.0 : 1.0;
    // Arms: idle clap forward, pump overhead when excited.
    float up = smoothstep(0.25, 0.85, ex + (iSeed.w - 0.5) * 0.6);
    float pump = 0.25 * sin(t * 1.3 + side);
    float clap = 0.6 + 0.12 * sin(uTime * 9.0 + seed * 20.0) * step(0.5, iSeed.w);
    float a = mix(clap, 2.7 + pump, up);
    vec3 pivot = vec3(side * 0.24, 0.6, -0.02);
    mat3 r = rotX(a);
    p = r * (p - pivot) + pivot;
    n = r * n;
  }
  p.y += standT * 0.35 + bob;
  mat3 ry = rotY(iYaw);
  p = ry * p;
  n = ry * n;
  vec3 world = p + iOffset;
  vWorld = world;
  vN = n;
  vColor = part == 1.0 ? iSkin : (part >= 2.0 ? mix(iShirt, iSkin, 0.35) : iShirt);
  vRow = iSeed.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const CROWD_FRAG = /* glsl */ `
uniform float uLight;
varying vec3 vColor;
varying vec3 vN;
varying vec3 vWorld;
void main() {
  vec3 n = normalize(vN);
  // Spill from the lit Box: comes from the arena center, fades with height and distance.
  vec3 toBox = normalize(vec3(-vWorld.x, 2.5 - vWorld.y, -vWorld.z));
  float d = length(vWorld.xz);
  float spill = max(0.0, dot(n, toBox)) * exp(-max(0.0, vWorld.y - 1.0) * 0.22) * (9.0 / (d + 1.0));
  float top = max(0.0, n.y) * 0.05;
  float l = (0.012 + spill * 0.075 + top) * uLight;
  gl_FragColor = vec4(vColor * l, 1.0);
}`;

const SIGN_VERT = /* glsl */ `
attribute vec3 iOffset;
attribute float iYaw;
attribute vec2 iCell;
attribute float iSeed;
uniform float uTime;
uniform float uExcite;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  float t = uTime * (2.0 + uExcite * 4.0) + iSeed * 30.0;
  vec3 p = position;
  // Sway and pump.
  float sway = sin(t * 0.7) * (0.05 + uExcite * 0.12);
  float c = cos(sway), s = sin(sway);
  p = vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
  p.y += max(0.0, sin(t)) * uExcite * 0.18 + uExcite * 0.25;
  float cy = cos(iYaw), sy = sin(iYaw);
  p = vec3(cy * p.x + sy * p.z, p.y, -sy * p.x + cy * p.z);
  vec3 w = p + iOffset;
  vWorld = w;
  vUv = (uv + iCell) * 0.25;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const SIGN_FRAG = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uLight;
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vec4 c = texture2D(uAtlas, vUv);
  if (c.a < 0.5) discard;
  float d = length(vWorld.xz);
  float l = (0.03 + 1.6 / (d + 1.0) * exp(-max(0.0, vWorld.y - 1.5) * 0.15) * 0.25) * uLight;
  gl_FragColor = vec4(c.rgb * l, 1.0);
}`;

const FLASH_VERT = /* glsl */ `
attribute float seed;
uniform float uTime;
uniform float uExcite;
uniform float uScale;
varying float vB;
float hash(float n) { return fract(sin(n) * 43758.5453123); }
void main() {
  float rate = 1.3;
  float slot = floor(uTime * rate + seed * 17.0);
  float ph = fract(uTime * rate + seed * 17.0);
  float chance = 0.004 + uExcite * 0.03;
  float on = step(hash(slot * 13.7 + seed * 91.1), chance);
  vB = on * exp(-ph * 26.0);
  vec4 mv = viewMatrix * vec4(position, 1.0);
  gl_PointSize = vB > 0.002 ? uScale * 0.7 / -mv.z : 0.0;
  gl_Position = projectionMatrix * mv;
}`;

const FLASH_FRAG = /* glsl */ `
varying float vB;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = dot(p, p);
  if (r > 1.0) discard;
  float core = exp(-r * 9.0);
  gl_FragColor = vec4(vec3(0.9, 0.95, 1.0) * core * vB * 40.0, 1.0);
}`;

const SHIRTS = ['#111111', '#141414', '#f0f0f0', '#b8241c', '#1f4fa8', '#e86a10', '#2b6b2b', '#6b6b6b', '#d9c21a', '#5a2a7a', '#3a3a3a', '#1d1d40', '#8a1a1a', '#e0e0e0', '#2a8ad8'];
const SKINS = ['#f1c7a5', '#d9a07a', '#a8714c', '#7a4a2c', '#4d2e1c', '#e8b48e'];

function signAtlas(): THREE.Texture {
  const S = 1024;
  const cell = S / 4;
  const { c, g } = canvas(S);
  const rng = new Rng(404);
  const names = ROSTER.filter((r) => r.loadout.cls === 'heavy').map((r) => r.card.name.toUpperCase());
  const texts = [
    'FLIP IT!', 'MORE SPARKS', `GO ${names[0]}!`, 'HI MOM', 'SAW IT IN HALF', `${names[1]} RULES`, 'BOOM!', 'NUT OR BUST',
    'WE WANT FIRE', 'PULVERIZE!', `GO ${names[3]}`, 'SPIN TO WIN', 'KILL THE WEDGE', 'I DROVE 6 HRS', `${names[5]}!!`, 'SMASH IT',
  ];
  const boards = ['#fbfbf4', '#f7f0a0', '#fdd3e0', '#c9f0ff', '#ffe0b0', '#ffffff'];
  const inks = ['#d01010', '#1030c0', '#101010', '#109020', '#a010a0', '#e05000'];
  const fonts = ['"Marker Felt"', '"Chalkboard SE"', '"Comic Sans MS"', '"Bradley Hand"', 'cursive'];
  texts.forEach((t, i) => {
    const x = (i % 4) * cell;
    const y = Math.floor(i / 4) * cell;
    g.save();
    g.translate(x + cell / 2, y + cell / 2);
    g.rotate(rng.range(-0.04, 0.04));
    g.fillStyle = rng.pick(boards);
    const w = cell * 0.94;
    const h = cell * 0.62;
    g.fillRect(-w / 2, -h / 2, w, h);
    g.fillStyle = rng.pick(inks);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const words = t.toUpperCase().split(' ');
    const lines = words.length > 2 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [words.join(' ')];
    const size = lines.length > 1 ? 54 : 64;
    g.font = `bold ${size}px ${rng.pick(fonts)}, sans-serif`;
    lines.forEach((l, j) => {
      const yy = (j - (lines.length - 1) / 2) * size * 1.05;
      let fs = size;
      while (g.measureText(l).width > w * 0.9 && fs > 20) {
        fs -= 4;
        g.font = `bold ${fs}px ${rng.pick(fonts)}, sans-serif`;
      }
      g.fillText(l, rng.range(-4, 4), yy);
    });
    // Glitter star or underline doodle.
    g.strokeStyle = rng.pick(inks);
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(-w * 0.35, h * 0.38);
    g.quadraticCurveTo(0, h * 0.45, w * 0.35, h * 0.36);
    g.stroke();
    g.restore();
  });
  return canvasTexture(c, { mips: true });
}

export function buildCrowd(seats: Seat[], density: number): Crowd {
  const root = new THREE.Group();
  root.name = 'crowd';
  const uniforms = { uTime: { value: 0 }, uExcite: { value: 0.2 }, uLight: { value: 1 } };
  const personGeo = personGeometry(true);
  const mat = new THREE.ShaderMaterial({ vertexShader: CROWD_VERT, fragmentShader: CROWD_FRAG, uniforms });
  const signMat = new THREE.ShaderMaterial({
    vertexShader: SIGN_VERT,
    fragmentShader: SIGN_FRAG,
    uniforms: { ...uniforms, uAtlas: { value: signAtlas() } },
    side: THREE.DoubleSide,
  });
  const flashMat = new THREE.ShaderMaterial({
    vertexShader: FLASH_VERT,
    fragmentShader: FLASH_FRAG,
    uniforms: { ...uniforms, uScale: { value: 400 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  let meshes: THREE.Object3D[] = [];

  const build = (d: number) => {
    for (const m of meshes) {
      root.remove(m);
      if (m instanceof THREE.Mesh || m instanceof THREE.Points) m.geometry.dispose();
    }
    meshes = [];
    const rng = new Rng(1999);
    const chosen: Seat[] = [];
    for (const s of seats) {
      // Fuller near the front.
      const p = d * (1 - s.row * 0.025);
      if (rng.chance(p)) chosen.push(s);
    }
    const n = chosen.length;
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = personGeo.index;
    geo.setAttribute('position', personGeo.attributes.position);
    geo.setAttribute('normal', personGeo.attributes.normal);
    geo.setAttribute('part', personGeo.attributes.part);
    const off = new Float32Array(n * 3);
    const yaw = new Float32Array(n);
    const seed = new Float32Array(n * 4);
    const shirt = new Float32Array(n * 3);
    const skin = new Float32Array(n * 3);
    const col = new THREE.Color();
    chosen.forEach((s, i) => {
      off.set([s.pos.x + rng.gauss() * 0.04, s.pos.y, s.pos.z + rng.gauss() * 0.04], i * 3);
      yaw[i] = s.yaw + rng.gauss() * 0.15;
      seed.set([rng.next(), rng.range(0.15, 0.95), rng.next(), rng.next()], i * 4);
      col.set(rng.pick(SHIRTS)).convertSRGBToLinear();
      shirt.set([col.r, col.g, col.b], i * 3);
      col.set(rng.pick(SKINS)).convertSRGBToLinear();
      skin.set([col.r, col.g, col.b], i * 3);
    });
    geo.setAttribute('iOffset', new THREE.InstancedBufferAttribute(off, 3));
    geo.setAttribute('iYaw', new THREE.InstancedBufferAttribute(yaw, 1));
    geo.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.setAttribute('iShirt', new THREE.InstancedBufferAttribute(shirt, 3));
    geo.setAttribute('iSkin', new THREE.InstancedBufferAttribute(skin, 3));
    geo.instanceCount = n;
    const people = new THREE.Mesh(geo, mat);
    people.frustumCulled = false;
    people.name = 'people';
    meshes.push(people);

    // Signs: a few dozen, mostly in the lower rows.
    const signers = chosen.filter((s) => s.row < 8 && rng.chance(0.05)).slice(0, 72);
    const quad = new THREE.PlaneGeometry(0.9, 0.58);
    quad.translate(0, 1.45, -0.15);
    const sg = new THREE.InstancedBufferGeometry();
    sg.index = quad.index;
    sg.setAttribute('position', quad.attributes.position);
    sg.setAttribute('uv', quad.attributes.uv);
    const so = new Float32Array(signers.length * 3);
    const sy = new Float32Array(signers.length);
    const sc = new Float32Array(signers.length * 2);
    const ss = new Float32Array(signers.length);
    signers.forEach((s, i) => {
      so.set([s.pos.x, s.pos.y, s.pos.z], i * 3);
      sy[i] = s.yaw;
      const cell = rng.int(0, 15);
      sc.set([cell % 4, 3 - Math.floor(cell / 4)], i * 2);
      ss[i] = rng.next();
    });
    sg.setAttribute('iOffset', new THREE.InstancedBufferAttribute(so, 3));
    sg.setAttribute('iYaw', new THREE.InstancedBufferAttribute(sy, 1));
    sg.setAttribute('iCell', new THREE.InstancedBufferAttribute(sc, 2));
    sg.setAttribute('iSeed', new THREE.InstancedBufferAttribute(ss, 1));
    sg.instanceCount = signers.length;
    const signs = new THREE.Mesh(sg, signMat);
    signs.frustumCulled = false;
    meshes.push(signs);

    // Camera flashes.
    const flashers = chosen.filter(() => rng.chance(0.35));
    const fp = new Float32Array(flashers.length * 3);
    const fs = new Float32Array(flashers.length);
    flashers.forEach((s, i) => {
      fp.set([s.pos.x, s.pos.y + 0.9, s.pos.z], i * 3);
      fs[i] = rng.next();
    });
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(fp, 3));
    fg.setAttribute('seed', new THREE.BufferAttribute(fs, 1));
    const flashes = new THREE.Points(fg, flashMat);
    flashes.frustumCulled = false;
    flashes.renderOrder = 5;
    meshes.push(flashes);
    for (const m of meshes) root.add(m);
  };
  build(density);
  return { root, uniforms, setDensity: build };
}
