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
import { MusicDialog } from "./music-dialog.ts";
import { PluginHost, saveSettings, settingsOf } from "./plugins.ts";
import { enhanceSelects } from "./dropdown.ts";
import { checkForUpdates, initUpdater } from "./updater.ts";
import { closeMenus, fillRanges, MenuBar, type MenuItem } from "./menu.ts";
import { ask, codeName, confirmBox, form } from "./modal.ts";
import { Welcome } from "./welcome.ts";
import { GameView } from "./game-view.ts";
import { desktopFeel } from "./desktop-feel.ts";
import { tooltips } from "./tooltip.ts";
import { readAseprite } from "./aseprite.ts";
import { ParticleDialog } from "./particle-dialog.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const LAST_FOLDER = "slate:lastFolder";
const RECENT = "slate:recent";
const RUN_IN = "slate:runIn";
/** the docs in the user's language (Korean or English) */
const docUrl = (name: string) => `https://github.com/Erzyh/slate-engine/blob/main/docs/${navigator.language.startsWith("ko") ? "ko" : "en"}/${name}.md`;
const VERSION = __SLATE_VERSION__;

desktopFeel();
tooltips();
enhanceSelects();
fillRanges();
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
  setStatus(`Saved ${dir}/${name}.wav · play it in code with sfx("${name}")`);
};
const musicDialog = new MusicDialog();
musicDialog.exists = (name) => !!project.cart.music?.[name];
musicDialog.onSave = (dir, name, wav) => {
  project.addAudio("music", name, wav, "wav", dir);
  markFile(`${dir}/${name}.wav`);
  scheduleNativeSync();
  setStatus(`Saved ${dir}/${name}.wav · play it in code with music("${name}")`);
};
let preview: HTMLAudioElement | null = null;
const particleDialog = new ParticleDialog({
  presets: () => (project.cart.particles ??= {}),
  changed: () => {
    markFile("slate.json");
    scheduleNativeSync();
  },
});
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
  templatesChanged: () => {
    markFile("slate.json");
    scheduleNativeSync();
  },
  playFrom: (map, x, y) => {
    playtest = { map, x, y };
    void useGameView().then((view) => startGame(view ? "view" : "window"));
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
  info: (msg) => ($("status-info").textContent = msg),
  saveBinary,
  saveText,
  addSprite: (name, frames) => {
    const s = project.addSprite(name, frames);
    markFile(spritePath(s.name));
    openSprite(s.name);
  },
  paletteChanged: (colors) => {
    project.cart.palette = colors;
    markFile("slate.json");
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
  names: (kind) =>
    kind === "sprites" ? project.sprites.map((s) => s.name)
    : kind === "maps" ? project.maps.map((m) => m.name)
    : kind === "sounds" ? Object.keys(project.cart.sounds ?? {})
    : kind === "music" ? Object.keys(project.cart.music ?? {})
    : Object.keys(project.cart.particles ?? {}),
});
code.onSwitch = (path) => openScript(path);
const statusEl = $("status");
const gameView = new GameView({
  log: (line) => appendLog(line + "\n"),
  error: (text) => showError(text),
  save: (name, bytes, ext, label) => void saveBinary(`${project.cart.name}-${name}`, bytes, ext, label).then((p) => p && setStatus(`Saved ${p}`)),
  status: (msg) => setStatus(msg),
});
/** where Play runs the game: the Game view inside the editor, or a separate window */
const runIn = () => (localStorage.getItem(RUN_IN) === "window" ? "window" : "view");

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
  newScript: (dir) => void newScript(dir),
  newSprite: (dir) => void newSprite(dir),
  newMap: () => {
    showTab("map");
    $("map-new").click();
  },
  newSound: (dir) => sfxDialog.open(dir),
  newMusic: (dir) => musicDialog.open(dir),
  playAudio: (path) => {
    const top = path.split("/")[0] as "music" | "sounds";
    const url = (top === "music" ? project.cart.music : project.cart.sounds)?.[baseName(path)];
    preview?.pause();
    if (!url || preview?.dataset.path === path) return void (preview = null);
    preview = new Audio(url);
    preview.dataset.path = path;
    preview.onended = () => (preview = null);
    void preview.play();
    setStatus(`Playing ${path} · click it again to stop`);
  },
  newFolder: (parent) => void newFolder(parent),
  importFiles: (dir) => {
    importTarget = dir;
    $<HTMLInputElement>("import-input").click();
  },
  rename: (path) => void renamePath(path),
  remove: (path) => void removePath(path),
  removeFolder: (dir) => void removeFolder(dir),
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

