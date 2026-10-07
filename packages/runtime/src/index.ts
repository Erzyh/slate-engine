export { Game, fmt, parseColor, type GameOptions, type SprOptions, type TextOptions, type Color } from "./game.ts";
export { emptyCartridge, decodeFrame, encodeFrame, type Cartridge, type SpriteDef, type TileMap, type MapLayer, type MapObject } from "./cart.ts";
export { beep, sfx } from "./audio.ts";
export { playerHtml } from "./export.ts";
export * from "./project.ts";

import { Game, type GameOptions } from "./game.ts";
import type { Cartridge } from "./cart.ts";

/** Entry point for exported games: `Slate.boot(canvas, cart)`. */
export function boot(canvas: HTMLCanvasElement, cart: Cartridge, opts?: GameOptions) {
  return Game.create(canvas, cart, opts);
}
