// Continuous robot voices: drive motors, spinner siren and whoom, lifter gearmotor, fire and
// smoke. All nodes are made once per entrant; frame() only moves AudioParams.

import type { BotFrame, BotSpec, DriveId, SpinnerKind } from '../contract';
import type { Bank } from './bank';
import { clamp, noiseBuffer } from './dsp';
import type { Placement } from './spatial';

interface MotorVoice {
  /** Whine frequency at rest and the added span at full speed (Hz). */
  base: number;
  span: number;
  wave: OscillatorType;
  q: number;
  level: number;
  /** Gear mesh tone as a ratio of the whine. */
  gear: number;
  gearLevel: number;
  /** Brush and gear noise level and its center. */
  noise: number;
  noiseF: number;
  /** Rattle rate as a ratio of the whine (chain and gear lash). */
  rattle: number;
}

const MOTORS: Record<DriveId, MotorVoice> = {
  // Cordless drill motors: thin, buzzy, high.
  drill2: { base: 420, span: 1500, wave: 'square', q: 4, level: 0.4, gear: 0.5, gearLevel: 0.35, noise: 0.25, noiseF: 3500, rattle: 0.06 },
  // Magmotors: high and angry, lots of brush noise.
  mag2: { base: 330, span: 1350, wave: 'sawtooth', q: 2.5, level: 0.55, gear: 0.25, gearLevel: 0.3, noise: 0.4, noiseF: 2600, rattle: 0.05 },
  // Wheelchair motors: deep worm-gear growl.
  chair4: { base: 85, span: 270, wave: 'sawtooth', q: 1.4, level: 0.6, gear: 2.8, gearLevel: 0.45, noise: 0.45, noiseF: 900, rattle: 0.11 },
  // Chain-driven six wheeler: low and rattly.
  skid6: { base: 110, span: 320, wave: 'sawtooth', q: 1.4, level: 0.6, gear: 2.2, gearLevel: 0.35, noise: 0.55, noiseF: 1300, rattle: 0.2 },
};

interface SpinVoice {
  /** Siren pitch as a multiple of the tooth-pass rate. */
  mult: number;
  /** Whoom noise band. */
  band: number;
  level: number;
  whoom: number;
}

const SPINNERS: Record<SpinnerKind, SpinVoice> = {
  vdisk: { mult: 4, band: 700, level: 0.55, whoom: 0.5 },
  drum: { mult: 5.5, band: 1400, level: 0.55, whoom: 0.35 },
  hbar: { mult: 4, band: 420, level: 0.5, whoom: 0.75 },
  shell: { mult: 6, band: 260, level: 0.45, whoom: 0.95 },
};

/** Robot voices sit well under impacts: a motor is a bed, a hit is an event. */
const ROBOT_TRIM = 0.27;

const isSpinner = (k: string): k is SpinnerKind => k === 'vdisk' || k === 'drum' || k === 'hbar' || k === 'shell';

export class RobotVoice {
  readonly out: GainNode;
  private pan: StereoPannerNode;
  private air: BiquadFilterNode;
  private send: GainNode;
  // drive
  private whine: OscillatorNode;
  private whineBP: BiquadFilterNode;
  private gear: OscillatorNode;
  private driveG: GainNode;
  private brush: AudioBufferSourceNode;
  private brushBP: BiquadFilterNode;
  private rattle: OscillatorNode;
  // spinner
  private siren?: OscillatorNode;
  private siren2?: OscillatorNode;
  private sirenLP?: BiquadFilterNode;
  private spinG?: GainNode;
  private whoomLFO?: OscillatorNode;
  private whoomBP?: BiquadFilterNode;
  private whoomG?: GainNode;
  // lifter
  private lift?: OscillatorNode;
  private liftG?: GainNode;
  // fire and smoke loops, made when needed
  private fire?: { src: AudioBufferSourceNode; g: GainNode };
  private smoke?: { src: AudioBufferSourceNode; g: GainNode };
  private lastSpin: number[] | null = null;
  private lastArm = 0;
  private motor: MotorVoice;
  private spin?: SpinVoice;
  private pitch: number;
  private all: AudioScheduledSourceNode[] = [];

