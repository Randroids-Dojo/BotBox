// The director: owns the frame loop and runs the show. Title, menus, the season as a run of
// episodes (cold open, title, desk, bracket, pits, fight, bumper), exhibitions and the garage.

import type { AudioEngine } from '../audio/types';
import type { BotCard, Entrant, Loadout, WeightClass, WorldFrame } from '../contract';
import { KILLSAWS, PULVERIZERS, RAMRODS, SPIKESTRIPS } from '../data/arena';
import { CLASS_LABEL } from '../data/parts';
import { ROSTER, rivalById, rivalsFor } from '../data/roster';
import type { Input } from '../input/input';
import type { Stage } from '../render/types';
import type { Rapier } from '../sim/rapier';
import { buildSpec } from '../sim/spec';
import type { BroadcastUI, Damage, RivalSummary, Speaker } from '../ui/types';
import { careerSummary, latestCareer, newCareer, slotView, type CareerSave } from './career';
import { runFight, nameLines, type RoundId } from './fight';
import { prologue, skipToStorage } from './prologue';
import { load, store, type SaveData } from './save';
import { PLAYER, ROUND_IDS, bracketView, describeSeason, newSeason, nextFight, record, resultText, simulateRound } from './season';
import { starterLoadout, toClass } from './starter';
import { careerHub, jumpTo } from './workshop';

type Tick = (dt: number) => void;

const SPEAKER: Record<string, Speaker> = { vic: 'Vic', dale: 'Dale', chuck: 'Chuck', jenna: 'Jenna' };

export function idleWorld(t = 0): WorldFrame {
  return {
    t,
    bots: [],
    debris: [],
    hazards: [
      ...PULVERIZERS.map((p) => ({ id: p.id, kind: 'pulverizer' as const, state: 0, spin: 0, warn: false })),
      ...KILLSAWS.map((k) => ({ id: k.id, kind: 'killsaw' as const, state: 0, spin: t * 8, warn: false })),
      ...RAMRODS.map((r) => ({ id: r.id, kind: 'ramrod' as const, state: 0, spin: 0, warn: false })),
      ...SPIKESTRIPS.map((s) => ({ id: s.id, kind: 'spikestrip' as const, state: 1, spin: 0, warn: false })),
    ],
    match: { phase: 'idle', clock: 180, lights: 0, timeScale: 1 },
  };
}

const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);

export class Game {
  save: SaveData = load();
  /** Dev and test hooks: ?autopilot drives the player's robot with the AI, ?speed=N runs fights faster. */
  readonly autopilot = params.has('autopilot');
  readonly speed = Math.max(1, Number(params.get('speed') ?? 1));
  skipped = false;
  skipAll = false;
  /** The match on screen, for tests and dev tools (window.botbox.game.current). */
  current: import('../sim/match').Match | null = null;
  /** Told when it is (or stops being) a good moment to offer a refresh. */
  onCalm: (calm: boolean) => void = () => {};
  private skippableNow = false;
  private tick: Tick | null = null;
  private frameWaiters: (() => void)[] = [];
  private last = performance.now();
  private idleT = 0;

  constructor(
    readonly R: Rapier,
    readonly stage: Stage,
    readonly audio: AudioEngine,
    readonly ui: BroadcastUI,
    readonly input: Input,
  ) {
    input.onAction((a) => {
      if (a === 'skip') this.skip();
    });
    // On touch screens a tap anywhere skips a cinematic, not just the small skip button.
    window.addEventListener('pointerup', (e) => {
      if (!this.skippableNow || e.pointerType !== 'touch') return;
      if ((e.target as HTMLElement | null)?.closest('button, input, .nav')) return;
      this.skip();
    });
    this.applySettings();
    requestAnimationFrame(this.loop);
  }

  /** Show or hide the skip hint and accept taps or keys to skip. */
  setSkippable(on: boolean): void {
    this.skippableNow = on;
    this.ui.skippable(on);
  }

  // ------------------------------------------------------------------ loop and timing

  private loop = (now: number): void => {
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.input.poll();
    if (this.tick) this.tick(dt);
    else this.idle(dt);
    const w = this.frameWaiters;
    this.frameWaiters = [];
    for (const f of w) f();
    requestAnimationFrame(this.loop);
  };

