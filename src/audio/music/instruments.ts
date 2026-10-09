// Music instruments, rendered note by note into the bank. Keys look like `m.<inst>.<arg>.<var>`.
//
// The guitar is the identity of the show, so it gets the most care: stacked detuned saws and a
// pulse per string, a pick transient, a pluck brightness envelope (palm mutes close fast), a
// two-stage tanh amp with a tone stack between, a cabinet EQ, and a gate so chugs stop dead.
// Two takes with different detune are rendered for the left and right doubles.

import type { Bank } from '../bank';
import { biquad, gain, makeImpulse, mtof, noise, osc, pulseWave, rng, shaperCurve } from '../dsp';
import { burst, thump } from '../sounds/kit';

type C = OfflineAudioContext;

/** Seconds of each rendered note sample. The sequencer cuts notes with a release. */
export const NOTE_SECONDS: Record<string, number> = {
  gtrM: 0.6,
  gtrO: 3.4,
  crM: 0.5,
  crO: 3.0,
  lead: 2.6,
  bassM: 0.5,
  bassO: 2.6,
  stab: 0.8,
  pad: 5,
  arp: 0.45,
  clean: 1.8,
};

/** Render rate per instrument: guitars roll off by 7 kHz, bass and pads lower still. Saves
 *  most of the bank's memory. Drums keep the full rate for cymbals. */
const NOTE_RATE: Record<string, number> = {
  gtrM: 32000,
  gtrO: 32000,
  crM: 32000,
  crO: 32000,
  lead: 32000,
  stab: 32000,
  bassM: 22050,
  bassO: 22050,
  pad: 22050,
  arp: 32000,
  clean: 22050,
  riser: 32000,
};

function shaper(ctx: C, amount: number, asym: number): WaveShaperNode {
  const w = ctx.createWaveShaper();
  w.curve = shaperCurve(amount, asym, 8192);
  w.oversample = '4x';
  return w;
}

interface AmpOpts {
  drive1: number;
  drive2: number;
  /** Mid scoop depth in dB (negative cuts). */
  scoop: number;
  presence: number;
  level: number;
  /** Lead voicing: more mids, less scoop. */
  lead?: boolean;
}

/** Amp and cabinet. Returns the input node; output goes to `out`. */
function amp(ctx: C, out: AudioNode, o: AmpOpts): AudioNode {
  const input = gain(ctx, 1);
  const hp = biquad(ctx, 'highpass', o.lead ? 180 : 160, 0.7);
  // Mid hump into the clipper, like a boost pedal in front of the amp.
  const boost = biquad(ctx, 'peaking', o.lead ? 900 : 1000, 0.8, 9);
  const s1 = shaper(ctx, o.drive1, 0.12);
  const tone1 = biquad(ctx, 'lowpass', 4200, 0.6);
  const tone2 = biquad(ctx, 'highpass', 90, 0.6);
  const s2 = shaper(ctx, o.drive2, 0.05);
  // Cabinet: 4x12 closed back. Thump, scoop, presence, steep top roll-off.
  const c1 = biquad(ctx, 'highpass', 75, 0.8);
  const c2 = biquad(ctx, 'peaking', 115, 1.1, 3.5);
  const c3 = biquad(ctx, 'peaking', o.lead ? 1100 : 430, 0.9, o.lead ? 3 : o.scoop);
  const c4 = biquad(ctx, 'peaking', 2500, 1.2, o.presence);
  const c5 = biquad(ctx, 'lowpass', 5800, 0.9);
  const c6 = biquad(ctx, 'lowpass', 7500, 0.6);
  const lvl = gain(ctx, o.level);
  input.connect(hp).connect(boost).connect(s1).connect(tone1).connect(tone2).connect(s2);
  s2.connect(c1).connect(c2).connect(c3).connect(c4).connect(c5).connect(c6).connect(lvl).connect(out);
  return input;
}