async function newScript(dir: string) {
  const name = await ask("New script", "untitled", {
    message: `Created in ${dir}/. Load it from another script with require("${dir.replace(/^scripts\/?/, "") ? dir.replace(/^scripts\//, "") + "/" : ""}name").`,
    clean: (v) => v.replace(/[^\w/-]/g, "_"),
    ok: "Create",
  });
  if (!name) return;
  const path = project.addScript(`${dir}/${name.replace(/\.luau$/, "")}.luau`, `-- ${name}\nlocal M = {}\n\nreturn M\n`);
  markFile(path);
  openScript(path);
}

async function newFolder(parent: string) {
  const name = await ask("New folder", "", { message: `Inside ${parent}/`, clean: codeName, ok: "Create" });
  if (!name) return;
  project.folders.add(`${parent}/${name}`);
  explorer.collapsed.delete(parent);
  renderExplorer();
  markFile(`${parent}/${name}/`);
}

async function removePath(path: string) {
  const ok = await confirmBox(`Delete ${baseName(path)}?`, folder ? "It moves to the project's .slate-trash folder when you save." : path, { ok: "Delete", danger: true });
  if (!ok) return;
  project.deletePath(path);
  if (path.startsWith("sprites/") && currentSprite === baseName(path)) selectSprite(project.sprites[0]?.name ?? null);
  if (path.startsWith("maps/")) mapEditor.setProject(project);
  code.sync((p) => p in project.scripts);
  markFile(path);
  scheduleNativeSync();
}

async function removeFolder(dir: string) {
  const n = project.paths().filter((p) => p.startsWith(dir + "/")).length;
  if (!(await confirmBox(`Delete the folder ${dir.slice(dir.lastIndexOf("/") + 1)}?`, `${dir}/ and the ${n} file(s) in it.`, { ok: "Delete", danger: true }))) return;
  project.deleteFolder(dir);
  selectSprite(project.get(currentSprite ?? "") ? currentSprite : project.sprites[0]?.name ?? null);
  mapEditor.setProject(project);
  code.sync((p) => p in project.scripts);
  markFile(dir + "/");
  scheduleNativeSync();
}

function renderExplorer() {
  if (!project) return;
  explorer.render(
    project,
    { script: $("tab-code").classList.contains("active") ? code.active : null, sprite: $("tab-pixel").classList.contains("active") ? currentSprite : null, map: $("tab-map").classList.contains("active") ? mapEditor.map?.name ?? null : null },
    dirty,
    project.cart.main ?? "",
  );
  const name = project.cart.title || project.cart.name;
  $("project-label").textContent = folder ? folder.label.split(/[\\/]/).pop() ?? folder.label : name;
  $("project-label").title = folder ? folder.label : "Not saved to a folder yet";
  $("project-title").textContent = name;
  $("project-title").title = "Project settings";
  const st = $("save-state");
  st.textContent = !folder ? "Not saved" : dirty.size ? "Unsaved changes" : "Saved";
  st.classList.toggle("dirty", !folder || dirty.size > 0);
}

