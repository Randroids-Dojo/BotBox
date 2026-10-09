// Arena workbench: the Stage driven by MockWorld, with controls for scenes, cameras, shots,
// quality, the broadcast filter and the mock, plus an fps and draw call readout.
//   ?lab=arena&scene=arena&cam=broadcast&q=high&filter=1&bots=3&hideui=1&warp=8

import type { HitEvent, MatchEvent, Vec3 } from '../contract';
import { ROSTER } from '../data/roster';
import { createStage } from '../render/stage';
import type { CameraMode, Quality, SceneId, ShotRequest, StageEntrant } from '../render/types';
import { buildSpec } from '../sim/spec';
import { MockWorld } from './mock';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ui = document.getElementById('ui')!;
const stage = createStage(canvas);

const botIds = (params.get('ids') ?? 'megahurtz,flapjack,general-discontent').split(',');
const nBots = Number(params.get('bots') ?? 2);
const corners = ['red', 'blue', 'green', 'yellow'] as const;
const rivals = botIds.map((id) => ROSTER.find((r) => r.id === id) ?? ROSTER[0]).slice(0, nBots);
const entrants: StageEntrant[] = rivals.map((r, i) => ({ id: r.id, spec: buildSpec(r.loadout), corner: corners[i], player: i === 0 }));

let mock = newMock();
let paused = false;
let lastHit: HitEvent | null = null;
let replaySeed = 0;

function newMock(): MockWorld {
  return new MockWorld(
    entrants.map((e) => ({ id: e.id, spec: e.spec })),
    { seed: 7, countdown: Number(params.get('countdown') ?? 4), clashEvery: 2.2 },
  );
}

const loading = document.createElement('div');
loading.style.cssText = 'position:fixed;left:20px;bottom:20px;font:600 14px system-ui;color:#aaa';
ui.appendChild(loading);
await stage.init((p) => (loading.textContent = `Loading ${Math.round(p * 100)}%`));
loading.remove();
stage.setEntrants(entrants);
stage.garage(entrants[0].spec);
stage.trophy(entrants[0].spec);
const q0 = params.get('q') as Quality | null;
if (q0) stage.setQuality(q0);
stage.setScene((params.get('scene') as SceneId) ?? 'arena');
stage.setCameraMode((params.get('cam') as CameraMode) ?? 'chase');
if (params.get('filter') === '1') stage.setBroadcastFilter(true);

// Warp the mock forward so screenshots land mid fight.
const warp = Number(params.get('warp') ?? 0);
for (let t = 0; t < warp; t += 1 / 60) mock.step(1 / 60);
if (params.get('pause') === '1') paused = true;

// ------------------------------------------------------------------ controls
const panel = document.createElement('div');
panel.style.cssText =
  'position:fixed;top:8px;right:8px;width:250px;max-height:calc(100vh - 16px);overflow:auto;pointer-events:auto;background:rgba(8,10,14,.82);border:1px solid #333;border-radius:6px;padding:8px;font:12px/1.3 system-ui;color:#ddd';
if (params.get('hideui') === '1') panel.style.display = 'none';
ui.appendChild(panel);
const readout = document.createElement('pre');
readout.style.cssText = 'margin:0 0 6px;font:11px/1.35 ui-monospace,monospace;color:#9f9';
panel.appendChild(readout);

function row(title: string, items: [string, () => void][]): void {
  const h = document.createElement('div');
  h.textContent = title;
  h.style.cssText = 'margin:6px 0 3px;color:#ff6a00;font-weight:700;text-transform:uppercase;font-size:10px;letter-spacing:.08em';
  panel.appendChild(h);
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px';
  for (const [label, fn] of items) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'background:#1c2028;color:#eee;border:1px solid #3a404c;border-radius:3px;padding:3px 6px;font:11px system-ui;cursor:pointer';
    b.onclick = fn;
    wrap.appendChild(b);
  }
  panel.appendChild(wrap);
}

const point = (): Vec3 => lastHit?.point ?? { x: 0, y: 0.2, z: 0 };
const ids = entrants.map((e) => e.id);
const shots: [string, ShotRequest | (() => ShotRequest)][] = [
  ['flyover', { kind: 'flyover', duration: 8 }],
  ...entrants.map((e) => [`intro ${e.id.slice(0, 6)}`, { kind: 'bot_intro', bot: e.id, duration: 6 }] as [string, ShotRequest]),
  ['faceoff', { kind: 'faceoff', duration: 4 }],
  ['lights', { kind: 'lights', duration: 4 }],
  ['impact', () => ({ kind: 'impact', point: point(), bots: lastHit ? [lastHit.victim, lastHit.attacker ?? ids[0]] : ids, duration: 1.6 })],
  ['replay', () => ({ kind: 'replay', point: point(), bots: ids, duration: 5, seed: replaySeed++ })],
  ['winner', { kind: 'winner', bot: ids[0], duration: 10 }],
  ['loser', { kind: 'loser', bot: ids[1] ?? ids[0], duration: 5 }],
  ['booth', { kind: 'booth', duration: 5 }],
  ['live', { kind: 'live' }],
];

