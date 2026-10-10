// Voice cut-off audit: logs every voice line, how much of it played, and who cut it.
// npx tsx scripts/qa/voices.ts '<url>' <seconds> [extra Enter presses after start]
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://localhost:5240/?autopilot';
const secs = Number(process.argv[3] ?? 60);
const enters = Number(process.argv[4] ?? 0);
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(url);
await p.waitForSelector('.title-screen', { timeout: 40000 });
await p.keyboard.press('Enter');
await p.waitForTimeout(300);
await p.evaluate(`(() => {
  const eng = window.botbox.audio;
  const v = eng.core.voice;
  const ctx = eng.core.ctx || eng.ctx;
  const log = window.__vlog = [];
  const caller = () => (new Error().stack || '').split('\\n').slice(3, 9).map((s) => s.trim().replace(/https?:\\/\\/[^/]+\\//, '').replace(/\\?[^:)]*/, '')).filter((s) => !/voice\\.ts|audio\\/index/.test(s)).slice(0, 3).join(' < ');
  const oPlay = v.play.bind(v), oStop = v.stop.bind(v);
  let cur = null;
  v.play = (id, interrupt) => {
    const line = v.manifest.lines[id];
    if (v.cur && !interrupt) { log.push({ id, refused: true, by: v.cur.id, t: performance.now() }); return Promise.resolve(false); }
    if (v.cur && interrupt && cur) { cur.cutBy = 'interrupt ' + id + ' from ' + caller(); }
    const rec = { id, dur: line ? line.dur : 0, req: performance.now(), start: 0, end: 0, ok: null, cutBy: null, from: caller() };
    log.push(rec);
    const pr = oPlay(id, interrupt);
    const tok = v.token;
    const poll = setInterval(() => { if (v.cur && v.cur.token === tok && v.cur.src && !rec.start) { rec.start = performance.now(); clearInterval(poll); } if (!v.cur || v.cur.token !== tok) clearInterval(poll); }, 5);
    cur = rec;
    pr.then((ok) => { rec.ok = ok; rec.end = performance.now(); if (!rec.start) rec.start = rec.end; });
    return pr;
  };
  v.stop = () => { if (v.cur && cur && !cur.cutBy) cur.cutBy = 'stop from ' + caller(); return oStop(); };
})()`);
for (let i = 0; i < enters; i++) { await p.waitForTimeout(4000); await p.keyboard.press('Enter'); }
await p.waitForTimeout(secs * 1000);
const log = JSON.parse(await p.evaluate('JSON.stringify(window.__vlog)')) as { id: string; dur: number; req: number; start: number; end: number; ok: boolean | null; cutBy: string | null; refused?: boolean; by?: string; from?: string }[];
let played = 0, cut = 0, refused = 0;
for (const r of log) {
  if (r.refused) { refused++; console.log(`REFUSED ${r.id} (busy with ${r.by})`); continue; }
  if (!r.end) { console.log(`PLAYING ${r.id}`); continue; }
  played++;
  const heard = (r.end - r.start) / 1000;
  const frac = r.dur ? heard / r.dur : 1;
  const wait = (r.start - r.req) / 1000;
  if (frac < 0.92) { cut++; console.log(`CUT ${r.id} heard ${heard.toFixed(2)}/${r.dur.toFixed(2)}s (load ${wait.toFixed(2)}s) by ${r.cutBy}\n      asked from ${r.from}`); }
}
console.log(`\nlines ${played}, cut ${cut} (${((cut / Math.max(1, played)) * 100).toFixed(0)}%), refused ${refused}`);
await b.close();
