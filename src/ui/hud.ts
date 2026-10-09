// In-fight HUD: scoreboard clock, light tree, and a corner panel per robot with a damage
// schematic, component gauges, weapon status, battery, KO count and hold timer.
// Built once per fight by hud(entrants); hudFrame(world) only touches values that changed.

import { COMPONENTS, FACETS, type BotFrame, type BotSpec, type Component, type Facet, type WorldFrame } from '../contract';
import type { HudEntrant } from './types';
import { CORNER_COLOR, el, emitAction, fmtClock, healthColor } from './core';
import type { UiCtx } from './fx';

const SVG = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

const COMP_SHORT: Record<Component, string> = { driveL: 'L', driveR: 'R', weapon: 'W', battery: 'B', electronics: 'E' };

/** Cache-aware setters so per-frame updates only touch the DOM on change. */
class Cell {
  private last: string | number | boolean | null = null;
  constructor(private apply: (v: never) => void) {}
  set<T extends string | number | boolean | null>(v: T): void {
    if (v === this.last) return;
    this.last = v;
    (this.apply as (v: T) => void)(v);
  }
}

class BotPanel {
  readonly node: HTMLElement;
  readonly ko: HTMLElement;
  private facetEls = new Map<Facet, SVGElement>();
  private wheelEls: SVGElement[] = [];
  private rotor: SVGGElement | null = null;
  private rotorAngle = 0;
  private cells: Record<string, Cell> = {};
  private compFill = new Map<Component, HTMLElement>();
  private weaponKind: BotSpec['weapon']['kind'];
  private arc: SVGCircleElement | null = null;
  private arcLen = 0;

  constructor(readonly e: HudEntrant, slot: number) {
    const spec = e.spec;
    const color = CORNER_COLOR[e.corner] ?? '#ff6a00';
    this.weaponKind = spec.weapon.kind;
    const right = slot % 2 === 1;

    // ---- schematic
    const sch = this.schematic(spec);
    const belly = el('div.hp-belly', [el('span.hp-belly-k', 'Belly'), el('span.hp-belly-bar', el('span.hp-belly-fill'))]);
    const bellyFill = belly.querySelector('.hp-belly-fill') as HTMLElement;
    this.cells.belly = new Cell((v: number) => {
      bellyFill.style.width = `${v * 100}%`;
      bellyFill.style.background = healthColor(v);
    });

    // ---- component gauges
    const gauges = el('div.hp-comps');
    for (const c of COMPONENTS) {
      const fill = el('span.hc-fill');
      this.compFill.set(c, fill);
      gauges.append(el('div.hc', [el('span.hc-bar', fill), el('span.hc-k.cond', COMP_SHORT[c])]));
      this.cells[`c:${c}`] = new Cell((v: number) => {
        fill.style.height = `${Math.max(0.04, v) * 100}%`;
        fill.style.background = healthColor(v);
        fill.parentElement!.parentElement!.classList.toggle('dead', v <= 0);
      });
    }

    // ---- weapon status
    const weapon = this.weaponBlock(spec);

    // ---- battery
    const batFill = el('span.bat-fill');
    const batPct = el('span.bat-pct.cond');
    const bat = el('div.hp-bat', [el('span.bat-k', 'Batt'), el('span.bat-bar', batFill), batPct]);
    this.cells.bat = new Cell((v: number) => {
      batFill.style.width = `${v}%`;
      batFill.classList.toggle('low', v < 25);
      batPct.textContent = `${v}%`;
    });

    // ---- hold
    const holdFill = el('span.hold-fill');
    const holdN = el('span.hold-n.cond');
    const hold = el('div.hp-hold', [el('span.hold-k.wide', 'Hold'), el('span.hold-bar', holdFill), holdN]);
    this.cells.hold = new Cell((v: number) => {
      hold.classList.toggle('on', v >= 0);
      if (v < 0) return;
      // v is tenths of a second; the release comes at 10 seconds, the warning from 7.
      holdFill.style.width = `${Math.min(1, v / 100) * 100}%`;
      hold.classList.toggle('warn', v >= 70);
      holdN.textContent = (v / 10).toFixed(1);
    });

    const status = el('div.hp-status');
    this.cells.status = new Cell((v: string) => {
      status.textContent = v;
      status.classList.toggle('on', !!v);
    });

    this.node = el(`div.hp.slot-${slot}${right ? '.right' : ''}${e.player ? '.player' : ''}`, { style: `--cc:${color}` }, [
      el('div.hp-name', [el('span.hp-stripe'), el('span.hp-nm.wide', e.name), e.player ? el('span.hp-you', 'You') : null]),
      el('div.hp-body', [el('div.hp-sch', [sch, belly]), gauges, el('div.hp-side', [weapon, bat])]),
      hold,
      status,
    ]);

    // ---- knockout count: a referee count plaque shown under the scoreboard (see Hud).
    const koN = el('span.ko-n.cond');
    this.ko = el(`div.ko.slot-${slot}`, { style: `--cc:${color}` }, [el('span.ko-k.wide', 'Count'), koN, el('span.ko-nm.wide', e.name)]);
    this.cells.ko = new Cell((v: number) => {
      this.ko.classList.toggle('on', v >= 0);
      if (v >= 0) {
        koN.textContent = String(v);
        this.ko.classList.remove('tick');
        void this.ko.offsetWidth;
        this.ko.classList.add('tick');
      }
    });
  }

