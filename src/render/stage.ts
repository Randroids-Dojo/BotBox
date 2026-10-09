// The Stage: renderer, post, the Box and its crowd, robots, fx and debris, cameras and the TV
// director, and the title, garage and trophy scenes. See src/render/types.ts for the contract.

import * as THREE from 'three';
import type { BotSpec, Component, Corner, Facet, MatchEvent, Quat, Vec3, WorldFrame } from '../contract';
import { BIG_SCREEN } from '../data/arena';
import { buildArena, CROWD_LAYER, type Arena } from './arena';
import { buildChromeEnv, buildGarageEnv } from './arena/env';
import { createBotView } from './bots';
import { BroadcastDirector, CameraSystem, type CamBot, type CamCtx } from './camera';
import { createDebrisLayer, createFxLayer } from './fx';
import { PostPipeline } from './post/pipeline';
import { GarageScene } from './scenes/garage';
import { TitleScene } from './scenes/title';
import { TrophyScene } from './scenes/trophy';
import type { BotView, CameraMode, DebrisLayer, FxLayer, Quality, SceneId, ShotRequest, Stage, StageEntrant } from './types';
import { setMaxAnisotropy } from './util/tex';

interface QualitySpec {
  dpr: number;
  /** Max rendered pixels (width * height). */
  pixels: number;
  screenEvery: number;
  screenRes: [number, number];
}

const QUALITY: Record<Quality, QualitySpec> = {
  high: { dpr: 2, pixels: 2560 * 1440, screenEvery: 2, screenRes: [384, 216] },
  medium: { dpr: 1.5, pixels: 1920 * 1080, screenEvery: 3, screenRes: [320, 180] },
  low: { dpr: 1.25, pixels: 1280 * 640, screenEvery: 4, screenRes: [256, 144] },
};

/** Extra methods beyond the Stage contract. */
export interface StageExtras {
  /** Crowd excitement 0..1 (base level; hits add short bursts on top). */
  crowd(level: number): void;
  /** Draw calls and triangles of the last frame, plus the active camera rig. */
  stats(): { calls: number; triangles: number; rig: string; pixels: [number, number] };
  readonly renderer: THREE.WebGLRenderer;
}

const _q = new THREE.Quaternion();
const _f = new THREE.Vector3();

