// Bad pixel hunt: run with ?nan in the URL (the sanitize pass paints NaN magenta and overflow
// cyan) and count those pixels per frame. npx tsx scripts/qa/badpixels.ts '<url with &nan>' <seconds> [mobile]
import { chromium, devices } from 'playwright-core';
const url = process.argv[2] ?? 'http://localhost:5240/?autopilot&nan';
const secs = Number(process.argv[3] ?? 30);
const mobile = process.argv[4] === 'mobile';
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const size = mobile ? { width: 915, height: 412 } : { width: 1280, height: 720 };
const ctx = await b.newContext(mobile ? { ...devices['Pixel 7'], viewport: size, deviceScaleFactor: 1 } : { viewport: size });
const p = await ctx.newPage();
p.on('console', (m) => { const t = m.text(); if (t.startsWith('BAD') || m.type() === 'error') console.log(t.slice(0, 400)); });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto(url);
await p.waitForSelector('.title-screen', { timeout: 40000 });
await p.evaluate(`(() => {
  const st = window.botbox.stage;
  const r = st.renderer;
  const gl = r.getContext();
  const orig = st.render.bind(st);
  let n = 0, shots = 0;
  window.__nan = { frames: 0, bad: 0 };
  st.render = (w, e, dt) => {
    orig(w, e, dt);
    n++;
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const px = new Uint8Array(W * H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let mag = 0, cyan = 0, yel = 0, minx = 1e9, miny = 1e9, maxx = 0, maxy = 0;
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * 4, R = px[i], G = px[i + 1], Bc = px[i + 2];
      let hit = false;
      if (R > 200 && G < 60 && Bc > 200) { mag++; hit = true; }
      else if (R < 60 && G > 200 && Bc > 200) { cyan++; hit = true; }
      if (hit) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, H - y); maxy = Math.max(maxy, H - y); }
    }
    window.__nan.frames++;
    if (mag + cyan > 0) {
      window.__nan.bad++;
      console.log('BAD frame ' + n + ' scene ' + st.sceneId + ' nan ' + mag + ' inf ' + cyan + ' box ' + [minx, miny, maxx, maxy].join(','));
    }
  };
})()`);
if (mobile) await p.locator('.title-screen').tap();
else { await p.keyboard.press('Enter'); await p.waitForTimeout(1000); await p.keyboard.press('Enter'); }
await p.waitForTimeout(secs * 1000);
console.log('summary', await p.evaluate('JSON.stringify(window.__nan)'));
await b.close();
