import "./style.css";
import { baseName, extOf, type Cartridge } from "@slate/runtime";
import { CodeEditor } from "./code-editor.ts";
import { example, template } from "./examples.ts";
import { Explorer } from "./explorer.ts";
import { fingerprint, openFolderPath, pickFolder, type ProjectFolder } from "./folder.ts";
import { pickCartFile, saveBinary, saveCart, saveText } from "./io.ts";
import { exportWeb, exportWindows, isTauri, nativeRunning, playerOutput, runNative, stopNative, updateNative } from "./native.ts";
import { MapEditor } from "./map-editor.ts";
import { canvasSize, resample } from "./ops.ts";
import { PixelPanels } from "./panels.ts";
import { PixelEditor } from "./pixel-editor.ts";
import { Project, STARTER_MAIN } from "./project.ts";
import { StampDialog } from "./stamp-dialog.ts";
import { SfxDialog } from "./sfx-dialog.ts";
import { PluginHost, saveSettings, settingsOf } from "./plugins.ts";
import { enhanceSelects } from "./dropdown.ts";
import { checkForUpdates, initUpdater } from "./updater.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const LAST_FOLDER = "slate:lastFolder";

enhanceSelects();
let project: Project;
/** The folder the project lives in (null = not saved yet: an example, a new project, an import). */
let folder: ProjectFolder | null = null;
/** Fingerprints of the files as last saved/opened: only changed files are written. */
let saved = new Map<string, string>();
/** Files changed since the last save (shown with a dot in the explorer). */
const dirty = new Set<string>();
let currentSprite: string | null = null;
/** Native game window state, and the scripts it was last (re)started with. */
let nativeOn = false;
let applied: { scripts: Record<string, string>; main: string } = { scripts: {}, main: "" };

const editor = new PixelEditor($("pixel-canvas"), $("palette"));
const stamp = new StampDialog();
const sfxDialog = new SfxDialog();
sfxDialog.exists = (name) => !!project.cart.sounds?.[name];
sfxDialog.onSave = (dir, name, wav) => {
  project.addAudio("sounds", name, wav, "wav", dir);
  markFile(`${dir}/${name}.wav`);
  scheduleNativeSync();
  setStatus(`Saved ${dir}/${name}.wav · in code: sfx("${name}")`);
  return null;
};
let preview: HTMLAudioElement | null = null;
const mapEditor = new MapEditor({
  changed: () => {
    if (mapEditor.map) markFile(mapPath(mapEditor.map.name));
    scheduleNativeSync();
  },
  status: (msg, error) => setStatus(msg, error),
  flagsChanged: (s) => {
    markFile(spritePath(s.name));
    scheduleNativeSync();
  },
});
const panels = new PixelPanels(editor, {
  pixelsChanged: () => syncSprite(),
  structureChanged: () => {
    const s = editor.sprite;
    if (s) markFile(spritePath(s.name));
    renderExplorer();
    scheduleNativeSync();
  },
  status: (msg, error) => setStatus(msg, error),
  saveBinary,
  saveText,
  addSprite: (name, frames) => {
    const s = project.addSprite(name, frames);
    markFile(spritePath(s.name));
    openSprite(s.name);
  },
});
const code = new CodeEditor($("code-host"), $("code-tabs"), {
  changed: (path, text) => {
    project.scripts[path] = text;
    markFile(path);
  },
  run: () => void restart(),
  save: () => void save(),
  scripts: () => Object.keys(project.scripts),
});
code.onSwitch = (path) => openScript(path);
const statusEl = $("status");

const spritePath = (name: string) => `${project.get(name)?.folder ?? "sprites"}/${name}.png`;
const mapPath = (name: string) => `${project.mapFolders.get(name) ?? "maps"}/${name}.json`;

// ------------------------------------------------------------------ explorer

