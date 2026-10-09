// The BOTBOX chrome logo: wide extended italic letters, extruded and beveled, chrome with
// a sweeping highlight, on a dark plate with a hot orange edge.

import * as THREE from 'three';

type Pt = [number, number];

function poly(pts: Pt[]): THREE.Shape {
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => (i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
  s.closePath();
  return s;
}

function holePath(pts: Pt[]): THREE.Path {
  const p = new THREE.Path();
  // Holes wind the other way.
  [...pts].reverse().forEach(([x, y], i) => (i === 0 ? p.moveTo(x, y) : p.lineTo(x, y)));
  p.closePath();
  return p;
}

function chamferRect(x0: number, y0: number, x1: number, y1: number, c: number): Pt[] {
  return [
    [x0 + c, y0],
    [x1 - c, y0],
    [x1, y0 + c],
    [x1, y1 - c],
    [x1 - c, y1],
    [x0 + c, y1],
    [x0, y1 - c],
    [x0, y0 + c],
  ];
}

const LETTERS: Record<string, { w: number; shape: () => THREE.Shape }> = {
  B: {
    w: 0.98,
    shape: () => {
      const s = poly([
        [0, 0],
        [0.84, 0],
        [0.98, 0.14],
        [0.98, 0.38],
        [0.88, 0.5],
        [0.98, 0.62],
        [0.98, 0.86],
        [0.84, 1],
        [0, 1],
      ]);
      s.holes.push(holePath(chamferRect(0.27, 0.6, 0.71, 0.77, 0.04)));
      s.holes.push(holePath(chamferRect(0.27, 0.23, 0.71, 0.4, 0.04)));
      return s;
    },
  },
  O: {
    w: 1.04,
    shape: () => {
      const s = poly(chamferRect(0, 0, 1.04, 1, 0.22));
      s.holes.push(holePath(chamferRect(0.28, 0.24, 0.76, 0.76, 0.08)));
      return s;
    },
  },
  T: {
    w: 0.98,
    shape: () =>
      poly([
        [0, 1],
        [0.98, 1],
        [0.98, 0.75],
        [0.64, 0.75],
        [0.64, 0],
        [0.34, 0],
        [0.34, 0.75],
        [0, 0.75],
      ]),
  },
  X: {
    w: 1.06,
    shape: () =>
      poly([
        [0, 1],
        [0.32, 1],
        [0.53, 0.69],
        [0.74, 1],
        [1.06, 1],
        [0.7, 0.5],
        [1.06, 0],
        [0.74, 0],
        [0.53, 0.31],
        [0.32, 0],
        [0, 0],
        [0.36, 0.5],
      ]),
  },
};

export interface Logo {
  root: THREE.Group;
  width: number;
  update(time: number): void;
}

export function buildLogo(env: THREE.Texture): Logo {
  const root = new THREE.Group();
  const word = 'BOTBOX';
  const gap = 0.14;
  const shear = 0.2;
  const sweep = { value: -10 };
  const chrome = new THREE.MeshStandardMaterial({ color: '#f2f5fa', metalness: 1, roughness: 0.1, envMap: env, envMapIntensity: 1.25 });
  chrome.onBeforeCompile = (sh) => {
    sh.uniforms.uSweep = sweep;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSweepPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSweepPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSweepPos;\nuniform float uSweep;')
      .replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        float d = vSweepPos.x + vSweepPos.y * 0.7 - uSweep;
        float band = exp(-d * d * 30.0);
        gl_FragColor.rgb += vec3(1.0, 0.92, 0.8) * band * 3.5;`,
      );
  };
  let x = 0;
  const geos: THREE.BufferGeometry[] = [];
  for (const ch of word) {
    const L = LETTERS[ch];
    const g = new THREE.ExtrudeGeometry(L.shape(), {
      depth: 0.22,
      bevelEnabled: true,
      bevelThickness: 0.07,
      bevelSize: 0.045,
      bevelSegments: 4,
      curveSegments: 4,
    });
    g.translate(x, 0, 0);
    geos.push(g);
    x += L.w + gap;
  }
  const width = x - gap;
  const shearM = new THREE.Matrix4().set(1, shear, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  for (const g of geos) {
    g.applyMatrix4(shearM);
    g.translate(-width / 2 - shear * 0.5, -0.5, 0);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, chrome);
    root.add(m);
  }

  // Backing plate: a dark slanted blade with a hot orange rim.
  const pw = width / 2 + 0.55;
  const plate = poly([
    [-pw - 0.25, -0.78],
    [pw - 0.05, -0.78],
    [pw + 0.35, 0.78],
    [-pw + 0.15, 0.78],
  ]);
  const plateGeo = new THREE.ExtrudeGeometry(plate, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
  plateGeo.translate(0, 0, -0.22);
  const plateMat = new THREE.MeshStandardMaterial({ color: '#15171c', metalness: 0.9, roughness: 0.35, envMap: env, envMapIntensity: 0.5 });
  root.add(new THREE.Mesh(plateGeo, plateMat));
  const rimShape = poly([
    [-pw - 0.36, -0.88],
    [pw + 0.04, -0.88],
    [pw + 0.48, 0.88],
    [-pw + 0.08, 0.88],
  ]);
  rimShape.holes.push(
    holePath([
      [-pw - 0.25, -0.78],
      [pw - 0.05, -0.78],
      [pw + 0.35, 0.78],
      [-pw + 0.15, 0.78],
    ]),
  );
  const rimGeo = new THREE.ExtrudeGeometry(rimShape, { depth: 0.06, bevelEnabled: false });
  rimGeo.translate(0, 0, -0.2);
  const rim = new THREE.Mesh(rimGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(4.5, 1.25, 0.05) }));
  root.add(rim);
  // Bolt heads in the plate corners.
  const boltGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.05, 6);
  boltGeo.rotateX(Math.PI / 2);
  for (const [bx, by] of [
    [-pw - 0.05, -0.62],
    [pw - 0.12, -0.62],
    [pw + 0.22, 0.62],
    [-pw + 0.28, 0.62],
  ]) {
    const b = new THREE.Mesh(boltGeo, chrome);
    b.position.set(bx, by, -0.1);
    root.add(b);
  }

  return {
    root,
    width: width + 1.4,
    update(time) {
      // A highlight sweeps across every few seconds.
      const period = 4.5;
      const ph = (time % period) / period;
      sweep.value = -width * 0.8 + ph * width * 2.2;
    },
  };
}
