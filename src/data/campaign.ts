// The career: the champion you were, the robot that ended you, the ladder back up, and the
// economy. Story and tuning notes live in docs/CAMPAIGN.md.

import type { Loadout, PartKey } from '../contract';
import { ROSTER, type Rival } from './roster';

export const PLAYER_TEAM = {
  team: 'Team Juggernaut',
  hometown: 'Oakland, California',
  builders: 'You, and whoever still returns your calls',
};

/** Juggernaut at its peak: the three-time champion you play in the prologue. */
export const JUGGERNAUT_PRIME: Loadout = {
  name: 'Juggernaut',
  cls: 'heavy',
  chassis: 'box',
  drive: 'chair4',
  power: 'nicad',
  weapon: 'vdisk',
  armor: { material: 'titanium', grade: 2 },
  extras: ['wheelguards', 'srimech'],
  paint: { primary: '#14161a', secondary: '#d4a017', accent: '#e8e8e8', pattern: 'stripes', finish: 'gloss', decal: 'CHAMP' },
};

/** What is left two seasons later: a bent frame, a box of scrap and the self-righting arm
 *  nobody wanted to buy. No weapon. */
export const SCRAP_LOADOUT: Loadout = {
  name: 'Juggernaut',
  cls: 'heavy',
  chassis: 'box',
  drive: 'drill2',
  power: 'sla',
  weapon: 'none',
  armor: { material: 'aluminum', grade: 1 },
  extras: ['wedgeplate', 'srimech'],
  paint: { primary: '#5a5148', secondary: '#2a2a2a', accent: '#d4a017', pattern: 'solid', finish: 'raw', decal: 'JUG' },
};

/** Parts the player owns at the start of the climb. */
export const STARTING_OWNED: PartKey[] = [
  'chassis:box',
  'drive:drill2',
  'power:sla',
  'weapon:none',
  'armor:aluminum',
  'extra:wedgeplate',
  'extra:srimech',
];

/** Price and store tier for every part (tier 0 is available from the start). */
export const PART_PRICES: Record<PartKey, { price: number; tier: 0 | 1 | 2 | 3 }> = {
  'chassis:box': { price: 0, tier: 0 },
  'chassis:wedge': { price: 400, tier: 0 },
  'chassis:invertible': { price: 1500, tier: 1 },
  'chassis:shell': { price: 3000, tier: 3 },
  'drive:drill2': { price: 0, tier: 0 },
  'drive:chair4': { price: 900, tier: 1 },
  'drive:mag2': { price: 2200, tier: 2 },
  'drive:skid6': { price: 3200, tier: 2 },
  'power:sla': { price: 0, tier: 0 },
  'power:nicad': { price: 600, tier: 1 },
  'power:nimh': { price: 2400, tier: 2 },
  'weapon:none': { price: 0, tier: 0 },
  'weapon:lifter': { price: 800, tier: 1 },
  'weapon:drum': { price: 1300, tier: 1 },
  'weapon:vdisk': { price: 1500, tier: 1 },
  'weapon:axe': { price: 2000, tier: 2 },
  'weapon:flipper': { price: 2600, tier: 2 },
  'weapon:hbar': { price: 3000, tier: 2 },
  'weapon:shell': { price: 4000, tier: 3 },
  'armor:aluminum': { price: 0, tier: 0 },
  'armor:polycarb': { price: 150, tier: 0 },
  'armor:uhmw': { price: 250, tier: 0 },
  'armor:steel': { price: 1200, tier: 1 },
  'armor:titanium': { price: 2800, tier: 2 },
  'extra:wedgeplate': { price: 0, tier: 0 },
  'extra:spikes': { price: 120, tier: 0 },
  'extra:skirts': { price: 250, tier: 0 },
  'extra:wheelguards': { price: 350, tier: 0 },
  // A box that gets flipped is counted out. The first thing worth saving for.
  'extra:srimech': { price: 900, tier: 0 },
};

export type ActId = 'scrapyard' | 'regionals' | 'show' | 'championship';
export type Presentation = 'minimal' | 'regional' | 'broadcast';

export interface Act {
  id: ActId;
  title: string;
  subtitle: string;
  /** Store tier unlocked when the act begins. */
  tier: 0 | 1 | 2 | 3;
  presentation: Presentation;
  /** Dollars per 10 percent repaired. */
  repairPer10: number;
  /** Crowd level 0..1. */
  crowd: number;
}

export const ACTS: Act[] = [
  { id: 'scrapyard', title: 'The Scrapyard Circuit', subtitle: 'Tuesday nights. Folding chairs. No cameras.', tier: 0, presentation: 'minimal', repairPer10: 5, crowd: 0.25 },
  { id: 'regionals', title: 'Regionals', subtitle: 'Taped for the regional broadcast.', tier: 1, presentation: 'regional', repairPer10: 15, crowd: 0.55 },
  { id: 'show', title: 'The Show', subtitle: 'BotBox. Prime time. Everyone is watching.', tier: 2, presentation: 'broadcast', repairPer10: 35, crowd: 0.8 },
  { id: 'championship', title: 'The Championship', subtitle: 'The rematch.', tier: 3, presentation: 'broadcast', repairPer10: 35, crowd: 1 },
];

