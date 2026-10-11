// Black squares: read the WebGL frame back after every render and count frames holding a solid
// black block (one NaN pixel smeared by bloom leaves a square about 128 px across). Works on the
// game (window.botbox) and the lab (window.__lab).
// npx tsx scripts/qa/blacksquares.ts '<url>' <seconds>
//   e.g. 'http://localhost:5240/?lab=arena&hideui=1&q=high' 30   (target: 0 square-sized hits)
import { chromium } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5240/?lab=arena&hideui=1&q=high';
const secs = Number(process.argv[3] ?? 30);
const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
p.on('console', (m) => {
  const t = m.text();
  if (t.startsWith('SQ')) console.log(t);
});
await p.goto(url);
await p.waitForTimeout(4000);
await p.evaluate(`(() => {
  const st = (window.__lab || window.botbox).stage;
  const gl = st.renderer.getContext();
  const orig = st.render.bind(st);
  let n = 0;
  window.__sq = { frames: 0, squares: 0 };
  st.render = (...a) => {
    orig(...a);
    n++;
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const px = new Uint8Array(W * H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
    // 16 px tiles that are exactly black. Vignetted corners can do that too, so only a block of
    // 30 or more counts as a square.
    let tiles = 0, minx = 1e9, miny = 1e9, maxx = -1, maxy = -1;
    for (let ty = 0; ty + 16 <= H; ty += 16) for (let tx = 0; tx + 16 <= W; tx += 16) {
      let all = true;
      for (let y = ty; y < ty + 16 && all; y += 3) for (let x = tx; x < tx + 16; x += 3) {
        const i = (y * W + x) * 4;
        if (px[i] || px[i + 1] || px[i + 2]) { all = false; break; }
      }
      if (all) { tiles++; minx = Math.min(minx, tx); maxx = Math.max(maxx, tx + 16); miny = Math.min(miny, H - ty - 16); maxy = Math.max(maxy, H - ty); }
    }
    window.__sq.frames++;
    if (tiles >= 30) {
      window.__sq.squares++;
      console.log('SQ frame ' + n + ' tiles ' + tiles + ' box ' + [minx, miny, maxx, maxy].join(','));
    }
  };
})()`);
await p.waitForTimeout(secs * 1000);
const r = (await p.evaluate('window.__sq')) as { frames: number; squares: number };
console.log(`${r.squares} frames with a black square out of ${r.frames}`);
await b.close();
process.exit(0);
