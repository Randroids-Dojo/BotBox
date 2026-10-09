// The score. Drop-D palm mutes, big open chords, a lead hook, synth stabs. All original.
// Notation is described in score.ts.

import type { MusicCue } from '../types';
import type { CueDef, Section } from './score';

/** Build a 16-token bar from [token, steps] pairs; the token is followed by holds. */
function L(...items: [string, number][]): string {
  const out: string[] = [];
  for (const [tok, n] of items) {
    if (tok === '.') for (let i = 0; i < n; i++) out.push('.');
    else {
      out.push(tok);
      for (let i = 1; i < n; i++) out.push('-');
    }
  }
  if (out.length !== 16) throw new Error(`bar has ${out.length} steps: ${out.join(' ')}`);
  return out.join(' ');
}
const HOLD = L(['-', 16]);
const REST = L(['.', 16]);
const chordBar = (c: string) => L([c, 16]);

// ---- the theme riff (title, bumper, nut)
const R1 = 'dd.d.dd.F--G--d.';
const R2 = 'dd.d.dd.B--A--a.';
const R4 = 'dd.d.dd.F-G-H-G.';
const RIFF = [R1, R2, R1, R4];
const RIFF_KICK = ['xx.x.xx.x..x..x.', 'xx.x.xx.x..x..x.', 'xx.x.xx.x..x..x.', 'xx.x.xx.x.x.x.x.'];
const BACKBEAT = ['....x.......x...'];
const EIGHTHS = ['x.x.x.x.x.x.x.x.'];
const CRASH1 = ['x...............', '................', '................', '................'];
const RIFF_STAB = [
  L(['.', 8], ['F', 3], ['G', 3], ['.', 2]),
  L(['.', 8], ['Bb', 3], ['A', 3], ['.', 2]),
  L(['.', 8], ['F', 3], ['G', 3], ['.', 2]),
  L(['.', 8], ['F', 2], ['G', 2], ['Ab', 2], ['G', 1], ['.', 1]),
];

const riffA: Section = { bars: 4, tracks: { gtr: RIFF, bass: 'follow', kick: RIFF_KICK, snare: BACKBEAT, hat: EIGHTHS, cym: CRASH1 } };
const riffA2: Section = { bars: 4, tracks: { ...riffA.tracks, stab: RIFF_STAB } };

const CHORUS_KICK = ['x.x...x.x.x...x.'];
const CHORUS_CYM = ['x.r.r.r.r.r.r.r.', 'r.r.r.r.r.r.r.r.'];

const breakC: Section = {
  bars: 2,
  tracks: {
    gtr: ['D..D..D...D.D...', 'D..D..D.....F-G-'],
    bass: 'follow',
    kick: ['x..x..x...x.x...', 'x..x..x.....x.x.'],
    cym: ['x..x..x...x.x...', 'x..x..x.........'],
    snare: ['................', '..........o.o.xX'],
    stab: [L(['Dm', 3], ['Dm', 3], ['Dm', 4], ['Dm', 2], ['.', 4]), L(['Dm', 3], ['Dm', 3], ['Dm', 1], ['.', 5], ['F', 2], ['G', 2])],
  },
};

const title: CueDef = {
  bpm: 132,
  loopFrom: 1,
  sections: [
    {
      bars: 2,
      tracks: { gtr: [R1, R2], bass: 'follow', snare: ['................', '............xXxX'], fx: [L(['riser:32', 16]), HOLD] },
    },
    riffA,
    riffA2,
    {
      bars: 8,
      tracks: {
        gtr: ['D--------D--D-D-', 'B--------B--B-B-', 'C--------C--C-C-', 'A--------A--a.a.', 'D--------D--D-D-', 'B--------B--B-B-', 'C-------F-------', 'G-------A---a.a.'],
        bass: 'follow',
        kick: CHORUS_KICK,
        snare: BACKBEAT,
        cym: CHORUS_CYM,
        lead: [
          L(['A4', 4], ['D5', 4], ['C5', 3], ['A4', 3], ['G4', 2]),
          L(['F4', 8], ['D4', 3], ['F4', 3], ['G4', 2]),
          L(['E4', 8], ['G4', 3], ['C5', 3], ['Bb4', 2]),
          L(['A4', 12], ['.', 4]),
          L(['A4', 4], ['D5', 4], ['C5', 3], ['A4', 3], ['G4', 2]),
          L(['F4', 8], ['D5', 3], ['C5', 3], ['Bb4', 2]),
          L(['C5', 8], ['A4', 4], ['C5', 4]),
          L(['B4', 4], ['D5', 4], ['E5', 8]),
        ],
        stab: [chordBar('Dm'), chordBar('Bb'), chordBar('C'), chordBar('A'), chordBar('Dm'), chordBar('Bb'), L(['C', 8], ['F', 8]), L(['G', 8], ['A', 8])].map((b) =>
          b.replace(/ - - - - - - - - - - - -/, ' . . . . . . . . . . . .'),
        ),
      },
    },
    breakC,
  ],
  mix: { stab: 0.8 },
};

