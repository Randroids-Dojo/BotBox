// One fight, broadcast style: intros, the light tree, the fight with commentary and cinematic
// beats, the result, Bot Replay, the judges, the interview.

import type { BotCard, Corner, Entrant, MatchEvent, MatchResult, WorldFrame } from '../contract';
import { CLASS_LABEL, WEAPONS } from '../data/parts';
import { VOICED_NAMES, rivalById } from '../data/roster';
import { Match } from '../sim/match';
import { yawOf } from '../sim/math';
import { Commentary } from './commentary';
import type { Game } from './game';
import { interview } from './interview';
import { Recorder } from './replay';

export type RoundId = 'quarter' | 'semi' | 'final' | 'exhibition' | 'rumble';
const ROUND_LABEL: Record<RoundId, string> = {
  quarter: 'Quarterfinal',
  semi: 'Semifinal',
  final: 'The final',
  exhibition: 'Exhibition',
  rumble: 'Robot rumble',
};

export interface FightSetup {
  entrants: Entrant[];
  round: RoundId;
  length: number;
  playerId: string | null;
  /** Season stakes for the interview copy. */
  final?: boolean;
  championIfWon?: boolean;
}

export interface FightOutcome {
  result: MatchResult;
  playerWon: boolean;
  carried: Entrant['carried'];
  quit: boolean;
}

const CORNER_LINE: Record<Corner, string> = { red: 'vic.red', blue: 'vic.blue', green: 'vic.green', yellow: 'vic.yellow' };

