/** Push repo to GitHub via API (token in .gh-token.txt) */
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OWNER = "jiaxin610";
const REPO = "tvbox-config";
const BRANCH = "main";

const PUSH_PATHS = [
  "publish",
  "sources",
  "lib",
  "publish.mjs",
  "publish.bat",
  "update.bat",
  "package.json",
  "README.md",
  ".github",
  ".gitignore",
];

async function ensureToken() {
  const p = join(ROOT, ".gh-token.txt");
  try {
    const t = (await readFile(p, "utf8")).trim();
    if (t.length >= 20) return t;
  } catch {
    /* missing */
  }
  try {
    const t = execFileSync("gh", ["auth", "token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (t.length >= 20) {
      await writeFile(p, t, "utf8");
      return t;
    }
  } catch {
    /* no gh */
  }
  throw new Error(`缺少 Token: ${p} (需要 repo + workflow 权限)`);
}

async function collectFiles() {
  const files = [];
  async function walk(base, rel = "") {
    let names;
    try {
      names = await readdir(base);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === ".git" || name === "node_modules" || name === ".gh-token.txt") continue;
      const p = join(base, name);
      const r = rel ? `${rel}/${name}` : name;
      const s = await stat(p);
      if (s.isDirectory()) await walk(p, r);
      else files.push({ abs: p, rel: r.replaceAll("\\", "/") });
    }
  }
  for (const top of PUSH_PATHS) {
    await walk(join(ROOT, top), top);
  }
  return files;
}

async function gh(token, method, path, body) {
  const resp = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "tvbox-publish/1.0",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`${method} ${path} -> ${resp.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

export async function pushToGithub({ onLog = console.log } = {}) {
  const token = await ensureToken();
  const files = await collectFiles();
  onLog(`[push] files=${files.length}`);

  const tree = [];
  for (const f of files) {
    const content = await readFile(f.abs);
    const blob = await gh(token, "POST", `/repos/${OWNER}/${REPO}/git/blobs`, {
      content: content.toString("base64"),
      encoding: "base64",
    });
    tree.push({ path: f.rel, mode: "100644", type: "blob", sha: blob.sha });
    process.stdout.write(".");
  }
  onLog("\n[push] blobs ok");

  const ref = await gh(token, "GET", `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
  const parentSha = ref.object.sha;
  const baseCommit = await gh(token, "GET", `/repos/${OWNER}/${REPO}/git/commits/${parentSha}`);
  const treeObj = await gh(token, "POST", `/repos/${OWNER}/${REPO}/git/trees`, {
    base_tree: baseCommit.tree.sha,
    tree,
  });
  const commit = await gh(token, "POST", `/repos/${OWNER}/${REPO}/git/commits`, {
    message: "publish: update TVBox config",
    tree: treeObj.sha,
    parents: [parentSha],
  });
  await gh(token, "PATCH", `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
    sha: commit.sha,
    force: true,
  });
  onLog(`[push] commit=${commit.sha.slice(0, 8)}`);

  try {
    await gh(token, "POST", `/repos/${OWNER}/${REPO}/actions/workflows/pages.yml/dispatches`, {
      ref: BRANCH,
    });
    onLog("[push] pages deploy triggered");
  } catch (e) {
    onLog(`[push] pages trigger skip: ${e.message}`);
  }

  const url = `https://${OWNER}.github.io/${REPO}/config.json`;
  onLog(`[push] ${url}`);
  return url;
}