const menu: CueDef = {
  bpm: 108,
  crunch: true,
  loopFrom: 0,
  level: 0.8,
  sections: [
    {
      bars: 4,
      tracks: {
        gtr: ['d.......d.d.....', 'd.......d.d.....', 'b.......b.b.....', 'c.......c.a.....'],
        bass: ['D-------D-D-----', 'D-------D-D-----', 'B-------B-B-----', 'C-------C-A-----'],
        pad: [chordBar('Dm'), HOLD, chordBar('Bb'), L(['C', 8], ['Am', 8])],
        arp: [
          'D4 F4 A4 D5 A4 F4 D4 F4 A4 D5 F5 D5 A4 F4 D4 A3',
          'D4 F4 A4 D5 A4 F4 D4 F4 A4 D5 F5 D5 A4 F4 D4 A3',
          'Bb3 D4 F4 Bb4 F4 D4 Bb3 D4 F4 Bb4 D5 Bb4 F4 D4 Bb3 F3',
          'C4 E4 G4 C5 G4 E4 C4 E4 A3 C4 E4 A4 E4 C4 A3 E3',
        ],
        kick: ['x.....x...x.....', 'x.....x...x...x.'],
        snare: ['........x.......'],
        hat: ['xoxoxoxoxoxoxoxo'],
        cym: CRASH1,
      },
    },
    {
      bars: 4,
      tracks: {
        gtr: ['d.......d.d.....', 'd.......d.d.....', 'b.......b.b.....', 'c.......c.a.....'],
        bass: ['D-------D-D-----', 'D-------D-D-----', 'B-------B-B-----', 'C-------C-A-----'],
        pad: [chordBar('Dm'), HOLD, chordBar('Bb'), L(['C', 8], ['Am', 8])],
        clean: [L(['A4', 4], ['D5', 4], ['C5', 3], ['A4', 3], ['G4', 2]), L(['F4', 8], ['.', 8]), L(['D4', 4], ['F4', 4], ['Bb4', 8]), L(['C5', 8], ['A4', 8])],
        kick: ['x.....x...x.....', 'x.....x...x...x.'],
        snare: ['........x.......', '........x.....o.'],
        hat: ['xoxoxoxoxoxoxoxo'],
        cym: ['r...r...r...r...'],
      },
    },
  ],
  mix: { gtrL: 0.65, gtrR: 0.65, arp: 0.66, pad: 0.66 },
};

const pits: CueDef = {
  bpm: 116,
  crunch: true,
  radio: true,
  level: 1.5,
  swing: 0.12,
  loopFrom: 0,
  sections: [
    {
      bars: 4,
      tracks: {
        gtr: ['D.d.d.d.D.d.d.d.', 'D.d.d.d.D.d.d.d.', 'C.c.c.c.G.g.g.g.', 'D.d.d.d.D.d.C.G.'],
        bass: 'follow',
        kick: ['x.....x.x.......', 'x.....x.x.....x.'],
        snare: BACKBEAT,
        hat: ['x.x.x.x.x.x.x.xO'],
        cym: CRASH1,
      },
    },
    {
      bars: 4,
      tracks: {
        gtr: ['D.d.d.d.D.d.d.d.', 'D.d.d.d.D.d.d.d.', 'C.c.c.c.G.g.g.g.', 'D.d.d.d.D.d.C.G.'],
        bass: 'follow',
        kick: ['x.....x.x.......', 'x.....x.x.....x.'],
        snare: ['....x.......x...', '....x.......x.oo'],
        hat: ['x.x.x.x.x.x.x.xO'],
        cym: CRASH1,
        lead: [
          L(['D5', 2], ['E5', 1], ['F#5', 1], ['A5', 2], ['F#5', 1], ['E5', 1], ['D5', 4], ['.', 4]),
          L(['.', 8], ['A4', 2], ['B4', 1], ['D5', 5]),
          L(['C5', 4], ['B4', 2], ['A4', 2], ['G4', 4], ['.', 4]),
          L(['D5', 8], ['.', 8]),
        ],
      },
    },
  ],
  mix: { lead: 0.5 },
};

