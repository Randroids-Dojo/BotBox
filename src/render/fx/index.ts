// Placeholder fx and debris layers. The bots agent replaces this file. Keep exported names.
import * as THREE from 'three';
import type { CreateDebrisLayer, CreateFxLayer, DebrisLayer, FxLayer } from '../types';

export const createFxLayer: CreateFxLayer = () => {
  const root = new THREE.Group();
  const fx: FxLayer = { root, event() {}, update() {}, clear() {}, dispose() {} };
  return fx;
};

export const createDebrisLayer: CreateDebrisLayer = () => {
  const root = new THREE.Group();
  const meshes = new Map<number, THREE.Object3D>();
  const layer: DebrisLayer = {
    root,
    update(debris, bots) {
      const seen = new Set<number>();
      for (const d of debris) {
        seen.add(d.id);
        let m = meshes.get(d.id);
        if (!m) {
          const view = bots(d.bot);
          m = d.kind === 'panel' && view && d.index !== undefined ? view.panelMesh(d.index) : d.kind === 'wheel' && view && d.index !== undefined ? view.wheelMesh(d.index) : new THREE.Mesh(new THREE.BoxGeometry(d.size.x, d.size.y, d.size.z), new THREE.MeshStandardMaterial({ color: '#888' }));
          meshes.set(d.id, m);
          root.add(m);
        }
        m.position.set(d.pos.x, d.pos.y, d.pos.z);
        m.quaternion.set(d.quat.x, d.quat.y, d.quat.z, d.quat.w);
      }
      for (const [id, m] of meshes) if (!seen.has(id)) { root.remove(m); meshes.delete(id); }
    },
    clear() {
      for (const m of meshes.values()) root.remove(m);
      meshes.clear();
    },
  };
  return layer;
};
