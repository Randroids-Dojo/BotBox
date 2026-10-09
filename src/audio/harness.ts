// Offline renders through the real engine code, for measurement and listening. Used by the lab
// page (window.__botboxAudio) and src/audio/tools/render.ts (headless Chrome).

import type { BotSpec, HitKind, MatchEvent, Quat, Vec3, WorldFrame } from '../contract';
import { ROSTER } from '../data/roster';
import { MockWorld } from '../dev/mock';
import { buildSpec } from '../sim/spec';
import type { Bank } from './bank';
import { Core } from './engine';
import { defineAll, warmBank } from './index';
import { defineNote } from './music/instruments';
import { cueKeys } from './music/player';
import { MATERIALS } from './sounds/sfx';
import type { MusicCue, Stinger, UiSound } from './types';
import { Biquad } from './dsp';
import { VoiceManifest } from './voice';

export const RATE = 48000;

export interface Stats {
  peak: number;
  peakDb: number;
  rmsDb: number;
  dc: number;
  clipped: number;
  /** Short-term (400 ms) RMS dB range, to find dropouts. */
  stMin: number;
  stMax: number;
  /** Longest run below -60 dBFS, seconds. */
  longestGap: number;
}

export function stats(chs: Float32Array[], rate = RATE, from = 0): Stats {
  let peak = 0;
  let sum = 0;
  let dc = 0;
  let clipped = 0;
  const n = chs[0].length;
  for (const c of chs)
    for (let i = from; i < n; i++) {
      const x = c[i];
      const a = Math.abs(x);
      if (a > peak) peak = a;
      if (a >= 0.999) clipped++;
      sum += x * x;
      dc += x;
    }
  const count = (n - from) * chs.length;
  const win = Math.floor(rate * 0.4);
  let stMin = Infinity;
  let stMax = -Infinity;
  let gap = 0;
  let longest = 0;
  for (let i = from; i + win <= n; i += win) {
    let s = 0;
    for (const c of chs) for (let j = i; j < i + win; j++) s += c[j] * c[j];
    const db = 10 * Math.log10(s / (win * chs.length) + 1e-12);
    stMin = Math.min(stMin, db);
    stMax = Math.max(stMax, db);
    if (db < -60) {
      gap += 0.4;
      longest = Math.max(longest, gap);
    } else gap = 0;
  }
  return {
    peak,
    peakDb: 20 * Math.log10(peak + 1e-12),
    rmsDb: 10 * Math.log10(sum / count + 1e-12),
    dc: dc / count,
    clipped,
    stMin,
    stMax,
    longestGap: longest,
  };
}

