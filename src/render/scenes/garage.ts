// Garage: a builder's pit workshop. Pegboard and tools, workbench, toolboxes, cables, a
// hanging work lamp, a team banner, and the robot on a turntable under warm light. The
// right 40 percent of the frame is left for the parts panel.

import * as THREE from 'three';
import type { BotFrame, BotSpec, Component, Facet } from '../../contract';
import { createBotView } from '../bots';
import { Pose } from '../camera';
import type { BotView, Quality } from '../types';
import { GeoBatch, worldUv } from '../util/geom';
import { Rng } from '../util/rng';
import { canvas, canvasTexture, hazardPattern, noiseCanvas } from '../util/tex';
import { restingFrame } from './trophy';

const _d = new THREE.Vector3();
const _r = new THREE.Vector3();

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
  private bannerCanvas: HTMLCanvasElement;
  private bannerTex: THREE.CanvasTexture;
  private lampLight: THREE.SpotLight;
  private lamp = new THREE.Group();

  constructor(private env: THREE.Texture, private quality: () => Quality) {
    const s = this.scene;
    s.background = new THREE.Color(0.012, 0.01, 0.008);
    s.environment = env;
    s.environmentIntensity = 0.55;
    s.fog = new THREE.Fog(0x0a0806, 9, 20);
    const rng = new Rng(88);

    // ---------------------------------------------------------------- room
    const floorTex = concreteTexture(rng);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 12), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.82, metalness: 0.05 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);
    const block = new THREE.MeshStandardMaterial({ map: blockTexture(), roughness: 0.9 });
    const back = new THREE.Mesh(new THREE.PlaneGeometry(14, 5), block);
    back.position.set(0, 2.5, -3.2);
    back.receiveShadow = true;
    s.add(back);
    const left = new THREE.Mesh(new THREE.PlaneGeometry(12, 5), block);
    left.position.set(-4.6, 2.5, 1);
    left.rotation.y = Math.PI / 2;
    left.receiveShadow = true;
    s.add(left);

    // Pegboard with tools.
    const peg = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.6), new THREE.MeshStandardMaterial({ map: pegboardTexture(), roughness: 0.85 }));
    peg.position.set(-1.6, 1.85, -3.17);
    peg.receiveShadow = true;
    s.add(peg);
    s.add(this.tools(rng));

    // Workbench along the back wall.
    const wood = new THREE.MeshStandardMaterial({ map: woodTexture(rng), roughness: 0.7 });
    const steel = new THREE.MeshStandardMaterial({ color: '#4a4e55', roughness: 0.45, metalness: 0.8 });
    const bench = new GeoBatch();
    bench.box(-3.5, 0.9, -3.15, 0.3, 0.96, -2.45);
    const benchTop = new THREE.Mesh(worldUv(bench.build(), 1), wood);
    benchTop.castShadow = benchTop.receiveShadow = true;
    s.add(benchTop);
    const legs = new GeoBatch();
    for (const x of [-3.4, -1.6, 0.2]) for (const z of [-3.1, -2.5]) legs.box(x - 0.03, 0, z - 0.03, x + 0.03, 0.9, z + 0.03);
    legs.box(-3.45, 0.25, -3.12, 0.25, 0.28, -2.48);
    s.add(new THREE.Mesh(legs.build(), steel));
    // Bench clutter: a vise, battery packs, a drill, a parts bin.
    const clutter = new GeoBatch();
    clutter.box(-3.2, 0.96, -2.9, -2.95, 1.1, -2.65);
    clutter.box(-3.15, 1.1, -2.85, -3.0, 1.2, -2.7);
    for (let i = 0; i < 3; i++) clutter.box(-2.3 + i * 0.28, 0.96, -2.95, -2.08 + i * 0.28, 1.1, -2.75);
    clutter.box(-0.9, 0.96, -3.0, -0.4, 1.08, -2.6);
    s.add(new THREE.Mesh(clutter.build(), new THREE.MeshStandardMaterial({ color: '#2a2c30', roughness: 0.6, metalness: 0.4 })));
    const packs = new GeoBatch();
    for (let i = 0; i < 3; i++) packs.box(-2.28 + i * 0.28, 1.1, -2.93, -2.1 + i * 0.28, 1.13, -2.77);
    s.add(new THREE.Mesh(packs.build(), new THREE.MeshStandardMaterial({ color: '#d8a010', roughness: 0.5 })));

    // Rolling toolboxes, the classic red.
    const red = new THREE.MeshStandardMaterial({ color: '#b3140e', roughness: 0.35, metalness: 0.5 });
    const chrome = new THREE.MeshStandardMaterial({ color: '#e0e0e0', roughness: 0.15, metalness: 1 });
    const tb = new GeoBatch();
    const handles = new GeoBatch();
    for (const [x, z, h] of [
      [1.4, -2.75, 1.05],
      [2.3, -2.75, 0.75],
    ] as const) {
      tb.box(x - 0.42, 0.1, z - 0.3, x + 0.42, h, z + 0.3);
      for (let d = 0; d < 5; d++) {
        const y = 0.2 + (d * (h - 0.25)) / 5;
        handles.box(x - 0.25, y + 0.08, z + 0.3, x + 0.25, y + 0.1, z + 0.33);
        handles.box(x - 0.41, y + 0.01, z + 0.3, x + 0.41, y + 0.015, z + 0.305);
      }
      for (const cx of [-0.35, 0.35]) for (const cz of [-0.22, 0.22]) handles.add(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 10), x + cx, 0.05, z + cz, Math.PI / 2, 0, 0);
    }
    const tbm = new THREE.Mesh(tb.build(), red);
    tbm.castShadow = tbm.receiveShadow = true;
    s.add(tbm, new THREE.Mesh(handles.build(), chrome));

    // Fire extinguisher by the door.
    const ext = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.5, 16), red);
    ext.position.set(-4.4, 0.25, 0.5);
    s.add(ext);

    // Cables snaking across the floor.
    const cables = new GeoBatch();
    for (let i = 0; i < 4; i++) {
      const pts: THREE.Vector3[] = [];
      let x = -3 + i * 0.6;
      let z = -2.4;
      for (let k = 0; k < 7; k++) {
        pts.push(new THREE.Vector3(x, 0.015, z));
        x += rng.range(-0.5, 0.7);
        z += rng.range(0.3, 0.7);
      }
      cables.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.012 + i * 0.002, 5, false));
    }
    s.add(new THREE.Mesh(cables.build(), new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.6 })));

    // Team banner on the back wall.
    const bc = canvas(1024, 256);
    this.bannerCanvas = bc.c;
    this.bannerTex = canvasTexture(bc.c);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), new THREE.MeshStandardMaterial({ map: this.bannerTex, roughness: 0.8, side: THREE.DoubleSide }));
    banner.position.set(-1.3, 3.15, -3.12);
    s.add(banner);
    // Safety sign.
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.5), new THREE.MeshStandardMaterial({ map: safetySign(), roughness: 0.6 }));
    sign.position.set(-4.58, 1.7, -1.4);
    sign.rotation.y = Math.PI / 2;
    s.add(sign);

    // ---------------------------------------------------------------- turntable
    const plateMat = new THREE.MeshStandardMaterial({ color: '#6e737a', roughness: 0.35, metalness: 0.9, map: diamondPlate() });
    const plate = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.05, 64), plateMat);
    plate.position.y = 0.205;
    plate.receiveShadow = true;
    plate.castShadow = true;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.05, 0.18, 48), new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.5, metalness: 0.6 }));
    base.position.y = 0.09;
    base.receiveShadow = true;
    const stripe = new THREE.Mesh(new THREE.CylinderGeometry(1.255, 1.255, 0.03, 64, 1, true), new THREE.MeshStandardMaterial({ map: hazardRing(), roughness: 0.5 }));
    stripe.position.y = 0.205;
    this.turntable.add(plate, stripe);
    s.add(base, this.turntable);

    // ---------------------------------------------------------------- lights
    s.add(new THREE.HemisphereLight(0xffd8b0, 0x201810, 0.35));
    // Hanging work lamp: shade, bulb, cord, warm shadowed spot.
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.3, 24, 1, true), new THREE.MeshStandardMaterial({ color: '#2d4a2a', roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide }));
    shade.position.y = 0.0;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(12, 8, 4) }));
    bulb.position.y = -0.1;
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 2, 4), new THREE.MeshBasicMaterial({ color: '#050505' }));
    cord.position.y = 1.15;
    this.lamp.add(shade, bulb, cord);
    this.lamp.position.set(0.25, 2.85, 0.3);
    s.add(this.lamp);
    this.lampLight = new THREE.SpotLight(0xffc890, 34, 12, 0.9, 0.6, 1.4);
    this.lampLight.position.set(0.25, 2.7, 0.3);
    this.lampLight.target.position.set(0, 0, 0);
    this.lampLight.castShadow = true;
    this.lampLight.shadow.mapSize.set(1024, 1024);
    this.lampLight.shadow.bias = -0.0004;
    this.lampLight.shadow.normalBias = 0.02;
    s.add(this.lampLight, this.lampLight.target);
    // Cool fluorescent rim from the open roll-up door.
    const rimL = new THREE.DirectionalLight(0x9fb8ff, 1.3);
    rimL.position.set(-4, 3, 4);
    s.add(rimL);
    const fill = new THREE.PointLight(0xff9a50, 6, 8, 1.5);
    fill.position.set(2.8, 1.6, -1.8);
    s.add(fill);
    // Fluorescent fixture glowing over the bench.
    const tube = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.05, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 5.4, 6) }));
    tube.position.set(-1.6, 3.6, -2.6);
    s.add(tube);
    const tubeLight = new THREE.PointLight(0xdfe8ff, 5, 6, 1.5);
    tubeLight.position.set(-1.6, 3.3, -2.4);
    s.add(tubeLight);
    this.setBanner('YOUR ROBOT');
  }

  private tools(rng: Rng): THREE.Object3D {
    const g = new GeoBatch();
    const x0 = -3.2;
    // Wrenches in a size run.
    for (let i = 0; i < 9; i++) {
      const x = x0 + 0.12 + i * 0.1;
      const len = 0.18 + i * 0.025;
      g.box(x - 0.012, 2.5 - len, -3.14, x + 0.012, 2.5, -3.12);
      g.add(new THREE.TorusGeometry(0.025, 0.008, 4, 10, Math.PI * 1.4), x, 2.5 + 0.02, -3.13);
    }
    // Hammers and screwdrivers.
    for (let i = 0; i < 3; i++) {
      const x = x0 + 1.2 + i * 0.22;
      g.box(x - 0.015, 1.7, -3.14, x + 0.015, 2.05, -3.11);
      g.box(x - 0.07, 2.05, -3.14, x + 0.07, 2.1, -3.1);
    }
    for (let i = 0; i < 6; i++) {
      const x = x0 + 1.95 + i * 0.07;
      g.add(new THREE.CylinderGeometry(0.004, 0.004, 0.16, 4), x, 2.25, -3.13);
      g.add(new THREE.CylinderGeometry(0.015, 0.015, 0.1, 6), x, 2.38, -3.13);
    }
    // Pliers and snips.
    for (let i = 0; i < 4; i++) {
      const x = x0 + 2.55 + i * 0.16;
      g.add(new THREE.BoxGeometry(0.015, 0.2, 0.02), x - 0.02, 1.55, -3.13, 0, 0, 0.12);
      g.add(new THREE.BoxGeometry(0.015, 0.2, 0.02), x + 0.02, 1.55, -3.13, 0, 0, -0.12);
    }
    void rng;
    const m = new THREE.Mesh(g.build(), new THREE.MeshStandardMaterial({ color: '#b8bcc4', roughness: 0.3, metalness: 1 }));
    m.castShadow = true;
    return m;
  }

  setBanner(name: string): void {
    const g = this.bannerCanvas.getContext('2d')!;
    const W = 1024;
    const H = 256;
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#13306e');
    grd.addColorStop(1, '#081633');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#ff6a00';
    g.fillRect(0, H - 34, W, 12);
    g.fillRect(0, 22, W, 6);
    let size = 120;
    const text = `TEAM ${name.toUpperCase()}`;
    g.font = `italic 900 ${size}px "Arial Black", Impact, sans-serif`;
    while (g.measureText(text).width > W * 0.9 && size > 40) {
      size -= 6;
      g.font = `italic 900 ${size}px "Arial Black", Impact, sans-serif`;
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 10;
    g.strokeStyle = '#000';
    g.strokeText(text, W / 2, H / 2);
    g.fillStyle = '#f4f4f4';
    g.fillText(text, W / 2, H / 2);
    this.bannerTex.needsUpdate = true;
  }

  setRobot(spec: BotSpec, damage?: { facets: Record<Facet, number>; parts: Record<Component, number> }): void {
    if (this.view && this.view.spec !== spec) {
      this.turntable.remove(this.view.root);
      this.view.dispose();
      this.view = null;
    }
    if (!this.view) {
      this.view = createBotView(spec, { envMap: this.env, quality: this.quality() });
      this.view.root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      this.turntable.add(this.view.root);
    }
    this.frame = restingFrame(spec, { x: 0, y: 0.23, z: 0 }, 0);
    if (damage) {
      Object.assign(this.frame.facets, damage.facets);
      Object.assign(this.frame.parts, damage.parts);
      const minPart = Math.min(...Object.values(damage.parts));
      this.frame.smoke = minPart < 0.35 ? 1 - minPart / 0.35 : 0;
    }
    this.size = Math.max(spec.length, spec.width, spec.height * 1.4);
    this.center.set(0, 0.23 + spec.height * 0.45, 0);
    this.setBanner(spec.loadout.name || 'ROOKIE');
  }

  orbit(dx: number, dy: number): void {
    this.yaw -= dx * 0.006;
    this.pitch = Math.max(0.04, Math.min(1.05, this.pitch + dy * 0.004));
  }

  update(time: number, dt: number, cam: THREE.PerspectiveCamera): void {
    this.spin += dt * 0.25;
    this.turntable.rotation.y = this.spin;
    if (this.view && this.frame) this.view.update(this.frame, dt);
    this.lamp.rotation.z = Math.sin(time * 0.6) * 0.02;
    // Distance so the robot spans about 38 percent of the frame width.
    const fov = 30;
    const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(fov) / 2) * cam.aspect);
    const r = this.size * 0.62 + 0.15;
    // Fit by width (robot in the left 60 percent) and by height, whichever needs more room.
    const vHalf = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
    const dist = Math.max(1.7, r / (0.6 * Math.tan(hfov / 2)), r / (0.82 * vHalf));
    const p = this.pose;
    p.pos.set(Math.sin(this.yaw) * Math.cos(this.pitch) * dist, this.center.y + Math.sin(this.pitch) * dist, Math.cos(this.yaw) * Math.cos(this.pitch) * dist);
    p.pos.add(this.center);
    // Aim a little low so the robot sits above the stats card in the lower left.
    p.target.copy(this.center).setY(this.center.y - dist * 0.075);
    // Shift the robot into the left 60 percent: aim right of it.
    _d.subVectors(p.target, p.pos).normalize();
    _r.crossVectors(_d, new THREE.Vector3(0, 1, 0)).normalize();
    const halfW = dist * Math.tan(hfov / 2);
    p.target.addScaledVector(_r, halfW * 0.4);
    p.fov = fov;
    p.roll = 0;
  }
}