/** Health below this fraction is patched for free between fights. */
export const FREE_PATCH = 0.4;

export interface CampaignFight {
  id: string;
  act: ActId;
  /** Rival id (roster, career bots or the nemesis). */
  opponent: string;
  /** Event name on the card and slate. */
  title: string;
  prize: number;
  /** Player's rank after winning. */
  rankAfter: number;
  /** Rival skill for this fight (rivals sharpen as you climb). */
  skill: number;
  /** One line shown on the next-fight card. */
  blurb: string;
  /** The rival as it ran that night, when it differs from its roster build (regional robots
   *  run cheaper armor and batteries than their prime-time versions). */
  tweak?: Partial<Pick<Loadout, 'armor' | 'power' | 'drive' | 'extras'>>;
}

// ---- new robots for the career

function careerRival(id: string, card: Rival['card'], loadout: Omit<Loadout, 'name'>, style: Rival['style'], skill: number): Rival {
  return { id, card: { ...card, voiceId: id }, loadout: { ...loadout, name: card.name }, style, skill, seed: 99 };
}

export const NEMESIS: Rival = careerRival(
  'terminal-velocity',
  {
    name: 'Terminal Velocity',
    team: 'Team Apex',
    hometown: 'Boston, Massachusetts',
    builders: 'Victoria Kane and a graduate lab',
    blurb: 'A titanium bar spinning at highway speed. It ended Juggernaut in one hit.',
    record: '18-0',
  },
  {
    cls: 'heavy',
    chassis: 'invertible',
    drive: 'chair4',
    power: 'nicad',
    weapon: 'hbar',
    armor: { material: 'titanium', grade: 2 },
    extras: ['srimech'],
    paint: { primary: '#0b0b10', secondary: '#c0172f', accent: '#f2f2f2', pattern: 'stripes', finish: 'gloss', decal: 'TV' },
  },
  'spinner',
  0.95,
);

export const CAREER_BOTS: Rival[] = [
  careerRival(
    'doorstop',
    { name: 'Doorstop', team: 'Team Cinderblock', hometown: 'Fresno, California', builders: 'Earl Pruitt and his nephew', blurb: 'A slow pusher built from a steel door and optimism.', record: '2-9' },
    { cls: 'heavy', chassis: 'box', drive: 'drill2', power: 'sla', weapon: 'none', armor: { material: 'polycarb', grade: 1 }, extras: [], paint: { primary: '#7a6a55', secondary: '#3a3a3a', accent: '#e0c060', pattern: 'solid', finish: 'matte', decal: 'STOP' } },
    'tactical',
    0.05,
  ),
  careerRival(
    'trash-panda',
    { name: 'Trash Panda', team: 'Team Dumpster', hometown: 'Stockton, California', builders: 'The night shift at a recycling plant', blurb: 'A spiked rammer that eats whatever you leave lying around.', record: '4-7' },
    { cls: 'heavy', chassis: 'box', drive: 'drill2', power: 'sla', weapon: 'none', armor: { material: 'uhmw', grade: 1 }, extras: ['spikes'], paint: { primary: '#6b6b6b', secondary: '#111111', accent: '#ffffff', pattern: 'stripes', finish: 'matte', decal: 'RAWR' } },
    'aggressive',
    0.25,
  ),
  careerRival(
    'lawn-dart',
    { name: 'Lawn Dart', team: 'Team Backyard', hometown: 'Modesto, California', builders: 'The Okafor twins', blurb: 'A cheap vertical disk that wobbles like a shopping cart. Still hurts.', record: '5-6' },
    { cls: 'heavy', chassis: 'box', drive: 'drill2', power: 'nicad', weapon: 'vdisk', armor: { material: 'polycarb', grade: 1 }, extras: [], paint: { primary: '#2e8b57', secondary: '#f5f5dc', accent: '#ff4500', pattern: 'checker', finish: 'gloss', decal: 'FORE' } },
    'spinner',
    0.3,
  ),
  careerRival(
    'buzz-off',
    { name: 'Buzz Off', team: 'Team Hornet', hometown: 'Sacramento, California', builders: 'A beekeeper with a grudge', blurb: 'A fragile horizontal bar. Get inside it before it spins up.', record: '6-5' },
    { cls: 'heavy', chassis: 'invertible', drive: 'drill2', power: 'nicad', weapon: 'hbar', armor: { material: 'uhmw', grade: 1 }, extras: [], paint: { primary: '#f2c200', secondary: '#111111', accent: '#ffffff', pattern: 'hazard', finish: 'gloss', decal: 'BZZT' } },
    'spinner',
    0.35,
  ),
  careerRival(
    'chop-suey',
    { name: 'Chop Suey', team: 'Team Takeout', hometown: 'San Jose, California', builders: 'Two line cooks and a welder', blurb: 'A pneumatic cleaver on a swing arm. Order number nine.', record: '9-4' },
    { cls: 'heavy', chassis: 'box', drive: 'chair4', power: 'sla', weapon: 'axe', armor: { material: 'aluminum', grade: 2 }, extras: [], paint: { primary: '#b22222', secondary: '#f5deb3', accent: '#222222', pattern: 'solid', finish: 'gloss', decal: '#9' } },
    'tactical',
    0.5,
  ),
];

