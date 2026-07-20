import { Blocks, isSolid } from './protocol';

export const CHUNK_X = 16;
export const CHUNK_Y = 64;
export const CHUNK_Z = 16;
export const CHUNK_RADIUS = 5;

function floorDiv(a: number, b: number): number {
  let q = Math.trunc(a / b);
  const r = a % b;
  if (r !== 0 && (r < 0) !== (b < 0)) q--;
  return q;
}

/** Match C# unchecked uint hash from World.cs */
function hash01(x: number, z: number, seed: number): number {
  let n =
    (Math.imul(x | 0, 374761393) +
      Math.imul(z | 0, 668265263) +
      Math.imul(seed | 0, 982451653)) |
    0;
  n >>>= 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
  n = (n ^ (n >>> 16)) >>> 0;
  return (n & 0xffffff) / 0xffffff;
}

function hashInt(x: number, z: number, seed: number): number {
  let n =
    (Math.imul(x | 0, 374761393) +
      Math.imul(z | 0, 668265263) +
      Math.imul(seed | 0, 982451653)) |
    0;
  n >>>= 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0;
  return (n & 0x7fffffff) >>> 0;
}

function noise2D(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  let fx = x - x0;
  let fz = z - z0;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash01(x0, z0, seed);
  const b = hash01(x0 + 1, z0, seed);
  const c = hash01(x0, z0 + 1, seed);
  const d = hash01(x0 + 1, z0 + 1, seed);
  const ab = a + (b - a) * fx;
  const cd = c + (d - c) * fx;
  return (ab + (cd - ab) * fz) * 2 - 1;
}

function noise3D(x: number, y: number, z: number, seed: number): number {
  const xy = noise2D(x, y, seed);
  const yz = noise2D(y + 17.1, z + 9.3, seed);
  const xz = noise2D(x + 4.7, z + 21.2, seed);
  return (xy + yz + xz) / 3;
}

export class World {
  readonly seed: number;
  private chunks = new Map<string, Uint8Array>();

  constructor(seed: number) {
    this.seed = seed;
  }

