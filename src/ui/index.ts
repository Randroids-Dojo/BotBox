// BOTBOX broadcast UI: menus, garage, bracket, broadcast graphics, fight HUD and touch controls.
// DOM over the WebGL canvas. See src/ui/types.ts for the contract.

import '@fontsource-variable/saira/wdth.css';
import '@fontsource/michroma/400.css';
import './css/base.css';
import './css/menus.css';
import './css/garage.css';
import './css/broadcast.css';
import './css/hud.css';
import './css/career.css';

import type { AudioEngine } from '../audio/types';
import type { Input } from '../input/input';
import type { BroadcastUI } from './types';
import { Nav, Sfx, el } from './core';
import type { UiCtx } from './fx';
import { Broadcast } from './broadcast';
import { bracket } from './bracket';
import { careerLadder, rewards, saves, workshop } from './career';
import { Cinema } from './cinema';
import { exhibition } from './exhibition';
import { garage } from './garage';
import { Hud } from './hud';
import { Loading, credits, mainMenu, pause, pickClass, settings, title } from './menus';
import { TouchControls } from './touch';

export interface BroadcastUIExtras {
  /** Lab and debug hooks. */
  readonly debug: {
    ctx: UiCtx;
    forceTouch(on: boolean): void;
    /** Tear down every open screen and graphic. */
    reset(): void;
  };
}

export function createBroadcastUI(deps: { input: Input; audio?: AudioEngine | null }): BroadcastUI & BroadcastUIExtras {
  const sfx = new Sfx(deps.audio ?? null);
  const nav = new Nav(deps.input, sfx);
  let ctx: UiCtx | null = null;
  let loading: Loading | null = null;
  let bc: Broadcast | null = null;
  let hud: Hud | null = null;
  let touch: TouchControls | null = null;
  let cinema: Cinema | null = null;

  const need = (): UiCtx => {
    if (!ctx) throw new Error('BroadcastUI.init(root) must be called first');
    return ctx;
  };

  const ui: BroadcastUI & BroadcastUIExtras = {
    init(root: HTMLElement) {
      const bx = el('div.bx');
      const layer = (name: string) => el(`div.bx-layer.l-${name}`);
      const layers = { hud: layer('hud'), gfx: layer('gfx'), touch: layer('touch'), screen: layer('screen'), over: layer('over'), top: layer('top') };
      bx.append(layers.hud, layers.gfx, layers.touch, layers.screen, layers.over, layers.top);
      root.append(bx);
      ctx = { input: deps.input, nav, sfx, root: bx, layers, mine: null };
      loading = new Loading(ctx);
      bc = new Broadcast(ctx);
      hud = new Hud(ctx);
      touch = new TouchControls(ctx);
      cinema = new Cinema(ctx);
      // Keep the device class current for hint glyphs.
      const setDev = (d: string) => (bx.dataset.device = d);
      setDev(deps.input.lastDevice);
      deps.input.onDevice(setDev);
    },

    loading: (p, label) => loading?.show(p, label),
    loaded: () => loading?.hide(),

    title: () => title(need()),
    mainMenu: (save) => {
      if (save.robot) need().mine = save.robot;
      return mainMenu(need(), save);
    },
    pickClass: (t) => pickClass(need(), t),
    exhibition: (rivals, hasRobot) => exhibition(need(), rivals, hasRobot),
    garage: (g) => garage(need(), g),
    bracket: (view, opp) => bracket(need(), view, opp),
    settings: (cur) => settings(need(), cur),
    credits: () => credits(need()),
    pause: (canTapOut) => pause(need(), canTapOut),

    slate: (t, sub, sec) => bc!.slate(t, sub, sec),
    bumper: () => bc!.bumper(),
    decision: (v) => bc!.decision(v),
    interview: (lines) => bc!.interview(lines),
    result: (r) => bc!.result(r),
    ceremony: (card, cls) => bc!.ceremony(card, cls),
    eliminated: (card, round) => bc!.eliminated(card, round),

    lowerThird: (info) => bc?.lowerThird(info),
    caption: (s, t) => bc?.caption(s, t),
    bug: (show) => bc?.bug(show),
    hud: (entrants) =>
      hud?.set(entrants, (es) => {
        bc!.names.clear();
        for (const e of es) bc!.names.set(e.id, { name: e.name, player: e.player, corner: e.corner });
      }),
    hudFrame: (w) => hud?.frame(w),
    banner: (k, t) => bc?.banner(k, t),
    replayFrame: (on) => bc?.replayFrame(on),
    touchControls: (o) => touch?.set(o),
    skippable: (on) => bc?.skippable(on),

    saves: (slots, seenIntro) => saves(need(), slots, seenIntro),
    workshop: (v) => workshop(need(), v),
    career: (v) => careerLadder(need(), v),
    rewards: (v) => rewards(need(), v),
    montage: (card) => cinema!.montage(card),
    story: (lines, sec) => cinema!.story(lines, sec),
    coach: (text, action) => cinema?.coach(text, action),

    debug: {
      get ctx() {
        return need();
      },
      forceTouch: (on) => touch?.force(on),
      reset: () => {
        const c = need();
        nav.clear();
        for (const l of [c.layers.screen, c.layers.over, c.layers.gfx]) l.replaceChildren();
        bc = new Broadcast(c);
        cinema?.clear();
        cinema = new Cinema(c);
      },
    },
  };
  return ui;
}