const explorer = new Explorer($("explorer"), {
  openScript: (p) => openScript(p),
  openSprite: (n) => openSprite(n),
  openMap: (n) => {
    showTab("map");
    mapEditor.selectMap(n);
    renderExplorer();
  },
  newScript: (dir) => {
    const name = prompt(`New script in ${dir}/ (load it with require("${dir.replace(/^scripts\/?/, "") ? dir.replace(/^scripts\//, "") + "/" : ""}name"))`, "untitled")?.trim();
    if (!name) return;
    const path = project.addScript(`${dir}/${name.replace(/\.luau$/, "").replace(/[^\w/-]/g, "_")}.luau`, `-- ${name}\nlocal M = {}\n\nreturn M\n`);
    markFile(path);
    openScript(path);
  },
  newSprite: (dir) => newSprite(dir),
  newMap: () => {
    showTab("map");
    $("map-new").click();
  },
  newSound: (dir) => sfxDialog.open(dir),
  playAudio: (path) => {
    const top = path.split("/")[0] as "music" | "sounds";
    const url = (top === "music" ? project.cart.music : project.cart.sounds)?.[baseName(path)];
    preview?.pause();
    if (!url || preview?.dataset.path === path) return void (preview = null);
    preview = new Audio(url);
    preview.dataset.path = path;
    preview.onended = () => (preview = null);
    void preview.play();
    setStatus(`Playing ${path} (click again to stop)`);
  },
  newFolder: (parent) => {
    const name = prompt(`New folder in ${parent}/`, "")?.trim().replace(/[^\w-]/g, "_");
    if (!name) return;
    project.folders.add(`${parent}/${name}`);
    explorer.collapsed.delete(parent);
    renderExplorer();
    markFile(`${parent}/${name}/`);
  },
  importFiles: (dir) => {
    importTarget = dir;
    $<HTMLInputElement>("import-input").click();
  },
  rename: (path) => renamePath(path),
  remove: (path) => {
    if (!confirm(`Delete ${path}?${folder ? "\n(It moves to the project's .slate-trash folder when you save.)" : ""}`)) return;
    project.deletePath(path);
    if (path.startsWith("sprites/") && currentSprite === baseName(path)) selectSprite(project.sprites[0]?.name ?? null);
    if (path.startsWith("maps/")) mapEditor.setProject(project);
    code.sync((p) => p in project.scripts);
    markFile(path);
    scheduleNativeSync();
  },
  removeFolder: (dir) => {
    const n = project.paths().filter((p) => p.startsWith(dir + "/")).length;
    if (!confirm(`Delete the folder ${dir}/ and its ${n} file(s)?`)) return;
    project.deleteFolder(dir);
    selectSprite(project.get(currentSprite ?? "") ? currentSprite : project.sprites[0]?.name ?? null);
    mapEditor.setProject(project);
    code.sync((p) => p in project.scripts);
    markFile(dir + "/");
    scheduleNativeSync();
  },
  setMain: (path) => {
    project.cart.main = path;
    markFile("slate.json");
    setStatus(`${path} now runs first`);
  },
});
$("btn-new-file").onclick = (e) => {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  explorer.menu(r.left, r.bottom + 4, explorer.folderItems(""));
};

function renderExplorer() {
  if (!project) return;
  explorer.render(
    project,
    { script: $("tab-code").classList.contains("active") ? code.active : null, sprite: $("tab-pixel").classList.contains("active") ? currentSprite : null, map: $("tab-map").classList.contains("active") ? mapEditor.map?.name ?? null : null },
    dirty,
    project.cart.main ?? "",
  );
  $("project-label").textContent = folder ? folder.label.split(/[\\/]/).pop() ?? folder.label : `${project.cart.name} (not saved)`;
  $("project-label").title = folder ? folder.label : "Not saved to a folder yet: File > Save project as…";
}