class StageImpl implements Stage, StageExtras {
  renderer!: THREE.WebGLRenderer;
  private quality: Quality;
  private sceneId: SceneId = 'title';
  private arenaScene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 220);
  private post!: PostPipeline;
  private arena!: Arena;
  private garageScene!: GarageScene;
  private titleScene!: TitleScene;
  private trophyScene!: TrophyScene;
  private botsRoot = new THREE.Group();
  private fx!: FxLayer;
  private debris!: DebrisLayer;
  private views = new Map<string, BotView>();
  private camBots: CamBot[] = [];
  private cams = new CameraSystem();
  private screenCam = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 120);
  private screenDirector = new BroadcastDirector(31, ['floor']);
  private screenRT!: THREE.WebGLRenderTarget;
  private time = 0;
  private frameNo = 0;
  private crowdBase = 0.25;
  private crowdBurst = 0;
  private dressing: 'normal' | 'championship' | 'qualifier' = 'normal';
  private lastStats = { calls: 0, triangles: 0 };
  private titleEvents: MatchEvent[] = [];
  private lastWorld: WorldFrame | null = null;
  private lookup = (id: string) => this.views.get(id);
  private listenerOut = { pos: { x: 0, y: 0, z: 0 } as Vec3, quat: { x: 0, y: 0, z: 0, w: 1 } as Quat };
  private ctx: CamCtx;
  private ready = false;
  /** Frames to skip the big screen feed while shadow maps are rebuilt. */
  private screenHold = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.camera.layers.enable(CROWD_LAYER);
    const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    this.quality = coarse ? 'low' : 'high';
    const bots = this.camBots;
    this.ctx = {
      bots,
      time: 0,
      get: (id) => bots.find((b) => b.id === id),
      player: () => bots.find((b) => b.player),
    };
  }

  async init(onProgress?: (p: number) => void): Promise<void> {
    const p = onProgress ?? (() => {});
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, stencil: false, depth: true, powerPreference: 'high-performance' });
    this.renderer = r;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.NoToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.info.autoReset = false;
    setMaxAnisotropy(r.capabilities.getMaxAnisotropy());
    p(0.05);

    this.arena = await buildArena(r, this.quality, (x) => p(0.05 + x * 0.75));
    const s = this.arenaScene;
    s.add(this.arena.root);
    s.environment = this.arena.env;
    s.environmentIntensity = 0.7;
    s.background = new THREE.Color(0.006, 0.007, 0.011);
    s.fog = new THREE.FogExp2(0x07090d, 0.022);
    this.fx = createFxLayer({ quality: this.quality });
    this.debris = createDebrisLayer();
    s.add(this.botsRoot, this.fx.root, this.debris.root);

    const chrome = buildChromeEnv(r);
    this.titleScene = new TitleScene(chrome);
    s.add(this.titleScene.root);
    this.trophyScene = new TrophyScene(this.arena.env, () => this.quality);
    s.add(this.trophyScene.root);
    this.garageScene = new GarageScene(buildGarageEnv(r), () => this.quality);
    p(0.88);

    this.screenRT = new THREE.WebGLRenderTarget(384, 216, { type: THREE.HalfFloatType, samples: 0 });
    this.arena.stands.screenUniforms.uFeed.value = this.screenRT.texture;

    this.arena.setDressing(this.dressing);
    this.post = new PostPipeline(r, s, this.camera);
    this.applyQuality();
    this.resize();
    this.setScene(this.sceneId);
    // Compile everything up front so the first fight frame does not hitch.
    this.titleScene.root.visible = true;
    this.trophyScene.root.visible = true;
    this.arena.dressing.root.traverse((o) => (o.visible = true));
    await r.compileAsync(s, this.camera);
    this.arena.dressing.set(this.dressing);
    this.arena.dressing.setQuality(this.quality);
    this.garageScene.showAll(true);
    await r.compileAsync(this.garageScene.scene, this.camera);
    this.garageScene.showAll(false);
    this.setScene(this.sceneId);
    this.ready = true;
    p(1);
  }

  setScene(scene: SceneId): void {
    this.sceneId = scene;
    if (!this.arena) return;
    const inArena = scene !== 'garage';
    this.titleScene.root.visible = scene === 'title';
    this.trophyScene.root.visible = scene === 'trophy';
    this.botsRoot.visible = scene === 'arena';
    this.fx.root.visible = scene !== 'garage';
    this.debris.root.visible = scene === 'arena';
    this.post.setScene(inArena ? this.arenaScene : this.garageScene.scene);
    // Title is moodier: low key light, beams carry the frame.
    this.arena.lights.setLevel(scene === 'title' ? 0.35 : 1);
    this.arena.lights.setBeams(scene === 'title' ? 0.2 : 0.11);
    if (scene === 'title') this.fx.clear();
  }

  setEntrants(entrants: StageEntrant[]): void {
    for (const v of this.views.values()) {
      this.botsRoot.remove(v.root);
      v.dispose();
    }
    this.views.clear();
    this.fx?.clear();
    this.debris?.clear();
    this.camBots.length = 0;
    for (const e of entrants) {
      const v = createBotView(e.spec, { envMap: this.arena?.env ?? null, quality: this.quality });
      v.root.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = true;
      });
      this.views.set(e.id, v);
      this.botsRoot.add(v.root);
      this.camBots.push({
        id: e.id,
        pos: new THREE.Vector3(),
        yaw: 0,
        length: e.spec.length,
        scale: e.spec.scale,
        alive: true,
        corner: e.corner as Corner,
        player: e.player,
      });
    }
    this.cams.shot({ kind: 'live' });
  }

  setCameraMode(mode: CameraMode): void {
    this.cams.setMode(mode);
  }

  getCameraMode(): CameraMode {
    return this.cams.getMode();
  }

  shot(req: ShotRequest): void {
    this.cams.shot(req);
  }

  shotActive(): boolean {
    return this.cams.shotActive();
  }

  crowd(level: number): void {
    this.crowdBase = Math.max(0, Math.min(1, level));
  }

  render(world: WorldFrame, events: MatchEvent[], dt: number): void {
    if (!this.ready) return;
    dt = Math.min(0.1, Math.max(0, dt));
    this.time += dt;
    this.frameNo++;
    this.ctx.time = this.time;
    const r = this.renderer;
    r.info.reset();
    const aspect = this.camera.aspect;

    if (this.sceneId === 'garage') {
      this.garageScene.update(this.time, dt, this.camera);
      this.applyPose(this.garageScene.pose);
    } else if (this.sceneId === 'title') {
      this.titleEvents.length = 0;
      this.titleScene.update(this.time, dt, aspect, this.titleEvents);
      for (const e of this.titleEvents) this.fx.event(e, this.titleScene.world);
      this.arena.update(this.titleScene.hazards, 0, dt, this.time);
      this.applyPose(this.titleScene.pose);
      this.titleScene.placeLogo(this.camera, this.time);
      this.fx.update(this.titleScene.world, dt, this.camera, this.lookup);
      this.crowdLevel(0.12, dt);
    } else if (this.sceneId === 'trophy') {
      this.trophyScene.update(this.time, dt);
      this.arena.update(world.hazards, world.match.lights, dt, this.time);
      this.applyPose(this.trophyScene.pose);
      this.crowdLevel(1, dt);
    } else {
      this.renderArena(world, events, dt);
    }

    if (this.sceneId !== 'garage') this.updateScreen(world);
    this.post.render(dt, this.time);
    this.lastStats.calls = r.info.render.calls;
    this.lastStats.triangles = r.info.render.triangles;
  }

  private renderArena(world: WorldFrame, events: MatchEvent[], dt: number): void {
    this.lastWorld = world;
    const simDt = dt * (world.match.timeScale ?? 1);
    for (const b of world.bots) {
      const v = this.views.get(b.id);
      if (v) v.update(b, simDt);
      const cb = this.ctx.get(b.id);
      if (cb) {
        cb.pos.set(b.pos.x, b.pos.y, b.pos.z);
        _q.set(b.quat.x, b.quat.y, b.quat.z, b.quat.w);
        _f.set(0, 0, -1).applyQuaternion(_q);
        if (Math.abs(_f.x) + Math.abs(_f.z) > 0.05) cb.yaw = Math.atan2(-_f.x, -_f.z);
        cb.alive = !b.disabled;
      }
    }
    for (const e of events) {
      this.fx.event(e, world);
      if (e.type === 'hit') {
        this.views.get(e.victim)?.hit(e);
        this.cams.hit(e);
        this.crowdBurst = Math.min(1, this.crowdBurst + e.severity * 0.9 + 0.05);
      } else if (e.type === 'panel_off' || e.type === 'fire_start' || e.type === 'flipped' || e.type === 'ko') {
        this.crowdBurst = Math.min(1, this.crowdBurst + 0.4);
      } else if (e.type === 'fight_start') {
        this.crowdBurst = Math.min(1, this.crowdBurst + 0.6);
      }
    }
    this.fx.update(world, simDt, this.camera, this.lookup);
    this.debris.update(world.debris, this.lookup);
    this.arena.update(world.hazards, world.match.lights, dt, this.time);
    this.cams.update(this.ctx, dt, this.camera.aspect);
    this.cams.apply(this.camera, this.time);
    // The driver camera stands where the crew stands: hide them.
    const driver = this.cams.getMode() === 'driver' && !this.cams.inShot();
    const me = this.ctx.player();
    for (const [corner, crew] of this.arena.stands.drivers) crew.visible = !(driver && (me?.corner ?? 'red') === corner);
    this.crowdLevel(this.crowdBase, dt);
  }

  private crowdLevel(base: number, dt: number): void {
    this.crowdBurst = Math.max(0, this.crowdBurst - dt * 0.35);
    const u = this.arena.crowd.uniforms.uExcite;
    // A finals house never sits down; a Tuesday crowd claps politely.
    if (this.dressing === 'championship') base = Math.max(base, 0.45) + 0.1;
    else if (this.dressing === 'qualifier') base *= 0.55;
    const target = Math.min(1, base + this.crowdBurst);
    u.value += (target - u.value) * (1 - Math.exp(-dt * 4));
  }

  private applyPose(p: { pos: THREE.Vector3; target: THREE.Vector3; fov: number; roll: number }): void {
    const c = this.camera;
    c.position.copy(p.pos);
    c.up.set(0, 1, 0);
    c.lookAt(p.target);
    if (p.roll) c.rotateZ(p.roll);
    if (c.fov !== p.fov) {
      c.fov = p.fov;
      c.updateProjectionMatrix();
    }
  }

  /** Big screen: a low res live feed from its own director, every few frames. */
  private updateScreen(world: WorldFrame): void {
    const q = QUALITY[this.quality];
    if (this.screenHold > 0) {
      this.screenHold--;
      return;
    }
    if (this.frameNo % q.screenEvery !== 0) return;
    // The screen is off at a garage league: skip its feed.
    if (this.dressing === 'qualifier') return;
    const r = this.renderer;
    const screen = this.arena.stands.screen;
    const usesWorld = this.sceneId === 'arena' && world.bots.length > 0;
    if (usesWorld) {
      const pose = this.screenDirector.update(this.ctx, (1 / 60) * q.screenEvery, 16 / 9);
      this.screenCam.position.copy(pose.pos);
      this.screenCam.lookAt(pose.target);
      this.screenCam.fov = pose.fov;
    } else {
      // Title and trophy: a slow pan across the floor.
      const a = this.time * 0.1;
      this.screenCam.position.set(Math.sin(a) * 6, 3, Math.cos(a) * 6);
      this.screenCam.lookAt(0, this.sceneId === 'trophy' ? 0.8 : 0, 0);
      this.screenCam.fov = this.sceneId === 'trophy' ? 30 : 50;
    }
    this.screenCam.updateProjectionMatrix();
    screen.visible = false;
    const logo = this.titleScene.root.visible;
    this.titleScene.root.visible = false;
    const auto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.screenRT);
    r.render(this.arenaScene, this.screenCam);
    r.setRenderTarget(null);
    r.shadowMap.autoUpdate = auto;
    r.shadowMap.needsUpdate = true;
    screen.visible = true;
    this.titleScene.root.visible = logo;
  }

  clearTransient(): void {
    this.fx?.clear();
    this.debris?.clear();
    this.crowdBurst = 0;
  }

  controlYaw(): number {
    return this.cams.controlYaw(this.camera);
  }

  listener(): { pos: Vec3; quat: Quat } {
    return this.cams.listener(this.camera, this.listenerOut);
  }

  garage(
    spec: BotSpec,
    damage?: { facets: Record<Facet, number>; parts: Record<Component, number> },
    opts?: { tier?: 0 | 1 | 2 | 3; missing?: ('drive' | 'power' | 'armor' | 'weapon')[] },
  ): void {
    this.garageScene?.setRobot(spec, damage, opts);
  }

  setDressing(d: 'normal' | 'championship' | 'qualifier'): void {
    this.dressing = d;
    this.arena?.setDressing(d);
  }

  orbit(dx: number, dy: number): void {
    if (this.sceneId === 'garage') this.garageScene.orbit(dx, dy);
    else if (this.sceneId === 'trophy') this.trophyScene.orbit(dx, dy);
  }

  trophy(spec: BotSpec): void {
    this.trophyScene?.setRobot(spec);
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return;
    this.quality = q;
    if (this.ready) this.applyQuality();
  }

  private applyQuality(): void {
    const q = this.quality;
    this.post.setQuality(q);
    this.arena.setQuality(q);
    const res = QUALITY[q].screenRes;
    this.screenRT.setSize(res[0], res[1]);
    // Shadow maps were reallocated: let the main pass render them before the feed reuses them.
    this.screenHold = 3;
    this.resize();
  }

  getQuality(): Quality {
    return this.quality;
  }

  setBroadcastFilter(on: boolean): void {
    this.post?.setBroadcast(on);
  }

  shake(amount: number): void {
    this.cams.shake(amount);
  }

  resize(): void {
    if (!this.renderer) return;
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const q = QUALITY[this.quality];
    let dpr = Math.min(window.devicePixelRatio || 1, q.dpr);
    if (w * h * dpr * dpr > q.pixels) dpr = Math.sqrt(q.pixels / (w * h));
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const bigAspect = BIG_SCREEN.w / BIG_SCREEN.h;
    this.screenCam.aspect = bigAspect;
  }

  stats(): { calls: number; triangles: number; rig: string; pixels: [number, number] } {
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    return { ...this.lastStats, rig: this.sceneId === 'arena' ? this.cams.rigName : this.sceneId, pixels: [s.x, s.y] };
  }

  /** Last world frame shown in the arena. */
  get world(): WorldFrame | null {
    return this.lastWorld;
  }
}

export function createStage(canvas: HTMLCanvasElement): Stage & StageExtras {
  return new StageImpl(canvas);
}
