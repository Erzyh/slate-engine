// Code tab: CodeMirror 6 with one tab per open script, Luau highlighting, completion for the
// Slate API and for require("...") paths, and the current error marked on its line.

import { autocompletion, type CompletionContext, type CompletionResult, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, HighlightStyle, indentOnInput, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration, drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, hoverTooltip, keymap, lineNumbers, type DecorationSet,
} from "@codemirror/view";
import { API, EFFECT_NAMES, NAME_ARGS, SFX_PRESETS } from "./api-docs.ts";
import { tags as t } from "@lezer/highlight";

const LUA_WORDS = new Set(["and", "break", "continue", "do", "else", "elseif", "end", "false", "for", "function", "if", "in", "local", "nil", "not", "or", "repeat", "return", "then", "true", "until", "while", "type", "typeof", "self"]);

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
  ".cm-tooltip": { background: "#20212a", border: "1px solid #363948", color: "#e7e8ee", borderRadius: "6px", boxShadow: "0 6px 18px #0008" },
  ".cm-tooltip-autocomplete ul": { fontFamily: "var(--mono)", fontSize: "12px", maxHeight: "16em" },
  ".cm-tooltip-autocomplete ul li": { padding: "2px 8px !important" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { background: "#2c4a86" },
  ".cm-completionDetail": { color: "#8b8fa3", fontStyle: "normal", marginLeft: "1.2em" },
  ".cm-completionMatchedText": { textDecoration: "none", color: "#ffcd75" },
  ".cm-tooltip.cm-completionInfo": { padding: "8px 10px", maxWidth: "420px", whiteSpace: "pre-wrap", fontFamily: "Pretendard, sans-serif", fontSize: "12px", lineHeight: "1.5" },
  ".cm-api-tip": { padding: "8px 10px", maxWidth: "460px", fontSize: "12px", lineHeight: "1.5" },
  ".cm-api-tip .sig": { fontFamily: "var(--mono)", color: "#82aaff", whiteSpace: "pre-wrap" },
  ".cm-api-tip .doc": { color: "#c9cbd6", marginTop: "4px" },
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
  /** project names for completing string arguments: spr("...", map("...", sfx("... */
  names(kind: "sprites" | "maps" | "sounds" | "music" | "particles"): string[];
}

/** Completion entry for an API name. */
function apiOption(name: string, label = name) {
  const [sig, doc] = API[name];
  const isModule = /^[A-Z]\w*$/.test(name) && Object.keys(API).some((k) => k.startsWith(name + "."));
  return {
    label,
    type: isModule ? "namespace" : /^[A-Z]/.test(name) && !name.includes(".") ? "constant" : "function",
    detail: sig.length > 60 ? sig.slice(0, 58) + "…" : sig,
    info: `${sig}\n\n${doc}`,
    boost: isModule ? 1 : 0,
  };
}

/** The dotted name under the cursor (e.g. "Path.find"), with its range. */
function wordAt(text: string, pos: number) {
  let a = pos, b = pos;
  while (a > 0 && /[\w.]/.test(text[a - 1])) a--;
  while (b < text.length && /\w/.test(text[b])) b++;
  return { from: a, to: b, word: text.slice(a, b) };
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
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    // require("...") paths
    const req = ctx.matchBefore(/require\(["'][\w/.-]*/);
    if (req) {
      const from = req.from + req.text.search(/["']/) + 1;
      return {
        from,
        options: this.hooks.scripts().map((p) => ({ label: p.replace(/^scripts\//, "").replace(/\.luau$/, ""), type: "text", detail: p })),
      };
    }
    // names inside quotes: spr("hero"  map("level1"  sfx("coin"  Fx.effect("crt"  Scene.go("play"
    for (const [re, kind] of NAME_ARGS) {
      const m = before.match(re);
      if (!m) continue;
      const typed = before.match(/[\w-]*$/)![0];
      let names: string[];
      if (kind === "effects") names = EFFECT_NAMES;
      else if (kind === "scenes") names = [...ctx.state.doc.toString().matchAll(/Scene\.add\(\s*["']([\w-]+)/g)].map((x) => x[1]);
      else if (kind === "sounds") names = [...this.hooks.names("sounds"), ...SFX_PRESETS];
      else names = this.hooks.names(kind);
      return { from: ctx.pos - typed.length, options: [...new Set(names)].map((n) => ({ label: n, type: "text", detail: kind })), validFor: /^[\w-]*$/ };
    }
    // Module.member
    const dotted = ctx.matchBefore(/[A-Z]\w*\.\w*/);
    if (dotted) {
      const [mod] = dotted.text.split(".");
      const members = Object.keys(API).filter((k) => k.startsWith(mod + "."));
      if (members.length) {
        return { from: dotted.from + mod.length + 1, options: members.map((k) => apiOption(k, k.slice(mod.length + 1))), validFor: /^\w*$/ };
      }
    }
    const word = ctx.matchBefore(/\w+/);
    if (!word || (word.from === word.to && !ctx.explicit)) return null;
    // API names, then the words already in this file (variables, functions)
    const api = Object.keys(API).filter((k) => !k.includes(".")).map((k) => apiOption(k));
    const seen = new Set(Object.keys(API));
    const own: { label: string; type: string }[] = [];
    for (const m of ctx.state.doc.toString().matchAll(/\b[A-Za-z_]\w{2,}\b/g)) {
      const w = m[0];
      if (seen.has(w) || m.index === word.from || LUA_WORDS.has(w)) continue;
      seen.add(w);
      own.push({ label: w, type: "variable" });
    }
    return { from: word.from, options: [...api, ...own], validFor: /^\w*$/ };
  };

  /** Hover a name: its signature and what it does. */
  private hover = hoverTooltip((view, pos) => {
    const line = view.state.doc.lineAt(pos);
    const { from, to, word } = wordAt(line.text, pos - line.from);
    let name = word;
    // "Path.find" or just "find" after "Path."
    while (name && !API[name] && name.includes(".")) name = name.slice(name.indexOf(".") + 1);
    if (!name || !API[name]) return null;
    const [sig, doc] = API[name];
    return {
      pos: line.from + from,
      end: line.from + to,
      above: true,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "cm-api-tip";
        const a = document.createElement("div");
        a.className = "sig";
        a.textContent = sig;
        const b = document.createElement("div");
        b.className = "doc";
        b.textContent = doc;
        dom.append(a, b);
        return { dom };
      },
    };
  }, { hoverTime: 350 });

  private makeState(path: string, doc: string): EditorState {
    const ext: Extension[] = [
      lineNumbers(), highlightActiveLineGutter(), foldGutter(), history(), drawSelection(), indentOnInput(), bracketMatching(),
      closeBrackets(), highlightActiveLine(), highlightSelectionMatches(), search({ top: true }),
      StreamLanguage.define(lua), syntaxHighlighting(highlight), theme, errorField,
      EditorState.tabSize.of(2),
      autocompletion({ override: [this.complete], icons: false }),
      this.hover,
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
