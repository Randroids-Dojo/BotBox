// Eight-robot bracket with the player's path highlighted and a scouting card for the next fight.

import { key } from './hints';
import { CLASS_LABEL } from '../data/parts';
import type { BracketMatch, BracketSlot, BracketView, RivalSummary } from './types';
import { el, exit } from './core';
import { slamFx, type UiCtx } from './fx';
import { scoutCard } from './scout';
import { button, nutIcon } from './widgets';

export function bracket(ctx: UiCtx, view: BracketView, opponent: RivalSummary | null): Promise<void> {
  return new Promise((resolve) => {
    const tree = el('div.bk-tree');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('bk-lines');
    tree.append(svg);
    const cols: HTMLElement[][] = [];
    view.rounds.forEach((round, ri) => {
      const col = el('div.bk-col', [el('div.bk-round.kicker', round.label)]);
      const boxes: HTMLElement[] = [];
      const stack = el('div.bk-stack');
      round.matches.forEach((m, mi) => {
        const next = view.next && view.next.round === ri && view.next.match === mi;
        const box = matchBox(m, !!next);
        box.style.animationDelay = `${ri * 120 + mi * 50}ms`;
        boxes.push(box);
        stack.append(box);
      });
      col.append(stack);
      cols.push(boxes);
      tree.append(col);
    });
    // The champion slot.
    const last = view.rounds[view.rounds.length - 1]?.matches[0];
    const champ = last?.winner ? nameOf(last, last.winner) : null;
    const champSlot = el(`div.bk-champ${champ?.player ? '.player' : ''}`, [nutIcon(champ ? 'won' : 'empty'), el('div.bk-champ-name.wide', champ ? champ.name : 'Giant Nut')]);
    tree.append(el('div.bk-col.bk-champ-col', [el('div.bk-round.kicker', 'Champion'), el('div.bk-stack', champSlot)]));

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      ctx.sfx.ui('select');
      ctx.sfx.sting('whoosh');
      ctx.nav.pop(scope);
      window.removeEventListener('resize', draw);
      void exit(node, 260).then(() => resolve());
    };
    const go = button(view.next ? 'To the pits' : 'Continue', { activate: finish, cls: 'small primary' });
    const node = el('div.screen.bracket-screen', [
      el('div.dim-bg'),
      el('div.bk-main', [
        el('div.screen-head', [el('div', [el('div.kicker', `${CLASS_LABEL[view.cls]} bracket`), el('h1.screen-title.wide.chrome-text', 'The road to the Nut')])]),
        el('div.bk-scroll', tree),
        el('div.bk-foot', [go, el('div.hint-row', [el('span', [...key('Enter', 'A'), 'Continue'])])]),
      ]),
      opponent ? el('div.bk-side', scoutCard(opponent, ctx.mine)) : null,
    ]);
    ctx.layers.screen.append(node);
    const scope = ctx.nav.push({ root: node, back: finish, initial: go });

    // Connector lines between rounds, drawn after layout.
    function draw(): void {
      const tr = tree.getBoundingClientRect();
      svg.setAttribute('width', String(tree.scrollWidth));
      svg.setAttribute('height', String(tree.scrollHeight));
      svg.replaceChildren();
      const line = (pts: [number, number][], hot: boolean) => {
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        p.setAttribute('points', pts.map(([x, y]) => `${x},${y}`).join(' '));
        p.setAttribute('class', hot ? 'hot' : '');
        svg.append(p);
      };
      const all = [...cols, [champSlot]];
      for (let r = 0; r < all.length - 1; r++) {
        all[r].forEach((box, i) => {
          const target = all[r + 1][Math.floor(i / 2)];
          if (!target) return;
          const a = box.getBoundingClientRect();
          const b = target.getBoundingClientRect();
          const x0 = a.right - tr.left;
          const y0 = a.top + a.height / 2 - tr.top;
          const x1 = b.left - tr.left;
          const y1 = b.top + b.height / 2 - tr.top;
          const mx = (x0 + x1) / 2;
          line(
            [
              [x0, y0],
              [mx, y0],
              [mx, y1],
              [x1, y1],
            ],
            box.classList.contains('has-player') && box.classList.contains('player-won'),
          );
        });
      }
    }
    requestAnimationFrame(() => requestAnimationFrame(draw));
    setTimeout(draw, 700);
    window.addEventListener('resize', draw);
    slamFx(node, go, 'right', 10);
  });
}

function nameOf(m: BracketMatch, id: string): BracketSlot | null {
  if (m.a?.id === id) return m.a;
  if (m.b?.id === id) return m.b;
  return null;
}

function matchBox(m: BracketMatch, next: boolean): HTMLElement {
  const slot = (s: BracketSlot | null) => {
    if (!s) return el('div.bk-slot.empty', [el('span.bk-name', 'TBD')]);
    const won = m.winner === s.id;
    const lost = !!m.winner && !won;
    return el(`div.bk-slot${s.player ? '.player' : ''}${won ? '.won' : ''}${lost ? '.lost' : ''}`, [el('span.bk-name.wide', s.name), won ? el('span.bk-w', '▶') : null]);
  };
  const hasPlayer = !!(m.a?.player || m.b?.player);
  const playerWon = hasPlayer && !!m.winner && (m.a?.player ? m.a.id === m.winner : m.b?.id === m.winner);
  return el(`div.bk-match${next ? '.next' : ''}${hasPlayer ? '.has-player' : ''}${playerWon ? '.player-won' : ''}`, [
    slot(m.a),
    slot(m.b),
    m.result ? el('div.bk-res.cond', m.result) : next ? el('div.bk-res.next-tag', 'Next fight') : null,
  ]);
}