  constructor(
    private ctx: BaseAudioContext,
    private bank: Bank,
    readonly id: string,
    readonly spec: BotSpec,
    dest: AudioNode,
    hall: AudioNode,
  ) {
    const t = ctx.currentTime;
    const g = (v = 0) => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };
    const f = (type: BiquadFilterType, freq: number, q = 0.7) => {
      const n = ctx.createBiquadFilter();
      n.type = type;
      n.frequency.value = freq;
      n.Q.value = q;
      return n;
    };
    const o = (type: OscillatorType, freq: number) => {
      const n = ctx.createOscillator();
      n.type = type;
      n.frequency.value = freq;
      n.start(t);
      this.all.push(n);
      return n;
    };
    this.motor = MOTORS[spec.loadout.drive];
    // Smaller robots spin smaller motors faster.
    this.pitch = 1 / Math.sqrt(Math.max(0.4, spec.scale));
    this.out = g(1);
    this.air = f('lowpass', 16000, 0.5);
    this.pan = ctx.createStereoPanner();
    this.send = g(0.12);
    this.out.connect(this.air).connect(this.pan).connect(dest);
    this.pan.connect(this.send).connect(hall);

    // Drive: commutator whine, gear mesh, brush and gear noise with lash rattle.
    const m = this.motor;
    this.driveG = g(0);
    this.driveG.connect(this.out);
    this.whine = o(m.wave, m.base);
    this.whineBP = f('bandpass', m.base * 2, m.q);
    const whineG = g(0.5);
    this.whine.connect(this.whineBP).connect(whineG).connect(this.driveG);
    this.gear = o('triangle', m.base * m.gear);
    const gearG = g(m.gearLevel);
    this.gear.connect(gearG).connect(this.driveG);
    this.brush = ctx.createBufferSource();
    this.brush.buffer = noiseBuffer(ctx, 'white');
    this.brush.loop = true;
    this.brush.start(t, Math.random() * 1.5);
    this.all.push(this.brush);
    this.brushBP = f('bandpass', m.noiseF, 1.2);
    const brushG = g(m.noise * 0.5);
    this.brush.connect(this.brushBP).connect(brushG).connect(this.driveG);
    // Gear lash: amplitude modulation of the noise.
    this.rattle = o('square', 20);
    const depth = g(m.noise * 0.45);
    this.rattle.connect(depth).connect(brushG.gain);

