/** Build TVBox 点播 + 网络扫台直播 into publish/ */
import { writeFile, mkdir, readFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scanIptvSubscriptions } from "./collect.mjs";
import { buildM3u } from "./m3u.mjs";
import {
  parseSitesTxt,
  normalizeSites,
  mergeSiteLists,
  bindSpiderLoginJar,
  prioritizePanSearchSites,
  hardenPanPlayback,
} from "./sites.mjs";
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
  ensureFallbackHomeSite,
  getHomeRecSite,
} from "./recommend.mjs";
import { parseChannelsTxt } from "./channels.mjs";
import { privatizeJars } from "./jar.mjs";

const LIB = dirname(fileURLToPath(import.meta.url));
const ROOT = join(LIB, "..");
const OUT = join(ROOT, "publish");
const PAGES_BASE =
  process.env.PAGES_BASE || "https://jiaxin610.github.io/tvbox-config";

const DEFAULT_SPIDER = "http://home.jundie.top:81/jar/top98_1.jar";

const SPIDER_FOR_HOME_API = {
  csp_DouBan: DEFAULT_SPIDER,
  csp_Douban: DEFAULT_SPIDER,
  csp_DouDou: "https://szyyds.cn/tv/x.jpg",
  csp_DouDouGuard: "https://szyyds.cn/tv/x.jpg",
};

function resolveSpiderForHomeSite(sites, warehouseSpider = "") {
  if (isValidSpider(warehouseSpider)) {
    return String(warehouseSpider).split(";")[0].trim();
  }
  const home = getHomeRecSite(sites);
  if (!home) return DEFAULT_SPIDER;
  const api = String(home.api || "").split("?")[0].trim();
  if (SPIDER_FOR_HOME_API[api]) return SPIDER_FOR_HOME_API[api];
  if (isValidSpider(home.jar) && !/^csp_/i.test(api)) {
    return String(home.jar).split(";")[0].trim();
  }
  if (/^csp_/i.test(api)) return DEFAULT_SPIDER;
  return DEFAULT_SPIDER;
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

  // 仅远程订阅 URL，不加载 local.txt / 本地拨号源
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
  sites = ensureFallbackHomeSite(sites, recommend);
  sites = ensureHomeRecommendSite(sites, recommend);
  // 夸快/盘搜/玩歌提到配置站后，保证全局搜索能扫到网盘
  sites = prioritizePanSearchSites(sites);

  for (const stale of [join(OUT, "tokenm.json"), join(OUT, "jar", "pg.jar")]) {
    try {
      await unlink(stale);
    } catch {
      /* already absent */
    }
  }

  let spiderDownload = resolveSpiderForHomeSite(sites, whMerge.spider);
  if (spiderDownload) {
    onLog(`[build] spider for home -> ${spiderDownload}`);
  } else if (whMerge.spider) {
    onLog(`[build] spider skipped (invalid/local): ${whMerge.spider}`);
  }

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
  const before = sites.length;
  sites = filterSitesForSpider(sites, spiderDownload);
  if (sites.length !== before) {
    onLog(`[build] dropped ${before - sites.length} jar-dependent sites (no valid spider)`);
  }

  // 原样私有化：镜像 jar/资源到本仓库；相对路径已在 merge 时转绝对
  let spider = spiderDownload || "";
  ({ sites, spider } = await privatizeJars({
    sites,
    spider,
    outDir: OUT,
    pagesBase: PAGES_BASE,
    onLog,
  }));

  // 配置｜中心 + 夸父/阿离 → 同一 spider.jar（登录态）；盘搜站不强制改 jar
  sites = bindSpiderLoginJar(sites, spider);
  sites = hardenPanPlayback(sites);
  sites = prioritizePanSearchSites(sites);
  onLog(
    `[build] privatized spider=${spider ? "yes" : "no"} panWebShare=${sites.filter((s) => /^csp_PanWebShare$/i.test(String(s.api || ""))).length} config=${sites.filter((s) => /^csp_Config$/i.test(String(s.api || ""))).length} panFirst=${sites.slice(0, 20).filter((s) => /PanWeb|PanSou|Duopan/i.test(String(s.api || ""))).map((s) => s.name).join(",")}`,
  );

  // 记事本：只保留你自己的私有化接口地址
  const noteDir = join(ROOT, "记事本");
  await mkdir(noteDir, { recursive: true });
  const privateUrl = `${PAGES_BASE.replace(/\/$/, "")}/config.json`;
  await writeFile(
    join(noteDir, "配置地址.txt"),
    `${privateUrl}\n`,
    "utf8",
  );
  onLog(`[build] 记事本 -> ${privateUrl}`);

  let channelWishlist = [];
  try {
    channelWishlist = parseChannelsTxt(
      await readFile(join(ROOT, "sources", "channels.txt"), "utf8"),
    );
  } catch {
    /* optional */
  }

  onLog(
    `[build] subscribe=${mergedSub.length} wish=${channelWishlist.length} vod=${sites.length} home=${sites[0]?.name || "-"} spider=${spider ? "yes" : "no"}`,
  );

  const { channels, meta } = await scanIptvSubscriptions(
    {
      ...raw,
      subscribe: mergedSub,
      localPlaylists: [],
      channelWishlist,
      wishlistOnly: raw.wishlistOnly !== false,
      keepLocalOnFail: false,
      seed: [],
      playlists: [],
    },
    { onLog: (m) => onLog(`[iptv] ${m}`) },
  );

  const livesUrl = `${PAGES_BASE.replace(/\/$/, "")}/lives.m3u`;
  await writeFile(join(OUT, "lives.m3u"), buildM3u(channels, { resort: false }), "utf8");
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

  onLog(`[build] done live=${channels.length} vod=${sites.length} -> publish/`);
  return { channels: channels.length, sites: sites.length, livesUrl };
}