  private idle(dt: number): void {
    this.idleT += dt;
    const w = idleWorld(this.idleT);
    this.stage.render(w, [], dt);
    this.audio.frame(w, [], this.stage.listener(), dt);
  }

  setTick(t: Tick | null): void {
    this.tick = t;
  }

  frame(): Promise<void> {
    return new Promise((r) => this.frameWaiters.push(r));
  }

  /** Wait real seconds (or for a promise), cut short by a skip unless `skippable` is false. */
  async wait(what: number | Promise<unknown>, skippable = true): Promise<void> {
    this.skipped = false;
    if (typeof what !== 'number') {
      let done = false;
      void what.then(() => (done = true));
      while (!done && !(skippable && this.skipped)) await this.frame();
      return;
    }
    let t = 0;
    let prev = performance.now();
    while (t < what && !(skippable && this.skipped)) {
      await this.frame();
      const now = performance.now();
      t += (now - prev) / 1000;
      prev = now;
    }
  }

  private skip(): void {
    this.skipped = true;
    this.skipAll = true;
    this.skipGen++;
  }

  /** Bumped by every skip, so a queued line knows the moment it belonged to was skipped. */
  private skipGen = 0;
  private sayQueue: Promise<void> = Promise.resolve();
  private sayPending = 0;

  /** True while scripted lines are playing or waiting their turn (the booth stays quiet). */
  get saying(): boolean {
    return this.sayPending > 0;
  }

  /**
   * Play voice lines in order with captions. Scripted lines queue behind each other and wait for
   * whoever is talking to finish: a line that has started is only ever cut by a skip.
   * `maxSec` stops new lines from starting after that long; `late` drops the whole call if it
   * cannot start within that many seconds (a reaction that would land after its moment).
   */
  say(ids: string[], maxSec = 30, late = 6): Promise<void> {
    const called = performance.now();
    const gen = this.skipGen;
    this.sayPending++;
    const run = this.sayQueue.then(async () => {
      try {
        await this.sayNow(ids, called, gen, maxSec, late);
      } finally {
        this.sayPending--;
      }
    });
    this.sayQueue = run.catch(() => undefined);
    return run;
  }

  private async sayNow(ids: string[], called: number, gen: number, maxSec: number, late: number): Promise<void> {
    const age = () => (performance.now() - called) / 1000;
    // Let the booth finish its sentence.
    while (this.audio.voiceBusy() && age() < late && this.skipGen === gen) await this.frame();
    if (this.skipGen !== gen || age() >= late) return;
    for (const id of ids) {
      if (age() > maxSec || this.skipGen !== gen) break;
      const line = this.audio.voiceLine(id);
      if (!line) continue;
      const who = SPEAKER[id.split('.')[0]] ?? 'Vic';
      if (this.save.settings.subtitles) this.ui.caption(who, line.text);
      const p = this.audio.voice(id, { interrupt: true });
      let done = false;
      void p.then(() => (done = true));
      while (!done && this.skipGen === gen) await this.frame();
      if (this.skipGen !== gen) {
        this.audio.stopVoice();
        break;
      }
    }
    this.ui.caption(null);
  }

  /** Wait until nobody is talking (up to `maxSec`). */
  async quiet(maxSec = 8): Promise<void> {
    const t0 = performance.now();
    while ((this.saying || this.audio.voiceBusy()) && (performance.now() - t0) / 1000 < maxSec) await this.frame();
  }

  pickId(prefix: string): string {
    const ids = this.audio.voiceIds().filter((id) => id.startsWith(prefix));
    return ids.length ? ids[Math.floor(Math.random() * ids.length)] : `${prefix}1`;
  }

  crowd(level: number): void {
    this.audio.crowd(level);
    (this.stage as Stage & { crowd?: (l: number) => void }).crowd?.(level);
  }

  applySettings(): void {
    const s = this.save.settings;
    this.audio.setVolumes(s.volumes);
    const coarse = matchMedia('(pointer: coarse)').matches;
    this.stage.setQuality(s.quality === 'auto' ? (coarse ? 'medium' : 'high') : s.quality);
    this.stage.setBroadcastFilter(s.broadcastFilter);
    this.input.driveMode = s.drive;
  }