  private key(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  generateAroundSpawn(): void {
    for (let cz = -CHUNK_RADIUS; cz < CHUNK_RADIUS; cz++) {
      for (let cx = -CHUNK_RADIUS; cx < CHUNK_RADIUS; cx++) {
        const data = new Uint8Array(CHUNK_X * CHUNK_Y * CHUNK_Z);
        this.generateTerrain(cx, cz, data);
        this.chunks.set(this.key(cx, cz), data);
      }
    }
    for (let cz = -CHUNK_RADIUS; cz < CHUNK_RADIUS; cz++) {
      for (let cx = -CHUNK_RADIUS; cx < CHUNK_RADIUS; cx++) {
        this.placeTrees(cx, cz);
      }
    }
  }

  private idx(lx: number, ly: number, lz: number): number {
    return lx + CHUNK_X * (lz + CHUNK_Z * ly);
  }

  getBlock(wx: number, wy: number, wz: number): number {
    if (wy < 0 || wy >= CHUNK_Y) return Blocks.Air;
    const cx = floorDiv(wx, CHUNK_X);
    const cz = floorDiv(wz, CHUNK_Z);
    const data = this.chunks.get(this.key(cx, cz));
    if (!data) return Blocks.Air;
    const lx = wx - cx * CHUNK_X;
    const lz = wz - cz * CHUNK_Z;
    return data[this.idx(lx, wy, lz)];
  }

  setBlock(wx: number, wy: number, wz: number, id: number): boolean {
    if (wy < 0 || wy >= CHUNK_Y) return false;
    const cx = floorDiv(wx, CHUNK_X);
    const cz = floorDiv(wz, CHUNK_Z);
    const data = this.chunks.get(this.key(cx, cz));
    if (!data) return false;
    const lx = wx - cx * CHUNK_X;
    const lz = wz - cz * CHUNK_Z;
    data[this.idx(lx, wy, lz)] = id;
    return true;
  }

  surfaceHeight(wx: number, wz: number): number {
    for (let y = CHUNK_Y - 1; y >= 0; y--) {
      if (isSolid(this.getBlock(wx, y, wz))) return y + 1;
    }
    return 1;
  }

  terrainHeight(wx: number, wz: number): number {
    const continent = noise2D(wx * 0.008 + 3, wz * 0.008 + 1, this.seed);
    const hills = noise2D(wx * 0.035, wz * 0.035, this.seed);
    const detail = noise2D(wx * 0.12 + 20, wz * 0.12 + 7, this.seed);
    let ridge = Math.abs(noise2D(wx * 0.02 + 90, wz * 0.02 + 40, this.seed));
    ridge = Math.pow(1 - ridge, 2.2);
    const h = 22 + continent * 10 + hills * 7 + detail * 2.5 + ridge * 14;
    return Math.min(CHUNK_Y - 10, Math.max(6, Math.round(h)));
  }

  private moisture(wx: number, wz: number): number {
    return noise2D(wx * 0.015 + 200, wz * 0.015 + 50, this.seed);
  }

  private isCave(wx: number, y: number, wz: number, surface: number): boolean {
    if (y < 3 || y >= surface - 2) return false;
    const n = noise3D(wx * 0.07, y * 0.09, wz * 0.07, this.seed);
    const n2 = noise3D(wx * 0.04 + 40, y * 0.05 + 10, wz * 0.04 + 40, this.seed);
    const cave = n * 0.65 + n2 * 0.35;
    const depthBias = Math.min(1, Math.max(0.15, (surface - y) / 28));
    return cave > 0.52 * depthBias + 0.18;
  }

  private generateTerrain(cx: number, cz: number, data: Uint8Array): void {
    const ox = cx * CHUNK_X;
    const oz = cz * CHUNK_Z;
    for (let lz = 0; lz < CHUNK_Z; lz++) {
      for (let lx = 0; lx < CHUNK_X; lx++) {
        const wx = ox + lx;
        const wz = oz + lz;
        const height = this.terrainHeight(wx, wz);
        const moisture = this.moisture(wx, wz);
        for (let y = 0; y < CHUNK_Y; y++) {
          let id: number;
          if (y > height) id = Blocks.Air;
          else if (this.isCave(wx, y, wz, height)) id = Blocks.Air;
          else if (y === height) {
            if (moisture < -0.45 && noise2D(wx * 0.2, wz * 0.2, this.seed) > 0.35)
              id = Blocks.Stone;
            else if (moisture < -0.2) id = Blocks.Dirt;
            else id = Blocks.Grass;
          } else if (y >= height - 3) id = Blocks.Dirt;
          else id = Blocks.Stone;
          data[this.idx(lx, y, lz)] = id;
        }
      }
    }
  }

  private isTreeSpot(wx: number, wz: number): boolean {
    if (hashInt(wx, wz, this.seed) % 53 !== 0) return false;
    if (this.moisture(wx, wz) < -0.15) return false;
    const height = this.terrainHeight(wx, wz);
    return height > 16 && height < 48;
  }

  private placeTrees(cx: number, cz: number): void {
    const ox = cx * CHUNK_X;
    const oz = cz * CHUNK_Z;
    for (let lz = 0; lz < CHUNK_Z; lz++) {
      for (let lx = 0; lx < CHUNK_X; lx++) {
        const wx = ox + lx;
        const wz = oz + lz;
        if (!this.isTreeSpot(wx, wz)) continue;
        const height = this.terrainHeight(wx, wz);
        if (this.getBlock(wx, height, wz) !== Blocks.Grass) continue;
        if (this.isCave(wx, height, wz, height)) continue;
        const trunk = 4 + ((wx * 13 + wz * 7 + this.seed) & 1);
        if (height + trunk + 2 >= CHUNK_Y) continue;
        for (let t = 1; t <= trunk; t++) this.setBlock(wx, height + t, wz, Blocks.Wood);
        const top = height + trunk;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dz = -2; dz <= 2; dz++) {
            for (let dx = -2; dx <= 2; dx++) {
              if (Math.abs(dx) === 2 && Math.abs(dz) === 2 && Math.abs(dy) >= 1) continue;
              if (dx === 0 && dz === 0 && dy <= 0) continue;
              const ly = top + dy;
              if (ly <= height || ly >= CHUNK_Y) continue;
              if (this.getBlock(wx + dx, ly, wz + dz) === Blocks.Air)
                this.setBlock(wx + dx, ly, wz + dz, Blocks.Leaves);
            }
          }
        }
      }
    }
  }

  chunkKeys(): string[] {
    return [...this.chunks.keys()];
  }

  getChunkData(cx: number, cz: number): Uint8Array | undefined {
    return this.chunks.get(this.key(cx, cz));
  }
}
