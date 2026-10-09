// The sample bank. Every effect, crowd texture and music note is synthesized once into an
// AudioBuffer with an OfflineAudioContext (which needs no user gesture and renders off the main
// thread), then played back with cheap AudioBufferSourceNodes. This keeps the live graph small:
// a hit is three or four buffer sources, a guitar chug is two.

export interface SoundDef {
  /** Rendered length in seconds (the tail is faded over the last 10 ms). */
  seconds: number;
  channels?: 1 | 2;
  /** Render rate. Crowd textures use a lower rate to save memory. */
  rate?: number;
  /** Seamless loop: renders `xfade` extra seconds and folds them over the head. */
  loop?: { xfade: number };
  /** Build the graph into `out` starting at time 0. */
  render?: (ctx: OfflineAudioContext, out: AudioNode) => void | Promise<void>;
  /** Or compute samples directly. */
  make?: (rate: number) => Float32Array[];
  /** Normalize the rendered peak to this linear level. */
  peak?: number;
  /** Shift the sample so its onset lands 0.5 ms in. Oversampled waveshapers add a few ms of
   *  latency each, which would put notes behind the beat. */
  align?: boolean;
}

export class Bank {
  private defs = new Map<string, SoundDef>();
  private buffers = new Map<string, AudioBuffer>();
  private pending = new Map<string, Promise<AudioBuffer | undefined>>();
  private queue: (() => void)[] = [];
  private running = 0;
  /** Seconds spent rendering, for the lab. */
  renderSeconds = 0;
  rendered = 0;

  constructor(readonly rate = 48000, private concurrency = 3) {}

  define(id: string, def: SoundDef): void {
    if (!this.defs.has(id)) this.defs.set(id, def);
  }
  has(id: string): boolean {
    return this.defs.has(id);
  }
  ids(prefix = ''): string[] {
    return [...this.defs.keys()].filter((k) => k.startsWith(prefix));
  }
  get(id: string): AudioBuffer | undefined {
    return this.buffers.get(id);
  }
  /** Total bytes held by rendered buffers. */
  bytes(): number {
    let n = 0;
    for (const b of this.buffers.values()) n += b.length * b.numberOfChannels * 4;
    return n;
  }

  /** Render (once) and resolve to the buffer. */
  load(id: string): Promise<AudioBuffer | undefined> {
    const have = this.buffers.get(id);
    if (have) return Promise.resolve(have);
    const p = this.pending.get(id);
    if (p) return p;
    const def = this.defs.get(id);
    if (!def) return Promise.resolve(undefined);
    const job = new Promise<AudioBuffer | undefined>((resolve) => {
      this.queue.push(() => {
        this.running++;
        const t0 = performance.now();
        this.renderDef(def)
          .then((b) => {
            this.buffers.set(id, b);
            resolve(b);
          })
          .catch((e) => {
            console.warn(`audio: render of ${id} failed`, e);
            resolve(undefined);
          })
          .finally(() => {
            this.renderSeconds += (performance.now() - t0) / 1000;
            this.rendered++;
            this.pending.delete(id);
            this.running--;
            this.next();
          });
      });
      this.next();
    });
    this.pending.set(id, job);
    return job;
  }

  ensure(ids: Iterable<string>): Promise<void> {
    return Promise.all([...ids].map((id) => this.load(id))).then(() => undefined);
  }

  private next(): void {
    while (this.running < this.concurrency && this.queue.length) this.queue.shift()!();
  }

  private async renderDef(def: SoundDef): Promise<AudioBuffer> {
    const rate = def.rate ?? this.rate;
    const ch = def.channels ?? 1;
    const extra = def.loop?.xfade ?? 0;
    const len = Math.max(1, Math.ceil((def.seconds + extra) * rate));
    let data: Float32Array[];
    if (def.make) {
      data = def.make(rate);
    } else {
      const ctx = new OfflineAudioContext(ch, len, rate);
      const out = ctx.createGain();
      out.connect(ctx.destination);
      await def.render!(ctx, out);
      const b = await ctx.startRendering();
      data = [];
      for (let c = 0; c < ch; c++) data.push(b.getChannelData(c));
    }
    if (def.peak) {
      let m = 0;
      for (const c of data) for (let i = 0; i < c.length; i++) m = Math.max(m, Math.abs(c[i]));
      if (m > 1e-6) {
        const g = def.peak / m;
        for (const c of data) for (let i = 0; i < c.length; i++) c[i] *= g;
      }
    }
    if (def.align) {
      let m = 0;
      for (const c of data) for (let i = 0; i < c.length; i++) m = Math.max(m, Math.abs(c[i]));
      let first = data[0].length;
      for (const c of data) {
        const i = c.findIndex((x) => Math.abs(x) > m * 0.003);
        if (i >= 0) first = Math.min(first, i);
      }
      const shift = Math.max(0, first - Math.floor(rate * 0.0005));
      if (shift > 0) data = data.map((c) => c.slice(shift));
    }
    const outLen = Math.ceil(def.seconds * rate);
    const res = new AudioBuffer({ length: outLen, numberOfChannels: data.length, sampleRate: rate });
    for (let c = 0; c < data.length; c++) {
      const src = data[c];
      const dst = new Float32Array(outLen);
      dst.set(src.subarray(0, Math.min(outLen, src.length)));
      if (def.loop) {
        // Fold the rendered overhang onto the head with an equal-power crossfade.
        const x = Math.min(Math.floor(def.loop.xfade * rate), src.length - outLen);
        for (let i = 0; i < x; i++) {
          const a = i / x;
          dst[i] = dst[i] * Math.sin(a * Math.PI * 0.5) + src[outLen + i] * Math.cos(a * Math.PI * 0.5);
        }
      } else {
        const f = Math.min(outLen, Math.floor(0.01 * rate));
        for (let i = 0; i < f; i++) dst[outLen - 1 - i] *= i / f;
      }
      res.copyToChannel(dst, c);
    }
    return res;
  }
}
