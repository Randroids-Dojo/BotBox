// Render module contracts. Owned by the lead; render agents implement them.
//
//   Stage (src/render/stage.ts, arena agent): renderer, post-processing, scenes, arena, crowd,
//     hazards, lighting, cameras and the TV director. Owns the frame loop's draw call.
//   BotView, FxLayer, DebrisLayer, props (src/render/bots, src/render/fx, src/render/props,
//     bots agent): robot meshes and their damage, sparks, smoke, fire, debris, the Giant Nut.

import type * as THREE from 'three';
import type {
  BotFrame,
  BotSpec,
  Component,
  Corner,
  DebrisFrame,
  Facet,
  HitEvent,
  MatchEvent,
  Quat,
  Vec3,
  WorldFrame,
} from '../contract';

export type Quality = 'high' | 'medium' | 'low';
export type SceneId = 'title' | 'arena' | 'garage' | 'trophy';
export type CameraMode = 'chase' | 'broadcast' | 'driver';

/** Cinematic camera requests from the game director. Each runs for `duration` seconds of real
 *  time and then holds its last framing until another shot or `live` is requested. */
export type ShotRequest =
  /** Sweeping flyover of the Box for the cold open and title. */
  | { kind: 'flyover'; duration: number }
  /** Slow push-in on one robot sitting in its square, for its intro and lower third. */
  | { kind: 'bot_intro'; bot: string; duration: number }
  /** Low wide shot with both robots, just before the lights. */
  | { kind: 'faceoff'; duration: number }
  /** Tight on the light tree during the countdown. */
  | { kind: 'lights'; duration: number }
  /** Quick cut to a dramatic angle on a big impact (real time; the sim may be slowed). */
  | { kind: 'impact'; point: Vec3; bots: string[]; duration: number }
  /** Replay angle around a moment. `seed` picks the angle so replays vary. */
  | { kind: 'replay'; point: Vec3; bots: string[]; duration: number; seed: number }
  /** Slow orbit around the winner. */
  | { kind: 'winner'; bot: string; duration: number }
  /** Hold on a beaten robot (smoke, fire, count). */
  | { kind: 'loser'; bot: string; duration: number }
  /** High wide from the announcer booth. */
  | { kind: 'booth'; duration: number }
  /** Back to the gameplay camera for the current CameraMode. */
  | { kind: 'live' };

export interface StageEntrant {
  id: string;
  spec: BotSpec;
  corner: Corner;
  player: boolean;
}

export interface Stage {
  readonly canvas: HTMLCanvasElement;
  /** Build renderer, scenes and generated textures. Reports progress 0..1. */
  init(onProgress?: (p: number) => void): Promise<void>;
  setScene(scene: SceneId): void;
  /** Build bot views for the arena. Replaces any previous entrants. */
  setEntrants(entrants: StageEntrant[]): void;
  /** Gameplay camera mode. */
  setCameraMode(mode: CameraMode): void;
  getCameraMode(): CameraMode;
  shot(req: ShotRequest): void;
  /** True while a cinematic shot is still moving. */
  shotActive(): boolean;
  /**
   * Draw one frame. `world` is the (interpolated) state to show. `events` are sim events since
   * the previous call; the stage forwards them to bots and fx. `dt` is real seconds since the
   * previous call (camera and fx timing). Also used for replays: the director feeds recorded
   * frames and events, after calling `clearTransient()` when it jumps in time.
   */
  render(world: WorldFrame, events: MatchEvent[], dt: number): void;
  /** Remove live particles, debris meshes and transient effects (before a replay or a new fight). */
  clearTransient(): void;
  /** Yaw (radians about +Y, 0 looks toward -Z) of the camera's view on the floor plane. */
  controlYaw(): number;
  /** Camera pose for the audio listener. */
  listener(): { pos: Vec3; quat: Quat };
  /** Garage scene: show this robot on the turntable, with optional damage fractions. */
  garage(spec: BotSpec, damage?: { facets: Record<Facet, number>; parts: Record<Component, number> }): void;
  /** Drag to orbit the garage or trophy view (pixels). */
  orbit(dx: number, dy: number): void;
  /** Trophy scene: the Giant Nut with the winning robot. */
  trophy(spec: BotSpec): void;
  setQuality(q: Quality): void;
  getQuality(): Quality;
  /** Optional broadcast look: grain, slight chroma, scanline softness. */
  setBroadcastFilter(on: boolean): void;
  /** Shake the camera (0..1) for hits the director wants to emphasize. */
  shake(amount: number): void;
  resize(): void;
}

// ------------------------------------------------------------------------------------------
// Bots agent contracts (src/render/bots, src/render/fx, src/render/props)

export interface BotViewOptions {
  envMap: THREE.Texture | null;
  quality: Quality;
}

export interface BotView {
  /** Add this to the scene. Its transform is driven by `update`. */
  readonly root: THREE.Object3D;
  readonly spec: BotSpec;
  /** Apply a frame: pose, wheel spin, weapon angle, missing panels and wheels, smoke anchor. */
  update(frame: BotFrame, dt: number): void;
  /** A hit landed on this robot: dents, scratches and scorch at the contact point. Must ignore
   *  hits with `t` at or before the latest applied hit (replays re-send events). */
  hit(e: HitEvent): void;
  /** Reset accumulated visual damage (new fight). */
  resetDamage(): void;
  /** Clone of a panel's mesh for a debris body, in panel-local space (centered). */
  panelMesh(index: number): THREE.Object3D;
  /** Clone of a wheel mesh for debris, centered. */
  wheelMesh(index: number): THREE.Object3D;
  /** World-space position of a component, for smoke and fire emitters. */
  componentWorld(c: Component, out: THREE.Vector3): THREE.Vector3;
  dispose(): void;
}

export type CreateBotView = (spec: BotSpec, opts: BotViewOptions) => BotView;

export interface FxLayer {
  readonly root: THREE.Object3D;
  /** React to a sim event (sparks, flashes, dust, shrapnel, pneumatic puffs, hazard sparks). */
  event(e: MatchEvent, world: WorldFrame): void;
  /** Continuous effects: smoke and fire from damaged robots, grinding, spinner wind, then
   *  integrate particles. `bots` resolves a robot id to its view. */
  update(world: WorldFrame, dt: number, camera: THREE.Camera, bots: (id: string) => BotView | undefined): void;
  clear(): void;
  dispose(): void;
}

export type CreateFxLayer = (opts: { quality: Quality }) => FxLayer;

export interface DebrisLayer {
  readonly root: THREE.Object3D;
  /** Sync meshes to the sim's debris bodies. Creates meshes from bot views on first sight. */
  update(debris: DebrisFrame[], bots: (id: string) => BotView | undefined): void;
  clear(): void;
}

export type CreateDebrisLayer = () => DebrisLayer;

/** The Giant Nut trophy (a large chromed hex nut on a plinth), about 0.9 m tall. */
export type CreateNutTrophy = (envMap: THREE.Texture | null) => THREE.Object3D;
