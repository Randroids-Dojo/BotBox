# AGENTS.md

Rules for any coding agent working on BotBox.

## Product

A robot combat game that plays like an episode of a turn-of-the-millennium cable robot combat show. The player builds a robot under a weight limit and fights a three-round bracket in the Box for the Giant Nut. Top quality 3D, visceral physical hits, tactical hardware. Read `docs/DESIGN.md` and `docs/ARCHITECTURE.md` before changing anything.

## Rules

1. **No em dashes or en dashes.** Not in code, comments, copy, commits or PRs. Use a period, comma, colon or parentheses.
2. **Commit messages and PR descriptions read as written by a human.** No AI attribution, no generated-by footers, no co-author lines.
3. **Everything is original.** No real show names, logos, hosts, judges or robots. Evoke the era, never copy it. Real places and generic hardware names (NiCad, wheelchair motor, AR400) are fine.
4. **The sim is the truth.** `src/sim` never touches three.js, the DOM or Web Audio, and render, audio and UI never change sim state. Everything they show comes from `WorldFrame` and `MatchEvent`.
5. **Contracts are owned by the lead.** `src/contract.ts`, `src/*/types.ts` and `src/data/` change only through the lead. Module agents stay inside their own paths (see `docs/ARCHITECTURE.md`).
6. **Every input path.** Keyboard, gamepad and touch must each be able to play a whole season and drive every menu.
7. **Phones count.** The game must hold 30 fps or better on a Pixel 8 Pro at `low` and look good there.
8. **Copy is short and punchy**, in the show's voice. Sentence case in menus, caps fine on broadcast graphics.
9. Never commit `.env*` files or print secrets.
10. One headless browser at a time on this Mac, and close it when done. Check `uptime` before heavy runs.

## Commands

```bash
npm run dev          # Vite on :5240 (PORT=xxxx to change)
npm run typecheck
npm test
npm run build
```

## QA before calling it done

Screenshots miss timing, audio and feel. These scripts measure them (dev server on :5240, one at a time):

```bash
npx tsx scripts/qa/voices.ts 'http://localhost:5240/?autopilot' 110          # every voice line: how much played, who cut it (target 0 cut)
npx tsx scripts/qa/voices.ts 'http://localhost:5240/?autopilot&career=8' 230 1 # same over a full prime-time fight
npx tsx scripts/qa/camera.ts 'http://localhost:5240/?autopilot&career=8' 60   # framing, swing speed, view against heading, cutaways
npx tsx scripts/qa/handling.ts                                                # acceleration, stopping, turn-in, overshoot per robot
npx tsx scripts/qa/prologue-flip.ts                                           # flipped in the prologue: prompt, assist, hit on contact
npx tsx scripts/qa/badpixels.ts 'http://localhost:5240/?autopilot&nan' 45     # NaN (magenta) and overflow (cyan) pixels per frame
npx tsx scripts/qa/ladder.ts 8 0.8                                            # career win rates per rung
```

Scripted scenes must survive a player doing the wrong thing (flipped, stuck, idle): test that, not just the happy path. `?nan` on a phone shows whether black squares come from bad pixels.

