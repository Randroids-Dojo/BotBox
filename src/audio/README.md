# BotBox audio

Everything is synthesized in the browser except the recorded voice lines. `createAudioEngine()` in
`index.ts` implements `AudioEngine` from `types.ts`.

## How it works

- **Sample bank (`bank.ts`).** Every effect, crowd texture, stinger, UI sound and music note is
  rendered once with an `OfflineAudioContext` (no user gesture needed, renders off the main thread)
  into an `AudioBuffer`. At runtime a hit is three or four buffer sources and a guitar chug is two,
  so the live graph stays small. The bank starts rendering when the engine is created; the title
  cue and UI sounds come first. Full warm-up is about 1.5 s of wall time on an M-series Mac and
  holds about 47 MB of buffers (music notes at 22 to 32 kHz, effects at 48 kHz, crowd at 24 kHz).
- **Robots (`robots.ts`).** One persistent voice per entrant from `setEntrants`: drive motor
  whine, gear mesh and brush noise with lash rattle (per drive type), spinner siren and "whoom"
  chopped at the tooth-pass rate, lifter gearmotor, fire and smoke loops. `frame()` only moves
  AudioParams.
- **World (`world.ts`).** Impacts are layered from the bank by kind (crack, clonk, thunk, clang,
  crunch), material ring (modal synthesis, plastics dull), sub thump and debris, scaled by energy
  and severity. Weapons, hazards, grinding, debris, damage and the crowd react to `MatchEvent`s.
  One-shot groups are capped at 16 (oldest stolen).
- **Music (`music/`).** `cues.ts` is the score in a small pattern notation (`score.ts`), compiled to
  timed note events and played from the bank with a lookahead scheduler. Cues crossfade.
- **Voice (`voice.ts`).** Manifest at `public/voice/manifest.json`, MP3s decoded on demand with a
  48-line LRU cache, one line at a time, ducking music 10 dB and crowd 6 dB. Vic goes through an
  arena PA hall and slap, Dale and Chuck stay dry in the booth, Jenna gets a small room.
- **Mix (`mixer.ts`).** Buses for world, crowd, music, voice and UI; master DC blocker, glue
  compressor, limiter and a soft safety clipper that never reaches full scale.

## Integration notes for the director

- Call `unlock()` from `pointerup`, `touchend`, `click` or `keydown` (Chrome on Android does not
  grant audio from `pointerdown` or `touchstart`). Calling it on every gesture is fine.
- `music(cue)` before unlock is remembered and starts on unlock. `stinger`, `ui` and `voice` before
  unlock are dropped (`voice` resolves false).
- `frame()` every rendered frame with the camera pose as the listener. The quaternion is the
  camera's world orientation in three.js convention (looks down -Z, +X is right).
- Arena events in `frame()` play their own stingers: `lights` for lamps 1 to 3, `go` for the green
  lamp or `fight_start`, `ko`, and `time` for `time_up`. A `stinger()` call with the same id within
  0.5 s is ignored, so calling both is harmless.
- `setWorldActive(false)` for menus and pause: motors, impacts, hazards and the crowd fade out and
  their subgraphs are detached so they cost nothing.
- `crowd(level)` sets a scripted excitement floor 0..1 (robot intros, the Giant Nut ceremony). It
  keeps the crowd audible even with the world inactive. `crowd(0)` hands the crowd back to the
  action. The crowd starts with the first `frame()` or a scripted level, never on the title screen.
- `setTimeScale(s)` is the slow-motion control (world pitch and low-pass). `WorldFrame.match.timeScale`
  is not read.
- `setVolumes` takes linear gains 0..1. UI sounds and stingers follow `sfx`.
- Latency: the music bus and master dynamics add a constant 18 ms; world sounds about 12 ms.

## Lab and tools

- `?lab=audio`: buttons for every stinger, UI sound, hazard, weapon and impact (kind x material x
  three energies), every music cue with a fade selector, a mock fight with two roster robots and an
  orbiting listener, slow motion, world on and off, crowd level, volume sliders and a voice browser.
- Offline renders through the real engine (headless Chrome), with a Vite server on :5243
  (`npx vite --config src/audio/tools/vite.audio.config.ts` has live reload off):
  - `npx tsx src/audio/tools/render.ts all voice cpu` writes WAVs and `report.json` to
    `/tmp/botbox-audio`.
  - `npx tsx src/audio/tools/lanes.ts <cue>` prints solo lane levels.
  - `npx tsx src/audio/tools/labcheck.ts` drives the live lab and reports renderer CPU.
  - `python3 src/audio/tools/analyze.py spectrum|onsets|seam|levels|dyn FILE ...` (numpy).
