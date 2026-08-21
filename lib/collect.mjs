/** IPTV subscribe scanner: fetch M3U/TXT → merge → probe → keep alive */

import { parseM3u } from "./m3u.mjs";
import { probeAll } from "./probe.mjs";

function isAllowedUrl(url, blockHostRe, allowIpHost) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname;
  if (!host) return false;
  if (blockHostRe.test(host)) return false;
  if (!allowIpHost && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return false;
  return true;
}

async function fetchText(url, userAgent) {
  const resp = await fetch(url, {
    headers: { "User-Agent": userAgent, Accept: "*/*" },
    redirect: "follow",
  });
  if (!resp.ok) throw new Error(`${url} -> ${resp.status}`);
  return resp.text();
}

/** Parse dial-style TXT: Group,#genre# then Name,url */
export function parseTxt(text, defaultGroup = "默认") {
  const out = [];
  let group = defaultGroup;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("//")) continue;
    if (line.includes(",#genre#")) {
      group = line.split(",#genre#")[0].trim() || defaultGroup;
      continue;
    }
    const idx = line.indexOf(",");
    if (idx <= 0) continue;
    const name = line.slice(0, idx).trim();
    const url = line.slice(idx + 1).trim();
    if (!name || !/^https?:\/\//i.test(url)) continue;
    out.push({ name, group, url, logo: "", tvgId: "" });
  }
  return out;
}

function parsePlaylist(text, sourceName) {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("#EXTM3U") || trimmed.includes("#EXTINF:")) {
    return parseM3u(text, sourceName);
  }
  return parseTxt(text, sourceName);
}

function channelKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/（.*?）|\(.*?\)/g, "")
    .replace(/超清|高清|标清|4k|4K|FHD|HD|SD|直播/gi, "");
}

/**
 * Scan IPTV subscribe URLs → probe → return alive channels (merged by name).
 */
export async function scanIptvSubscriptions(config, { onLog = () => {} } = {}) {
  const userAgent = config.userAgent || "iptv-scan/1.0";
  const blockHostRe = new RegExp(config.blockHostPattern || "^$", "i");
  const allowIpHost = config.allowIpHost !== false;
  const maxCandidates = config.maxCandidates ?? 800;
  const keepPerChannel = config.keepPerChannel ?? 3;
  const subscribe = Array.isArray(config.subscribe) ? config.subscribe : [];

  const byName = new Map();
  const fetchReport = [];
  const seenUrl = new Set();

  for (const item of subscribe) {
    const url = typeof item === "string" ? item : item?.url;
    const name = (typeof item === "object" && item?.name) || url;
    const enabled = typeof item === "object" ? item.enabled !== false : true;
    if (!url || !enabled) continue;
    try {
      onLog(`scan ${name}`);
      const text = await fetchText(url, userAgent);
      const items = parsePlaylist(text, name);
      let added = 0;
      for (const it of items) {
        if (!isAllowedUrl(it.url, blockHostRe, allowIpHost)) continue;
        if (seenUrl.has(it.url)) continue;
        seenUrl.add(it.url);
        const key = channelKey(it.name) || it.url;
        if (!byName.has(key)) {
          byName.set(key, {
            name: String(it.name).replace(/\s+/g, " ").trim(),
            group: it.group || "默认",
            logo: it.logo || "",
            tvgId: it.tvgId || "",
            urls: [],
            source: name,
          });
        }
        const ch = byName.get(key);
        if (!ch.urls.includes(it.url)) ch.urls.push(it.url);
        added++;
      }
      fetchReport.push({ name, url, ok: true, parsed: items.length, added });
    } catch (err) {
      fetchReport.push({ name, url, ok: false, error: String(err.message || err) });
      onLog(`skip ${name}: ${err.message}`);
    }
  }

  let candidates = [...byName.values()];
  // Prefer channels with more mirror urls, then Chinese-ish names
  candidates.sort((a, b) => {
    const score = (c) =>
      (c.urls.length > 1 ? 0 : 1) +
      (/cctv|卫视|央视|综合|新闻|体育/i.test(c.name) ? 0 : 1);
    return score(a) - score(b) || b.urls.length - a.urls.length;
  });
  if (candidates.length > maxCandidates) {
    candidates = candidates.slice(0, maxCandidates);
  }

  const allUrls = [];
  for (const ch of candidates) {
    for (const u of ch.urls) {
      if (!allUrls.includes(u)) allUrls.push(u);
    }
  }

  onLog(`probe urls=${allUrls.length} channels=${candidates.length}`);
  const probes =
    allUrls.length === 0
      ? new Map()
      : await probeAll(allUrls, {
          concurrency: config.probeConcurrency ?? 20,
          timeoutMs: config.probeTimeoutMs ?? 8000,
          userAgent,
        });

  const aliveChannels = [];
  for (const ch of candidates) {
    const alive = ch.urls
      .map((u) => probes.get(u))
      .filter((r) => r?.ok)
      .sort((a, b) => (a.latencyMs ?? 1e9) - (b.latencyMs ?? 1e9))
      .slice(0, keepPerChannel);
    if (!alive.length) continue;
    aliveChannels.push({
      name: ch.name,
      group: ch.group,
      logo: ch.logo,
      tvgId: ch.tvgId,
      source: ch.source,
      urls: alive.map((r) => r.url),
      latencyMs: alive[0].latencyMs,
    });
  }

  // Sort output: faster first within groups
  aliveChannels.sort((a, b) => {
    const g = String(a.group).localeCompare(String(b.group), "zh");
    if (g !== 0) return g;
    return (a.latencyMs ?? 1e9) - (b.latencyMs ?? 1e9);
  });

  const aliveN = [...probes.values()].filter((r) => r.ok).length;
  const deadN = [...probes.values()].filter((r) => !r.ok).length;

  return {
    channels: aliveChannels,
    meta: {
      checkedAt: new Date().toISOString(),
      mode: "iptv-scan",
      subscribeCount: subscribe.length,
      candidates: candidates.length,
      urlsTotal: probes.size,
      urlsAlive: aliveN,
      urlsDead: deadN,
      channelsAlive: aliveChannels.length,
      fetchReport,
    },
  };
}

/** Backward-compatible alias */
export async function collectPublicChannels(config, opts) {
  return scanIptvSubscriptions(config, opts);
}
