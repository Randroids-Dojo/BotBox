// Broadcast package: stingers for the show graphics and the arena tree, and UI sounds that feel
// like 2001 TV graphics: chrome, punchy, short.

import type { Stinger, UiSound } from '../types';
import type { Bank } from '../bank';
import { biquad, gain, makeImpulse, mtof, osc, rng } from '../dsp';
import { burst, drive, modal, rattle, thump } from './kit';

/** A stereo hall send inside an offline render. */
function hall(ctx: BaseAudioContext, out: AudioNode, wet: number, seconds = 2.2): AudioNode {
  const c = ctx.createConvolver();
  c.buffer = makeImpulse(ctx, { seconds, decay: seconds * 0.85, preDelay: 0.025, seed: 77 });
  const g = gain(ctx, wet);
  c.connect(g).connect(out);
  return c;
}

/** Detuned saw stack through a closing filter: brassy synth stab. */
function stab(ctx: BaseAudioContext, out: AudioNode, t: number, midis: number[], o: { dur: number; amp: number; bright?: number }): void {
  const f = biquad(ctx, 'lowpass', 400, 2);
  const g = gain(ctx, 0);
  f.connect(g).connect(out);
  const top = 400 + 5200 * (o.bright ?? 1);
  f.frequency.setValueAtTime(400, t);
  f.frequency.linearRampToValueAtTime(top, t + 0.015);
  f.frequency.setTargetAtTime(700, t + 0.02, o.dur * 0.35);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.amp, t + 0.008);
  g.gain.setTargetAtTime(o.amp * 0.5, t + 0.02, 0.08);
  g.gain.setTargetAtTime(0, t + o.dur, 0.08);
  for (const m of midis)
    for (const d of [-14, -5, 6, 13]) {
      const s = osc(ctx, 'sawtooth', mtof(m), t, t + o.dur + 0.6, d);
      const p = ctx.createStereoPanner();
      p.pan.value = d / 16;
      s.connect(p).connect(f);
    }
}

function horn(ctx: BaseAudioContext, out: AudioNode, t: number, freqs: number[], dur: number, amp: number, type: OscillatorType = 'sawtooth'): void {
  const sh = drive(ctx, 2.5, 0.1);
  const bp1 = biquad(ctx, 'peaking', 1200, 1.5, 9);
  const lp = biquad(ctx, 'lowpass', 3200, 0.7);
  const g = gain(ctx, 0);
  sh.connect(bp1).connect(lp).connect(g).connect(out);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(amp, t + 0.03);
  g.gain.setValueAtTime(amp, t + dur - 0.06);
  g.gain.linearRampToValueAtTime(0, t + dur);
  for (const f of freqs)
    for (const d of [-6, 5]) {
      const s = osc(ctx, type, f, t, t + dur + 0.05, d);
      s.connect(gain(ctx, 0.35)).connect(sh);
    }
}

export const STINGER_SECONDS: Record<Exclude<Stinger, 'crowd_roar' | 'heartbreak' | 'cash' | 'rankup' | 'unlock'>, number> = {
  logo: 3.6,
  whoosh: 0.9,
  lights: 1.4,
  go: 2.8,
  ko: 2.6,
  time: 2.4,
  decision: 3.2,
  replay: 1.6,
  stamp: 1.6,
};