/** 16-bit PCM WAV, base64. */
export function wavBase64(chs: Float32Array[], rate = RATE): string {
  const n = chs[0].length;
  const nc = chs.length;
  const buf = new ArrayBuffer(44 + n * nc * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + n * nc * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, nc, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * nc * 2, true);
  v.setUint16(32, nc * 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, n * nc * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < nc; c++) {
      const x = Math.max(-1, Math.min(1, chs[c][i]));
      v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
      o += 2;
    }
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------------------------------------------------------------------------------------------

let sharedBank: Bank | null = null;
const manifest = new VoiceManifest();

export function useBank(b: Bank): void {
  sharedBank = b;
}

export async function harnessBank(): Promise<Bank> {
  if (!sharedBank) {
    const { Bank } = await import('./bank');
    sharedBank = new Bank(RATE, 4);
    defineAll(sharedBank);
  }
  await warmBank(sharedBank);
  await sharedBank.ensure(sharedBank.ids());
  return sharedBank;
}

interface Driver {
  ctx: OfflineAudioContext;
  core: Core;
  seconds: number;
  /** Called every `step` seconds of audio time with the context suspended. */
  hook?: (t: number, step: number) => void | Promise<void>;
  step?: number;
}

async function run(d: Driver): Promise<Float32Array[]> {
  const step = d.step ?? 1 / 30;
  const ctx = d.ctx;
  for (let k = 1; k * step < d.seconds - step; k++) {
    const t = k * step;
    void ctx.suspend(t).then(async () => {
      await d.hook?.(t, step);
      d.core.tick(0.3);
      await ctx.resume();
    });
  }
  const b = await ctx.startRendering();
  return [b.getChannelData(0), b.getChannelData(1)];
}

function offline(seconds: number): OfflineAudioContext {
  return new OfflineAudioContext(2, Math.ceil(seconds * RATE), RATE);
}

export interface RenderResult {
  stats: Stats;
  wav?: string;
  ms: number;
  /** Extra measurements. */
  info: Record<string, unknown>;
}

/** A music cue on its own, optionally switching to another cue partway (crossfade test). */
export async function renderCue(cue: Exclude<MusicCue, 'none'>, seconds: number, o: { wav?: boolean; then?: { at: number; cue: MusicCue; fade: number }; solo?: string[] } = {}): Promise<RenderResult> {
  const t0 = performance.now();
  const bank = await harnessBank();
  await bank.ensure(cueKeys(bank, cue));
  if (o.then && o.then.cue !== 'none') await bank.ensure(cueKeys(bank, o.then.cue));
  const ctx = offline(seconds);
  const core = new Core(ctx, bank, manifest);
  core.world.setActive(false);
  core.mixer.crowdGate.gain.value = 0;
  if (o.solo) core.music.solo = new Set(o.solo as never[]);
  core.musicCue(cue, 0);
  await core.music.idle();
  let switched = false;
  const out = await run({
    ctx,
    core,
    seconds,
    hook: async (t) => {
      if (o.then && !switched && t >= o.then.at) {
        switched = true;
        core.musicCue(o.then.cue, o.then.fade);
        await core.music.idle();
      }
    },
  });
  return { stats: stats(out), wav: o.wav ? wavBase64(out) : undefined, ms: performance.now() - t0, info: { cue } };
}

function rosterSpecs(ids: string[]): { id: string; spec: BotSpec }[] {
  return ids.map((id) => {
    const r = ROSTER.find((x) => x.id === id) ?? ROSTER[0];
    return { id: r.id, spec: buildSpec(r.loadout) };
  });
}

/** Camera pose orbiting the arena, looking at the center. */
export function orbitListener(t: number): { pos: Vec3; quat: Quat } {
  const a = t * 0.12;
  const pos = { x: Math.sin(a) * 11, y: 5, z: Math.cos(a) * 11 };
  // Yaw so -Z points at the origin.
  const yaw = Math.atan2(pos.x, pos.z);
  return { pos, quat: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) } };
}

/** Grinding contact the mock does not produce: bursts when robots are close. */
export function grindEvents(world: WorldFrame, t: number): MatchEvent[] {
  if (world.match.phase !== 'fight' || world.bots.length < 2) return [];
  const [a, b] = world.bots;
  const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
  const burst = Math.sin(t * 0.9) > 0.75;
  if (d > 2.2 && !burst) return [];
  const point = { x: (a.pos.x + b.pos.x) / 2, y: 0.15, z: (a.pos.z + b.pos.z) / 2 };
  return [{ type: 'grind', t, point, dir: { x: 1, y: 0, z: 0 }, intensity: burst ? 0.7 : 0.5, material: 'steel' }];
}