async function renamePath(path: string) {
  const isFolder = !project.paths().includes(path);
  const top = path.split("/")[0];
  const leaf = path.slice(path.lastIndexOf("/") + 1);
  const ext = isFolder || top === "scripts" ? "" : leaf.slice(leaf.lastIndexOf("."));
  const answer = await ask(isFolder ? "Rename folder" : "Rename", isFolder || top === "scripts" ? leaf : baseName(path), {
    message: top === "sprites" && !isFolder ? `Code that uses spr("${baseName(path)}") must use the new name too.` : undefined,
    clean: (v) => v.replace(/[^\w.-]/g, "_"),
    ok: "Rename",
  });
  if (!answer || answer === leaf) return;
  const dir = path.slice(0, path.lastIndexOf("/"));
  const clean = answer;
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
  if (gameRunning()) await stopGame();
  project = p;
  folder = where;
  dirty.clear();
  project.on(() => renderExplorer());
  document.title = `${p.cart.title || p.cart.name} · Slate`;
  if (where && isTauri) {
    localStorage.setItem(LAST_FOLDER, where.label);
    rememberRecent(where.label, p.cart.title || p.cart.name);
  }
  saved = where ? fingerprints(p.toFiles()) : new Map();
  applied = { scripts: { ...p.scripts }, main: p.cart.main ?? "" };
  code.reset();
  panels.setProjectPalette(p.cart.palette ?? []);
  currentSprite = p.sprites[0]?.name ?? null;
  selectSprite(currentSprite);
  mapEditor.setProject(p);
  const main = p.cart.main ?? "";
  if (main in p.scripts) code.show(main, p.scripts[main]);
  renderExplorer();
  welcome.hide();
  setStatus(`Opened ${where ? where.label : p.cart.title || p.cart.name}`);
}

async function openCart(cart: Cartridge) {
  await openProject(await Project.load(structuredClone(cart)), null);
}

function fingerprints(files: Map<string, Uint8Array>) {
  return new Map([...files].map(([p, b]) => [p, fingerprint(b)]));
}

/** Ask before throwing away unsaved work. */
async function okToLeave(what: string) {
  if (!dirty.size) return true;
  return confirmBox("Discard unsaved changes?", `${what} The changes in the current project haven't been saved.`, { ok: "Discard", danger: true });
}

async function openFolder() {
  if (!(await okToLeave("Opening another project closes this one."))) return;
  try {
    const f = await pickFolder("open");
    if (!f) return;
    await openFolderAt(f);
  } catch (e) {
    setStatus(String(e), true);
  }
}

async function openFolderAt(f: ProjectFolder) {
  const { files, dirs } = await f.read();
  await openProject(await Project.fromFiles(files, dirs), f);
}

async function writeTo(f: ProjectFolder, all: boolean) {
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
    setStatus(r.written || r.removed ? `Saved ${r.written} file(s)${r.removed ? `, moved ${r.removed} deleted file(s) to .slate-trash` : ""}` : "Nothing to save");
  } catch (e) {
    setStatus(`Couldn't save: ${e}`, true);
  }
}

async function saveAs() {
  try {
    const f = await pickFolder("save");
    if (!f) return;
    folder = f;
    if (isTauri) {
      localStorage.setItem(LAST_FOLDER, f.label);
      rememberRecent(f.label, project.cart.title || project.cart.name);
    }
    const r = await writeTo(f, true);
    setStatus(`Saved the project to ${f.label} (${r.written} files)`);
  } catch (e) {
    setStatus(String(e), true);
  }
}

async function newProject(from = "") {
  if (!(await okToLeave("A new project replaces this one."))) return;
  const name = await ask("New project", "my-game", {
    message: from ? `From the ${from} template. Choose its folder when you save.` : "An empty project. Choose its folder when you save.",
    clean: (v) => v.replace(/[^\w-]/g, "-"),
    ok: "Create",
  });
  if (!name) return;
  const base = from ? template(from) : null;
  const cart: Cartridge = base
    ? { ...base, name, title: name }
    : {
        slate: 1, name, title: name, resolution: [320, 180], background: "#1a1c2c", sprites: [], maps: [], code: "", lang: "luau",
        scripts: { "scripts/main.luau": STARTER_MAIN }, main: "scripts/main.luau", music: {}, sounds: {},
      };
  await openProject(await Project.load(cart), null);
  setStatus(`New project "${name}" · File > Save as to choose its folder`);
}

