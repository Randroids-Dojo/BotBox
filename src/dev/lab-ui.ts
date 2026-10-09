// ?lab=ui : workbench for the broadcast UI. Opens every screen and broadcast element with fake
// data, plays a MockWorld fight under the HUD, and draws a stand-in 3D stage behind it.
//
// URL options (for screenshots):  &open=<id>  opens one item on load, &panel=0 hides the drawer,
// &touch=1 forces the touch controls. window.lab.open(id) does the same from a script.

import * as THREE from 'three';
import type { AudioEngine, UiSound } from '../audio/types';
import { COMPONENTS, FACETS, type BotSpec, type Component, type Corner, type Facet, type JudgeCard, type Loadout, type MatchResult, type PartKey, type WorldFrame } from '../contract';
import { ARENA_HALF, KILLSAWS, PULVERIZERS, START_SQUARES } from '../data/arena';
import { CLASS_LABEL, WEAPONS } from '../data/parts';
import { ACTS, FIGHTS, PART_PRICES, RANKED_NAMES, SCRAP_LOADOUT, STARTING_OWNED, careerRivalById } from '../data/campaign';
import { ROSTER, rivalById, rivalsFor } from '../data/roster';
import { Input } from '../input/input';
import { createBotView } from '../render/bots';
import { createNutTrophy } from '../render/props/nut';
import type { BotView } from '../render/types';
import { buildSpec } from '../sim/spec';
import { createBroadcastUI } from '../ui';
import type { BracketView, CareerShop, CareerView, Damage, DecisionView, GarageCategory, HudEntrant, MontageCard, RewardsView, RivalSummary, Settings, WorkshopView } from '../ui/types';
import { MockWorld } from './mock';

// ------------------------------------------------------------------------------------------
// Fake data

const PLAYER: Loadout = {
  name: 'Rust Bucket',
  cls: 'heavy',
  chassis: 'box',
  drive: 'chair4',
  power: 'nicad',
  weapon: 'drum',
  armor: { material: 'aluminum', grade: 2 },
  extras: ['srimech'],
  paint: { primary: '#ff6a00', secondary: '#101418', accent: '#f2f2f2', pattern: 'hazard', finish: 'gloss', decal: 'RB' },
};
const PLAYER_CARD = {
  name: 'Rust Bucket',
  team: 'Team Garage Sale',
  hometown: 'Fresno, California',
  builders: 'You and your cousin Dwayne',
  blurb: 'A rookie drum spinner built from a lawn tractor and a lot of optimism.',
  record: '1-0',
  voiceId: 'rust-bucket',
};

const summary = (id: string): RivalSummary => {
  const r = rivalById(id)!;
  return { id: r.id, card: r.card, cls: r.loadout.cls, spec: buildSpec(r.loadout), style: r.style, seed: r.seed };
};
const ALL_RIVALS: RivalSummary[] = ROSTER.map((r) => summary(r.id));

const SETTINGS: Settings = {
  volumes: { master: 0.8, music: 0.6, sfx: 0.9, voice: 1 },
  camera: 'chase',
  drive: 'robot',
  quality: 'auto',
  cinematicHits: true,
  subtitles: true,
  broadcastFilter: true,
  commentary: true,
  matchLength: 180,
};

function bracketView(stage: 'qf' | 'sf' | 'done'): BracketView {
  const heavy = rivalsFor('heavy');
  const s = (id: string) => {
    const r = heavy.find((x) => x.id === id)!;
    return { id: r.id, name: r.card.name, player: false };
  };
  const me = { id: 'player', name: 'Rust Bucket', player: true };
  const [h1, h2, h3, h4, h5, h6, h7] = heavy.map((r) => r.id);
  const qf = [
    { a: s(h1), b: me, winner: stage === 'qf' ? null : 'player', result: stage === 'qf' ? null : 'KO 1:42' },
    { a: s(h4), b: s(h5), winner: stage === 'qf' ? null : h4, result: stage === 'qf' ? null : '27-18' },
    { a: s(h3), b: s(h6), winner: stage === 'qf' ? null : h6, result: stage === 'qf' ? null : 'KO 0:51' },
    { a: s(h2), b: s(h7), winner: stage === 'qf' ? null : h2, result: stage === 'qf' ? null : '31-14' },
  ];
  const sf =
    stage === 'qf'
      ? [
          { a: null, b: null, winner: null, result: null },
          { a: null, b: null, winner: null, result: null },
        ]
      : [
          { a: me, b: s(h4), winner: stage === 'done' ? 'player' : null, result: stage === 'done' ? '29-16' : null },
          { a: s(h6), b: s(h2), winner: stage === 'done' ? h2 : null, result: stage === 'done' ? 'KO 2:10' : null },
        ];
  const f =
    stage === 'done'
      ? [{ a: me, b: s(h2), winner: 'player', result: 'KO 2:31' }]
      : [{ a: null, b: null, winner: null, result: null }];
  return {
    cls: 'heavy',
    rounds: [
      { label: 'Quarterfinal', matches: qf },
      { label: 'Semifinal', matches: sf },
      { label: 'Final', matches: f },
    ],
    next: stage === 'qf' ? { round: 0, match: 0 } : stage === 'sf' ? { round: 1, match: 0 } : null,
  };
}

function pitsDamage(): Damage {
  const facets = Object.fromEntries(FACETS.map((f) => [f, 1])) as Record<Facet, number>;
  const parts = Object.fromEntries(COMPONENTS.map((c) => [c, 1])) as Record<Component, number>;
  facets.front = 0.34;
  facets.left = 0.0;
  facets.top = 0.71;
  facets.belly = 0.88;
  parts.driveL = 0.42;
  parts.weapon = 0.63;
  parts.battery = 0.8;
  return { facets, parts };
}