export async function runFight(g: Game, setup: FightSetup): Promise<FightOutcome> {
  const { stage, audio, ui, input } = g;
  const simEntrants = g.autopilot ? setup.entrants.map((e) => ({ ...e, control: 'ai' as const, skill: e.control === 'player' ? 0.95 : e.skill })) : setup.entrants;
  const match = new Match(g.R, { entrants: simEntrants, length: setup.length, seed: (Math.random() * 1e9) | 0 });
  const rec = new Recorder();
  const booth = new Commentary(audio, ui, () => g.save.settings);
  const player = setup.playerId ? match.bot(setup.playerId) ?? null : null;
  const cls = setup.entrants[0].spec.loadout.cls;

  g.onCalm(false);
  stage.setScene('arena');
  stage.clearTransient();
  stage.setEntrants(setup.entrants.map((e) => ({ id: e.id, spec: e.spec, corner: e.corner, player: e.id === setup.playerId })));
  audio.setEntrants(setup.entrants.map((e) => ({ id: e.id, spec: e.spec })));
  audio.setWorldActive(true);
  stage.setCameraMode(g.save.settings.camera);
  g.applySettings();

  let world: WorldFrame = match.frame();
  let pending: MatchEvent[] = [];
  let simRunning = false;
  let quit = false;
  let paused = false;
  let slowUntil = 0;
  let cinematicUntil = 0;
  let lastCinematic = -99;
  let clock = 0;
  const lastBanner = new Map<string, number>();
  let lastAnyBanner = -99;

  // The frame loop for this fight: sim when running, always draw.
  g.setTick((dt) => {
    clock += dt;
    if (!paused) {
      if (simRunning) {
        if (player) {
          const cmd = input.command(stage.controlYaw(), yawOf(player.quat), player.inverted);
          match.setCommand(player.id, cmd);
        }
        // Slow motion beats ease back to full speed.
        if (clock < slowUntil) match.timeScale = 0.22;
        else match.timeScale = Math.min(1, match.timeScale + dt * 2.5);
        audio.setTimeScale(match.timeScale);
        match.advance(dt * g.speed);
      }
      const events = match.drainEvents();
      world = match.frame();
      if (simRunning) rec.push(world, events);
      for (const e of events) onEvent(e);
      booth.events(events, world, setup.playerId);
      booth.update(dt);
      pending = events;
    } else {
      pending = [];
    }
    if (clock > cinematicUntil && cinematicUntil > 0) {
      cinematicUntil = 0;
      stage.shot({ kind: 'live' });
    }
    stage.render(world, pending, dt);
    audio.frame(world, pending, stage.listener(), paused ? 0 : dt);
    ui.hudFrame(world);
  });

  const crowdFor = (sev: number) => g.crowd(Math.min(1, 0.45 + sev * 0.6));

  function onEvent(e: MatchEvent): void {
    switch (e.type) {
      case 'lights':
        audio.stinger(e.lights === 4 ? 'go' : 'lights');
        break;
      case 'hit':
        if (e.severity > 0.5) stage.shake(Math.min(1, e.severity));
        if (e.severity >= 0.78 && g.save.settings.cinematicHits && clock - lastCinematic > 6 && simRunning) {
          lastCinematic = clock;
          slowUntil = clock + 0.45;
          cinematicUntil = clock + 1.1;
          stage.shot({ kind: 'impact', point: e.point, bots: [e.victim, ...(e.attacker ? [e.attacker] : [])], duration: 1.1 });
        }
        crowdFor(e.severity);
        break;
      case 'flipped': {
        // Only call it when it matters: a robot that cannot drive upside down, once in a while.
        const b = match.bot(e.bot);
        if (b && !b.spec.invertible && clock - (lastBanner.get(`flip:${e.bot}`) ?? -99) > 10 && clock - lastAnyBanner > 4) {
          lastBanner.set(`flip:${e.bot}`, clock);
          lastAnyBanner = clock;
          ui.banner('flipped');
        }
        crowdFor(0.8);
        break;
      }
      case 'fire_start':
        if (clock - lastAnyBanner > 2) {
          lastAnyBanner = clock;
          ui.banner('fire');
        }
        crowdFor(0.9);
        break;
      case 'release':
        ui.banner('release');
        break;
      default:
        break;
    }
  }

  const unsubAction = input.onAction((a) => {
    if (a === 'camera' && simRunning) {
      const order = ['chase', 'broadcast', 'driver'] as const;
      const next = order[(order.indexOf(stage.getCameraMode()) + 1) % order.length];
      stage.setCameraMode(next);
      g.save.settings.camera = next;
      g.persist();
    }
    if (a === 'pause' && simRunning && !paused) void pauseMenu();
  });

  async function pauseMenu(): Promise<void> {
    paused = true;
    audio.setWorldActive(false);
    input.reset();
    ui.touchControls(null);
    for (;;) {
      const choice = await ui.pause(!!player && match.phase === 'fight');
      if (choice === 'settings') {
        g.save.settings = await ui.settings(g.save.settings);
        g.applySettings();
        g.persist();
        continue;
      }
      if (choice === 'tapout' && player) match.tapOut(player.id);
      if (choice === 'quit') quit = true;
      break;
    }
    paused = false;
    audio.setWorldActive(true);
    if (player && !quit) ui.touchControls(touchOpts());
  }

  const touchOpts = () => {
    if (!player) return null;
    const w = player.spec.weapon.kind;
    const label = w === 'none' ? 'RAM' : w === 'flipper' ? 'FLIP' : w === 'axe' ? 'AXE' : w === 'lifter' ? 'LIFT' : 'SPIN';
    return { weaponLabel: label, selfRight: player.spec.selfRight && !player.spec.invertible };
  };

  // ---------------------------------------------------------------- intro
  g.skipped = false;
  g.skipAll = false;
  ui.bug(true);
  audio.music('intro', 1.5);
  g.crowd(0.55);
  ui.skippable(true);
  const roundLabel = ROUND_LABEL[setup.round];
  stage.shot({ kind: 'flyover', duration: 6 });
  void g.say([`vic.round.${setup.round}`, `vic.class.${cls}`]);
  await g.wait(ui.slate(roundLabel.toUpperCase(), `${CLASS_LABEL[cls]} division`, 2.6));
  if (!g.skipped) {
    booth.speak('intro');
    await g.wait(2.8);
  }
  for (const e of setup.entrants) {
    if (g.skipAll) break;
    stage.shot({ kind: 'bot_intro', bot: e.id, duration: 7 });
    ui.lowerThird({
      corner: e.corner,
      card: e.card,
      stats: e.spec.stats,
      weaponShort: WEAPONS[e.spec.loadout.weapon].short,
      classLabel: CLASS_LABEL[cls],
    });
    await g.say([CORNER_LINE[e.corner], ...introLines(e)], 14);
    ui.lowerThird(null);
    await g.wait(0.35);
  }
  ui.skippable(false);
  g.skipAll = false;
  stage.shot({ kind: 'faceoff', duration: 3 });
  void g.say(['vic.ready']);
  await g.wait(1.6, false);
  stage.shot({ kind: 'lights', duration: 4 });
  ui.hud(setup.entrants.map((e) => ({ id: e.id, name: e.card.name, corner: e.corner, spec: e.spec, player: e.id === setup.playerId })));
  match.startCountdown();
  simRunning = true;
  g.crowd(0.75);
  // Wait for green.
  while (match.phase === 'countdown') await g.frame();
  void g.say([g.pickId('vic.go.')]);
  ui.banner('fight');
  stage.shot({ kind: 'live' });
  audio.music('fight', 1);
  // Hand the crowd back to the action.
  g.crowd(0.6);
  audio.crowd(0);
  booth.reset();
  if (player) ui.touchControls(touchOpts());

  // ---------------------------------------------------------------- fight
  while (match.phase === 'fight' && !quit) await g.frame();
  ui.touchControls(null);
  if (quit) {
    unsubAction();
    simRunning = false;
    ui.hud(null);
    ui.bug(false);
    audio.crowd(0);
    audio.setWorldActive(false);
    match.dispose();
    g.onCalm(true);
    return { result: match.result ?? fallbackResult(match), playerWon: false, carried: player?.carried(), quit: true };
  }

  // Let the end breathe: the robots keep coasting for a moment.
  const result = match.result!;
  booth.enabled = false;
  audio.stopVoice();
  ui.caption(null);
  if (result.method === 'decision') {
    audio.stinger('time');
    ui.banner('time');
    void g.say(['vic.time']);
  } else if (result.method === 'tapout') {
    audio.stinger('ko');
    ui.banner('tapout');
    void g.say(['vic.tapout']);
  } else {
    audio.stinger('ko');
    ui.banner('ko');
    void g.say([g.pickId('vic.ko.')]);
    const loser = setup.entrants.find((e) => e.id !== result.winner);
    if (loser) stage.shot({ kind: 'loser', bot: loser.id, duration: 3 });
  }
  g.crowd(1);
  await g.wait(3.2, false);
  simRunning = false;
  ui.hud(null);
  audio.music('none', 1);

  // ---------------------------------------------------------------- bot replay
  const moments = rec.best(3);
  if (moments.length) {
    ui.skippable(true);
    audio.stinger('replay');
    ui.replayFrame(true);
    for (const [i, h] of moments.entries()) {
      if (g.skipAll) break;
      stage.clearTransient();
      const start = h.t - 1.7;
      const end = h.t + 1.6;
      const rate = 0.4;
      let t = start;
      let prev = start - 1e-3;
      stage.shot({ kind: 'replay', point: h.point, bots: h.bots, duration: (end - start) / rate, seed: i * 7 + Math.floor(h.t) });
      g.setTick((dt) => {
        t = Math.min(end, t + dt * rate);
        const s = rec.at(t, prev);
        prev = t;
        if (!s) return;
        stage.render(s.frame, s.events, dt);
        audio.setTimeScale(rate);
        audio.frame(s.frame, s.events, stage.listener(), dt);
      });
      if (i === 0) booth.speak(Math.random() < 0.5 ? 'huge' : 'hit');
      while (t < end && !g.skipped) await g.frame();
      g.skipped = false;
    }
    ui.replayFrame(false);
    ui.skippable(false);
    g.skipAll = false;
    audio.setTimeScale(1);
    stage.clearTransient();
  }

  // Back to the live (frozen) arena for the decision.
  const final = match.frame();
  g.setTick((dt) => {
    stage.render(final, [], dt);
    audio.frame(final, [], stage.listener(), dt);
  });

  // ---------------------------------------------------------------- decision
  const winnerEntrant = setup.entrants.find((e) => e.id === result.winner) ?? null;
  if (result.method === 'decision' && result.judges && result.totals && setup.entrants.length === 2) {
    stage.shot({ kind: 'booth', duration: 8 });
    audio.music('intro', 1);
    await g.say(['vic.decision']);
    const decision = ui.decision({
      judges: result.judges,
      totals: result.totals,
      winner: result.winner!,
      entrants: setup.entrants.map((e) => ({ id: e.id, name: e.card.name, corner: e.corner })),
    });
    audio.stinger('decision');
    const w = result.totals[result.winner!];
    const l = Object.entries(result.totals).find(([id]) => id !== result.winner)?.[1] ?? 0;
    await g.say(['vic.byscore', `vic.num.${w}`, 'vic.to', `vic.num.${l}`, g.pickId('vic.winner.'), ...nameLines(winnerEntrant)]);
    await decision;
  } else if (winnerEntrant) {
    await g.say([g.pickId('vic.winner.'), ...nameLines(winnerEntrant)]);
  }

  const playerWon = !!setup.playerId && result.winner === setup.playerId;
  if (winnerEntrant) {
    stage.shot({ kind: 'winner', bot: winnerEntrant.id, duration: 7 });
    ui.banner('winner', winnerEntrant.card.name);
  }
  audio.music(setup.playerId ? (playerWon ? 'victory' : 'defeat') : 'victory', 0.5);
  g.crowd(playerWon || !setup.playerId ? 1 : 0.6);
  await g.wait(3.5);

  // ---------------------------------------------------------------- interview
  if (setup.playerId) {
    const me = setup.entrants.find((e) => e.id === setup.playerId)!;
    const them = setup.entrants.find((e) => e.id !== setup.playerId)!;
    void g.say([g.pickId(playerWon ? (setup.championIfWon ? 'jenna.champ.' : 'jenna.win.') : 'jenna.lose.')]);
    await ui.interview(
      interview({
        won: playerWon,
        result,
        me: { id: me.id, name: me.card.name, weapon: me.spec.loadout.weapon },
        them: them.card,
        final: !!setup.final,
        champion: playerWon && !!setup.championIfWon,
      }),
    );
    audio.stopVoice();
  }

  unsubAction();
  ui.bug(false);
  audio.crowd(0);
  audio.setWorldActive(false);
  const carried = player?.carried();
  match.dispose();
  g.save.fights++;
  g.persist();
  g.onCalm(true);
  return { result, playerWon, carried, quit: false };

  function introLines(e: Entrant): string[] {
    if (e.control === 'ai' || rivalById(e.id)) return [`vic.bot.${e.card.voiceId ?? e.id}`];
    return [g.pickId('vic.player.intro.'), ...nameLines(e)];
  }
}

/** Announcer lines for a robot's name. */
export function nameLines(e: { card: BotCard; id: string } | null): string[] {
  if (!e) return [];
  if (rivalById(e.id)) return [`vic.name.${e.card.voiceId ?? e.id}`];
  const voiced = VOICED_NAMES.find((n) => n.name.toLowerCase() === e.card.name.trim().toLowerCase());
  return [voiced ? `vic.player.${voiced.slug}` : 'vic.player.rookie'];
}

function fallbackResult(m: Match): MatchResult {
  return { winner: null, method: 'tapout', time: 0, stats: Object.fromEntries(m.bots.map((b) => [b.id, b.stats])) };
}