  private schematic(spec: BotSpec): SVGSVGElement {
    const W = spec.width;
    const L = Math.max(spec.length, 0.3);
    const pad = 0.08 * Math.max(W, L);
    const vb = `${-W / 2 - pad} ${-L / 2 - pad} ${W + pad * 2} ${L + pad * 2}`;
    const root = svg('svg', { viewBox: vb, class: 'hp-svg' });
    const stroke = 0.012 * Math.max(W, L);
    // Wheels under the armor.
    spec.wheels.forEach((w) => {
      const r = svg('rect', { x: w.pos.x - w.width / 2, y: w.pos.z - w.radius, width: w.width, height: w.radius * 2, rx: w.width * 0.2, class: 'sch-wheel' });
      this.wheelEls.push(r);
      root.append(r);
    });
    const shell = spec.loadout.chassis === 'shell';
    if (shell) {
      const R = Math.min(W, L) / 2;
      const r = R * 0.62;
      const arc = (a0: number, a1: number) => {
        const p = (rad: number, a: number) => `${(Math.sin(a) * rad).toFixed(4)} ${(-Math.cos(a) * rad).toFixed(4)}`;
        return `M ${p(R, a0)} A ${R} ${R} 0 0 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 0 0 ${p(r, a0)} Z`;
      };
      const q = Math.PI / 4;
      const segs: [Facet, number, number][] = [
        ['front', -q, q],
        ['right', q, 3 * q],
        ['rear', 3 * q, 5 * q],
        ['left', 5 * q, 7 * q],
      ];
      for (const [f, a0, a1] of segs) {
        const path = svg('path', { d: arc(a0 + 0.04, a1 - 0.04), class: 'sch-facet', 'stroke-width': stroke });
        this.facetEls.set(f, path);
        root.append(path);
      }
      const top = svg('circle', { cx: 0, cy: 0, r: r * 0.86, class: 'sch-facet', 'stroke-width': stroke });
      this.facetEls.set('top', top);
      root.append(top);
    } else {
      const hw = Math.min(W, spec.width) / 2 - (spec.wheels.length && spec.loadout.chassis !== 'invertible' ? (spec.wheels[0].width + 0.012) : 0);
      const bw = Math.max(hw, W * 0.3);
      const hl = L / 2;
      const iw = bw * 0.62;
      const ih = hl * 0.66;
      const P = (pts: number[][]) => pts.map((p) => p.join(',')).join(' ');
      const front = P([[-bw, -hl], [bw, -hl], [iw, -ih], [-iw, -ih]]);
      const rear = P([[-bw, hl], [bw, hl], [iw, ih], [-iw, ih]]);
      const left = P([[-bw, -hl], [-iw, -ih], [-iw, ih], [-bw, hl]]);
      const right = P([[bw, -hl], [iw, -ih], [iw, ih], [bw, hl]]);
      const topR = P([[-iw, -ih], [iw, -ih], [iw, ih], [-iw, ih]]);
      for (const [f, pts] of [['front', front], ['rear', rear], ['left', left], ['right', right], ['top', topR]] as [Facet, string][]) {
        const poly = svg('polygon', { points: pts, class: 'sch-facet', 'stroke-width': stroke });
        this.facetEls.set(f, poly);
        root.append(poly);
      }
    }
    // Weapon glyph.
    const w = spec.weapon;
    const g = svg('g', { class: 'sch-weapon' });
    if (w.kind === 'vdisk' || w.kind === 'drum') {
      const ww = w.kind === 'vdisk' ? Math.max(w.width, 0.03) : w.width;
      g.append(svg('rect', { x: -ww / 2, y: w.center.z - w.radius, width: ww, height: w.radius * 2, rx: ww * 0.3 }));
    } else if (w.kind === 'hbar') {
      this.rotor = svg('g', { transform: `translate(0 ${w.center.z})` });
      this.rotor.append(svg('rect', { x: -w.radius, y: -w.chord / 2, width: w.radius * 2, height: w.chord, rx: w.chord * 0.3 }));
      g.append(this.rotor);
    } else if (w.kind === 'shell') {
      this.rotor = svg('g', {});
      const R = w.radius;
      this.rotor.append(svg('circle', { cx: 0, cy: 0, r: R, fill: 'none', 'stroke-width': stroke * 2.4 }));
      this.rotor.append(svg('rect', { x: -R * 0.08, y: -R - R * 0.06, width: R * 0.16, height: R * 0.18 }));
      this.rotor.append(svg('rect', { x: -R * 0.08, y: R - R * 0.12, width: R * 0.16, height: R * 0.18 }));
      g.append(this.rotor);
    } else if (w.kind === 'flipper' || w.kind === 'lifter') {
      g.append(svg('rect', { x: -w.width / 2, y: -L / 2 - 0.02, width: w.width, height: 0.06, rx: 0.01 }));
    } else if (w.kind === 'axe') {
      g.append(svg('rect', { x: -0.035, y: -L / 2 + 0.05, width: 0.07, height: L * 0.7, rx: 0.02 }));
      g.append(svg('rect', { x: -0.07, y: -L / 2 - 0.03, width: 0.14, height: 0.1, rx: 0.02 }));
    }
    root.append(g);
    // Front marker.
    root.append(svg('path', { d: `M ${-0.04} ${-L / 2 - pad * 0.5} L 0 ${-L / 2 - pad * 0.95} L 0.04 ${-L / 2 - pad * 0.5} Z`, class: 'sch-front' }));
    for (const f of FACETS) {
      if (f === 'belly') continue;
      const elx = this.facetEls.get(f);
      if (!elx) continue;
      this.cells[`f:${f}`] = new Cell((v: number) => {
        elx.setAttribute('fill', healthColor(v));
        elx.classList.toggle('gone', v <= 0);
      });
    }
    return root;
  }

