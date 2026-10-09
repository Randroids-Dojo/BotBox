// Building blocks for offline sound renderers: modal rings, filtered noise bursts, pitch-swept
// thumps. All take an absolute start time so they can be layered in one render.

import type { ArmorMaterialId } from '../../contract';
import { biquad, gain, noise, osc, rng, shaperCurve, type NoiseColor } from '../dsp';

export type Ctx = BaseAudioContext;

/** Damped sine partials (modal synthesis). Pairs each partial with a slightly detuned twin
 *  so the ring beats like a real plate. */
export function modal(
  ctx: Ctx,
  out: AudioNode,
  t: number,
  o: { f0: number; ratios: number[]; decay: number; amp: number; tilt?: number; damp?: number; seed?: number; jitter?: number; twin?: number },
): void {
  const r = rng(o.seed ?? 7);
  o.ratios.forEach((ratio, k) => {
    const f = o.f0 * ratio * (1 + ((r() * 2 - 1) * (o.jitter ?? 0.02)));
    if (f > ctx.sampleRate * 0.45) return;
    const a = (o.amp / Math.pow(k + 1, o.tilt ?? 0.6)) * (0.7 + r() * 0.6);
    const d = o.decay / Math.pow(ratio, o.damp ?? 0.7);
    for (const tw of [0, o.twin ?? 0.004]) {
      const g = gain(ctx, 0);
      const s = osc(ctx, 'sine', f * (1 + tw), t, t + d * 7 + 0.05);
      s.connect(g).connect(out);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a * (tw ? 0.6 : 1), t + 0.0015);
      g.gain.setTargetAtTime(0, t + 0.0015, d);
    }
  });
}

/** Filtered noise with an attack and exponential decay. */
export function burst(
  ctx: Ctx,
  out: AudioNode,
  t: number,
  o: {
    type?: BiquadFilterType;
    f: number;
    q?: number;
    amp: number;
    attack?: number;
    decay: number;
    hold?: number;
    color?: NoiseColor;
    seed?: number;
    fEnd?: number;
    fTime?: number;
  },
): GainNode {
  const len = (o.attack ?? 0.001) + (o.hold ?? 0) + o.decay * 7 + 0.02;
  const n = noise(ctx, t, len, o.color ?? 'white', o.seed ?? 1);
  const f = biquad(ctx, o.type ?? 'bandpass', o.f, o.q ?? 1);
  if (o.fEnd) f.frequency.exponentialRampToValueAtTime(o.fEnd, t + (o.fTime ?? o.decay * 3));
  const g = gain(ctx, 0);
  n.connect(f).connect(g).connect(out);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.amp, t + (o.attack ?? 0.001));
  if (o.hold) g.gain.setValueAtTime(o.amp, t + (o.attack ?? 0.001) + o.hold);
  g.gain.setTargetAtTime(0, t + (o.attack ?? 0.001) + (o.hold ?? 0), o.decay);
  return g;
}

/** A sine (or other wave) with a pitch drop and decay: kicks, booms, body thumps. */
export function thump(
  ctx: Ctx,
  out: AudioNode,
  t: number,
  o: { f0: number; f1: number; drop: number; amp: number; decay: number; type?: OscillatorType },
): void {
  const s = osc(ctx, o.type ?? 'sine', o.f0, t, t + o.decay * 7 + 0.05);
  s.frequency.setValueAtTime(o.f0, t);
  s.frequency.exponentialRampToValueAtTime(o.f1, t + o.drop);
  const g = gain(ctx, 0);
  s.connect(g).connect(out);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.amp, t + 0.002);
  g.gain.setTargetAtTime(0, t + 0.002, o.decay);
}

/** Soft saturation stage. */
export function drive(ctx: Ctx, amount: number, asym = 0.1): WaveShaperNode {
  const w = ctx.createWaveShaper();
  w.curve = shaperCurve(amount, asym);
  w.oversample = '4x';
  return w;
}

