import type { Renderer } from "./renderer.ts";

const KEY_NAMES: Record<string, string> = {
  ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
  Space: "space", Enter: "enter", Escape: "escape", ShiftLeft: "shift", ShiftRight: "shift",
  ControlLeft: "ctrl", ControlRight: "ctrl", Tab: "tab", Backspace: "backspace",
};

function keyName(code: string) {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith("Key")) return code.slice(3).toLowerCase();
  if (code.startsWith("Digit")) return code.slice(5);
  return code.toLowerCase();
}

export interface Mouse {
  x: number;
  y: number;
  down: boolean;
  pressed: boolean;
  released: boolean;
  right: boolean;
  wheel: number;
  inside: boolean;
}

export class Input {
  mouse: Mouse = { x: 0, y: 0, down: false, pressed: false, released: false, right: false, wheel: 0, inside: false };
  private keys = new Set<string>();
  private pressedKeys = new Set<string>();
  private pending = { pressed: 0, released: 0, wheel: 0 };
  private off: (() => void)[] = [];
  /** When false, keyboard events are ignored (e.g. while the editor has focus elsewhere). */
  keyboard = true;

  constructor(private canvas: HTMLCanvasElement, private renderer: Renderer) {
    const on = <K extends keyof WindowEventMap>(t: EventTarget, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => t.removeEventListener(type, fn as EventListener));
    };
    const move = (e: PointerEvent | MouseEvent) => {
      const r = this.canvas.getBoundingClientRect();
      const v = this.renderer.view;
      this.mouse.x = Math.floor((e.clientX - r.left - v.x) / v.scale);
      this.mouse.y = Math.floor((e.clientY - r.top - v.y) / v.scale);
      this.mouse.inside =
        this.mouse.x >= 0 && this.mouse.y >= 0 && this.mouse.x < renderer.width && this.mouse.y < renderer.height;
    };
    on(window, "pointermove", move);
    on(canvas, "pointerdown", (e) => {
      move(e);
      if (e.button === 2) this.mouse.right = true;
      else { this.mouse.down = true; this.pending.pressed++; }
    });
    on(window, "pointerup", (e) => {
      if (e.button === 2) this.mouse.right = false;
      else if (this.mouse.down) { this.mouse.down = false; this.pending.released++; }
    });
    on(canvas, "contextmenu", (e) => e.preventDefault());
    on(canvas, "wheel", (e) => { this.pending.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    on(window, "keydown", (e) => {
      if (!this.keyboard || e.repeat) return;
      const k = keyName(e.code);
      this.keys.add(k);
      this.pressedKeys.add(k);
    });
    on(window, "keyup", (e) => this.keys.delete(keyName(e.code)));
    on(window, "blur", () => this.keys.clear());
  }

  /** Called at the start of each fixed update: latch edge-triggered events for this tick. */
  beginTick() {
    // One click per tick: fast clicks inside a single frame carry over instead of merging.
    const p = this.pending;
    this.mouse.pressed = p.pressed > 0;
    this.mouse.released = !this.mouse.pressed && p.released > 0;
    if (this.mouse.pressed) p.pressed--;
    else if (this.mouse.released) p.released--;
    this.mouse.wheel = p.wheel;
    p.wheel = 0;
  }

  /** Drop queued events (e.g. clicks made while the game was paused). */
  flush() {
    this.pending = { pressed: 0, released: 0, wheel: 0 };
    this.pressedKeys.clear();
  }

  endTick() {
    this.pressedKeys.clear();
    this.mouse.pressed = this.mouse.released = false;
    this.mouse.wheel = 0;
  }

  key(name: string) {
    return this.keys.has(name);
  }

  keyp(name: string) {
    return this.pressedKeys.has(name);
  }

  destroy() {
    this.off.forEach((f) => f());
  }
}
