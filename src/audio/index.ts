// BotBox audio. Everything except the recorded voice lines is synthesized in the browser.
//
// Usage (the director):
//   const audio = createAudioEngine();          // at boot; starts rendering the sample bank
//   el.addEventListener('pointerup', () => audio.unlock());   // and touchend, click, keydown
//   audio.music('title');                        // safe before unlock: starts once unlocked
//   audio.setEntrants(entrants); audio.frame(world, events, camera, dt)   // every rendered frame
//
// Notes for integration
// - unlock(): Chrome on Android only grants audio from pointerup, touchend, click or keydown,
//   not pointerdown or touchstart. Call it from those, on every gesture until `unlocked` is true.
// - Arena events in frame() play their own stingers: 'lights' (lamps 1 to 3), 'go' (green lamp or
//   fight_start), 'ko', 'time' (time_up). A stinger() call for the same id within 0.5 s is
//   ignored, so calling both is harmless.
// - The crowd reacts to events on its own. crowd(level) sets a scripted floor (0..1) that keeps
//   the crowd audible even with setWorldActive(false), for intros and the ceremony; crowd(0)
//   hands it back to the action.
// - setTimeScale(s) is the slow-motion control; WorldFrame.match.timeScale is not read.
// - Volumes are linear gains 0..1. UI and stingers follow `sfx`.

import type { BotSpec, MatchEvent, Quat, Vec3, WorldFrame } from '../contract';
import { Bank } from './bank';
import { Core } from './engine';
import { cueKeys } from './music/player';
import { defineCrowd } from './sounds/crowd';
import { defineSfx } from './sounds/sfx';
import { defineShow } from './sounds/show';
import type { AudioEngine, MusicCue, Stinger, UiSound, Volumes } from './types';
import { VoiceManifest } from './voice';

export type { AudioEngine } from './types';

/** Define every effect, stinger, UI sound and crowd texture on a bank. */
export function defineAll(bank: Bank): void {
  defineShow(bank);
  defineSfx(bank);
  defineCrowd(bank);
}

/** Render order at boot: what the title screen needs first. */
export function warmBank(bank: Bank, firstCue: Exclude<MusicCue, 'none'> = 'title'): Promise<void> {
  const music = (cue: Exclude<MusicCue, 'none'>) => cueKeys(bank, cue);
  const first = [...bank.ids('ui.'), 'st.logo', 'st.whoosh', ...music(firstCue)];
  // A first launch goes from the title straight into the prologue, so it comes next.
  return bank
    .ensure(first)
    .then(() => bank.ensure(music('prologue')))
    .then(() => bank.ensure([...bank.ids('st.'), ...bank.ids('crowd.')]))
    .then(() => bank.ensure(bank.ids().filter((k) => !k.startsWith('m.'))))
    .then(() => bank.ensure([...music('montage'), ...music('workshop')]))
    .then(() => bank.ensure([...music('menu'), ...music('intro'), ...music('fight')]));
}

class LiveAudio implements AudioEngine {
  private ctx: AudioContext | null = null;
  private core: Core | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  readonly bank = new Bank(48000, 3);
  readonly manifest = new VoiceManifest();
  private state: {
    entrants: { id: string; spec: BotSpec }[];
    volumes: Volumes | null;
    cue: MusicCue;
    fade: number;
    worldActive: boolean;
    timeScale: number;
    crowd: number;
  } = { entrants: [], volumes: null, cue: 'none', fade: 1, worldActive: true, timeScale: 1, crowd: 0 };

  constructor() {
    defineAll(this.bank);
    void warmBank(this.bank);
  }

  get unlocked(): boolean {
    return this.ctx?.state === 'running';
  }

  unlock(): void {
    if (!this.ctx) {
      let ctx: AudioContext;
      try {
        ctx = new AudioContext({ latencyHint: 'interactive' });
      } catch (e) {
        console.warn('audio: no Web Audio', e);
        return;
      }
      this.ctx = ctx;
      const core = new Core(ctx, this.bank, this.manifest);
      this.core = core;
      const s = this.state;
      core.setEntrants(s.entrants);
      if (s.volumes) core.setVolumes(s.volumes);
      core.world.setActive(s.worldActive);
      core.world.setTimeScale(s.timeScale);
      if (s.crowd) core.world.crowd.script(s.crowd);
      if (s.cue !== 'none') core.musicCue(s.cue, Math.min(s.fade, 0.5));
      this.timer = setInterval(() => this.core?.tick(document.hidden ? 1.5 : 0.3), 50);
    }
    const ctx = this.ctx;
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
    // A silent blip: some mobile browsers only unlock once a source has played in the gesture.
    const b = ctx.createBuffer(1, 1, ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.connect(ctx.destination);
    src.start();
  }

  setEntrants(entrants: { id: string; spec: BotSpec }[]): void {
    this.state.entrants = entrants;
    this.core?.setEntrants(entrants);
  }

  frame(world: WorldFrame, events: MatchEvent[], listener: { pos: Vec3; quat: Quat }, dt: number): void {
    if (this.unlocked) this.core?.frame(world, events, listener, dt);
  }

  setWorldActive(active: boolean): void {
    this.state.worldActive = active;
    this.core?.world.setActive(active);
  }

  setTimeScale(s: number): void {
    this.state.timeScale = s;
    this.core?.world.setTimeScale(s);
  }

  music(cue: MusicCue, fadeSec = 1): void {
    this.state.cue = cue;
    this.state.fade = fadeSec;
    this.core?.musicCue(cue, fadeSec);
  }

  stinger(id: Stinger): void {
    if (this.unlocked) this.core?.stinger(id);
  }

  ui(id: UiSound): void {
    if (this.unlocked) this.core?.ui(id);
  }

  voice(id: string, opts?: { interrupt?: boolean }): Promise<boolean> {
    if (!this.core || !this.unlocked) return Promise.resolve(false);
    return this.core.voice.play(id, !!opts?.interrupt);
  }

  voiceBusy(): boolean {
    return this.core?.voice.busy() ?? false;
  }

  stopVoice(): void {
    this.core?.voice.stop();
  }

  voiceIds(): string[] {
    return this.manifest.ids();
  }

  voiceLine(id: string): { text: string; speaker: string; dur: number } | undefined {
    const l = this.manifest.lines[id];
    return l ? { text: l.text, speaker: l.speaker, dur: l.dur } : undefined;
  }

  crowd(level: number): void {
    this.state.crowd = level;
    this.core?.world.crowd.script(level);
  }

  setVolumes(v: Volumes): void {
    this.state.volumes = v;
    this.core?.setVolumes(v);
  }

  /** Lab and debugging. */
  debug(): { core: Core | null; bank: Bank; ctx: AudioContext | null } {
    return { core: this.core, bank: this.bank, ctx: this.ctx };
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    void this.ctx?.close();
    this.ctx = null;
    this.core = null;
  }
}

export function createAudioEngine(): AudioEngine & { debug: LiveAudio['debug']; dispose(): void; readonly manifest: VoiceManifest } {
  return new LiveAudio();
}

export { Bank } from './bank';
export { Core } from './engine';
export { VoiceManifest } from './voice';
