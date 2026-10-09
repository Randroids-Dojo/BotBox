import { describe, expect, it } from 'vitest';
import { CLASSES } from '../src/data/parts';
import { ROSTER, rivalsFor, VOICED_NAMES } from '../src/data/roster';
import { buildSpec, checkLoadout } from '../src/sim/spec';

describe('roster', () => {
  it('has seven rivals per class with seeds 1 to 7', () => {
    for (const cls of CLASSES) {
      const rivals = rivalsFor(cls);
      expect(rivals.map((r) => r.seed)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    }
  });

  it('every rival loadout is legal', () => {
    for (const r of ROSTER) {
      const c = checkLoadout(r.loadout);
      expect(c.problems, r.id).toEqual([]);
    }
  });

  it('ids and voiced names are unique slugs', () => {
    const ids = ROSTER.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
    const slugs = VOICED_NAMES.map((n) => n.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('specs are physically sane', () => {
    for (const r of ROSTER) {
      const s = buildSpec(r.loadout);
      expect(s.massKg).toBeGreaterThan(10);
      expect(s.wheels.length).toBeGreaterThanOrEqual(2);
      for (const w of s.wheels) expect(w.pos.y - w.radius).toBeCloseTo(-s.groundClearance, 5);
      expect(s.panels.length).toBeGreaterThanOrEqual(6);
      expect(s.hull.length).toBeGreaterThanOrEqual(1);
      expect(s.stats.runtimeSec).toBeGreaterThan(100);
    }
  });
});

describe('career', () => {
  it('every career loadout is legal and every fight has a rival', async () => {
    const { CAREER_BOTS, NEMESIS, JUGGERNAUT_PRIME, SCRAP_LOADOUT, FIGHTS, careerRivalById, PART_PRICES } = await import('../src/data/campaign');
    for (const l of [JUGGERNAUT_PRIME, SCRAP_LOADOUT, NEMESIS.loadout, ...CAREER_BOTS.map((r) => r.loadout)]) {
      expect(checkLoadout(l).problems, l.name).toEqual([]);
    }
    for (const f of FIGHTS) expect(careerRivalById(f.opponent), f.id).toBeTruthy();
    // Every part in the catalog has a price.
    const { CHASSIS_IDS, DRIVE_IDS, POWER_IDS, WEAPON_IDS, ARMOR_IDS, EXTRA_IDS } = await import('../src/data/parts');
    const keys = [...CHASSIS_IDS.map((x) => `chassis:${x}`), ...DRIVE_IDS.map((x) => `drive:${x}`), ...POWER_IDS.map((x) => `power:${x}`), ...WEAPON_IDS.map((x) => `weapon:${x}`), ...ARMOR_IDS.map((x) => `armor:${x}`), ...EXTRA_IDS.map((x) => `extra:${x}`)];
    for (const k of keys) expect(PART_PRICES[k as keyof typeof PART_PRICES], k).toBeTruthy();
  });
});
