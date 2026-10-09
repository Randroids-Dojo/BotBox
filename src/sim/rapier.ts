// Rapier loads its WASM once; everything in the sim awaits this before building a world.
import RAPIER from '@dimforge/rapier3d-compat';

let ready: Promise<typeof RAPIER> | null = null;

export function loadRapier(): Promise<typeof RAPIER> {
  if (!ready) ready = RAPIER.init().then(() => RAPIER);
  return ready;
}

export type Rapier = typeof RAPIER;
