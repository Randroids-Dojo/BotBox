// End-to-end campaign run: plays the career through the real UI like a player. Fights run on
// autopilot (the player's robot driven by the AI); everything else (the guided rebuild, the
// workshop, the store, repairs, rewards, the ladder, side gigs, the slot picker) is clicked.
// Logs every screen, caption, prompt and banner change with a timestamp, page errors, the
// career save after each fight, and screenshots each new screen.
//
// npx tsx scripts/qa/campaign-e2e.ts '<url>' <minutes> <outdir> [mobile|portrait]
// Fresh first launch: 'http://localhost:5240/?autopilot&speed=4'
// Jump in: '...&career=8' (starts at fight 8 in slot 1)
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { chromium, devices, type Page } from 'playwright-core';

const url = process.argv[2] ?? 'http://localhost:5240/?autopilot&speed=4';
const minutes = Number(process.argv[3] ?? 30);
const out = process.argv[4] ?? '/tmp/e2e';
const mode = process.argv[5] ?? '';
mkdirSync(out, { recursive: true });
const logFile = `${out}/log.txt`;
writeFileSync(logFile, '');
const t0 = Date.now();
const ts = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(7);
const log = (s: string) => {
  const line = `${ts()}s ${s}`;
  appendFileSync(logFile, line + '\n');
  console.log(line);
};

const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext(
  mode === 'portrait'
    ? { ...devices['Pixel 7'], viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 }
    : mode === 'mobile'
      ? { ...devices['Pixel 7'], viewport: { width: 915, height: 412 }, deviceScaleFactor: 2 }
      : { viewport: { width: 1280, height: 720 } },
);
const p: Page = await ctx.newPage();
p.on('pageerror', (e) => log(`PAGEERROR ${e.message} ${(e.stack ?? '').split('\n').slice(1, 3).join(' | ')}`));
p.on('crash', () => log('PAGECRASH renderer crashed'));
p.on('framenavigated', (f) => { if (f === p.mainFrame()) log(`NAVIGATED ${f.url()}`); });
// Lost GL contexts and memory, for reloads and freezes nobody asked for.
await p.addInitScript(() => {
  addEventListener('webglcontextlost', () => console.warn('WEBGL context lost'), true);
  setInterval(() => {
    const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    if (m) console.warn(`HEAP ${(m.usedJSHeapSize / 1e6).toFixed(0)} MB`);
  }, 60000);
});
p.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') log(`CONSOLE.${m.type()} ${m.text().slice(0, 240)}`);
});
await p.goto(url);
await p.waitForSelector('.title-screen', { timeout: 60000 });

const touch = mode === 'portrait' || mode === 'mobile';
const click = async (sel: string, label = sel) => {
  const l = p.locator(sel).first();
  if (!(await l.count())) return false;
  try {
    if (touch) await l.tap({ timeout: 3000 });
    else await l.click({ timeout: 3000 });
    log(`CLICK ${label}`);
    return true;
  } catch (e) {
    log(`CLICK-FAIL ${label}: ${(e as Error).message.split('\n')[0]}`);
    return false;
  }
};
const clickText = async (scope: string, re: RegExp, label: string) => {
  const l = p.locator(scope).getByText(re).first();
  if (!(await l.count())) return false;
  try {
    if (touch) await l.tap({ timeout: 3000 });
    else await l.click({ timeout: 3000 });
    log(`CLICK ${label}`);
    return true;
  } catch {
    return false;
  }
};
const press = async (k: string) => {
  log(`PRESS ${k}`);
  await p.keyboard.press(k);
};

