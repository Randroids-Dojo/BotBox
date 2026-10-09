// Assembles the Box and everything around it into one scene graph.

import * as THREE from 'three';
import type { HazardFrame } from '../../contract';
import type { Quality } from '../types';
import { buildCrowd, type Crowd } from './crowd';
import { buildDressing, type ArenaDressing } from './dressing';
import { buildArenaEnv } from './env';
import { buildFloorTextures, createFloor } from './floor';
import { buildHazards, type Hazards } from './hazards';
import { buildLightRig, type Dressing, type LightRig } from './lights';
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
  dressing: ArenaDressing;
  setQuality(q: Quality): void;
  /** Event dressing: lights, crowd, banners and props. Cheap to switch. */
  setDressing(d: Dressing): void;
  getDressing(): Dressing;
  update(hazards: HazardFrame[], lights: number, dt: number, time: number): void;
}

export const CROWD_LAYER = 1;

export function crowdDensity(q: Quality): number {
  return q === 'high' ? 0.92 : q === 'medium' ? 0.6 : 0.32;
}

/** The crowd is built this full so a packed finals house is a fill change, not a rebuild. */
function crowdBuilt(q: Quality): number {
  return q === 'high' ? 1 : q === 'medium' ? 0.72 : 0.42;
}

const FILL: Record<Dressing, number> = { normal: 1, qualifier: 0.2, championship: 1 };
/** House lights on the stands (the crowd shader's light level). */
const HOUSE: Record<Dressing, number> = { normal: 1, qualifier: 0.55, championship: 1.2 };

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
  const crowd = buildCrowd(stands.seats, crowdBuilt(quality));
  root.add(crowd.root);
  // The crowd lives on its own layer: the main camera sees it, the big screen feed and the
  // shadow cameras skip it.
  crowd.root.traverse((o) => o.layers.set(CROWD_LAYER));
  const env = buildArenaEnv(renderer, structure.fixtures);
  const dressing = buildDressing(mats);
  root.add(dressing.root);
  progress(0.8);

  let dress: Dressing = 'normal';
  let q0 = quality;
  // Normal shows the usual house; the finals pack every built seat; a qualifier is a fifth of it.
  const applyFill = () => crowd.setFill(dress === 'championship' ? 1 : (crowdDensity(q0) / crowdBuilt(q0)) * FILL[dress]);
  const lensColor = new THREE.Color();
  const applyLenses = () => {
    // Fixtures without a beam in a qualifier are switched off.
    const lit = new Set(lights.litFixtures());
    const k = dress === 'championship' ? 18 : 14;
    structure.fixtures.forEach((f, i) => {
      const on = dress !== 'qualifier' || lit.has(f);
      structure.lenses.setColorAt(i, lensColor.copy(f.color).multiplyScalar(on ? k : 0.25));
    });
    if (structure.lenses.instanceColor) structure.lenses.instanceColor.needsUpdate = true;
  };
  applyFill();

  return {
    root,
    env,
    mats,
    structure,
    lights,
    hazards,
    stands,
    crowd,
    dressing,
    setQuality(q) {
      q0 = q;
      lights.setQuality(q);
      crowd.setDensity(crowdBuilt(q));
      crowd.root.traverse((o) => o.layers.set(CROWD_LAYER));
      applyFill();
      applyLenses();
    },
    setDressing(d) {
      dress = d;
      lights.setDressing(d);
      dressing.set(d);
      crowd.uniforms.uLight.value = HOUSE[d];
      // No TV on a Tuesday: the big screen is off.
      stands.screenUniforms.uOn.value = d === 'qualifier' ? 0 : 1;
      applyFill();
      applyLenses();
    },
    getDressing() {
      return dress;
    },
    update(hz, lit, dt, time) {
      hazards.update(hz, dt, time);
      hazards.setLights(lit, time);
      lights.beamUniforms.uTime.value = time;
      dressing.sweepUniforms.uTime.value = time;
      crowd.uniforms.uTime.value = time;
      stands.screenUniforms.uTime.value = time;
    },
  };
}
