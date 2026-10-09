// Bus graph and master chain.
//
//   world sources ─▶ worldIn ─┐                    (motors, impacts, hazards)
//   hall sends ───▶ hall ─────┤
//                             ▼
//                     worldLP (slow motion) ─▶ worldGate (setWorldActive) ─▶ sfxVol ─┐
//   crowd ─▶ crowdLP ─▶ crowdDuck ─▶ crowdGate ─────────────────────────────▶ sfxVol ─┤
//   music cues ─▶ musicDuck ─▶ musicGlue ─▶ musicVol ────────────────────────────────┤
//   voice chains ─▶ voiceVol ────────────────────────────────────────────────────────┤
//   stingers, ui ─▶ uiVol ───────────────────────────────────────────────────────────┤
//                                                                                     ▼
//                               master ─▶ glue comp ─▶ limiter ─▶ safety clip ─▶ out

import { dbToGain, makeImpulse, safetyCurve } from './dsp';

export class Mixer {
  readonly master: GainNode;
  readonly worldIn: GainNode;
  readonly hallIn: GainNode;
  readonly worldLP: BiquadFilterNode;
  readonly worldGate: GainNode;
  readonly crowdIn: GainNode;
  readonly crowdLP: BiquadFilterNode;
  readonly crowdDuck: GainNode;
  readonly crowdGate: GainNode;
  readonly musicIn: GainNode;
  readonly musicDuck: GainNode;
  readonly voiceIn: GainNode;
  readonly uiIn: GainNode;
  private sfxVol: GainNode;
  private musicVol: GainNode;
  private voiceVol: GainNode;
  private uiVol: GainNode;
  readonly limiter: DynamicsCompressorNode;
  readonly glue: DynamicsCompressorNode;

  constructor(readonly ctx: BaseAudioContext, out: AudioNode = ctx.destination) {
    const g = (v = 1) => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };
    this.master = g(0.9);
    this.glue = ctx.createDynamicsCompressor();
    this.glue.threshold.value = -12;
    this.glue.knee.value = 8;
    this.glue.ratio.value = 2;
    this.glue.attack.value = 0.012;
    this.glue.release.value = 0.25;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -3;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.12;
    const makeup = g(1);
    const safety = ctx.createWaveShaper();
    safety.curve = safetyCurve(0.8);
    // The limiter has a few ms of lookahead; the shaper catches anything faster.
    // DC and subsonic blocker in front of the dynamics.
    const dcBlock = ctx.createBiquadFilter();
    dcBlock.type = 'highpass';
    dcBlock.frequency.value = 22;
    dcBlock.Q.value = 0.6;
    this.master.connect(dcBlock).connect(this.glue).connect(this.limiter).connect(makeup).connect(safety).connect(out);

    this.sfxVol = g(1);
    this.musicVol = g(1);
    this.voiceVol = g(1);
    this.uiVol = g(1);
    for (const n of [this.sfxVol, this.musicVol, this.voiceVol, this.uiVol]) n.connect(this.master);

    // World.
    this.worldIn = g(1);
    this.hallIn = g(1);
    this.worldLP = ctx.createBiquadFilter();
    this.worldLP.type = 'lowpass';
    this.worldLP.frequency.value = 20000;
    this.worldLP.Q.value = 0.6;
    this.worldGate = g(1);
    const hall = ctx.createConvolver();
    hall.buffer = makeImpulse(ctx, { seconds: 2.4, decay: 2.0, preDelay: 0.03, seed: 9, damp: 0.6 });
    const hallWet = g(0.5);
    this.hall = hall;
    this.worldIn.connect(this.worldLP);
    this.hallIn.connect(hall).connect(hallWet).connect(this.worldLP);
    this.worldLP.connect(this.worldGate).connect(this.sfxVol);

    // Crowd: its own gate so a scripted crowd can play over an inactive world.
    this.crowdIn = g(0.55);
    this.crowdLP = ctx.createBiquadFilter();
    this.crowdLP.type = 'lowpass';
    this.crowdLP.frequency.value = 3000;
    this.crowdLP.Q.value = 0.5;
    this.crowdDuck = g(1);
    this.crowdGate = g(1);
    const crowdSlow = ctx.createBiquadFilter();
    crowdSlow.type = 'lowpass';
    crowdSlow.frequency.value = 20000;
    this.crowdSlowLP = crowdSlow;
    this.crowdIn.connect(this.crowdLP).connect(crowdSlow).connect(this.crowdDuck).connect(this.crowdGate).connect(this.sfxVol);

    // Music.
    // Cue mixes are written hot; this sets the music bed about 18 dB under full scale.
    this.musicIn = g(dbToGain(-22.5));
    this.musicDuck = g(1);
    const mglue = ctx.createDynamicsCompressor();
    mglue.threshold.value = -24;
    mglue.knee.value = 6;
    mglue.ratio.value = 3;
    mglue.attack.value = 0.008;
    mglue.release.value = 0.18;
    this.musicIn.connect(this.musicDuck).connect(mglue).connect(this.musicVol);

    this.voiceIn = g(1);
    this.voiceIn.connect(this.voiceVol);
    this.uiIn = g(1);
    this.uiIn.connect(this.uiVol);
  }

  readonly crowdSlowLP: BiquadFilterNode;

  private hall!: ConvolverNode;

  detachWorld(): void {
    this.worldIn.disconnect();
    this.hallIn.disconnect();
  }
  attachWorld(): void {
    this.worldIn.connect(this.worldLP);
    this.hallIn.connect(this.hall);
  }
  detachCrowd(): void {
    this.crowdIn.disconnect();
  }
  attachCrowd(): void {
    this.crowdIn.connect(this.crowdLP);
  }

  setVolumes(v: { master: number; music: number; sfx: number; voice: number }): void {
    const t = this.ctx.currentTime;
    const set = (n: GainNode, x: number) => n.gain.setTargetAtTime(Math.max(0, Math.min(1.5, x)), t, 0.03);
    set(this.master, 0.9 * v.master);
    set(this.musicVol, v.music);
    set(this.sfxVol, v.sfx);
    set(this.uiVol, v.sfx);
    set(this.voiceVol, v.voice);
  }

  /** Duck music and crowd while a voice line plays. */
  duck(on: boolean): void {
    const t = this.ctx.currentTime;
    this.musicDuck.gain.setTargetAtTime(on ? dbToGain(-10) : 1, t, on ? 0.05 : 0.25);
    this.crowdDuck.gain.setTargetAtTime(on ? dbToGain(-6) : 1, t, on ? 0.06 : 0.3);
  }
}
