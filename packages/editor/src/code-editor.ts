// Code tab: CodeMirror 6 with one tab per open script, Luau highlighting, completion for the
// Slate API and for require("...") paths, and the current error marked on its line.

import { autocompletion, type CompletionContext, type CompletionResult, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, HighlightStyle, indentOnInput, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration, drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type DecorationSet,
} from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

/** The Slate API for completion: name -> signature / help. */
const API: [string, string][] = [
  ["spr", "spr(name, x, y, { frame, anim, scale, sx, sy, rot, ox, oy, flipX, flipY, alpha, tint, add })"],
  ["rect", "rect(x, y, w, h, color)"], ["rectline", "rectline(x, y, w, h, color)"], ["line", "line(x0, y0, x1, y1, color)"],
  ["circ", "circ(x, y, r, color, filled?)"], ["text", "text(s, x, y, color, { align, scale, outline })"], ["textw", "textw(s, scale?, font?)"], ["font", "font(\"erx\" | \"erx_b\" | \"erx_gl\" | \"pico\") -> previous font"],
  ["cls", "cls(color)"], ["camera", "camera(x?, y?)"], ["blend", "blend(\"add\" | nil)"], ["sprite", "sprite(name) -> { w, h, frames, fps, tags, durations }"],
  ["map", "map(name, x, y, { layer, tint })"], ["mget", "mget(map, tx, ty, layer?)"], ["mset", "mset(map, tx, ty, tile, layer?)"],
  ["mapinfo", "mapinfo(map) -> { w, h, tw, th }"], ["msolid", "msolid(map, px, py, bit?)"], ["fget", "fget(tileset, tile, bit?)"],
  ["objects", "objects(map, type?) -> placed objects { id, type, x, y, props... }"],
  ["btn", "btn(action) -- held: left right up down a b x y start select (keyboard + gamepad)"], ["btnp", "btnp(action) -- pressed this frame"],
  ["bind", "bind(action, { \"z\", \"space\", \"pad_a\" })"], ["axis", "axis(\"x\" | \"y\" | \"rx\" | \"ry\" | \"lt\" | \"rt\") -> -1..1"], ["pad", "pad() -> gamepad name or nil"],
  ["fullscreen", "fullscreen(on?) -> is fullscreen (F11 / Alt+Enter too)"],
  ["key", "key(name) -- held"], ["keyp", "keyp(name) -- pressed this frame"], ["hit", "hit(x, y, w, h) -- mouse over"],
  ["mouse", "mouse.x, mouse.y, mouse.down, mouse.pressed, mouse.released, mouse.wheel"],
  ["t", "t() -- seconds since start"], ["now", "now() -- wall clock"], ["rnd", "rnd(a?, b?)"], ["irnd", "irnd(a, b)"],
  ["pick", "pick(list)"], ["clamp", "clamp(v, lo, hi)"], ["lerp", "lerp(a, b, k)"], ["fmt", "fmt(n) -- 1.23K"],
  ["save", "save(key, value)"], ["load", "load(key, fallback)"], ["wipe", "wipe(key)"],
  ["sfx", "sfx(name, volume?) -- sounds/ file or a preset"], ["beep", "beep(freq, dur, wave, vol, slide)"],
  ["music", "music(name, { volume, loop, fade }) / music(nil)"], ["musicname", "musicname()"],
  ["log", "log(...) -- shows in the console"], ["require", "require(\"path/in/scripts\")"],
  ["Anim", "Anim.new(sprite, tag) -- :play(tag, { loop, onEnd }) :update(dt) :draw(x, y, opts) .frame .done"],
  ["Timer", "Timer.after(sec, fn) / Timer.every(sec, fn, count?) / Timer.cancel(h)"],
  ["Tween", "Tween.to(obj, sec, { x = 10 }, { ease, delay, onDone, onUpdate })"], ["Ease", "Ease.outCubic(t) ... linear in/out/inOut Quad Cubic Sine, inBack outBack outElastic outBounce"],
  ["Scene", "Scene.add(name, { enter, leave, update, draw }) / Scene.go(name, args?, { fade, color })"],
  ["Cam", "Cam.follow(x, y, dt, { lerp, bounds = map, lookX, lookY }) Cam.shake(amount, time) Cam.apply() Cam.reset()"],
  ["Physics", "Physics.move(box, dx, dy, map, { solid, oneway }) -> { left, right, up, down } / Physics.grounded / Physics.overlap"],
  ["Dialog", "Dialog.say(text | {pages}, { name, portrait, onDone }) / Dialog.ask(text, {choices}, fn(i)) / Dialog.active() / Dialog.draw()"],
  ["UI", "UI.menu(items):update()/:draw(x, y)  UI.pause.update()/draw()  UI.button(label, x, y, w, h)  UI.bar(x, y, w, h, v, max, color)  UI.toast(msg)"],
  ["wrap", "wrap(text, width, scale?, font?) -> lines"], ["texth", "texth(scale?, font?) -> line height"],
  ["volume", "volume(\"music\" | \"sfx\", v?) -> 0..1"],
  ["Particles", "local fx = Particles.new(); fx:burst(x, y, n, { colors, speed, life, angle, spread, gravity, drag, size }); fx:update(dt); fx:draw()"],
  ["W", "screen width"], ["H", "screen height"],
  ["init", "function init() -- once at start"], ["update", "function update(dt) -- 60 times a second"], ["draw", "function draw()"],
];

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: "#c792ea" },
  { tag: [t.string, t.special(t.string)], color: "#c3e88d" },
  { tag: t.number, color: "#f78c6c" },
  { tag: t.comment, color: "#6c6890", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#82aaff" },
  { tag: t.operator, color: "#89ddff" },
  { tag: [t.bool, t.null, t.atom], color: "#ff9cac" },
  { tag: t.variableName, color: "#e8e2f5" },
  { tag: t.propertyName, color: "#b8b2d8" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", background: "#14151b", color: "#e7e8ee", fontSize: "13px" },
  ".cm-content": { fontFamily: "'JetBrains Mono', 'Cascadia Mono', Consolas, monospace", caretColor: "#ffcd75" },
  ".cm-gutters": { background: "#14151b", color: "#4f5263", border: "none" },
  // the active line is translucent so a selection on it still shows
  ".cm-activeLine": { background: "#ffffff08" },
  ".cm-activeLineGutter": { background: "#ffffff08", color: "#a4a7b5" },
  // selection: a clear blue like other code editors (dimmer when the editor isn't focused)
  ".cm-selectionBackground": { background: "#2c3d66 !important" },
  "&.cm-focused .cm-selectionBackground": { background: "#2f5aa8 !important" },
  ".cm-content ::selection": { background: "#2f5aa8 !important" },
  ".cm-selectionMatch": { background: "#2f5aa840", outline: "1px solid #2f5aa880" },
  ".cm-cursor": { borderLeftColor: "#ffcc4d" },
  ".cm-errorLine": { background: "#4a1a2a" },
  ".cm-tooltip": { background: "#20212a", border: "1px solid #363948", color: "#e7e8ee" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { background: "#2c4a86" },
  ".cm-panels": { background: "#1b1c23", color: "#e7e8ee" },
  ".cm-searchMatch": { background: "#5a4d7a66" },
}, { dark: true });

// ------------------------------------------------------------------ error line

const setError = StateEffect.define<number | null>();
const errorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setError)) continue;
      if (e.value === null || e.value < 1 || e.value > tr.state.doc.lines) deco = Decoration.none;
      else deco = Decoration.set([Decoration.line({ class: "cm-errorLine" }).range(tr.state.doc.line(e.value).from)]);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ------------------------------------------------------------------ the editor

