// Shared arena materials and their generated textures.

import * as THREE from 'three';
import { Rng } from '../util/rng';
import { canvas, canvasTexture, hazardPattern, heightToNormal, noiseCanvas, wear } from '../util/tex';

export interface ArenaMaterials {
  kick: THREE.MeshStandardMaterial;
  frame: THREE.MeshStandardMaterial;
  darkSteel: THREE.MeshStandardMaterial;
  brightSteel: THREE.MeshStandardMaterial;
  hazard: THREE.MeshStandardMaterial;
  truss: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  lexan: THREE.MeshStandardMaterial;
  lexanCeiling: THREE.MeshStandardMaterial;
  lexanEdge: THREE.MeshBasicMaterial;
  hydraulic: THREE.MeshStandardMaterial;
  bolt: THREE.MeshStandardMaterial;
  paintRed: THREE.MeshStandardMaterial;
  blackPaint: THREE.MeshStandardMaterial;
}

function brushedSteel(seed: number, base: string, scuffs: number): { map: THREE.Texture; normal: THREE.Texture } {
  const rng = new Rng(seed);
  const W = 512;
  const { c, g } = canvas(W, W);
  g.fillStyle = base;
  g.fillRect(0, 0, W, W);
  // Brushing: long faint horizontal strokes.
  for (let i = 0; i < 900; i++) {
    const y = rng.next() * W;
    g.strokeStyle = rng.chance(0.5) ? `rgba(255,255,255,${rng.range(0.01, 0.05)})` : `rgba(0,0,0,${rng.range(0.02, 0.07)})`;
    g.lineWidth = rng.range(0.5, 1.5);
    g.beginPath();
    g.moveTo(rng.next() * W - 100, y);
    g.lineTo(rng.next() * W + 100, y + rng.range(-2, 2));
    g.stroke();
  }
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = 0.4;
  g.drawImage(noiseCanvas(128, 4, seed + 1, 4), 0, 0, W, W);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  // Scuffs and impact marks.
  for (let i = 0; i < scuffs; i++) {
    const x = rng.next() * W;
    const y = rng.next() * W;
    const a = rng.range(-0.6, 0.6);
    const l = rng.range(10, 80);
    g.strokeStyle = rng.chance(0.4) ? 'rgba(200,200,205,0.5)' : 'rgba(10,10,10,0.35)';
    g.lineWidth = rng.range(0.6, 2.5);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  // Height for dents.
  const { c: hc, g: hg } = canvas(256);
  hg.fillStyle = 'rgb(128,128,128)';
  hg.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 18; i++) {
    const x = rng.next() * 256;
    const y = rng.next() * 256;
    const r = rng.range(6, 26);
    const grd = hg.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(40,40,40,0.8)');
    grd.addColorStop(1, 'rgba(128,128,128,0)');
    hg.fillStyle = grd;
    hg.beginPath();
    hg.arc(x, y, r, 0, Math.PI * 2);
    hg.fill();
  }
  for (let i = 0; i < 120; i++) {
    hg.strokeStyle = 'rgba(80,80,80,0.5)';
    hg.lineWidth = 1;
    hg.beginPath();
    const x = rng.next() * 256;
    const y = rng.next() * 256;
    hg.moveTo(x, y);
    hg.lineTo(x + rng.range(-20, 20), y + rng.range(-6, 6));
    hg.stroke();
  }
  return { map: canvasTexture(c, { repeat: [1, 1] }), normal: heightToNormal(hc, 2, true) };
}

function lexanScratches(seed: number, size: number): { map: THREE.Texture; alpha: THREE.Texture } {
  const rng = new Rng(seed);
  const { c, g } = canvas(size);
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);
  const s = size / 1024;
  // Long cleaning swirls.
  for (let i = 0; i < 60; i++) {
    g.strokeStyle = `rgba(255,255,255,${rng.range(0.04, 0.12)})`;
    g.lineWidth = rng.range(0.5, 1.2) * s;
    g.beginPath();
    g.arc(rng.next() * size, rng.next() * size, rng.range(80, 500) * s, rng.next() * 6, rng.next() * 6 + rng.range(0.3, 1.2));
    g.stroke();
  }
  // Debris hits: short bright gouges and star chips.
  for (let i = 0; i < 380; i++) {
    const x = rng.next() * size;
    const y = rng.next() * size;
    const a = rng.next() * Math.PI * 2;
    const l = rng.range(4, 50) * s;
    g.strokeStyle = `rgba(255,255,255,${rng.range(0.15, 0.55)})`;
    g.lineWidth = rng.range(0.6, 1.6) * s;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  for (let i = 0; i < 25; i++) {
    const x = rng.next() * size;
    const y = rng.next() * size;
    g.strokeStyle = `rgba(255,255,255,${rng.range(0.3, 0.7)})`;
    g.lineWidth = 1 * s;
    for (let j = 0; j < 7; j++) {
      const a = rng.next() * Math.PI * 2;
      const l = rng.range(3, 16) * s;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
  }
  // Haze and smudges.
  g.globalCompositeOperation = 'screen';
  g.globalAlpha = 0.18;
  g.drawImage(noiseCanvas(128, 4, seed + 5, 3), 0, 0, size, size);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  const map = canvasTexture(c, { repeat: [1, 1] });
  // Alpha: a base haze plus the scratches (grey channel used by alphaMap).
  const { c: ac, g: ag } = canvas(size / 2);
  ag.fillStyle = 'rgb(70,70,70)';
  ag.fillRect(0, 0, size / 2, size / 2);
  ag.globalCompositeOperation = 'lighter';
  ag.drawImage(c, 0, 0, size / 2, size / 2);
  const alpha = canvasTexture(ac, { srgb: false, repeat: [1, 1] });
  return { map, alpha };
}

export function lexanMaterial(scr: { map: THREE.Texture; alpha: THREE.Texture }, opacity: number, emissive: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: '#56666a',
    map: scr.map,
    alphaMap: scr.alpha,
    emissive: '#a8c4cc',
    emissiveMap: scr.map,
    emissiveIntensity: emissive,
    roughness: 0.06,
    metalness: 0,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    envMapIntensity: 0.8,
  });
  // Premultiplied style: reflections and scratches are added at full strength, the view
  // behind is only dimmed by alpha. Thick polycarbonate, not a missing wall.
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  return m;
}

