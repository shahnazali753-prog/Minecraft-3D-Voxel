// Block registry + procedurally painted texture atlas (no image files needed).
import * as THREE from './three.js';
import { mulberry32 } from './noise.js';

export const TILE = 16;           // pixels per tile
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 4;

export const B = {
  AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, LOG: 5, LEAVES: 6, WATER: 7,
  PLANKS: 8, COBBLE: 9, GLASS: 10, BRICK: 11, SNOW: 12, BEDROCK: 13, COAL: 14,
  GRAVEL: 15, GOLD: 16, RED: 17, ORANGE: 18, YELLOW: 19, LIME: 20, BLUE: 21,
  PURPLE: 22, WHITE: 23, TALLGRASS: 24, ROSE: 25, DANDELION: 26,
};

// Tile indices in the atlas
const T = {
  grassTop: 0, grassSide: 1, dirt: 2, stone: 3, sand: 4, logSide: 5, logTop: 6, leaves: 7,
  planks: 8, cobble: 9, glass: 10, brick: 11, snow: 12, snowSide: 13, bedrock: 14, coal: 15,
  gravel: 16, gold: 17, water: 18, red: 19, orange: 20, yellow: 21, lime: 22, blue: 23,
  purple: 24, white: 25, tallgrass: 26, rose: 27, dandelion: 28,
};

// render: 'cube' | 'cross' | 'liquid'
// opaque: fully hides neighbouring faces + casts AO
// solid: collides with player
function def(id, name, tiles, opts = {}) {
  const t = typeof tiles === 'number' ? { top: tiles, side: tiles, bottom: tiles } : tiles;
  return {
    id, name,
    top: t.top, side: t.side, bottom: t.bottom ?? t.top,
    render: opts.render || 'cube',
    opaque: opts.opaque ?? true,
    solid: opts.solid ?? true,
    hardness: opts.hardness ?? 0.6,
    drop: opts.drop ?? id,
    breakable: opts.breakable ?? true,
    color: opts.color || '#888',
  };
}

export const BLOCKS = [];
BLOCKS[B.AIR] = def(B.AIR, 'Air', 0, { opaque: false, solid: false, render: 'none' });
BLOCKS[B.GRASS] = def(B.GRASS, 'Grass', { top: T.grassTop, side: T.grassSide, bottom: T.dirt }, { hardness: 0.45, drop: B.DIRT, color: '#5fb83a' });
BLOCKS[B.DIRT] = def(B.DIRT, 'Dirt', T.dirt, { hardness: 0.4, color: '#8a5a35' });
BLOCKS[B.STONE] = def(B.STONE, 'Stone', T.stone, { hardness: 1.0, drop: B.COBBLE, color: '#8c8c8c' });
BLOCKS[B.SAND] = def(B.SAND, 'Sand', T.sand, { hardness: 0.35, color: '#e8d48f' });
BLOCKS[B.LOG] = def(B.LOG, 'Wood', { top: T.logTop, side: T.logSide }, { hardness: 0.8, color: '#6b4a2a' });
BLOCKS[B.LEAVES] = def(B.LEAVES, 'Leaves', T.leaves, { opaque: false, hardness: 0.15, color: '#3f9a2e' });
BLOCKS[B.WATER] = def(B.WATER, 'Water', T.water, { opaque: false, solid: false, render: 'liquid', breakable: false, color: '#3a7bd5' });
BLOCKS[B.PLANKS] = def(B.PLANKS, 'Planks', T.planks, { hardness: 0.7, color: '#b58a50' });
BLOCKS[B.COBBLE] = def(B.COBBLE, 'Cobblestone', T.cobble, { hardness: 1.0, color: '#7a7a7a' });
BLOCKS[B.GLASS] = def(B.GLASS, 'Glass', T.glass, { opaque: false, hardness: 0.3, color: '#cfeefc' });
BLOCKS[B.BRICK] = def(B.BRICK, 'Bricks', T.brick, { hardness: 1.0, color: '#a5493a' });
BLOCKS[B.SNOW] = def(B.SNOW, 'Snow', { top: T.snow, side: T.snowSide, bottom: T.dirt }, { hardness: 0.3, color: '#f2f7ff' });
BLOCKS[B.BEDROCK] = def(B.BEDROCK, 'Bedrock', T.bedrock, { breakable: false, color: '#333' });
BLOCKS[B.COAL] = def(B.COAL, 'Coal Ore', T.coal, { hardness: 1.2, color: '#555' });
BLOCKS[B.GRAVEL] = def(B.GRAVEL, 'Gravel', T.gravel, { hardness: 0.45, color: '#8a8580' });
BLOCKS[B.GOLD] = def(B.GOLD, 'Gold Ore', T.gold, { hardness: 1.4, color: '#e6c24a' });
BLOCKS[B.RED] = def(B.RED, 'Red Block', T.red, { hardness: 0.5, color: '#d8403a' });
BLOCKS[B.ORANGE] = def(B.ORANGE, 'Orange Block', T.orange, { hardness: 0.5, color: '#f08a2c' });
BLOCKS[B.YELLOW] = def(B.YELLOW, 'Yellow Block', T.yellow, { hardness: 0.5, color: '#f5d63a' });
BLOCKS[B.LIME] = def(B.LIME, 'Lime Block', T.lime, { hardness: 0.5, color: '#7fd13b' });
BLOCKS[B.BLUE] = def(B.BLUE, 'Blue Block', T.blue, { hardness: 0.5, color: '#3a6fd8' });
BLOCKS[B.PURPLE] = def(B.PURPLE, 'Purple Block', T.purple, { hardness: 0.5, color: '#9b4ad8' });
BLOCKS[B.WHITE] = def(B.WHITE, 'White Block', T.white, { hardness: 0.5, color: '#eeeeee' });
BLOCKS[B.TALLGRASS] = def(B.TALLGRASS, 'Tall Grass', T.tallgrass, { opaque: false, solid: false, render: 'cross', hardness: 0, color: '#5fb83a' });
BLOCKS[B.ROSE] = def(B.ROSE, 'Rose', T.rose, { opaque: false, solid: false, render: 'cross', hardness: 0, color: '#e03a3a' });
BLOCKS[B.DANDELION] = def(B.DANDELION, 'Dandelion', T.dandelion, { opaque: false, solid: false, render: 'cross', hardness: 0, color: '#f5d63a' });

