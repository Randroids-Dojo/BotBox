// Environment maps: a simplified Box with its light rig, prefiltered with PMREM, so steel,
// chrome and Lexan reflect the truss lights, the dark stands and the hot floor.

import * as THREE from 'three';
import { ARENA_HALF, BIG_SCREEN, LEXAN_TOP } from '../../data/arena';
import { TRUSS_HALF, TRUSS_Y, type Fixture } from './structure';

export function buildArenaEnv(renderer: THREE.WebGLRenderer, fixtures: Fixture[]): THREE.Texture {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0.004, 0.005, 0.008);
  const basic = (c: THREE.ColorRepresentation, k = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide });
  // Floor: lit grey steel with brighter pools.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2), basic('#4a5058', 0.55));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  for (const f of fixtures) {
    const pool = new THREE.Mesh(new THREE.CircleGeometry(Math.tan(f.angle) * f.pos.distanceTo(f.target) * 0.8, 16), basic(f.color, 0.35));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(f.target.x, 0.01, f.target.z);
    scene.add(pool);
  }
  // Stands: dark, slightly warm, a faint band of lit faces near the bottom.
  const stands = new THREE.Mesh(new THREE.CylinderGeometry(16, 13, 10, 32, 1, true), basic('#0c0c10', 1));
  stands.position.y = 4;
  scene.add(stands);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(12.5, 12.5, 1.2, 32, 1, true), basic('#352c26', 1));
  band.position.y = 1.6;
  scene.add(band);
  // Kick walls.
  const walls = new THREE.Mesh(new THREE.BoxGeometry(ARENA_HALF * 2, 0.6, ARENA_HALF * 2), basic('#5a5e64', 0.5));
  walls.position.y = 0.3;
  (walls.material as THREE.MeshBasicMaterial).side = THREE.BackSide;
  scene.add(walls);
  // Truss lights: bright small discs, strong enough to read as hot speculars.
  for (const f of fixtures) {
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.3, 12), basic(f.color, 60));
    lamp.position.copy(f.pos);
    lamp.lookAt(0, 0, 0);
    scene.add(lamp);
  }
  // A couple of big soft key panels overhead.
  for (const [x, z] of [
    [0, 0],
    [8, 9],
  ]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), basic('#dfe8ff', 8));
    panel.position.set(x, 16, z);
    panel.lookAt(0, 0, 0);
    scene.add(panel);
  }
  // Truss silhouette lines.
  const trussMat = basic('#3a3d44', 0.6);
  for (const s of [-1, 1]) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(TRUSS_HALF * 2, 0.4, 0.4), trussMat);
    a.position.set(0, TRUSS_Y, s * TRUSS_HALF);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, TRUSS_HALF * 2), trussMat);
    b.position.set(s * TRUSS_HALF, TRUSS_Y, 0);
    scene.add(a, b);
  }
  // Big screen glow and amber accents.
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(BIG_SCREEN.w, BIG_SCREEN.h), basic('#4a6aa0', 2));
  screen.position.set(BIG_SCREEN.pos.x, BIG_SCREEN.pos.y, BIG_SCREEN.pos.z);
  scene.add(screen);
  for (const [x, z] of [
    [-12, 0],
    [12, 0],
    [0, 13],
  ]) {
    const a = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.5), basic('#ff8a30', 3));
    a.position.set(x, 1.2, z);
    a.lookAt(0, 1.2, 0);
    scene.add(a);
  }
  // Lexan ceiling sheen.
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2), basic('#1a2228', 0.6));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = LEXAN_TOP;
  scene.add(ceil);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.0, 0.1, 60, { position: new THREE.Vector3(0, 1.2, 0) });
  pmrem.dispose();
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  return rt.texture;
}

/** A warm workshop environment for the garage. */
export function buildGarageEnv(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0.02, 0.016, 0.012);
  const basic = (c: THREE.ColorRepresentation, k = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide });
  const room = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 9), basic('#2a2118', 0.6));
  room.position.y = 2.5;
  scene.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 9), basic('#3a342c', 0.7));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.01;
  scene.add(floor);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8), basic('#ffd9a0', 40));
  lamp.position.set(0, 2.6, 0);
  scene.add(lamp);
  for (const x of [-3, 3]) {
    const tube = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.12), basic('#e8f0ff', 12));
    tube.position.set(x, 4.8, -1);
    scene.add(tube);
  }
  const door = new THREE.Mesh(new THREE.PlaneGeometry(3, 2.6), basic('#5a7aa8', 1.4));
  door.position.set(-4.9, 1.4, 1);
  door.rotation.y = Math.PI / 2;
  scene.add(door);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.0, 0.1, 40, { position: new THREE.Vector3(0, 1, 0) });
  pmrem.dispose();
  return rt.texture;
}

/** A classic chrome studio: bright sky, hard horizon, black ground, a few strip lights. */
export function buildChromeEnv(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(20, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */ `
        varying vec3 vP;
        void main() {
          vec3 d = normalize(vP);
          float y = d.y;
          vec3 top = vec3(0.55, 0.7, 1.1) * 2.2;
          vec3 hor = vec3(2.6, 1.3, 0.45);
          vec3 c = mix(hor, top, smoothstep(0.0, 0.5, y));
          vec3 ground = mix(vec3(0.02), vec3(0.12, 0.08, 0.06), smoothstep(-0.25, 0.0, y));
          c = y > 0.0 ? c : ground;
          // A thin bright line right at the horizon.
          c += vec3(4.0, 3.2, 2.4) * exp(-abs(y) * 120.0);
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  scene.add(sky);
  const strip = new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 14, 15), side: THREE.DoubleSide });
  for (const [x, y, z] of [
    [-6, 6, 4],
    [6, 5, 3],
    [0, 8, -6],
  ]) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.5), strip);
    s.position.set(x, y, z);
    s.lookAt(0, 0, 0);
    scene.add(s);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.0, 0.1, 50);
  pmrem.dispose();
  return rt.texture;
}
