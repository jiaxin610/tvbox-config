#!/usr/bin/env node
/**
 * 一键：扫描 subscribe.txt → 生成 dist → 发布到 GitHub Pages
 *
 * 用法：
 *   1. 编辑 sources/subscribe.txt（每行一个订阅 URL）
 *   2. 确保有 Token：.gh-token.txt 或已 gh auth login
 *   3. node scan-publish.mjs
 *      或双击 扫并发布.bat
 */
import { spawn } from "node:child_process";
import { writeFile, access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = dirname(fileURLToPath(import.meta.url));
const nodeBin = process.execPath;

function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(nodeBin, [join(ROOT, script)], {
      cwd: ROOT,
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exit ${code}`));
    });
  });
}

async function ensureToken() {
  const tokenPath = join(ROOT, ".gh-token.txt");
  try {
    await access(tokenPath);
    const t = (await readFile(tokenPath, "utf8")).trim();
    if (t.length >= 20) return;
  } catch {
    /* missing */
  }

  // try gh auth token
  try {
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out.length >= 20) {
      await writeFile(tokenPath, out, "utf8");
      console.log("[token] 已从 gh auth token 写入 .gh-token.txt");
      return;
    }
  } catch {
    /* no gh */
  }

  console.error(`
缺少 GitHub Token。
请把 Token 保存到：
  ${tokenPath}
需要权限：repo、workflow
生成地址：https://github.com/settings/tokens/new?scopes=repo,workflow
`);
  process.exit(1);
}

console.log("======== 1/2 扫描订阅 ========");
await run("api-once.mjs");
console.log("\n======== 2/2 发布到 GitHub Pages ========");
await ensureToken();
await run("push-via-api.mjs");
console.log(`
完成。
TVBox 配置地址：
https://jiaxin610.github.io/tvbox-config/config.json

等 1～2 分钟 Actions 部署后再刷新 TVBox。
`);
