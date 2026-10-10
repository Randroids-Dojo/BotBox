// The garage: build a robot under the weight limit, or repair and refit it in the pits.

import { key } from './hints';
import {
  COMPONENTS,
  FACETS,
  type ArmorGrade,
  type ArmorMaterialId,
  type ChassisId,
  type Component,
  type DriveId,
  type ExtraId,
  type Facet,
  type Loadout,
  type PaintFinish,
  type PaintPattern,
  type PartKey,
  type PowerId,
  type WeaponId,
  type WeightClass,
} from '../contract';
import {
  ARMOR,
  ARMOR_GRADE,
  ARMOR_IDS,
  CHASSIS,
  CHASSIS_IDS,
  CLASSES,
  CLASS_LABEL,
  CLASS_LIMIT_LB,
  DRIVES,
  DRIVE_IDS,
  EXTRAS,
  EXTRA_IDS,
  POWER,
  POWER_IDS,
  WEAPONS,
  WEAPON_IDS,
  massScale,
} from '../data/parts';
import { VOICED_NAMES } from '../data/roster';
import { buildSpec, checkLoadout, extraAllowed, loadoutWeight, weightBreakdown } from '../sim/spec';
import type { Damage, GarageCategory, GarageContext, GarageResult } from './types';
import { el, exit, healthColor, item, replay, type Scope } from './core';
import { money } from './money';
import { slamFx, type UiCtx } from './fx';
import { scoutCard } from './scout';
import { advice } from './stats';
import { button, statBars } from './widgets';

type Tab = 'repair' | 'scout' | 'chassis' | 'drive' | 'power' | 'weapon' | 'armor' | 'extras' | 'paint' | 'name';
const TAB_LABEL: Record<Tab, string> = {
  repair: 'Repair',
  scout: 'Scout',
  chassis: 'Chassis',
  drive: 'Drive',
  power: 'Power',
  weapon: 'Weapon',
  armor: 'Armor',
  extras: 'Extras',
  paint: 'Paint',
  name: 'Name',
};

const SWAP_COST = 3;
const ARMOR_COST = 5;

const COMPONENT_LABEL: Record<Component, string> = {
  driveL: 'Left drive',
  driveR: 'Right drive',
  weapon: 'Weapon',
  battery: 'Battery',
  electronics: 'Electronics',
};
const FACET_LABEL: Record<Facet, string> = {
  front: 'Front armor',
  rear: 'Rear armor',
  left: 'Left armor',
  right: 'Right armor',
  top: 'Top armor',
  belly: 'Belly armor',
};

const SWATCHES = ['#ff6a00', '#d81e1e', '#ffd21f', '#3be36b', '#1e9e4a', '#2a7fff', '#21e6ff', '#7a3cff', '#ff4fb0', '#f2f2f2', '#9aa4b2', '#4b5320', '#7a3b12', '#101418'];
const PATTERNS: { id: PaintPattern; label: string }[] = [
  { id: 'solid', label: 'Solid' },
  { id: 'stripes', label: 'Stripes' },
  { id: 'flames', label: 'Flames' },
  { id: 'checker', label: 'Checker' },
  { id: 'hazard', label: 'Hazard' },
  { id: 'camo', label: 'Camo' },
  { id: 'splatter', label: 'Splatter' },
  { id: 'number', label: 'Number' },
];
const FINISHES: { id: PaintFinish; label: string }[] = [
  { id: 'gloss', label: 'Gloss' },
  { id: 'matte', label: 'Matte' },
  { id: 'metal', label: 'Metal flake' },
  { id: 'raw', label: 'Bare metal' },
];

const WEIGHT_COLORS: string[] = ['#8d96a3', '#2a7fff', '#ffd21f', '#21e6ff', '#ff6a00', '#d9dee5', '#b77bff', '#ff4fb0', '#3be36b'];

const SPEAKER_SVG =
  '<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 4V5L7 9H3z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/></svg>';

function clone(l: Loadout): Loadout {
  return { ...l, armor: { ...l.armor }, extras: [...l.extras], paint: { ...l.paint } };
}
function cloneDamage(d: Damage): Damage {
  return { facets: { ...d.facets }, parts: { ...d.parts } };
}
function healthy(): Damage {
  return {
    facets: Object.fromEntries(FACETS.map((f) => [f, 1])) as Record<Facet, number>,
    parts: Object.fromEntries(COMPONENTS.map((c) => [c, 1])) as Record<Component, number>,
  };
}

/** Drop extras the chassis or weapon no longer allows. */
function fixExtras(l: Loadout): string[] {
  const dropped: string[] = [];
  l.extras = l.extras.filter((e) => {
    const ok = extraAllowed(l, e);
    if (!ok) dropped.push(EXTRAS[e].label.toLowerCase());
    return ok;
  });
  return dropped;
}

interface Opt {
  key: string;
  label: string;
  blurb?: string;
  /** Weight shown on the row (class scaled), or null. */
  lb: number | null;
  selected: boolean;
  /** Loadout if picked, or null when it cannot be picked. */
  next: Loadout | null;
  why: string | null;
  /** Side effects of picking it ("Swaps weapon to ..."). */
  note?: string;
  cls?: string;
  /** Career store: what the row costs, and what picking it would buy. */
  shop?: { state: 'owned' | 'buy' | 'short' | 'locked' | 'free'; price: number; buy: PartKey[] };
}

type RepairKey = `f:${Facet}` | `c:${Component}`;

/** Coach lines for the guided first rebuild. */
const GUIDE_TEXT: Record<GarageCategory, string> = {
  chassis: 'Pick a frame',
  drive: 'Bolt on some wheels',
  power: 'Wire in a battery',
  weapon: 'Pick a weapon',
  armor: 'Hang some armor',
  extras: 'Add some extras',
  paint: 'Give it some paint',
  name: 'Keep the name or pick a new one',
};

/** Every store part a loadout uses. */
function partsOf(l: Loadout): PartKey[] {
  return [`chassis:${l.chassis}`, `drive:${l.drive}`, `power:${l.power}`, `weapon:${l.weapon}`, `armor:${l.armor.material}`, ...l.extras.map((e) => `extra:${e}` as PartKey)];
}