function decisionView(): DecisionView {
  const a = 'player';
  const b = 'flapjack';
  const card = (judge: string, ag: number, st: number, dm: number): JudgeCard => ({
    judge,
    aggression: { [a]: ag, [b]: 5 - ag },
    strategy: { [a]: st, [b]: 5 - st },
    damage: { [a]: dm, [b]: 5 - dm },
  });
  const judges = [card('Dr. Elaine Park', 3, 4, 3), card('Rick Darrow', 4, 3, 4), card('Gus Feldman', 3, 2, 4)];
  const total = (id: string) => judges.reduce((s, j) => s + j.aggression[id] + j.strategy[id] + j.damage[id], 0);
  return {
    judges,
    totals: { [a]: total(a), [b]: total(b) },
    winner: a,
    entrants: [
      { id: a, name: 'Rust Bucket', corner: 'red' },
      { id: b, name: 'Flapjack', corner: 'blue' },
    ],
  };
}

function matchResult(won: boolean): MatchResult {
  const st = (d: number, t: number) => ({ damageDealt: d, damageTaken: t, hits: 23, bigHits: 4, attackTime: 71, controlTime: 18, hazardDamageDealt: 140, flips: 1 });
  return {
    winner: won ? 'player' : 'flapjack',
    method: won ? 'ko' : 'decision',
    time: 102,
    totals: won ? undefined : { player: 19, flapjack: 26 },
    stats: { player: won ? st(812, 290) : st(380, 640), flapjack: won ? st(290, 812) : st(640, 380) },
  };
}

// ------------------------------------------------------------------------------------------
// Career fakes

const csum = (id: string): RivalSummary => {
  const r = careerRivalById(id)!;
  return { id: r.id, card: r.card, cls: r.loadout.cls, spec: buildSpec(r.loadout), style: r.style, seed: r.seed };
};

/** Fights won so far (0..13) drives every career fake. */
function careerAt(won: number) {
  const next = FIGHTS[won] ?? null;
  const actIdx = next ? ACTS.findIndex((a) => a.id === next.act) : ACTS.length - 1;
  const act = ACTS[actIdx];
  const rank = won ? FIGHTS[won - 1].rankAfter : null;
  const earnings = FIGHTS.slice(0, won).reduce((s, f) => s + f.prize, 0);
  return { next, actIdx, act, rank, earnings };
}

const RESULTS = ['KO 1:42', '24-9', 'KO 0:58', 'KO 2:31', '19-14', 'KO 1:05', '21-12', 'KO 2:02', '26-7', 'KO 0:44', '18-15', 'KO 1:51', 'KO 2:59'];
const ROBOT = { name: 'Juggernaut', spec: buildSpec(SCRAP_LOADOUT) };

function workshopView(won: number, opts: { funds: number; damaged?: boolean; gig?: boolean; news?: string | null; losses?: number; name?: string }): WorkshopView {
  const c = careerAt(won);
  const n = c.next;
  const gigFight = FIGHTS[Math.max(0, won - 1)];
  return {
    robot: opts.name ? { name: opts.name, spec: ROBOT.spec } : ROBOT,
    funds: opts.funds,
    rank: c.rank,
    record: { w: won, l: opts.losses ?? 0 },
    act: { title: c.act.title, subtitle: c.act.subtitle, index: c.actIdx, total: ACTS.length },
    next: n ? { title: n.title, opponent: csum(n.opponent), prize: n.prize, blurb: n.blurb } : null,
    damaged: !!opts.damaged,
    sideGig: opts.gig ? { title: 'Parking lot exhibition', opponent: csum(gigFight.opponent), prize: Math.round((n?.prize ?? 1000) * 0.35 / 50) * 50 } : null,
    news: opts.news === undefined ? null : opts.news,
    tier: c.act.tier,
  };
}

function careerView(won: number): CareerView {
  const c = careerAt(won);
  const acts = ACTS.map((a) => ({
    title: a.title,
    subtitle: a.subtitle,
    fights: FIGHTS.filter((f) => f.act === a.id).map((f) => {
      const i = FIGHTS.indexOf(f);
      const state: 'won' | 'next' | 'locked' = i < won ? 'won' : i === won ? 'next' : 'locked';
      return { title: f.title, opponent: careerRivalById(f.opponent)?.card.name ?? f.opponent, prize: f.prize, state, result: state === 'won' ? RESULTS[i] : null };
    }),
  }));
  const rankings: CareerView['rankings'] = [];
  const names = [...RANKED_NAMES];
  if (c.rank !== null && c.rank <= 10) names.splice(c.rank - 1, 0, 'Juggernaut');
  names.slice(0, 10).forEach((name, i) => rankings.push({ rank: i + 1, name, you: name === 'Juggernaut' }));
  if (c.rank !== null && c.rank > 10) rankings.push({ rank: c.rank, name: 'Juggernaut', you: true });
  return { acts, rankings, funds: [0, 350, 120, 2450, 900, 3800][Math.min(5, won)] ?? 6200, earnings: c.earnings, record: { w: won, l: Math.floor(won / 3) } };
}

const LOCK_REASON: Record<number, string> = { 1: 'Unlocks at the Regionals', 2: 'Unlocks on The Show', 3: 'Unlocks at the Championship' };

function fakeShop(tier: number, funds: number, owned: PartKey[], repairPer10: number): CareerShop {
  const prices = Object.fromEntries(Object.entries(PART_PRICES).map(([k, v]) => [k, v.price])) as Record<PartKey, number>;
  const locked: Partial<Record<PartKey, string>> = {};
  for (const [k, v] of Object.entries(PART_PRICES)) if (v.tier > tier) locked[k as PartKey] = LOCK_REASON[v.tier];
  const shop: CareerShop = {
    funds,
    owned: [...owned],
    prices,
    locked,
    repairPer10,
    freePatch: 0.4,
    buy(k) {
      if (locked[k] || prices[k] > shop.funds) {
        log(`buy refused: ${k}`);
        return null;
      }
      shop.funds -= prices[k];
      shop.owned.push(k);
      log(`bought ${k} for $${prices[k]}, $${shop.funds} left`);
      return shop.funds;
    },
  };
  return shop;
}

