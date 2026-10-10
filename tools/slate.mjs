#!/usr/bin/env node
// The Slate command line (see tools/slate.ts): node <engine>/tools/slate.mjs <command> ...
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tsx = path.join(here, "..", "node_modules", "tsx", "dist", "cli.mjs");
const r = spawnSync(process.execPath, [tsx, path.join(here, "slate.ts"), ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);

