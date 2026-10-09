// Per-robot paint atlas. Every armor panel (and the spinning shell, when there is one) gets a
// cell in two canvases: `color` (sRGB albedo, alpha for polycarbonate) and `rm` (R bump height,
// G roughness, B metalness, used as bump, roughness and metalness map at once). Panel geometry
// maps its outer face to its cell in meters, so patterns, decals, edge wear and later damage are
// all drawn in real units at the right spot.
import * as THREE from 'three';
import type { ArmorMaterialId, Facet, Paint } from '../../contract';
import { Rand, luminance, mix, shade } from './util';

export type PanelRole = 'top' | 'belly' | 'front' | 'slope' | 'rear' | 'side' | 'wedgeplate' | 'guard' | 'skirt' | 'shell' | 'bulkhead';

export interface PaintItem {
  id: string;
  /** Size of the face in meters (local x and y extents). */
  w: number;
  h: number;
  role: PanelRole;
  facet?: Facet;
  /** Panel-local (x, y, outer z) to robot frame. Identity for skins. */
  matrix: THREE.Matrix4;
}

export interface AtlasCell {
  x: number;
  y: number;
  /** Pixel size of the content area. */
  pw: number;
  ph: number;
  /** Pixels per meter. */
  k: number;
  item: PaintItem;
}

/** Bare material look, used for raw finishes, chips and scratches. */
export const BARE: Record<ArmorMaterialId, { color: string; rough: number; metal: number; spark: string }> = {
  aluminum: { color: '#b4b9bf', rough: 0.36, metal: 1, spark: '#ffc070' },
  titanium: { color: '#79828d', rough: 0.3, metal: 1, spark: '#ffffff' },
  steel: { color: '#55595e', rough: 0.48, metal: 0.95, spark: '#ff9a3a' },
  uhmw: { color: '#ece9e0', rough: 0.55, metal: 0, spark: '#ffffff' },
  polycarb: { color: '#d8e2e6', rough: 0.12, metal: 0, spark: '#ffffff' },
};

const SWATCHES = ['bolt', 'raw', 'dark', 'rubber'] as const;
export type Swatch = (typeof SWATCHES)[number];

const PAD = 6;
const FONT = '"Arial Black", "Arial Bold", Impact, "Helvetica Neue", Helvetica, sans-serif';

function rmStyle(bump: number, rough: number, metal: number): string {
  return `rgb(${Math.round(bump * 255)},${Math.round(rough * 255)},${Math.round(metal * 255)})`;
}

interface Palette {
  base: string;
  p: string;
  s: string;
  a: string;
  dark: string;
  light: string;
  bare: string;
}

export class PaintAtlas {
  readonly size: number;
  readonly color: HTMLCanvasElement;
  readonly rm: HTMLCanvasElement;
  readonly colorTex: THREE.CanvasTexture;
  readonly rmTex: THREE.CanvasTexture;
  readonly cells = new Map<string, AtlasCell>();
  private swatch = new Map<Swatch, { x: number; y: number; s: number }>();
  private cx: CanvasRenderingContext2D;
  private rx: CanvasRenderingContext2D;
  private dirty = false;
  private paintRM: string;
  private bareRM: string;

  constructor(
    private items: PaintItem[],
    private paint: Paint,
    private material: ArmorMaterialId,
    private name: string,
    size: number,
    private scale: number,
    private botLength: number,
    private hullH: number,
  ) {
    this.size = size;
    this.color = document.createElement('canvas');
    this.rm = document.createElement('canvas');
    this.color.width = this.color.height = size;
    this.rm.width = this.rm.height = size;
    this.cx = this.color.getContext('2d', { willReadFrequently: false })!;
    this.rx = this.rm.getContext('2d')!;
    this.pack();
    this.colorTex = new THREE.CanvasTexture(this.color);
    this.colorTex.colorSpace = THREE.SRGBColorSpace;
    this.rmTex = new THREE.CanvasTexture(this.rm);
    this.rmTex.colorSpace = THREE.NoColorSpace;
    for (const t of [this.colorTex, this.rmTex]) {
      t.anisotropy = 4;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
    }
    const f = paint.finish;
    const bare = BARE[material];
    const plastic = material === 'uhmw' || material === 'polycarb';
    this.paintRM = plastic
      ? rmStyle(0.5, material === 'polycarb' ? 0.1 : 0.5, 0)
      : f === 'gloss'
        ? rmStyle(0.5, 0.3, 0)
        : f === 'matte'
          ? rmStyle(0.5, 0.72, 0)
          : f === 'metal'
            ? rmStyle(0.5, 0.34, 0.75)
            : rmStyle(0.5, 0.6, 0);
    this.bareRM = rmStyle(0.46, bare.rough, bare.metal);
    this.repaint();
  }

  // ------------------------------------------------------------------------------- layout

