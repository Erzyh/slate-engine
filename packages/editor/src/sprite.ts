// Editable sprite: layers × frames (each layer has one cel per frame) plus animation tags.
// The game only ever sees the flattened frames; layers and tags are editor data that is
// saved alongside so the work stays editable.

export type TagDir = "forward" | "reverse" | "pingpong";

export interface Tag {
  name: string;
  from: number;
  to: number;
  dir: TagDir;
}

export interface Layer {
  name: string;
  visible: boolean;
  /** 0..1 */
  opacity: number;
  cels: ImageData[];
  /** no painting at all */
  locked?: boolean;
  /** paint only over pixels that are already opaque (keeps the silhouette) */
  alphaLock?: boolean;
}

export function blank(w: number, h: number) {
  return new ImageData(w, h);
}

export function copyImage(img: ImageData) {
  return new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
}

export class EditSprite {
  layers: Layer[];
  tags: Tag[] = [];
  /** Per-frame bit flags for tilesets (bit 0 = solid). */
  flags: number[] = [];
  /** Per-frame duration in ms; 0 = 1/fps (Aseprite-style frame timing). */
  durations: number[] = [];
  /** Project folder the sprite's files live in ("sprites", "sprites/enemies", ...). */
  folder = "sprites";

  constructor(public name: string, frames: ImageData[], public fps = 8) {
    this.layers = [{ name: "Layer 1", visible: true, opacity: 1, cels: frames }];
  }

  get w() {
    return this.layers[0].cels[0].width;
  }

  get h() {
    return this.layers[0].cels[0].height;
  }

  get frameCount() {
    return this.layers[0].cels.length;
  }

  /** Visible layers composited bottom to top. */
  flat(frame: number): ImageData {
    const { w, h } = this;
    const out = new ImageData(w, h);
    const d = out.data;
    for (const layer of this.layers) {
      if (!layer.visible || layer.opacity <= 0) continue;
      const s = layer.cels[frame].data;
      for (let i = 0; i < d.length; i += 4) {
        const sa = (s[i + 3] / 255) * layer.opacity;
        if (sa <= 0) continue;
        const da = d[i + 3] / 255;
        const oa = sa + da * (1 - sa);
        for (let c = 0; c < 3; c++) d[i + c] = (s[i + c] * sa + d[i + c] * da * (1 - sa)) / oa;
        d[i + 3] = oa * 255;
      }
    }
    return out;
  }

  /** Flattened frames: what the game draws. */
  get frames(): ImageData[] {
    return Array.from({ length: this.frameCount }, (_, i) => this.flat(i));
  }

  // ------------------------------------------------------------ frames

  /** Duration of frame i in ms (its own, or 1/fps). */
  frameMs(i: number) {
    const d = this.durations[i] ?? 0;
    return d > 0 ? d : 1000 / Math.max(1, this.fps);
  }

  insertFrame(at: number, copyFrom?: number) {
    this.flags.splice(at, 0, copyFrom === undefined ? 0 : this.flags[copyFrom] ?? 0);
    if (this.durations.length) this.durations.splice(at, 0, copyFrom === undefined ? 0 : this.durations[copyFrom] ?? 0);
    for (const l of this.layers) {
      l.cels.splice(at, 0, copyFrom === undefined ? blank(this.w, this.h) : copyImage(l.cels[copyFrom]));
    }
    for (const t of this.tags) {
      if (t.from >= at) t.from++;
      if (t.to >= at) t.to++;
    }
  }

  removeFrame(i: number) {
    if (this.frameCount < 2) return;
    this.flags.splice(i, 1);
    this.durations.splice(i, 1);
    for (const l of this.layers) l.cels.splice(i, 1);
    this.tags = this.tags
      .map((t) => ({ ...t, from: t.from > i ? t.from - 1 : t.from, to: t.to >= i ? t.to - 1 : t.to }))
      .filter((t) => t.to >= t.from && t.to >= 0);
  }

  moveFrame(from: number, to: number) {
    const [f] = this.flags.splice(from, 1);
    this.flags.splice(to, 0, f ?? 0);
    if (this.durations.length) {
      const [d] = this.durations.splice(from, 1);
      this.durations.splice(to, 0, d ?? 0);
    }
    for (const l of this.layers) {
      const [c] = l.cels.splice(from, 1);
      l.cels.splice(to, 0, c);
    }
  }

  // ------------------------------------------------------------ layers

  addLayer(at: number, name = `Layer ${this.layers.length + 1}`) {
    const cels = Array.from({ length: this.frameCount }, () => blank(this.w, this.h));
    this.layers.splice(at, 0, { name, visible: true, opacity: 1, cels });
  }

  duplicateLayer(i: number) {
    const l = this.layers[i];
    this.layers.splice(i + 1, 0, { ...l, name: `${l.name} copy`, cels: l.cels.map(copyImage) });
  }

  removeLayer(i: number) {
    if (this.layers.length > 1) this.layers.splice(i, 1);
  }

  /** Merge layer i into the one below it. */
  mergeDown(i: number) {
    if (i <= 0) return;
    const top = this.layers[i];
    const below = this.layers[i - 1];
    const tmp = new EditSprite("tmp", [], 0);
    for (let f = 0; f < this.frameCount; f++) {
      tmp.layers = [
        { ...below, visible: true, cels: [below.cels[f]] },
        { ...top, visible: top.visible, cels: [top.cels[f]] },
      ];
      const merged = tmp.flat(0);
      // keep the lower layer's opacity semantics: bake it, then reset to 1
      below.cels[f] = merged;
    }
    below.opacity = 1;
    this.layers.splice(i, 1);
  }

  // ------------------------------------------------------------ whole-sprite transforms

  /** Apply fn to every cel (all layers, all frames). fn returns the new cel. */
  mapCels(fn: (c: ImageData) => ImageData) {
    for (const l of this.layers) l.cels = l.cels.map(fn);
  }

  /** Play order of a tag (or all frames): forward, reverse or ping-pong. */
  playOrder(tag: Tag | null) {
    const from = tag ? tag.from : 0;
    const to = tag ? tag.to : this.frameCount - 1;
    const out: number[] = [];
    if (tag?.dir === "reverse") for (let f = to; f >= from; f--) out.push(f);
    else {
      for (let f = from; f <= to; f++) out.push(f);
      if (tag?.dir === "pingpong") for (let f = to - 1; f > from; f--) out.push(f);
    }
    return out;
  }

  /** Tag playback: frame index for an animation time in seconds (same rules as the game). */
  tagFrame(tag: Tag | null, t: number) {
    const order = this.playOrder(tag);
    const cycle = order.reduce((s, f) => s + this.frameMs(f), 0);
    let rest = ((t * 1000) % cycle + cycle) % cycle;
    for (const f of order) {
      rest -= this.frameMs(f);
      if (rest < 0) return f;
    }
    return order[order.length - 1];
  }

  clone(): EditSprite {
    const s = new EditSprite(this.name, [], this.fps);
    s.layers = this.layers.map((l) => ({ ...l, cels: l.cels.map(copyImage) }));
    s.tags = this.tags.map((t) => ({ ...t }));
    s.flags = this.flags.slice();
    s.durations = this.durations.slice();
    s.folder = this.folder;
    return s;
  }

  /** Restore everything except the name from a clone (undo). */
  restore(from: EditSprite) {
    this.layers = from.layers.map((l) => ({ ...l, cels: l.cels.map(copyImage) }));
    this.tags = from.tags.map((t) => ({ ...t }));
    this.flags = from.flags.slice();
    this.durations = from.durations.slice();
    this.fps = from.fps;
  }
}