  private weaponBlock(spec: BotSpec): HTMLElement {
    const w = spec.weapon;
    if (w.kind === 'vdisk' || w.kind === 'drum' || w.kind === 'hbar' || w.kind === 'shell') {
      const r = 16;
      const len = 2 * Math.PI * r * 0.75;
      this.arcLen = len;
      const gauge = svg('svg', { viewBox: '0 0 40 40', class: 'rpm-svg' });
      gauge.append(svg('circle', { cx: 20, cy: 20, r, class: 'rpm-track', 'stroke-dasharray': `${len} 999`, transform: 'rotate(135 20 20)' }));
      this.arc = svg('circle', { cx: 20, cy: 20, r, class: 'rpm-arc', 'stroke-dasharray': `0 999`, transform: 'rotate(135 20 20)' });
      gauge.append(this.arc);
      const num = el('span.rpm-n.cond');
      const lamp = el('span.lamp');
      const node = el('div.hp-weapon.spin', [el('div.rpm', [gauge, num]), el('div.wk', [lamp, el('span.wk-t.wide', 'Rpm')])]);
      this.cells.rpm = new Cell((v: number) => (num.textContent = v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)));
      this.cells.spin = new Cell((v: number) => {
        this.arc!.setAttribute('stroke-dasharray', `${(this.arcLen * v) / 100} 999`);
        node.classList.toggle('full', v > 90);
      });
      this.cells.armed = new Cell((v: boolean) => lamp.classList.toggle('on', v));
      return node;
    }
    if (w.kind === 'flipper' || w.kind === 'axe') {
      const shots = el('span.gas-n.cond');
      const lamp = el('span.lamp');
      const node = el('div.hp-weapon.gas', [el('div.gas', [shots, el('span.gas-k', 'Gas')]), el('div.wk', [lamp, el('span.wk-t.wide', w.kind === 'axe' ? 'Axe' : 'Flip')])]);
      this.cells.shots = new Cell((v: number) => {
        shots.textContent = String(v);
        node.classList.toggle('empty', v <= 0);
      });
      this.cells.ready = new Cell((v: boolean) => {
        lamp.classList.toggle('on', v);
        lamp.classList.toggle('red', !v);
      });
      return node;
    }
    if (w.kind === 'lifter') {
      const fill = el('span.lift-fill');
      const lamp = el('span.lamp');
      const node = el('div.hp-weapon.lift', [el('div.lift', el('span.lift-bar', fill)), el('div.wk', [lamp, el('span.wk-t.wide', 'Lift')])]);
      this.cells.arm = new Cell((v: number) => (fill.style.height = `${v}%`));
      this.cells.armed = new Cell((v: boolean) => lamp.classList.toggle('on', v));
      return node;
    }
    return el('div.hp-weapon.none', [el('span.wk-t.wide', 'Pusher')]);
  }

  update(f: BotFrame, dt: number): void {
    for (const fc of FACETS) {
      const v = Math.round(f.facets[fc] * 50) / 50;
      if (fc === 'belly') this.cells.belly.set(v);
      else this.cells[`f:${fc}`]?.set(v);
    }
    for (const c of COMPONENTS) this.cells[`c:${c}`].set(Math.round(f.parts[c] * 50) / 50);
    f.wheelLost.forEach((lost, i) => this.wheelEls[i]?.classList.toggle('lost', lost));
    const w = f.weapon;
    if (this.weaponKind === 'vdisk' || this.weaponKind === 'drum' || this.weaponKind === 'hbar' || this.weaponKind === 'shell') {
      this.cells.rpm.set(Math.round(w.rpm / 10) * 10);
      this.cells.spin.set(Math.round(w.spin01 * 100));
      this.cells.armed.set(w.armed);
      if (this.rotor) {
        this.rotorAngle = (this.rotorAngle + w.spin01 * dt * 900) % 360;
        const z = this.rotor.getAttribute('transform')?.match(/translate\(0 ([^)]+)\)/)?.[1];
        this.rotor.setAttribute('transform', `${z ? `translate(0 ${z}) ` : ''}rotate(${this.rotorAngle.toFixed(1)})`);
      }
    } else if (this.weaponKind === 'flipper' || this.weaponKind === 'axe') {
      this.cells.shots.set(Number.isFinite(w.shotsLeft) ? w.shotsLeft : 0);
      this.cells.ready.set(w.ready && w.shotsLeft > 0);
    } else if (this.weaponKind === 'lifter') {
      this.cells.arm.set(Math.round(w.arm * 100));
      this.cells.armed.set(w.armed);
    }
    this.cells.bat.set(Math.round(f.charge * 100));
    this.cells.hold.set(f.holdTime === null ? -1 : Math.round(f.holdTime * 10));
    this.cells.ko.set(f.koCount === null ? -1 : Math.max(0, Math.ceil(f.koCount)));
    this.cells.status.set(f.disabled ? 'Disabled' : f.fire > 0.2 ? 'On fire' : f.inverted ? 'Upside down' : f.smoke > 0.4 ? 'Smoking' : '');
    this.node.classList.toggle('disabled', f.disabled);
  }
}

