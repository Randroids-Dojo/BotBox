// Drive the game in Chrome on an Android phone over adb + DevTools (adb forward tcp:9222
// localabstract:chrome_devtools_remote first). Opens the URL in the existing tab, sits on the
// title, then Quick fight on autopilot, while the phone records its own screen.
// npx tsx scripts/qa/device-run.ts '<url with ?autopilot>' <out.mp4> [titleSec] [fightSec]
import { execFileSync, spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
const url = process.argv[2];
const out = process.argv[3] ?? '/tmp/device.mp4';
const titleSec = Number(process.argv[4] ?? 15);
const fightSec = Number(process.argv[5] ?? 60);
const adb = (...a: string[]) => execFileSync('adb', a, { encoding: 'utf8' });
const browser = await chromium.connectOverCDP('http://localhost:9222');
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('botbox-game'));
if (!page) throw new Error('no botbox tab');
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[page]', m.text().slice(0, 200)); });
await page.goto(url);
await page.bringToFront();
await page.waitForSelector('.title-screen', { timeout: 60000 });
const total = Math.ceil(titleSec + fightSec + 25);
const rec = spawn('adb', ['shell', 'screenrecord', '--bit-rate', '16000000', '--time-limit', String(Math.min(180, total)), '/sdcard/bb-run.mp4']);
await page.waitForTimeout(titleSec * 1000);
const tap = async (sel: string | RegExp) => {
  const l = typeof sel === 'string' ? page.locator(sel) : page.getByText(sel).first();
  const b = await l.boundingBox();
  if (!b) throw new Error(`not found ${sel}`);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
};
await tap('.title-screen');
await page.waitForTimeout(2500);
await tap(/^\s*quick fight\s*$/i);
await page.waitForTimeout(2000);
await tap(/^\s*flapjack\s*$/i);
await page.waitForTimeout(500);
await tap(/^\s*fight\s*$/i);
console.log('fight started', new Date().toISOString());
await page.waitForTimeout(fightSec * 1000);
console.log('stats', await page.evaluate(`JSON.stringify({ q: window.botbox.stage.getQuality(), dpr: devicePixelRatio, w: innerWidth, h: innerHeight, gl: (() => { const g = window.botbox.stage.renderer.getContext(); const d = g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); })() })`));
await new Promise<void>((r) => rec.on('exit', () => r()));
adb('pull', '/sdcard/bb-run.mp4', out);
adb('shell', 'rm', '/sdcard/bb-run.mp4');
console.log('saved', out);
await browser.close().catch(() => {});