function renamePath(path: string) {
  const isFolder = !project.paths().includes(path);
  const top = path.split("/")[0];
  const leaf = path.slice(path.lastIndexOf("/") + 1);
  const ext = isFolder || top === "scripts" ? "" : leaf.slice(leaf.lastIndexOf("."));
  const answer = prompt(isFolder ? `Rename folder ${path}/` : `Rename ${path}${top === "sprites" ? "\n(code that uses spr(\"" + baseName(path) + "\") must be updated too)" : ""}`, isFolder || top === "scripts" ? leaf : baseName(path))?.trim();
  if (!answer || answer === leaf) return;
  const dir = path.slice(0, path.lastIndexOf("/"));
  const clean = answer.replace(/[^\w.-]/g, "_");
  if (isFolder) {
    const to = `${dir}/${clean}`;
    for (const p of project.paths().filter((x) => x.startsWith(path + "/"))) {
      project.renamePath(p, to + p.slice(path.length));
      markFile(p);
    }
    for (const f of [...project.folders]) if (f === path || f.startsWith(path + "/")) {
      project.folders.delete(f);
      project.folders.add(to + f.slice(path.length));
    }
    code.sync((p) => p in project.scripts);
    renderExplorer();
    return;
  }
  const to = `${dir}/${top === "scripts" && !clean.endsWith(".luau") ? clean + ".luau" : top === "scripts" ? clean : clean + ext}`;
  const oldName = baseName(path);
  if (!project.renamePath(path, to)) return setStatus(`"${to}" already exists`, true);
  markFile(path);
  markFile(to);
  if (top === "scripts") code.sync((p) => p in project.scripts, [path, to]);
  if (top === "sprites" && currentSprite === oldName) currentSprite = baseName(to);
  if (top === "maps") mapEditor.setProject(project);
  scheduleNativeSync();
  renderExplorer();
}

// ------------------------------------------------------------------ open / save

async function openProject(p: Project, where: ProjectFolder | null) {
  project = p;
  folder = where;
  dirty.clear();
  project.on(() => renderExplorer());
  $<HTMLInputElement>("cart-name").value = p.cart.name;
  document.title = `${p.cart.name} · Slate`;
  if (where && isTauri) localStorage.setItem(LAST_FOLDER, where.label);
  saved = where ? fingerprints(p.toFiles()) : new Map();
  applied = { scripts: { ...p.scripts }, main: p.cart.main ?? "" };
  code.reset();
  currentSprite = p.sprites[0]?.name ?? null;
  selectSprite(currentSprite);
  mapEditor.setProject(p);
  if (nativeOn) await updateNative(nativeCart());
  const main = p.cart.main ?? "";
  if (main in p.scripts) code.show(main, p.scripts[main]);
  renderExplorer();
  setStatus(`Opened ${where ? where.label : p.cart.name} · ${Object.keys(p.scripts).length} scripts · ${p.sprites.length} sprites · ${p.maps.length} maps`);
}

async function openCart(cart: Cartridge) {
  await openProject(await Project.load(structuredClone(cart)), null);
}

function fingerprints(files: Map<string, Uint8Array>) {
  return new Map([...files].map(([p, b]) => [p, fingerprint(b)]));
}

async function openFolder() {
  if (dirty.size && !confirm("Open another project? Unsaved changes will be lost.")) return;
  try {
    const f = await pickFolder("open");
    if (!f) return;
    const { files, dirs } = await f.read();
    await openProject(await Project.fromFiles(files, dirs), f);
  } catch (e) {
    setStatus(String(e), true);
  }
}

async function writeTo(f: ProjectFolder, all: boolean) {
  project.cart.name = $<HTMLInputElement>("cart-name").value.trim() || "untitled";
  const files = project.toFiles();
  const prints = fingerprints(files);
  const changed = new Map([...files].filter(([p]) => all || saved.get(p) !== prints.get(p)));
  const removed = all ? [] : [...saved.keys()].filter((p) => !files.has(p));
  await f.write(changed, removed, [...project.folders]);
  saved = prints;
  dirty.clear();
  renderExplorer();
  return { written: changed.size, removed: removed.length };
}

async function save() {
  if (!folder) return saveAs();
  try {
    const r = await writeTo(folder, false);
    setStatus(r.written || r.removed ? `Saved ${r.written} file(s)${r.removed ? `, moved ${r.removed} deleted file(s) to .slate-trash` : ""} · ${folder.label}` : `Nothing changed · ${folder.label}`);
  } catch (e) {
    setStatus(`Save failed: ${e}`, true);
  }
}

