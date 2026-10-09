// World sound: robots, impacts, weapons, hazards, grinding, debris and the crowd, driven by
// WorldFrame and MatchEvent.

import type { ArmorMaterialId, BotSpec, HazardKind, HitEvent, MatchEvent, Quat, Vec3, WorldFrame } from '../contract';
import { KILLSAWS, PULVERIZERS, RAMRODS } from '../data/arena';
import type { Bank } from './bank';
import { clamp, dbToGain } from './dsp';
import type { Mixer } from './mixer';
import { RobotVoice } from './robots';
import { RING_VARIANTS, TRANSIENTS, type TransientId } from './sounds/sfx';
import { Listener } from './spatial';
import type { Stinger } from './types';

/** Simultaneous one-shot groups in the world before the oldest is stolen. */
export const MAX_ONESHOTS = 16;

interface Layer {
  key: string;
  gain: number;
  rate?: number;
  delay?: number;
}

interface Shot {
  t0: number;
  end: number;
  gain: GainNode;
  srcs: AudioBufferSourceNode[];
}

const HAZARD_POS = new Map<string, Vec3>([
  ...KILLSAWS.map((k) => [k.id, k.center] as const),
  ...PULVERIZERS.map((p) => [p.id, p.center] as const),
  ...RAMRODS.map((r) => [r.id, r.center] as const),
]);

const pick = (n: number) => Math.floor(Math.random() * n);
const jitter = (a: number) => 1 + (Math.random() * 2 - 1) * a;

/** Energy to a 0..1 loudness: 100 J is a tap, 20 kJ is a season highlight. */
export function hitLevel(e: HitEvent): number {
  const byEnergy = clamp((Math.log10(Math.max(1, e.energy)) - 2) / 2.3, 0, 1);
  return clamp(Math.max(byEnergy, e.severity), 0, 1);
}

export class World {
  readonly listener = new Listener();
  private robots = new Map<string, RobotVoice>();
  private shots: Shot[] = [];
  private active = true;
  private timeScale = 1;
  private lastHazard = new Map<string, number>();
  private alarmAt = -1;
  private grind: { src: AudioBufferSourceNode; gain: GainNode; pan: StereoPannerNode; bp: BiquadFilterNode; level: number; idle: number } | null = null;
  private grindTarget = 0;
  private grindPos: Vec3 = { x: 0, y: 0, z: 0 };
  private grindMat: ArmorMaterialId = 'steel';
  private pendingFire = new Map<string, number>();
  private lastHitBy = new Map<string, number>();
  /** Recently played keys, to merge duplicates within a frame. */
  private recent = new Map<string, number>();
  readonly crowd: Crowd;
  /** Stinger hook for arena events (lights, horn, buzzers). */
  onStinger: (id: Stinger) => void = () => {};
  stats = { shots: 0, stolen: 0, peakShots: 0 };

  constructor(
    private ctx: BaseAudioContext,
    private bank: Bank,
    private mixer: Mixer,
  ) {
    this.crowd = new Crowd(ctx, bank, mixer);
  }

  get rate(): number {
    return Math.pow(this.timeScale, 0.6);
  }

  setEntrants(entrants: { id: string; spec: BotSpec }[]): void {
    // Keyed by what the robot sounds like, so rebuilding spec objects every call is free.
    const key = (s: BotSpec) => `${s.loadout.drive}/${s.loadout.weapon}/${s.loadout.cls}/${s.scale}`;
    const want = new Map(entrants.map((e) => [e.id, e.spec]));
    for (const [id, v] of this.robots) {
      const s = want.get(id);
      if (!s || key(s) !== key(v.spec)) {
        v.dispose();
        this.robots.delete(id);
      }
    }
    for (const e of entrants)
      if (!this.robots.has(e.id)) this.robots.set(e.id, new RobotVoice(this.ctx, this.bank, e.id, e.spec, this.mixer.worldIn, this.mixer.hallIn));
  }

  /** While the world is off, the whole world subgraph is detached so it costs nothing. */
  private attached = true;
  private offSince = 0;

