// The first launch. The last seconds of a championship final, played for a taste and then taken
// away: Terminal Velocity winds up, launches Juggernaut and ends its reign. A montage of the
// fall, two seasons in a few beats. Then a storage unit, a box of scrap and the first rebuild.

import { COMPONENTS, FACETS, type BotCard, type DriveCommand, type Entrant, type Loadout, type MatchEvent } from '../contract';
import { FIGHTS, JUGGERNAUT_PRIME, NEMESIS, PLAYER_TEAM, careerRivalById } from '../data/campaign';
import { CLASS_LABEL, WEAPONS } from '../data/parts';
import { Match } from '../sim/match';
import { yawOf } from '../sim/math';
import { buildSpec } from '../sim/spec';
import type { Damage, GarageCategory, MontageCard } from '../ui/types';
import { careerShop, newCareer, rivalSummary } from './career';
import { Commentary } from './commentary';
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
        match.setCommand(PLAYER, cmd);
      }
      if (control && (Math.abs(me.cmd.throttle) > 0.3 || Math.abs(me.cmd.turn) > 0.5)) moveT += dt;
      if (clock < slowUntil) match.timeScale = slowScale;
      else match.timeScale = Math.min(1, match.timeScale + dt * easeRate);
      audio.setTimeScale(match.timeScale);
      // Nobody gets counted out by accident (robots shoving nose to nose read as stuck to
      // the rules). Terminal Velocity never is; Juggernaut only once it has been hit.
      for (const b of downed ? [tv] : [me, tv]) {
        b.koCount = null;
        b.immobileTime = 0;
        b.stuckTime = 0;
      }
      match.advance(dt * g.speed);
    }
    const events = match.drainEvents();
    const world = match.frame();
    for (const e of events) onEvent(e);
    booth.events(events, world, PLAYER);
    booth.update(dt);
    stage.render(world, events, dt);
    audio.frame(world, events, stage.listener(), dt);
    ui.hudFrame(world);
  });

  // ---- open: the final, forty-five seconds left
  g.skipped = false;
  g.skipAll = false;
  ui.bug(true);
  audio.music('prologue', 0.4);
  g.crowd(1);
  ui.hud(entrants.map((e) => ({ id: e.id, name: e.card.name, corner: e.corner, spec: e.spec, player: e.id === PLAYER })));
  g.setSkippable(true);
  stage.shot({ kind: 'flyover', duration: 5 });
  void g.say(['vic.pro.open'], 9);
  await g.wait(ui.slate('THE FINAL', '45 seconds left. Juggernaut is going for four.', 3.4));
  if (!g.skipAll) {
    stage.shot({ kind: 'bot_intro', bot: PLAYER, duration: 3.4 });
    ui.lowerThird({ corner: 'red', card: CHAMP_CARD, stats: entrants[0].spec.stats, weaponShort: WEAPONS.vdisk.short, classLabel: CLASS_LABEL.heavy });
    await g.wait(2.8);
    ui.lowerThird(null);
  }
  g.setSkippable(false);
  g.skipAll = false;

  // ---- the taste: the champion in full flight
  stage.shot({ kind: 'live' });
  match.startFight();
  running = true;
  control = true;
  ui.banner('fight');
  if (!auto) ui.touchControls({ weaponLabel: 'SPIN', selfRight: true });
  ui.coach('Drive at Terminal Velocity', 'drive');
  const tasteStart = clock;
  let step = 0;
  let said = 0;
  let righting = false;
  for (;;) {
    await g.frame();
    const t = clock - tasteStart;
    // Flipped: say how to get back up, then carry on where the coaching left off.
    if (flippedT > 0.4 && !righting) {
      righting = true;
      ui.coach('Flipped! Self-right', 'selfRight');
    } else if (righting && flippedT === 0) {
      righting = false;
      ui.coach(step === 0 ? 'Drive at Terminal Velocity' : step === 1 ? 'Spin up the disk' : 'Hit it!', step === 0 ? 'drive' : step === 1 ? 'weapon' : undefined);
    }
    if (righting) continue;
    if (step === 0 && (moveT > 0.7 || t > 5 || auto)) {
      step = 1;
      ui.coach('Spin up the disk', 'weapon');
    }
    if (step === 1 && (me.armed || t > 9)) {
      // A champion never forgets to arm the weapon.
      if (!me.armed) me.armed = true;
      step = 2;
      ui.coach('Hit it!');
    }
    if (hits > said || (said === 0 && t > 7)) {
      said = Math.max(said + 1, hits);
      if (!g.saying) void g.say([g.pickId(said % 2 ? 'chuck.pro.taste.' : 'dale.pro.taste.')], 30, 1.5);
      if (step === 2) ui.coach(hits === 1 ? 'Again!' : null);
    }
    // Never take control away while the robot is upside down.
    if (((hits >= 2 && clock - lastHitT > 0.8) || t > 17 || match.phase !== 'fight') && !me.helpless) break;
  }

  // ---- the turn: control is gone, Terminal Velocity winds all the way up
  control = false;
  ui.coach(null);
  ui.touchControls(null);
  if (auto) match.setAiScript(PLAYER, 'passive');
  match.setAiScript(NEMESIS.id, 'windup');
  stage.shot({ kind: 'bot_intro', bot: NEMESIS.id, duration: 3.4 });
  g.crowd(0.9);
  const turnLine = g.say([g.pickId(Math.random() < 0.5 ? 'chuck.pro.turn.' : 'dale.pro.turn.')], 30, 2);
  const turnStart = clock;
  // Wind up until the bar is screaming and the booth has said so.
  let turnDone = false;
  void turnLine.then(() => (turnDone = true));
  while ((tv.spin01 < 0.9 || clock - turnStart < 2.2 || !turnDone) && clock - turnStart < 5) await g.frame();
  tv.omega = Math.max(tv.omega, tv.omegaMax * 0.95);

  // ---- the charge. It has to really connect: the hit only lands on contact.
  const charge = async (limit: number) => {
    match.setAiScript(NEMESIS.id, 'charge');
    stage.shot({ kind: 'faceoff', duration: 2.6 });
    const from = clock;
    while (struck < from && apart(me, tv) > 1.05 && clock - from < limit) await g.frame();
    return struck >= from || apart(me, tv) <= 1.05;
  };
  if (!(await charge(5))) {
    // Stuck somewhere: cut away and line Terminal Velocity up for another run. The cut hides it.
    stage.shot({ kind: 'loser', bot: PLAYER, duration: 1 });
    await g.frame();
    const back = { x: me.pos.x - Math.sign(me.pos.x || 1) * 1.8, z: me.pos.z - Math.sign(me.pos.z || 1) * 0.4 };
    tv.body.setTranslation({ x: back.x, y: tv.pos.y + 0.05, z: back.z }, true);
    tv.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    tv.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    const yaw = face(back, me.pos);
    tv.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    await charge(4);
  }

  // ---- the hit
  match.finisher(NEMESIS.id, PLAYER, 'launch', { fire: true, kill: true });
  downed = true;
  match.setAiScript(NEMESIS.id, 'passive');
  slowScale = 0.14;
  slowUntil = clock + 1.6;
  easeRate = 0.45;
  stage.shake(1);
  stage.shot({ kind: 'replay', point: me.pos, bots: [PLAYER], duration: 4.2, seed: 0 });
  audio.stinger('heartbreak');
  g.crowd(1);
  await g.wait(1.0, false);
  // One line of shock; Vic picks the count up when it finishes.
  void g.say([g.pickId(Math.random() < 0.5 ? 'chuck.pro.down.' : 'dale.pro.down.')], 30, 2);
  const flight = clock;
  while ((me.airborne || clock - flight < 2.4) && clock - flight < 5.5) await g.frame();

  // ---- the count, and a new champion
  stage.shot({ kind: 'loser', bot: PLAYER, duration: 5 });
  g.crowd(0.5);
  await g.wait(2.6, false);
  await g.quiet(4);
  match.forceKo(PLAYER);
  audio.stinger('ko');
  ui.banner('ko');
  g.crowd(1);
  await atLeast(2.4, g.say(['vic.pro.ko.1']));
  ui.hud(null);
  stage.shot({ kind: 'winner', bot: NEMESIS.id, duration: 8 });
  await atLeast(3, g.say(['vic.pro.ko.2']));
  ui.banner('winner', NEMESIS.card.name);
  await g.wait(3.6, false);
  ui.bug(false);
  stage.shot({ kind: 'loser', bot: PLAYER, duration: 8 });

  return () => {
    const last = match.frame();
    g.setTick((dt) => stage.render(last, [], dt));
    match.dispose();
  };
}

