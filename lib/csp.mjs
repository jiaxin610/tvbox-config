/** PG / 盘搜类 CSP 站点（QuarkPanso 等） */

import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

export function rewriteTokenmExt(ext, tokenmUrl) {
  const raw = String(ext || "").trim();
  if (!raw) return tokenmUrl;
  return raw
    .replace(/\.\/lib\/tokenm\.json/gi, tokenmUrl)
    .replace(/https?:\/\/[^\s$]*tokenm\.json/gi, tokenmUrl);
}

export async function loadCspSitesJson(path) {
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/**
 * Prepare pan-search CSP sites with hosted jar + tokenm.
 * Returns sites ready to inject (empty if pg jar unavailable).
 */
export function prepareCspSites(list, { pgJar = "", tokenmUrl = "", prefix = "盘搜" } = {}) {
  if (!isValidJar(pgJar) || !tokenmUrl) return [];
  const out = [];
  for (const s of list || []) {
    if (!s || typeof s !== "object") continue;
    const api = String(s.api || "").trim();
    if (!api) continue;
    const { jarNeed, ...rest } = s;
    const site = {
      ...rest,
      key: String(s.key || api).trim(),
      name: prefixName(s.name || api, prefix),
      type: Number.isFinite(Number(s.type)) ? Number(s.type) : 3,
      api,
      searchable: s.searchable === 0 ? 0 : 1,
      quickSearch: s.quickSearch === 0 ? 0 : 1,
      filterable: s.filterable === 0 ? 0 : 1,
      timeout: Number(s.timeout) > 0 ? Number(s.timeout) : 60,
      ext: rewriteTokenmExt(s.ext, tokenmUrl),
      jar: pgJar,
    };
    out.push(site);
  }
  return out;
}

function prefixName(name, prefix) {
  const n = String(name || "").trim();
  if (!prefix || n.startsWith(`[${prefix}]`)) return n;
  return `[${prefix}]${n}`;
}

export function isValidJar(jar) {
  const s = String(jar || "").split(";")[0].trim();
  return /^https?:\/\//i.test(s);
}

/** Insert CSP sites right after the home site (index 0). */
export function injectCspSites(sites, cspSites) {
  if (!cspSites?.length) return sites || [];
  const list = [...(sites || [])];
  const seenApi = new Set(cspSites.map((s) => String(s.api || "")));
  const filtered = list.filter((s) => {
    const api = String(s.api || "");
    // keep TOP 盘搜 (csp_PanSou) — different from PG QuarkPanso family
    if (api === "csp_PanSou") return true;
    return !seenApi.has(api);
  });
  if (!filtered.length) return [...cspSites];
  return [filtered[0], ...cspSites, ...filtered.slice(1)];
}

async function fileIsJar(path) {
  try {
    await access(path);
    const buf = await readFile(path);
    return buf.length > 1000 && buf[0] === 0x50 && buf[1] === 0x4b ? buf : null;
  } catch {
    return null;
  }
}

async function downloadJar(url, onLog) {
  onLog(`[pg-jar] download ${url}`);
  const resp = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "tvbox-publish/1.0", Accept: "*/*" },
  });
  if (!resp.ok) throw new Error(`http_${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length < 1000) throw new Error(`too_small_${buf.length}`);
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error("not_jar");
  return buf;
}

/**
 * Ensure publish/jar/pg.jar exists; return hosted jar string with md5.
 */
export async function mirrorPgJar({
  outDir,
  pagesBase,
  jarListPath,
  onLog = () => {},
} = {}) {
  const jarDir = join(outDir, "jar");
  const jarPath = join(jarDir, "pg.jar");
  await mkdir(jarDir, { recursive: true });

  let buf = await fileIsJar(jarPath);
  if (!buf) {
    let urls = [];
    try {
      urls = (await readFile(jarListPath, "utf8"))
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#") && /^https?:\/\//i.test(l));
    } catch {
      /* optional */
    }
    for (const u of urls) {
      try {
        buf = await downloadJar(u, onLog);
        await writeFile(jarPath, buf);
        onLog(`[pg-jar] saved ${buf.length} bytes`);
        break;
      } catch (err) {
        onLog(`[pg-jar] fail ${err.message} <- ${u}`);
      }
    }
  } else {
    onLog(`[pg-jar] reuse local ${buf.length} bytes`);
  }

  if (!buf) return "";
  const hosted = `${String(pagesBase || "").replace(/\/$/, "")}/jar/pg.jar`;
  const md5 = createHash("md5").update(buf).digest("hex");
  return `${hosted};md5;${md5}`;
}

/** Copy sources/tokenm.json -> publish/tokenm.json; return public URL */
export async function hostTokenm({
  srcPath,
  outDir,
  pagesBase,
  onLog = () => {},
} = {}) {
  let text;
  try {
    text = await readFile(srcPath, "utf8");
    JSON.parse(text);
  } catch (err) {
    onLog(`[tokenm] skip: ${err.message}`);
    return "";
  }
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "tokenm.json"), text, "utf8");
  const url = `${String(pagesBase || "").replace(/\/$/, "")}/tokenm.json`;
  onLog(`[tokenm] hosted ${url}`);
  return url;
}
