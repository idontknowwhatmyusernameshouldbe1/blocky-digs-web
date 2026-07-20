/** Shared binary protocol with Blocky Digs PC (little-endian). */

export const NetMsg = {
  Welcome: 1,
  PlayerPose: 2,
  SetBlock: 3,
  Goodbye: 4,
  Chat: 5,
  Damage: 6,
} as const;

export const Blocks = {
  Air: 0,
  Dirt: 1,
  Grass: 2,
  Stone: 3,
  Wood: 4,
  Leaves: 5,
} as const;

export const HOTBAR = [Blocks.Dirt, Blocks.Grass, Blocks.Stone, Blocks.Wood] as const;

export function blockName(id: number): string {
  switch (id) {
    case Blocks.Dirt: return 'Dirt';
    case Blocks.Grass: return 'Grass';
    case Blocks.Stone: return 'Stone';
    case Blocks.Wood: return 'Wood';
    case Blocks.Leaves: return 'Leaves';
    default: return 'Air';
  }
}

export function isSolid(id: number): boolean {
  return id !== Blocks.Air;
}

export function encodePose(localId: number, x: number, y: number, z: number, yaw: number, pitch: number): ArrayBuffer {
  const buf = new ArrayBuffer(1 + 1 + 20);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o++, NetMsg.PlayerPose);
  v.setUint8(o++, localId);
  v.setFloat32(o, x, true); o += 4;
  v.setFloat32(o, y, true); o += 4;
  v.setFloat32(o, z, true); o += 4;
  v.setFloat32(o, yaw, true); o += 4;
  v.setFloat32(o, pitch, true);
  return buf;
}

export function encodeSetBlock(x: number, y: number, z: number, id: number): ArrayBuffer {
  const buf = new ArrayBuffer(1 + 12 + 1);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o++, NetMsg.SetBlock);
  v.setInt32(o, x, true); o += 4;
  v.setInt32(o, y, true); o += 4;
  v.setInt32(o, z, true); o += 4;
  v.setUint8(o, id);
  return buf;
}

export function encodeChat(localId: number, text: string): ArrayBuffer {
  const enc = new TextEncoder().encode(text.slice(0, 80));
  const buf = new ArrayBuffer(1 + 1 + 2 + enc.length);
  const v = new DataView(buf);
  v.setUint8(0, NetMsg.Chat);
  v.setUint8(1, localId);
  v.setUint16(2, enc.length, true);
  new Uint8Array(buf, 4).set(enc);
  return buf;
}

export function encodeDamage(localId: number, targetId: number, amount: number, x: number, y: number, z: number): ArrayBuffer {
  const buf = new ArrayBuffer(1 + 3 + 12);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o++, NetMsg.Damage);
  v.setUint8(o++, localId);
  v.setUint8(o++, targetId);
  v.setUint8(o++, amount);
  v.setFloat32(o, x, true); o += 4;
  v.setFloat32(o, y, true); o += 4;
  v.setFloat32(o, z, true);
  return buf;
}
