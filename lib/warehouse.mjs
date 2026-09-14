/** Fetch and merge TVBox single-warehouse (整仓) JSON configs */

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { preferPublicDns, fetchTextResilient } from "./dns.mjs";
preferPublicDns();

import { parseTvboxConfigText } from "./config-parse.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = join(ROOT, "sources", "cache");

export function parseWarehousesTxt(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("|");
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim();
    const url = line.slice(idx + 1).trim();
    if (!name || !/^https?:\/\//i.test(url)) continue;
    out.push({ name, url });
  }
  return out;
}

/** Heuristic: full TVBox config URL vs CMS provide/vod API */
export function isLikelyWarehouseUrl(url) {
  const u = url.toLowerCase();
  if (/\/api\.php\/provide\/vod/i.test(u)) return false;
  if (/provide\/vod/i.test(u) && !u.endsWith(".json")) return false;
  if (u.endsWith(".json")) return true;
  if (u.endsWith(".txt") && (u.includes("tvbox") || u.includes("/box/") || u.includes("final"))) {
    return true;
  }
  if (/\/ok\/?$/.test(u)) return true;
  if (u.includes("top98") || u.includes("/box/") || u.includes("fmbox")) return true;
  if (u.includes(".php") && !u.includes("provide/vod")) return true;
  if (!u.includes("api.php") && !u.includes("provide")) return true;
  return false;
}

async function fetchConfig(url, userAgent = "okhttp/3.15") {
  const { ok, status, text } = await fetchTextResilient(url, {
    headers: { "User-Agent": userAgent, Accept: "application/json,*/*" },
    timeoutMs: 20000,
  });
  if (!ok) throw new Error(`http_${status}`);
  try {
    return parseTvboxConfigText(text);
  } catch (err) {
    throw new Error(err.message || "not_json");
  }
}

/** 电脑 DNS 污染/解析失败时，可用手机下载的源文件：sources/cache/TOP.json */
async function loadCachedConfig(name) {
  const path = join(CACHE_DIR, `${name}.json`);
  try {
    const text = await readFile(path, "utf8");
    return parseTvboxConfigText(text);
  } catch {
    return null;
  }
}

function uniqueKey(base, used) {
  let k = base || "site";
  let n = 1;
  while (used.has(k)) {
    k = `${base}_${n++}`;
  }
  used.add(k);
  return k;
}

function prefixName(name, sourceName) {
  const n = String(name || "").trim();
  // 唯一主仓不改名（TOP / 主仓 / ONE）
  if (!sourceName || sourceName === "TOP" || sourceName === "主仓" || sourceName === "ONE") {
    return n;
  }
  if (n.startsWith(`[${sourceName}]`)) return n;
  return `[${sourceName}]${n}`;
}

