// Offline renders of the music cues, the effects tour and a mock fight through the real engine
// in headless Chrome, with measurements, and WAVs for listening.
//
//   PORT=5243 npm run dev                          (another terminal)
//   npx tsx src/audio/tools/render.ts [cues|fight|tour|keys|xfade|all] [--no-wav]
//
// Writes to /tmp/botbox-audio (OUT=... to change). Analyze with tools/analyze.py.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const what = new Set(args.filter((a) => !a.startsWith('--')));
if (!what.size || what.has('all')) for (const w of ['cues', 'fight', 'tour', 'keys', 'xfade']) what.add(w);
const wav = !args.includes('--no-wav');
const URL = process.env.URL ?? 'http://localhost:5243/?lab=audio';
const OUT = process.env.OUT ?? '/tmp/botbox-audio';
mkdirSync(join(OUT, 'keys'), { recursive: true });

const browser = await chromium.launch({ channel: process.env.CHANNEL ?? 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const errors: string[] = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(URL);
await page.waitForFunction(() => !!window.__botboxAudio, null, { timeout: 30000 });

const fmt = (x: number, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
const report: Record<string, unknown> = {};
type Stats = { peakDb: number; rmsDb: number; dc: number; clipped: number; stMin: number; stMax: number; longestGap: number };
const line = (name: string, s: Stats, ms: number, extra = '') =>
  console.log(
    `  ${name.padEnd(26)} peak ${fmt(s.peakDb).padStart(6)}  rms ${fmt(s.rmsDb).padStart(6)}  st ${fmt(s.stMin)}..${fmt(s.stMax)}  gap ${fmt(s.longestGap)}s  clip ${s.clipped}  dc ${s.dc.toExponential(1)}  ${fmt(ms / 1000)}s${extra}`,
  );
const save = (name: string, b64?: string) => b64 && writeFileSync(join(OUT, name), Buffer.from(b64, 'base64'));

const t0 = Date.now();
const info = await page.evaluate(() => window.__botboxAudio!.bankInfo());
console.log(`bank: ${info.ids} sounds, ${(info.bytes / 1048576).toFixed(1)} MB, render ${info.renderSeconds.toFixed(1)} s cpu, ${((Date.now() - t0) / 1000).toFixed(1)} s wall`);
report.bank = info;

if (what.has('cues')) {
  console.log('\nmusic cues');
  const cues = ['title', 'menu', 'pits', 'intro', 'fight', 'victory', 'defeat', 'bumper', 'nut'] as const;
  const r: Record<string, unknown> = {};
  for (const cue of cues) {
    const secs = cue === 'bumper' ? 8 : cue === 'victory' || cue === 'defeat' ? 24 : 45;
    const res = await page.evaluate(([c, s, w]) => window.__botboxAudio!.renderCue(c, s, { wav: w }), [cue, secs, wav] as const);
    save(`music-${cue}.wav`, res.wav);
    line(cue, res.stats, res.ms);
    r[cue] = res.stats;
  }
  report.cues = r;
}

if (what.has('grid')) {
  console.log('\ngrid (solo lanes)');
  for (const [cue, lanes] of [
    ['fight', ['kick']],
    ['fight', ['gtrL']],
    ['title', ['snare']],
    ['pits', ['kick', 'snare']],
  ] as const) {
    const res = await page.evaluate(([c, l]) => window.__botboxAudio!.renderCue(c, 12, { wav: true, solo: [...l] }), [cue, lanes] as const);
    save(`grid-${cue}-${lanes.join('+')}.wav`, res.wav);
    line(`${cue} ${lanes.join('+')}`, res.stats, res.ms);
  }
}

if (what.has('xfade')) {
  console.log('\ncrossfades');
  for (const [a, b, fade] of [
    ['title', 'menu', 2],
    ['intro', 'fight', 0.5],
    ['fight', 'victory', 0.3],
    ['fight', 'none', 2],
  ] as const) {
    const res = await page.evaluate(([a, b, f, w]) => window.__botboxAudio!.renderCue(a, 20, { wav: w, then: { at: 10, cue: b, fade: f } }), [a, b, fade, wav] as const);
    save(`xfade-${a}-${b}.wav`, res.wav);
    line(`${a} -> ${b} (${fade}s)`, res.stats, res.ms);
  }
}

if (what.has('fight')) {
  console.log('\nmock fight');
  const res = await page.evaluate((w) => window.__botboxAudio!.renderFight(60, { wav: w }), wav);
  save('mock-fight.wav', res.wav);
  line('fight 60s', res.stats, res.ms, `  ${JSON.stringify(res.info)}`);
  report.fight = res;
  const slow = await page.evaluate((w) => window.__botboxAudio!.renderFight(30, { wav: w, bots: ['homewrecker', 'flapjack'], seed: 3, slowmo: [14, 20] }), wav);
  save('mock-fight-shell-vs-flipper-slowmo.wav', slow.wav);
  line('shell vs flipper 30s', slow.stats, slow.ms, `  ${JSON.stringify(slow.info)}`);
  const dry = await page.evaluate((w) => window.__botboxAudio!.renderFight(30, { wav: w, music: false, bots: ['megahurtz', 'tax-audit'] }), wav);
  save('mock-fight-no-music.wav', dry.wav);
  line('fight no music 30s', dry.stats, dry.ms);
}

if (what.has('layers')) {
  console.log('\nfight layers (30 s, no music)');
  for (const [name, o] of [
    ['crowd only', { crowd: true, robots: false, events: false }],
    ['robots only', { crowd: false, robots: true, events: false }],
    ['events only', { crowd: false, robots: false, events: true }],
    ['world, no crowd', { crowd: false, robots: true, events: true }],
    ['crowd reacting', { crowd: true, robots: true, worldMute: true }],
    ['hits only', { crowd: false, robots: false, only: ['hit', 'shrapnel', 'panel_off'], hazards: false }],
    ['hazards only', { crowd: false, robots: false, only: ['hazard'] }],
    ['grind only', { crowd: false, robots: false, only: ['grind'], hazards: false }],
    ['weapons only', { crowd: false, robots: false, only: ['weapon_fire', 'weapon_arm'], hazards: false }],
    ['countdown only', { crowd: false, robots: false, only: ['lights', 'fight_start'], hazards: false }],
  ] as const) {
    const res = await page.evaluate(([opts, w]) => window.__botboxAudio!.renderFight(30, { ...opts, music: false, wav: w }), [o, wav] as const);
    save(`layer-${name.replace(/[ ,]+/g, '-')}.wav`, res.wav);
    line(name, res.stats, res.ms);
  }
}

if (what.has('tour')) {
  console.log('\neffects tour');
  const res = await page.evaluate((w) => window.__botboxAudio!.renderTour({ wav: w }), wav);
  save('sfx-tour.wav', res.wav);
  writeFileSync(join(OUT, 'sfx-tour-cues.txt'), res.cues.map((c) => `${c.t.toFixed(2)}\t${c.what}\t${c.peakDb.toFixed(1)}\t${c.rmsDb.toFixed(1)}`).join('\n'));
  for (const c of res.cues) console.log(`  ${c.what.padEnd(34)} peak ${fmt(c.peakDb).padStart(6)}  rms ${fmt(c.rmsDb).padStart(6)}`);
  line('tour', res.stats, res.ms);
  report.tour = res.cues;
}

if (what.has('keys')) {
  const keys = ['m.gtrM.38.0', 'm.gtrO.38.0', 'm.gtrO.41.1', 'm.crO.38.0', 'm.lead.69.0', 'm.bassM.26.0', 'm.kick.0.0', 'm.snare.0.0', 'm.crash.0.0', 'm.stab.Dm.0', 'ring.steel.0', 'ring.titanium.0', 'ring.aluminum.0', 'ring.uhmw.0', 'ring.polycarb.0', 'tr.crack.0', 'crowd.murmur', 'crowd.roar', 'crowd.cheer'];
  for (const k of keys) {
    const r = await page.evaluate((key) => window.__botboxAudio!.renderKey(key), k);
    save(`keys/${k}.wav`, r.wav);
  }
  console.log(`\nwrote ${keys.length} sample WAVs to ${OUT}/keys`);
}

writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 1));
console.log(`\nwrote ${OUT}`);
if (errors.length) {
  console.log(`\n${errors.length} console messages:`);
  for (const e of [...new Set(errors)].slice(0, 30)) console.log('  ' + e);
}
await browser.close();
