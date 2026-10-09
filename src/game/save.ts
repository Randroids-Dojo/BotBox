// Settings and the season in progress, kept in localStorage.

import type { Component, Facet, Loadout, WeightClass } from '../contract';
import type { Settings } from '../ui/types';

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

export function load(): SaveData {
  const fresh: SaveData = { settings: defaultSettings(), robot: null, season: null, nuts: {}, fights: 0 };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh;
    const d = JSON.parse(raw) as Partial<SaveData>;
    return {
      settings: { ...fresh.settings, ...(d.settings ?? {}), volumes: { ...fresh.settings.volumes, ...(d.settings?.volumes ?? {}) } },
      robot: d.robot ?? null,
      season: d.season ?? null,
      nuts: d.nuts ?? {},
      fights: d.fights ?? 0,
    };
  } catch {
    return fresh;
  }
}

export function store(d: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // Private mode or full storage: the game still runs, it just forgets.
  }
}
