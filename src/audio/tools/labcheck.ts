// Drives the live lab page in headless Chrome: clicks through music, stingers and impacts, runs
// the mock fight in a real-time AudioContext and reports renderer CPU, the lab's status readout
// and console errors. Writes a screenshot.
//
//   npx tsx src/audio/tools/labcheck.ts

import { chromium } from 'playwright-core';

const URL = process.env.URL ?? 'http://localhost:5243/?lab=audio';
const OUT = process.env.OUT ?? '/tmp/botbox-audio';

const browser = await chromium.launch({ channel: process.env.CHANNEL ?? 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
const errors: string[] = [];
page.on('console', (m) => {
  if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('404')) errors.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(URL);
await page.waitForSelector('#lab button');
const cdp = await browser.newBrowserCDPSession();

async function rendererCpu(): Promise<number> {
  const info = (await cdp.send('SystemInfo.getProcessInfo')) as { processInfo: { type: string; id: number; cpuTime: number }[] };
  return info.processInfo.filter((p) => p.type === 'renderer').reduce((s, p) => s + p.cpuTime, 0);
}
const status = () => page.$eval('#lab .stat', (e) => e.textContent ?? '');
const click = (label: string) => page.getByRole('button', { name: label, exact: true }).first().click();

await click('title');
await page.waitForTimeout(3000);
console.log('after title:\n' + (await status()));

for (const s of ['logo', 'whoosh', 'lights', 'go', 'ko', 'decision', 'replay', 'stamp']) {
  await click(s);
  await page.waitForTimeout(250);
}
for (const u of ['move', 'select', 'back', 'error', 'buy', 'repair', 'tick', 'type']) {
  await click(u);
  await page.waitForTimeout(80);
}
// A row of impact buttons (S and H for a few materials).
const hits = page.locator('#lab table button');
console.log(`impact buttons: ${await hits.count()}`);
for (let i = 0; i < 30; i += 4) {
  await hits.nth(i).click();
  await page.waitForTimeout(60);
}

await click('none');
await page.waitForTimeout(1500);
let c0 = await rendererCpu();
let w0 = Date.now();
await page.waitForTimeout(8000);
const idle = (await rendererCpu()) - c0;
const idleWall = (Date.now() - w0) / 1000;

await click('start mock fight');
await page.waitForTimeout(6000);
c0 = await rendererCpu();
w0 = Date.now();
await page.waitForTimeout(15000);
const fight = (await rendererCpu()) - c0;
const fightWall = (Date.now() - w0) / 1000;
console.log('\nduring mock fight:\n' + (await status()));
await page.screenshot({ path: `${OUT}/lab.png`, fullPage: false });
await click('slow motion');
await page.waitForTimeout(2000);
await click('slow motion');
await click('stop mock fight');

console.log(`\nrenderer CPU: idle page ${((idle / idleWall) * 100).toFixed(1)}% of a core, mock fight with music ${((fight / fightWall) * 100).toFixed(1)}% of a core`);
console.log(`screenshot ${OUT}/lab.png`);
if (errors.length) console.log(`\n${errors.length} console messages:\n  ` + [...new Set(errors)].slice(0, 20).join('\n  '));
await browser.close();
