// Record the first-launch prologue on an Android phone (adb forward tcp:9222
// localabstract:chrome_devtools_remote first). Clears this origin's career slots so the
// prologue plays, taps PRESS START, and records the phone's screen.
// npx tsx scripts/qa/device-prologue.ts '<url>' <out.mp4> [seconds]
import { execFileSync, spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
const url = process.argv[2];
const out = process.argv[3] ?? '/tmp/device.mp4';
const secs = Number(process.argv[4] ?? 100);
const adb = (...a: string[]) => execFileSync('adb', a, { encoding: 'utf8' });
const browser = await chromium.connectOverCDP('http://localhost:9222');
const origin = new URL(url).origin;
let page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith(origin));
if (!page) {
  adb('shell', 'am', 'start', '--user', '0', '-a', 'android.intent.action.VIEW', '-d', url, 'com.android.chrome');
  for (let i = 0; i < 30 && !page; i++) {
    await new Promise((r) => setTimeout(r, 500));
    page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith(origin));
  }
}
if (!page) throw new Error('no tab for ' + origin);
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.evaluate(`(() => { const k = 'botbox:v1'; const d = JSON.parse(localStorage.getItem(k) || '{}'); d.slots = [null, null, null]; d.slot = 0; d.seenIntro = false; localStorage.setItem(k, JSON.stringify(d)); })()`);
await page.reload();
await page.bringToFront();
await page.waitForSelector('.title-screen', { timeout: 60000 });
const rec = spawn('adb', ['shell', 'screenrecord', '--bit-rate', '16000000', '--time-limit', String(Math.min(180, secs)), '/sdcard/bb-run.mp4']);
await page.waitForTimeout(2000);
const b = await page.locator('.title-screen').boundingBox();
await page.mouse.click(b!.x + b!.width / 2, b!.y + b!.height / 2);
console.log('started', new Date().toISOString());
await new Promise<void>((r) => rec.on('exit', () => r()));
console.log('gpu', await page.evaluate(`(() => { const g = window.botbox.stage.renderer.getContext(); const d = g.getExtension('WEBGL_debug_renderer_info'); return (d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER)) + ' quality ' + window.botbox.stage.getQuality() + ' dpr ' + devicePixelRatio; })()`));
adb('pull', '/sdcard/bb-run.mp4', out);
adb('shell', 'rm', '/sdcard/bb-run.mp4');
console.log('saved', out);
process.exit(0);
