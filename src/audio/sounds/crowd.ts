// The crowd. Thousands of people are faked with a few dozen "talkers": a buzzy voice source
// through two moving formant filters, syllable envelopes and a random pan each. Summed and put
// in a big room they read as an arena full of people. Rendered once into loops and one-shots.

import type { Bank } from '../bank';
import { Biquad, biquad, clamp, gain, makeImpulse, noise, osc, rng } from '../dsp';

const RATE = 24000;

/** Vowel formants (F1, F2). */
const V = {
  a: [730, 1090],
  ae: [660, 1720],
  e: [530, 1840],
  i: [300, 2200],
  o: [570, 840],
  u: [320, 870],
  er: [490, 1350],
} as const;
type Vowel = keyof typeof V;

interface TalkerOpts {
  t0: number;
  t1: number;
  f0: number;
  pan: number;
  level: number;
  /** Syllables per second. */
  rate: number;
  /** Chance a syllable is a pause. */
  rest: number;
  vowels: Vowel[];
  seed: number;
  /** Pitch swing within a syllable (shouts rise and fall). */
  swing?: number;
  /** Overall envelope: [time, level] points, multiplies syllable levels. */
  shape?: [number, number][];
  /** f0 multiplier over the talker's life (start, end). */
  glide?: [number, number];
}

function talker(ctx: BaseAudioContext, out: AudioNode, o: TalkerOpts): void {
  const r = rng(o.seed);
  const src = osc(ctx, 'sawtooth', o.f0, o.t0, o.t1);
  const breath = noise(ctx, o.t0, o.t1 - o.t0, 'white', o.seed);
  const bg = gain(ctx, 0.25);
  breath.connect(bg);
  const f1 = biquad(ctx, 'bandpass', 600, 4);
  const f2 = biquad(ctx, 'bandpass', 1400, 7);
  const f2g = gain(ctx, 0.55);
  src.connect(f1);
  src.connect(f2);
  bg.connect(f1);
  bg.connect(f2);
  f2.connect(f2g);
  const env = gain(ctx, 0);
  f1.connect(env);
  f2g.connect(env);
  const pan = ctx.createStereoPanner();
  pan.pan.value = o.pan;
  env.connect(pan).connect(out);
  const shapeAt = (t: number) => {
    if (!o.shape) return 1;
    const s = o.shape;
    if (t <= s[0][0]) return s[0][1];
    for (let k = 1; k < s.length; k++)
      if (t <= s[k][0]) return s[k - 1][1] + ((s[k][1] - s[k - 1][1]) * (t - s[k - 1][0])) / (s[k][0] - s[k - 1][0]);
    return s[s.length - 1][1];
  };
  let t = o.t0 + r() * 0.3;
  while (t < o.t1 - 0.05) {
    const len = (0.5 + r()) / o.rate;
    const life = (t - o.t0) / (o.t1 - o.t0);
    const g0 = o.glide ? o.glide[0] + (o.glide[1] - o.glide[0]) * life : 1;
    if (r() >= o.rest) {
      const v = V[o.vowels[Math.floor(r() * o.vowels.length)]];
      const k = 0.9 + r() * 0.2; // speaker formant scale
      f1.frequency.setTargetAtTime(v[0] * k, t, 0.03);
      f2.frequency.setTargetAtTime(v[1] * k, t, 0.03);
      const f = o.f0 * g0 * (0.92 + r() * 0.16);
      src.frequency.setTargetAtTime(f, t, 0.02);
      if (o.swing) src.frequency.setTargetAtTime(f * (1 + o.swing * (r() - 0.3)), t + len * 0.4, len * 0.3);
      const a = o.level * (0.45 + r() * 0.55) * shapeAt(t);
      env.gain.setTargetAtTime(a, t, 0.025);
      env.gain.setTargetAtTime(a * 0.2, t + len * 0.75, 0.03);
    } else {
      env.gain.setTargetAtTime(0, t, 0.04);
    }
    t += len;
  }
  env.gain.setTargetAtTime(0, o.t1 - 0.05, 0.02);
}

interface CrowdOpts {
  seconds: number;
  talkers: number;
  seed: number;
  level: number;
  /** f0 ranges for low and high voices. */
  low: [number, number];
  high: [number, number];
  rate: [number, number];
  rest: number;
  vowels: Vowel[];
  swing?: number;
  shape?: [number, number][];
  glide?: [number, number];
  /** Low-pass on the crowd (distance). */
  lp: number;
  /** Wet level in the room. */
  room: number;
  loop?: boolean;
}

