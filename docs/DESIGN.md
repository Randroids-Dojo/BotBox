# BotBox design bible

BotBox is a love letter to turn-of-the-millennium cable robot combat: the Comedy Central years, roughly 2000 to 2002. Home-built heavyweights, NiCad packs and drill motors, a steel box full of saws and hammers, a sarcastic host, a jock co-host, a booming announcer, and a giant nut for a trophy. The player is a rookie builder. They design a robot under a weight limit, roll it into the Box, and fight a three-round bracket for the Nut.

Everything here is original: the show title, the hosts, the judges and every rival robot. It evokes the era. It never copies a real person, a real robot or a real logo.

## Pillars

1. **It feels like an episode.** Cold open, title sequence, host banter, pit segment, robot intros with stat cards, countdown lights, the fight, the instant replay, the judges, the interview, the bumper. You should be able to mute the game and still read it as a 2001 cable broadcast from across the room.
2. **Hits are physical and violent.** Every impact is a rigid-body event with a direction, an energy in joules, a contact point, a facet that took it and a component behind that facet. Sparks, dents, flying panels, smoke, fire, crowd roar and camera all key off that one event. A big spinner hit should make you flinch.
3. **Hardware is the strategy.** The weight limit forces trade-offs. A huge spinner leaves little for armor. A NiCad pack saves weight but can catch fire. A wedge beats a spinner with a high disk and loses to a lifter with forks. You scout the next opponent and refit between fights with limited repair time.
4. **Cinematic but drivable.** The default camera keeps both robots in frame and always reads clearly. TV cuts, slow motion and replays happen around the driving, never instead of it.

## The show

- **Title:** BOTBOX. Tagline on the title card: "Robot combat. Season 2001." Taped at Treasure Island, San Francisco.
- **Announcer, Vic Ramone.** The voice of the Box. Booming, theatrical, rolls the names. Does intros, the countdown call, the KO count and the decision.
- **Host, Dale Pruitt.** Play-by-play. Dry, sarcastic stand-up comedian. Undercuts the drama, loves a dumb robot name.
- **Co-host, Chuck "Cannon" Kowalski.** Color commentary. Former pro quarterback. Treats robots like linemen. "That's a sack!"
- **Pit reporter, Jenna Rae.** Upbeat, does the post-fight interview with the builder.
- **Judges.** Three, introduced on the decision card: Dr. Elaine Park (robotics professor), Rick Darrow (movie effects veteran), Gus Feldman (science fiction author).
- **Trophy.** The Giant Nut: a huge chromed hex nut on a plinth.

Tone: irreverent, warm, a bit goofy. The builders are nerds in team shirts. The robots have dumb names and frightening weapons.

## Weight classes

| Class | Limit | Scale (relative to heavyweight) |
| --- | --- | --- |
| Lightweight | 60 lb | 0.66 linear |
| Middleweight | 120 lb | 0.82 linear |
| Heavyweight | 220 lb | 1.0 linear |
| Super heavyweight | 340 lb | 1.15 linear |

A season is played in one class (heavyweight by default). Each class has seven rival robots in `src/data/roster.ts`. Every fight is one-on-one in the same class. Exhibition also offers a rumble (three or four robots, last one moving wins).

## Episode flow

1. **Cold open.** A flyover of the Box with sparks and a "Tonight on BotBox" tease.
2. **Title sequence.** Chrome logo, pyro, the theme riff, the announcer: "From Treasure Island in San Francisco... this is BOTBOX!"
3. **Host desk.** One or two lines of banter as captions and voice.
4. **Bracket.** An eight-robot bracket for the class. The player's slot is highlighted. Scouting card for the next opponent.
5. **The pits.** Repair and refit in the workshop. Limited repair points.
6. **Fight intro.** Arena flyover, the robots on their squares, lower-third stat cards, the announcer intro for each: "In the red square..."
7. **Countdown.** The light tree goes red, red, red, green. The announcer calls it.
8. **The fight.** Three minutes.
9. **Result.** Knockout replay or judges' decision, "Bot Replay" of the best moments, pit interview, damage report.
10. **Bumper.** "BotBox will be right back." Optionally watch an undercard fight in another class.
11. **The final.** Win the third fight and the Giant Nut is presented with confetti and the full theme.

## Match rules

- **Length:** 3:00 (exhibition can be set to 2:00 or 5:00).
- **Start:** each robot in its square (red and blue, diagonal corners). Light tree, then go.
- **Knockout:** a robot that cannot show controlled translational movement starts a 10-second count. Moving 0.5 m under its own power resets it. At zero the robot is counted out.
- **Holds:** a robot may not lift or pin an opponent for more than 10 seconds. At 10 seconds the referee calls "release"; the holder's drive and lifter are cut for 2 seconds.
- **Tap out:** a builder can forfeit from the pause menu to save the robot. It loses the fight.
- **Judges:** if both robots are moving at time, each of the three judges splits 5 points in each of Aggression, Strategy and Damage between the two robots. Totals are out of 45 and read as "by a score of 31 to 14". Judges use the match stats (damage dealt, time spent attacking, control, hazard use) with a little per-judge variance.

## The Box

A 48 ft (14.6 m) square steel floor. Steel kick walls 0.6 m high with bolted spikestrips on two sides, then scratched Lexan to a Lexan ceiling at 5 m. Steel truss above with theatrical lights. Stands on all four sides behind the Lexan, a big screen, the announcer booth, the driver stations on the south side.

