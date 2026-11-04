// BlockWorld - entry point & game loop.
import * as THREE from './three.js';
import { World } from './world.js';
import { Sky } from './sky.js';
import { Player } from './player.js';
import { Controls } from './controls.js';
import { UI } from './ui.js';
import { Particles } from './particles.js';
import { Sfx, materialOf } from './audio.js';
import { B, BLOCKS, RENDER, IS_SOLID, ATLAS_COLS, ATLAS_ROWS, getBlockColor } from './blocks.js';
import { HEIGHT } from './worldgen.js';
import { hashString } from './noise.js';
import * as Store from './storage.js';

const REACH = 6;
const AUTOSAVE_SECONDS = 30;
const MAX_STACK = 64;
const CREATIVE_HOTBAR = [B.GRASS, B.DIRT, B.STONE, B.PLANKS, B.LOG, B.GLASS, B.BRICK, B.SAND, B.ROSE];

class Game {
  constructor() {
    this.canvas = document.getElementById('canvas');
    this.settings = Store.loadSettings();
    this.state = 'title';
    this.isTouch = matchMedia('(pointer: coarse)').matches;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: !this.isTouch, powerPreference: 'high-performance',
    });
    this.renderer.autoClear = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.05, 700);

    // first-person held block, rendered in its own pass so it never clips into walls
    this.handScene = new THREE.Scene();
    this.handCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.handAmbient = new THREE.AmbientLight(0xffffff, 1);
    this.handLight = new THREE.DirectionalLight(0xffffff, 0.8);
    this.handLight.position.set(-1, 2, 1.5);
    this.handScene.add(this.handAmbient, this.handLight);
    this.hand = null;
    this.handSwing = 0;

    this.sky = new Sky(this.scene, 1234);
    this.particles = new Particles(this.scene);
    this.sfx = new Sfx();
    this.controls = new Controls(this.canvas, document.getElementById('game'));
    this.controls.setTouchMode(this.isTouch);
    this.ui = new UI(this);

    // block highlight
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    this.highlight = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }));
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    this.world = null;
    this.player = null;
    this.worldState = null;
    this.time = 0.08;
    this.slots = [];
    this.selected = 0;
    this.breakProgress = 0;
    this.breakTarget = null;
    this.breakCooldown = 0;
    this.autosaveTimer = 0;
    this.titleAngle = 0;
    this.fps = 0; this.fpsFrames = 0; this.fpsTime = 0;
    this.dir = new THREE.Vector3();

    this._bindEvents();
    this.applySettings();
    this.onResize();
    this.startTitle();
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------------------------------------------------------------- setup
  _bindEvents() {
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.onResize(), 200));

    const unlockAudio = () => this.sfx.unlock();
    window.addEventListener('touchend', unlockAudio, { passive: true });
    window.addEventListener('click', unlockAudio);
    window.addEventListener('keydown', unlockAudio);

    this.controls.on('slot', (i) => this.selectSlot(i));
    this.controls.on('scroll', (d) => this.selectSlot((this.selected + d + 9) % 9));
    this.controls.on('inventory', () => {
      if (this.state === 'inventory') this.resume();
      else this.openInventory();
    });
    this.controls.on('button', (name) => {
      if (name === 'pause') this.pause();
      else if (name === 'inventory') this.openInventory();
      else if (name.startsWith('slot:')) this.selectSlot(parseInt(name.slice(5), 10));
    });
    this.controls.on('lockchange', (locked) => {
      document.getElementById('click-to-play').classList.toggle('hidden', locked || this.state !== 'playing');
      if (!locked && this.state === 'playing' && !this.isTouch) {
        if (this.ignoreUnlock) { this.ignoreUnlock = false; return; }
        this.pause();
      }
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.state === 'inventory') this.resume();
      // touch keyboards / desktop without pointer lock support
      if (e.code === 'KeyP' && this.state === 'playing') this.pause();
    });

    const saveNow = () => { if (this.state === 'playing' || this.state === 'paused' || this.state === 'inventory') this.save(false); };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        saveNow();
        if (this.state === 'playing') this.pause();
      }
    });
    window.addEventListener('pagehide', saveNow);
    window.addEventListener('beforeunload', saveNow);
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.handCamera.aspect = w / h;
    this.handCamera.updateProjectionMatrix();
    this._placeHand();
  }

  applySettings() {
    const s = this.settings;
    Store.saveSettings(s);
    const dpr = window.devicePixelRatio || 1;
    const ratio = s.quality === 'low' ? Math.min(dpr, 1) * (this.isTouch ? 0.75 : 1)
      : s.quality === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2);
    this.renderer.setPixelRatio(ratio);
    this.onResize();
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.controls.sensitivity = s.sensitivity;
    this.controls.invertY = s.invertY;
    this.sfx.enabled = s.sound;
    this.sky.setCloudsVisible(s.clouds);
    if (this.player) this.player.autoJump = s.autoJump;
    if (this.world && this.state !== 'title') {
      this.world.renderDistance = s.renderDistance;
      this.world.lastCenter = null; // re-evaluate queue
    }
    this.sky.setFogDistance((this.world ? this.world.renderDistance : s.renderDistance) * 16 - 6);
    document.getElementById('info').classList.toggle('hidden', !s.showFps);
  }

  // ---------------------------------------------------------------- states
  setState(st) {
    this.state = st;
    const inGame = st === 'playing' || st === 'paused' || st === 'inventory';
    document.getElementById('hud').classList.toggle('hidden', !inGame);
    document.body.classList.toggle('creative', !!(this.worldState && this.worldState.mode === 'creative') && inGame);
  }

  startTitle() {
    this.disposeWorld();
    this.worldState = null;
    this.world = new World(this.scene, hashString('blockworld-title'));
    this.world.renderDistance = this.isTouch ? 2 : 3;
    this.world.lastCenter = null;
    this.particles.world = this.world;
    this.sky.setFogDistance(this.world.renderDistance * 16 - 4);
    const spawn = this.world.gen.findSpawn();
    this.titleCenter = new THREE.Vector3(spawn.x, spawn.y + 10, spawn.z);
    this.time = 0.12;
    this.setHand(0);
    this.ui.stack = [];
    this.ui.show('title');
    this.setState('title');
  }

  disposeWorld() {
    if (this.world) this.world.dispose();
    this.world = null;
    this.player = null;
    this.particles.clear();
    this.highlight.visible = false;
    this.setHand(0);
  }

  createWorld({ name, seed, mode }) {
    let seedNum;
    if (!seed) seedNum = (Math.random() * 2 ** 31) | 0;
    else if (/^-?\d+$/.test(seed)) seedNum = parseInt(seed, 10) | 0;
    else seedNum = hashString(seed) | 0;
    const state = {
      id: Store.newWorldId(), name, mode, seed: seedNum, seedText: seed || String(seedNum),
      created: Date.now(), time: 0.06, player: null, edits: {},
      slots: mode === 'creative' ? CREATIVE_HOTBAR.map((id) => ({ id, count: 1 })) : Array.from({ length: 9 }, () => ({ id: 0, count: 0 })),
      selected: 0,
    };
    Store.saveWorld(state);
    this.startWorld(state);
  }

  loadWorld(id) {
    const state = Store.loadWorld(id);
    if (!state) { alert('Could not load this world.'); return; }
    this.startWorld(state);
  }

  startWorld(state) {
    this.disposeWorld();
    this.worldState = state;
    this.world = new World(this.scene, state.seed, state.edits || {});
    this.world.renderDistance = this.settings.renderDistance;
    this.particles.world = this.world;
    this.player = new Player(this.world);
    this.player.creative = state.mode === 'creative';
    this.player.autoJump = this.settings.autoJump;
    this.time = state.time ?? 0.06;
    this.slots = (state.slots || []).map((s) => ({ id: s.id | 0, count: s.count | 0 }));
    while (this.slots.length < 9) this.slots.push({ id: 0, count: 0 });
    this.selected = state.selected | 0;
    if (state.player) {
      const p = state.player;
      this.player.pos.set(p.x, p.y, p.z);
      this.player.yaw = p.yaw || 0; this.player.pitch = p.pitch || 0;
      this.player.flying = !!p.flying && this.player.creative;
      this.needsSpawnFix = false;
    } else {
      const s = this.world.gen.findSpawn();
      this.player.pos.set(s.x, s.y, s.z);
      this.player.yaw = Math.PI * 0.25;
      this.needsSpawnFix = true;
    }
    this.player.frozen = true;
    this.applySettings();
    this.ui.show('loading');
    this.ui.setLoading(0, 'Generating world…');
    this.loadingTotal = null;
    this.setState('loading');
  }

  finishLoading() {
    const p = this.player;
    if (this.needsSpawnFix) {
      const x = Math.floor(p.pos.x), z = Math.floor(p.pos.z);
      p.pos.y = this.world.topSolid(x, z) + 1.001;
    }
    // never start inside blocks
    let guard = 0;
    while (p.collides(p.pos.x, p.pos.y, p.pos.z) && guard++ < HEIGHT) p.pos.y += 1;
    p.frozen = false;
    this.ui.show(null);
    this.setState('playing');
    this.refreshHotbar();
    this.setHand(this.slots[this.selected]?.id || 0);
    document.getElementById('mode-badge').textContent = (this.worldState.mode === 'creative' ? 'CREATIVE' : 'SURVIVAL') + ' · ' + this.worldState.name;
    this.ui.toast(this.isTouch ? 'Left: move · Right: look' : 'Click to start');
    if (!this.isTouch) {
      document.getElementById('click-to-play').classList.remove('hidden');
      this.controls.requestLock();
    }
    this.controls.enabled = true;
    this.save(false);
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'inventory') return;
    this.controls.reset();
    this.ignoreUnlock = true;
    this.controls.exitLock();
    setTimeout(() => { this.ignoreUnlock = false; }, 100);
    this.setState('paused');
    this.ui.stack = [];
    this.ui.show('pause');
    const ws = this.worldState;
    document.getElementById('pause-info').textContent = `${ws.name} · ${ws.mode} · seed ${ws.seedText ?? ws.seed}`;
  }

  resume() {
    if (!this.world || !this.player) return;
    this.ui.show(null);
    this.ui.stack = [];
    this.controls.reset();
    this.setState('playing');
    if (!this.isTouch) {
      document.getElementById('click-to-play').classList.remove('hidden');
      this.controls.requestLock();
    }
  }

  openInventory() {
    if (this.state !== 'playing' || !this.player?.creative) return;
    this.controls.reset();
    this.ignoreUnlock = true;
    this.controls.exitLock();
    this.setState('inventory');
    this.ui.show('inventory');
  }

  quitToTitle() {
    this.save(false);
    this.controls.enabled = false;
    this.controls.exitLock();
    this.startTitle();
  }

  save(showToast) {
    if (!this.worldState || !this.world || !this.player) return;
    const p = this.player;
    const st = this.worldState;
    st.time = this.time;
    st.player = { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, pitch: p.pitch, flying: p.flying };
    st.edits = this.world.serializeEdits();
    st.slots = this.slots;
    st.selected = this.selected;
    const ok = Store.saveWorld(st);
    if (showToast) this.ui.toast(ok ? 'World saved!' : 'Save failed (storage full?)');
    this.autosaveTimer = 0;
  }

  // ---------------------------------------------------------------- hotbar
  selectSlot(i) {
    if (!this.player || i < 0 || i > 8) return;
    this.selected = i;
    this.refreshHotbar();
    const id = this.slots[i]?.id;
    this.setHand(id || 0);
    if (id) this.ui.toast(BLOCKS[id].name);
  }

  setSlotBlock(id) {
    this.slots[this.selected] = { id, count: 1 };
    this.refreshHotbar();
    this.setHand(id);
  }

  refreshHotbar() {
    this.ui.renderHotbar(this.slots, this.selected, this.player?.creative);
  }

  addToInventory(id) {
    if (!id) return;
    let slot = this.slots.find((s) => s.id === id && s.count < MAX_STACK);
    if (!slot) slot = this.slots.find((s) => !s.id || s.count <= 0);
    if (!slot) return;
    if (slot.id !== id) { slot.id = id; slot.count = 0; }
    slot.count++;
    this.refreshHotbar();
    if (this.slots[this.selected] === slot) this.setHand(id);
  }

  // ---------------------------------------------------------------- held block
  setHand(id) {
    if (this.handId === id) return;
    this.handId = id;
    if (this.hand) { this.handScene.remove(this.hand); this.hand.geometry.dispose(); this.hand = null; }
    if (!id || !this.world) return;
    const b = BLOCKS[id];
    let geo;
    if (RENDER[id] === 2) {
      geo = new THREE.PlaneGeometry(0.32, 0.32);
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        const [u, v] = tileUV(b.side, uv.getX(i), uv.getY(i));
        uv.setXY(i, u, v);
      }
    } else {
      geo = new THREE.BoxGeometry(0.24, 0.24, 0.24);
      const uv = geo.attributes.uv;
      const tiles = [b.side, b.side, b.top, b.bottom, b.side, b.side];
      for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
        const i = f * 4 + k;
        const [u, v] = tileUV(tiles[f], uv.getX(i), uv.getY(i));
        uv.setXY(i, u, v);
      }
    }
    const mat = this.handMat || (this.handMat = new THREE.MeshLambertMaterial({ alphaTest: 0.5, side: THREE.DoubleSide }));
    mat.map = this.world.atlas;
    mat.transparent = id === B.WATER;
    mat.opacity = id === B.WATER ? 0.8 : 1;
    mat.needsUpdate = true;
    this.hand = new THREE.Mesh(geo, mat);
    this.handScene.add(this.hand);
    this._placeHand();
  }

  _placeHand() {
    if (!this.hand) return;
    const portrait = this.handCamera.aspect < 1;
    this.handBase = new THREE.Vector3(portrait ? 0.26 : 0.5, portrait ? -0.5 : -0.4, -1.0);
    this.hand.rotation.set(0.25, -0.7, 0.05);
  }

  // ---------------------------------------------------------------- frame
  frame() {
    const now = performance.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.1) dt = 0.1;

    this.fpsFrames++; this.fpsTime += dt;
    if (this.fpsTime >= 0.5) { this.fps = Math.round(this.fpsFrames / this.fpsTime); this.fpsFrames = 0; this.fpsTime = 0; }

    let underwater = false;
    if (this.state === 'title') {
      this.titleAngle += dt * 0.05;
      const r = 28;
      const c = this.titleCenter;
      this.camera.position.set(c.x + Math.cos(this.titleAngle) * r, c.y + 4, c.z + Math.sin(this.titleAngle) * r);
      this.camera.lookAt(c.x, c.y - 6, c.z);
      this.world.update(this.camera.position.x, this.camera.position.z, 4);
      this.time = (this.time + dt / 400) % 1;
    } else if (this.state === 'loading') {
      const res = this.world.update(this.player.pos.x, this.player.pos.z, 30);
      if (this.loadingTotal === null) this.loadingTotal = Math.max(1, res.pending);
      const ready = this.world.isMeshedAround(this.player.pos.x, this.player.pos.z, 1);
      this.ui.setLoading(Math.min(0.98, 1 - res.pending / this.loadingTotal));
      this.player.applyToCamera(this.camera, false);
      if (ready) this.finishLoading();
    } else if (this.world && this.player) {
      const playing = this.state === 'playing';
      const input = playing ? this.controls.read() : { moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0 };
      const p = this.player;
      if (playing) {
        p.yaw -= input.lookDX;
        p.pitch -= input.lookDY;
        p.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, p.pitch));
        if (input.toggleFly && p.creative) {
          p.flying = !p.flying;
          if (p.flying) p.vel.y = 0;
          this.ui.toast(p.flying ? 'Flying' : 'Walking');
        }
      }
      p.update(dt, input);
      document.body.classList.toggle('flying', p.flying);
      p.applyToCamera(this.camera, this.settings.viewBob);
      if (playing) this.handleInteraction(dt, input);
      this.world.update(p.pos.x, p.pos.z, this.isTouch ? 5 : 8);
      this.time = (this.time + dt / this.settings.dayLength) % 1;
      underwater = p.headInWater;
      if (p.inWater && !this.wasInWater && p.vel.y < -2) this.sfx.splash();
      this.wasInWater = p.inWater;

      this.autosaveTimer += dt;
      if (this.autosaveTimer > AUTOSAVE_SECONDS && this.state === 'playing') this.save(false);

      if (this.settings.showFps) {
        const ps = p.pos;
        document.getElementById('info').textContent =
          `${this.fps} fps\nXYZ ${ps.x.toFixed(1)} ${ps.y.toFixed(1)} ${ps.z.toFixed(1)}\nchunks ${this.world.chunks.size}  time ${(((this.time * 24) + 6) % 24).toFixed(1)}h`;
      }
    }

    // sky, fog & lighting
    const sky = this.sky.update(this.time, this.camera, dt, underwater);
    document.getElementById('underwater').classList.toggle('on', underwater);
    if (underwater) { this.scene.fog.near = 0.5; this.scene.fog.far = 22; }
    else this.sky.setFogDistance(this.world.renderDistance * 16 - 6);
    if (this.world) this.world.waterTex.offset.set((now / 1000) * 0.04, (now / 1000) * 0.025);
    this.particles.update(dt);

    // held block bobbing & swing
    if (this.hand && this.state !== 'title') {
      const p = this.player;
      const bob = p && this.settings.viewBob ? p.bob : 0;
      this.handSwing = Math.max(0, this.handSwing - dt * 4);
      const sw = Math.sin(this.handSwing * Math.PI);
      this.hand.position.set(
        this.handBase.x + Math.cos(bob) * 0.03 - sw * 0.15,
        this.handBase.y - Math.abs(Math.sin(bob)) * 0.03 - sw * 0.1,
        this.handBase.z - sw * 0.2,
      );
      this.hand.rotation.x = 0.25 - sw * 0.6;
      const l = 0.35 + 0.65 * sky.day;
      this.handAmbient.intensity = 0.7 * l + 0.2;
      this.handLight.intensity = 0.9 * l;
    }

    this.renderer.clear();
    this.renderer.setClearColor(this.scene.fog.color);
    this.renderer.render(this.scene, this.camera);
    if (this.hand && (this.state === 'playing' || this.state === 'paused' || this.state === 'inventory')) {
      this.renderer.clearDepth();
      this.renderer.render(this.handScene, this.handCamera);
    }
  }

  handleInteraction(dt, input) {
    const p = this.player;
    const eye = p.eye;
    p.lookDir(this.dir);
    const hit = this.world.raycast(eye, this.dir, REACH);
    if (hit) {
      this.highlight.visible = true;
      if (RENDER[hit.id] === 2) {
        this.highlight.scale.set(0.7, 0.8, 0.7);
        this.highlight.position.set(hit.x + 0.5, hit.y + 0.4, hit.z + 0.5);
      } else {
        this.highlight.scale.set(1, 1, 1);
        this.highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      }
    } else this.highlight.visible = false;

    const ring = document.getElementById('break-ring');
    this.breakCooldown -= dt;

    // ---- breaking
    if (input.breakHeld && hit && BLOCKS[hit.id].breakable !== false) {
      const sameTarget = this.breakTarget && this.breakTarget.x === hit.x && this.breakTarget.y === hit.y && this.breakTarget.z === hit.z;
      if (!sameTarget) { this.breakTarget = { x: hit.x, y: hit.y, z: hit.z }; this.breakProgress = 0; }
      if (this.breakCooldown <= 0) {
        const hardness = p.creative ? 0 : BLOCKS[hit.id].hardness;
        if (hardness <= 0) this.breakBlock(hit);
        else {
          this.breakProgress += dt / hardness;
          if (Math.random() < dt * 8) this.handSwing = 1;
          ring.classList.add('on');
          ring.style.setProperty('--p', Math.min(1, this.breakProgress).toFixed(3));
          if (this.breakProgress >= 1) this.breakBlock(hit);
        }
      }
    } else {
      this.breakTarget = null;
      this.breakProgress = 0;
      ring.classList.remove('on');
    }
    if (!input.breakHeld) this.breakCooldown = 0;

    // ---- placing
    if (input.place && hit) {
      const slot = this.slots[this.selected];
      if (slot && slot.id && (p.creative || slot.count > 0)) this.placeBlock(hit, slot);
    }

    // ---- pick block (middle click)
    if (input.pick && hit && p.creative && hit.id !== B.BEDROCK) this.setSlotBlock(hit.id);
  }

  breakBlock(hit) {
    const id = hit.id;
    this.world.setBlock(hit.x, hit.y, hit.z, this._fillAfterBreak(hit.x, hit.y, hit.z));
    this.particles.burst(hit.x, hit.y, hit.z, getBlockColor(id), this.isTouch ? 10 : 16);
    this.sfx.break(materialOf(id));
    this.handSwing = 1;
    this.breakProgress = 0;
    this.breakTarget = null;
    this.breakCooldown = this.player.creative ? 0.22 : 0.12;
    document.getElementById('break-ring').classList.remove('on');
    if (!this.player.creative) {
      const drop = BLOCKS[id].drop;
      if (drop && id !== B.TALLGRASS) this.addToInventory(drop);
    }
    if (navigator.vibrate && this.isTouch) navigator.vibrate(12);
  }

  // Water flows into a broken block's space if there's water next to/above it
  _fillAfterBreak(x, y, z) {
    const w = this.world;
    if (w.getBlock(x, y + 1, z) === B.WATER) return B.WATER;
    const n = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dz] of n) if (w.getBlock(x + dx, y, z + dz) === B.WATER) return B.WATER;
    return B.AIR;
  }

  placeBlock(hit, slot) {
    const p = this.player;
    const w = this.world;
    let x, y, z;
    // clicking a plant replaces it
    if (RENDER[hit.id] === 2) { x = hit.x; y = hit.y; z = hit.z; }
    else { x = hit.x + hit.nx; y = hit.y + hit.ny; z = hit.z + hit.nz; }
    if (y < 0 || y >= HEIGHT) return;
    const cur = w.getBlock(x, y, z);
    if (cur !== B.AIR && cur !== B.WATER && RENDER[cur] !== 2) return;
    const id = slot.id;
    if (IS_SOLID[id] && p.intersectsBlock(x, y, z)) return;
    if (RENDER[id] === 2) {
      const below = w.getBlock(x, y - 1, z);
      if (below !== B.GRASS && below !== B.DIRT) return;
      if (cur === B.WATER) return;
    }
    if (!w.setBlock(x, y, z, id)) return;
    this.sfx.place(materialOf(id));
    this.handSwing = 1;
    if (!p.creative) {
      slot.count--;
      if (slot.count <= 0) { slot.id = 0; slot.count = 0; this.setHand(0); }
      this.refreshHotbar();
    }
  }
}

function tileUV(tile, u, v) {
  const col = tile % ATLAS_COLS, row = Math.floor(tile / ATLAS_COLS);
  const e = 0.002;
  const u0 = col / ATLAS_COLS + e, u1 = (col + 1) / ATLAS_COLS - e;
  const v1 = 1 - row / ATLAS_ROWS - e, v0 = 1 - (row + 1) / ATLAS_ROWS + e;
  return [u0 + (u1 - u0) * u, v0 + (v1 - v0) * v];
}

function boot() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) throw new Error('WebGL 2 is not available on this device/browser (iOS 15+ / a modern browser is required).');
    window.blockworld = new Game();
  } catch (e) {
    console.error(e);
    const el = document.getElementById('boot-error');
    el.textContent = 'BlockWorld could not start: ' + e.message;
    el.classList.remove('hidden');
  }
}
boot();
