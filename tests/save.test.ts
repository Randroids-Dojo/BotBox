import { describe, expect, it } from 'vitest';
import { latestCareer, newCareer, slotView } from '../src/game/career';
import { SLOTS, migrate } from '../src/game/save';

describe('save slots', () => {
  it('starts with three empty slots', () => {
    const m = migrate({});
    expect(m.slots).toHaveLength(SLOTS);
    expect(m.slots.every((s) => s === null)).toBe(true);
    expect(m.career).toBeNull();
    expect(m.seenIntro).toBe(false);
  });

  it('moves a pre-slots career into slot 1 and remembers the intro was seen', () => {
    const c = { ...newCareer(), prologueDone: true, rebuilt: true, funds: 900 };
    const m = migrate({ career: c });
    expect(m.slots[0]).toBe(c);
    expect(m.slot).toBe(0);
    expect(m.career).toBe(c);
    expect(m.seenIntro).toBe(true);
  });

  it('keeps stored slots and the active one', () => {
    const a = newCareer();
    const b = { ...newCareer(), prologueDone: true };
    const m = migrate({ slots: [a, null, b], slot: 2, seenIntro: true });
    expect(m.career).toBe(b);
    expect(m.slots[1]).toBeNull();
  });

  it('describes slots and finds the one played last', () => {
    const a = { ...newCareer(), prologueDone: true, rebuilt: true, savedAt: 100 };
    const b = { ...newCareer(), prologueDone: true, rebuilt: true, savedAt: 200, next: 4, rank: 40 };
    expect(latestCareer([a, null, b])).toBe(b);
    expect(slotView(null, 1)).toEqual({ slot: 1, career: null });
    const v = slotView(b, 2).career!;
    expect(v.act).toBe('Act II. Regionals');
    expect(v.progress).toEqual({ won: 4, total: 13 });
    expect(v.fresh).toBe(false);
    expect(slotView(newCareer(), 0).career!.fresh).toBe(true);
  });
});
