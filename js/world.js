// Chunk streaming, block access/editing, mesh management and raycasting.
import * as THREE from './three.js';
import { WorldGen, CHUNK, HEIGHT } from './worldgen.js';
import { buildChunkMesh } from './mesher.js';
import { B, RENDER, IS_SOLID, createAtlasTexture, createWaterTexture } from './blocks.js';

const key = (cx, cz) => cx + ',' + cz;

export class World {
  constructor(scene, seed, edits = {}) {
    this.scene = scene;
    this.seed = seed;
    this.gen = new WorldGen(seed);
    this.chunks = new Map();       // key -> { cx, cz, data, mesh, water, dirty }
    this.edits = new Map();        // key -> Map(localIndex -> id)
    for (const k in edits) {
      const arr = edits[k];
      const m = new Map();
      for (let i = 0; i < arr.length; i += 2) m.set(arr[i], arr[i + 1]);
      this.edits.set(k, m);
    }
    this.renderDistance = 4;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.atlas = createAtlasTexture();
    this.material = new THREE.MeshLambertMaterial({
      map: this.atlas, vertexColors: true, alphaTest: 0.5,
    });
    this.waterTex = createWaterTexture();
    this.waterMaterial = new THREE.MeshLambertMaterial({
      map: this.waterTex, vertexColors: true, transparent: true, opacity: 0.72,
      side: THREE.DoubleSide, depthWrite: false,
    });
    this.lastCenter = null;
    this.genQueue = [];
  }

  serializeEdits() {
    const out = {};
    for (const [k, m] of this.edits) {
      if (!m.size) continue;
      const arr = [];
      for (const [i, id] of m) arr.push(i, id);
      out[k] = arr;
    }
    return out;
  }

  // ---------------------------------------------------------------- blocks
  getChunk(cx, cz) { return this.chunks.get(key(cx, cz)); }

  getBlock(x, y, z) {
    if (y < 0) return B.BEDROCK;
    if (y >= HEIGHT) return B.AIR;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.chunks.get(key(cx, cz));
    if (!c) return y < 40 ? B.STONE : B.AIR; // unloaded: treat low areas as solid
    return c.data[(x - cx * CHUNK) + (z - cz * CHUNK) * CHUNK + y * CHUNK * CHUNK];
  }

  isSolid(x, y, z) { return IS_SOLID[this.getBlock(x, y, z)] === 1; }

