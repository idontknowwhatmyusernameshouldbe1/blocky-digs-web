import {
  NetMsg,
  encodeChat,
  encodeDamage,
  encodePose,
  encodeSetBlock,
} from './protocol';

export type NetHandlers = {
  onWelcome: (seed: number, localId: number) => void;
  onPose: (id: number, x: number, y: number, z: number, yaw: number) => void;
  onSetBlock: (x: number, y: number, z: number, id: number) => void;
  onChat: (id: number, text: string) => void;
  onDamage: (attacker: number, target: number, amount: number, x: number, y: number, z: number) => void;
  onClose: (reason: string) => void;
};

export class NetClient {
  private ws: WebSocket | null = null;
  localId = 1;
  ready = false;

  constructor(private handlers: NetHandlers) {}

  connect(host: string, port = 7778): void {
    this.close();
    const url = `ws://${host}:${port}`;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;

    ws.onopen = () => {
      /* wait for Welcome */
    };

    ws.onmessage = (ev) => {
      if (!(ev.data instanceof ArrayBuffer)) return;
      this.handlePacket(new DataView(ev.data));
    };

    ws.onerror = () => this.handlers.onClose('WebSocket error');
    ws.onclose = () => {
      this.ready = false;
      this.handlers.onClose('Disconnected');
    };
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.ready = false;
  }

  private send(buf: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(buf);
  }

  sendPose(x: number, y: number, z: number, yaw: number, pitch: number): void {
    if (!this.ready) return;
    this.send(encodePose(this.localId, x, y, z, yaw, pitch));
  }

  sendSetBlock(x: number, y: number, z: number, id: number): void {
    if (!this.ready) return;
    this.send(encodeSetBlock(x, y, z, id));
  }

  sendChat(text: string): void {
    if (!this.ready) return;
    this.send(encodeChat(this.localId, text));
  }

  sendDamage(targetId: number, amount: number, x: number, y: number, z: number): void {
    if (!this.ready) return;
    this.send(encodeDamage(this.localId, targetId, amount, x, y, z));
  }

  private handlePacket(v: DataView): void {
    if (v.byteLength < 1) return;
    let o = 0;
    const type = v.getUint8(o++);
    switch (type) {
      case NetMsg.Welcome: {
        const seed = v.getInt32(o, true); o += 4;
        const id = v.getUint8(o);
        this.localId = id;
        this.ready = true;
        this.handlers.onWelcome(seed, id);
        break;
      }
      case NetMsg.PlayerPose: {
        const id = v.getUint8(o++); 
        const x = v.getFloat32(o, true); o += 4;
        const y = v.getFloat32(o, true); o += 4;
        const z = v.getFloat32(o, true); o += 4;
        const yaw = v.getFloat32(o, true);
        if (id !== this.localId) this.handlers.onPose(id, x, y, z, yaw);
        break;
      }
      case NetMsg.SetBlock: {
        const x = v.getInt32(o, true); o += 4;
        const y = v.getInt32(o, true); o += 4;
        const z = v.getInt32(o, true); o += 4;
        const id = v.getUint8(o);
        this.handlers.onSetBlock(x, y, z, id);
        break;
      }
      case NetMsg.Chat: {
        const id = v.getUint8(o++);
        const len = v.getUint16(o, true); o += 2;
        const bytes = new Uint8Array(v.buffer, v.byteOffset + o, len);
        const text = new TextDecoder().decode(bytes);
        this.handlers.onChat(id, text);
        break;
      }
      case NetMsg.Damage: {
        const attacker = v.getUint8(o++);
        const target = v.getUint8(o++);
        const amount = v.getUint8(o++);
        const x = v.getFloat32(o, true); o += 4;
        const y = v.getFloat32(o, true); o += 4;
        const z = v.getFloat32(o, true);
        this.handlers.onDamage(attacker, target, amount, x, y, z);
        break;
      }
    }
  }
}