// Blocks offered in the creative inventory (in order)
export const CREATIVE_BLOCKS = [
  B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.SAND, B.GRAVEL, B.LOG, B.PLANKS, B.LEAVES,
  B.GLASS, B.BRICK, B.SNOW, B.COAL, B.GOLD, B.WATER, B.RED, B.ORANGE, B.YELLOW,
  B.LIME, B.BLUE, B.PURPLE, B.WHITE, B.TALLGRASS, B.ROSE, B.DANDELION, B.BEDROCK,
];

// Fast lookup tables for the mesher / physics
export const IS_OPAQUE = new Uint8Array(256);
export const IS_SOLID = new Uint8Array(256);
export const RENDER = new Uint8Array(256); // 0 none, 1 cube, 2 cross, 3 liquid
for (const b of BLOCKS) {
  if (!b) continue;
  IS_OPAQUE[b.id] = b.opaque ? 1 : 0;
  IS_SOLID[b.id] = b.solid ? 1 : 0;
  RENDER[b.id] = { none: 0, cube: 1, cross: 2, liquid: 3 }[b.render];
}

// ---------------------------------------------------------------------------
// Texture painting
// ---------------------------------------------------------------------------
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const clamp255 = (v) => Math.max(0, Math.min(255, v | 0));

function painter(ctx, tileIndex, seed) {
  const ox = (tileIndex % ATLAS_COLS) * TILE;
  const oy = Math.floor(tileIndex / ATLAS_COLS) * TILE;
  const img = ctx.createImageData(TILE, TILE);
  const rand = mulberry32(seed * 9973 + 17);
  const set = (x, y, rgb, a = 255) => {
    const i = (y * TILE + x) * 4;
    img.data[i] = clamp255(rgb[0]); img.data[i + 1] = clamp255(rgb[1]);
    img.data[i + 2] = clamp255(rgb[2]); img.data[i + 3] = a;
  };
  const get = (x, y) => {
    const i = (y * TILE + x) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
  };
  const noisy = (base, amt) => {
    const c = hexToRgb(base);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const v = (rand() - 0.5) * amt;
      set(x, y, [c[0] + v, c[1] + v, c[2] + v]);
    }
  };
  return { img, rand, set, get, noisy, commit: () => ctx.putImageData(img, ox, oy) };
}

function paintAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * TILE;
  canvas.height = ATLAS_ROWS * TILE;
  const ctx = canvas.getContext('2d');

  const tiles = {
    grassTop(p) {
      p.noisy('#5cb338', 34);
      for (let i = 0; i < 26; i++) {
        const x = (p.rand() * TILE) | 0, y = (p.rand() * TILE) | 0;
        p.set(x, y, p.rand() < 0.5 ? [120, 205, 80] : [62, 140, 40]);
      }
    },
    dirt(p) {
      p.noisy('#8b5a35', 40);
      for (let i = 0; i < 18; i++) {
        const x = (p.rand() * TILE) | 0, y = (p.rand() * TILE) | 0;
        p.set(x, y, p.rand() < 0.5 ? [110, 72, 45] : [160, 112, 74]);
      }
    },
    grassSide(p) {
      tiles.dirt(p);
      for (let x = 0; x < TILE; x++) {
        const depth = 3 + ((p.rand() * 3) | 0);
        for (let y = 0; y < depth; y++) {
          const v = (p.rand() - 0.5) * 30;
          p.set(x, y, [92 + v, 179 + v, 56 + v]);
        }
      }
    },
    stone(p) {
      p.noisy('#8f8f8f', 26);
      for (let i = 0; i < 10; i++) {
        let x = (p.rand() * TILE) | 0, y = (p.rand() * TILE) | 0;
        for (let k = 0; k < 3; k++) {
          p.set(x, y, [108, 108, 108]);
          x = (x + 1) % TILE; if (p.rand() < 0.5) y = (y + 1) % TILE;
        }
      }
    },
    sand(p) {
      p.noisy('#e6d395', 22);
      for (let i = 0; i < 14; i++) p.set((p.rand() * TILE) | 0, (p.rand() * TILE) | 0, [205, 185, 120]);
    },
    logSide(p) {
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const stripe = (x % 4 === 0) ? -26 : (x % 4 === 2 ? 10 : 0);
        const v = (p.rand() - 0.5) * 20 + stripe;
        p.set(x, y, [108 + v, 76 + v, 44 + v]);
      }
    },
    logTop(p) {
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        let c;
        if (d > 6.5) c = [100, 70, 40];
        else c = (Math.floor(d) % 2 === 0) ? [190, 150, 95] : [160, 122, 74];
        const v = (p.rand() - 0.5) * 14;
        p.set(x, y, [c[0] + v, c[1] + v, c[2] + v]);
      }
    },
    leaves(p) {
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const r = p.rand();
        if (r < 0.08) { p.set(x, y, [0, 0, 0], 0); continue; }
        const v = (p.rand() - 0.5) * 50;
        const g = r < 0.3 ? [40, 110, 30] : [66, 160, 48];
        p.set(x, y, [g[0] + v * 0.4, g[1] + v, g[2] + v * 0.4]);
      }
    },
    planks(p) {
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const row = Math.floor(y / 4);
        const seam = (y % 4 === 3) || ((x + row * 5) % 16 === 0);
        const v = (p.rand() - 0.5) * 16;
        p.set(x, y, seam ? [120, 85, 48] : [184 + v, 140 + v, 82 + v]);
      }
    },
    cobble(p) {
      p.noisy('#7d7d7d', 20);
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const cx = Math.floor((x + (Math.floor(y / 5) % 2) * 3) / 5), cy = Math.floor(y / 5);
        const edge = (x + (Math.floor(y / 5) % 2) * 3) % 5 === 0 || y % 5 === 0;
        const shade = ((cx * 7 + cy * 13) % 5) * 8;
        const v = (p.rand() - 0.5) * 18;
        p.set(x, y, edge ? [70, 70, 70] : [118 + shade + v, 118 + shade + v, 118 + shade + v]);
      }
    },
    glass(p) {
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const edge = x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1;
        const shine = (x - y === 3 || x - y === 4) && x > 3 && x < 12;
        if (edge) p.set(x, y, [200, 235, 250]);
        else if (shine) p.set(x, y, [240, 250, 255], 200);
        else p.set(x, y, [0, 0, 0], 0);
      }
    },
    brick(p) {
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const row = Math.floor(y / 4);
        const mortar = y % 4 === 3 || (x + (row % 2) * 4) % 8 === 7;
        const v = (p.rand() - 0.5) * 22;
        p.set(x, y, mortar ? [200, 195, 185] : [168 + v, 74 + v * 0.5, 58 + v * 0.5]);
      }
    },
    snow(p) { p.noisy('#f3f7fd', 12); },
    snowSide(p) {
      tiles.dirt(p);
      for (let x = 0; x < TILE; x++) {
        const depth = 3 + ((p.rand() * 3) | 0);
        for (let y = 0; y < depth; y++) { const v = (p.rand() - 0.5) * 10; p.set(x, y, [240 + v, 245 + v, 252 + v]); }
      }
    },
    bedrock(p) {
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const v = p.rand();
        const c = v < 0.33 ? 40 : v < 0.66 ? 75 : 110;
        p.set(x, y, [c, c, c]);
      }
    },
    ore(p, color) {
      tiles.stone(p);
      const c = hexToRgb(color);
      for (let i = 0; i < 6; i++) {
        const x = 1 + ((p.rand() * 13) | 0), y = 1 + ((p.rand() * 13) | 0);
        p.set(x, y, c); p.set(x + 1, y, c); p.set(x, y + 1, [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8]);
      }
    },
    gravel(p) {
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const r = p.rand();
        const c = r < 0.3 ? [110, 104, 100] : r < 0.6 ? [140, 134, 128] : r < 0.85 ? [160, 150, 145] : [95, 90, 88];
        p.set(x, y, c);
      }
    },
    water(p) {
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const w = Math.sin((x + y * 0.5) * 0.8) * 10 + Math.sin(y * 1.3) * 8;
        p.set(x, y, [50 + w, 120 + w, 215 + w * 0.5]);
      }
    },
    colored(p, color) {
      const c = hexToRgb(color);
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
        const edge = x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1;
        const v = (p.rand() - 0.5) * 14 + (edge ? -22 : 0);
        p.set(x, y, [c[0] + v, c[1] + v, c[2] + v]);
      }
    },
    tallgrass(p) {
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) p.set(x, y, [0, 0, 0], 0);
      for (let b = 0; b < 7; b++) {
        let x = 1 + ((p.rand() * 14) | 0);
        const h = 6 + ((p.rand() * 9) | 0);
        for (let i = 0; i < h; i++) {
          const y = TILE - 1 - i;
          const v = (p.rand() - 0.5) * 30;
          p.set(x, y, [70 + v + i * 3, 160 + v + i * 4, 50 + v]);
          if (i > 3 && p.rand() < 0.3) x = Math.max(0, Math.min(TILE - 1, x + (p.rand() < 0.5 ? -1 : 1)));
        }
      }
    },
    flower(p, petal, center) {
      for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) p.set(x, y, [0, 0, 0], 0);
      for (let y = 7; y < TILE; y++) p.set(7, y, [60, 140, 40]);
      p.set(6, 11, [70, 160, 50]); p.set(5, 10, [70, 160, 50]); p.set(8, 12, [70, 160, 50]); p.set(9, 11, [70, 160, 50]);
      const pc = hexToRgb(petal), cc = hexToRgb(center);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > 3) continue;
        p.set(7 + dx, 5 + dy, pc);
      }
      p.set(7, 5, cc);
    },
  };

  const jobs = [
    [T.grassTop, (p) => tiles.grassTop(p)], [T.grassSide, (p) => tiles.grassSide(p)],
    [T.dirt, (p) => tiles.dirt(p)], [T.stone, (p) => tiles.stone(p)], [T.sand, (p) => tiles.sand(p)],
    [T.logSide, (p) => tiles.logSide(p)], [T.logTop, (p) => tiles.logTop(p)], [T.leaves, (p) => tiles.leaves(p)],
    [T.planks, (p) => tiles.planks(p)], [T.cobble, (p) => tiles.cobble(p)], [T.glass, (p) => tiles.glass(p)],
    [T.brick, (p) => tiles.brick(p)], [T.snow, (p) => tiles.snow(p)], [T.snowSide, (p) => tiles.snowSide(p)],
    [T.bedrock, (p) => tiles.bedrock(p)], [T.coal, (p) => tiles.ore(p, '#262626')],
    [T.gravel, (p) => tiles.gravel(p)], [T.gold, (p) => tiles.ore(p, '#f2cc3d')], [T.water, (p) => tiles.water(p)],
    [T.red, (p) => tiles.colored(p, '#d8403a')], [T.orange, (p) => tiles.colored(p, '#f08a2c')],
    [T.yellow, (p) => tiles.colored(p, '#f5d63a')], [T.lime, (p) => tiles.colored(p, '#7fd13b')],
    [T.blue, (p) => tiles.colored(p, '#3a6fd8')], [T.purple, (p) => tiles.colored(p, '#9b4ad8')],
    [T.white, (p) => tiles.colored(p, '#eeeeee')], [T.tallgrass, (p) => tiles.tallgrass(p)],
    [T.rose, (p) => tiles.flower(p, '#e8343a', '#ffd84a')], [T.dandelion, (p) => tiles.flower(p, '#f7d93a', '#f08a2c')],
  ];
  for (const [idx, fn] of jobs) {
    const p = painter(ctx, idx, idx + 1);
    fn(p);
    p.commit();
  }
  return canvas;
}

