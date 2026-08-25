/** Fetch and merge TVBox single-warehouse (整仓) JSON configs */

import { parseTvboxConfigText } from "./config-parse.mjs";

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
  const resp = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": userAgent, Accept: "application/json,*/*" },
  });
  if (!resp.ok) throw new Error(`http_${resp.status}`);
  const text = await resp.text();
  try {
    return parseTvboxConfigText(text);
  } catch (err) {
    throw new Error(err.message || "not_json");
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
  // 主仓不改名，直接解析进接口；副仓加前缀区分
  if (!sourceName || sourceName === "TOP" || sourceName === "主仓") return n;
  if (n.startsWith(`[${sourceName}]`)) return n;
  return `[${sourceName}]${n}`;
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
 */
export async function mergeWarehouses(entries, { onLog = () => {} } = {}) {
  const usedKeys = new Set();
  const sites = [];
  const parses = [];
  const flags = [];
  let spider = "";
  let wallpaper = "";
  const report = [];

  for (const { name, url } of entries) {
    try {
      onLog(`warehouse ${name} -> ${url}`);
      const cfg = await fetchConfig(url);
      const nSites = Array.isArray(cfg.sites) ? cfg.sites.length : 0;
      onLog(`parsed ${name}: sites=${nSites} spider=${cfg.spider ? "yes" : "no"}`);
      report.push({ name, url, ok: true, sites: nSites });

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

      for (const s of cfg.sites || []) {
        if (!s || typeof s !== "object") continue;
        const baseKey = String(s.key || s.name || `wh_${sites.length}`).trim();
        sites.push({
          ...s,
          key: uniqueKey(baseKey, usedKeys),
          name: prefixName(s.name, name),
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
    report,
  };
}
