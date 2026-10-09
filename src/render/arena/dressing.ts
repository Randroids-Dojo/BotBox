// Event dressing for the Box. Built once and toggled.
//   qualifier: a Tuesday-night garage league. A hand-lettered banner zip-tied over the sponsors.
//     (The light rig and crowd thin out separately: see lights.ts and crowd.ts.)
//   championship: CHAMPIONSHIP FINAL banners on the stand fronts and hanging over the stands,
//     a finals header on the big screen, confetti cannons standing by at the corners, and
//     searchlights sweeping the house. Banners and props are one draw call each; the
//     searchlights are one more, animated in the vertex shader.

import * as THREE from 'three';
import { ARENA_HALF, BIG_SCREEN } from '../../data/arena';
import { GeoBatch } from '../util/geom';
import { canvas, canvasTexture, hazardPattern } from '../util/tex';
import { BEAM_FRAG, type Dressing } from './lights';
import type { ArenaMaterials } from './materials';
import { FRONT_H, SIDES, type Side } from './stands';

export interface ArenaDressing {
  root: THREE.Group;
  sweepUniforms: { uTime: { value: number }; uIntensity: { value: number } };
  set(d: Dressing): void;
}

const SWEEP_VERT = /* glsl */ `
attribute float along;
attribute vec3 beamColor;
attribute vec4 pivot;
uniform float uTime;
varying float vAlong;
varying vec3 vColor;
varying vec3 vNormalV;
varying vec3 vViewPos;
varying vec3 vWorld;
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
void main() {
  vAlong = along;
  vColor = beamColor;
  // Each light pans and tilts on its own slow figure eight across the house and the Box.
  float ph = pivot.w;
  float yaw = ph * 6.2832 + sin(uTime * 0.31 + ph * 7.0) * 0.8;
  float tilt = 0.75 + 0.3 * sin(uTime * 0.47 + ph * 3.1);
  mat3 r = rotY(yaw) * rotX(tilt);
  vec4 wp = modelMatrix * vec4(r * position + pivot.xyz, 1.0);
  vWorld = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vViewPos = mv.xyz;
  vNormalV = normalize(normalMatrix * (r * normal));
  gl_Position = projectionMatrix * mv;
}`;