const intro: CueDef = {
  bpm: 120,
  loopFrom: 0,
  sections: [
    {
      bars: 8,
      tracks: {
        gtr: ['D---------------', '--------........', REST.replace(/ /g, ''), REST.replace(/ /g, ''), 'd.......d.......', 'd...d...d...d...', 'd.d.d.d.d.d.d.d.', 'dddddddddddd.E-.'],
        bass: ['D---------------', '--------........', '................', '................', 'd.......d.......', 'd...d...d...d...', 'd.d.d.d.d.d.d.d.', 'dddddddddddd.E-.'],
        pad: [chordBar('Dm'), HOLD, chordBar('Dm'), HOLD, chordBar('Bb'), HOLD, chordBar('A'), HOLD],
        kick: ['x..x............', 'x..x............', 'x..x............', 'x..x............', 'x..x............', 'x..x............', 'x..x....x..x....', 'x..x....x..x....'],
        tom: ['3...............', '3...............', '3...............', '3.......3.......', '3.......3.......', '3...3...3...3...', '3...3...3...3...', '3.3.3.3.2.2.1.1.'],
        hat: ['o.o.o.o.o.o.o.o.'],
        snare: ['................', '................', '................', '................', '................', '................', '................', '........o.o.xxXX'],
        stab: [REST, REST, REST, L(['.', 12], ['Eb', 4]), REST, REST, REST, REST],
        fx: [L(['boom', 16]), REST, REST, REST, REST, REST, L(['riser:32', 16]), HOLD],
        cym: ['x...............', '................', '................', '................', 'x...............', '................', '................', '................'],
      },
    },
  ],
  mix: { pad: 0.58, gtrL: 0.8, gtrR: 0.8 },
};

const fight: CueDef = {
  bpm: 140,
  loopFrom: 0,
  level: 0.55,
  scoop: true,
  sections: [
    {
      bars: 8,
      tracks: {
        gtr: ['dd.dd.d.dd.dd.d.', 'dd.dd.d.dd.dd.d.', 'dd.dd.d.dd.dd.d.', 'dd.dd.d.F--.G--.', 'dd.dd.d.dd.dd.d.', 'dd.dd.d.dd.dd.d.', 'dd.dd.d.dd.dd.d.', 'dd.dd.d.B--.C--.'],
        bass: 'follow',
        kick: ['x..x..x.x..x..x.'],
        snare: BACKBEAT,
        hat: EIGHTHS,
        cym: ['x...............', '................', '................', '................'],
      },
    },
  ],
  mix: { gtrL: 0.75, gtrR: 0.75, hat: 0.36 },
};

const victory: CueDef = {
  bpm: 132,
  loopFrom: 1,
  sections: [
    {
      bars: 3,
      tracks: {
        gtr: ['D..D..D.B---C---', 'D---------------', '----------------'],
        bass: 'follow',
        kick: ['x..x..x.x...x...', 'x...............', '................'],
        cym: ['x..x..x.x...x...', 'x...............', '................'],
        stab: [L(['D', 3], ['D', 3], ['D', 2], ['Bb', 4], ['C', 4]), L(['D', 8], ['.', 8]), REST],
        lead: [REST, L(['A4', 4], ['D5', 4], ['F#5', 4], ['A5', 4]), L(['D6', 16])],
        fx: [L(['boom', 16]), REST, REST],
      },
    },
    {
      bars: 4,
      tracks: {
        gtr: ['D-------D-------', 'B-------B-------', 'C-------C-------', 'A-------a.a.a.a.'],
        bass: 'follow',
        kick: ['x.......x.x.....'],
        snare: BACKBEAT,
        hat: EIGHTHS,
        cym: CRASH1,
      },
    },
  ],
  mix: { gtrL: 0.75, gtrR: 0.75 },
};

