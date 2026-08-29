/** IPTV subscribe scanner: fetch M3U/TXT → merge → probe → keep alive */

import { parseM3u } from "./m3u.mjs";
import { probeAll } from "./probe.mjs";
import { compareChannels, cctvNumber } from "./sort.mjs";
import { applyChannelWishlist, matchChannelName } from "./channels.mjs";
import { detectQuality } from "./quality.mjs";

/** minQuality: 1=含标清；未知(0)在 minQuality<=1 时测速通过即可保留 */
function meetsMinQuality(quality, minQuality) {
  if (minQuality <= 0) return true;
  const q = Number(quality) || 0;
  if (q === 0) return minQuality <= 1;
  return q >= minQuality;
}

function isAllowedUrl(url, blockHostRe, allowIpHost, blockUrlRe) {
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
  if (blockUrlRe && blockUrlRe.test(url)) return false;
  if (!allowIpHost && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return false;
  return true;
}

/** 频道名与 URL 路径相关性：CCTV13 优先带 cctv13 的地址，降低假源权重 */
export function urlNameAffinity(name, url) {
  const n = String(name || "");
  const u = String(url || "").toLowerCase();
  const cctv = cctvNumber(n);
  if (cctv != null) {
    const id = String(cctv);
    const padded = id.padStart(2, "0");
    if (
      new RegExp(`cctv[-_]?0?${id}(?:hd|sd|4k)?(?:[^0-9]|$)`, "i").test(u) ||
      u.includes(`cctv${padded}`) ||
      u.includes(`cctv-${id}`) ||
      u.includes(`cctv_${id}`)
    ) {
      return 0; // best
    }
    // 常见错标：省级活动流 / 蓝天等
    if (/hebtv\.com|cztv\.com|lantian|\/jishi\/|\/cp\d+\.m3u8/i.test(u)) return 50;
    return 10;
  }
  // 卫视：URL 含台名/拼音更可信
  const sat = n.match(/([\u4e00-\u9fa5]{2,})卫视/);
  if (sat) {
    const area = sat[1];
    const py = {
      湖南: "hunan|hnws|hunantv|mango",
      浙江: "zhejiang|zjws|cztv|lantian",
      江苏: "jiangsu|jsws|jstv",
      东方: "dongfang|dfws|shanghai|smg",
      北京: "beijing|bjws|brtv",
      广东: "guangdong|gdws|gdtv",
      深圳: "shenzhen|szws",
      四川: "sichuan|scws",
      湖北: "hubei|hbws",
      安徽: "anhui|ahws",
    };
    const re = py[area] || area;
    if (new RegExp(re, "i").test(u) || u.includes(encodeURIComponent(area).toLowerCase())) {
      return 0;
    }
    // 明显串台
    if (/cctv|hebtv|\/jishi\//i.test(u) && !new RegExp(re, "i").test(u)) return 40;
    return 8;
  }
  return 5;
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
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  if (!lines.length) return false;
  const body = lines.join("\n");
  return /,#genre#/i.test(body) || /^[^,\s]+,\s*https?:\/\//im.test(body);
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
  const n = String(baseName || "")
    .trim()
    .replace(/\s*(?:8\s*k|4\s*k|超高清|超清|高清|标清|fhd|hd|sd)\s*$/i, "")
    .trim();
  if (quality >= 8) return `${n} 8K`;
  if (quality >= 4) return `${n} 4K`;
  if (quality >= 2) return `${n} 高清`;
  if (quality >= 1) return `${n} 标清`;
  return n;
}

/** 央视 + 卫视 → 同一分组 */
const LIVE_GROUP = "央卫视";

/** 央视/卫视（含 4K）统一归入一个分组 */
function unifiedGroup(ch) {
  const g = `${ch.group || ""} ${ch.name || ""}`;
  if (/卫视|CCTV|央视|中央/i.test(g)) return LIVE_GROUP;
  if (/卫视|央视|CCTV/i.test(ch.group || "")) return LIVE_GROUP;
  return String(ch.group || "其他").replace(/^4K/i, "") || "其他";
}

/**
 * 有 4K 不要高清，有高清不要标清；但高清档若整体过慢则降档（避免假 4K 拖死）。
 * 档位：8=8K → 4=4K → 2=高清 → 1=标清
 */
function keepBestQualityTier(alive, maxLatencyMs = 4500) {
  if (!alive?.length) return [];
  const floors = [8, 4, 2, 1];
  for (const floor of floors) {
    const tier = alive.filter((a) => (Number(a.quality) || 0) >= floor);
    if (!tier.length) continue;
    const bestLat = Math.min(...tier.map((a) => a.latencyMs ?? 1e9));
    if (bestLat <= maxLatencyMs) return tier;
  }
  return alive;
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
  const blockUrlRe = config.blockUrlPattern
    ? new RegExp(config.blockUrlPattern, "i")
    : null;
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
  const localUrls = new Set();

  function ingestItem(it, sourceName) {
    if (!isAllowedUrl(it.url, blockHostRe, allowIpHost, blockUrlRe)) return false;
    if (sourceName === "local" || sourceName === "subscribe-local" || sourceName === "直播源") {
      localUrls.add(it.url);
    }
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
        if (!meetsMinQuality(quality, minQuality)) return null;
        if ((r.latencyMs ?? 9999) > maxLatencyMs) return null;
        return { ...r, quality };
      })
      .filter(Boolean)
      .sort((a, b) => {
        // 本地固定源优先（已人工验证可播）
        const aLoc = localUrls.has(a.url) ? 0 : 1;
        const bLoc = localUrls.has(b.url) ? 0 : 1;
        if (aLoc !== bLoc) return aLoc - bLoc;
        // 名称与 URL 相关性（避免 CCTV13 选到河北台等假源）
        const aff =
          urlNameAffinity(ch.name, a.url) - urlNameAffinity(ch.name, b.url);
        if (aff !== 0) return aff;
        // 延迟优先：差超过 600ms 时取更快的（加载慢的问题）
        const latDiff = (a.latencyMs ?? 1e9) - (b.latencyMs ?? 1e9);
        if (Math.abs(latDiff) > 600) return latDiff;
        // 延迟接近时再比清晰度（4K 优先）
        if (prefer4K && (a.quality || 0) !== (b.quality || 0)) {
          return (b.quality || 0) - (a.quality || 0);
        }
        if (preferNonIp) {
          const aIp = /:\/\/(\d{1,3}\.){3}\d{1,3}[:/]/.test(a.url) ? 1 : 0;
          const bIp = /:\/\/(\d{1,3}\.){3}\d{1,3}[:/]/.test(b.url) ? 1 : 0;
          if (aIp !== bIp) return aIp - bIp;
        }
        return latDiff;
      })
      .slice(0, Math.max(keepPerChannel * 3, 6)); // 先多留，再按清晰度档裁剪

    alive = keepBestQualityTier(alive, maxLatencyMs).slice(0, keepPerChannel);

    if (!alive.length && keepLocalOnFail && ch.source === "local") {
      alive = keepBestQualityTier(
        ch.urls
          .filter((u) => meetsMinQuality(qualityOf(ch, u), minQuality))
          .map((url) => ({
            ok: true,
            url,
            latencyMs: 9999,
            quality: qualityOf(ch, url),
          })),
        maxLatencyMs,
      ).slice(0, keepPerChannel);
    }
    if (!alive.length) continue;
    const bestQ = alive[0].quality || 0;
    if (!meetsMinQuality(bestQ, minQuality)) continue;
    aliveChannels.push({
      name: displayName(ch.name, prefer4K ? bestQ : 0),
      group: unifiedGroup(ch),
      logo: ch.logo,
      tvgId: ch.tvgId,
      source: ch.source,
      urls: alive.map((r) => r.url),
      latencyMs: alive[0].latencyMs,
      quality: bestQ,
    });
  }

  // 央视 → 卫视，组内按台号；不再把 4K 单独提到最前
  aliveChannels.sort((a, b) => {
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
      return meetsMinQuality(q, minQuality);
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
      sdCount: finalChannels.filter((c) => (c.quality || 0) === 1).length,
      fetchReport,
    },
  };
}

/** Backward-compatible alias */
export async function collectPublicChannels(config, opts) {
  return scanIptvSubscriptions(config, opts);
}
