// Zoom and pan for the pixel and map canvases: the mouse wheel zooms around the cursor (Shift+wheel
// scrolls sideways), dragging with the middle button pans.

export interface CanvasView {
  /** Zoom to z keeping the point under (clientX, clientY) in place; the view's center by default. */
  zoomTo(z: number, clientX?: number, clientY?: number): void;
  /** The next zoom level in or out from the current one. */
  step(dir: 1 | -1): number;
}

export function canvasView(
  wrap: HTMLElement,
  canvas: HTMLCanvasElement,
  o: { zoom: () => number; setZoom: (z: number) => void; levels: number[]; changed?: () => void },
): CanvasView {
  const zoomTo = (z: number, cx?: number, cy?: number) => {
    const w = wrap.getBoundingClientRect();
    cx ??= w.left + w.width / 2;
    cy ??= w.top + w.height / 2;
    const before = canvas.getBoundingClientRect();
    const old = o.zoom();
    // the sprite / map point under the cursor, in unzoomed units
    const px = (cx - before.left) / old, py = (cy - before.top) / old;
    o.setZoom(z);
    const now = o.zoom();
    if (now === old) return;
    const after = canvas.getBoundingClientRect();
    wrap.scrollLeft += after.left + px * now - cx;
    wrap.scrollTop += after.top + py * now - cy;
    o.changed?.();
  };
  const step = (dir: 1 | -1) => stepFrom(o.zoom(), dir);
  const stepFrom = (z: number, dir: 1 | -1) => {
    const l = o.levels;
    return dir > 0 ? (l.find((v) => v > z) ?? l[l.length - 1]) : ([...l].reverse().find((v) => v < z) ?? l[0]);
  };

  // trackpads send many small deltas: zoom one level per ~100 units
  let acc = 0;
  wrap.addEventListener("wheel", (e) => {
    if (e.shiftKey && !e.ctrlKey) return; // horizontal scroll
    e.preventDefault();
    acc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    if (Math.abs(acc) < 50) return;
    const dir = acc < 0 ? 1 : -1;
    // a big delta (fast wheel, or several ticks in one event) moves several levels
    let z = o.zoom();
    for (let n = Math.min(3, Math.max(1, Math.round(Math.abs(acc) / 100))); n > 0; n--) z = stepFrom(z, dir);
    acc = 0;
    zoomTo(z, e.clientX, e.clientY);
  }, { passive: false });

  // pan: drag with the middle button
  wrap.addEventListener("pointerdown", (e) => {
    if (e.button !== 1) return;
    // capture phase: the canvas below must not start a stroke
    e.preventDefault();
    e.stopPropagation();
    wrap.setPointerCapture(e.pointerId);
    wrap.classList.add("panning");
    let lx = e.clientX, ly = e.clientY;
    const move = (ev: PointerEvent) => {
      wrap.scrollLeft -= ev.clientX - lx;
      wrap.scrollTop -= ev.clientY - ly;
      lx = ev.clientX;
      ly = ev.clientY;
    };
    const up = () => {
      wrap.removeEventListener("pointermove", move);
      wrap.classList.remove("panning");
    };
    wrap.addEventListener("pointermove", move);
    wrap.addEventListener("pointerup", up, { once: true });
  }, true);

  return { zoomTo, step };
}
