// The first launch. The last seconds of a championship final, played for a taste and then taken
// away: Juggernaut breaks down under the player's hands, and Terminal Velocity hits it in the side
// and tears it apart. A montage of the fall on old film, November 1999 to March 2001, four losses
// four different ways. Then a storage unit, a box of scrap and the first rebuild.

import { COMPONENTS, FACETS, type BotCard, type DriveCommand, type Entrant, type Loadout, type MatchEvent } from '../contract';
import { ARENA_HALF } from '../data/arena';
import { FIGHTS, JUGGERNAUT_PRIME, NEMESIS, PLAYER_TEAM } from '../data/campaign';
import { CLASS_LABEL, WEAPONS } from '../data/parts';
import type { ShotRequest } from '../render/types';
import type { BotSim } from '../sim/bot';
import { Match } from '../sim/match';
import { yawOf } from '../sim/math';
import { buildSpec } from '../sim/spec';
import type { Damage, GarageCategory, MontageCard } from '../ui/types';
import { careerShop, newCareer, rivalSummary } from './career';
import { Commentary } from './commentary';
import { DeathClip, type DeathKind } from './deaths';
import type { Game } from './game';
import { PLAYER } from './season';

const IDLE: DriveCommand = { throttle: 0, turn: 0, weapon: false, weaponPressed: false, selfRight: false };

export const CHAMP_CARD: BotCard = {
  name: 'Juggernaut',
  team: PLAYER_TEAM.team,
  hometown: PLAYER_TEAM.hometown,
  builders: 'you and a crew of six',
  blurb: 'Three Giant Nuts. Going for four.',
  record: '31-0',
};

/** Terminal Velocity as the crowd knows it before the hit. */
const RIVAL_CARD: BotCard = {
  ...NEMESIS.card,
  blurb: 'Undefeated rookie. A titanium bar spinning at highway speed.',
  record: '18-0',
};

/** Every facet and part at one health fraction. */
export function wear(facets: number, parts = facets): Damage {
  return {
    facets: Object.fromEntries(FACETS.map((f) => [f, facets])) as Damage['facets'],
    parts: Object.fromEntries(COMPONENTS.map((p) => [p, parts])) as Damage['parts'],
  };
}

function face(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.atan2(-(b.x - a.x), -(b.z - a.z));
}

function apart(a: { pos: { x: number; z: number } }, b: { pos: { x: number; z: number } }): number {
  return Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
}

/** The garage turntable, with the guided rebuild's empty slots hidden. */
export function workshopPreview(g: Game, tier: 0 | 1 | 2 | 3) {
  return (l: Loadout, d?: Damage, missing?: GarageCategory[]) => {
    g.stage.setScene('garage');
    const hide = (missing ?? []).filter((m): m is 'drive' | 'power' | 'armor' | 'weapon' => m === 'drive' || m === 'power' || m === 'armor' || m === 'weapon');
    g.stage.garage(buildSpec(l), d, { tier, missing: hide });
  };
}

// -------------------------------------------------------------------------------- the final

/** The playable final and the takeover. Leaves the burning arena on screen (the tick keeps
 *  running) and returns a function that tears the match down. */
