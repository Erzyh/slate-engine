// Updates for the desktop app: on start (and from File > Check for updates…) ask GitHub for the
// latest release (updater/latest.json in the repo). If there is a newer, signed version, a banner offers
// to install it; the installer runs in the background and Slate restarts on the new version.

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./native.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface UpdateHooks {
  /** true if the user may lose unsaved work (asked before restarting) */
  dirty(): boolean;
  /** save the project first; resolves false if that didn't happen */
  save(): Promise<boolean>;
  status(msg: string, error?: boolean): void;
}

let hooks: UpdateHooks;

function banner(html: string, actions: [string, () => void, boolean?][] = []) {
  const el = $("update-banner");
  el.innerHTML = `<span class="update-text">${html}</span>`;
  for (const [label, fn, primary] of actions) {
    const b = document.createElement("button");
    b.textContent = label;
    if (primary) b.className = "accent";
    b.onclick = fn;
    el.appendChild(b);
  }
  el.classList.toggle("hidden", !html);
}

const hide = () => banner("");

export async function checkForUpdates(manual = false) {
  if (!isTauri) {
    if (manual) hooks.status("Updates are for the Slate desktop app", true);
    return;
  }
  const { check } = await import("@tauri-apps/plugin-updater");
  let update;
  try {
    update = await check();
  } catch (err) {
    if (manual) hooks.status(`Could not check for updates: ${err}`, true);
    return;
  }
  if (!update) {
    if (manual) hooks.status("Slate is up to date");
    return;
  }
  const notes = (update.body ?? "").split("\n").find((l) => l.trim().startsWith("-"))?.replace(/^\s*-\s*/, "") ?? "";
  banner(`<b>Slate ${update.version}</b> is available (you have ${update.currentVersion}).${notes ? ` <span class="muted">${escapeHtml(notes)}</span>` : ""}`, [
    ["Update & restart", () => void install(update), true],
    ["Release notes", () => window.open(`https://github.com/Erzyh/slate-engine/releases/tag/v${update.version}`, "_blank")],
    ["Later", hide],
  ]);
}

async function install(update: import("@tauri-apps/plugin-updater").Update) {
  if (hooks.dirty()) {
    const save = confirm("Save the project before updating?\n\nOK = save, then update.  Cancel = update without saving.");
    if (save && !(await hooks.save())) return;
  }
  let total = 0, got = 0;
  try {
    await update.downloadAndInstall((e) => {
      if (e.event === "Started") total = e.data.contentLength ?? 0;
      else if (e.event === "Progress") {
        got += e.data.chunkLength;
        banner(`Downloading Slate ${update.version}… ${total ? Math.round((got / total) * 100) + "%" : `${(got / 1048576).toFixed(1)} MB`}`);
      } else if (e.event === "Finished") banner(`Installing Slate ${update.version}…`);
    });
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (err) {
    banner(`Update failed: ${escapeHtml(String(err))}`, [["Close", hide]]);
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** SLATE_UPDATE_TEST=<file>: check + download (signature verified), no install, report to the file. */
async function selfTest() {
  const { check } = await import("@tauri-apps/plugin-updater");
  const lines: string[] = [];
  try {
    const u = await check();
    lines.push(`check: ${u ? `update ${u.currentVersion} -> ${u.version}` : "up to date"}`);
    if (u) {
      let n = 0;
      await u.download((e) => {
        if (e.event === "Progress") n += e.data.chunkLength;
      });
      lines.push(`download: ok, ${n} bytes, signature verified`);
    }
  } catch (err) {
    lines.push(`error: ${err}`);
  }
  await invoke("update_test_report", { text: lines.join("\n") });
}

export async function initUpdater(h: UpdateHooks) {
  hooks = h;
  if (!isTauri) return;
  const test = await invoke<string | null>("update_test").catch(() => null);
  if (test) return void selfTest();
  // quietly, a few seconds after start
  setTimeout(() => void checkForUpdates(false), 4000);
}