export function createArenaMaterials(): ArenaMaterials {
  const kickTex = brushedSteel(31, '#6d7176', 140);
  kickTex.map.repeat.set(0.5, 0.5);
  kickTex.normal.repeat.set(0.5, 0.5);
  const kick = new THREE.MeshStandardMaterial({
    map: kickTex.map,
    normalMap: kickTex.normal,
    roughness: 0.42,
    metalness: 0.85,
  });
  const frameTex = brushedSteel(41, '#2b2d30', 50);
  frameTex.map.repeat.set(0.6, 0.6);
  const frame = new THREE.MeshStandardMaterial({ map: frameTex.map, roughness: 0.55, metalness: 0.6 });
  const darkSteel = new THREE.MeshStandardMaterial({ map: frameTex.map, color: '#8a8e94', roughness: 0.45, metalness: 0.85 });
  const brightSteel = new THREE.MeshStandardMaterial({ map: kickTex.map, color: '#e8ecf0', roughness: 0.25, metalness: 1 });

  const { c: hc, g: hg } = canvas(256, 256);
  hg.fillStyle = hazardPattern(hg, 32);
  hg.fillRect(0, 0, 256, 256);
  wear(hg, 256, 256, new Rng(5), 3, 0.5);
  hg.globalCompositeOperation = 'destination-over';
  hg.fillStyle = '#55585c';
  hg.fillRect(0, 0, 256, 256);
  const hazardTex = canvasTexture(hc, { repeat: [1, 1] });
  const hazard = new THREE.MeshStandardMaterial({ map: hazardTex, roughness: 0.55, metalness: 0.2 });

  const truss = new THREE.MeshStandardMaterial({ color: '#9aa0a8', roughness: 0.35, metalness: 0.9 });
  const rubber = new THREE.MeshStandardMaterial({ color: '#121212', roughness: 0.75, metalness: 0 });
  const concTex = noiseCanvas(256, 8, 77, 4);
  const conc = canvasTexture(concTex, { repeat: [12, 12] });
  const concrete = new THREE.MeshStandardMaterial({ map: conc, color: '#3a3b3e', roughness: 0.9, metalness: 0 });

  const scr = lexanScratches(17, 1024);
  scr.map.repeat.set(1 / 3.65, 1 / 4.4);
  scr.alpha.repeat.copy(scr.map.repeat);
  const lexan = lexanMaterial(scr, 0.2, 0.012);
  const scr2 = { map: scr.map.clone(), alpha: scr.alpha.clone() };
  scr2.map.repeat.set(1 / 4, 1 / 4);
  scr2.alpha.repeat.set(1 / 4, 1 / 4);
  scr2.map.needsUpdate = scr2.alpha.needsUpdate = true;
  const lexanCeiling = lexanMaterial(scr2, 0.1, 0.006);
  const lexanEdge = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.55, 0.55), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });

  const hydraulic = new THREE.MeshStandardMaterial({ color: '#c8ccd2', roughness: 0.12, metalness: 1 });
  const bolt = new THREE.MeshStandardMaterial({ color: '#a8acb2', roughness: 0.35, metalness: 1 });
  const paintRed = new THREE.MeshStandardMaterial({ color: '#a3170f', roughness: 0.45, metalness: 0.2 });
  const blackPaint = new THREE.MeshStandardMaterial({ color: '#16171a', roughness: 0.6, metalness: 0.3 });
  return { kick, frame, darkSteel, brightSteel, hazard, truss, rubber, concrete, lexan, lexanCeiling, lexanEdge, hydraulic, bolt, paintRed, blackPaint };
}