row('Scene', (['title', 'arena', 'garage', 'trophy'] as SceneId[]).map((s) => [s, () => stage.setScene(s)]));
row('Camera', (['chase', 'broadcast', 'driver'] as CameraMode[]).map((m) => [m, () => stage.setCameraMode(m)]));
row('Shots', shots.map(([l, s]) => [l, () => stage.shot(typeof s === 'function' ? s() : s)]));
row('Quality', (['high', 'medium', 'low'] as Quality[]).map((q) => [q, () => stage.setQuality(q)]));
row('Look', [
  ['broadcast filter', () => stage.setBroadcastFilter(!filterOn())],
  ['shake', () => stage.shake(0.7)],
  ['crowd 0', () => stage.crowd(0)],
  ['crowd .5', () => stage.crowd(0.5)],
  ['crowd 1', () => stage.crowd(1)],
]);
row('Mock', [
  ['pause', () => (paused = !paused)],
  ['restart', () => {
    mock = newMock();
    stage.clearTransient();
    stage.setEntrants(entrants);
  }],
  ['big hit', () => {
    const t = mock.t;
    const [a, v] = [entrants[0].id, entrants[1]?.id ?? entrants[0].id];
    const e: HitEvent = { type: 'hit', t, kind: 'spinner', attacker: a, victim: v, point: point(), dir: { x: 1, y: 0.4, z: 0 }, energy: 12000, facet: 'front', damage: 40, severity: 1, material: 'steel' };
    pending.push(e);
    stage.shake(0.8);
  }],
]);
let filter = params.get('filter') === '1';
function filterOn(): boolean {
  filter = !filter;
  return !filter;
}

// ------------------------------------------------------------------ loop
const pending: MatchEvent[] = [];
let last = performance.now();
let fpsAcc = 0;
let fpsN = 0;
let fps = 0;
let worst = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fpsAcc += dt;
  fpsN++;
  worst = Math.max(worst, dt);
  if (fpsAcc > 0.5) {
    fps = fpsN / fpsAcc;
    fpsAcc = 0;
    fpsN = 0;
    const s = stage.stats();
    readout.textContent = `${fps.toFixed(0)} fps  worst ${(worst * 1000).toFixed(0)} ms\ncalls ${s.calls}  tris ${(s.triangles / 1000).toFixed(0)}k\n${s.pixels[0]}x${s.pixels[1]}  ${stage.getQuality()}\ncam ${stage.getCameraMode()}  rig ${s.rig}\nmock t ${mock.t.toFixed(1)} ${paused ? 'PAUSED' : ''}`;
    worst = 0;
  }
  const { frame: w, events } = paused ? { frame: lastFrame ?? mock.step(0).frame, events: [] as MatchEvent[] } : mock.step(dt);
  lastFrame = w;
  for (const e of events) if (e.type === 'hit') lastHit = e;
  const all = pending.length ? [...events, ...pending.splice(0)] : events;
  stage.render(w, all, dt);
  requestAnimationFrame(frame);
}
let lastFrame: ReturnType<MockWorld['step']>['frame'] | null = null;
requestAnimationFrame(frame);
addEventListener('resize', () => stage.resize());

// Drag to orbit in garage and trophy.
let drag: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => (drag = { x: e.clientX, y: e.clientY }));
addEventListener('pointerup', () => (drag = null));
addEventListener('pointermove', (e) => {
  if (!drag) return;
  stage.orbit(e.clientX - drag.x, e.clientY - drag.y);
  drag = { x: e.clientX, y: e.clientY };
});

(window as unknown as { __lab: unknown }).__lab = {
  stage,
  get mock() {
    return mock;
  },
  stats: () => ({ fps, ...stage.stats() }),
  pause: (p: boolean) => (paused = p),
  /** Render n frames back to back, waiting for the GPU each time. Milliseconds per frame. */
  bench(n = 90): { ms: number; calls: number } {
    const gl = stage.renderer.getContext();
    const px = new Uint8Array(4);
    let calls = 0;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      const { frame: w, events } = mock.step(1 / 60);
      stage.render(w, events, 1 / 60);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      calls += stage.stats().calls;
    }
    return { ms: (performance.now() - t0) / n, calls: Math.round(calls / n) };
  },
};