async function openExample(id: string) {
  if (!(await okToLeave("Opening an example replaces this project."))) return;
  await openCart(example(id));
}

async function importCart() {
  const cart = await pickCartFile($("open-input"));
  if (cart) await openCart(cart);
}

async function exportGame(target: "windows" | "web" | "slate") {
  try {
    if (target === "windows") {
      if (!isTauri) return setStatus("Windows export works in the Slate desktop app", true);
      const r = await exportWindows(project.toCart());
      if (r) setStatus(`Exported ${r.path} (${(r.bytes / 1024 / 1024).toFixed(1)} MB) · a standalone Windows game`);
    } else if (target === "web") {
      if (!isTauri) return setStatus("Web export works in the Slate desktop app", true);
      const r = await exportWeb(project.toCart());
      if (r) setStatus(`Exported ${r.path} (${(r.bytes / 1024 / 1024).toFixed(1)} MB) · upload it to itch.io as an HTML game`);
    } else {
      const path = await saveCart(project.toFullCart());
      if (path) setStatus(`Saved ${path} · the whole project in one file`);
    }
  } catch (err) {
    setStatus(String(err), true);
  }
}

/** Name, window title, resolution, background, fullscreen. */
async function projectSettings() {
  const c = project.cart;
  const r = await form({
    title: "Project settings",
    ok: "Save",
    fields: [
      { key: "title", label: "Game title", value: c.title ?? c.name, hint: "Shown in the window title and as the .exe name" },
      { key: "name", label: "Save name", value: c.name, clean: (v) => v.replace(/[^\w-]/g, "-"), hint: "Folder for save() data · letters, digits, - and _" },
      { key: "w", label: "Width (pixels)", type: "number", value: c.resolution[0], min: 16, max: 1920, half: true },
      { key: "h", label: "Height (pixels)", type: "number", value: c.resolution[1], min: 16, max: 1080, half: true },
      { key: "bg", label: "Background", type: "color", value: c.background ?? "#000000" },
      { key: "fs", label: "Start in fullscreen", type: "checkbox", value: !!c.fullscreen },
    ],
    validate: (v) => (!v.name ? "Enter a save name" : Number(v.w) < 16 || Number(v.h) < 16 ? "The game needs at least 16 × 16 pixels" : null),
  });
  if (!r) return;
  c.title = String(r.title) || String(r.name);
  c.name = String(r.name);
  c.resolution = [Math.round(Number(r.w)), Math.round(Number(r.h))];
  c.background = String(r.bg);
  c.fullscreen = !!r.fs || undefined;
  document.title = `${c.title} · Slate`;
  markFile("slate.json");
  scheduleNativeSync();
}

let importTarget = "";
$<HTMLInputElement>("import-input").onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const list = [...(input.files ?? [])];
  input.value = "";
  for (const f of list) await importFile(f, importTarget);
};

/** Add a file from disk: .luau -> scripts, .png / .aseprite -> sprite, .ogg/.wav -> music or sounds, .json -> map. */
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
  } else if (ext === "aseprite" || ext === "ase") {
    try {
      const a = await readAseprite(bytes.buffer as ArrayBuffer);
      const s = project.addSprite(name, a.layers[0].cels, 8, top === "sprites" ? dir : "sprites");
      s.layers = a.layers;
      s.tags = a.tags;
      s.durations = a.durations;
      markFile(spritePath(s.name));
      openSprite(s.name);
      setStatus(`Imported ${f.name}: ${a.layers.length} layer${a.layers.length > 1 ? "s" : ""}, ${s.frameCount} frame${s.frameCount > 1 ? "s" : ""}${a.tags.length ? `, tags ${a.tags.map((t) => t.name).join(", ")}` : ""}`);
    } catch (err) {
      setStatus(`Couldn't read ${f.name}: ${(err as Error).message}`, true);
    }
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
  } else setStatus(`Can't import ${f.name} · use .luau, .png, .ogg, .wav or a map .json`, true);
  renderExplorer();
  scheduleNativeSync();
}

