// Placeholder robot view: hull boxes, wheels and a weapon block. The bots agent replaces this
// file with the real procedural robots. Keep the exported names and signatures.
import * as THREE from 'three';
import type { BotFrame, BotSpec, Component, HitEvent } from '../../contract';
import type { BotView, BotViewOptions, CreateBotView } from '../types';

class StubBotView implements BotView {
  readonly root = new THREE.Group();
  private wheels: THREE.Mesh[] = [];
  private panels: THREE.Mesh[] = [];
  constructor(readonly spec: BotSpec, _opts: BotViewOptions) {
    const mat = new THREE.MeshStandardMaterial({ color: spec.loadout.paint.primary, metalness: 0.4, roughness: 0.5 });
    for (const p of spec.panels) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.t), mat);
      m.position.set(p.center.x, p.center.y, p.center.z);
      m.quaternion.set(p.rot.x, p.rot.y, p.rot.z, p.rot.w);
      m.castShadow = true;
      this.root.add(m);
      this.panels.push(m);
    }
    const tire = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.9 });
    for (const w of spec.wheels) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(w.radius, w.radius, w.width, 20), tire);
      m.rotation.z = Math.PI / 2;
      m.position.set(w.pos.x, w.pos.y, w.pos.z);
      this.root.add(m);
      this.wheels.push(m);
    }
  }
  update(f: BotFrame): void {
    this.root.position.set(f.pos.x, f.pos.y, f.pos.z);
    this.root.quaternion.set(f.quat.x, f.quat.y, f.quat.z, f.quat.w);
    this.spec.panels.forEach((p, i) => (this.panels[i].visible = f.facets[p.facet] > 0));
    this.wheels.forEach((w, i) => (w.visible = !f.wheelLost[i]));
  }
  hit(_e: HitEvent): void {}
  resetDamage(): void {}
  panelMesh(i: number): THREE.Object3D {
    const m = this.panels[i].clone();
    m.position.set(0, 0, 0);
    m.quaternion.identity();
    return m;
  }
  wheelMesh(i: number): THREE.Object3D {
    const m = this.wheels[i].clone();
    m.position.set(0, 0, 0);
    return m;
  }
  componentWorld(c: Component, out: THREE.Vector3): THREE.Vector3 {
    const s = this.spec.internals.find((x) => x.component === c);
    out.set(s?.center.x ?? 0, s?.center.y ?? 0, s?.center.z ?? 0);
    return this.root.localToWorld(out);
  }
  dispose(): void {}
}

export const createBotView: CreateBotView = (spec, opts) => new StubBotView(spec, opts);
