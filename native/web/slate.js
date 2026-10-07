// Slate web player loader. Runs the same player as the Windows .exe, compiled to WebAssembly
// (wasm32-wasip1 with wasm exception handling). Loaded after mq_js_bundle.js (macroquad's WebGL/audio glue).
//
// Page layout: index.html, mq_js_bundle.js, slate.js, slate-player.wasm, game.slate
"use strict";

(function () {
  let cart = new Uint8Array(0);
  let taken = null;
  /** editor game view: runs inside the editor (cartridge and edits arrive by postMessage) */
  let embed = false;
  let pending = null;
  const toEditor = (msg) => parent.postMessage({ slate: true, ...msg }, "*");
  const mem = () => wasm_memory.buffer;
  const bytes = (ptr, len) => new Uint8Array(mem(), ptr, len);
  const str = (ptr, len) => new TextDecoder().decode(bytes(ptr, len));
  const view = () => new DataView(mem());

  // ---------------------------------------------------------------- WASI (just what the player needs)
  const ESUCCESS = 0, EBADF = 8, ENOSYS = 52;
  const lines = { 1: "", 2: "" };
  const wasi = {
    args_sizes_get(argc, size) { view().setUint32(argc, 0, true); view().setUint32(size, 0, true); return ESUCCESS; },
    args_get() { return ESUCCESS; },
    environ_sizes_get(n, size) { view().setUint32(n, 0, true); view().setUint32(size, 0, true); return ESUCCESS; },
    environ_get() { return ESUCCESS; },
    clock_time_get(id, _precision, out) {
      const ns = id === 0 ? BigInt(Date.now()) * 1000000n : BigInt(Math.round(performance.now() * 1e6));
      view().setBigUint64(out, ns, true);
      return ESUCCESS;
    },
    random_get(ptr, len) { crypto.getRandomValues(bytes(ptr, len)); return ESUCCESS; },
    fd_write(fd, iovs, n, written) {
      const v = view();
      let total = 0;
      for (let i = 0; i < n; i++) {
        const p = v.getUint32(iovs + i * 8, true), l = v.getUint32(iovs + i * 8 + 4, true);
        if (fd === 1 || fd === 2) lines[fd] += str(p, l);
        total += l;
      }
      for (const f of [1, 2]) {
        let k;
        while ((k = lines[f].indexOf("\n")) >= 0) {
          const line = lines[f].slice(0, k);
          if (embed) toEditor({ type: "log", line });
          else (f === 1 ? console.log : console.error)(line);
          lines[f] = lines[f].slice(k + 1);
        }
      }
      v.setUint32(written, total, true);
      return ESUCCESS;
    },
    fd_fdstat_get(fd, out) {
      if (fd > 2) return EBADF;
      const v = view();
      v.setUint8(out, 2); // character device
      v.setUint16(out + 2, 0, true);
      v.setBigUint64(out + 8, 0n, true);
      v.setBigUint64(out + 16, 0n, true);
      return ESUCCESS;
    },
    fd_prestat_get() { return EBADF; }, // no preopened directories: no file system
    proc_exit(code) { throw new Error(`exit ${code}`); },
    sched_yield() { return ESUCCESS; },
  };
  const wasiProxy = new Proxy(wasi, { get: (t, k) => t[k] ?? (() => ENOSYS) });

  // ---------------------------------------------------------------- Slate imports
  const slate = {
    slate_cart_len: () => cart.length,
    slate_cart_read(dst) { bytes(dst, cart.length).set(cart); },
    slate_cart_poll() {
      if (!pending) return 0;
      cart = pending;
      pending = null;
      return cart.length;
    },
    slate_error(p, n) { if (embed) toEditor({ type: "error", text: str(p, n) }); },
    slate_store_set(k, kl, v, vl) { try { localStorage.setItem(str(k, kl), str(v, vl)); } catch {} },
    slate_store_get(k, kl) {
      let v = null;
      try { v = localStorage.getItem(str(k, kl)); } catch {}
      if (v === null) return -1;
      taken = new TextEncoder().encode(v);
      return taken.length;
    },
    slate_store_take(dst) { bytes(dst, taken.length).set(taken); taken = null; },
    slate_store_remove(k, kl) { try { localStorage.removeItem(str(k, kl)); } catch {} },
    slate_pad(dst) {
      const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter((p) => p && p.connected) : [];
      const p = pads.find((x) => x.mapping === "standard") ?? pads[0];
      const out = new Float32Array(mem(), dst, 20);
      out.fill(0);
      if (!p) return 0;
      for (let i = 0; i < 16 && i < p.buttons.length; i++) out[i] = p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0);
      for (let i = 0; i < 4 && i < p.axes.length; i++) out[16 + i] = p.axes[i];
      return 1;
    },
    // C clock() (Luau's os.clock), nanoseconds in wasi-libc
    clock: () => BigInt(Math.round(performance.now() * 1e6)),
  };

  miniquad_add_plugin({
    name: "slate",
    version: 1,
    register_plugin(importObject) {
      Object.assign(importObject.env, slate);
      importObject.wasi_snapshot_preview1 = wasiProxy;
    },
  });

  async function start(wasmUrl) {
    register_plugins(plugins);
    const module = await WebAssembly.compileStreaming(fetch(wasmUrl));
    // stub any env import nobody provides (not the WASI ones, which come from the proxy above)
    for (const i of WebAssembly.Module.imports(module)) {
      if (i.module === "env" && importObject.env[i.name] === undefined) importObject.env[i.name] = () => console.warn(`missing ${i.name}`);
    }
    const instance = await WebAssembly.instantiate(module, importObject);
    wasm_memory = instance.exports.memory;
    wasm_exports = instance.exports;
    init_plugins(plugins);
    // reactor-style start: run the C++/Rust constructors, then main (which hands the loop to the browser).
    // (_start would also run the destructors as soon as main returns.)
    instance.exports.__wasm_call_ctors();
    instance.exports.__main_void();
  }

  /** Inside the editor: wait for the cartridge, start at once, take live edits after that. */
  function runEmbedded(opts) {
    embed = true;
    document.getElementById("start")?.remove();
    const canvas = document.getElementById("glcanvas");
    let started = false;
    window.addEventListener("message", (e) => {
      const m = e.data;
      if (!m || m.slate !== true || m.type !== "cart") return;
      const b = new Uint8Array(m.bytes);
      if (!started) {
        started = true;
        cart = b;
        canvas.focus();
        window.addEventListener("pointerdown", () => canvas.focus());
        start(opts.wasm ?? "slate-player.wasm").catch((err) => toEditor({ type: "error", text: String(err) }));
      } else pending = b;
    });
    window.addEventListener("focus", () => toEditor({ type: "focus" }));
    toEditor({ type: "ready" });
  }

  // a game, not a web page: no browser context menu, no reload / print / find / page zoom
  window.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "F5" || e.key === "F3" || e.key === "F7" || (mod && "rpufgsjh+=-0".includes(k) && k.length === 1)) e.preventDefault();
  }, true);
  window.addEventListener("wheel", (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

  /** Load game.slate and wait for a click / key (browsers only allow sound after one), then run. */
  window.slateRun = async function (opts = {}) {
    if (opts.embed) return runEmbedded(opts);
    const overlay = document.getElementById("start");
    const res = await fetch(opts.cart ?? "game.slate");
    if (!res.ok) {
      overlay.textContent = "game.slate not found";
      return;
    }
    cart = new Uint8Array(await res.arrayBuffer());
    // the page title: "title" (or "name") from the cartridge
    try {
      const c = JSON.parse(new TextDecoder().decode(cart));
      document.title = c.title || c.name || document.title;
    } catch {}
    overlay.classList.add("ready");
    const go = () => {
      window.removeEventListener("keydown", go);
      overlay.removeEventListener("pointerdown", go);
      overlay.remove();
      // keys only reach the game while the canvas has focus (itch.io embeds it in an iframe)
      const canvas = document.getElementById("glcanvas");
      canvas.focus();
      setTimeout(() => canvas.focus(), 0);
      window.addEventListener("pointerdown", () => canvas.focus());
      start(opts.wasm ?? "slate-player.wasm").catch((e) => {
        console.error(e);
        document.body.insertAdjacentHTML("beforeend", `<pre class="err">${String(e)}</pre>`);
      });
    };
    window.addEventListener("keydown", go);
    overlay.addEventListener("pointerdown", go);
  };
})();
