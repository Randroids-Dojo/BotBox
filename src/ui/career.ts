// Career screens: the workshop hub, the ladder with the rankings board, and the purse after a fight.
// Quieter than fight night: one obvious action per screen, the rest tucked underneath.

import { key } from './hints';
import type { CareerView, RewardsView, WorkshopChoice, WorkshopView } from './types';
import { append, el, exit, item, replay, sleep } from './core';
import { slamFx, type UiCtx } from './fx';
import { countUp, money, rankText } from './money';
import { button } from './widgets';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

// ------------------------------------------------------------------------------------------
// Workshop

export function workshop(ctx: UiCtx, v: WorkshopView): Promise<WorkshopChoice> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (c: WorkshopChoice) => {
      if (done) return;
      done = true;
      ctx.sfx.ui(c === 'menu' ? 'back' : 'select');
      if (c === 'fight' || c === 'sidegig') ctx.sfx.sting('whoosh');
      ctx.nav.pop(scope);
      void exit(node, 260).then(() => resolve(c));
    };

    const menuBtn = item(el('div.ws-menu', { 'aria-label': 'Menu' }, [el('span.ws-burger', [el('span'), el('span'), el('span')]), el('span.ws-menu-t', 'Menu')]), {
      activate: () => finish('menu'),
    });
    const ticker = v.news ? el('div.ws-ticker', [el('span.ws-tick-tag', 'News'), el('span.ws-tick-t', v.news)]) : null;
    const view = el('div.ws-view', [menuBtn, ticker]);

    // The next fight is the one big thing on the screen.
    let primary: HTMLElement;
    let card: HTMLElement;
    if (v.next) {
      const n = v.next;
      primary = button('Fight', { cls: 'primary ws-go', sub: `Purse ${money(n.prize)}`, activate: () => finish('fight') });
      card = el('div.ws-next', [
        el('div.ws-next-top', [el('span.kicker', 'Next fight'), el('span.ws-event', n.title)]),
        el('div.ws-opp', [el('span.ws-vs', 'vs'), el('span.ws-opp-name.wide', n.opponent.card.name)]),
        el('div.ws-blurb', n.blurb),
        primary,
      ]);
    } else {
      primary = button('Career', { cls: 'primary ws-go', activate: () => finish('career') });
      card = el('div.ws-next.ws-champ', [
        el('div.ws-next-top', [el('span.kicker', 'Champion')]),
        el('div.ws-opp', [el('span.ws-opp-name.wide', 'The Nut is home')]),
        el('div.ws-blurb', 'Rank #1. Nothing left to climb, except back into the Box for fun.'),
        primary,
      ]);
    }

    const build = button('Work on the robot', { cls: 'small ws-sec', activate: () => finish('build') });
    if (v.damaged) build.append(el('span.ws-flag', 'Needs repairs'));
    const gig = v.sideGig ? button('Side gig', { cls: 'small ws-sec', sub: money(v.sideGig.prize), activate: () => finish('sidegig') }) : null;
    if (gig && v.sideGig) gig.title = `${v.sideGig.title} vs ${v.sideGig.opponent.card.name}`;
    const ladder = button('Career', { cls: 'small ws-sec', activate: () => finish('career') });

    const panel = el('div.ws-panel', [
      el('div.ws-act', [el('span.kicker', `Act ${ROMAN[v.act.index] ?? v.act.index + 1}`), el('span.ws-act-t', v.act.title)]),
      el('div.ws-bot', [
        el('div.ws-name.wide.chrome-text', v.robot.name),
        el('div.ws-meta', [el(`span.ws-rank${v.rank === null ? '.none' : ''}`, rankText(v.rank)), el('span.ws-rec.cond', `${v.record.w}-${v.record.l}`)]),
      ]),
      el('div.ws-funds', [el('span.kicker', 'Funds'), el('span.ws-money.cond', money(v.funds))]),
      card,
      el('div.ws-more', [build, gig, ladder]),
      el('div.ws-hints.hint-row', [el('span', [...key('Enter', 'A'), 'Select']), el('span', [...key('Esc', 'B'), 'Menu'])]),
    ]);
    const node = el(`div.screen.workshop.t${v.tier}`, [view, panel]);
    ctx.layers.screen.append(node);
    const scope = ctx.nav.push({ root: node, back: () => finish('menu'), initial: primary });
    slamFx(node, primary, 'right', 12);
  });
}

