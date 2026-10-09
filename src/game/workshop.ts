// The career hub: the workshop between fights. The garage and the store, the next fight on the
// card, side gigs for cash, the rankings, and the climb from the Scrapyard Circuit back to the
// Giant Nut.

import type { BotCard, Entrant } from '../contract';
import { FIGHTS, NEMESIS, PLAYER_TEAM, careerRivalById, fightLoadout, type CampaignFight } from '../data/campaign';
import { buildSpec } from '../sim/spec';
import {
  careerShop,
  careerView,
  currentAct,
  nextFight,
  rivalSummary,
  settle,
  sideGig,
  storeTier,
  workshopTier,
  workshopView,
  type CareerSave,
  type SideGig,
} from './career';
import { nameLines, runFight } from './fight';
import type { Game } from './game';
import { firstRebuild, workshopPreview } from './prologue';
import { PLAYER, resultText } from './season';

export function careerCard(c: CareerSave): BotCard {
  const blurb =
    c.rank === null
      ? 'A fallen champion, rebuilt from scrap.'
      : c.rank > 20
        ? 'The old champ, clawing its way back.'
        : c.rank > 1
          ? 'The comeback everyone is talking about.'
          : 'Champion again.';
  return {
    name: c.loadout.name,
    team: PLAYER_TEAM.team,
    hometown: PLAYER_TEAM.hometown,
    builders: PLAYER_TEAM.builders,
    blurb,
    record: `${c.w}-${c.l}`,
  };
}

function showWorkshop(g: Game, c: CareerSave): void {
  g.setTick(null);
  g.audio.setWorldActive(false);
  g.stage.setDressing('normal');
  g.stage.setScene('garage');
  g.stage.garage(buildSpec(c.loadout), c.damage ?? undefined, { tier: workshopTier(c) });
}

async function garage(g: Game, c: CareerSave, opponent: CampaignFight | null): Promise<void> {
  const res = await g.ui.garage({
    mode: 'career',
    career: careerShop(c, () => g.persist()),
    loadout: c.loadout,
    classLocked: true,
    damage: c.damage ?? undefined,
    opponent: opponent ? rivalSummary(opponent.opponent, opponent.rankAfter) : undefined,
    preview: workshopPreview(g, workshopTier(c)),
    orbit: (dx, dy) => g.stage.orbit(dx, dy),
  });
  if (res) {
    c.loadout = res.loadout;
    if (res.damage) c.damage = res.damage;
    if (res.funds !== undefined) c.funds = res.funds;
  }
  g.persist();
}

/** Prize money counting up, then the rank, then anything new in the store. */
async function rewardsBeat(g: Game, view: Parameters<Game['ui']['rewards']>[0]): Promise<void> {
  const screen = g.ui.rewards(view);
  void (async () => {
    if (view.prize > 0) {
      g.audio.stinger('cash');
      await g.wait(1.3, false);
    }
    if (view.rankAfter !== null && view.rankAfter !== view.rankBefore) {
      g.audio.stinger('rankup');
      await g.wait(1.2, false);
    }
    if (view.unlocks.length) g.audio.stinger('unlock');
  })();
  await screen;
}

