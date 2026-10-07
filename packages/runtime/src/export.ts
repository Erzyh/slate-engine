import type { Cartridge } from "./cart.ts";

/** A single self-contained HTML file: player runtime + cartridge. Ready for itch.io. */
export function playerHtml(playerJs: string, cart: Cartridge): string {
  const safe = (s: string) => s.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${cart.name.replace(/[<>&]/g, "")}</title>
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}canvas{width:100vw;height:100vh;display:block}</style>
</head><body><canvas id="c"></canvas>
<script>${safe(playerJs)}</script>
<script>Slate.boot(document.getElementById("c"), ${safe(JSON.stringify(cart))});</script>
</body></html>`;
}
