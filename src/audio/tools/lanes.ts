// Per-lane levels of a cue, rendered solo through the real music bus.
//   npx tsx src/audio/tools/lanes.ts <cue> [lane ...]
import { chromium } from 'playwright-core';

const [cue = 'title', ...pick] = process.argv.slice(2);
const lanes = pick.length ? pick : ['gtrL', 'gtrR', 'bass', 'kick', 'snare', 'hat', 'cym', 'tom', 'lead', 'arp', 'clean', 'stab', 'pad', 'fx'];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto(process.env.URL ?? 'http://localhost:5243/?lab=audio');
await page.waitForFunction(() => !!window.__botboxAudio);
for (const lane of lanes) {
  const r = await page.evaluate(([c, l, s]) => window.__botboxAudio!.renderCue(c as never, s, { solo: [l] }), [cue, lane, Number(process.env.SECS ?? 16)] as const);
  if (r.stats.peakDb > -100) console.log(`${cue} ${lane.padEnd(6)} rms ${r.stats.rmsDb.toFixed(1).padStart(6)}  peak ${r.stats.peakDb.toFixed(1).padStart(6)}`);
}
await browser.close();
