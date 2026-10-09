// Audio workbench: ?lab=audio. Every sound on a button, every music cue, a mock fight for the
// world mix with a moving listener, volume sliders and a voice browser.

import type { ArmorMaterialId, HitKind, MatchEvent } from '../contract';
import { ROSTER } from '../data/roster';
import { createAudioEngine } from '../audio';
import { grindEvents, harness, orbitListener, useBank } from '../audio/harness';
import type { MusicCue, Stinger, UiSound } from '../audio/types';
import { buildSpec } from '../sim/spec';
import { MockWorld } from './mock';

declare global {
  interface Window {
    __botboxAudio?: typeof harness;
  }
}
const audio = createAudioEngine();
const debug = () => audio.debug();
// Offline renders share the live bank so nothing is synthesized twice.
useBank(audio.debug().bank);
window.__botboxAudio = harness;

const css = `
#lab{position:fixed;inset:0;overflow:auto;padding:14px 18px 60px;font:13px/1.35 system-ui,sans-serif;color:#e8e8e8;background:#0b0d10;touch-action:auto;user-select:text}
#lab h1{font:800 20px system-ui;letter-spacing:.12em;margin:0 0 8px;color:#ffb21c}
#lab h2{font:700 12px system-ui;letter-spacing:.14em;text-transform:uppercase;color:#8fb6ff;margin:16px 0 6px}
#lab button{background:#1b2028;color:#eee;border:1px solid #333b47;border-radius:3px;padding:5px 9px;margin:2px;font:12px system-ui;cursor:pointer}
#lab button:hover{background:#26303c}#lab button.on{background:#7a1b12;border-color:#d8401e}
#lab .row{display:flex;flex-wrap:wrap;align-items:center;gap:2px}
#lab table{border-collapse:collapse}#lab td{padding:1px 4px}#lab td:first-child{color:#9aa;min-width:80px}
#lab .stat{font:12px ui-monospace,monospace;color:#9fd29f;white-space:pre}
#lab label{margin-right:12px}
#lab input[type=range]{vertical-align:middle;width:120px}
#lab .voice{max-height:260px;overflow:auto;border:1px solid #2a313b;padding:4px;margin-top:4px}
#lab .voice div{cursor:pointer;padding:2px 4px}#lab .voice div:hover{background:#1d2530}
#lab .voice b{color:#ffb21c;font-weight:600;margin-right:6px}
#lab canvas{background:#111418;border:1px solid #2a313b}
#lab .cap{color:#ffe08a;min-height:18px}
`;

const root = document.createElement('div');
root.id = 'lab';
document.body.append(Object.assign(document.createElement('style'), { textContent: css }), root);
// Any tap unlocks (Chrome on Android grants audio on pointerup, not pointerdown).
for (const ev of ['pointerup', 'touchend', 'click', 'keydown']) window.addEventListener(ev, () => audio.unlock(), { capture: true });

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), attrs);
  e.append(...kids);
  return e;
}
function button(label: string, fn: () => void): HTMLButtonElement {
  return h('button', { onclick: fn }, label);
}
function section(title: string, ...kids: Node[]): void {
  root.append(h('h2', {}, title), ...kids);
}

root.append(h('h1', {}, 'BOTBOX AUDIO LAB'), h('div', { className: 'cap' }, 'Tap anything to start audio.'));
const status = h('div', { className: 'stat' });
root.append(status);

// ---- volumes
const vol = { master: 1, music: 0.8, sfx: 1, voice: 1 };
const volRow = h('div', { className: 'row' });
for (const k of Object.keys(vol) as (keyof typeof vol)[]) {
  const r = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: String(vol[k]) });
  r.oninput = () => {
    vol[k] = Number(r.value);
    audio.setVolumes(vol);
  };
  volRow.append(h('label', {}, `${k} `, r));
}
audio.setVolumes(vol);
section('Volumes', volRow);

// ---- music
const cues: MusicCue[] = ['title', 'menu', 'pits', 'intro', 'fight', 'victory', 'defeat', 'bumper', 'nut', 'none'];
const fadeSel = h('select');
for (const f of ['0', '0.5', '1', '2', '4']) fadeSel.append(h('option', { value: f, selected: f === '1' }, `fade ${f}s`));
const cueRow = h('div', { className: 'row' });
const cueButtons = new Map<MusicCue, HTMLButtonElement>();
for (const c of cues) {
  const b = button(c, () => {
    audio.unlock();
    audio.music(c, Number(fadeSel.value));
    for (const [k, x] of cueButtons) x.classList.toggle('on', k === c && c !== 'none');
  });
  cueButtons.set(c, b);
  cueRow.append(b);
}
cueRow.append(fadeSel);
section('Music', cueRow);

