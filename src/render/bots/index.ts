// Robot views. Procedural robots built from a BotSpec: see view.ts for the assembly, paint.ts
// for paint and damage textures, plate.ts for armor geometry, weapons.ts, wheel.ts and
// internals.ts for the hardware.
import type { BotView, CreateBotView } from '../types';
import type { MissingPart } from './view';
import { createProceduralBotView } from './view';

export const createBotView: CreateBotView = (spec, opts) => createProceduralBotView(spec, opts);

export type { MissingPart } from './view';

/** Garage rebuild: hide parts not fitted yet on a procedural robot view (see view.ts). */
export function setMissingParts(view: BotView, parts: readonly MissingPart[], animate: boolean): void {
  (view as Partial<{ setMissing(p: readonly MissingPart[], a: boolean): void }>).setMissing?.(parts, animate);
}