  private pack(): void {
    const S = this.size;
    const swatchPx = Math.max(12, Math.round(S / 48));
    // Shelf packing at a shared density, shrinking until everything fits.
    let k = S * 1.2;
    for (let attempt = 0; attempt < 60; attempt++) {
      this.cells.clear();
      let x = 0;
      let y = 0;
      let shelfH = 0;
      let ok = true;
      const sorted = [...this.items].sort((a, b) => b.h - a.h);
      for (const it of sorted) {
        let kk = k;
        // Long skins (the shell) get a lower density so they do not starve the panels.
        if (it.w * kk + PAD * 2 > S) kk = (S - PAD * 2) / it.w;
        const pw = Math.max(4, Math.ceil(it.w * kk));
        const ph = Math.max(4, Math.ceil(it.h * kk));
        if (x + pw + PAD * 2 > S) {
          x = 0;
          y += shelfH;
          shelfH = 0;
        }
        if (y + ph + PAD * 2 > S - swatchPx - PAD) {
          ok = false;
          break;
        }
        this.cells.set(it.id, { x: x + PAD, y: y + PAD, pw, ph, k: kk, item: it });
        x += pw + PAD * 2;
        shelfH = Math.max(shelfH, ph + PAD * 2);
      }
      if (ok) break;
      k *= 0.93;
    }
    SWATCHES.forEach((s, i) => this.swatch.set(s, { x: PAD + i * (swatchPx + PAD * 2), y: S - swatchPx - PAD, s: swatchPx }));
  }

  /** Atlas uv of a point in a cell's local meters (x right, y up, centered). */
  uv(id: string, x: number, y: number, out: [number, number] = [0, 0]): [number, number] {
    const c = this.cells.get(id);
    if (!c) {
      out[0] = out[1] = 0;
      return out;
    }
    const it = c.item;
    const px = c.x + (x + it.w / 2) * c.k;
    const py = c.y + (it.h / 2 - y) * c.k;
    out[0] = px / this.size;
    out[1] = 1 - py / this.size;
    return out;
  }

  swatchUV(s: Swatch): [number, number] {
    const w = this.swatch.get(s)!;
    return [(w.x + w.s / 2) / this.size, 1 - (w.y + w.s / 2) / this.size];
  }

  // ------------------------------------------------------------------------------- painting

  private palette(): Palette {
    const p = this.paint;
    const bare = BARE[this.material].color;
    let base = p.primary;
    if (p.finish === 'raw') base = bare;
    if (this.material === 'uhmw') base = mix(p.primary, luminance(p.primary) > 0.35 ? '#f4f2ea' : '#1a1a1a', 0.35);
    return {
      base,
      p: p.primary,
      s: p.secondary,
      a: p.accent,
      dark: luminance(p.primary) > 0.4 ? shade(p.primary, -0.65) : '#0c0c0c',
      light: luminance(p.primary) > 0.75 ? '#1a1a1a' : '#f5f3ec',
      bare,
    };
  }

  /** Draw the whole robot from scratch (new robot or damage reset). */
  repaint(): void {
    const S = this.size;
    const cx = this.cx;
    const rx = this.rx;
    cx.setTransform(1, 0, 0, 1, 0, 0);
    rx.setTransform(1, 0, 0, 1, 0, 0);
    cx.clearRect(0, 0, S, S);
    cx.fillStyle = '#333';
    cx.fillRect(0, 0, S, S);
    rx.fillStyle = rmStyle(0.5, 0.6, 0);
    rx.fillRect(0, 0, S, S);
    const pal = this.palette();
    for (const c of this.cells.values()) this.paintCell(c, pal);
    this.paintSwatches();
    this.dirty = true;
    this.flush();
  }

  private paintSwatches(): void {
    const sw = (s: Swatch, color: string, rm: string) => {
      const w = this.swatch.get(s)!;
      this.cx.fillStyle = color;
      this.cx.fillRect(w.x - PAD, w.y - PAD, w.s + PAD * 2, w.s + PAD * 2);
      this.rx.fillStyle = rm;
      this.rx.fillRect(w.x - PAD, w.y - PAD, w.s + PAD * 2, w.s + PAD * 2);
    };
    const boltColor = this.paint.finish === 'raw' || this.material === 'steel' ? '#3a3c3f' : '#a6a49a';
    sw('bolt', boltColor, rmStyle(0.5, 0.38, 1));
    sw('raw', BARE[this.material === 'uhmw' || this.material === 'polycarb' ? 'aluminum' : this.material].color, rmStyle(0.5, 0.42, 1));
    sw('dark', '#1d1e20', rmStyle(0.5, 0.55, 0.6));
    sw('rubber', '#141414', rmStyle(0.5, 0.9, 0));
  }

  /** Set a canvas transform so drawing is in the cell's meters, x right, y up, origin centered. */
  private enter(ctx: CanvasRenderingContext2D, c: AtlasCell): void {
    ctx.setTransform(c.k, 0, 0, -c.k, c.x + (c.item.w / 2) * c.k, c.y + (c.item.h / 2) * c.k);
  }

  private clipCell(ctx: CanvasRenderingContext2D, c: AtlasCell, pad = 0): void {
    ctx.beginPath();
    const p = pad / c.k;
    ctx.rect(-c.item.w / 2 - p, -c.item.h / 2 - p, c.item.w + 2 * p, c.item.h + 2 * p);
    ctx.clip();
  }