// ------------------------------------------------------------------------------------------
// Career ladder

export function careerLadder(ctx: UiCtx, v: CareerView): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      ctx.nav.pop(scope);
      void exit(node, 240).then(() => resolve());
    };

    // The climb reads bottom to top: Act I at the foot, the championship at the summit.
    const climb = el('div.ld-climb');
    let nextRow: HTMLElement | null = null;
    v.acts.forEach((a, ai) => {
      const won = a.fights.every((f) => f.state === 'won');
      const current = a.fights.some((f) => f.state === 'next');
      const state = won ? 'done' : current ? 'current' : 'locked';
      const rows = el('div.ld-rungs');
      a.fights.forEach((f, fi) => {
        const right =
          f.state === 'won'
            ? el('span.ld-res.cond', f.result ?? 'Won')
            : f.state === 'next'
              ? el('span.ld-prize.cond', money(f.prize))
              : el('span.ld-prize.cond.dim', money(f.prize));
        const row = item(
          el(`div.ld-fight.s-${f.state}`, [
            el('span.ld-mark', f.state === 'won' ? '✓' : f.state === 'next' ? '▶' : String(fi + 1)),
            el('span.ld-main', [el('span.ld-opp.wide', f.opponent), el('span.ld-ev', f.title)]),
            right,
          ]),
          { activate: () => ctx.sfx.ui('tick') },
        );
        if (f.state === 'next') nextRow = row;
        rows.prepend(row);
      });
      climb.prepend(
        el(`div.ld-act.a-${state}`, [
          el('div.ld-act-k', [el('span.kicker', `Act ${ROMAN[ai] ?? ai + 1}`), state === 'done' ? el('span.ld-act-done', 'Done') : null]),
          el('div.ld-act-t.wide', a.title),
          el('div.ld-act-sub', a.subtitle),
          rows,
        ]),
      );
    });

    const board = el('div.ld-board');
    const top = v.rankings.filter((r) => r.rank <= 10);
    const rest = v.rankings.filter((r) => r.rank > 10);
    for (const r of top) board.append(rankRow(r));
    if (rest.length) {
      board.append(el('div.ld-gap', '...'));
      for (const r of rest) board.append(rankRow(r));
    }
    if (!v.rankings.some((r) => r.you)) board.append(el('div.ld-gap', '...'), el('div.ld-r.you', [el('span.ld-rn.cond', '--'), el('span.ld-rname.wide', 'You'), el('span.ld-rt', 'Unranked')]));

    const back = button('Back', { cls: 'small', activate: () => (ctx.sfx.ui('back'), finish()) });
    const stat = (k: string, val: string) => el('div.ld-stat', [el('span.kicker', k), el('span.ld-sv.cond', val)]);
    const node = el('div.screen.ladder', [
      el('div.dim-bg'),
      el('div.ld-wrap', [
        el('div.ld-head', [
          el('div', [el('div.kicker', 'Career'), el('h1.screen-title.wide.chrome-text', 'The climb')]),
          el('div.ld-stats', [stat('Funds', money(v.funds)), stat('Earned', money(v.earnings)), stat('Record', `${v.record.w}-${v.record.l}`)]),
        ]),
        el('div.ld-body', [el('div.ld-climb-wrap', climb), el('div.ld-side', [el('div.kicker', 'Heavyweight rankings'), board])]),
        el('div.ld-foot', [back, el('div.hint-row', [el('span', [...key('↑↓', '✛'), 'Scroll']), el('span', [...key('Esc', 'B'), 'Back'])])]),
      ]),
    ]);
    ctx.layers.screen.append(node);
    const scope = ctx.nav.push({ root: node, back: finish, initial: back });
    // Open on the rung you're standing on.
    requestAnimationFrame(() => (nextRow as HTMLElement | null)?.scrollIntoView({ block: 'center' }));
  });
}

function rankRow(r: { rank: number; name: string; you: boolean }): HTMLElement {
  return el(`div.ld-r${r.you ? '.you' : ''}`, [el('span.ld-rn.cond', `${r.rank}`), el('span.ld-rname.wide', r.name), r.you ? el('span.ld-rt', 'You') : null]);
}