function crowdGraph(ctx: OfflineAudioContext, out: AudioNode, o: CrowdOpts): void {
  const r = rng(o.seed);
  const sum = gain(ctx, 1);
  const lp = biquad(ctx, 'lowpass', o.lp, 0.6);
  const hp = biquad(ctx, 'highpass', 140, 0.7);
  sum.connect(hp).connect(lp);
  lp.connect(out);
  const verb = ctx.createConvolver();
  verb.buffer = makeImpulse(ctx, { seconds: 1.8, decay: 1.6, preDelay: 0.03, seed: o.seed });
  lp.connect(verb).connect(gain(ctx, o.room)).connect(out);
  const total = o.seconds + (o.loop ? 0.6 : 0);
  for (let i = 0; i < o.talkers; i++) {
    const hi = r() < 0.45;
    const [a, b] = hi ? o.high : o.low;
    const t0 = o.loop ? -r() * 0.5 : r() * 0.08;
    talker(ctx, sum, {
      t0: Math.max(0, t0),
      t1: total,
      f0: a + (b - a) * r(),
      pan: clamp((r() * 2 - 1) * 0.9, -1, 1),
      level: o.level * (0.5 + r() * 0.5),
      rate: o.rate[0] + (o.rate[1] - o.rate[0]) * r(),
      rest: o.rest,
      vowels: o.vowels,
      seed: o.seed * 1000 + i,
      swing: o.swing,
      shape: o.shape,
      glide: o.glide,
    });
  }
}

/** Whistles: sine glides, the sound of an excited arena. */
function whistles(ctx: BaseAudioContext, out: AudioNode, seconds: number, n: number, seed: number, amp: number): void {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const at = r() * (seconds - 0.8);
    const f = 1900 + r() * 1300;
    const len = 0.3 + r() * 0.6;
    const o = osc(ctx, 'sine', f, at, at + len + 0.1);
    o.frequency.setValueAtTime(f * 0.9, at);
    o.frequency.linearRampToValueAtTime(f * 1.12, at + len * 0.3);
    o.frequency.linearRampToValueAtTime(f * (r() < 0.5 ? 0.85 : 1.05), at + len);
    const g = gain(ctx, 0);
    const p = ctx.createStereoPanner();
    p.pan.value = r() * 1.6 - 0.8;
    o.connect(g).connect(p).connect(out);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(amp * (0.4 + r() * 0.6), at + 0.04);
    g.gain.setValueAtTime(amp * 0.5, at + len - 0.05);
    g.gain.linearRampToValueAtTime(0, at + len);
  }
}

/** Applause as samples: clappers grouped into a few filter bands. */
function applause(rate: number, seconds: number, seed: number, shape: (t: number) => number): Float32Array[] {
  const n = Math.floor(rate * seconds);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const r = rng(seed);
  const groups = 8;
  for (let gi = 0; gi < groups; gi++) {
    const exc = new Float32Array(n);
    const clappers = 14;
    for (let c = 0; c < clappers; c++) {
      let t = r() * 0.3;
      const per = 1 / (3.2 + r() * 2);
      while (t < seconds) {
        const amp = shape(t) * (0.4 + r() * 0.6);
        if (amp > 0.02) {
          const at = Math.floor(t * rate);
          const len = Math.floor(rate * 0.012);
          for (let i = 0; i < len && at + i < n; i++) exc[at + i] += (r() * 2 - 1) * amp * Math.exp(-i / (rate * 0.0025));
        }
        t += per * (0.85 + r() * 0.3);
      }
    }
    const bp = new Biquad(rate, 'bp', 700 + gi * 260, 1.4);
    const hp = new Biquad(rate, 'hp', 400, 0.7);
    const pan = (gi / (groups - 1)) * 1.6 - 0.8;
    const gl = Math.cos(((pan + 1) * Math.PI) / 4);
    const gr = Math.sin(((pan + 1) * Math.PI) / 4);
    for (let i = 0; i < n; i++) {
      const y = hp.run(bp.run(exc[i])) * 0.5;
      L[i] += y * gl;
      R[i] += y * gr;
    }
  }
  return [L, R];
}

