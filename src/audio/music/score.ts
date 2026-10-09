// Pattern notation and the compiler from cue definitions to timed sample events.
//
// Every bar is 16 sixteenth-note steps.
//   gtr, bass: one char per step. Lowercase = palm-muted chug, uppercase = open chord that rings
//     until the next event or a '.'. '-' holds, '.' rests (and chokes a ringing chord).
//     Letters: j C#2 (bass lines), d D2, e Eb2, k E2, f F2, n F#2, g G2, h Ab2, a A2, b Bb2, m B2,
//     c C3, p C#3, q D3. The rock bass plays an octave under these, the soft bass at pitch.
//   kick, snare, tom, hat, cym: one char per step. x hit, X accent, o ghost. Snare: r rim click.
//     Hats: x closed, O open, s brush swish. Toms: 1 high, 2 mid, 3 low. Cymbals: x crash, r ride.
//   lead, arp, clean, piano, cgtr: space separated tokens, one per step: a note (A4, C#5, Bb3),
//     '-' hold, '.' rest. Join notes with '+' for a chord (D3+A3+F4, rolled on piano and strummed on
//     cgtr). A leading '~' plays the token soft.
//   stab, pad: tokens are chord names (Dm, Bb, F#m, D5), '-' hold, '.' rest.
//   fx: tokens 'boom', 'riser:<steps>' (a sweep that peaks <steps> later), '.'.

import { NOTE_SECONDS } from './instruments';

export type TrackId = 'gtr' | 'bass' | 'kick' | 'snare' | 'hat' | 'cym' | 'tom' | 'lead' | 'arp' | 'clean' | 'piano' | 'cgtr' | 'stab' | 'pad' | 'fx';

export interface Section {
  bars: number;
  /** Bar patterns; a track shorter than `bars` repeats. 'follow' on bass doubles the guitar roots. */
  tracks: Partial<Record<TrackId, string[] | 'follow'>>;
}

export interface CueDef {
  bpm: number;
  /** Semitones added to every pitched note. */
  transpose?: number;
  /** Crunch (lower gain) guitar instead of the high-gain rig. */
  crunch?: boolean;
  sections: Section[];
  /** Index of the section the loop returns to, or null to play once and stop. */
  loopFrom: number | null;
  /** Track level overrides. */
  mix?: Partial<Record<Lane, number>>;
  /** Cue output level. */
  level?: number;
  /** Lo-fi radio filter: true for the boombox in the pits, or a cheaper set (see RadioOpts). */
  radio?: boolean | RadioOpts;
  /** Brushes and a felt kick instead of the rock kit. */
  kit?: 'rock' | 'soft';
  /** Fingered round bass an octave up instead of the drop-D rock bass. */
  bassTone?: 'rock' | 'soft';
  /** Electric guitar on the cgtr lane: clean, or a light overdrive with vibrato for melodies. */
  cgtrTone?: 'clean' | 'drive';
  /** A room on the cue: one convolver, lanes send to it (default send 1, drums less). */
  verb?: { seconds: number; wet: number; sends?: Partial<Record<Lane, number>> };
  /** Mid scoop to leave room for voice and sfx (the fight bed). */
  scoop?: boolean;
  /** Swing amount for the off 16ths, 0..0.5 of a step. */
  swing?: number;
}

/** A small cheap radio: steep band-pass, a little crunch, mono, a bed of hiss. */
export interface RadioOpts {
  hp: number;
  lp: number;
  /** Speaker cone resonance boost in dB around 1.3 kHz. */
  honk: number;
  /** Waveshaper drive, 1 is clean. */
  drive: number;
  /** Hiss into the radio, in dB (it goes through the radio filters with the music). */
  hissDb: number;
}

export interface NoteEvent {
  /** Seconds from the start of its segment. */
  t: number;
  key: string;
  /** Seconds until the release starts; Infinity plays the sample out. */
  dur: number;
  vel: number;
  /** Output lane: decides pan and level. */
  lane: Lane;
}

export type Lane = 'gtrL' | 'gtrR' | 'bass' | 'kick' | 'snare' | 'hat' | 'cym' | 'tom' | 'lead' | 'arp' | 'clean' | 'piano' | 'cgtr' | 'stab' | 'pad' | 'fx';

export const LANE_PAN: Record<Lane, number> = {
  gtrL: -0.8,
  gtrR: 0.8,
  bass: 0,
  kick: 0,
  snare: 0.02,
  hat: 0.35,
  cym: -0.3,
  tom: -0.15,
  lead: 0.1,
  arp: 0.25,
  clean: -0.2,
  piano: 0.15,
  cgtr: -0.25,
  stab: 0,
  pad: 0,
  fx: 0,
};