/** The full world mix: a mock fight with two roster robots, fight music, crowd, moving camera. */
export async function renderFight(
  seconds: number,
  o: { wav?: boolean; bots?: string[]; music?: boolean; seed?: number; slowmo?: [number, number]; crowd?: boolean; robots?: boolean; events?: boolean; only?: readonly string[]; hazards?: boolean; worldMute?: boolean } = {},
): Promise<RenderResult> {
  const t0 = performance.now();
  const bank = await harnessBank();
  await bank.ensure(cueKeys(bank, 'fight'));
  const ctx = offline(seconds);
  const core = new Core(ctx, bank, manifest);
  const specs = rosterSpecs(o.bots ?? ['megahurtz', 'tax-audit']);
  if (o.robots !== false) core.setEntrants(specs);
  if (o.crowd === false) core.mixer.crowdGate.gain.value = 0;
  const mock = new MockWorld(specs, { seed: o.seed ?? 7, countdown: 4, clashEvery: 2.2 });
  if (o.music !== false) {
    core.musicCue('fight', 0);
    await core.music.idle();
  }
  const counts: Record<string, number> = {};
  let peakShots = 0;
  const excite: number[] = [];
  let frameMs = 0;
  let frames = 0;
  const out = await run({
    ctx,
    core,
    seconds,
    step: 1 / 60,
    hook: (t, step) => {
      const { frame, events } = mock.step(step);
      let ev = o.events === false ? [] : [...events, ...grindEvents(frame, t)];
      if (o.only) ev = ev.filter((e) => o.only!.includes(e.type));
      if (o.hazards === false) frame.hazards = [];
      if (o.crowd === false) core.mixer.crowdGate.gain.value = 0;
      if (o.worldMute) core.mixer.worldGate.gain.value = 0;
      for (const e of ev) counts[e.type === 'hit' ? `hit.${e.kind}` : e.type] = (counts[e.type === 'hit' ? `hit.${e.kind}` : e.type] ?? 0) + 1;
      if (o.slowmo) core.world.setTimeScale(t >= o.slowmo[0] && t < o.slowmo[1] ? 0.25 : 1);
      const f0 = performance.now();
      core.frame(frame, ev, orbitListener(t), step);
      frameMs += performance.now() - f0;
      frames++;
      peakShots = Math.max(peakShots, core.world.oneshotCount());
      if (Math.abs(t % 2) < step) excite.push(Math.round(core.world.crowd.excitement * 100) / 100);
    },
  });
  return {
    stats: stats(out),
    wav: o.wav ? wavBase64(out) : undefined,
    ms: performance.now() - t0,
    info: { excitement: excite, counts, peakShots, stolen: core.world.stats.stolen, frameMsAvg: frameMs / Math.max(1, frames), nodeEstimate: core.world.nodeCount() },
  };
}

export interface TourCue {
  t: number;
  what: string;
}

