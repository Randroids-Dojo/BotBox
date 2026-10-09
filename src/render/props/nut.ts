// Placeholder Giant Nut. The bots agent replaces this file. Keep the exported name.
import * as THREE from 'three';
import type { CreateNutTrophy } from '../types';

export const createNutTrophy: CreateNutTrophy = (envMap) => {
  const g = new THREE.Group();
  const nut = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.35, 0.3, 6),
    new THREE.MeshStandardMaterial({ color: '#ddd', metalness: 1, roughness: 0.15, envMap }),
  );
  nut.position.y = 0.75;
  nut.rotation.x = Math.PI / 2;
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.55, 0.6), new THREE.MeshStandardMaterial({ color: '#2a1a10' }));
  plinth.position.y = 0.275;
  g.add(nut, plinth);
  return g;
};
