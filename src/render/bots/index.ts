// Robot views. Procedural robots built from a BotSpec: see view.ts for the assembly, paint.ts
// for paint and damage textures, plate.ts for armor geometry, weapons.ts, wheel.ts and
// internals.ts for the hardware.
import type { CreateBotView } from '../types';
import { createProceduralBotView } from './view';

export const createBotView: CreateBotView = (spec, opts) => createProceduralBotView(spec, opts);
