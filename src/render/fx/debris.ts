// Debris meshes for the sim's loose bodies. Panels and wheels are copies of the shedding robot's
// own parts (same paint, dents and scratches), bent and scorched a little more; teeth and chunks
// are generic torn steel.
import * as THREE from 'three';
import type { DebrisFrame } from '../../contract';
import { bendPlate } from '../bots/plate';
import type { BotView, DebrisLayer } from '../types';
import { mulberry } from './sparks';

interface Item {
  obj: THREE.Object3D;
  owned: { geos: THREE.BufferGeometry[]; mats: THREE.Material[] };
}

const CHUNK_COLOR: Record<string, string> = {
  aluminum: '#b9bdc2',
  titanium: '#7d858f',
  steel: '#55595e',
  uhmw: '#e8e6de',
  polycarb: '#cfdfe6',
};

export class Debris implements DebrisLayer {
  readonly root = new THREE.Group();
  private items = new Map<number, Item>();
  private seen = new Set<number>();
  private steel = new THREE.MeshStandardMaterial({ color: '#7d8186', metalness: 1, roughness: 0.42 });
  private toothGeo: THREE.BufferGeometry;

  constructor() {
    this.root.name = 'debris';
    const sh = new THREE.Shape();
    sh.moveTo(-0.5, -0.5);
    sh.lineTo(0.5, -0.5);
    sh.lineTo(0.5, 0.5);
    sh.lineTo(0.1, 0.5);
    sh.lineTo(-0.5, -0.1);
    sh.closePath();
    this.toothGeo = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false });
    this.toothGeo.translate(0, 0, -0.5);
  }

  update(debris: DebrisFrame[], bots: (id: string) => BotView | undefined): void {
    this.seen.clear();
    for (const d of debris) {
      this.seen.add(d.id);
      let it = this.items.get(d.id);
      if (!it) {
        it = this.make(d, bots(d.bot));
        this.items.set(d.id, it);
        this.root.add(it.obj);
      }
      it.obj.position.set(d.pos.x, d.pos.y, d.pos.z);
      it.obj.quaternion.set(d.quat.x, d.quat.y, d.quat.z, d.quat.w);
    }
    for (const [id, it] of this.items) if (!this.seen.has(id)) this.drop(id, it);
  }

  private make(d: DebrisFrame, view: BotView | undefined): Item {
    const owned: Item['owned'] = { geos: [], mats: [] };
    const r = mulberry(d.id * 7919 + 13);
    let obj: THREE.Object3D;
    if (d.kind === 'panel' && view && d.index !== undefined) {
      obj = view.panelMesh(d.index);
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        owned.geos.push(m.geometry);
        // Bent by the hit that tore it off.
        if (m === obj.children[0]) bendPlate(m.geometry, (r() - 0.3) * 0.9, (r() - 0.5) * 0.6);
        const mat = (m.material as THREE.MeshStandardMaterial).clone();
        mat.color.multiplyScalar(0.82);
        owned.mats.push(mat);
        m.material = mat;
        m.castShadow = true;
      });
    } else if (d.kind === 'wheel' && view && d.index !== undefined) {
      obj = view.wheelMesh(d.index);
      obj.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    } else if (d.kind === 'tooth') {
      const m = new THREE.Mesh(this.toothGeo, this.steel);
      m.scale.set(d.size.x, d.size.y, d.size.z);
      m.castShadow = true;
      obj = m;
    } else {
      const mat = view?.spec.loadout.armor.material ?? 'steel';
      const g = new THREE.IcosahedronGeometry(0.5, 0);
      // Torn and lumpy.
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.7 + 0.5 * r()), p.getY(i) * (0.5 + 0.4 * r()), p.getZ(i) * (0.7 + 0.5 * r()));
      g.computeVertexNormals();
      const mm = new THREE.MeshStandardMaterial({ color: CHUNK_COLOR[mat], metalness: mat === 'uhmw' || mat === 'polycarb' ? 0 : 0.9, roughness: 0.45 });
      owned.geos.push(g);
      owned.mats.push(mm);
      const m = new THREE.Mesh(g, mm);
      m.scale.set(d.size.x, d.size.y, d.size.z);
      m.castShadow = true;
      obj = m;
    }
    obj.name = `debris:${d.id}`;
    return { obj, owned };
  }

  private drop(id: number, it: Item): void {
    it.obj.removeFromParent();
    for (const g of it.owned.geos) g.dispose();
    for (const m of it.owned.mats) m.dispose();
    this.items.delete(id);
  }

  clear(): void {
    for (const [id, it] of this.items) this.drop(id, it);
  }
}
