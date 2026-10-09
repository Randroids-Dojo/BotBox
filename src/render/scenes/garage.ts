// Garage: the workshop the player lives in, and the robot on a turntable in the middle of it.
// Four tiers (a storage unit, a real garage, a sponsored shop, a pro facility) are built once and
// toggled; they share one light rig that each tier re-tunes, so switching never recompiles a
// shader. The robot is framed in the left 60 percent of a landscape screen (the parts panel
// takes the right 40) and in the top 40 percent of a portrait one (the panel is a bottom sheet).
// During the first rebuild, parts not fitted yet are left off and pop on when they arrive.

import * as THREE from 'three';
import type { BotFrame, BotSpec, Component, Facet } from '../../contract';
import { createBotView, setMissingParts, type MissingPart } from '../bots';
import { Pose } from '../camera';
import type { BotView, Quality } from '../types';
import { restingFrame } from './trophy';
import { createKit, type GarageLights, type TierLook, type WorkshopTier } from './workshop/common';
import { buildHomeGarage } from './workshop/homegarage';
import { buildProFacility } from './workshop/pro';
import { buildShop } from './workshop/shop';
import { buildStorageUnit } from './workshop/storage';

export type WorkshopTierId = 0 | 1 | 2 | 3;

const _d = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class GarageScene {
  readonly scene = new THREE.Scene();
  readonly pose = new Pose();
  private view: BotView | null = null;
  private frame: BotFrame | null = null;
  private turntable = new THREE.Group();
  private spin = 0;
  private yaw = 0.6;
  private pitch = 0.14;
  private size = 1;
  private center = new THREE.Vector3(0, 0.3, 0);
  private lights: GarageLights;
  private tiers: WorkshopTier[];
  private tier: WorkshopTierId = 2;
  private missing = new Set<MissingPart>();
  private teamName = 'YOUR ROBOT';

  constructor(private env: THREE.Texture, private quality: () => Quality) {
    const s = this.scene;
    s.background = new THREE.Color();
    s.environment = env;
    s.fog = new THREE.Fog(0x0a0806, 9, 20);
    const kit = createKit(env);

    // One rig for every tier: the count never changes, only positions, colors and intensities.
    const key = new THREE.SpotLight(0xffffff, 1, 0, 0.9, 0.6, 2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.camera.near = 0.3;
    key.shadow.camera.far = 14;
    this.lights = {
      hemi: new THREE.HemisphereLight(0xffffff, 0x000000, 0.3),
      key,
      rim: new THREE.DirectionalLight(0xffffff, 1),
      fillA: new THREE.PointLight(0xffffff, 1, 6, 2),
      fillB: new THREE.PointLight(0xffffff, 1, 6, 2),
      prac: new THREE.PointLight(0xffffff, 1, 3, 2),
    };
    const L = this.lights;
    s.add(L.hemi, L.key, L.key.target, L.rim, L.fillA, L.fillB, L.prac);

    this.tiers = [buildStorageUnit(kit), buildHomeGarage(kit), buildShop(kit), buildProFacility(kit)];
    for (const t of this.tiers) {
      s.add(t.root);
      this.turntable.add(t.top);
    }
    s.add(this.turntable);
    this.applyTier(2);
  }

  /** Show every tier at once so a renderer compile covers all their materials. */
  showAll(on: boolean): void {
    if (on) for (const t of this.tiers) t.root.visible = t.top.visible = true;
    else this.applyTier(this.tier);
  }

  get currentTier(): WorkshopTierId {
    return this.tier;
  }

  setTier(t: WorkshopTierId): void {
    if (t === this.tier) return;
    this.applyTier(t);
    // A new room gets its own opening angle.
    this.yaw = this.look.yaw;
    this.pitch = this.look.pitch;
  }

  private get look(): TierLook {
    return this.tiers[this.tier].look;
  }

  private applyTier(t: WorkshopTierId): void {
    this.tier = t;
    this.tiers.forEach((x, i) => (x.root.visible = x.top.visible = i === t));
    const k = this.look;
    const s = this.scene;
    (s.background as THREE.Color).set(k.background);
    const fog = s.fog as THREE.Fog;
    fog.color.set(k.fog[0]);
    fog.near = k.fog[1];
    fog.far = k.fog[2];
    s.environmentIntensity = k.env;
    const L = this.lights;
    L.hemi.color.set(k.hemi[0]);
    L.hemi.groundColor.set(k.hemi[1]);
    L.hemi.intensity = k.hemi[2];
    L.key.position.set(...k.key.pos);
    L.key.target.position.set(...k.key.target);
    L.key.color.set(k.key.color);
    L.key.intensity = k.key.intensity;
    L.key.angle = k.key.angle;
    L.key.penumbra = k.key.penumbra;
    L.key.distance = k.key.distance;
    L.key.decay = k.key.decay;
    // Keep the shadow frustum tight around the robot even under a wide bulb cone.
    L.key.shadow.focus = Math.min(1, 0.75 / k.key.angle);
    L.rim.position.set(...k.rim.pos);
    L.rim.color.set(k.rim.color);
    L.rim.intensity = k.rim.intensity;
    for (const [light, p] of [
      [L.fillA, k.fillA],
      [L.fillB, k.fillB],
      [L.prac, k.prac],
    ] as const) {
      light.position.set(...p.pos);
      light.color.set(p.color);
      light.intensity = p.intensity;
      light.distance = p.distance;
      light.decay = p.decay;
    }
    this.tiers[t].setName?.(this.teamName);
  }

  setRobot(
    spec: BotSpec,
    damage?: { facets: Record<Facet, number>; parts: Record<Component, number> },
    opts?: { tier?: WorkshopTierId; missing?: MissingPart[] },
  ): void {
    this.setTier(opts?.tier ?? 2);
    const fresh = !this.view || this.view.spec !== spec;
    if (this.view && fresh) {
      this.turntable.remove(this.view.root);
      this.view.dispose();
      this.view = null;
    }
    if (!this.view) {
      this.view = createBotView(spec, { envMap: this.env, quality: this.quality() });
      this.turntable.add(this.view.root);
      // A rebuilt view starts from what was missing before, so new parts still pop on.
      setMissingParts(this.view, [...this.missing], false);
      this.shadows(this.view.root);
    }
    const missing = opts?.missing ?? [];
    setMissingParts(this.view, missing, true);
    // The garage's split internals are new meshes: give them shadows too.
    if (fresh) this.shadows(this.view.root);
    this.missing = new Set(missing);
    this.frame = restingFrame(spec, { x: 0, y: 0.23, z: 0 }, 0);
    if (damage) {
      Object.assign(this.frame.facets, damage.facets);
      Object.assign(this.frame.parts, damage.parts);
      const minPart = Math.min(...Object.values(damage.parts));
      this.frame.smoke = minPart < 0.35 ? 1 - minPart / 0.35 : 0;
    }
    this.size = Math.max(spec.length, spec.width, spec.height * 1.4);
    this.center.set(0, 0.23 + spec.height * 0.45, 0);
    this.teamName = spec.loadout.name || 'ROOKIE';
    this.tiers[this.tier].setName?.(this.teamName);
  }

  private shadows(o: THREE.Object3D): void {
    o.traverse((m) => {
      if (m instanceof THREE.Mesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
  }

  orbit(dx: number, dy: number): void {
    this.yaw -= dx * 0.006;
    this.pitch = Math.max(0.04, Math.min(1.05, this.pitch + dy * 0.004));
  }

  update(time: number, dt: number, cam: THREE.PerspectiveCamera): void {
    this.spin += dt * 0.25;
    this.turntable.rotation.y = this.spin;
    if (this.view && this.frame) this.view.update(this.frame, dt);
    this.tiers[this.tier].update?.(time, dt, this.lights);
    this.frameRobot(cam.aspect);
  }

  /** Fit the robot in the free part of the screen, inside the room when the room allows. */
  private frameRobot(aspect: number): void {
    const k = this.look;
    const portrait = aspect < 1;
    // Fractions of the half extents the robot may fill, and where its center sits (NDC).
    const fitH = portrait ? 0.86 : 0.6;
    const fitV = portrait ? 0.34 : 0.82;
    const ndcX = portrait ? 0 : -0.4;
    const ndcY = portrait ? 0.6 : (k.aimY ?? 0.28);
    const r = this.size * 0.62 + 0.15;
    let fov = portrait ? Math.max(k.fov, 44) : k.fov;
    let tanV = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
    let dist = Math.max(1.7, r / (fitH * tanV * aspect), r / (fitV * tanV));
    if (dist > k.maxDist) {
      // Widen the lens rather than back out through a wall.
      dist = k.maxDist;
      tanV = Math.min(Math.tan(THREE.MathUtils.degToRad(80) / 2), Math.max(r / (fitV * dist), r / (fitH * aspect * dist)));
      fov = THREE.MathUtils.radToDeg(2 * Math.atan(tanV));
      dist = Math.max(1.7, r / (fitH * tanV * aspect), r / (fitV * tanV));
    }
    const p = this.pose;
    p.pos.set(Math.sin(this.yaw) * Math.cos(this.pitch) * dist, Math.sin(this.pitch) * dist, Math.cos(this.yaw) * Math.cos(this.pitch) * dist);
    p.pos.add(this.center);
    // Aim away from the robot so it lands at (ndcX, ndcY) on screen.
    _d.subVectors(this.center, p.pos).normalize();
    _r.crossVectors(_d, UP).normalize();
    _u.crossVectors(_r, _d).normalize();
    p.target.copy(this.center);
    p.target.addScaledVector(_r, -ndcX * dist * tanV * aspect);
    p.target.addScaledVector(_u, -ndcY * dist * tanV);
    p.fov = fov;
    p.roll = 0;
  }
}