  persist(): void {
    const c = this.save.career;
    if (c) {
      c.savedAt = Date.now();
      this.save.slots[this.save.slot] = c;
    }
    store(this.save);
  }

  // ------------------------------------------------------------------ the show

  async run(): Promise<void> {
    this.stage.setScene('title');
    this.audio.setWorldActive(false);
    this.audio.music('title', 0.5);
    await this.ui.title();
    this.audio.stinger('logo');
    const jump = params.get('career');
    if (jump !== null) {
      this.useSlot(this.save.slot, this.save.career ?? newCareer());
      jumpTo(this.save.career!, Number(jump) || 0);
      this.persist();
    }
    // First launch: straight into the last seconds of a championship final, in slot 1 (or the
    // slot whose opening was left unfinished). The dev jump goes straight to the workshop too.
    const started = this.save.slots.some((c) => c?.prologueDone);
    if (!started || jump !== null) {
      if (!this.save.career) {
        const open = this.save.slots.findIndex((c) => !!c);
        this.useSlot(open >= 0 ? open : 0, this.save.slots[open] ?? newCareer());
      }
      await this.guarded(() => this.career());
    }
    for (;;) {
      this.stage.setScene('title');
      this.audio.music('menu', 1);
      const choice = await this.ui.mainMenu({
        career: careerSummary(latestCareer(this.save.slots)),
        season: this.save.season && !this.save.season.done ? describeSeason(this.save.season) : null,
        nuts: this.save.nuts,
        robot: this.save.robot,
      });
      await this.guarded(async () => {
        if (choice === 'career') await this.careerSlots();
        else if (choice === 'quick') await this.exhibition();
        else if (choice === 'continue') await this.season(true);
        else if (choice === 'season') await this.season(false);
        else if (choice === 'exhibition') await this.exhibition();
        else if (choice === 'garage') await this.garage();
        else if (choice === 'settings') {
          this.save.settings = await this.ui.settings(this.save.settings);
          this.applySettings();
          this.persist();
        } else if (choice === 'credits') await this.ui.credits();
      });
    }
  }

  /** Run a mode; whatever happens, come back to a clean menu. */
  private async guarded(f: () => Promise<void>): Promise<void> {
    try {
      await f();
    } catch (err) {
      console.error(err);
    }
    this.setTick(null);
    this.ui.hud(null);
    this.ui.touchControls(null);
    this.ui.caption(null);
    this.ui.coach(null);
    this.ui.lowerThird(null);
    this.ui.bug(false);
    this.audio.setWorldActive(false);
    this.stage.setDressing('normal');
    this.onCalm(true);
  }

  /** Make a slot the one being played. */
  private useSlot(slot: number, c: CareerSave): void {
    this.save.slot = slot;
    this.save.slots[slot] = c;
    this.save.career = c;
  }

  /** The slot picker: continue a career, start a new one, or clear a slot. */
  private async careerSlots(): Promise<void> {
    for (;;) {
      this.stage.setScene('title');
      const pick = await this.ui.saves(this.save.slots.map((c, i) => slotView(c, i)), this.save.seenIntro);
      if (!pick) return;
      if (pick.action === 'delete') {
        this.save.slots[pick.slot] = null;
        if (this.save.slot === pick.slot) this.save.career = null;
        this.persist();
        continue;
      }
      if (pick.action === 'new') {
        this.useSlot(pick.slot, newCareer());
        this.persist();
        if (pick.skipIntro) await skipToStorage(this);
      } else {
        const c = this.save.slots[pick.slot];
        if (!c) continue;
        this.useSlot(pick.slot, c);
        this.persist();
      }
      await this.career();
      return;
    }
  }

  /** The comeback career: the prologue the first time, then the workshop. */
  private async career(): Promise<void> {
    if (!this.save.career?.prologueDone) await prologue(this);
    await careerHub(this);
  }

  private rivalSummary(id: string): RivalSummary {
    const r = rivalById(id)!;
    return { id, card: r.card, cls: r.loadout.cls, spec: buildSpec(r.loadout), style: r.style, seed: r.seed };
  }