async function saveAs() {
  try {
    const f = await pickFolder("save");
    if (!f) return;
    folder = f;
    if (isTauri) localStorage.setItem(LAST_FOLDER, f.label);
    const r = await writeTo(f, true);
    setStatus(`Saved the project to ${f.label} (${r.written} files)`);
  } catch (e) {
    setStatus(String(e), true);
  }
}

async function newProject(from = "") {
  if (dirty.size && !confirm("Start a new project? Unsaved changes will be lost.")) return;
  const name = prompt("Project name", "my-game")?.trim().replace(/[^\w-]/g, "-");
  if (!name) return;
  const base = from ? template(from) : null;
  const cart: Cartridge = base
    ? { ...base, name, title: name }
    : {
        slate: 1, name, title: name, resolution: [320, 180], background: "#1a1c2c", sprites: [], maps: [], code: "", lang: "luau",
        scripts: { "scripts/main.luau": STARTER_MAIN }, main: "scripts/main.luau", music: {}, sounds: {},
      };
  await openProject(await Project.load(cart), null);
  setStatus(`New project "${name}" · File > Save project as… to pick its folder`);
}

let importTarget = "";
$<HTMLInputElement>("import-input").onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const list = [...(input.files ?? [])];
  input.value = "";
  for (const f of list) await importFile(f, importTarget);
};

/** Add a file from disk: .luau -> scripts, .png -> sprite, .ogg/.wav -> music or sounds, .json -> map. */
async function importFile(f: File, dir: string) {
  const ext = extOf(f.name), name = baseName(f.name).replace(/[^\w-]/g, "_");
  const top = dir.split("/")[0];
  const bytes = new Uint8Array(await f.arrayBuffer());
  if (ext === "luau" || ext === "lua") {
    const path = project.addScript(`${top === "scripts" ? dir : "scripts"}/${name}.luau`, new TextDecoder().decode(bytes));
    markFile(path);
    openScript(path);
  } else if (ext === "png") {
    const img = await createImageBitmap(f);
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    const s = project.addSprite(name, [g.getImageData(0, 0, img.width, img.height)], 8, top === "sprites" ? dir : "sprites");
    markFile(spritePath(s.name));
    openSprite(s.name);
  } else if (ext === "ogg" || ext === "wav") {
    const kind = top === "music" || top === "sounds" ? top : ext === "ogg" ? "music" : "sounds";
    project.addAudio(kind, name, bytes, ext, top === kind ? dir : kind);
    markFile(`${kind}/${name}.${ext}`);
    setStatus(`Added ${kind}/${name}.${ext} · in code: ${kind === "music" ? `music("${name}")` : `sfx("${name}")`}`);
  } else if (ext === "json") {
    try {
      const m = JSON.parse(new TextDecoder().decode(bytes));
      if (!m.layers || !m.tileset) throw new Error("not a tile map");
      project.maps.push({ ...m, name });
      mapEditor.setProject(project);
      markFile(mapPath(name));
    } catch (err) {
      setStatus(`${f.name}: ${err}`, true);
    }
  } else setStatus(`Can't import ${f.name} (use .luau, .png, .ogg, .wav or a map .json)`, true);
  renderExplorer();
  scheduleNativeSync();
}

// ------------------------------------------------------------------ game

/** Cartridge for the native player. Script edits apply on Restart (Ctrl+Enter), not on every keystroke. */
function nativeCart(): Cartridge {
  project.cart.name = $<HTMLInputElement>("cart-name").value.trim() || "untitled";
  return { ...project.toCart(), scripts: applied.scripts, main: applied.main };
}

let nativeSyncTimer = 0;
function scheduleNativeSync() {
  if (!nativeOn) return;
  clearTimeout(nativeSyncTimer);
  nativeSyncTimer = window.setTimeout(async () => {
    nativeOn = await updateNative(nativeCart());
    updatePlayButton();
  }, 200);
}

