// Prologue scenario: no input from the player, flipped right after control starts. Checks the
// self-right prompt and assist, that control is never taken while upside down, and that the
// takeover hit lands on contact.
import { chromium } from 'playwright-core';
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto('http://localhost:5240/' + (process.argv[2] ?? ''));
await p.waitForSelector('.title-screen', { timeout: 40000 });
await p.keyboard.press('Enter');
await p.waitForFunction('window.botbox.game.current && window.botbox.game.current.phase === "fight"', null, { timeout: 30000, polling: 100 });
await p.waitForTimeout(1500);
const flip = process.argv[3] !== 'noflip';
if (flip) {
  await p.evaluate(`(() => { const m = window.botbox.game.current, me = m.bot('player'); const k = me.spec.massKg;
    const t = me.body.translation(); me.body.setTranslation({ x: t.x, y: t.y + 0.5, z: t.z }, true); me.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true); void k; })()`);
}
const t0 = Date.now();
let lastLine = '';
let hitLogged = false;
while (Date.now() - t0 < 45000) {
  const s = JSON.parse(await p.evaluate(`JSON.stringify((() => { const m = window.botbox.game.current; if (!m) return null; const me = m.bot('player'), tv = m.bot('terminal-velocity');
    const d = Math.hypot(me.pos.x - tv.pos.x, me.pos.z - tv.pos.z);
    const coach = document.querySelector('.coach-t'); return { phase: m.phase, helpless: me.helpless, inverted: me.inverted, dis: me.disabledReason, d: +d.toFixed(2), coach: coach ? coach.textContent : '', ai: m.ai.get('terminal-velocity').script, spin: +tv.spin01.toFixed(2) }; })())`));
  if (!s) break;
  const line = `${s.phase} helpless=${s.helpless} coach="${s.coach}" tv=${s.ai} dis=${s.dis}`;
  if (line !== lastLine) { console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${line} spin=${s.spin} d=${s.d}`); lastLine = line; }
  if (s.dis === 'radio' && !hitLogged) { hitLogged = true; console.log(`HIT at distance ${s.d}`); }
  if (s.phase === 'over') break;
  await p.waitForTimeout(100);
}
await b.close();