/** One plucked string voice: two detuned saws and a pulse with a pick pitch drop. */
function stringVoice(ctx: C, out: AudioNode, t: number, midi: number, o: { detune: number; amp: number; end: number; pulse: PeriodicWave; seed: number }): void {
  const r = rng(o.seed);
  const f = mtof(midi);
  const parts: [OscillatorType | 'pulse', number, number][] = [
    ['sawtooth', -o.detune * (0.6 + r() * 0.8), o.amp],
    ['sawtooth', o.detune * (0.6 + r() * 0.8), o.amp],
    ['pulse', (r() - 0.5) * 4, o.amp * 0.7],
  ];
  for (const [type, cents, a] of parts) {
    const s = ctx.createOscillator();
    if (type === 'pulse') s.setPeriodicWave(o.pulse);
    else s.type = type;
    s.frequency.value = f;
    s.detune.setValueAtTime(cents + 18, t);
    s.detune.setTargetAtTime(cents, t, 0.018);
    s.start(t);
    s.stop(o.end);
    s.connect(gain(ctx, a)).connect(out);
  }
}

/** Power chord (root, fifth, octave). */
function guitar(ctx: C, out: AudioNode, midi: number, o: { mute: boolean; variant: number; crunch: boolean }): void {
  const seconds = NOTE_SECONDS[o.crunch ? (o.mute ? 'crM' : 'crO') : o.mute ? 'gtrM' : 'gtrO'];
  const gate = gain(ctx, 0);
  gate.connect(out);
  const input = amp(ctx, gate, {
    drive1: o.crunch ? 5 : 14,
    drive2: o.crunch ? 1.8 : 4,
    scoop: o.mute ? -3 : -5,
    presence: o.crunch ? 4 : 6,
    level: o.crunch ? 0.55 : 0.42,
  });
  const bright = biquad(ctx, 'lowpass', 1000, 0.9);
  const env = gain(ctx, 0);
  env.connect(bright).connect(input);
  const t = 0.004;
  const pulse = pulseWave(ctx, 0.28);
  const notes = [midi, midi + 7, midi + 12];
  const strum = o.mute ? 0.0015 : 0.006;
  notes.forEach((m, i) => {
    const sg = gain(ctx, 0);
    sg.connect(env);
    const at = t + i * strum * (1 + o.variant * 0.3);
    sg.gain.setValueAtTime(0, at);
    sg.gain.linearRampToValueAtTime(1, at + 0.002);
    stringVoice(ctx, sg, at, m, { detune: 7 + o.variant * 3, amp: 0.11 - i * 0.012, end: seconds, pulse, seed: 31 * midi + i * 7 + o.variant * 1000 });
  });
  // Pick attack.
  burst(ctx, input, t, { type: 'bandpass', f: 2600, q: 1.2, amp: 0.05, decay: 0.004, seed: midi + o.variant });
  env.gain.setValueAtTime(0, 0);
  env.gain.linearRampToValueAtTime(1, t + 0.003);
  if (o.mute) {
    // Palm mute: brightness snaps shut, the strings choke, the gate closes.
    bright.frequency.setValueAtTime(3500, t);
    bright.frequency.setTargetAtTime(600, t + 0.005, 0.035);
    env.gain.setTargetAtTime(0.25, t + 0.01, 0.06);
    gate.gain.setValueAtTime(0, 0);
    gate.gain.linearRampToValueAtTime(1, t + 0.002);
    gate.gain.setValueAtTime(1, t + 0.09);
    gate.gain.setTargetAtTime(0, t + 0.09, 0.05);
  } else {
    bright.frequency.setValueAtTime(7000, t);
    bright.frequency.setTargetAtTime(3000, t + 0.01, 1.0);
    env.gain.setTargetAtTime(0.35, t + 0.02, 0.9);
    gate.gain.setValueAtTime(0, 0);
    gate.gain.linearRampToValueAtTime(1, t + 0.003);
    gate.gain.setValueAtTime(1, seconds - 0.6);
    gate.gain.linearRampToValueAtTime(0, seconds - 0.02);
  }
}

