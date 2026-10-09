// Minimal types for the parts of n8ao the stage uses.
declare module 'n8ao' {
  import type { Pass } from 'postprocessing';
  import type * as THREE from 'three';
  export class N8AOPostPass extends Pass {
    constructor(scene: THREE.Scene, camera: THREE.Camera, width?: number, height?: number);
    scene: THREE.Scene;
    camera: THREE.Camera;
    autoDetectTransparency: boolean;
    configuration: {
      aoRadius: number;
      distanceFalloff: number;
      intensity: number;
      halfRes: boolean;
      color: THREE.Color;
      aoSamples: number;
      denoiseSamples: number;
      denoiseRadius: number;
      gammaCorrection: boolean;
      screenSpaceRadius: boolean;
      transparencyAware: boolean;
    };
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
  }
}