const defeat: CueDef = {
  bpm: 80,
  loopFrom: 1,
  level: 0.8,
  sections: [
    {
      bars: 2,
      tracks: {
        gtr: ['D-------C-------', 'B-------A-------'],
        bass: 'follow',
        kick: ['x.......x.......'],
        cym: ['x...............', '................'],
        pad: [chordBar('Dm'), L(['Bb', 8], ['A', 8])],
      },
    },
    {
      bars: 4,
      tracks: {
        pad: [chordBar('Dm'), chordBar('Bb'), chordBar('Gm'), chordBar('A')],
        clean: [
          'D4 . A4 . D5 . A4 . F4 . A4 . D5 . A4 .',
          'Bb3 . F4 . Bb4 . F4 . D4 . F4 . Bb4 . F4 .',
          'G3 . D4 . G4 . D4 . Bb3 . D4 . G4 . D4 .',
          'A3 . E4 . A4 . E4 . C#4 . E4 . A4 . . .',
        ],
        bass: ['D---------------', 'B---------------', 'G---------------', 'A---------------'],
        kick: ['x...............'],
      },
    },
  ],
  mix: { pad: 0.6, clean: 1.1, bass: 0.7 },
};

const bumper: CueDef = {
  bpm: 132,
  loopFrom: null,
  sections: [
    {
      bars: 3,
      tracks: {
        gtr: [R1, 'D..D..D---------', '----------------'],
        bass: 'follow',
        kick: ['xx.x.xx.x..x..x.', 'x..x..x.........', '................'],
        snare: ['....x.......x...', '................', '................'],
        hat: ['x.x.x.x.x.x.x.x.', '................', '................'],
        cym: ['x...............', 'x..x..x.........', '................'],
        stab: [RIFF_STAB[0], L(['Dm', 3], ['Dm', 3], ['Dm', 10]), REST],
      },
    },
  ],
};

const nut: CueDef = {
  bpm: 132,
  loopFrom: 1,
  sections: [
    {
      bars: 2,
      tracks: {
        gtr: ['D-----D-----D-D-', 'G-----A-----D---'],
        bass: 'follow',
        kick: ['x.....x.....x.x.', 'x.....x.....x...'],
        cym: ['x.....x.....x.x.', 'x.....x.....x...'],
        snare: ['................', '........o.o.xxXX'],
        stab: [L(['D', 6], ['D', 6], ['D', 2], ['D', 2]), L(['G', 6], ['A', 6], ['D', 4])],
        lead: [L(['D5', 6], ['F#5', 6], ['A5', 4]), L(['B5', 6], ['C#6', 6], ['D6', 4])],
        fx: [L(['boom', 16]), REST],
      },
    },
    riffA,
    riffA2,
    {
      bars: 8,
      tracks: {
        gtr: ['D--------D--D-D-', 'A--------A--A-A-', 'M--------M--M-M-', 'G--------G--G-G-', 'D--------D--D-D-', 'A--------A--A-A-', 'M-------G-------', 'A--------A--a.a.'],
        bass: 'follow',
        kick: CHORUS_KICK,
        snare: BACKBEAT,
        cym: ['x.r.r.r.r.r.r.r.'],
        lead: [
          L(['F#5', 4], ['A5', 4], ['F#5', 3], ['E5', 3], ['D5', 2]),
          L(['E5', 8], ['C#5', 3], ['E5', 3], ['A5', 2]),
          L(['F#5', 8], ['D5', 3], ['F#5', 3], ['B5', 2]),
          L(['A5', 4], ['G5', 4], ['F#5', 4], ['E5', 4]),
          L(['F#5', 4], ['A5', 4], ['F#5', 3], ['E5', 3], ['D5', 2]),
          L(['E5', 8], ['A5', 4], ['C#6', 4]),
          L(['D6', 8], ['B5', 8]),
          L(['A5', 12], ['.', 4]),
        ],
        stab: [L(['D', 4], ['.', 12]), L(['A', 4], ['.', 12]), L(['Bm', 4], ['.', 12]), L(['G', 4], ['.', 12]), L(['D', 4], ['.', 12]), L(['A', 4], ['.', 12]), L(['Bm', 4], ['.', 4], ['G', 4], ['.', 4]), L(['A', 8], ['.', 8])],
      },
    },
    breakC,
  ],
  mix: { stab: 0.9, cym: 1.2 },
};

// prologue, montage and workshop reuse existing cues until they get their own.
export const CUES: Record<Exclude<MusicCue, 'none'>, CueDef> = { title, menu, pits, intro, fight, victory, defeat, bumper, nut, prologue: title, montage: defeat, workshop: pits };
