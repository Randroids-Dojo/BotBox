// Loading, title, main menu, class picker, settings, credits and pause.

import { key } from './hints';
import type { WeightClass } from '../contract';
import { CLASSES, CLASS_LABEL, CLASS_LIMIT_LB } from '../data/parts';
import type { MainMenuChoice, SaveSummary, Settings } from './types';
import { el, exit, item, sleep } from './core';
import { slamFx, wipe, type UiCtx } from './fx';
import { button, cycler, nutIcon, slider, toggle } from './widgets';

// ------------------------------------------------------------------------------------------
// Loading

export class Loading {
  private node: HTMLElement | null = null;
  private fill: HTMLElement | null = null;
  private label: HTMLElement | null = null;
  private pct: HTMLElement | null = null;
  constructor(private ctx: UiCtx) {}

  show(progress: number, label?: string): void {
    if (!this.node) {
      this.fill = el('div.load-fill');
      this.label = el('div.load-label.wide');
      this.pct = el('div.load-pct.cond');
      this.node = el('div.loading', [
        el('div.load-center', [
          el('div.load-logo.logo-type.chrome-text', 'BOTBOX'),
          el('div.load-tag.kicker', 'Robot combat. Season 2001.'),
          el('div.load-bar.panel', [this.fill]),
          el('div.load-row', [this.label, this.pct]),
        ]),
      ]);
      this.ctx.layers.top.append(this.node);
    }
    const p = Math.max(0, Math.min(1, progress));
    this.fill!.style.width = `${(p * 100).toFixed(1)}%`;
    this.pct!.textContent = `${Math.round(p * 100)}%`;
    this.label!.textContent = label ?? loadingQuip(p);
  }

  hide(): void {
    if (!this.node) return;
    const n = this.node;
    this.node = null;
    void exit(n, 420);
  }
}

function loadingQuip(p: number): string {
  const lines = ['Sweeping the Box', 'Charging the NiCads', 'Sharpening the killsaws', 'Polishing the Nut', 'Seating the crowd', 'Testing the Pulverizers'];
  return lines[Math.min(lines.length - 1, Math.floor(p * lines.length))];
}

// ------------------------------------------------------------------------------------------
// Title

export function title(ctx: UiCtx): Promise<void> {
  return new Promise((resolve) => {
    const press = el('div.press.wide', 'Press start');
    const node = el('div.screen.title-screen.live', [
      el('div.title-low', [el('div.title-tag.kicker', 'Robot combat. Season 2001.'), press]),
      el('div.title-foot', [el('span', 'Taped at Treasure Island, San Francisco'), el('span', 'Season 2001')]),
    ]);
    ctx.layers.screen.append(node);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      ctx.sfx.unlock();
      ctx.sfx.ui('select');
      ctx.sfx.sting('whoosh');
      ctx.nav.pop(scope);
      press.classList.add('hit');
      slamFx(node, press, 'center', 22);
      setTimeout(() => void exit(node, 300).then(resolve), 260);
    };
    const scope = ctx.nav.push({ root: node, back: () => undefined });
    // Confirm from keyboard or pad: the scope has no items, so listen directly.
    const off = ctx.input.onMenu((n) => {
      if (n === 'confirm' && ctx.nav.top() === scope) {
        off();
        finish();
      }
    });
    node.addEventListener('pointerup', () => {
      off();
      finish();
    });
  });
}

// ------------------------------------------------------------------------------------------
// Main menu

const MENU_SUBS: Record<MainMenuChoice, string> = {
  continue: '',
  season: 'Three fights for the Nut',
  exhibition: 'One-off fights and rumbles',
  garage: 'Build and paint your robot',
  settings: 'Sound, camera, controls',
  credits: 'Who built this',
};

