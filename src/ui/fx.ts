// Shared UI context plus wipe, spark and lens-flare garnish for broadcast graphics.

import type { Loadout } from '../contract';
import type { Input } from '../input/input';
import { el, type Nav, type Sfx } from './core';

export interface Layers {
  hud: HTMLElement;
  gfx: HTMLElement;
  touch: HTMLElement;
  screen: HTMLElement;
  over: HTMLElement;
  top: HTMLElement;
}

export interface UiCtx {
  input: Input;
  nav: Nav;
  sfx: Sfx;
  root: HTMLElement;
  layers: Layers;
  /** The player's most recent loadout (for scouting tips). */
  mine: Loadout | null;
}

/** A burst of sparks at (x, y) in the container's coordinates (px). */
export function sparks(parent: HTMLElement, x: number, y: number, n = 14, opts: { up?: boolean; spread?: number; speed?: number } = {}): void {
  const spread = opts.spread ?? Math.PI * 2;
  const base = opts.up ? -Math.PI / 2 : 0;
  for (let i = 0; i < n; i++) {
    const a = base + (Math.random() - 0.5) * spread;
    const d = (opts.speed ?? 1) * (60 + Math.random() * 180);
    const s = el('span.spark');
    const dx = Math.cos(a) * d;
    const dy = Math.sin(a) * d + 40 + Math.random() * 60;
    s.style.left = `${x}px`;
    s.style.top = `${y}px`;
    s.style.setProperty('--dx', `${dx}px`);
    s.style.setProperty('--dy', `${dy}px`);
    s.style.setProperty('--r', `${(Math.atan2(dy, dx) * 180) / Math.PI}deg`);
    s.style.setProperty('--t', `${0.35 + Math.random() * 0.45}s`);
    parent.append(s);
    setTimeout(() => s.remove(), 900);
  }
}

export function flare(parent: HTMLElement, x: number, y: number): void {
  const f = el('span.flare');
  f.style.left = `${x}px`;
  f.style.top = `${y}px`;
  parent.append(f);
  setTimeout(() => f.remove(), 700);
}

/** Sparks and a glint along the leading edge of an element that just slammed in. */
export function slamFx(parent: HTMLElement, target: HTMLElement, edge: 'left' | 'right' | 'top' | 'bottom' | 'center' = 'right', n = 16): void {
  requestAnimationFrame(() => {
    const p = parent.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    let x = r.left + r.width / 2;
    let y = r.top + r.height / 2;
    if (edge === 'right') x = r.right;
    if (edge === 'left') x = r.left;
    if (edge === 'top') y = r.top;
    if (edge === 'bottom') y = r.bottom;
    sparks(parent, x - p.left, y - p.top, n);
    flare(parent, x - p.left, y - p.top);
  });
}

/** A full-screen striped wipe across the given layer. */
export function wipe(parent: HTMLElement): void {
  const w = el('div.wipe');
  parent.append(w);
  setTimeout(() => w.remove(), 700);
}