/** Lane levels, set from solo-lane renders (tools/lanes.ts) toward a rock mix: kick and snare
 *  peaks level, the guitar pair a little under the kick, hats well back, crashes and stabs as
 *  accents. Samples are peak-normalized, so these are the whole mix. */
export const LANE_LEVEL: Record<Lane, number> = {
  gtrL: 0.88,
  gtrR: 0.88,
  bass: 0.93,
  kick: 0.95,
  snare: 1.27,
  hat: 0.46,
  cym: 1.1,
  tom: 0.75,
  lead: 0.75,
  arp: 0.8,
  clean: 1.0,
  piano: 1.0,
  cgtr: 1.0,
  stab: 1.1,
  pad: 0.48,
  fx: 1.1,
};

export interface Segment {
  events: NoteEvent[];
  duration: number;
}

export interface CompiledCue {
  intro: Segment;
  loop: Segment | null;
  keys: Set<string>;
  bpm: number;
  bar: number;
}

const GTR: Record<string, number> = { j: 37, d: 38, e: 39, k: 40, f: 41, n: 42, g: 43, h: 44, a: 45, b: 46, m: 47, c: 48, p: 49, q: 50 };
const NOTE_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function noteMidi(tok: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(tok);
  if (!m) throw new Error(`bad note ${tok}`);
  return 12 * (Number(m[3]) + 1) + NOTE_PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

function tokens(bar: string): string[] {
  const t = bar.trim().split(/\s+/);
  if (t.length !== 16) throw new Error(`bar needs 16 tokens, got ${t.length}: "${bar}"`);
  return t;
}

function chars(bar: string): string[] {
  const c = [...bar.replace(/\s+/g, '')];
  if (c.length !== 16) throw new Error(`bar needs 16 steps, got ${c.length}: "${bar}"`);
  return c;
}

/** Note runs from a char lane: [step, letter, lengthSteps] using global step indices. */
function charRuns(bars: string[], startStep: number): { step: number; ch: string; len: number }[] {
  const all = bars.flatMap(chars);
  const out: { step: number; ch: string; len: number }[] = [];
  for (let i = 0; i < all.length; i++) {
    const c = all[i];
    if (c === '-' || c === '.') continue;
    let j = i + 1;
    while (j < all.length && all[j] === '-') j++;
    out.push({ step: startStep + i, ch: c, len: j - i });
  }
  return out;
}

function tokenRuns(bars: string[], startStep: number): { step: number; tok: string; len: number }[] {
  const all = bars.flatMap(tokens);
  const out: { step: number; tok: string; len: number }[] = [];
  for (let i = 0; i < all.length; i++) {
    const c = all[i];
    if (c === '-' || c === '.') continue;
    let j = i + 1;
    while (j < all.length && all[j] === '-') j++;
    out.push({ step: startStep + i, tok: c, len: j - i });
  }
  return out;
}

function expand(p: string[], bars: number): string[] {
  return Array.from({ length: bars }, (_, i) => p[i % p.length]);
}

function vel(c: string): number {
  return c === 'X' ? 1 : c === 'o' ? 0.4 : 0.8;
}

function compileSections(def: CueDef, sections: Section[], keys: Set<string>): Segment {
  const step = 60 / def.bpm / 4;
  const tr = def.transpose ?? 0;
  const ev: NoteEvent[] = [];
  const swing = def.swing ?? 0;
  const at = (s: number) => s * step + (s % 2 === 1 ? swing * step : 0);
  const push = (e: NoteEvent) => {
    ev.push(e);
    keys.add(e.key);
  };
  let s0 = 0;
  for (const sec of sections) {
    const T = sec.tracks;
    const gtrBars = T.gtr && T.gtr !== 'follow' ? expand(T.gtr, sec.bars) : null;
    // Guitars, doubled left and right.
    if (gtrBars) {
      for (const r of charRuns(gtrBars, s0)) {
        const mute = r.ch === r.ch.toLowerCase();
        const midi = GTR[r.ch.toLowerCase()];
        if (midi == null) throw new Error(`bad guitar char ${r.ch}`);
        const inst = def.crunch ? (mute ? 'crM' : 'crO') : mute ? 'gtrM' : 'gtrO';
        const dur = mute ? Math.min(r.len * step, NOTE_SECONDS[inst]) : r.len * step;
        push({ t: at(r.step), key: `m.${inst}.${midi + tr}.0`, dur, vel: 0.9, lane: 'gtrL' });
        push({ t: at(r.step) + 0.009, key: `m.${inst}.${midi + tr}.1`, dur, vel: 0.9, lane: 'gtrR' });
      }
    }
    // Bass.
    const bassSrc = T.bass === 'follow' ? gtrBars : T.bass ? expand(T.bass, sec.bars) : null;
    if (bassSrc) {
      const soft = def.bassTone === 'soft';
      for (const r of charRuns(bassSrc, s0)) {
        const mute = r.ch === r.ch.toLowerCase();
        if (soft) {
          // Round bass an octave up; lowercase is a short note.
          const midi = GTR[r.ch.toLowerCase()] + tr;
          push({ t: at(r.step), key: `m.bassS.${midi}.0`, dur: mute ? Math.min(r.len, 2) * step : r.len * step, vel: 0.9, lane: 'bass' });
          continue;
        }
        const midi = GTR[r.ch.toLowerCase()] - 12 + tr;
        const inst = mute ? 'bassM' : 'bassO';
        push({ t: at(r.step), key: `m.${inst}.${midi}.0`, dur: r.len * step, vel: 0.9, lane: 'bass' });
      }
    }
    // Drums.
    const drum = (id: TrackId, map: (c: string) => string | null, lane: Lane) => {
      const p = T[id];
      if (!p || p === 'follow') return;
      expand(p, sec.bars)
        .flatMap(chars)
        .forEach((c, i) => {
          if (c === '.' || c === '-') return;
          const k = map(c);
          if (!k) return;
          push({ t: at(s0 + i), key: `m.${k}.0.0`, dur: Infinity, vel: vel(c), lane });
        });
    };
    const soft = def.kit === 'soft';
    drum('kick', () => (soft ? 'kickS' : 'kick'), 'kick');
    drum('snare', (c) => (c === 'r' ? 'rim' : soft ? 'snareS' : 'snare'), 'snare');
    drum('hat', (c) => (c === 'O' ? 'hatO' : c === 's' ? 'swish' : soft ? 'hatS' : 'hatC'), 'hat');
    drum('cym', (c) => (c === 'r' ? 'ride' : 'crash'), 'cym');
    drum('tom', (c) => (c === '1' ? 'tom1' : c === '2' ? 'tom2' : c === '3' ? 'tom3' : null), 'tom');
    // Melodic token lanes.
    for (const id of ['lead', 'arp', 'clean', 'piano', 'cgtr'] as const) {
      const p = T[id];
      if (!p || p === 'follow') continue;
      const variant = id === 'cgtr' && def.cgtrTone === 'drive' ? 1 : 0;
      // Chords: piano rolls a little, guitar strums low to high.
      const spread = id === 'cgtr' ? 0.012 : id === 'piano' ? 0.006 : 0;
      for (const r of tokenRuns(expand(p, sec.bars), s0)) {
        const softTok = r.tok.startsWith('~');
        const notes = (softTok ? r.tok.slice(1) : r.tok).split('+');
        notes.forEach((n, k) => {
          const midi = noteMidi(n) + tr;
          const vel = (softTok ? 0.5 : 0.9) * (notes.length > 1 ? 1 - 0.25 * (k / (notes.length - 1)) * (id === 'piano' ? 1 : 0.4) : 1);
          push({ t: at(r.step) + k * spread, key: `m.${id}.${midi}.${variant}`, dur: r.len * step - k * spread, vel, lane: id });
        });
      }
    }
    for (const id of ['stab', 'pad'] as const) {
      const p = T[id];
      if (!p || p === 'follow') continue;
      for (const r of tokenRuns(expand(p, sec.bars), s0)) {
        const name = transposeChord(r.tok, tr);
        push({ t: at(r.step), key: `m.${id}.${name}.0`, dur: r.len * step, vel: 0.9, lane: id });
      }
    }
    if (T.fx && T.fx !== 'follow') {
      for (const r of tokenRuns(expand(T.fx, sec.bars), s0)) {
        if (r.tok === 'boom') push({ t: at(r.step), key: 'm.boom.0.0', dur: Infinity, vel: 0.9, lane: 'fx' });
        else if (r.tok.startsWith('riser:')) {
          const n = Number(r.tok.slice(6));
          const ms = Math.round(n * step * 1000);
          push({ t: at(r.step), key: `m.riser.${ms}.0`, dur: Infinity, vel: 0.9, lane: 'fx' });
        }
      }
    }
    s0 += sec.bars * 16;
  }
  ev.sort((a, b) => a.t - b.t);
  return { events: ev, duration: s0 * step };
}

const SHARP = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

function transposeChord(name: string, tr: number): string {
  if (!tr) return name;
  const m = /^([A-G])(#|b)?(.*)$/.exec(name)!;
  const pc = (NOTE_PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + tr + 120) % 12;
  return SHARP[pc] + m[3];
}

export function compileCue(def: CueDef): CompiledCue {
  const keys = new Set<string>();
  const lf = def.loopFrom;
  const intro = compileSections(def, lf == null ? def.sections : def.sections.slice(0, lf), keys);
  const loop = lf == null ? null : compileSections(def, def.sections.slice(lf), keys);
  return { intro, loop, keys, bpm: def.bpm, bar: (60 / def.bpm) * 4 };
}
