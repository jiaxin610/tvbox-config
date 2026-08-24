/** IPTV subscribe scanner: fetch M3U/TXT → merge → probe → keep alive */

import { parseM3u } from "./m3u.mjs";
import { probeAll } from "./probe.mjs";
import { compareChannels, cctvNumber } from "./sort.mjs";
import { applyChannelWishlist, matchChannelName } from "./channels.mjs";

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
    // 注释行（以 # 开头），但「分类,#genre#」除外
    if (line.startsWith("#") && !line.includes(",#genre#")) continue;
    if (/,#genre#/i.test(line) && !line.startsWith("#")) {
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

/** subscribe.txt 是拨号源（含 #genre#）还是纯 URL 列表 */
export function isDialPlaylistText(text) {
  const t = String(text || "");
  return /,#genre#/i.test(t) || /^[^#\s][^,]*,\s*https?:\/\//im.test(t);
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
    .replace(/超清|高清|标清|4k|4K|8k|8K|FHD|HD|SD|直播/gi, "");
}

function channelScore(ch, config) {
  const name = ch.name || "";
  let score = ch.urls?.length ? 0 : 10;
  const cctv = cctvNumber(name);
  if (cctv != null && cctv >= 1 && cctv <= 17) {
    score -= 100 + (18 - cctv); // CCTV1 最优先
  }
  if (config.preferChinese !== false) {
    if (/cctv|央视|卫视|综合|新闻|体育|中文|华语|China|Chinese/i.test(name)) score -= 5;
    if (/^[A-Za-z0-9 .-]+$/.test(name) && !/CCTV|TV/i.test(name)) score += 3;
  }
  if (config.skipHeavyQuality !== false && /4K|8K|2160|4320/i.test(name)) score += 8;
  const first = ch.urls?.[0] || "";
  if (first.startsWith("https")) score -= 2;
  if (config.preferNonIp !== false) {
    try {
      const host = new URL(first).hostname;
      if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) score += 15; // IP 源更慢，降权
    } catch {
      /* ignore */
    }
  }
  return score;
}

/**
 * Scan IPTV subscribe URLs → probe → return alive channels (merged by name).
 */
