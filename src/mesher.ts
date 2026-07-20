import * as THREE from 'three';
import { Blocks, isSolid } from './protocol';
import { CHUNK_X, CHUNK_Y, CHUNK_Z, World } from './world';

const FACE_N = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
] as const;

const FACE_V: number[][][] = [
  [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]],
  [[0, 0, 1], [0, 0, 0], [0, 1, 0], [0, 1, 1]],
  [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]],
  [[0, 0, 1], [1, 0, 1], [1, 0, 0], [0, 0, 0]],
  [[1, 0, 1], [0, 0, 1], [0, 1, 1], [1, 1, 1]],
  [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
];

const SHADE = [0.85, 0.75, 1, 0.55, 0.9, 0.7];

function tileFor(id: number, face: number): number {
  if (id === Blocks.Dirt) return 0;
  if (id === Blocks.Grass) return face === 2 ? 1 : 0;
  if (id === Blocks.Stone) return 2;
  if (id === Blocks.Wood) return 3;
  if (id === Blocks.Leaves) return 1;
  return 0;
}

export async function loadAtlas(): Promise<THREE.Texture> {
  const names = ['dirt', 'grass', 'stone', 'wood'];
  const size = 16;
  const canvas = document.createElement('canvas');
  canvas.width = size * 4;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  await Promise.all(
    names.map(
      (n, i) =>
        new Promise<void>((res, rej) => {
          const img = new Image();
          img.onload = () => {
            ctx.drawImage(img, i * size, 0, size, size);
            res();
          };
          img.onerror = () => rej(new Error(n));
          img.src = `${import.meta.env.BASE_URL}textures/${n}.png`;
        }),
    ),
  );
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildChunkMesh(
  world: World,
  cx: number,
  cz: number,
  material: THREE.MeshLambertMaterial,
): THREE.Mesh | null {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const ox = cx * CHUNK_X;
  const oz = cz * CHUNK_Z;
  const inset = 0.5 / (4 * 16);

  for (let ly = 0; ly < CHUNK_Y; ly++) {
    for (let lz = 0; lz < CHUNK_Z; lz++) {
      for (let lx = 0; lx < CHUNK_X; lx++) {
        const wx = ox + lx;
        const wy = ly;
        const wz = oz + lz;
        const id = world.getBlock(wx, wy, wz);
        if (!isSolid(id)) continue;

        for (let face = 0; face < 6; face++) {
          const [nx, ny, nz] = FACE_N[face];
          if (isSolid(world.getBlock(wx + nx, wy + ny, wz + nz))) continue;

          const tile = tileFor(id, face);
          const u0 = tile / 4 + inset;
          const u1 = (tile + 1) / 4 - inset;
          const v0 = inset;
          const v1 = 1 - inset;
          const uv = [
            [u0, v1],
            [u1, v1],
            [u1, v0],
            [u0, v0],
          ];
          let shade = SHADE[face];
          let r = shade;
          let g = shade;
          let b = shade;
          if (id === Blocks.Leaves) {
            r = shade * 0.55;
            g = shade * 0.95;
            b = shade * 0.45;
          }

          const base = positions.length / 3;
          for (let i = 0; i < 4; i++) {
            const [vx, vy, vz] = FACE_V[face][i];
            positions.push(wx + vx, wy + vy, wz + vz);
            normals.push(nx, ny, nz);
            uvs.push(uv[i][0], uv[i][1]);
            colors.push(r, g, b);
          }
          // Three.js FrontSide expects CCW; PC/MonoGame used the opposite winding
          indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
        }
      }
    }
  }

  if (positions.length === 0) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  geo.computeBoundingSphere();
  return new THREE.Mesh(geo, material);
}