// ------------------------------------------------------------------ recent projects

function recentList(): { path: string; name: string }[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT) ?? "[]");
  } catch {
    return [];
  }
}

function rememberRecent(path: string, name: string) {
  const list = [{ path, name }, ...recentList().filter((r) => r.path !== path)].slice(0, 8);
  localStorage.setItem(RECENT, JSON.stringify(list));
}

// ------------------------------------------------------------------ game

/** Cartridge for the native player. Script edits apply on Restart (Ctrl+Enter), not on every keystroke. */
/** "Play from here": where the game should start (until the next plain Play) */
let playtest: Cartridge["playtest"] | null = null;
/** map objects a game may place its player from */
const SPAWN = /^(player|start|spawn|hero)$/i;

function nativeCart(): Cartridge {
  const cart: Cartridge = { ...project.toCart(), scripts: applied.scripts, main: applied.main };
  const pt = playtest;
  if (pt) {
    cart.playtest = pt;
    // games that place their player from a map object start there too, without any code
    cart.maps = cart.maps?.map((m) => (m.name !== pt.map ? m : { ...m, objects: m.objects?.map((o) => (SPAWN.test(o.type) ? { ...o, x: pt.x, y: pt.y } : o)) }));
  }
  return cart;
}

const cartBytes = () => new TextEncoder().encode(JSON.stringify(nativeCart()));

/** sprite / map / settings edits reach the running game (code waits for Restart) */
let nativeSyncTimer = 0;
function scheduleNativeSync() {
  if (!nativeOn && !gameView.running) return;
  clearTimeout(nativeSyncTimer);
  nativeSyncTimer = window.setTimeout(async () => {
    if (gameView.running) gameView.update(cartBytes());
    if (nativeOn) nativeOn = await updateNative(nativeCart());
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
    if (!folder) project.autosave();
  }, 1000);
}

function setStatus(msg: string, error = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", error);
}

const gameRunning = () => nativeOn || gameView.running;

async function useGameView() {
  return runIn() === "view" && (await gameView.check());
}

async function startGame(where: "view" | "window") {
  applied = { scripts: { ...project.scripts }, main: project.cart.main ?? "" };
  clearConsole();
  if (where === "view") {
    gameView.start(cartBytes());
    setStatus("Running in the Game view · sprite and map edits show up live · Ctrl+Enter restarts with new code");
  } else if (isTauri) {
    if (nativeOn) await stopNative();
    await runNative(nativeCart());
    nativeOn = true;
    setStatus("Running in a window · sprite and map edits show up live · Ctrl+Enter restarts with new code");
  } else {
    setStatus("Running in a separate window needs the Slate desktop app", true);
  }
  updatePlayButton();
}

async function stopGame() {
  if (gameView.running) gameView.stop();
  if (nativeOn) {
    await stopNative();
    nativeOn = false;
  }
  updatePlayButton();
}

async function togglePlay() {
  if (gameRunning()) return stopGame();
  playtest = null;
  await startGame((await useGameView()) ? "view" : "window");
}

/** restart with the latest code, where the game is running (or where Play would run it) */
async function restart() {
  if (gameView.running) return startGame("view");
  if (nativeOn) return startGame("window");
  await startGame((await useGameView()) ? "view" : "window");
}

function updatePlayButton() {
  const on = gameRunning();
  const b = $("btn-play");
  b.innerHTML = on ? '<svg><use href="#i-stop" /></svg><span>Stop</span>' : '<svg><use href="#i-play" /></svg><span>Play</span>';
  b.title = on ? "Stop (Space)" : "Play (Space)";
  b.classList.toggle("running", on);
  $("game-state").textContent = gameView.running ? "running" : "";
}

$("game-restart").onclick = () => void restart();
$("game-window").onclick = async () => {
  if (!isTauri) return setStatus("Running in a separate window needs the Slate desktop app", true);
  gameView.stop();
  gameView.show(false);
  await startGame("window");
};
$("game-close").onclick = () => {
  gameView.stop();
  gameView.show(false);
  updatePlayButton();
};