/** 相对路径 → 绝对 URL（相对仓地址），保留 ;md5; 后缀 */
export function resolveFieldUrl(field, baseUrl) {
  if (field == null || field === "") return field;
  if (typeof field !== "string") return field;
  const parts = field.split(";");
  const raw = parts[0].trim();
  if (!raw) return field;
  if (/^https?:\/\//i.test(raw)) return field;
  if (/^csp_/i.test(raw)) return field;
  if (!baseUrl) return field;
  try {
    const abs = new URL(raw, baseUrl).href;
    if (!/^https?:\/\//i.test(abs)) return field;
    parts[0] = abs;
    return parts.join(";");
  } catch {
    return field;
  }
}

function absolutizeSite(site, baseUrl) {
  const s = { ...site };
  if (s.jar) s.jar = resolveFieldUrl(s.jar, baseUrl);
  if (s.api) s.api = resolveFieldUrl(s.api, baseUrl);
  if (typeof s.ext === "string") s.ext = resolveFieldUrl(s.ext, baseUrl);
  return s;
}

/** Resolve spider jar to absolute http(s); drop local/relative paths */
export function resolveSpider(spider, baseUrl) {
  const s = String(spider || "").trim();
  if (!s) return "";
  // strip ;md5 hash suffix used by some TVBox configs
  const [pathPart] = s.split(";");
  const raw = pathPart.trim();
  if (/^https?:\/\//i.test(raw)) return s.startsWith("http") ? s : raw;
  if (!baseUrl) return "";
  try {
    const abs = new URL(raw, baseUrl).href;
    return /^https?:\/\//i.test(abs) ? abs : "";
  } catch {
    return "";
  }
}

export function isValidSpider(spider) {
  const s = String(spider || "").split(";")[0].trim();
  return /^https?:\/\//i.test(s);
}

/** Drop csp_* sites that need jar when spider is missing/invalid */
export function filterSitesForSpider(sites, spider) {
  const hasGlobal = isValidSpider(spider);
  return (sites || []).filter((s) => {
    const api = String(s.api || "");
    const type = Number(s.type);
    const hasOwnJar = isValidSpider(s.jar);
    // type 3 + csp_xxx needs global spider or site-level jar
    if (type === 3 && /^csp_/i.test(api)) return hasGlobal || hasOwnJar;
    if (type === 3 && !/^https?:\/\//i.test(api)) return hasGlobal || hasOwnJar;
    return true;
  });
}

/**
 * Fetch warehouse configs and merge sites/parses/flags/spider.
 * 网络相关全局项（doh/rules/ijk）只取主仓（第一条成功拉取的仓），
 * 避免副仓 DoH/嗅探规则改写 DNS / 劫持网盘直链导致中途停加载。
 */
export async function mergeWarehouses(entries, { onLog = () => {} } = {}) {
  const usedKeys = new Set();
  const sites = [];
  const parses = [];
  const flags = [];
  let spider = "";
  let wallpaper = "";
  let danmaku = "";
  let ijk = [];
  let doh = [];
  let rules = [];
  let primaryNetworkLocked = false;
  const report = [];

  for (const { name, url } of entries) {
    try {
      onLog(`warehouse ${name} -> ${url}`);
      let cfg;
      let fromCache = false;
      try {
        cfg = await fetchConfig(url);
      } catch (fetchErr) {
        cfg = await loadCachedConfig(name);
        if (!cfg) throw fetchErr;
        fromCache = true;
        onLog(`warehouse ${name}: live fetch failed (${fetchErr.message}), using sources/cache/${name}.json`);
      }
      const nSites = Array.isArray(cfg.sites) ? cfg.sites.length : 0;
      onLog(`parsed ${name}: sites=${nSites} spider=${cfg.spider ? "yes" : "no"}${fromCache ? " [cache]" : ""}`);
      report.push({ name, url, ok: true, sites: nSites, cache: fromCache });

      // 缓存文件没有真实 base URL 时，仍用声明的仓地址做相对路径解析
      const baseUrl = url;

      if (!spider && cfg.spider) {
        const resolved = resolveSpider(cfg.spider, url);
        if (resolved) {
          spider = resolved;
          onLog(`spider -> ${resolved.split(";")[0]}`);
        } else {
          onLog(`spider skipped (relative/local): ${cfg.spider}`);
        }
      }
      if (cfg.wallpaper && !wallpaper && /^https?:\/\//i.test(cfg.wallpaper)) {
        wallpaper = cfg.wallpaper;
      }
      if (!danmaku && cfg.danmaku && /^https?:\/\//i.test(String(cfg.danmaku))) {
        danmaku = String(cfg.danmaku);
      }

      // ijk / doh / rules：只取第一个成功拉取的仓（当前仅 ONE）
      if ((!ijk || !ijk.length) && Array.isArray(cfg.ijk) && cfg.ijk.length) {
        ijk = cfg.ijk;
        onLog(`ijk <- ${name}: ${cfg.ijk.map((g) => g.group).join(",")}`);
      }
      if (!primaryNetworkLocked) {
        doh = Array.isArray(cfg.doh) ? cfg.doh : [];
        rules = Array.isArray(cfg.rules) ? cfg.rules : [];
        primaryNetworkLocked = true;
        onLog(
          `primary(${name}) network: doh=${doh.length} rules=${rules.length}`,
        );
      }

      for (const s of cfg.sites || []) {
        if (!s || typeof s !== "object") continue;
        const baseKey = String(s.key || s.name || `wh_${sites.length}`).trim();
        const abs = absolutizeSite(s, url);
        sites.push({
          ...abs,
          key: uniqueKey(baseKey, usedKeys),
          name: prefixName(abs.name, name),
        });
      }

      for (const p of cfg.parses || []) {
        if (p && typeof p === "object") parses.push(p);
      }
      for (const f of cfg.flags || []) {
        if (f != null) flags.push(f);
      }
    } catch (err) {
      report.push({ name, url, ok: false, error: String(err.message || err) });
      onLog(`skip ${name}: ${err.message}`);
    }
  }

  return {
    sites,
    parses,
    flags,
    spider,
    wallpaper,
    danmaku,
    ijk,
    doh,
    rules,
    report,
  };
}
