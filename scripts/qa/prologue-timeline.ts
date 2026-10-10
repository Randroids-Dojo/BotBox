// The prologue as a player sees it: drives at Terminal Velocity with the keyboard like a person
// would, and logs every caption, coach prompt, banner, slate, lower third and camera shot as a
// timeline, with frames every `every` seconds into /tmp/pt-NN.png.
// npx tsx scripts/qa/prologue-timeline.ts [url] [seconds] [every]
import { chromium } from 'playwright-core';
const url = process.argv[2] ?? 'http://localhost:5240/';
const secs = Number(process.argv[3] ?? 95);
const every = Number(process.argv[4] ?? 2);
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(url);
await p.waitForSelector('.title-screen', { timeout: 40000 });
await p.keyboard.press('Enter');
const t0 = Date.now();
let last = '';
let shot = 0;
let nextShot = 0;
const held = new Set<string>();
const hold = async (k: string, on: boolean) => {
  if (on && !held.has(k)) { held.add(k); await p.keyboard.down(k); }
  if (!on && held.has(k)) { held.delete(k); await p.keyboard.up(k); }
};
let armed = false;
while (Date.now() - t0 < secs * 1000) {
  const t = (Date.now() - t0) / 1000;
  const s = JSON.parse(await p.evaluate(`JSON.stringify((() => {
    const q = (sel) => { const e = document.querySelector(sel); return e ? e.textContent.trim().replace(/\\s+/g, ' ') : ''; };
    const m = window.botbox.game.current;
    let drive = null;
    if (m && m.phase === 'fight') {
      const me = m.bot('player'), tv = m.bot('terminal-velocity');
      if (me && tv) {
        const q4 = me.quat; const fx = -(2 * (q4.x * q4.z + q4.w * q4.y)), fz = -(1 - 2 * (q4.x * q4.x + q4.y * q4.y));
        const want = Math.atan2(-(tv.pos.x - me.pos.x), -(tv.pos.z - me.pos.z)), have = Math.atan2(-fx, -fz);
        drive = { err: Math.atan2(Math.sin(want - have), Math.cos(want - have)), armed: me.armed, helpless: me.helpless };
      }
    }
    return { cap: q('.caption') || q('.cap'), coach: q('.coach-t'), banner: q('.banner'), slate: q('.slate'), l3: q('.lower-third .l3-name') || q('.l3-name'), story: q('.story'), montage: q('.mt-card') || q('.montage'), rig: window.botbox.stage.cams.rigName, phase: m ? m.phase : '-', drive };
  })())`));
  // Drive like a person: point at Terminal Velocity and go, spin up when told.
  if (s.drive && s.coach) {
    const e = s.drive.err;
    await hold('KeyA', e > 0.25);
    await hold('KeyD', e < -0.25);
    await hold('KeyW', Math.abs(e) < 1.2);
    if (/spin/i.test(s.coach) && !armed) { armed = true; await p.keyboard.press('Space'); }
    if (/self-right/i.test(s.coach)) await p.keyboard.press('KeyE');
  } else for (const k of [...held]) await hold(k, false);
  const line = `cap="${s.cap}" coach="${s.coach}" banner="${s.banner}" slate="${s.slate}" l3="${s.l3}" story="${s.story}" mont="${s.montage.slice(0, 50)}" rig=${s.rig} phase=${s.phase}`;
  if (line !== last) { console.log(`${t.toFixed(1).padStart(5)}s ${line}`); last = line; }
  if (t >= nextShot) { await p.screenshot({ path: `/tmp/pt-${String(shot++).padStart(2, '0')}.png` }); nextShot += every; }
  await p.waitForTimeout(120);
}
await b.close();