function careerDamage(): Damage {
  const d = pitsDamage();
  // The free patch already lifted anything under 40 percent.
  for (const f of FACETS) d.facets[f] = Math.max(0.4, d.facets[f]);
  for (const c of COMPONENTS) d.parts[c] = Math.max(0.4, d.parts[c]);
  return d;
}

const MONTAGE: MontageCard[] = [
  { kind: 'headline', title: 'Juggernaut dethroned', sub: 'Terminal Velocity ends a three-year reign with one hit', sec: 2.6 },
  { kind: 'rank', title: 'Juggernaut', rank: { from: 1, to: 3 }, sec: 2.2 },
  { kind: 'result', title: 'Fall Classic, round one', result: { opponent: 'Megahurtz', method: 'KO 0:48' }, sec: 2 },
  { kind: 'headline', title: 'Sponsors walk out on Team Juggernaut', sub: 'Bolt-Rite Hardware ends a six-year deal', sec: 2.4 },
  { kind: 'result', title: 'Pacific Open, quarterfinal', result: { opponent: 'Flapjack', method: 'Decision 2-1' }, sub: 'Juggernaut flipped twice, never got its disk up to speed', sec: 2.2 },
  { kind: 'rank', title: 'Juggernaut', rank: { from: 38, to: null }, sub: 'Dropped from the top 50', sec: 2.6 },
];

function rewardsView(kind: 'win' | 'loss' | 'act' | 'first'): RewardsView {
  if (kind === 'loss')
    return { won: false, prize: 0, fundsBefore: 420, fundsAfter: 420, rankBefore: 47, rankAfter: 47, unlocks: [], actComplete: null, note: 'Lawn Dart got lucky. Rematch any time, and the garage has your repairs.' };
  if (kind === 'first')
    return { won: true, prize: 300, fundsBefore: 0, fundsAfter: 300, rankBefore: null, rankAfter: 52, unlocks: [], actComplete: null, note: 'First win in two seasons. The phone might ring again.' };
  if (kind === 'act')
    return {
      won: true,
      prize: 600,
      fundsBefore: 380,
      fundsAfter: 980,
      rankBefore: 43,
      rankAfter: 40,
      unlocks: ['4WD wheelchair motors', 'NiCad packs', 'Vertical disk', 'Drum spinner', 'Electric lifter', 'Hardened steel', 'Srimech'],
      actComplete: { title: 'The Scrapyard Circuit', next: 'Regionals' },
      note: null,
    };
  return { won: true, prize: 1500, fundsBefore: 850, fundsAfter: 2350, rankBefore: 31, rankAfter: 24, unlocks: [], actComplete: null, note: 'Chop Suey swung at nothing all night.' };
}

const careerGarage = (o: { tier: number; funds: number; owned: PartKey[]; repairPer10: number; damage?: Damage; guided?: GarageCategory[]; loadout: Loadout; opponent?: string }) => {
  stage.setMode('garage');
  return ui
    .garage({
      mode: 'career',
      career: fakeShop(o.tier, o.funds, o.owned, o.repairPer10),
      guided: o.guided,
      loadout: o.loadout,
      classLocked: true,
      damage: o.damage,
      opponent: o.opponent ? csum(o.opponent) : undefined,
      preview: (l, _d, missing) => {
        stage.showGarage(l);
        if (missing) log(`preview missing: ${missing.join(', ') || 'none'}`);
      },
      orbit: (dx, dy) => stage.orbit(dx, dy),
    })
    .then((r) => log(`career garage: ${r ? JSON.stringify({ funds: r.funds, bought: r.bought, loadout: r.loadout, damage: r.damage }) : 'back'}`));
};

const shopWorkshop = (v: WorkshopView) => {
  stage.setMode('garage');
  stage.showGarage(SCRAP_LOADOUT);
  return ui.workshop(v).then((c) => log(`workshop: ${c}`));
};

const coachDevice = (d: 'keyboard' | 'gamepad' | 'touch') => {
  ui.debug.ctx.root.dataset.device = d;
};

// ------------------------------------------------------------------------------------------
// Fake audio that records what the UI asked for.

const heard: string[] = [];
const fakeAudio = {
  unlock() {},
  unlocked: true,
  setEntrants() {},
  frame() {},
  setWorldActive() {},
  setTimeScale() {},
  music() {},
  stinger(id: string) {
    heard.push(`stinger:${id}`);
  },
  ui(id: UiSound) {
    heard.push(`ui:${id}`);
  },
  voice: async () => false,
  voiceBusy: () => false,
  stopVoice() {},
  voiceIds: () => [],
  voiceLine: () => undefined,
  crowd() {},
  setVolumes() {},
} satisfies AudioEngine;

// ------------------------------------------------------------------------------------------
// Stand-in stage: a dark Box, robots from MockWorld, a turntable and a trophy.

type StageMode = 'title' | 'arena' | 'garage' | 'trophy' | 'none';

