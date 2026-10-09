// Camera system: gameplay modes, the TV director, cinematic shots, shake, and the listener.

import * as THREE from 'three';
import type { HitEvent, Quat, Vec3 } from '../../contract';
import type { CameraMode, ShotRequest } from '../types';
import { BroadcastDirector } from './director';
import { ChaseCam, DriverCam } from './gameplay';
import { runShot, shotMoving, startShot, type ActiveShot } from './shots';
import { noise1, Pose, type CamCtx } from './types';

export { BroadcastDirector } from './director';
export type { CamBot, CamCtx } from './types';
export { Pose } from './types';

const _f = new THREE.Vector3();

export class CameraSystem {
  private mode: CameraMode = 'chase';
  private chase = new ChaseCam();
  private driver = new DriverCam();
  readonly director = new BroadcastDirector(7);
  private active: ActiveShot | null = null;
  private pendingShot: Exclude<ShotRequest, { kind: 'live' }> | null = null;
  private shotPose = new Pose();
  /** Final pose before shake. */
  readonly pose = new Pose();
  private trauma = 0;
  private lastCtx: CamCtx | null = null;

  setMode(m: CameraMode): void {
    if (m === this.mode) return;
    this.mode = m;
    this.chase.reset();
    this.driver.reset();
    this.director.reset();
  }

  getMode(): CameraMode {
    return this.mode;
  }

  shot(req: ShotRequest): void {
    if (req.kind === 'live') {
      this.active = null;
      this.pendingShot = null;
      this.chase.reset();
      this.driver.reset();
      this.director.reset();
      return;
    }
    // Started on the next update so it sees current robot positions and time.
    this.pendingShot = req;
  }

  shotActive(): boolean {
    if (this.pendingShot) return true;
    if (!this.active || !this.lastCtx) return false;
    return shotMoving(this.active, this.lastCtx.time);
  }

  inShot(): boolean {
    return !!this.active || !!this.pendingShot;
  }

  hit(e: HitEvent): void {
    this.director.hit(e);
  }

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(ctx: CamCtx, dt: number, aspect: number): Pose {
    this.lastCtx = ctx;
    if (this.pendingShot) {
      this.active = startShot(this.pendingShot, ctx, this.pose);
      this.pendingShot = null;
    }
    let p: Pose;
    if (this.active) {
      if (shotMoving(this.active, ctx.time) || this.active.start === ctx.time) {
        runShot(this.active, ctx, aspect, this.shotPose, dt);
      }
      p = this.shotPose;
    } else if (this.mode === 'chase') p = this.chase.update(ctx, dt, aspect);
    else if (this.mode === 'driver') p = this.driver.update(ctx, dt);
    else p = this.director.update(ctx, dt, aspect);
    this.pose.copy(p);
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    return this.pose;
  }

  /** Write the pose plus shake to a three camera. */
  apply(cam: THREE.PerspectiveCamera, time: number): void {
    const p = this.pose;
    const s = this.trauma * this.trauma;
    cam.position.copy(p.pos);
    if (s > 0) {
      cam.position.x += noise1(time * 22, 11) * 0.22 * s;
      cam.position.y += noise1(time * 24, 12) * 0.16 * s;
      cam.position.z += noise1(time * 20, 13) * 0.22 * s;
    }
    _f.copy(p.target);
    if (Math.abs(_f.x - cam.position.x) < 1e-3 && Math.abs(_f.z - cam.position.z) < 1e-3) _f.z += 0.01;
    cam.up.set(0, 1, 0);
    cam.lookAt(_f);
    const roll = p.roll + (s > 0 ? noise1(time * 18, 14) * 0.05 * s : 0);
    if (roll !== 0) cam.rotateZ(roll);
    if (Math.abs(cam.fov - p.fov) > 1e-3) {
      cam.fov = p.fov;
      cam.updateProjectionMatrix();
    }
  }

  /** Floor plane yaw of the view, 0 looking toward -Z, positive turning left. */
  controlYaw(cam: THREE.Camera): number {
    cam.getWorldDirection(_f);
    if (Math.abs(_f.x) + Math.abs(_f.z) < 1e-4) return 0;
    return Math.atan2(-_f.x, -_f.z);
  }

  listener(cam: THREE.Camera, out: { pos: Vec3; quat: Quat }): { pos: Vec3; quat: Quat } {
    out.pos.x = cam.position.x;
    out.pos.y = cam.position.y;
    out.pos.z = cam.position.z;
    out.quat.x = cam.quaternion.x;
    out.quat.y = cam.quaternion.y;
    out.quat.z = cam.quaternion.z;
    out.quat.w = cam.quaternion.w;
    return out;
  }

  get rigName(): string {
    if (this.active) return `shot:${this.active.req.kind}`;
    return this.mode === 'broadcast' ? this.director.rigName : this.mode;
  }
}
