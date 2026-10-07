import { defineConfig, type Plugin } from "vite";

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

export default defineConfig({
  clearScreen: false,
  plugins: [localProxy()],
  server: { port: 1420, strictPort: true },
  build: { outDir: "dist", target: "es2022", chunkSizeWarningLimit: 2000 },
});
