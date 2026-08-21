#!/usr/bin/env node
/**
 * Seed empty GitHub repo + upload tree via Contents/Git API.
 * Token from .gh-token.txt — never printed.
 */
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OWNER = "jiaxin610";
const REPO = "tvbox-config";
const BRANCH = "main";

const SKIP = new Set([
  ".git",
  "node_modules",
  ".venv",
  ".gh-token.txt",
  ".gitee-token.txt",
]);

async function walk(dir, out = []) {
  for (const name of await readdir(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const s = await stat(p);
    if (s.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

async function gh(token, method, path, body) {
  const resp = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "tvbox-config-uploader",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!resp.ok) {
    const err = new Error(`${method} ${path} -> ${resp.status} ${text.slice(0, 500)}`);
    err.status = resp.status;
    err.json = json;
    throw err;
  }
  return json;
}

const token = (await readFile(join(ROOT, ".gh-token.txt"), "utf8")).trim();

// 1) Seed empty repo with a tiny README so Git Data API works
try {
  await gh(token, "PUT", `/repos/${OWNER}/${REPO}/contents/README.md`, {
    message: "chore: init repo",
    content: Buffer.from("# tvbox-config\n").toString("base64"),
    branch: BRANCH,
  });
  console.log("seeded README");
} catch (err) {
  if (err.status === 422) console.log("seed skipped (already exists)");
  else throw err;
}

const files = await walk(ROOT);
console.log(`files=${files.length}`);

const tree = [];
for (const abs of files) {
  const rel = relative(ROOT, abs).replaceAll("\\", "/");
  const content = await readFile(abs);
  const blob = await gh(token, "POST", `/repos/${OWNER}/${REPO}/git/blobs`, {
    content: content.toString("base64"),
    encoding: "base64",
  });
  tree.push({ path: rel, mode: "100644", type: "blob", sha: blob.sha });
  process.stdout.write(".");
}
console.log("\nblobs ok");

const ref = await gh(token, "GET", `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
const parentSha = ref.object.sha;
const baseCommit = await gh(token, "GET", `/repos/${OWNER}/${REPO}/git/commits/${parentSha}`);

const treeObj = await gh(token, "POST", `/repos/${OWNER}/${REPO}/git/trees`, {
  base_tree: baseCommit.tree.sha,
  tree,
});

const commit = await gh(token, "POST", `/repos/${OWNER}/${REPO}/git/commits`, {
  message: "Deploy TVBox IPTV config for GitHub Pages",
  tree: treeObj.sha,
  parents: [parentSha],
});

await gh(token, "PATCH", `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
  sha: commit.sha,
  force: true,
});
console.log(`commit=${commit.sha}`);

// Enable Pages (Actions)
try {
  await gh(token, "POST", `/repos/${OWNER}/${REPO}/pages`, {
    build_type: "workflow",
  });
  console.log("pages enabled (workflow)");
} catch (err) {
  console.warn("pages POST:", String(err.message).slice(0, 180));
}

// Trigger workflow
try {
  await gh(
    token,
    "POST",
    `/repos/${OWNER}/${REPO}/actions/workflows/pages.yml/dispatches`,
    { ref: BRANCH },
  );
  console.log("workflow dispatched");
} catch (err) {
  console.warn("dispatch:", String(err.message).slice(0, 180));
}

const pagesUrl = `https://${OWNER}.github.io/${REPO}/config.json`;
await writeFile(
  join(ROOT, "记事本", "配置地址.txt"),
  `${pagesUrl}\n`,
  "utf8",
);
console.log(`PAGES_URL=${pagesUrl}`);
console.log(`REPO_URL=https://github.com/${OWNER}/${REPO}`);