// -------------------------------------------------------------------------------- the fall

/** A three second clip from a lost fight: the decline, one beating at a time. */
async function clip(g: Game, mine: Loadout, foeId: string, style: 'launch' | 'flip' | 'slam', sec: number, carried: Damage): Promise<void> {
  const { stage, audio } = g;
  const foe = careerRivalById(foeId)!;
  // Close enough that the charge lands in the first second of the clip.
  const a = { x: -0.75, z: 0.45 };
  const b = { x: 0.85, z: -0.4 };
  const entrants: Entrant[] = [
    { id: 'juggernaut', corner: 'red', spec: buildSpec(mine), card: CHAMP_CARD, control: 'ai', skill: 0.4, carried },
    { id: foe.id, corner: 'blue', spec: buildSpec(foe.loadout), card: foe.card, control: 'ai', skill: 0.9 },
  ];
  const m = new Match(g.R, {
    entrants,
    length: 60,
    seed: 11,
    positions: { juggernaut: { ...a, yaw: face(a, b) + 0.5 }, [foe.id]: { ...b, yaw: face(b, a) } },
  });
  m.setAiScript('juggernaut', 'passive');
  m.setAiScript(foe.id, 'charge');
  m.startFight();
  const jug = m.bot('juggernaut')!;
  const them = m.bot(foe.id)!;
  stage.setDressing('normal');
  stage.setScene('arena');
  stage.clearTransient();
  stage.setEntrants(entrants.map((e) => ({ id: e.id, spec: e.spec, corner: e.corner, player: false })));
  audio.setEntrants(entrants.map((e) => ({ id: e.id, spec: e.spec })));
  audio.setWorldActive(true);
  stage.shot({ kind: 'faceoff', duration: 2 });
  let t = 0;
  let hitAt = -1;
  let touched = false;
  g.setTick((dt) => {
    t += dt;
    // The throw lands on contact, never from across the floor.
    if (hitAt < 0 && (touched || apart(jug, them) < 1.05 || t > 2.5)) {
      hitAt = t;
      // Clips stay in frame: a smaller throw than the real thing.
      m.finisher(foe.id, 'juggernaut', style, { fire: style === 'launch', power: style === 'launch' ? 0.62 : 1 });
      m.setAiScript(foe.id, 'passive');
      m.timeScale = 0.25;
      stage.shake(0.8);
      stage.shot({ kind: 'replay', point: jug.pos, bots: ['juggernaut'], duration: sec, seed: style === 'slam' ? 1 : 0 });
      g.crowd(0.9);
    }
    if (hitAt >= 0 && t - hitAt > 0.8) m.timeScale = Math.min(1, m.timeScale + dt);
    audio.setTimeScale(m.timeScale);
    m.advance(dt);
    const events = m.drainEvents();
    for (const e of events) if (e.type === 'hit' && e.attacker === foe.id && e.victim === 'juggernaut') touched = true;
    const world = m.frame();
    stage.render(world, events, dt);
    audio.frame(world, events, stage.listener(), dt);
  });
  await g.wait(sec);
  // Freeze on the last frame before the match goes away.
  const last = m.frame();
  g.setTick((dt) => stage.render(last, [], dt));
  await g.frame();
  m.dispose();
  audio.setTimeScale(1);
}