export function mainMenu(ctx: UiCtx, save: SaveSummary): Promise<MainMenuChoice> {
  return new Promise((resolve) => {
    const list = el('div.menu-list');
    const choices: { id: MainMenuChoice; label: string; sub: string }[] = [];
    if (save.season) choices.push({ id: 'continue', label: 'Continue', sub: save.season });
    choices.push({ id: 'season', label: save.season ? 'New season' : 'Season', sub: MENU_SUBS.season });
    choices.push({ id: 'exhibition', label: 'Exhibition', sub: MENU_SUBS.exhibition });
    choices.push({ id: 'garage', label: 'Garage', sub: save.robot ? save.robot.name : MENU_SUBS.garage });
    choices.push({ id: 'settings', label: 'Settings', sub: MENU_SUBS.settings });
    choices.push({ id: 'credits', label: 'Credits', sub: MENU_SUBS.credits });
    let done = false;
    const pick = (id: MainMenuChoice) => {
      if (done) return;
      done = true;
      ctx.sfx.ui('select');
      ctx.sfx.sting('whoosh');
      ctx.nav.pop(scope);
      void exit(node, 260).then(() => resolve(id));
    };
    choices.forEach((c, i) => {
      const b = button(c.label, { sub: c.sub, activate: () => pick(c.id), cls: c.id === 'continue' ? 'primary' : '' });
      b.style.animationDelay = `${i * 45}ms`;
      list.append(b);
    });

    const nuts = el('div.nut-row');
    for (const cls of CLASSES) {
      const n = save.nuts[cls] ?? 0;
      nuts.append(el(`div.nut-slot${n ? '.won' : ''}`, [nutIcon(n ? 'won' : 'empty'), el('span.nut-cls', CLASS_LABEL[cls].replace(' heavyweight', ' heavy')), el('span.nut-n.cond', n ? `x${n}` : '0')]));
    }
    const card = el('div.save-card.panel.scan', [
      el('div.kicker', 'Your shop'),
      el('div.save-robot.wide', save.robot ? save.robot.name : 'No robot yet'),
      el('div.save-line', save.robot ? `${CLASS_LABEL[save.robot.cls]} build` : 'Head to the garage and bolt one together.'),
      save.season ? el('div.save-season', [el('span.tag', 'On air'), el('span', save.season)]) : null,
      el('div.kicker.nut-kicker', 'Giant Nuts'),
      nuts,
    ]);

    const node = el('div.screen.main-menu', [
      el('div.mm-left', [el('div.mm-brand', [el('span.mm-logo.logo-type.chrome-text', 'BOTBOX'), el('span.mm-season.kicker', 'Season 2001')]), list]),
      card,
      el('div.mm-hints.hint-row', [el('span', [...key('Enter', 'A'), 'Select']), el('span', [...key('↑↓', '✛'), 'Move'])]),
    ]);
    ctx.layers.screen.append(node);
    const scope = ctx.nav.push({ root: node, wrap: true, initial: list.firstElementChild as HTMLElement });
  });
}

// ------------------------------------------------------------------------------------------
// Pick a weight class

const CLASS_BLURB: Record<WeightClass, string> = {
  light: 'Small, fast and fragile. Hits come quick.',
  middle: 'The builder sweet spot. Room for a real weapon.',
  heavy: 'The main event. Big disks, big flips, big crowds.',
  super: 'Monsters. Every hit sounds like a car crash.',
};

export function pickClass(ctx: UiCtx, titleText: string): Promise<WeightClass | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: WeightClass | null) => {
      if (done) return;
      done = true;
      ctx.nav.pop(scope);
      if (v) {
        ctx.sfx.ui('select');
        ctx.sfx.sting('whoosh');
      }
      void exit(node, 260).then(() => resolve(v));
    };
    const grid = el('div.class-grid');
    let initial: HTMLElement | null = null;
    CLASSES.forEach((c, i) => {
      const card = item(
        el('div.class-card.panel.scan', [
          el('div.cc-top', [el('span.cc-n.cond', String(i + 1).padStart(2, '0')), el('span.cc-scale', [el('span.cc-dot'), el('span.cc-dot'), el('span.cc-dot'), el('span.cc-dot')])]),
          el('div.cc-name.wide', CLASS_LABEL[c]),
          el('div.cc-limit', [el('span.cc-lb.cond', String(CLASS_LIMIT_LB[c])), el('span.cc-unit.wide', 'lb')]),
          el('div.cc-blurb', CLASS_BLURB[c]),
          el('div.hazard-bar'),
        ]),
        { activate: () => finish(c) },
      );
      card.style.setProperty('--size', String(i + 1));
      card.style.animationDelay = `${i * 60}ms`;
      if (c === 'heavy') initial = card;
      grid.append(card);
    });
    const node = el('div.screen.class-screen', [
      el('div.dim-bg'),
      el('div.screen-head', [el('div', [el('div.kicker', 'Pick a weight class'), el('h1.screen-title.wide.chrome-text', titleText)])]),
      grid,
      el('div.hint-row.foot-hints', [el('span', [...key('Enter', 'A'), 'Pick']), el('span', [...key('Esc', 'B'), 'Back'])]),
    ]);
    ctx.layers.screen.append(node);
    const scope = ctx.nav.push({ root: node, back: () => finish(null), initial });
  });
}