function markFile(path: string) {
  dirty.add(path);
  scheduleAutosave();
  renderExplorer();
}

let autosaveTimer = 0;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    project.cart.name = $<HTMLInputElement>("cart-name").value.trim() || "untitled";
    if (!folder) project.autosave();
  }, 1000);
}

function setStatus(msg: string, error = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", error);
}

async function togglePlay() {
  if (!isTauri) {
    setStatus("Games run in the Slate desktop app (npm run desktop:dev)", true);
    return;
  }
  if (nativeOn && (await nativeRunning())) {
    await stopNative();
    nativeOn = false;
  } else {
    applied = { scripts: { ...project.scripts }, main: project.cart.main ?? "" };
    clearConsole();
    await runNative(nativeCart());
    nativeOn = true;
    setStatus("Game window opened · sprite and map edits apply live · Ctrl+Enter applies code");
  }
  updatePlayButton();
}

async function restart() {
  if (!isTauri) return togglePlay();
  applied = { scripts: { ...project.scripts }, main: project.cart.main ?? "" };
  // stop + start so the game restarts even when the code is unchanged
  if (nativeOn) await stopNative();
  clearConsole();
  await runNative(nativeCart());
  nativeOn = true;
  updatePlayButton();
}

function updatePlayButton() {
  const b = $("btn-play");
  b.textContent = nativeOn ? "■ Stop" : "▶ Play";
  b.classList.toggle("running", nativeOn);
}

// ------------------------------------------------------------------ console (log() output and errors from the game)

let logOffset = 0;
let lastError = "";
const consoleLog = $("console-log");

function clearConsole() {
  consoleLog.textContent = "";
  logOffset = 0;
  showError("");
}

/** "scripts/player.luau:12: attempt to ..." -> { path, line } */
function errorPlace(msg: string) {
  const m = msg.match(/((?:scripts\/)?[\w/.-]+\.luau):(\d+):/) ?? msg.match(/^main:(\d+):/);
  if (!m) return null;
  return m.length === 3 ? { path: m[1], line: Number(m[2]) } : { path: project.cart.main ?? "", line: Number(m[1]) };
}

function showError(msg: string) {
  lastError = msg;
  const el = $("console-error");
  el.textContent = msg ? `⚠ ${msg}` : "";
  const at = msg ? errorPlace(msg) : null;
  code.setError(at && at.path in project.scripts ? at : null);
  if (msg) setStatus(msg, true);
}

$("console-error").onclick = () => {
  const at = errorPlace(lastError);
  if (at && at.path in project.scripts) openScript(at.path, at.line);
};
$("console-clear").onclick = () => {
  consoleLog.textContent = "";
};

async function pollPlayer() {
  if (!isTauri) return;
  const out = await playerOutput(logOffset);
  if (!out) return;
  if (out.offset < logOffset) logOffset = 0;
  if (out.log) {
    consoleLog.textContent += out.log;
    if (consoleLog.textContent.length > 60000) consoleLog.textContent = consoleLog.textContent.slice(-40000);
    consoleLog.scrollTop = consoleLog.scrollHeight;
  }
  logOffset = out.offset;
  if (out.error !== lastError) showError(out.error);
}

// ------------------------------------------------------------------ sprites, scripts

function openSprite(name: string) {
  showTab("pixel");
  selectSprite(name);
}

function openScript(path: string, line?: number) {
  if (!(path in project.scripts)) return;
  showTab("code");
  code.show(path, project.scripts[path], line);
  renderExplorer();
}

function selectSprite(name: string | null, frame = 0) {
  currentSprite = name;
  const s = name ? project.get(name) ?? null : null;
  editor.setSprite(s, frame);
  editor.clearHistory();
  panels.refresh();
  renderExplorer();
}