    const w = spec.weapon;
    if (isSpinner(w.kind)) {
      const sv = SPINNERS[w.kind];
      this.spin = sv;
      this.spinG = g(0);
      this.spinG.connect(this.out);
      this.siren = o('sawtooth', 40);
      this.siren2 = o('triangle', 80);
      this.sirenLP = f('lowpass', 2000, 3);
      const s2g = g(0.35);
      this.siren.connect(this.sirenLP);
      this.siren2.connect(s2g).connect(this.sirenLP);
      const sg = g(0.45);
      this.sirenLP.connect(sg).connect(this.spinG);
      // Whoom: noise band chopped at the tooth-pass rate.
      const wn = ctx.createBufferSource();
      wn.buffer = noiseBuffer(ctx, 'pink');
      wn.loop = true;
      wn.start(t, Math.random() * 1.5);
      this.all.push(wn);
      this.whoomBP = f('bandpass', sv.band, 1.3);
      this.whoomG = g(sv.whoom * 0.5);
      wn.connect(this.whoomBP).connect(this.whoomG).connect(this.spinG);
      this.whoomLFO = o('sine', 2);
      const wd = g(sv.whoom * 0.5);
      this.whoomLFO.connect(wd).connect(this.whoomG.gain);
    }
    if (w.kind === 'lifter') {
      this.lift = o('sawtooth', 70);
      this.liftG = g(0);
      this.lift.connect(f('lowpass', 900, 2)).connect(this.liftG).connect(this.out);
    }
  }

  /** Update from the latest frame. `rate` is the slow-motion pitch factor. */
  update(b: BotFrame, dt: number, place: Placement, rate: number, active: boolean): void {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const k = 0.04;
    const spec = this.spec;
    const set = (p: AudioParam, v: number, tc = k) => p.setTargetAtTime(v, t, tc);

    set(this.pan.pan, place.pan, 0.03);
    set(this.out.gain, active ? place.gain * ROBOT_TRIM : 0, 0.05);
    set(this.air.frequency, place.lp, 0.1);

    // Wheel speed from the rolling angle (falls back to body speed).
    let wheel01 = 0;
    const ws = b.wheelSpin;
    if (this.lastSpin && this.lastSpin.length === ws.length && dt > 1e-4) {
      let sum = 0;
      let n = 0;
      for (let i = 0; i < ws.length; i++) {
        const d = Math.abs(ws[i] - this.lastSpin[i]);
        if (d < 60 && !b.wheelLost[i]) {
          sum += d;
          n++;
        }
      }
      const r = spec.wheels[0]?.radius ?? 0.1;
      if (n) wheel01 = (sum / n / dt) * r / Math.max(0.5, spec.stats.topSpeed);
    }
    this.lastSpin = ws.slice();
    if (!wheel01) wheel01 = Math.hypot(b.vel.x, b.vel.z) / Math.max(0.5, spec.stats.topSpeed);
    const effort = (Math.abs(b.driveL) + Math.abs(b.driveR)) / 2;
    const contact = b.wheelContact.some((c) => c);
    // Off the floor the motors free-wheel up to the speed the stick asks for.
    const speed = clamp(contact ? wheel01 : Math.max(wheel01, effort), 0, 1.3);
    const alive = !b.disabled && b.charge > 0;
    const driveHealth = Math.min(1, (b.parts.driveL + b.parts.driveR) / 2 + 0.3);
    const m = this.motor;
    const p = this.pitch * rate;
    const fw = (m.base + m.span * speed) * p * (0.9 + 0.1 * b.charge);
    set(this.whine.frequency, fw);
    set(this.whineBP.frequency, Math.min(9000, fw * 2.2));
    set(this.gear.frequency, fw * m.gear);
    set(this.rattle.frequency, Math.max(4, fw * m.rattle));
    set(this.brushBP.frequency, m.noiseF * (0.8 + 0.4 * speed) * p);
    // Load: pushing hard at low speed is louder and rougher than cruising.
    const strain = clamp(effort - speed, 0, 1);
    const lvl = alive ? m.level * clamp(0.04 + 0.55 * speed + 0.45 * effort + 0.3 * strain, 0, 1.2) * driveHealth : 0;
    set(this.driveG.gain, lvl, 0.05);

    // Spinner.
    const w = spec.weapon;
    if (this.spin && this.siren && 'teeth' in w) {
      const sv = this.spin;
      const s01 = clamp(b.weapon.spin01, 0, 1);
      const tooth = (Math.max(0, b.weapon.rpm) / 60) * Math.max(1, w.teeth);
      const fs = Math.max(20, tooth * sv.mult * rate);
      set(this.siren.frequency, fs, 0.05);
      set(this.siren2!.frequency, fs * 2.01, 0.05);
      set(this.sirenLP!.frequency, Math.min(9000, 600 + fs * 4), 0.05);
      set(this.whoomLFO!.frequency, Math.max(0.5, tooth * rate), 0.05);
      set(this.whoomBP!.frequency, sv.band * (0.7 + 0.6 * s01) * rate, 0.1);
      const wl = s01 < 0.01 ? 0 : sv.level * Math.pow(s01, 1.3) * (b.parts.weapon > 0 ? 1 : 0.4);
      set(this.spinG!.gain, wl, 0.06);
    }

    // Lifter gearmotor while the arm moves.
    if (this.lift && this.liftG) {
      const v = dt > 1e-4 ? Math.abs(b.weapon.arm - this.lastArm) / dt : 0;
      set(this.lift.frequency, (65 + 50 * clamp(v, 0, 2)) * this.pitch * rate);
      set(this.liftG.gain, alive && v > 0.03 ? 0.35 : 0, 0.04);
    }
    this.lastArm = b.weapon.arm;

    // Fire and smoke.
    this.loopLayer('fire', b.fire * 0.7, rate);
    this.loopLayer('smoke', b.smoke * 0.22, rate);
  }

  private loopLayer(kind: 'fire' | 'smoke', level: number, rate: number): void {
    const t = this.ctx.currentTime;
    let l = this[kind];
    if (!l && level > 0.01) {
      const buf = this.bank.get(`${kind}.loop`);
      if (!buf) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      src.connect(g).connect(this.out);
      src.start(t, Math.random() * buf.duration);
      l = this[kind] = { src, g };
    }
    if (!l) return;
    l.g.gain.setTargetAtTime(level, t, 0.2);
    l.src.playbackRate.setTargetAtTime(rate, t, 0.05);
  }

  /** Fade everything out (world inactive or robot removed). */
  silence(): void {
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.05);
  }

  dispose(): void {
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.02);
    for (const n of this.all) n.stop(t + 0.15);
    this.fire?.src.stop(t + 0.15);
    this.smoke?.src.stop(t + 0.15);
    setTimeout(() => {
      try {
        this.pan.disconnect();
      } catch {
        /* gone */
      }
    }, 300);
  }
}
