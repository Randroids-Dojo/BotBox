// Settings, the career save slots and the season in progress, kept in localStorage.

import type { Component, Facet, Loadout, WeightClass } from '../contract';
import type { Settings } from '../ui/types';
import type { CareerSave } from './career';

const KEY = 'botbox:v1';

export interface BracketMatchSave {
  a: string | null;
  b: string | null;
  winner: string | null;
  result: string | null;
}

export interface SeasonSave {
  cls: WeightClass;
  /** Rival ids in bracket order; 'player' is the player's slot. */
  rounds: BracketMatchSave[][];
  /** Player's damage carried into the next fight. */
  damage: { facets: Record<Facet, number>; parts: Record<Component, number> } | null;
  /** Player's loadout for this season (refits change it). */
  loadout: Loadout;
  done: boolean;
  champion: boolean;
}

export interface SaveData {
  settings: Settings;
  robot: Loadout | null;
  season: SeasonSave | null;
  /** Career save slots (always SLOTS long; null is empty). */
  slots: (CareerSave | null)[];
  /** The slot being played. */
  slot: number;
  /** The career being played: `slots[slot]`, kept in step by the director. Not stored twice. */
  career: CareerSave | null;
  /** The championship prologue has been seen at least once (a new game may skip it). */
  seenIntro: boolean;
  nuts: Partial<Record<WeightClass, number>>;
  fights: number;
}

export function defaultSettings(): Settings {
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return {
    volumes: { master: 0.9, music: 0.6, sfx: 0.9, voice: 1 },
    camera: 'chase',
    drive: 'robot',
    quality: 'auto',
    cinematicHits: true,
    subtitles: true,
    broadcastFilter: true,
    commentary: true,
    matchLength: touch ? 120 : 180,
  };
}

export const SLOTS = 3;

type Stored = Partial<SaveData> & { career?: CareerSave | null };

/** Bring any stored shape up to date: a single pre-slots career moves into slot 1. */
export function migrate(d: Stored): Pick<SaveData, 'slots' | 'slot' | 'career' | 'seenIntro'> {
  const slots: (CareerSave | null)[] = Array.from({ length: SLOTS }, (_, i) => d.slots?.[i] ?? null);
  if (!d.slots && d.career) slots[0] = d.career;
  const slot = Math.max(0, Math.min(SLOTS - 1, Math.floor(d.slot ?? 0)));
  return {
    slots,
    slot,
    career: slots[slot],
    seenIntro: d.seenIntro ?? slots.some((c) => !!c?.prologueDone),
  };
}

export function load(): SaveData {
  const fresh: SaveData = { settings: defaultSettings(), robot: null, season: null, ...migrate({}), nuts: {}, fights: 0 };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const d = JSON.parse(raw) as Stored;
    return {
      settings: { ...fresh.settings, ...(d.settings ?? {}), volumes: { ...fresh.settings.volumes, ...(d.settings?.volumes ?? {}) } },
      robot: d.robot ?? null,
      season: d.season ?? null,
      ...migrate(d),
      nuts: d.nuts ?? {},
      fights: d.fights ?? 0,
    };
  } catch {
    return fresh;
  }
}

export function store(d: SaveData): void {
  try {
    // The active career lives in its slot; storing it twice would let the copies drift.
    localStorage.setItem(KEY, JSON.stringify({ ...d, career: undefined }));
  } catch {
    // Private mode or full storage: the game still runs, it just forgets.
  }
}
