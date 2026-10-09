// The broadcast graphics package: lower thirds, captions, the network bug, banners, the replay
// frame, slates, the bumper, the judges' decision, the pit interview, results and the ceremony.

import type { BotCard, Corner, WeightClass } from '../contract';
import { CLASS_LABEL } from '../data/parts';
import type { BannerKind, DecisionView, LowerThird, Speaker } from './types';
import { CORNER_COLOR, el, emitAction, exit, fmtClock, replay, sleep } from './core';
import { flare, slamFx, sparks, wipe, type UiCtx } from './fx';
import { button, nutIcon } from './widgets';

export const SPEAKER_NAME: Record<Speaker, string> = {
  Vic: 'Vic Ramone',
  Dale: 'Dale Pruitt',
  Chuck: 'Chuck Kowalski',
  Jenna: 'Jenna Rae',
  Builder: 'Builder',
};
const SPEAKER_ROLE: Record<Speaker, string> = {
  Vic: 'Announcer',
  Dale: 'Host',
  Chuck: 'Color',
  Jenna: 'Pit reporter',
  Builder: 'Team',
};

const CORNER_LABEL: Record<Corner, string> = { red: 'Red square', blue: 'Blue square', green: 'Green square', yellow: 'Yellow square' };

const BANNER: Record<BannerKind, { text: string; tone: string; hold: number }> = {
  fight: { text: 'Fight!', tone: 'orange', hold: 1300 },
  ko: { text: 'Knockout', tone: 'red', hold: 2200 },
  time: { text: 'Time', tone: 'blue', hold: 1800 },
  replay: { text: 'Bot replay', tone: 'blue', hold: 1500 },
  release: { text: 'Release!', tone: 'yellow', hold: 1500 },
  tapout: { text: 'Tapped out', tone: 'red', hold: 2200 },
  winner: { text: 'Winner', tone: 'chrome', hold: 3200 },
  flipped: { text: 'Flipped!', tone: 'orange', hold: 1400 },
  fire: { text: 'Fire!', tone: 'fire', hold: 1600 },
};

export class Broadcast {
  private l3: HTMLElement | null = null;
  private cap: HTMLElement | null = null;
  private capText: HTMLElement | null = null;
  private capPlate: HTMLElement | null = null;
  private bugEl: HTMLElement | null = null;
  private bugClock: HTMLElement | null = null;
  private bugTimer = 0;
  private bannerEl: HTMLElement | null = null;
  private bannerTimer = 0;
  private replayEl: HTMLElement | null = null;
  private skipEl: HTMLElement | null = null;
  /** Names by entrant id, learned from the HUD, for result summaries. */
  names = new Map<string, { name: string; player: boolean; corner: Corner }>();

  constructor(private ctx: UiCtx) {}

  // ---- lower third
  lowerThird(info: LowerThird | null): void {
    const g = this.ctx.layers.gfx;
    if (this.l3) {
      const old = this.l3;
      this.l3 = null;
      void exit(old, 260);
    }
    if (!info) return;
    const c = info.card;
    const color = CORNER_COLOR[info.corner] ?? '#ff6a00';
    const chip = (k: string, v: string) => el('div.l3-chip', [el('span.l3-k', k), el('span.l3-v.wide', v)]);
    const node = el(`div.l3.scan.c-${info.corner}`, { style: `--cc:${color}` }, [
      el('div.l3-corner', [el('span.l3-corner-txt.wide', CORNER_LABEL[info.corner])]),
      el('div.l3-body', [
        el('div.l3-top', [el('span.tag', c.team), el('span.l3-home', c.hometown)]),
        el('div.l3-name.wide.chrome-text', c.name),
        el('div.l3-builders', `Built by ${c.builders}`),
        el('div.l3-chips', [
          chip('Class', info.classLabel),
          chip('Weapon', info.weaponShort),
          chip('Weight', `${info.stats.weightLb.toFixed(0)} lb`),
          chip('Record', c.record ?? '0-0'),
        ]),
        el('div.l3-blurb', c.blurb),
      ]),
      el('div.l3-glint'),
    ]);
    g.append(node);
    this.l3 = node;
    this.ctx.sfx.sting('whoosh');
    slamFx(g, node.querySelector('.l3-name') as HTMLElement, 'right', 18);
  }

