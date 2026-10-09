// Generated sprite textures for the fx layer: billowy smoke puffs, flame licks, a soft glow and
// a floor scorch mark. All procedural, built once and shared.
import * as THREE from 'three';
import { mulberry } from './sparks';

function valueNoise(size: number, cells: number, seed: number): Float32Array {
  const r = mulberry(seed);
  const g = new Float32Array((cells + 1) * (cells + 1));
  for (let i = 0; i < g.length; i++) g[i] = r();
  // Wrap so the noise tiles.
  for (let i = 0; i <= cells; i++) {
    g[i * (cells + 1) + cells] = g[i * (cells + 1)];
    g[cells * (cells + 1) + i] = g[i];
  }
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const a = g[iy * (cells + 1) + ix];
      const b = g[iy * (cells + 1) + ix + 1];
      const c = g[(iy + 1) * (cells + 1) + ix];
      const d = g[(iy + 1) * (cells + 1) + ix + 1];
      out[y * size + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  return out;
}

function fbm(size: number, seed: number): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 0.5;
  let total = 0;
  for (let o = 0; o < 4; o++) {
    const n = valueNoise(size, 4 << o, seed + o * 31);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

let smoke: THREE.CanvasTexture | null = null;
/** 2x2 atlas of smoke puffs: RGB carries subtle self-shadowing, alpha the billow. */
export function smokeTexture(): THREE.CanvasTexture {
  if (smoke) return smoke;
  const C = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = C * 2;
  const ctx = cv.getContext('2d')!;
  for (let cell = 0; cell < 4; cell++) {
    const n = fbm(C, 100 + cell * 7);
    const img = ctx.createImageData(C, C);
    for (let y = 0; y < C; y++)
      for (let x = 0; x < C; x++) {
        const dx = (x + 0.5) / C - 0.5;
        const dy = (y + 0.5) / C - 0.5;
        const r = Math.hypot(dx, dy) * 2;
        const v = n[y * C + x];
        const fall = Math.max(0, 1 - r * (0.7 + v * 0.75));
        const a = Math.min(1, Math.pow(fall, 1.1) * (0.2 + v * v * 2.2));
        // Darker toward the bottom-right, like light from above.
        const lit = 0.75 + 0.25 * (0.5 - dy) + (v - 0.5) * 0.35;
        const i = (y * C + x) * 4;
        const c = Math.max(0, Math.min(255, lit * 235));
        img.data[i] = c;
        img.data[i + 1] = c;
        img.data[i + 2] = c;
        img.data[i + 3] = Math.max(0, Math.min(255, a * 255));
      }
    ctx.putImageData(img, (cell % 2) * C, Math.floor(cell / 2) * C);
  }
  smoke = new THREE.CanvasTexture(cv);
  smoke.colorSpace = THREE.SRGBColorSpace;
  return smoke;
}

let flame: THREE.CanvasTexture | null = null;
/** 2x2 atlas of flame tongues and a round glow, white cores fading out. */
export function flameTexture(): THREE.CanvasTexture {
  if (flame) return flame;
  const C = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = C * 2;
  const ctx = cv.getContext('2d')!;
  for (let cell = 0; cell < 4; cell++) {
    const n = fbm(C, 300 + cell * 13);
    const img = ctx.createImageData(C, C);
    for (let y = 0; y < C; y++)
      for (let x = 0; x < C; x++) {
        const u = (x + 0.5) / C - 0.5;
        const v = 1 - (y + 0.5) / C; // 0 bottom, 1 top
        let a: number;
        if (cell === 3) {
          // Round glow.
          const r = Math.hypot(u, v - 0.5) * 2;
          a = Math.pow(Math.max(0, 1 - r), 2.2);
        } else {
          // Teardrop: wide at the bottom third, tapering to a tip, broken up by noise.
          const width = 0.42 * Math.sin(Math.min(1, v * 1.1) * Math.PI) * (1 - v * 0.55);
          const wobble = (n[y * C + x] - 0.5) * 0.35;
          const d = Math.abs(u + wobble * v) / Math.max(0.02, width);
          a = Math.max(0, 1 - d) * Math.min(1, v * 6) * (0.6 + 0.6 * n[y * C + x]);
          a = Math.pow(a, 0.8);
        }
        const i = (y * C + x) * 4;
        img.data[i] = 255;
        img.data[i + 1] = 255;
        img.data[i + 2] = 255;
        img.data[i + 3] = Math.max(0, Math.min(255, a * 255));
      }
    ctx.putImageData(img, (cell % 2) * C, Math.floor(cell / 2) * C);
  }
  flame = new THREE.CanvasTexture(cv);
  flame.colorSpace = THREE.NoColorSpace;
  return flame;
}

let scorch: THREE.CanvasTexture | null = null;
/** Floor burn: a dark blotch with radial streaks and soot speckle. */
export function scorchTexture(): THREE.CanvasTexture {
  if (scorch) return scorch;
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const r = mulberry(5);
  const c = S / 2;
  // Streaks thrown outward from the center.
  ctx.lineCap = 'round';
  for (let i = 0; i < 40; i++) {
    const a = r() * Math.PI * 2;
    const len = S * (0.18 + r() * 0.3);
    const g = ctx.createLinearGradient(c, c, c + Math.cos(a) * len, c + Math.sin(a) * len);
    g.addColorStop(0, 'rgba(18,14,10,0.55)');
    g.addColorStop(1, 'rgba(18,14,10,0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 2 + r() * 6;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.cos(a) * len, c + Math.sin(a) * len);
    ctx.stroke();
  }
  // Soft core.
  const g = ctx.createRadialGradient(c, c, 0, c, c, S * 0.32);
  g.addColorStop(0, 'rgba(14,11,8,0.9)');
  g.addColorStop(0.55, 'rgba(18,14,10,0.55)');
  g.addColorStop(1, 'rgba(20,16,12,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  // Speckle so it reads as soot, not paint.
  for (let i = 0; i < 260; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.pow(r(), 1.3) * S * 0.42;
    ctx.fillStyle = `rgba(16,12,9,${0.1 + r() * 0.25})`;
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, 0.5 + r() * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  scorch = new THREE.CanvasTexture(cv);
  scorch.colorSpace = THREE.SRGBColorSpace;
  return scorch;
}
