/** Load and normalize TVBox VOD sites */

export function parseSitesTxt(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("|");
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim();
    const api = line.slice(idx + 1).trim();
    if (!name || !/^https?:\/\//i.test(api)) continue;
    out.push({ name, api });
  }
  return out;
}

export function normalizeSites(list) {
  const seen = new Set();
  const sites = [];
  let idx = 0;
  for (const s of list || []) {
    const api = String(s.api || "").trim();
    const name = String(s.name || "").trim();
    if (!api || !name) continue;
    if (!/^https?:\/\//i.test(api)) continue;
    if (seen.has(api)) continue;
    seen.add(api);
    let key = String(s.key || name)
      .toLowerCase()
      .replace(/[^a-z0-9_\u4e00-\u9fa5]+/gi, "_")
      .replace(/^_+|_+$/g, "");
    if (!key || seen.has(`key:${key}`)) key = `site_${++idx}`;
    seen.add(`key:${key}`);
    sites.push({
      key,
      name,
      type: Number.isFinite(Number(s.type)) ? Number(s.type) : 1,
      api,
      searchable: s.searchable === 0 ? 0 : 1,
      quickSearch: s.quickSearch === 0 ? 0 : 1,
      filter: s.filter === 0 ? 0 : 1,
      ...(s.ext ? { ext: s.ext } : {}),
      ...(s.jar ? { jar: s.jar } : {}),
    });
  }
  return sites;
}

/** Merge CMS sites with warehouse sites; dedupe by key */
export function mergeSiteLists(cmsSites, warehouseSites) {
  const seenKey = new Set();
  const seenApi = new Set();
  const out = [];
  for (const s of [...cmsSites, ...warehouseSites]) {
    if (s.api && seenApi.has(s.api)) continue;
    if (s.key && seenKey.has(s.key)) {
      s = { ...s, key: `${s.key}_${out.length + 1}` };
    }
    if (s.api) seenApi.add(s.api);
    if (s.key) seenKey.add(s.key);
    out.push(s);
  }
  return out;
}

/** 网盘类站点：禁止自动换源，登录时应弹二维码而不是跳下一源 */
const PAN_API_RE =
  /^csp_(?:Config|Pan|Ali|Quark|UC|Baidu|Duopan|Wogg|Wobg|PanSou|PanSearch|PanWeb|YunPan|Alist|Push)/i;

const PAN_NAME_RE =
  /网盘|云盘|夸克|阿里|阿离|夸父|盘搜|弹幕配置|歌配置|扫码|登录|UC盘|百度盘|115|迅雷云/i;

export function isPanLoginSite(site) {
  const api = String(site?.api || "").split("?")[0].trim();
  const name = String(site?.name || "");
  const key = String(site?.key || "");
  if (PAN_API_RE.test(api)) return true;
  if (PAN_NAME_RE.test(`${name} ${key}`)) return true;
  return false;
}

/**
 * 强制网盘站 changeable=0；把扫码配置站提前到首页后，便于先登录再播。
 */
export function hardenPanLoginSites(sites) {
  const list = (sites || []).map((s) => {
    if (!isPanLoginSite(s)) return s;
    return { ...s, changeable: 0 };
  });

  const home = [];
  const configs = [];
  const pans = [];
  const other = [];
  let sawConfig = false;

  for (const s of list) {
    if (Number(s.indexs) === 1) {
      home.push(s);
      continue;
    }
    const api = String(s.api || "").split("?")[0];
    if (/^csp_Config$/i.test(api)) {
      if (sawConfig) continue;
      sawConfig = true;
      const prefix = String(s.name || "").match(/^\[[^\]]+\]/)?.[0] || "";
      configs.push({
        ...s,
        name: `${prefix}🔑扫码登录｜网盘`,
        changeable: 0,
        searchable: 0,
        filterable: 0,
      });
      continue;
    }
    if (isPanLoginSite(s)) pans.push(s);
    else other.push(s);
  }

  return [...home, ...configs, ...pans, ...other];
}

/** Optional light check: GET api and see if JSON-ish */
export async function probeSite(api, { timeoutMs = 8000, userAgent = "tvbox-sites/1.0" } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetch(api, {
      method: "GET",
      redirect: "follow",
      signal: ac.signal,
      headers: { "User-Agent": userAgent, Accept: "application/json,*/*" },
    });
    const text = (await resp.text()).slice(0, 500);
    const ok = resp.ok && (text.includes("{") || text.includes("list") || text.includes("vod"));
    return { api, ok, status: resp.status, reason: ok ? "ok" : "bad_body" };
  } catch (err) {
    return {
      api,
      ok: false,
      status: 0,
      reason: err?.name === "AbortError" ? "timeout" : `error:${err?.name || "unknown"}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
