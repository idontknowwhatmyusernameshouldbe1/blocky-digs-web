import * as THREE from 'three';
import { Blocks, HOTBAR, isSolid } from './protocol';
import { NetClient } from './net';
import { World } from './world';
import { buildChunkMesh, loadAtlas } from './mesher';
import { TouchControls, isTouchDevice } from './touch';

const REACH = 6.5;
const PUNCH_REACH = 3.2;
const PUNCH_DMG = 3;
const MAX_HP = 20;
const RADIUS = 0.3;
const HEIGHT = 1.75;
const EYE = 1.55;

type Remote = { id: number; pos: THREE.Vector3; yaw: number; mesh: THREE.Mesh };

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(75, 1, 0.05, 256);
  private world: World | null = null;
  private material: THREE.MeshLambertMaterial | null = null;
  private chunkMeshes = new Map<string, THREE.Mesh>();
  private net: NetClient;
  private remotes = new Map<number, Remote>();

  private pos = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private yaw = Math.PI;
  private pitch = 0;
  private onGround = false;
  private health = MAX_HP;
  private invuln = 0;
  private punchCd = 0;
  private fallSpeed = 0;
  private wasOnGround = true;
  private hotbar = 0;

  private keys = new Set<string>();
  private mouseCaptured = false;
  private chatOpen = false;
  private poseTimer = 0;
  private running = false;
  private lastT = 0;
  readonly touchMode = isTouchDevice();
  private touch: TouchControls | null = null;

  private lookHit: { x: number; y: number; z: number; dist: number } | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private ui: {
      hud: HTMLElement;
      menu: HTMLElement;
      status: HTMLElement;
      hp: HTMLElement;
      hotbar: HTMLElement;
      chatLog: HTMLElement;
      chatBox: HTMLElement;
      chatInput: HTMLInputElement;
      topHint: HTMLElement;
      touchControls: HTMLElement;
      stickBase: HTMLElement;
      stickKnob: HTMLElement;
      lookZone: HTMLElement;
    },
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color(0x87ceeb);
    const hemi = new THREE.HemisphereLight(0xddeeff, 0x445533, 0.55);
    const sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.position.set(-0.4, 1, -0.3);
    this.scene.add(hemi, sun);

    this.net = new NetClient({
      onWelcome: (seed, id) => this.begin(seed, id),
      onPose: (id, x, y, z, yaw) => this.upsertRemote(id, x, y, z, yaw),
      onSetBlock: (x, y, z, id) => this.applyBlock(x, y, z, id, false),
      onChat: (id, text) => this.pushChat(id, text),
      onDamage: (a, t, amt, x, y, z) => this.onDamage(a, t, amt, x, y, z),
      onClose: (r) => {
        this.ui.status.textContent = r;
        this.stop();
      },
    });

    if (this.touchMode) {
      document.body.classList.add('touch-mode');
      this.touch = new TouchControls(
        this.ui.touchControls,
        this.ui.stickBase,
        this.ui.stickKnob,
        this.ui.lookZone,
      );
      this.ui.topHint.textContent =
        'Touch: left stick move · drag right to look · Dig/Place/Jump';
    }

    this.bindInput();
    this.buildHotbar();
  }

  join(host: string): void {
    this.ui.status.textContent = `Connecting ws://${host}:7778 …`;
    this.net.connect(host, 7778);
  }

  private async begin(seed: number, localId: number): Promise<void> {
    this.ui.status.textContent = `Joined as P${localId} — building world…`;
    this.ui.menu.classList.add('hidden');
    this.ui.hud.classList.remove('hidden');
    if (this.touchMode) {
      this.ui.touchControls.classList.remove('hidden');
      this.mouseCaptured = true; // always "in game" on touch
    }

    try {
      const atlas = await loadAtlas();
      this.material = new THREE.MeshLambertMaterial({
        map: atlas,
        vertexColors: true,
        side: THREE.FrontSide,
      });
    } catch (err) {
      console.warn('Texture atlas failed, using solid colors', err);
      this.material = new THREE.MeshLambertMaterial({
        vertexColors: true,
        color: 0xffffff,
        side: THREE.FrontSide,
      });
    }

    this.world = new World(seed);
    this.world.generateAroundSpawn();
    this.remeshAll();
    this.resize();

    const sy = this.world.surfaceHeight(0, 0);
    this.pos.set(0.5 + localId * 1.5, sy + 0.1, 0.5);
    this.health = MAX_HP;
    this.invuln = 1.5;
    this.updateHp();
    this.pushChat(0, `P${localId} joined (web)`);
    this.ui.status.textContent = `P${localId} · seed ${seed}`;

    this.running = true;
    this.lastT = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  private stop(): void {
    this.running = false;
    this.mouseCaptured = false;
    document.exitPointerLock();
    this.ui.hud.classList.add('hidden');
    this.ui.touchControls.classList.add('hidden');
    this.ui.menu.classList.remove('hidden');
    for (const m of this.chunkMeshes.values()) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.chunkMeshes.clear();
    for (const r of this.remotes.values()) this.scene.remove(r.mesh);
    this.remotes.clear();
    this.world = null;
  }

  private remeshAll(): void {
    if (!this.world || !this.material) return;
    for (const m of this.chunkMeshes.values()) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.chunkMeshes.clear();
    for (const key of this.world.chunkKeys()) {
      const [cx, cz] = key.split(',').map(Number);
      const mesh = buildChunkMesh(this.world, cx, cz, this.material);
      if (!mesh) continue;
      this.chunkMeshes.set(key, mesh);
      this.scene.add(mesh);
    }
  }

  private remeshNear(wx: number, wz: number): void {
    // Full remesh is fine for small worlds
    this.remeshAll();
  }

  private applyBlock(x: number, y: number, z: number, id: number, send: boolean): void {
    if (!this.world) return;
    if (!this.world.setBlock(x, y, z, id)) return;
    this.remeshNear(x, z);
    if (send) this.net.sendSetBlock(x, y, z, id);
  }

  private upsertRemote(id: number, x: number, y: number, z: number, yaw: number): void {
    let r = this.remotes.get(id);
    if (!r) {
      const geo = new THREE.BoxGeometry(RADIUS * 2, HEIGHT, RADIUS * 2);
      const mat = new THREE.MeshLambertMaterial({ color: colorFor(id) });
      const mesh = new THREE.Mesh(geo, mat);
      r = { id, pos: new THREE.Vector3(x, y, z), yaw, mesh };
      this.remotes.set(id, r);
      this.scene.add(mesh);
    }
    r.pos.set(x, y, z);
    r.yaw = yaw;
    r.mesh.position.set(x, y + HEIGHT / 2, z);
  }

  private bindInput(): void {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (!this.running) return;
      if (this.chatOpen) {
        if (e.code === 'Enter') {
          const t = this.ui.chatInput.value.trim();
          this.ui.chatInput.value = '';
          this.chatOpen = false;
          this.ui.chatBox.classList.add('hidden');
          if (t) {
            this.pushChat(this.net.localId, t);
            this.net.sendChat(t);
          }
          e.preventDefault();
        } else if (e.code === 'Escape') {
          this.chatOpen = false;
          this.ui.chatBox.classList.add('hidden');
        }
        return;
      }
      if (e.code === 'KeyT') {
        this.chatOpen = true;
        this.ui.chatBox.classList.remove('hidden');
        this.ui.chatInput.focus();
        document.exitPointerLock();
        this.mouseCaptured = false;
        e.preventDefault();
      }
      if (e.code === 'Digit1') this.hotbar = 0;
      if (e.code === 'Digit2') this.hotbar = 1;
      if (e.code === 'Digit3') this.hotbar = 2;
      if (e.code === 'Digit4') this.hotbar = 3;
      this.buildHotbar();
      if (e.code === 'Escape') {
        document.exitPointerLock();
        this.mouseCaptured = false;
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    this.canvas.addEventListener('click', () => {
      if (!this.running || this.chatOpen || this.touchMode) return;
      this.canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      if (this.touchMode) return;
      this.mouseCaptured = document.pointerLockElement === this.canvas;
    });
    document.addEventListener('mousemove', (e) => {
      if (this.touchMode || !this.mouseCaptured || this.chatOpen) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch -= e.movementY * 0.0022;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    });
    document.addEventListener('mousedown', (e) => {
      if (this.touchMode || !this.running || !this.mouseCaptured || this.chatOpen) return;
      if (e.button === 0) this.onLeftClick();
      if (e.button === 2) this.onRightClick();
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('blur', () => {
      if (!this.touchMode) {
        document.exitPointerLock();
        this.mouseCaptured = false;
      }
      this.keys.clear();
    });
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private lookDir(): THREE.Vector3 {
    return new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    ).normalize();
  }

  private eye(): THREE.Vector3 {
    return this.pos.clone().add(new THREE.Vector3(0, EYE, 0));
  }

  private frame(t: number): void {
    if (!this.running || !this.world) return;
    const dt = Math.min(0.05, (t - this.lastT) / 1000);
    this.lastT = t;
    this.update(dt);
    this.draw();
    requestAnimationFrame((nt) => this.frame(nt));
  }

  private update(dt: number): void {
    if (!this.world) return;
    this.invuln = Math.max(0, this.invuln - dt);
    this.punchCd = Math.max(0, this.punchCd - dt);

    if (this.touch && !this.chatOpen) {
      const look = this.touch.consumeLook();
      this.yaw -= look.x * 0.0045;
      this.pitch -= look.y * 0.0045;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));

      const acts = this.touch.consumeActions();
      if (acts.dig) this.onLeftClick();
      if (acts.place) this.onRightClick();
      if (acts.chat) {
        this.chatOpen = true;
        this.ui.chatBox.classList.remove('hidden');
        this.ui.chatInput.focus();
      }
    }

    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    let wish = new THREE.Vector3();
    if (!this.chatOpen) {
      if (this.keys.has('KeyW')) wish.add(forward);
      if (this.keys.has('KeyS')) wish.sub(forward);
      if (this.keys.has('KeyD')) wish.add(right);
      if (this.keys.has('KeyA')) wish.sub(right);
      if (this.touch) {
        const m = this.touch.move;
        if (m.x * m.x + m.y * m.y > 0.02) {
          wish.addScaledVector(forward, m.y);
          wish.addScaledVector(right, m.x);
        }
      }
    }
    const sprint =
      this.keys.has('ShiftLeft') ||
      this.keys.has('ShiftRight') ||
      (this.touch?.sprintHeld ?? false);
    const speed = 5.2 * (sprint ? 1.55 : 1);

    if (wish.lengthSq() > 1e-4) {
      wish.normalize();
      this.vel.x = wish.x * speed;
      this.vel.z = wish.z * speed;
    } else if (this.onGround) {
      this.vel.x = 0;
      this.vel.z = 0;
    } else {
      this.vel.x *= Math.exp(-6 * dt);
      this.vel.z *= Math.exp(-6 * dt);
    }

    const wantJump =
      this.keys.has('Space') || (this.touch?.jumpHeld ?? false);
    if (this.onGround && !this.chatOpen && wantJump) {
      this.vel.y = 7.2;
      this.onGround = false;
    }

    this.vel.y -= 24 * dt;
    if (this.vel.y < 0) this.fallSpeed = Math.min(this.fallSpeed, this.vel.y);

    this.onGround = false;
    this.moveAxis(new THREE.Vector3(this.vel.x * dt, 0, 0));
    this.moveAxis(new THREE.Vector3(0, 0, this.vel.z * dt));
    this.moveAxis(new THREE.Vector3(0, this.vel.y * dt, 0));

    if (this.onGround && !this.wasOnGround && this.fallSpeed < -12) {
      const dmg = Math.min(12, Math.floor((-this.fallSpeed - 12) * 0.85));
      if (dmg > 0) this.hurt(dmg, null, 0);
      this.fallSpeed = 0;
    }
    if (this.onGround) this.fallSpeed = 0;
    this.wasOnGround = this.onGround;

    this.lookHit = this.rayBlock(this.eye(), this.lookDir(), REACH);

    this.poseTimer += dt;
    if (this.poseTimer >= 0.05) {
      this.poseTimer = 0;
      this.net.sendPose(this.pos.x, this.pos.y, this.pos.z, this.yaw, this.pitch);
    }

    const eye = this.eye();
    this.camera.position.copy(eye);
    this.camera.lookAt(eye.clone().add(this.lookDir()));
  }

  private moveAxis(delta: THREE.Vector3): void {
    if (!this.world) return;
    this.pos.add(delta);
    const minX = Math.floor(this.pos.x - RADIUS) - 1;
    const maxX = Math.floor(this.pos.x + RADIUS) + 1;
    const minY = Math.max(0, Math.floor(this.pos.y) - 1);
    const maxY = Math.min(63, Math.floor(this.pos.y + HEIGHT) + 1);
    const minZ = Math.floor(this.pos.z - RADIUS) - 1;
    const maxZ = Math.floor(this.pos.z + RADIUS) + 1;

    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          if (!isSolid(this.world.getBlock(x, y, z))) continue;
          const bmin = new THREE.Vector3(x, y, z);
          const bmax = new THREE.Vector3(x + 1, y + 1, z + 1);
          const pmin = new THREE.Vector3(this.pos.x - RADIUS, this.pos.y, this.pos.z - RADIUS);
          const pmax = new THREE.Vector3(this.pos.x + RADIUS, this.pos.y + HEIGHT, this.pos.z + RADIUS);
          if (pmax.x <= bmin.x || pmin.x >= bmax.x || pmax.y <= bmin.y || pmin.y >= bmax.y || pmax.z <= bmin.z || pmin.z >= bmax.z)
            continue;

          if (delta.x !== 0) {
            this.pos.x = delta.x > 0 ? bmin.x - RADIUS - 0.001 : bmax.x + RADIUS + 0.001;
            this.vel.x = 0;
          } else if (delta.z !== 0) {
            this.pos.z = delta.z > 0 ? bmin.z - RADIUS - 0.001 : bmax.z + RADIUS + 0.001;
            this.vel.z = 0;
          } else if (delta.y !== 0) {
            if (delta.y > 0) {
              this.pos.y = bmin.y - HEIGHT - 0.001;
              this.vel.y = 0;
            } else {
              this.pos.y = bmax.y + 0.001;
              this.vel.y = 0;
              this.onGround = true;
            }
          }
        }
      }
    }
  }

  private rayBlock(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number) {
    if (!this.world) return null;
    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);
    const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
    const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
    const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;
    const tDeltaX = stepX === 0 ? Infinity : Math.abs(1 / dir.x);
    const tDeltaY = stepY === 0 ? Infinity : Math.abs(1 / dir.y);
    const tDeltaZ = stepZ === 0 ? Infinity : Math.abs(1 / dir.z);
    let tMaxX = stepX > 0 ? (x + 1 - origin.x) * tDeltaX : stepX < 0 ? (origin.x - x) * tDeltaX : Infinity;
    let tMaxY = stepY > 0 ? (y + 1 - origin.y) * tDeltaY : stepY < 0 ? (origin.y - y) * tDeltaY : Infinity;
    let tMaxZ = stepZ > 0 ? (z + 1 - origin.z) * tDeltaZ : stepZ < 0 ? (origin.z - z) * tDeltaZ : Infinity;
    let dist = 0;

    for (let i = 0; i < 128; i++) {
      if (isSolid(this.world.getBlock(x, y, z))) return { x, y, z, dist };
      if (tMaxX < tMaxY) {
        if (tMaxX < tMaxZ) {
          dist = tMaxX;
          if (dist > maxDist) return null;
          x += stepX;
          tMaxX += tDeltaX;
        } else {
          dist = tMaxZ;
          if (dist > maxDist) return null;
          z += stepZ;
          tMaxZ += tDeltaZ;
        }
      } else if (tMaxY < tMaxZ) {
        dist = tMaxY;
        if (dist > maxDist) return null;
        y += stepY;
        tMaxY += tDeltaY;
      } else {
        dist = tMaxZ;
        if (dist > maxDist) return null;
        z += stepZ;
        tMaxZ += tDeltaZ;
      }
    }
    return null;
  }

  private onLeftClick(): void {
    if (this.tryPunch()) return;
    if (this.lookHit) this.applyBlock(this.lookHit.x, this.lookHit.y, this.lookHit.z, Blocks.Air, true);
  }

  private onRightClick(): void {
    if (!this.lookHit || !this.world) return;
    // place on face toward camera — approximate with step back along look
    const eye = this.eye();
    const dir = this.lookDir();
    const hit = this.lookHit;
    const px = hit.x - Math.sign(dir.x) * (Math.abs(dir.x) >= Math.abs(dir.y) && Math.abs(dir.x) >= Math.abs(dir.z) ? 1 : 0);
    // Better: place adjacent using neighbor from ray previous cell — use simple approach:
    const place = this.findPlacePos(eye, dir, hit);
    if (!place) return;
    if (isSolid(this.world.getBlock(place.x, place.y, place.z))) return;
    if (this.overlapsPlayer(place.x, place.y, place.z)) return;
    this.applyBlock(place.x, place.y, place.z, HOTBAR[this.hotbar], true);
  }

  private findPlacePos(origin: THREE.Vector3, dir: THREE.Vector3, hit: { x: number; y: number; z: number; dist: number }) {
    // Walk ray to just before hit block
    const prev = origin.clone().addScaledVector(dir, Math.max(0, hit.dist - 0.01));
    return { x: Math.floor(prev.x), y: Math.floor(prev.y), z: Math.floor(prev.z) };
  }

  private overlapsPlayer(bx: number, by: number, bz: number): boolean {
    const pmin = new THREE.Vector3(this.pos.x - RADIUS, this.pos.y, this.pos.z - RADIUS);
    const pmax = new THREE.Vector3(this.pos.x + RADIUS, this.pos.y + HEIGHT, this.pos.z + RADIUS);
    return !(pmax.x <= bx || pmin.x >= bx + 1 || pmax.y <= by || pmin.y >= by + 1 || pmax.z <= bz || pmin.z >= bz + 1);
  }

  private tryPunch(): boolean {
    if (this.punchCd > 0) return false;
    const eye = this.eye();
    const dir = this.lookDir();
    let bestDist = PUNCH_REACH;
    let best: Remote | null = null;
    const blockDist = this.lookHit?.dist ?? Infinity;

    for (const r of this.remotes.values()) {
      const box = new THREE.Box3(
        new THREE.Vector3(r.pos.x - RADIUS, r.pos.y, r.pos.z - RADIUS),
        new THREE.Vector3(r.pos.x + RADIUS, r.pos.y + HEIGHT, r.pos.z + RADIUS),
      );
      const hit = new THREE.Ray(eye, dir).intersectBox(box, new THREE.Vector3());
      if (!hit) continue;
      const dist = eye.distanceTo(hit);
      if (dist > bestDist || dist > blockDist) continue;
      bestDist = dist;
      best = r;
    }
    if (!best) return false;
    this.punchCd = 0.45;
    this.net.sendDamage(best.id, PUNCH_DMG, this.pos.x, this.pos.y, this.pos.z);
    this.pushChat(0, `You punched P${best.id}`);
    return true;
  }

  private onDamage(attacker: number, target: number, amount: number, x: number, y: number, z: number): void {
    if (target !== this.net.localId) return;
    this.hurt(amount, new THREE.Vector3(x, y, z), attacker);
  }

  private hurt(amount: number, from: THREE.Vector3 | null, attacker: number): void {
    if (this.invuln > 0 || this.health <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.invuln = 0.55;
    this.updateHp();
    if (from) {
      const dir = this.pos.clone().sub(from);
      dir.y = 0.2;
      if (dir.lengthSq() < 1e-4) dir.set(Math.sin(this.yaw), 0.2, Math.cos(this.yaw));
      dir.normalize();
      this.vel.set(dir.x * 6.5, Math.max(this.vel.y, 5), dir.z * 6.5);
      this.onGround = false;
    }
    if (this.health <= 0) {
      this.pushChat(0, attacker === 0 ? `P${this.net.localId} fell too hard` : `P${attacker} KO'd P${this.net.localId}`);
      if (attacker !== 0) this.net.sendChat(`P${attacker} KO'd P${this.net.localId}`);
      else this.net.sendChat(`P${this.net.localId} fell too hard`);
      this.respawn();
    }
  }

  private respawn(): void {
    if (!this.world) return;
    const sy = this.world.surfaceHeight(0, 0);
    this.pos.set(0.5 + this.net.localId * 1.5, sy + 0.1, 0.5);
    this.vel.set(0, 0, 0);
    this.health = MAX_HP;
    this.invuln = 1.5;
    this.updateHp();
  }

  private updateHp(): void {
    this.ui.hp.innerHTML = '';
    for (let i = 0; i < MAX_HP; i++) {
      const s = document.createElement('span');
      if (i >= this.health) s.classList.add('empty');
      this.ui.hp.appendChild(s);
    }
  }

  private buildHotbar(): void {
    const names = ['dirt', 'grass', 'stone', 'wood'];
    this.ui.hotbar.innerHTML = '';
    names.forEach((n, i) => {
      const slot = document.createElement('div');
      slot.className = 'slot' + (i === this.hotbar ? ' sel' : '');
      const img = document.createElement('img');
      img.src = `${import.meta.env.BASE_URL}textures/${n}.png`;
      img.alt = n;
      slot.appendChild(img);
      slot.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.hotbar = i;
        this.buildHotbar();
      });
      this.ui.hotbar.appendChild(slot);
    });
  }

  private pushChat(id: number, text: string): void {
    const row = document.createElement('div');
    const label = id === 0 ? 'SYS' : `P${id}`;
    row.textContent = `${label}: ${text}`;
    this.ui.chatLog.appendChild(row);
    while (this.ui.chatLog.children.length > 8) this.ui.chatLog.firstChild?.remove();
    setTimeout(() => row.remove(), 20000);
  }

  private draw(): void {
    this.renderer.render(this.scene, this.camera);
  }
}

function colorFor(id: number): number {
  switch (id) {
    case 2: return 0xff7850;
    case 3: return 0x50b4ff;
    case 4: return 0xffdc50;
    default: return 0xc864ff;
  }
}
