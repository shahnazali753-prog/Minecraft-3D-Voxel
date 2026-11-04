// Builds chunk geometry with hidden-face culling, per-vertex ambient
// occlusion and a cheap "skylight" term (blocks under cover are darker).
import { BLOCKS, IS_OPAQUE, RENDER, B, ATLAS_COLS, ATLAS_ROWS } from './blocks.js';
import { CHUNK, HEIGHT } from './worldgen.js';

const P = CHUNK + 2;          // padded size
const PL = P * P;             // padded layer

// Face definitions: normal, 4 corners (CCW from outside), uv per corner, base shade
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.82, side: 'side' },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.82, side: 'side' },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0, side: 'top' },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.55, side: 'bottom' },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.7, side: 'side' },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.7, side: 'side' },
];
const UVS = [[0, 0], [1, 0], [1, 1], [0, 1]];
// For each face & corner precompute the AO neighbour offsets
for (const f of FACES) {
  const axis = f.n[0] !== 0 ? 0 : f.n[1] !== 0 ? 1 : 2;
  const t = [0, 1, 2].filter((a) => a !== axis);
  f.ao = f.c.map((corner) => {
    const s1 = [0, 0, 0], s2 = [0, 0, 0];
    s1[t[0]] = corner[t[0]] ? 1 : -1;
    s2[t[1]] = corner[t[1]] ? 1 : -1;
    const base = f.n;
    return {
      a: [base[0] + s1[0], base[1] + s1[1], base[2] + s1[2]],
      b: [base[0] + s2[0], base[1] + s2[1], base[2] + s2[2]],
      c: [base[0] + s1[0] + s2[0], base[1] + s1[1] + s2[1], base[2] + s1[2] + s2[2]],
    };
  });
}

const AO_CURVE = [0.42, 0.62, 0.8, 1.0];
const TU = 1 / ATLAS_COLS, TV = 1 / ATLAS_ROWS;
const INSET = 0.0015;

function tileUV(tile, u, v) {
  const col = tile % ATLAS_COLS, row = Math.floor(tile / ATLAS_COLS);
  // canvas row 0 is the top of the texture; flipY puts it at v=1
  const u0 = col * TU + INSET, u1 = (col + 1) * TU - INSET;
  const v1 = 1 - row * TV - INSET, v0 = 1 - (row + 1) * TV + INSET;
  return [u0 + (u1 - u0) * u, v0 + (v1 - v0) * v];
}

class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.idx = []; this.count = 0; }
  quad(verts, normal, uvs, colors, flip) {
    const b = this.count;
    for (let i = 0; i < 4; i++) {
      this.pos.push(verts[i][0], verts[i][1], verts[i][2]);
      this.nor.push(normal[0], normal[1], normal[2]);
      this.uv.push(uvs[i][0], uvs[i][1]);
      this.col.push(colors[i], colors[i], colors[i]);
    }
    if (flip) this.idx.push(b + 1, b + 2, b + 3, b + 1, b + 3, b);
    else this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    this.count += 4;
  }
  result() {
    if (this.count === 0) return null;
    return {
      position: new Float32Array(this.pos),
      normal: new Float32Array(this.nor),
      uv: new Float32Array(this.uv),
      color: new Float32Array(this.col),
      index: this.count > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx),
    };
  }
}

/**
 * @param {Uint8Array[]} n 3x3 neighbourhood of chunk data, index (dx+1)+(dz+1)*3, centre = 4
 */
