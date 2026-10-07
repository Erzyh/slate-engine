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
  // debug flags from the editor's Game view (bit 0 hitboxes, 1 paused, 2 step once, 3 stats)
  let debugFlags = null;
  const toEditor = (msg, transfer) => parent.postMessage({ slate: true, ...msg }, "*", transfer);
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
    slate_debug_poll() {
      if (debugFlags === null) return 0;
      // the player keeps the state; a step request (bit 2) is delivered once
      const d = debugFlags;
      debugFlags = null;
      return (d | 0x80000000) >>> 0;
    },
    slate_frame(p, n, w, h) {
      if (!embed) return;
      const px = bytes(p, n).slice();
      toEditor({ type: "frame", w, h, px: px.buffer }, [px.buffer]);
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
      if (p) {
        for (let i = 0; i < 16 && i < p.buttons.length; i++) out[i] = p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0);
        for (let i = 0; i < 4 && i < p.axes.length; i++) out[16 + i] = p.axes[i];
      }
      // the on-screen controls count as a gamepad too
      if (touch.on) for (let i = 0; i < 16; i++) out[i] = Math.max(out[i], touch.b[i]);
      return p || touch.on ? 1 : 0;
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
    touchControls();
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
      if (m && m.slate === true && m.type === "debug") {
        debugFlags = m.flags | 0;
        return;
      }
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

  // ---------------------------------------------------------------- touch controls
  // Phones and tablets get an on-screen d-pad, A, B and Start. They drive the gamepad buttons
  // (standard mapping), so games need no changes: btn("left"), btn("a")... just work.
  // ?touch=1 shows them anywhere, ?touch=0 never.
  const touch = { on: false, b: new Float32Array(16) };
  const PAD = { up: 12, down: 13, left: 14, right: 15, a: 0, b: 1, start: 9 };

  function touchControls() {
    const force = new URLSearchParams(location.search).get("touch");
    const coarse = matchMedia("(pointer: coarse)").matches && navigator.maxTouchPoints > 0;
    if (force === "0" || (!coarse && force !== "1")) return;
    touch.on = true;
    const css = document.createElement("style");
    css.textContent = `
      .tc { position: fixed; z-index: 10; touch-action: none; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
      .tc-pad { left: max(16px, env(safe-area-inset-left)); bottom: max(16px, env(safe-area-inset-bottom)); width: 132px; height: 132px; border-radius: 50%; background: #ffffff1c; border: 2px solid #ffffff30; }
      .tc-pad::before, .tc-pad::after { content: ""; position: absolute; left: 50%; top: 50%; background: #ffffff38; border-radius: 6px; transform: translate(-50%, -50%); }
      .tc-pad::before { width: 38px; height: 100px; }
      .tc-pad::after { width: 100px; height: 38px; }
      .tc-knob { position: absolute; left: 50%; top: 50%; width: 46px; height: 46px; margin: -23px 0 0 -23px; border-radius: 50%; background: #ffffff55; transition: transform .05s; z-index: 1; }
      .tc-btn { width: 66px; height: 66px; border-radius: 50%; background: #ffffff1c; border: 2px solid #ffffff40; color: #ffffffb0; font: 600 20px/62px system-ui, sans-serif; text-align: center; }
      .tc-btn.on, .tc-start.on { background: #ffffff50; }
      .tc-a { right: max(20px, env(safe-area-inset-right)); bottom: max(54px, env(safe-area-inset-bottom)); }
      .tc-b { right: calc(max(20px, env(safe-area-inset-right)) + 76px); bottom: max(16px, env(safe-area-inset-bottom)); }
      .tc-start { left: 50%; top: max(10px, env(safe-area-inset-top)); transform: translateX(-50%); padding: 5px 14px; border-radius: 14px; background: #ffffff1c; border: 2px solid #ffffff30; color: #ffffffa0; font: 600 12px system-ui, sans-serif; letter-spacing: 1px; }
    `;
    document.head.appendChild(css);
    const el = (cls, text = "") => {
      const d = document.createElement("div");
      d.className = `tc ${cls}`;
      d.textContent = text;
      document.body.appendChild(d);
      return d;
    };
    // d-pad: the direction from its center (8 ways, with a dead zone in the middle)
    const pad = el("tc-pad");
    const knob = document.createElement("div");
    knob.className = "tc-knob";
    pad.appendChild(knob);
    const setDir = (dx, dy) => {
      const len = Math.hypot(dx, dy);
      const on = len > 0.28;
      const a = Math.atan2(dy, dx);
      const near = (t) => Math.abs(Math.atan2(Math.sin(a - t), Math.cos(a - t))) < Math.PI * 0.375;
      touch.b[PAD.right] = on && near(0) ? 1 : 0;
      touch.b[PAD.down] = on && near(Math.PI / 2) ? 1 : 0;
      touch.b[PAD.left] = on && near(Math.PI) ? 1 : 0;
      touch.b[PAD.up] = on && near(-Math.PI / 2) ? 1 : 0;
      const k = Math.min(1, len);
      knob.style.transform = on ? `translate(${(dx / (len || 1)) * k * 40}px, ${(dy / (len || 1)) * k * 40}px)` : "";
    };
    const track = (node, down, move, up) => {
      node.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        try { node.setPointerCapture(e.pointerId); } catch {}
        down(e);
      });
      node.addEventListener("pointermove", (e) => { if (e.buttons || node.hasPointerCapture(e.pointerId)) move(e); });
      const end = () => up();
      node.addEventListener("pointerup", end);
      node.addEventListener("pointercancel", end);
      node.addEventListener("lostpointercapture", end);
    };
    const fromPad = (e) => {
      const r = pad.getBoundingClientRect();
      setDir((e.clientX - r.left - r.width / 2) / (r.width / 2), (e.clientY - r.top - r.height / 2) / (r.height / 2));
    };
    track(pad, fromPad, fromPad, () => setDir(0, 0));
    const button = (cls, text, index) => {
      const b = el(cls, text);
      track(b, () => { touch.b[index] = 1; b.classList.add("on"); if (navigator.vibrate) navigator.vibrate(8); }, () => {}, () => { touch.b[index] = 0; b.classList.remove("on"); });
    };
    button("tc-btn tc-a", "A", PAD.a);
    button("tc-btn tc-b", "B", PAD.b);
    button("tc-start", "START", PAD.start);
    // no page scrolling / zooming while playing
    document.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
  }

  // a game, not a web page: no browser context menu, no reload / print / find / page zoom
  window.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === "F5" || e.key === "F3" || e.key === "F7" || (mod && "rpufgsjh+=-0".includes(k) && k.length === 1)) e.preventDefault();
    // the editor's Game view: pause / step keys work while the game has focus
    if (embed && (e.key === "F6" || e.key === "F7" || e.key === "F8" || e.key === "F9")) {
      e.preventDefault();
      toEditor({ type: "key", key: e.key });
    }
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
