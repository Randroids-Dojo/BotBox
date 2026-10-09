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
  PartKey,
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

/** Main menu for returning players: Career (the workshop), Quick fight, Settings, Credits.
 *  The older choices remain valid values but the menu no longer offers them. */
export type MainMenuChoice = 'career' | 'quick' | 'continue' | 'season' | 'exhibition' | 'garage' | 'settings' | 'credits';

export interface SaveSummary {
  /** The career in progress, for the Career button ("Juggernaut. Rank #43. $350"). */
  career: string | null;
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

/** Garage categories, also used to mark empty slots during the guided first rebuild. */
export type GarageCategory = 'chassis' | 'drive' | 'power' | 'weapon' | 'armor' | 'extras' | 'paint' | 'name';

/** The career store inside the garage. Every part shows its price; owned parts are free to
 *  swap; a part the player does not own is bought the moment it is fitted (confirm first);
 *  parts above the current tier are visible but locked with a reason. */
export interface CareerShop {
  funds: number;
  owned: PartKey[];
  /** Price for every part key. */
  prices: Record<PartKey, number>;
  /** Locked parts and why ("Unlocks at the Regionals"). */
  locked: Partial<Record<PartKey, string>>;
  /** Buy a part. Returns the new funds, or null if refused (cannot afford, locked). */
  buy(key: PartKey): number | null;
  /** Repairs cost money in a career: dollars per 10 percent restored, from funds. */
  repairPer10: number;
  /** Health below this fraction is patched for free (already applied to the damage passed in). */
  freePatch: number;
}

export interface GarageContext {
  /** build: free editing, any class. pits: between season fights, repairs and limited refit.
   *  career: the workshop garage, with prices, buying and paid repairs (see `career`). */
  mode: 'build' | 'pits' | 'career';
  /** Career store (mode 'career'). Pit-style refit costs and repair points do not apply. */
  career?: CareerShop;
  /** Guided first rebuild: these slots start empty and must be filled in this order. The UI
   *  walks the player through them with a coach mark, shows EMPTY on the tabs, and keeps Done
   *  disabled until all are filled. The preview receives the still-missing slots. */
  guided?: GarageCategory[];
  loadout: Loadout;
  /** Locked in pits. */
  classLocked: boolean;
  damage?: Damage;
  repairPoints?: number;
  /** The next opponent, for the scouting card. */
  opponent?: RivalSummary;
  /** Ask the stage to show this loadout (with damage) on the workshop turntable. */
  preview(loadout: Loadout, damage?: Damage, missing?: GarageCategory[]): void;
  orbit(dx: number, dy: number): void;
}

export interface GarageResult {
  loadout: Loadout;
  damage?: Damage;
  /** Career: funds left after purchases and repairs, and what was bought. */
  funds?: number;
  bought?: PartKey[];
}

// ---- career screens

export interface WorkshopView {
  robot: { name: string; spec: BotSpec };
  funds: number;
  /** null is unranked. */
  rank: number | null;
  record: { w: number; l: number };
  act: { title: string; subtitle: string; index: number; total: number };
  /** The next campaign fight, or null when the career is complete. */
  next: { title: string; opponent: RivalSummary; prize: number; blurb: string } | null;
  /** Robot has damage worth repairing. */
  damaged: boolean;
  /** A repeatable exhibition for cash, once unlocked. */
  sideGig: { title: string; opponent: RivalSummary; prize: number } | null;
  /** One-line ticker: news, unlocks, a nudge ("New in the store: NiCad packs"). */
  news: string | null;
  /** Workshop level 0..3 (storage unit to pro shop), for styling. */
  tier: 0 | 1 | 2 | 3;
}

export type WorkshopChoice = 'fight' | 'build' | 'sidegig' | 'career' | 'menu';

export interface CareerView {
  acts: {
    title: string;
    subtitle: string;
    fights: { title: string; opponent: string; prize: number; state: 'won' | 'next' | 'locked'; result: string | null }[];
  }[];
  /** Top ten plus the player if outside it. */
  rankings: { rank: number; name: string; you: boolean }[];
  funds: number;
  earnings: number;
  record: { w: number; l: number };
}

export interface RewardsView {
  won: boolean;
  /** Purse paid (0 on a loss). */
  prize: number;
  fundsBefore: number;
  fundsAfter: number;
  rankBefore: number | null;
  rankAfter: number | null;
  /** New parts in the store, by label. */
  unlocks: string[];
  /** Set when this win finished an act. */
  actComplete: { title: string; next: string } | null;
  /** A short line under the numbers ("Rematch any time. Repairs are waiting in the garage."). */
  note: string | null;
}

/** One beat of the prologue montage: TV graphics over the 3D shot the director sets up. */
export interface MontageCard {
  /** headline: a newspaper or TV news banner. result: a loss on the scoreboard ticker. rank: the
   *  rankings slide (from rank to rank, null is unranked). */
  kind: 'headline' | 'result' | 'rank';
  title: string;
  sub?: string;
  result?: { opponent: string; method: string };
  rank?: { from: number | null; to: number | null };
  /** Seconds on screen. */
  sec: number;
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

  // ---- career
  workshop(view: WorkshopView): Promise<WorkshopChoice>;
  career(view: CareerView): Promise<void>;
  rewards(view: RewardsView): Promise<void>;
  /** A montage beat (fire and forget the graphic; resolves after card.sec). */
  montage(card: MontageCard): Promise<void>;
  /** Story text on black ("Two seasons later."), resolves after sec. */
  story(lines: string[], sec: number): Promise<void>;
  /** A coach prompt for the prologue and first rebuild: short text plus a device-aware key or
   *  button hint (action names: 'drive', 'weapon', 'selfRight', 'camera'), or null to clear. */
  coach(text: string | null, action?: 'drive' | 'weapon' | 'selfRight' | 'camera'): void;
}