  maintain(): void {
    const now = this.ctx.currentTime;
    if (!this.active && this.attached && now - this.offSince > 0.6) {
      this.mixer.detachWorld();
      this.attached = false;
    }
    this.updateGrind();
    this.crowd.maintain();
  }

  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    const t = this.ctx.currentTime;
    if (on && !this.attached) {
      this.mixer.attachWorld();
      this.attached = true;
    }
    if (!on) this.offSince = t;
    this.mixer.worldGate.gain.setTargetAtTime(on ? 1 : 0, t, on ? 0.08 : 0.1);
    if (!on) {
      for (const r of this.robots.values()) r.silence();
      this.grindTarget = 0;
    }
    this.crowd.setWorldActive(on);
  }

  setTimeScale(s: number): void {
    this.timeScale = clamp(s, 0.05, 1);
    const t = this.ctx.currentTime;
    const f = this.timeScale >= 0.99 ? 20000 : clamp(20000 * Math.pow(this.timeScale, 1.6), 700, 20000);
    this.mixer.worldLP.frequency.setTargetAtTime(f, t, 0.08);
    this.mixer.crowdSlowLP.frequency.setTargetAtTime(f, t, 0.08);
    this.crowd.setRate(Math.pow(this.timeScale, 0.4));
  }

  frame(world: WorldFrame, events: MatchEvent[], listener: { pos: Vec3; quat: Quat }, dt: number): void {
    this.listener.set(listener.pos, listener.quat);
    const now = this.ctx.currentTime;
    for (const [k, t] of this.recent) if (now - t > 0.05) this.recent.delete(k);
    for (const ev of events) this.event(ev, world);
    if (this.active) {
      const rate = this.rate;
      // dt is real seconds; motion in the frame is in sim seconds.
      const simDt = dt * this.timeScale;
      for (const b of world.bots) {
        const v = this.robots.get(b.id);
        if (v) v.update(b, simDt, this.listener.place(b.pos), rate, true);
      }
      this.hazardFrames(world);
      this.whiffs(world);
    }
    this.updateGrind();
    this.crowd.arm();
    this.crowd.update(dt, world);
    this.shots = this.shots.filter((s) => s.end > now);
  }

  // ---------------------------------------------------------------------------------------
  // One-shots

  /** Play layered bank sounds at a world position (or centered if null). */
  play(layers: Layer[], pos: Vec3 | null, o: { gain?: number; send?: number; lp?: number } = {}): void {
    if (!this.active) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.005;
    const place = pos ? this.listener.place(pos) : { pan: 0, gain: 0.7, lp: 18000, dist: 8 };
    // Steal the oldest when the pool is full.
    if (this.shots.length >= MAX_ONESHOTS) {
      const old = this.shots.shift()!;
      old.gain.gain.setTargetAtTime(0, t, 0.01);
      for (const s of old.srcs) s.stop(t + 0.06);
      this.stats.stolen++;
    }
    const g = ctx.createGain();
    g.gain.value = (o.gain ?? 1) * place.gain;
    const p = ctx.createStereoPanner();
    p.pan.value = place.pan;
    let head: AudioNode = g;
    const lpF = Math.min(place.lp, o.lp ?? 20000);
    if (lpF < 17000) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = lpF;
      lp.Q.value = 0.5;
      g.connect(lp);
      head = lp;
    }
    head.connect(p).connect(this.mixer.worldIn);
    if ((o.send ?? 0.2) > 0) {
      const s = ctx.createGain();
      s.gain.value = o.send ?? 0.2;
      p.connect(s).connect(this.mixer.hallIn);
    }
    const srcs: AudioBufferSourceNode[] = [];
    let end = t;
    const rate = this.rate;
    for (const l of layers) {
      const buf = this.bank.get(l.key);
      if (!buf || l.gain <= 0.001) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = (l.rate ?? 1) * rate;
      const lg = ctx.createGain();
      lg.gain.value = l.gain;
      src.connect(lg).connect(g);
      const at = t + (l.delay ?? 0) / Math.max(0.2, this.timeScale);
      src.start(at);
      srcs.push(src);
      end = Math.max(end, at + buf.duration / src.playbackRate.value);
    }
    if (!srcs.length) return;
    this.shots.push({ t0: t, end, gain: g, srcs });
    this.stats.shots++;
    this.stats.peakShots = Math.max(this.stats.peakShots, this.shots.length);
  }

  private once(key: string): boolean {
    if (this.recent.has(key)) return false;
    this.recent.set(key, this.ctx.currentTime);
    return true;
  }

  // ---------------------------------------------------------------------------------------
  // Events

  private event(ev: MatchEvent, world: WorldFrame): void {
    const botPos = (id: string) => world.bots.find((b) => b.id === id)?.pos ?? null;
    switch (ev.type) {
      case 'hit':
        this.hit(ev);
        if (ev.attacker) this.lastHitBy.set(ev.attacker, world.t);
        this.crowd.hit(ev);
        break;
      case 'grind':
        this.grindTarget = Math.max(this.grindTarget, clamp(ev.intensity, 0, 1));
        this.grindPos = ev.point;
        this.grindMat = ev.material;
        break;
      case 'panel_off':
        this.play([{ key: `clatter.plate.${pick(2)}`, gain: 0.7, rate: jitter(0.08), delay: 0.25 }], botPos(ev.bot), { send: 0.25 });
        this.crowd.bump(0.25, 'cheer');
        break;
      case 'wheel_off':
        this.play([{ key: 'clatter.wheel', gain: 0.7, rate: jitter(0.06), delay: 0.2 }, { key: `debris.${pick(3)}`, gain: 0.3 }], botPos(ev.bot));
        this.crowd.bump(0.3, 'cheer');
        break;
      case 'shrapnel':
        this.play([{ key: `debris.${pick(3)}`, gain: clamp(0.08 + ev.count * 0.02, 0, 0.35), rate: jitter(0.1) * 1.15 }], ev.point, { send: 0.1 });
        break;
      case 'component_down':
        this.play([{ key: 'zap', gain: 0.5, rate: jitter(0.1) }], botPos(ev.bot), { send: 0.1 });
        break;
      case 'smoke_start':
        this.play([{ key: 'zap', gain: 0.45, rate: jitter(0.1) * 0.9 }], botPos(ev.bot));
        this.crowd.bump(0.2, 'ooh');
        break;
      case 'fire_start':
        this.play([{ key: 'ignite', gain: 0.6 }], botPos(ev.bot));
        this.crowd.bump(0.45, 'cheer');
        break;
      case 'flipped':
        this.crowd.bump(0.35, 'cheer');
        break;
      case 'airborne':
        this.crowd.bump(0.3 + clamp(ev.height / 3, 0, 0.3), 'ooh');
        break;
      case 'landed': {
        const l = clamp(ev.speed / 7, 0.2, 1);
        this.play([{ key: `landing.${pick(2)}`, gain: 0.5 + 0.5 * l, rate: jitter(0.06) * (1.05 - 0.1 * l) }, { key: `debris.${pick(3)}`, gain: 0.25 * l }], botPos(ev.bot), { send: 0.3 });
        break;
      }
      case 'righted':
        this.crowd.bump(0.3, 'cheer');
        break;
      case 'weapon_fire': {
        const p = botPos(ev.bot);
        if (ev.kind === 'flipper')
          this.play([{ key: 'pneu.bang', gain: 1 }, { key: 'pneu.hiss', gain: 0.55, delay: 0.03 }, { key: `tr.clang.${pick(2)}`, gain: 0.35, rate: 0.85 }], p, { send: 0.3 });
        else if (ev.kind === 'axe')
          this.play([{ key: 'pneu.bang', gain: 0.7, rate: 1.1 }, { key: 'swing', gain: 0.8, rate: jitter(0.05) }, { key: 'pneu.hiss', gain: 0.35, delay: 0.05 }], p, { send: 0.25 });
        else if (ev.kind === 'srimech') this.play([{ key: 'srimech', gain: 0.9 }, { key: 'pneu.hiss', gain: 0.35, delay: 0.04 }], p, { send: 0.3 });
        else this.play([{ key: 'relay', gain: 0.5 }], p);
        if (ev.kind !== 'srimech') this.pendingFire.set(ev.bot, world.t);
        break;
      }
      case 'weapon_arm':
        this.play([{ key: 'relay', gain: ev.on ? 0.6 : 0.4, rate: ev.on ? 1 : 0.8 }], botPos(ev.bot), { send: 0.1 });
        break;
      case 'hazard':
        this.hazard(ev.hazard, ev.kind, ev.action);
        break;
      case 'lights':
        this.onStinger(ev.lights === 4 ? 'go' : 'lights');
        break;
      case 'fight_start':
        this.onStinger('go');
        this.crowd.bump(0.7, 'cheer');
        break;
      case 'ko':
        this.onStinger('ko');
        this.crowd.bump(0.9, 'cheer');
        break;
      case 'ko_clear':
        this.crowd.bump(0.3, 'cheer');
        break;
      case 'time_up':
        this.onStinger('time');
        this.crowd.bump(0.6, 'cheer');
        break;
      case 'match_over':
        this.crowd.bump(0.8, 'applause');
        break;
      default:
        break;
    }
  }

  private hit(e: HitEvent): void {
    const L = hitLevel(e);
    // Merge piles of hits on one victim in one frame: keep the first (they arrive loudest first
    // in practice, and a second identical layer would just phase).
    if (!this.once(`hit:${e.victim}:${e.kind}`)) return;
    const mat = e.material;
    const plastic = mat === 'uhmw' || mat === 'polycarb';
    const ring = (gain: number, rate = 1): Layer => ({
      key: `ring.${mat}.${pick(RING_VARIANTS)}`,
      gain,
      rate: rate * jitter(0.05) * (mat === 'titanium' ? 1.05 : 1) * (1.06 - 0.12 * L),
    });
    const tr = (id: TransientId, gain: number, rate = 1): Layer => ({ key: `tr.${id}.${pick(TRANSIENTS[id])}`, gain, rate: rate * jitter(0.05) });
    const thump = (gain: number): Layer => ({ key: `thump.${pick(2)}`, gain, rate: jitter(0.04) * (1.05 - 0.15 * L) });
    const debris = (gain: number): Layer => ({ key: `debris.${pick(3)}`, gain, rate: jitter(0.1), delay: 0.03 });
    let layers: Layer[] = [];
    let send = 0.22;
    switch (e.kind) {
      case 'spinner':
        layers = [tr('crack', 1, 1.02 - 0.08 * L), ring(0.9), thump(L > 0.35 ? 0.9 * L : 0), debris(L > 0.45 ? 0.55 * L : 0)];
        send = 0.3;
        break;
      case 'ram':
        layers = [tr('clonk', 0.9), ring(0.45, 0.72), thump(L > 0.45 ? 0.6 * L : 0)];
        break;
      case 'axe':
        layers = [tr('thunk', 1), ring(0.65, 0.9), thump(L > 0.25 ? 0.85 * L : 0), debris(L > 0.55 ? 0.4 * L : 0)];
        send = 0.28;
        break;
      case 'flip':
        layers = [tr('clang', 0.8), ring(0.55)];
        break;
      case 'lift':
        layers = [tr('clang', 0.45, 0.8), ring(0.3, 0.9)];
        break;
      case 'wall':
        layers = [tr('clonk', 0.8, 0.85), { key: `ring.steel.${pick(RING_VARIANTS)}`, gain: 0.55, rate: 0.55 * jitter(0.05) }, thump(L > 0.25 ? 0.75 * L : 0)];
        send = 0.35;
        break;
      case 'spikestrip':
        layers = [tr('crunch', 0.8), ring(0.4), { key: `ring.steel.${pick(RING_VARIANTS)}`, gain: 0.25, rate: 1.3 }];
        break;
      case 'killsaw':
        layers = [{ key: 'saw.shriek', gain: 0.85, rate: jitter(0.05) }, tr('crunch', 0.5, 1.1), ring(0.4), debris(0.35)];
        send = 0.25;
        break;
      case 'pulverizer':
        layers = [tr('thunk', 1, 0.8), thump(1), ring(0.6, 0.85), debris(0.5)];
        send = 0.35;
        break;
      case 'ramrod':
        layers = [tr('clonk', 0.6, 1.1), ring(0.45)];
        break;
      case 'floor':
        layers = [{ key: `landing.${pick(2)}`, gain: 0.8, rate: jitter(0.05) }, ring(0.35, 0.8)];
        send = 0.3;
        break;
    }
    // Plastic armor swallows the crack and the shine.
    this.play(layers, e.point, { gain: dbToGain(-14 + 14 * L), send, lp: plastic ? 2600 : undefined });
  }

  private hazard(id: string, kind: HazardKind, action: 'warn' | 'strike' | 'retract'): void {
    const pos = HAZARD_POS.get(id) ?? null;
    const now = this.ctx.currentTime;
    if (action === 'warn') {
      // Beacons: one chirp at a time, saws quieter than the big hazards.
      if (now - this.alarmAt < 0.35) return;
      this.alarmAt = now;
      this.play([{ key: 'alarm', gain: kind === 'killsaw' ? 0.16 : 0.3 }], pos, { send: 0.35 });
      return;
    }
    if (action === 'strike') {
      if (kind === 'killsaw') this.play([{ key: 'saw.whir', gain: 0.28, rate: jitter(0.04) }], pos, { send: 0.2 });
      else if (kind === 'pulverizer') this.play([{ key: 'pulv.hiss', gain: 0.4 }], pos, { send: 0.3 });
      else if (kind === 'ramrod') this.play([{ key: 'ramrod', gain: 0.4, rate: jitter(0.04) }], pos, { send: 0.3 });
      return;
    }
    if (kind === 'pulverizer') this.play([{ key: 'pulv.retract', gain: 0.35 }], pos, { send: 0.25 });
    else if (kind === 'ramrod') this.play([{ key: 'ramrod.retract', gain: 0.35 }], pos, { send: 0.2 });
  }

  /** The pulverizer slam lands when the hammer reaches the floor. */
  private hazardFrames(world: WorldFrame): void {
    for (const h of world.hazards) {
      if (h.kind !== 'pulverizer') continue;
      const prev = this.lastHazard.get(h.id) ?? 0;
      if (prev < 0.9 && h.state >= 0.9) {
        this.play([{ key: 'pulv.slam', gain: 0.5 }], HAZARD_POS.get(h.id) ?? null, { send: 0.45 });
        this.crowd.bump(0.1, null);
      }
      this.lastHazard.set(h.id, h.state);
    }
  }

  /** A weapon that fires and hits nothing gets an "aww" now and then. */
  private whiffs(world: WorldFrame): void {
    for (const [bot, t] of this.pendingFire) {
      if (world.t - t < 0.6) continue;
      this.pendingFire.delete(bot);
      const hitAt = this.lastHitBy.get(bot) ?? -1;
      if (hitAt < t - 0.05) this.crowd.whiff();
    }
  }

  private grindAt = 0;

  /** Grinding fades within ~0.15 s of the last grind event. Runs on the audio clock so it also
   *  decays when frames stop or arrive with dt = 0. */
  private updateGrind(): void {
    const t = this.ctx.currentTime;
    const dt = Math.max(0, t - this.grindAt);
    this.grindAt = t;
    const level = this.active ? this.grindTarget : 0;
    this.grindTarget *= Math.exp(-dt / 0.12);
    if (!this.grind && level > 0.02) {
      const buf = this.bank.get('grind.loop');
      if (!buf) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'peaking';
      bp.frequency.value = 2000;
      bp.gain.value = 0;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      const pan = this.ctx.createStereoPanner();
      src.connect(bp).connect(gain).connect(pan).connect(this.mixer.worldIn);
      src.start(t, Math.random() * buf.duration);
      this.grind = { src, gain, pan, bp, level: 0, idle: 0 };
    }
    const g = this.grind;
    if (!g) return;
    const place = this.listener.place(this.grindPos);
    const plastic = this.grindMat === 'uhmw' || this.grindMat === 'polycarb';
    g.gain.gain.setTargetAtTime(level * 0.35 * place.gain, t, 0.03);
    g.pan.pan.setTargetAtTime(place.pan, t, 0.03);
    g.bp.gain.setTargetAtTime(plastic ? -12 : this.grindMat === 'titanium' ? 4 : 0, t, 0.05);
    g.src.playbackRate.setTargetAtTime((plastic ? 0.7 : 1) * this.rate * (0.85 + 0.3 * level), t, 0.05);
    g.idle = level < 0.01 ? g.idle + dt : 0;
    if (dt === 0) return;
    if (g.idle > 3) {
      g.src.stop(t + 0.1);
      this.grind = null;
    }
  }

  /** Live node estimate, for the lab's CPU readout. */
  nodeCount(): number {
    return this.robots.size * 22 + this.shots.reduce((n, s) => n + 4 + s.srcs.length * 2, 0) + (this.grind ? 4 : 0) + this.crowd.nodeCount();
  }

  oneshotCount(): number {
    return this.shots.length;
  }
}

