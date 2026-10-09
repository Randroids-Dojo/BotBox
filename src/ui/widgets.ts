// Reusable menu widgets: buttons, cyclers, sliders, toggles, the hex-nut icon, stat bars.

import type { BotStats, WeightClass } from '../contract';
import { el, item, type ItemHandlers } from './core';
import { STAT_DEFS } from './stats';

export function button(label: string, opts: ItemHandlers & { sub?: string; cls?: string; disabled?: boolean } = {}): HTMLElement {
  const b = el(`div.btn${opts.cls ? '.' + opts.cls.split(' ').join('.') : ''}`, [el('span.label', label), opts.sub ? el('span.sub', opts.sub) : null]);
  if (opts.disabled) b.classList.add('is-disabled');
  return item(b, opts);
}

export interface Cycler<T> {
  node: HTMLElement;
  value: T;
  set(v: T): void;
}

/** A left/right option picker: ◀ VALUE ▶. */
export function cycler<T>(label: string, options: { value: T; label: string }[], value: T, onChange: (v: T) => void, onMove?: () => void): Cycler<T> {
  const val = el('span.cyc-val.wide');
  const left = el('span.cyc-arrow.l', '◀');
  const right = el('span.cyc-arrow.r', '▶');
  const node = el('div.row.cycler', [el('span.row-label', label), el('span.cyc', [left, val, right])]);
  const state: Cycler<T> = {
    node,
    value,
    set(v: T) {
      state.value = v;
      val.textContent = options.find((o) => o.value === v)?.label ?? String(v);
    },
  };
  const step = (dir: -1 | 1) => {
    const i = options.findIndex((o) => o.value === state.value);
    const n = options[(i + dir + options.length) % options.length];
    state.set(n.value);
    onMove?.();
    onChange(n.value);
  };
  left.addEventListener('click', (e) => {
    e.stopPropagation();
    step(-1);
  });
  right.addEventListener('click', (e) => {
    e.stopPropagation();
    step(1);
  });
  item(node, { activate: () => step(1), adjust: (d) => step(d) });
  state.set(value);
  return state;
}

/** A segmented 0..1 slider like a broadcast meter. */
export function slider(label: string, value: number, onChange: (v: number) => void, onMove?: () => void): HTMLElement {
  const segs: HTMLElement[] = [];
  const meter = el('span.meter');
  for (let i = 0; i < 10; i++) {
    const s = el('span.seg');
    segs.push(s);
    meter.append(s);
  }
  const num = el('span.meter-num.cond');
  const node = el('div.row.slider', [el('span.row-label', label), el('span.meter-wrap', [meter, num])]);
  let v = value;
  const draw = () => {
    const lit = Math.round(v * 10);
    segs.forEach((s, i) => s.classList.toggle('on', i < lit));
    num.textContent = String(Math.round(v * 100));
  };
  const set = (nv: number) => {
    nv = Math.max(0, Math.min(1, Math.round(nv * 10) / 10));
    if (nv === v) return false;
    v = nv;
    draw();
    onMove?.();
    onChange(v);
    return true;
  };
  segs.forEach((s, i) =>
    s.addEventListener('click', (e) => {
      e.stopPropagation();
      set((i + 1) / 10);
    }),
  );
  item(node, { adjust: (d) => void set(v + d * 0.1), activate: () => void set(v >= 1 ? 0 : v + 0.1) });
  draw();
  return node;
}

export function toggle(label: string, value: boolean, onChange: (v: boolean) => void, onMove?: () => void): HTMLElement {
  const pill = el('span.pill.wide');
  const node = el('div.row.toggle', [el('span.row-label', label), pill]);
  let v = value;
  const draw = () => {
    pill.textContent = v ? 'On' : 'Off';
    pill.classList.toggle('on', v);
  };
  const flip = () => {
    v = !v;
    draw();
    onMove?.();
    onChange(v);
  };
  item(node, { activate: flip, adjust: () => flip() });
  draw();
  return node;
}

/** The Giant Nut icon: a chrome hex with a hole. */
export function nutIcon(cls = ''): HTMLElement {
  return el(`span.nut-icon${cls ? '.' + cls : ''}`, el('span.nut-hole'));
}

/** Labelled stat bars from BotStats, with optional comparison deltas. */
export function statBars(stats: BotStats, cls: WeightClass, compare?: BotStats | null, ids?: string[]): HTMLElement {
  const wrap = el('div.statbars');
  for (const d of STAT_DEFS) {
    if (ids && !ids.includes(d.id)) continue;
    const v = Math.max(0, Math.min(1, d.bar(stats, cls)));
    const fill = el('span.sb-fill');
    fill.style.width = `${(v * 100).toFixed(1)}%`;
    const track = el('span.sb-track', fill);
    let deltaNode: HTMLElement | null = null;
    if (compare) {
      const diff = d.value(compare, cls) - d.value(stats, cls);
      const cv = Math.max(0, Math.min(1, d.bar(compare, cls)));
      if (Math.abs(diff) > 1e-3) {
        const ghost = el(`span.sb-ghost.${diff > 0 ? 'up' : 'down'}`);
        const a = Math.min(v, cv);
        ghost.style.left = `${a * 100}%`;
        ghost.style.width = `${Math.abs(cv - v) * 100}%`;
        track.append(ghost);
        deltaNode = el(`span.sb-delta.${diff > 0 ? 'up' : 'down'}.cond`, d.delta(diff));
      }
    }
    wrap.append(
      el(`div.sb.sb-${d.id}`, [el('span.sb-label', d.label), track, el('span.sb-val.cond', d.text(stats)), deltaNode ?? el('span.sb-delta.cond', '')]),
    );
  }
  return wrap;
}
