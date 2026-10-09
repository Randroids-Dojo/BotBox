// Small DSP helpers shared by the bank renderers and the live engine.

export const dbToGain = (db: number): number => Math.pow(10, db / 20);
export const gainToDb = (g: number): number => 20 * Math.log10(Math.max(1e-9, g));
export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** Deterministic PRNG (mulberry32) so renders are repeatable. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type NoiseColor = 'white' | 'pink' | 'brown';

/** Fill a Float32Array with noise of the given color, normalized to about +-1 peak. */
export function fillNoise(out: Float32Array, color: NoiseColor, seed: number): void {
  const r = rng(seed);
  if (color === 'white') {
    for (let i = 0; i < out.length; i++) out[i] = r() * 2 - 1;
    return;
  }
  if (color === 'pink') {
    // Paul Kellet's economy pink filter.
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < out.length; i++) {
      const w = r() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25;
    }
    return;
  }
  let last = 0;
  for (let i = 0; i < out.length; i++) {
    last = (last + 0.02 * (r() * 2 - 1)) / 1.02;
    out[i] = last * 3.5;
  }
}

const noiseCache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

/** A shared looping noise buffer per context and color (2 s, made once). */
export function noiseBuffer(ctx: BaseAudioContext, color: NoiseColor = 'white', seconds = 2, seed = 1): AudioBuffer {
  let m = noiseCache.get(ctx);
  if (!m) noiseCache.set(ctx, (m = new Map()));
  const key = `${color}:${seconds}:${seed}`;
  let b = m.get(key);
  if (!b) {
    b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    fillNoise(b.getChannelData(0), color, seed);
    m.set(key, b);
  }
  return b;
}

/** A noise source started at `t` (and stopped at `t + dur` if given). */
export function noise(
  ctx: BaseAudioContext,
  t: number,
  dur: number | null,
  color: NoiseColor = 'white',
  seed = 1,
): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx, color, 2, 1);
  s.loop = true;
  s.start(t, (seed * 0.137) % 1.9);
  if (dur != null) s.stop(t + dur);
  return s;
}

/** Synthetic reverb impulse: stereo decorrelated noise with an exponential decay, a little
 *  pre-delay, early reflections and a darker tail. */
export function makeImpulse(
  ctx: BaseAudioContext,
  o: { seconds: number; decay: number; preDelay?: number; early?: number; damp?: number; seed?: number },
): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * o.seconds);
  const b = ctx.createBuffer(2, len, sr);
  const pre = Math.floor((o.preDelay ?? 0.01) * sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    const r = rng((o.seed ?? 3) + ch * 101);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const tt = (i - pre) / sr;
      const env = Math.exp((-6.9 * tt) / o.decay);
      // Damping: the tail gets darker over time.
      const a = Math.min(0.95, (o.damp ?? 0.5) * (tt / o.decay));
      lp = lp * a + (r() * 2 - 1) * (1 - a);
      d[i] = lp * env;
    }
    // Early reflections.
    const n = o.early ?? 8;
    for (let k = 0; k < n; k++) {
      const at = pre + Math.floor(r() * sr * Math.min(0.08, o.seconds * 0.3));
      if (at < len) d[at] += (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.5) * (1 - k / n);
    }
  }
  // Normalize energy so wet levels are predictable.
  let e = 0;
  for (let ch = 0; ch < 2; ch++) for (const x of b.getChannelData(ch)) e += x * x;
  const g = 1 / Math.sqrt(e / 2 + 1e-9);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] *= g * 0.6;
  }
  return b;
}

/** Soft clipping curve. `drive` > 1 pushes harder; `asym` adds even harmonics. */
export function shaperCurve(drive: number, asym = 0, n = 4096): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const y = Math.tanh(drive * (x + asym * x * x)) - Math.tanh(drive * asym * 0);
    c[i] = y / norm;
  }
  // Remove the DC that asymmetry adds at zero input.
  const mid = c[Math.floor(n / 2)];
  for (let i = 0; i < n; i++) c[i] -= mid;
  return c;
}

/** Safety clipper: linear to `knee`, then smooth up to `ceil` (never reaches full scale). */
export function safetyCurve(knee = 0.8, n = 4096, ceil = 0.97): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2.4 - 1.2; // input range is wider than 1
    const ax = Math.abs(x);
    const y = ax <= knee ? ax : knee + (ceil - knee) * Math.tanh((ax - knee) / (ceil - knee));
    c[i] = Math.sign(x) * y;
  }
  return c;
}

/** Exponential decay envelope on a gain param: hit `peak` after `attack`, fall to ~0 by `t + dur`. */
export function pluck(p: AudioParam, t: number, peak: number, attack: number, dur: number, floor = 0.0001): void {
  p.setValueAtTime(floor, t);
  p.linearRampToValueAtTime(peak, t + attack);
  p.setTargetAtTime(floor, t + attack, Math.max(0.001, dur / 5));
}

export function osc(ctx: BaseAudioContext, type: OscillatorType, freq: number, t: number, stop?: number, detune = 0): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  o.start(t);
  if (stop != null) o.stop(stop);
  return o;
}

export function gain(ctx: BaseAudioContext, v = 1): GainNode {
  const g = ctx.createGain();
  g.gain.value = v;
  return g;
}

export function biquad(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q = 0.707, gainDb = 0): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  f.gain.value = gainDb;
  return f;
}

/** Connect a chain of nodes in order and return the last. */
export function chain<T extends AudioNode>(...nodes: [AudioNode, ...AudioNode[], T]): T {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1] as T;
}

/** A pulse wave as a PeriodicWave with the given duty cycle. */
export function pulseWave(ctx: BaseAudioContext, duty: number, harmonics = 64): PeriodicWave {
  const re = new Float32Array(harmonics);
  const im = new Float32Array(harmonics);
  for (let k = 1; k < harmonics; k++) re[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  return ctx.createPeriodicWave(re, im);
}

/** RBJ cookbook biquad for direct sample synthesis in `make` renderers. */
export class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  constructor(private sr: number, type: 'lp' | 'hp' | 'bp' | 'peak' = 'lp', f = 1000, q = 0.707, db = 0) {
    this.set(type, f, q, db);
  }
  set(type: 'lp' | 'hp' | 'bp' | 'peak', f: number, q: number, db = 0): void {
    const w = (2 * Math.PI * Math.min(f, this.sr * 0.49)) / this.sr;
    const cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q);
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else {
      const A = Math.pow(10, db / 40);
      b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }
  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/** Add a short damped modal "ping" (sum of sines) into `out` at sample `at`. */
export function addPing(out: Float32Array, sr: number, at: number, freqs: number[], amp: number, decay: number): void {
  const n = Math.min(out.length - at, Math.floor(decay * 7 * sr));
  for (let k = 0; k < freqs.length; k++) {
    const w = (2 * Math.PI * freqs[k]) / sr;
    const a = amp / (1 + k * 0.6);
    const d = Math.exp(-1 / (decay * sr / (1 + k * 0.4)));
    let e = a;
    for (let i = 0; i < n; i++) {
      out[at + i] += Math.sin(w * i) * e;
      e *= d;
    }
  }
}