// -----------------------------------------------------------------------------------------
// Crowd

type Reaction = 'cheer' | 'ooh' | 'groan' | 'applause' | null;

export class Crowd {
  private loops: { src: AudioBufferSourceNode; g: GainNode; base: number }[] = [];
  private started = false;
  /** Excitement 0..1, driven by events and decaying back to the base level. */
  excitement = 0.15;
  private scripted = 0;
  private worldActive = true;
  private lastCheer = -10;
  private lastGroan = -10;
  private lastOoh = -10;
  private rate = 1;
  private oneshots: { src: AudioBufferSourceNode; g: GainNode }[] = [];
  /** Until this time the arena is stunned: no reactions, the beds pulled almost to nothing. */
  private hushUntil = -1;

  constructor(
    private ctx: BaseAudioContext,
    private bank: Bank,
    private mixer: Mixer,
  ) {}

  /** The crowd is part of the arena: it starts with the first world frame or a scripted level. */
  private armed = false;
  arm(): void {
    this.armed = true;
  }

  private ensure(): boolean {
    if (this.started) return true;
    if (!this.armed) return false;
    const murmur = this.bank.get('crowd.murmur');
    const roar = this.bank.get('crowd.roar');
    if (!murmur || !roar) return false;
    const t = this.ctx.currentTime;
    const add = (buf: AudioBuffer, rate: number, offset: number) => {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.value = rate;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      src.connect(g).connect(this.mixer.crowdIn);
      src.start(t, offset);
      this.loops.push({ src, g, base: rate });
      return g;
    };
    // Two copies of the bed at different speeds never line up, so the loop never repeats.
    add(murmur, 1, 0);
    add(murmur, 0.93, 5.3);
    add(roar, 1, 0);
    add(roar, 0.95, 4.1);
    this.started = true;
    return true;
  }