export async function scanIptvSubscriptions(config, { onLog = () => {} } = {}) {
  const userAgent = config.userAgent || "iptv-scan/1.0";
  const blockHostRe = new RegExp(config.blockHostPattern || "^$", "i");
  const allowIpHost = config.allowIpHost === true;
  const maxCandidates = config.maxCandidates ?? 200;
  const maxAliveChannels = config.maxAliveChannels ?? 120;
  const maxLatencyMs = config.maxLatencyMs ?? 2500;
  const keepPerChannel = config.keepPerChannel ?? 1;
  const subscribe = Array.isArray(config.subscribe) ? config.subscribe : [];
  const localPlaylists = Array.isArray(config.localPlaylists) ? config.localPlaylists : [];
  const channelWishlist = Array.isArray(config.channelWishlist) ? config.channelWishlist : [];
  const wishlistOnly = config.wishlistOnly !== false && channelWishlist.length > 0;

  const byName = new Map();
  const fetchReport = [];
  const seenUrl = new Set();

  function ingestItem(it, sourceName) {
    if (!isAllowedUrl(it.url, blockHostRe, allowIpHost)) return false;
    if (seenUrl.has(it.url)) return false;
    seenUrl.add(it.url);
    const key = channelKey(it.name) || it.url;
    if (!byName.has(key)) {
      byName.set(key, {
        name: String(it.name).replace(/\s+/g, " ").trim(),
        group: it.group || "默认",
        logo: it.logo || "",
        tvgId: it.tvgId || "",
        urls: [],
        source: sourceName,
      });
    }
    const ch = byName.get(key);
    if (!ch.urls.includes(it.url)) ch.urls.push(it.url);
    return true;
  }

  for (const local of localPlaylists) {
    const name = local?.name || "local";
    const text = String(local?.text || "");
    if (!text.trim()) continue;
    try {
      onLog(`local ${name}`);
      const items = parsePlaylist(text, name);
      let added = 0;
      for (const it of items) {
        if (ingestItem(it, name)) added++;
      }
      fetchReport.push({ name, url: "local", ok: true, parsed: items.length, added });
    } catch (err) {
      fetchReport.push({ name, url: "local", ok: false, error: String(err.message || err) });
      onLog(`skip local ${name}: ${err.message}`);
    }
  }

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
        if (ingestItem(it, name)) added++;
      }
      fetchReport.push({ name, url, ok: true, parsed: items.length, added });
    } catch (err) {
      fetchReport.push({ name, url, ok: false, error: String(err.message || err) });
      onLog(`skip ${name}: ${err.message}`);
    }
  }

  let candidates = [...byName.values()];
  const wishHit = (ch) =>
    channelWishlist.some((w) => matchChannelName(ch.name, w.name));

  candidates.sort((a, b) => {
    if (channelWishlist.length) {
      const aw = wishHit(a) ? 0 : 1;
      const bw = wishHit(b) ? 0 : 1;
      if (aw !== bw) return aw - bw;
    }
    return (
      channelScore(a, config) - channelScore(b, config) || b.urls.length - a.urls.length
    );
  });

  if (candidates.length > maxCandidates) {
    if (channelWishlist.length) {
      const must = candidates.filter(wishHit);
      const rest = candidates.filter((c) => !wishHit(c));
      const limit = Math.max(maxCandidates, must.length);
      candidates = [...must, ...rest].slice(0, limit);
    } else {
      candidates = candidates.slice(0, maxCandidates);
    }
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

  const keepLocalOnFail = config.keepLocalOnFail === true && localPlaylists.length > 0;
  const preferNonIp = config.preferNonIp !== false;
  const aliveChannels = [];
  for (const ch of candidates) {
    let alive = ch.urls
      .map((u) => probes.get(u))
      .filter((r) => r?.ok && (r.latencyMs ?? 9999) <= maxLatencyMs)
      .sort((a, b) => {
        if (preferNonIp) {
          const aIp = /:\/\/(\d{1,3}\.){3}\d{1,3}[:/]/.test(a.url) ? 1 : 0;
          const bIp = /:\/\/(\d{1,3}\.){3}\d{1,3}[:/]/.test(b.url) ? 1 : 0;
          if (aIp !== bIp) return aIp - bIp;
        }
        return (a.latencyMs ?? 1e9) - (b.latencyMs ?? 1e9);
      })
      .slice(0, keepPerChannel);

    // 仅当显式开启 keepLocalOnFail 时才保留测速失败的本地源
    if (!alive.length && keepLocalOnFail && ch.source === "local") {
      alive = ch.urls.slice(0, keepPerChannel).map((url) => ({
        ok: true,
        url,
        latencyMs: 9999,
      }));
    }
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

  // 同分组内优先低延迟
  aliveChannels.sort((a, b) => {
    const c = compareChannels(a, b);
    if (c !== 0) return c;
    return (a.latencyMs ?? 1e9) - (b.latencyMs ?? 1e9);
  });

  let finalChannels = aliveChannels;
  if (channelWishlist.length) {
    finalChannels = applyChannelWishlist(aliveChannels, channelWishlist, {
      wishlistOnly,
      onLog: (m) => onLog(`wish ${m}`),
    });
    onLog(`wishlist ${finalChannels.length}/${channelWishlist.length} matched`);
  }

  if (finalChannels.length > maxAliveChannels) {
    onLog(`trim channels ${finalChannels.length} -> ${maxAliveChannels}`);
    finalChannels.length = maxAliveChannels;
  }

  const aliveN = [...probes.values()].filter((r) => r.ok).length;
  const deadN = [...probes.values()].filter((r) => !r.ok).length;

  return {
    channels: finalChannels,
    meta: {
      checkedAt: new Date().toISOString(),
      mode: channelWishlist.length ? "iptv-wishlist" : "iptv-scan",
      subscribeCount: subscribe.length,
      wishlistCount: channelWishlist.length,
      wishlistMatched: finalChannels.length,
      candidates: candidates.length,
      urlsTotal: probes.size,
      urlsAlive: aliveN,
      urlsDead: deadN,
      channelsAlive: finalChannels.length,
      maxLatencyMs,
      maxAliveChannels,
      fetchReport,
    },
  };
}

/** Backward-compatible alias */
export async function collectPublicChannels(config, opts) {
  return scanIptvSubscriptions(config, opts);
}