/** Pixel edits: refresh thumbnails, push to the running game (at most once per animation frame). */
let syncQueued = false;
function syncSprite() {
  if (syncQueued) return;
  syncQueued = true;
  requestAnimationFrame(() => {
    syncQueued = false;
    const s = editor.sprite;
    if (!s) return;
    panels.refreshThumbs();
    mapEditor.invalidate(s.name);
    markFile(spritePath(s.name));
    scheduleNativeSync();
  });
}

function newSprite(dir = "sprites") {
  const v = prompt("New sprite size (width x height)", "16x16");
  const m = v?.match(/(\d+)\s*[x×*, ]\s*(\d+)/);
  if (!m) return;
  const w = Math.min(512, +m[1]), h = Math.min(512, +m[2]);
  const s = project.addSprite("sprite", [new ImageData(w, h)], 8, dir);
  markFile(spritePath(s.name));
  openSprite(s.name);
  renamePath(spritePath(s.name));
}

stamp.onStampFrame = (name, img) => {
  const s = project.get(name);
  if (!s) return;
  // fit into the sprite's frame size: shrink (nearest) if bigger, then center
  let fit = img;
  if (img.width > s.w || img.height > s.h) {
    const k = Math.min(s.w / img.width, s.h / img.height);
    fit = resample(img, Math.max(1, Math.round(img.width * k)), Math.max(1, Math.round(img.height * k)));
  }
  fit = canvasSize(fit, s.w, s.h, Math.floor((s.w - fit.width) / 2), Math.floor((s.h - fit.height) / 2));
  s.insertFrame(s.frameCount);
  s.layers[0].cels[s.frameCount - 1] = fit;
  selectSprite(s.name, s.frameCount - 1);
  mapEditor.invalidate(s.name);
  markFile(spritePath(s.name));
  scheduleNativeSync();
  setStatus(`Added frame ${s.frameCount} to "${s.name}"${img.width !== s.w || img.height !== s.h ? ` (fitted from ${img.width}×${img.height})` : ""}`);
};

stamp.onStamp = (name, img) => {
  const s = project.addSprite(name, [img]);
  markFile(spritePath(s.name));
  openSprite(s.name);
  scheduleNativeSync();
  setStatus(`Stamped "${s.name}" ${img.width}×${img.height} · use it in code: spr('${s.name}', x, y)`);
};

// ------------------------------------------------------------------ UI wiring

function showTab(tab: string) {
  for (const b of document.querySelectorAll<HTMLElement>(".tabs button")) b.classList.toggle("active", b.dataset.tab === tab);
  for (const t of document.querySelectorAll(".tab")) t.classList.toggle("active", t.id === `tab-${tab}`);
  if (tab === "pixel") editor.render();
  if (tab === "map") mapEditor.refresh();
  if (tab === "code" && !code.active) {
    const main = project?.cart.main ?? "";
    if (main in (project?.scripts ?? {})) code.show(main, project.scripts[main]);
  }
  renderExplorer();
}

for (const b of document.querySelectorAll<HTMLElement>(".tabs button")) b.onclick = () => showTab(b.dataset.tab!);

