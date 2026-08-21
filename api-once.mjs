#!/usr/bin/env node
/**
 * IPTV scan + VOD sites → write GitHub Pages dist/
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scanIptvSubscriptions } from "./lib/collect.mjs";
import { buildM3u } from "./lib/m3u.mjs";
import { parseSitesTxt, normalizeSites, probeSite } from "./lib/sites.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, "dist");
const PAGES_BASE =
  process.env.PAGES_BASE || "https://jiaxin610.github.io/tvbox-config";
const PROBE_SITES = process.env.PROBE_SITES === "1";

function parseSubscribeTxt(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && /^https?:\/\//i.test(l));
}

const raw = JSON.parse(await readFile(join(ROOT, "sources", "upstreams.json"), "utf8"));
let fromFile = [];
try {
  fromFile = parseSubscribeTxt(
    await readFile(join(ROOT, "sources", "subscribe.txt"), "utf8"),
  );
} catch {
  /* optional */
}

const subscribe = [
  ...(Array.isArray(raw.subscribe) ? raw.subscribe : []),
  ...fromFile.map((url) => ({ name: url, url, enabled: true })),
];

const seenSub = new Set();
const merged = [];
for (const s of subscribe) {
  const url = typeof s === "string" ? s : s.url;
  if (!url || seenSub.has(url)) continue;
  seenSub.add(url);
  merged.push(typeof s === "string" ? { url, name: url, enabled: true } : s);
}

const config = {
  ...raw,
  subscribe: merged,
  seed: [],
  playlists: [],
};

// ---- VOD sites ----
let sitesRaw = [];
try {
  const sj = JSON.parse(await readFile(join(ROOT, "sources", "sites.json"), "utf8"));
  sitesRaw = Array.isArray(sj.sites) ? sj.sites : [];
} catch {
  /* optional */
}
try {
  const st = await readFile(join(ROOT, "sources", "sites.txt"), "utf8");
  for (const row of parseSitesTxt(st)) sitesRaw.push(row);
} catch {
  /* optional */
}
let sites = normalizeSites(sitesRaw);

if (PROBE_SITES && sites.length) {
  console.log(`[sites] probing ${sites.length} ...`);
  const kept = [];
  for (const s of sites) {
    const r = await probeSite(s.api);
    console.log(`[sites] ${s.name} -> ${r.ok ? "ok" : r.reason}`);
    if (r.ok) kept.push(s);
  }
  sites = kept;
}

console.log(`[once] IPTV scan subscribe=${merged.length}`);
console.log(`[once] VOD sites=${sites.length}`);
if (!merged.length) {
  console.warn("[once] 没有直播订阅：编辑 sources/subscribe.txt");
}
if (!sites.length) {
  console.warn("[once] 没有点播站点：编辑 sources/sites.txt （名称|接口）");
}

const { channels, meta } = await scanIptvSubscriptions(config, {
  onLog: (m) => console.log(`[scan] ${m}`),
});

await mkdir(DIST, { recursive: true });
const livesUrl = `${PAGES_BASE.replace(/\/$/, "")}/lives.m3u`;
await writeFile(join(DIST, "lives.m3u"), buildM3u(channels), "utf8");
await writeFile(
  join(DIST, "config.json"),
  JSON.stringify(
    {
      spider: "",
      wallpaper: "",
      sites,
      lives: [
        {
          name: "IPTV扫描",
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
  JSON.stringify(
    {
      ...meta,
      channelCount: channels.length,
      siteCount: sites.length,
      sites: sites.map((s) => ({ name: s.name, api: s.api })),
      livesUrl,
    },
    null,
    2,
  ) + "\n",
  "utf8",
);
await writeFile(
  join(ROOT, "sources", "lives.json"),
  JSON.stringify(
    {
      channels: channels.map(({ name, group, urls, logo, tvgId }) => ({
        name,
        group,
        urls,
        logo,
        tvgId,
      })),
    },
    null,
    2,
  ) + "\n",
  "utf8",
);
await writeFile(
  join(ROOT, "sources", "sites.json"),
  JSON.stringify({ sites }, null, 2) + "\n",
  "utf8",
);
await writeFile(
  join(DIST, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>TVBox Config</title>
<p>配置：<a href="./config.json">${PAGES_BASE}/config.json</a></p>
<p>直播：${channels.length}　点播站点：${sites.length}</p>
`,
  "utf8",
);

console.log(`[once] done live=${channels.length} vod_sites=${sites.length}`);