function leadGuitar(ctx: C, out: AudioNode, midi: number, variant: number): void {
  const seconds = NOTE_SECONDS.lead;
  const gate = gain(ctx, 0);
  gate.connect(out);
  const input = amp(ctx, gate, { drive1: 12, drive2: 3, scoop: 0, presence: 3, level: 0.35, lead: true });
  const bright = biquad(ctx, 'lowpass', 4000, 0.8);
  const env = gain(ctx, 0);
  env.connect(bright).connect(input);
  const f = mtof(midi);
  const lfo = osc(ctx, 'sine', 5.6, 0, seconds);
  const depth = gain(ctx, 0);
  lfo.connect(depth);
  depth.gain.setValueAtTime(0, 0);
  depth.gain.setValueAtTime(0, 0.22);
  depth.gain.linearRampToValueAtTime(28, 0.7);
  const pulse = pulseWave(ctx, 0.35);
  for (const [type, cents, a] of [
    ['sawtooth', -6, 0.2],
    ['sawtooth', 5, 0.2],
    ['pulse', 0, 0.14],
  ] as const) {
    const s = ctx.createOscillator();
    if (type === 'pulse') s.setPeriodicWave(pulse);
    else s.type = type;
    s.frequency.value = f;
    // Pick, then a quick slide into pitch.
    s.detune.setValueAtTime(cents - 70 - variant * 10, 0);
    s.detune.setTargetAtTime(cents, 0.004, 0.02);
    depth.connect(s.detune);
    s.start(0);
    s.stop(seconds);
    s.connect(gain(ctx, a)).connect(env);
  }
  env.gain.setValueAtTime(0, 0);
  env.gain.linearRampToValueAtTime(1, 0.004);
  env.gain.setTargetAtTime(0.6, 0.01, 0.6);
  bright.frequency.setValueAtTime(6000, 0);
  bright.frequency.setTargetAtTime(2800, 0.01, 0.4);
  gate.gain.setValueAtTime(0, 0);
  gate.gain.linearRampToValueAtTime(1, 0.004);
  gate.gain.setValueAtTime(1, seconds - 0.4);
  gate.gain.linearRampToValueAtTime(0, seconds - 0.02);
}

function bass(ctx: C, out: AudioNode, midi: number, mute: boolean): void {
  const seconds = NOTE_SECONDS[mute ? 'bassM' : 'bassO'];
  const f = mtof(midi);
  const lp = biquad(ctx, 'lowpass', 900, 1.1);
  const sh = shaper(ctx, 3.5, 0.1);
  const growl = biquad(ctx, 'peaking', 800, 1, 7);
  const hp = biquad(ctx, 'highpass', 32, 0.7);
  const env = gain(ctx, 0);
  env.connect(lp).connect(sh).connect(growl).connect(hp).connect(gain(ctx, 0.5)).connect(out);
  osc(ctx, 'sawtooth', f, 0, seconds).connect(gain(ctx, 0.45)).connect(env);
  osc(ctx, 'sawtooth', f, 0, seconds, 9).connect(gain(ctx, 0.3)).connect(env);
  osc(ctx, 'sine', f, 0, seconds).connect(gain(ctx, 0.5)).connect(env);
  lp.frequency.setValueAtTime(2200, 0);
  lp.frequency.setTargetAtTime(mute ? 500 : 750, 0.005, mute ? 0.04 : 0.25);
  env.gain.setValueAtTime(0, 0);
  env.gain.linearRampToValueAtTime(1, 0.004);
  if (mute) {
    env.gain.setTargetAtTime(0.3, 0.02, 0.06);
    env.gain.setTargetAtTime(0, 0.16, 0.04);
  } else {
    env.gain.setTargetAtTime(0.55, 0.02, 0.5);
    env.gain.setValueAtTime(0.55, seconds - 0.4);
    env.gain.linearRampToValueAtTime(0, seconds - 0.02);
  }
}

