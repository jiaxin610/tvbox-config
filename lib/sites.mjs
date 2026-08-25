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

/**
 * Merge CMS + warehouse sites.
 * CSP 同 api 可有多实例（夸快/玩偶…、两个 Config），用 key+ext 区分，不按 api 硬去重。
 */
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
      const fp = `${apiBase}\0${String(s.key || "")}\0${JSON.stringify(s.ext ?? null)}\0${String(s.jar || "")}`;
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

/**
 * 夸克/阿里登录态在全局 spider（0820）里。
 * 把「无 jar 的 Config / 夸父 / 阿离 / 盘搜」显式绑到同一 spider.jar，避免壳用错 jar。
 * 歌配置 / 玩歌仍保留各自 pan-login.jar（0810），互不影响。
 */
export function bindSpiderLoginJar(sites, spiderField) {
  const jar = String(spiderField || "").trim();
  if (!jar) return sites || [];
  return (sites || []).map((s) => {
    const api = String(s.api || "").split("?")[0].trim();
    const hasJar = String(s.jar || "").trim();

    if (/^csp_Config$/i.test(api) && !hasJar) {
      return { ...s, jar, changeable: 0 };
    }
    if (/^csp_Pan(?:Ali|Quark|UC|Baidu)$/i.test(api)) {
      return { ...s, jar, changeable: 0 };
    }
    if (/^csp_Pan(?:WebShare|Sou|Search)$/i.test(api) && !hasJar) {
      return { ...s, jar };
    }
    return s;
  });
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
