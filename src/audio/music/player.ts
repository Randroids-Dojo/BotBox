// Plays compiled cues from bank samples with a lookahead scheduler and crossfades between cues.

import type { Bank } from '../bank';
import type { MusicCue } from '../types';
import { CUES } from './cues';
import { defineNote } from './instruments';
import { compileCue, LANE_LEVEL, LANE_PAN, type CompiledCue, type CueDef, type Lane, type NoteEvent, type Segment } from './score';

type Cue = Exclude<MusicCue, 'none'>;

const STINGS: Cue[] = ['victory', 'defeat', 'bumper'];

const compiled = new Map<Cue, CompiledCue>();
export function compiledCue(cue: Cue): CompiledCue {
  let c = compiled.get(cue);
  if (!c) compiled.set(cue, (c = compileCue(CUES[cue])));
  return c;
}

/** Bank keys a cue needs, defined on the bank. */
export function cueKeys(bank: Bank, cue: Cue): string[] {
  const keys = [...compiledCue(cue).keys];
  for (const k of keys) defineNote(bank, k);
  return keys;
}

function release(key: string): number {
  if (key.startsWith('m.pad')) return 0.35;
  if (key.startsWith('m.gtrO') || key.startsWith('m.crO') || key.startsWith('m.bassO')) return 0.045;
  if (key.startsWith('m.lead') || key.startsWith('m.clean')) return 0.06;
  return 0.02;
}

class CueVoice {
  readonly out: GainNode;
  private lanes = new Map<Lane, GainNode>();
  private seg: Segment;
  private segStart: number;
  private idx = 0;
  private inLoop = false;
  private sources: { src: AudioBufferSourceNode; end: number }[] = [];
  done = false;
  stopAt = Infinity;
  private head: AudioNode;
  private def: CueDef;
  private solo: Set<Lane> | null;

  constructor(
    private ctx: BaseAudioContext,
    private bank: Bank,
    readonly cue: Cue,
    private c: CompiledCue,
    dest: AudioNode,
    start: number,
    solo: Set<Lane> | null,
  ) {
    const def = CUES[cue];
    this.out = ctx.createGain();
    let head: AudioNode = this.out;
    const chainTo = (n: AudioNode) => {
      n.connect(head);
      head = n;
    };
    // Built back to front: lanes feed `head`, `head` ends in `out`.
    if (def.scoop) {
      const s = ctx.createBiquadFilter();
      s.type = 'peaking';
      s.frequency.value = 2600;
      s.Q.value = 0.7;
      s.gain.value = -5;
      chainTo(s);
      const s2 = ctx.createBiquadFilter();
      s2.type = 'peaking';
      s2.frequency.value = 900;
      s2.Q.value = 0.8;
      s2.gain.value = -2.5;
      chainTo(s2);
    }
    if (def.radio) {
      // A boombox on a workbench: narrow band, a little crunch.
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3800;
      lp.Q.value = 1.2;
      chainTo(lp);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 280;
      hp.Q.value = 0.9;
      chainTo(hp);
      const pk = ctx.createBiquadFilter();
      pk.type = 'peaking';
      pk.frequency.value = 1500;
      pk.Q.value = 1;
      pk.gain.value = 5;
      chainTo(pk);
    }
    const level = ctx.createGain();
    level.gain.value = def.level ?? 1;
    chainTo(level);
    this.out.connect(dest);
    this.head = head;
    this.def = def;
    this.solo = solo;
    this.seg = c.intro.events.length ? c.intro : (c.loop ?? c.intro);
    this.inLoop = this.seg === c.loop;
    this.segStart = start;
  }

  /** Where the cue is: seconds into the current segment, and which segment. */
  position(now: number): { t: number; loop: boolean } {
    return { t: now - this.segStart, loop: this.inLoop };
  }

  pump(until: number): void {
    if (this.done) return;
    for (;;) {
      if (this.idx >= this.seg.events.length) {
        const next = this.c.loop;
        if (!next) {
          // One-shot cue: finished once the last tail has played out.
          if (until > this.segStart + this.seg.duration + 5) this.done = true;
          return;
        }
        this.segStart += this.seg.duration;
        this.seg = next;
        this.inLoop = true;
        this.idx = 0;
        continue;
      }
      const e = this.seg.events[this.idx];
      const t = this.segStart + e.t;
      if (t >= until) break;
      this.idx++;
      if (t >= this.stopAt) continue;
      if (t < this.ctx.currentTime - 0.02) continue; // late (tab was asleep): skip, do not pile up
      this.play(e, t);
    }
    const now = this.ctx.currentTime;
    if (this.sources.length > 64) this.sources = this.sources.filter((s) => s.end > now);
  }