  setWorldActive(on: boolean): void {
    this.worldActive = on;
    this.gate();
  }

  private gateOn = true;
  private gateOffAt = 0;
  private crowdAttached = true;

  private gate(): void {
    const on = this.worldActive || this.scripted > 0;
    const t = this.ctx.currentTime;
    if (on && !this.crowdAttached) {
      this.mixer.attachCrowd();
      this.crowdAttached = true;
    }
    if (!on && this.gateOn) this.gateOffAt = t;
    this.gateOn = on;
    this.mixer.crowdGate.gain.setTargetAtTime(on ? 1 : 0, t, on ? 0.2 : 0.15);
  }

  /** Detach the crowd loops once they have faded out. */
  maintain(): void {
    if (!this.gateOn && this.crowdAttached && this.ctx.currentTime - this.gateOffAt > 1) {
      this.mixer.detachCrowd();
      this.crowdAttached = false;
    }
  }

  setRate(r: number): void {
    this.rate = r;
    const t = this.ctx.currentTime;
    for (const l of this.loops) l.src.playbackRate.setTargetAtTime(l.base * r, t, 0.1);
  }

  /** Scripted excitement floor (intro, ceremony). 0 hands control back to the action. */
  script(level: number): void {
    if (level > 0) this.armed = true;
    const was = this.scripted;
    this.scripted = clamp(level, 0, 1);
    if (this.scripted > this.excitement + 0.3 && this.scripted > was) this.react('cheer', this.scripted);
    this.excitement = Math.max(this.excitement, this.scripted);
    this.gate();
  }

