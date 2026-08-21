#!/usr/bin/env node
/** Publish only (skip scan). Needs .gh-token.txt */
import { spawn } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = dirname(fileURLToPath(import.meta.url));
const tokenPath = join(ROOT, ".gh-token.txt");
const nodeBin = process.execPath;

async function ensureToken() {
  try {
    const t = (await readFile(tokenPath, "utf8")).trim();
    if (t.length >= 20) return;
  } catch {
    /* missing */
  }
  try {
    const out = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out.length >= 20) {
      await writeFile(tokenPath, out, "utf8");
      console.log("[token] wrote from gh auth token");
      return;
    }
  } catch {
    /* no gh */
  }
  console.error(`Missing token file:\n  ${tokenPath}\nNeed scopes: repo, workflow`);
  process.exit(1);
}

await ensureToken();
await new Promise((resolve, reject) => {
  const child = spawn(nodeBin, [join(ROOT, "push-via-api.mjs")], {
    cwd: ROOT,
    stdio: "inherit",
  });
  child.on("exit", (c) => (c === 0 ? resolve() : reject(new Error("push failed"))));
});
console.log("\nOK https://jiaxin610.github.io/tvbox-config/config.json\n");
