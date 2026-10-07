import { existsSync, readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";

const version = JSON.parse(readFileSync(new URL("../desktop/src-tauri/tauri.conf.json", import.meta.url), "utf8")).version as string;

/** Dev-only proxy so plugins can reach local servers (e.g. ComfyUI) from the browser without CORS. */
function localProxy(): Plugin {
  return {
    name: "slate-local-proxy",
    configureServer(server) {
      server.middlewares.use("/__proxy", async (req, res) => {
        try {
          const target = new URL(new URL(req.url ?? "", "http://x").searchParams.get("url") ?? "");
          if (!["127.0.0.1", "localhost"].includes(target.hostname)) throw new Error("only local hosts");
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const r = await fetch(target, {
            method: req.method,
            headers: req.headers["content-type"] ? { "content-type": String(req.headers["content-type"]) } : {},
            body: chunks.length ? Buffer.concat(chunks) : undefined,
          });
          res.statusCode = r.status;
          res.end(Buffer.from(await r.arrayBuffer()));
        } catch (e) {
          res.statusCode = 502;
          res.end(String(e));
        }
      });
    },
  };
}

/** The web player (native/web + the wasm build) at /player/, for the editor's Game view. */
const PLAYER_FILES: Record<string, string> = {
  "index.html": "../../native/web/index.html",
  "slate.js": "../../native/web/slate.js",
  "mq_js_bundle.js": "../../native/web/mq_js_bundle.js",
  "slate-player.wasm": "../../native/target/wasm32-wasip1/release/slate-player.wasm",
};
const TYPES: Record<string, string> = { html: "text/html", js: "text/javascript", wasm: "application/wasm" };

function slatePlayer(): Plugin {
  const file = (name: string) => new URL(PLAYER_FILES[name], import.meta.url);
  return {
    name: "slate-player",
    configureServer(server) {
      server.middlewares.use("/player/", (req, res, next) => {
        const name = (req.url ?? "").split("?")[0].replace(/^\//, "") || "index.html";
        if (!(name in PLAYER_FILES) || !existsSync(file(name))) return next();
        res.setHeader("content-type", TYPES[name.split(".").pop()!] ?? "application/octet-stream");
        res.setHeader("cache-control", "no-store");
        res.end(readFileSync(file(name)));
      });
    },
    generateBundle() {
      // without the wasm (npm run web:build) the editor falls back to a separate game window
      for (const name of Object.keys(PLAYER_FILES)) {
        if (existsSync(file(name))) this.emitFile({ type: "asset", fileName: `player/${name}`, source: readFileSync(file(name)) });
      }
    },
  };
}

export default defineConfig({
  clearScreen: false,
  plugins: [localProxy(), slatePlayer()],
  define: { __SLATE_VERSION__: JSON.stringify(version) },
  server: { port: 1420, strictPort: true },
  build: { outDir: "dist", target: "es2022", chunkSizeWarningLimit: 2000 },
});