export function defineShow(bank: Bank): void {
  const S = STINGER_SECONDS;
  bank.define('st.logo', {
    peak: 0.7,
    seconds: S.logo,
    channels: 2,
    render: (ctx, out) => {
      const verb = hall(ctx, out, 0.5, 2.6);
      const dry = gain(ctx, 1);
      dry.connect(out);
      dry.connect(verb);
      const sh = drive(ctx, 2.5, 0.2);
      sh.connect(dry);
      thump(ctx, sh, 0.0, { f0: 90, f1: 30, drop: 0.35, amp: 0.95, decay: 0.45 });
      burst(ctx, sh, 0.0, { type: 'highpass', f: 900, q: 0.7, amp: 0.8, decay: 0.006, seed: 2 });
      modal(ctx, dry, 0.0, { f0: 210, ratios: [1, 1.59, 2.14, 2.3, 2.65, 2.92, 3.5, 4.16, 5.4], decay: 0.9, amp: 0.09, tilt: 0.4, damp: 0.45, seed: 3 });
      // Chrome glint.
      modal(ctx, dry, 0.03, { f0: 2350, ratios: [1, 1.5, 2.01, 2.7], decay: 0.5, amp: 0.025, tilt: 0.2, damp: 0.3, seed: 4 });
      stab(ctx, dry, 0.0, [38, 45, 50, 57, 62], { dur: 0.9, amp: 0.1, bright: 0.8 });
    },
  });
  bank.define('st.whoosh', {
    peak: 0.7,
    seconds: S.whoosh,
    channels: 2,
    render: (ctx, out) => {
      const p = ctx.createStereoPanner();
      p.pan.setValueAtTime(-0.8, 0);
      p.pan.linearRampToValueAtTime(0.8, 0.45);
      p.connect(out);
      burst(ctx, p, 0, { type: 'bandpass', f: 300, q: 1.5, amp: 0.7, attack: 0.22, decay: 0.08, seed: 10, fEnd: 4000, fTime: 0.3 });
      const s = osc(ctx, 'sawtooth', 180, 0, 0.45);
      s.frequency.exponentialRampToValueAtTime(900, 0.3);
      const g = gain(ctx, 0);
      s.connect(biquad(ctx, 'lowpass', 1500, 1)).connect(g).connect(p);
      g.gain.linearRampToValueAtTime(0.06, 0.2);
      g.gain.linearRampToValueAtTime(0, 0.4);
    },
  });
  bank.define('st.lights', {
    peak: 0.7,
    seconds: S.lights,
    channels: 2,
    render: (ctx, out) => {
      const verb = hall(ctx, out, 0.45);
      const dry = gain(ctx, 1);
      dry.connect(out);
      dry.connect(verb);
      // Relay clack, then a fat lamp tone.
      burst(ctx, dry, 0, { type: 'bandpass', f: 3000, q: 2, amp: 0.5, decay: 0.004, seed: 20 });
      const g = gain(ctx, 0);
      g.connect(biquad(ctx, 'lowpass', 2400, 0.8)).connect(dry);
      for (const [f, a, type] of [
        [392, 0.35, 'square'],
        [196, 0.4, 'sine'],
        [784, 0.08, 'sine'],
      ] as const)
        osc(ctx, type, f, 0.005, 0.6).connect(gain(ctx, a)).connect(g);
      g.gain.setValueAtTime(0, 0.005);
      g.gain.linearRampToValueAtTime(0.7, 0.012);
      g.gain.setValueAtTime(0.6, 0.38);
      g.gain.linearRampToValueAtTime(0, 0.45);
    },
  });
  bank.define('st.go', {
    peak: 0.7,
    seconds: S.go,
    channels: 2,
    render: (ctx, out) => {
      const verb = hall(ctx, out, 0.5, 2.4);
      const dry = gain(ctx, 1);
      dry.connect(out);
      dry.connect(verb);
      // Stadium air horn: a fat minor-third chord.
      horn(ctx, dry, 0, [233, 277, 349], 1.4, 0.6);
      thump(ctx, dry, 0, { f0: 120, f1: 50, drop: 0.1, amp: 0.6, decay: 0.15 });
      burst(ctx, dry, 0, { type: 'highpass', f: 5000, q: 0.5, amp: 0.15, decay: 0.3, seed: 30 });
    },
  });
  bank.define('st.ko', {
    peak: 0.7,
    seconds: S.ko,
    channels: 2,
    render: (ctx, out) => {
      const verb = hall(ctx, out, 0.4);
      const dry = gain(ctx, 1);
      dry.connect(out);
      dry.connect(verb);
      // Harsh buzzer: two square tones a fifth apart, nasal.
      horn(ctx, dry, 0, [98, 147, 196], 1.5, 0.75, 'square');
    },
  });
  bank.define('st.time', {
    peak: 0.7,
    seconds: S.time,
    channels: 2,
    render: (ctx, out) => {
      const verb = hall(ctx, out, 0.4);
      const dry = gain(ctx, 1);
      dry.connect(out);
      dry.connect(verb);
      // Two blasts of a lighter horn.
      horn(ctx, dry, 0, [175, 220, 262], 0.45, 0.6);
      horn(ctx, dry, 0.55, [175, 220, 262], 0.9, 0.6);
    },
  });
  bank.define('st.decision', {
    peak: 0.7,
    seconds: S.decision,
    channels: 2,
    render: (ctx, out) => {
      const verb = hall(ctx, out, 0.45, 2.4);
      const dry = gain(ctx, 1);
      dry.connect(out);
      dry.connect(verb);
      // Snare roll building into the reveal hit at 1.0 s.
      const r = rng(40);
      for (let t = 0; t < 0.98; t += 0.045 - t * 0.012) {
        const a = 0.08 + 0.35 * (t / 1.0);
        burst(ctx, dry, t, { type: 'bandpass', f: 2500, q: 0.7, amp: a * (0.8 + r() * 0.4), decay: 0.04, seed: 41 + Math.floor(t * 100) });
        thump(ctx, dry, t, { f0: 220, f1: 170, drop: 0.02, amp: a * 0.4, decay: 0.03, type: 'triangle' });
      }
      thump(ctx, dry, 1.0, { f0: 110, f1: 40, drop: 0.12, amp: 0.9, decay: 0.3 });
      burst(ctx, dry, 1.0, { type: 'highpass', f: 4500, q: 0.4, amp: 0.4, decay: 0.6, seed: 45 });
      stab(ctx, dry, 1.0, [50, 57, 62, 66, 69], { dur: 0.8, amp: 0.1 });
    },
  });
  bank.define('st.replay', {
    peak: 0.7,
    seconds: S.replay,
    channels: 2,
    render: (ctx, out) => {
      const verb = hall(ctx, out, 0.3);
      const dry = gain(ctx, 1);
      dry.connect(out);
      dry.connect(verb);
      // Reverse whoosh into a chopped digital zap and a chrome clang.
      const p = ctx.createStereoPanner();
      p.pan.setValueAtTime(0.7, 0);
      p.pan.linearRampToValueAtTime(-0.7, 0.35);
      p.connect(dry);
      burst(ctx, p, 0, { type: 'bandpass', f: 3500, q: 1.2, amp: 0.6, attack: 0.3, decay: 0.02, seed: 50, fEnd: 500, fTime: 0.3 });
      const z = osc(ctx, 'square', 1400, 0.32, 0.55);
      z.frequency.setValueAtTime(1400, 0.32);
      z.frequency.exponentialRampToValueAtTime(180, 0.55);
      const zg = gain(ctx, 0);
      z.connect(biquad(ctx, 'bandpass', 1500, 0.8)).connect(zg).connect(dry);
      for (let t = 0.32; t < 0.55; t += 0.03) {
        zg.gain.setValueAtTime(0.25, t);
        zg.gain.setValueAtTime(0, t + 0.018);
      }
      modal(ctx, dry, 0.32, { f0: 880, ratios: [1, 1.5, 2.3, 3.1], decay: 0.25, amp: 0.06, seed: 51 });
      thump(ctx, dry, 0.32, { f0: 150, f1: 60, drop: 0.08, amp: 0.5, decay: 0.1 });
    },
  });
  bank.define('st.stamp', {
    peak: 0.7,
    seconds: S.stamp,
    channels: 2,
    render: (ctx, out) => {
      const verb = hall(ctx, out, 0.3);
      const dry = gain(ctx, 1);
      dry.connect(out);
      dry.connect(verb);
      const sh = drive(ctx, 2.2, 0.2);
      sh.connect(dry);
      thump(ctx, sh, 0, { f0: 130, f1: 45, drop: 0.08, amp: 0.95, decay: 0.14 });
      burst(ctx, sh, 0, { type: 'lowpass', f: 2500, q: 0.7, amp: 0.7, decay: 0.012, color: 'pink', seed: 60 });
      modal(ctx, dry, 0.001, { f0: 330, ratios: [1, 1.59, 2.14, 2.65, 3.5], decay: 0.18, amp: 0.1, seed: 61 });
    },
  });

  // ---- UI
  const ui = (id: UiSound, seconds: number, render: (ctx: OfflineAudioContext, out: AudioNode) => void) => bank.define(`ui.${id}`, { seconds, render, peak: 0.5 });
  ui('move', 0.12, (ctx, out) => {
    burst(ctx, out, 0, { type: 'bandpass', f: 4000, q: 1.5, amp: 0.4, decay: 0.002, seed: 70 });
    modal(ctx, out, 0, { f0: 2350, ratios: [1, 1.53, 2.1], decay: 0.012, amp: 0.18, seed: 71 });
  });
  ui('select', 0.35, (ctx, out) => {
    thump(ctx, out, 0, { f0: 320, f1: 140, drop: 0.03, amp: 0.55, decay: 0.035 });
    burst(ctx, out, 0, { type: 'bandpass', f: 3000, q: 1, amp: 0.4, decay: 0.004, seed: 72 });
    modal(ctx, out, 0.03, { f0: 1760, ratios: [1, 1.5, 2.01, 2.76], decay: 0.06, amp: 0.12, seed: 73 });
    const s = osc(ctx, 'square', 880, 0.03, 0.12);
    s.frequency.exponentialRampToValueAtTime(1760, 0.1);
    const g = gain(ctx, 0);
    s.connect(biquad(ctx, 'lowpass', 3000, 0.7)).connect(g).connect(out);
    g.gain.setValueAtTime(0.06, 0.03);
    g.gain.linearRampToValueAtTime(0, 0.12);
  });
  ui('back', 0.25, (ctx, out) => {
    burst(ctx, out, 0, { type: 'bandpass', f: 1800, q: 1, amp: 0.35, decay: 0.004, seed: 74 });
    const s = osc(ctx, 'square', 1100, 0, 0.1);
    s.frequency.exponentialRampToValueAtTime(420, 0.09);
    const g = gain(ctx, 0);
    s.connect(biquad(ctx, 'lowpass', 2500, 0.7)).connect(g).connect(out);
    g.gain.setValueAtTime(0.08, 0);
    g.gain.linearRampToValueAtTime(0, 0.1);
    modal(ctx, out, 0, { f0: 900, ratios: [1, 1.6, 2.3], decay: 0.03, amp: 0.1, seed: 75 });
  });
  ui('error', 0.35, (ctx, out) => {
    for (const at of [0, 0.11]) {
      const s = osc(ctx, 'square', 140, at, at + 0.08);
      const g = gain(ctx, 0);
      s.connect(biquad(ctx, 'bandpass', 700, 1.2)).connect(g).connect(out);
      g.gain.setValueAtTime(0.4, at);
      g.gain.setValueAtTime(0.4, at + 0.07);
      g.gain.linearRampToValueAtTime(0, at + 0.08);
    }
  });
  ui('buy', 0.7, (ctx, out) => {
    // Ratchet clacks and a register bell.
    for (let k = 0; k < 3; k++) burst(ctx, out, k * 0.035, { type: 'bandpass', f: 2600, q: 2, amp: 0.4, decay: 0.004, seed: 80 + k });
    modal(ctx, out, 0.12, { f0: 2093, ratios: [1, 2.0, 2.76, 5.4], decay: 0.18, amp: 0.1, tilt: 0.3, seed: 83 });
    modal(ctx, out, 0.12, { f0: 2637, ratios: [1, 2.0, 2.76], decay: 0.16, amp: 0.07, tilt: 0.3, seed: 84 });
    thump(ctx, out, 0.12, { f0: 260, f1: 140, drop: 0.03, amp: 0.3, decay: 0.03 });
  });
  ui('repair', 0.75, (ctx, out) => {
    // Impact wrench: a buzzing hammer run and a final clunk.
    const bp = biquad(ctx, 'bandpass', 1400, 1.2);
    const g = gain(ctx, 0.5);
    bp.connect(drive(ctx, 2, 0.1)).connect(g).connect(out);
    for (let t = 0; t < 0.42; t += 0.022) burst(ctx, bp, t, { type: 'bandpass', f: 1400 + t * 600, q: 1, amp: 0.7, decay: 0.006, seed: 90 + Math.floor(t * 1000) });
    const m = osc(ctx, 'sawtooth', 90, 0, 0.45);
    m.frequency.linearRampToValueAtTime(140, 0.4);
    m.connect(gain(ctx, 0.12)).connect(bp);
    thump(ctx, out, 0.46, { f0: 200, f1: 90, drop: 0.03, amp: 0.45, decay: 0.04 });
    modal(ctx, out, 0.46, { f0: 1250, ratios: [1, 1.7, 2.6], decay: 0.06, amp: 0.08, seed: 99 });
  });
  ui('tick', 0.06, (ctx, out) => {
    burst(ctx, out, 0, { type: 'highpass', f: 3500, q: 0.7, amp: 0.4, decay: 0.0015, seed: 100 });
    modal(ctx, out, 0, { f0: 3100, ratios: [1, 1.6], decay: 0.006, amp: 0.08, seed: 101 });
  });
  ui('type', 0.08, (ctx, out) => {
    burst(ctx, out, 0, { type: 'bandpass', f: 2200, q: 1.5, amp: 0.4, decay: 0.003, seed: 102 });
    thump(ctx, out, 0, { f0: 500, f1: 300, drop: 0.01, amp: 0.15, decay: 0.008 });
    rattle(ctx, out, 0.004, { dur: 0.02, count: 2, fLo: 3000, fHi: 4500, amp: 0.05, decay: 0.004, seed: 103 });
  });
}
