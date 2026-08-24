/** IPTV subscribe scanner: fetch M3U/TXT → merge → probe → keep alive */

import { parseM3u } from "./m3u.mjs";
import { probeAll } from "./probe.mjs";
import { compareChannels, cctvNumber } from "./sort.mjs";
import { applyChannelWishlist, matchChannelName } from "./channels.mjs";
import { detectQuality } from "./quality.mjs";

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
  let n = String(name || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/（.*?）|\(.*?\)/g, "");
  // 官方「CCTV4K / CCTV-4K」独立频道，勿当成 CCTV4
  if (/^cctv-?4k/.test(n)) return "cctv4k";
  // 去掉清晰度后缀，便于 CCTV1 与 CCTV1-4K 合并
  n = n.replace(/(?:超高清|超清|高清|标清|8k|4k|fhd|hd|sd|直播)+$/gi, "");
  n = n.replace(/[-_]?4k$/i, "");
  return n;
}

function displayName(baseName, quality) {
  const n = String(baseName || "").trim();
  if (quality >= 8 && !/8\s*k/i.test(n)) return `${n} 8K`;
  if (quality >= 4 && !/4\s*k|超高清/i.test(n)) return `${n} 4K`;
  if (quality >= 2 && !/1080|高清|超清|fhd/i.test(n)) return `${n} 高清`;
  return n;
}

