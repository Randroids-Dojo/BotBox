// The booth: picks Dale and Chuck lines from fight events, keeps them timely, alternates the
// voices, fills lulls with banter, and lets Vic count knockouts over the top.

import type { AudioEngine } from '../audio/types';
import type { MatchEvent, WorldFrame } from '../contract';
import type { BroadcastUI, Settings, Speaker } from '../ui/types';

type Category =
  | 'start' | 'hit' | 'huge' | 'flip' | 'airborne' | 'saw' | 'pulverizer' | 'ramrod' | 'spikes' | 'wall' | 'panel'
  | 'wheel' | 'fire' | 'smoke' | 'weapondown' | 'drivedown' | 'count' | 'ko' | 'righted' | 'pin' | 'spinup' | 'whiff'
  | 'chase' | 'timelow' | 'decision' | 'upset' | 'idle' | 'intro' | 'rookie';

const PRIORITY: Record<Category, number> = {
  huge: 9, ko: 9, flip: 8, fire: 8, saw: 7, pulverizer: 7, panel: 7, wheel: 7, start: 6, airborne: 6, count: 6,
  weapondown: 6, drivedown: 6, timelow: 6, decision: 6, righted: 5, pin: 5, upset: 5, hit: 4, wall: 4, spikes: 4,
  ramrod: 4, smoke: 4, spinup: 3, whiff: 3, chase: 3, intro: 2, rookie: 2, idle: 1,
};

interface Pending {
  cat: Category;
  at: number;
  priority: number;
}

export class Commentary {
  private now = 0;
  private pending: Pending | null = null;
  private lastLine = -10;
  private lastSpeaker: 'dale' | 'chuck' = 'chuck';
  private recent: string[] = [];
  private spoke = new Set<Category>();
  private lastEvent = 0;
  private pendingWhiff = new Map<string, number>();
  private busyUntil = 0;
  private counting = false;
  enabled = true;

  constructor(
    private audio: AudioEngine,
    private ui: BroadcastUI,
    private settings: () => Settings,
  ) {}

  reset(): void {
    this.pending = null;
    this.lastLine = this.now;
    this.spoke.clear();
    this.pendingWhiff.clear();
    this.counting = false;
  }

  /** Ids available for a voice prefix like "chuck.huge.". */
  private variants(prefix: string): string[] {
    return this.audio.voiceIds().filter((id) => id.startsWith(prefix));
  }

  private queue(cat: Category, boost = 0): void {
    const p = PRIORITY[cat] + boost;
    if (!this.pending || p >= this.pending.priority || this.now - this.pending.at > 1.2) {
      this.pending = { cat, at: this.now, priority: p };
    }
  }

  events(events: MatchEvent[], world: WorldFrame, playerId: string | null): void {
    for (const e of events) {
      this.lastEvent = this.now;
      switch (e.type) {
        case 'fight_start':
          this.queue('start');
          break;
        case 'hit': {
          for (const [bot] of this.pendingWhiff) if (e.attacker === bot) this.pendingWhiff.delete(bot);
          if (e.kind === 'killsaw') this.queue('saw');
          else if (e.kind === 'pulverizer') this.queue('pulverizer');
          else if (e.kind === 'ramrod') this.queue('ramrod');
          else if (e.kind === 'spikestrip') this.queue('spikes');
          else if (e.severity >= 0.72) this.queue('huge');
          else if (e.kind === 'wall' && e.severity > 0.3) this.queue('wall');
          else if (e.severity >= 0.35 && e.kind !== 'floor') this.queue('hit');
          break;
        }
        case 'airborne':
          if (e.height > 0.6) this.queue('airborne');
          break;
        case 'flipped':
          this.queue('flip');
          break;
        case 'panel_off':
          this.queue('panel');
          break;
        case 'wheel_off':
          this.queue('wheel');
          break;
        case 'fire_start':
          this.queue('fire');
          break;
        case 'smoke_start':
          this.queue('smoke');
          break;
        case 'component_down':
          if (e.component === 'weapon') this.queue('weapondown');
          else if (e.component === 'driveL' || e.component === 'driveR') this.queue('drivedown');
          break;
        case 'ko_count':
          this.count(e.n, e.n === 10);
          break;
        case 'ko_clear':
          this.counting = false;
          break;
        case 'righted':
          this.queue('righted');
          break;
        case 'hold_warn':
          this.queue('pin');
          break;
        case 'release':
          this.announce('vic.release');
          break;
        case 'weapon_arm':
          if (e.on && !this.spoke.has('spinup')) this.queue('spinup');
          break;
        case 'weapon_fire':
          if (e.kind === 'axe' || e.kind === 'flipper') this.pendingWhiff.set(e.bot, this.now);
          break;
        case 'clock':
          if (e.remaining === 30) this.queue('timelow');
          break;
        default:
          break;
      }
    }
    for (const [bot, t] of this.pendingWhiff) {
      if (this.now - t > 0.6) {
        this.pendingWhiff.delete(bot);
        if (Math.random() < 0.35) this.queue('whiff');
      }
    }
    void world;
    void playerId;
  }