  private playerCard(l: Loadout): BotCard {
    return {
      name: l.name,
      team: 'Team Rookie',
      hometown: 'A garage near you',
      builders: 'You and whoever owes you a favor',
      blurb: 'A rookie team with something to prove.',
      record: `${this.save.nuts[l.cls] ?? 0} Giant Nuts`,
    };
  }

  private garagePreview = (l: Loadout, d?: Damage) => {
    this.stage.setScene('garage');
    this.stage.garage(buildSpec(l), d);
  };

  async garage(): Promise<void> {
    this.stage.setScene('garage');
    this.audio.music('pits', 1);
    const res = await this.ui.garage({
      mode: 'build',
      loadout: this.save.robot ?? starterLoadout(),
      classLocked: false,
      preview: this.garagePreview,
      orbit: (dx, dy) => this.stage.orbit(dx, dy),
    });
    if (res) {
      this.save.robot = res.loadout;
      this.persist();
    }
  }

  // ------------------------------------------------------------------ season

  private async season(resume: boolean): Promise<void> {
    if (!resume || !this.save.season || this.save.season.done) {
      const cls = await this.ui.pickClass('Pick your weight class');
      if (!cls) return;
      const base = this.save.robot ? toClass(this.save.robot, cls) : starterLoadout(cls);
      this.stage.setScene('garage');
      this.audio.music('pits', 1);
      const built = await this.ui.garage({
        mode: 'build',
        loadout: base,
        classLocked: true,
        preview: this.garagePreview,
        orbit: (dx, dy) => this.stage.orbit(dx, dy),
      });
      if (!built) return;
      this.save.robot = built.loadout;
      this.save.season = newSeason(cls, built.loadout);
      this.persist();
    }
    const s = this.save.season!;
    let first = true;
    for (;;) {
      const next = nextFight(s);
      if (!next) break;
      const round = ROUND_IDS[next.round] as RoundId;
      const opp = this.rivalSummary(next.opponent);

      await this.episodeOpen(first);
      first = false;

      // Bracket and scouting.
      this.stage.setScene('title');
      this.audio.music('menu', 1);
      await this.ui.bracket(bracketView(s, s.loadout.name), opp);

      // The pits.
      this.stage.setScene('garage');
      this.audio.music('pits', 1);
      void this.say([this.pickId('jenna.pits.')]);
      const pits = await this.ui.garage({
        mode: 'pits',
        loadout: s.loadout,
        classLocked: true,
        damage: s.damage ?? undefined,
        repairPoints: 12,
        opponent: opp,
        preview: this.garagePreview,
        orbit: (dx, dy) => this.stage.orbit(dx, dy),
      });
      this.audio.stopVoice();
      this.ui.caption(null);
      if (!pits) return;
      s.loadout = pits.loadout;
      s.damage = pits.damage ?? s.damage;
      this.save.robot = pits.loadout;
      this.persist();

      // The fight.
      const rival = rivalById(next.opponent)!;
      const entrants: Entrant[] = [
        { id: PLAYER, corner: 'red', spec: buildSpec(s.loadout), card: this.playerCard(s.loadout), control: 'player', skill: 1, carried: s.damage ?? undefined },
        { id: rival.id, corner: 'blue', spec: buildSpec(rival.loadout), card: rival.card, control: 'ai', skill: Math.min(1, rival.skill + next.round * 0.04) },
      ];
      const out = await runFight(this, {
        entrants,
        round,
        length: 180,
        playerId: PLAYER,
        final: round === 'final',
        championIfWon: round === 'final',
      });
      this.setTick(null);
      if (out.quit) return;
      const winner = out.result.winner ?? rival.id;
      record(s, next.round, next.match, winner, resultText(out.result.method, out.result.time, out.result.totals, winner));
      simulateRound(s, next.round);
      s.damage = out.carried ?? null;
      if (!out.playerWon) {
        s.done = true;
        this.persist();
        await this.ui.result({ won: false, headline: `${rival.card.name} wins`, detail: `${out.cause ? out.cause + ' ' : ''}Your season ends in the ${round === 'final' ? 'final' : round + 'finals'}.`, result: out.result });
        await this.ui.eliminated(this.playerCard(s.loadout), round);
        break;
      }
      if (round === 'final') {
        s.done = true;
        s.champion = true;
        this.save.nuts[s.cls] = (this.save.nuts[s.cls] ?? 0) + 1;
        this.persist();
        await this.ceremony(s.loadout);
        break;
      }
      this.persist();
      await this.ui.result({ won: true, headline: `${s.loadout.name} advances`, detail: `Next: the ${ROUND_IDS[next.round + 1] === 'final' ? 'final' : ROUND_IDS[next.round + 1] + 'finals'}.`, result: out.result });
      // Commercial break.
      this.audio.music('bumper', 0.2);
      void this.say([this.pickId('dale.bumper.')]);
      await this.ui.bumper();
    }
  }