/** Sparse random clicks: debris skitter, crackle, rattle. Each click is a tiny ring. */
export function rattle(
  ctx: Ctx,
  out: AudioNode,
  t: number,
  o: { dur: number; count: number; fLo: number; fHi: number; amp: number; decay: number; seed?: number; ease?: number },
): void {
  const r = rng(o.seed ?? 11);
  for (let i = 0; i < o.count; i++) {
    // `ease` > 1 bunches clicks toward the start (things settling).
    const at = t + Math.pow(r(), o.ease ?? 1.6) * o.dur;
    const f = o.fLo * Math.pow(o.fHi / o.fLo, r());
    const fade = 1 - (at - t) / (o.dur * 1.15);
    const a = o.amp * fade * (0.35 + r() * 0.65);
    const g = gain(ctx, 0);
    const s = osc(ctx, r() < 0.5 ? 'sine' : 'triangle', f, at, at + o.decay * 6);
    s.connect(g).connect(out);
    g.gain.setValueAtTime(a, at);
    g.gain.setTargetAtTime(0, at, o.decay * (0.5 + r()));
  }
}

// -----------------------------------------------------------------------------------------
// Material rings

export interface MaterialVoice {
  f0: number;
  ratios: number[];
  decay: number;
  tilt: number;
  damp: number;
  amp: number;
}

/** Plate-like inharmonic partial ratios. */
const PLATE = [1, 1.59, 2.14, 2.3, 2.65, 2.92, 3.5, 4.16, 4.63, 5.4, 6.27, 7.13];

export const MATERIAL: Record<ArmorMaterialId, MaterialVoice | null> = {
  steel: { f0: 380, ratios: PLATE, decay: 0.42, tilt: 0.45, damp: 0.55, amp: 0.16 },
  aluminum: { f0: 300, ratios: PLATE.slice(0, 9), decay: 0.16, tilt: 0.75, damp: 0.9, amp: 0.17 },
  titanium: { f0: 720, ratios: [1, 1.62, 2.27, 2.89, 3.53, 4.41, 5.2, 6.3, 7.7, 9.6], decay: 0.38, tilt: 0.25, damp: 0.4, amp: 0.13 },
  // Plastics have no lasting ring; they get a short hollow body instead.
  uhmw: null,
  polycarb: null,
};

export function materialRing(ctx: Ctx, out: AudioNode, t: number, mat: ArmorMaterialId, variant: number, scale = 1): void {
  const m = MATERIAL[mat];
  const seed = 100 + variant * 17 + mat.length;
  if (m) {
    modal(ctx, out, t, {
      f0: m.f0 * (1 + variant * 0.13),
      ratios: m.ratios,
      decay: m.decay * scale,
      tilt: m.tilt,
      damp: m.damp,
      amp: m.amp,
      seed,
      jitter: 0.03,
    });
    return;
  }
  if (mat === 'uhmw') {
    // Dull thock: low body, no shine.
    modal(ctx, out, t, { f0: 210 * (1 + variant * 0.1), ratios: [1, 1.9, 3.1], decay: 0.035, amp: 0.3, tilt: 1, damp: 0.5, seed });
    burst(ctx, out, t, { type: 'lowpass', f: 700, q: 0.8, amp: 0.45, decay: 0.03, color: 'pink', seed });
  } else {
    // Polycarbonate: hollow bonk with a crack on top.
    modal(ctx, out, t, { f0: 480 * (1 + variant * 0.1), ratios: [1, 1.71, 2.6, 3.4], decay: 0.07, amp: 0.25, tilt: 0.8, damp: 0.6, seed });
    burst(ctx, out, t, { type: 'highpass', f: 2200, q: 0.7, amp: 0.25, decay: 0.012, seed });
    rattle(ctx, out, t + 0.02, { dur: 0.15, count: 6, fLo: 900, fHi: 2500, amp: 0.05, decay: 0.01, seed });
  }
}
