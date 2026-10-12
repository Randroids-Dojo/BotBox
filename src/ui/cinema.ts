// Prologue graphics: montage cards (news headlines, loss tickers, the rankings slide), the
// montage date rolling forward on the top cinema bar, story text on black, and the coach bubble
// that teaches the first fight and the first rebuild.

import { JUGGERNAUT_PRIME } from '../data/campaign';
import { el, exit, sleep } from './core';
import { slamFx, type UiCtx } from './fx';
import type { MontageCard, ScreenMarker } from './types';

type CoachAction = 'drive' | 'weapon' | 'selfRight' | 'camera';

/** Key, pad and touch names for each coached action. */
const COACH_KEYS: Record<CoachAction, { kb: string[]; pad: string[]; touch: string[] }> = {
  drive: { kb: ['W', 'A', 'S', 'D'], pad: ['Left stick'], touch: ['Stick'] },
  weapon: { kb: ['Space'], pad: ['RT'], touch: ['Weapon'] },
  selfRight: { kb: ['E'], pad: ['B'], touch: ['Right'] },
  camera: { kb: ['C'], pad: ['Y'], touch: ['Cam'] },
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Months since year 0 as "March 2000". */
function monthYear(n: number): string {
  return `${MONTHS[n % 12]} ${Math.floor(n / 12)}`;
}

export class Cinema {
  private cards: HTMLElement[] = [];
  private headlines = 0;
  private coachEl: HTMLElement | null = null;
  private coachText: HTMLElement | null = null;
  private coachKeys: HTMLElement | null = null;

  constructor(private ctx: UiCtx) {}

  // ---- montage
  async montage(card: MontageCard): Promise<void> {
    const ms = Math.max(400, card.sec * 1000);
    // Whatever is still up from the last beat gets out of the way fast.
    for (const c of this.cards.splice(0)) void exit(c, 140);
    const node = this.build(card);
    node.style.setProperty('--hold', `${ms}ms`);
    this.ctx.layers.gfx.append(node);
    this.cards.push(node);
    const sfx = this.ctx.sfx;
    if (card.kind === 'result') sfx.sting('stamp');
    else sfx.sting('whoosh');
    if (card.kind === 'rank') void this.tumble(node, card, Math.min(900, ms * 0.45));
    else slamFx(this.ctx.layers.gfx, node.querySelector<HTMLElement>('.mt-hit') ?? node, card.kind === 'result' ? 'left' : 'right', 12);
    await sleep(ms - 180);
    const i = this.cards.indexOf(node);
    if (i >= 0) this.cards.splice(i, 1);
    void exit(node, 170);
    await sleep(180);
  }

  private build(card: MontageCard): HTMLElement {
    if (card.kind === 'headline') {
      // Alternate a newspaper clipping and a TV news banner so a run of headlines has rhythm.
      const paper = this.headlines++ % 2 === 0;
      if (paper)
        return el('div.mt.mt-paper', [
          el('div.mt-mast', [el('span', 'The Bay Area Bolt'), el('span', 'Sports')]),
          el('div.mt-hl.mt-hit', card.title),
          card.sub ? el('div.mt-dek', card.sub) : null,
        ]);
      return el('div.mt.mt-tv', [
        el('div.mt-tv-top', [el('span.mt-breaking', 'Breaking'), el('span.mt-net', 'BotBox news')]),
        el('div.mt-tv-hl.wide.mt-hit', card.title),
        card.sub ? el('div.mt-tv-sub', card.sub) : null,
      ]);
    }
    if (card.kind === 'result') {
      const r = card.result ?? { opponent: card.sub ?? '', method: '' };
      return el('div.mt.mt-result', [
        el('div.mt-res-title', card.title),
        el('div.mt-res-bar.mt-hit', [
          el('span.mt-final', 'Final'),
          el('span.mt-team.wide', [el('span.mt-l', 'L'), el('span', JUGGERNAUT_PRIME.name)]),
          el('span.mt-def', 'def. by'),
          el('span.mt-team.wide.win', r.opponent),
          r.method ? el('span.mt-method.cond', r.method) : null,
        ]),
        card.sub && card.result ? el('div.mt-crawl', card.sub) : null,
      ]);
    }
    const rk = card.rank ?? { from: null, to: null };
    return el('div.mt.mt-rank', [
      el('div.mt-rank-head', [el('span.kicker', 'Heavyweight rankings')]),
      el('div.mt-rank-name.wide', card.title),
      el('div.mt-rank-row', [el('span.mt-rank-num.cond', rk.from === null ? 'Unranked' : `#${rk.from}`), el('span.mt-rank-arrow', '▼')]),
      card.sub ? el('div.mt-rank-sub', card.sub) : null,
    ]);
  }

  private async tumble(node: HTMLElement, card: MontageCard, ms: number): Promise<void> {
    const num = node.querySelector<HTMLElement>('.mt-rank-num')!;
    const { from, to } = card.rank ?? { from: null, to: null };
    await sleep(260);
    const steps = 9;
    const a = from ?? 1;
    const b = to ?? Math.max(a + 30, 60);
    for (let i = 1; i <= steps; i++) {
      if (!node.isConnected) return;
      const k = i / steps;
      const v = Math.round(a + (b - a) * (1 - Math.pow(1 - k, 2)));
      num.textContent = `#${v}`;
      num.classList.remove('roll');
      void num.offsetWidth;
      num.classList.add('roll');
      this.ctx.sfx.ui('tick');
      await sleep(ms / steps);
    }
    num.textContent = to === null ? 'Unranked' : `#${to}`;
    num.classList.add('final');
    node.classList.add(to === null ? 'gone' : 'down');
  }

  // ---- montage date
  private dateEl: HTMLElement | null = null;
  private dateText: HTMLElement | null = null;
  private dateNow = 0;
  private dateRun = 0;

  montageDate(d: { month: number; year: number } | null): void {
    const run = ++this.dateRun;
    if (!d) {
      if (this.dateEl) void exit(this.dateEl, 300);
      this.dateEl = this.dateText = null;
      return;
    }
    const to = d.year * 12 + d.month - 1;
    if (!this.dateEl) {
      this.dateText = el('span.fd-t', monthYear(to));
      this.dateEl = el('div.film-date', [el('span.fd-rule'), this.dateText, el('span.fd-rule')]);
      this.ctx.layers.gfx.append(this.dateEl);
      this.dateNow = to;
      return;
    }
    void this.rollDate(to, run);
  }

  /** Flip through the months in between, quick ticks like a calendar in a time lapse. */
  private async rollDate(to: number, run: number): Promise<void> {
    const text = this.dateText!;
    const steps = Math.abs(to - this.dateNow);
    const stride = Math.max(1, Math.ceil(steps / 10));
    text.classList.remove('set');
    while (this.dateNow !== to) {
      if (run !== this.dateRun || !text.isConnected) return;
      this.dateNow = to > this.dateNow ? Math.min(to, this.dateNow + stride) : Math.max(to, this.dateNow - stride);
      text.textContent = monthYear(this.dateNow);
      text.classList.remove('tick');
      void text.offsetWidth;
      text.classList.add('tick');
      this.ctx.sfx.ui('tick');
      await sleep(steps > 6 ? 60 : 95);
    }
    text.classList.remove('tick');
    void text.offsetWidth;
    text.classList.add('set');
  }

  // ---- story
  async story(lines: string[], sec: number): Promise<void> {
    const ms = Math.max(800, sec * 1000);
    const node = el('div.story', el('div.story-lines', lines.map((l) => el('div.story-line', l))));
    const per = Math.min(1400, (ms * 0.55) / Math.max(1, lines.length));
    node.querySelectorAll<HTMLElement>('.story-line').forEach((l, i) => (l.style.animationDelay = `${350 + i * per}ms`));
    this.ctx.layers.over.append(node);
    await sleep(ms - 450);
    node.classList.add('out');
    await sleep(450);
    node.remove();
  }

  // ---- coach
  coach(text: string | null, action?: CoachAction): void {
    if (!text) {
      if (this.coachEl) {
        const c = this.coachEl;
        this.coachEl = null;
        void exit(c, 180);
      }
      return;
    }
    if (!this.coachEl) {
      this.coachText = el('div.coach-t');
      this.coachKeys = el('div.coach-k');
      this.coachEl = el('div.coach', [this.coachKeys, this.coachText]);
      this.ctx.layers.gfx.append(this.coachEl);
    } else {
      this.coachEl.classList.remove('pop');
      void this.coachEl.offsetWidth;
      this.coachEl.classList.add('pop');
    }
    this.coachText!.textContent = text;
    this.coachKeys!.replaceChildren();
    this.coachEl.classList.toggle('no-keys', !action);
    if (action) {
      const k = COACH_KEYS[action];
      this.coachKeys!.append(
        el('span.k-kb', k.kb.map((t) => el('b', t))),
        el('span.k-pad', k.pad.map((t) => el('b', t))),
        el('span.k-touch', k.touch.map((t) => el('b', t))),
      );
    }
  }

  // ---- letterbox
  private bars: HTMLElement | null = null;
  letterbox(on: boolean): void {
    if (!this.bars) {
      this.bars = el('div.lbox', [el('div.lbox-t'), el('div.lbox-b')]);
      // Under the captions and graphics: subtitles sit on the black bars like a film.
      this.ctx.layers.hud.append(this.bars);
    }
    this.bars.classList.toggle('on', on);
  }

  // ---- markers
  private marks = new Map<string, HTMLElement>();
  markers(list: ScreenMarker[]): void {
    const keep = new Set<string>();
    for (const m of list) {
      keep.add(m.id);
      let node = this.marks.get(m.id);
      if (!node) {
        node = el(`div.mk.mk-${m.tone}`, [el('span.mk-l'), el('span.mk-a')]);
        this.ctx.layers.gfx.append(node);
        this.marks.set(m.id, node);
      }
      (node.firstChild as HTMLElement).textContent = m.label;
      // Off screen: pin to the edge, arrow pointing toward the robot.
      const edge = !m.onScreen;
      const x = Math.min(0.94, Math.max(0.06, m.x));
      const y = Math.min(0.86, Math.max(0.12, m.y));
      node.classList.toggle('edge', edge);
      node.style.left = `${x * 100}%`;
      node.style.top = `${y * 100}%`;
      if (edge) node.style.setProperty('--ang', `${Math.atan2(m.y - 0.5, m.x - 0.5)}rad`);
    }
    for (const [id, node] of this.marks) {
      if (keep.has(id)) continue;
      node.remove();
      this.marks.delete(id);
    }
  }

  /** Drop every card and the coach (debug resets). */
  clear(): void {
    for (const c of this.cards.splice(0)) c.remove();
    this.dateRun++;
    this.dateEl?.remove();
    this.dateEl = this.dateText = null;
    this.coachEl?.remove();
    this.coachEl = null;
    this.bars?.remove();
    this.bars = null;
    this.markers([]);
  }
}