async function theFinal(g: Game): Promise<() => void> {
  const { stage, audio, ui, input } = g;
  const auto = g.autopilot;
  const pAt = { x: -1.9, z: 1.3 };
  const nAt = { x: 1.7, z: -0.9 };
  const entrants: Entrant[] = [
    { id: PLAYER, corner: 'red', spec: buildSpec(JUGGERNAUT_PRIME), card: CHAMP_CARD, control: auto ? 'ai' : 'player', skill: 1, carried: wear(0.74, 0.88) },
    { id: NEMESIS.id, corner: 'blue', spec: buildSpec(NEMESIS.loadout), card: NEMESIS.card, control: 'ai', skill: NEMESIS.skill, carried: wear(0.82, 0.95) },
  ];
  const match = new Match(g.R, {
    entrants,
    length: 45,
    seed: 7,
    positions: { [PLAYER]: { ...pAt, yaw: face(pAt, nAt) }, [NEMESIS.id]: { ...nAt, yaw: face(nAt, pAt) + 1.1 } },
  });
  // A floor trap must not decide this fight: the script owns it.
  match.hazardsOn = false;
  match.setAiScript(NEMESIS.id, 'passive');
  if (auto) match.setAiScript(PLAYER, 'charge');
  const me = match.bot(PLAYER)!;
  const tv = match.bot(NEMESIS.id)!;
  g.current = match;
  // Scripted lines only, but Vic still counts the knockout.
  const booth = new Commentary(audio, ui, () => g.save.settings);
  booth.enabled = false;
  booth.hold = () => g.saying;

  /** A beat that lasts at least `sec`, longer if its voice line runs over. */
  const atLeast = (sec: number, p: Promise<unknown>) => Promise.all([p, g.wait(sec, false)]);

  g.onCalm(false);
  stage.setDressing('championship');
  stage.setScene('arena');
  stage.clearTransient();
  stage.setEntrants(entrants.map((e) => ({ id: e.id, spec: e.spec, corner: e.corner, player: e.id === PLAYER })));
  audio.setEntrants(entrants.map((e) => ({ id: e.id, spec: e.spec })));
  audio.setWorldActive(true);
  stage.setCameraMode(g.save.settings.camera);
  g.applySettings();

  let running = false;
  let control = false;
  let downed = false;
  let clock = 0;
  let slowUntil = 0;
  let slowScale = 1;
  let easeRate = 2.5;
  let moveT = 0;
  let flippedT = 0;
  let hits = 0;
  let lastHitT = -99;
  let struck = -99;
  let broken = false;

  const onEvent = (e: MatchEvent) => {
    if (e.type !== 'hit') return;
    if (e.severity > 0.5) stage.shake(Math.min(1, e.severity));
    g.crowd(Math.min(1, 0.65 + e.severity * 0.5));
    if (e.attacker === PLAYER && e.victim === NEMESIS.id && e.severity >= 0.15 && clock - lastHitT > 0.6) {
      hits++;
      lastHitT = clock;
    }
    if (e.attacker === NEMESIS.id && e.victim === PLAYER) struck = clock;
  };

  g.setTick((dt) => {
    clock += dt;
    if (running) {
      flippedT = me.helpless && !downed ? flippedT + dt : 0;
      if (!auto) {
        const cmd = control ? input.command(stage.controlYaw(), yawOf(me.quat), me.inverted) : { ...IDLE };
        // The champion's crew hits the srimech for you if you have not found the button yet.
        if (flippedT > 2.2) cmd.selfRight = true;
        // Broken down: the disk will not spin up again.
        if (broken) {
          cmd.weapon = false;
          cmd.weaponPressed = false;
        }
        match.setCommand(PLAYER, cmd);
      }
      if (control && (Math.abs(me.cmd.throttle) > 0.3 || Math.abs(me.cmd.turn) > 0.5)) moveT += dt;
      if (clock < slowUntil) match.timeScale = slowScale;
      else match.timeScale = Math.min(1, match.timeScale + dt * easeRate);
      audio.setTimeScale(match.timeScale);
      // Nobody gets counted out: the script ends this fight, not the ten count.
      for (const b of [me, tv]) {
        b.koCount = null;
        b.immobileTime = 0;
        b.stuckTime = 0;
      }
      // A cinematic runs in real time, whatever the test speed-up says.
      match.advance(dt);
    }
    const events = match.drainEvents();
    const world = match.frame();
    for (const e of events) onEvent(e);
    booth.events(events, world, PLAYER);
    booth.update(dt);
    stage.render(world, events, dt);
    audio.frame(world, events, stage.listener(), dt);
    ui.hudFrame(world);
    showMarks();
  });

  // Floating labels over the robots while the player is learning who is who.
  let marks: { id: string; label: string; tone: 'you' | 'target'; bot: typeof me }[] = [];
  let markShown = false;
  const showMarks = () => {
    if (!marks.length) {
      if (markShown) ui.markers([]);
      markShown = false;
      return;
    }
    markShown = true;
    ui.markers(marks.map((m) => ({ id: m.id, label: m.label, tone: m.tone, ...stage.project({ x: m.bot.pos.x, y: m.bot.pos.y + 0.75, z: m.bot.pos.z }) })));
  };
  const cutscene = (on: boolean) => {
    ui.letterbox(on);
    if (on) {
      ui.coach(null);
      ui.touchControls(null);
      ui.hud(null);
      marks = [];
    }
  };
  const hud = () => ui.hud(entrants.map((e) => ({ id: e.id, name: e.card.name, corner: e.corner, spec: e.spec, player: e.id === PLAYER })));
  const l3 = (e: Entrant, card: BotCard) =>
    ui.lowerThird({ corner: e.corner, card, stats: e.spec.stats, weaponShort: WEAPONS[e.spec.loadout.weapon].short, classLabel: CLASS_LABEL.heavy });

  // ---- open: who is who, and what is at stake
  g.skipped = false;
  g.skipAll = false;
  ui.bug(true);
  audio.music('prologue', 0.4);
  g.crowd(1);
  cutscene(true);
  g.setSkippable(true);
  stage.shot({ kind: 'flyover', duration: 4.5 });
  const open = g.say(['vic.pro.open']);
  await g.wait(ui.slate('CHAMPIONSHIP FINAL', '45 seconds left', 3.6));
  if (!g.skipAll) {
    stage.shot({ kind: 'bot_intro', bot: PLAYER, duration: 4 });
    l3(entrants[0], CHAMP_CARD);
    await g.wait(3.6);
    ui.lowerThird(null);
  }
  if (!g.skipAll) {
    await g.wait(open);
    stage.shot({ kind: 'bot_intro', bot: NEMESIS.id, duration: 4 });
    l3(entrants[1], RIVAL_CARD);
    await g.wait(Promise.all([g.say(['vic.name.terminal-velocity']), g.wait(3.2)]));
    ui.lowerThird(null);
  }
  g.setSkippable(false);
  g.skipAll = false;
  ui.caption(null);

  // ---- the taste: the champion in full flight, at the player's pace
  cutscene(false);
  hud();
  stage.shot({ kind: 'live' });
  match.startFight();
  running = true;
  control = true;
  ui.banner('fight');
  if (!auto) ui.touchControls({ weaponLabel: 'SPIN', selfRight: true });
  marks = [
    { id: 'you', label: 'You', tone: 'you', bot: me },
    { id: 'tv', label: 'Terminal Velocity', tone: 'target', bot: tv },
  ];
  const steps = [
    { text: 'Drive at Terminal Velocity', action: 'drive' as const },
    { text: 'Spin up your disk', action: 'weapon' as const },
    { text: 'Hit it! 3 hits to go', action: undefined },
  ];
  let step = 0;
  let stepAt = clock;
  const setStep = (n: number) => {
    step = n;
    stepAt = clock;
    const st = steps[Math.min(n, steps.length - 1)];
    ui.coach(st.text, st.action);
  };
  setStep(0);
  const tasteStart = clock;
  let counted = 0;
  let righting = false;
  let doneAt = -1;
  for (;;) {
    await g.frame();
    const t = clock - tasteStart;
    const inStep = clock - stepAt;
    if (clock - tasteStart > 4 && marks.length === 2) marks = marks.filter((m) => m.id !== 'you');
    // Flipped: say how to get back up, then carry on where the coaching left off.
    if (flippedT > 0.4 && !righting) {
      righting = true;
      ui.coach('Flipped! Self-right', 'selfRight');
    } else if (righting && flippedT === 0) {
      righting = false;
      setStep(step);
    }
    // Still stuck after the crew's srimech (wedged on its side): set it back on its wheels. The
    // script must never wait on a robot that cannot get up.
    if (flippedT > 6) upright(me);
    if (righting) continue;
    if (step === 0 && inStep > 2 && (apart(me, tv) < 2.4 || inStep > 7 || auto)) setStep(1);
    else if (step === 1 && inStep > 1.2 && (me.armed || inStep > 6)) {
      // A champion never forgets to arm the weapon.
      if (!me.armed) me.armed = true;
      setStep(2);
    }
    // Hits land big: the champion is in control, and the crowd and the booth say so.
    if (step === 2 && hits > counted) {
      counted = hits;
      const d = { x: tv.pos.x - me.pos.x, z: tv.pos.z - me.pos.z };
      const n = Math.hypot(d.x, d.z) || 1;
      const m = tv.spec.massKg;
      tv.body.applyImpulse({ x: (d.x / n) * m * 2.4, y: m * 1.4, z: (d.z / n) * m * 2.4 }, true);
      stage.shake(0.5);
      g.crowd(1);
      // Three reactions at most, so the last one is done before the cutscene starts.
      if (!g.saying && counted <= 3) void g.say([g.pickId(counted % 2 ? 'chuck.pro.taste.' : 'dale.pro.taste.')], 30, 1.5);
      if (counted === 3) {
        ui.coach('That is the champ! Keep going');
        doneAt = clock;
      } else if (counted < 3) ui.coach(counted === 2 ? 'One more!' : 'Again! 2 hits to go');
    }
    // At least a dozen seconds at the sticks, then it breaks (never while upside down).
    const finished = (doneAt > 0 && clock - doneAt > 1.4 && t > 12) || t > 24 || match.phase !== 'fight';
    if (finished && !me.helpless) break;
  }

  // ---- the breakdown: the left drive burns out with the player still at the sticks. It can
  // only turn in circles, and the disk spins down and will not come back.
  broken = true;
  me.damagePart('driveL', 1e6, null);
  me.armed = false;
  if (auto) match.setAiScript(PLAYER, 'passive');
  stage.shake(0.35);
  g.crowd(0.55);
  ui.coach('Your left drive just died!');
  await g.say(['dale.pro.break.1']);
  const circles = g.say(['chuck.pro.break.1']);
  await g.wait(1.6, false);

  // ---- the turn: bars drop, the right side quits too, and the champion sits dead in the water
  control = false;
  cutscene(true);
  // The clock stops with the bars down: the cutscene cannot run the final out of time.
  match.clockHeld = true;
  match.setAiScript(PLAYER, 'idle');
  // The hit is staged on its wheels: a robot on its back is set right under the cut.
  if (me.helpless) upright(me);
  stage.shot({ kind: 'loser', bot: PLAYER, duration: 5 });
  await g.wait(0.7, false);
  me.damagePart('driveR', 1e6, null);
  stage.shake(0.2);
  await g.wait(circles, false);

  // Terminal Velocity lines up on the champion's side (the dead left one if there is room).
  const flank = (side: 1 | -1, d: number) => {
    const y = yawOf(me.quat);
    return { x: me.pos.x - Math.cos(y) * side * d, z: me.pos.z + Math.sin(y) * side * d };
  };
  const room = (p: { x: number; z: number }) => ARENA_HALF - Math.max(Math.abs(p.x), Math.abs(p.z));
  const side: 1 | -1 = room(flank(1, 2.8)) >= 1.2 || room(flank(1, 2.8)) >= room(flank(-1, 2.8)) ? 1 : -1;
  const place = (d: number) => {
    const p = flank(side, d);
    const lim = ARENA_HALF - 0.9;
    const at = { x: Math.max(-lim, Math.min(lim, p.x)), z: Math.max(-lim, Math.min(lim, p.z)) };
    tv.body.setTranslation({ x: at.x, y: Math.max(tv.pos.y, 0.05) + 0.03, z: at.z }, true);
    tv.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    tv.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    const y = face(at, me.pos);
    tv.body.setRotation({ x: 0, y: Math.sin(y / 2), z: 0, w: Math.cos(y / 2) }, true);
  };
  place(2.8);
  match.setAiScript(NEMESIS.id, 'windup');
  // Behind Terminal Velocity, looking at the champion's flank as the bar comes up to speed.
  stage.shot({ kind: 'attack', bot: NEMESIS.id, target: PLAYER, duration: 7 });
  g.crowd(0.75);
  await g.say(['dale.pro.side.1']);
  const windAt = clock;
  while (tv.spin01 < 0.9 && clock - windAt < 1.5) await g.frame();
  tv.omega = Math.max(tv.omega, tv.omegaMax * 0.95);
  // It charges as Chuck sees it coming, so the hit lands as his line ends.
  const warn = g.say(['chuck.pro.side.1']);
  await g.wait(Math.max(0.6, (audio.voiceLine('chuck.pro.side.1')?.dur ?? 3.6) - 1.4), false);
  const charge = async (limit: number) => {
    match.setAiScript(NEMESIS.id, 'charge');
    const from = clock;
    while (struck < from && apart(me, tv) > 1.05 && clock - from < limit) await g.frame();
    return struck >= from || apart(me, tv) <= 1.05;
  };
  if (!(await charge(3))) {
    // Stuck somewhere: cut away and line it up again closer. The cut hides it.
    stage.shot({ kind: 'loser', bot: PLAYER, duration: 1 });
    await g.frame();
    place(1.6);
    stage.shot({ kind: 'attack', bot: NEMESIS.id, target: PLAYER, duration: 3 });
    await charge(3);
  }

  // ---- the hit: square in the flank. Wheels, armor and the disk come off, and it rolls over.
  match.finisher(NEMESIS.id, PLAYER, 'broadside', { kill: true, tear: true, power: 0.82 });
  downed = true;
  match.setAiScript(NEMESIS.id, 'passive');
  slowScale = 0.12;
  slowUntil = clock + 1.8;
  easeRate = 0.45;
  stage.shake(1);
  stage.shot({ kind: 'follow', bot: PLAYER, from: NEMESIS.id, duration: 5 });
  audio.stinger('heartbreak');
  g.crowd(1);
  await warn;
  void g.say(['chuck.pro.hit.1'], 30, 3);
  const flight = clock;
  while ((me.airborne || clock - flight < 2.6) && clock - flight < 5.5) await g.frame();

  // ---- the wreck, and a new champion
  stage.shot({ kind: 'loser', bot: PLAYER, duration: 7 });
  g.crowd(0.4);
  await g.say(['dale.pro.hit.1'], 30, 6);
  await g.quiet(3);
  match.forceKo(PLAYER);
  audio.stinger('ko');
  ui.banner('ko');
  g.crowd(1);
  await atLeast(2.8, g.say(['vic.pro.ko.1']));
  stage.shot({ kind: 'winner', bot: NEMESIS.id, duration: 10 });
  const crowned = g.say(['vic.pro.ko.2']);
  // The banner lands with the name, at the end of the line.
  await g.wait(Math.max(0.5, (audio.voiceLine('vic.pro.ko.2')?.dur ?? 6) - 3), false);
  ui.banner('winner', NEMESIS.card.name);
  // Long enough for the banner to clear before the film rolls.
  await g.wait(Promise.all([crowned, g.wait(3.8, false)]));
  ui.bug(false);
  stage.shot({ kind: 'loser', bot: PLAYER, duration: 8 });

  return () => {
    const last = match.frame();
    g.setTick((dt) => stage.render(last, [], dt));
    match.dispose();
  };
}