  /** Cold open, title and the host desk. */
  private async episodeOpen(full: boolean): Promise<void> {
    this.skipped = false;
    this.skipAll = false;
    this.setSkippable(true);
    this.stage.setEntrants([]);
    this.stage.setScene('arena');
    this.stage.shot({ kind: 'flyover', duration: 7 });
    this.audio.music('intro', 0.5);
    this.crowd(0.5);
    if (full) {
      void this.say([this.pickId('vic.tonight.')]);
      await this.wait(this.ui.slate('TONIGHT ON BOTBOX', 'Treasure Island, San Francisco', 3));
    }
    if (!this.skipAll) {
      this.stage.setScene('title');
      this.audio.music('title', 0.2);
      this.audio.stinger('logo');
      await this.say([this.pickId('vic.open.')], 6);
      await this.wait(1.2);
    }
    if (!this.skipAll && full) {
      this.stage.setScene('arena');
      this.stage.shot({ kind: 'booth', duration: 8 });
      this.audio.music('menu', 1);
      await this.say([this.pickId('dale.desk.'), this.pickId('chuck.desk.')], 9);
    }
    this.setSkippable(false);
    this.skipAll = false;
    this.audio.crowd(0);
  }

  private async ceremony(l: Loadout): Promise<void> {
    const spec = buildSpec(l);
    this.stage.setScene('trophy');
    this.stage.trophy(spec);
    this.audio.music('nut', 0.5);
    this.crowd(1);
    void this.say(['vic.champion', ...nameLines({ id: PLAYER, card: this.playerCard(l) })]);
    await this.ui.ceremony(this.playerCard(l), l.cls);
  }

  // ------------------------------------------------------------------ exhibition

  private async exhibition(): Promise<void> {
    this.stage.setScene('title');
    const rivals = ROSTER.map((r) => this.rivalSummary(r.id));
    const cfg = await this.ui.exhibition(rivals, !!this.save.robot);
    if (!cfg) return;
    const cls: WeightClass = cfg.cls;
    const corners = ['red', 'blue', 'green', 'yellow'] as const;
    const entrants: Entrant[] = [];
    let playerId: string | null = null;
    if (cfg.mode !== 'watch') {
      if (cfg.playerRival) {
        const r = rivalById(cfg.playerRival)!;
        entrants.push({ id: r.id, corner: 'red', spec: buildSpec(r.loadout), card: r.card, control: 'player', skill: 1 });
        playerId = r.id;
      } else {
        const l = toClass(this.save.robot ?? starterLoadout(cls), cls);
        entrants.push({ id: PLAYER, corner: 'red', spec: buildSpec(l), card: this.playerCard(l), control: 'player', skill: 1 });
        playerId = PLAYER;
      }
    }
    const pool = cfg.rivals.length ? cfg.rivals : rivalsFor(cls).slice(0, cfg.mode === 'rumble' ? 3 : 2).map((r) => r.id);
    for (const id of pool) {
      if (entrants.length >= 4 || entrants.some((e) => e.id === id)) continue;
      const r = rivalById(id)!;
      entrants.push({ id: r.id, corner: corners[entrants.length], spec: buildSpec(r.loadout), card: r.card, control: 'ai', skill: r.skill });
    }
    if (entrants.length < 2) return;
    await runFight(this, {
      entrants,
      round: cfg.mode === 'rumble' ? 'rumble' : 'exhibition',
      length: this.save.settings.matchLength,
      playerId,
    });
    this.setTick(null);
    void CLASS_LABEL;
  }
}
