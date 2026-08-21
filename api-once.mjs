#!/usr/bin/env node
/**
 * One-shot crawl for CI / static hosting.
 * Writes absolute lives URL so TVBox can load GitHub Pages correctly.
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectPublicChannels } from "./lib/collect.mjs";
import { buildM3u } from "./lib/m3u.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, "dist");
const PAGES_BASE =
  process.env.PAGES_BASE || "https://jiaxin610.github.io/tvbox-config";

const raw = JSON.parse(await readFile(join(ROOT, "sources", "upstreams.json"), "utf8"));
const config = {
  ...raw,
  userAgent: raw.userAgent || "iptv-api/1.0",
  maxCandidates: raw.maxCandidates ?? 250,
  blockHostPattern: raw.blockHostPattern || "",
  probeConcurrency: raw.probeConcurrency ?? 16,
  probeTimeoutMs: raw.probeTimeoutMs ?? 8000,
  playlists: raw.playlists || [],
  seed: raw.seed || [],
};

console.log("[once] crawling public playlists…");
let channels = [];
let meta = { checkedAt: new Date().toISOString(), channelsAlive: 0 };
try {
  const result = await collectPublicChannels(config, {
    onLog: (m) => console.log(`[crawl] ${m}`),
  });
  channels = result.channels;
  meta = result.meta;
} catch (err) {
  console.error("[once] crawl failed:", err.message || err);
}

// Fallback: if probe wiped everything, keep seed URLs so config is not empty
if (!channels.length && Array.isArray(config.seed) && config.seed.length) {
  console.warn("[once] no alive channels — falling back to seed");
  channels = config.seed.map((s) => ({
    name: s.name,
    group: s.group || "演示",
    urls: s.urls || [],
    logo: s.logo || "",
    tvgId: s.tvgId || "",
  }));
  meta = { ...meta, fallback: "seed", channelsAlive: channels.length };
}

await mkdir(DIST, { recursive: true });
const livesUrl = `${PAGES_BASE.replace(/\/$/, "")}/lives.m3u`;
await writeFile(join(DIST, "lives.m3u"), buildM3u(channels), "utf8");
await writeFile(
  join(DIST, "config.json"),
  JSON.stringify(
    {
      spider: "",
      wallpaper: "",
      sites: [],
      lives: [
        {
          name: "IPTV直播",
          type: 0,
          url: livesUrl,
          epg: "",
          logo: "",
        },
      ],
      parses: [],
      flags: [],
      ijk: [],
      ads: [],
    },
    null,
    2,
  ) + "\n",
  "utf8",
);
await writeFile(
  join(DIST, "status.json"),
  JSON.stringify({ ...meta, channelCount: channels.length, livesUrl }, null, 2) + "\n",
  "utf8",
);
await writeFile(
  join(DIST, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>IPTV-API</title>
<p>TVBox 配置地址：</p>
<p><a href="./config.json">${PAGES_BASE}/config.json</a></p>
<p>直播列表：<a href="./lives.m3u">${livesUrl}</a></p>
<p>频道数：${channels.length}</p>
`,
  "utf8",
);

console.log(`[once] done alive=${channels.length} livesUrl=${livesUrl}`);
if (!channels.length) process.exit(2);
