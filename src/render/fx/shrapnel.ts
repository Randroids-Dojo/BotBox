// Shrapnel: torn shards, popped bolts, chunks and plastic chips. Lit instanced meshes, simulated
// on the CPU: they tumble, bounce, skitter across the floor, settle and fade out after a while.
import * as THREE from 'three';
import { mulberry } from './sparks';

export type ShardKind = 'shard' | 'bolt' | 'chunk' | 'chip';

interface Piece {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  quat: THREE.Quaternion;
  spin: THREE.Vector3;
  age: number;
  life: number;
  scale: number;
  rest: boolean;
  hot: number;
  half: number;
}

function shardGeometry(): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  sh.moveTo(-0.5, -0.35);
  sh.lineTo(0.15, -0.5);
  sh.lineTo(0.55, -0.1);
  sh.lineTo(0.2, 0.15);
  sh.lineTo(0.35, 0.5);
  sh.lineTo(-0.2, 0.2);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: 0.06, bevelEnabled: false });
  g.translate(0, 0, -0.03);
  return g;
}

function boltGeometry(): THREE.BufferGeometry {
  const head = new THREE.CylinderGeometry(0.5, 0.5, 0.35, 6).toNonIndexed();
  head.translate(0, 0.6, 0);
  const shank = new THREE.CylinderGeometry(0.22, 0.22, 1.2, 8, 1).toNonIndexed();
  const parts = [head, shank];
  const pos: number[] = [];
  const nrm: number[] = [];
  for (const p of parts) {
    pos.push(...(p.attributes.position.array as Float32Array));
    nrm.push(...(p.attributes.normal.array as Float32Array));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.scale(0.5, 0.5, 0.5);
  return g;
}

export class ShrapnelSystem {
  readonly root = new THREE.Group();
  private meshes = new Map<ShardKind, THREE.InstancedMesh>();
  private pieces = new Map<ShardKind, Piece[]>();
  private colors = new Map<ShardKind, THREE.Color[]>();
  private rnd = mulberry(4242);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  /** Called for hot flying pieces so the layer can leave a spark trail. */
  trail: ((x: number, y: number, z: number, vx: number, vy: number, vz: number) => void) | null = null;

  constructor(private capacity: number) {
    const metal = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.85, roughness: 0.38 });
    const plastic = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0, roughness: 0.5 });
    const defs: [ShardKind, THREE.BufferGeometry, THREE.Material][] = [
      ['shard', shardGeometry(), metal],
      ['bolt', boltGeometry(), metal],
      ['chunk', new THREE.IcosahedronGeometry(0.5, 0), metal],
      ['chip', new THREE.BoxGeometry(1, 0.25, 0.7), plastic],
    ];
    for (const [k, g, mat] of defs) {
      const im = new THREE.InstancedMesh(g, mat, capacity);
      im.count = 0;
      im.castShadow = true;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      this.root.add(im);
      this.meshes.set(k, im);
      this.pieces.set(k, []);
      this.colors.set(k, []);
    }
  }

  spawn(kind: ShardKind, x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, color: THREE.ColorRepresentation, hot = 0): void {
    const list = this.pieces.get(kind)!;
    const cols = this.colors.get(kind)!;
    if (list.length >= this.capacity) {
      list.shift();
      cols.shift();
    }
    const r = this.rnd;
    list.push({
      pos: new THREE.Vector3(x, y, z),
      vel: new THREE.Vector3(vx, vy, vz),
      quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 6, r() * 6, r() * 6)),
      spin: new THREE.Vector3((r() - 0.5) * 30, (r() - 0.5) * 30, (r() - 0.5) * 30),
      age: 0,
      life: 7 + r() * 5,
      scale: size * (0.6 + 0.8 * r()),
      rest: false,
      hot,
      half: kind === 'chunk' ? 0.4 : kind === 'bolt' ? 0.15 : 0.08,
    });
    cols.push(new THREE.Color(color).multiplyScalar(0.8 + 0.4 * r()));
  }

  update(dt: number): void {
    const r = this.rnd;
    for (const [kind, list] of this.pieces) {
      const im = this.meshes.get(kind)!;
      const cols = this.colors.get(kind)!;
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.age += dt;
        if (p.age > p.life) {
          list.splice(i, 1);
          cols.splice(i, 1);
          continue;
        }
        if (!p.rest) {
          p.vel.y -= 9.81 * dt;
          p.pos.addScaledVector(p.vel, dt);
          const floor = p.half * p.scale;
          if (p.pos.y < floor) {
            p.pos.y = floor;
            if (p.vel.y < -0.6) {
              p.vel.y = -p.vel.y * 0.32;
              p.vel.x = p.vel.x * 0.7 + (r() - 0.5) * 0.6;
              p.vel.z = p.vel.z * 0.7 + (r() - 0.5) * 0.6;
              p.spin.multiplyScalar(0.6).add(new THREE.Vector3((r() - 0.5) * 8, (r() - 0.5) * 8, (r() - 0.5) * 8));
            } else {
              // Skitter and slide to a stop.
              p.vel.y = 0;
              p.vel.x *= Math.max(0, 1 - 3.5 * dt);
              p.vel.z *= Math.max(0, 1 - 3.5 * dt);
              p.spin.multiplyScalar(Math.max(0, 1 - 6 * dt));
              if (p.vel.lengthSq() < 0.02) p.rest = true;
            }
          }
          for (const ax of ['x', 'z'] as const) {
            if (Math.abs(p.pos[ax]) > 7.25) {
              p.pos[ax] = Math.sign(p.pos[ax]) * 7.25;
              p.vel[ax] *= -0.4;
            }
          }
          const w = p.spin.length();
          if (w > 1e-3) {
            this.q.setFromAxisAngle(this.s.copy(p.spin).divideScalar(w), w * dt);
            p.quat.premultiply(this.q);
          }
          if (p.hot > 0 && this.trail && p.vel.lengthSq() > 4 && r() < 0.6) this.trail(p.pos.x, p.pos.y, p.pos.z, p.vel.x * 0.2, p.vel.y * 0.2, p.vel.z * 0.2);
          p.hot = Math.max(0, p.hot - dt * 2);
        }
      }
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const fade = p.age > p.life - 1 ? p.life - p.age : 1;
        this.s.setScalar(p.scale * Math.max(0.001, fade));
        this.m.compose(p.pos, p.quat, this.s);
        im.setMatrixAt(i, this.m);
        im.setColorAt(i, cols[i]);
      }
      im.count = list.length;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  clear(): void {
    for (const [k, list] of this.pieces) {
      list.length = 0;
      this.colors.get(k)!.length = 0;
      this.meshes.get(k)!.count = 0;
    }
  }

  dispose(): void {
    for (const im of this.meshes.values()) {
      im.geometry.dispose();
      (im.material as THREE.Material).dispose();
      im.dispose();
    }
  }
}
