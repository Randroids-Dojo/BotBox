# Career: the fall and the climb

BotBox opens on a story, not a menu. The first time you play you are the champion, in the last seconds of a final you are about to win. Then you lose everything. The game is the climb back.

## First launch

1. **Press start.** The title over the dark Box: logo and PRESS START, nothing else. It is the audio unlock.
2. **Prologue: the championship final, 0:45 left.** No menus, no intros. You are JUGGERNAUT, the three-time heavyweight champion going for a fourth Giant Nut, a titanium box with a 19 kJ vertical disk, rank #1. Both robots are already scuffed. The crowd is on its feet.
   - **Taste (about 15 seconds, you drive).** Short coach prompts teach the only three things you need: drive, spin up the disk, hit. The challenger, TERMINAL VELOCITY, mostly circles and lets you land a couple of big, satisfying hits. Commentary is ecstatic.
   - **Breakdown.** After the third hit Juggernaut's left drive burns out with the player still at the sticks: smoke pours out, it can only turn in circles, and the disk spins down and will not come back. The booth sees it before the player does ("Is the champ smoking?", "It can only go in circles!").
   - **Takeover.** The bars drop and the right side quits too: the champion sits dead in the water. Terminal Velocity lines up on its flank (the dead left side when there is room) and spins up, shot from behind its bar. It charges in from the side, the champion cannot turn to face it, and one hit in slow motion tears it apart: both wheels on that side sheared off, side and top armor gone, the disk ripped off its mount, and the wreck rolled onto its back. Pieces everywhere. The count. KNOCKOUT. A new champion.
3. **Montage: the fall.** About 45 seconds on old film (a faded warm print with grain, flicker, scratches and dust), a date typed on the top bar rolling forward month by month from November 1999 to March 2001. Four losses, each a different way to go down, each shot differently:
   - March 2000, Flapjack: flipped onto its back, the srimech fires and falls back, wheels spinning in the air.
   - August 2000, Snowplow: shoved sideways across the killsaws.
   - November 2000, Chop Suey at Regionals: an axe through the lid until the radio dies.
   - January 2001, Trash Panda in the garage league: rammed into the spikes, the battery catches fire, the team taps out.

   Between them the rankings slide (#1, #3, #11, #38, unranked) over the robot in the garage, more worn each time, the sponsors leave and the disk is sold. The choreography is in `src/game/deaths.ts`, on the sim alone, and `tests/prologue.test.ts` checks each death lands. `?fall` starts a first launch on the montage.
4. **"Spring 2001."** A rented storage unit in Oakland. A bare bulb. On the bench: what is left of Juggernaut, a bent frame and a box of scrap.
5. **Rebuild.** A guided first build: bolt on wheels (drive), wire a battery (power), hang some armor, keep the name. Only the scrap you own is available. Done unlocks your first fight.
6. **The workshop hub.** From now on this is home: your robot on the bench, your funds, your rank, and one big button for the next fight.

Returning players get the title, then a short menu: Career (to the workshop), Quick fight, Settings, Credits.

## The climb

One weight class (heavyweight). Four acts, thirteen fights. Each act raises the stakes, the presentation and the parts you can buy.

| Act | Venue and feel | Fights | Rank after | Prize per win | Store tier |
| --- | --- | --- | --- | --- | --- |
| I. The Scrapyard Circuit | Tuesday-night garage league in the Box. Half-empty stands, no TV, quick lights and go. | 4 | #52, #47, #43, #40 | $400 to $1,000 | 0: scrap and basics, wheel guards, a srimech |
| II. Regionals | Taped for the regional broadcast. Robot intros and lower thirds, the commentators pick you up. | 4 | #31, #24, #19, #16 | $1,500 to $2,600 | 1: real drive, NiCads, spinners, lifter, steel |
| III. The Show | BotBox proper: full broadcast, replays, interviews. | 4 | #11, #7, #4, #2 | $3,500 to $6,000 | 2: Magmotors, 6WD, NiMH, bars, flippers, axes, titanium |
| IV. The Championship | The rematch with Terminal Velocity for the Giant Nut and #1. | 1 | #1 | $25,000 | 3: everything |

Opponents:

- **Act I:** DOORSTOP (a slow wedge, your first and easiest fight), TRASH PANDA (spiked rammer), LAWN DART (a wobbly cheap vertical disk), BUZZ OFF (a fragile horizontal bar).
- **Act II:** HOMEWRECKER, CHOP SUEY (a new axe robot), UNDERTOW, SNOWPLOW.
- **Act III:** TAX AUDIT, GENERAL DISCONTENT, FLAPJACK, MEGAHURTZ.
- **Act IV:** TERMINAL VELOCITY.

Rivals get a little sharper the higher you climb. Lose and you can rematch as often as you like. Rank never drops.

## Money

- **Start:** $0 and the scrap of Juggernaut: box frame, 2WD drill motors, a sealed lead-acid pack, light aluminum armor, a front wedge plate and the self-righting arm nobody wanted to buy. No weapon (the disk went to pay the rent).
- **Earn:** prize money for every campaign win. Side gigs (repeatable grudge matches against a robot you have already beaten, from this act or the one before) pay a smaller purse, so a bad run never leaves you stuck.
- **Spend:**
  - Parts in the garage: every part shows its price, and you buy it the moment you fit it. Parts above your tier are visible but locked ("Unlocks at the Regionals").
  - Armor thickness is free once you own the material. Weight is the limit.
  - Repairs cost money per 10 percent restored on each panel or part ($4 in Act I, $8 in Act II, $15 in Act III and IV, `repairPer10` in `ACTS`). Anything below 60 percent gets a free patch job, so you can always field a working robot.
  - A lost campaign fight pays a 20 percent appearance fee. Together with the patch job, a loss costs about a fifth of the next purse to put right, not the whole bank (the end-to-end run found a player broke and losing in a loop at the old prices).
- **Balance, from AI-vs-AI ladders:** a srimech decides most early fights (the killsaws flip everything and a flipped box is counted out), so the scrap keeps its old one and Act I is winnable until Buzz Off, the act's wall. The Regionals want a spinner on chair motors with steel and a srimech; the regional versions of Homewrecker and Undertow run aluminum and lead-acid (`tweak` in `FIGHTS`). Prime Juggernaut against Terminal Velocity is close to a coin flip.

## Fight presentation by act

| | Act I | Act II | Act III and IV |
| --- | --- | --- | --- |
| Show open and desk | no | no | yes |
| Slate and robot intros | slate and silent name cards | lower thirds and Vic | full |
| Commentary | off | sparse | full |
| Bot Replay | no | best moment | top 3 |
| Pit interview | no | yes | yes |
| Crowd | sparse | half | packed |

## Workshop

The hub screen. Left: the 3D workshop with your robot on the bench. Right: a short panel.

- Robot name, rank (or Unranked), record and funds.
- **Next fight** card: opponent, venue, prize. One big button.
- **Work on the robot:** the garage, now with prices, buying and repairs.
- **Side gig:** when unlocked (after your first win).
- **Career:** the ladder: acts, fights, results, and a top-10 rankings board with you on it.

The workshop itself improves as you climb: storage unit (Act I), a real garage (Act II), a sponsored shop (Act III), a pro facility with your trophies (Act IV).

## Copy

Short, wry, warm. The fall is sad but fast; the climb is earned. No em dashes or en dashes.
