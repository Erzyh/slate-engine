// The Slate command line: build, run, test and export projects from anywhere (no editor needed).
//
//   slate new <dir> [--template platformer|topdown|shmup]   a new project (from a template)
//   slate build <dir>                                       -> <dir>/build/<name>.slate
//   slate run <dir> [--watch]                               play it; --watch rebuilds on every save
//                                                          and the running game reloads (art, maps,
//                                                          --!live scripts without a restart)
//   slate test <dir> [--script t.luau] [--turbo 20] [--seed 1] [--timeout 300]
//                                                          run headless-fast; the test script runs
//                                                          after main and ends with quit(code)
//   slate export <dir> [--exe] [--web]                      a standalone Windows .exe / itch.io zip
//
// Started by tools/slate.mjs (`node <engine>/tools/slate.mjs ...`, or `npx slate ...` inside the repo).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildProject, readProjectFiles } from "./build-project.ts";
import { packProject, type ProjectSettings } from "../packages/runtime/src/project.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const PLAYER = path.join(ROOT, "native/target/release", process.platform === "win32" ? "slate-player.exe" : "slate-player");
const [cmd, target, ...rest] = process.argv.slice(2);
const flag = (name: string) => rest.includes(`--${name}`);
const opt = (name: string, def?: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 && rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[i + 1] : def;
};

function usage(): never {
  console.log(fs.readFileSync(import.meta.filename, "utf8").split("\n").filter((l) => l.startsWith("//")).slice(0, 13).map((l) => l.slice(3)).join("\n"));
  process.exit(cmd ? 1 : 0);
}

function projectDir(): string {
  const dir = path.resolve(target ?? ".");
  if (!fs.existsSync(path.join(dir, "slate.json"))) {
    console.error(`no slate.json in ${dir}`);
    process.exit(1);
  }
  return dir;
}

function settingsOf(dir: string): ProjectSettings {
  return JSON.parse(fs.readFileSync(path.join(dir, "slate.json"), "utf8"));
}

function needPlayer() {
  if (!fs.existsSync(PLAYER)) {
    console.error(`no player at ${PLAYER}: build it with npm run native:build (in ${ROOT})`);
    process.exit(1);
  }
}

/** Build quietly; returns the cartridge path. */
function build(dir: string, flags: string[] = []): string {
  buildProject(dir, flags);
  return path.join(dir, "build", `${settingsOf(dir).name}.slate`);
}

async function main() {
  switch (cmd) {
    case "new": {
      if (!target) usage();
      const dir = path.resolve(target);
      if (fs.existsSync(dir) && fs.readdirSync(dir).length) {
        console.error(`${dir} is not empty`);
        process.exit(1);
      }
      const tpl = path.join(ROOT, "templates", opt("template", "platformer")!);
      if (!fs.existsSync(path.join(tpl, "slate.json"))) {
        console.error(`no template ${tpl}`);
        process.exit(1);
      }
      fs.cpSync(tpl, dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}build`) });
      const name = path.basename(dir).replace(/[^\w-]/g, "-");
      const s = settingsOf(dir);
      fs.writeFileSync(path.join(dir, "slate.json"), JSON.stringify({ ...s, name, title: path.basename(dir) }, null, 2) + "\n");
      console.log(`created ${dir} from ${path.basename(tpl)} · slate run ${target} --watch`);
      return;
    }
    case "build": {
      build(projectDir());
      return;
    }
    case "export": {
      const flags = flag("web") ? ["--web"] : [];
      if (flag("exe") || !flag("web")) {
        needPlayer();
        flags.push("--exe");
      }
      build(projectDir(), flags);
      return;
    }
    case "run": {
      needPlayer();
      const dir = projectDir();
      const cart = build(dir);
      const args = [cart];
      if (flag("watch")) args.push("--watch");
      const p = spawn(PLAYER, args, { stdio: "inherit" });
      if (flag("watch")) {
        let timer: NodeJS.Timeout | undefined;
        const watcher = fs.watch(dir, { recursive: true }, (_e, file) => {
          if (!file || String(file).replaceAll("\\", "/").startsWith("build/")) return;
          clearTimeout(timer);
          timer = setTimeout(() => {
            try {
              build(dir);
            } catch (e) {
              console.error(String(e));
            }
          }, 250);
        });
        p.on("exit", () => watcher.close());
        console.log("watching for changes · close the game window to stop");
      }
      p.on("exit", (code) => process.exit(code ?? 0));
      return;
    }
    case "test": {
      needPlayer();
      const dir = projectDir();
      const files = readProjectFiles(dir);
      const cart = packProject(files);
      const script = opt("script");
      if (script) {
        // the test runs right after main: it can wrap update(), drive the game and quit(code)
        const mainPath = cart.main ?? "scripts/main.luau";
        cart.scripts!["scripts/__test.luau"] = fs.readFileSync(path.resolve(script), "utf8");
        cart.scripts!["scripts/__run_test.luau"] = `require("${mainPath}")\nrequire("scripts/__test.luau")\n`;
        cart.main = "scripts/__run_test.luau";
      }
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "slate-test-"));
      const cartPath = path.join(tmp, "test.slate");
      const errPath = path.join(tmp, "error.txt");
      fs.writeFileSync(cartPath, JSON.stringify(cart));
      const env = { ...process.env, SLATE_TURBO: opt("turbo", "20")!, SLATE_SEED: opt("seed", "1")!, SLATE_ERRLOG: errPath };
      const timeout = Number(opt("timeout", "300")) * 1000;
      const started = Date.now();
      const p = spawn(PLAYER, [cartPath], { env, stdio: ["ignore", "inherit", "inherit"] });
      const poll = setInterval(() => {
        const err = fs.existsSync(errPath) ? fs.readFileSync(errPath, "utf8").trim() : "";
        if (err) {
          console.error(`ERROR ${err}`);
          p.kill();
          finish(1);
        } else if (Date.now() - started > timeout) {
          console.error(`timed out after ${timeout / 1000} s (end the test with quit())`);
          p.kill();
          finish(2);
        }
      }, 250);
      const finish = (code: number) => {
        clearInterval(poll);
        fs.rmSync(tmp, { recursive: true, force: true });
        process.exit(code);
      };
      p.on("exit", (code) => finish(code ?? 0));
      return;
    }
    default:
      usage();
  }
}

await main();