class LabStage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
  mode: StageMode = 'title';
  private arena = new THREE.Group();
  private bots = new Map<string, BotView>();
  private turntable = new THREE.Group();
  private garageBot: BotView | null = null;
  private trophy = new THREE.Group();
  private orbitYaw = 0.6;
  private orbitPitch = 0.35;
  private t = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.scene.background = new THREE.Color('#05070a');
    this.scene.fog = new THREE.Fog('#05070a', 18, 42);
    this.scene.add(new THREE.HemisphereLight('#8fb4ff', '#1a1208', 0.5));
    const key = new THREE.SpotLight('#dfe8ff', 900, 40, 0.75, 0.5);
    key.position.set(2, 14, 6);
    key.castShadow = true;
    this.scene.add(key, key.target);
    const amber = new THREE.PointLight('#ffae5a', 120, 30);
    amber.position.set(-6, 5, -6);
    this.scene.add(amber);
    this.buildArena();
    this.scene.add(this.arena, this.turntable, this.trophy);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.15, 0.08, 48), new THREE.MeshStandardMaterial({ color: '#2a2e35', metalness: 0.7, roughness: 0.4 }));
    disc.position.y = -0.04;
    disc.receiveShadow = true;
    this.turntable.add(disc);
    const nut = createNutTrophy(null);
    nut.scale.setScalar(1.6);
    this.trophy.add(nut);
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  private buildArena(): void {
    const c = document.createElement('canvas');
    c.width = c.height = 1024;
    const g = c.getContext('2d')!;
    g.fillStyle = '#23262b';
    g.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 3000; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.05})`;
      g.fillRect(Math.random() * 1024, Math.random() * 1024, Math.random() * 40, 1);
    }
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 3;
    for (let i = 0; i <= 8; i++) {
      g.beginPath();
      g.moveTo((i * 1024) / 8, 0);
      g.lineTo((i * 1024) / 8, 1024);
      g.moveTo(0, (i * 1024) / 8);
      g.lineTo(1024, (i * 1024) / 8);
      g.stroke();
    }
    const toPx = (v: number) => ((v + ARENA_HALF) / (ARENA_HALF * 2)) * 1024;
    const hazard = (x: number, z: number, w: number, h: number) => {
      g.save();
      g.beginPath();
      g.rect(toPx(x - w / 2), toPx(z - h / 2), (w / (ARENA_HALF * 2)) * 1024, (h / (ARENA_HALF * 2)) * 1024);
      g.clip();
      for (let i = -40; i < 80; i++) {
        g.fillStyle = i % 2 ? '#d9a400' : '#111';
        g.beginPath();
        const x0 = toPx(x - w / 2) + i * 12;
        g.moveTo(x0, toPx(z - h / 2));
        g.lineTo(x0 + 12, toPx(z - h / 2));
        g.lineTo(x0 + 12 - 300, toPx(z + h / 2) + 300);
        g.lineTo(x0 - 300, toPx(z + h / 2) + 300);
        g.fill();
      }
      g.restore();
    };
    for (const p of PULVERIZERS) hazard(p.center.x, p.center.z, p.radius * 2.2, p.radius * 2.2);
    for (const k of KILLSAWS) hazard(k.center.x, k.center.z, 0.5, 3.2);
    for (const s of START_SQUARES.slice(0, 2)) {
      g.strokeStyle = s.color;
      g.lineWidth = 8;
      g.strokeRect(toPx(s.center.x - s.half), toPx(s.center.z - s.half), (s.half / ARENA_HALF) * 1024, (s.half / ARENA_HALF) * 1024);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2), new THREE.MeshStandardMaterial({ map: tex, metalness: 0.55, roughness: 0.55 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.arena.add(floor);
    const wallMat = new THREE.MeshStandardMaterial({ color: '#3a3f47', metalness: 0.8, roughness: 0.35 });
    const lexan = new THREE.MeshStandardMaterial({ color: '#9fc4ff', transparent: true, opacity: 0.07, metalness: 0.2, roughness: 0.1 });
    for (const [x, z, ry] of [
      [0, -ARENA_HALF, 0],
      [0, ARENA_HALF, 0],
      [-ARENA_HALF, 0, Math.PI / 2],
      [ARENA_HALF, 0, Math.PI / 2],
    ]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(ARENA_HALF * 2, 0.6, 0.2), wallMat);
      w.position.set(x, 0.3, z);
      w.rotation.y = ry;
      const l = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_HALF * 2, 4.4), lexan);
      l.position.set(x, 2.8, z);
      l.rotation.y = ry;
      this.arena.add(w, l);
    }
    // Truss lights.
    for (let i = -2; i <= 2; i++) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshBasicMaterial({ color: '#fff6e0' }));
      lamp.position.set(i * 3, 6.5, -ARENA_HALF - 0.5);
      this.arena.add(lamp);
    }
  }

  setMode(m: StageMode): void {
    this.mode = m;
    this.arena.visible = m === 'arena' || m === 'title';
    this.turntable.visible = m === 'garage';
    this.trophy.visible = m === 'trophy';
    for (const b of this.bots.values()) b.root.visible = m === 'arena';
    this.renderer.domElement.style.visibility = m === 'none' ? 'hidden' : 'visible';
  }

  setFighters(list: { id: string; spec: BotSpec }[]): void {
    for (const b of this.bots.values()) {
      this.scene.remove(b.root);
      b.dispose();
    }
    this.bots.clear();
    for (const f of list) {
      const v = createBotView(f.spec, { envMap: null, quality: 'high' });
      v.root.traverse((o) => (o.castShadow = true));
      this.scene.add(v.root);
      this.bots.set(f.id, v);
    }
  }

  showGarage(l: Loadout): void {
    if (this.garageBot) {
      this.turntable.remove(this.garageBot.root);
      this.garageBot.dispose();
    }
    this.garageBot = createBotView(buildSpec(l), { envMap: null, quality: 'high' });
    this.garageBot.root.traverse((o) => (o.castShadow = true));
    this.turntable.add(this.garageBot.root);
  }

  orbit(dx: number, dy: number): void {
    this.orbitYaw -= dx * 0.008;
    this.orbitPitch = Math.max(0.05, Math.min(1.2, this.orbitPitch + dy * 0.006));
  }

  frame(world: WorldFrame | null, dt: number): void {
    this.t += dt;
    const W = innerWidth;
    const H = innerHeight;
    this.camera.clearViewOffset();
    if (this.mode === 'garage') {
      // Frame the turntable in the left 60 percent (top 40 percent in portrait).
      if (W > H) this.camera.setViewOffset(W, H, W * 0.2, 0, W, H);
      else this.camera.setViewOffset(W, H, 0, H * 0.3, W, H);
      this.orbitYaw += dt * 0.25;
      const r = W > H ? 2.6 : 3.4;
      this.camera.position.set(Math.sin(this.orbitYaw) * r * Math.cos(this.orbitPitch), 0.2 + r * Math.sin(this.orbitPitch), Math.cos(this.orbitYaw) * r * Math.cos(this.orbitPitch));
      this.camera.lookAt(0, 0.15, 0);
    } else if (this.mode === 'trophy') {
      const a = this.t * 0.3;
      this.camera.position.set(Math.sin(a) * 4, 1.6, Math.cos(a) * 4);
      this.camera.lookAt(0, 1.0, 0);
    } else if (this.mode === 'title') {
      const a = this.t * 0.05;
      this.camera.position.set(Math.sin(a) * 13, 7.5, Math.cos(a) * 13);
      this.camera.lookAt(0, 0, 0);
    } else {
      this.camera.position.set(0, 9.5, 12.5);
      this.camera.lookAt(0, 0, 0.8);
    }
    if (world && this.mode === 'arena') for (const b of world.bots) this.bots.get(b.id)?.update(b, dt);
    this.renderer.render(this.scene, this.camera);
  }

  resize(): void {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }
}

// ------------------------------------------------------------------------------------------
// Boot

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const stage = new LabStage(canvas);
const input = new Input();
const ui = createBroadcastUI({ input, audio: fakeAudio });
const root = document.getElementById('ui')!;
ui.init(root);

let world: MockWorld | null = null;
let lastFrame: WorldFrame | null = null;
let mine: Loadout = { ...PLAYER };
let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  input.poll();
  if (world) {
    const { frame } = world.step(dt);
    lastFrame = frame;
    ui.hudFrame(frame);
  }
  stage.frame(lastFrame, dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function stopFight(): void {
  world = null;
  lastFrame = null;
  ui.hud(null);
  ui.touchControls(null);
}

function startFight(n: 2 | 4, opts: { countdown?: number; ko?: boolean; hold?: boolean } = {}): void {
  stage.setMode('arena');
  const heavy = rivalsFor('heavy');
  const corners: Corner[] = ['red', 'blue', 'green', 'yellow'];
  const fighters = [{ id: 'player', spec: buildSpec(mine), name: mine.name, player: true }, ...heavy.slice(0, n - 1).map((r) => ({ id: r.id, spec: buildSpec(r.loadout), name: r.card.name, player: false }))];
  // Make the second robot a flipper so the gas readout shows.
  if (n === 2) {
    const f = rivalById('flapjack')!;
    fighters[1] = { id: f.id, spec: buildSpec(f.loadout), name: f.card.name, player: false };
  }
  world = new MockWorld(
    fighters.map((f) => ({ id: f.id, spec: f.spec })),
    { countdown: opts.countdown ?? 4, clashEvery: 1.4, seed: 11 },
  );
  stage.setFighters(fighters);
  const entrants: HudEntrant[] = fighters.map((f, i) => ({ id: f.id, name: f.name, corner: corners[i], spec: f.spec, player: f.player }));
  ui.hud(entrants);
  ui.touchControls({ weaponLabel: WEAPONS[mine.weapon].short, selfRight: buildSpec(mine).selfRight });
  if (opts.ko || opts.hold) {
    // Fast-forward into the fight and fake a count and a hold on top of the mock frames.
    const w = world;
    for (let i = 0; i < 60 * 20; i++) w.step(1 / 60);
    const step = w.step.bind(w);
    let t0 = 0;
    w.step = (dt: number) => {
      const r = step(dt);
      t0 += dt;
      if (opts.ko) {
        const b = r.frame.bots[1];
        b.koCount = Math.max(0.1, 7.4 - t0);
        b.inverted = true;
      }
      if (opts.hold) r.frame.bots[0].holdTime = Math.min(9.6, 5 + t0);
      return r;
    };
  }
}

const L3 = (id: string, corner: Corner) => {
  const r = rivalById(id)!;
  const spec = buildSpec(r.loadout);
  ui.lowerThird({ corner, card: r.card, stats: spec.stats, weaponShort: WEAPONS[r.loadout.weapon].short, classLabel: CLASS_LABEL[r.loadout.cls] });
};

const ITEMS: Record<string, { group: string; label: string; run: () => unknown }> = {
  loading: {
    group: 'Screens',
    label: 'Loading',
    run: async () => {
      stage.setMode('none');
      for (let i = 0; i <= 20; i++) {
        ui.loading(i / 20);
        await new Promise((r) => setTimeout(r, 120));
      }
      ui.loaded();
    },
  },
  loadinghold: { group: 'Screens', label: 'Loading (hold 60%)', run: () => (stage.setMode('none'), ui.loading(0.6)) },
  title: { group: 'Screens', label: 'Title', run: () => (stage.setMode('title'), ui.title().then(() => log('title done'))) },
  menu: {
    group: 'Screens',
    label: 'Main menu',
    run: () => {
      stage.setMode('title');
      return ui.mainMenu({ career: 'Juggernaut. Rank #43. $350', season: 'Heavyweight semifinal vs Tax Audit', nuts: { heavy: 1, light: 2 }, robot: mine }).then((c) => log(`menu: ${c}`));
    },
  },
  menunew: { group: 'Screens', label: 'Main menu (new player)', run: () => (stage.setMode('title'), ui.mainMenu({ career: null, season: null, nuts: {}, robot: null }).then((c) => log(`menu: ${c}`))) },
  class: { group: 'Screens', label: 'Pick class', run: () => (stage.setMode('title'), ui.pickClass('New season').then((c) => log(`class: ${c}`))) },
  exhibition: {
    group: 'Screens',
    label: 'Exhibition',
    run: () => (stage.setMode('title'), ui.exhibition(ALL_RIVALS, true).then((c) => log(`exhibition: ${JSON.stringify(c)}`))),
  },
  garage: {
    group: 'Screens',
    label: 'Garage (build)',
    run: () => {
      stage.setMode('garage');
      return ui
        .garage({
          mode: 'build',
          loadout: mine,
          classLocked: false,
          preview: (l) => stage.showGarage(l),
          orbit: (dx, dy) => stage.orbit(dx, dy),
        })
        .then((r) => {
          if (r) mine = r.loadout;
          log(`garage: ${r ? JSON.stringify(r.loadout) : 'back'}`);
        });
    },
  },
  pits: {
    group: 'Screens',
    label: 'Garage (pits)',
    run: () => {
      stage.setMode('garage');
      return ui
        .garage({
          mode: 'pits',
          loadout: mine,
          classLocked: true,
          damage: pitsDamage(),
          repairPoints: 9,
          opponent: summary('tax-audit'),
          preview: (l) => stage.showGarage(l),
          orbit: (dx, dy) => stage.orbit(dx, dy),
        })
        .then((r) => log(`pits: ${r ? JSON.stringify(r) : 'back'}`));
    },
  },
  bracket: { group: 'Screens', label: 'Bracket (semis)', run: () => (stage.setMode('title'), ui.bracket(bracketView('sf'), summary('tax-audit')).then(() => log('bracket done'))) },
  bracketqf: { group: 'Screens', label: 'Bracket (start)', run: () => (stage.setMode('title'), ui.bracket(bracketView('qf'), summary('megahurtz')).then(() => log('bracket done'))) },
  bracketdone: { group: 'Screens', label: 'Bracket (won)', run: () => (stage.setMode('title'), ui.bracket(bracketView('done'), null).then(() => log('bracket done'))) },
  settings: { group: 'Screens', label: 'Settings', run: () => ui.settings(SETTINGS).then((s) => log(`settings: ${JSON.stringify(s)}`)) },
  credits: { group: 'Screens', label: 'Credits', run: () => (stage.setMode('title'), ui.credits().then(() => log('credits done'))) },
  pause: { group: 'Screens', label: 'Pause', run: () => ui.pause(true).then((p) => log(`pause: ${p}`)) },

  l3red: { group: 'Broadcast', label: 'Lower third (red)', run: () => L3('megahurtz', 'red') },
  l3blue: { group: 'Broadcast', label: 'Lower third (blue)', run: () => L3('general-discontent', 'blue') },
  l3off: { group: 'Broadcast', label: 'Lower third off', run: () => ui.lowerThird(null) },
  capvic: { group: 'Broadcast', label: 'Caption: Vic', run: () => ui.caption('Vic', 'In the red square, from Sunnyvale, California... MEGAHURTZ!') },
  capdale: { group: 'Broadcast', label: 'Caption: Dale', run: () => ui.caption('Dale', 'That robot has the turning circle of a cruise ship. And the charm.') },
  capchuck: { group: 'Broadcast', label: 'Caption: Chuck', run: () => ui.caption('Chuck', "That's a sack! He got under him like a nose tackle!") },
  capoff: { group: 'Broadcast', label: 'Caption off', run: () => ui.caption(null) },
  bugon: { group: 'Broadcast', label: 'Bug on', run: () => ui.bug(true) },
  bugoff: { group: 'Broadcast', label: 'Bug off', run: () => ui.bug(false) },
  ...Object.fromEntries(
    (['fight', 'ko', 'time', 'replay', 'release', 'tapout', 'winner', 'flipped', 'fire'] as const).map((k) => [
      `banner-${k}`,
      { group: 'Banners', label: k, run: () => ui.banner(k, k === 'winner' ? 'Rust Bucket' : undefined) },
    ]),
  ),
  replayon: { group: 'Broadcast', label: 'Replay frame on', run: () => ui.replayFrame(true) },
  replayoff: { group: 'Broadcast', label: 'Replay frame off', run: () => ui.replayFrame(false) },
  slate: { group: 'Broadcast', label: 'Slate', run: () => ui.slate('Quarterfinal', 'Rust Bucket vs Megahurtz', 3) },
  slate2: { group: 'Broadcast', label: 'Slate (tonight)', run: () => ui.slate('Tonight on BotBox', 'Heavyweights. Hammers. Heartbreak.', 3) },
  bumper: { group: 'Broadcast', label: 'Bumper', run: () => ui.bumper() },
  decision: { group: 'Broadcast', label: 'Decision', run: () => (stage.setMode('arena'), ui.decision(decisionView()).then(() => log('decision done'))) },
  interview: {
    group: 'Broadcast',
    label: 'Interview',
    run: () =>
      ui.interview([
        { speaker: 'Jenna', text: "I'm here with the builder of Rust Bucket. That drum took a beating out there. How are you feeling?" },
        { speaker: 'Builder', text: 'Honestly? I think we left a wheel somewhere in the killsaws. But we won!' },
        { speaker: 'Jenna', text: 'Back to you, Dale.' },
      ]),
  },
  resultwon: { group: 'Broadcast', label: 'Result (won)', run: () => ui.result({ won: true, headline: 'Rust Bucket drums out Flapjack', detail: 'Semifinal next. 9 repair points in the pits.', result: matchResult(true) }) },
  resultlost: { group: 'Broadcast', label: 'Result (lost)', run: () => ui.result({ won: false, headline: 'Flapjack takes the decision', detail: 'Your season is over. Back to the garage.', result: matchResult(false) }) },
  ceremony: { group: 'Broadcast', label: 'Ceremony', run: () => (stage.setMode('trophy'), ui.ceremony(PLAYER_CARD, 'heavy')) },
  eliminated: { group: 'Broadcast', label: 'Eliminated', run: () => ui.eliminated(PLAYER_CARD, 'Semifinal') },
  skipon: { group: 'Broadcast', label: 'Skip hint on', run: () => ui.skippable(true) },
  skipoff: { group: 'Broadcast', label: 'Skip hint off', run: () => ui.skippable(false) },

  ws1: { group: 'Career', label: 'Workshop: first fight', run: () => shopWorkshop(workshopView(0, { funds: 0, news: 'Doorstop is waiting. Tuesday, 8 pm, the Box.' })) },
  ws1b: { group: 'Career', label: 'Workshop: Act I, damaged, side gig', run: () => shopWorkshop(workshopView(2, { funds: 350, damaged: true, gig: true, losses: 1, news: 'New in the store: ground skirts' })) },
  ws2: { group: 'Career', label: 'Workshop: Act II', run: () => shopWorkshop(workshopView(5, { funds: 2450, gig: true, news: 'New in the store: NiCad packs, spinners and hardened steel' })) },
  ws3: { group: 'Career', label: 'Workshop: Act III', run: () => shopWorkshop(workshopView(9, { funds: 7800, damaged: true, gig: true, losses: 3 })) },
  ws4: { group: 'Career', label: 'Workshop: Act IV', run: () => shopWorkshop(workshopView(12, { funds: 14250, gig: true, losses: 4, news: 'Terminal Velocity says it remembers you' })) },
  wslong: { group: 'Career', label: 'Workshop: long names', run: () => shopWorkshop(workshopView(10, { funds: 123456, damaged: true, gig: true, losses: 12, name: 'Sir Reginald Clankington III', news: 'General Discontent has filed a formal complaint about your paint job and also the weather' })) },
  wsdone: { group: 'Career', label: 'Workshop: champion', run: () => shopWorkshop(workshopView(13, { funds: 31200, losses: 4 })) },
  gcareer: {
    group: 'Career',
    label: 'Garage: career store',
    run: () =>
      careerGarage({
        tier: 1,
        funds: 1250,
        owned: [...STARTING_OWNED, 'armor:uhmw', 'extra:spikes'],
        repairPer10: 15,
        damage: careerDamage(),
        loadout: { ...SCRAP_LOADOUT, extras: ['wedgeplate', 'spikes'] },
        opponent: 'homewrecker',
      }),
  },
  gbroke: {
    group: 'Career',
    label: 'Garage: career, broke',
    run: () => careerGarage({ tier: 0, funds: 40, owned: [...STARTING_OWNED], repairPer10: 5, damage: careerDamage(), loadout: SCRAP_LOADOUT }),
  },
  gguided: {
    group: 'Career',
    label: 'Garage: guided rebuild',
    run: () => careerGarage({ tier: 0, funds: 0, owned: [...STARTING_OWNED], repairPer10: 5, guided: ['drive', 'power', 'armor', 'name'], loadout: SCRAP_LOADOUT }),
  },
  ladder1: { group: 'Career', label: 'Career ladder (early)', run: () => (stage.setMode('garage'), ui.career(careerView(1)).then(() => log('ladder done'))) },
  ladder2: { group: 'Career', label: 'Career ladder (late)', run: () => (stage.setMode('garage'), ui.career(careerView(10)).then(() => log('ladder done'))) },
  rwfirst: { group: 'Career', label: 'Rewards: first win', run: () => (stage.setMode('garage'), ui.rewards(rewardsView('first')).then(() => log('rewards done'))) },
  rwwin: { group: 'Career', label: 'Rewards: win', run: () => (stage.setMode('garage'), ui.rewards(rewardsView('win')).then(() => log('rewards done'))) },
  rwloss: { group: 'Career', label: 'Rewards: loss', run: () => (stage.setMode('garage'), ui.rewards(rewardsView('loss')).then(() => log('rewards done'))) },
  rwact: { group: 'Career', label: 'Rewards: act complete', run: () => (stage.setMode('garage'), ui.rewards(rewardsView('act')).then(() => log('rewards done'))) },
  montage: {
    group: 'Career',
    label: 'Montage (6 cards)',
    run: async () => {
      startFight(2, { countdown: 0 });
      ui.hud(null);
      ui.touchControls(null);
      for (const c of MONTAGE) await ui.montage(c);
      log('montage done');
    },
  },
  ...Object.fromEntries(
    MONTAGE.map((c, i) => [
      `mt${i + 1}`,
      {
        group: 'Career',
        label: `Montage card ${i + 1} (${c.kind})`,
        run: async () => {
          stage.setMode('arena');
          // Headlines alternate paper and TV: play the earlier ones in a blink so each card looks as it would in sequence.
          for (const e of MONTAGE.slice(0, i).filter((x) => x.kind === 'headline')) await ui.montage({ ...e, sec: 0.4 });
          await ui.montage({ ...c, sec: 30 });
        },
      },
    ]),
  ),
  story: { group: 'Career', label: 'Story', run: () => ui.story(['Two seasons later.', 'A rented storage unit in Oakland.'], 5).then(() => log('story done')) },
  storyhold: { group: 'Career', label: 'Story (hold)', run: () => ui.story(['Two seasons later.', 'A rented storage unit in Oakland.'], 60) },
  coachkb: { group: 'Career', label: 'Coach: keyboard (drive)', run: () => (coachDevice('keyboard'), ui.coach('Drive at Terminal Velocity', 'drive')) },
  coachpad: { group: 'Career', label: 'Coach: gamepad (weapon)', run: () => (coachDevice('gamepad'), ui.coach('Spin up the disk', 'weapon')) },
  coachtouch: { group: 'Career', label: 'Coach: touch (weapon)', run: () => (coachDevice('touch'), ui.coach('Spin up the disk', 'weapon')) },
  coachright: { group: 'Career', label: 'Coach: self-right', run: () => ui.coach('Flip yourself back over', 'selfRight') },
  coachcam: { group: 'Career', label: 'Coach: camera', run: () => ui.coach('Switch the camera', 'camera') },
  coachtext: { group: 'Career', label: 'Coach: text only', run: () => ui.coach('Hit it. Hit it again.') },
  coachoff: { group: 'Career', label: 'Coach off', run: () => ui.coach(null) },
  coachfight: {
    group: 'Career',
    label: 'Coach over a fight',
    run: () => {
      startFight(2, { countdown: 0 });
      ui.caption('Dale', 'Forty-five seconds left and Juggernaut is still the champ.');
      ui.coach('Spin up the disk', 'weapon');
    },
  },

  fight: { group: 'Fight', label: 'Mock fight (duel)', run: () => startFight(2) },
  fightlive: { group: 'Fight', label: 'Mock fight (no countdown)', run: () => startFight(2, { countdown: 0 }) },
  rumble: { group: 'Fight', label: 'Mock rumble (4)', run: () => startFight(4, { countdown: 0 }) },
  ko: { group: 'Fight', label: 'KO count + hold', run: () => startFight(2, { ko: true, hold: true }) },
  stop: { group: 'Fight', label: 'Stop fight', run: () => stopFight() },
  touch: { group: 'Fight', label: 'Force touch controls', run: () => ui.debug.forceTouch(true) },
  touchoff: { group: 'Fight', label: 'Touch controls auto', run: () => ui.debug.forceTouch(false) },
};

// ---- drawer
const logEl = document.createElement('div');
function log(s: string): void {
  console.log('[lab-ui]', s);
  logEl.textContent = s.slice(0, 400);
}
const drawer = document.createElement('div');
drawer.style.cssText =
  'position:fixed;left:0;top:0;bottom:0;width:220px;overflow:auto;background:rgba(0,0,0,.82);color:#ddd;font:12px system-ui;z-index:1000;padding:8px;box-shadow:2px 0 8px #000;transition:transform .2s';
const groups = new Map<string, HTMLElement>();
for (const [id, it] of Object.entries(ITEMS)) {
  let g = groups.get(it.group);
  if (!g) {
    g = document.createElement('div');
    g.innerHTML = `<div style="margin:10px 0 4px;color:#ff6a00;font-weight:700;letter-spacing:.1em;text-transform:uppercase">${it.group}</div>`;
    drawer.append(g);
    groups.set(it.group, g);
  }
  const b = document.createElement('button');
  b.textContent = it.label;
  b.tabIndex = -1;
  b.style.cssText = 'display:block;width:100%;text-align:left;margin:2px 0;padding:4px 6px;background:#1c2026;color:#eee;border:1px solid #333;cursor:pointer;font:12px system-ui';
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', () => open(id));
  g.append(b);
}
logEl.style.cssText = 'margin-top:12px;color:#9f9;white-space:pre-wrap;word-break:break-all';
drawer.append(logEl);
const toggle = document.createElement('button');
toggle.textContent = 'LAB';
toggle.tabIndex = -1;
toggle.style.cssText = 'position:fixed;left:4px;bottom:4px;z-index:1001;font:700 11px system-ui;background:#ff6a00;color:#000;border:0;padding:4px 8px;cursor:pointer';
toggle.addEventListener('mousedown', (e) => e.preventDefault());
let drawerOpen = params.get('panel') !== '0';
const syncDrawer = () => {
  drawer.style.transform = drawerOpen ? 'none' : 'translateX(-105%)';
  toggle.style.display = params.get('panel') === '0' ? 'none' : 'block';
};
toggle.addEventListener('click', () => {
  drawerOpen = !drawerOpen;
  syncDrawer();
});
addEventListener('keydown', (e) => {
  if (e.code === 'Backquote') {
    drawerOpen = !drawerOpen;
    syncDrawer();
  }
});
document.body.append(drawer, toggle);
syncDrawer();

function open(id: string): unknown {
  const it = ITEMS[id];
  if (!it) return log(`no item ${id}`);
  const careerFresh = it.group === 'Career' && !id.startsWith('coach');
  const fresh = (it.group === 'Screens' && !['settings', 'pause', 'loading', 'loadinghold'].includes(id)) || ['fight', 'fightlive', 'rumble', 'ko', 'coachfight'].includes(id) || careerFresh;
  if (fresh || ['decision', 'resultwon', 'resultlost', 'ceremony', 'eliminated'].includes(id)) {
    if (fresh) stopFight();
    ui.debug.reset();
  }
  if (drawerOpen && innerWidth < 1000) {
    drawerOpen = false;
    syncDrawer();
  }
  log(`open ${id}`);
  return it.run();
}

declare global {
  interface Window {
    lab: { open: (id: string) => unknown; heard: string[]; ui: typeof ui; items: string[]; input: Input };
  }
}
window.lab = { open, heard, ui, items: Object.keys(ITEMS), input };

stage.setMode('title');
if (params.get('touch') === '1') ui.debug.forceTouch(true);
for (const id of (params.get('open') ?? '').split(',').filter(Boolean)) void open(id);
