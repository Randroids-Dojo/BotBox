// Fx and debris layers. See layer.ts (sparks, smoke, fire, flashes, shrapnel, hazards) and
// debris.ts (meshes for the sim's loose bodies).
import type { CreateDebrisLayer, CreateFxLayer } from '../types';
import { Debris } from './debris';
import { Fx } from './layer';

export const createFxLayer: CreateFxLayer = (opts) => new Fx(opts.quality);

export const createDebrisLayer: CreateDebrisLayer = () => new Debris();