// ------------------------------------------------------------------ console (log() output and errors from the game)

let logOffset = 0;
let lastError = "";
const consoleLog = $("console-log");

function appendLog(text: string) {
  consoleLog.textContent += text;
  if (consoleLog.textContent.length > 60000) consoleLog.textContent = consoleLog.textContent.slice(-40000);
  consoleLog.scrollTop = consoleLog.scrollHeight;
}

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
  el.textContent = msg;
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
  if (out.log) appendLog(out.log);
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

async function newSprite(dir = "sprites") {
  const r = await form({
    title: "New sprite",
    ok: "Create",
    fields: [
      { key: "name", label: "Name", value: "sprite", clean: codeName, hint: 'Used in code: spr("name", x, y)' },
      { key: "w", label: "Width", type: "number", value: 16, min: 1, max: 512, half: true },
      { key: "h", label: "Height", type: "number", value: 16, min: 1, max: 512, half: true },
    ],
    validate: (v) => (!v.name ? "Enter a name" : project.get(String(v.name)) ? `There is already a sprite named "${v.name}"` : Number(v.w) < 1 || Number(v.h) < 1 || Number(v.w) > 512 || Number(v.h) > 512 ? "Size: 1 to 512 pixels" : null),
  });
  if (!r) return;
  const s = project.addSprite(String(r.name), [new ImageData(Math.round(Number(r.w)), Math.round(Number(r.h)))], 8, dir);
  markFile(spritePath(s.name));
  openSprite(s.name);
}

function openStamp() {
  stamp.setTargets(project.sprites.map((s) => ({ name: s.name, w: s.w, h: s.h, frames: s.frameCount })));
  stamp.open();
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
  setStatus(`Stamped "${s.name}" ${img.width}×${img.height} · use it in code: spr("${s.name}", x, y)`);
};

// ------------------------------------------------------------------ menus

const tabIs = (t: string) => $(`tab-${t}`).classList.contains("active");

