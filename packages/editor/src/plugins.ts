// Plugin host. Each plugin runs in its own sandboxed iframe (opaque origin, scripts only) and
// can reach the editor only through postMessage. Network access is limited to the hosts its
// plugin.json declares; on desktop the Rust side checks that list again before any request.
//
// Plugin API (inside the sandbox):
//   slate.settings                         merged defaults + user settings
//   slate.registerImageGenerator({ id, name, options, generate(prompt, opts, progress) })
//       generate returns { bytes: Uint8Array, background?: "auto" | "none" }
//   slate.fetch(url, { method, headers, body })  -> { status, ok, bytes, text(), json() }
//   slate.sleep(ms)

import { isTauri } from "./native.ts";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  /** License/attribution notice shown in the plugin manager. */
  notice?: string;
  entry: string;
  permissions?: { network?: string[] };
  settings?: Record<string, { label?: string; default: string }>;
}

export interface GenOption {
  key: string;
  label?: string;
  values: string[];
}

export interface Generator {
  plugin: string;
  id: string;
  name: string;
  options: GenOption[];
}

export interface GenResult {
  bytes: Uint8Array;
  /** Grid Stamp hints from the generator */
  background?: "auto" | "none";
  colors?: number;
  /** the image is a texture: make a seamless tile */
  tile?: boolean;
}

interface Loaded {
  manifest: PluginManifest;
  frame: HTMLIFrameElement;
  enabled: boolean;
}

type Pending = { resolve: (v: GenResult) => void; reject: (e: Error) => void; progress: (t: string) => void };

const ENABLED_KEY = "slate:plugins:disabled";

function disabledSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(ENABLED_KEY) ?? "[]"));
  } catch {
    return new Set();
  }
}

export function settingsOf(m: PluginManifest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m.settings ?? {})) out[k] = v.default;
  try {
    Object.assign(out, JSON.parse(localStorage.getItem(`slate:plugin:${m.id}:settings`) ?? "{}"));
  } catch {
    // ignore broken settings
  }
  return out;
}

export function saveSettings(id: string, s: Record<string, string>) {
  try {
    localStorage.setItem(`slate:plugin:${id}:settings`, JSON.stringify(s));
  } catch {
    // storage unavailable
  }
}

const BOOTSTRAP = `
const pending = new Map(); let seq = 0; const gens = {};
const call = (msg) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); parent.postMessage({ ...msg, id }, "*"); });
window.slate = {
  settings: __SETTINGS__,
  registerImageGenerator(g) {
    gens[g.id] = g;
    parent.postMessage({ type: "register-generator", gen: { id: g.id, name: g.name, options: g.options || [] } }, "*");
  },
  async fetch(url, init = {}) {
    const r = await call({ type: "fetch", url, init: { method: init.method || "GET", headers: init.headers || {}, body: init.body ?? null } });
    const bytes = new Uint8Array(r.body);
    return { status: r.status, ok: r.status >= 200 && r.status < 300, bytes,
      text() { return new TextDecoder().decode(bytes); }, json() { return JSON.parse(this.text()); } };
  },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};
addEventListener("message", async (e) => {
  if (e.source !== parent) return;
  const m = e.data;
  if (m.type === "reply") {
    const p = pending.get(m.id); pending.delete(m.id);
    if (p) m.error ? p.rej(new Error(m.error)) : p.res(m.data);
  } else if (m.type === "generate") {
    try {
      const g = gens[m.gen];
      if (!g) throw new Error("unknown generator " + m.gen);
      const r = await g.generate(m.prompt, m.opts, (t) => parent.postMessage({ type: "progress", id: m.id, text: String(t) }, "*"));
      parent.postMessage({ type: "generated", id: m.id, bytes: r.bytes, background: r.background, colors: r.colors, tile: r.tile }, "*");
    } catch (err) {
      parent.postMessage({ type: "generated", id: m.id, error: String(err && err.message || err) }, "*");
    }
  }
});
`;

