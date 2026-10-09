// Shared plumbing for the broadcast UI: element builder, focus navigation scopes driven by
// Input.onMenu and pointer events, UI sounds and small timing helpers.

import type { MenuNav } from '../contract';
import type { AudioEngine, Stinger, UiSound } from '../audio/types';
import type { Input } from '../input/input';

type Kid = Node | string | null | undefined | false;

/** Build an element: el('div.a.b', kids) or el('div.a', { attrs }, kids). */
export function el<K extends keyof HTMLElementTagNameMap = 'div'>(
  sel: string,
  attrs?: Record<string, string | number | boolean | undefined> | Kid | Kid[],
  kids?: Kid | Kid[],
): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = sel.split('.');
  const e = document.createElement(tag || 'div') as HTMLElementTagNameMap[K];
  if (classes.length) e.className = classes.join(' ');
  let children = kids;
  if (attrs !== undefined && (typeof attrs !== 'object' || attrs === null || attrs instanceof Node || Array.isArray(attrs))) {
    children = attrs as Kid | Kid[];
  } else if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === false) continue;
      if (k === 'style') e.setAttribute('style', String(v));
      else e.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(e, children);
  return e;
}

export function append(parent: HTMLElement, kids: Kid | Kid[]): void {
  const list = Array.isArray(kids) ? kids : [kids];
  for (const k of list) {
    if (k === null || k === undefined || k === false) continue;
    parent.append(typeof k === 'string' ? document.createTextNode(k) : k);
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Remove an element after its exit animation (class `out`), with a timeout fallback. */
export function exit(e: HTMLElement, ms = 320): Promise<void> {
  return new Promise((resolve) => {
    if (!e.isConnected) return resolve();
    e.classList.add('out');
    setTimeout(() => {
      e.remove();
      resolve();
    }, ms);
  });
}

/** Restart a CSS animation class. */
export function replay(e: HTMLElement, cls: string): void {
  e.classList.remove(cls);
  void e.offsetWidth;
  e.classList.add(cls);
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ------------------------------------------------------------------------------------------
// Sounds

export class Sfx {
  constructor(private audio: AudioEngine | null) {}
  ui(id: UiSound): void {
    try {
      this.audio?.ui(id);
    } catch {
      /* audio is optional */
    }
  }
  sting(id: Stinger): void {
    try {
      this.audio?.stinger(id);
    } catch {
      /* audio is optional */
    }
  }
  unlock(): void {
    try {
      this.audio?.unlock();
    } catch {
      /* audio is optional */
    }
  }
  get engine(): AudioEngine | null {
    return this.audio;
  }
}

// ------------------------------------------------------------------------------------------
// Focus navigation. A stack of scopes; only the top one hears Input.onMenu. Focusable items
// carry the `nav` class and optional handlers. Arrow keys move spatially between items.

export interface ItemHandlers {
  /** Confirm or click. */
  activate?: () => void;
  /** Left or right while focused (sliders, cyclers). Return false to let focus move instead. */
  adjust?: (dir: -1 | 1) => boolean | void;
  /** Called when the item gains focus (hover deltas, previews). */
  focus?: () => void;
}

const handlers = new WeakMap<HTMLElement, ItemHandlers>();

/** Make an element a focusable, clickable item. */
export function item<T extends HTMLElement>(e: T, h: ItemHandlers = {}): T {
  e.classList.add('nav');
  handlers.set(e, h);
  if (!e.getAttribute('role') && e.tagName !== 'INPUT') e.setAttribute('role', 'button');
  return e;
}

export function setHandlers(e: HTMLElement, h: ItemHandlers): void {
  handlers.set(e, { ...handlers.get(e), ...h });
}

export interface ScopeOptions {
  root: HTMLElement;
  back?: () => void;
  tab?: (dir: -1 | 1) => void;
  /** Wrap vertical movement at the ends of a list. */
  wrap?: boolean;
  initial?: HTMLElement | null;
  /** Called when focus moves, after handlers. */
  onFocus?: (e: HTMLElement) => void;
}

export class Scope {
  focused: HTMLElement | null = null;
  constructor(readonly nav: Nav, readonly opts: ScopeOptions) {}

  items(): HTMLElement[] {
    return [...this.opts.root.querySelectorAll<HTMLElement>('.nav')].filter(
      (e) => e.offsetParent !== null && !e.closest('.nav-off'),
    );
  }

  focus(e: HTMLElement | null, opts: { silent?: boolean; scroll?: boolean } = {}): void {
    if (e === this.focused) return;
    this.focused?.classList.remove('is-focus');
    this.focused = e;
    if (!e) return;
    e.classList.add('is-focus');
    if (opts.scroll !== false) e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (!opts.silent) this.nav.sfx.ui('move');
    handlers.get(e)?.focus?.();
    this.opts.onFocus?.(e);
  }

  /** Re-validate focus after the DOM changed. */
  refresh(prefer?: HTMLElement | null): void {
    const list = this.items();
    if (prefer && list.includes(prefer)) {
      this.focused?.classList.remove('is-focus');
      this.focused = null;
      this.focus(prefer, { silent: true });
      return;
    }
    if (this.focused && list.includes(this.focused)) {
      this.focused.classList.add('is-focus');
      return;
    }
    this.focused = null;
    this.focus(list[0] ?? null, { silent: true });
  }

  activate(e: HTMLElement): void {
    if (e.classList.contains('is-disabled')) {
      this.nav.sfx.ui('error');
      replay(e, 'shake');
      return;
    }
    if (e instanceof HTMLInputElement) {
      e.focus();
      return;
    }
    const h = handlers.get(e);
    if (h?.activate) {
      h.activate();
    }
  }

  handle(n: MenuNav): void {
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
      // Typing: Enter and Escape just finish editing.
      if (n === 'confirm' || n === 'back') {
        active.blur();
        this.nav.sfx.ui('select');
      }
      return;
    }
    if (n === 'back') {
      if (this.opts.back) {
        this.nav.sfx.ui('back');
        this.opts.back();
      }
      return;
    }
    if (n === 'tabPrev' || n === 'tabNext') {
      this.opts.tab?.(n === 'tabPrev' ? -1 : 1);
      return;
    }
    if (!this.focused || !this.items().includes(this.focused)) {
      this.refresh();
      if (n !== 'confirm') return;
    }
    const f = this.focused;
    if (!f) return;
    if (n === 'confirm') {
      this.activate(f);
      return;
    }
    if (n === 'left' || n === 'right') {
      const h = handlers.get(f);
      if (h?.adjust && h.adjust(n === 'left' ? -1 : 1) !== false) return;
    }
    const next = this.spatial(f, n);
    if (next) this.focus(next);
  }

  private spatial(from: HTMLElement, dir: 'up' | 'down' | 'left' | 'right'): HTMLElement | null {
    const a = from.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    const list = this.items();
    for (const e of list) {
      if (e === from) continue;
      const b = e.getBoundingClientRect();
      const bx = b.left + b.width / 2;
      const by = b.top + b.height / 2;
      let main: number;
      let ortho: number;
      if (dir === 'down') {
        main = b.top - a.bottom;
        if (by <= ay + 2) continue;
        ortho = overlap(a.left, a.right, b.left, b.right) ? 0 : Math.abs(bx - ax);
      } else if (dir === 'up') {
        main = a.top - b.bottom;
        if (by >= ay - 2) continue;
        ortho = overlap(a.left, a.right, b.left, b.right) ? 0 : Math.abs(bx - ax);
      } else if (dir === 'right') {
        main = b.left - a.right;
        if (bx <= ax + 2) continue;
        ortho = overlap(a.top, a.bottom, b.top, b.bottom) ? 0 : Math.abs(by - ay);
      } else {
        main = a.left - b.right;
        if (bx >= ax - 2) continue;
        ortho = overlap(a.top, a.bottom, b.top, b.bottom) ? 0 : Math.abs(by - ay);
      }
      const score = Math.max(-20, main) + ortho * 3 + Math.abs(dir === 'up' || dir === 'down' ? bx - ax : by - ay) * 0.05;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    if (!best && this.opts.wrap && (dir === 'up' || dir === 'down')) {
      const sorted = [...list].sort((p, q) => p.getBoundingClientRect().top - q.getBoundingClientRect().top);
      best = dir === 'down' ? sorted[0] : sorted[sorted.length - 1];
      if (best === from) best = null;
    }
    return best;
  }
}

function overlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return Math.min(a1, b1) - Math.max(a0, b0) > 4;
}

export class Nav {
  private stack: Scope[] = [];
  constructor(readonly input: Input, readonly sfx: Sfx) {
    input.onMenu((n) => this.top()?.handle(n));
  }

  top(): Scope | undefined {
    return this.stack[this.stack.length - 1];
  }

  push(opts: ScopeOptions): Scope {
    const s = new Scope(this, opts);
    this.stack.push(s);
    const root = opts.root;
    // Pointer: hover focuses (mouse), click activates.
    root.addEventListener('pointerover', (e) => {
      if (e.pointerType !== 'mouse' || this.top() !== s) return;
      const t = (e.target as HTMLElement).closest<HTMLElement>('.nav');
      if (t && root.contains(t) && t !== s.focused) s.focus(t, { scroll: false });
    });
    root.addEventListener('click', (e) => {
      if (this.top() !== s) return;
      const t = (e.target as HTMLElement).closest<HTMLElement>('.nav');
      if (!t || !root.contains(t)) return;
      if (t.tagName === 'INPUT') {
        s.focus(t, { silent: true, scroll: false });
        return;
      }
      s.focus(t, { silent: true, scroll: false });
      s.activate(t);
    });
    requestAnimationFrame(() => s.refresh(opts.initial ?? null));
    return s;
  }

  /** Drop every scope (debug and hard resets). */
  clear(): void {
    this.stack.length = 0;
  }

  pop(s: Scope): void {
    const i = this.stack.indexOf(s);
    if (i >= 0) this.stack.splice(i, 1);
    const active = document.activeElement as HTMLElement | null;
    if (active && s.opts.root.contains(active)) active.blur();
  }
}

/** Simulate an Input action without a public API (CAM, pause, skip buttons). */
export function emitAction(input: Input, a: 'camera' | 'pause' | 'skip'): void {
  const anyInput = input as unknown as { emitAction?: (a: string) => void };
  if (typeof anyInput.emitAction === 'function') anyInput.emitAction(a);
}

/** Sentence-case corner names. */
export const CORNER_COLOR: Record<string, string> = {
  red: '#ff2a2a',
  blue: '#2a7fff',
  green: '#28d465',
  yellow: '#ffd21f',
};

/** Health color ramp for schematics and gauges. */
export function healthColor(v: number): string {
  if (v <= 0) return '#2a2d33';
  if (v < 0.3) return '#ff2a1f';
  if (v < 0.6) return '#ffb000';
  return '#3be36b';
}