  private count(n: number, first: boolean): void {
    if (first) {
      this.counting = true;
      this.queue('count');
    }
    if (!this.counting) return;
    const id = `vic.count.${n}`;
    if (this.audio.voiceLine(id)) {
      void this.audio.voice(id, { interrupt: true });
      this.busyUntil = this.now + 0.8;
    }
  }

  /** Vic over the top of everything. */
  announce(id: string): void {
    if (!this.audio.voiceLine(id)) return;
    this.caption('Vic', id);
    void this.audio.voice(id, { interrupt: true }).then(() => this.ui.caption(null));
    this.busyUntil = this.now + (this.audio.voiceLine(id)?.dur ?? 1);
  }

  update(dt: number): void {
    this.now += dt;
    if (!this.enabled || !this.settings().commentary) {
      this.pending = null;
      return;
    }
    if (this.audio.voiceBusy() || this.now < this.busyUntil) return;
    if (!this.pending && this.now - this.lastLine > 9 && this.now - this.lastEvent > 3) this.queue('idle');
    const p = this.pending;
    if (!p) return;
    const stale = p.cat !== 'idle' && this.now - p.at > 1.4;
    const gap = this.now - this.lastLine;
    if (stale) {
      this.pending = null;
      return;
    }
    if (gap < (p.priority >= 7 ? 0.6 : 2.2)) return;
    this.pending = null;
    this.speak(p.cat);
  }

  /** Say a line from a category now (used by the director for scripted beats). */
  speak(cat: Category | 'desk' | 'bumper'): boolean {
    // Alternate voices, with Dale getting the jokes and Chuck the big moments.
    let speaker: 'dale' | 'chuck' = this.lastSpeaker === 'dale' ? 'chuck' : 'dale';
    if (cat === 'huge' || cat === 'flip' || cat === 'pulverizer') speaker = Math.random() < 0.65 ? 'chuck' : 'dale';
    if (cat === 'bumper') speaker = 'dale';
    let ids = this.variants(`${speaker}.${cat}.`);
    if (!ids.length) {
      speaker = speaker === 'dale' ? 'chuck' : 'dale';
      ids = this.variants(`${speaker}.${cat}.`);
    }
    if (!ids.length) return false;
    const fresh = ids.filter((id) => !this.recent.includes(id));
    const pool = fresh.length ? fresh : ids;
    const id = pool[Math.floor(Math.random() * pool.length)];
    this.recent.push(id);
    if (this.recent.length > 24) this.recent.shift();
    this.lastSpeaker = speaker;
    this.lastLine = this.now;
    if (cat !== 'desk' && cat !== 'bumper') this.spoke.add(cat as Category);
    this.caption(speaker === 'dale' ? 'Dale' : 'Chuck', id);
    void this.audio.voice(id).then(() => this.ui.caption(null));
    return true;
  }

  private caption(speaker: Speaker, id: string): void {
    const line = this.audio.voiceLine(id);
    if (line && this.settings().subtitles) this.ui.caption(speaker, line.text);
  }
}
