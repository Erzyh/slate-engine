// Make the editor behave like a desktop app, not a web page: no browser context menu (text fields
// get an app menu with cut / copy / paste instead), no reload / print / find-in-page / page zoom /
// back-forward shortcuts, no text selection or image dragging on the interface.

import { popupMenu } from "./menu.ts";

const TEXT_INPUTS = new Set(["text", "search", "number", "url", "email", ""]);

function isTextField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && TEXT_INPUTS.has(el.type);
}

async function paste(target: HTMLElement) {
  target.focus();
  try {
    const text = await navigator.clipboard.readText();
    if (text) document.execCommand("insertText", false, text);
  } catch {
    document.execCommand("paste");
  }
}

function textMenu(e: MouseEvent, target: HTMLElement) {
  const field = isTextField(target) ? target : null;
  const selected = field ? (field.selectionStart ?? 0) !== (field.selectionEnd ?? 0) : !!window.getSelection()?.toString();
  const editable = field ? !field.readOnly && !field.disabled : !!target.closest("[contenteditable=true]");
  popupMenu(e.clientX, e.clientY, [
    { label: "Cut", key: "Ctrl+X", disabled: !(selected && editable), action: () => { target.focus(); document.execCommand("cut"); } },
    { label: "Copy", key: "Ctrl+C", disabled: !selected, action: () => { target.focus(); document.execCommand("copy"); } },
    { label: "Paste", key: "Ctrl+V", disabled: !editable, action: () => void paste(target) },
    "-",
    { label: "Select all", key: "Ctrl+A", action: () => { target.focus(); if (field) field.select(); else document.execCommand("selectAll"); } },
  ]);
}

export function desktopFeel() {
  // right click: the editor's own menus where they exist, a text menu in text fields, nothing elsewhere
  window.addEventListener("contextmenu", (e) => {
    if (e.defaultPrevented) return; // a panel already showed its own menu
    e.preventDefault();
    const t = e.target as HTMLElement;
    const code = t.closest<HTMLElement>(".cm-content");
    if (isTextField(t)) textMenu(e, t);
    else if (code) textMenu(e, code);
  });

  // browser shortcuts that make no sense in an app
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    const inCode = !!(e.target as HTMLElement).closest?.(".cm-editor");
    const block =
      e.key === "F5" || e.key === "F7" || e.key === "BrowserBack" || e.key === "BrowserForward" ||
      (mod && (k === "r" || k === "p" || k === "u" || k === "j" || k === "n" || k === "t" || k === "w" || k === "h")) ||
      // find in page (the code editor has its own find)
      (!inCode && (e.key === "F3" || (mod && (k === "f" || k === "g")))) ||
      (mod && (k === "+" || k === "=" || k === "-" || k === "0")) ||
      (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !inCode) ||
      (!import.meta.env.DEV && (e.key === "F12" || (mod && e.shiftKey && (k === "i" || k === "c"))));
    if (block) e.preventDefault();
  }, true);

  // ctrl+wheel would zoom the whole page
  window.addEventListener("wheel", (e) => {
    if (e.ctrlKey) e.preventDefault();
  }, { passive: false, capture: true });

  // dropping a file outside the handled areas must not open it as a page
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());
  // middle click auto-scroll and link dragging
  window.addEventListener("mousedown", (e) => {
    if (e.button === 1) e.preventDefault();
  });
  window.addEventListener("dragstart", (e) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLImageElement || t instanceof HTMLAnchorElement || t instanceof HTMLCanvasElement) e.preventDefault();
  });
}
