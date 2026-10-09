// Broadcast UI contract. Owned by the lead; the UI agent implements it in src/ui.
// The UI is DOM over the WebGL canvas. Menus resolve promises; the broadcast package (lower
// thirds, captions, HUD, banners) is fire-and-forget. Every menu works with mouse, touch,
// keyboard and gamepad (gamepad and keyboard arrive through Input.onMenu).

import type { Volumes } from '../audio/types';
import type {
  BotCard,
  BotSpec,
  BotStats,
  Component,
  Corner,
  Facet,
  JudgeCard,
  Loadout,
  MatchResult,
  WeightClass,
  WorldFrame,
} from '../contract';
import type { CameraMode, Quality } from '../render/types';

export type DriveMode = 'robot' | 'camera' | 'tank';

export interface Settings {
  volumes: Volumes;
  camera: CameraMode;
  drive: DriveMode;
  quality: Quality | 'auto';
  /** Slow-motion beats and impact cuts on big hits. */
  cinematicHits: boolean;
  subtitles: boolean;
  /** Grain and broadcast softness. */
  broadcastFilter: boolean;
  /** Commentary voice lines during fights. */
  commentary: boolean;
  /** Exhibition fight length, seconds. Season fights are always 180. */
  matchLength: 120 | 180 | 300;
}

export interface Damage {
  facets: Record<Facet, number>;
  parts: Record<Component, number>;
}

export type MainMenuChoice = 'continue' | 'season' | 'exhibition' | 'garage' | 'settings' | 'credits';

export interface SaveSummary {
  /** A season in progress, described for the menu ("Heavyweight semifinal vs Flapjack"). */
  season: string | null;
  /** Giant Nuts won, per class. */
  nuts: Partial<Record<WeightClass, number>>;
  /** The player's robot, if one has been built. */
  robot: Loadout | null;
}

export interface RivalSummary {
  id: string;
  card: BotCard;
  cls: WeightClass;
  spec: BotSpec;
  style: string;
  seed: number;
}

export interface ExhibitionConfig {
  /** duel: player vs one rival; rumble: player plus 2 or 3 rivals; watch: rivals only. */
  mode: 'duel' | 'rumble' | 'watch';
  cls: WeightClass;
  /** Rival ids. Duel: 1. Rumble: 2 or 3. Watch: 2. */
  rivals: string[];
  /** Use a rival's robot instead of the player's own (duel and rumble). */
  playerRival: string | null;
}

export interface GarageContext {
  /** build: free editing, any class. pits: between season fights, repairs and limited refit. */
  mode: 'build' | 'pits';
  loadout: Loadout;
  /** Locked in pits. */
  classLocked: boolean;
  damage?: Damage;
  repairPoints?: number;
  /** The next opponent, for the scouting card. */
  opponent?: RivalSummary;
  /** Ask the stage to show this loadout (with damage) on the workshop turntable. */
  preview(loadout: Loadout, damage?: Damage): void;
  orbit(dx: number, dy: number): void;
}

export interface GarageResult {
  loadout: Loadout;
  damage?: Damage;
}

export interface BracketSlot {
  id: string;
  name: string;
  player: boolean;
}

export interface BracketMatch {
  a: BracketSlot | null;
  b: BracketSlot | null;
  winner: string | null;
  /** "KO 1:42" or "31-14". */
  result: string | null;
}

export interface BracketView {
  cls: WeightClass;
  rounds: { label: string; matches: BracketMatch[] }[];
  /** Round and match index of the player's next fight, or null when the bracket is done. */
  next: { round: number; match: number } | null;
}

export interface LowerThird {
  corner: Corner;
  card: BotCard;
  stats: BotStats;
  weaponShort: string;
  classLabel: string;
}

export interface HudEntrant {
  id: string;
  name: string;
  corner: Corner;
  spec: BotSpec;
  player: boolean;
}

export type BannerKind = 'fight' | 'ko' | 'time' | 'replay' | 'release' | 'tapout' | 'winner' | 'flipped' | 'fire';

export type Speaker = 'Vic' | 'Dale' | 'Chuck' | 'Jenna' | 'Builder';

export interface DecisionView {
  judges: JudgeCard[];
  totals: Record<string, number>;
  winner: string;
  entrants: { id: string; name: string; corner: Corner }[];
}

export interface BroadcastUI {
  /** Mount into the overlay root. */
  init(root: HTMLElement): void;

  loading(progress: number, label?: string): void;
  loaded(): void;

  /** PRESS START over the title scene. */
  title(): Promise<void>;
  mainMenu(save: SaveSummary): Promise<MainMenuChoice>;
  pickClass(title: string): Promise<WeightClass | null>;
  exhibition(rivals: RivalSummary[], hasRobot: boolean): Promise<ExhibitionConfig | null>;
  garage(ctx: GarageContext): Promise<GarageResult | null>;
  bracket(view: BracketView, opponent: RivalSummary | null): Promise<void>;
  settings(current: Settings): Promise<Settings>;
  credits(): Promise<void>;
  pause(canTapOut: boolean): Promise<'resume' | 'tapout' | 'settings' | 'quit'>;

  /** Full-screen broadcast slate: "QUARTERFINAL", "TONIGHT ON BOTBOX". Resolves after `sec`. */
  slate(title: string, sub: string | null, sec: number): Promise<void>;
  /** "BOTBOX will be right back" bumper. */
  bumper(): Promise<void>;
  decision(view: DecisionView): Promise<void>;
  interview(lines: { speaker: Speaker; text: string }[]): Promise<void>;
  /** End of a fight: result, damage taken, what happens next. */
  result(r: { won: boolean; headline: string; detail: string; result: MatchResult }): Promise<void>;
  /** Giant Nut ceremony overlay over the trophy scene. */
  ceremony(card: BotCard, cls: WeightClass): Promise<void>;
  /** Season over (lost). */
  eliminated(card: BotCard, round: string): Promise<void>;

  // ---- fire-and-forget broadcast package
  lowerThird(info: LowerThird | null): void;
  caption(speaker: Speaker | null, text?: string): void;
  /** Network bug in the corner with the show logo. */
  bug(show: boolean): void;
  /** In-fight HUD: clock, light tree, damage schematics, weapon status, KO and hold counts. */
  hud(entrants: HudEntrant[] | null): void;
  hudFrame(world: WorldFrame): void;
  banner(kind: BannerKind, text?: string): void;
  /** "BOT REPLAY" frame and tint while a replay plays. */
  replayFrame(on: boolean): void;
  /** On-screen touch controls for fights. */
  touchControls(opts: { weaponLabel: string; selfRight: boolean } | null): void;
  /** Little "skip" hint shown during cinematics; resolves when the player skips. */
  skippable(on: boolean): void;
}
