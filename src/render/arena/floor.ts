// The Box floor: bolted steel plates with weld seams, wear, scorch, hazard paint, the start
// squares and the center logo. Everything is drawn on canvases at load.

import * as THREE from 'three';
import { ARENA_HALF, KILLSAWS, PULVERIZERS, RAMRODS, START_SQUARES } from '../../data/arena';
import { Rng } from '../util/rng';
import { canvas, canvasTexture, hazardPattern, heightToNormal, noiseCanvas, wear, type Ctx2D } from '../util/tex';

const SIZE_M = ARENA_HALF * 2;
/** Plates per side. 12 plates of about 1.2 m. */
const PLATES = 12;

export interface FloorTextures {
  map: THREE.Texture;
  orm: THREE.Texture;
  normal: THREE.Texture;
}

export function buildFloorTextures(res: number): FloorTextures {
  const rng = new Rng(2001);
  const S = res;
  const k = S / SIZE_M;
  const X = (x: number) => (x + ARENA_HALF) * k;
  const Z = (z: number) => (z + ARENA_HALF) * k;

  // ---------------------------------------------------------------- albedo
  const { c: albedo, g } = canvas(S);
  g.fillStyle = '#4c4f53';
  g.fillRect(0, 0, S, S);

  // Mottled mill scale at two scales.
  const n1 = noiseCanvas(128, 4, 11, 4);
  const n2 = noiseCanvas(256, 16, 12, 3);
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = 0.55;
  g.drawImage(n1, 0, 0, S, S);
  g.globalAlpha = 0.35;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) g.drawImage(n2, (i * S) / 2, (j * S) / 2, S / 2, S / 2);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;

  // Plate to plate tone variation.
  const P = S / PLATES;
  for (let i = 0; i < PLATES; i++) {
    for (let j = 0; j < PLATES; j++) {
      const v = rng.range(-1, 1);
      g.fillStyle = v > 0 ? `rgba(200,205,210,${v * 0.06})` : `rgba(0,0,0,${-v * 0.12})`;
      g.fillRect(i * P, j * P, P, P);
    }
  }

  // Tire tracks: dark rubber arcs, in pairs.
  for (let i = 0; i < 70; i++) {
    const cx = rng.range(0.1, 0.9) * S;
    const cy = rng.range(0.1, 0.9) * S;
    const r = rng.range(0.8, 5) * k;
    const a0 = rng.next() * Math.PI * 2;
    const a1 = a0 + rng.range(0.4, 2.2);
    const gap = rng.range(0.35, 0.6) * k;
    g.strokeStyle = `rgba(8,8,8,${rng.range(0.06, 0.16)})`;
    g.lineWidth = rng.range(0.05, 0.1) * k;
    for (const off of [0, gap]) {
      g.beginPath();
      g.arc(cx, cy, r + off, a0, a1);
      g.stroke();
    }
  }
  // Polished swirls where robots scrub around.
  g.globalCompositeOperation = 'screen';
  for (let i = 0; i < 50; i++) {
    g.strokeStyle = `rgba(150,155,160,${rng.range(0.03, 0.08)})`;
    g.lineWidth = rng.range(0.1, 0.4) * k;
    g.beginPath();
    g.arc(rng.next() * S, rng.next() * S, rng.range(0.5, 3) * k, rng.next() * 6, rng.next() * 6 + 1.5);
    g.stroke();
  }
  g.globalCompositeOperation = 'source-over';

  // Scorch marks.
  const scorch = (x: number, z: number, r: number, a: number) => {
    const grd = g.createRadialGradient(X(x), Z(z), 0, X(x), Z(z), r * k);
    grd.addColorStop(0, `rgba(12,8,4,${a})`);
    grd.addColorStop(0.45, `rgba(30,18,10,${a * 0.6})`);
    grd.addColorStop(0.75, `rgba(50,55,110,${a * 0.18})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(X(x), Z(z), r * k, r * k * rng.range(0.5, 1), rng.next() * 3, 0, Math.PI * 2);
    g.fill();
  };
  for (let i = 0; i < 16; i++) scorch(rng.range(-6.5, 6.5), rng.range(-6.5, 6.5), rng.range(0.25, 0.9), rng.range(0.35, 0.7));
  for (const p of PULVERIZERS) for (let i = 0; i < 4; i++) scorch(p.center.x + rng.gauss() * 0.3, p.center.z + rng.gauss() * 0.3, rng.range(0.3, 0.7), 0.6);
  for (const s of KILLSAWS) scorch(s.center.x + rng.gauss() * 0.15, s.center.z + rng.gauss() * 0.3, rng.range(0.25, 0.5), 0.5);

  // Gouges and spinner bites: bright cuts with a dark lip.
  const gouge = (x: number, y: number, a: number, l: number, w: number) => {
    const dx = Math.cos(a) * l;
    const dy = Math.sin(a) * l;
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(10,10,10,0.6)';
    g.lineWidth = w * 1.8;
    g.beginPath();
    g.moveTo(x + 1, y + 1);
    g.lineTo(x + dx + 1, y + dy + 1);
    g.stroke();
    g.strokeStyle = 'rgba(150,154,160,0.55)';
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + dx, y + dy);
    g.stroke();
  };
  // Clustered where robots fight, few elsewhere.
  for (let c = 0; c < 14; c++) {
    const cx = rng.range(0.15, 0.85) * S;
    const cy = rng.range(0.15, 0.85) * S;
    const n = rng.int(3, 12);
    const a0 = rng.next() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      gouge(cx + rng.gauss() * 0.4 * k, cy + rng.gauss() * 0.4 * k, a0 + rng.gauss() * 0.4, rng.range(0.04, 0.3) * k, rng.range(0.6, 2.0) * (S / 2048));
    }
  }
  // Saw scars: arcs across the killsaw strips.
  for (const s of KILLSAWS) {
    for (let i = 0; i < 6; i++) {
      g.strokeStyle = `rgba(185,190,195,${rng.range(0.25, 0.6)})`;
      g.lineWidth = rng.range(0.8, 1.6) * (S / 2048);
      g.beginPath();
      const r = rng.range(0.3, 0.9) * k;
      const a = rng.next() * Math.PI * 2;
      g.arc(X(s.center.x) + rng.gauss() * 8, Z(s.center.z) + rng.gauss() * 20, r, a, a + rng.range(0.3, 1));
      g.stroke();
    }
  }

  // Weld seams and plate bolts.
  drawSeams(g, S, k, rng);

  // ------------------------------------------------------------------ paint layer
  const { c: paint, g: pg } = canvas(S);
  const band = 0.15 * k;
  pg.fillStyle = hazardPattern(pg, 0.09 * k);
  const ringRect = (x0: number, z0: number, x1: number, z1: number) => {
    pg.beginPath();
    pg.rect(X(x0) - band, Z(z0) - band, X(x1) - X(x0) + band * 2, Z(z1) - Z(z0) + band * 2);
    pg.rect(X(x0), Z(z0), X(x1) - X(x0), Z(z1) - Z(z0));
    pg.fill('evenodd');
  };
  // Killsaw strips.
  for (const x of [...new Set(KILLSAWS.map((s) => s.center.x))]) {
    const strip = KILLSAWS.filter((s) => s.center.x === x);
    const zMin = Math.min(...strip.map((s) => s.center.z - s.length / 2)) - 0.3;
    const zMax = Math.max(...strip.map((s) => s.center.z + s.length / 2)) + 0.3;
    ringRect(x - 0.42, zMin, x + 0.42, zMax);
  }
  // Ramrod patches.
  for (const r of RAMRODS) ringRect(r.center.x - r.hx - 0.12, r.center.z - r.hz - 0.12, r.center.x + r.hx + 0.12, r.center.z + r.hz + 0.12);
  // Pulverizer strike circles.
  for (const p of PULVERIZERS) {
    pg.beginPath();
    pg.arc(X(p.center.x), Z(p.center.z), (p.radius + 0.15) * k, 0, Math.PI * 2);
    pg.arc(X(p.center.x), Z(p.center.z), p.radius * k, 0, Math.PI * 2, true);
    pg.fill();
  }
  // Start squares.
  for (const s of START_SQUARES) {
    const rumble = s.corner === 'green' || s.corner === 'yellow';
    const x0 = X(s.center.x - s.half);
    const y0 = Z(s.center.z - s.half);
    const w = s.half * 2 * k;
    if (rumble) {
      pg.strokeStyle = s.color;
      pg.globalAlpha = 0.55;
      pg.lineWidth = 0.08 * k;
      pg.strokeRect(x0, y0, w, w);
      pg.globalAlpha = 1;
      continue;
    }
    pg.fillStyle = s.color;
    pg.globalAlpha = 0.7;
    pg.fillRect(x0, y0, w, w);
    pg.globalAlpha = 1;
    pg.strokeStyle = 'rgba(240,240,235,0.9)';
    pg.lineWidth = 0.06 * k;
    pg.strokeRect(x0 + 0.1 * k, y0 + 0.1 * k, w - 0.2 * k, w - 0.2 * k);
    pg.save();
    pg.translate(X(s.center.x), Z(s.center.z));
    pg.fillStyle = 'rgba(240,240,235,0.85)';
    pg.font = `italic 900 ${0.42 * k}px "Arial Black", Impact, sans-serif`;
    pg.textAlign = 'center';
    pg.textBaseline = 'middle';
    pg.fillText(s.corner.toUpperCase(), 0, 0);
    pg.restore();
  }
  drawCenterLogo(pg, S / 2, S / 2, k);
  wear(pg, S, S, rng, 2.2, S / 2048);

  // Hazard hardware painted dark under the meshes: saw slots and ramrod holes.
  g.drawImage(paint, 0, 0);
  for (const s of KILLSAWS) {
    g.fillStyle = '#1b1c1e';
    g.fillRect(X(s.center.x - 0.16), Z(s.center.z - s.length / 2 - 0.12), 0.32 * k, (s.length + 0.24) * k);
    g.fillStyle = '#020202';
    g.fillRect(X(s.center.x - s.width / 2), Z(s.center.z - s.length / 2), s.width * k, s.length * k);
  }
  for (const r of RAMRODS) {
    g.fillStyle = '#2a2b2d';
    g.fillRect(X(r.center.x - r.hx), Z(r.center.z - r.hz), r.hx * 2 * k, r.hz * 2 * k);
    for (let i = 0; i < r.cols; i++) {
      for (let j = 0; j < r.rows; j++) {
        const x = r.center.x - r.hx + ((i + 0.5) / r.cols) * r.hx * 2;
        const z = r.center.z - r.hz + ((j + 0.5) / r.rows) * r.hz * 2;
        g.fillStyle = '#030303';
        g.beginPath();
        g.arc(X(x), Z(z), r.spikeRadius * 1.6 * k, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  // Battered strike plates.
  for (const p of PULVERIZERS) {
    const grd = g.createRadialGradient(X(p.center.x), Z(p.center.z), 0, X(p.center.x), Z(p.center.z), p.radius * k);
    grd.addColorStop(0, 'rgba(20,18,16,0.55)');
    grd.addColorStop(0.6, 'rgba(40,40,42,0.35)');
    grd.addColorStop(1, 'rgba(0,0,0,0.1)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(X(p.center.x), Z(p.center.z), p.radius * k, 0, Math.PI * 2);
    g.fill();
  }

  // ------------------------------------------------------------------ roughness and metalness
  const OR = S / 2;
  const ok = OR / SIZE_M;
  const { c: orm, g: og } = canvas(OR);
  og.fillStyle = 'rgb(255,120,125)';
  og.fillRect(0, 0, OR, OR);
  og.globalCompositeOperation = 'overlay';
  og.globalAlpha = 0.5;
  og.drawImage(n1, 0, 0, OR, OR);
  og.globalCompositeOperation = 'source-over';
  og.globalAlpha = 1;
  // Polished drive paths are smoother.
  for (let i = 0; i < 70; i++) {
    og.strokeStyle = `rgba(255,75,160,${rng.range(0.1, 0.3)})`;
    og.lineWidth = rng.range(0.15, 0.5) * ok;
    og.beginPath();
    og.arc(rng.next() * OR, rng.next() * OR, rng.range(0.6, 4) * ok, rng.next() * 6, rng.next() * 6 + 1.4);
    og.stroke();
  }
  // Paint is dielectric and satin.
  const { c: pm, g: pmg } = canvas(OR);
  pmg.drawImage(paint, 0, 0, OR, OR);
  pmg.globalCompositeOperation = 'source-in';
  pmg.fillStyle = 'rgb(255,150,0)';
  pmg.fillRect(0, 0, OR, OR);
  og.drawImage(pm, 0, 0);

  // ------------------------------------------------------------------ tiling plate normal
  const normal = buildPlateNormal(S >= 2048 ? 1024 : 512, rng);

  const map = canvasTexture(albedo, { aniso: 16 });
  const ormTex = canvasTexture(orm, { srgb: false, aniso: 8 });
  return { map, orm: ormTex, normal };
}

function drawSeams(g: Ctx2D, S: number, k: number, rng: Rng): void {
  const P = S / PLATES;
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    g.strokeStyle = 'rgba(15,15,16,0.55)';
    g.lineWidth = Math.max(2, 0.018 * k);
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.strokeStyle = 'rgba(150,140,128,0.35)';
    g.lineWidth = Math.max(1, 0.007 * k);
    g.beginPath();
    g.moveTo(x0 + 1, y0 + 1);
    g.lineTo(x1 + 1, y1 + 1);
    g.stroke();
  };
  for (let i = 1; i < PLATES; i++) {
    line(i * P, 0, i * P, S);
    line(0, i * P, S, i * P);
  }
  // Bolts along every plate edge.
  const step = P / 4;
  const r = Math.max(1.2, 0.016 * k);
  for (let i = 0; i <= PLATES; i++) {
    for (let j = 0; j < PLATES * 4; j++) {
      for (const [x, y] of [
        [i * P + 0.05 * k, j * step + step / 2],
        [j * step + step / 2, i * P + 0.05 * k],
      ]) {
        if (rng.chance(0.04)) continue; // a few missing bolts
        g.fillStyle = 'rgba(10,10,10,0.6)';
        g.beginPath();
        g.arc(x, y, r * 1.35, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(140,142,146,0.9)';
        g.beginPath();
        g.arc(x - 0.3, y - 0.3, r, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
}

function drawCenterLogo(g: Ctx2D, cx: number, cy: number, k: number): void {
  g.save();
  g.translate(cx, cy);
  // Hex nut outline.
  const hex = (r: number) => {
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
  };
  g.fillStyle = 'rgba(214,86,8,0.88)';
  hex(1.75 * k);
  g.arc(0, 0, 1.45 * k, 0, Math.PI * 2, true);
  g.fill('evenodd');
  g.strokeStyle = 'rgba(230,230,225,0.8)';
  g.lineWidth = 0.05 * k;
  hex(1.85 * k);
  g.stroke();
  // Wordmark.
  g.rotate(-0.06);
  g.font = `italic 900 ${0.78 * k}px "Arial Black", Impact, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 0.12 * k;
  g.strokeStyle = 'rgba(12,12,12,0.95)';
  g.lineJoin = 'round';
  g.strokeText('BOTBOX', 0, 0);
  g.fillStyle = 'rgba(160,160,152,0.92)';
  g.fillText('BOTBOX', 0, 0);
  g.font = `italic 800 ${0.2 * k}px "Arial Black", Impact, sans-serif`;
  g.fillStyle = 'rgba(255,106,0,0.95)';
  g.fillText('ROBOT  COMBAT', 0, 0.62 * k);
  g.restore();
}

/** Height map of a 2x2 block of plates, tiled across the floor. */
function buildPlateNormal(T: number, rng: Rng): THREE.Texture {
  const { c, g } = canvas(T);
  g.fillStyle = 'rgb(128,128,128)';
  g.fillRect(0, 0, T, T);
  const noise = noiseCanvas(256, 32, 99, 3);
  g.globalAlpha = 0.18;
  g.drawImage(noise, 0, 0, T, T);
  g.globalAlpha = 1;
  const k = T / ((SIZE_M / PLATES) * 2);
  // Dents.
  for (let i = 0; i < 40; i++) {
    const x = rng.next() * T;
    const y = rng.next() * T;
    const r = rng.range(0.02, 0.12) * k;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(60,60,60,0.5)');
    grd.addColorStop(1, 'rgba(128,128,128,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // Fine scratches.
  for (let i = 0; i < 700; i++) {
    const x = rng.next() * T;
    const y = rng.next() * T;
    const a = rng.next() * Math.PI * 2;
    const l = rng.range(4, 60);
    g.strokeStyle = `rgba(70,70,70,${rng.range(0.2, 0.6)})`;
    g.lineWidth = rng.range(0.6, 1.4);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  // Seams: a groove with a raised weld bead.
  const seams = [0, T / 2, T];
  for (const s of seams) {
    for (const vertical of [true, false]) {
      const draw = (w: number, col: string) => {
        g.strokeStyle = col;
        g.lineWidth = w;
        g.beginPath();
        if (vertical) {
          g.moveTo(s, 0);
          g.lineTo(s, T);
        } else {
          g.moveTo(0, s);
          g.lineTo(T, s);
        }
        g.stroke();
      };
      draw(0.03 * k, 'rgb(70,70,70)');
      draw(0.016 * k, 'rgb(150,150,150)');
      draw(0.008 * k, 'rgb(185,185,185)');
    }
  }
  // Weld ripples along the bead.
  for (const s of seams) {
    for (let t = 0; t < T; t += 3) {
      g.fillStyle = 'rgba(210,210,210,0.35)';
      g.beginPath();
      g.arc(s, t, 0.006 * k, 0, Math.PI * 2);
      g.arc(t, s, 0.006 * k, 0, Math.PI * 2);
      g.fill();
    }
  }
  // Bolt heads.
  const step = T / 8;
  const off = 0.05 * k;
  for (let i = 0; i < 8; i++) {
    for (const s of [0, T / 2]) {
      for (const [x, y] of [
        [s + off, i * step + step / 2],
        [i * step + step / 2, s + off],
      ]) {
        const r = 0.018 * k;
        const grd = g.createRadialGradient(x - r * 0.2, y - r * 0.2, 0, x, y, r);
        grd.addColorStop(0, 'rgb(230,230,230)');
        grd.addColorStop(0.7, 'rgb(190,190,190)');
        grd.addColorStop(1, 'rgb(110,110,110)');
        g.fillStyle = grd;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  return heightToNormal(c, 2.2, true);
}

export function createFloor(tex: FloorTextures): THREE.Mesh {
  tex.normal.repeat.set(PLATES / 2, PLATES / 2);
  const mat = new THREE.MeshStandardMaterial({
    map: tex.map,
    roughnessMap: tex.orm,
    metalnessMap: tex.orm,
    normalMap: tex.normal,
    normalScale: new THREE.Vector2(0.9, 0.9),
    roughness: 1,
    metalness: 1,
    envMapIntensity: 0.9,
  });
  const geo = new THREE.PlaneGeometry(SIZE_M, SIZE_M);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  m.name = 'floor';
  return m;
}