let atlasCanvas = null;
export function getAtlasCanvas() {
  if (!atlasCanvas) atlasCanvas = paintAtlas();
  return atlasCanvas;
}

export function createAtlasTexture() {
  const tex = new THREE.CanvasTexture(getAtlasCanvas());
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Separate tiling water texture (world-space UVs, animated by offset)
export function createWaterTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(32, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const w = Math.sin((x / 32) * Math.PI * 4 + Math.sin((y / 32) * Math.PI * 2) * 1.5) * 0.5 + 0.5;
    const w2 = Math.sin((y / 32) * Math.PI * 6 + (x / 32) * Math.PI * 2) * 0.5 + 0.5;
    const v = w * 0.6 + w2 * 0.4;
    const i = (y * 32 + x) * 4;
    img.data[i] = 40 + v * 50; img.data[i + 1] = 120 + v * 60; img.data[i + 2] = 210 + v * 35; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Isometric icon for the hotbar / inventory, returned as a data URL (cached).
const iconCache = new Map();
export function getBlockIcon(id, size = 64) {
  const key = id + ':' + size;
  if (iconCache.has(key)) return iconCache.get(key);
  const atlas = getAtlasCanvas();
  const b = BLOCKS[id];
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const tileCanvas = (tile, darken) => {
    const t = document.createElement('canvas');
    t.width = t.height = TILE;
    const tc = t.getContext('2d');
    tc.drawImage(atlas, (tile % ATLAS_COLS) * TILE, Math.floor(tile / ATLAS_COLS) * TILE, TILE, TILE, 0, 0, TILE, TILE);
    if (darken > 0) {
      tc.globalCompositeOperation = 'source-atop';
      tc.fillStyle = `rgba(0,0,0,${darken})`;
      tc.fillRect(0, 0, TILE, TILE);
    }
    return t;
  };
  const s = size / 64;
  if (b.render === 'cross') {
    ctx.drawImage(tileCanvas(b.side, 0), 8 * s, 8 * s, 48 * s, 48 * s);
  } else {
    const k = s / TILE;
    // top
    ctx.setTransform(26 * k, 13 * k, -26 * k, 13 * k, 32 * s, 6 * s);
    ctx.drawImage(tileCanvas(b.top, 0), 0, 0);
    // left
    ctx.setTransform(26 * k, 13 * k, 0, 30 * k, 6 * s, 19 * s);
    ctx.drawImage(tileCanvas(b.side, 0.18), 0, 0);
    // right
    ctx.setTransform(26 * k, -13 * k, 0, 30 * k, 32 * s, 32 * s);
    ctx.drawImage(tileCanvas(b.side, 0.38), 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  const url = c.toDataURL();
  iconCache.set(key, url);
  return url;
}

// Average colour of a block's side tile (used for break particles)
const colorCache = new Map();
export function getBlockColor(id) {
  if (colorCache.has(id)) return colorCache.get(id);
  const b = BLOCKS[id];
  const ctx = getAtlasCanvas().getContext('2d');
  const data = ctx.getImageData((b.side % ATLAS_COLS) * TILE, Math.floor(b.side / ATLAS_COLS) * TILE, TILE, TILE).data;
  let r = 0, g = 0, bl = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    r += data[i]; g += data[i + 1]; bl += data[i + 2]; n++;
  }
  const col = n ? new THREE.Color(r / n / 255, g / n / 255, bl / n / 255) : new THREE.Color(b.color);
  colorCache.set(id, col);
  return col;
}