function concreteTexture(rng: Rng): THREE.Texture {
  const S = 1024;
  const { c, g } = canvas(S);
  g.fillStyle = '#4e4b47';
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = 0.6;
  g.drawImage(noiseCanvas(128, 4, 5, 4), 0, 0, S, S);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  // Oil stains and tire marks.
  for (let i = 0; i < 14; i++) {
    const x = rng.next() * S;
    const y = rng.next() * S;
    const r = rng.range(20, 110);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(15,12,8,0.6)');
    grd.addColorStop(1, 'rgba(15,12,8,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(x, y, r, r * rng.range(0.5, 1), rng.next() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // Expansion joints.
  g.strokeStyle = 'rgba(20,18,15,0.7)';
  g.lineWidth = 3;
  for (const t of [S / 3, (2 * S) / 3]) {
    g.beginPath();
    g.moveTo(t, 0);
    g.lineTo(t, S);
    g.moveTo(0, t);
    g.lineTo(S, t);
    g.stroke();
  }
  return canvasTexture(c, { repeat: [2, 2] });
}

function blockTexture(): THREE.Texture {
  const { c, g } = canvas(512);
  g.fillStyle = '#8a8378';
  g.fillRect(0, 0, 512, 512);
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = 0.5;
  g.drawImage(noiseCanvas(128, 8, 7, 4), 0, 0, 512, 512);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = 'rgba(40,36,30,0.8)';
  g.lineWidth = 4;
  for (let row = 0; row < 8; row++) {
    const y = row * 64;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(512, y);
    g.stroke();
    for (let col = 0; col < 4; col++) {
      const x = col * 128 + (row % 2) * 64;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y + 64);
      g.stroke();
    }
  }
  return canvasTexture(c, { repeat: [9, 3.6] });
}

function pegboardTexture(): THREE.Texture {
  const { c, g } = canvas(1024, 456);
  g.fillStyle = '#a07a50';
  g.fillRect(0, 0, 1024, 456);
  g.globalCompositeOperation = 'multiply';
  g.globalAlpha = 0.35;
  g.drawImage(noiseCanvas(128, 8, 9, 3), 0, 0, 1024, 456);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#1a120a';
  for (let y = 10; y < 456; y += 19) for (let x = 10; x < 1024; x += 19) {
    g.beginPath();
    g.arc(x, y, 3.2, 0, Math.PI * 2);
    g.fill();
  }
  // Tool outlines painted on the board, builder style.
  g.strokeStyle = 'rgba(30,30,30,0.6)';
  g.lineWidth = 3;
  for (let i = 0; i < 9; i++) g.strokeRect(30 + i * 28, 60, 10, 50 + i * 7);
  return canvasTexture(c);
}

function woodTexture(rng: Rng): THREE.Texture {
  const { c, g } = canvas(512, 128);
  g.fillStyle = '#7a5532';
  g.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 80; i++) {
    g.strokeStyle = `rgba(40,22,10,${rng.range(0.1, 0.3)})`;
    g.lineWidth = rng.range(1, 3);
    g.beginPath();
    const y = rng.next() * 128;
    g.moveTo(0, y);
    g.bezierCurveTo(170, y + rng.range(-8, 8), 340, y + rng.range(-8, 8), 512, y + rng.range(-5, 5));
    g.stroke();
  }
  // Burns and cut marks.
  for (let i = 0; i < 12; i++) {
    g.fillStyle = 'rgba(15,8,2,0.5)';
    g.beginPath();
    g.arc(rng.next() * 512, rng.next() * 128, rng.range(3, 12), 0, Math.PI * 2);
    g.fill();
  }
  return canvasTexture(c, { repeat: [1, 1] });
}