// ------------------------------------------------------------------------------------------
// Settings

export function settings(ctx: UiCtx, current: Settings): Promise<Settings> {
  return new Promise((resolve) => {
    const s: Settings = { ...current, volumes: { ...current.volumes } };
    const tick = () => ctx.sfx.ui('tick');
    const vol = () => {
      try {
        ctx.sfx.engine?.setVolumes(s.volumes);
      } catch {
        /* optional */
      }
    };
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      ctx.nav.pop(scope);
      void exit(node, 240).then(() => resolve(s));
    };
    const group = (name: string, rows: HTMLElement[]) => el('div.set-group', [el('div.kicker', name), ...rows]);
    const rows = el('div.set-rows', [
      group('Sound', [
        slider('Master', s.volumes.master, (v) => ((s.volumes.master = v), vol()), tick),
        slider('Music', s.volumes.music, (v) => ((s.volumes.music = v), vol()), tick),
        slider('Effects', s.volumes.sfx, (v) => ((s.volumes.sfx = v), vol()), tick),
        slider('Voices', s.volumes.voice, (v) => ((s.volumes.voice = v), vol()), tick),
        toggle('Commentary', s.commentary, (v) => (s.commentary = v), tick),
        toggle('Subtitles', s.subtitles, (v) => (s.subtitles = v), tick),
      ]),
      group('Fight', [
        cycler<Settings['camera']>(
          'Camera',
          [
            { value: 'chase', label: 'Chase' },
            { value: 'broadcast', label: 'Broadcast' },
            { value: 'driver', label: 'Driver' },
          ],
          s.camera,
          (v) => (s.camera = v),
          tick,
        ).node,
        cycler<Settings['drive']>(
          'Steering',
          [
            { value: 'robot', label: 'Robot' },
            { value: 'camera', label: 'Camera' },
            { value: 'tank', label: 'Tank' },
          ],
          s.drive,
          (v) => (s.drive = v),
          tick,
        ).node,
        toggle('Cinematic hits', s.cinematicHits, (v) => (s.cinematicHits = v), tick),
        cycler<number>(
          'Exhibition length',
          [
            { value: 120, label: '2:00' },
            { value: 180, label: '3:00' },
            { value: 300, label: '5:00' },
          ],
          s.matchLength,
          (v) => (s.matchLength = v as Settings['matchLength']),
          tick,
        ).node,
      ]),
      group('Picture', [
        cycler<Settings['quality']>(
          'Quality',
          [
            { value: 'auto', label: 'Auto' },
            { value: 'high', label: 'High' },
            { value: 'medium', label: 'Medium' },
            { value: 'low', label: 'Low' },
          ],
          s.quality,
          (v) => (s.quality = v),
          tick,
        ).node,
        toggle('Broadcast filter', s.broadcastFilter, (v) => (s.broadcastFilter = v), tick),
      ]),
    ]);
    const done_ = button('Done', { activate: () => (ctx.sfx.ui('select'), finish()), cls: 'small primary' });
    const node = el('div.screen.settings-screen.modal', [
      el('div.dim-bg'),
      el('div.modal-panel.panel.cut', [
        el('div.modal-head', [el('div.kicker', 'Setup'), el('h1.screen-title.wide.chrome-text', 'Settings')]),
        el('div.hazard-bar'),
        rows,
        el('div.modal-foot', [done_, el('div.hint-row', [el('span', [...key('◀▶', '✛'), 'Change']), el('span', [...key('Esc', 'B'), 'Done'])])]),
      ]),
    ]);
    ctx.layers.over.append(node);
    const scope = ctx.nav.push({ root: node, back: finish, wrap: true });
  });
}