/** Back on its wheels, facing the way it was (a scripted reset hidden by a cut). */
function upright(b: BotSim): void {
  const yaw = yawOf(b.quat);
  b.body.setTranslation({ x: b.pos.x, y: b.pos.y + 0.25, z: b.pos.z }, true);
  b.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
  b.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

// -------------------------------------------------------------------------------- the fall

/** Camera for each montage death: the opening framing, the moment it lands, and the wreck. */
const DEATH_SHOTS: Record<DeathKind, { open: (c: DeathClip) => ShotRequest; hit?: (c: DeathClip) => ShotRequest; after?: (c: DeathClip) => ShotRequest }> = {
  // Over Juggernaut's shoulder as Flapjack comes in, side on as it goes up and over, then close
  // on it lying on its back, wheels spinning, the srimech falling back.
  turtle: {
    open: () => ({ kind: 'faceoff', duration: 2 }),
    hit: (c) => ({ kind: 'follow', bot: JUG, from: c.foeId, duration: 2 }),
    after: () => ({ kind: 'loser', bot: JUG, duration: 4 }),
  },
  // Circling the shove across the saw slots.
  saws: {
    open: (c) => ({ kind: 'replay', point: mid(c), bots: [JUG, c.foeId], duration: 6, seed: 1 }),
  },
  // Side on, low, so the axe's arc reads; then straight down on the hole in the lid.
  axe: {
    open: (c) => ({ kind: 'impact', point: c.jug.pos, bots: [JUG, c.foeId], duration: 3 }),
    after: (c) => ({ kind: 'replay', point: c.jug.pos, bots: [JUG], duration: 4, seed: 3 }),
  },
  // A long lens through the Lexan as Trash Panda comes, low across the ram into the spikes, then
  // close on the fire.
  fire: {
    open: (c) => ({ kind: 'replay', point: mid(c), bots: [JUG, c.foeId], duration: 3, seed: 2 }),
    hit: (c) => ({ kind: 'replay', point: c.jug.pos, bots: [JUG, c.foeId], duration: 2, seed: 0 }),
    after: () => ({ kind: 'loser', bot: JUG, duration: 4 }),
  },
};

const JUG = 'juggernaut';

function mid(c: DeathClip): { x: number; y: number; z: number } {
  return { x: (c.jug.pos.x + c.foe.pos.x) / 2, y: 0.2, z: (c.jug.pos.z + c.foe.pos.z) / 2 };
}

/** One loss from the decline, a few seconds long, each a different way to go down. */
async function clip(g: Game, kind: DeathKind, mine: Loadout, foeId: string, sec: number, carried: Damage, dressing: 'normal' | 'qualifier' = 'normal'): Promise<void> {
  const { stage, audio } = g;
  const c = new DeathClip(g.R, kind, mine, foeId, carried, CHAMP_CARD);
  const shots = DEATH_SHOTS[kind];
  stage.setDressing(dressing);
  stage.setScene('arena');
  stage.clearTransient();
  stage.setEntrants(c.entrants.map((e) => ({ id: e.id, spec: e.spec, corner: e.corner, player: false })));
  audio.setEntrants(c.entrants.map((e) => ({ id: e.id, spec: e.spec })));
  audio.setWorldActive(true);
  stage.shot(shots.open(c));
  g.setTick((dt) => {
    const { events, cue } = c.tick(dt);
    if (cue === 'hit') {
      stage.shake(0.8);
      g.crowd(0.9);
      if (shots.hit) stage.shot(shots.hit(c));
    } else if (cue === 'after' && shots.after) stage.shot(shots.after(c));
    audio.setTimeScale(c.match.timeScale);
    const world = c.match.frame();
    stage.render(world, events, dt);
    audio.frame(world, events, stage.listener(), dt);
  });
  await g.wait(sec);
  // Freeze on the last frame before the match goes away.
  const last = c.match.frame();
  g.setTick((dt) => stage.render(last, [], dt));
  await g.frame();
  c.dispose();
  audio.setTimeScale(1);
}

function garageBeat(g: Game, l: Loadout, d: Damage, tier: 0 | 1 | 2 | 3, missing: ('drive' | 'power' | 'armor' | 'weapon')[] = []): void {
  g.setTick(null);
  g.audio.setWorldActive(false);
  g.stage.setScene('garage');
  g.stage.garage(buildSpec(l), d, { tier, missing });
}

type Month = { month: number; year: number };
const when = (month: number, year: number): Month => ({ month, year });

/** The decline on old film, a date rolling forward on the top bar: four losses, each a different
 *  way to go down, the rankings sliding, the sponsors and the disk gone. */
async function theFall(g: Game, teardown: () => void): Promise<void> {
  const { ui, audio, stage } = g;
  g.skipped = false;
  g.skipAll = false;
  g.setSkippable(true);
  audio.music('montage', 2.5);
  ui.letterbox(true);
  stage.setFilm(true);
  const tired: Loadout = { ...JUGGERNAUT_PRIME, armor: { material: 'steel', grade: 1 }, paint: { ...JUGGERNAUT_PRIME.paint, finish: 'matte' } };
  const worn: Loadout = { ...tired, drive: 'drill2', power: 'sla', extras: ['srimech'], paint: { ...tired.paint, decal: 'JUG' } };
  // Each beat lasts as long as its line: nobody gets cut off by the next headline.
  const beat = async (date: Month, card: MontageCard, voice: string | null, scene?: () => Promise<void>) => {
    if (g.skipAll) return;
    ui.montageDate(date);
    const dur = voice ? (g.audio.voiceLine(voice)?.dur ?? 0) : 0;
    const said = voice ? g.say([voice], 30, 2) : Promise.resolve();
    await g.wait(Promise.all([ui.montage({ ...card, sec: Math.max(card.sec, dur + 0.5) }), scene?.(), said]));
  };

  // The wreck, still smoking.
  await beat(when(11, 1999), { kind: 'headline', title: 'THE CHAMPION FALLS', sub: 'One hit from Terminal Velocity ends a three year reign.', sec: 4.2 }, 'chuck.fall.2');
  teardown();
  await beat(
    when(3, 2000),
    { kind: 'result', title: 'Spring season. Round one.', result: { opponent: 'Flapjack', method: 'Flipped. Never got back up.' }, sec: 5 },
    'jenna.fall.1',
    () => clip(g, 'turtle', tired, 'flapjack', 4.8, wear(0.8)),
  );
  if (!g.skipAll) garageBeat(g, tired, wear(0.45, 0.6), 2);
  await beat(when(4, 2000), { kind: 'rank', title: 'Juggernaut', rank: { from: 1, to: 3 }, sec: 2.6 }, 'dale.fall.2');
  await beat(when(5, 2000), { kind: 'headline', title: 'SPONSORS PULL OUT', sub: 'Team Juggernaut loses its backing.', sec: 3.4 }, 'jenna.fall.2');
  await beat(
    when(8, 2000),
    { kind: 'result', title: 'Fall season. Round one, again.', result: { opponent: 'Snowplow', method: 'Shoved into the killsaws' }, sec: 5 },
    'dale.fall.1',
    () => clip(g, 'saws', worn, 'snowplow', 4.8, wear(0.7)),
  );
  if (!g.skipAll) garageBeat(g, worn, wear(0.35, 0.5), 1);
  await beat(when(9, 2000), { kind: 'rank', title: 'Juggernaut', rank: { from: 3, to: 11 }, sec: 2.4 }, 'chuck.fall.1');
  await beat(
    when(11, 2000),
    { kind: 'result', title: 'Regionals.', result: { opponent: 'Chop Suey', method: 'Axed through the lid' }, sec: 4.6 },
    'dale.fall.3',
    () => clip(g, 'axe', worn, 'chop-suey', 4.4, wear(0.6)),
  );
  if (!g.skipAll) garageBeat(g, worn, wear(0.3, 0.45), 1);
  await beat(when(12, 2000), { kind: 'rank', title: 'Juggernaut', rank: { from: 11, to: 38 }, sec: 2.4 }, 'chuck.fall.3');
  await beat(
    when(1, 2001),
    { kind: 'result', title: 'Tuesday night. The garage league.', result: { opponent: 'Trash Panda', method: 'Caught fire. Tapped out.' }, sec: 5 },
    'jenna.fall.5',
    () => clip(g, 'fire', worn, 'trash-panda', 4.8, wear(0.55), 'qualifier'),
  );
  if (!g.skipAll) garageBeat(g, { ...worn, weapon: 'none' }, wear(0.3, 0.45), 0, ['weapon']);
  await beat(when(2, 2001), { kind: 'headline', title: 'THE DISK IS SOLD', sub: 'Juggernaut parts with its weapon to pay the bills.', sec: 3.6 }, 'jenna.fall.4');
  await beat(when(3, 2001), { kind: 'rank', title: 'Juggernaut', rank: { from: 38, to: null }, sec: 2.8 }, 'jenna.fall.3');
  await g.quiet(5);
  ui.caption(null);
  ui.montageDate(null);
  stage.setFilm(false);
  g.setSkippable(false);
  g.skipAll = false;
  g.setTick(null);
  g.audio.setWorldActive(false);
  g.stage.setDressing('normal');
}

// -------------------------------------------------------------------------------- the climb begins

/** The storage unit: the scrap on the turntable, and the guided first rebuild. */
export async function firstRebuild(g: Game): Promise<void> {
  const { stage, audio, ui } = g;
  const c = g.save.career!;
  g.setTick(null);
  stage.setScene('garage');
  stage.garage(buildSpec(c.loadout), undefined, { tier: 0, missing: ['drive', 'power', 'armor'] });
  audio.music('workshop', 2);
  ui.coach('This is what is left of Juggernaut. Put it back together.');
  await g.wait(3.6);
  ui.coach(null);
  const res = await ui.garage({
    mode: 'career',
    career: careerShop(c, () => g.persist()),
    guided: ['drive', 'power', 'armor', 'name'],
    loadout: c.loadout,
    classLocked: true,
    opponent: rivalSummary(FIGHTS[0].opponent, FIGHTS[0].rankAfter),
    preview: workshopPreview(g, 0),
    orbit: (dx, dy) => stage.orbit(dx, dy),
  });
  if (res) {
    c.loadout = res.loadout;
    if (res.funds !== undefined) c.funds = res.funds;
  }
  c.rebuilt = true;
  g.persist();
}

/** First launch: the final, the fall, two seasons later, the rebuild. */
/** A new game for someone who has seen the opening: straight to the storage unit. */
export async function skipToStorage(g: Game): Promise<void> {
  g.save.career!.prologueDone = true;
  g.persist();
  g.stage.setScene('title');
  g.audio.music('none', 1);
  await g.ui.story(['Juggernaut lost the final. Then it lost everything else.', 'Spring 2001.', 'A rented storage unit in Oakland.'], 6.5);
}

export async function prologue(g: Game): Promise<void> {
  if (!g.save.career) g.save.career = newCareer();
  const teardown = g.jumpToFall ? () => g.stage.setScene('arena') : await theFinal(g);
  await theFall(g, teardown);
  g.save.career.prologueDone = true;
  g.save.seenIntro = true;
  g.persist();
  g.audio.music('none', 4);
  g.ui.letterbox(false);
  await g.ui.story(['Spring 2001.', 'A rented storage unit in Oakland.'], 5);
  await firstRebuild(g);
}
