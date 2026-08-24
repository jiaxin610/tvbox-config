#!/usr/bin/env node
/**
 * IPTV scan + CMS sites + 单仓 merge → GitHub Pages dist/
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scanIptvSubscriptions } from "./lib/collect.mjs";
import { buildM3u } from "./lib/m3u.mjs";
import {
  parseSitesTxt,
  normalizeSites,
  mergeSiteLists,
  probeSite,
} from "./lib/sites.mjs";
import {
  parseWarehousesTxt,
  mergeWarehouses,
  isLikelyWarehouseUrl,
} from "./lib/warehouse.mjs";

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
const mergedSub = [];
for (const s of subscribe) {
  const url = typeof s === "string" ? s : s.url;
  if (!url || seenSub.has(url)) continue;
  seenSub.add(url);
  mergedSub.push(typeof s === "string" ? { url, name: url, enabled: true } : s);
}

const config = { ...raw, subscribe: mergedSub, seed: [], playlists: [] };

// ---- CMS sites (sites.txt) + auto-detect 单仓 lines ----
let cmsRaw = [];
let warehouseFromSites = [];
try {
  const sj = JSON.parse(await readFile(join(ROOT, "sources", "sites.json"), "utf8"));
  cmsRaw = Array.isArray(sj.sites) ? sj.sites : [];
} catch {
  /* optional */
}
try {
  const st = await readFile(join(ROOT, "sources", "sites.txt"), "utf8");
  for (const row of parseSitesTxt(st)) {
    if (isLikelyWarehouseUrl(row.api)) {
      warehouseFromSites.push({ name: row.name, url: row.api });
    } else {
      cmsRaw.push(row);
    }
  }
} catch {
  /* optional */
}

// ---- warehouses.txt ----
let warehouseEntries = [...warehouseFromSites];
try {
  const wt = await readFile(join(ROOT, "sources", "warehouses.txt"), "utf8");
  const seenWh = new Set(warehouseEntries.map((w) => w.url));
  for (const row of parseWarehousesTxt(wt)) {
    if (!seenWh.has(row.url)) {
      warehouseEntries.push(row);
      seenWh.add(row.url);
    }
  }
} catch {
  /* optional */
}

let cmsSites = normalizeSites(cmsRaw);
let whMerge = { sites: [], parses: [], flags: [], spider: "", wallpaper: "", report: [] };

if (warehouseEntries.length) {
  console.log(`[once] warehouses=${warehouseEntries.length}`);
  whMerge = await mergeWarehouses(warehouseEntries, {
    onLog: (m) => console.log(`[wh] ${m}`),
  });
}

let sites = mergeSiteLists(cmsSites, whMerge.sites);

if (PROBE_SITES && cmsSites.length) {
  console.log(`[sites] probing CMS ${cmsSites.length} ...`);
  const kept = [];
  for (const s of cmsSites) {
    const r = await probeSite(s.api);
    console.log(`[sites] ${s.name} -> ${r.ok ? "ok" : r.reason}`);
    if (r.ok) kept.push(s);
  }
  cmsSites = kept;
  sites = mergeSiteLists(cmsSites, whMerge.sites);
}

console.log(`[once] IPTV subscribe=${mergedSub.length}`);
console.log(`[once] CMS sites=${cmsSites.length} warehouse_sites=${whMerge.sites.length} total=${sites.length}`);

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
      spider: whMerge.spider || "",
      wallpaper: whMerge.wallpaper || "",
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
      parses: whMerge.parses || [],
      flags: whMerge.flags || [],
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
      cmsSiteCount: cmsSites.length,
      warehouseSiteCount: whMerge.sites.length,
      siteCount: sites.length,
      warehouseReport: whMerge.report,
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
  JSON.stringify({ sites: cmsSites }, null, 2) + "\n",
  "utf8",
);
await writeFile(
  join(DIST, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>TVBox Config</title>
<p>配置：<a href="./config.json">${PAGES_BASE}/config.json</a></p>
<p>直播：${channels.length}　点播：CMS ${cmsSites.length} + 单仓 ${whMerge.sites.length} = ${sites.length}</p>
`,
  "utf8",
);

console.log(`[once] done live=${channels.length} sites=${sites.length}`);
