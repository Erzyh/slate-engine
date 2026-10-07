// Styled dropdowns. On Windows the native <select> popup ignores the app's colors (the hovered item
// turns white and its light text disappears), so every <select> stays as the data model - same id,
// same value, same "change" events - and a button + menu drawn with the app's palette replaces its popup.

let open: { menu: HTMLDivElement; sel: HTMLSelectElement; btn: HTMLButtonElement } | null = null;
const labels = new Map<HTMLSelectElement, () => void>();

function close() {
  open?.menu.remove();
  open?.btn.classList.remove("open");
  open = null;
}

/** "File…", "Export…": selects whose first option is an empty-valued title act as menus. */
const isMenu = (sel: HTMLSelectElement) => sel.options[0]?.value === "" && /…|\.\.\./.test(sel.options[0].textContent ?? "");

function pick(sel: HTMLSelectElement, value: string) {
  sel.value = value;
  sel.dispatchEvent(new Event("input", { bubbles: true }));
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  labels.get(sel)?.();
}

function openMenu(sel: HTMLSelectElement, btn: HTMLButtonElement) {
  close();
  const menu = document.createElement("div");
  menu.className = "dd-menu";
  const menuLike = isMenu(sel);
  const items: HTMLButtonElement[] = [];
  const addOption = (o: HTMLOptionElement, i: number) => {
    if (menuLike && i === 0) return;
    const it = document.createElement("button");
    it.type = "button";
    it.className = "dd-item";
    it.textContent = o.textContent;
    if (!menuLike && o.selected) it.classList.add("current");
    if (o.disabled) it.disabled = true;
    // one highlight at a time: the mouse moves the keyboard focus
    it.onpointerenter = () => it.focus();
    it.onclick = () => {
      close();
      pick(sel, o.value);
    };
    menu.appendChild(it);
    items.push(it);
  };
  let i = 0;
  for (const child of [...sel.children]) {
    if (child instanceof HTMLOptGroupElement) {
      const h = document.createElement("div");
      h.className = "dd-group";
      h.textContent = child.label;
      menu.appendChild(h);
      for (const o of [...child.children]) if (o instanceof HTMLOptionElement) addOption(o, i++);
    } else if (child instanceof HTMLOptionElement) addOption(child, i++);
  }
  if (!items.length) return;
  document.body.appendChild(menu);
  const r = btn.getBoundingClientRect();
  menu.style.minWidth = `${Math.max(r.width, 160)}px`;
  const below = r.bottom + 4 + menu.offsetHeight < innerHeight;
  menu.style.left = `${Math.min(r.left, innerWidth - menu.offsetWidth - 4)}px`;
  menu.style.top = `${below ? r.bottom + 4 : Math.max(4, r.top - 4 - menu.offsetHeight)}px`;
  btn.classList.add("open");
  open = { menu, sel, btn };
  (menu.querySelector(".current") as HTMLButtonElement | null ?? items[0]).focus();
}

function enhance(sel: HTMLSelectElement) {
  if (sel.dataset.dd) return;
  sel.dataset.dd = "1";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `dd ${sel.className}`.trim();
  if (sel.id) btn.dataset.for = sel.id;
  btn.title = sel.title;
  const text = document.createElement("span");
  text.className = "dd-text";
  const caret = document.createElement("span");
  caret.className = "dd-caret";
  caret.textContent = "▾";
  btn.append(text, caret);
  const label = () => {
    const o = sel.selectedOptions[0] ?? sel.options[0];
    text.textContent = o?.textContent ?? "";
    btn.disabled = sel.disabled;
  };
  labels.set(sel, label);
  sel.classList.add("dd-native");
  sel.after(btn);
  label();
  btn.onclick = (e) => {
    e.stopPropagation();
    if (open?.sel === sel) close();
    else openMenu(sel, btn);
  };
  sel.addEventListener("change", label);
  new MutationObserver(label).observe(sel, { childList: true, subtree: true, attributes: true, characterData: true });
}

/** Replace the popups of all selects, now and later (plugin settings add some at runtime). */
export function enhanceSelects() {
  document.querySelectorAll("select").forEach((s) => enhance(s));
  new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n instanceof HTMLSelectElement) enhance(n);
        else if (n instanceof HTMLElement) n.querySelectorAll("select").forEach((s) => enhance(s));
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
  // code that sets select.value directly doesn't fire events: refresh the labels after interactions
  const refresh = () => labels.forEach((l) => l());
  window.addEventListener("pointerup", () => setTimeout(refresh, 0), true);
  window.addEventListener("keyup", () => setTimeout(refresh, 0), true);
  window.addEventListener("pointerdown", (e) => {
    if (open && !open.menu.contains(e.target as Node) && e.target !== open.btn && !open.btn.contains(e.target as Node)) close();
  }, true);
  window.addEventListener("resize", close);
  window.addEventListener("keydown", (e) => {
    if (!open) return;
    const items = [...open.menu.querySelectorAll<HTMLButtonElement>(".dd-item:not(:disabled)")];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Enter" || e.key === " ") {
      (document.activeElement as HTMLButtonElement | null)?.click?.();
    } else if (e.key === "Escape") {
      const btn = open.btn;
      close();
      btn.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const next = items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length];
      next?.focus();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
}