  hit(e: HitEvent): void {
    const L = hitLevel(e);
    if (L > 0.75 || e.severity > 0.6) this.bump(0.2 + 0.4 * L, 'cheer');
    else if (L > 0.45) this.bump(0.08 + 0.2 * L, e.kind === 'spinner' || e.kind === 'axe' ? 'ooh' : null);
    else this.bump(0.03 + 0.05 * L, null);
  }

  whiff(): void {
    if (Math.random() < 0.6) this.bump(0, 'groan');
  }

  /** A stunned silence for `seconds`: cut reactions in flight, hold the beds down, then let the
   *  crowd come back up on its own. */
  hush(seconds: number): void {
    const t = this.ctx.currentTime;
    this.hushUntil = t + seconds;
    this.excitement = 0;
    for (const o of this.oneshots) {
      o.g.gain.cancelScheduledValues(t);
      o.g.gain.setTargetAtTime(0, t, 0.12);
      o.src.stop(t + 0.8);
    }
    this.update(0, null);
  }

  private hushed(): boolean {
    return this.ctx.currentTime < this.hushUntil;
  }

  bump(amount: number, reaction: Reaction): void {
    if (this.hushed()) return;
    this.excitement = clamp(this.excitement + amount, 0, 1);
    if (reaction) this.react(reaction, amount);
  }

