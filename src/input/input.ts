// Keyboard, gamepad and touch, merged into one drive command and one stream of menu navigation.

import type { DriveCommand, MenuNav } from '../contract';
import type { DriveMode } from '../ui/types';

export type Device = 'keyboard' | 'gamepad' | 'touch' | 'mouse';
export type Action = 'camera' | 'pause' | 'skip';

const NAV_KEYS: Record<string, MenuNav> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
  Enter: 'confirm',
  NumpadEnter: 'confirm',
  Space: 'confirm',
  Escape: 'back',
  Backspace: 'back',
  KeyQ: 'tabPrev',
  KeyE: 'tabNext',
  PageUp: 'tabPrev',
  PageDown: 'tabNext',
};

const DEAD = 0.18;
const REPEAT_DELAY = 0.38;
const REPEAT_RATE = 0.11;

function dead(v: number): number {
  const a = Math.abs(v);
  if (a < DEAD) return 0;
  return Math.sign(v) * Math.min(1, (a - DEAD) / (1 - DEAD));
}

function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export class Input {
  lastDevice: Device = 'keyboard';
  driveMode: DriveMode = 'robot';

  private keys = new Set<string>();
  private weaponEdge = false;
  private menuSubs = new Set<(n: MenuNav) => void>();
  private actionSubs = new Set<(a: Action) => void>();
  private deviceSubs = new Set<(d: Device) => void>();

  private padPrev: boolean[] = [];
  private padNavHeld: MenuNav | null = null;
  private padNavTimer = 0;
  private padWeaponPrev = false;
  private padStick = { lx: 0, ly: 0, rx: 0, ry: 0 };
  private padButtons = { weapon: false, selfRight: false };
  private padConnected = false;
  private lastPoll = performance.now();

  /** Written by the UI's on-screen controls. Stick y is forward. */
  readonly touch = {
    x: 0,
    y: 0,
    weapon: false,
    selfRight: false,
    weaponEdge: false,
  };

  constructor() {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('pointerdown', (e) => this.setDevice(e.pointerType === 'touch' ? 'touch' : 'mouse'), {
      capture: true,
    });
  }

  setTouchStick(x: number, y: number): void {
    this.touch.x = x;
    this.touch.y = y;
    this.setDevice('touch');
  }

  setTouchButton(id: 'weapon' | 'selfRight', down: boolean): void {
    if (id === 'weapon') {
      if (down && !this.touch.weapon) this.touch.weaponEdge = true;
      this.touch.weapon = down;
    } else this.touch.selfRight = down;
    this.setDevice('touch');
  }

  onMenu(fn: (n: MenuNav) => void): () => void {
    this.menuSubs.add(fn);
    return () => this.menuSubs.delete(fn);
  }

  onAction(fn: (a: Action) => void): () => void {
    this.actionSubs.add(fn);
    return () => this.actionSubs.delete(fn);
  }

  onDevice(fn: (d: Device) => void): () => void {
    this.deviceSubs.add(fn);
    return () => this.deviceSubs.delete(fn);
  }

  get gamepadConnected(): boolean {
    return this.padConnected;
  }

  /** Call once per animation frame. */
  poll(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastPoll) / 1000);
    this.lastPoll = now;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    this.padConnected = !!pad;
    if (!pad) {
      this.padStick = { lx: 0, ly: 0, rx: 0, ry: 0 };
      this.padButtons = { weapon: false, selfRight: false };
      return;
    }
    const b = (i: number) => !!pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.4);
    const ax = (i: number) => dead(pad.axes[i] ?? 0);
    const stick = { lx: ax(0), ly: -ax(1), rx: ax(2), ry: -ax(3) };
    const buttons: boolean[] = pad.buttons.map((_, i) => b(i));
    const pressed = (i: number) => buttons[i] && !this.padPrev[i];
    const any = buttons.some(Boolean) || Math.abs(stick.lx) + Math.abs(stick.ly) + Math.abs(stick.rx) + Math.abs(stick.ry) > 0;
    if (any) this.setDevice('gamepad');

    // Menu navigation with repeat.
    let held: MenuNav | null = null;
    if (buttons[12] || stick.ly > 0.6) held = 'up';
    else if (buttons[13] || stick.ly < -0.6) held = 'down';
    else if (buttons[14] || stick.lx < -0.6) held = 'left';
    else if (buttons[15] || stick.lx > 0.6) held = 'right';
    if (held !== this.padNavHeld) {
      this.padNavHeld = held;
      this.padNavTimer = REPEAT_DELAY;
      if (held) this.emitMenu(held);
    } else if (held) {
      this.padNavTimer -= dt;
      if (this.padNavTimer <= 0) {
        this.padNavTimer = REPEAT_RATE;
        this.emitMenu(held);
      }
    }
    if (pressed(0)) this.emitMenu('confirm');
    if (pressed(1)) this.emitMenu('back');
    if (pressed(4)) this.emitMenu('tabPrev');
    if (pressed(5)) this.emitMenu('tabNext');
    if (pressed(3)) this.emitAction('camera');
    if (pressed(9)) this.emitAction('pause');
    if (pressed(0) || pressed(9)) this.emitAction('skip');

    this.padStick = stick;
    this.padButtons = { weapon: buttons[7] || buttons[0], selfRight: buttons[1] };
    this.padPrev = buttons;
  }

  /**
   * The player's drive command.
   * @param controlYaw camera yaw on the floor (0 looks toward -Z)
   * @param robotYaw the robot's heading (0 faces -Z), used by camera-relative drive
   * @param inverted robot is upside down (camera-relative steering flips)
   */
  command(controlYaw: number, robotYaw: number, inverted = false): DriveCommand {
    const typing = isTyping();
    const k = (c: string) => !typing && this.keys.has(c);
    const kx = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    const ky = (k('KeyW') || k('ArrowUp') ? 1 : 0) - (k('KeyS') || k('ArrowDown') ? 1 : 0);

    let x = kx + this.padStick.lx + this.touch.x;
    let y = ky + this.padStick.ly + this.touch.y;
    x = Math.max(-1, Math.min(1, x));
    y = Math.max(-1, Math.min(1, y));

    let throttle = y;
    let turn = x;
    const usingKeys = kx !== 0 || ky !== 0;
    if (this.driveMode === 'tank' && this.lastDevice === 'gamepad' && !usingKeys) {
      const left = this.padStick.ly;
      const right = this.padStick.ry;
      throttle = (left + right) / 2;
      turn = (left - right) / 2;
    } else if (this.driveMode === 'camera' && !usingKeys) {
      const mag = Math.min(1, Math.hypot(x, y));
      if (mag > 0.05) {
        // Desired heading in world: stick up is the camera's forward.
        const want = controlYaw + Math.atan2(-x, y);
        let err = wrap(want - robotYaw);
        if (inverted) err = -err;
        if (Math.abs(err) > 2.2) {
          // Target is behind: back up toward it instead of turning all the way round.
          const back = wrap(err + Math.PI);
          throttle = -mag * Math.max(0, Math.cos(back));
          turn = clamp(-back * 1.6);
        } else {
          throttle = mag * Math.max(0, Math.cos(err));
          turn = clamp(-err * 1.6);
        }
      } else {
        throttle = 0;
        turn = 0;
      }
    }

    const weaponHeld = k('Space') || this.padButtons.weapon || this.touch.weapon;
    const weaponPressed = this.weaponEdge || this.touch.weaponEdge || (this.padButtons.weapon && !this.padWeaponPrev);
    this.weaponEdge = false;
    this.touch.weaponEdge = false;
    this.padWeaponPrev = this.padButtons.weapon;

    return {
      throttle,
      turn,
      weapon: weaponHeld,
      weaponPressed,
      selfRight: k('KeyE') || this.padButtons.selfRight || this.touch.selfRight,
    };
  }

  /** Release everything (entering menus, losing focus). */
  reset(): void {
    this.keys.clear();
    this.touch.x = this.touch.y = 0;
    this.touch.weapon = this.touch.selfRight = false;
    this.weaponEdge = false;
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (isTyping()) {
      if (down && (e.code === 'Escape' || e.code === 'Enter' || e.code === 'NumpadEnter')) this.emitMenu(NAV_KEYS[e.code]);
      return;
    }
    if (down) {
      this.setDevice('keyboard');
      if (!e.repeat) {
        if (e.code === 'Space') this.weaponEdge = true;
        if (e.code === 'KeyC') this.emitAction('camera');
        if (e.code === 'Escape' || e.code === 'KeyP') this.emitAction('pause');
        if (e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape') this.emitAction('skip');
      }
      const nav = NAV_KEYS[e.code];
      if (nav) this.emitMenu(nav);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
    } else {
      this.keys.delete(e.code);
    }
  }

  private emitMenu(n: MenuNav): void {
    for (const fn of [...this.menuSubs]) fn(n);
  }

  /** Fire an action from on-screen buttons. */
  emitAction(a: Action): void {
    for (const fn of [...this.actionSubs]) fn(a);
  }

  private setDevice(d: Device): void {
    if (d === this.lastDevice) return;
    this.lastDevice = d;
    for (const fn of [...this.deviceSubs]) fn(d);
  }
}

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v));
}