Hazards (layout in `src/data/arena.ts`, shared by sim and renderers):

- **Pulverizers.** Two giant pneumatic sledgehammers in the north-west and south-east corners. When a robot sits in a pulverizer zone, the hammer winds up and slams down. Huge top damage and a jolt.
- **Killsaws.** Two strips of floor slots running north to south, west and east of center. When a robot rolls over a slot, a carbide saw blade rises through it with a shower of sparks and hurls the robot up. Bottom damage.
- **Ramrods.** Two patches of floor spikes north and south of center that punch up under robots.
- **Spikestrips.** Rows of steel spikes on the east and west kick walls. Hitting the wall there hurts more.
- **The red and blue squares.** Starting zones in the south-west (red) and north-east (blue) corners. Exact coordinates are in `arena.ts`.

## Hardware

All parts live in `src/data/parts.ts` with heavyweight weights in pounds, scaled by class. The garage shows weight used against the limit, plus derived stats: top speed, pushing power, weapon energy, armor, runtime, self-righting and invertibility.

- **Chassis:** Box, Wedge, Low-profile invertible, Shell (only with the shell spinner).
- **Drive:** 2WD drill motors, 2WD Magmotors (fast), 4WD wheelchair motors (torque), 6WD skid steer (pushing).
- **Power:** sealed lead-acid (heavy, robust), NiCad (light, can catch fire when punctured), NiMH (lightest, fragile).
- **Weapon:** none (pusher), vertical disk, drum, horizontal bar, full-body shell, pneumatic flipper, pneumatic axe, electric lifter.
- **Armor:** material (aluminum, titanium, UHMW, polycarbonate, hardened steel) and thickness (light, medium, heavy).
- **Extras:** front wedge plate, ground skirts, srimech (self-righting), wheel guards, ram spikes.

Materials matter: titanium throws white sparks and shrugs off spinners, UHMW soaks spinner hits but saws chew it, polycarbonate is light and brittle, hardened steel is heavy and nearly indestructible.

## Damage model

Every robot has five armor facets (front, rear, left, right, top) plus a belly, and five internal components (left drive, right drive, weapon, battery, electronics). A hit lands on a facet. Facet HP absorbs it first, scaled by material and weapon type. When a facet is gone its panel flies off, and later hits on that side go straight into the components behind it:

| Facet | Components behind it |
| --- | --- |
| Front | weapon, electronics |
| Rear | battery, electronics |
| Left | left drive, battery |
| Right | right drive, weapon |
| Top | electronics, weapon, battery |
| Belly | left drive, right drive, battery |

Effects: a dead drive side leaves the robot driving in circles. A damaged weapon spins slower, a dead one stops. A damaged battery cuts power, a NiCad puncture can start a fire. Dead electronics is a lost radio link: the robot stops. Motors below 35% smoke.

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Drive | WASD or arrows | Left stick (or both sticks in tank mode) | Left thumbstick |
| Weapon | Space | RT or A | WEAPON button |
| Self-right | E | B | RIGHT button (when a srimech is fitted) |
| Camera | C | Y | CAM button |
| Pause | Esc or P | Start | Pause button |

Spinners: the weapon button arms or disarms the weapon motor. Flipper and axe: press to fire. Lifter: hold to raise. Drive is robot-relative by default (up is forward for the robot); a camera-relative option is in settings.

## Cameras

- **Chase (default):** behind and above the player's robot, framed so the opponent stays in view.
- **Broadcast:** an automatic TV director cutting between the booth wide shot, roaming handhelds, corner floor cams and the overhead jib.
- **Driver station:** fixed, high and outside the Lexan, like a real driver. Hard mode.

Big hits trigger a short slow-motion beat and an optional quick cut to an impact camera, then return. Intros, outros and replays use jib, dolly, orbit and handheld moves.

## Art direction

A 2001 cable sports broadcast under hard theatrical light. Cool white and steel-blue key light from the truss, amber accents, deep shadow in the stands, haze in the beams. The floor is dark scuffed steel plate with weld seams, gouges, burn marks and painted yellow and black hazard zones. The Lexan is scratched and reflective. Sparks are white-hot to orange and bloom hard. Robots are home-built: bolts, welds, scuffed paint, team decals, exposed wheels.

Broadcast graphics: chrome bevel and brushed metal, hazard orange (#ff6a00), electric blue (#2a7fff), black, wide extended type for headers, condensed bold numerals, sparks and lens flares on wipes. A slight interlaced TV texture on graphics only.

## Audio direction

- **Music:** early 2000s rock: drop-D palm-muted guitar, big drums, synth stabs. Title theme, pit loop, fight bed (lower intensity, ducked under voice), victory sting, bumper sting. Synthesized in the browser.
- **Robots:** drive motor whine with gear grind, the rising siren of a spinner, pneumatic hiss and bang, hammer thump.
- **Impacts:** layered metal: a sharp transient, inharmonic ringing, a low thump for big hits, grinding scrape for sustained contact, spark crackle.
- **Arena:** crowd bed that swells and roars with the action, countdown beeps and the start horn, saws, hammers, ramrods.
- **Voice:** recorded lines for the announcer, both commentators and the pit reporter, generated offline and shipped as MP3.

## Copy

Short, punchy, era-appropriate. Sentence case in menus. ALL CAPS is fine on broadcast graphics. No em dashes or en dashes anywhere.
