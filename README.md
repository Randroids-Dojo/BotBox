# BOTBOX

Robot combat, Season 2001. A browser game that plays like an episode of a turn-of-the-millennium cable robot combat show: build a robot under the weight limit, roll it into the Box, survive the killsaws and the Pulverizers, and fight a three-round bracket for the Giant Nut.

- Real rigid-body fights (Rapier): spinners store and dump kinetic energy, wedges get under, flippers launch, axes punch through top armor.
- Tactical hardware: chassis, drive, batteries, weapons, armor materials and extras under a hard weight limit, with repairs and refits between fights.
- The whole broadcast: cold open, title, robot intros with stat cards, the light tree, commentary, instant replay, judges' decisions, pit interviews.

Everything is original: the show, its hosts and every robot are made up.

Play: https://botbox-game.vercel.app (every push to `main` deploys; open copies offer a refresh when a new release is live).

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Drive | WASD or arrows | Left stick (tank mode: both sticks) | Left thumbstick |
| Weapon | Space | RT or A | WEAPON |
| Self-right | E | B | RIGHT |
| Camera | C | Y | CAM |
| Pause, tap out | Esc or P | Start | Pause button |

## Develop

```bash
npm install
npm run dev        # http://localhost:5240
npm test
npm run build
```

Module workbenches: `?lab=arena`, `?lab=bots`, `?lab=audio`, `?lab=ui`.

Testing hooks: `?autopilot` lets the AI drive your robot, `?speed=4` runs fights faster. `npx tsx scripts/simfight.ts [rivalA rivalB]` runs headless fights for physics tuning. Voice lines are generated with `scripts/voice/generate.py` (see `docs/VOICE.md`).

Docs: `docs/DESIGN.md` (the show bible), `docs/ARCHITECTURE.md`, `docs/VOICE.md`.
