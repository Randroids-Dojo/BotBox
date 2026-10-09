// Audio module contract. Owned by the lead; the audio agent implements it in src/audio.

import type { BotSpec, MatchEvent, Quat, Vec3, WorldFrame } from '../contract';

export type MusicCue =
  | 'title' // the theme: big riff, for the title sequence and main menu
  | 'menu' // calmer loop for menus and bracket
  | 'pits' // workshop loop: tools, radio-rock feel
  | 'intro' // tension build under robot intros and the lights
  | 'fight' // fight bed, lower intensity, sits under voice and sfx
  | 'victory' // player won a fight
  | 'defeat' // player lost
  | 'bumper' // short commercial-break sting then silence
  | 'nut' // Giant Nut ceremony: full theme, triumphant
  | 'none';

export type Stinger =
  | 'logo' // chrome logo slam
  | 'whoosh' // graphics wipe
  | 'lights' // one lamp of the light tree
  | 'go' // green light and start horn
  | 'ko' // knockout buzzer
  | 'time' // end of time buzzer
  | 'decision' // judges' card reveal
  | 'replay' // "Bot Replay" wipe
  | 'stamp' // result stamp
  | 'crowd_roar'; // one-off big crowd reaction

export type UiSound = 'move' | 'select' | 'back' | 'error' | 'buy' | 'repair' | 'tick' | 'type';

export interface Volumes {
  master: number;
  music: number;
  sfx: number;
  voice: number;
}

export interface AudioEngine {
  /** Create or resume the AudioContext. Call from pointerup, touchend, click or keydown. */
  unlock(): void;
  readonly unlocked: boolean;
  /** Robots in the arena, for motor and weapon voices. */
  setEntrants(entrants: { id: string; spec: BotSpec }[]): void;
  /** World sound: motors, spinners, impacts, grinding, hazards, crowd. `dt` is real seconds. */
  frame(world: WorldFrame, events: MatchEvent[], listener: { pos: Vec3; quat: Quat }, dt: number): void;
  /** Silence world sound (menus, pause). */
  setWorldActive(active: boolean): void;
  /** Slow motion: pitch and filter world sound by the sim time scale. */
  setTimeScale(s: number): void;
  music(cue: MusicCue, fadeSec?: number): void;
  stinger(id: Stinger): void;
  ui(id: UiSound): void;
  /** Play a recorded line by id from public/voice/manifest.json. Ducks music and crowd.
   *  Resolves true when it finishes, false if it was missing, interrupted or skipped. */
  voice(id: string, opts?: { interrupt?: boolean }): Promise<boolean>;
  voiceBusy(): boolean;
  stopVoice(): void;
  /** Ids available in the voice manifest (empty until loaded). */
  voiceIds(): string[];
  /** Text and speaker for a voice line, for captions. */
  voiceLine(id: string): { text: string; speaker: string; dur: number } | undefined;
  /** Crowd excitement override 0..1 for scripted moments (intro, ceremony). */
  crowd(level: number): void;
  setVolumes(v: Volumes): void;
}