export function buildDressing(mats: ArenaMaterials): ArenaDressing {
  const root = new THREE.Group();
  root.name = 'dressing';
  const champ = new THREE.Group();
  champ.name = 'dressing:championship';
  const qual = new THREE.Group();
  qual.name = 'dressing:qualifier';
  root.add(champ, qual);

  // ------------------------------------------------------------------ championship banners
  const atlas = finalsAtlas();
  const quads = new QuadBatch();
  // Atlas cells (u0, v0, u1, v1): the wide FINAL banner, the tall drop, the screen header.
  const WIDE: Cell = [0, 0.5, 1, 1];
  const DROP: Cell = [0, 0, 0.36, 0.5];
  const HEAD: Cell = [0.36, 0.25, 1, 0.5];
  for (const s of SIDES) {
    // In the gaps between the sponsor banners on the stand front.
    for (const a of [-3.25, 3.25]) quads.onSide(s, a, s.d0 - 0.03, FRONT_H * 0.5, 2.1, 0.95, WIDE);
    // Drops hanging over the first rows.
    for (const a of [-5.2, 5.2]) quads.onSide(s, a, s.d0 + 0.5, 5.3, 1.5, 3.1, DROP);
  }
  // Over the big screen's header.
  quads.at(new THREE.Vector3(BIG_SCREEN.pos.x, BIG_SCREEN.pos.y + BIG_SCREEN.h / 2 + 0.7, BIG_SCREEN.pos.z - 0.06), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), BIG_SCREEN.w + 0.5, 0.75, HEAD);
  const bannerMat = new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas, emissive: '#ffffff', emissiveIntensity: 0.55, roughness: 0.5, side: THREE.DoubleSide });
  const banners = new THREE.Mesh(quads.build(), bannerMat);
  banners.name = 'finals-banners';
  champ.add(banners);

  // ------------------------------------------------------------------ confetti cannons
  const cannons = new GeoBatch();
  const stripes = new GeoBatch();
  const c = ARENA_HALF + 1.5;
  for (const [x, z] of [
    [-c, -c],
    [c, -c],
    [-c, c],
    [c, c],
  ]) {
    const yaw = Math.atan2(-x, -z);
    // Base, gas bottle and a tube aimed up and in over the Box.
    cannons.add(new THREE.CylinderGeometry(0.42, 0.48, 0.3, 16), x, 0.15, z);
    cannons.add(new THREE.CylinderGeometry(0.12, 0.12, 0.9, 12), x - Math.sin(yaw) * 0.32, 0.6, z - Math.cos(yaw) * 0.32);
    const tube = new THREE.CylinderGeometry(0.2, 0.17, 1.5, 16, 1, true);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x + Math.sin(yaw) * 0.25, 0.95, z + Math.cos(yaw) * 0.25),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.55, yaw, 0, 'YXZ')),
      new THREE.Vector3(1, 1, 1),
    );
    cannons.addMatrix(tube, m);
    const band = new THREE.CylinderGeometry(0.205, 0.205, 0.22, 16, 1, true);
    stripes.addMatrix(band, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0)));
  }
  const cannonMesh = new THREE.Mesh(cannons.build(), mats.blackPaint);
  cannonMesh.castShadow = true;
  const { c: hc, g: hg } = canvas(128, 32);
  hg.fillStyle = hazardPattern(hg, 8);
  hg.fillRect(0, 0, 128, 32);
  const stripeMesh = new THREE.Mesh(stripes.build(), new THREE.MeshStandardMaterial({ map: canvasTexture(hc, { repeat: [2, 1] }), roughness: 0.5 }));
  champ.add(cannonMesh, stripeMesh);

  // ------------------------------------------------------------------ searchlights
  const sweepUniforms = { uTime: { value: 0 }, uIntensity: { value: 0.085 } };
  const sweep = new THREE.Mesh(
    sweepGeometry(),
    new THREE.ShaderMaterial({
      vertexShader: SWEEP_VERT,
      fragmentShader: BEAM_FRAG,
      uniforms: sweepUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  sweep.frustumCulled = false;
  sweep.renderOrder = 4;
  champ.add(sweep);

  // ------------------------------------------------------------------ qualifier
  const lq = new QuadBatch();
  for (const s of [SIDES[0], SIDES[3]]) lq.onSide(s, 0, s.d0 - 0.04, FRONT_H * 0.52, 4.4, 1.0, [0, 0, 1, 1]);
  const league = new THREE.Mesh(lq.build(), new THREE.MeshStandardMaterial({ map: leagueTexture(), roughness: 0.85, side: THREE.DoubleSide }));
  qual.add(league);

  const set = (d: Dressing) => {
    champ.visible = d === 'championship';
    qual.visible = d === 'qualifier';
  };
  set('normal');
  return { root, sweepUniforms, set };
}

// ------------------------------------------------------------------ geometry helpers

type Cell = [number, number, number, number];

class QuadBatch {
  private pos: number[] = [];
  private uv: number[] = [];
  private nor: number[] = [];

  /** A quad on a stand side: `along` across the side, `out` from the center, centered at y. */
  onSide(s: Side, along: number, out: number, y: number, w: number, h: number, cell: Cell): void {
    const n = new THREE.Vector3(-s.n.x, 0, -s.n.y);
    const t = new THREE.Vector3(-s.n.y, 0, s.n.x);
    const c = new THREE.Vector3(t.x * along + s.n.x * out, y, t.z * along + s.n.y * out);
    this.at(c, t, n, w, h, cell);
  }

  at(c: THREE.Vector3, t: THREE.Vector3, n: THREE.Vector3, w: number, h: number, [u0, v0, u1, v1]: Cell): void {
    const corners: [number, number, number, number][] = [
      [-1, -1, u0, v0],
      [1, -1, u1, v0],
      [1, 1, u1, v1],
      [-1, -1, u0, v0],
      [1, 1, u1, v1],
      [-1, 1, u0, v1],
    ];
    for (const [sx, sy, u, v] of corners) {
      this.pos.push(c.x + t.x * sx * w * 0.5, c.y + sy * h * 0.5, c.z + t.z * sx * w * 0.5);
      this.uv.push(u, v);
      this.nor.push(n.x, n.y, n.z);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

/** Six searchlight cones pointing down from pivots high over the corners of the house. */
function sweepGeometry(): THREE.BufferGeometry {
  const seg = 16;
  const pos: number[] = [];
  const nor: number[] = [];
  const along: number[] = [];
  const color: number[] = [];
  const pivot: number[] = [];
  const idx: number[] = [];
  const len = 22;
  const r0 = 0.18;
  const r1 = 1.6;
  const lights: [number, number, number, THREE.Color][] = [
    [-12, 13, -12, new THREE.Color(1.0, 0.85, 0.55)],
    [12, 13, -12, new THREE.Color(0.7, 0.8, 1.0)],
    [-12, 13, 12, new THREE.Color(0.7, 0.8, 1.0)],
    [12, 13, 12, new THREE.Color(1.0, 0.85, 0.55)],
    [0, 14, -14, new THREE.Color(1.0, 0.7, 0.4)],
    [0, 14, 15, new THREE.Color(1.0, 0.7, 0.4)],
  ];
  lights.forEach(([x, y, z, col], k) => {
    const base = pos.length / 3;
    for (let j = 0; j <= 1; j++) {
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const r = j === 0 ? r0 : r1;
        pos.push(Math.cos(a) * r, -j * len, Math.sin(a) * r);
        const n = new THREE.Vector3(Math.cos(a), (r1 - r0) / len, Math.sin(a)).normalize();
        nor.push(n.x, n.y, n.z);
        along.push(j);
        color.push(col.r, col.g, col.b);
        pivot.push(x, y, z, k / lights.length);
      }
    }
    for (let i = 0; i < seg; i++) {
      const a = base + i;
      const b = base + i + 1;
      const c = base + seg + 1 + i;
      const d = base + seg + 2 + i;
      idx.push(a, c, b, b, c, d);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('along', new THREE.Float32BufferAttribute(along, 1));
  g.setAttribute('beamColor', new THREE.Float32BufferAttribute(color, 3));
  g.setAttribute('pivot', new THREE.Float32BufferAttribute(pivot, 4));
  g.setIndex(idx);
  return g;
}

// ------------------------------------------------------------------ textures

function finalsAtlas(): THREE.Texture {
  const W = 1024;
  const H = 1024;
  const { c, g } = canvas(W, H);
  const gold = (y0: number, y1: number) => {
    const grd = g.createLinearGradient(0, y0, 0, y1);
    grd.addColorStop(0, '#fff2b0');
    grd.addColorStop(0.45, '#f2c230');
    grd.addColorStop(1, '#a8740c');
    return grd;
  };
  // Wide: top half.
  g.fillStyle = '#0b0b10';
  g.fillRect(0, 0, W, H / 2);
  g.fillStyle = gold(0, H / 2);
  g.fillRect(0, 20, W, 14);
  g.fillRect(0, H / 2 - 34, W, 14);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'italic 900 128px "Arial Black", Impact, sans-serif';
  g.fillStyle = gold(150, 300);
  g.fillText('CHAMPIONSHIP', W / 2, 190, W * 0.92);
  g.font = 'italic 900 150px "Arial Black", Impact, sans-serif';
  g.fillStyle = '#ffffff';
  g.fillText('FINAL', W / 2, 360);
  // Drop: bottom left (0..0.36 of the width, lower half).
  const dw = W * 0.36;
  g.fillStyle = '#7a0c10';
  g.fillRect(0, H / 2, dw, H / 2);
  g.fillStyle = gold(H / 2, H);
  g.fillRect(16, H / 2 + 16, dw - 32, 10);
  g.fillRect(16, H - 26, dw - 32, 10);
  // A hex nut.
  g.save();
  g.translate(dw / 2, H / 2 + 140);
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    g.lineTo(Math.cos(a) * 90, Math.sin(a) * 90);
  }
  g.closePath();
  g.fillStyle = gold(-90, 90);
  g.fill();
  g.beginPath();
  g.arc(0, 0, 40, 0, Math.PI * 2);
  g.fillStyle = '#7a0c10';
  g.fill();
  g.restore();
  g.fillStyle = '#ffffff';
  g.font = 'italic 900 70px "Arial Black", Impact, sans-serif';
  for (const [i, l] of ['F', 'I', 'N', 'A', 'L'].entries()) g.fillText(l, dw / 2, H / 2 + 280 + i * 46 * 1.0, dw);
  // Header: right part of the lower half, top strip.
  const hx = dw;
  const hy = H / 2;
  const hw = W - dw;
  const hh = H / 4;
  const grd = g.createLinearGradient(0, hy, 0, hy + hh);
  grd.addColorStop(0, '#1a1208');
  grd.addColorStop(1, '#050403');
  g.fillStyle = grd;
  g.fillRect(hx, hy, hw, hh);
  g.font = 'italic 900 92px "Arial Black", Impact, sans-serif';
  g.fillStyle = gold(hy + 60, hy + 180);
  g.fillText('CHAMPIONSHIP FINAL', hx + hw / 2, hy + hh / 2 + 6, hw * 0.94);
  // The remaining corner stays dark.
  g.fillStyle = '#000';
  g.fillRect(hx, hy + hh, hw, H - hy - hh);
  return canvasTexture(c, { aniso: 8 });
}

function leagueTexture(): THREE.Texture {
  const { c, g } = canvas(1024, 232);
  g.fillStyle = '#e8e2d2';
  g.fillRect(0, 0, 1024, 232);
  g.strokeStyle = 'rgba(0,0,0,0.12)';
  g.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    g.moveTo(0, 30 + i * 40);
    g.bezierCurveTo(300, 26 + i * 40, 700, 36 + i * 40, 1024, 30 + i * 40);
    g.stroke();
  }
  g.fillStyle = '#c01818';
  g.font = 'bold 92px "Marker Felt", "Comic Sans MS", cursive';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('TUESDAY NIGHT', 512, 82, 980);
  g.fillStyle = '#1a1a1a';
  g.font = 'bold 64px "Marker Felt", "Comic Sans MS", cursive';
  g.fillText('garage league . $5 at the door', 512, 172, 980);
  // Duct tape at the corners.
  g.fillStyle = 'rgba(150,150,155,0.9)';
  for (const [x, y, a] of [
    [30, 26, -0.6],
    [994, 26, 0.6],
    [30, 206, 0.6],
    [994, 206, -0.6],
  ]) {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.fillRect(-40, -12, 80, 24);
    g.restore();
  }
  return canvasTexture(c);
}