interface State {
  screen: string;
  cap: string;
  coach: string;
  banner: string;
  slate: string;
  l3: string;
  story: string;
  mont: string;
  bars: boolean;
  phase: string;
  career: { funds: number; rank: number | null; next: number; w: number; l: number; rebuilt: boolean; damaged: boolean } | null;
  rig: string;
}
const state = async (): Promise<State> =>
  JSON.parse(
    await p.evaluate(`JSON.stringify((() => {
      const q = (sel) => { const e = document.querySelector(sel); return e ? e.textContent.trim().replace(/\\s+/g, ' ').slice(0, 140) : ''; };
      const scr = [...document.querySelectorAll('.screen')].map((e) => [...e.classList].filter((c) => c !== 'screen' && c !== 'out').join('.')).join('+');
      const g = window.botbox.game;
      const c = g.save.career;
      let damaged = false;
      if (c && c.damage) damaged = Object.values(c.damage.facets).some((v) => v < 0.95) || Object.values(c.damage.parts).some((v) => v < 0.95);
      return {
        screen: (document.querySelector('.title-screen') ? 'title ' : '') + scr,
        cap: q('.caption'), coach: q('.coach-t'), banner: q('.banner'), slate: q('.slate'), l3: q('.l3-name'), story: q('.story'), mont: q('.mt'),
        bars: !!document.querySelector('.lbox.on'),
        phase: g.current ? g.current.phase : '-',
        career: c ? { funds: c.funds, rank: c.rank, next: c.next, w: c.w, l: c.l, rebuilt: c.rebuilt, damaged } : null,
        rig: window.botbox.stage.cams.rigName,
      };
    })())`),
  );

// Parts to buy, in order, when the store has them and there is money to spare.
const WANT: { tab: string; key: string }[] = [
  { tab: 'armor', key: 'armor:uhmw' },
  { tab: 'extras', key: 'extra:wheelguards' },
  { tab: 'weapon', key: 'weapon:vdisk' },
  { tab: 'power', key: 'power:nicad' },
  { tab: 'drive', key: 'drive:chair4' },
  { tab: 'armor', key: 'armor:steel' },
  { tab: 'armor', key: 'armor:titanium' },
  { tab: 'power', key: 'power:nimh' },
];
const bought = new Set<string>();

async function shop(): Promise<void> {
  await p.waitForTimeout(800);
  // Repairs first when damaged.
  if (await clickText('.garage', /fix the worst first/i, 'Fix the worst first')) await p.waitForTimeout(500);
  for (const w of WANT) {
    if (bought.has(w.key)) continue;
    await click(`.garage [data-key="tab:${w.tab}"]`, `tab ${w.tab}`);
    await p.waitForTimeout(400);
    const row = p.locator(`.garage [data-key="${w.key}"]`).first();
    if (!(await row.count())) continue;
    const cls = (await row.getAttribute('class', { timeout: 2000 }).catch(() => '')) ?? '';
    if (/s-owned/.test(cls)) {
      bought.add(w.key);
      continue;
    }
    if (!/s-buy/.test(cls)) continue; // locked or short of money
    await click(`.garage [data-key="${w.key}"]`, `part ${w.key}`);
    await p.waitForTimeout(500);
    if (await p.locator('.gp-confirm').count()) {
      await click('.gp-confirm .btn.primary', `buy ${w.key}`);
      await p.waitForTimeout(500);
      bought.add(w.key);
      log(`BOUGHT ${w.key}`);
    }
    break; // one purchase per visit, so the run spreads them out
  }
  await p.screenshot({ path: `${out}/shop-${Date.now() - t0}.png` });
  const warn = await p.evaluate(`(document.querySelector('.gp-warn') || {}).textContent || ''`);
  if (warn) log(`GARAGE-WARN ${warn}`);
  if (!(await clickText('.garage .gp-foot', /^\s*done\s*$/i, 'Done'))) {
    log('Done unavailable; going back');
    await clickText('.garage .gp-foot', /^\s*back\s*$/i, 'Back');
  }
}

