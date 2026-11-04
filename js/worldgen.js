// Deterministic terrain generation: hills, mountains, beaches, deserts,
// snow peaks, caves, ores, water, trees and flowers.
import { SimplexNoise, hash2 } from './noise.js';
import { B } from './blocks.js';

export const CHUNK = 16;
export const HEIGHT = 64;
export const SEA_LEVEL = 24;

export class WorldGen {
  constructor(seed) {
    this.seed = seed | 0;
    this.n1 = new SimplexNoise(seed);
    this.n2 = new SimplexNoise(seed + 101);
    this.n3 = new SimplexNoise(seed + 202);
    this.caveA = new SimplexNoise(seed + 303);
    this.caveB = new SimplexNoise(seed + 404);
    this.caveC = new SimplexNoise(seed + 505);
    this.biome = new SimplexNoise(seed + 606);
  }

  // Surface height (y of the top solid block) for a world column.
  height(x, z) {
    const cont = this.n1.fbm2(x * 0.0035, z * 0.0035, 3);      // continents / oceans
    const hills = this.n2.fbm2(x * 0.018, z * 0.018, 4);       // rolling hills
    let m = this.n3.fbm2(x * 0.007 + 50, z * 0.007 - 50, 3);   // mountains
    m = Math.max(0, m - 0.05);
    let h = SEA_LEVEL + 3 + cont * 12 + hills * 5 + m * m * 90;
    return Math.max(4, Math.min(HEIGHT - 8, Math.floor(h)));
  }

  // 0 = temperate, 1 = desert
  temperature(x, z) {
    return this.biome.fbm2(x * 0.0025 + 300, z * 0.0025 + 300, 2);
  }

  forest(x, z) {
    return this.biome.noise2(x * 0.01 - 400, z * 0.01 + 200);
  }

  isCave(x, y, z, h) {
    if (y <= 1) return false;
    // keep ocean / lake floors sealed so water doesn't hang over caves
    if (h <= SEA_LEVEL + 1 && y > h - 6) return false;
    const a = this.caveA.noise3(x * 0.055, y * 0.08, z * 0.055);
    const b = this.caveB.noise3(x * 0.055, y * 0.08, z * 0.055);
    if (a * a + b * b < 0.014) return true; // spaghetti tunnels
    if (y < h - 8) {
      const c = this.caveC.noise3(x * 0.03, y * 0.05, z * 0.03);
      if (c > 0.68) return true; // larger caverns
    }
    return false;
  }

