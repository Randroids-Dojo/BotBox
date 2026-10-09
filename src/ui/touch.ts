// On-screen fight controls for phones: a floating left thumbstick, a big WEAPON button, a
// RIGHT button when the robot can self-right, and CAM. Tapping the scoreboard pauses. Each control tracks its own
// pointer id so driving and firing work at the same time.

import { el, emitAction } from './core';
import type { UiCtx } from './fx';

export class TouchControls {
  private node: HTMLElement | null = null;
  private opts: { weaponLabel: string; selfRight: boolean } | null = null;
  private forced = false;
  private offDevice: (() => void) | null = null;
  /** Until a device reports in, trust the pointer type so a phone's first touch drives. */
  private deviceKnown = false;
  private readonly coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  constructor(private ctx: UiCtx) {
    this.offDevice = ctx.input.onDevice(() => {
      this.deviceKnown = true;
      this.sync();
    });
  }

  /** Lab hook: show the controls whatever the last device was. */
  force(on: boolean): void {
    this.forced = on;
    this.sync();
  }

  set(opts: { weaponLabel: string; selfRight: boolean } | null): void {
    this.opts = opts;
    this.teardown();
    if (opts) this.build(opts);
    this.sync();
  }

  private sync(): void {
    const touchy = this.deviceKnown ? this.ctx.input.lastDevice === 'touch' : this.coarse || this.ctx.input.lastDevice === 'touch';
    const show = !!this.node && (this.forced || touchy);
    this.node?.classList.toggle('show', show);
    this.ctx.root.classList.toggle('touch-on', show);
  }

  private teardown(): void {
    if (!this.node) return;
    this.ctx.input.setTouchStick(0, 0);
    this.ctx.input.setTouchButton('weapon', false);
    this.ctx.input.setTouchButton('selfRight', false);
    this.node.remove();
    this.node = null;
  }

  private build(opts: { weaponLabel: string; selfRight: boolean }): void {
    const input = this.ctx.input;
    // ---- thumbstick: appears where the thumb lands in the left zone.
    const knob = el('div.ts-knob');
    const base = el('div.ts-base', [el('div.ts-ring'), knob]);
    const zone = el('div.ts-zone.live', base);
    let stickId: number | null = null;
    let cx = 0;
    let cy = 0;
    const R = () => base.getBoundingClientRect().width / 2 || 60;
    const place = (x: number, y: number) => {
      const z = zone.getBoundingClientRect();
      base.style.left = `${x - z.left}px`;
      base.style.top = `${y - z.top}px`;
    };
    const move = (x: number, y: number) => {
      const r = R();
      let dx = x - cx;
      let dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d > r) {
        dx = (dx / d) * r;
        dy = (dy / d) * r;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      input.setTouchStick(dx / r, -dy / r);
    };
    zone.addEventListener('pointerdown', (e) => {
      if (stickId !== null) return;
      e.preventDefault();
      stickId = e.pointerId;
      capture(zone, e.pointerId);
      cx = e.clientX;
      cy = e.clientY;
      place(cx, cy);
      base.classList.add('active');
      move(cx, cy);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== stickId) return;
      move(e.clientX, e.clientY);
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== stickId) return;
      stickId = null;
      base.classList.remove('active');
      knob.style.transform = '';
      base.style.left = '';
      base.style.top = '';
      input.setTouchStick(0, 0);
    };
    zone.addEventListener('pointerup', release);
    zone.addEventListener('pointercancel', release);

    // ---- buttons
    const hold = (b: HTMLElement, down: (d: boolean) => void) => {
      let id: number | null = null;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (id !== null) return;
        id = e.pointerId;
        capture(b, e.pointerId);
        b.classList.add('down');
        down(true);
      });
      const up = (e: PointerEvent) => {
        if (e.pointerId !== id) return;
        id = null;
        b.classList.remove('down');
        down(false);
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    };
    const tapBtn = (b: HTMLElement, fn: () => void) => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        b.classList.add('down');
        fn();
      });
      const up = () => b.classList.remove('down');
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    };

    const weapon = el('div.tb.tb-weapon.live', [el('span.tb-ring'), el('span.tb-t.wide', opts.weaponLabel || 'Weapon')]);
    hold(weapon, (d) => input.setTouchButton('weapon', d));
    const right = opts.selfRight ? el('div.tb.tb-right.live', el('span.tb-t.wide', 'Right')) : null;
    if (right) hold(right, (d) => input.setTouchButton('selfRight', d));
    const cam = el('div.tb.tb-cam.live', el('span.tb-t.wide', 'Cam'));
    tapBtn(cam, () => emitAction(input, 'camera'));
    // Pause lives on the scoreboard (see hud.ts), clear of the knockout count.
    this.node = el('div.touch', [zone, weapon, right, cam]);
    this.ctx.layers.touch.append(this.node);
  }

  dispose(): void {
    this.teardown();
    this.offDevice?.();
    void this.opts;
  }
}

function capture(e: HTMLElement, id: number): void {
  try {
    e.setPointerCapture(id);
  } catch {
    /* synthetic or already released pointers */
  }
}