let last = '';
let lastChange = Date.now();
let lastScreen = '';
let shots = 0;
let workshopVisits = 0;
let actedOn = '';
let actedAt = 0;
let fightsSeen = 0;
let lastFightPhase = '-';
const deadline = t0 + minutes * 60_000;
while (Date.now() < deadline) {
  let s: State;
  try {
    s = await state();
  } catch (e) {
    log(`STATE-FAIL ${(e as Error).message.split('\n')[0]}`);
    await p.waitForTimeout(1000);
    continue;
  }
  const line = `screen=${s.screen} phase=${s.phase} rig=${s.rig} bars=${s.bars} | cap="${s.cap}" coach="${s.coach}" banner="${s.banner}" slate="${s.slate}" l3="${s.l3}" story="${s.story}" mont="${s.mont.slice(0, 60)}"`;
  if (line !== last) {
    log(line);
    last = line;
    lastChange = Date.now();
  }
  if (s.screen !== lastScreen) {
    lastScreen = s.screen;
    await p.screenshot({ path: `${out}/${String(shots++).padStart(3, '0')}-${(s.screen || 'live').replace(/[^a-z0-9.+-]/gi, '_').slice(0, 40)}.png` });
  }
  if (s.phase === 'over' && lastFightPhase === 'fight') {
    fightsSeen++;
    log(`FIGHT-OVER #${fightsSeen}`);
  }
  lastFightPhase = s.phase;
  if (Date.now() - lastChange > 60_000) {
    log('STUCK no change for 60 s');
    await p.screenshot({ path: `${out}/stuck-${shots++}.png` });
    await press('Enter');
    lastChange = Date.now();
  }

  // ---- react to the screen like a player
  const scr = s.screen;
  if (!scr.includes('workshop') && actedOn === 'workshop') actedOn = '';
  if (scr.startsWith('title')) {
    if (touch) await click('.title-screen', 'title');
    else await press('Enter');
  } else if (scr.includes('main-menu')) {
    await click('.mm-career', 'Career');
  } else if (scr.includes('saves')) {
    if (!(await clickText('.saves', /^\s*continue\s*$/i, 'Continue slot'))) await clickText('.saves', /^\s*new game\s*$/i, 'New game slot');
  } else if (scr.includes('garage') && scr.includes('guided')) {
    // Fill each empty slot with the first option, then Done.
    // The screen can close between reads: never wait on it.
    const info = await p.evaluate(`(() => { const d = document.querySelector('.garage .gp-foot .btn.primary'); const c = document.querySelector('.gp-coach'); return { disabled: !d || d.classList.contains('is-disabled'), coach: c ? c.textContent : '' }; })()`) as { disabled: boolean; coach: string };
    if (!info.disabled) await clickText('.garage .gp-foot', /^\s*done\s*$/i, 'Done (rebuild)');
    else await press('Enter');
  } else if (scr.includes('garage')) {
    actedOn = 'garage';
    await shop();
  } else if (scr.includes('workshop') && (actedOn !== 'workshop' || Date.now() - actedAt > 6000)) {
    actedOn = 'workshop';
    actedAt = Date.now();
    await p.waitForTimeout(700);
    workshopVisits++;
    const c = s.career;
    log(`WORKSHOP visit ${workshopVisits}: ${JSON.stringify(c)}`);
    await p.waitForTimeout(600);
    if (workshopVisits % 5 === 2) {
      await clickText('.workshop', /^\s*career\s*$/i, 'Career ladder');
    } else if (c && (c.damaged || c.funds >= 250) && workshopVisits % 2 === 1) {
      await clickText('.workshop', /work on the robot/i, 'Work on the robot');
    } else if (c && c.l >= 2 && c.l % 2 === 0 && (await p.locator('.workshop').getByText(/side gig/i).count())) {
      await clickText('.workshop', /side gig/i, 'Side gig');
    } else {
      await click('.workshop .ws-go', 'Fight');
    }
  } else if (scr.includes('ladder')) {
    await p.waitForTimeout(1200);
    await press('Escape');
  } else if (scr.includes('rewards')) {
    await p.waitForTimeout(2500);
    await press('Enter');
    await p.waitForTimeout(600);
    if (await p.locator('.rewards').count()) await press('Enter');
  } else {
    // Decision cards, interviews, results, ceremony: anything waiting on Continue.
    const cont = p.locator('.screen .btn.primary:visible, .screen .btn:visible').filter({ hasText: /continue|next|ok/i }).first();
    if (s.phase !== 'fight' && (await cont.count())) {
      await p.waitForTimeout(1500);
      if (touch) await cont.tap().catch(() => {});
      else await cont.click().catch(() => {});
      log('CLICK continue');
    }
  }
  await p.waitForTimeout(250);
}
log(`END fights=${fightsSeen} workshopVisits=${workshopVisits}`);
const final = await state().catch(() => null);
log(`FINAL ${JSON.stringify(final?.career)}`);
await b.close();
