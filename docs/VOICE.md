# Voice lines

All voice is recorded offline with ElevenLabs and shipped as MP3 in `public/voice/`. The game looks lines up by id in `public/voice/manifest.json`:

```json
{
  "version": 1,
  "lines": {
    "vic.red": { "file": "vic/red.mp3", "text": "In the red square...", "speaker": "Vic", "dur": 1.6 }
  }
}
```

`speaker` is one of `Vic`, `Dale`, `Chuck`, `Jenna`. `dur` is seconds. Numbered variants start at 1 (`chuck.huge.1`, `chuck.huge.2`, ...). The game picks a random variant of a category, so a category can have any number of variants, but every category below needs at least the minimum.

## Cast (original characters, original designed voices)

- **Vic Ramone**, the announcer. Booming, theatrical, a big arena voice, stretches the robot names.
- **Dale Pruitt**, the host and play-by-play. Dry, quick, sarcastic stand-up comedian.
- **Chuck "Cannon" Kowalski**, color commentary. Former pro quarterback, loud, earnest, football metaphors.
- **Jenna Rae**, pit reporter. Upbeat, fast, warm.

## Announcer (Vic)

| Id | Min | What |
| --- | --- | --- |
| `vic.open.N` | 3 | Show open: "From Treasure Island in San Francisco... this is BOTBOX!" |
| `vic.tonight.N` | 2 | Cold open tease: "Tonight on BotBox..." |
| `vic.class.light`, `.middle`, `.heavy`, `.super` | 1 each | "Heavyweight division!" |
| `vic.round.quarter`, `.semi`, `.final`, `.exhibition`, `.rumble` | 1 each | "Quarterfinal action!", "This... is the final!" |
| `vic.red`, `vic.blue`, `vic.green`, `vic.yellow` | 1 each | "In the red square..." / "And in the blue square..." |
| `vic.bot.<rivalId>` | 1 each | Intro body ending in the name: "From Sunnyvale, California, a two hundred pound vertical spinner... MEGAHURTZ!" Use each rival's hometown, class and weapon type from `src/data/roster.ts`. |
| `vic.name.<rivalId>` | 1 each | The name alone, shouted, for results: "MEGAHURTZ!" |
| `vic.player.<slug>` | 1 each | Player robot names from `VOICED_NAMES` in `src/data/roster.ts`, shouted. |
| `vic.player.intro.N` | 3 | Generic intro body for the player's robot that leads into the name: "A rookie team, straight out of the garage..." |
| `vic.player.rookie` | 1 | Fallback name call when the player's name is not voiced: "...the ROOKIE!" |
| `vic.ready` | 1 | "Builders, ready..." |
| `vic.go.N` | 3 | The start call on green. Original, punchy. Not anyone's real catchphrase. |
| `vic.count.1` ... `vic.count.10` | 1 each | Knockout count numbers. |
| `vic.ko.N` | 3 | "It's a KNOCKOUT!" |
| `vic.time` | 1 | "That's TIME!" |
| `vic.decision` | 1 | "Ladies and gentlemen, we go to the judges..." |
| `vic.byscore` | 1 | "By a score of..." |
| `vic.num.0` ... `vic.num.45` | 1 each | Numbers, read like a ring announcer. |
| `vic.to` | 1 | "to" |
| `vic.winner.N` | 2 | "Your winner..." |
| `vic.release` | 1 | "Release! Release!" |
| `vic.tapout` | 1 | "They've tapped out!" |
| `vic.lastbot` | 1 | Rumble: "The last robot moving..." |
| `vic.champion` | 1 | "Your BotBox champion, and the winner of the Giant Nut..." |

## Commentary (Dale and Chuck)

Ids are `dale.<category>.N` and `chuck.<category>.N`, at least 3 variants per speaker per category unless noted. Lines are reactions that make sense for any robot, so they never name one. Keep most under 3 seconds; the director drops lines that would land late.

