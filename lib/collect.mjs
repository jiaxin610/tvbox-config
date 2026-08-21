/** Fetch public playlist upstreams and normalize channels */

import { parseM3u } from "./m3u.mjs";
import { probeAll } from "./probe.mjs";

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function isAllowedUrl(url, blockHostRe) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname;
  if (!host || blockHostRe.test(host)) return false;
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

function preferScore(ch) {
  const name = ch.name || "";
  const https = (ch.urls?.[0] || "").startsWith("https") ? 0 : 1;
  const zh = /中|CCTV|卫视|综合|新闻|TV|News|Chinese|华语/i.test(name) ? 0 : 1;
  return zh * 10 + https;
}

/**
 * Crawl configured public playlists → probe → return alive channels.
 */
export async function collectPublicChannels(config, { onLog = () => {} } = {}) {
  const userAgent = config.userAgent || "iptv-api/1.0";
  const blockHostRe = new RegExp(config.blockHostPattern || "^$", "i");
  const maxCandidates = config.maxCandidates ?? 250;
  const seed = Array.isArray(config.seed) ? config.seed : [];

  const seenUrl = new Set();
  const collected = [];

  for (const s of seed) {
    const urls = (s.urls || []).filter((u) => isAllowedUrl(u, blockHostRe));
    for (const u of urls) seenUrl.add(u);
    if (urls.length) {
      collected.push({
        name: s.name,
        group: s.group || "演示",
        logo: s.logo || "",
        tvgId: s.tvgId || "",
        urls,
        source: "seed",
      });
    }
  }

  const playlists = (config.playlists || []).filter((p) => p.enabled !== false);
  const fetchReport = [];

  for (const pl of playlists) {
    try {
      onLog(`fetch ${pl.name || pl.url}`);
      const text = await fetchText(pl.url, userAgent);
      const items = parseM3u(text, pl.name || "公开");
      let added = 0;
      for (const it of items) {
        if (!isAllowedUrl(it.url, blockHostRe)) continue;
        if (seenUrl.has(it.url)) continue;
        seenUrl.add(it.url);
        collected.push({
          name: String(it.name).replace(/\s+/g, " ").trim(),
          group: it.group || "公开",
          logo: it.logo || "",
          tvgId: it.tvgId || "",
          urls: [it.url],
          source: pl.name || pl.url,
        });
        added++;
      }
      fetchReport.push({ name: pl.name, url: pl.url, ok: true, parsed: items.length, added });
    } catch (err) {
      fetchReport.push({ name: pl.name, url: pl.url, ok: false, error: String(err.message || err) });
      onLog(`skip ${pl.name}: ${err.message}`);
    }
  }

  // seed first, then ranked candidates capped
  const seeds = collected.filter((c) => c.source === "seed");
  const rest = collected
    .filter((c) => c.source !== "seed")
    .sort((a, b) => preferScore(a) - preferScore(b))
    .slice(0, Math.max(0, maxCandidates - seeds.length));
  const candidates = [...seeds, ...rest];

  const allUrls = [];
  for (const ch of candidates) {
    for (const u of ch.urls) {
      if (!allUrls.includes(u)) allUrls.push(u);
    }
  }

  onLog(`probe urls=${allUrls.length} concurrency=${config.probeConcurrency ?? 16}`);
  const probes = await probeAll(allUrls, {
    concurrency: config.probeConcurrency ?? 16,
    timeoutMs: config.probeTimeoutMs ?? 8000,
    userAgent,
  });

  const aliveChannels = [];
  for (const ch of candidates) {
    const alive = ch.urls
      .map((u) => probes.get(u))
      .filter((r) => r?.ok)
      .sort((a, b) => (a.latencyMs ?? 1e9) - (b.latencyMs ?? 1e9));
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

  const aliveN = [...probes.values()].filter((r) => r.ok).length;
  const deadN = [...probes.values()].filter((r) => !r.ok).length;

  return {
    channels: aliveChannels,
    meta: {
      checkedAt: new Date().toISOString(),
      candidates: candidates.length,
      urlsTotal: probes.size,
      urlsAlive: aliveN,
      urlsDead: deadN,
      channelsAlive: aliveChannels.length,
      fetchReport,
    },
  };
}
