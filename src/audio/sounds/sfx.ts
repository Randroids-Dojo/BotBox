// World effects: impact layers, weapons, hazards, damage, debris. Mono, spatialized live.

import type { ArmorMaterialId } from '../../contract';
import type { Bank } from '../bank';
import { biquad, gain, noise, osc, rng } from '../dsp';
import { burst, drive, materialRing, modal, rattle, thump } from './kit';

export const MATERIALS: ArmorMaterialId[] = ['steel', 'aluminum', 'titanium', 'uhmw', 'polycarb'];
export const RING_VARIANTS = 3;

/** Transient layers per hit flavor, with variant counts. */
export const TRANSIENTS = {
  crack: 3, // spinner tooth
  clonk: 2, // chassis ram, wall
  thunk: 2, // axe, pulverizer
  clang: 2, // flipper plate, lifter
  crunch: 2, // spikes, saw bite
} as const;
export type TransientId = keyof typeof TRANSIENTS;

export function defineSfx(bank: Bank): void {
  // ---- material rings
  for (const mat of MATERIALS)
    for (let v = 0; v < RING_VARIANTS; v++)
      bank.define(`ring.${mat}.${v}`, {
        seconds: mat === 'uhmw' || mat === 'polycarb' ? 0.4 : mat === 'aluminum' ? 1.0 : 1.8,
        peak: mat === 'uhmw' || mat === 'polycarb' ? 0.55 : 0.5,
        render: (ctx, out) => materialRing(ctx, out, 0.0, mat, v),
      });

  // ---- transients
  for (let v = 0; v < TRANSIENTS.crack; v++)
    bank.define(`tr.crack.${v}`, {
      peak: 0.9,
      seconds: 0.7,
      render: (ctx, out) => {
        const sh = drive(ctx, 3.5, 0.15);
        const g = gain(ctx, 0.7);
        sh.connect(g).connect(out);
        // The snap: an instant broadband spike, then a tearing bite. The body is kept out of
        // the clipper so it does not swallow the crack.
        burst(ctx, sh, 0, { type: 'highpass', f: 1200, q: 0.7, amp: 1.0, decay: 0.005, seed: 3 + v });
        burst(ctx, sh, 0.001, { type: 'bandpass', f: 2600 + v * 500, q: 2.0, amp: 1.0, decay: 0.035, seed: 9 + v });
        burst(ctx, sh, 0.003, { type: 'bandpass', f: 4800, q: 1.5, amp: 0.5, decay: 0.02, seed: 15 + v });
        burst(ctx, sh, 0.004, { type: 'bandpass', f: 1500, q: 1.2, amp: 0.55, attack: 0.004, hold: 0.04 + v * 0.02, decay: 0.05, seed: 21 + v, fEnd: 800, fTime: 0.12 });
        thump(ctx, out, 0, { f0: 160, f1: 55, drop: 0.06, amp: 0.3, decay: 0.07 });
        rattle(ctx, out, 0.03, { dur: 0.45, count: 14, fLo: 1800, fHi: 6500, amp: 0.12, decay: 0.012, seed: 5 + v, ease: 2 });
      },
    });
  for (let v = 0; v < TRANSIENTS.clonk; v++)
    bank.define(`tr.clonk.${v}`, {
      peak: 0.9,
      seconds: 0.6,
      render: (ctx, out) => {
        const sh = drive(ctx, 2, 0.2);
        sh.connect(out);
        burst(ctx, sh, 0, { type: 'lowpass', f: 900, q: 0.9, amp: 0.9, decay: 0.012, color: 'pink', seed: 4 + v });
        modal(ctx, sh, 0, { f0: 170 + v * 40, ratios: [1, 2.32, 3.9], decay: 0.06, amp: 0.45, tilt: 0.8, damp: 0.6, seed: 8 + v });
        thump(ctx, sh, 0, { f0: 120, f1: 52, drop: 0.1, amp: 0.85, decay: 0.12 });
      },
    });
  for (let v = 0; v < TRANSIENTS.thunk; v++)
    bank.define(`tr.thunk.${v}`, {
      peak: 0.9,
      seconds: 0.7,
      render: (ctx, out) => {
        const sh = drive(ctx, 2.8, 0.2);
        sh.connect(out);
        burst(ctx, sh, 0, { type: 'bandpass', f: 750 + v * 150, q: 1, amp: 1, decay: 0.02, seed: 12 + v });
        thump(ctx, sh, 0, { f0: 170, f1: 55, drop: 0.07, amp: 0.95, decay: 0.15 });
        // Puncture: a short crunchy grain.
        burst(ctx, sh, 0.008, { type: 'lowpass', f: 3500, q: 0.7, amp: 0.4, attack: 0.003, hold: 0.03, decay: 0.03, seed: 31 + v });
        rattle(ctx, out, 0.02, { dur: 0.2, count: 8, fLo: 1200, fHi: 4000, amp: 0.1, decay: 0.01, seed: 40 + v });
      },
    });
  for (let v = 0; v < TRANSIENTS.clang; v++)
    bank.define(`tr.clang.${v}`, {
      peak: 0.9,
      seconds: 0.9,
      render: (ctx, out) => {
        burst(ctx, out, 0, { type: 'highpass', f: 1500, q: 0.7, amp: 0.6, decay: 0.006, seed: 50 + v });
        modal(ctx, out, 0, { f0: 520 + v * 90, ratios: [1, 1.5, 2.2, 2.75, 3.6, 4.4], decay: 0.18, amp: 0.2, tilt: 0.5, damp: 0.6, seed: 52 + v });
        thump(ctx, out, 0, { f0: 200, f1: 80, drop: 0.05, amp: 0.5, decay: 0.07 });
      },
    });
  for (let v = 0; v < TRANSIENTS.crunch; v++)
    bank.define(`tr.crunch.${v}`, {
      peak: 0.9,
      seconds: 0.6,
      render: (ctx, out) => {
        const sh = drive(ctx, 3, 0.1);
        sh.connect(out);
        rattle(ctx, sh, 0, { dur: 0.16, count: 24, fLo: 600, fHi: 3000, amp: 0.35, decay: 0.008, seed: 60 + v, ease: 1.2 });
        burst(ctx, sh, 0, { type: 'bandpass', f: 1500, q: 0.8, amp: 0.5, attack: 0.003, hold: 0.08, decay: 0.05, seed: 61 + v });
        thump(ctx, sh, 0, { f0: 110, f1: 50, drop: 0.08, amp: 0.6, decay: 0.1 });
      },
    });

  // ---- low end and debris
  for (let v = 0; v < 2; v++)
    bank.define(`thump.${v}`, {
      peak: 0.9,
      seconds: 1.4,
      render: (ctx, out) => {
        thump(ctx, out, 0, { f0: 85 - v * 12, f1: 34, drop: 0.25, amp: 0.95, decay: 0.32 });
        burst(ctx, out, 0, { type: 'lowpass', f: 260, q: 0.7, amp: 0.7, decay: 0.12, color: 'brown', seed: 70 + v });
      },
    });
  for (let v = 0; v < 3; v++)
    bank.define(`debris.${v}`, {
      peak: 0.5,
      seconds: 1.6,
      render: (ctx, out) => {
        rattle(ctx, out, 0.05, { dur: 1.3, count: 38, fLo: 1400, fHi: 7000, amp: 0.2, decay: 0.014, seed: 80 + v, ease: 2.2 });
        rattle(ctx, out, 0.1, { dur: 1.0, count: 10, fLo: 400, fHi: 1200, amp: 0.22, decay: 0.025, seed: 90 + v, ease: 1.8 });
      },
    });
  for (let v = 0; v < 2; v++)
    bank.define(`clatter.plate.${v}`, {
      seconds: 2.0,
      render: (ctx, out) => {
        // A plate lands, bounces with shrinking gaps, then rattles flat.
        let at = 0;
        let gap = 0.28 + v * 0.05;
        let a = 1;
        const r = rng(100 + v);
        for (let k = 0; k < 7; k++) {
          modal(ctx, out, at, { f0: 560 + r() * 160, ratios: [1, 1.48, 2.1, 2.7, 3.3, 4.2], decay: 0.12 * a + 0.03, amp: 0.13 * a, tilt: 0.5, damp: 0.6, seed: 101 + k });
          burst(ctx, out, at, { type: 'bandpass', f: 1200, q: 0.8, amp: 0.35 * a, decay: 0.008, seed: 110 + k });
          at += gap;
          gap *= 0.62;
          a *= 0.72;
        }
        // Settling wobble.
        for (let k = 0; k < 10; k++) {
          const tt = at + k * 0.028 * (1 + k * 0.08);
          burst(ctx, out, tt, { type: 'bandpass', f: 900, q: 2, amp: 0.12 * (1 - k / 10), decay: 0.01, seed: 130 + k });
        }
      },
    });
  bank.define('clatter.wheel', {
    seconds: 1.6,
    render: (ctx, out) => {
      let at = 0;
      let gap = 0.35;
      let a = 1;
      for (let k = 0; k < 5; k++) {
        thump(ctx, out, at, { f0: 160, f1: 90, drop: 0.04, amp: 0.6 * a, decay: 0.05 });
        burst(ctx, out, at, { type: 'lowpass', f: 600, q: 1, amp: 0.4 * a, decay: 0.02, color: 'pink', seed: 140 + k });
        modal(ctx, out, at, { f0: 900, ratios: [1, 1.7, 2.6], decay: 0.04, amp: 0.05 * a, seed: 145 + k });
        at += gap;
        gap *= 0.6;
        a *= 0.65;
      }
    },
  });
  for (let v = 0; v < 2; v++)
    bank.define(`landing.${v}`, {
      seconds: 1.6,
      render: (ctx, out) => {
        const sh = drive(ctx, 2, 0.15);
        sh.connect(out);
        thump(ctx, sh, 0, { f0: 95, f1: 38, drop: 0.15, amp: 1, decay: 0.2 });
        burst(ctx, sh, 0, { type: 'lowpass', f: 1200, q: 0.7, amp: 0.7, decay: 0.03, color: 'pink', seed: 150 + v });
        modal(ctx, out, 0.002, { f0: 210 + v * 35, ratios: [1, 1.59, 2.14, 2.65, 3.5, 4.6], decay: 0.3, amp: 0.13, tilt: 0.5, damp: 0.6, seed: 152 + v });
        rattle(ctx, out, 0.04, { dur: 0.9, count: 20, fLo: 800, fHi: 5000, amp: 0.16, decay: 0.015, seed: 155 + v, ease: 2 });
      },
    });

  // ---- grinding: rough scrape loop
  bank.define('grind.loop', {
    seconds: 2.0,
    loop: { xfade: 0.2 },
    render: (ctx, out) => {
      const r = rng(160);
      // Scrape body: band noise with jittery amplitude.
      for (const [f, q, a] of [
        [1700, 1.5, 0.5],
        [3600, 2, 0.35],
        [700, 1, 0.3],
      ] as const) {
        const g = gain(ctx, 0);
        noise(ctx, 0, 2.3, 'white', Math.floor(f)).connect(biquad(ctx, 'bandpass', f, q)).connect(g).connect(out);
        for (let t = 0; t < 2.3; t += 0.02 + r() * 0.03) g.gain.setTargetAtTime(a * (0.3 + r() * 0.9), t, 0.01);
      }
      // Squeals: high partials that wander.
      for (let k = 0; k < 3; k++) {
        const o = osc(ctx, 'sine', 2400 + k * 1300, 0, 2.3);
        for (let t = 0; t < 2.3; t += 0.15) o.frequency.setTargetAtTime(2200 + k * 1300 + r() * 600, t, 0.05);
        const g = gain(ctx, 0);
        o.connect(g).connect(out);
        for (let t = 0; t < 2.3; t += 0.08) g.gain.setTargetAtTime(r() < 0.35 ? 0.05 * r() : 0, t, 0.02);
      }
      rattle(ctx, out, 0, { dur: 2.3, count: 70, fLo: 2000, fHi: 8000, amp: 0.1, decay: 0.006, seed: 161, ease: 1 });
    },
  });

  // ---- weapons
  bank.define('pneu.bang', {
    seconds: 1.2,
    render: (ctx, out) => {
      const sh = drive(ctx, 2.5, 0.1);
      sh.connect(out);
      // Valve dump: a hard crack, a low pop, then a gassy exhaust.
      burst(ctx, sh, 0, { type: 'highpass', f: 600, q: 0.7, amp: 1, decay: 0.005, seed: 170 });
      burst(ctx, sh, 0, { type: 'bandpass', f: 1900, q: 1, amp: 0.7, decay: 0.05, seed: 171 });
      thump(ctx, sh, 0, { f0: 140, f1: 60, drop: 0.05, amp: 0.8, decay: 0.07 });
      burst(ctx, out, 0.01, { type: 'highpass', f: 2800, q: 0.6, amp: 0.4, attack: 0.01, decay: 0.22, seed: 172 });
    },
  });
  bank.define('pneu.hiss', {
    seconds: 1.2,
    render: (ctx, out) => {
      burst(ctx, out, 0, { type: 'highpass', f: 3200, q: 0.5, amp: 0.35, attack: 0.02, hold: 0.1, decay: 0.25, seed: 175 });
      burst(ctx, out, 0, { type: 'bandpass', f: 6000, q: 1, amp: 0.2, attack: 0.03, decay: 0.2, seed: 176 });
    },
  });
  bank.define('swing', {
    seconds: 0.5,
    render: (ctx, out) => {
      burst(ctx, out, 0, { type: 'bandpass', f: 350, q: 2, amp: 0.5, attack: 0.12, decay: 0.06, seed: 180, fEnd: 1800, fTime: 0.16 });
    },
  });
  bank.define('relay', {
    seconds: 0.4,
    render: (ctx, out) => {
      // Contactor clunk when a weapon motor is armed.
      burst(ctx, out, 0, { type: 'bandpass', f: 2500, q: 2, amp: 0.6, decay: 0.004, seed: 185 });
      thump(ctx, out, 0, { f0: 220, f1: 110, drop: 0.02, amp: 0.4, decay: 0.03 });
      modal(ctx, out, 0.012, { f0: 1300, ratios: [1, 2.4, 3.9], decay: 0.03, amp: 0.08, seed: 186 });
    },
  });
  bank.define('srimech', {
    seconds: 1.0,
    render: (ctx, out) => {
      burst(ctx, out, 0, { type: 'highpass', f: 800, q: 0.7, amp: 0.7, decay: 0.006, seed: 190 });
      thump(ctx, out, 0, { f0: 130, f1: 70, drop: 0.05, amp: 0.6, decay: 0.08 });
      burst(ctx, out, 0.02, { type: 'highpass', f: 3000, q: 0.6, amp: 0.3, attack: 0.01, decay: 0.18, seed: 191 });
      modal(ctx, out, 0.2, { f0: 260, ratios: [1, 2.1, 3.3], decay: 0.06, amp: 0.25, seed: 192 });
    },
  });

  // ---- damage
  bank.define('zap', {
    seconds: 0.7,
    render: (ctx, out) => {
      const b = osc(ctx, 'sawtooth', 120, 0, 0.35);
      const g = gain(ctx, 0);
      b.connect(biquad(ctx, 'bandpass', 900, 1.5)).connect(g).connect(out);
      const r = rng(200);
      for (let t = 0; t < 0.35; t += 0.015) g.gain.setValueAtTime(r() < 0.6 ? 0.4 * (1 - t / 0.35) : 0, t);
      burst(ctx, out, 0, { type: 'highpass', f: 2500, q: 0.7, amp: 0.7, decay: 0.01, seed: 201 });
      rattle(ctx, out, 0.01, { dur: 0.4, count: 18, fLo: 3000, fHi: 9000, amp: 0.15, decay: 0.004, seed: 202, ease: 1.5 });
    },
  });
  bank.define('ignite', {
    seconds: 1.4,
    render: (ctx, out) => {
      burst(ctx, out, 0, { type: 'lowpass', f: 300, q: 0.8, amp: 0.8, attack: 0.15, decay: 0.25, color: 'brown', seed: 205, fEnd: 900, fTime: 0.3 });
      rattle(ctx, out, 0.1, { dur: 1.1, count: 30, fLo: 1500, fHi: 6000, amp: 0.18, decay: 0.006, seed: 206, ease: 1.3 });
    },
  });
  bank.define('fire.loop', {
    seconds: 3,
    loop: { xfade: 0.3 },
    render: (ctx, out) => {
      const g = gain(ctx, 0);
      noise(ctx, 0, 3.4, 'brown', 210).connect(biquad(ctx, 'lowpass', 500, 0.7)).connect(g).connect(out);
      const r = rng(211);
      for (let t = 0; t < 3.4; t += 0.1) g.gain.setTargetAtTime(0.35 + r() * 0.35, t, 0.06);
      burst(ctx, out, 0, { type: 'highpass', f: 4000, q: 0.5, amp: 0.05, hold: 3.3, decay: 0.05, seed: 212 });
      rattle(ctx, out, 0, { dur: 3.4, count: 110, fLo: 900, fHi: 6000, amp: 0.22, decay: 0.004, seed: 213, ease: 1 });
    },
  });
  bank.define('smoke.loop', {
    seconds: 3,
    loop: { xfade: 0.3 },
    render: (ctx, out) => {
      const g = gain(ctx, 0);
      noise(ctx, 0, 3.4, 'white', 215).connect(biquad(ctx, 'highpass', 5000, 0.6)).connect(g).connect(out);
      const r = rng(216);
      for (let t = 0; t < 3.4; t += 0.012) g.gain.setValueAtTime(r() < 0.4 ? 0.12 * r() : 0.02, t);
      // A faint mains buzz under the sizzle.
      const b = osc(ctx, 'sawtooth', 120, 0, 3.4);
      b.connect(biquad(ctx, 'bandpass', 600, 2)).connect(gain(ctx, 0.03)).connect(out);
    },
  });

  // ---- hazards
  bank.define('saw.whir', {
    seconds: 2.2,
    render: (ctx, out) => {
      // Blade motor spins up as it rises, holds, then winds down as it drops.
      const env = gain(ctx, 0);
      env.connect(out);
      env.gain.setValueAtTime(0, 0);
      env.gain.linearRampToValueAtTime(1, 0.25);
      env.gain.setValueAtTime(1, 1.3);
      env.gain.linearRampToValueAtTime(0, 2.1);
      const m = osc(ctx, 'sawtooth', 70, 0, 2.2);
      m.frequency.setValueAtTime(70, 0);
      m.frequency.exponentialRampToValueAtTime(190, 0.35);
      m.frequency.setValueAtTime(190, 1.3);
      m.frequency.exponentialRampToValueAtTime(90, 2.1);
      m.connect(biquad(ctx, 'lowpass', 1400, 1)).connect(gain(ctx, 0.22)).connect(env);
      // Tooth whine: 40 teeth passing.
      const w = osc(ctx, 'triangle', 1800, 0, 2.2);
      w.frequency.setValueAtTime(600, 0);
      w.frequency.exponentialRampToValueAtTime(2500, 0.35);
      w.frequency.setValueAtTime(2500, 1.3);
      w.frequency.exponentialRampToValueAtTime(900, 2.1);
      w.connect(gain(ctx, 0.05)).connect(env);
      burst(ctx, env, 0, { type: 'bandpass', f: 1200, q: 1.2, amp: 0.25, attack: 0.2, hold: 1.4, decay: 0.2, seed: 220 });
      burst(ctx, out, 0, { type: 'bandpass', f: 400, q: 1, amp: 0.35, decay: 0.03, seed: 221 });
    },
  });
  bank.define('saw.shriek', {
    seconds: 1.3,
    render: (ctx, out) => {
      const env = gain(ctx, 0);
      const sh = drive(ctx, 2, 0);
      sh.connect(env).connect(out);
      env.gain.setValueAtTime(0, 0);
      env.gain.linearRampToValueAtTime(0.9, 0.01);
      env.gain.setValueAtTime(0.8, 0.5);
      env.gain.setTargetAtTime(0, 0.5, 0.15);
      const r = rng(225);
      for (const f of [2150, 3320, 4710, 6240]) {
        const o = osc(ctx, 'sine', f, 0, 1.3);
        for (let t = 0; t < 1.2; t += 0.03) o.frequency.setTargetAtTime(f * (0.96 + r() * 0.08), t, 0.015);
        const g = gain(ctx, 0);
        o.connect(g).connect(sh);
        for (let t = 0; t < 1.2; t += 0.02) g.gain.setValueAtTime(0.08 + r() * 0.2, t);
      }
      burst(ctx, sh, 0, { type: 'bandpass', f: 2800, q: 1.5, amp: 0.4, hold: 0.55, decay: 0.12, seed: 226 });
      rattle(ctx, out, 0, { dur: 0.9, count: 60, fLo: 2500, fHi: 9000, amp: 0.15, decay: 0.004, seed: 227, ease: 1.2 });
    },
  });
  bank.define('pulv.hiss', {
    seconds: 0.9,
    render: (ctx, out) => {
      burst(ctx, out, 0, { type: 'bandpass', f: 250, q: 1.5, amp: 0.7, attack: 0.18, decay: 0.08, seed: 230, fEnd: 1100, fTime: 0.22 });
      burst(ctx, out, 0, { type: 'highpass', f: 3500, q: 0.5, amp: 0.25, attack: 0.05, hold: 0.15, decay: 0.1, seed: 231 });
    },
  });
  bank.define('pulv.slam', {
    seconds: 2.6,
    render: (ctx, out) => {
      const sh = drive(ctx, 2.2, 0.15);
      sh.connect(out);
      thump(ctx, sh, 0, { f0: 70, f1: 28, drop: 0.3, amp: 1, decay: 0.45 });
      burst(ctx, sh, 0, { type: 'lowpass', f: 500, q: 0.7, amp: 0.9, decay: 0.08, color: 'brown', seed: 235 });
      burst(ctx, sh, 0, { type: 'highpass', f: 1000, q: 0.7, amp: 0.7, decay: 0.006, seed: 236 });
      modal(ctx, out, 0, { f0: 150, ratios: [1, 1.59, 2.14, 2.3, 2.65, 2.92, 3.5, 4.16, 5.4, 6.8], decay: 0.7, amp: 0.12, tilt: 0.4, damp: 0.5, seed: 237 });
      rattle(ctx, out, 0.05, { dur: 1.5, count: 30, fLo: 700, fHi: 5000, amp: 0.14, decay: 0.015, seed: 238, ease: 2 });
    },
  });
  bank.define('pulv.retract', {
    seconds: 1.2,
    render: (ctx, out) => {
      const m = osc(ctx, 'sawtooth', 150, 0, 1.0);
      m.frequency.linearRampToValueAtTime(115, 0.9);
      const g = gain(ctx, 0);
      m.connect(biquad(ctx, 'lowpass', 700, 2)).connect(g).connect(out);
      g.gain.setValueAtTime(0, 0);
      g.gain.linearRampToValueAtTime(0.25, 0.08);
      g.gain.setValueAtTime(0.25, 0.75);
      g.gain.linearRampToValueAtTime(0, 0.95);
      burst(ctx, out, 0.85, { type: 'highpass', f: 2500, q: 0.6, amp: 0.25, decay: 0.12, seed: 240 });
    },
  });
  bank.define('ramrod', {
    seconds: 0.8,
    render: (ctx, out) => {
      for (const [at, a] of [
        [0, 1],
        [0.085, 0.8],
      ] as const) {
        thump(ctx, out, at, { f0: 160, f1: 70, drop: 0.04, amp: 0.8 * a, decay: 0.06 });
        burst(ctx, out, at, { type: 'bandpass', f: 1800, q: 1.2, amp: 0.5 * a, decay: 0.012, seed: 245 });
        modal(ctx, out, at + 0.002, { f0: 640, ratios: [1, 2.3, 3.7], decay: 0.05, amp: 0.1 * a, seed: 246 });
      }
      burst(ctx, out, 0.01, { type: 'highpass', f: 3000, q: 0.6, amp: 0.2, decay: 0.1, seed: 247 });
    },
  });
  bank.define('ramrod.retract', {
    seconds: 0.5,
    render: (ctx, out) => {
      thump(ctx, out, 0, { f0: 140, f1: 80, drop: 0.03, amp: 0.4, decay: 0.04 });
      burst(ctx, out, 0, { type: 'highpass', f: 2500, q: 0.6, amp: 0.12, decay: 0.08, seed: 248 });
    },
  });
  bank.define('alarm', {
    seconds: 0.5,
    render: (ctx, out) => {
      // Two chirps through a cheap horn speaker.
      const hp = biquad(ctx, 'bandpass', 1700, 2);
      hp.connect(drive(ctx, 2, 0)).connect(gain(ctx, 0.5)).connect(out);
      for (const at of [0, 0.13]) {
        const o = osc(ctx, 'square', 1500, at, at + 0.08);
        o.frequency.setValueAtTime(1500, at);
        o.frequency.linearRampToValueAtTime(1900, at + 0.08);
        const g = gain(ctx, 0);
        o.connect(g).connect(hp);
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(0.7, at + 0.004);
        g.gain.setValueAtTime(0.7, at + 0.07);
        g.gain.linearRampToValueAtTime(0, at + 0.08);
      }
    },
  });
}