// ---- stingers and UI
const stingers: Stinger[] = ['logo', 'whoosh', 'lights', 'go', 'ko', 'time', 'decision', 'replay', 'stamp', 'crowd_roar'];
section('Stingers', h('div', { className: 'row' }, ...stingers.map((s) => button(s, () => audio.stinger(s)))));
const uis: UiSound[] = ['move', 'select', 'back', 'error', 'buy', 'repair', 'tick', 'type'];
section('UI', h('div', { className: 'row' }, ...uis.map((u) => button(u, () => audio.ui(u)))));

// ---- world one-shots go through frame() with a still world
function fire(events: MatchEvent[]): void {
  audio.unlock();
  const w = mock ? lastFrame : still();
  audio.frame(w, events, listenerAt(performance.now() / 1000), 0);
}
function still() {
  return { t: 0, bots: [], debris: [], hazards: [], match: { phase: 'fight' as const, clock: 100, lights: 4 as const, timeScale: 1 } };
}
const at = { x: 0, y: 0.2, z: 0 };

const kinds: HitKind[] = ['spinner', 'ram', 'axe', 'flip', 'lift', 'wall', 'spikestrip', 'killsaw', 'pulverizer', 'ramrod', 'floor'];
const mats: ArmorMaterialId[] = ['steel', 'aluminum', 'titanium', 'uhmw', 'polycarb'];
const energies: [string, number][] = [
  ['light', 300],
  ['solid', 3000],
  ['huge', 18000],
];
const tbl = h('table');
tbl.append(h('tr', {}, h('td', {}, ''), ...mats.map((m) => h('td', {}, m))));
for (const kind of kinds) {
  const tr = h('tr', {}, h('td', {}, kind));
  for (const material of mats)
    tr.append(
      h(
        'td',
        {},
        ...energies.map(([label, energy]) =>
          button(label[0].toUpperCase(), () =>
            fire([{ type: 'hit', t: 0, kind, attacker: null, victim: 'v', point: at, dir: { x: 1, y: 0, z: 0 }, energy, facet: 'front', damage: 10, severity: Math.min(1, energy / 12000), material }]),
          ),
        ),
      ),
    );
  tbl.append(tr);
}
section('Impacts (kind x material, L / S / H energy)', tbl);

const hz = (hazard: string, kind: 'killsaw' | 'pulverizer' | 'ramrod', action: 'warn' | 'strike' | 'retract') => () => fire([{ type: 'hazard', t: 0, hazard, kind, action, target: null }]);
section(
  'Hazards',
  h(
    'div',
    { className: 'row' },
    button('saw warn', hz('saw-w-1', 'killsaw', 'warn')),
    button('saw rise', hz('saw-w-1', 'killsaw', 'strike')),
    button('saw bite', () => fire([{ type: 'hit', t: 0, kind: 'killsaw', attacker: null, victim: 'v', point: at, dir: { x: 0, y: 1, z: 0 }, energy: 4000, facet: 'belly', damage: 20, severity: 0.5, material: 'aluminum' }])),
    button('pulverizer warn', hz('pulv-nw', 'pulverizer', 'warn')),
    button('pulverizer swing', hz('pulv-nw', 'pulverizer', 'strike')),
    button('pulverizer slam', () => {
      audio.unlock();
      const l = listenerAt(performance.now() / 1000);
      const w = still();
      audio.frame({ ...w, hazards: [{ id: 'pulv-nw', kind: 'pulverizer', state: 0, spin: 0, warn: false }] }, [], l, 0);
      audio.frame({ ...w, hazards: [{ id: 'pulv-nw', kind: 'pulverizer', state: 1, spin: 0, warn: false }] }, [], l, 0);
    }),
    button('pulverizer retract', hz('pulv-nw', 'pulverizer', 'retract')),
    button('ramrods', hz('ram-n', 'ramrod', 'strike')),
    button('ramrods retract', hz('ram-n', 'ramrod', 'retract')),
  ),
);