export function defineCrowd(bank: Bank): void {
  const mixed: Vowel[] = ['a', 'ae', 'e', 'i', 'o', 'u', 'er'];
  const shout: Vowel[] = ['a', 'ae', 'o', 'e', 'a'];

  // The bed: a big room of people talking, waiting, reacting a little.
  bank.define('crowd.murmur', {
    seconds: 12,
    channels: 2,
    rate: RATE,
    loop: { xfade: 0.6 },
    render: (ctx, out) => {
      crowdGraph(ctx, out, {
        seconds: 12,
        talkers: 46,
        seed: 1,
        level: 0.11,
        low: [95, 150],
        high: [180, 260],
        rate: [3, 5],
        rest: 0.35,
        vowels: mixed,
        lp: 1800,
        room: 0.9,
        loop: true,
      });
      // Room tone under it: air handling and shuffling.
      const g = gain(ctx, 0.03);
      noise(ctx, 0, 12.6, 'brown', 9).connect(biquad(ctx, 'highpass', 60, 0.7)).connect(biquad(ctx, 'lowpass', 260, 0.7)).connect(g).connect(out);
    },
  });
  // Excited: shouting, cheering, whistles. Faded in over the bed with excitement.
  bank.define('crowd.roar', {
    seconds: 10,
    channels: 2,
    rate: RATE,
    loop: { xfade: 0.6 },
    render: (ctx, out) => {
      crowdGraph(ctx, out, {
        seconds: 10,
        talkers: 56,
        seed: 2,
        level: 0.12,
        low: [150, 240],
        high: [270, 420],
        rate: [1.2, 2.6],
        rest: 0.12,
        vowels: shout,
        swing: 0.25,
        lp: 3800,
        room: 1.0,
        loop: true,
      });
      const hiss = gain(ctx, 0);
      noise(ctx, 0, 10.6, 'pink', 21).connect(biquad(ctx, 'bandpass', 1300, 0.6)).connect(hiss).connect(out);
      const r = rng(22);
      for (let t = 0; t < 10.6; t += 0.4) hiss.gain.setTargetAtTime(0.12 + r() * 0.08, t, 0.3);
      whistles(ctx, out, 10.6, 9, 23, 0.035);
    },
  });
  bank.define('crowd.cheer', {
    seconds: 4.5,
    channels: 2,
    rate: RATE,
    render: (ctx, out) => {
      const shape: [number, number][] = [
        [0, 0.2],
        [0.15, 1],
        [1.2, 0.9],
        [3.8, 0.12],
        [4.4, 0],
      ];
      crowdGraph(ctx, out, {
        seconds: 4.5,
        talkers: 60,
        seed: 3,
        level: 0.2,
        low: [170, 260],
        high: [300, 460],
        rate: [1, 2],
        rest: 0.05,
        vowels: ['a', 'o', 'ae', 'e'],
        swing: 0.35,
        shape,
        lp: 4500,
        room: 1.1,
      });
      const env = gain(ctx, 0);
      noise(ctx, 0, 4.5, 'pink', 31).connect(biquad(ctx, 'bandpass', 1500, 0.5)).connect(env).connect(out);
      env.gain.setValueAtTime(0, 0);
      env.gain.linearRampToValueAtTime(0.28, 0.15);
      env.gain.setTargetAtTime(0, 1.0, 1.0);
      whistles(ctx, out, 4.2, 7, 33, 0.05);
    },
  });
  bank.define('crowd.groan', {
    seconds: 2.6,
    channels: 2,
    rate: RATE,
    render: (ctx, out) => {
      crowdGraph(ctx, out, {
        seconds: 2.6,
        talkers: 44,
        seed: 4,
        level: 0.2,
        low: [130, 190],
        high: [240, 330],
        rate: [0.6, 0.9],
        rest: 0,
        vowels: ['o', 'a', 'u'],
        shape: [
          [0, 0],
          [0.3, 1],
          [1.0, 0.8],
          [2.4, 0],
        ],
        glide: [1.15, 0.7],
        lp: 2600,
        room: 1.0,
      });
    },
  });
  bank.define('crowd.ooh', {
    seconds: 2.2,
    channels: 2,
    rate: RATE,
    render: (ctx, out) => {
      crowdGraph(ctx, out, {
        seconds: 2.2,
        talkers: 44,
        seed: 5,
        level: 0.2,
        low: [140, 200],
        high: [250, 340],
        rate: [0.5, 0.7],
        rest: 0,
        vowels: ['u', 'o'],
        shape: [
          [0, 0],
          [0.6, 1],
          [1.3, 0.7],
          [2.1, 0],
        ],
        glide: [0.9, 1.25],
        lp: 2400,
        room: 1.0,
      });
    },
  });
  bank.define('crowd.applause', {
    seconds: 6,
    channels: 2,
    rate: RATE,
    make: (rate) => applause(rate, 6, 41, (t) => (t < 0.4 ? t / 0.4 : t < 3.5 ? 1 : Math.max(0, 1 - (t - 3.5) / 2.3))),
  });
}
