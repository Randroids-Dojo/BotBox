# Architecture

TypeScript, Vite, three.js (WebGL2) with pmndrs `postprocessing` and `n8ao`, Rapier 3D (`@dimforge/rapier3d-compat`) for physics, Web Audio for all sound, DOM for the broadcast UI. Static site on Vercel.

## Modules and owners

| Path | What | Owner |
| --- | --- | --- |
| `src/contract.ts` | Shared types: loadouts, specs, frames, events, results | lead |
| `src/render/types.ts`, `src/audio/types.ts`, `src/ui/types.ts` | Module interfaces | lead |
| `src/data/` | Parts catalog, roster, arena layout | lead |
| `src/sim/` | Rapier world, robots, drive, weapons, damage, hazards, rules, judges, AI. `spec.ts` turns a Loadout into a BotSpec | lead |
| `src/game/` | Director: episode flow, season, bracket, saves, commentary, replays, frame loop | lead |
| `src/input/` | Keyboard, gamepad, touch | lead |
| `src/render/stage.ts`, `src/render/arena/`, `src/render/camera/`, `src/render/post/`, `src/render/scenes/` | Renderer, post, the Box, crowd, lights, hazards, cameras and TV director, title, garage and trophy scenes | arena agent |
| `src/render/bots/`, `src/render/fx/`, `src/render/props/` | Robot meshes and visual damage, sparks, smoke, fire, debris, Giant Nut | bots agent |
| `src/audio/` | Procedural sfx, music, voice playback and mix | audio agent |
| `src/ui/` | Broadcast graphics, menus, garage UI, HUD, touch controls | UI agent |
| `public/voice/`, `scripts/voice/` | Recorded voice lines and the script that generates them | voice agent |
| `src/dev/` | Mock world (lead) and one lab page per module (`lab-<name>.ts`, owned by that module's agent) | shared |

A module agent edits only its own paths plus its own `src/dev/lab-<name>.ts`. Contracts change only through the lead.

## Data flow

```
Input ──DriveCommand──▶ Sim (fixed 120 Hz, Rapier) ──WorldFrame + MatchEvent[]──▶ Director
                                                                                   │
                       ┌───────────────────────────┬───────────────────────────────┤
                       ▼                           ▼                               ▼
                 Stage.render()              Audio.frame()              UI.hudFrame(), captions
                 (bots, fx, debris,          (motors, impacts,          Commentary picks voice
                  cameras)                    crowd, music, voice)       lines from events
```

- The sim is the only source of truth. It knows nothing about three.js, the DOM or audio.
- Renderers and audio read `WorldFrame` and react to `MatchEvent`. They never change sim state.
- `BotSpec` (from `src/sim/spec.ts`) is shared, so colliders and meshes line up.
- Replays: the director records `WorldFrame` and events each frame in a ring buffer and plays them back through `Stage.render` with replay camera shots. Anything the renderer shows must be derivable from frames and events.

## Frames

- World: meters, +Y up, floor at y = 0, arena center at the origin, +X east, +Z south (toward the driver stations).
- Robot: forward is -Z, right is +X, up is +Y. Origin at the footprint center on the belly plane.
- Yaw: radians about +Y; yaw 0 faces -Z (north). Positive yaw turns left (counter-clockwise from above).

## Labs

`npm run dev`, then `http://localhost:5240/?lab=<name>`. Each module has a workbench that runs it alone against `src/dev/mock.ts`:

- `?lab=arena`: the Box, lighting, post, hazards, cameras, scenes, with mock robots.
- `?lab=bots`: every roster robot on turntables, damage and debris tests, fx triggers.
- `?lab=audio`: buttons for every sound, a mock fight for the world mix, voice browser.
- `?lab=ui`: every screen and broadcast element with fake data.

## Performance budget

- Desktop high: 60 fps at 1440p on an Apple M-series laptop.
- Phone (Pixel 8 Pro): 60 fps target at `medium`, never below 30 at `low`.
- Physics: 120 Hz fixed step, at most 4 robots, at most 24 live debris bodies.
- Draw calls in a fight: under 400 on high. Instance the crowd, spikes and bolts.
