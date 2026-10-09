// Post: N8AO (high only), mipmap bloom, vignette and filmic tone mapping, SMAA, and the
// optional broadcast filter.

import { N8AOPostPass } from 'n8ao';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  KernelSize,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import * as THREE from 'three';
import type { Quality } from '../types';
import { BroadcastEffect } from './broadcast';
import { SanitizeEffect } from './sanitize';

export class PostPipeline {
  readonly composer: EffectComposer;
  private renderPass: RenderPass;
  private ao: N8AOPostPass;
  private bloom: BloomEffect;
  private tone: ToneMappingEffect;
  private vignette: VignetteEffect;
  private smaa: SMAAEffect;
  private gradePass: EffectPass;
  private aaPass: EffectPass;
  private broadcastPass: EffectPass;
  readonly broadcast: BroadcastEffect;
  private quality: Quality = 'high';

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, private camera: THREE.PerspectiveCamera) {
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.ao = new N8AOPostPass(scene, camera, size.x, size.y);
    this.ao.configuration.aoRadius = 1.2;
    this.ao.configuration.distanceFalloff = 1.0;
    this.ao.configuration.intensity = 2.2;
    this.ao.configuration.halfRes = true;
    this.ao.configuration.color = new THREE.Color(0, 0, 0);
    this.ao.setQualityMode('Medium');
    // Its transparency mode assumes normal blending and washes out the premultiplied Lexan.
    // It also walks the scene every frame to detect transparency. Off.
    this.ao.autoDetectTransparency = false;
    this.ao.configuration.transparencyAware = false;
    this.composer.addPass(this.ao);
    this.composer.addPass(new EffectPass(camera, new SanitizeEffect()));
    // Kawase blur, not the mipmap blur: the mipmap chain sometimes resolved to an all-black
    // frame for one frame every few seconds (seen as flicker, on desktop and phones).
    this.bloom = new BloomEffect({
      mipmapBlur: false,
      kernelSize: KernelSize.HUGE,
      luminanceThreshold: 1.7,
      luminanceSmoothing: 0.35,
      intensity: 1.35,
      resolutionScale: 0.5,
    });
    this.vignette = new VignetteEffect({ offset: 0.3, darkness: 0.62 });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.gradePass = new EffectPass(camera, this.bloom, this.vignette, this.tone);
    this.composer.addPass(this.gradePass);
    this.smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
    this.aaPass = new EffectPass(camera, this.smaa);
    this.composer.addPass(this.aaPass);
    this.broadcast = new BroadcastEffect();
    this.broadcastPass = new EffectPass(camera, this.broadcast);
    this.composer.addPass(this.broadcastPass);
    this.setBroadcast(false);
  }

  setScene(scene: THREE.Scene): void {
    this.renderPass.mainScene = scene;
    this.ao.scene = scene;
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.ao.enabled = q === 'high';
    this.bloom.blurPass.kernelSize = q === 'low' ? KernelSize.LARGE : KernelSize.HUGE;
    this.bloom.resolution.scale = q === 'low' ? 0.35 : 0.5;
    this.smaa.applyPreset(q === 'low' ? SMAAPreset.LOW : q === 'medium' ? SMAAPreset.MEDIUM : SMAAPreset.HIGH);
  }

  setBroadcast(on: boolean): void {
    // The last enabled pass must write to the screen.
    this.broadcastPass.enabled = on;
    this.broadcastPass.renderToScreen = on;
    this.aaPass.renderToScreen = !on;
  }

  get broadcastOn(): boolean {
    return this.broadcastPass.enabled;
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h, false);
  }

  render(dt: number, time: number): void {
    this.broadcast.setTime(time);
    void this.quality;
    void this.camera;
    void this.renderer;
    this.composer.render(dt);
  }
}
