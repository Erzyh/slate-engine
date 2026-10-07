// The menu bar (File, Edit, ...) and pop-up menus. Built like a desktop app's: click a title to open,
// move over the others to switch, arrows / Enter / Esc on the keyboard.

export type MenuItem =
  | "-"
  | { header: string }
  | { label: string; key?: string; action: () => void; checked?: boolean; disabled?: boolean };

export interface MenuDef {
  label: string;
  items: () => MenuItem[];
}

let openMenu: { el: HTMLDivElement; owner: HTMLElement | null; onClose?: () => void } | null = null;

export function closeMenus() {
  if (!openMenu) return;
  openMenu.el.remove();
  openMenu.owner?.classList.remove("open");
  const cb = openMenu.onClose;
  openMenu = null;
  cb?.();
}

/** Show a menu at (x, y) (or under `owner`). */
export function popupMenu(x: number, y: number, items: MenuItem[], owner: HTMLElement | null = null, onClose?: () => void) {
  closeMenus();
  const el = document.createElement("div");
  el.className = "dd-menu";
  el.setAttribute("role", "menu");
  for (const it of items) {
    if (it === "-") {
      el.appendChild(Object.assign(document.createElement("div"), { className: "sep" }));
      continue;
    }
    if ("header" in it) {
      el.appendChild(Object.assign(document.createElement("div"), { className: "dd-group", textContent: it.header }));
      continue;
    }
    const b = document.createElement("button");
    b.className = "dd-item";
    b.setAttribute("role", "menuitem");
    b.disabled = !!it.disabled;
    const mark = document.createElement("span");
    mark.className = "check-mark";
    if (it.checked !== undefined) mark.innerHTML = it.checked ? '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8.5l3 3 7-7"/></svg>' : "";
    const label = Object.assign(document.createElement("span"), { className: "menu-label", textContent: it.label });
    b.append(mark, label);
    if (it.key) b.appendChild(Object.assign(document.createElement("span"), { className: "menu-key", textContent: it.key }));
    b.onpointerenter = () => b.focus();
    b.onclick = () => {
      closeMenus();
      it.action();
    };
    el.appendChild(b);
  }
  // no check column when nothing in the menu can be checked
  if (!items.some((i) => typeof i === "object" && "label" in i && i.checked !== undefined)) el.classList.add("no-checks");
  document.body.appendChild(el);
  el.style.left = `${Math.max(4, Math.min(x, innerWidth - el.offsetWidth - 4))}px`;
  el.style.top = `${Math.max(4, Math.min(y, innerHeight - el.offsetHeight - 4))}px`;
  owner?.classList.add("open");
  openMenu = { el, owner, onClose };
}

export class MenuBar {
  private buttons: HTMLButtonElement[] = [];

  constructor(private el: HTMLElement, private menus: MenuDef[]) {
    for (const [i, m] of menus.entries()) {
      const b = document.createElement("button");
      b.textContent = m.label;
      b.onclick = (e) => {
        e.stopPropagation();
        if (openMenu?.owner === b) closeMenus();
        else this.open(i);
      };
      // like native menus: once one is open, hovering another opens it
      b.onpointerenter = () => {
        if (openMenu && openMenu.owner !== b && this.buttons.includes(openMenu.owner as HTMLButtonElement)) this.open(i);
      };
      el.appendChild(b);
      this.buttons.push(b);
    }
  }

  open(i: number) {
    const b = this.buttons[i];
    const r = b.getBoundingClientRect();
    popupMenu(r.left, r.bottom + 4, this.menus[i].items(), b);
  }
}

window.addEventListener("pointerdown", (e) => {
  if (openMenu && !openMenu.el.contains(e.target as Node) && !openMenu.owner?.contains(e.target as Node)) closeMenus();
}, true);
window.addEventListener("blur", closeMenus);
window.addEventListener("resize", closeMenus);
window.addEventListener("keydown", (e) => {
  if (!openMenu) return;
  const items = [...openMenu.el.querySelectorAll<HTMLButtonElement>(".dd-item:not(:disabled)")];
  const at = items.indexOf(document.activeElement as HTMLButtonElement);
  if (e.key === "Escape") closeMenus();
  else if (e.key === "ArrowDown") items[(at + 1) % items.length]?.focus();
  else if (e.key === "ArrowUp") items[(at - 1 + items.length) % items.length]?.focus();
  else if (e.key === "Enter" && at >= 0) items[at].click();
  else return;
  e.preventDefault();
  e.stopPropagation();
}, true);

/** Range sliders show their filled part in the accent color (CSS reads --p). */
export function fillRanges() {
  const set = (r: HTMLInputElement) => {
    const min = Number(r.min || 0), max = Number(r.max || 100);
    r.style.setProperty("--p", `${((Number(r.value) - min) / (max - min || 1)) * 100}%`);
  };
  const all = () => document.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(set);
  document.addEventListener("input", (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type === "range") set(e.target);
  }, true);
  new MutationObserver(all).observe(document.body, { childList: true, subtree: true });
  // values set from code don't fire events: refresh on a timer that costs nothing when nothing changes
  setInterval(all, 400);
  all();
}
