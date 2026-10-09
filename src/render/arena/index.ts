// Assembles the Box and everything around it into one scene graph.

import * as THREE from 'three';
import type { HazardFrame } from '../../contract';
import type { Quality } from '../types';
import { buildCrowd, type Crowd } from './crowd';
import { buildArenaEnv } from './env';
import { buildFloorTextures, createFloor } from './floor';
import { buildHazards, type Hazards } from './hazards';
import { buildLightRig, type LightRig } from './lights';
import { createArenaMaterials, type ArenaMaterials } from './materials';
import { buildStands, type Stands } from './stands';
import { buildStructure, type Structure } from './structure';

export interface Arena {
  root: THREE.Group;
  env: THREE.Texture;
  mats: ArenaMaterials;
  structure: Structure;
  lights: LightRig;
  hazards: Hazards;
  stands: Stands;
  crowd: Crowd;
  setQuality(q: Quality): void;
  update(hazards: HazardFrame[], lights: number, dt: number, time: number): void;
}

export function crowdDensity(q: Quality): number {
  return q === 'high' ? 0.92 : q === 'medium' ? 0.6 : 0.32;
}

export async function buildArena(renderer: THREE.WebGLRenderer, quality: Quality, progress: (p: number) => void): Promise<Arena> {
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));
  const root = new THREE.Group();
  root.name = 'arena';
  const mats = createArenaMaterials();
  progress(0.1);
  await tick();
  const floorTex = buildFloorTextures(quality === 'low' ? 1024 : 2048);
  root.add(createFloor(floorTex));
  progress(0.35);
  await tick();
  const structure = buildStructure(mats);
  root.add(structure.root);
  const lights = buildLightRig(structure.fixtures, quality);
  root.add(lights.root);
  progress(0.5);
  await tick();
  const hazards = buildHazards(mats);
  root.add(hazards.root);
  const stands = buildStands(mats);
  root.add(stands.root);
  progress(0.65);
  await tick();
  const crowd = buildCrowd(stands.seats, crowdDensity(quality));
  root.add(crowd.root);
  const env = buildArenaEnv(renderer, structure.fixtures);
  progress(0.8);

  return {
    root,
    env,
    mats,
    structure,
    lights,
    hazards,
    stands,
    crowd,
    setQuality(q) {
      lights.setQuality(q);
      crowd.setDensity(crowdDensity(q));
    },
    update(hz, lit, dt, time) {
      hazards.update(hz, dt, time);
      hazards.setLights(lit, time);
      lights.beamUniforms.uTime.value = time;
      crowd.uniforms.uTime.value = time;
      stands.screenUniforms.uTime.value = time;
    },
  };
}
