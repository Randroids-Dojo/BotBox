// Gameplay camera metrics over a live autopilot fight: framing, swing speed, snaps, and how often
// the view disagrees with the robot's heading (tank controls feel backwards then).
// npx tsx scripts/qa/camera.ts '<url>' <seconds> [mobile]
import { chromium, devices } from 'playwright-core';
const url = process.argv[2] ?? 'http://localhost:5240/?autopilot&career=8';
const secs = Number(process.argv[3] ?? 60);
const mobile = process.argv[4] === 'mobile';
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const size = mobile ? { width: 915, height: 412 } : { width: 1280, height: 720 };
const ctx = await b.newContext(mobile ? { ...devices['Pixel 7'], viewport: size, deviceScaleFactor: 1 } : { viewport: size });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(url);
await p.waitForSelector('.title-screen', { timeout: 40000 });
if (mobile) await p.locator('.title-screen').tap(); else await p.keyboard.press('Enter');
await p.waitForTimeout(4000);
if (mobile) await p.getByText(/^\s*fight\s*$/i).first().tap(); else await p.keyboard.press('Enter');
await p.waitForFunction('window.botbox.game.current && window.botbox.game.current.phase === "fight"', null, { timeout: 90000, polling: 200 });
await p.evaluate(`(() => {
  const st = window.botbox.stage, cam = st.camera, orig = st.render.bind(st);
  const M = window.__cm = { n: 0, live: 0, offMe: 0, offFoe: 0, edgeMe: 0, misalign: 0, yawRates: [], snaps: 0, dists: [], shots: 0 };
  let prevYaw = null, prevT = performance.now();
  const v = { x: 0, y: 0, z: 0 };
  st.render = (w, e, dt) => {
    orig(w, e, dt);
    const now = performance.now(); const fdt = (now - prevT) / 1000; prevT = now;
    const g = window.botbox.game.current;
    if (!g || g.phase !== 'fight') { prevYaw = null; return; }
    M.n++;
    const rig = st.cams.rigName;
    if (rig.startsWith('shot:')) { M.shots++; prevYaw = null; return; }
    const me = w.bots.find((x) => x.id === 'player'); const foe = w.bots.find((x) => x.id !== 'player');
    if (!me || !foe) return;
    M.live++;
    const proj = (pt) => { const P = cam.position.clone().set(pt.x, pt.y + 0.2, pt.z).project(cam); return P; };
    const a = proj(me.pos), f = proj(foe.pos);
    const off = (P) => P.z > 1 || Math.abs(P.x) > 1 || Math.abs(P.y) > 1;
    if (off(a)) M.offMe++; else if (Math.abs(a.x) > 0.85 || Math.abs(a.y) > 0.85) M.edgeMe++;
    if (off(f)) M.offFoe++;
    const d = cam.getWorldDirection(cam.position.clone());
    const yaw = Math.atan2(-d.x, -d.z);
    const q = me.quat; const fx = -(2 * (q.x * q.z + q.w * q.y)), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const ryaw = Math.atan2(-fx, -fz);
    const mis = Math.abs(Math.atan2(Math.sin(yaw - ryaw), Math.cos(yaw - ryaw)));
    if (mis > Math.PI / 2) M.misalign++;
    if (prevYaw !== null && fdt > 0) {
      const dy = Math.abs(Math.atan2(Math.sin(yaw - prevYaw), Math.cos(yaw - prevYaw)));
      M.yawRates.push(dy / fdt * 180 / Math.PI);
      if (dy > 0.35) M.snaps++;
    }
    prevYaw = yaw;
    M.dists.push(cam.position.distanceTo(cam.position.clone().set(me.pos.x, me.pos.y, me.pos.z)));
  };
})()`);
await p.waitForTimeout(secs * 1000);
const M = JSON.parse(await p.evaluate('JSON.stringify(window.__cm)'));
const pct = (x: number) => `${((100 * x) / Math.max(1, M.live)).toFixed(1)}%`;
const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
const q = (a: number[], k: number) => sorted(a)[Math.floor((a.length - 1) * k)] ?? 0;
console.log(`frames ${M.n} live ${M.live} in-shot ${M.shots} (${((100 * M.shots) / Math.max(1, M.n)).toFixed(1)}% of fight time in cinematic cuts)`);
console.log(`player off-screen ${pct(M.offMe)}, near edge ${pct(M.edgeMe)}, opponent off-screen ${pct(M.offFoe)}`);
console.log(`view faces against robot heading (>90deg) ${pct(M.misalign)}`);
console.log(`camera yaw rate deg/s median ${q(M.yawRates, 0.5).toFixed(0)} p90 ${q(M.yawRates, 0.9).toFixed(0)} p99 ${q(M.yawRates, 0.99).toFixed(0)}; snaps (>20deg in a frame) ${M.snaps}`);
console.log(`camera distance median ${q(M.dists, 0.5).toFixed(1)} m, p10 ${q(M.dists, 0.1).toFixed(1)}, p90 ${q(M.dists, 0.9).toFixed(1)}`);
await b.close();