/** Every robot the career can field, by id. */
export function careerRivalById(id: string): Rival | undefined {
  return id === NEMESIS.id ? NEMESIS : CAREER_BOTS.find((r) => r.id === id) ?? ROSTER.find((r) => r.id === id);
}

export const FIGHTS: CampaignFight[] = [
  { id: 'c1', act: 'scrapyard', opponent: 'doorstop', title: 'Garage league qualifier', prize: 400, rankAfter: 52, skill: 0.05, blurb: 'Your first fight back. Shove it into something sharp.' },
  { id: 'c2', act: 'scrapyard', opponent: 'trash-panda', title: 'Garage league, week two', prize: 600, rankAfter: 47, skill: 0.25, blurb: 'It rams. Keep your nose pointed at it.' },
  { id: 'c3', act: 'scrapyard', opponent: 'lawn-dart', title: 'Garage league, week three', prize: 800, rankAfter: 43, skill: 0.3, blurb: 'A spinner. Hit it before the disk gets up to speed.' },
  { id: 'c4', act: 'scrapyard', opponent: 'buzz-off', title: 'Garage league final', prize: 1000, rankAfter: 40, skill: 0.36, blurb: 'Win this and the regional producers will call.' },
  { id: 'c5', act: 'regionals', opponent: 'homewrecker', title: 'Regional qualifier', prize: 1500, rankAfter: 31, skill: 0.42, blurb: 'A shell spinner. Slow to wind up, brutal once it does.', tweak: { armor: { material: 'aluminum', grade: 1 }, power: 'sla' } },
  { id: 'c6', act: 'regionals', opponent: 'chop-suey', title: 'Regional round of 16', prize: 1800, rankAfter: 24, skill: 0.48, blurb: 'An axe. Make it swing at nothing.' },
  { id: 'c7', act: 'regionals', opponent: 'undertow', title: 'Regional semifinal', prize: 2200, rankAfter: 19, skill: 0.54, blurb: 'A lifter that carries robots to the Pulverizer.', tweak: { armor: { material: 'aluminum', grade: 1 }, power: 'sla' } },
  { id: 'c8', act: 'regionals', opponent: 'snowplow', title: 'Regional final', prize: 2600, rankAfter: 16, skill: 0.6, blurb: 'Six wheels and hardened steel. It will try to push you around.' },
  { id: 'c9', act: 'show', opponent: 'tax-audit', title: 'BotBox, opening night', prize: 3500, rankAfter: 11, skill: 0.66, blurb: 'Prime time. An axe with an accountant behind the sticks.' },
  { id: 'c10', act: 'show', opponent: 'general-discontent', title: 'BotBox quarterfinal', prize: 4000, rankAfter: 7, skill: 0.72, blurb: 'Forty inches of bar at knee height.' },
  { id: 'c11', act: 'show', opponent: 'flapjack', title: 'BotBox semifinal', prize: 5000, rankAfter: 4, skill: 0.78, blurb: 'The flipper that has flipped everything it met.' },
  { id: 'c12', act: 'show', opponent: 'megahurtz', title: 'Title eliminator', prize: 6000, rankAfter: 2, skill: 0.84, blurb: 'Win and you get your rematch.' },
  { id: 'c13', act: 'championship', opponent: 'terminal-velocity', title: 'The championship', prize: 25000, rankAfter: 1, skill: 0.92, blurb: 'The robot that ended you. For the Giant Nut.' },
];

/** The rival's loadout for a campaign fight. */
export function fightLoadout(f: CampaignFight): Loadout {
  const base = careerRivalById(f.opponent)!.loadout;
  return { ...base, ...f.tweak, extras: [...(f.tweak?.extras ?? base.extras)] };
}

/** Side gigs pay this share of the next campaign purse (rounded to $50). */
export const SIDE_GIG_SHARE = 0.35;

/** The rankings board for the career screen: the top ten names around the player's climb. */
export const RANKED_NAMES: string[] = [
  'Terminal Velocity',
  'Megahurtz',
  'Flapjack',
  'General Discontent',
  'Tax Audit',
  'Snowplow',
  'Undertow',
  'Chop Suey',
  'Homewrecker',
  'Buzz Off',
];