editor.onChange = syncSprite;
$("btn-new-sprite").onclick = () => newSprite();
$("btn-stamp").onclick = () => {
  stamp.setTargets(project.sprites.map((s) => ({ name: s.name, w: s.w, h: s.h, frames: s.frameCount })));
  stamp.open();
};
$("btn-play").onclick = togglePlay;
$("btn-restart").onclick = restart;
$("btn-save").onclick = () => void save();
$<HTMLSelectElement>("file-menu").onchange = async (e) => {
  const sel = e.target as HTMLSelectElement;
  const v = sel.value;
  sel.value = "";
  if (v === "new" || v.startsWith("new:")) await newProject(v.slice(4));
  else if (v === "open") await openFolder();
  else if (v === "save-as") await saveAs();
  else if (v === "updates") await checkForUpdates(true);
  else if (v === "import") {
    const cart = await pickCartFile($("open-input"));
    if (cart) await openCart(cart);
  }
};
$<HTMLSelectElement>("export").onchange = async (e) => {
  const sel = e.target as HTMLSelectElement;
  const target = sel.value;
  sel.value = "";
  project.cart.name = $<HTMLInputElement>("cart-name").value.trim() || "untitled";
  try {
    if (target === "windows") {
      if (!isTauri) return setStatus("Windows export is available in the Slate desktop app", true);
      const r = await exportWindows(project.toCart());
      if (r) setStatus(`Exported ${r.path} (${(r.bytes / 1024 / 1024).toFixed(1)} MB) - a standalone Windows game`);
    } else if (target === "web") {
      if (!isTauri) return setStatus("Web export is available in the Slate desktop app (or: npm run cart -- <folder> --web)", true);
      const r = await exportWeb(project.toCart());
      if (r) setStatus(`Exported ${r.path} (${(r.bytes / 1024 / 1024).toFixed(1)} MB) - upload it to itch.io as an HTML game (viewport = your resolution × 3)`);
    } else if (target === "slate") {
      const path = await saveCart(project.toFullCart());
      if (path) setStatus(`Saved ${path} (the whole project in one file)`);
    }
  } catch (err) {
    setStatus(String(err), true);
  }
};
$<HTMLSelectElement>("examples").onchange = async (e) => {
  const sel = e.target as HTMLSelectElement;
  const id = sel.value;
  sel.value = "";
  if (!id) return;
  if (dirty.size && !confirm("Open the example? Unsaved changes in the current project will be lost.")) return;
  await openCart(example(id));
};
$<HTMLInputElement>("cart-name").onchange = (e) => {
  project.cart.name = (e.target as HTMLInputElement).value.trim() || "untitled";
  document.title = `${project.cart.name} · Slate`;
  markFile("slate.json");
};

const typing = () => {
  const el = document.activeElement;
  return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type !== "checkbox" && el.type !== "range") || !!el?.closest(".cm-editor");
};

window.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === "Enter") { e.preventDefault(); void restart(); return; }
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); return; }
  if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); void openFolder(); return; }
  if (stamp.isOpen) { if (e.key === "Escape") stamp.close(); return; }
  if (!$("plugins-dialog").classList.contains("hidden")) { if (e.key === "Escape") $("plugins-dialog").classList.add("hidden"); return; }
  if (e.key === "Escape") explorer.hideMenu();
  if (typing()) return;
  if (panels.dialogOpen) { panels.handleKey(e); return; }
  if (e.code === "Space") { e.preventDefault(); void togglePlay(); return; }
  if ($("tab-map").classList.contains("active")) {
    if (mapEditor.handleKey(e)) e.preventDefault();
    return;
  }
  if (!$("tab-pixel").classList.contains("active")) return;
  if (panels.handleKey(e)) e.preventDefault();
});

// Paste an image anywhere -> Grid Stamp
window.addEventListener("paste", (e) => {
  if (typing()) return;
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
  const f = item?.getAsFile();
  if (f) { e.preventDefault(); void stamp.loadBlob(f, "pasted"); }
});
// Drop files: images -> Grid Stamp, .slate -> open, the rest -> import into the project
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  if (stamp.isOpen) return;
  e.preventDefault();
  const files = [...(e.dataTransfer?.files ?? [])];
  if (files.length === 1 && files[0].type.startsWith("image/") && !(e.target as HTMLElement).closest?.(".sidebar")) {
    void stamp.loadBlob(files[0], files[0].name);
    return;
  }
  for (const f of files) {
    if (f.name.endsWith(".slate")) void f.text().then((t) => openCart(JSON.parse(t)));
    else void importFile(f, "");
  }
});
window.addEventListener("beforeunload", (e) => {
  if (!folder) project?.autosave();
  else if (dirty.size) e.preventDefault();
});
// the game window: notice when it closes, collect its log and errors
setInterval(async () => {
  if (!nativeOn) return;
  await pollPlayer();
  if (!(await nativeRunning())) {
    nativeOn = false;
    updatePlayButton();
  }
}, 500);

