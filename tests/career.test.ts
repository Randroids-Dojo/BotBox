import { describe, expect, it } from 'vitest';
import { FIGHTS, FREE_PATCH, PART_PRICES } from '../src/data/campaign';
import { careerShop, careerView, freePatch, lockedParts, newCareer, settle, sideGig, storeTier, workshopView } from '../src/game/career';
import { wear } from '../src/game/prologue';

describe('career', () => {
  it('starts broke, unranked, with a box of scrap', () => {
    const c = newCareer();
    expect(c.funds).toBe(0);
    expect(c.rank).toBeNull();
    expect(c.loadout.weapon).toBe('none');
    expect(storeTier(c)).toBe(0);
    expect(sideGig(c, 0)).toBeNull();
    expect(workshopView(c, null).next?.opponent.id).toBe(FIGHTS[0].opponent);
  });

  it('pays the purse, climbs the rankings and unlocks the next act', () => {
    const c = newCareer();
    for (let i = 0; i < 4; i++) {
      const r = settle(c, { won: true, fight: FIGHTS[i], prize: FIGHTS[i].prize, result: 'KO 1:00', damage: null });
      expect(r.fundsAfter).toBe(r.fundsBefore + FIGHTS[i].prize);
      if (i < 3) expect(r.actComplete).toBeNull();
      else {
        expect(r.actComplete?.next).toBe('Regionals');
        expect(r.unlocks.length).toBeGreaterThan(0);
      }
    }
    expect(c.rank).toBe(FIGHTS[3].rankAfter);
    expect(storeTier(c)).toBe(1);
    expect(sideGig(c, 1)?.prize).toBeGreaterThan(0);
    const view = careerView(c);
    expect(view.acts[0].fights.every((f) => f.state === 'won')).toBe(true);
    expect(view.acts[1].fights[0].state).toBe('next');
  });

  it('a loss costs nothing but pride, and heavy damage is patched for free', () => {
    const c = newCareer();
    const r = settle(c, { won: false, fight: FIGHTS[0], prize: FIGHTS[0].prize, result: 'KO 1:00', damage: wear(0.1, 0.05) });
    expect(r.prize).toBe(0);
    expect(c.next).toBe(0);
    expect(c.l).toBe(1);
    expect(c.damage?.facets.front).toBe(FREE_PATCH);
    expect(freePatch(wear(0.9))?.facets.front).toBe(0.9);
  });

  it('sells only what is unlocked and affordable', () => {
    const c = newCareer();
    const shop = careerShop(c, () => {});
    expect(lockedParts(c)['weapon:vdisk']).toBeDefined();
    expect(shop.buy('weapon:vdisk')).toBeNull();
    expect(shop.buy('armor:polycarb')).toBeNull();
    c.funds = 1000;
    expect(shop.buy('armor:polycarb')).toBe(1000 - PART_PRICES['armor:polycarb'].price);
    expect(c.owned).toContain('armor:polycarb');
    expect(shop.buy('armor:polycarb')).toBe(c.funds);
  });

  it('wins the championship at the end of the ladder', () => {
    const c = newCareer();
    for (const f of FIGHTS) settle(c, { won: true, fight: f, prize: f.prize, result: 'KO 1:00', damage: null });
    expect(c.rank).toBe(1);
    expect(c.next).toBe(FIGHTS.length);
    expect(workshopView(c, null).next).toBeNull();
  });
});