  setBlock(x, y, z, id) {
    if (y < 0 || y >= HEIGHT) return false;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const k = key(cx, cz);
    const c = this.chunks.get(k);
    if (!c) return false;
    const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
    const idx = lx + lz * CHUNK + y * CHUNK * CHUNK;
    if (c.data[idx] === id) return false;
    c.data[idx] = id;
    let m = this.edits.get(k);
    if (!m) { m = new Map(); this.edits.set(k, m); }
    m.set(idx, id);
    c.dirty = true;
    c.urgent = true;
    // neighbours share AO / faces across borders
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      if ((dx === -1 && lx > 1) || (dx === 1 && lx < CHUNK - 2)) continue;
      if ((dz === -1 && lz > 1) || (dz === 1 && lz < CHUNK - 2)) continue;
      const nc = this.chunks.get(key(cx + dx, cz + dz));
      if (nc) { nc.dirty = true; nc.urgent = true; }
    }
    // plants pop off when their support is removed
    if (id === B.AIR || id === B.WATER) {
      const above = this.getBlock(x, y + 1, z);
      if (RENDER[above] === 2) this.setBlock(x, y + 1, z, B.AIR);
    }
    this.onBlockChanged?.(x, y, z, id);
    return true;
  }

  // Highest y with a solid block in the column (for spawning)
  topSolid(x, z) {
    for (let y = HEIGHT - 1; y >= 0; y--) if (IS_SOLID[this.getBlock(x, y, z)]) return y;
    return 0;
  }

  // ---------------------------------------------------------------- streaming
  update(px, pz, budgetMs = 6) {
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    const R = this.renderDistance;
    const t0 = performance.now();

    // Unload far chunks
    if (!this.lastCenter || this.lastCenter[0] !== pcx || this.lastCenter[1] !== pcz) {
      this.lastCenter = [pcx, pcz];
      for (const [k, c] of this.chunks) {
        if (Math.abs(c.cx - pcx) > R + 2 || Math.abs(c.cz - pcz) > R + 2) {
          this.disposeChunk(c);
          this.chunks.delete(k);
        }
      }
      // rebuild generation queue sorted by distance
      this.genQueue = [];
      for (let dz = -R - 1; dz <= R + 1; dz++) for (let dx = -R - 1; dx <= R + 1; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        if (!this.chunks.has(key(cx, cz))) this.genQueue.push([cx, cz, dx * dx + dz * dz]);
      }
      this.genQueue.sort((a, b) => b[2] - a[2]); // pop from the end = nearest first
    }

    // Urgent remeshes (player edits) always happen immediately
    for (const c of this.chunks.values()) {
      if (c.urgent) { c.urgent = false; this.meshChunk(c); }
    }

    // Generate chunk data
    let generated = 0;
    while (this.genQueue.length && (generated === 0 || performance.now() - t0 < budgetMs * 0.5)) {
      const [cx, cz] = this.genQueue.pop();
      const k = key(cx, cz);
      if (this.chunks.has(k)) continue;
      const data = this.gen.generateChunk(cx, cz);
      const ed = this.edits.get(k);
      if (ed) for (const [i, id] of ed) data[i] = id;
      const c = { cx, cz, data, mesh: null, water: null, dirty: true, urgent: false };
      this.chunks.set(k, c);
      generated++;
    }

    // Mesh dirty chunks that have all neighbours available, nearest first
    const candidates = [];
    for (const c of this.chunks.values()) {
      if (!c.dirty) continue;
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (Math.abs(dx) > R || Math.abs(dz) > R) continue;
      candidates.push([dx * dx + dz * dz, c]);
    }
    candidates.sort((a, b) => a[0] - b[0]);
    let meshed = 0;
    for (const [, c] of candidates) {
      if (meshed > 0 && performance.now() - t0 > budgetMs) break;
      if (this.meshChunk(c)) meshed++;
    }

    // Visibility by distance (keeps a circular-ish view)
    for (const c of this.chunks.values()) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      const vis = Math.abs(dx) <= R && Math.abs(dz) <= R;
      if (c.mesh) c.mesh.visible = vis;
      if (c.water) c.water.visible = vis;
    }
    return { pending: this.genQueue.length + candidates.length - meshed };
  }

  meshChunk(c) {
    const n = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const nc = this.chunks.get(key(c.cx + dx, c.cz + dz));
      if (!nc) return false;
      n.push(nc.data);
    }
    const res = buildChunkMesh(n);
    this.disposeChunk(c);
    const ox = c.cx * CHUNK, oz = c.cz * CHUNK;
    if (res.opaque) {
      c.mesh = new THREE.Mesh(toGeometry(res.opaque), this.material);
      c.mesh.position.set(ox, 0, oz);
      c.mesh.matrixAutoUpdate = false; c.mesh.updateMatrix();
      this.group.add(c.mesh);
    }
    if (res.water) {
      c.water = new THREE.Mesh(toGeometry(res.water), this.waterMaterial);
      c.water.position.set(ox, 0, oz);
      c.water.matrixAutoUpdate = false; c.water.updateMatrix();
      c.water.renderOrder = 1;
      this.group.add(c.water);
    }
    c.dirty = false;
    return true;
  }

  disposeChunk(c) {
    if (c.mesh) { this.group.remove(c.mesh); c.mesh.geometry.dispose(); c.mesh = null; }
    if (c.water) { this.group.remove(c.water); c.water.geometry.dispose(); c.water = null; }
  }

  isMeshedAround(x, z, r = 1) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const c = this.chunks.get(key(cx + dx, cz + dz));
      if (!c || c.dirty) return false;
    }
    return true;
  }

  dispose() {
    for (const c of this.chunks.values()) this.disposeChunk(c);
    this.chunks.clear();
    this.scene.remove(this.group);
    this.material.dispose(); this.waterMaterial.dispose();
    this.atlas.dispose(); this.waterTex.dispose();
  }

  // ---------------------------------------------------------------- raycast
  // Voxel DDA. Returns { x,y,z, nx,ny,nz, id } of the first targetable block.
  raycast(origin, dir, maxDist = 6) {
    let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    const sx = Math.sign(dir.x), sy = Math.sign(dir.y), sz = Math.sign(dir.z);
    const tdx = sx !== 0 ? Math.abs(1 / dir.x) : Infinity;
    const tdy = sy !== 0 ? Math.abs(1 / dir.y) : Infinity;
    const tdz = sz !== 0 ? Math.abs(1 / dir.z) : Infinity;
    let tmx = sx > 0 ? (x + 1 - origin.x) * tdx : sx < 0 ? (origin.x - x) * tdx : Infinity;
    let tmy = sy > 0 ? (y + 1 - origin.y) * tdy : sy < 0 ? (origin.y - y) * tdy : Infinity;
    let tmz = sz > 0 ? (z + 1 - origin.z) * tdz : sz < 0 ? (origin.z - z) * tdz : Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0;
    while (t <= maxDist) {
      const id = this.getBlock(x, y, z);
      if (id !== B.AIR && id !== B.WATER) return { x, y, z, nx, ny, nz, id, dist: t };
      if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
      else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
      else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
    }
    return null;
  }
}

function toGeometry(g) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(g.position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(g.normal, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(g.uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(g.color, 3));
  geo.setIndex(new THREE.BufferAttribute(g.index, 1));
  geo.computeBoundingSphere();
  return geo;
}
