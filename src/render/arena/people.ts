// Low poly person geometry shared by the crowd, the drivers and the booth hosts. A `part`
// attribute marks body (0), head (1), left arm (2) and right arm (3) so the crowd shader can
// animate arms.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function tagged(g: THREE.BufferGeometry, part: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const c = g.index ? g.toNonIndexed() : g;
  c.translate(x, y, z);
  const n = c.attributes.position.count;
  c.setAttribute('part', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
  c.deleteAttribute('uv');
  return c;
}

/** Seated person, origin at seat level, facing -Z. About 1.25 m tall seated. */
export function personGeometry(seated = true): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const hip = seated ? 0.05 : 0.85;
  // Torso, slightly tapered.
  const torso = new THREE.CylinderGeometry(0.2, 0.16, 0.56, 6, 1);
  torso.scale(1, 1, 0.62);
  parts.push(tagged(torso, 0, 0, hip + 0.3, 0));
  // Head.
  parts.push(tagged(new THREE.IcosahedronGeometry(0.11, 0), 1, 0, hip + 0.72, -0.01));
  // Arms hang from the shoulders (pivot at y = hip + 0.55).
  for (const [s, part] of [
    [-1, 2],
    [1, 3],
  ] as const) {
    const arm = new THREE.BoxGeometry(0.08, 0.5, 0.09);
    parts.push(tagged(arm, part, s * 0.24, hip + 0.33, -0.02));
  }
  if (seated) {
    // Thighs forward and shins down.
    const thigh = new THREE.BoxGeometry(0.34, 0.13, 0.42);
    parts.push(tagged(thigh, 0, 0, hip + 0.02, -0.2));
    const shin = new THREE.BoxGeometry(0.3, 0.42, 0.12);
    parts.push(tagged(shin, 0, 0, hip - 0.2, -0.4));
  } else {
    for (const s of [-1, 1]) parts.push(tagged(new THREE.BoxGeometry(0.13, 0.85, 0.14), 0, s * 0.1, 0.42, 0));
  }
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return g;
}
