// Recorded voice lines: manifest, on-demand decode with a small cache, one line at a time,
// per-speaker processing (Vic on the arena PA, Dale and Chuck dry in the booth, Jenna on the
// floor), and ducking of music and crowd while a line plays.

import { dbToGain, makeImpulse } from './dsp';
import type { Mixer } from './mixer';

export interface ManifestLine {
  file: string;
  text: string;
  speaker: string;
  dur: number;
}

interface Manifest {
  version: number;
  lines: Record<string, ManifestLine>;
}

const BASE = (import.meta.env?.BASE_URL ?? '/') + 'voice/';
/** Manifest files are relative to public/voice; absolute and blob URLs pass through (tests). */
const url = (file: string) => (/^(blob:|data:|https?:|\/)/.test(file) ? file : BASE + file);

/** Loads the manifest once, shared by every engine instance. */
let manifestPromise: Promise<Manifest | null> | null = null;
export function loadManifest(): Promise<Manifest | null> {
  if (!manifestPromise)
    manifestPromise = fetch(BASE + 'manifest.json')
      .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
      .then((m) => (m && typeof m === 'object' && m.lines ? m : null))
      .catch(() => null);
  return manifestPromise;
}

export class VoiceManifest {
  lines: Record<string, ManifestLine> = {};
  ready: Promise<void>;
  constructor() {
    this.ready = loadManifest().then((m) => {
      if (m) this.lines = m.lines;
    });
  }
  ids(): string[] {
    return Object.keys(this.lines);
  }
}

type Speaker = 'Vic' | 'Dale' | 'Chuck' | 'Jenna';

export class VoicePlayer {
  private chains = new Map<string, AudioNode>();
  private cache = new Map<string, AudioBuffer>();
  private loads = new Map<string, Promise<AudioBuffer | null>>();
  private cur: { id: string; src: AudioBufferSourceNode | null; gain: GainNode | null; resolve: (ok: boolean) => void; token: number } | null = null;
  private token = 0;

  constructor(
    private ctx: BaseAudioContext,
    private mixer: Mixer,
    private manifest: VoiceManifest,
  ) {}

  busy(): boolean {
    return this.cur != null;
  }

  private chain(speaker: string): AudioNode {
    const have = this.chains.get(speaker);
    if (have) return have;
    const ctx = this.ctx;
    const out = this.mixer.voiceIn;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = speaker === 'Vic' ? 95 : 85;
    hp.Q.value = 0.7;
    const pres = ctx.createBiquadFilter();
    pres.type = 'peaking';
    pres.frequency.value = speaker === 'Vic' ? 2800 : 3800;
    pres.Q.value = 0.9;
    pres.gain.value = speaker === 'Vic' ? 3 : 2;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -22;
    comp.ratio.value = 4;
    comp.knee.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.12;
    const pan = ctx.createStereoPanner();
    const lvl = ctx.createGain();
    hp.connect(pres).connect(comp).connect(lvl).connect(pan).connect(out);
    const s = speaker as Speaker;
    if (s === 'Vic') {
      // The arena PA: a big hall, and a slap off the far stands.
      lvl.gain.value = dbToGain(-1);
      const verb = ctx.createConvolver();
      verb.buffer = makeImpulse(ctx, { seconds: 2.8, decay: 2.4, preDelay: 0.045, seed: 21, damp: 0.55 });
      const wet = ctx.createGain();
      wet.gain.value = 0.42;
      comp.connect(verb).connect(wet).connect(out);
      const slap = ctx.createDelay(0.5);
      slap.delayTime.value = 0.13;
      const fb = ctx.createGain();
      fb.gain.value = 0.22;
      const slapLP = ctx.createBiquadFilter();
      slapLP.type = 'lowpass';
      slapLP.frequency.value = 2400;
      const slapG = ctx.createGain();
      slapG.gain.value = 0.28;
      comp.connect(slap).connect(slapLP).connect(slapG).connect(out);
      slapLP.connect(fb).connect(slap);
    } else if (s === 'Jenna') {
      lvl.gain.value = dbToGain(-2);
      const verb = ctx.createConvolver();
      verb.buffer = makeImpulse(ctx, { seconds: 0.6, decay: 0.45, preDelay: 0.012, seed: 23, damp: 0.7 });
      const wet = ctx.createGain();
      wet.gain.value = 0.2;
      comp.connect(verb).connect(wet).connect(out);
    } else {
      // Booth mics: close and dry. The two hosts sit a little apart.
      lvl.gain.value = dbToGain(-2);
      pan.pan.value = s === 'Dale' ? -0.12 : s === 'Chuck' ? 0.12 : 0;
    }
    this.chains.set(speaker, hp);
    return hp;
  }

  private load(id: string): Promise<AudioBuffer | null> {
    const have = this.cache.get(id);
    if (have) {
      // Refresh LRU order.
      this.cache.delete(id);
      this.cache.set(id, have);
      return Promise.resolve(have);
    }
    const p = this.loads.get(id);
    if (p) return p;
    const line = this.manifest.lines[id];
    if (!line) return Promise.resolve(null);
    const job = fetch(url(line.file))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
      .then((ab) => this.ctx.decodeAudioData(ab))
      .then((b) => {
        this.cache.set(id, b);
        while (this.cache.size > 48) this.cache.delete(this.cache.keys().next().value!);
        return b;
      })
      .catch((e) => {
        console.warn(`audio: voice ${id} failed to load`, e);
        return null;
      })
      .finally(() => this.loads.delete(id));
    this.loads.set(id, job);
    return job;
  }

  /** Warm the cache for lines that are about to be needed. */
  preload(ids: string[]): Promise<void> {
    return Promise.all(ids.map((id) => this.load(id))).then(() => undefined);
  }

  play(id: string, interrupt: boolean): Promise<boolean> {
    const line = this.manifest.lines[id];
    if (!line) return Promise.resolve(false);
    if (this.cur && !interrupt) return Promise.resolve(false);
    if (this.cur) this.stop();
    const token = ++this.token;
    return new Promise<boolean>((resolve) => {
      this.cur = { id, src: null, gain: null, resolve, token };
      this.mixer.duck(true);
      void this.load(id).then((buf) => {
        if (!this.cur || this.cur.token !== token) return;
        if (!buf) {
          this.finish(false);
          return;
        }
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        const g = this.ctx.createGain();
        src.connect(g).connect(this.chain(line.speaker));
        src.onended = () => {
          if (this.cur?.token === token) this.finish(true);
        };
        src.start(this.ctx.currentTime + 0.01);
        this.cur.src = src;
        this.cur.gain = g;
      });
    });
  }

  private finish(ok: boolean): void {
    const c = this.cur;
    if (!c) return;
    this.cur = null;
    this.mixer.duck(false);
    c.resolve(ok);
  }

  stop(): void {
    const c = this.cur;
    if (!c) return;
    if (c.src && c.gain) {
      const t = this.ctx.currentTime;
      c.gain.gain.setTargetAtTime(0, t, 0.012);
      try {
        c.src.stop(t + 0.06);
      } catch {
        /* not started */
      }
    }
    this.finish(false);
  }
}
