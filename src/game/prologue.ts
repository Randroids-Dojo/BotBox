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
    if (flippedT > 6) {
      const p = me.pos;
      const yaw0 = yawOf(me.quat);
      me.body.setTranslation({ x: p.x, y: p.y + 0.25, z: p.z }, true);
      me.body.setRotation({ x: 0, y: Math.sin(yaw0 / 2), z: 0, w: Math.cos(yaw0 / 2) }, true);
      me.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
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
    // At least a dozen seconds at the sticks, then the script takes over (never while upside down).
    const finished = (doneAt > 0 && clock - doneAt > 1.4 && t > 12) || t > 24 || match.phase !== 'fight';
    if (finished && !me.helpless) break;
  }

  // ---- the turn: bars drop, the HUD goes, and the film takes over
  control = false;
  cutscene(true);
  // The clock stops with the bars down: the cutscene cannot run the final out of time.
  match.clockHeld = true;
  if (auto) match.setAiScript(PLAYER, 'passive');
  // Line Terminal Velocity up a short run away, facing the champion. The cut hides the move.
  const room = { x: -Math.sign(me.pos.x || 1), z: -Math.sign(me.pos.z || 1) };
  const rn = Math.hypot(room.x, room.z);
  const at = { x: me.pos.x + (room.x / rn) * 2.6, z: me.pos.z + (room.z / rn) * 2.6 };
  tv.body.setTranslation({ x: at.x, y: tv.pos.y + 0.03, z: at.z }, true);
  tv.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  tv.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  const yaw = face(at, me.pos);
  tv.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
  match.setAiScript(NEMESIS.id, 'windup');
  // Both robots in one slow orbit: the champion idling, the bar beginning to turn.
  const mid = { x: (me.pos.x + at.x) / 2, y: 0.2, z: (me.pos.z + at.z) / 2 };
  stage.shot({ kind: 'replay', point: mid, bots: [NEMESIS.id, PLAYER], duration: 8, seed: 1 });
  g.crowd(0.7);
  await g.say(['dale.pro.turn.1']);
  const turnStart = clock;
  while (tv.spin01 < 0.6 && clock - turnStart < 1.2) await g.frame();
  // Then close on the bar as it screams up to speed.
  stage.shot({ kind: 'bot_intro', bot: NEMESIS.id, duration: 2.4 });
  const closeAt = clock;
  while ((tv.spin01 < 0.9 || clock - closeAt < 1.3) && clock - closeAt < 2.2) await g.frame();
  tv.omega = Math.max(tv.omega, tv.omegaMax * 0.95);
  // Over the champion's shoulder as it comes.
  const warn = g.say(['chuck.pro.turn.2']);
  await g.wait(0.6, false);
  const charge = async (limit: number) => {
    match.setAiScript(NEMESIS.id, 'charge');
    stage.shot({ kind: 'faceoff', duration: 2.6 });
    const from = clock;
    while (struck < from && apart(me, tv) > 1.05 && clock - from < limit) await g.frame();
    return struck >= from || apart(me, tv) <= 1.05;
  };
  if (!(await charge(4))) {
    // Stuck somewhere: cut away and line it up again closer. The cut hides it.
    stage.shot({ kind: 'loser', bot: PLAYER, duration: 1 });
    await g.frame();
    const back = { x: me.pos.x + (room.x / rn) * 1.6, z: me.pos.z + (room.z / rn) * 1.6 };
    tv.body.setTranslation({ x: back.x, y: tv.pos.y + 0.03, z: back.z }, true);
    tv.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    const y2 = face(back, me.pos);
    tv.body.setRotation({ x: 0, y: Math.sin(y2 / 2), z: 0, w: Math.cos(y2 / 2) }, true);
    await charge(4);
  }

  // ---- the hit
  // High enough to gasp at, low enough to stay in the shot.
  match.finisher(NEMESIS.id, PLAYER, 'launch', { fire: true, kill: true, power: 0.82 });
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
  await g.wait(0.4, false);
  void g.say(['chuck.pro.down.1'], 30, 3);
  const flight = clock;
  while ((me.airborne || clock - flight < 2.6) && clock - flight < 5.5) await g.frame();

  // ---- down and out, and a new champion
  stage.shot({ kind: 'loser', bot: PLAYER, duration: 6 });
  g.crowd(0.4);
  await g.quiet(4);
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
  await g.wait(Promise.all([crowned, g.wait(3.2, false)]));
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
/** A new game for someone who has seen the opening: straight to the storage unit. */
export async function skipToStorage(g: Game): Promise<void> {
  g.save.career!.prologueDone = true;
  g.persist();
  g.stage.setScene('title');
  g.audio.music('none', 1);
  await g.ui.story(['Juggernaut lost the final. Then it lost everything else.', 'Two seasons later.', 'A rented storage unit in Oakland.'], 6.5);
}

export async function prologue(g: Game): Promise<void> {
  if (!g.save.career) g.save.career = newCareer();
  const teardown = await theFinal(g);
  await theFall(g, teardown);
  g.save.career.prologueDone = true;
  g.save.seenIntro = true;
  g.persist();
  g.audio.music('none', 4);
  g.ui.letterbox(false);
  await g.ui.story(['Two seasons later.', 'A rented storage unit in Oakland.'], 5);
  await firstRebuild(g);
}