  // ---- captions
  caption(speaker: Speaker | null, text?: string): void {
    if (!speaker || !text) {
      if (this.cap) {
        const c = this.cap;
        this.cap = null;
        void exit(c, 200);
      }
      return;
    }
    if (!this.cap) {
      this.capPlate = el('div.cap-plate');
      this.capText = el('div.cap-text');
      this.cap = el('div.caption', [this.capPlate, this.capText]);
      this.ctx.layers.gfx.append(this.cap);
    }
    this.capPlate!.replaceChildren(el('span.cap-name.wide', SPEAKER_NAME[speaker]), el('span.cap-role', SPEAKER_ROLE[speaker]));
    this.capPlate!.dataset.speaker = speaker;
    this.capText!.textContent = text;
    replay(this.capText!, 'pop');
  }

  // ---- network bug
  bug(show: boolean): void {
    if (!show) {
      clearInterval(this.bugTimer);
      if (this.bugEl) {
        const b = this.bugEl;
        this.bugEl = null;
        void exit(b, 200);
      }
      return;
    }
    if (this.bugEl) return;
    this.bugClock = el('span.bug-clock.cond');
    this.bugEl = el('div.bug', [el('span.bug-logo.logo-type.chrome-text', 'BOTBOX'), el('span.bug-sep'), this.bugClock]);
    this.ctx.layers.gfx.append(this.bugEl);
    const tickClock = () => {
      const d = new Date();
      const h = d.getHours() % 12 || 12;
      this.bugClock!.textContent = `${h}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    tickClock();
    this.bugTimer = window.setInterval(tickClock, 10000);
  }

  // ---- banners
  banner(kind: BannerKind, text?: string): void {
    const def = BANNER[kind];
    if (this.bannerEl) this.bannerEl.remove();
    clearTimeout(this.bannerTimer);
    const word = el(`div.bn-word.wide.tone-${def.tone}`, def.text);
    const node = el(`div.banner.k-${kind}`, [el('div.bn-band.top'), el('div.bn-core', [word, text ? el('div.bn-sub.wide', text) : null]), el('div.bn-band.bot')]);
    this.ctx.layers.gfx.append(node);
    this.bannerEl = node;
    requestAnimationFrame(() => {
      const r = word.getBoundingClientRect();
      const p = this.ctx.layers.gfx.getBoundingClientRect();
      sparks(this.ctx.layers.gfx, r.left - p.left, r.top + r.height / 2 - p.top, 16);
      sparks(this.ctx.layers.gfx, r.right - p.left, r.top + r.height / 2 - p.top, 16);
      flare(this.ctx.layers.gfx, r.left + r.width * 0.75 - p.left, r.top + r.height * 0.3 - p.top);
    });
    this.bannerTimer = window.setTimeout(() => {
      if (this.bannerEl === node) this.bannerEl = null;
      void exit(node, 260);
    }, def.hold);
  }

  // ---- replay frame
  replayFrame(on: boolean): void {
    if (!on) {
      if (this.replayEl) {
        const r = this.replayEl;
        this.replayEl = null;
        void exit(r, 240);
      }
      return;
    }
    if (this.replayEl) return;
    this.replayEl = el('div.replay', [
      el('div.rp-tint'),
      el('div.rp-frame'),
      el('div.rp-tag', [el('span.rp-dot'), el('span.rp-word.wide', 'Bot replay'), el('span.rp-arrows', '◀◀')]),
      el('div.rp-corner.br.cond', 'SLO-MO'),
    ]);
    this.ctx.layers.gfx.append(this.replayEl);
    this.ctx.sfx.sting('replay');
  }

  // ---- skip hint
  skippable(on: boolean): void {
    if (!on) {
      if (this.skipEl) {
        const s = this.skipEl;
        this.skipEl = null;
        void exit(s, 160);
      }
      return;
    }
    if (this.skipEl) return;
    const dev = this.ctx.input.lastDevice;
    const key = dev === 'gamepad' ? 'A' : dev === 'touch' ? 'Tap' : 'Enter';
    this.skipEl = el('div.skip.live', [el('b', key), el('span.wide', 'Skip'), el('span.skip-arr', '▶▶')]);
    this.skipEl.addEventListener('pointerup', () => emitAction(this.ctx.input, 'skip'));
    this.ctx.layers.gfx.append(this.skipEl);
  }

  // ---- slate
  async slate(title: string, sub: string | null, sec: number): Promise<void> {
    const node = el('div.slate.scan', [
      el('div.sl-bg'),
      el('div.sl-stripe.a'),
      el('div.sl-stripe.b'),
      el('div.sl-center', [el('div.sl-kicker.kicker', 'BotBox'), el('div.sl-title.wide.chrome-text', title), sub ? el('div.sl-sub.wide', sub) : null, el('div.hazard-bar.sl-haz')]),
    ]);
    this.ctx.sfx.sting('whoosh');
    wipe(this.ctx.layers.over);
    await sleep(240);
    this.ctx.layers.over.append(node);
    slamFx(this.ctx.layers.over, node.querySelector('.sl-title') as HTMLElement, 'right', 22);
    await sleep(Math.max(300, sec * 1000 - 500));
    wipe(this.ctx.layers.over);
    await sleep(260);
    node.remove();
  }

  // ---- bumper
  async bumper(): Promise<void> {
    const node = el('div.slate.bumper.scan', [
      el('div.sl-bg'),
      el('div.bp-nut', nutIcon('won big')),
      el('div.sl-center', [el('div.bp-logo.logo-type.chrome-text', 'BOTBOX'), el('div.bp-line.wide', 'Will be right back'), el('div.hazard-bar.sl-haz')]),
    ]);
    this.ctx.sfx.sting('whoosh');
    wipe(this.ctx.layers.over);
    await sleep(240);
    this.ctx.layers.over.append(node);
    await sleep(3000);
    wipe(this.ctx.layers.over);
    await sleep(260);
    node.remove();
  }

  // ---- decision
  decision(view: DecisionView): Promise<void> {
    return new Promise((resolve) => {
      const [A, B] = view.entrants;
      const colA = CORNER_COLOR[A?.corner ?? 'red'];
      const colB = CORNER_COLOR[B?.corner ?? 'blue'];
      const cards: HTMLElement[] = [];
      for (const j of view.judges) {
        const row = (cat: string, rec: Record<string, number>) => {
          const a = rec[A.id] ?? 0;
          const b = rec[B.id] ?? 0;
          const split = el('div.dj-split', [el('span.dj-a', { style: `flex:${a || 0.001}` }), el('span.dj-b', { style: `flex:${b || 0.001}` })]);
          return el('div.dj-row', [el('span.dj-n.cond.a', String(a)), el('div.dj-mid', [el('span.dj-cat', cat), split]), el('span.dj-n.cond.b', String(b))]);
        };
        const ta = (j.aggression[A.id] ?? 0) + (j.strategy[A.id] ?? 0) + (j.damage[A.id] ?? 0);
        const tb = (j.aggression[B.id] ?? 0) + (j.strategy[B.id] ?? 0) + (j.damage[B.id] ?? 0);
        cards.push(
          el('div.dj.panel.scan', [
            el('div.dj-name.wide', j.judge),
            row('Aggression', j.aggression),
            row('Strategy', j.strategy),
            row('Damage', j.damage),
            el('div.dj-total', [el('span.cond.a', String(ta)), el('span.dj-tl', 'Card'), el('span.cond.b', String(tb))]),
          ]),
        );
      }
      const totA = el('span.dc-tot.cond.a', '0');
      const totB = el('span.dc-tot.cond.b', '0');
      const winnerName = view.entrants.find((e) => e.id === view.winner)?.name ?? '';
      const stamp = el('div.dc-winner', [el('span.tag', 'Winner by decision'), el('span.dc-wname.wide.chrome-text', winnerName)]);
      const cont = button('Continue', { activate: () => finish(), cls: 'small primary' });
      cont.classList.add('dc-cont');
      const node = el('div.screen.decision-screen', { style: `--ca:${colA};--cb:${colB}` }, [
        el('div.dim-bg'),
        el('div.dc-card', [
          el('div.dc-head', [el('span.tag.chrome', 'The judges'), el('div.dc-title.wide.chrome-text', 'Decision')]),
          el('div.dc-names', [el('span.dc-name.wide.a', A?.name ?? ''), el('span.dc-vs.cond', 'vs'), el('span.dc-name.wide.b', B?.name ?? '')]),
          el('div.dc-judges', cards),
          el('div.dc-totals', [totA, el('span.dc-of.wide', 'Out of 45'), totB]),
          stamp,
          cont,
        ]),
      ]);
      this.ctx.layers.over.append(node);
      let done = false;
      let revealed = false;
      let autoTimer = 0;
      const finish = () => {
        if (!revealed) return;
        if (done) return;
        done = true;
        clearTimeout(autoTimer);
        this.ctx.sfx.ui('select');
        this.ctx.nav.pop(scope);
        void exit(node, 260).then(() => resolve());
      };
      const scope = this.ctx.nav.push({ root: node, back: finish });
      const run = async () => {
        await sleep(500);
        for (const c of cards) {
          c.classList.add('in');
          this.ctx.sfx.sting('decision');
          await sleep(1100);
        }
        const fa = view.totals[A.id] ?? 0;
        const fb = view.totals[B.id] ?? 0;
        node.classList.add('totals');
        for (let i = 0; i <= 20; i++) {
          totA.textContent = String(Math.round((fa * i) / 20));
          totB.textContent = String(Math.round((fb * i) / 20));
          if (i % 4 === 0) this.ctx.sfx.ui('tick');
          await sleep(35);
        }
        await sleep(350);
        node.classList.add('won', view.winner === A.id ? 'win-a' : 'win-b');
        this.ctx.sfx.sting('stamp');
        slamFx(node, stamp, 'center', 26);
        revealed = true;
        scope.refresh(cont);
        autoTimer = window.setTimeout(finish, 9000);
      };
      void run();
    });
  }

  // ---- interview
  async interview(lines: { speaker: Speaker; text: string }[]): Promise<void> {
    const plate = el('div.cap-plate');
    const text = el('div.cap-text');
    const node = el('div.interview', [el('div.iv-tag', [el('span.tag.blue', 'Pit report'), el('span.iv-live.wide', 'From the pits')]), el('div.caption.iv-cap', [plate, text])]);
    this.ctx.layers.gfx.append(node);
    let skip: (() => void) | null = null;
    const off = this.ctx.input.onMenu((n) => {
      if (n === 'confirm') skip?.();
    });
    const offA = this.ctx.input.onAction((a) => {
      if (a === 'skip') skip?.();
    });
    node.classList.add('live');
    node.addEventListener('pointerup', () => skip?.());
    for (const l of lines) {
      plate.replaceChildren(el('span.cap-name.wide', SPEAKER_NAME[l.speaker]), el('span.cap-role', SPEAKER_ROLE[l.speaker]));
      plate.dataset.speaker = l.speaker;
      text.textContent = l.text;
      replay(text, 'pop');
      const ms = Math.max(2200, 1000 + l.text.length * 62);
      await new Promise<void>((r) => {
        const t = setTimeout(r, ms);
        skip = () => {
          clearTimeout(t);
          r();
        };
      });
      skip = null;
      await sleep(120);
    }
    off();
    offA();
    await exit(node, 220);
  }

  // ---- result
  result(r: { won: boolean; headline: string; detail: string; result: import('../contract').MatchResult }): Promise<void> {
    return new Promise((resolve) => {
      const res = r.result;
      const player = [...this.names.entries()].find(([, v]) => v.player)?.[0] ?? Object.keys(res.stats)[0];
      const me = res.stats[player];
      const method =
        res.method === 'ko'
          ? `Knockout at ${fmtClock(res.time)}`
          : res.method === 'decision'
            ? `Decision${res.totals && player in res.totals ? `, ${Object.values(res.totals).sort((a, b) => b - a).join(' to ')}` : ''}`
            : res.method === 'tapout'
              ? `Tap out at ${fmtClock(res.time)}`
              : `Last one moving at ${fmtClock(res.time)}`;
      const stat = (k: string, v: string | number) => el('div.rs-stat', [el('span.rs-v.cond', String(v)), el('span.rs-k', k)]);
      const cont = button('Continue', { activate: () => finish(), cls: 'small primary' });
      const node = el(`div.screen.result-screen.${r.won ? 'won' : 'lost'}`, [
        el('div.dim-bg'),
        el('div.rs-panel.panel.cut.scan', [
          el('div.rs-stamp.wide', r.won ? 'Win' : 'Loss'),
          el('div.rs-method.kicker', method),
          el('div.rs-head.wide.chrome-text', r.headline),
          me
            ? el('div.rs-stats', [
                stat('Damage dealt', Math.round(me.damageDealt)),
                stat('Damage taken', Math.round(me.damageTaken)),
                stat('Hits', me.hits),
                stat('Big hits', me.bigHits),
                stat('Hazard damage', Math.round(me.hazardDamageDealt)),
                stat('Flips', me.flips),
              ])
            : null,
          el('div.rs-next', [el('span.tag' + (r.won ? '' : '.blue'), 'Next'), el('span', r.detail)]),
          cont,
        ]),
      ]);
      this.ctx.layers.over.append(node);
      this.ctx.sfx.sting('stamp');
      slamFx(node, node.querySelector('.rs-stamp') as HTMLElement, 'center', 24);
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.ctx.sfx.ui('select');
        this.ctx.nav.pop(scope);
        void exit(node, 260).then(() => resolve());
      };
      const scope = this.ctx.nav.push({ root: node, back: finish, initial: cont });
    });
  }

  // ---- ceremony
  ceremony(card: BotCard, cls: WeightClass): Promise<void> {
    return new Promise((resolve) => {
      const confetti = el('div.confetti');
      const colors = ['#ff6a00', '#2a7fff', '#ffd21f', '#ffffff', '#d9dee5', '#ff2a2a'];
      for (let i = 0; i < 90; i++) {
        const c = el('span.cf', {
          style: `left:${Math.random() * 100}%;--c:${colors[i % colors.length]};--d:${(2.8 + Math.random() * 3).toFixed(2)}s;--delay:${(-Math.random() * 5).toFixed(2)}s;--x:${(Math.random() * 120 - 60).toFixed(0)}px;--r:${(Math.random() * 720).toFixed(0)}deg`,
        });
        confetti.append(c);
      }
      const cont = button('Continue', { activate: () => finish(), cls: 'small primary' });
      const node = el('div.screen.ceremony-screen', [
        confetti,
        el('div.cm-top', [el('div.cm-title.wide.orange-text', 'Champion'), el('div.cm-kicker.kicker', `${CLASS_LABEL[cls]} Giant Nut`)]),
        el('div.cm-bottom.scan', [el('div.cm-name.wide.chrome-text', card.name), el('div.cm-team', `${card.team}. ${card.hometown}`), el('div.cm-builders', `Built by ${card.builders}`), cont]),
      ]);
      this.ctx.layers.over.append(node);
      this.ctx.sfx.sting('crowd_roar');
      slamFx(node, node.querySelector('.cm-title') as HTMLElement, 'center', 40);
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.ctx.sfx.ui('select');
        this.ctx.nav.pop(scope);
        void exit(node, 400).then(() => resolve());
      };
      const scope = this.ctx.nav.push({ root: node, back: finish, initial: cont });
    });
  }

  // ---- eliminated
  eliminated(card: BotCard, round: string): Promise<void> {
    return new Promise((resolve) => {
      const quips = ['Back to the garage. Bring a bigger battery.', 'The Box always wins eventually.', 'Hold your head up. Bolt it back together.', 'Next season, more armor.'];
      const cont = button('Continue', { activate: () => finish(), cls: 'small primary' });
      const node = el('div.screen.elim-screen', [
        el('div.dim-bg'),
        el('div.el-panel.panel.cut.scan', [
          el('div.el-stamp.wide', 'Eliminated'),
          el('div.el-name.wide.chrome-text', card.name),
          el('div.el-round.kicker', `Out in the ${round.toLowerCase()}`),
          el('div.el-quip', quips[Math.floor(Math.random() * quips.length)]),
          cont,
        ]),
      ]);
      this.ctx.layers.over.append(node);
      this.ctx.sfx.sting('stamp');
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        this.ctx.sfx.ui('select');
        this.ctx.nav.pop(scope);
        void exit(node, 260).then(() => resolve());
      };
      const scope = this.ctx.nav.push({ root: node, back: finish, initial: cont });
    });
  }
}
