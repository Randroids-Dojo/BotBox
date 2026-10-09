// Procedural texture helpers: canvases, value noise, height to normal conversion.

import * as THREE from 'three';
import { Rng } from './rng';

export type Ctx2D = CanvasRenderingContext2D;

export function canvas(w: number, h = w): { c: HTMLCanvasElement; g: Ctx2D } {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: false })!;
  return { c, g };
}

let maxAniso = 8;
export function setMaxAnisotropy(n: number): void {
  maxAniso = n;
}

export interface TexOpts {
  srgb?: boolean;
  repeat?: [number, number];
  aniso?: number;
  mips?: boolean;
}

export function canvasTexture(c: HTMLCanvasElement, o: TexOpts = {}): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = o.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (o.repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(o.repeat[0], o.repeat[1]);
  }
  t.anisotropy = Math.min(maxAniso, o.aniso ?? 8);
  t.generateMipmaps = o.mips !== false;
  t.minFilter = o.mips === false ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** A tileable value noise canvas of `size` with `cells` lattice cells, greyscale. */
export function noiseCanvas(size: number, cells: number, seed: number, octaves = 4): HTMLCanvasElement {
  const { c, g } = canvas(size);
  const img = g.createImageData(size, size);
  const rng = new Rng(seed);
  const lattices: Float32Array[] = [];
  for (let o = 0; o < octaves; o++) {
    const n = cells << o;
    const a = new Float32Array(n * n);
    for (let i = 0; i < a.length; i++) a[i] = rng.next();
    lattices.push(a);
  }
  const fade = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      let amp = 1;
      let norm = 0;
      for (let o = 0; o < octaves; o++) {
        const n = cells << o;
        const fx = (x / size) * n;
        const fy = (y / size) * n;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fade(fx - x0);
        const ty = fade(fy - y0);
        const L = lattices[o];
        const i00 = L[(y0 % n) * n + (x0 % n)];
        const i10 = L[(y0 % n) * n + ((x0 + 1) % n)];
        const i01 = L[((y0 + 1) % n) * n + (x0 % n)];
        const i11 = L[((y0 + 1) % n) * n + ((x0 + 1) % n)];
        v += amp * ((i00 * (1 - tx) + i10 * tx) * (1 - ty) + (i01 * (1 - tx) + i11 * tx) * ty);
        norm += amp;
        amp *= 0.5;
      }
      const b = Math.round((v / norm) * 255);
      const k = (y * size + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = b;
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/**
 * Convert a greyscale height canvas (red channel, 0..255) into a tangent space normal map.
 * Rows are kept in canvas order and the texture is uploaded with flipY so it lines up with
 * canvas textures drawn the same way.
 */
export function heightToNormal(src: HTMLCanvasElement, strength: number, wrap = true): THREE.DataTexture {
  const w = src.width;
  const h = src.height;
  const data = src.getContext('2d')!.getImageData(0, 0, w, h).data;
  const hgt = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) hgt[i] = data[i * 4] / 255;
  const out = new Uint8Array(w * h * 4);
  const at = (x: number, y: number) => {
    if (wrap) {
      x = (x + w) % w;
      y = (y + h) % h;
    } else {
      x = Math.max(0, Math.min(w - 1, x));
      y = Math.max(0, Math.min(h - 1, y));
    }
    return hgt[y * w + x];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      // Canvas y grows downward; texture v grows upward after the flip below.
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
      let nx = -dx;
      let ny = -dy;
      let nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      // Store with row 0 at the bottom (flip) so it matches flipY canvas textures.
      const k = ((h - 1 - y) * w + x) * 4;
      out[k] = (nx * 0.5 + 0.5) * 255;
      out[k + 1] = (ny * 0.5 + 0.5) * 255;
      out[k + 2] = (nz * 0.5 + 0.5) * 255;
      out[k + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = wrap ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = maxAniso;
  t.needsUpdate = true;
  return t;
}

/** Diagonal yellow and black hazard stripe pattern. */
export function hazardPattern(g: Ctx2D, stripe: number, yellow = '#cf9e10', black = '#141414'): CanvasPattern {
  const s = stripe * 2;
  const { c, g: p } = canvas(s, s);
  p.fillStyle = black;
  p.fillRect(0, 0, s, s);
  p.fillStyle = yellow;
  p.beginPath();
  p.moveTo(0, 0);
  p.lineTo(stripe, 0);
  p.lineTo(0, stripe);
  p.closePath();
  p.fill();
  p.beginPath();
  p.moveTo(s, 0);
  p.lineTo(s, stripe);
  p.lineTo(stripe, s);
  p.lineTo(0, s);
  p.closePath();
  p.fill();
  return g.createPattern(c, 'repeat')!;
}

/** A small pre-rendered texture of a hazard stripe band, for meshes. */
export function hazardStripeTexture(px = 256, stripes = 4): THREE.CanvasTexture {
  const { c, g } = canvas(px, px);
  g.fillStyle = hazardPattern(g, px / stripes / 2);
  g.fillRect(0, 0, px, px);
  return canvasTexture(c, { repeat: [1, 1] });
}

/** Rounded rectangle path. */
export function roundRect(g: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

/** Wear a painted layer: punch holes and scratches through it with destination-out. */
export function wear(g: Ctx2D, w: number, h: number, rng: Rng, amount: number, scale = 1): void {
  g.save();
  g.globalCompositeOperation = 'destination-out';
  const n = Math.round(amount * w * h * 0.0004);
  for (let i = 0; i < n; i++) {
    const x = rng.next() * w;
    const y = rng.next() * h;
    g.globalAlpha = rng.range(0.2, 0.9);
    if (rng.chance(0.6)) {
      g.lineWidth = rng.range(0.5, 2.5) * scale;
      g.strokeStyle = '#000';
      g.beginPath();
      g.moveTo(x, y);
      const a = rng.next() * Math.PI * 2;
      const l = rng.range(5, 60) * scale;
      g.quadraticCurveTo(x + Math.cos(a + 0.3) * l * 0.5, y + Math.sin(a + 0.3) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    } else {
      g.fillStyle = '#000';
      g.beginPath();
      g.arc(x, y, rng.range(1, 6) * scale, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
}
