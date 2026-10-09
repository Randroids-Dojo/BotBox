// Renders public/icon.svg to the PNG icons: npx tsx scripts/icons.ts
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const svg = readFileSync('public/icon.svg', 'utf8');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const [name, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]] as const) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `public/${name}`, omitBackground: true });
  await page.close();
}
await browser.close();
console.log('icons written');
