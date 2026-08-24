/** Homepage recommend helpers for TVBox */

import { readFile } from "node:fs/promises";

const DEFAULT_RECOMMEND = {
  title: "TOP",
  homeSitePattern: "\\[TOP\\]|nxog|Nostr|豆瓣|Douban|首页推荐|csp_Douban",
  wallpaper: "",
  homeCategories: ["热门电影", "热播剧集", "热门动漫", "热播综艺", "电视剧榜单"],
  cmsCategories: [
    "电影",
    "连续剧",
    "电视剧",
    "综艺",
    "动漫",
    "动作片",
    "喜剧片",
    "爱情片",
    "科幻片",
    "恐怖片",
    "剧情片",
    "战争片",
    "国产剧",
    "港台剧",
    "日韩剧",
    "欧美剧",
  ],
  preferNamePattern: "TOP|推荐|热门|榜单|douban|首页|豆瓣",
};

export async function loadRecommend(path) {
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    return { ...DEFAULT_RECOMMEND, ...raw };
  } catch {
    return { ...DEFAULT_RECOMMEND };
  }
}

function homeSiteRe(recommend) {
  return new RegExp(recommend?.homeSitePattern || DEFAULT_RECOMMEND.homeSitePattern, "i");
}

export function isRecommendSite(site, pattern) {
  const re = new RegExp(pattern || DEFAULT_RECOMMEND.preferNamePattern, "i");
  return re.test(`${site?.name || ""} ${site?.key || ""} ${site?.api || ""}`);
}

export function isHomeIndexSite(site, recommend) {
  const re = homeSiteRe(recommend);
  return Number(site?.indexs) === 1 || re.test(`${site?.name || ""}${site?.key || ""}${site?.api || ""}`);
}

/** TOP / 推荐站排前 */
export function prioritizeRecommendSites(sites, recommend) {
  const pattern = recommend?.preferNamePattern;
  const homeRe = homeSiteRe(recommend);
  const home = [];
  const rec = [];
  const rest = [];
  for (const s of sites || []) {
    if (Number(s.indexs) === 1 || homeRe.test(`${s.name || ""}${s.key || ""}${s.api || ""}`)) {
      home.push(s);
    } else if (isRecommendSite(s, pattern)) rec.push(s);
    else rest.push(s);
  }
  return [...home, ...rec, ...rest];
}

export function applyHomeCategories(sites, recommend) {
  const cats = [
    ...(recommend?.homeCategories || []),
    ...(recommend?.cmsCategories || []),
  ];
  const uniq = [...new Set(cats.filter(Boolean))];
  return (sites || []).map((s) => {
    const type = Number(s.type);
    if (type === 1 || type === 0 || s.api?.includes("provide/vod")) {
      return {
        ...s,
        filter: 1,
        searchable: s.searchable === 0 ? 0 : 1,
        quickSearch: s.quickSearch === 0 ? 0 : 1,
        categories: Array.isArray(s.categories) && s.categories.length ? s.categories : uniq,
      };
    }
    if (type === 3 && s.filterable == null && s.filter == null) {
      return { ...s, filterable: 1 };
    }
    return s;
  });
}

/**
 * 无 TOP/豆瓣首页时插入兜底站，避免盘搜站被当成首页
 */
export function ensureFallbackHomeSite(sites, recommend) {
  const re = homeSiteRe(recommend);
  const list = sites || [];
  const hasHome = list.some(
    (s) =>
      Number(s.indexs) === 1 ||
      re.test(`${s.name || ""}${s.key || ""}${s.api || ""}`) ||
      /Douban|DouBan|豆瓣/i.test(`${s.api || ""}${s.key || ""}`),
  );
  if (hasHome) return list;
  const title = recommend?.title || "TOP";
  return [
    {
      key: "Douban",
      name: title,
      type: 3,
      api: "csp_Douban",
      searchable: 0,
      filterable: 1,
      indexs: 1,
    },
    ...list,
  ];
}

/**
 * 首页站 = TOP（优先 csp_Douban / indexs 推荐源）
 */
export function ensureHomeRecommendSite(sites, recommend) {
  const re = homeSiteRe(recommend);
  const title = recommend?.title || "TOP";
  const list = (sites || []).map((s) => {
    const n = { ...s };
    if (Number(n.indexs) === 1) n.indexs = 0;
    return n;
  });

  // 优先：豆瓣/首页推荐类 → 否则任意 TOP 站 → 否则第一个
  let idx = list.findIndex(
    (s) =>
      /Douban|DouBan|豆瓣|首页推荐|Nostr推荐/i.test(`${s.api || ""}${s.key || ""}${s.name || ""}`) &&
      re.test(`${s.name || ""}${s.key || ""}${s.api || ""}`),
  );
  if (idx < 0) {
    idx = list.findIndex((s) =>
      /Douban|DouBan|豆瓣|首页推荐/i.test(`${s.api || ""}${s.key || ""}${s.name || ""}`),
    );
  }
  if (idx < 0) idx = list.findIndex((s) => re.test(`${s.name || ""}${s.key || ""}${s.api || ""}`));
  if (idx < 0 && list.length) idx = 0;
  if (idx < 0) return list;

  const home = { ...list[idx] };
  home.name = title;
  home.indexs = 1;
  list.splice(idx, 1);
  list.unshift(home);
  return list;
}

export function getHomeRecSite(sites) {
  return (sites || []).find((s) => Number(s.indexs) === 1) || (sites || [])[0];
}
