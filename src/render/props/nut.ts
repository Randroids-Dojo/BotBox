// The Giant Nut: a chromed hex nut about 0.6 m across the flats, with the classic 30 degree
// chamfer on both faces and a threaded bore, standing on a walnut plinth with a brass plaque.
// Origin at the center of the base on the floor; about 0.95 m tall.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { CreateNutTrophy } from '../types';

const APOTHEM = 0.3; // across flats 0.6
const THICK = 0.27;
const R_MINOR = 0.148;
const R_MAJOR = 0.168;
const PITCH = 0.034;
const CS = 0.016; // bore countersink
const TAN30 = Math.tan(Math.PI / 6);
const R_CHAMFER = APOTHEM * 0.94;

/** Highest |z| allowed at radius r: the chamfer cone. */
function zMax(r: number): number {
  return Math.min(THICK / 2, THICK / 2 - (r - R_CHAMFER) * TAN30);
}

function nutGeometry(segPerFlat: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const vert = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    pos.push(x, y, z);
    nrm.push(nx, ny, nz);
    return pos.length / 3 - 1;
  };
  const half = APOTHEM * TAN30;
  // Flat k has its outward normal at angle -90 + 60k degrees (a flat at the bottom).
  const flatAngle = (k: number) => -Math.PI / 2 + (k * Math.PI) / 3;
  // Point on flat k at offset x along the flat.
  const onFlat = (k: number, x: number) => {
    const a = flatAngle(k);
    const nx = Math.cos(a);
    const ny = Math.sin(a);
    return { px: nx * APOTHEM - ny * x, py: ny * APOTHEM + nx * x, nx, ny };
  };

  // ---- side flats
  const vSeg = 10;
  for (let k = 0; k < 6; k++) {
    const rows: number[][] = [];
    for (let i = 0; i <= segPerFlat; i++) {
      const x = -half + (i / segPerFlat) * half * 2;
      const p = onFlat(k, x);
      const r = Math.hypot(p.px, p.py);
      const zm = zMax(r);
      const row: number[] = [];
      for (let j = 0; j <= vSeg; j++) {
        const z = -zm + (j / vSeg) * zm * 2;
        row.push(vert(p.px, p.py, z, p.nx, p.ny, 0));
      }
      rows.push(row);
    }
    for (let i = 0; i < segPerFlat; i++)
      for (let j = 0; j < vSeg; j++) {
        const a = rows[i][j];
        const b = rows[i + 1][j];
        const c = rows[i + 1][j + 1];
        const d = rows[i][j + 1];
        idx.push(a, b, c, a, c, d);
      }
  }

  // ---- end faces (annulus from the bore lip out to the hex, lowered onto the chamfer cone)
  const rb = R_MAJOR + CS * 0.2;
  for (const side of [1, -1]) {
    const outline: { x: number; y: number }[] = [];
    for (let k = 0; k < 6; k++)
      for (let i = 0; i < segPerFlat; i++) {
        const x = -half + (i / segPerFlat) * half * 2;
        const p = onFlat(k, x);
        outline.push({ x: p.px, y: p.py });
      }
    const n = outline.length;
    // Two bands with their own vertices: the flat face out to the chamfer circle, then the
    // cone out to the hex edge, so the crease stays crisp.
    for (const band of [0, 1]) {
      const steps = band === 0 ? 6 : 7;
      const grid: number[][] = [];
      for (let s = 0; s < n; s++) {
        const o = outline[s];
        const ro = Math.hypot(o.x, o.y);
        const ux = o.x / ro;
        const uy = o.y / ro;
        const col: number[] = [];
        for (let j = 0; j <= steps; j++) {
          const t = j / steps;
          const r = band === 0 ? rb + (R_CHAMFER - rb) * t : R_CHAMFER + (ro - R_CHAMFER) * t;
          const z = zMax(r) * side;
          let nx = 0;
          let ny = 0;
          let nz = side;
          if (band === 1) {
            const l = Math.hypot(TAN30, 1);
            nx = (ux * TAN30) / l;
            ny = (uy * TAN30) / l;
            nz = side / l;
          }
          col.push(vert(ux * r, uy * r, z, nx, ny, nz));
        }
        grid.push(col);
      }
      for (let s = 0; s < n; s++)
        for (let j = 0; j < steps; j++) {
          const a = grid[s][j];
          const b = grid[(s + 1) % n][j];
          const c = grid[(s + 1) % n][j + 1];
          const d = grid[s][j + 1];
          if (side > 0) idx.push(a, c, b, a, d, c);
          else idx.push(a, b, c, a, c, d);
        }
    }
  }

  // ---- threaded bore
  const thetaSeg = segPerFlat * 6;
  const zSeg = Math.round((THICK / PITCH) * 10);
  const bore: number[][] = [];
  const start = pos.length / 3;
  for (let i = 0; i <= thetaSeg; i++) {
    const th = (i / thetaSeg) * Math.PI * 2;
    const col: number[] = [];
    for (let j = 0; j <= zSeg; j++) {
      const z = -THICK / 2 + (j / zSeg) * THICK;
      const f = z / PITCH + th / (Math.PI * 2);
      const tri = 1 - Math.abs((f - Math.floor(f)) * 2 - 1);
      let r = R_MINOR + (R_MAJOR - R_MINOR) * tri;
      const flare = R_MAJOR - CS + 1.2 * (Math.abs(z) - (THICK / 2 - CS));
      r = Math.max(r, flare);
      col.push(vert(Math.cos(th) * r, Math.sin(th) * r, z, 0, 0, 0));
    }
    bore.push(col);
  }
  for (let i = 0; i < thetaSeg; i++)
    for (let j = 0; j < zSeg; j++) {
      const a = bore[i][j];
      const b = bore[i + 1][j];
      const c = bore[i + 1][j + 1];
      const d = bore[i][j + 1];
      idx.push(a, c, b, a, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  // Bore normals from its own faces (inward).
  const tmp = new THREE.BufferGeometry();
  const bp = pos.slice(start * 3);
  tmp.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
  tmp.setIndex(idx.filter((_, i) => i >= idx.length - thetaSeg * zSeg * 6).map((v) => v - start));
  tmp.computeVertexNormals();
  const bn = tmp.attributes.normal.array as Float32Array;
  const na = g.attributes.normal.array as Float32Array;
  na.set(bn, start * 3);
  tmp.dispose();
  return g;
}

function woodTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 256;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#3b2213';
  ctx.fillRect(0, 0, W, H);
  let seed = 3;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 160; i++) {
    const y0 = r() * H;
    const amp = 2 + r() * 8;
    const freq = 0.004 + r() * 0.01;
    const ph = r() * 10;
    ctx.strokeStyle = r() < 0.5 ? `rgba(20,10,4,${0.2 + r() * 0.35})` : `rgba(110,62,30,${0.15 + r() * 0.25})`;
    ctx.lineWidth = 0.5 + r() * 2.5;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 8) {
      const y = y0 + Math.sin(x * freq + ph) * amp + Math.sin(x * freq * 3.1 + ph) * amp * 0.3;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function plaqueTextures(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const W = 1024;
  const H = 256;
  const draw = (bump: boolean) => {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = bump ? '#ffffff' : '#c9a24a';
    ctx.fillRect(0, 0, W, H);
    if (!bump) {
      // Brushed brass.
      for (let i = 0; i < 900; i++) {
        const y = Math.random() * H;
        ctx.strokeStyle = Math.random() < 0.5 ? 'rgba(255,240,190,0.08)' : 'rgba(90,60,10,0.08)';
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y + (Math.random() - 0.5) * 2);
        ctx.stroke();
      }
    }
    const ink = bump ? '#202020' : '#2a1d08';
    ctx.strokeStyle = ink;
    ctx.lineWidth = 6;
    ctx.strokeRect(22, 22, W - 44, H - 44);
    ctx.lineWidth = 2;
    ctx.strokeRect(36, 36, W - 72, H - 72);
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'italic 900 92px "Arial Black", Impact, "Helvetica Neue", sans-serif';
    ctx.fillText('BOTBOX CHAMPION', W / 2, H * 0.42, W - 120);
    ctx.font = '700 46px "Arial Black", Impact, "Helvetica Neue", sans-serif';
    ctx.fillText('2001', W / 2, H * 0.74);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = bump ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { map: draw(false), bump: draw(true) };
}

export const createNutTrophy: CreateNutTrophy = (envMap) => {
  const g = new THREE.Group();
  g.name = 'giant-nut';
  // Base and plinth.
  const baseH = 0.04;
  const plinthH = 0.3;
  const base = new THREE.Mesh(new RoundedBoxGeometry(0.7, baseH, 0.5, 2, 0.008), new THREE.MeshStandardMaterial({ color: '#0e0e0f', roughness: 0.35, metalness: 0.2, envMap }));
  base.position.y = baseH / 2;
  const wood = woodTexture();
  const woodMat = new THREE.MeshPhysicalMaterial({ map: wood, roughness: 0.42, clearcoat: 0.8, clearcoatRoughness: 0.18, envMap });
  const plinth = new THREE.Mesh(new RoundedBoxGeometry(0.62, plinthH, 0.42, 3, 0.018), woodMat);
  plinth.position.y = baseH + plinthH / 2;
  const capMat = new THREE.MeshStandardMaterial({ color: '#d8dadd', metalness: 1, roughness: 0.12, envMap });
  const cap = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.012, 0.4, 2, 0.004), capMat);
  cap.position.y = baseH + plinthH + 0.006;
  // Brass plaque on the front face.
  const pl = plaqueTextures();
  const plaqueMat = new THREE.MeshStandardMaterial({ map: pl.map, bumpMap: pl.bump, bumpScale: 3, metalness: 1, roughness: 0.32, envMap });
  const plaque = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.1, 0.006, 2, 0.002), plaqueMat);
  plaque.position.set(0, baseH + plinthH * 0.52, 0.21 + 0.003);
  const screwMat = new THREE.MeshStandardMaterial({ color: '#b08a3a', metalness: 1, roughness: 0.25, envMap });
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const sc = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), screwMat);
      sc.rotation.x = Math.PI / 2;
      sc.position.set(sx * 0.185, plaque.position.y + sy * 0.037, 0.216);
      g.add(sc);
    }
  // The nut, standing on a flat, axis toward the front.
  const chrome = new THREE.MeshStandardMaterial({ color: '#eceef0', metalness: 1, roughness: 0.055, envMap, envMapIntensity: 1.8 });
  const nut = new THREE.Mesh(nutGeometry(18), chrome);
  nut.position.y = baseH + plinthH + 0.012 + APOTHEM;
  // A slight turn so the camera catches the chamfer and the thread.
  nut.rotation.y = 0.32;
  for (const m of [base, plinth, cap, plaque, nut]) {
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  return g;
};