/** Every one-shot in sequence with gaps, and per-cue levels. */
export async function renderTour(o: { wav?: boolean; group?: 'all' | 'show' | 'impacts' | 'world' } = {}): Promise<RenderResult & { cues: (TourCue & { peakDb: number; rmsDb: number })[] }> {
  const t0 = performance.now();
  const bank = await harnessBank();
  const group = o.group ?? 'all';
  const plan: { what: string; len: number; fire: (core: Core) => void }[] = [];
  const stingers: Stinger[] = ['logo', 'whoosh', 'lights', 'go', 'ko', 'time', 'decision', 'replay', 'stamp', 'crowd_roar'];
  const uis: UiSound[] = ['move', 'select', 'back', 'error', 'buy', 'repair', 'tick', 'type'];
  const center = { x: 0, y: 0.2, z: 0 };
  if (group === 'all' || group === 'show') {
    for (const s of stingers) plan.push({ what: `stinger.${s}`, len: s === 'logo' || s === 'decision' || s === 'crowd_roar' ? 4 : 2.6, fire: (c) => c.stinger(s) });
    for (const u of uis) plan.push({ what: `ui.${u}`, len: 0.8, fire: (c) => c.ui(u) });
  }
  if (group === 'all' || group === 'impacts') {
    const kinds: HitKind[] = ['spinner', 'ram', 'axe', 'flip', 'lift', 'wall', 'spikestrip', 'killsaw', 'pulverizer', 'ramrod', 'floor'];
    for (const kind of kinds)
      for (const material of kind === 'spinner' ? MATERIALS : (['steel'] as const))
        for (const energy of [300, 3000, 18000])
          plan.push({
            what: `hit.${kind}.${material}.${energy}`,
            len: 1.6,
            fire: (c) =>
              c.world.frame(
                emptyWorld(),
                [{ type: 'hit', t: 0, kind, attacker: null, victim: 'v', point: center, dir: { x: 1, y: 0, z: 0 }, energy, facet: 'front', damage: 10, severity: Math.min(1, energy / 12000), material }],
                orbitListener(0),
                0,
              ),
          });
  }
  if (group === 'all' || group === 'world') {
    const ev = (e: MatchEvent) => (c: Core) => c.world.frame(emptyWorld(), [e], orbitListener(0), 0);
    plan.push({ what: 'weapon.flipper', len: 1.6, fire: ev({ type: 'weapon_fire', t: 0, bot: 'x', kind: 'flipper' }) });
    plan.push({ what: 'weapon.axe', len: 1.6, fire: ev({ type: 'weapon_fire', t: 0, bot: 'x', kind: 'axe' }) });
    plan.push({ what: 'weapon.srimech', len: 1.6, fire: ev({ type: 'weapon_fire', t: 0, bot: 'x', kind: 'srimech' }) });
    plan.push({ what: 'weapon.arm', len: 1, fire: ev({ type: 'weapon_arm', t: 0, bot: 'x', on: true }) });
    plan.push({ what: 'landed', len: 2, fire: ev({ type: 'landed', t: 0, bot: 'x', speed: 6 }) });
    plan.push({ what: 'panel_off', len: 2.4, fire: ev({ type: 'panel_off', t: 0, bot: 'x', facet: 'left', debris: 1 }) });
    plan.push({ what: 'wheel_off', len: 2.2, fire: ev({ type: 'wheel_off', t: 0, bot: 'x', index: 0, debris: 1 }) });
    plan.push({ what: 'fire_start', len: 2.2, fire: ev({ type: 'fire_start', t: 0, bot: 'x' }) });
    plan.push({ what: 'smoke_start', len: 1.4, fire: ev({ type: 'smoke_start', t: 0, bot: 'x' }) });
    for (const id of ['saw-w-0', 'pulv-nw', 'ram-n'] as const) {
      const kind = id.startsWith('saw') ? 'killsaw' : id.startsWith('pulv') ? 'pulverizer' : 'ramrod';
      plan.push({ what: `hazard.${kind}.warn`, len: 0.8, fire: ev({ type: 'hazard', t: 0, hazard: id, kind, action: 'warn', target: null }) });
      plan.push({ what: `hazard.${kind}.strike`, len: kind === 'killsaw' ? 2.6 : 1.4, fire: ev({ type: 'hazard', t: 0, hazard: id, kind, action: 'strike', target: null }) });
      plan.push({ what: `hazard.${kind}.retract`, len: 1.4, fire: ev({ type: 'hazard', t: 0, hazard: id, kind, action: 'retract', target: null }) });
    }
    plan.push({
      what: 'hazard.pulverizer.slam',
      len: 2.8,
      fire: (c) => {
        const w = emptyWorld();
        w.hazards = [{ id: 'pulv-nw', kind: 'pulverizer', state: 0, spin: 0, warn: false }];
        c.world.frame(w, [], orbitListener(0), 0);
        w.hazards = [{ id: 'pulv-nw', kind: 'pulverizer', state: 1, spin: 0, warn: false }];
        c.world.frame(w, [], orbitListener(0), 0);
      },
    });
  }
  const seconds = plan.reduce((s, p) => s + p.len, 0) + 1;
  const ctx = offline(seconds);
  const core = new Core(ctx, bank, manifest);
  core.mixer.crowdGate.gain.value = 0;
  const cues: TourCue[] = [];
  let at = 0.5;
  for (const p of plan) {
    const t = at;
    cues.push({ t, what: p.what });
    void ctx.suspend(Math.round((t * RATE) / 128) * (128 / RATE)).then(() => {
      p.fire(core);
      void ctx.resume();
    });
    at += p.len;
  }
  const b = await ctx.startRendering();
  const out = [b.getChannelData(0), b.getChannelData(1)];
  const per = plan.map((p, i) => {
    const a = Math.floor(cues[i].t * RATE);
    const e = Math.floor((cues[i].t + p.len) * RATE);
    const s = stats(out.map((c) => c.subarray(a, e)));
    return { ...cues[i], peakDb: s.peakDb, rmsDb: s.rmsDb };
  });
  return { stats: stats(out), wav: o.wav ? wavBase64(out) : undefined, ms: performance.now() - t0, info: {}, cues: per };
}