// ------------------------------------------------------------------------------------------
// Rewards

export function rewards(ctx: UiCtx, v: RewardsView): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    let skipping = false;
    const skips: (() => void)[] = [];
    const finish = () => {
      if (done) return;
      if (!settled) {
        // First press skips to the end of the count.
        skipping = true;
        for (const s of skips) s();
        return;
      }
      done = true;
      ctx.sfx.ui('select');
      ctx.nav.pop(scope);
      void exit(node, 260).then(() => resolve());
    };
    let settled = false;
    const wait = (ms: number) => (skipping ? Promise.resolve() : Promise.race([sleep(ms), new Promise<void>((r) => skips.push(r))]));

    const cont = button('Continue', { cls: 'primary rw-go', activate: () => finish() });
    const card = el(`div.rw-card${v.won ? '.won' : '.lost'}`);
    const actBanner = v.actComplete
      ? el('div.rw-act', [el('div.rw-act-k.kicker', 'Act complete'), el('div.rw-act-t.wide.chrome-text', v.actComplete.title), el('div.rw-act-n', `Next: ${v.actComplete.next}`)])
      : null;
    const node = el('div.screen.rewards', [el('div.dim-bg'), el('div.rw-wrap', [actBanner, card])]);

    const fundsNum = el('span.rw-fv.cond', money(v.fundsBefore));
    const rankOld = el('span.rw-r.old.cond', rankText(v.rankBefore));
    const rankNew = el('span.rw-r.new.cond', rankText(v.rankAfter));
    const climbed = v.rankAfter !== null && (v.rankBefore === null || v.rankAfter < v.rankBefore);
    const rankRow = el(`div.rw-rank${climbed ? '.up' : ''}`, [el('span.kicker', 'Rank'), el('span.rw-rslot', climbed ? [rankOld, el('span.rw-arrow', '▲'), rankNew] : [rankNew])]);
    const unlocks = v.unlocks.length ? el('div.rw-unlocks', [el('span.kicker', 'New in the store'), el('div.rw-chips', v.unlocks.map((u) => el('span.rw-chip', u)))]) : null;

    if (v.won) {
      const purse = el('div.rw-purse.cond', money(0));
      append(card, [
        el('div.rw-head', [el('span.tag', 'Winner'), el('span.kicker', 'Purse')]),
        purse,
        el('div.rw-funds', [el('span.kicker', 'Funds'), fundsNum]),
        rankRow,
        unlocks,
        v.note ? el('div.rw-note', v.note) : null,
        cont,
      ]);
      for (const e of [rankRow, unlocks]) e?.classList.add('pending');
      ctx.layers.screen.append(node);
      void (async () => {
        await wait(350);
        ctx.sfx.sting('cash');
        const c1 = countUp(purse, 0, v.prize, skipping ? 0 : 900);
        skips.push(c1.skip);
        await c1.done;
        await wait(150);
        const c2 = countUp(fundsNum, v.fundsBefore, v.fundsAfter, skipping ? 0 : 800);
        skips.push(c2.skip);
        await c2.done;
        replay(fundsNum, 'bump');
        await wait(250);
        rankRow.classList.remove('pending');
        replay(rankRow, 'in');
        if (climbed) ctx.sfx.sting('rankup');
        if (unlocks) {
          await wait(650);
          unlocks.classList.remove('pending');
          replay(unlocks, 'in');
          ctx.sfx.sting('unlock');
        }
        if (actBanner) {
          await wait(500);
          actBanner.classList.add('on');
          ctx.sfx.sting('whoosh');
          slamFx(node, actBanner, 'center', 20);
        }
        settled = true;
      })();
    } else {
      card.append(
        el('div.rw-head', [el('span.tag.blue', 'Not tonight')]),
        el('div.rw-loss.wide', 'No purse'),
        el('div.rw-note', v.note ?? 'Rematch any time.'),
        el('div.rw-funds.quiet', [el('span.kicker', 'Funds'), fundsNum]),
        cont,
      );
      fundsNum.textContent = money(v.fundsAfter);
      ctx.layers.screen.append(node);
      settled = true;
    }
    const scope = ctx.nav.push({ root: node, back: finish, initial: cont });
  });
}