  generateChunk(cx, cz) {
    const data = new Uint8Array(CHUNK * CHUNK * HEIGHT);
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const heights = new Int16Array(CHUNK * CHUNK);
    const seed = this.seed;

    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const wx = x0 + lx, wz = z0 + lz;
        const h = this.height(wx, wz);
        heights[lx + lz * CHUNK] = h;
        const temp = this.temperature(wx, wz);
        const desert = temp > 0.28;
        const beach = h <= SEA_LEVEL + 1;
        const snowy = h >= 44 + Math.floor(hash2(wx, wz, seed) * 3);
        const top = Math.max(h, SEA_LEVEL);
        for (let y = 0; y <= top; y++) {
          let id = B.AIR;
          if (y === 0) id = B.BEDROCK;
          else if (y <= h) {
            const depth = h - y;
            if (depth === 0) {
              if (h < SEA_LEVEL) id = (hash2(wx, wz, seed + 7) < 0.3) ? B.GRAVEL : B.SAND;
              else if (beach || desert) id = B.SAND;
              else if (snowy) id = B.SNOW;
              else if (h > 50) id = B.STONE;
              else id = B.GRASS;
            } else if (depth < 4) {
              if (beach || desert) id = depth < 3 ? B.SAND : B.STONE;
              else if (h > 50) id = B.STONE;
              else id = B.DIRT;
            } else {
              id = B.STONE;
              const r = hash2(wx * 31 + y, wz * 17 - y, seed + 11);
              if (r < 0.012) id = B.COAL;
              else if (y < 18 && r < 0.016) id = B.GOLD;
              else if (r > 0.993) id = B.GRAVEL;
            }
            if (y < h && id !== B.BEDROCK && this.isCave(wx, y, wz, h)) id = B.AIR;
          } else if (y <= SEA_LEVEL) {
            id = B.WATER;
          }
          data[lx + lz * CHUNK + y * CHUNK * CHUNK] = id;
        }

        // flowers & grass tufts
        if (h > SEA_LEVEL + 1 && h < HEIGHT - 2 && data[lx + lz * CHUNK + h * 256] === B.GRASS) {
          const r = hash2(wx, wz, seed + 99);
          let plant = 0;
          if (r < 0.10) plant = B.TALLGRASS;
          else if (r < 0.112) plant = B.ROSE;
          else if (r < 0.124) plant = B.DANDELION;
          if (plant) data[lx + lz * CHUNK + (h + 1) * 256] = plant;
        }
      }
    }

    this.placeTrees(data, cx, cz, heights);
    return data;
  }

  // Trees use a jittered grid so they are evenly spread and can cross chunk borders.
  placeTrees(data, cx, cz, heights) {
    const CELL = 5;
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const seed = this.seed;
    const gx0 = Math.floor((x0 - 3) / CELL), gx1 = Math.floor((x0 + CHUNK + 3) / CELL);
    const gz0 = Math.floor((z0 - 3) / CELL), gz1 = Math.floor((z0 + CHUNK + 3) / CELL);
    const setIf = (wx, y, wz, id, onlyAir) => {
      const lx = wx - x0, lz = wz - z0;
      if (lx < 0 || lz < 0 || lx >= CHUNK || lz >= CHUNK || y < 0 || y >= HEIGHT) return;
      const i = lx + lz * CHUNK + y * 256;
      const cur = data[i];
      if (onlyAir && cur !== B.AIR && cur !== B.TALLGRASS && cur !== B.ROSE && cur !== B.DANDELION) return;
      data[i] = id;
    };

    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const tx = gx * CELL + Math.floor(hash2(gx, gz, seed + 1) * CELL);
        const tz = gz * CELL + Math.floor(hash2(gx, gz, seed + 2) * CELL);
        const f = this.forest(tx, tz);
        const chance = 0.12 + Math.max(0, f) * 0.75;
        if (hash2(gx, gz, seed + 3) > chance) continue;
        const lx = tx - x0, lz = tz - z0;
        const h = (lx >= 0 && lz >= 0 && lx < CHUNK && lz < CHUNK) ? heights[lx + lz * CHUNK] : this.height(tx, tz);
        if (h <= SEA_LEVEL + 1 || h > 46) continue;
        if (this.temperature(tx, tz) > 0.28) continue; // no trees in deserts
        // ground must be grass (not carved away)
        if (lx >= 0 && lz >= 0 && lx < CHUNK && lz < CHUNK) {
          if (data[lx + lz * CHUNK + h * 256] !== B.GRASS) continue;
        } else if (this.isCave(tx, h - 1, tz, h)) continue;

        const trunk = 4 + Math.floor(hash2(gx, gz, seed + 4) * 3);
        const topY = h + trunk;
        // leaves
        for (let dy = -2; dy <= 1; dy++) {
          const r = dy <= -1 ? 2 : 1;
          for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
            const corner = Math.abs(dx) === r && Math.abs(dz) === r;
            if (corner && (dy === 1 || hash2(tx + dx * 7, tz + dz * 13 + dy, seed + 5) < 0.5)) continue;
            setIf(tx + dx, topY + dy, tz + dz, B.LEAVES, true);
          }
        }
        setIf(tx, topY + 1, tz, B.LEAVES, true);
        for (let y = h + 1; y <= topY; y++) setIf(tx, y, tz, B.LOG, false);
        setIf(tx, h, tz, B.DIRT, false);
      }
    }
  }

  findSpawn() {
    for (let r = 0; r < 200; r += 4) {
      for (let a = 0; a < 16; a++) {
        const x = Math.round(Math.cos(a / 16 * Math.PI * 2) * r);
        const z = Math.round(Math.sin(a / 16 * Math.PI * 2) * r);
        const h = this.height(x, z);
        if (h > SEA_LEVEL + 1 && h < 44) return { x: x + 0.5, y: h + 1.01, z: z + 0.5 };
      }
    }
    return { x: 0.5, y: this.height(0, 0) + 2, z: 0.5 };
  }
}