/** A speech-like test line: a buzzy voice through moving formants with syllables. */
function fakeSpeech(seconds: number, f0: number): Float32Array {
  const n = Math.floor(RATE * seconds);
  const out = new Float32Array(n);
  let ph = 0;
  const f1 = new Biquad(RATE, 'bp', 700, 5);
  const f2 = new Biquad(RATE, 'bp', 1200, 8);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const syl = Math.max(0, Math.sin(t * Math.PI * 4.5)) ** 0.6;
    if (i % 2400 === 0) {
      const v = [[730, 1090], [530, 1840], [300, 2200], [570, 840]][Math.floor(t * 4.5) % 4];
      f1.set('bp', v[0], 5);
      f2.set('bp', v[1], 8);
    }
    ph += (f0 * (1 + 0.1 * Math.sin(t * 3))) / RATE;
    const src = (ph % 1) * 2 - 1;
    out[i] = (f1.run(src) + 0.6 * f2.run(src)) * syl * 2.2;
  }
  return out;
}

export interface VoiceTest {
  results: Record<string, { ok: boolean; at: number; resolvedAt: number }>;
  windows: Record<string, number>;
  wav?: string;
}

/** Voice playback through the engine: ducking, skip, interrupt, missing ids, speaker chains.
 *  `musicOnly` renders with the voice bus muted, to read the duck on the music. */
export async function renderVoiceTest(o: { musicOnly?: boolean; wav?: boolean } = {}): Promise<VoiceTest> {
  const bank = await harnessBank();
  await bank.ensure(cueKeys(bank, 'menu'));
  const ctx = offline(16);
  const man = new VoiceManifest();
  await man.ready;
  const blob = (f0: number) => URL.createObjectURL(new Blob([Uint8Array.from(atob(wavBase64([fakeSpeech(1.6, f0)])), (c) => c.charCodeAt(0))], { type: 'audio/wav' }));
  man.lines = {
    'test.vic': { file: blob(110), text: 'Test Vic', speaker: 'Vic', dur: 1.6 },
    'test.dale': { file: blob(140), text: 'Test Dale', speaker: 'Dale', dur: 1.6 },
    'test.jenna': { file: blob(220), text: 'Test Jenna', speaker: 'Jenna', dur: 1.6 },
  };
  const core = new Core(ctx, bank, man);
  core.world.setActive(false);
  core.mixer.crowdGate.gain.value = 0;
  core.setVolumes({ master: 1, music: o.musicOnly ? 1 : 0, sfx: 1, voice: o.musicOnly ? 0 : 1 });
  await core.voice.preload(Object.keys(man.lines));
  core.musicCue('menu', 0);
  await core.music.idle();
  const results: VoiceTest['results'] = {};
  const say = (name: string, id: string, interrupt = false) => {
    const at = ctx.currentTime;
    void core.voice.play(id, interrupt).then((ok) => (results[name] = { ok, at, resolvedAt: ctx.currentTime }));
  };
  const plan: [number, () => void][] = [
    [3, () => say('vic', 'test.vic')],
    [3.5, () => say('dale while busy (skipped)', 'test.dale')],
    [8, () => say('dale', 'test.dale')],
    [8.6, () => say('jenna interrupts', 'test.jenna', true)],
    [12, () => say('missing id', 'nope.1')],
  ];
  const out = await run({
    ctx,
    core,
    seconds: 16,
    hook: async (t, step) => {
      for (const [at, fn] of plan) if (t >= at && t - step < at) fn();
      // Let a pending decode attach its source before audio time moves on.
      await new Promise((r) => setTimeout(r, 5));
    },
  });
  const win = (a: number, b: number) => stats(out.map((c) => c.subarray(Math.floor(a * RATE), Math.floor(b * RATE)))).rmsDb;
  return {
    results,
    windows: {
      'before (1-3 s)': win(1, 3),
      'vic line (3.3-4.5 s)': win(3.3, 4.5),
      'just after vic ends (4.7-5.5 s)': win(4.7, 5.5),
      'recovered (6.5-7.9 s)': win(6.5, 7.9),
      'dale line (8.1-8.5 s)': win(8.1, 8.5),
      'after dale cut (8.62-8.66 s)': win(8.62, 8.66),
      'jenna line (8.7-10.2 s)': win(8.7, 10.2),
      'jenna tail (10.35-10.9 s)': win(10.35, 10.9),
      'late (13-15.5 s)': win(13, 15.5),
    },
    wav: o.wav ? wavBase64(out) : undefined,
  };
}