// ---- chords

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Parse a chord name like D, Dm, Bb, F#m, D5, Asus. Returns pitch classes from the root. */
export function parseChord(name: string): { root: number; tones: number[] } {
  const m = /^([A-G])(#|b)?(m|5|sus)?$/.exec(name);
  if (!m) throw new Error(`bad chord ${name}`);
  const root = (PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  const q = m[3];
  const tones = q === 'm' ? [0, 3, 7] : q === '5' ? [0, 7, 12] : q === 'sus' ? [0, 5, 7] : [0, 4, 7];
  return { root, tones };
}

/** Voice a chord with its root between `lo` and `lo + 11`. */
export function voiceChord(name: string, lo: number): number[] {
  const c = parseChord(name);
  const r = lo + ((c.root - (lo % 12) + 12) % 12);
  return c.tones.map((x) => r + x);
}

function stab(ctx: C, out: AudioNode, chord: string): void {
  const midis = voiceChord(chord, 55);
  const seconds = NOTE_SECONDS.stab;
  const f = biquad(ctx, 'lowpass', 500, 2.5);
  const g = gain(ctx, 0);
  f.connect(g).connect(out);
  f.frequency.setValueAtTime(500, 0);
  f.frequency.linearRampToValueAtTime(6000, 0.012);
  f.frequency.setTargetAtTime(900, 0.02, 0.12);
  g.gain.setValueAtTime(0, 0);
  g.gain.linearRampToValueAtTime(0.35, 0.006);
  g.gain.setTargetAtTime(0.18, 0.02, 0.1);
  g.gain.setValueAtTime(0.18, seconds - 0.25);
  g.gain.linearRampToValueAtTime(0, seconds - 0.02);
  for (const m of [...midis, midis[0] - 12])
    for (const d of [-12, -4, 5, 13]) osc(ctx, 'sawtooth', mtof(m), 0, seconds, d).connect(gain(ctx, 0.12)).connect(f);
  // Orchestra-hit grit on top.
  burst(ctx, out, 0, { type: 'bandpass', f: 3000, q: 0.7, amp: 0.08, decay: 0.03, seed: 5 });
}

function pad(ctx: C, out: AudioNode, chord: string): void {
  const midis = voiceChord(chord, 50);
  const seconds = NOTE_SECONDS.pad;
  const f = biquad(ctx, 'lowpass', 1300, 0.6);
  const g = gain(ctx, 0);
  f.connect(g).connect(out);
  g.gain.setValueAtTime(0, 0);
  g.gain.linearRampToValueAtTime(0.25, 0.5);
  g.gain.setValueAtTime(0.25, seconds - 0.8);
  g.gain.linearRampToValueAtTime(0, seconds - 0.02);
  const lfo = osc(ctx, 'sine', 0.3, 0, seconds);
  const lg = gain(ctx, 300);
  lfo.connect(lg).connect(f.frequency);
  for (const m of [midis[0] - 12, ...midis]) for (const d of [-11, 0, 10]) osc(ctx, 'sawtooth', mtof(m), 0, seconds, d).connect(gain(ctx, 0.07)).connect(f);
}

function arp(ctx: C, out: AudioNode, midi: number): void {
  const seconds = NOTE_SECONDS.arp;
  const s = ctx.createOscillator();
  s.setPeriodicWave(pulseWave(ctx, 0.25));
  s.frequency.value = mtof(midi);
  s.start(0);
  s.stop(seconds);
  const f = biquad(ctx, 'lowpass', 3500, 3);
  const g = gain(ctx, 0);
  s.connect(f).connect(g).connect(out);
  f.frequency.setValueAtTime(4000, 0);
  f.frequency.setTargetAtTime(700, 0.005, 0.06);
  g.gain.setValueAtTime(0, 0);
  g.gain.linearRampToValueAtTime(0.3, 0.003);
  g.gain.setTargetAtTime(0, 0.01, 0.12);
}

function clean(ctx: C, out: AudioNode, midi: number): void {
  const seconds = NOTE_SECONDS.clean;
  const f = biquad(ctx, 'lowpass', 2500, 0.7);
  const g = gain(ctx, 0);
  f.connect(g).connect(out);
  for (const [type, d, a] of [
    ['sawtooth', -5, 0.12],
    ['triangle', 6, 0.25],
  ] as const)
    osc(ctx, type, mtof(midi), 0, seconds, d).connect(gain(ctx, a)).connect(f);
  f.frequency.setValueAtTime(3500, 0);
  f.frequency.setTargetAtTime(1200, 0.005, 0.3);
  g.gain.setValueAtTime(0, 0);
  g.gain.linearRampToValueAtTime(0.5, 0.003);
  g.gain.setTargetAtTime(0, 0.01, 0.7);
}

// ---- drums

function room(ctx: C, out: AudioNode, wet: number, seconds = 0.7): AudioNode {
  const dry = gain(ctx, 1);
  dry.connect(out);
  const c = ctx.createConvolver();
  c.buffer = makeImpulse(ctx, { seconds, decay: seconds * 0.8, preDelay: 0.008, seed: 5, damp: 0.7 });
  dry.connect(c).connect(gain(ctx, wet)).connect(out);
  return dry;
}

const HAT_FREQS = [205.3, 304.4, 369.6, 522.7, 540, 800];

function metal(ctx: C, out: AudioNode, mult: number, decay: number, amp: number, hp: number): void {
  const bp = biquad(ctx, 'bandpass', 10000, 0.8);
  const h = biquad(ctx, 'highpass', hp, 0.7);
  const g = gain(ctx, 0);
  bp.connect(h).connect(g).connect(out);
  for (const f of HAT_FREQS) osc(ctx, 'square', f * mult, 0, decay * 8 + 0.05).connect(gain(ctx, 0.15)).connect(bp);
  burst(ctx, h, 0, { type: 'highpass', f: hp, q: 0.5, amp: amp * 0.6, decay, seed: 3 });
  g.gain.setValueAtTime(0, 0);
  g.gain.linearRampToValueAtTime(amp, 0.001);
  g.gain.setTargetAtTime(0, 0.002, decay);
}

interface DrumDef {
  seconds: number;
  render: (ctx: C, out: AudioNode) => void;
}

export const DRUMS: Record<string, DrumDef> = {
  kick: {
    seconds: 0.7,
    render: (ctx, out) => {
      const sh = shaper(ctx, 1.8, 0);
      sh.connect(out);
      thump(ctx, sh, 0, { f0: 170, f1: 50, drop: 0.045, amp: 0.95, decay: 0.16 });
      // Punch and beater click so the kick reads on small speakers.
      thump(ctx, sh, 0, { f0: 260, f1: 110, drop: 0.02, amp: 0.35, decay: 0.03 });
      burst(ctx, sh, 0, { type: 'bandpass', f: 2800, q: 0.9, amp: 0.7, decay: 0.008, seed: 1 });
      burst(ctx, out, 0, { type: 'highpass', f: 5000, q: 0.5, amp: 0.25, decay: 0.003, seed: 2 });
    },
  },
  snare: {
    seconds: 1.0,
    render: (ctx, out) => {
      const o = room(ctx, out, 0.35);
      const sh = shaper(ctx, 1.6, 0);
      sh.connect(o);
      thump(ctx, sh, 0, { f0: 240, f1: 185, drop: 0.03, amp: 0.55, decay: 0.07, type: 'triangle' });
      thump(ctx, sh, 0, { f0: 340, f1: 320, drop: 0.02, amp: 0.25, decay: 0.04 });
      burst(ctx, sh, 0, { type: 'bandpass', f: 4200, q: 0.5, amp: 0.7, decay: 0.09, seed: 4 });
      burst(ctx, sh, 0, { type: 'highpass', f: 1500, q: 0.7, amp: 0.3, decay: 0.05, seed: 5 });
    },
  },
  hatC: { seconds: 0.2, render: (ctx, out) => metal(ctx, out, 1.6, 0.025, 0.5, 7000) },
  hatO: { seconds: 0.8, render: (ctx, out) => metal(ctx, out, 1.6, 0.16, 0.45, 6500) },
  crash: {
    seconds: 3.4,
    render: (ctx, out) => {
      metal(ctx, out, 2.2, 0.75, 0.4, 4000);
      burst(ctx, out, 0, { type: 'highpass', f: 3000, q: 0.5, amp: 0.35, decay: 0.6, seed: 7 });
      burst(ctx, out, 0, { type: 'bandpass', f: 600, q: 0.8, amp: 0.15, decay: 0.05, seed: 8 });
    },
  },
  ride: {
    seconds: 1.6,
    render: (ctx, out) => {
      metal(ctx, out, 2.9, 0.35, 0.22, 5000);
      thump(ctx, out, 0, { f0: 3000, f1: 2900, drop: 0.01, amp: 0.05, decay: 0.3 });
    },
  },
  tom1: { seconds: 0.8, render: (ctx, out) => tom(ctx, out, 210) },
  tom2: { seconds: 0.9, render: (ctx, out) => tom(ctx, out, 150) },
  tom3: { seconds: 1.0, render: (ctx, out) => tom(ctx, out, 100) },
  boom: {
    seconds: 3.0,
    render: (ctx, out) => {
      const o = room(ctx, out, 0.6, 2.5);
      thump(ctx, o, 0, { f0: 75, f1: 28, drop: 0.5, amp: 0.95, decay: 0.7 });
      burst(ctx, o, 0, { type: 'lowpass', f: 300, q: 0.7, amp: 0.6, decay: 0.2, color: 'brown', seed: 9 });
      burst(ctx, o, 0, { type: 'highpass', f: 2000, q: 0.5, amp: 0.25, decay: 0.3, seed: 10 });
    },
  },
};

function tom(ctx: C, out: AudioNode, f: number): void {
  const o = room(ctx, out, 0.3);
  thump(ctx, o, 0, { f0: f * 1.5, f1: f, drop: 0.04, amp: 0.8, decay: 0.18 });
  burst(ctx, o, 0, { type: 'lowpass', f: 1200, q: 0.7, amp: 0.25, decay: 0.02, seed: f });
}

/** Rising noise sweep over `seconds`, peaking at the end (cut at the downbeat). */
function riser(ctx: C, out: AudioNode, seconds: number): void {
  const f = biquad(ctx, 'bandpass', 300, 1.8);
  const g = gain(ctx, 0);
  noise(ctx, 0, seconds + 0.1, 'white', 12).connect(f).connect(g).connect(out);
  f.frequency.setValueAtTime(300, 0);
  f.frequency.exponentialRampToValueAtTime(7000, seconds);
  g.gain.setValueAtTime(0.001, 0);
  g.gain.exponentialRampToValueAtTime(0.5, seconds);
  g.gain.linearRampToValueAtTime(0, seconds + 0.05);
  const s = osc(ctx, 'sawtooth', 80, 0, seconds + 0.05);
  s.frequency.exponentialRampToValueAtTime(640, seconds);
  const sg = gain(ctx, 0);
  s.connect(biquad(ctx, 'lowpass', 1800, 1)).connect(sg).connect(out);
  sg.gain.setValueAtTime(0, 0);
  sg.gain.linearRampToValueAtTime(0.08, seconds);
  sg.gain.linearRampToValueAtTime(0, seconds + 0.05);
}

/** Every music sample is peak-normalized so lane levels in score.ts are the mix. */
const NOTE_PEAK: Record<string, number> = {
  gtrM: 0.9,
  gtrO: 0.9,
  crM: 0.9,
  crO: 0.9,
  lead: 0.9,
  bassM: 0.9,
  bassO: 0.9,
  stab: 0.9,
  pad: 0.9,
  arp: 0.9,
  clean: 0.9,
  kick: 0.95,
  snare: 0.95,
  hatC: 0.9,
  hatO: 0.9,
  crash: 0.9,
  ride: 0.9,
  tom1: 0.9,
  tom2: 0.9,
  tom3: 0.9,
  boom: 0.95,
  riser: 0.8,
};

/** Make sure a music sample key is defined in the bank. */
export function defineNote(bank: Bank, key: string): void {
  if (bank.has(key)) return;
  const [, inst, arg, v] = key.split('.');
  const variant = Number(v ?? 0);
  const midi = Number(arg);
  let def: { seconds: number; rate?: number; render: (ctx: C, out: AudioNode) => void } | null = null;
  switch (inst) {
    case 'gtrM':
    case 'gtrO':
    case 'crM':
    case 'crO':
      def = {
        seconds: NOTE_SECONDS[inst],
        render: (ctx, out) => guitar(ctx, out, midi, { mute: inst.endsWith('M'), variant, crunch: inst.startsWith('cr') }),
      };
      break;
    case 'lead':
      def = { seconds: NOTE_SECONDS.lead, render: (ctx, out) => leadGuitar(ctx, out, midi, variant) };
      break;
    case 'bassM':
    case 'bassO':
      def = { seconds: NOTE_SECONDS[inst], render: (ctx, out) => bass(ctx, out, midi, inst === 'bassM') };
      break;
    case 'stab':
      def = { seconds: NOTE_SECONDS.stab, render: (ctx, out) => stab(ctx, out, arg) };
      break;
    case 'pad':
      def = { seconds: NOTE_SECONDS.pad, render: (ctx, out) => pad(ctx, out, arg) };
      break;
    case 'arp':
      def = { seconds: NOTE_SECONDS.arp, render: (ctx, out) => arp(ctx, out, midi) };
      break;
    case 'clean':
      def = { seconds: NOTE_SECONDS.clean, render: (ctx, out) => clean(ctx, out, midi) };
      break;
    case 'riser': {
      const secs = midi / 1000;
      def = { seconds: secs + 0.1, render: (ctx, out) => riser(ctx, out, secs) };
      break;
    }
    default: {
      const d = DRUMS[inst];
      if (d) def = d;
    }
  }
  if (!def) throw new Error(`unknown music sample ${key}`);
  const align = inst !== 'riser' && inst !== 'boom' && inst !== 'pad';
  bank.define(key, { ...def, rate: def.rate ?? NOTE_RATE[inst], align, peak: NOTE_PEAK[inst] });
}
