// The career save and its rules: money, parts owned, repairs, rank, the ladder, and the views
// the workshop screens show. Pure functions over CareerSave; the director owns the flow.

import { COMPONENTS, FACETS, type Loadout, type PartKey } from '../contract';
import {
  ACTS,
  FIGHTS,
  FREE_PATCH,
  NEMESIS,
  PART_PRICES,
  RANKED_NAMES,
  SCRAP_LOADOUT,
  SIDE_GIG_SHARE,
  STARTING_OWNED,
  careerRivalById,
  type Act,
  type CampaignFight,
} from '../data/campaign';
import { ARMOR, CHASSIS, DRIVES, EXTRAS, POWER, WEAPONS } from '../data/parts';
import { buildSpec } from '../sim/spec';
import type { CareerShop, CareerView, Damage, RewardsView, RivalSummary, WorkshopView } from '../ui/types';

export interface CareerSave {
  /** The prologue and the montage have been seen. */
  prologueDone: boolean;
  /** The guided first rebuild is finished. */
  rebuilt: boolean;
  funds: number;
  earnings: number;
  /** null is unranked. */
  rank: number | null;
  /** Index into FIGHTS of the next campaign fight (FIGHTS.length when the career is complete). */
  next: number;
  owned: PartKey[];
  loadout: Loadout;
  damage: Damage | null;
  w: number;
  l: number;
  results: Record<string, string>;
  /** Store tier whose unlocks the player has been told about. */
  toldTier: number;
}

export function newCareer(): CareerSave {
  return {
    prologueDone: false,
    rebuilt: false,
    funds: 0,
    earnings: 0,
    rank: null,
    next: 0,
    owned: [...STARTING_OWNED],
    loadout: { ...SCRAP_LOADOUT, extras: [...SCRAP_LOADOUT.extras], armor: { ...SCRAP_LOADOUT.armor }, paint: { ...SCRAP_LOADOUT.paint } },
    damage: null,
    w: 0,
    l: 0,
    results: {},
    toldTier: 0,
  };
}

export function nextFight(c: CareerSave): CampaignFight | null {
  return FIGHTS[c.next] ?? null;
}

export function currentAct(c: CareerSave): Act {
  const f = nextFight(c) ?? FIGHTS[FIGHTS.length - 1];
  return ACTS.find((a) => a.id === f.act)!;
}

export function actIndex(c: CareerSave): number {
  return ACTS.indexOf(currentAct(c));
}

export function storeTier(c: CareerSave): number {
  return currentAct(c).tier;
}

export function workshopTier(c: CareerSave): 0 | 1 | 2 | 3 {
  if (c.next >= FIGHTS.length) return 3;
  return Math.max(0, Math.min(3, actIndex(c))) as 0 | 1 | 2 | 3;
}

export function partLabel(key: PartKey): string {
  const [cat, id] = key.split(':') as [string, string];
  if (cat === 'chassis') return CHASSIS[id as keyof typeof CHASSIS].label;
  if (cat === 'drive') return DRIVES[id as keyof typeof DRIVES].label;
  if (cat === 'power') return POWER[id as keyof typeof POWER].label;
  if (cat === 'weapon') return WEAPONS[id as keyof typeof WEAPONS].label;
  if (cat === 'armor') return ARMOR[id as keyof typeof ARMOR].label;
  return EXTRAS[id as keyof typeof EXTRAS].label;
}

const TIER_NAME = ['the Scrapyard Circuit', 'the Regionals', 'The Show', 'the Championship'];

export function lockedParts(c: CareerSave): Partial<Record<PartKey, string>> {
  const tier = storeTier(c);
  const out: Partial<Record<PartKey, string>> = {};
  for (const [k, v] of Object.entries(PART_PRICES) as [PartKey, (typeof PART_PRICES)[PartKey]][]) {
    if (v.tier > tier && !c.owned.includes(k)) out[k] = `Unlocks at ${TIER_NAME[v.tier]}`;
  }
  return out;
}