const evb = (label: string, e: MatchEvent) => button(label, () => fire([e]));
section(
  'Weapons and damage',
  h(
    'div',
    { className: 'row' },
    evb('flipper', { type: 'weapon_fire', t: 0, bot: 'x', kind: 'flipper' }),
    evb('axe', { type: 'weapon_fire', t: 0, bot: 'x', kind: 'axe' }),
    evb('lifter', { type: 'weapon_fire', t: 0, bot: 'x', kind: 'lifter' }),
    evb('srimech', { type: 'weapon_fire', t: 0, bot: 'x', kind: 'srimech' }),
    evb('spin-up relay', { type: 'weapon_arm', t: 0, bot: 'x', on: true }),
    evb('landed', { type: 'landed', t: 0, bot: 'x', speed: 6 }),
    evb('panel off', { type: 'panel_off', t: 0, bot: 'x', facet: 'left', debris: 1 }),
    evb('wheel off', { type: 'wheel_off', t: 0, bot: 'x', index: 0, debris: 1 }),
    evb('shrapnel', { type: 'shrapnel', t: 0, bot: 'x', point: at, dir: { x: 1, y: 0, z: 0 }, count: 8, material: 'titanium' }),
    evb('smoke', { type: 'smoke_start', t: 0, bot: 'x' }),
    evb('fire', { type: 'fire_start', t: 0, bot: 'x' }),
    evb('component down', { type: 'component_down', t: 0, bot: 'x', component: 'weapon' }),
    button('grind 1 s', () => {
      const t0 = performance.now();
      const id = setInterval(() => {
        fire([{ type: 'grind', t: 0, point: at, dir: { x: 1, y: 0, z: 0 }, intensity: 0.8, material: 'steel' }]);
        if (performance.now() - t0 > 1000) clearInterval(id);
      }, 33);
    }),
  ),
);

// ---- crowd
const crowdR = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: '0' });
crowdR.oninput = () => audio.crowd(Number(crowdR.value));
section('Crowd', h('div', { className: 'row' }, h('label', {}, 'scripted level ', crowdR), button('roar', () => audio.stinger('crowd_roar'))));

// ---- mock fight
let mock: MockWorld | null = null;
let lastFrame = still() as ReturnType<MockWorld['step']>['frame'];
let orbit = true;
let slow = false;
let raf = 0;
const pickA = h('select');
const pickB = h('select');
for (const r of ROSTER) {
  pickA.append(h('option', { value: r.id, selected: r.id === 'megahurtz' }, `${r.card.name} (${r.loadout.cls} ${r.loadout.weapon}, ${r.loadout.drive})`));
  pickB.append(h('option', { value: r.id, selected: r.id === 'tax-audit' }, `${r.card.name} (${r.loadout.cls} ${r.loadout.weapon}, ${r.loadout.drive})`));
}
const view = h('canvas', { width: 220, height: 220 });
const fightBtn = button('start mock fight', () => (mock ? stopFight() : startFight()));
const worldBtn = button('world on', () => {
  worldOn = !worldOn;
  audio.setWorldActive(worldOn);
  worldBtn.textContent = worldOn ? 'world on' : 'world off';
});
let worldOn = true;
const slowBtn = button('slow motion', () => {
  slow = !slow;
  audio.setTimeScale(slow ? 0.25 : 1);
  slowBtn.classList.toggle('on', slow);
});
const orbitBtn = button('camera orbit', () => {
  orbit = !orbit;
  orbitBtn.classList.toggle('on', orbit);
});
orbitBtn.classList.add('on');
section('Mock fight', h('div', { className: 'row' }, pickA, h('span', {}, ' vs '), pickB), h('div', { className: 'row' }, fightBtn, worldBtn, slowBtn, orbitBtn), view);

function listenerAt(t: number) {
  return orbit ? orbitListener(t) : { pos: { x: 0, y: 6, z: 12 }, quat: { x: -0.22, y: 0, z: 0, w: 0.975 } };
}

