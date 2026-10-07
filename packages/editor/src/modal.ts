// In-app dialogs (instead of the browser's prompt / confirm / alert, which show the page's address and
// can't be styled). Every function opens a centered modal and resolves when it closes.

export interface Field {
  key: string;
  label: string;
  /** text (default), number, color, checkbox, select */
  type?: "text" | "number" | "color" | "checkbox" | "select";
  value?: string | number | boolean;
  placeholder?: string;
  hint?: string;
  min?: number;
  max?: number;
  options?: [string, string][];
  /** half width (two such fields share a row) */
  half?: boolean;
  /** text fields: characters that are not allowed are replaced as you type */
  clean?: (v: string) => string;
}

export interface FormOptions {
  title: string;
  message?: string;
  fields: Field[];
  ok?: string;
  cancel?: string;
  danger?: boolean;
  /** return an error message to keep the dialog open */
  validate?: (v: Record<string, string | number | boolean>) => string | null;
}

let layer: HTMLDivElement | null = null;

function root() {
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "ui-modal-layer";
    document.body.appendChild(layer);
  }
  return layer;
}

/** A general form dialog. Resolves with the values, or null when cancelled. */
export function form(o: FormOptions): Promise<Record<string, string | number | boolean> | null> {
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "ui-modal-back";
    const box = document.createElement("div");
    box.className = "ui-modal";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    const h = document.createElement("h2");
    h.textContent = o.title;
    box.appendChild(h);
    if (o.message) {
      const p = document.createElement("p");
      p.className = "ui-modal-msg";
      p.textContent = o.message;
      box.appendChild(p);
    }
    const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
    const grid = document.createElement("div");
    grid.className = "ui-modal-fields";
    for (const f of o.fields) {
      const row = document.createElement("label");
      row.className = "ui-field" + (f.type === "checkbox" ? " check" : "") + (f.half ? " half" : "");
      const name = document.createElement("span");
      name.className = "ui-field-label";
      name.textContent = f.label;
      let input: HTMLInputElement | HTMLSelectElement;
      if (f.type === "select") {
        const sel = document.createElement("select");
        for (const [v, label] of f.options ?? []) {
          const opt = document.createElement("option");
          opt.value = v;
          opt.textContent = label;
          sel.appendChild(opt);
        }
        sel.value = String(f.value ?? "");
        input = sel;
      } else {
        const inp = document.createElement("input");
        inp.type = f.type ?? "text";
        inp.spellcheck = false;
        if (f.type === "checkbox") inp.checked = !!f.value;
        else inp.value = String(f.value ?? "");
        if (f.placeholder) inp.placeholder = f.placeholder;
        if (f.min !== undefined) inp.min = String(f.min);
        if (f.max !== undefined) inp.max = String(f.max);
        if (f.clean) inp.oninput = () => {
          const c = f.clean!(inp.value);
          if (c !== inp.value) inp.value = c;
        };
        input = inp;
      }
      inputs.set(f.key, input);
      if (f.type === "checkbox") row.append(input, name);
      else row.append(name, input);
      if (f.hint) {
        const hint = document.createElement("span");
        hint.className = "ui-field-hint";
        hint.textContent = f.hint;
        row.appendChild(hint);
      }
      grid.appendChild(row);
    }
    if (o.fields.length) box.appendChild(grid);
    const err = document.createElement("p");
    err.className = "ui-modal-error";
    box.appendChild(err);
    const foot = document.createElement("div");
    foot.className = "ui-modal-foot";
    const cancel = document.createElement("button");
    cancel.textContent = o.cancel ?? "Cancel";
    const ok = document.createElement("button");
    ok.className = o.danger ? "danger" : "primary";
    ok.textContent = o.ok ?? "OK";
    if (o.cancel !== "") foot.appendChild(cancel);
    foot.appendChild(ok);
    box.appendChild(foot);
    back.appendChild(box);
    root().appendChild(back);

    const read = () => {
      const v: Record<string, string | number | boolean> = {};
      for (const f of o.fields) {
        const i = inputs.get(f.key)!;
        if (f.type === "checkbox") v[f.key] = (i as HTMLInputElement).checked;
        else if (f.type === "number") v[f.key] = Number(i.value);
        else v[f.key] = i.value.trim();
      }
      return v;
    };
    const done = (result: Record<string, string | number | boolean> | null) => {
      if (result) {
        const e = o.validate?.(result);
        if (e) {
          err.textContent = e;
          return;
        }
      }
      back.remove();
      window.removeEventListener("keydown", keys, true);
      resolve(result);
    };
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        done(null);
      } else if (e.key === "Enter" && !(e.target instanceof HTMLSelectElement)) {
        e.preventDefault();
        e.stopPropagation();
        done(read());
      } else e.stopPropagation(); // keep editor shortcuts out while a dialog is open
    };
    window.addEventListener("keydown", keys, true);
    cancel.onclick = () => done(null);
    ok.onclick = () => done(read());
    back.addEventListener("mousedown", (e) => {
      if (e.target === back) done(null);
    });
    const first = [...inputs.values()][0];
    setTimeout(() => {
      if (first instanceof HTMLInputElement && first.type !== "checkbox") {
        first.focus();
        first.select();
      } else ok.focus();
    }, 0);
  });
}

/** One text value (rename, new name...). */
export async function ask(title: string, value = "", o: { message?: string; placeholder?: string; ok?: string; label?: string; clean?: (v: string) => string } = {}) {
  const r = await form({
    title,
    message: o.message,
    ok: o.ok,
    fields: [{ key: "v", label: o.label ?? "Name", value, placeholder: o.placeholder, clean: o.clean }],
    validate: (v) => (String(v.v) ? null : "Enter a value"),
  });
  return r ? String(r.v) : null;
}

/** Width and height in pixels (or tiles). */
export async function askSize(title: string, w: number, h: number, o: { message?: string; ok?: string; max?: number; unit?: string } = {}) {
  const max = o.max ?? 1024;
  const r = await form({
    title,
    message: o.message,
    ok: o.ok,
    fields: [
      { key: "w", label: `Width${o.unit ? ` (${o.unit})` : ""}`, type: "number", value: w, min: 1, max, half: true },
      { key: "h", label: `Height${o.unit ? ` (${o.unit})` : ""}`, type: "number", value: h, min: 1, max, half: true },
    ],
    validate: (v) => (Number(v.w) >= 1 && Number(v.h) >= 1 && Number(v.w) <= max && Number(v.h) <= max ? null : `Use 1 to ${max}`),
  });
  return r ? ([Math.round(Number(r.w)), Math.round(Number(r.h))] as [number, number]) : null;
}

/** Yes / no. */
export async function confirmBox(title: string, message = "", o: { ok?: string; cancel?: string; danger?: boolean } = {}) {
  return !!(await form({ title, message, fields: [], ok: o.ok ?? "OK", cancel: o.cancel, danger: o.danger }));
}

/** A message with a single button. */
export async function alertBox(title: string, message = "") {
  await form({ title, message, fields: [], ok: "OK", cancel: "" });
}

/** Keep only letters, digits, _ and - (names used in code). */
export const codeName = (v: string) => v.replace(/[^\w-]/g, "_");
