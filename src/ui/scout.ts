// Scouting card for the next opponent: hardware, stats, record, blurb and a tactical tip.

import type { Loadout } from '../contract';
import { CLASS_LABEL } from '../data/parts';
import type { RivalSummary } from './types';
import { el } from './core';
import { hardwareLine, scoutTip, weaponShort } from './stats';
import { statBars } from './widgets';

const STYLE_LABEL: Record<string, string> = {
  aggressive: 'Charges in',
  tactical: 'Patient, picks its moment',
  bully: 'Shoves you into hazards',
  spinner: 'Spins up and hunts',
  wedger: 'Gets under and lifts',
};

export function scoutCard(opp: RivalSummary, mine: Loadout | null, compact = false): HTMLElement {
  const l = opp.spec.loadout;
  const swatch = el('span.sc-swatch', { style: `--a:${l.paint.primary};--b:${l.paint.secondary};--c:${l.paint.accent}` });
  return el(`div.scout${compact ? '.compact' : ''}.panel.scan`, [
    el('div.sc-top', [el('span.tag', 'Scouting report'), el('span.sc-seed.cond', `#${opp.seed} seed`)]),
    el('div.sc-name-row', [swatch, el('div.sc-name.wide.chrome-text', opp.card.name)]),
    el('div.sc-team', `${opp.card.team}. ${opp.card.hometown}`),
    el('div.sc-facts', [
      fact('Weapon', weaponShort(l)),
      fact('Record', opp.card.record ?? '0-0'),
      fact('Weight', `${opp.spec.stats.weightLb.toFixed(0)} lb`),
      fact('Style', STYLE_LABEL[opp.style] ?? opp.style),
    ]),
    statBars(opp.spec.stats, opp.cls, null, ['speed', 'push', 'weapon', 'armor']),
    el('div.sc-hw', [el('span.kicker', 'Hardware'), el('span', hardwareLine(l))]),
    compact ? null : el('div.sc-blurb', opp.card.blurb),
    el('div.sc-tip', [el('span.tag.chrome', 'Tip'), el('span.sc-tip-text', scoutTip(opp.spec, mine))]),
    el('div.sc-class.kicker', CLASS_LABEL[opp.cls]),
  ]);
}

function fact(k: string, v: string): HTMLElement {
  return el('div.fact', [el('span.fact-k', k), el('span.fact-v.wide', v)]);
}
