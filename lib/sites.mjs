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
  for (const s of list || []) {
    const api = String(s.api || "").trim();
    const name = String(s.name || "").trim();
    if (!api || !name) continue;
    if (!/^https?:\/\//i.test(api)) continue;
    if (seen.has(api)) continue;
    seen.add(api);
    const key =
      String(s.key || name)
        .toLowerCase()
        .replace(/[^a-z0-9_\u4e00-\u9fa5]+/gi, "_")
        .replace(/^_+|_+$/g, "") || `site_${sites.length + 1}`;
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