  private play(e: NoteEvent, t: number): void {
    const buf = this.bank.get(e.key);
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = e.vel;
    src.connect(g).connect(this.lane(e.lane));
    src.start(t);
    let end = t + buf.duration;
    if (Number.isFinite(e.dur) && e.dur < buf.duration) {
      const r = release(e.key);
      g.gain.setValueAtTime(e.vel, t + e.dur);
      g.gain.setTargetAtTime(0, t + e.dur, r / 3);
      end = t + e.dur + r * 2;
      src.stop(end);
    }
    this.sources.push({ src, end });
  }

  /** Lanes are made on first use, so a sparse cue does not pay for unused ones. */
  private lane(lane: Lane): GainNode {
    let g = this.lanes.get(lane);
    if (g) return g;
    g = this.ctx.createGain();
    g.gain.value = this.solo && !this.solo.has(lane) ? 0 : (this.def.mix?.[lane] ?? LANE_LEVEL[lane]);
    if (LANE_PAN[lane]) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = LANE_PAN[lane];
      g.connect(p).connect(this.head);
    } else {
      // Keep the equal-power pan law of the panned lanes (a centered panner is -3 dB).
      g.gain.value *= Math.SQRT1_2;
      g.connect(this.head);
    }
    this.lanes.set(lane, g);
    return g;
  }

  fadeOut(at: number, sec: number): void {
    this.stopAt = at + sec;
    const g = this.out.gain;
    g.cancelScheduledValues(at);
    g.setValueAtTime(g.value, at);
    g.linearRampToValueAtTime(0, at + Math.max(0.02, sec));
    for (const s of this.sources) if (s.end > at + sec) s.src.stop(at + sec + 0.05);
  }

  dispose(): void {
    this.done = true;
    try {
      this.out.disconnect();
    } catch {
      /* already gone */
    }
  }
}

export class MusicPlayer {
  private current: CueVoice | null = null;
  private fading: CueVoice[] = [];
  private want: { cue: MusicCue; fade: number; token: number } = { cue: 'none', fade: 0, token: 0 };
  private loading: Promise<void> | null = null;
  /** Testing: only these lanes are audible in cues started from now on. */
  solo: Set<Lane> | null = null;

  constructor(
    private ctx: BaseAudioContext,
    private bank: Bank,
    private dest: AudioNode,
  ) {}

  get cue(): MusicCue {
    return this.current?.cue ?? 'none';
  }

  /** Resolves when the requested cue has started (or failed). */
  idle(): Promise<void> {
    return this.loading ?? Promise.resolve();
  }

  play(cue: MusicCue, fade = 1): void {
    if (cue === this.want.cue && (this.current?.cue === cue || this.loading)) return;
    const token = ++this.want.token;
    this.want = { cue, fade, token };
    if (cue === 'none') {
      this.loading = null;
      this.stopCurrent(fade);
      return;
    }
    const keys = cueKeys(this.bank, cue);
    this.loading = this.bank.ensure(keys).then(() => {
      if (this.want.token !== token) return;
      this.loading = null;
      this.start(cue, fade);
    });
  }

  private stopCurrent(fade: number): void {
    if (!this.current) return;
    this.current.fadeOut(this.ctx.currentTime, fade);
    this.fading.push(this.current);
    this.current = null;
  }

  private start(cue: Cue, fade: number): void {
    const now = this.ctx.currentTime;
    const at = now + 0.06;
    this.stopCurrent(Math.max(0.05, fade));
    const v = new CueVoice(this.ctx, this.bank, cue, compiledCue(cue), this.dest, at, this.solo);
    const fadeIn = STINGS.includes(cue) ? 0 : fade;
    if (fadeIn > 0.05) {
      v.out.gain.setValueAtTime(0, at);
      v.out.gain.linearRampToValueAtTime(1, at + fadeIn);
    }
    this.current = v;
    v.pump(at + 0.3);
  }

  pump(lookahead = 0.3): void {
    const until = this.ctx.currentTime + lookahead;
    this.current?.pump(until);
    const now = this.ctx.currentTime;
    for (const f of this.fading) {
      f.pump(until);
      if (now > f.stopAt + 0.3) f.dispose();
    }
    this.fading = this.fading.filter((f) => !f.done);
    if (this.current?.done) {
      this.current.dispose();
      this.current = null;
    }
  }

  position(): { cue: MusicCue; t: number; loop: boolean } {
    if (!this.current) return { cue: 'none', t: 0, loop: false };
    return { cue: this.current.cue, ...this.current.position(this.ctx.currentTime) };
  }
}
