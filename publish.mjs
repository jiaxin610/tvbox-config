#!/usr/bin/env node
/**
 * Publish current project (dist + sources) to GitHub Pages.
 * Does NOT scan. Needs .gh-token.txt (repo + workflow).
 *
 * Usage: node publish.mjs
 *    or: publish.bat
 */
import { spawn, execFileSync } from "node:child_process";
import { readFile, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const tokenPath = join(ROOT, ".gh-token.txt");
const nodeBin = process.execPath;
const PAGES = "https://jiaxin610.github.io/tvbox-config/config.json";

async function ensureToken() {
  try {
    const t = (await readFile(tokenPath, "utf8")).trim();
    if (t.length >= 20) {
      console.log("[token] ok (.gh-token.txt)");
      return;
    }
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
  console.error(`
[ERROR] Missing GitHub Token
Save token to:
  ${tokenPath}
Scopes: repo, workflow
Create: https://github.com/settings/tokens/new?scopes=repo,workflow
`);
  process.exit(1);
}

try {
  await access(join(ROOT, "dist", "config.json"));
} catch {
  console.error("[ERROR] dist/config.json missing. Run scan first: scan-publish.bat");
  process.exit(1);
}

await ensureToken();
console.log("[publish] uploading via API...");
await new Promise((resolve, reject) => {
  const child = spawn(nodeBin, [join(ROOT, "push-via-api.mjs")], {
    cwd: ROOT,
    stdio: "inherit",
  });
  child.on("exit", (code) =>
    code === 0 ? resolve() : reject(new Error(`push exit ${code}`)),
  );
});

console.log(`
[OK] published
TVBox URL:
${PAGES}
Wait 1-2 min for Actions, then refresh TVBox.
`);
