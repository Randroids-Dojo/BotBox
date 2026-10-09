// Pit interview copy: Jenna's question and the builder's answer, written from what happened.

import type { BotCard, MatchResult, WeaponId } from '../contract';
import type { Speaker } from '../ui/types';

function pick<T>(xs: T[]): T {
  return xs[Math.floor(Math.random() * xs.length)];
}

export function interview(o: {
  won: boolean;
  result: MatchResult;
  me: { id: string; name: string; weapon: WeaponId };
  them: BotCard;
  final: boolean;
  champion: boolean;
}): { speaker: Speaker; text: string }[] {
  const { won, result, me, them } = o;
  const s = result.stats[me.id];
  const lines: { speaker: Speaker; text: string }[] = [];
  const how = result.method;
  if (o.champion) {
    lines.push({ speaker: 'Jenna', text: `You just won the Giant Nut! What goes through your head right now?` });
    lines.push({ speaker: 'Builder', text: pick([
      `Honestly? Where we are going to put it. Our garage is already full of robot.`,
      `Six months of weekends. Every one of them was worth it.`,
      `I want to thank my wife, my credit card company, and every hardware store in the county.`,
    ]) });
    return lines;
  }
  if (won) {
    lines.push({ speaker: 'Jenna', text: pick([
      `${me.name} moves on! Walk me through that fight.`,
      `What a win over ${them.name}! How does it feel?`,
      `You took down ${them.name}. Did it go the way you planned?`,
    ]) });
    if (how === 'ko' && s && s.flips > 0) lines.push({ speaker: 'Builder', text: pick([`Once we got under them it was over. They can't get back up, and we knew it.`, `We practiced that flip in the parking lot all week.`]) });
    else if (how === 'ko' && s && s.hazardDamageDealt > s.damageDealt * 0.4) lines.push({ speaker: 'Builder', text: pick([`The Box did half the work. We just gave it some help.`, `The plan was the saws all along. Don't tell anybody.`]) });
    else if (how === 'ko') lines.push({ speaker: 'Builder', text: pick([`We hit them hard and kept hitting. That's the whole plan.`, `When that panel came off I knew we had them.`, `We just kept the pressure on. Our drive train is bulletproof.`]) });
    else if (how === 'decision') lines.push({ speaker: 'Builder', text: pick([`Three minutes is a long time in there. I'm glad the judges saw it our way.`, `We drove smart. We didn't need the knockout.`, `Not pretty, but a win's a win.`]) });
    else lines.push({ speaker: 'Builder', text: `We'll take it. On to the next one.` });
    lines.push({ speaker: 'Jenna', text: o.final ? `Next up, the final. Anything to fix?` : `What do you need to fix before the next round?` });
    lines.push({ speaker: 'Builder', text: pick([`Everything that's smoking.`, `Some armor, some wiring, and a sandwich.`, `We'll know when we open it up. Hopefully nothing.`, me.weapon === 'none' ? `Nothing. We don't have anything to break.` : `The weapon took a beating. We'll check the bearings.`]) });
  } else {
    lines.push({ speaker: 'Jenna', text: pick([`Tough break against ${them.name}. What happened out there?`, `That one got away from you. Talk me through it.`]) });
    if (how === 'ko') lines.push({ speaker: 'Builder', text: pick([`We got caught and couldn't get back up. That's robot combat.`, `Once we lost drive, it was over. We'll be back.`, `They were the better robot today. We learned a lot.`]) });
    else if (how === 'tapout') lines.push({ speaker: 'Builder', text: `We tapped out to save the robot. Live to fight another season.` });
    else lines.push({ speaker: 'Builder', text: pick([`I thought we did enough. The judges didn't.`, `Close fight. Next year we bring a bigger weapon.`]) });
  }
  return lines;
}