new MenuBar($("menubar"), [
  {
    label: "File",
    items: () => [
      { label: "Start screen", action: () => welcome.show() },
      "-",
      { label: "New project", action: () => void newProject() },
      { header: "New from template" },
      { label: "Platformer", action: () => void newProject("platformer") },
      { label: "Top-down", action: () => void newProject("topdown") },
      { label: "Shooter", action: () => void newProject("shmup") },
      "-",
      { label: "Open folder", key: "Ctrl+O", action: () => void openFolder() },
      { label: "Save", key: "Ctrl+S", action: () => void save() },
      { label: "Save as", action: () => void saveAs() },
      { label: "Import cartridge (.slate)", action: () => void importCart() },
      "-",
      { header: "Export" },
      { label: "Windows game (.exe)", action: () => void exportGame("windows") },
      { label: "Web game for itch.io (.zip)", action: () => void exportGame("web") },
      { label: "Cartridge (.slate)", action: () => void exportGame("slate") },
      "-",
      { header: "Examples" },
      { label: "Jelly Jump", action: () => void openExample("jelly") },
      { label: "Star Barrage", action: () => void openExample("star-barrage") },
    ],
  },
  {
    label: "Edit",
    items: () => [
      { label: "Undo", key: "Ctrl+Z", action: () => panels.command("undo"), disabled: !tabIs("pixel") },
      { label: "Redo", key: "Ctrl+Shift+Z", action: () => panels.command("redo"), disabled: !tabIs("pixel") },
      "-",
      { label: "Cut", key: "Ctrl+X", action: () => panels.command("cut"), disabled: !tabIs("pixel") },
      { label: "Copy", key: "Ctrl+C", action: () => panels.command("copy"), disabled: !tabIs("pixel") },
      { label: "Paste", key: "Ctrl+V", action: () => panels.command("paste"), disabled: !tabIs("pixel") },
      "-",
      { label: "Select all", key: "Ctrl+A", action: () => panels.command("select-all"), disabled: !tabIs("pixel") },
      { label: "Deselect", key: "Ctrl+D", action: () => panels.command("deselect"), disabled: !tabIs("pixel") },
      { label: "Invert selection", key: "Ctrl+Shift+I", action: () => panels.command("invert-selection"), disabled: !tabIs("pixel") },
      { label: "Fill selection", key: "Alt+Backspace", action: () => panels.command("fill-selection"), disabled: !tabIs("pixel") },
    ],
  },
  {
    label: "Sprite",
    items: () => {
      const has = !!editor.sprite;
      const op = (label: string, id: string): MenuItem => ({ label, action: () => { showTab("pixel"); panels.imageOp(id); }, disabled: !has });
      return [
        { label: "New sprite", action: () => void newSprite() },
        { label: "Import image with Grid Stamp", action: openStamp },
        { label: "Import sprite sheet", action: () => void panels.sheetOp("import-sheet") },
        { label: "Import Aseprite file", action: () => { importTarget = "sprites"; $<HTMLInputElement>("import-input").click(); } },
        "-",
        op("Flip horizontal", "flip-h"),
        op("Flip vertical", "flip-v"),
        op("Rotate 90° right", "rot-cw"),
        op("Rotate 90° left", "rot-ccw"),
        "-",
        op("Add outline", "outline"),
        op("Add outline with corners", "outline8"),
        op("Replace color", "replace"),
        op("Adjust colors", "adjust"),
        "-",
        op("Scale × 2", "scale2"),
        op("Scale × ½", "scale05"),
        op("Canvas size", "canvas"),
        op("Trim to content", "trim"),
        "-",
        { label: "Export sprite sheet (PNG + JSON)", action: () => void panels.sheetOp("export-sheet"), disabled: !has },
        { label: "Export animated GIF", action: () => void panels.sheetOp("export-gif"), disabled: !has },
      ];
    },
  },
  {
    label: "Project",
    items: () => [
      { label: "Project settings", action: () => void projectSettings() },
      "-",
      { label: "New script", action: () => void newScript("scripts") },
      { label: "New map", action: () => { showTab("map"); $("map-new").click(); } },
      { label: "New sound effect", action: () => sfxDialog.open("sounds") },
      { label: "New music", action: () => musicDialog.open("music") },
      { label: "Particles", action: () => particleDialog.open() },
      { label: "Import files", action: () => { importTarget = ""; $<HTMLInputElement>("import-input").click(); } },
      "-",
      { label: "Plugins", action: () => void openPlugins() },
    ],
  },
  {
    label: "View",
    items: () => [
      { label: "Pixel", key: "1", action: () => showTab("pixel"), checked: tabIs("pixel") },
      { label: "Map", key: "2", action: () => showTab("map"), checked: tabIs("map") },
      { label: "Code", key: "3", action: () => showTab("code"), checked: tabIs("code") },
      "-",
      { label: "Game view", action: () => gameView.show(!gameView.visible), checked: gameView.visible },
      { label: "Play in the Game view", action: () => localStorage.setItem(RUN_IN, runIn() === "view" ? "window" : "view"), checked: runIn() === "view" },
      "-",
      { label: "Grid", action: () => $("grid").click(), checked: editor.grid },
      { label: "Onion skin", action: () => $("onion").click(), checked: editor.onion },
      { label: "Light background", action: () => $("light-bg").click(), checked: editor.lightBg },
      "-",
      { label: "Zoom in", key: "+", action: () => $(tabIs("map") ? "map-zoom-in" : "zoom-in").click() },
      { label: "Zoom out", key: "-", action: () => $(tabIs("map") ? "map-zoom-out" : "zoom-out").click() },
    ],
  },
  {
    label: "Help",
    items: () => [
      { label: "Getting started", action: () => openLink(docUrl("getting-started")) },
      { label: "Game code API", action: () => openLink(docUrl("api")) },
      { label: "Editor guide", action: () => openLink(docUrl("editor")) },
      "-",
      { label: "Check for updates", action: () => void checkForUpdates(true) },
      { label: `About Slate ${VERSION}`, action: () => void confirmBox(`Slate ${VERSION}`, "A pixel game engine. MIT license.\nERXPIXEL font: SIL Open Font License 1.1.", { ok: "Close", cancel: "" }) },
    ],
  },
]);