export function buildChunkMesh(n) {
  // Copy into a padded volume for fast neighbour access
  const vol = new Uint8Array(PL * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    const yo = y * PL, so = y * CHUNK * CHUNK;
    for (let pz = 0; pz < P; pz++) {
      const lz = pz - 1;
      const dz = lz < 0 ? -1 : lz >= CHUNK ? 1 : 0;
      const sz = lz - dz * CHUNK;
      for (let px = 0; px < P; px++) {
        const lx = px - 1;
        const dx = lx < 0 ? -1 : lx >= CHUNK ? 1 : 0;
        const src = n[(dx + 1) + (dz + 1) * 3];
        vol[px + pz * P + yo] = src ? src[(lx - dx * CHUNK) + sz * CHUNK + so] : B.STONE;
      }
    }
  }
  // Heightmap of the padded area (first y from the top that blocks sky)
  const hmap = new Int16Array(PL);
  let maxY = 0;
  for (let i = 0; i < PL; i++) {
    let y = HEIGHT - 1;
    for (; y >= 0; y--) {
      const id = vol[i + y * PL];
      if (id !== B.AIR && RENDER[id] !== 2 && id !== B.WATER) break;
    }
    hmap[i] = y + 1;
    const px = i % P, pz = (i / P) | 0;
    if (px > 0 && pz > 0 && px <= CHUNK && pz <= CHUNK) {
      // include water/plants above the heightmap when bounding the scan
      let top = HEIGHT - 1;
      while (top > 0 && vol[i + top * PL] === B.AIR) top--;
      if (top > maxY) maxY = top;
    }
  }

  const get = (x, y, z) => (y < 0 ? B.BEDROCK : y >= HEIGHT ? B.AIR : vol[x + z * P + y * PL]);
  const occ = (x, y, z) => (y < 0 ? 1 : y >= HEIGHT ? 0 : (IS_OPAQUE[vol[x + z * P + y * PL]] || vol[x + z * P + y * PL] === B.LEAVES) ? 1 : 0);
  const sky = (x, y, z) => (y >= hmap[x + z * P] ? 1 : 0);

  const opaque = new GeoBuilder();
  const water = new GeoBuilder();
  const verts = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const uvs = [[0, 0], [0, 0], [0, 0], [0, 0]];
  const cols = [0, 0, 0, 0];
  const aos = [0, 0, 0, 0];

  for (let y = 0; y <= maxY && y < HEIGHT; y++) {
    for (let lz = 0; lz < CHUNK; lz++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const px = lx + 1, pz = lz + 1;
        const id = vol[px + pz * P + y * PL];
        if (id === B.AIR) continue;
        const r = RENDER[id];
        const blk = BLOCKS[id];

        if (r === 2) { // cross-shaped plant
          const light = 0.35 + 0.65 * sky(px, y, pz);
          const c = light * 0.95;
          const t = blk.side;
          const d = 0.15, e = 0.85;
          const quads = [
            [[lx + d, y, lz + d], [lx + e, y, lz + e], [lx + e, y + 1, lz + e], [lx + d, y + 1, lz + d]],
            [[lx + e, y, lz + d], [lx + d, y, lz + e], [lx + d, y + 1, lz + e], [lx + e, y + 1, lz + d]],
          ];
          for (let qi = 0; qi < 4; qi++) uvs[qi] = tileUV(t, UVS[qi][0], UVS[qi][1]);
          cols[0] = cols[1] = cols[2] = cols[3] = c;
          for (const q of quads) {
            opaque.quad(q, [0, 1, 0], uvs, cols, false);
            opaque.quad([q[1], q[0], q[3], q[2]], [0, 1, 0], [uvs[1], uvs[0], uvs[3], uvs[2]], cols, false);
          }
          continue;
        }

        const isWater = r === 3;
        const waterTop = isWater && get(px, y + 1, pz) !== B.WATER;
        for (let fi = 0; fi < 6; fi++) {
          const f = FACES[fi];
          const nx = px + f.n[0], ny = y + f.n[1], nz = pz + f.n[2];
          const nid = get(nx, ny, nz);
          if (isWater) {
            if (nid === B.WATER || IS_OPAQUE[nid]) continue;
          } else {
            if (IS_OPAQUE[nid]) continue;
            if (nid === id && (id === B.LEAVES || id === B.GLASS)) continue;
          }
          const target = isWater ? water : opaque;
          const tile = isWater ? 0 : blk[f.side];

          for (let k = 0; k < 4; k++) {
            const cn = f.c[k];
            let vy = y + cn[1];
            if (isWater && waterTop && cn[1] === 1) vy -= 0.12;
            verts[k] = [lx + cn[0], vy, lz + cn[2]];
            if (isWater) {
              const wx = lx + cn[0], wz = lz + cn[2];
              if (f.n[1] !== 0) uvs[k] = [wx * 0.5, wz * 0.5];
              else if (f.n[0] !== 0) uvs[k] = [wz * 0.5, vy * 0.5];
              else uvs[k] = [wx * 0.5, vy * 0.5];
              cols[k] = f.shade * (0.55 + 0.45 * sky(nx, ny, nz));
              aos[k] = 3;
            } else {
              uvs[k] = tileUV(tile, UVS[k][0], UVS[k][1]);
              const ao = f.ao[k];
              const s1 = occ(px + ao.a[0], y + ao.a[1], pz + ao.a[2]);
              const s2 = occ(px + ao.b[0], y + ao.b[1], pz + ao.b[2]);
              const cc = occ(px + ao.c[0], y + ao.c[1], pz + ao.c[2]);
              const aoLevel = (s1 && s2) ? 0 : 3 - (s1 + s2 + cc);
              aos[k] = aoLevel;
              // smooth skylight from the non-solid cells around this corner
              let sum = sky(nx, ny, nz), cnt = 1;
              if (!s1) { sum += sky(px + ao.a[0], y + ao.a[1], pz + ao.a[2]); cnt++; }
              if (!s2) { sum += sky(px + ao.b[0], y + ao.b[1], pz + ao.b[2]); cnt++; }
              if (!cc && !(s1 && s2)) { sum += sky(px + ao.c[0], y + ao.c[1], pz + ao.c[2]); cnt++; }
              const light = 0.3 + 0.7 * (sum / cnt);
              cols[k] = f.shade * AO_CURVE[aoLevel] * light;
            }
          }
          const flip = aos[0] + aos[2] < aos[1] + aos[3];
          target.quad(verts, f.n, uvs, cols, flip);
        }
      }
    }
  }
  return { opaque: opaque.result(), water: water.result() };
}