function garageBeat(g: Game, l: Loadout, d: Damage, tier: 0 | 1 | 2 | 3, missing: ('drive' | 'power' | 'armor' | 'weapon')[] = []): void {
  g.setTick(null);
  g.audio.setWorldActive(false);
  g.stage.setScene('garage');
  g.stage.garage(buildSpec(l), d, { tier, missing });
}

async function theFall(g: Game, teardown: () => void): Promise<void> {
  const { ui, audio } = g;
  g.skipped = false;
  g.skipAll = false;
  g.setSkippable(true);
  audio.music('montage', 2.5);
  const tired: Loadout = { ...JUGGERNAUT_PRIME, armor: { material: 'steel', grade: 1 }, paint: { ...JUGGERNAUT_PRIME.paint, finish: 'matte' } };
  const worn: Loadout = { ...tired, drive: 'drill2', power: 'sla', extras: [], paint: { ...tired.paint, decal: 'JUG' } };
  // Each beat lasts as long as its line: nobody gets cut off by the next headline.
  const beat = async (card: MontageCard, voice: string | null, scene?: () => Promise<void>) => {
    if (g.skipAll) return;
    const dur = voice ? (g.audio.voiceLine(voice)?.dur ?? 0) : 0;
    const said = voice ? g.say([voice], 30, 2) : Promise.resolve();
    await g.wait(Promise.all([ui.montage({ ...card, sec: Math.max(card.sec, dur + 0.5) }), scene?.(), said]));
  };

  // The wreck, still burning.
  await beat({ kind: 'headline', title: 'THE CHAMPION FALLS', sub: 'One hit from Terminal Velocity ends a three year reign.', sec: 4.2 }, null);
  teardown();
  await beat(
    { kind: 'result', title: 'Next season. Round one.', result: { opponent: 'Flapjack', method: 'Flipped and counted out' }, sec: 4.4 },
    'jenna.fall.1',
    () => clip(g, tired, 'flapjack', 'flip', 4.2, wear(0.8)),
  );
  if (!g.skipAll) garageBeat(g, tired, wear(0.45, 0.6), 2);
  await beat({ kind: 'rank', title: 'Juggernaut', rank: { from: 1, to: 3 }, sec: 2.6 }, g.pickId('dale.fall.'));
  await beat({ kind: 'headline', title: 'SPONSORS PULL OUT', sub: 'Team Juggernaut loses its backing.', sec: 3.6 }, 'jenna.fall.2');
  await beat(
    { kind: 'result', title: 'Round one, again.', result: { opponent: 'Snowplow', method: 'Shoved into the saws' }, sec: 4.4 },
    g.pickId('chuck.fall.'),
    () => clip(g, worn, 'snowplow', 'slam', 4.2, wear(0.7)),
  );
  if (!g.skipAll) garageBeat(g, worn, wear(0.35, 0.5), 1);
  await beat({ kind: 'rank', title: 'Juggernaut', rank: { from: 3, to: 11 }, sec: 2.6 }, null);
  await beat(
    { kind: 'result', title: 'A regional, this time.', result: { opponent: 'Homewrecker', method: 'Torn apart in 0:41' }, sec: 4.4 },
    g.pickId('dale.fall.'),
    () => clip(g, worn, 'homewrecker', 'launch', 4.2, wear(0.6)),
  );
  if (!g.skipAll) garageBeat(g, worn, wear(0.3, 0.45), 1);
  await beat({ kind: 'rank', title: 'Juggernaut', rank: { from: 11, to: 38 }, sec: 2.6 }, 'jenna.fall.3');
  if (!g.skipAll) garageBeat(g, { ...worn, weapon: 'none' }, wear(0.3, 0.45), 0, ['weapon']);
  await beat({ kind: 'headline', title: 'THE DISK IS SOLD', sub: 'Juggernaut parts with its weapon to pay the bills.', sec: 3.8 }, 'jenna.fall.4');
  await beat({ kind: 'rank', title: 'Juggernaut', rank: { from: 38, to: null }, sec: 2.8 }, g.pickId('chuck.fall.'));
  await g.quiet(5);
  ui.caption(null);
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
export async function prologue(g: Game): Promise<void> {
  if (!g.save.career) g.save.career = newCareer();
  const teardown = await theFinal(g);
  await theFall(g, teardown);
  g.save.career.prologueDone = true;
  g.persist();
  g.audio.music('none', 4);
  await g.ui.story(['Two seasons later.', 'A rented storage unit in Oakland.'], 5);
  await firstRebuild(g);
}
