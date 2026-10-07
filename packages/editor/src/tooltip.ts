// Tooltips in the editor's own style instead of the browser's: any element with a title gets one.
// "Pen (B)" shows the shortcut as a key, text after " · " becomes a second, dimmer line.

const DELAY = 450;

export function tooltips() {
  const tip = document.createElement("div");
  tip.className = "tooltip";
  document.body.appendChild(tip);
  let target: HTMLElement | null = null;
  let timer = 0;
  // once one tooltip was shown, moving to a neighbor shows the next one at once
  let warm = 0;

  const hide = () => {
    clearTimeout(timer);
    if (target && tip.classList.contains("show")) warm = performance.now();
    target = null;
    tip.classList.remove("show");
  };

  const show = (el: HTMLElement) => {
    const text = el.dataset.tip ?? "";
    if (!text || !el.isConnected) return;
    const [head, ...rest] = text.split(" · ");
    const m = head.match(/^(.*?)\s*\(([^()]{1,24})\)$/);
    tip.textContent = "";
    const line = document.createElement("div");
    line.className = "tip-head";
    line.append(m ? m[1] : head);
    if (m) {
      const k = document.createElement("kbd");
      k.textContent = m[2];
      line.append(k);
    }
    tip.append(line);
    if (rest.length) {
      const sub = document.createElement("div");
      sub.className = "tip-sub";
      sub.textContent = rest.join(" · ");
      tip.append(sub);
    }
    tip.classList.add("show");
    // below the element (above it near the bottom of the window); beside it in a vertical tool
    // column; always kept inside the window
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    let x = r.left + r.width / 2 - t.width / 2;
    let y = r.bottom + 6;
    if (el.closest(".toolbox")) {
      x = r.right + 8;
      y = r.top + r.height / 2 - t.height / 2;
    } else if (y + t.height > innerHeight - 4) y = r.top - t.height - 6;
    y = Math.max(4, Math.min(innerHeight - t.height - 4, y));
    x = Math.max(4, Math.min(innerWidth - t.width - 4, x));
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };

  document.addEventListener("mouseover", (e) => {
    const el = (e.target as HTMLElement).closest?.<HTMLElement>("[title], [data-tip]");
    if (el === target) return;
    hide();
    if (!el) return;
    // take the title over so the browser's own tooltip never appears
    const title = el.getAttribute("title");
    if (title !== null) {
      el.dataset.tip = title;
      el.removeAttribute("title");
    }
    target = el;
    timer = window.setTimeout(() => show(el), performance.now() - warm < 400 ? 0 : DELAY);
  });
  document.addEventListener("mousedown", hide, true);
  document.addEventListener("wheel", hide, { passive: true, capture: true });
  window.addEventListener("blur", hide);
}
