/** Fetch and merge TVBox single-warehouse (整仓) JSON configs */

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

async function fetchConfig(url, userAgent = "tvbox-warehouse/1.0") {
  const resp = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": userAgent, Accept: "application/json,*/*" },
  });
  if (!resp.ok) throw new Error(`http_${resp.status}`);
  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("not_json");
  }
  if (!data || typeof data !== "object") throw new Error("bad_json");
  return data;
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
  if (!sourceName || n.startsWith(`[${sourceName}]`)) return n;
  return `[${sourceName}]${n}`;
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
      report.push({ name, url, ok: true, sites: nSites });

      if (cfg.spider && !spider) spider = cfg.spider;
      if (cfg.wallpaper && !wallpaper) wallpaper = cfg.wallpaper;

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
