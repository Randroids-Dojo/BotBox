// Exhibition setup: duel, rumble or watch; class; pick rivals from cards; optionally drive one.

import type { WeightClass } from '../contract';
import { CLASSES, CLASS_LABEL } from '../data/parts';
import type { ExhibitionConfig, RivalSummary } from './types';
import { el, exit, item, replay } from './core';
import type { UiCtx } from './fx';
import { weaponShort } from './stats';
import { button, cycler, statBars } from './widgets';

type Mode = ExhibitionConfig['mode'];
const NEED: Record<Mode, [number, number]> = { duel: [1, 1], rumble: [2, 3], watch: [2, 2] };
const MODE_HINT: Record<Mode, string> = {
  duel: 'Pick 1 opponent',
  rumble: 'Pick 2 or 3 opponents. Last robot moving wins.',
  watch: 'Pick 2 robots and grab a soda',
};

export function exhibition(ctx: UiCtx, rivals: RivalSummary[], hasRobot: boolean): Promise<ExhibitionConfig | null> {
  return new Promise((resolve) => {
    const classes = CLASSES.filter((c) => rivals.some((r) => r.cls === c));
    let mode: Mode = 'duel';
    let cls: WeightClass = classes.includes('heavy') ? 'heavy' : classes[0] ?? 'heavy';
    let drive: string = hasRobot ? 'mine' : '';
    let picked: string[] = [];
    let done = false;
    const tick = () => ctx.sfx.ui('tick');

    const inClass = () => rivals.filter((r) => r.cls === cls).sort((a, b) => a.seed - b.seed);
    const driveOptions = () => [
      ...(hasRobot ? [{ value: 'mine', label: 'My robot' }] : []),
      ...inClass().map((r) => ({ value: r.id, label: r.card.name })),
    ];
    const ensureDrive = () => {
      if (mode === 'watch') return;
      const ok = driveOptions().some((o) => o.value === drive);
      if (!ok) drive = driveOptions()[0]?.value ?? '';
      picked = picked.filter((p) => p !== drive);
    };

    const left = el('div.ex-left');
    const grid = el('div.ex-grid');
    const need = el('div.ex-need.wide');
    const fight = button('Fight', { activate: () => go(), cls: 'primary' });
    const back = button('Back', { activate: () => cancel(), cls: 'small' });

    const renderLeft = () => {
      const kids: HTMLElement[] = [
        el('div.ex-head', [el('div.kicker', 'Exhibition'), el('h1.screen-title.wide.chrome-text', 'Fight night')]),
        el('div.hazard-bar'),
        cycler<Mode>(
          'Format',
          [
            { value: 'duel', label: 'Duel' },
            { value: 'rumble', label: 'Rumble' },
            { value: 'watch', label: 'Watch' },
          ],
          mode,
          (v) => {
            mode = v as Mode;
            const [, max] = NEED[mode];
            picked = picked.slice(0, max);
            ensureDrive();
            render('format');
          },
          tick,
        ).node,
        cycler<WeightClass>(
          'Class',
          classes.map((c) => ({ value: c, label: CLASS_LABEL[c] })),
          cls,
          (v) => {
            cls = v;
            picked = [];
            ensureDrive();
            render('class');
          },
          tick,
        ).node,
        mode !== 'watch'
          ? cycler<string>('You drive', driveOptions(), drive, (v) => {
              drive = v;
              picked = picked.filter((p) => p !== drive);
              render('drive');
            }, tick).node
          : null,
        need,
        el('div.ex-btns', [fight, back]),
      ].filter((x): x is HTMLElement => !!x);
      left.replaceChildren(...kids);
      const rows = left.querySelectorAll<HTMLElement>('.row');
      ['format', 'class', 'drive'].forEach((k, i) => rows[i]?.setAttribute('data-key', k));
    };

    const renderGrid = () => {
      grid.replaceChildren();
      for (const r of inClass()) {
        const isDrive = mode !== 'watch' && drive === r.id;
        const sel = picked.includes(r.id);
        const l = r.spec.loadout;
        const card = item(
          el(`div.ex-card.panel${sel ? '.sel' : ''}${isDrive ? '.drive' : ''}`, { 'data-key': `rival:${r.id}` }, [
            el('div.exc-paint', { style: `--a:${l.paint.primary};--b:${l.paint.secondary};--c:${l.paint.accent}` }),
            el('div.exc-top', [el('span.exc-seed.cond', `#${r.seed}`), el('span.exc-rec.cond', r.card.record ?? '')]),
            el('div.exc-name.wide', r.card.name),
            el('div.exc-weapon', weaponShort(l)),
            statBars(r.spec.stats, r.cls, null, ['speed', 'weapon', 'armor']),
            sel ? el('div.exc-stamp.wide', mode === 'watch' ? 'On' : 'In') : null,
            isDrive ? el('div.exc-stamp.you.wide', 'You') : null,
          ]),
          {
            activate: () => {
              if (isDrive) {
                ctx.sfx.ui('error');
                return;
              }
              const [, max] = NEED[mode];
              if (sel) picked = picked.filter((p) => p !== r.id);
              else {
                picked = [...picked, r.id];
                if (picked.length > max) picked = picked.slice(picked.length - max);
              }
              ctx.sfx.ui(sel ? 'back' : 'select');
              render(`rival:${r.id}`);
            },
          },
        );
        grid.append(card);
      }
    };

    const valid = () => {
      const [min, max] = NEED[mode];
      if (picked.length < min || picked.length > max) return false;
      if (mode !== 'watch' && !drive) return false;
      return true;
    };

    const render = (keep: string | null) => {
      const k = keep ?? scope?.focused?.dataset.key ?? null;
      renderLeft();
      renderGrid();
      const [min] = NEED[mode];
      need.textContent = valid() ? `Ready: ${picked.length} ${picked.length === 1 ? 'opponent' : mode === 'watch' ? 'robots' : 'opponents'}` : `${MODE_HINT[mode]} (${picked.length}/${min})`;
      need.classList.toggle('ok', valid());
      fight.classList.toggle('blocked', !valid());
      if (scope) scope.refresh(k ? node.querySelector<HTMLElement>(`[data-key="${CSS.escape(k)}"]`) : null);
    };

    const go = () => {
      if (!valid()) {
        ctx.sfx.ui('error');
        replay(need, 'shake');
        return;
      }
      finish({ mode, cls, rivals: [...picked], playerRival: mode === 'watch' || drive === 'mine' ? null : drive });
    };
    const cancel = () => finish(null);
    const finish = (v: ExhibitionConfig | null) => {
      if (done) return;
      done = true;
      if (v) {
        ctx.sfx.ui('select');
        ctx.sfx.sting('whoosh');
      }
      if (scope) ctx.nav.pop(scope);
      void exit(node, 260).then(() => resolve(v));
    };

    const node = el('div.screen.ex-screen', [el('div.dim-bg'), el('div.ex-wrap', [left, el('div.ex-right', [el('div.kicker.ex-grid-head', 'The roster'), el('div.ex-scroll', grid)])])]);
    ctx.layers.screen.append(node);
    ensureDrive();
    let scope: ReturnType<typeof ctx.nav.push> | undefined;
    render(null);
    const sc = ctx.nav.push({ root: node, back: cancel });
    scope = sc;
    sc.refresh(left.querySelector<HTMLElement>('.nav'));
  });
}