async function fight(g: Game, c: CareerSave, f: CampaignFight | null, gig: SideGig | null): Promise<void> {
  const act = currentAct(c);
  const oppId = f ? f.opponent : gig!.opponent;
  const rival = careerRivalById(oppId)!;
  const final = oppId === NEMESIS.id;
  const firstOfAct = !!f && FIGHTS.find((x) => x.act === f.act) === f;
  const openLines: string[] = [];
  if (final) openLines.push('jenna.rematch', 'vic.final.open');
  else if (firstOfAct && act.id !== 'scrapyard') openLines.push(`vic.act.${act.id}`);

  g.stage.setDressing(act.id === 'championship' ? 'championship' : act.id === 'scrapyard' ? 'qualifier' : 'normal');
  const entrants: Entrant[] = [
    { id: PLAYER, corner: 'red', spec: buildSpec(c.loadout), card: careerCard(c), control: 'player', skill: 1, carried: c.damage ?? undefined },
    { id: rival.id, corner: 'blue', spec: buildSpec(fightLoadout(f ?? FIGHTS.find((x) => x.opponent === oppId)!)), card: rival.card, control: 'ai', skill: f ? f.skill : gig!.skill },
  ];
  const out = await runFight(g, {
    entrants,
    round: final ? 'final' : 'exhibition',
    length: act.id === 'scrapyard' ? 120 : 180,
    playerId: PLAYER,
    final,
    championIfWon: final,
    presentation: act.presentation,
    slate: { title: (f ? f.title : gig!.title).toUpperCase(), sub: act.title },
    comeback: act.id !== 'scrapyard',
    openLines,
    crowd: act.crowd,
  });
  g.setTick(null);
  g.stage.setDressing('normal');
  if (out.quit) return;

  const won = out.playerWon;
  const view = settle(c, {
    won,
    fight: f,
    prize: f ? f.prize : gig!.prize,
    result: resultText(out.result.method, out.result.time, out.result.totals, out.result.winner),
    damage: out.carried ?? null,
  });
  g.persist();

  if (won && final) {
    await ceremony(g, c);
  }
  showWorkshop(g, c);
  g.audio.music('workshop', 1);
  await rewardsBeat(g, view);
  if (view.actComplete && c.next < FIGHTS.length) {
    const next = currentAct(c);
    g.audio.stinger('whoosh');
    await g.ui.slate(next.title.toUpperCase(), next.subtitle, 3.2);
  }
}

async function ceremony(g: Game, c: CareerSave): Promise<void> {
  const spec = buildSpec(c.loadout);
  const card = careerCard(c);
  g.stage.setScene('trophy');
  g.stage.trophy(spec);
  g.audio.music('nut', 0.5);
  g.crowd(1);
  void g.say(['vic.champion', ...nameLines({ id: PLAYER, card }), 'vic.comeback'], 16);
  await g.ui.ceremony(card, c.loadout.cls);
  g.audio.stopVoice();
  g.ui.caption(null);
}

/** The workshop loop. Returns when the player heads back to the main menu. */
export async function careerHub(g: Game): Promise<void> {
  const c = g.save.career!;
  if (!c.rebuilt) await firstRebuild(g);
  let gigSeed = c.w * 7 + c.l * 3;
  for (;;) {
    g.onCalm(true);
    showWorkshop(g, c);
    g.audio.music('workshop', 1);
    const gig = sideGig(c, gigSeed);
    const view = workshopView(c, gig);
    // Tell them about new parts once.
    if (storeTier(c) > c.toldTier) {
      g.audio.stinger('unlock');
      c.toldTier = storeTier(c);
      g.persist();
    }
    const choice = await g.ui.workshop(view);
    if (choice === 'menu') return;
    try {
      if (choice === 'career') await g.ui.career(careerView(c));
      else if (choice === 'build') await garage(g, c, nextFight(c));
      else if (choice === 'fight' && nextFight(c)) await fight(g, c, nextFight(c), null);
      else if (choice === 'sidegig' && gig) {
        await fight(g, c, null, gig);
        gigSeed++;
      }
    } catch (err) {
      console.error(err);
    }
    g.setTick(null);
    g.ui.hud(null);
    g.ui.touchControls(null);
    g.ui.caption(null);
    g.ui.lowerThird(null);
    g.ui.bug(false);
  }
}

/** Dev and test hook: ?career=N skips the prologue and starts the climb at fight N. */
export function jumpTo(c: CareerSave, index: number): void {
  const i = Math.max(0, Math.min(FIGHTS.length, index));
  c.prologueDone = true;
  c.rebuilt = true;
  c.next = i;
  c.w = i;
  c.rank = i > 0 ? FIGHTS[i - 1].rankAfter : null;
  c.funds = Math.max(c.funds, Math.round(FIGHTS.slice(0, i).reduce((s, f) => s + f.prize, 0) * 0.6));
}