  private paintCell(c: AtlasCell, pal: Palette): void {
    const it = c.item;
    const rng = new Rand(`${this.name}:${it.id}`);
    for (const mode of ['color', 'rm'] as const) {
      const ctx = mode === 'color' ? this.cx : this.rx;
      ctx.save();
      this.enter(ctx, c);
      this.clipCell(ctx, c, PAD);
      const fill = (role: keyof Palette): string => {
        if (mode === 'color') return pal[role];
        if (role === 'bare') return this.bareRM;
        if (role === 'base' && this.paint.finish === 'raw') return this.bareRM;
        return this.paintRM;
      };
      ctx.fillStyle = fill('base');
      ctx.fillRect(-it.w, -it.h, it.w * 2, it.h * 2);
      if (this.paint.finish === 'raw' || this.material === 'uhmw') this.bareTexture(ctx, c, mode, new Rand(`${this.name}:${it.id}:bare`));
      this.pattern(ctx, c, fill, mode, new Rand(`${this.name}:${it.id}:pat`));
      this.labels(ctx, c, fill, mode);
      this.wear(ctx, c, mode, rng);
      ctx.restore();
    }
    if (this.material === 'polycarb') this.polycarbAlpha(c);
  }

  /** Brushed lines, mill scale or plastic texture on unpainted material. */
  private bareTexture(ctx: CanvasRenderingContext2D, c: AtlasCell, mode: 'color' | 'rm', r: Rand): void {
    const it = c.item;
    const n = Math.min(400, Math.round(it.w * it.h * 900));
    ctx.lineWidth = 0.6 / c.k;
    for (let i = 0; i < n; i++) {
      const y = r.range(-it.h / 2, it.h / 2);
      const x = r.range(-it.w / 2, it.w / 2);
      const len = r.range(0.05, 0.4);
      const light = r.chance(0.5);
      ctx.strokeStyle = mode === 'color' ? (light ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)') : light ? 'rgba(0,40,0,0.06)' : 'rgba(0,0,0,0.05)';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y + r.range(-0.002, 0.002));
      ctx.stroke();
    }
    if (this.material === 'steel') {
      // Mill scale: dark blue-gray blotches.
      for (let i = 0; i < Math.round(it.w * it.h * 60); i++) {
        const x = r.range(-it.w / 2, it.w / 2);
        const y = r.range(-it.h / 2, it.h / 2);
        const rad = r.range(0.02, 0.09);
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        const col = mode === 'color' ? 'rgba(30,36,46,0.35)' : 'rgba(0,150,200,0.25)';
        g.addColorStop(0, col);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
    }
  }

  /** Robot frame point of a cell-local point on the outer face. */
  private toRobot(it: PaintItem, x: number, y: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(x, y, 0).applyMatrix4(it.matrix);
  }

  /** Direction (robot frame) of the cell's local +x axis. */
  private axisX(it: PaintItem): THREE.Vector3 {
    const o = this.toRobot(it, 0, 0);
    return this.toRobot(it, 1, 0).sub(o);
  }

  private pattern(ctx: CanvasRenderingContext2D, c: AtlasCell, fill: (r: keyof Palette) => string, mode: 'color' | 'rm', r: Rand): void {
    const it = c.item;
    const s = this.scale;
    const role = it.role;
    const W = it.w;
    const H = it.h;
    const flat = role === 'top' || role === 'belly' || role === 'front' || role === 'rear' || role === 'slope' || role === 'wedgeplate';
    const isSide = role === 'side' || role === 'guard' || role === 'skirt';
    const robotY = (y: number) => this.toRobot(it, 0, y).y;
    // Which end of a side cell is the robot's front.
    const ax = this.axisX(it);
    const frontSign = ax.z > 0.5 ? -1 : ax.z < -0.5 ? 1 : 0;
    switch (this.paint.pattern) {
      case 'solid': {
        if (role === 'top' || role === 'side' || role === 'shell') {
          ctx.strokeStyle = fill('a');
          ctx.lineWidth = 0.008 * s;
          const inset = 0.03 * s;
          roundRect(ctx, -W / 2 + inset, -H / 2 + inset, W - 2 * inset, H - 2 * inset, 0.03 * s);
          ctx.stroke();
        }
        break;
      }
      case 'stripes': {
        const sw = 0.055 * s;
        const gap = 0.025 * s;
        if (flat || role === 'shell') {
          // Racing stripes run nose to tail, so they read on top, front and rear.
          const along = role === 'shell' ? 'h' : 'v';
          for (const sgn of [-1, 1]) {
            const x0 = sgn * (gap + sw / 2);
            ctx.fillStyle = fill('s');
            if (along === 'v') ctx.fillRect(x0 - sw / 2, -H, sw, H * 2);
            else ctx.fillRect(-W, x0 - sw / 2 - H * 0.1, W * 2, sw);
            ctx.fillStyle = fill('a');
            const lw = 0.008 * s;
            if (along === 'v') {
              ctx.fillRect(x0 - sw / 2 - lw * 1.8, -H, lw, H * 2);
              ctx.fillRect(x0 + sw / 2 + lw * 0.8, -H, lw, H * 2);
            }
          }
        } else if (isSide) {
          // A band along the side.
          const y0 = this.botHeightBand(it, 0.42);
          const bh = 0.06 * s;
          ctx.fillStyle = fill('s');
          ctx.fillRect(-W, y0 - bh / 2, W * 2, bh);
          ctx.fillStyle = fill('a');
          ctx.fillRect(-W, y0 + bh / 2 + 0.006 * s, W * 2, 0.008 * s);
          ctx.fillRect(-W, y0 - bh / 2 - 0.014 * s, W * 2, 0.008 * s);
        }
        break;
      }
      case 'flames': {
        if (isSide && frontSign !== 0) this.flames(ctx, it, fill, mode, r, frontSign, robotY);
        else if (role === 'top' || role === 'shell') this.flames(ctx, it, fill, mode, r, role === 'shell' ? -1 : 0, robotY);
        else if (role === 'front' || role === 'slope' || role === 'wedgeplate') {
          ctx.fillStyle = fill('s');
          ctx.fillRect(-W, -H, W * 2, H * 2);
          this.flames(ctx, it, fill, mode, r, 2, robotY);
        }
        break;
      }
      case 'checker': {
        const q = 0.05 * s;
        const band = (y0: number, rows: number) => {
          for (let row = 0; row < rows; row++)
            for (let i = Math.floor(-W / 2 / q) - 1; i < W / 2 / q + 1; i++) {
              ctx.fillStyle = fill((i + row) % 2 === 0 ? 's' : 'a');
              ctx.fillRect(i * q, y0 + row * q, q, q);
            }
        };
        if (role === 'top' || role === 'belly' || role === 'shell') {
          for (let j = Math.floor(-H / 2 / q) - 1; j < H / 2 / q + 1; j++) band(j * q, 1);
        } else if (isSide) {
          band(this.botHeightBand(it, 0.3) - q, 2);
        } else {
          band(-H / 2 + 0.02 * s, 1);
        }
        break;
      }
      case 'hazard': {
        const sw = 0.055 * s;
        const diag = (y0: number, y1: number) => {
          ctx.save();
          ctx.beginPath();
          ctx.rect(-W, y0, W * 2, y1 - y0);
          ctx.clip();
          ctx.fillStyle = fill('s');
          for (let x = -W - H; x < W + H; x += sw * 2) {
            ctx.beginPath();
            ctx.moveTo(x, y0 - 0.01);
            ctx.lineTo(x + sw, y0 - 0.01);
            ctx.lineTo(x + sw + (y1 - y0) + 0.02, y1 + 0.01);
            ctx.lineTo(x + (y1 - y0) + 0.02, y1 + 0.01);
            ctx.closePath();
            ctx.fill();
          }
          ctx.restore();
        };
        if (role === 'front' || role === 'slope' || role === 'wedgeplate' || role === 'rear') diag(-H, H);
        else if (role === 'top' || role === 'shell') {
          diag(H / 2 - 0.1 * s, H);
          diag(-H, -H / 2 + 0.1 * s);
        } else if (isSide) {
          const yb = this.botHeightBand(it, 0.0);
          diag(-H, Math.max(-H / 2 + 0.05 * s, yb + 0.07 * s));
        }
        break;
      }
      case 'camo': {
        const n = Math.round((W * H) / (0.012 * s * s)) + 3;
        const cols: (keyof Palette)[] = ['s', 'a', 'dark', 's'];
        for (let i = 0; i < n; i++) {
          const x = r.range(-W / 2, W / 2);
          const y = r.range(-H / 2, H / 2);
          const rad = r.range(0.03, 0.09) * s;
          ctx.fillStyle = fill(cols[i % cols.length]);
          blob(ctx, x, y, rad, r);
        }
        break;
      }
      case 'splatter': {
        const n = Math.max(2, Math.round((W * H) / (0.05 * s * s)));
        for (let i = 0; i < n; i++) {
          ctx.fillStyle = fill(i % 3 === 2 ? 'a' : 's');
          splat(ctx, r.range(-W / 2, W / 2), r.range(-H / 2, H / 2), r.range(0.035, 0.08) * s, r);
        }
        break;
      }
      case 'number': {
        // A contrasting stripe plus a race roundel (the roundel itself is drawn with the labels).
        if (isSide || flat) {
          ctx.fillStyle = fill('s');
          if (isSide) ctx.fillRect(-W, this.botHeightBand(it, 0.15) - 0.02 * s, W * 2, 0.035 * s);
          else ctx.fillRect(-W / 2 + 0.03 * s, -H, 0.03 * s, H * 2);
        }
        break;
      }
    }
  }

  /** Cell-local y of a height `f` (0 floor of hull, 1 top) for a vertical cell. */
  private botHeightBand(it: PaintItem, f: number): number {
    const o = this.toRobot(it, 0, 0);
    const up = this.toRobot(it, 0, 1).sub(o).y || 1;
    return (f * this.hullH - o.y) / up;
  }

  private flames(
    ctx: CanvasRenderingContext2D,
    it: PaintItem,
    fill: (r: keyof Palette) => string,
    mode: 'color' | 'rm',
    r: Rand,
    dir: number,
    _robotY: (y: number) => number,
  ): void {
    const W = it.w;
    const H = it.h;
    const s = this.scale;
    // dir: -1 or 1 = front at local -x or +x (flames run along x). 0 = top (front at +y).
    // 2 = flames rising up the face.
    ctx.save();
    let along = W;
    let across = H;
    if (dir === 0) {
      ctx.rotate(-Math.PI / 2);
      along = H;
      across = W;
    } else if (dir === 2) {
      ctx.rotate(Math.PI / 2);
      along = H;
      across = W;
    } else if (dir === 1) {
      ctx.scale(-1, 1);
    }
    // Now flames start at local x = -along/2 and lick toward +x.
    const x0 = -along / 2 - 0.02 * s;
    const n = Math.max(3, Math.round(across / (0.07 * s)));
    const grad = mode === 'color' ? ctx.createLinearGradient(x0, 0, x0 + Math.min(along, this.botLength) * 0.8, 0) : null;
    if (grad) {
      grad.addColorStop(0, '#fff6c0');
      grad.addColorStop(0.18, this.paint.accent);
      grad.addColorStop(0.55, this.paint.secondary);
      grad.addColorStop(1, shade(this.paint.secondary, -0.25));
    }
    const path = new Path2D();
    path.moveTo(x0, -across / 2 - 0.01);
    for (let i = 0; i < n; i++) {
      const yA = -across / 2 + (i / n) * across;
      const yB = -across / 2 + ((i + 1) / n) * across;
      const len = along * r.range(0.35, 0.75);
      const tip = x0 + len;
      const curl = (yB - yA) * r.range(0.4, 1.1);
      path.bezierCurveTo(x0 + len * 0.35, yA, tip - len * 0.2, yA - curl * 0.2, tip, (yA + yB) / 2 + curl * 0.5);
      path.bezierCurveTo(tip - len * 0.25, (yA + yB) / 2 + curl * 0.1, x0 + len * 0.3, yB + (yB - yA) * 0.1, x0 + len * 0.15, yB);
    }
    path.lineTo(x0, across / 2 + 0.01);
    path.closePath();
    ctx.fillStyle = grad ?? fill('s');
    ctx.fill(path);
    ctx.lineWidth = 0.007 * s;
    ctx.strokeStyle = mode === 'color' ? shade(this.paint.secondary, -0.6) : fill('s');
    ctx.stroke(path);
    ctx.restore();
  }

  /** Decal, name, stickers. */
  private labels(ctx: CanvasRenderingContext2D, c: AtlasCell, fill: (r: keyof Palette) => string, mode: 'color' | 'rm'): void {
    const it = c.item;
    const s = this.scale;
    const decal = (this.paint.decal ?? '').toUpperCase();
    const number = this.paint.pattern === 'number';
    const shellDecal = it.role === 'shell';
    if ((it.role === 'top' || shellDecal) && decal) {
      if (number && !shellDecal) {
        this.roundel(ctx, 0, 0, Math.min(it.w, it.h) * 0.36, decal, fill);
      } else {
        const maxW = shellDecal ? it.w * 0.2 : it.w * 0.84;
        const maxH = shellDecal ? it.h * 0.55 : Math.min(it.h * 0.42, 0.17 * s);
        this.text(ctx, decal, 0, shellDecal ? 0 : -it.h * 0.08, maxW, maxH, fill, true);
        if (shellDecal) this.text(ctx, decal, it.w / 2, 0, maxW, maxH, fill, true);
      }
    }
    if (it.role === 'belly' && decal && this.paint.pattern !== 'solid') {
      this.text(ctx, decal, 0, 0, it.w * 0.7, Math.min(it.h * 0.3, 0.12 * s), fill, true);
    }
    if (it.role === 'side' && it.w > 0.3 * s) {
      const name = this.name.toUpperCase();
      if (number) {
        const rr = Math.min(it.h * 0.42, 0.11 * s);
        this.roundel(ctx, 0, this.botHeightBand(it, 0.55), rr, decal || '1', fill);
      } else {
        this.text(ctx, name, 0, this.botHeightBand(it, 0.58), it.w * 0.72, Math.min(it.h * 0.36, 0.085 * s), fill, false);
      }
    }
    if (mode === 'color' && it.role === 'rear') this.stickers(ctx, it);
    if (mode === 'color' && it.role === 'side' && it.w > 0.4 * s) this.sideStickers(ctx, it);
  }

  private roundel(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, text: string, fill: (r: keyof Palette) => string): void {
    ctx.save();
    ctx.fillStyle = fill('light');
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = r * 0.08;
    ctx.strokeStyle = fill('a');
    ctx.stroke();
    ctx.restore();
    this.text(ctx, text, x, y, r * 1.5, r * 1.1, (k) => (k === 'light' ? fill('dark') : k === 'p' ? fill('dark') : fill(k)), true, true);
  }

  /** Heavy italic text with an outline and drop shadow, fit to a box. y is the center. */
  private text(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxW: number,
    maxH: number,
    fill: (r: keyof Palette) => string,
    big: boolean,
    plain = false,
  ): void {
    if (!text) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, -1);
    const px = 100;
    ctx.font = `italic 900 ${px}px ${FONT}`;
    const m = ctx.measureText(text);
    const sc = Math.min(maxW / Math.max(1, m.width), maxH / (px * 0.78));
    ctx.scale(sc, sc);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lp = luminance(this.paint.primary);
    const ls = luminance(this.paint.secondary);
    // Text color: whichever of light/accent contrasts most with the primary.
    const face = plain ? fill('light') : Math.abs(luminance(this.paint.accent) - lp) > 0.35 ? fill('a') : lp > 0.5 ? fill('dark') : fill('light');
    const outline = plain ? fill('light') : Math.abs(ls - lp) > 0.2 && big ? fill('s') : lp > 0.5 ? fill('light') : fill('dark');
    if (!plain) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillText(text, 6, 6);
      ctx.lineJoin = 'round';
      ctx.lineWidth = 16;
      ctx.strokeStyle = outline;
      ctx.strokeText(text, 0, 0);
    }
    ctx.fillStyle = face;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  /** Inspection and parts stickers on the rear panel. */
  private stickers(ctx: CanvasRenderingContext2D, it: PaintItem): void {
    const s = this.scale;
    const r = new Rand(`${this.name}:stickers`);
    const sz = 0.055 * s;
    let x = -it.w / 2 + 0.05 * s;
    const y = it.h / 2 - 0.035 * s - sz / 2;
    const place = (draw: (w: number) => number) => {
      const used = draw(sz);
      x += used + 0.012 * s;
    };
    // Tech inspection sticker.
    place((w) => {
      ctx.save();
      ctx.translate(x + w / 2, y);
      ctx.rotate(r.range(-0.06, 0.06));
      ctx.fillStyle = '#f4f4ef';
      ctx.fillRect(-w / 2, -w / 2, w, w);
      ctx.fillStyle = '#1f8a3a';
      ctx.fillRect(-w / 2, w * 0.12, w, w * 0.38);
      ctx.scale(1, -1);
      ctx.fillStyle = '#fff';
      ctx.font = `900 ${w * 0.22}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('PASSED', 0, -w * 0.22);
      ctx.fillStyle = '#111';
      ctx.font = `700 ${w * 0.2}px ${FONT}`;
      ctx.fillText('2001', 0, w * 0.2);
      ctx.restore();
      return w;
    });
    // Danger triangle.
    place((w) => {
      ctx.save();
      ctx.translate(x + w / 2, y);
      ctx.fillStyle = '#ffd400';
      ctx.strokeStyle = '#111';
      ctx.lineWidth = w * 0.07;
      ctx.beginPath();
      ctx.moveTo(0, w * 0.48);
      ctx.lineTo(w * 0.52, -w * 0.42);
      ctx.lineTo(-w * 0.52, -w * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.scale(1, -1);
      ctx.fillStyle = '#111';
      ctx.font = `900 ${w * 0.5}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('!', 0, w * 0.32);
      ctx.restore();
      return w;
    });
    // Master switch label.
    place((w) => {
      ctx.save();
      ctx.translate(x + w * 0.8, y);
      ctx.fillStyle = '#c4161c';
      ctx.fillRect(-w * 0.8, -w * 0.25, w * 1.6, w * 0.5);
      ctx.scale(1, -1);
      ctx.fillStyle = '#fff';
      ctx.font = `900 ${w * 0.24}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('KILL SW', 0, 0);
      ctx.restore();
      return w * 1.6;
    });
  }

  private sideStickers(ctx: CanvasRenderingContext2D, it: PaintItem): void {
    const s = this.scale;
    const r = new Rand(`${this.name}:${it.id}:side`);
    if (!r.chance(0.7)) return;
    const w = 0.07 * s;
    const h = 0.025 * s;
    const ax = this.axisX(it);
    const rear = ax.z > 0 ? 1 : -1;
    ctx.save();
    ctx.translate(rear * (it.w / 2 - 0.06 * s - w / 2), this.botHeightBand(it, 0.85) - h);
    ctx.rotate(r.range(-0.04, 0.04));
    const labels = ['NiCad PWR', 'HI-AMP', '24 VOLT', 'TORQUE+', 'RPM', 'GEARS'];
    ctx.fillStyle = r.pick(['#111111', '#f2f2f2', '#e8c200', '#c4161c']);
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.scale(1, -1);
    ctx.fillStyle = ctx.fillStyle === '#f2f2f2' || ctx.fillStyle === '#e8c200' ? '#111' : '#fff';
    ctx.font = `italic 900 ${h * 0.62}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(r.pick(labels), 0, 0, w * 0.92);
    ctx.restore();
  }

  /** Chipped paint along edges, scuffs and grime toward the floor. */
  private wear(ctx: CanvasRenderingContext2D, c: AtlasCell, mode: 'color' | 'rm', r: Rand): void {
    const it = c.item;
    const s = this.scale;
    const W = it.w;
    const H = it.h;
    const plastic = this.material === 'uhmw' || this.material === 'polycarb';
    const bare = mode === 'color' ? (plastic ? 'rgba(255,255,255,0.5)' : BARE[this.material].color) : this.bareRM;
    if (this.paint.finish !== 'raw' || plastic) {
      const per = (W + H) * 2;
      const n = Math.round(per * (plastic ? 12 : 30));
      for (let i = 0; i < n; i++) {
        const t = r.next() * per;
        let x: number;
        let y: number;
        if (t < W) [x, y] = [-W / 2 + t, -H / 2];
        else if (t < W + H) [x, y] = [W / 2, -H / 2 + (t - W)];
        else if (t < 2 * W + H) [x, y] = [W / 2 - (t - W - H), H / 2];
        else [x, y] = [-W / 2, H / 2 - (t - 2 * W - H)];
        const inward = r.range(0, 0.006 * s);
        x += x > 0 ? -inward : inward;
        y += y > 0 ? -inward : inward;
        ctx.fillStyle = bare;
        // Chips are stretched along the edge they sit on.
        const alongX = Math.abs(Math.abs(y) - H / 2) < Math.abs(Math.abs(x) - W / 2);
        const big = r.chance(0.12) ? 2.2 : 1;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(alongX ? 2.2 : 0.7, alongX ? 0.7 : 2.2);
        blob(ctx, 0, 0, r.range(0.0015, 0.005) * s * big, r);
        ctx.restore();
      }
    }
    // Scuffs and fine scratches, mostly low on the sides.
    const scuffs = Math.round(W * H * 70);
    ctx.lineWidth = 0.0012 * s;
    for (let i = 0; i < scuffs; i++) {
      const x = r.range(-W / 2, W / 2);
      const y = r.range(-H / 2, H / 2);
      const a = r.range(-0.5, 0.5) + (r.chance(0.5) ? 0 : Math.PI / 2);
      const len = r.range(0.01, 0.07) * s;
      ctx.strokeStyle = mode === 'color' ? (plastic ? 'rgba(255,255,255,0.12)' : 'rgba(205,208,212,0.16)') : this.bareRM;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
    if (mode === 'color' && (it.role === 'side' || it.role === 'front' || it.role === 'rear' || it.role === 'skirt' || it.role === 'guard')) {
      const g = ctx.createLinearGradient(0, -H / 2, 0, -H / 2 + 0.08 * s);
      g.addColorStop(0, 'rgba(20,16,12,0.45)');
      g.addColorStop(1, 'rgba(20,16,12,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-W, -H / 2, W * 2, 0.08 * s);
    }
  }

  /** Polycarbonate is clear where unpainted: knock the base alpha down, keep graphics solid. */
  private polycarbAlpha(c: AtlasCell): void {
    const ctx = this.cx;
    const x0 = c.x - PAD;
    const y0 = c.y - PAD;
    const w = c.pw + PAD * 2;
    const h = c.ph + PAD * 2;
    const img = ctx.getImageData(x0, y0, w, h);
    const base = new THREE.Color(this.palette().base);
    const br = base.r * 255;
    const bg = base.g * 255;
    const bb = base.b * 255;
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const diff = Math.abs(d[i] - br) + Math.abs(d[i + 1] - bg) + Math.abs(d[i + 2] - bb);
      if (diff < 40) {
        // Smoky tinted clear plastic.
        d[i + 3] = 70;
      } else d[i + 3] = 235;
    }
    ctx.putImageData(img, x0, y0);
  }

  // ------------------------------------------------------------------------------- damage

  /** Scratches, gouges and scorch at a cell-local point. `dir` is a cell-local direction. */
  damage(id: string, x: number, y: number, dx: number, dy: number, energy: number, kind: 'spinner' | 'blunt' | 'saw' | 'heat', seed: number): void {
    const c = this.cells.get(id);
    if (!c) return;
    const r = new Rand(seed);
    const s = this.scale;
    const e = Math.min(1, Math.sqrt(Math.max(0, energy)) / 120);
    const plastic = this.material === 'uhmw' || this.material === 'polycarb';
    const a = Math.atan2(dy, dx) || r.range(0, Math.PI);
    const bare = BARE[this.material];
    for (const mode of ['color', 'rm'] as const) {
      const ctx = mode === 'color' ? this.cx : this.rx;
      ctx.save();
      this.enter(ctx, c);
      this.clipCell(ctx, c, PAD);
      const rr = new Rand(seed);
      if (this.material === 'polycarb' && kind !== 'heat') {
        this.crack(ctx, x, y, (0.05 + e * 0.2) * s, mode, rr);
      } else if (kind === 'heat') {
        const rad = (0.05 + e * 0.12) * s;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        if (mode === 'color') {
          g.addColorStop(0, 'rgba(10,8,6,0.85)');
          g.addColorStop(0.5, 'rgba(25,18,12,0.45)');
          g.addColorStop(1, 'rgba(30,20,10,0)');
        } else {
          g.addColorStop(0, rmStyle(0.5, 0.92, 0.1));
          g.addColorStop(1, 'rgba(128,235,26,0)');
        }
        ctx.fillStyle = g;
        ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      } else {
        // A fan of scratches along the hit direction, plus a gouge for heavy spinner hits.
        const n = 3 + Math.round(e * 8);
        const len = (0.04 + e * 0.22) * s;
        for (let i = 0; i < n; i++) {
          const off = rr.range(-0.03, 0.03) * s * (0.5 + e);
          const aa = a + rr.range(-0.12, 0.12);
          const ox = x - Math.sin(aa) * off - (Math.cos(aa) * len) / 2;
          const oy = y + Math.cos(aa) * off - (Math.sin(aa) * len) / 2;
          const l = len * rr.range(0.4, 1.1);
          ctx.lineWidth = rr.range(0.001, 0.003) * s;
          ctx.lineCap = 'round';
          ctx.strokeStyle = mode === 'color' ? (plastic ? 'rgba(255,255,255,0.75)' : 'rgba(225,228,232,0.95)') : rmStyle(0.38, 0.3, plastic ? 0 : 1);
          ctx.beginPath();
          ctx.moveTo(ox, oy);
          ctx.lineTo(ox + Math.cos(aa) * l, oy + Math.sin(aa) * l);
          ctx.stroke();
        }
        if (kind === 'spinner' || kind === 'saw' || e > 0.5) {
          const gl = len * (kind === 'saw' ? 1.3 : 0.9);
          const gw = (0.008 + e * 0.02) * s;
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(a);
          // Torn bright lip around a dark trench.
          ctx.fillStyle = mode === 'color' ? (plastic ? '#f6f6f2' : shade(bare.color, 0.35)) : rmStyle(0.62, 0.28, plastic ? 0 : 1);
          gouge(ctx, gl * 1.08, gw * 1.6, rr);
          ctx.fillStyle = mode === 'color' ? (plastic ? shade(this.palette().base, -0.3) : shade(bare.color, -0.45)) : rmStyle(0.15, 0.55, plastic ? 0 : 0.9);
          gouge(ctx, gl, gw, rr);
          ctx.restore();
        }
        if (!plastic && (kind === 'spinner' || kind === 'saw')) {
          // Heat tint from friction.
          const rad = (0.02 + e * 0.05) * s;
          const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
          g.addColorStop(0, mode === 'color' ? 'rgba(70,40,90,0.35)' : 'rgba(128,140,240,0.2)');
          g.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = g;
          ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
        }
        // Chipped paint flakes around the impact.
        if (this.paint.finish !== 'raw' && !plastic) {
          ctx.fillStyle = mode === 'color' ? bare.color : this.bareRM;
          for (let i = 0; i < 4 + e * 14; i++) blob(ctx, x + rr.range(-1, 1) * len * 0.5, y + rr.range(-1, 1) * len * 0.3, rr.range(0.002, 0.01) * s, rr);
        }
      }
      ctx.restore();
    }
    this.dirty = true;
  }

  private crack(ctx: CanvasRenderingContext2D, x: number, y: number, len: number, mode: 'color' | 'rm', r: Rand): void {
    ctx.strokeStyle = mode === 'color' ? 'rgba(255,255,255,0.9)' : rmStyle(0.45, 0.35, 0);
    ctx.lineCap = 'round';
    const branch = (px: number, py: number, a: number, l: number, depth: number) => {
      let cx = px;
      let cy = py;
      const steps = 5;
      ctx.lineWidth = (0.0016 + depth * 0.0006) * this.scale;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      for (let i = 0; i < steps; i++) {
        a += r.range(-0.4, 0.4);
        cx += (Math.cos(a) * l) / steps;
        cy += (Math.sin(a) * l) / steps;
        ctx.lineTo(cx, cy);
        if (depth > 0 && r.chance(0.3)) branch(cx, cy, a + r.range(-1.2, 1.2), l * 0.5, depth - 1);
      }
      ctx.stroke();
    };
    const arms = 4 + r.int(0, 3);
    for (let i = 0; i < arms; i++) branch(x, y, (i / arms) * Math.PI * 2 + r.range(-0.3, 0.3), len * r.range(0.5, 1), 2);
    // Crazed white spot at the impact.
    const g = ctx.createRadialGradient(x, y, 0, x, y, len * 0.18);
    g.addColorStop(0, mode === 'color' ? 'rgba(255,255,255,0.8)' : rmStyle(0.4, 0.5, 0));
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - len, y - len, len * 2, len * 2);
  }

  /** Soot from a fire, spread around a cell-local point. */
  soot(id: string, x: number, y: number, amount: number, seed: number): void {
    const c = this.cells.get(id);
    if (!c) return;
    const r = new Rand(seed);
    for (const mode of ['color', 'rm'] as const) {
      const ctx = mode === 'color' ? this.cx : this.rx;
      ctx.save();
      this.enter(ctx, c);
      this.clipCell(ctx, c, PAD);
      for (let i = 0; i < 3; i++) {
        const px = x + r.range(-0.12, 0.12) * this.scale;
        const py = y + r.range(-0.05, 0.15) * this.scale;
        const rad = r.range(0.06, 0.16) * this.scale;
        const g = ctx.createRadialGradient(px, py, 0, px, py, rad);
        g.addColorStop(0, mode === 'color' ? `rgba(8,7,6,${0.35 * amount})` : `rgba(128,240,0,${0.3 * amount})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(px - rad, py - rad, rad * 2, rad * 2);
      }
      ctx.restore();
    }
    this.dirty = true;
  }

  /** Push pending canvas changes to the GPU. */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.colorTex.needsUpdate = true;
    this.rmTex.needsUpdate = true;
  }

  dispose(): void {
    this.colorTex.dispose();
    this.rmTex.dispose();
    this.color.width = this.color.height = 1;
    this.rm.width = this.rm.height = 1;
  }
}

// ------------------------------------------------------------------------------- shapes

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rng: Rand): void {
  const n = 7;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * rng.range(0.55, 1.25);
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

function splat(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rng: Rand): void {
  blob(ctx, x, y, r, rng);
  const drops = 6 + rng.int(0, 6);
  for (let i = 0; i < drops; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = r * rng.range(1.1, 2.4);
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * rng.range(0.06, 0.2), 0, Math.PI * 2);
    ctx.fill();
    // Streak back toward the splat.
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6);
    ctx.lineTo(x + Math.cos(a + 0.08) * d, y + Math.sin(a + 0.08) * d);
    ctx.lineTo(x + Math.cos(a - 0.08) * d, y + Math.sin(a - 0.08) * d);
    ctx.closePath();
    ctx.fill();
  }
}

function gouge(ctx: CanvasRenderingContext2D, len: number, w: number, r: Rand): void {
  ctx.beginPath();
  ctx.moveTo(-len / 2, 0);
  const n = 6;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    ctx.lineTo(-len / 2 + t * len, (w / 2) * Math.sin(t * Math.PI) * r.range(0.7, 1.2) + (t > 0.7 ? w * 0.2 : 0));
  }
  for (let i = n - 1; i >= 1; i--) {
    const t = i / n;
    ctx.lineTo(-len / 2 + t * len, (-w / 2) * Math.sin(t * Math.PI) * r.range(0.7, 1.2));
  }
  ctx.closePath();
  ctx.fill();
}