function partLabel(k: PartKey): string {
  const [cat, id] = k.split(':') as [string, string];
  if (cat === 'chassis') return CHASSIS[id as ChassisId].label;
  if (cat === 'drive') return DRIVES[id as DriveId].label;
  if (cat === 'power') return POWER[id as PowerId].label;
  if (cat === 'weapon') return WEAPONS[id as WeaponId].label;
  if (cat === 'armor') return ARMOR[id as ArmorMaterialId].label;
  return EXTRAS[id as ExtraId].label;
}

export function garage(ctx: UiCtx, g: GarageContext): Promise<GarageResult | null> {
  return new Promise((resolve) => {
    const pits = g.mode === 'pits';
    const careerMode = g.mode === 'career';
    const shop = careerMode ? g.career ?? null : null;
    const orig = clone(g.loadout);
    let cur = clone(g.loadout);
    const origDamage = g.damage ? cloneDamage(g.damage) : healthy();
    const steps = new Map<RepairKey, number>();
    // Career money: purchases are paid on the spot through shop.buy; repairs are paid on Done.
    let funds = shop?.funds ?? 0;
    const owned = new Set<PartKey>(shop?.owned ?? []);
    const bought: PartKey[] = [];
    const unit = careerMode ? shop?.repairPer10 ?? 0 : 1;
    const budget = () => (pits ? g.repairPoints ?? 0 : careerMode ? funds : Infinity);
    const anyDamage = FACETS.some((f) => origDamage.facets[f] < 1) || COMPONENTS.some((c) => origDamage.parts[c] < 1);
    const tabs: Tab[] = ['chassis', 'drive', 'power', 'weapon', 'armor', 'extras', 'paint', 'name'];
    if (pits || careerMode) {
      if (g.opponent) tabs.unshift('scout');
      if (pits || anyDamage) tabs.unshift('repair');
    }
    // Guided first rebuild: these slots read EMPTY until the player picks something in them.
    const guided = (g.guided ?? []).filter((c) => tabs.includes(c));
    const filled = new Set<GarageCategory>();
    const missing = () => guided.filter((c) => !filled.has(c));
    const isEmpty = (c: Tab) => guided.includes(c as GarageCategory) && !filled.has(c as GarageCategory);
    let tab: Tab = guided[0] ?? tabs[0];
    let hover: Loadout | null = null;
    let backArmed = false;
    let done = false;

    // ---- costs and damage (pits and career)
    // In a career, armor thickness is free, so only a new material brings fresh plates.
    const armorChanged = (l: Loadout) => l.armor.material !== orig.armor.material || (!careerMode && l.armor.grade !== orig.armor.grade);
    const refitCost = (l: Loadout) => {
      if (!pits) return 0;
      let c = 0;
      if (l.drive !== orig.drive) c += SWAP_COST;
      if (l.power !== orig.power) c += SWAP_COST;
      if (l.weapon !== orig.weapon) c += SWAP_COST;
      if (armorChanged(l)) c += ARMOR_COST;
      for (const e of EXTRA_IDS) if (l.extras.includes(e) !== orig.extras.includes(e)) c += SWAP_COST;
      return c;
    };
    const fresh = (l: Loadout, k: RepairKey): boolean => {
      if (k.startsWith('f:')) return armorChanged(l);
      const c = k.slice(2) as Component;
      if (c === 'driveL' || c === 'driveR') return l.drive !== orig.drive;
      if (c === 'weapon') return l.weapon !== orig.weapon;
      if (c === 'battery') return l.power !== orig.power;
      return false;
    };
    const base = (k: RepairKey) => (k.startsWith('f:') ? origDamage.facets[k.slice(2) as Facet] : origDamage.parts[k.slice(2) as Component]);
    const health = (l: Loadout, k: RepairKey) => (fresh(l, k) ? 1 : Math.min(1, base(k) + (steps.get(k) ?? 0) * 0.1));
    const repairCost = (l: Loadout) => {
      let c = 0;
      for (const [k, n] of steps) if (!fresh(l, k)) c += n;
      return c;
    };
    /** Pits: repair points used. Career: dollars of repairs pending. */
    const spent = (l: Loadout) => refitCost(l) + repairCost(l) * unit;
    const effectiveDamage = (l: Loadout): Damage => {
      const d = healthy();
      for (const f of FACETS) d.facets[f] = health(l, `f:${f}`);
      for (const c of COMPONENTS) d.parts[c] = health(l, `c:${c}`);
      return d;
    };

    // ---- preview
    let previewTimer = 0;
    const preview = () => {
      clearTimeout(previewTimer);
      previewTimer = window.setTimeout(() => {
        try {
          g.preview(clone(cur), pits || careerMode ? effectiveDamage(cur) : g.damage, guided.length ? missing() : undefined);
        } catch (e) {
          console.warn('garage preview failed', e);
        }
      }, 60);
    };
    ctx.mine = cur;

    // ---- DOM skeleton
    const nameBig = el('div.gl-name.wide.chrome-text');
    const classLine = el('div.gl-class.kicker');
    const leftHead = el('div.gl-head', [el('span.tag' + (pits ? '.blue' : ''), pits ? 'The pits' : careerMode ? 'Workbench' : 'Garage'), nameBig, classLine]);
    const nextChip = (pits || careerMode) && g.opponent ? el('div.gl-next', [el('span.kicker', 'Next'), el('span.wide', g.opponent.card.name)]) : null;
    const drag = el('div.gl-drag.live');
    const leftStats = el('div.gl-stats-slot');
    const left = el('div.gar-left', [drag, leftHead, nextChip, leftStats]);

    const wNum = el('span.wm-num.cond');
    const wLimit = el('span.wm-limit.cond');
    const wDelta = el('span.wm-delta.cond');
    const wBar = el('div.wm-bar');
    const wGhost = el('div.wm-ghost');
    const wLegend = el('div.wm-legend');
    const wState = el('span.wm-state.wide');
    const pts = pits ? el('div.pts', [el('span.kicker', 'Repair points'), el('span.pts-num.cond')]) : null;
    const fundsNum = el('span.gf-num.cond');
    const fundsNote = el('span.gf-note.cond');
    const fundsBox = careerMode ? el('div.gfunds', [el('span.kicker', 'Funds'), fundsNum, fundsNote]) : null;
    const coach = el('div.gp-coach');
    const meter = el('div.wmeter', [
      el('div.wm-top', [el('span.kicker', 'Weight'), wState, el('span.wm-figs', [wNum, wLimit, wDelta])]),
      el('div.wm-track', [wBar, wGhost, el('div.wm-ticks')]),
      wLegend,
    ]);
    const tabRow = el('div.gp-tabs');
    const body = el('div.gp-body');
    const statsBox = el('div.gp-stats');
    const warn = el('div.gp-warn');
    const doneBtn = button(pits ? 'Ready' : 'Done', { activate: () => finish(true), cls: 'small primary' });
    const backBtn = button('Back', { activate: () => onBack(), cls: 'small' });
    const toast = el('div.gp-toast');
    const panel = el('div.gar-panel.panel', [
      fundsBox,
      el('div.gp-head', [meter, pts]),
      tabRow,
      guided.length ? coach : null,
      body,
      statsBox,
      warn,
      el('div.gp-foot', [doneBtn, guided.length ? null : backBtn, el('div.hint-row', [el('span', [...key('Q', 'LB'), ...key('E', 'RB'), 'Tabs'])])]),
      toast,
    ]);
    const node = el('div.screen.garage' + (pits ? '.pits' : '') + (careerMode ? '.career' : '') + (guided.length ? '.guided' : ''), [left, panel]);
    ctx.layers.screen.append(node);

    // The tale of the tape sits under the preview like a broadcast stat card.
    leftStats.append(statsBox);

    // Orbit by dragging the preview.
    let dragId: number | null = null;
    let lx = 0;
    let ly = 0;
    drag.addEventListener('pointerdown', (e) => {
      dragId = e.pointerId;
      lx = e.clientX;
      ly = e.clientY;
      try {
        drag.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    });
    drag.addEventListener('pointermove', (e) => {
      if (e.pointerId !== dragId) return;
      g.orbit(e.clientX - lx, e.clientY - ly);
      lx = e.clientX;
      ly = e.clientY;
    });
    const endDrag = (e: PointerEvent) => {
      if (e.pointerId === dragId) dragId = null;
    };
    drag.addEventListener('pointerup', endDrag);
    drag.addEventListener('pointercancel', endDrag);

    // ---- options per tab
    const lb = (heavyLb: number) => heavyLb * massScale(cur.cls);
    const costWhy = (n: Loadout): string | null => {
      if (!pits) return null;
      const need = spent(n) - spent(cur);
      const have = budget() - spent(cur);
      if (spent(n) > budget()) return `Costs ${need} pts, you have ${have}`;
      return null;
    };
    const costNote = (n: Loadout): string | undefined => {
      if (!pits) return undefined;
      const d = refitCost(n) - refitCost(cur);
      if (d > 0) return `${d} pts`;
      if (d < 0) return `Refund ${-d} pts`;
      return undefined;
    };

    const optsFor = (t: Tab): Opt[] => {
      const out: Opt[] = [];
      if (t === 'chassis') {
        for (const id of CHASSIS_IDS) {
          const p = CHASSIS[id];
          const n = clone(cur);
          n.chassis = id as ChassisId;
          let note: string | undefined;
          if (id === 'shell' && n.weapon !== 'shell') {
            n.weapon = 'shell';
            note = 'Swaps weapon to full-body shell';
          } else if (id !== 'shell' && n.weapon === 'shell') {
            n.weapon = 'none';
            note = 'Removes the shell spinner';
          }
          const dropped = fixExtras(n);
          if (dropped.length) note = [note, `Drops ${dropped.join(', ')}`].filter(Boolean).join('. ');
          let why: string | null = null;
          if (pits && id !== cur.chassis) why = 'Chassis is locked in the pits';
          out.push({ key: `chassis:${id}`, label: p.label, blurb: p.blurb, lb: lb(p.lb), selected: cur.chassis === id, next: why ? null : n, why, note });
        }
      } else if (t === 'drive') {
        for (const id of DRIVE_IDS) {
          const p = DRIVES[id];
          const n = clone(cur);
          n.drive = id as DriveId;
          out.push(opt(`drive:${id}`, p.label, p.blurb, lb(p.lb), cur.drive === id, n));
        }
      } else if (t === 'power') {
        for (const id of POWER_IDS) {
          const p = POWER[id];
          const n = clone(cur);
          n.power = id as PowerId;
          out.push(opt(`power:${id}`, p.label, p.blurb, lb(p.lb), cur.power === id, n));
        }
      } else if (t === 'weapon') {
        for (const id of WEAPON_IDS) {
          const p = WEAPONS[id];
          const n = clone(cur);
          n.weapon = id as WeaponId;
          let why: string | null = null;
          let note: string | undefined;
          if (p.notOn.includes(cur.chassis)) {
            if (id === 'shell' && !pits && !g.classLocked) {
              n.chassis = 'shell';
              note = 'Swaps chassis to shell base';
            } else if (id === 'shell') why = pits ? 'Needs the shell base, and the chassis is locked' : 'Needs the shell base';
            else why = `Does not fit a ${CHASSIS[cur.chassis].label.toLowerCase()}`;
          }
          const dropped = fixExtras(n);
          if (dropped.length) note = [note, `Drops ${dropped.join(', ')}`].filter(Boolean).join('. ');
          const o = opt(`weapon:${id}`, p.label, p.blurb, id === 'none' ? 0 : lb(p.lb), cur.weapon === id, why ? null : n, why);
          if (note) o.note = [note, o.note].filter(Boolean).join('. ');
          out.push(o);
        }
      } else if (t === 'armor') {
        for (const gr of [1, 2, 3] as ArmorGrade[]) {
          const n = clone(cur);
          n.armor.grade = gr;
          const o = opt(`grade:${gr}`, `${ARMOR_GRADE[gr].label}`, `${ARMOR_GRADE[gr].mm} mm`, null, cur.armor.grade === gr, n);
          o.cls = 'chip grade';
          out.push(o);
        }
        for (const id of ARMOR_IDS) {
          const p = ARMOR[id];
          const n = clone(cur);
          n.armor.material = id as ArmorMaterialId;
          const w = weightBreakdown(n).find((x) => x.label.endsWith('armor'))?.lb ?? null;
          out.push(opt(`armor:${id}`, p.label, p.blurb, w, cur.armor.material === id, n));
        }
      } else if (t === 'extras') {
        for (const id of EXTRA_IDS) {
          const p = EXTRAS[id];
          const has = cur.extras.includes(id as ExtraId);
          const n = clone(cur);
          n.extras = has ? n.extras.filter((e) => e !== id) : [...n.extras, id as ExtraId];
          let why: string | null = null;
          if (!has && !extraAllowed(cur, id as ExtraId)) {
            why = p.notOn.includes(cur.chassis)
              ? `Does not fit a ${CHASSIS[cur.chassis].label.toLowerCase()}`
              : `In the way of the ${WEAPONS[cur.weapon].label.toLowerCase()}`;
          }
          const o = opt(`extra:${id}`, p.label, p.blurb, lb(p.lb), has, why ? null : n, why);
          o.cls = 'toggle-opt';
          out.push(o);
        }
      }
      return out;
    };

    function opt(key: string, label: string, blurb: string, w: number | null, selected: boolean, n: Loadout | null, why: string | null = null): Opt {
      let reason = why;
      if (!reason && n && !selected) reason = costWhy(n);
      return { key, label, blurb, lb: w, selected, next: reason ? null : n, why: reason, note: n && !selected ? costNote(n) : undefined };
    }

    // ---- render
    let scope: Scope;
    const focusKey = () => scope?.focused?.dataset.key ?? null;
    const byKey = (k: string | null) => (k ? node.querySelector<HTMLElement>(`[data-key="${CSS.escape(k)}"]`) : null);

    const setHover = (l: Loadout | null) => {
      hover = l;
      drawMeter();
      drawStats();
    };

    const catOf = (k: string): GarageCategory => {
      const c = k.split(':')[0];
      return c === 'grade' ? 'armor' : c === 'extra' ? 'extras' : (c as GarageCategory);
    };

    const apply = (o: Opt) => {
      if (!o.next) return;
      const cat = catOf(o.key);
      const guidedPick = isEmpty(cat);
      if (o.selected && !o.key.startsWith('extra:') && !guidedPick) {
        ctx.sfx.ui('select');
        return;
      }
      const prev = cur;
      cur = o.next;
      ctx.mine = cur;
      // Swapped parts come back fresh: forget repairs on them.
      if (pits || careerMode) for (const k of [...steps.keys()]) if (fresh(cur, k) && !fresh(prev, k)) steps.delete(k);
      ctx.sfx.ui(pits && spent(cur) > spent(prev) ? 'buy' : 'select');
      backArmed = false;
      if (guidedPick) fill(cat);
      preview();
      renderAll(o.key);
    };

    /** Cash on hand after the repairs already dialed in. */
    const available = () => funds - spent(cur);

    const pick = (o: Opt) => {
      const sh = o.shop;
      if (!careerMode || !shop || !sh || !o.next || !sh.buy.length) return apply(o);
      const total = sh.buy.reduce((a, k) => a + (shop.prices[k] ?? 0), 0);
      if (total > available()) {
        ctx.sfx.ui('error');
        const row = byKey(o.key);
        if (row) replay(row, 'shake');
        showToast(`Need ${money(total - available())} more. Win a fight or take a side gig.`);
        return;
      }
      confirmBuy(sh.buy, total, () => {
        for (const k of sh.buy) {
          const left = shop.buy(k);
          if (left === null) {
            ctx.sfx.ui('error');
            showToast(`Couldn't buy the ${partLabel(k).toLowerCase()}`);
            renderAll(o.key);
            return;
          }
          funds = left;
          owned.add(k);
          bought.push(k);
        }
        ctx.sfx.ui('buy');
        // Re-pick against the new store state so the row is no longer a purchase.
        apply({ ...o, shop: undefined });
        bump(fundsNum);
      });
    };

    // One-tap purchase confirmation over the panel.
    const confirmBuy = (keys: PartKey[], total: number, yes: () => void) => {
      const what = keys.length === 1 ? partLabel(keys[0]) : keys.map(partLabel).join(' and ');
      let closed = false;
      const close = (ok: boolean) => {
        if (closed) return;
        closed = true;
        ctx.nav.pop(sub);
        box.remove();
        scope.refresh();
        if (ok) yes();
        else ctx.sfx.ui('back');
      };
      const buyBtn = button(`Buy ${money(total)}`, { cls: 'small primary', activate: () => close(true) });
      const noBtn = button('Cancel', { cls: 'small', activate: () => close(false) });
      const box = el('div.gp-confirm.live', [
        el('div.gc-card', [
          el('div.kicker', 'Buy it?'),
          el('div.gc-q', `${what} for ${money(total)}?`),
          el('div.gc-after.cond', `${money(available())} now, ${money(available() - total)} after`),
          el('div.gc-btns', [buyBtn, noBtn]),
        ]),
      ]);
      box.addEventListener('click', (e) => {
        if (e.target === box) close(false);
      });
      panel.append(box);
      ctx.sfx.ui('tick');
      const sub = ctx.nav.push({ root: box, back: () => close(false), initial: buyBtn });
    };

    // Store state and guided EMPTY state for a row.
    const decorate = (o: Opt): Opt => {
      const cat = catOf(o.key);
      if (isEmpty(cat) && cat !== 'extras') o.selected = false;
      if (!careerMode || !shop) return o;
      if (o.key.startsWith('grade:')) return o;
      const k = o.key as PartKey;
      const price = shop.prices[k] ?? 0;
      const lockedWhy = shop.locked[k];
      if (!owned.has(k) && lockedWhy) {
        o.shop = { state: 'locked', price, buy: [] };
        o.why = lockedWhy;
        o.next = null;
        return o;
      }
      const need = o.next && !o.selected ? partsOf(o.next).filter((p) => !owned.has(p)) : [];
      const blocked = need.find((p) => shop.locked[p]);
      if (blocked) {
        o.shop = { state: 'locked', price, buy: [] };
        o.why = o.why ?? shop.locked[blocked]!;
        o.next = null;
        return o;
      }
      const total = need.reduce((a, p) => a + (shop.prices[p] ?? 0), 0);
      const state = owned.has(k) ? 'owned' : total > available() ? 'short' : 'buy';
      o.shop = { state, price, buy: need };
      if (need.length > 1 || (need.length === 1 && need[0] !== k)) o.note = [o.note, `Also buys ${need.filter((p) => p !== k).map(partLabel).join(', ').toLowerCase()}`].filter(Boolean).join('. ');
      return o;
    };

    // ---- guided rebuild
    const fill = (c: GarageCategory) => {
      if (!isEmpty(c)) return;
      filled.add(c);
      preview();
      const next = missing()[0];
      // Walk straight on to the next empty slot, or to Done.
      window.setTimeout(() => {
        if (done) return;
        if (next) switchTab(next, true);
        else {
          renderAll(null);
          scope.refresh(doneBtn);
          replay(doneBtn, 'ready');
        }
      }, 380);
    };

    const drawCoach = () => {
      if (!guided.length) return;
      const left = missing();
      const step = guided.length - left.length;
      const dots = el('span.gc-dots', guided.map((c) => el(`span.gc-dot${filled.has(c) ? '.on' : ''}${c === left[0] ? '.cur' : ''}`)));
      if (!left.length) {
        coach.replaceChildren(el('div.gc-step', [dots, el('span.kicker', 'Ready')]), el('div.gc-text', 'All bolted together. Hit Done.'));
        coach.classList.add('all');
        return;
      }
      coach.classList.remove('all');
      coach.replaceChildren(
        el('div.gc-step', [dots, el('span.kicker', `Step ${step + 1} of ${guided.length}`)]),
        el('div.gc-text', GUIDE_TEXT[left[0]]),
      );
      if (tab !== left[0]) {
        const target = left[0];
        coach.append(item(el('div.gc-sub', { 'data-key': 'coachgo' }, `Back to ${TAB_LABEL[target]}`), { activate: () => switchTab(target, true) }));
      }
    };

    const renderTabs = () => {
      tabRow.replaceChildren();
      for (const t of tabs) {
        const empty = isEmpty(t);
        const step = empty && missing()[0] === t;
        const b = item(el(`div.gtab${t === tab ? '.on' : ''}${empty ? '.empty' : ''}${step ? '.step' : ''}`, { 'data-key': `tab:${t}` }, [el('span', TAB_LABEL[t]), empty ? el('span.gtab-empty', 'Empty') : null]), {
          activate: () => switchTab(t),
          focus: () => setHover(null),
        });
        tabRow.append(b);
      }
    };

    const switchTab = (t: Tab, focusBody = false) => {
      if (t === tab && !focusBody) return;
      tab = t;
      ctx.sfx.ui('move');
      renderAll(null);
      body.scrollTop = 0;
      const first = body.querySelector<HTMLElement>('.keep-name') ?? body.querySelector<HTMLElement>('.nav');
      const tabEl = byKey(`tab:${t}`);
      scope.refresh(focusBody ? first ?? tabEl : tabEl);
      tabEl?.scrollIntoView({ inline: 'center', block: 'nearest' });
    };

    const renderBody = () => {
      body.replaceChildren();
      body.dataset.tab = tab;
      if (tab === 'repair') return renderRepair();
      if (tab === 'scout') {
        if (g.opponent) body.append(scoutCard(g.opponent, cur, true));
        return;
      }
      if (tab === 'paint') return renderPaint();
      if (tab === 'name') return renderName();
      const opts = optsFor(tab).map(decorate);
      if (tab === 'chassis' && !g.classLocked && !pits && !careerMode) body.append(classRow());
      const list = el('div.opt-list' + (tab === 'armor' ? '.armor' : ''));
      if (tab === 'armor') {
        list.append(el('div.opt-sub.kicker', 'Thickness'));
        const chips = el('div.chip-row');
        list.append(chips);
        for (const o of opts.filter((x) => x.key.startsWith('grade:'))) chips.append(optRow(o));
        list.append(el('div.opt-sub.kicker', 'Material'));
        for (const o of opts.filter((x) => !x.key.startsWith('grade:'))) list.append(optRow(o));
      } else {
        for (const o of opts) list.append(optRow(o));
      }
      body.append(list);
    };

    const optRow = (o: Opt): HTMLElement => {
      const w = o.lb === null ? '' : `${o.lb.toFixed(1)} lb`;
      const delta = o.next && !o.selected ? loadoutWeight(o.next) - loadoutWeight(cur) : 0;
      const isChip = o.cls?.includes('chip');
      const row = el(`div.opt${o.selected ? '.sel' : ''}${o.why ? '.is-disabled' : ''}${o.shop ? '.s-' + o.shop.state : ''}${o.cls ? '.' + o.cls.split(' ').join('.') : ''}`, { 'data-key': o.key }, [
        el('div.opt-main', [
          o.key.startsWith('extra:') ? el('span.opt-box', o.selected ? '✓' : '') : null,
          el('span.opt-label.wide', o.label),
          isChip ? el('span.opt-mm.cond', o.blurb ?? '') : null,
          o.selected && !isChip ? el('span.opt-fitted', o.key.startsWith('extra:') ? 'Fitted' : 'Fitted') : null,
          el('span.opt-w.cond', w),
          !isChip && Math.abs(delta) > 0.05 ? el(`span.opt-d.cond.${delta > 0 ? 'heavier' : 'lighter'}`, `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`) : null,
          o.shop ? priceTag(o.shop) : null,
        ]),
        !isChip && o.blurb ? el('div.opt-blurb', o.blurb) : null,
        o.why ? el(`div.opt-why${o.shop?.state === 'locked' ? '.lock' : ''}`, o.why) : null,
        !o.why && o.note ? el('div.opt-note', o.note) : null,
      ]);
      return item(row, {
        activate: () => pick(o),
        focus: () => setHover(o.next && !o.selected ? o.next : null),
      });
    };

    const priceTag = (sh: NonNullable<Opt['shop']>): HTMLElement => {
      if (sh.state === 'owned' || sh.state === 'free') return el('span.opt-price.owned', 'Owned');
      return el(`span.opt-price.cond.${sh.state}`, money(sh.price));
    };

    const classRow = (): HTMLElement => {
      const opts = CLASSES;
      const val = el('span.cyc-val.wide');
      const draw = () => (val.textContent = `${CLASS_LABEL[cur.cls]}  ${CLASS_LIMIT_LB[cur.cls]} lb`);
      const step = (d: -1 | 1) => {
        const i = opts.indexOf(cur.cls);
        const nc = opts[(i + d + opts.length) % opts.length] as WeightClass;
        cur = { ...clone(cur), cls: nc };
        ctx.mine = cur;
        ctx.sfx.ui('tick');
        preview();
        renderAll('class');
      };
      const l = el('span.cyc-arrow.l', '◀');
      const r = el('span.cyc-arrow.r', '▶');
      l.addEventListener('click', (e) => (e.stopPropagation(), step(-1)));
      r.addEventListener('click', (e) => (e.stopPropagation(), step(1)));
      const row = item(el('div.row.cycler.class-row', { 'data-key': 'class' }, [el('span.row-label', 'Weight class'), el('span.cyc', [l, val, r])]), {
        activate: () => step(1),
        adjust: (d) => step(d),
        focus: () => setHover(null),
      });
      draw();
      return row;
    };

    const renderPaint = () => {
      const p = cur.paint;
      const setPaint = (fn: (l: Loadout) => void, key: string) => {
        const n = clone(cur);
        fn(n);
        cur = n;
        ctx.mine = cur;
        ctx.sfx.ui('tick');
        fill('paint');
        preview();
        renderAll(key);
      };
      for (const slot of ['primary', 'secondary', 'accent'] as const) {
        const row = el('div.swatch-row');
        for (const c of SWATCHES) {
          const sw = item(el(`div.swatch${p[slot].toLowerCase() === c ? '.sel' : ''}`, { 'data-key': `${slot}:${c}`, style: `--c:${c}`, title: c }), {
            activate: () => setPaint((l) => (l.paint[slot] = c), `${slot}:${c}`),
            focus: () => setHover(null),
          });
          row.append(sw);
        }
        body.append(el('div.paint-group', [el('div.opt-sub.kicker', slot === 'primary' ? 'Main color' : slot === 'secondary' ? 'Second color' : 'Trim'), row]));
      }
      const pat = el('div.chip-row.wrap');
      for (const x of PATTERNS)
        pat.append(
          item(el(`div.opt.chip${p.pattern === x.id ? '.sel' : ''}`, { 'data-key': `pattern:${x.id}` }, el('span.opt-label.wide', x.label)), {
            activate: () => setPaint((l) => (l.paint.pattern = x.id), `pattern:${x.id}`),
            focus: () => setHover(null),
          }),
        );
      const fin = el('div.chip-row.wrap');
      for (const x of FINISHES)
        fin.append(
          item(el(`div.opt.chip${p.finish === x.id ? '.sel' : ''}`, { 'data-key': `finish:${x.id}` }, el('span.opt-label.wide', x.label)), {
            activate: () => setPaint((l) => (l.paint.finish = x.id), `finish:${x.id}`),
            focus: () => setHover(null),
          }),
        );
      const decal = el<'input'>('input.text-in.wide', { type: 'text', maxlength: 10, value: p.decal ?? '', placeholder: 'Team initials', 'data-key': 'decal', spellcheck: 'false', autocomplete: 'off' });
      item(decal, { focus: () => setHover(null) });
      decal.addEventListener('input', () => {
        cur = clone(cur);
        cur.paint.decal = decal.value.toUpperCase().slice(0, 10);
        ctx.mine = cur;
        ctx.sfx.ui('type');
        preview();
      });
      body.append(
        el('div.paint-group', [el('div.opt-sub.kicker', 'Pattern'), pat]),
        el('div.paint-group', [el('div.opt-sub.kicker', 'Finish'), fin]),
        el('div.paint-group', [el('div.opt-sub.kicker', 'Decal on the lid (10 letters)'), decal]),
      );
    };

    const renderName = () => {
      const input = el<'input'>('input.text-in.name-in.wide', { type: 'text', maxlength: 24, value: cur.name, placeholder: 'Name your robot', 'data-key': 'name', spellcheck: 'false', autocomplete: 'off' });
      item(input, { focus: () => setHover(null) });
      const voiced = () => VOICED_NAMES.some((v) => v.name.toLowerCase() === cur.name.trim().toLowerCase());
      const note = el('div.name-note');
      const drawNote = () => {
        note.innerHTML = '';
        if (voiced()) note.append(el('span.spk'), ' The announcer will call this name.');
        else note.append('Custom names show on the graphics. Pick a name with the speaker and Vic Ramone will say it.');
        (note.firstChild as HTMLElement | null)?.classList?.contains('spk') && ((note.firstChild as HTMLElement).innerHTML = SPEAKER_SVG);
        nameBig.textContent = cur.name || 'Unnamed';
        grid.querySelectorAll<HTMLElement>('.vname').forEach((v) => v.classList.toggle('sel', v.dataset.name === cur.name));
      };
      input.addEventListener('input', () => {
        cur = clone(cur);
        cur.name = input.value.slice(0, 24);
        ctx.mine = cur;
        ctx.sfx.ui('type');
        drawNote();
        drawWarn();
      });
      input.addEventListener('change', () => {
        if (cur.name.trim()) fill('name');
      });
      const grid = el('div.vname-grid');
      for (const v of VOICED_NAMES) {
        const chip = item(el(`div.vname${cur.name === v.name ? '.sel' : ''}`, { 'data-key': `vname:${v.slug}`, 'data-name': v.name }, [el('span.spk'), el('span.wide', v.name)]), {
          activate: () => {
            cur = clone(cur);
            cur.name = v.name;
            ctx.mine = cur;
            input.value = v.name;
            ctx.sfx.ui('select');
            drawNote();
            drawWarn();
            fill('name');
            preview();
          },
          focus: () => setHover(null),
        });
        (chip.firstChild as HTMLElement).innerHTML = SPEAKER_SVG;
        grid.append(chip);
      }
      const keep = isEmpty('name')
        ? button('Keep this name', {
            cls: 'small primary keep-name',
            activate: () => {
              if (!cur.name.trim()) {
                ctx.sfx.ui('error');
                showToast('Give it a name first');
                return;
              }
              ctx.sfx.ui('select');
              fill('name');
            },
          })
        : null;
      if (keep) keep.dataset.key = 'keepname';
      body.append(el('div.paint-group', [el('div.opt-sub.kicker', 'Robot name'), input, keep, note]), el('div.paint-group', [el('div.opt-sub.kicker', 'Names the announcer knows'), grid]));
      drawNote();
    };

    const renderRepair = () => {
      const left = budget() - spent(cur);
      body.append(
        el(
          'div.rep-intro',
          careerMode
            ? `${money(unit)} fixes 10 percent. Anything under ${Math.round((shop?.freePatch ?? 0) * 100)} percent was patched for free. New parts come fresh.`
            : `1 point fixes 10 percent. Swapped parts come back new. ${left} of ${budget()} points left.`,
        ),
      );
      const mk = (k: RepairKey, label: string) => {
        const b = base(k);
        const h = health(cur, k);
        const isFresh = fresh(cur, k);
        const n = steps.get(k) ?? 0;
        const bar = el('div.rep-bar', [el('div.rep-base', { style: `width:${(b * 100).toFixed(1)}%;background:${healthColor(b)}` }), el('div.rep-fix', { style: `left:${(b * 100).toFixed(1)}%;width:${(Math.max(0, h - b) * 100).toFixed(1)}%` })]);
        const can = !isFresh && h < 1 && left >= unit;
        const minus = el('span.rep-btn.minus', '−');
        const plus = el('span.rep-btn.plus' + (careerMode ? '.cash' : ''), careerMode ? `+${money(unit)}` : '+');
        const add = (d: -1 | 1) => {
          if (d > 0) {
            if (!can) {
              ctx.sfx.ui('error');
              replay(row, 'shake');
              if (careerMode && !isFresh && h < 1) showToast('Not enough cash for repairs');
              return;
            }
            steps.set(k, n + 1);
            ctx.sfx.ui('repair');
          } else {
            if (n <= 0) return false;
            steps.set(k, n - 1);
            ctx.sfx.ui('back');
          }
          preview();
          renderAll(k);
          return true;
        };
        minus.addEventListener('click', (e) => (e.stopPropagation(), add(-1)));
        plus.addEventListener('click', (e) => (e.stopPropagation(), add(1)));
        const row = item(
          el(`div.rep-row${h >= 1 ? '.full' : ''}`, { 'data-key': k }, [
            el('span.rep-label.wide', label),
            bar,
            el('span.rep-pct.cond', isFresh ? 'NEW' : `${Math.round(h * 100)}%`),
            el('span.rep-ctl', [minus, el('span.rep-n.cond', careerMode ? (n ? money(n * unit) : '') : n ? `${n}` : '0'), plus]),
          ]),
          { activate: () => void add(1), adjust: (d) => (add(d), true), focus: () => setHover(null) },
        );
        return row;
      };
      body.append(el('div.opt-sub.kicker', 'Armor'));
      for (const f of FACETS) body.append(mk(`f:${f}`, FACET_LABEL[f]));
      body.append(el('div.opt-sub.kicker', 'Insides'));
      for (const c of COMPONENTS) body.append(mk(`c:${c}`, COMPONENT_LABEL[c]));
      const fixAll = button('Fix the worst first', {
        cls: 'small',
        activate: () => {
          let used = 0;
          for (;;) {
            if (budget() - spent(cur) < unit) break;
            const keys: RepairKey[] = [...COMPONENTS.map((c) => `c:${c}` as RepairKey), ...FACETS.map((f) => `f:${f}` as RepairKey)];
            const worst = keys.filter((k) => !fresh(cur, k) && health(cur, k) < 1).sort((a, b) => health(cur, a) - health(cur, b))[0];
            if (!worst) break;
            steps.set(worst, (steps.get(worst) ?? 0) + 1);
            used++;
          }
          ctx.sfx.ui(used ? 'repair' : 'error');
          preview();
          renderAll('fixall');
        },
      });
      fixAll.dataset.key = 'fixall';
      const clear = careerMode && steps.size
        ? button('Undo', {
            cls: 'small',
            activate: () => {
              steps.clear();
              ctx.sfx.ui('back');
              preview();
              renderAll('fixall');
            },
          })
        : null;
      if (clear) clear.dataset.key = 'repclear';
      body.append(
        el('div.rep-foot', [
          fixAll,
          clear,
          careerMode ? el('div.rep-total', [el('span.kicker', 'Repairs'), el('span.cond', money(repairCost(cur) * unit))]) : null,
        ]),
      );
    };

    // ---- meter, stats, warnings
    const drawMeter = () => {
      const check = checkLoadout(cur);
      const limit = check.limitLb;
      const w = check.weightLb;
      const over = w > limit + 1e-6;
      wNum.textContent = w.toFixed(1);
      wLimit.textContent = `/ ${limit} lb`;
      wState.textContent = over ? 'Overweight' : `${(limit - w).toFixed(1)} lb spare`;
      meter.classList.toggle('over', over);
      wBar.replaceChildren();
      wLegend.replaceChildren();
      const scale = Math.max(limit * 1.12, w);
      const lines = weightBreakdown(cur);
      lines.forEach((ln, i) => {
        const seg = el('div.wm-seg', { style: `width:${((ln.lb / scale) * 100).toFixed(2)}%;--c:${WEIGHT_COLORS[i % WEIGHT_COLORS.length]}`, title: `${ln.label} ${ln.lb.toFixed(1)} lb` });
        wBar.append(seg);
        if (i < 6) wLegend.append(el('span.wl', { style: `--c:${WEIGHT_COLORS[i % WEIGHT_COLORS.length]}` }, shortLine(ln.label)));
      });
      meter.style.setProperty('--limit', `${((limit / scale) * 100).toFixed(2)}%`);
      if (hover) {
        const hw = loadoutWeight(hover);
        const d = hw - w;
        wDelta.textContent = Math.abs(d) > 0.05 ? `${d > 0 ? '+' : ''}${d.toFixed(1)}` : '';
        wDelta.className = `wm-delta cond ${d > 0 ? 'heavier' : 'lighter'} ${hw > limit ? 'bust' : ''}`;
        wGhost.style.display = Math.abs(d) > 0.05 ? 'block' : 'none';
        const a = Math.min(w, hw) / scale;
        wGhost.style.left = `${a * 100}%`;
        wGhost.style.width = `${(Math.abs(d) / scale) * 100}%`;
        wGhost.className = `wm-ghost ${d > 0 ? 'heavier' : 'lighter'} ${hw > limit ? 'bust' : ''}`;
      } else {
        wDelta.textContent = '';
        wGhost.style.display = 'none';
      }
      if (pts) {
        const left = budget() - spent(cur);
        const hl = hover ? budget() - spent(hover) : left;
        (pts.lastChild as HTMLElement).textContent = hl !== left ? `${left} → ${hl}` : `${left}`;
        pts.classList.toggle('low', left <= 0);
      }
      if (fundsBox) {
        const pending = spent(cur);
        fundsNum.textContent = money(funds - pending);
        fundsNote.textContent = pending > 0 ? `${money(pending)} of repairs` : '';
        fundsBox.classList.toggle('broke', funds - pending <= 0);
      }
    };

    const drawStats = () => {
      const spec = buildSpec(cur);
      const hs = hover ? buildSpec(hover).stats : null;
      statsBox.replaceChildren(
        el('div.gs-head', [el('span.kicker', 'Tale of the tape'), el('span.gs-weapon.cond', spec.stats.weaponLabel === 'None' ? 'No weapon' : spec.stats.weaponLabel)]),
        statBars(spec.stats, cur.cls, hs),
        el('div.flags', [flag('Self-right', spec.stats.selfRight, hs?.selfRight), flag('Invertible', spec.stats.invertible, hs?.invertible)]),
      );
    };
    const flag = (label: string, v: boolean, h?: boolean) => {
      const changed = h !== undefined && h !== v;
      return el(`span.flag${v ? '.yes' : '.no'}${changed ? '.chg' : ''}`, [el('span.flag-dot'), label, changed ? el('span.flag-to', h ? ' → yes' : ' → no') : null]);
    };

    const drawWarn = () => {
      const check = checkLoadout(cur);
      const spec = buildSpec(cur);
      warn.replaceChildren(
        ...check.problems.map((p) => el('div.w.bad', [el('span.w-ico', '!'), p])),
        ...advice(spec).slice(0, check.problems.length ? 1 : 2).map((p) => el('div.w.tip', [el('span.w-ico', 'i'), p])),
      );
      doneBtn.classList.toggle('blocked', !check.ok);
    };

    const drawLeft = () => {
      nameBig.textContent = cur.name || 'Unnamed';
      classLine.textContent = `${CLASS_LABEL[cur.cls]}  ${CLASS_LIMIT_LB[cur.cls]} lb limit`;
    };

    const renderAll = (keep: string | null) => {
      const k = keep ?? focusKey();
      renderTabs();
      renderBody();
      drawMeter();
      drawStats();
      drawWarn();
      drawLeft();
      drawCoach();
      if (guided.length) doneBtn.classList.toggle('is-disabled', missing().length > 0);
      if (scope) scope.refresh(byKey(k));
    };
    const bump = (e: HTMLElement) => replay(e, 'bump');

    // ---- exit
    const showToast = (t: string) => {
      toast.textContent = t;
      replay(toast, 'show');
    };
    const finish = (ok: boolean) => {
      if (done) return;
      if (ok) {
        const check = checkLoadout(cur);
        if (!check.ok) {
          ctx.sfx.ui('error');
          replay(warn, 'shake');
          replay(doneBtn, 'shake');
          showToast(check.problems[0]);
          return;
        }
        if ((pits || careerMode) && spent(cur) > budget()) {
          ctx.sfx.ui('error');
          showToast(pits ? 'Not enough repair points' : 'Not enough cash for those repairs');
          return;
        }
        if (missing().length) {
          ctx.sfx.ui('error');
          showToast(GUIDE_TEXT[missing()[0]] + ' first');
          return;
        }
        ctx.sfx.ui('select');
        ctx.sfx.sting('whoosh');
      }
      done = true;
      clearTimeout(previewTimer);
      ctx.nav.pop(scope);
      if (ok) ctx.mine = cur;
      else ctx.mine = orig;
      const result = (): GarageResult => {
        if (careerMode) return { loadout: clone(cur), damage: effectiveDamage(cur), funds: funds - spent(cur), bought: [...bought] };
        return { loadout: clone(cur), damage: pits ? effectiveDamage(cur) : g.damage };
      };
      void exit(node, 260).then(() => resolve(ok ? result() : null));
    };
    const changed = () => JSON.stringify(cur) !== JSON.stringify(orig) || steps.size > 0;
    const onBack = () => {
      const active = document.activeElement as HTMLElement | null;
      if (active?.tagName === 'INPUT') return active.blur();
      if (scope.focused && body.contains(scope.focused)) {
        // First back leaves the list for the tabs.
        scope.focus(byKey(`tab:${tab}`));
        return;
      }
      if (guided.length) {
        // The first rebuild has no way out but Done.
        ctx.sfx.ui('error');
        showToast(missing().length ? GUIDE_TEXT[missing()[0]] : 'Hit Done to roll it out');
        return;
      }
      if (changed() && !backArmed) {
        backArmed = true;
        ctx.sfx.ui('error');
        showToast('Unsaved changes. Back again to throw them out.');
        return;
      }
      finish(false);
    };

    scope = ctx.nav.push({
      root: node,
      back: onBack,
      tab: (d) => {
        const i = tabs.indexOf(tab);
        switchTab(tabs[(i + d + tabs.length) % tabs.length], true);
      },
      onFocus: (e) => {
        if (!body.contains(e)) setHover(null);
      },
    });
    renderAll(null);
    scope.refresh(body.querySelector<HTMLElement>('.opt.sel') ?? body.querySelector<HTMLElement>('.nav'));
    slamFx(node, panel, 'left', 18);
    preview();
  });
}

function shortLine(label: string): string {
  if (label.startsWith('Radio')) return 'Radio';
  if (label.endsWith('armor')) return 'Armor';
  return label.replace('Low-profile ', '').replace(' motors', '').replace('Sealed ', '').replace(' packs', '');
}