  private react(r: Exclude<Reaction, null>, amount: number): void {
    if (this.hushed()) return;
    const now = this.ctx.currentTime;
    if (r === 'cheer' && now - this.lastCheer < 1.6) return;
    if (r === 'groan' && now - this.lastGroan < 4) return;
    if (r === 'ooh' && now - this.lastOoh < 2.5) return;
    const key = `crowd.${r}`;
    const buf = this.bank.get(key);
    if (!buf) return;
    if (r === 'cheer') this.lastCheer = now;
    if (r === 'groan') this.lastGroan = now;
    if (r === 'ooh') this.lastOoh = now;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = this.rate * (0.96 + Math.random() * 0.08);
    const g = this.ctx.createGain();
    g.gain.value = (r === 'applause' ? 0.9 : r === 'groan' ? 0.75 : 0.6) * (0.55 + 0.45 * clamp(amount * 1.5, 0, 1));
    src.connect(g).connect(this.mixer.crowdIn);
    src.start(now + 0.03);
    this.oneshots.push({ src, g });
    src.onended = () => {
      this.oneshots = this.oneshots.filter((s) => s.src !== src);
    };
    // Roars ride on top of a cheer.
    if (r === 'cheer' && amount > 0.6) {
      const app = this.bank.get('crowd.applause');
      if (app) {
        const a = this.ctx.createBufferSource();
        a.buffer = app;
        const ag = this.ctx.createGain();
        ag.gain.value = 0.35;
        a.connect(ag).connect(this.mixer.crowdIn);
        a.start(now + 0.4);
        this.oneshots.push({ src: a, g: ag });
        a.onended = () => {
          this.oneshots = this.oneshots.filter((s) => s.src !== a);
        };
      }
    }
  }