export class Hud {
  private node: HTMLElement | null = null;
  private panels: BotPanel[] = [];
  private clock: HTMLElement | null = null;
  private board: HTMLElement | null = null;
  private lamps: HTMLElement[] = [];
  private tree: HTMLElement | null = null;
  private slow: HTMLElement | null = null;
  private koRow: HTMLElement = el('div.ko-row');
  private cells: Record<string, Cell> = {};
  private lastT = 0;
  private fightStartT: number | null = null;

  constructor(private ctx: UiCtx) {}

  set(entrants: HudEntrant[] | null, onNames?: (e: HudEntrant[]) => void): void {
    if (this.node) {
      this.node.remove();
      this.node = null;
      this.panels = [];
    }
    if (!entrants) return;
    onNames?.(entrants);
    this.clock = el('span.sb-clock.cond', '3:00');
    this.lamps = [el('span.lt.red'), el('span.lt.red'), el('span.lt.red'), el('span.lt.green')];
    this.tree = el('div.lighttree', this.lamps);
    this.slow = el('span.sb-slow.wide', 'Slo-mo');
    // On touch screens the scoreboard doubles as the pause button.
    const pause = el('span.sb-pause', [el('span.pz'), el('span.pz')]);
    const face = el('div.sb-face', [el('span.sb-logo.logo-type', 'BOTBOX'), pause, this.clock, el('span.sb-phase.wide')]);
    face.addEventListener('pointerup', (ev) => {
      if (!this.ctx.root.classList.contains('touch-on')) return;
      ev.preventDefault();
      emitAction(this.ctx.input, 'pause');
    });
    this.koRow = el('div.ko-row');
    this.board = el('div.scoreboard', [face, this.tree, this.slow]);
    const phase = this.board.querySelector('.sb-phase') as HTMLElement;
    this.cells = {
      clock: new Cell((v: string) => (this.clock!.textContent = v)),
      phase: new Cell((v: string) => {
        phase.textContent = v === 'countdown' ? 'Ready' : v === 'over' ? 'Final' : v === 'fight' ? 'Live' : '';
        this.board!.dataset.phase = v;
      }),
      lights: new Cell((v: number) => {
        this.lamps.forEach((l, i) => l.classList.toggle('on', i < 3 ? v >= i + 1 && v < 4 : v === 4));
        if (v > 0) this.ctx.layers.hud.classList.add('lights-on');
      }),
      tree: new Cell((v: boolean) => this.tree!.classList.toggle('show', v)),
      late: new Cell((v: boolean) => this.board!.classList.toggle('late', v)),
      slow: new Cell((v: boolean) => this.slow!.classList.toggle('on', v)),
    };
    this.panels = entrants.slice(0, 4).map((e, i) => new BotPanel(e, i));
    for (const p of this.panels) this.koRow.append(p.ko);
    const colL = el('div.hud-col.left', this.panels.filter((_, i) => i % 2 === 0).map((p) => p.node));
    const colR = el('div.hud-col.right', this.panels.filter((_, i) => i % 2 === 1).map((p) => p.node));
    this.node = el(`div.hud.n${this.panels.length}`, [this.board, colL, colR, this.koRow]);
    this.ctx.layers.hud.append(this.node);
    this.fightStartT = null;
  }

  frame(world: WorldFrame): void {
    if (!this.node) return;
    const dt = this.lastT ? Math.min(0.1, Math.max(0, world.t - this.lastT)) : 0.016;
    this.lastT = world.t;
    const m = world.match;
    this.cells.clock.set(fmtClock(m.clock));
    this.cells.phase.set(m.phase);
    this.cells.lights.set(m.lights);
    if (m.phase === 'fight' && this.fightStartT === null) this.fightStartT = world.t;
    if (m.phase === 'countdown') this.fightStartT = null;
    const treeVisible = m.phase === 'countdown' || (m.phase === 'fight' && this.fightStartT !== null && world.t - this.fightStartT < 1.2);
    this.cells.tree.set(treeVisible);
    this.cells.late.set(m.phase === 'fight' && m.clock <= 10);
    this.cells.slow.set(m.timeScale < 0.9);
    for (const p of this.panels) {
      const f = world.bots.find((b) => b.id === p.e.id);
      if (f) p.update(f, dt);
    }
  }
}
