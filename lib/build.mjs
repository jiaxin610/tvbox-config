/** Build TVBox config into publish/ */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scanIptvSubscriptions, isDialPlaylistText } from "./collect.mjs";
import { buildM3u } from "./m3u.mjs";
import { parseSitesTxt, normalizeSites, mergeSiteLists } from "./sites.mjs";
import { buildIjkOptions } from "./player.mjs";
import {
  parseWarehousesTxt,
  mergeWarehouses,
  isLikelyWarehouseUrl,
  filterSitesForSpider,
  isValidSpider,
} from "./warehouse.mjs";
import {
  loadRecommend,
  prioritizeRecommendSites,
  applyHomeCategories,
  ensureHomeRecommendSite,
  getHomeRecSite,
} from "./recommend.mjs";
import { parseChannelsTxt } from "./channels.mjs";

const LIB = dirname(fileURLToPath(import.meta.url));
const ROOT = join(LIB, "..");
const OUT = join(ROOT, "publish");
const PAGES_BASE =
  process.env.PAGES_BASE || "https://jiaxin610.github.io/tvbox-config";

const DEFAULT_SPIDER = "http://home.jundie.top:81/jar/top98_1.jar";

/** 首页推荐站 api → 对应可下载的 jar 地址 */
const SPIDER_FOR_HOME_API = {
  csp_DouBan: DEFAULT_SPIDER,
  csp_Douban: DEFAULT_SPIDER,
  csp_DouDou: "https://szyyds.cn/tv/x.jpg",
  csp_DouDouGuard: "https://szyyds.cn/tv/x.jpg",
};

function resolveSpiderForHomeSite(sites, warehouseSpider = "") {
  // 单仓自带 spider 优先（TOP 仓）
  if (isValidSpider(warehouseSpider)) {
    return String(warehouseSpider).split(";")[0].trim();
  }
  const home = getHomeRecSite(sites);
  if (!home) return DEFAULT_SPIDER;
  // 站点自带 jar
  if (isValidSpider(home.jar)) {
    return String(home.jar).split(";")[0].trim();
  }
  const api = String(home.api || "").split("?")[0].trim();
  if (SPIDER_FOR_HOME_API[api]) return SPIDER_FOR_HOME_API[api];
  if (/^csp_/i.test(api)) return DEFAULT_SPIDER;
  return DEFAULT_SPIDER;
}

