export class Input {
  mx = 0;
  my = 0;
  px = 0;
  py = 0;
  left = false;
  right = false;
  leftPressed = false;
  placePressed = false;
  leftReleased = false;
  mdx = 0;
  mdy = 0;
  wheel = 0;
  /** This frame's aim delta came from a finger, so use the touch scale. */
  touchAim = false;
  chargeHeld = false;
  chargePressed = false;
  nudgeLeft = false;
  nudgeRight = false;
  loftUp = false;
  loftDown = false;
  keys = new Set<string>();
  pressed = new Set<string>();
  released = new Set<string>();
  touches = 0;
  cancelled = false;
  private el: HTMLElement | null = null;
  private readonly touchPos = new Map<number, { x: number; y: number }>();
  private primaryId = -1;
  private pinchDist = 0;

  get nudge(): number {
    return (this.nudgeLeft ? 1 : 0) + (this.nudgeRight ? -1 : 0);
  }

  attach(el: HTMLElement): void {
    this.el = el;
    el.addEventListener("pointerdown", this.onDown, { passive: false });
    window.addEventListener("pointermove", this.onMove, { passive: false });
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onUpKey);
    window.addEventListener("blur", () => this.reset());
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.reset(); });
  }

  reset(): void {
    this.left = this.right = this.leftPressed = this.leftReleased = false;
    this.placePressed = false;
    this.chargeHeld = this.chargePressed = false;
    this.nudgeLeft = this.nudgeRight = this.loftUp = this.loftDown = false;
    this.keys.clear(); this.pressed.clear(); this.released.clear();
    this.touchPos.clear(); this.primaryId = -1; this.touches = 0; this.pinchDist = 0;
    this.mdx = this.mdy = this.wheel = 0;
    this.cancelled = true;
  }

  endFrame(): void {
    this.leftPressed = false;
    this.placePressed = false;
    this.leftReleased = false;
    this.chargePressed = false;
    this.mdx = 0;
    this.mdy = 0;
    this.wheel = 0;
    this.touchAim = false;
    this.cancelled = false;
    this.pressed.clear();
    this.released.clear();
  }

  private ndc(e: PointerEvent): void {
    const el = this.el;
    if (!el) return;
    const r = el.getBoundingClientRect();
    this.px = e.clientX;
    this.py = e.clientY;
    this.mx = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.my = -(((e.clientY - r.top) / r.height) * 2 - 1);
  }

  private onDown = (e: PointerEvent): void => {
    this.ndc(e);
    if (e.button === 0 && this.touches === 0) this.placePressed = true;
    if (e.pointerType === "mouse") {
      if (e.button === 0) {
        this.left = true;
        this.leftPressed = true;
      }
      if (e.button === 2) this.right = true;
    } else {
      e.preventDefault();
      this.touchPos.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.primaryId < 0) this.primaryId = e.pointerId;
      this.touches = this.touchPos.size;
      this.right = this.touches >= 2;
      this.pinchDist = 0;
    }
    try {
      this.el?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  private onMove = (e: PointerEvent): void => {
    this.ndc(e);
    if (e.pointerType === "mouse") {
      if (e.target !== this.el && !this.left && !this.right) return;
      this.mdx += e.movementX;
      this.mdy += e.movementY;
      return;
    }
    const prev = this.touchPos.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;
    if (e.target === this.el) e.preventDefault();
    if (this.touches >= 2) {
      this.pinchDist = this.applyPinch();
      this.right = true;
    }
    if (e.pointerId === this.primaryId) {
      this.mdx += dx;
      this.mdy += dy;
      this.touchAim = true;
    }
  };

  private applyPinch(): number {
    const pts = [...this.touchPos.values()];
    const a = pts[0];
    const b = pts[1];
    if (!a || !b) return 0;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (this.pinchDist > 0) {
      // Fingers apart (dist grows) zooms in: wheel < 0 shrinks camera distance.
      this.wheel += (this.pinchDist - dist) * 1.6;
    }
    return dist;
  }

  private onUp = (e: PointerEvent): void => {
    if (e.type === "pointercancel") { this.reset(); return; }
    this.ndc(e);
    if (e.pointerType === "mouse") {
      if (e.button === 0) {
        if (this.left) this.leftReleased = true;
        this.left = false;
      }
      if (e.button === 2) this.right = false;
      return;
    }
    this.touchPos.delete(e.pointerId);
    this.touches = this.touchPos.size;
    if (this.touches < 2) {
      this.right = false;
      this.pinchDist = 0;
    }
    if (e.pointerId === this.primaryId) {
      const next = this.touchPos.keys().next();
      this.primaryId = next.done ? -1 : next.value;
    }
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.wheel += e.deltaY;
  };

  private onKey = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable=true]")) return;
    if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    if (e.repeat) return;
    this.keys.add(e.code);
    this.pressed.add(e.code);
  };

  private onUpKey = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    this.released.add(e.code);
  };
}