function startFight(): void {
  audio.unlock();
  const specs = [pickA.value, pickB.value].map((id, i) => {
    const r = ROSTER.find((x) => x.id === id)!;
    return { id: i === 0 ? r.id : `${r.id}#2`, spec: buildSpec(r.loadout) };
  });
  audio.setEntrants(specs);
  mock = new MockWorld(specs, { seed: Math.floor(Math.random() * 1000), countdown: 4, clashEvery: 2.2 });
  audio.music('fight', 1);
  for (const [k, x] of cueButtons) x.classList.toggle('on', k === 'fight');
  fightBtn.textContent = 'stop mock fight';
  let last = performance.now();
  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!mock) return;
    const { frame, events } = mock.step(dt * (slow ? 0.25 : 1));
    lastFrame = frame;
    const ev = [...events, ...grindEvents(frame, frame.t)];
    const f0 = performance.now();
    audio.frame(frame, ev, listenerAt(now / 1000), dt);
    frameCost = frameCost * 0.95 + (performance.now() - f0) * 0.05;
    for (const e of ev) if (e.type !== 'clock' && e.type !== 'grind') log(e);
    draw(frame, listenerAt(now / 1000));
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}
function stopFight(): void {
  cancelAnimationFrame(raf);
  mock = null;
  audio.setEntrants([]);
  audio.music('none', 1);
  fightBtn.textContent = 'start mock fight';
}
let frameCost = 0;
const evLog: string[] = [];
function log(e: MatchEvent): void {
  evLog.unshift(e.type === 'hit' ? `hit ${e.kind} ${Math.round(e.energy)} J ${e.material}` : e.type);
  evLog.length = Math.min(evLog.length, 6);
}

function draw(f: ReturnType<MockWorld['step']>['frame'], l: ReturnType<typeof listenerAt>): void {
  const g = view.getContext('2d')!;
  const s = 220 / 30;
  g.clearRect(0, 0, 220, 220);
  g.strokeStyle = '#555';
  g.strokeRect(110 - 7.3 * s, 110 - 7.3 * s, 14.6 * s, 14.6 * s);
  for (const b of f.bots) {
    g.fillStyle = b.id.includes('#') ? '#3a7bff' : '#ff3a2a';
    g.beginPath();
    g.arc(110 + b.pos.x * s, 110 + b.pos.z * s, 5, 0, 7);
    g.fill();
  }
  g.fillStyle = '#ffd34a';
  g.beginPath();
  g.arc(110 + l.pos.x * s, 110 + l.pos.z * s, 4, 0, 7);
  g.fill();
}

// ---- voice browser
const voiceList = h('div', { className: 'voice' });
const caption = h('div', { className: 'cap' });
const filter = h('input', { placeholder: 'filter ids', type: 'search' });
const interrupt = h('input', { type: 'checkbox', checked: true });
const voiceRow = h('div', { className: 'row' }, filter, h('label', {}, interrupt, ' interrupt'), button('stop', () => audio.stopVoice()));
section('Voice', voiceRow, caption, voiceList);
function renderVoices(): void {
  const ids = audio.voiceIds();
  voiceList.innerHTML = '';
  if (!ids.length) {
    voiceList.append(h('div', {}, 'No voice manifest yet (public/voice/manifest.json). voice() resolves false until it lands.'));
    return;
  }
  const q = filter.value.trim().toLowerCase();
  for (const id of ids.filter((x) => x.includes(q)).slice(0, 400)) {
    const line = audio.voiceLine(id)!;
    const d = h('div', {}, h('b', {}, id), `${line.speaker}: ${line.text}`);
    d.onclick = () => {
      audio.unlock();
      caption.textContent = `${line.speaker}: ${line.text}`;
      void audio.voice(id, { interrupt: interrupt.checked }).then((ok) => {
        caption.textContent = `${ok ? 'done' : 'skipped'}: ${id}`;
      });
    };
    voiceList.append(d);
  }
}
filter.oninput = renderVoices;
void audio.manifest.ready.then(renderVoices);
renderVoices();

// ---- status
setInterval(() => {
  const { core, bank, ctx } = debug();
  const pos = core?.music.position();
  status.textContent = [
    `context ${ctx?.state ?? 'not created'}${ctx ? ` @ ${ctx.sampleRate} Hz, base latency ${(ctx.baseLatency * 1000).toFixed(0)} ms` : ''}`,
    `bank ${bank.rendered} rendered of ${bank.ids().length} defined, ${(bank.bytes() / 1048576).toFixed(1)} MB, ${bank.renderSeconds.toFixed(1)} s render time`,
    `music ${pos?.cue ?? 'none'} ${pos ? pos.t.toFixed(1) + ' s' + (pos.loop ? ' (loop)' : '') : ''}`,
    `world one-shots ${core?.world.oneshotCount() ?? 0}, nodes about ${core?.world.nodeCount() ?? 0}, stolen ${core?.world.stats.stolen ?? 0}, frame() ${frameCost.toFixed(3)} ms`,
    `crowd excitement ${(core?.world.crowd.excitement ?? 0).toFixed(2)}   voice ${audio.voiceBusy() ? 'busy' : 'idle'}`,
    `events: ${evLog.join(' | ')}`,
  ].join('\n');
}, 200);