async function mirrorSpiderJar(spiderUrl, onLog) {
  if (!isValidSpider(spiderUrl)) return "";
  const src = String(spiderUrl).split(";")[0].trim();
  try {
    onLog(`[jar] download ${src}`);
    const resp = await fetch(src, {
      redirect: "follow",
      headers: { "User-Agent": "tvbox-publish/1.0", Accept: "*/*" },
    });
    if (!resp.ok) throw new Error(`http_${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 1000) throw new Error(`too_small_${buf.length}`);
    // zip/jar magic PK
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error("not_jar");
    await mkdir(join(OUT, "jar"), { recursive: true });
    await writeFile(join(OUT, "jar", "spider.jar"), buf);
    const hosted = `${PAGES_BASE.replace(/\/$/, "")}/jar/spider.jar`;
    const md5 = createHash("md5").update(buf).digest("hex");
    onLog(`[jar] mirrored ${buf.length} bytes -> ${hosted}`);
    return `${hosted};md5;${md5}`;
  } catch (err) {
    onLog(`[jar] mirror failed: ${err.message}`);
    return "";
  }
}

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
  const localPlaylists = [];
  try {
    const subText = await readFile(join(ROOT, "sources", "subscribe.txt"), "utf8");
    if (isDialPlaylistText(subText)) {
      localPlaylists.push({ name: "subscribe-local", text: subText });
      onLog(`[build] subscribe.txt = 本地拨号源`);
    }
    subscribeUrls = parseSubscribeTxt(subText);
  } catch {
    /* optional */
  }
  // iptv-api local.txt
  try {
    const localTxt = await readFile(join(ROOT, "sources", "local.txt"), "utf8");
    if (isDialPlaylistText(localTxt)) {
      localPlaylists.push({ name: "local", text: localTxt });
      onLog(`[build] local.txt = 本地源`);
    }
  } catch {
    /* optional */
  }
  // 兼容旧文件名
  try {
    const liveTxt = await readFile(join(ROOT, "sources", "直播源.txt"), "utf8");
    if (isDialPlaylistText(liveTxt)) {
      localPlaylists.push({ name: "直播源", text: liveTxt });
      onLog(`[build] 直播源.txt = 本地拨号源`);
    }
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
    // 跳过无效伪地址
    if (!/^https?:\/\//i.test(url) || /guovin\/iptv-api/i.test(url)) continue;
    seenSub.add(url);
    mergedSub.push(typeof s === "string" ? { url, name: url } : { ...s, url });
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

  const recommend = await loadRecommend(join(ROOT, "sources", "recommend.json"));

  let sites = mergeSiteLists(cmsSites, whMerge.sites);
  sites = applyHomeCategories(sites, recommend);
  sites = prioritizeRecommendSites(sites, recommend);
  sites = ensureHomeRecommendSite(sites, recommend);

  let spiderDownload = resolveSpiderForHomeSite(sites, whMerge.spider);
  if (spiderDownload) {
    onLog(`[build] spider for home -> ${spiderDownload}`);
  } else if (whMerge.spider) {
    onLog(`[build] spider skipped (invalid/local): ${whMerge.spider}`);
  }

  // optional override: sources/spider.txt one URL
  try {
    const sp = (await readFile(join(ROOT, "sources", "spider.txt"), "utf8"))
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("#") && /^https?:\/\//i.test(l));
    if (sp) {
      spiderDownload = sp;
      onLog(`[build] spider from sources/spider.txt`);
    }
  } catch {
    /* optional */
  }

  await mkdir(OUT, { recursive: true });
  let spider = "";
  if (spiderDownload) {
    const mirrored = await mirrorSpiderJar(spiderDownload, onLog);
    if (mirrored) {
      spider = mirrored;
    } else {
      onLog(`[build] spider mirror failed, clearing spider (avoid JAR error)`);
    }
  }

  const before = sites.length;
  sites = filterSitesForSpider(sites, spider);
  if (sites.length !== before) {
    onLog(`[build] dropped ${before - sites.length} jar-dependent sites (no valid spider)`);
  }

  let channelWishlist = [];
  try {
    channelWishlist = parseChannelsTxt(
      await readFile(join(ROOT, "sources", "channels.txt"), "utf8"),
    );
  } catch {
    /* optional */
  }

  onLog(
    `[build] subscribe=${mergedSub.length} wish=${channelWishlist.length} cms=${cmsSites.length} vod=${sites.length} home=${sites[0]?.name || "-"} spider=${spider ? "yes" : "no"}`,
  );
  // wishlistOnly：只保留 channels.txt 里测速通过的频道（更快更稳）
  const wishlistOnly = raw.wishlistOnly !== false;

  const { channels, meta } = await scanIptvSubscriptions(
    {
      ...raw,
      subscribe: mergedSub,
      localPlaylists,
      channelWishlist,
      wishlistOnly,
      keepLocalOnFail: raw.keepLocalOnFail === true,
      seed: [],
      playlists: [],
    },
    { onLog: (m) => onLog(`[iptv] ${m}`) },
  );

  await mkdir(OUT, { recursive: true });
  const livesUrl = `${PAGES_BASE.replace(/\/$/, "")}/lives.m3u`;
  await writeFile(join(OUT, "lives.m3u"), buildM3u(channels), "utf8");
  await writeFile(
    join(OUT, "config.json"),
    JSON.stringify(
      {
        spider,
        wallpaper: recommend.wallpaper || whMerge.wallpaper || "",
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
<p>直播 ${channels.length} · 点播 ${sites.length}</p>
<p>首页推荐：${(recommend.homeCategories || []).join(" · ")}</p>
<p>首页站点：${sites[0]?.name || "-"}</p>`,
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