export function partsUnlockedAt(tier: number): string[] {
  return (Object.entries(PART_PRICES) as [PartKey, { price: number; tier: number }][])
    .filter(([, v]) => v.tier === tier && v.price > 0)
    .map(([k]) => partLabel(k));
}

/** Health below the free patch line is fixed for free between fights. */
export function freePatch(d: Damage | null): Damage | null {
  if (!d) return null;
  const facets = { ...d.facets };
  const parts = { ...d.parts };
  for (const f of FACETS) facets[f] = Math.max(FREE_PATCH, facets[f]);
  for (const p of COMPONENTS) parts[p] = Math.max(FREE_PATCH, parts[p]);
  return { facets, parts };
}

export function isDamaged(d: Damage | null): boolean {
  if (!d) return false;
  return FACETS.some((f) => d.facets[f] < 0.95) || COMPONENTS.some((p) => d.parts[p] < 0.95);
}

/** The store as the garage sees it. `buy` mutates the save. */
export function careerShop(c: CareerSave, onChange: () => void): CareerShop {
  const prices = {} as Record<PartKey, number>;
  for (const [k, v] of Object.entries(PART_PRICES) as [PartKey, { price: number }][]) prices[k] = v.price;
  return {
    funds: c.funds,
    owned: [...c.owned],
    prices,
    locked: lockedParts(c),
    repairPer10: currentAct(c).repairPer10,
    freePatch: FREE_PATCH,
    buy: (key) => {
      if (c.owned.includes(key)) return c.funds;
      if (lockedParts(c)[key]) return null;
      const price = PART_PRICES[key].price;
      if (price > c.funds) return null;
      c.funds -= price;
      c.owned.push(key);
      onChange();
      return c.funds;
    },
  };
}

/** A rival for the scouting card; `rank` shows where they sit in the rankings. */
export function rivalSummary(id: string, rank: number): RivalSummary {
  const r = careerRivalById(id)!;
  return { id, card: r.card, cls: r.loadout.cls, spec: buildSpec(r.loadout), style: r.style, seed: rank };
}

function sideGigPurse(c: CareerSave): number {
  const f = nextFight(c) ?? FIGHTS[FIGHTS.length - 1];
  return Math.max(100, Math.round((f.prize * SIDE_GIG_SHARE) / 50) * 50);
}

/** A repeatable cash fight against someone from the current act (unlocked after the first win). */
export interface SideGig {
  title: string;
  opponent: string;
  prize: number;
  skill: number;
  rank: number;
}

export function sideGig(c: CareerSave, seed: number): SideGig | null {
  if (c.w === 0) return null;
  const act = currentAct(c);
  const pool = FIGHTS.filter((f) => f.act === act.id && f.opponent !== NEMESIS.id).map((f) => f.opponent);
  const done = FIGHTS.slice(0, c.next).filter((f) => f.act === act.id).map((f) => f.opponent);
  const choices = done.length ? done : pool;
  const opponent = choices[Math.abs(seed) % choices.length];
  const f = FIGHTS.find((x) => x.opponent === opponent);
  const skill = Math.max(0.1, (f?.skill ?? 0.4) - 0.05);
  return { title: act.id === 'scrapyard' ? 'Parking lot grudge match' : 'Exhibition bout', opponent, prize: sideGigPurse(c), skill, rank: f?.rankAfter ?? 50 };
}

export function workshopView(c: CareerSave, gig: SideGig | null): WorkshopView {
  const act = currentAct(c);
  const f = nextFight(c);
  let news: string | null = null;
  if (storeTier(c) > c.toldTier) news = `New in the store: ${partsUnlockedAt(storeTier(c)).slice(0, 4).join(', ')}`;
  else if (isDamaged(c.damage)) news = 'Your robot is still banged up. Repairs are in the garage.';
  else if (f && c.w === 0) news = 'Win your first fight to start earning.';
  return {
    robot: { name: c.loadout.name, spec: buildSpec(c.loadout) },
    funds: c.funds,
    rank: c.rank,
    record: { w: c.w, l: c.l },
    act: { title: act.title, subtitle: act.subtitle, index: ACTS.indexOf(act), total: ACTS.length },
    next: f ? { title: f.title, opponent: rivalSummary(f.opponent, f.rankAfter), prize: f.prize, blurb: f.blurb } : null,
    damaged: isDamaged(c.damage),
    sideGig: gig ? { title: gig.title, opponent: rivalSummary(gig.opponent, gig.rank), prize: gig.prize } : null,
    news,
    tier: workshopTier(c),
  };
}

