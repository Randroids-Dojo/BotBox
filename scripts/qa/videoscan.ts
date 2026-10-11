// Scan a screen recording frame by frame for (a) magenta or cyan pixels from ?nan mode and
// (b) small dark squares that flash for a frame or two. Streams frames, so long recordings are
// fine. A phone's portrait screen recorded into a landscape canvas: pass the crop.
// npx tsx scripts/qa/videoscan.ts <video> [scaleWidth] [crop w:h:x:y]
import { spawn, execFileSync } from 'node:child_process';
const file = process.argv[2];
const crop = process.argv[4];
const [vw, vh] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim().split(',').map(Number);
const cw = crop ? Number(crop.split(':')[0]) : vw;
const ch = crop ? Number(crop.split(':')[1]) : vh;
const W = Number(process.argv[3] ?? cw);
const H = Math.round((W * ch) / cw / 2) * 2;
const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }));
const vf = `${crop ? `crop=${crop},` : ''}scale=${W}:${H}:flags=area,format=rgb24`;
const ff = spawn('ffmpeg', ['-v', 'error', '-i', file, '-vf', vf, '-f', 'rawvideo', '-']);
const FS = W * H * 3;
let pending: Buffer = Buffer.alloc(0);
let f = 0;
let magFrames = 0;
const mag: string[] = [];
const dark: string[] = [];
const lumOf = (fr: Uint8Array) => {
  const l = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) l[i] = 0.2126 * fr[i * 3] + 0.7152 * fr[i * 3 + 1] + 0.0722 * fr[i * 3 + 2];
  return l;
};
const lums: Float32Array[] = [];
function frame(buf: Uint8Array) {
  let m = 0, c = 0, minx = W, miny = H, maxx = 0, maxy = 0;
  for (let i = 0; i < W * H; i++) {
    const r = buf[i * 3], g = buf[i * 3 + 1], b = buf[i * 3 + 2];
    const isM = r > 170 && b > 170 && g < 100;
    const isC = r < 100 && g > 170 && b > 170;
    if (isM || isC) {
      if (isM) m++; else c++;
      const x = i % W, y = (i / W) | 0;
      minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y);
    }
  }
  if (m + c >= 4) { magFrames++; if (mag.length < (process.env.FULL ? 1e6 : 30)) mag.push(`f${f} magenta ${m} cyan ${c} box ${minx},${miny}-${maxx},${maxy}`); }
  lums.push(lumOf(buf));
  if (lums.length > 5) lums.shift();
  // Check the middle of the last five frames.
  if (lums.length === 5) {
    const [a, b2, v, d, e] = lums;
    const mark = new Uint8Array(W * H);
    let any = 0;
    for (let i = 0; i < W * H; i++) {
      if (v[i] > 12) continue;
      if (Math.min(a[i], b2[i]) - v[i] > 40 && Math.min(d[i], e[i]) - v[i] > 40) { mark[i] = 1; any++; }
    }
    if (any >= 8) {
      const seen = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) {
        if (!mark[i] || seen[i]) continue;
        const st = [i]; seen[i] = 1;
        let x0 = W, y0 = H, x1 = 0, y1 = 0, cnt = 0;
        while (st.length) { const j = st.pop()!; const x = j % W, y = (j / W) | 0; cnt++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); for (const k of [j - 1, j + 1, j - W, j + W]) if (k >= 0 && k < W * H && mark[k] && !seen[k]) { seen[k] = 1; st.push(k); } }
        const w = x1 - x0 + 1, h = y1 - y0 + 1;
        if (cnt >= 8 && w <= W / 3 && h <= H / 3 && w / h > 0.33 && w / h < 3 && cnt / (w * h) > 0.5) dark.push(`f${f - 2} dark box ${x0},${y0} ${w}x${h} fill ${(cnt / (w * h)).toFixed(2)}`);
      }
    }
  }
  f++;
}
ff.stdout.on('data', (chunk: Buffer) => {
  pending = pending.length ? Buffer.concat([pending, chunk]) : Buffer.from(chunk);
  while (pending.length >= FS) {
    frame(pending.subarray(0, FS));
    pending = pending.subarray(FS);
  }
});
await new Promise<void>((r) => ff.on('close', () => r()));
const fps = f / dur;
const t = (s: string) => s.replace(/^f(\d+)/, (_, n) => `f${n} t=${(Number(n) / fps).toFixed(2)}s`);
console.log(`${file}: ${f} frames at ${fps.toFixed(1)} fps, scanned at ${W}x${H}${crop ? ` (crop ${crop})` : ''}`);
console.log(`frames with magenta/cyan: ${magFrames}`);
for (const l of mag) console.log('  ' + t(l));
console.log(`compact flashing dark squares: ${dark.length}`);
for (const l of dark.slice(0, process.env.FULL ? dark.length : 40)) console.log('  ' + t(l));
