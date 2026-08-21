#!/usr/bin/env node
/**
 * Probe live URLs, drop dead lines, emit TVBox config + M3U.
 * Zero npm deps (Node 18+).
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, "dist");
const SOURCES = join(ROOT, "sources");
const TIMEOUT_MS = 8000;
const USER_AGENT = "tvbox-config-maintain/1.0";
const MEDIA_HINTS = [
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "application/octet-stream",
  "video/",
  "audio/",
  "mpegurl",
];

function parseArgs(argv) {
  const out = {
    concurrency: 12,
    livesUrl: "./lives.m3u",
    wallpaper: "",
    strict: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--strict") out.strict = true;
    else if (a === "--concurrency") out.concurrency = Number(argv[++i]);
    else if (a === "--lives-url") out.livesUrl = argv[++i];
    else if (a === "--wallpaper") out.wallpaper = argv[++i];
  }
  return out;
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function looksLikeMedia(contentType, bodyPrefix) {
  const ct = (contentType || "").toLowerCase();
  if (MEDIA_HINTS.some((h) => ct.includes(h))) return true;
  const text = bodyPrefix.toString("utf8").trimStart();
  return text.startsWith("#EXTM3U") || text.startsWith("#EXT-X-");
}

async function probeUrl(url) {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ac.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
    });
    const latencyMs = Date.now() - started;
    if (!resp.ok) {
      return { url, ok: false, latencyMs, reason: `http_${resp.status}` };
    }
    const reader = resp.body?.getReader();
    const chunks = [];
    let size = 0;
    if (reader) {
      while (size < 512) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
        size += value.byteLength;
      }
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }
    const prefix = Buffer.concat(chunks);
    if (!looksLikeMedia(resp.headers.get("content-type"), prefix)) {
      return { url, ok: false, latencyMs, reason: "not_media" };
    }
    return { url, ok: true, latencyMs, reason: "ok" };
  } catch (err) {
    const name = err?.name === "AbortError" ? "timeout" : `error:${err?.name || "unknown"}`;
    return { url, ok: false, latencyMs: null, reason: name };
  } finally {
    clearTimeout(timer);
  }
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let idx = 0;
  async function run() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i], i);
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

function buildM3u(channels, probes) {
  const lines = ["#EXTM3U"];
  const report = [];

  for (const ch of channels) {
    const name = String(ch.name || "未命名").trim();
    const group = String(ch.group || "默认").trim();
    const urls = (ch.urls || []).map((u) => String(u).trim()).filter(Boolean);
    const alive = urls
      .map((u) => probes.get(u))
      .filter((r) => r?.ok)
      .sort((a, b) => (a.latencyMs ?? 1e9) - (b.latencyMs ?? 1e9));

    report.push({
      name,
      group,
      alive: alive.map((r) => ({ url: r.url, latency_ms: r.latencyMs })),
      dead: urls
        .filter((u) => !probes.get(u)?.ok)
        .map((u) => ({ url: u, reason: probes.get(u)?.reason || "missing" })),
    });

    for (const r of alive) {
      lines.push(`#EXTINF:-1 group-title="${group}",${name}`);
      lines.push(r.url);
    }
  }

  return { m3u: lines.join("\n") + "\n", report };
}

function buildConfig(sites, livesUrl, wallpaper = "") {
  return {
    spider: "",
    wallpaper,
    sites,
    lives: [
      {
        name: "自维护直播",
        type: 0,
        url: livesUrl,
        epg: "",
        logo: "",
      },
    ],
    parses: [],
    flags: [],
    ijk: [
      {
        group: "软解码",
        options: [
          { category: 4, name: "opensles", value: "0" },
          { category: 4, name: "overlay-format", value: "842225234" },
          { category: 4, name: "framedrop", value: "1" },
          { category: 4, name: "soundtouch", value: "1" },
          { category: 4, name: "start-on-prepared", value: "1" },
          { category: 1, name: "http-detect-range-support", value: "0" },
          { category: 1, name: "fflags", value: "fastseek" },
          { category: 2, name: "skip_loop_filter", value: "48" },
          { category: 4, name: "reconnect", value: "1" },
          { category: 4, name: "enable-accurate-seek", value: "0" },
          { category: 4, name: "mediacodec", value: "0" },
          { category: 4, name: "mediacodec-auto-rotate", value: "0" },
          { category: 4, name: "mediacodec-handle-resolution-change", value: "0" },
          { category: 4, name: "mediacodec-hevc", value: "0" },
        ],
      },
      {
        group: "硬解码",
        options: [
          { category: 4, name: "opensles", value: "0" },
          { category: 4, name: "overlay-format", value: "842225234" },
          { category: 4, name: "framedrop", value: "1" },
          { category: 4, name: "soundtouch", value: "1" },
          { category: 4, name: "start-on-prepared", value: "1" },
          { category: 1, name: "http-detect-range-support", value: "0" },
          { category: 1, name: "fflags", value: "fastseek" },
          { category: 2, name: "skip_loop_filter", value: "48" },
          { category: 4, name: "reconnect", value: "1" },
          { category: 4, name: "enable-accurate-seek", value: "0" },
          { category: 4, name: "mediacodec", value: "1" },
          { category: 4, name: "mediacodec-auto-rotate", value: "1" },
          { category: 4, name: "mediacodec-handle-resolution-change", value: "1" },
          { category: 4, name: "mediacodec-hevc", value: "1" },
        ],
      },
    ],
    ads: [],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const livesCfg = await readJson(join(SOURCES, "lives.json"), { channels: [] });
  const sitesCfg = await readJson(join(SOURCES, "sites.json"), { sites: [] });
  const channels = livesCfg.channels || [];
  const sites = sitesCfg.sites || [];

  const allUrls = [];
  for (const ch of channels) {
    for (const u of ch.urls || []) {
      const url = String(u).trim();
      if (url && !allUrls.includes(url)) allUrls.push(url);
    }
  }

  const probed = await mapPool(allUrls, args.concurrency, (url) => probeUrl(url));
  const probes = new Map(probed.map((r) => [r.url, r]));
  const { m3u, report } = buildM3u(channels, probes);

  await mkdir(DIST, { recursive: true });
  await writeFile(join(DIST, "lives.m3u"), m3u, "utf8");
  const config = buildConfig(sites, args.livesUrl, args.wallpaper);
  await writeFile(join(DIST, "config.json"), JSON.stringify(config, null, 2) + "\n", "utf8");

  const aliveN = [...probes.values()].filter((r) => r.ok).length;
  const deadN = [...probes.values()].filter((r) => !r.ok).length;
  const status = {
    checked_at: new Date().toISOString(),
    urls_total: probes.size,
    urls_alive: aliveN,
    urls_dead: deadN,
    channels: report,
  };
  await writeFile(join(DIST, "status.json"), JSON.stringify(status, null, 2) + "\n", "utf8");

  console.log(`OK  alive=${aliveN} dead=${deadN} -> ${DIST}`);
  if (args.strict && deadN > 0 && aliveN === 0) {
    console.error("ERROR: no alive streams");
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
