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

/** Merge CMS sites with warehouse sites; dedupe CMS by api, CSP by api+ext */
export function mergeSiteLists(cmsSites, warehouseSites) {
  const seenKey = new Set();
  const seenCmsApi = new Set();
  const seenCspFp = new Set();
  const out = [];
  for (const s of [...cmsSites, ...warehouseSites]) {
    const api = String(s.api || "").trim();
    const apiBase = api.split("?")[0];
    const type = Number(s.type);
    const isCsp = type === 3 && /^csp_/i.test(apiBase);

    if (isCsp) {
      // 同 api 可有多实例（夸快/玩偶/蜡笔…），靠 ext 区分
      const fp = `${apiBase}\0${JSON.stringify(s.ext ?? null)}`;
      if (seenCspFp.has(fp)) continue;
      seenCspFp.add(fp);
    } else if (api && seenCmsApi.has(api)) {
      continue;
    } else if (api) {
      seenCmsApi.add(api);
    }

    let site = s;
    if (site.key && seenKey.has(site.key)) {
      site = { ...site, key: `${site.key}_${out.length + 1}` };
    }
    if (site.key) seenKey.add(site.key);
    out.push(site);
  }
  return out;
}

/** 网盘类站点：禁止自动换源，登录时应弹二维码而不是跳下一源 */
const PAN_API_RE =
  /^csp_(?:Config|Pan|Ali|Quark|UC|Baidu|Duopan|Wogg|Wobg|PanSou|PanSearch|PanWeb|YunPan|Alist|Push)/i;

const PAN_NAME_RE =
  /网盘|云盘|夸克|阿里|阿离|夸父|盘搜|弹幕配置|歌配置|扫码|登录|UC盘|百度盘|115|迅雷云/i;

/** 搜索/聚合类网盘站：保留各自 jar（夸快需新版 spider 才能搜全） */
const PAN_SEARCH_API_RE = /^csp_(?:PanWebShare|PanSou|PanSearch)$/i;

/** 与 Config 同 login jar（0810）：仅 Duopan/玩歌 等 */
const PAN_LOGIN_JAR_API_RE = /^csp_(?:Duopan|WoGG|Push)$/i;

/** 夸父/阿离等：无 site jar，走全局 spider（0820），与 TOP 仓一致 */
const GLOBAL_PAN_PLAY_API_RE = /^csp_Pan(?:Ali|Quark|UC|Baidu)$/i;

export function isPanLoginSite(site) {
  const api = String(site?.api || "").split("?")[0].trim();
  if (PAN_SEARCH_API_RE.test(api)) return false;
  const name = String(site?.name || "");
  const key = String(site?.key || "");
  if (PAN_API_RE.test(api)) return true;
  if (PAN_NAME_RE.test(`${name} ${key}`)) return true;
  return false;
}

export function needsSharedPanLoginJar(site) {
  const api = String(site?.api || "").split("?")[0].trim();
  if (PAN_SEARCH_API_RE.test(api)) return false;
  if (GLOBAL_PAN_PLAY_API_RE.test(api)) return false;
  return PAN_LOGIN_JAR_API_RE.test(api);
}

/** 去掉夸父/阿离等 site.jar，强制使用全局 spider（登录态在 0820） */
export function stripGlobalPanPlayJar(sites) {
  return (sites || []).map((s) => {
    const api = String(s.api || "").split("?")[0];
    if (!GLOBAL_PAN_PLAY_API_RE.test(api)) return s;
    const { jar, ...rest } = s;
    return rest;
  });
}

/**
 * 扫码/玩歌：login jar（0810）。
 * 夸父/阿离：全局 spider（0820）；保留 TOP 第二个 Config（无 jar）用于 0820 扫码。
 */
export function hardenPanLoginSites(sites, globalSpider = "") {
  const list = [...(sites || [])];
  const configSite = list.find(
    (s) => /^csp_Config$/i.test(String(s.api || "").split("?")[0]),
  );
  const loginJar =
    (configSite && String(configSite.jar || "").trim()) ||
    String(globalSpider || "").trim() ||
    "";

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
      const hasOwnJar = String(s.jar || "").trim();
      if (!hasOwnJar) {
        // TOP「配置｜中心」：无 jar → 全局 spider 扫码（夸父/阿离播放）
        configs.push({
          ...s,
          changeable: 0,
          searchable: 0,
          filterable: 0,
        });
        continue;
      }
      if (sawConfig) continue;
      sawConfig = true;
      const prefix = String(s.name || "").match(/^\[[^\]]+\]/)?.[0] || "";
      const cfg = {
        ...s,
        name: `${prefix}🔑扫码登录｜网盘`,
        changeable: 0,
        searchable: 0,
        filterable: 0,
      };
      if (loginJar) cfg.jar = loginJar;
      configs.push(cfg);
      continue;
    }
    if (isPanLoginSite(s)) {
      const pan = { ...s, changeable: 0 };
      if (needsSharedPanLoginJar(s)) {
        if (loginJar) pan.jar = loginJar;
        else delete pan.jar;
      }
      pans.push(pan);
    } else {
      other.push(s);
    }
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
