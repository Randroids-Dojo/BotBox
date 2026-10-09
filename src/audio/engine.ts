// The engine core on a given AudioContext (live) or OfflineAudioContext (renders and tests).

import type { BotSpec, MatchEvent, Quat, Vec3, WorldFrame } from '../contract';
import type { Bank } from './bank';
import { Mixer } from './mixer';
import { MusicPlayer } from './music/player';
import type { MusicCue, Stinger, UiSound, Volumes } from './types';
import { VoicePlayer, type VoiceManifest } from './voice';
import { World } from './world';

const STINGER_GAIN: Partial<Record<Stinger, number>> = { lights: 0.45, whoosh: 0.4, replay: 0.5, stamp: 0.55, logo: 0.7, go: 0.7, ko: 0.65, time: 0.6, decision: 0.6, heartbreak: 0.72, cash: 0.5, rankup: 0.55, unlock: 0.5 };
const UI_GAIN: Partial<Record<UiSound, number>> = { move: 0.5, tick: 0.45, type: 0.35 };

export class Core {
  readonly mixer: Mixer;
  readonly world: World;
  readonly music: MusicPlayer;
  readonly voice: VoicePlayer;
  private lastStinger = new Map<Stinger, number>();
  private lastUi = new Map<UiSound, number>();
  private lastFrameAt = -1;
  private lastTick = -1;

  constructor(
    readonly ctx: BaseAudioContext,
    readonly bank: Bank,
    manifest: VoiceManifest,
    out?: AudioNode,
  ) {
    this.mixer = new Mixer(ctx, out);
    this.world = new World(ctx, bank, this.mixer);
    this.world.onStinger = (id) => this.stinger(id);
    this.music = new MusicPlayer(ctx, bank, this.mixer.musicIn);
    this.voice = new VoicePlayer(ctx, this.mixer, manifest);
  }

  setEntrants(e: { id: string; spec: BotSpec }[]): void {
    this.world.setEntrants(e);
  }

  frame(world: WorldFrame, events: MatchEvent[], listener: { pos: Vec3; quat: Quat }, dt: number): void {
    this.lastFrameAt = this.ctx.currentTime;
    this.world.frame(world, events, listener, Math.min(0.25, Math.max(0, dt)));
    this.music.pump();
  }

  /** Housekeeping on a timer: music scheduling, and the crowd when no frames arrive. */
  tick(lookahead = 0.3): void {
    const now = this.ctx.currentTime;
    const dt = this.lastTick < 0 ? 0 : Math.min(0.5, now - this.lastTick);
    this.lastTick = now;
    this.music.pump(lookahead);
    if (now - this.lastFrameAt > 0.2) this.world.crowd.update(dt, null);
    this.world.maintain();
  }

  stinger(id: Stinger): void {
    const now = this.ctx.currentTime;
    // Arena events trigger some stingers by themselves; a director call right after is a duplicate.
    const last = this.lastStinger.get(id) ?? -10;
    if (now - last < 0.5) return;
    this.lastStinger.set(id, now);
    if (id === 'crowd_roar') {
      this.world.crowd.bump(1, 'cheer');
      return;
    }
    this.oneshot(`st.${id}`, this.mixer.uiIn, STINGER_GAIN[id] ?? 0.6);
    if (id === 'go') this.world.crowd.bump(0.6, 'cheer');
    // The stinger carries its own gasp; the arena falls silent under it.
    if (id === 'heartbreak') this.world.crowd.hush(7);
  }

  ui(id: UiSound): void {
    const now = this.ctx.currentTime;
    if (now - (this.lastUi.get(id) ?? -1) < 0.025) return;
    this.lastUi.set(id, now);
    this.oneshot(`ui.${id}`, this.mixer.uiIn, UI_GAIN[id] ?? 0.8, id === 'move' || id === 'type' ? 0.04 : 0);
  }

  private oneshot(key: string, dest: AudioNode, gain: number, detune = 0): void {
    const buf = this.bank.get(key);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    if (detune) src.playbackRate.value = 1 + (Math.random() * 2 - 1) * detune;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(dest);
    src.start(this.ctx.currentTime + 0.003);
  }

  musicCue(cue: MusicCue, fade?: number): void {
    this.music.play(cue, fade ?? 1);
  }

  setVolumes(v: Volumes): void {
    this.mixer.setVolumes(v);
  }
}