function emptyWorld(): WorldFrame {
  return { t: 0, bots: [], debris: [], hazards: [], match: { phase: 'fight', clock: 100, lights: 4, timeScale: 1 } };
}

/** Render one bank sample on its own (for spectra). */
export async function renderKey(key: string): Promise<{ wav: string; seconds: number }> {
  const bank = await harnessBank();
  if (key.startsWith('m.')) defineNote(bank, key);
  await bank.load(key);
  const b = bank.get(key)!;
  const chs = Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i));
  return { wav: wavBase64(chs, b.sampleRate), seconds: b.duration };
}

export async function bankInfo(): Promise<{ ids: number; bytes: number; renderSeconds: number }> {
  const bank = await harnessBank();
  return { ids: bank.ids().length, bytes: bank.bytes(), renderSeconds: bank.renderSeconds };
}

/** Audio-graph cost in steady state: build a scene, then render 20 s with no main-thread hooks.
 *  Returns the render time as a fraction of real time for each scene. */
export async function cpuProfile(): Promise<Record<string, number>> {
  const bank = await harnessBank();
  await bank.ensure(cueKeys(bank, 'fight'));
  const specs = rosterSpecs(['megahurtz', 'homewrecker']);
  const scenes: [string, { music?: boolean; crowd?: boolean; robots?: number; hall?: boolean }][] = [
    ['bare mixer', { crowd: false, hall: false }],
    ['+ fight music', { music: true, crowd: false, hall: false }],
    ['+ crowd', { music: true, crowd: true, hall: false }],
    ['+ 2 robots (spinners)', { music: true, crowd: true, robots: 2, hall: false }],
    ['+ arena reverb (full fight)', { music: true, crowd: true, robots: 2, hall: true }],
  ];
  const out: Record<string, number> = {};
  for (const [name, o] of scenes) {
    const secs = 20;
    const ctx = offline(secs);
    const core = new Core(ctx, bank, manifest);
    if (!o.crowd) core.mixer.crowdGate.gain.value = 0;
    if (!o.hall) core.mixer.hallIn.disconnect();
    if (o.robots) core.setEntrants(specs.slice(0, o.robots));
    if (o.music) {
      core.musicCue('fight', 0);
      await core.music.idle();
    }
    // Spin the robots up and set every param once, then let the graph run on its own.
    const mock = new MockWorld(specs.slice(0, o.robots ?? 0), { countdown: 0 });
    for (let i = 0; i < 300; i++) mock.step(1 / 60);
    const { frame } = mock.step(1 / 60);
    core.frame(frame, [], orbitListener(0), 1 / 60);
    if (o.crowd) core.world.crowd.update(0.1, frame);
    // Music needs pumping; schedule the whole 20 s up front.
    core.music.pump(secs);
    const t0 = performance.now();
    await ctx.startRendering();
    out[name] = (performance.now() - t0) / 1000 / secs;
  }
  return out;
}

export const harness = { renderCue, renderFight, renderTour, renderKey, renderVoiceTest, cpuProfile, bankInfo, stats };
export type Harness = typeof harness;