// ------------------------------------------------------------------------------------------
// Credits

const CREDITS: [string, string[]][] = [
  ['BOTBOX', ['Robot combat. Season 2001.']],
  ['Announcer', ['Vic Ramone']],
  ['Hosts', ['Dale Pruitt', 'Chuck "Cannon" Kowalski']],
  ['Pit reporter', ['Jenna Rae']],
  ['Judges', ['Dr. Elaine Park', 'Rick Darrow', 'Gus Feldman']],
  ['Arena crew', ['The Pulverizer operators', 'Killsaw maintenance', 'Lexan polishers']],
  ['Builders', ['Every nerd in a team shirt who ever stayed up all night in a garage']],
  ['Taped at', ['Treasure Island, San Francisco']],
  ['Everything here is made up', ['The show, the hosts, the judges and every robot are fictional.']],
];

export function credits(ctx: UiCtx): Promise<void> {
  return new Promise((resolve) => {
    const roll = el('div.cred-roll');
    for (const [head, lines] of CREDITS) roll.append(el('div.cred-block', [el('div.kicker', head), ...lines.map((l) => el('div.cred-line.wide', l))]));
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      ctx.nav.pop(scope);
      void exit(node, 240).then(() => resolve());
    };
    const back = button('Back', { activate: () => (ctx.sfx.ui('back'), finish()), cls: 'small' });
    const node = el('div.screen.credits-screen', [el('div.dim-bg'), el('div.cred-window', roll), el('div.cred-foot', back)]);
    ctx.layers.screen.append(node);
    const scope = ctx.nav.push({ root: node, back: finish });
  });
}

// ------------------------------------------------------------------------------------------
// Pause

export function pause(ctx: UiCtx, canTapOut: boolean): Promise<'resume' | 'tapout' | 'settings' | 'quit'> {
  return new Promise((resolve) => {
    let done = false;
    let armed: 'tapout' | 'quit' | null = null;
    const finish = (v: 'resume' | 'tapout' | 'settings' | 'quit') => {
      if (done) return;
      done = true;
      ctx.nav.pop(scope);
      void exit(node, 200).then(() => resolve(v));
    };
    const confirmTwice = (id: 'tapout' | 'quit', b: HTMLElement, ask: string) => {
      if (armed === id) {
        ctx.sfx.ui('select');
        finish(id);
        return;
      }
      armed = id;
      ctx.sfx.ui('error');
      b.querySelector('.label')!.textContent = ask;
      b.classList.add('armed');
    };
    const resume = button('Resume', { activate: () => (ctx.sfx.ui('select'), finish('resume')), cls: 'primary' });
    const tap: HTMLElement = button('Tap out', {
      sub: canTapOut ? 'Forfeit, save the robot' : 'Not now',
      disabled: !canTapOut,
      activate: () => confirmTwice('tapout', tap, 'Really tap out?'),
    });
    const set = button('Settings', { activate: () => (ctx.sfx.ui('select'), finish('settings')) });
    const quit: HTMLElement = button('Quit to menu', { activate: () => confirmTwice('quit', quit, 'Really quit?') });
    const node = el('div.screen.pause-screen.modal', [
      el('div.dim-bg'),
      el('div.pause-panel.panel.cut', [el('div.pause-head', [el('span.tag', 'Time out'), el('h1.screen-title.wide.chrome-text', 'Paused')]), el('div.hazard-bar'), el('div.menu-list', [resume, tap, set, quit])]),
    ]);
    ctx.layers.over.append(node);
    const scope = ctx.nav.push({ root: node, back: () => finish('resume'), wrap: true, initial: resume });
  });
}

/** A short full-screen wipe between big screens. */
export async function bigWipe(ctx: UiCtx): Promise<void> {
  ctx.sfx.sting('whoosh');
  wipe(ctx.layers.top);
  await sleep(300);
}
