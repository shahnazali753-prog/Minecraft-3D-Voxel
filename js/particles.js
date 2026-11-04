// Pooled block-break particles using a single InstancedMesh (one draw call).
import * as THREE from './three.js';

const MAX = 160;

export class Particles {
  constructor(scene) {
    const geo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.parts = [];
    this.dummy = new THREE.Object3D();
    this.world = null;
  }

  burst(x, y, z, color, n = 14) {
    for (let i = 0; i < n; i++) {
      if (this.parts.length >= MAX) this.parts.shift();
      this.parts.push({
        p: new THREE.Vector3(x + 0.2 + Math.random() * 0.6, y + 0.2 + Math.random() * 0.6, z + 0.2 + Math.random() * 0.6),
        v: new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 4 + 1, (Math.random() - 0.5) * 4),
        life: 0.5 + Math.random() * 0.5,
        s: 0.6 + Math.random() * 0.6,
        c: color.clone().multiplyScalar(0.8 + Math.random() * 0.35),
      });
    }
  }

  update(dt) {
    const d = this.dummy;
    let n = 0;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const q = this.parts[i];
      q.life -= dt;
      if (q.life <= 0) { this.parts.splice(i, 1); continue; }
      q.v.y -= 16 * dt;
      q.p.addScaledVector(q.v, dt);
      if (this.world && this.world.isSolid(Math.floor(q.p.x), Math.floor(q.p.y), Math.floor(q.p.z))) {
        q.p.y = Math.floor(q.p.y) + 1.01; q.v.set(q.v.x * 0.4, 0, q.v.z * 0.4);
      }
    }
    for (const q of this.parts) {
      d.position.copy(q.p);
      d.scale.setScalar(q.s * Math.min(1, q.life * 3));
      d.updateMatrix();
      this.mesh.setMatrixAt(n, d.matrix);
      this.mesh.setColorAt(n, q.c);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() { this.parts.length = 0; this.mesh.count = 0; }
}