function diamondPlate(): THREE.Texture {
  const { c, g } = canvas(256);
  g.fillStyle = '#9aa0a8';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#c8ccd2';
  for (let y = 0; y < 256; y += 32) {
    for (let x = 0; x < 256; x += 32) {
      for (const [dx, dy, a] of [
        [8, 8, 0.785],
        [24, 24, -0.785],
      ]) {
        g.save();
        g.translate(x + dx, y + dy);
        g.rotate(a);
        g.fillRect(-9, -2, 18, 4);
        g.restore();
      }
    }
  }
  return canvasTexture(c, { repeat: [6, 6] });
}

function hazardRing(): THREE.Texture {
  const { c, g } = canvas(512, 32);
  g.fillStyle = hazardPattern(g, 16);
  g.fillRect(0, 0, 512, 32);
  return canvasTexture(c, { repeat: [8, 1] });
}

function safetySign(): THREE.Texture {
  const { c, g } = canvas(256, 180);
  g.fillStyle = '#f2f2ea';
  g.fillRect(0, 0, 256, 180);
  g.fillStyle = '#d01818';
  g.fillRect(0, 0, 256, 56);
  g.fillStyle = '#fff';
  g.font = 'bold 40px Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText('DANGER', 128, 44);
  g.fillStyle = '#111';
  g.font = 'bold 24px Arial, sans-serif';
  g.fillText('WEAPONS LIVE', 128, 100);
  g.fillText('SAFETY GLASSES', 128, 136);
  g.fillText('ON AT ALL TIMES', 128, 164);
  return canvasTexture(c);
}