function hostOf(url: string) {
  const u = new URL(url);
  const port = u.port || (u.protocol === "https:" ? "443" : "80");
  return `${u.hostname}:${port}`;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export class PluginHost {
  plugins = new Map<string, Loaded>();
  generators: Generator[] = [];
  onChange: () => void = () => {};
  private pending = new Map<number, Pending>();
  private seq = 0;

  constructor() {
    window.addEventListener("message", (e) => this.onMessage(e));
  }

  /** Discover installed plugins (desktop: app data folder; dev browser: repo plugins/). */
  async loadAll() {
    let found: { manifest: string; source: string }[] = [];
    if (isTauri) {
      found = await invoke("list_plugins");
    } else if (import.meta.env.DEV) {
      const manifests = import.meta.glob("../../../plugins/*/plugin.json", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
      const sources = import.meta.glob("../../../plugins/*/*.js", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
      for (const [path, manifest] of Object.entries(manifests)) {
        const m = JSON.parse(manifest) as PluginManifest;
        const src = sources[path.replace("plugin.json", m.entry)];
        if (src) found.push({ manifest, source: src });
      }
    }
    const disabled = disabledSet();
    for (const f of found) {
      try {
        const m = JSON.parse(f.manifest) as PluginManifest;
        this.sources.set(m.id, f.source);
        this.load(m, f.source, !disabled.has(m.id));
      } catch (err) {
        console.warn("bad plugin", err);
      }
    }
    this.onChange();
  }

  /** Drop every plugin and discover them again (after installing one). */
  async reloadAll() {
    for (const id of [...this.plugins.keys()]) this.unload(id);
    this.sources.clear();
    await this.loadAll();
  }

  private load(manifest: PluginManifest, source: string, enabled: boolean) {
    this.unload(manifest.id);
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.style.display = "none";
    const safe = (s: string) => s.replace(/<\/script/gi, "<\\/script");
    if (enabled) {
      const boot = BOOTSTRAP.replace("__SETTINGS__", JSON.stringify(settingsOf(manifest)));
      frame.srcdoc = `<!doctype html><script>${safe(boot)}</script><script type="module">${safe(source)}</script>`;
    }
    document.body.appendChild(frame);
    this.plugins.set(manifest.id, { manifest, frame, enabled });
  }

  private unload(id: string) {
    const p = this.plugins.get(id);
    if (!p) return;
    p.frame.remove();
    this.plugins.delete(id);
    this.generators = this.generators.filter((g) => g.plugin !== id);
  }

  /** Enable/disable and reload a plugin (also applies changed settings). */
  setEnabled(id: string, enabled: boolean) {
    const p = this.plugins.get(id);
    if (!p) return;
    const d = disabledSet();
    if (enabled) d.delete(id);
    else d.add(id);
    localStorage.setItem(ENABLED_KEY, JSON.stringify([...d]));
    this.load(p.manifest, this.sources.get(id) ?? "", enabled);
    this.onChange();
  }

  private sources = new Map<string, string>();

  generate(gen: Generator, prompt: string, opts: Record<string, string>, progress: (t: string) => void): Promise<GenResult> {
    const p = this.plugins.get(gen.plugin);
    if (!p?.frame.contentWindow) return Promise.reject(new Error("plugin not loaded"));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, progress });
      p.frame.contentWindow!.postMessage({ type: "generate", id, gen: gen.id, prompt, opts }, "*");
    });
  }

  private pluginFor(source: MessageEventSource | null) {
    for (const p of this.plugins.values()) if (p.frame.contentWindow === source) return p;
    return null;
  }

  private async onMessage(e: MessageEvent) {
    const p = this.pluginFor(e.source);
    if (!p) return;
    const m = e.data;
    const reply = (data: unknown, error?: string) => p.frame.contentWindow?.postMessage({ type: "reply", id: m.id, data, error }, "*");
    switch (m.type) {
      case "register-generator":
        this.generators = this.generators.filter((g) => !(g.plugin === p.manifest.id && g.id === m.gen.id));
        this.generators.push({ plugin: p.manifest.id, id: m.gen.id, name: m.gen.name, options: m.gen.options ?? [] });
        this.onChange();
        break;
      case "fetch":
        try {
          reply(await this.fetchFor(p.manifest, m.url, m.init));
        } catch (err) {
          reply(null, String((err as Error).message ?? err));
        }
        break;
      case "progress":
        this.pending.get(m.id)?.progress(m.text);
        break;
      case "generated": {
        const pend = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (!pend) break;
        if (m.error) pend.reject(new Error(m.error));
        else pend.resolve({ bytes: m.bytes, background: m.background, colors: m.colors, tile: m.tile });
        break;
      }
    }
  }

  /** Network access for a plugin, limited to its declared hosts. */
  private async fetchFor(m: PluginManifest, url: string, init: { method: string; headers: Record<string, string>; body: string | null }) {
    const allowed = m.permissions?.network ?? [];
    const host = hostOf(url);
    if (!allowed.includes(host)) throw new Error(`plugin "${m.id}" is not allowed to access ${host}`);
    if (isTauri) {
      const r = await invoke<{ status: number; body: number[] | string }>("plugin_fetch", {
        plugin: m.id, url, method: init.method, headers: init.headers, body: init.body,
      });
      const bytes = typeof r.body === "string" ? Uint8Array.from(atob(r.body), (c) => c.charCodeAt(0)) : new Uint8Array(r.body);
      return { status: r.status, body: bytes.buffer };
    }
    // dev browser: go through the Vite dev proxy (avoids CORS for local servers)
    const res = await fetch(`/__proxy?url=${encodeURIComponent(url)}`, {
      method: init.method, headers: init.headers, body: init.body ?? undefined,
    });
    return { status: res.status, body: await res.arrayBuffer() };
  }
}