export function rankings(c: CareerSave): CareerView['rankings'] {
  const names = RANKED_NAMES.slice();
  const you = c.loadout.name;
  const out: CareerView['rankings'] = [];
  if (c.rank !== null && c.rank <= 10) {
    names.splice(c.rank - 1, 0, you);
    names.length = 10;
    names.forEach((n, i) => out.push({ rank: i + 1, name: n, you: i + 1 === c.rank }));
  } else {
    names.forEach((n, i) => out.push({ rank: i + 1, name: n, you: false }));
    out.push({ rank: c.rank ?? 0, name: c.rank === null ? `${you} (unranked)` : you, you: true });
  }
  return out;
}

export function careerView(c: CareerSave): CareerView {
  return {
    acts: ACTS.map((a) => ({
      title: a.title,
      subtitle: a.subtitle,
      fights: FIGHTS.filter((f) => f.act === a.id).map((f) => {
        const i = FIGHTS.indexOf(f);
        return {
          title: f.title,
          opponent: careerRivalById(f.opponent)?.card.name ?? f.opponent,
          prize: f.prize,
          state: i < c.next ? ('won' as const) : i === c.next ? ('next' as const) : ('locked' as const),
          result: c.results[f.id] ?? null,
        };
      }),
    })),
    rankings: rankings(c),
    funds: c.funds,
    earnings: c.earnings,
    record: { w: c.w, l: c.l },
  };
}

/** Apply a campaign or side-gig result and build the rewards screen. */
export function settle(
  c: CareerSave,
  o: { won: boolean; fight: CampaignFight | null; prize: number; result: string; damage: Damage | null },
): RewardsView {
  const fundsBefore = c.funds;
  const rankBefore = c.rank;
  const tierBefore = storeTier(c);
  const actBefore = currentAct(c);
  c.damage = freePatch(o.damage);
  let actComplete: RewardsView['actComplete'] = null;
  if (o.won) {
    c.w++;
    c.funds += o.prize;
    c.earnings += o.prize;
    if (o.fight) {
      c.results[o.fight.id] = o.result;
      c.rank = c.rank === null ? o.fight.rankAfter : Math.min(c.rank, o.fight.rankAfter);
      c.next = Math.max(c.next, FIGHTS.indexOf(o.fight) + 1);
      const actAfter = currentAct(c);
      if (actAfter !== actBefore || c.next >= FIGHTS.length) {
        actComplete = { title: actBefore.title, next: c.next >= FIGHTS.length ? 'Champion again.' : actAfter.title };
      }
    }
  } else {
    c.l++;
  }
  const tierAfter = storeTier(c);
  const unlocks = tierAfter > tierBefore ? partsUnlockedAt(tierAfter) : [];
  return {
    won: o.won,
    prize: o.won ? o.prize : 0,
    fundsBefore,
    fundsAfter: c.funds,
    rankBefore,
    rankAfter: c.rank,
    unlocks,
    actComplete,
    note: o.won
      ? isDamaged(c.damage)
        ? 'Spend it wisely. Repairs and parts are in the garage.'
        : 'Spend it wisely.'
      : 'Rematch whenever you are ready. Patch it up first.',
  };
}

export function careerSummary(c: CareerSave | null): string | null {
  if (!c || !c.prologueDone) return null;
  const rank = c.rank === null ? 'Unranked' : `Rank #${c.rank}`;
  return `${c.loadout.name}. ${rank}. $${c.funds.toLocaleString('en-US')}`;
}
