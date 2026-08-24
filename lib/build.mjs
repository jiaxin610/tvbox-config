/** Build TVBox config into publish/ */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scanIptvSubscriptions } from "./collect.mjs";
import { buildM3u } from "./m3u.mjs";
import { parseSitesTxt, normalizeSites, mergeSiteLists } from "./sites.mjs";
import { buildIjkOptions } from "./player.mjs";
import {
  parseWarehousesTxt,
  mergeWarehouses,
  isLikelyWarehouseUrl,
} from "./warehouse.mjs";

const LIB = dirname(fileURLToPath(import.meta.url));
const ROOT = join(LIB, "..");
const OUT = join(ROOT, "publish");
const PAGES_BASE =
  process.env.PAGES_BASE || "https://jiaxin610.github.io/tvbox-config";

function parseSubscribeTxt(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && /^https?:\/\//i.test(l));
}

export async function buildPublish({ onLog = console.log } = {}) {
  const raw = JSON.parse(
    await readFile(join(ROOT, "sources", "upstreams.json"), "utf8"),
  );

  let subscribeUrls = [];
  try {
    subscribeUrls = parseSubscribeTxt(
      await readFile(join(ROOT, "sources", "subscribe.txt"), "utf8"),
    );
  } catch {
    /* optional */
  }
  const subscribe = [
    ...(raw.subscribe || []),
    ...subscribeUrls.map((url) => ({ name: url, url, enabled: true })),
  ];
  const seenSub = new Set();
  const mergedSub = [];
  for (const s of subscribe) {
    const url = typeof s === "string" ? s : s.url;
    if (!url || seenSub.has(url)) continue;
    seenSub.add(url);
    mergedSub.push(typeof s === "string" ? { url, name: url } : s);
  }

  let cmsRaw = [];
  const warehouseEntries = [];
  try {
    const st = await readFile(join(ROOT, "sources", "sites.txt"), "utf8");
    for (const row of parseSitesTxt(st)) {
      if (isLikelyWarehouseUrl(row.api)) {
        warehouseEntries.push({ name: row.name, url: row.api });
      } else {
        cmsRaw.push(row);
      }
    }
  } catch {
    /* optional */
  }
  try {
    const wt = await readFile(join(ROOT, "sources", "warehouses.txt"), "utf8");
    const seen = new Set(warehouseEntries.map((w) => w.url));
    for (const row of parseWarehousesTxt(wt)) {
      if (!seen.has(row.url)) {
        warehouseEntries.push(row);
        seen.add(row.url);
      }
    }
  } catch {
    /* optional */
  }

  let cmsSites = normalizeSites(cmsRaw);
  let whMerge = {
    sites: [],
    parses: [],
    flags: [],
    spider: "",
    wallpaper: "",
    report: [],
  };
  if (warehouseEntries.length) {
    onLog(`[build] warehouses=${warehouseEntries.length}`);
    whMerge = await mergeWarehouses(warehouseEntries, {
      onLog: (m) => onLog(`[wh] ${m}`),
    });
  }
  const sites = mergeSiteLists(cmsSites, whMerge.sites);

  onLog(`[build] subscribe=${mergedSub.length} cms=${cmsSites.length} vod=${sites.length}`);
  const { channels, meta } = await scanIptvSubscriptions(
    { ...raw, subscribe: mergedSub, seed: [], playlists: [] },
    { onLog: (m) => onLog(`[iptv] ${m}`) },
  );

  await mkdir(OUT, { recursive: true });
  const livesUrl = `${PAGES_BASE.replace(/\/$/, "")}/lives.m3u`;
  await writeFile(join(OUT, "lives.m3u"), buildM3u(channels), "utf8");
  await writeFile(
    join(OUT, "config.json"),
    JSON.stringify(
      {
        spider: whMerge.spider || "",
        wallpaper: whMerge.wallpaper || "",
        sites,
        lives: [{ name: "IPTV", type: 0, url: livesUrl, epg: "", logo: "" }],
        parses: whMerge.parses || [],
        flags: whMerge.flags || [],
        ijk: buildIjkOptions(),
        ads: [],
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await writeFile(
    join(OUT, "status.json"),
    JSON.stringify(
      {
        ...meta,
        channelCount: channels.length,
        siteCount: sites.length,
        livesUrl,
        builtAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await writeFile(
    join(OUT, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>TVBox</title>
<p><a href="./config.json">${PAGES_BASE}/config.json</a></p>
<p>直播 ${channels.length} · 点播 ${sites.length}</p>`,
    "utf8",
  );
  await writeFile(
    join(ROOT, "记事本", "配置地址.txt"),
    `${PAGES_BASE}/config.json\n`,
    "utf8",
  );

  onLog(`[build] done live=${channels.length} vod=${sites.length} -> publish/`);
  return { channels: channels.length, sites: sites.length, livesUrl };
}