async function openLink(url: string) {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("open_url", { url }).catch(() => window.open(url, "_blank"));
  } else window.open(url, "_blank");
}

$("project-title").onclick = () => void projectSettings();

// ------------------------------------------------------------------ start screen

const welcome = new Welcome({
  newProject: (t) => void newProject(t),
  openFolder: () => void openFolder(),
  openRecent: async (path) => {
    if (!(await okToLeave("Opening another project closes this one."))) return;
    try {
      const f = await openFolderPath(path);
      if (f) await openFolderAt(f);
    } catch (e) {
      setStatus(`Couldn't open ${path}: ${e}`, true);
    }
  },
  openExample: (id) => void openExample(id),
  recent: () => (isTauri ? recentList() : []),
  version: VERSION,
});

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
  $("status-info").textContent = "";
  renderExplorer();
}

for (const b of document.querySelectorAll<HTMLElement>(".tabs button")) b.onclick = () => showTab(b.dataset.tab!);

editor.onChange = syncSprite;
$("btn-play").onclick = togglePlay;
$("btn-restart").onclick = restart;

const typing = () => {
  const el = document.activeElement;
  return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type !== "checkbox" && el.type !== "range") || !!el?.closest(".cm-editor");
};

window.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === "Enter") { e.preventDefault(); void restart(); return; }
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); return; }
  if (mod && e.key.toLowerCase() === "o") { e.preventDefault(); void openFolder(); return; }
  if (welcome.isOpen) { if (e.key === "Escape") welcome.hide(); return; }
  if (stamp.isOpen) { if (e.key === "Escape") stamp.close(); return; }
  if (particleDialog.isOpen) { if (e.key === "Escape") particleDialog.close(); return; }
  if (sfxDialog.isOpen || musicDialog.isOpen) return;
  if (!$("plugins-dialog").classList.contains("hidden")) { if (e.key === "Escape") $("plugins-dialog").classList.add("hidden"); return; }
  if (e.key === "Escape") { explorer.hideMenu(); closeMenus(); }
  if (typing()) return;
  if (panels.dialogOpen) { panels.handleKey(e); return; }
  if (e.code === "Space") { e.preventDefault(); void togglePlay(); return; }
  if (!mod && (e.key === "1" || e.key === "2" || e.key === "3")) { showTab(["pixel", "map", "code"][Number(e.key) - 1]); return; }
  if (tabIs("map")) {
    if (mapEditor.handleKey(e)) e.preventDefault();
    return;
  }
  if (!tabIs("pixel")) return;
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
      if (f) return await openFolderAt(f);
    } catch {
      // the folder moved or is broken: fall back to the autosave / example
    }
  }
  const restored = Project.restore();
  await openCart(restored ?? example("jelly"));
  // first run (nothing to reopen): show the start screen
  if (!restored) welcome.show();
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
    list.innerHTML = '<div class="empty">No plugins installed.<br />Install one from a folder that contains plugin.json.</div>';
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
    el.querySelector(".ver")!.textContent = `${m.version} · ${m.id}`;
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

async function openPlugins() {
  renderPlugins();
  $("plugins-dialog").classList.remove("hidden");
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    $("plugin-folder").textContent = `Folder: ${await invoke<string>("plugins_folder")}`;
  } else {
    $("plugin-install").classList.add("hidden");
    $("plugin-folder").textContent = "Plugins are installed in the desktop app";
  }
}
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
  Object.assign(window, { slate: { stamp, editor, panels, mapEditor, code, explorer, sfxDialog, musicDialog, welcome, openCart, openScript, selectSprite, showTab, renderExplorer, get project() { return project; } } });
}

void initUpdater({
  dirty: () => dirty.size > 0,
  save: async () => {
    await save();
    return dirty.size === 0;
  },
  status: (m, e) => setStatus(m, e),
});