| Category | When |
| --- | --- |
| `start` | The fight just started |
| `hit` | A solid hit |
| `huge` | A massive hit, a highlight |
| `flip` | A robot got flipped over |
| `airborne` | A robot launched into the air |
| `saw` | Killsaws got someone |
| `pulverizer` | The Pulverizer hammer hit someone |
| `ramrod` | Floor spikes jolted someone |
| `spikes` | Slammed into the spikestrip wall |
| `wall` | Slammed into the wall |
| `panel` | Armor panel ripped off |
| `wheel` | A wheel knocked off |
| `fire` | Robot on fire |
| `smoke` | Robot smoking |
| `weapondown` | A weapon has stopped |
| `drivedown` | Driving in circles, lost a drive side |
| `count` | Knockout count started |
| `ko` | Knockout |
| `righted` | Self-righted, back in it |
| `pin` | One robot pinning or carrying the other |
| `spinup` | A spinner winding up, that whine |
| `whiff` | A miss, a swing at nothing |
| `chase` | One robot running, the other chasing |
| `timelow` | 30 seconds left |
| `decision` | Going to the judges |
| `upset` | The underdog is winning |
| `idle` | Filler banter during a lull: robots, builders, the Box, the show (at least 6 each) |
| `intro` | Pre-fight chatter while robots are on their squares |
| `rookie` | About the player's rookie team |
| `desk` | Show open banter at the host desk |
| `bumper` | Going to a break: "We'll be right back" (Dale only, 3) |

## Pit reporter (Jenna)

| Id | Min | What |
| --- | --- | --- |
| `jenna.pits.N` | 3 | Pit segment open: "I'm down in the pits, where the rookie team is scrambling..." |
| `jenna.win.N` | 3 | Post-fight, player won: "I'm here with the winners. How does it feel?" |
| `jenna.lose.N` | 3 | Post-fight, player lost: "Tough loss. What happened out there?" |
| `jenna.final.N` | 2 | Before the final |
| `jenna.champ.N` | 2 | After winning the Giant Nut |

## Career (see docs/CAMPAIGN.md)

The player's robot is JUGGERNAUT (the name call `vic.player.juggernaut` already exists). Robots are "it", never "he" or "she".

| Id | Min | Speaker | What |
| --- | --- | --- | --- |
| `vic.bot.<id>`, `vic.name.<id>` | 1 each | Vic | Intros and name calls for the new robots in `src/data/campaign.ts`: doorstop, trash-panda, lawn-dart, buzz-off, chop-suey, terminal-velocity. Terminal Velocity's intro should feel like the arrival of the villain. |
| `vic.pro.open` | 1 | Vic | Prologue open, over a packed house: forty-five seconds left in the championship final, the champion is rolling. |
| `vic.pro.ko.1`, `vic.pro.ko.2` | 1 each | Vic | Played in order, not picked at random. `.1` the champion goes down: "It's over!" `.2` "A new champion... TERMINAL VELOCITY!" |
| `vic.player.comeback.N` | 3 | Vic | Intro bodies for the rebuilt Juggernaut, leading into its name: a fallen champion clawing back from the scrap heap. |
| `vic.act.regionals`, `vic.act.show`, `vic.act.championship` | 1 each | Vic | Act openers: the regional broadcast, prime time on BotBox, the championship. |
| `vic.final.open` | 1 | Vic | The rematch: the robot that fell against the robot that broke it. |
| `vic.comeback` | 1 | Vic | After the final win: the comeback is complete. |
| `dale.pro.taste.N`, `chuck.pro.taste.N` | 3 each | Dale, Chuck | Prologue, while the champion dominates: seconds from a fourth straight Giant Nut (lines stay count-free). |
| `dale.pro.turn.N`, `chuck.pro.turn.N` | 2 each | Dale, Chuck | Prologue: something is wrong, Terminal Velocity's bar is screaming up to speed. |
| `dale.pro.down.N`, `chuck.pro.down.N` | 2 each | Dale, Chuck | Prologue: the champion is launched and goes down. Shock. |
| `jenna.fall.N` | 4 | Jenna | Montage, TV news style, played in order: 1 crashes out in the first round; 2 sponsors pull out; 3 falls out of the rankings; 4 the team sells the disk. |
| `dale.fall.N`, `chuck.fall.N` | 3 each | Dale, Chuck | Montage: wry and sad reactions to Juggernaut losing again and again. |
| `dale.comeback.N`, `chuck.comeback.N` | 4 each | Dale, Chuck | During Regionals and later fights when Juggernaut lands something big: the old champ still has it. |
| `jenna.comeback.N` | 3 | Jenna | Post-win interview openers during the climb. |
| `jenna.rematch` | 1 | Jenna | Before the final: the rematch everyone wanted. |