export interface CodeHooks {
  changed(path: string, text: string): void;
  run(): void;
  save(): void;
  /** script paths, for require completion */
  scripts(): string[];
}

export class CodeEditor {
  private view: EditorView;
  private states = new Map<string, EditorState>();
  open: string[] = [];
  active: string | null = null;
  private error: { path: string; line: number } | null = null;

  constructor(private host: HTMLElement, private tabsEl: HTMLElement, private hooks: CodeHooks) {
    this.view = new EditorView({ parent: host, state: this.makeState("", "") });
  }

  private complete = (ctx: CompletionContext): CompletionResult | null => {
    // require("...") paths
    const req = ctx.matchBefore(/require\(["'][\w/.-]*/);
    if (req) {
      const from = req.from + req.text.search(/["']/) + 1;
      return {
        from,
        options: this.hooks.scripts().map((p) => ({ label: p.replace(/^scripts\//, "").replace(/\.luau$/, ""), type: "text", detail: p })),
      };
    }
    const word = ctx.matchBefore(/[\w.]+/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    return {
      from: word.from,
      options: API.map(([label, info]) => ({ label, type: /^[A-Z]/.test(label) ? "class" : "function", info, detail: info.split(" --")[0] })),
      validFor: /^[\w.]*$/,
    };
  };

  private makeState(path: string, doc: string): EditorState {
    const ext: Extension[] = [
      lineNumbers(), highlightActiveLineGutter(), foldGutter(), history(), drawSelection(), indentOnInput(), bracketMatching(),
      closeBrackets(), highlightActiveLine(), highlightSelectionMatches(), search({ top: true }),
      StreamLanguage.define(lua), syntaxHighlighting(highlight), theme, errorField,
      EditorState.tabSize.of(2),
      autocompletion({ override: [this.complete] }),
      keymap.of([
        { key: "Mod-Enter", run: () => (this.hooks.run(), true) },
        { key: "Mod-s", run: () => (this.hooks.save(), true) },
        indentWithTab, ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap,
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && this.active === path) this.hooks.changed(path, u.state.doc.toString());
      }),
    ];
    return EditorState.create({ doc, extensions: ext });
  }

  /** Open (or switch to) a script. */
  show(path: string, text: string, line?: number) {
    if (this.active) this.states.set(this.active, this.view.state);
    if (!this.open.includes(path)) this.open.push(path);
    let st = this.states.get(path);
    if (!st || st.doc.toString() !== text) st = this.makeState(path, text);
    this.active = path;
    this.view.setState(st);
    this.applyError();
    this.renderTabs();
    if (line) this.gotoLine(line);
    requestAnimationFrame(() => this.view.focus());
  }

  close(path: string) {
    this.states.delete(path);
    this.open = this.open.filter((p) => p !== path);
    if (this.active === path) {
      this.active = null;
      const next = this.open[this.open.length - 1];
      if (next) this.onSwitch?.(next);
      else this.view.setState(this.makeState("", ""));
    }
    this.renderTabs();
  }

  /** Called when a tab is clicked (main.ts reopens the file with its current text). */
  onSwitch?: (path: string) => void;

  /** Files were renamed or deleted in the explorer. */
  sync(existing: (path: string) => boolean, renamed?: [string, string]) {
    if (renamed) {
      const [from, to] = renamed;
      this.open = this.open.map((p) => (p === from ? to : p));
      const st = this.states.get(from);
      if (st) {
        this.states.delete(from);
        this.states.set(to, st);
      }
      if (this.active === from) {
        this.active = to;
        // the update listener captured the old path: rebuild it for the new one
        this.view.setState(this.makeState(to, this.view.state.doc.toString()));
      }
    }
    for (const p of [...this.open]) if (!existing(p)) this.close(p);
    this.renderTabs();
  }

  /** Reset (a different project was opened). */
  reset() {
    this.states.clear();
    this.open = [];
    this.active = null;
    this.view.setState(this.makeState("", ""));
    this.renderTabs();
  }

  gotoLine(line: number) {
    const doc = this.view.state.doc;
    const l = doc.line(Math.max(1, Math.min(doc.lines, line)));
    this.view.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: "center" }) });
  }

  setError(err: { path: string; line: number } | null) {
    this.error = err;
    this.applyError();
    this.renderTabs();
  }

  private applyError() {
    const line = this.error && this.error.path === this.active ? this.error.line : null;
    this.view.dispatch({ effects: setError.of(line) });
  }

  get text() {
    return this.view.state.doc.toString();
  }

  private renderTabs() {
    this.tabsEl.innerHTML = "";
    for (const p of this.open) {
      const tab = document.createElement("div");
      tab.className = "code-tab" + (p === this.active ? " active" : "") + (this.error?.path === p ? " error" : "");
      tab.title = p;
      const name = document.createElement("span");
      name.textContent = p.replace(/^scripts\//, "");
      const x = document.createElement("button");
      x.innerHTML = '<svg><use href="#i-close" /></svg>';
      x.title = "Close";
      x.onclick = (e) => {
        e.stopPropagation();
        this.close(p);
      };
      tab.append(name, x);
      tab.onclick = () => this.onSwitch?.(p);
      this.tabsEl.appendChild(tab);
    }
    this.host.classList.toggle("empty", !this.active);
  }
}
