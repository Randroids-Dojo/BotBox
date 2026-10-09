// Title: a slow flyover of the dark Box with the chrome logo hung in front of the camera.
// Hazards cycle on their own and the saws throw sparks for ambience. The lower third of the
// frame stays clear for the PRESS START line.

import * as THREE from 'three';
import type { HazardFrame, MatchEvent, WorldFrame } from '../../contract';
import { KILLSAWS, PULVERIZERS, RAMRODS, SPIKESTRIPS } from '../../data/arena';
import { Pose } from '../camera';
import { buildLogo, type Logo } from './logo';

const _f = new THREE.Vector3();
const _u = new THREE.Vector3();
const _r = new THREE.Vector3();

export class TitleScene {
  readonly root = new THREE.Group();
  readonly logo: Logo;
  readonly pose = new Pose();
  readonly hazards: HazardFrame[];
  private timers = new Map<string, number>();
  private lastGrind = 0;
  readonly world: WorldFrame;

  constructor(chromeEnv: THREE.Texture) {
    this.logo = buildLogo(chromeEnv);
    this.root.add(this.logo.root);
    this.root.name = 'title';
    this.hazards = [
      ...PULVERIZERS.map((p) => ({ id: p.id, kind: 'pulverizer' as const, state: 0, spin: 0, warn: false })),
      ...KILLSAWS.map((k) => ({ id: k.id, kind: 'killsaw' as const, state: 0, spin: 0, warn: false })),
      ...RAMRODS.map((r) => ({ id: r.id, kind: 'ramrod' as const, state: 0, spin: 0, warn: false })),
      ...SPIKESTRIPS.map((s) => ({ id: s.id, kind: 'spikestrip' as const, state: 1, spin: 0, warn: false })),
    ];
    this.hazards.forEach((h, i) => this.timers.set(h.id, 2 + i * 1.7));
    this.world = { t: 0, bots: [], debris: [], hazards: this.hazards, match: { phase: 'idle', clock: 180, lights: 0, timeScale: 1 } };
  }

  /** Advance the camera path, logo and ambient hazards. Returns fx events to emit. */
  update(time: number, dt: number, _aspect: number, out: MatchEvent[]): void {
    // Camera: a slow drift inside the dark Box, looking across the floor at the far wall and
    // the crowd, rising and dipping under the beams.
    const a = time * 0.045 + 0.5;
    const r = 4.9 + Math.sin(time * 0.07) * 0.5;
    const y = 2.3 + Math.sin(time * 0.09) * 0.6;
    this.pose.pos.set(Math.sin(a) * r, y, Math.cos(a) * r);
    this.pose.target.set(-Math.sin(a + 0.45) * 4.5, 1.9, -Math.cos(a + 0.45) * 4.5);
    this.pose.fov = 52;
    this.pose.roll = Math.sin(time * 0.11) * 0.02;
    this.world.t = time;

    // Hazards: saws rise and spin, hammers slam, ramrods punch, at a lazy pace.
    for (const h of this.hazards) {
      if (h.kind === 'spikestrip') continue;
      let t = (this.timers.get(h.id) ?? 3) - dt;
      if (h.kind === 'killsaw') h.spin += dt * 45;
      h.warn = t < 0.9 && t > -2.5;
      if (t <= 0) {
        h.state = Math.min(1, h.state + dt * (h.kind === 'pulverizer' ? 4 : 3));
        if (h.kind === 'killsaw' && time - this.lastGrind > 0.08) {
          const s = KILLSAWS.find((k) => k.id === h.id)!;
          this.lastGrind = time;
          out.push({ type: 'grind', t: time, point: { x: s.center.x, y: 0.05, z: s.center.z - 0.35 }, dir: { x: 0, y: 0.6, z: -1 }, intensity: 0.7, material: 'steel' });
        }
        if (t < -2.8) {
          h.state = 0;
          t = 4 + ((h.id.length * 7.3 + time) % 9);
        }
      }
      this.timers.set(h.id, t);
    }
  }

  /** Hang the logo in the upper part of the frame, facing the camera with a gentle sway. */
  placeLogo(cam: THREE.PerspectiveCamera, time: number): void {
    this.logo.update(time);
    const d = 3.4;
    cam.getWorldDirection(_f);
    _u.copy(cam.up).applyQuaternion(cam.quaternion);
    _r.crossVectors(_f, _u).normalize();
    _u.crossVectors(_r, _f).normalize();
    const halfH = d * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const halfW = halfH * cam.aspect;
    const s = Math.min((halfW * 1.5) / this.logo.width, halfH * 0.7);
    const g = this.logo.root;
    g.scale.setScalar(s);
    g.position.copy(cam.position).addScaledVector(_f, d).addScaledVector(_u, halfH * 0.3);
    g.quaternion.copy(cam.quaternion);
    g.rotateY(Math.sin(time * 0.4) * 0.16);
    g.rotateX(Math.sin(time * 0.3) * 0.05 - 0.04);
  }
}