  update(dt: number, world: WorldFrame | null): void {
    if (!this.ensure()) return;
    const t = this.ctx.currentTime;
    const fighting = world?.match.phase === 'fight';
    const [m1, m2, r1, r2] = this.loops;
    if (this.hushed()) {
      // Stunned: a faint murmur, no roar. Excitement stays at zero and climbs back afterwards.
      this.excitement = 0;
      m1.g.gain.setTargetAtTime(0.07, t, 0.35);
      m2.g.gain.setTargetAtTime(0.05, t, 0.35);
      r1.g.gain.setTargetAtTime(0, t, 0.2);
      r2.g.gain.setTargetAtTime(0, t, 0.2);
      return;
    }
    const floor = Math.max(this.scripted, fighting ? 0.22 : 0.12);
    // Excitement falls back toward the floor over a few seconds.
    this.excitement = floor + (this.excitement - floor) * Math.exp(-dt / 2.2);
    const e = this.excitement;
    m1.g.gain.setTargetAtTime(0.4 + 0.25 * e, t, 0.3);
    m2.g.gain.setTargetAtTime(0.32 + 0.2 * e, t, 0.3);
    const roar = Math.pow(clamp((e - 0.15) / 0.85, 0, 1), 1.3);
    r1.g.gain.setTargetAtTime(0.85 * roar, t, 0.25);
    r2.g.gain.setTargetAtTime(0.6 * roar, t, 0.25);
    this.mixer.crowdLP.frequency.setTargetAtTime(1600 + 7000 * e, t, 0.3);
  }

  nodeCount(): number {
    return this.loops.length * 2 + this.oneshots.length * 2;
  }
}