function qualityGroup(ch, quality) {
  if (quality < 4) return ch.group;
  const g = `${ch.group || ""} ${ch.name || ""}`;
  if (/卫视/i.test(g)) return "4K卫视";
  if (/CCTV|央视|中央/i.test(g)) return "4K央视";
  return "4K";
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
  const prefer4K = config.prefer4K !== false;
  const minQ = config.minQuality ?? 0;
  const maxQ = Math.max(
    0,
    ...(ch.urlMeta || [])
      .filter((m) => (m.quality || 0) >= minQ)
      .map((m) => m.quality || 0),
  );
  if (prefer4K) {
    if (maxQ >= 4) score -= 20; // 有 4K 源的频道优先进入候选
    if (config.skipHeavyQuality === true && maxQ >= 4) score += 8;
  } else if (config.skipHeavyQuality !== false && /4K|8K|2160|4320/i.test(name)) {
    score += 8;
  }
  const first = ch.urls?.[0] || "";
  if (first.startsWith("https")) score -= 2;
  if (config.preferNonIp !== false) {
    try {
      const host = new URL(first).hostname;
      if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) score += 15;
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
  const minQuality = config.minQuality ?? 0;

  const byName = new Map();
  const fetchReport = [];
  const seenUrl = new Set();

  function ingestItem(it, sourceName) {
    if (!isAllowedUrl(it.url, blockHostRe, allowIpHost)) return false;
    const quality = detectQuality(it.name, it.url);
    // 明确标清(1)直接丢；未知(0)留给测速嗅探 RESOLUTION；>=minQuality 直接保留
    if (minQuality > 0 && quality > 0 && quality < minQuality) return false;
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
        urlMeta: [],
        source: sourceName,
      });
    }
    const ch = byName.get(key);
    if (!ch.urls.includes(it.url)) {
      ch.urls.push(it.url);
      ch.urlMeta.push({ url: it.url, quality, label: it.name });
      // 展示名：优先保留无杂后缀的基础名；有 4K 时后面再加
      if (quality < 4 && !/4\s*k|8\s*k/i.test(it.name)) {
        ch.name = String(it.name).replace(/\s+/g, " ").trim();
      }
    } else {
      const m = ch.urlMeta.find((x) => x.url === it.url);
      if (m && quality > (m.quality || 0)) m.quality = quality;
    }
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

  const qualityOf = (ch, url) =>
    ch.urlMeta?.find((m) => m.url === url)?.quality || detectQuality(ch.name, url);

  const allUrls = [];
  for (const ch of candidates) {
    for (const u of ch.urls) {
      const q = qualityOf(ch, u);
      // 明确低于门槛的不测；未知(0)要测，靠 m3u8 RESOLUTION 判定高清/4K
      if (minQuality > 0 && q > 0 && q < minQuality) continue;
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
  const prefer4K = config.prefer4K !== false;

  const aliveChannels = [];
  for (const ch of candidates) {
    let alive = ch.urls
      .map((u) => {
        const r = probes.get(u);
        if (!r?.ok) return null;
        const labelQ = qualityOf(ch, u);
        const probeQ = Number(r.quality) || 0;
        const quality = Math.max(labelQ, probeQ);
        if (minQuality > 0 && quality < minQuality) return null;
        if ((r.latencyMs ?? 9999) > maxLatencyMs) return null;
        return { ...r, quality };
      })
      .filter(Boolean)
      .sort((a, b) => {
        // 4K 优先，再比延迟，再比非 IP
        if (prefer4K && (a.quality || 0) !== (b.quality || 0)) {
          return (b.quality || 0) - (a.quality || 0);
        }
        if (preferNonIp) {
          const aIp = /:\/\/(\d{1,3}\.){3}\d{1,3}[:/]/.test(a.url) ? 1 : 0;
          const bIp = /:\/\/(\d{1,3}\.){3}\d{1,3}[:/]/.test(b.url) ? 1 : 0;
          if (aIp !== bIp) return aIp - bIp;
        }
        return (a.latencyMs ?? 1e9) - (b.latencyMs ?? 1e9);
      })
      .slice(0, keepPerChannel);

    if (!alive.length && keepLocalOnFail && ch.source === "local") {
      alive = ch.urls
        .filter((u) => minQuality <= 0 || qualityOf(ch, u) >= minQuality)
        .slice(0, keepPerChannel)
        .map((url) => ({
          ok: true,
          url,
          latencyMs: 9999,
          quality: qualityOf(ch, url),
        }));
    }
    if (!alive.length) continue;
    const bestQ = alive[0].quality || 0;
    if (minQuality > 0 && bestQ < minQuality) continue;
    aliveChannels.push({
      name: displayName(ch.name, prefer4K ? bestQ : 0),
      group: qualityGroup(ch, prefer4K ? bestQ : 0),
      logo: ch.logo,
      tvgId: ch.tvgId,
      source: ch.source,
      urls: alive.map((r) => r.url),
      latencyMs: alive[0].latencyMs,
      quality: bestQ,
    });
  }

  // 4K 频道组靠前，组内按央视序号 / 延迟
  aliveChannels.sort((a, b) => {
    if (prefer4K) {
      const aq = (a.quality || 0) >= 4 ? 0 : 1;
      const bq = (b.quality || 0) >= 4 ? 0 : 1;
      if (aq !== bq) return aq - bq;
    }
    const c = compareChannels(a, b);
    if (c !== 0) return c;
    return (a.latencyMs ?? 1e9) - (b.latencyMs ?? 1e9);
  });

  let finalChannels = aliveChannels;
  if (channelWishlist.length) {
    finalChannels = applyChannelWishlist(aliveChannels, channelWishlist, {
      wishlistOnly,
      minQuality,
      onLog: (m) => onLog(`wish ${m}`),
    });
    onLog(`wishlist ${finalChannels.length}/${channelWishlist.length} matched`);
  }

  if (minQuality > 0) {
    const before = finalChannels.length;
    finalChannels = finalChannels.filter((ch) => {
      const q =
        ch.quality ??
        Math.max(0, ...(ch.urls || []).map((u) => detectQuality(ch.name, u)));
      return q >= minQuality;
    });
    if (before !== finalChannels.length) {
      onLog(`minQuality>=${minQuality}: ${before} -> ${finalChannels.length}`);
    }
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
      prefer4K,
      minQuality,
      fourKCount: finalChannels.filter((c) => (c.quality || 0) >= 4).length,
      hdCount: finalChannels.filter(
        (c) => (c.quality || 0) >= 2 && (c.quality || 0) < 4,
      ).length,
      fetchReport,
    },
  };
}

/** Backward-compatible alias */
export async function collectPublicChannels(config, opts) {
  return scanIptvSubscriptions(config, opts);
}
