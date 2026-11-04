// First-person player: AABB physics, walking, jumping, swimming, flying, auto-jump.
import * as THREE from './three.js';
import { B } from './blocks.js';

const WIDTH = 0.6, HALF = WIDTH / 2, HEIGHT = 1.8, EYE = 1.62;
const GRAVITY = 28, JUMP_V = 8.6, WALK = 4.4, SPRINT = 6.2, FLY = 11, FLY_SPRINT = 20;

export class Player {
  constructor(world) {
    this.world = world;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = false;
    this.flying = false;
    this.inWater = false;
    this.headInWater = false;
    this.creative = false;
    this.autoJump = true;
    this.bob = 0;
    this.frozen = true; // until the spawn area is loaded
  }

  get eye() { return new THREE.Vector3(this.pos.x, this.pos.y + EYE, this.pos.z); }

  lookDir(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  // Does the player AABB intersect any solid block?
  collides(px, py, pz) {
    const w = this.world;
    const x0 = Math.floor(px - HALF), x1 = Math.floor(px + HALF - 1e-6);
    const y0 = Math.floor(py), y1 = Math.floor(py + HEIGHT - 1e-6);
    const z0 = Math.floor(pz - HALF), z1 = Math.floor(pz + HALF - 1e-6);
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      if (w.isSolid(x, y, z)) return true;
    }
    return false;
  }

  intersectsBlock(bx, by, bz) {
    return this.pos.x + HALF > bx && this.pos.x - HALF < bx + 1 &&
      this.pos.y + HEIGHT > by && this.pos.y < by + 1 &&
      this.pos.z + HALF > bz && this.pos.z - HALF < bz + 1;
  }

  /**
   * @param input { moveX, moveZ (-1..1, local), jump, down, sprint }
   */
  update(dt, input) {
    if (this.frozen) return;
    const w = this.world;
    const feet = w.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + 0.2), Math.floor(this.pos.z));
    const head = w.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y + EYE), Math.floor(this.pos.z));
    this.inWater = feet === B.WATER || head === B.WATER;
    this.headInWater = head === B.WATER;

    // Desired horizontal velocity
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let mx = input.moveX, mz = input.moveZ;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    // local (x right, z forward) -> world
    const fx = -sin, fz = -cos, rx = cos, rz = -sin;
    let speed = this.flying ? (input.sprint ? FLY_SPRINT : FLY) : (input.sprint ? SPRINT : WALK);
    if (this.inWater && !this.flying) speed *= 0.55;
    const wishX = (fx * mz + rx * mx) * speed;
    const wishZ = (fz * mz + rz * mx) * speed;

    const accel = this.flying ? 10 : this.onGround ? 16 : this.inWater ? 6 : 5;
    const k = Math.min(1, accel * dt);
    this.vel.x += (wishX - this.vel.x) * k;
    this.vel.z += (wishZ - this.vel.z) * k;

    if (this.flying) {
      const vy = (input.jump ? 1 : 0) - (input.down ? 1 : 0);
      this.vel.y += (vy * speed * 0.8 - this.vel.y) * Math.min(1, 10 * dt);
    } else if (this.inWater) {
      this.vel.y -= 9 * dt;
      if (input.jump) this.vel.y = Math.min(this.vel.y + 30 * dt, 3.6);
      this.vel.y = Math.max(this.vel.y, -3);
      this.vel.y *= Math.pow(0.5, dt * 2);
    } else {
      this.vel.y -= GRAVITY * dt;
      this.vel.y = Math.max(this.vel.y, -50);
      if (input.jump && this.onGround) { this.vel.y = JUMP_V; this.onGround = false; }
    }

    // Auto-jump (handy on touch screens): bump into a 1-block step while walking
    if (this.autoJump && this.onGround && !this.flying && len > 0.1) {
      const ahead = 0.45;
      const ax = this.pos.x + (wishX / speed) * ahead, az = this.pos.z + (wishZ / speed) * ahead;
      if (this.collides(ax, this.pos.y + 0.05, az) && !this.collides(ax, this.pos.y + 1.05, az) &&
        !this.collides(this.pos.x, this.pos.y + 1.05, this.pos.z)) {
        this.vel.y = JUMP_V;
        this.onGround = false;
      }
    }

    // Sneak-edge protection: don't walk off ledges while holding "down" on ground
    const sneaking = input.down && this.onGround && !this.flying;

    // Integrate with axis-separated collision, in small steps
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(this.vel.x), Math.abs(this.vel.y), Math.abs(this.vel.z)) * dt / 0.35));
    const sdt = dt / steps;
    let grounded = false;
    for (let s = 0; s < steps; s++) {
      // Y
      let ny = this.pos.y + this.vel.y * sdt;
      if (this.collides(this.pos.x, ny, this.pos.z)) {
        if (this.vel.y < 0) { ny = Math.floor(ny) + 1; grounded = true; if (this.flying && !this.creative) this.flying = false; }
        else ny = Math.ceil(ny + HEIGHT) - 1 - HEIGHT;
        if (this.collides(this.pos.x, ny, this.pos.z)) ny = this.pos.y;
        this.vel.y = 0;
      }
      this.pos.y = ny;
      // X
      let nx = this.pos.x + this.vel.x * sdt;
      if (this.collides(nx, this.pos.y, this.pos.z) ||
        (sneaking && !this.collides(nx, this.pos.y - 0.1, this.pos.z))) { nx = this.pos.x; this.vel.x = 0; }
      this.pos.x = nx;
      // Z
      let nz = this.pos.z + this.vel.z * sdt;
      if (this.collides(this.pos.x, this.pos.y, nz) ||
        (sneaking && !this.collides(this.pos.x, this.pos.y - 0.1, nz))) { nz = this.pos.z; this.vel.z = 0; }
      this.pos.z = nz;
    }
    // ground check (touching floor)
    this.onGround = grounded || (this.vel.y <= 0 && this.collides(this.pos.x, this.pos.y - 0.02, this.pos.z));
    if (this.onGround && this.flying && input.down) this.flying = false;

    if (this.pos.y < -20) { // fell out of the world
      this.pos.y = w.topSolid(Math.floor(this.pos.x), Math.floor(this.pos.z)) + 2;
      this.vel.set(0, 0, 0);
    }

    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hs > 0.5) this.bob += dt * hs * 1.9;
    else this.bob *= Math.pow(0.02, dt);
  }

  applyToCamera(camera, bobEnabled = true) {
    const bobY = bobEnabled ? Math.abs(Math.sin(this.bob)) * 0.06 : 0;
    const bobX = bobEnabled ? Math.cos(this.bob) * 0.03 : 0;
    camera.position.set(this.pos.x + bobX * Math.cos(this.yaw), this.pos.y + EYE + bobY, this.pos.z - bobX * Math.sin(this.yaw));
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
