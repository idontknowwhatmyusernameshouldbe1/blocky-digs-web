/** Detect coarse pointer / touch capability (phones, tablets, touch laptops). */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches === true;
  const touchPoints = (navigator.maxTouchPoints ?? 0) > 0;
  const ontouch = 'ontouchstart' in window;
  return coarse || touchPoints || ontouch;
}

export type TouchMove = { x: number; y: number }; // -1..1 wish on XZ plane relative to camera forward later

/**
 * On-screen controls: left stick = move, right drag = look, buttons = dig/place/jump/sprint/chat.
 */
export class TouchControls {
  move: TouchMove = { x: 0, y: 0 };
  lookDelta = { x: 0, y: 0 };
  jumpHeld = false;
  sprintHeld = false;
  digPressed = false;
  placePressed = false;
  chatPressed = false;

  private stickId: number | null = null;
  private lookId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lookLast = { x: 0, y: 0 };
  private readonly stickRadius: number;

  constructor(
    private root: HTMLElement,
    private stickBase: HTMLElement,
    private stickKnob: HTMLElement,
    private lookZone: HTMLElement,
  ) {
    this.stickRadius = 56;
    this.bind();
  }

  private bind(): void {
    const prevent = (e: Event) => e.preventDefault();

    this.stickBase.addEventListener('touchstart', (e) => this.onStickStart(e), { passive: false });
    this.stickBase.addEventListener('touchmove', (e) => this.onStickMove(e), { passive: false });
    this.stickBase.addEventListener('touchend', (e) => this.onStickEnd(e), { passive: false });
    this.stickBase.addEventListener('touchcancel', (e) => this.onStickEnd(e), { passive: false });

    this.lookZone.addEventListener('touchstart', (e) => this.onLookStart(e), { passive: false });
    this.lookZone.addEventListener('touchmove', (e) => this.onLookMove(e), { passive: false });
    this.lookZone.addEventListener('touchend', (e) => this.onLookEnd(e), { passive: false });
    this.lookZone.addEventListener('touchcancel', (e) => this.onLookEnd(e), { passive: false });

    this.root.querySelectorAll('[data-touch-action]').forEach((el) => {
      const action = (el as HTMLElement).dataset.touchAction!;
      el.addEventListener(
        'touchstart',
        (e) => {
          e.preventDefault();
          this.setAction(action, true);
        },
        { passive: false },
      );
      el.addEventListener(
        'touchend',
        (e) => {
          e.preventDefault();
          this.setAction(action, false);
        },
        { passive: false },
      );
      el.addEventListener(
        'touchcancel',
        () => this.setAction(action, false),
        { passive: true },
      );
      // mouse for hybrid devices
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.setAction(action, true);
      });
      el.addEventListener('mouseup', () => this.setAction(action, false));
      el.addEventListener('mouseleave', () => this.setAction(action, false));
    });

    this.root.addEventListener('gesturestart', prevent as EventListener, { passive: false });
  }

  private setAction(action: string, down: boolean): void {
    if (action === 'jump') this.jumpHeld = down;
    if (action === 'sprint') this.sprintHeld = down;
    if (action === 'dig' && down) this.digPressed = true;
    if (action === 'place' && down) this.placePressed = true;
    if (action === 'chat' && down) this.chatPressed = true;
  }

  /** Consume one-shot button edges each frame. */
  consumeActions(): { dig: boolean; place: boolean; chat: boolean } {
    const dig = this.digPressed;
    const place = this.placePressed;
    const chat = this.chatPressed;
    this.digPressed = false;
    this.placePressed = false;
    this.chatPressed = false;
    return { dig, place, chat };
  }

  /** Consume look deltas each frame. */
  consumeLook(): { x: number; y: number } {
    const d = { ...this.lookDelta };
    this.lookDelta.x = 0;
    this.lookDelta.y = 0;
    return d;
  }

  private onStickStart(e: TouchEvent): void {
    e.preventDefault();
    const t = e.changedTouches[0];
    if (!t || this.stickId !== null) return;
    this.stickId = t.identifier;
    const rect = this.stickBase.getBoundingClientRect();
    this.stickOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    this.updateStick(t.clientX, t.clientY);
  }

  private onStickMove(e: TouchEvent): void {
    e.preventDefault();
    const t = this.findTouch(e, this.stickId);
    if (!t) return;
    this.updateStick(t.clientX, t.clientY);
  }

  private onStickEnd(e: TouchEvent): void {
    e.preventDefault();
    if (!this.findTouch(e, this.stickId) && ![...e.touches].some((t) => t.identifier === this.stickId)) {
      this.stickId = null;
      this.move = { x: 0, y: 0 };
      this.stickKnob.style.transform = 'translate(-50%, -50%)';
    }
  }

  private updateStick(cx: number, cy: number): void {
    let dx = cx - this.stickOrigin.x;
    let dy = cy - this.stickOrigin.y;
    const len = Math.hypot(dx, dy) || 1;
    const max = this.stickRadius;
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    this.stickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    this.move = { x: dx / max, y: -dy / max }; // y forward
  }

  private onLookStart(e: TouchEvent): void {
    e.preventDefault();
    const t = e.changedTouches[0];
    if (!t || this.lookId !== null) return;
    this.lookId = t.identifier;
    this.lookLast = { x: t.clientX, y: t.clientY };
  }

  private onLookMove(e: TouchEvent): void {
    e.preventDefault();
    const t = this.findTouch(e, this.lookId);
    if (!t) return;
    this.lookDelta.x += t.clientX - this.lookLast.x;
    this.lookDelta.y += t.clientY - this.lookLast.y;
    this.lookLast = { x: t.clientX, y: t.clientY };
  }

  private onLookEnd(e: TouchEvent): void {
    e.preventDefault();
    if (!this.findTouch(e, this.lookId) && ![...e.touches].some((t) => t.identifier === this.lookId)) {
      this.lookId = null;
    }
  }

  private findTouch(e: TouchEvent, id: number | null): Touch | null {
    if (id === null) return null;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === id) return e.changedTouches[i];
    }
    return null;
  }
}