async function start() {
  const last = isTauri ? localStorage.getItem(LAST_FOLDER) : null;
  if (last) {
    try {
      const f = await openFolderPath(last);
      if (f) {
        const { files, dirs } = await f.read();
        return openProject(await Project.fromFiles(files, dirs), f);
      }
    } catch {
      // the folder moved or is broken: fall back to the autosave / example
    }
  }
  const restored = Project.restore();
  await openCart(restored ?? example("jelly"));
}
void start();

// ------------------------------------------------------------------ plugins

const plugins = new PluginHost();
plugins.onChange = () => {
  stamp.refreshAI();
  renderPlugins();
};
stamp.attachPlugins(plugins);
void plugins.loadAll();

function renderPlugins() {
  const list = $("plugin-list");
  list.innerHTML = "";
  if (plugins.plugins.size === 0) {
    list.innerHTML =
      '<div class="empty">No plugins installed.<br />Plugins add optional features like AI sprite generation (Slate Image).<br />' +
      'Use "Install from folder…" and pick a folder that contains plugin.json.</div>';
    return;
  }
  for (const { manifest: m, enabled } of plugins.plugins.values()) {
    const el = document.createElement("div");
    el.className = "plugin";
    el.innerHTML =
      '<div class="plugin-head"><b></b><span class="ver"></span><div class="spacer"></div>' +
      '<label class="check"><input type="checkbox" /> Enabled</label></div>' +
      '<div class="plugin-desc"></div><div class="plugin-notice"></div><div class="plugin-perm"></div><div class="plugin-settings"></div>';
    el.querySelector("b")!.textContent = m.name;
    el.querySelector(".ver")!.textContent = `v${m.version} · ${m.id}`;
    el.querySelector(".plugin-desc")!.textContent = m.description ?? "";
    el.querySelector(".plugin-notice")!.textContent = m.notice ?? "";
    const hosts = m.permissions?.network ?? [];
    el.querySelector(".plugin-perm")!.textContent = hosts.length ? `Network: ${hosts.join(", ")}` : "No network access";
    const cb = el.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    cb.checked = enabled;
    cb.onchange = () => plugins.setEnabled(m.id, cb.checked);
    const box = el.querySelector(".plugin-settings")!;
    const values = settingsOf(m);
    for (const [key, def] of Object.entries(m.settings ?? {})) {
      const label = document.createElement("label");
      label.textContent = def.label ?? key;
      const input = document.createElement("input");
      input.value = values[key] ?? def.default;
      input.spellcheck = false;
      input.onchange = () => {
        saveSettings(m.id, { ...settingsOf(m), [key]: input.value });
        plugins.setEnabled(m.id, cb.checked); // reload with the new settings
      };
      box.append(label, input);
    }
    list.appendChild(el);
  }
}

$("btn-plugins").onclick = async () => {
  renderPlugins();
  $("plugins-dialog").classList.remove("hidden");
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    $("plugin-folder").textContent = `Folder: ${await invoke<string>("plugins_folder")}`;
  } else {
    $("plugin-install").classList.add("hidden");
    $("plugin-folder").textContent = "Browser mode: plugins load from the repo's plugins/ folder";
  }
};
$("plugins-close").onclick = () => $("plugins-dialog").classList.add("hidden");
$("plugin-install").onclick = async () => {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const dir = await open({ directory: true, title: "Choose a plugin folder (with plugin.json)" });
  if (!dir || Array.isArray(dir)) return;
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    const id = await invoke<string>("install_plugin", { src: dir });
    await plugins.reloadAll();
    setStatus(`Installed plugin "${id}"`);
  } catch (err) {
    setStatus(String(err), true);
  }
};

if (import.meta.env.DEV) {
  // dev / automation hooks (trailer capture, tests)
  Object.assign(window, { slate: { stamp, editor, panels, mapEditor, code, explorer, openCart, openScript, selectSprite, showTab, renderExplorer, get project() { return project; } } });
}

void initUpdater({
  dirty: () => dirty.size > 0,
  save: async () => {
    await save();
    return dirty.size === 0;
  },
  status: (m, e) => setStatus(m, e),
});
