/** Homepage recommend helpers for TVBox */

import { readFile } from "node:fs/promises";

const DEFAULT_RECOMMEND = {
  title: "豆瓣推荐",
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
  preferNamePattern: "豆瓣|推荐|热门|榜单|douban|首页|DouBan",
};

/** TVBox 首页推荐最通用的站点（csp_DouBan + top98 jar） */
export const STANDARD_HOME_SITE = {
  key: "豆瓣",
  name: "豆瓣推荐",
  type: 3,
  api: "csp_DouBan",
  searchable: 0,
  quickSearch: 0,
  changeable: 0,
  filterable: 0,
  indexs: 1,
};

export async function loadRecommend(path) {
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    return { ...DEFAULT_RECOMMEND, ...raw };
  } catch {
    return { ...DEFAULT_RECOMMEND };
  }
}

export function isRecommendSite(site, pattern) {
  const re = new RegExp(pattern || DEFAULT_RECOMMEND.preferNamePattern, "i");
  return re.test(`${site?.name || ""} ${site?.key || ""} ${site?.api || ""}`);
}

export function isHomeIndexSite(site) {
  return Number(site?.indexs) === 1 || /豆瓣|DouBan|热门|推荐/i.test(site?.name || site?.key || "");
}

/** indexs=1 首页源排最前，其次推荐/豆瓣，再其余 */
export function prioritizeRecommendSites(sites, recommend) {
  const pattern = recommend?.preferNamePattern;
  const home = [];
  const rec = [];
  const rest = [];
  for (const s of sites || []) {
    if (Number(s.indexs) === 1) home.push(s);
    else if (isRecommendSite(s, pattern)) rec.push(s);
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
 * 注入标准豆瓣首页站（csp_DouBan），去掉不兼容的 DouDouGuard 首页站
 */
export function ensureHomeRecommendSite(sites, recommend) {
  const title = recommend?.title || STANDARD_HOME_SITE.name;
  const list = (sites || [])
    .filter((s) => !(Number(s.indexs) === 1 && String(s.api || "").includes("DouDou")))
    .filter((s) => !(s.key === "DouBan" && String(s.api || "").includes("DouDou")))
    .map((s) => {
      const n = { ...s };
      if (Number(n.indexs) === 1) n.indexs = 0;
      return n;
    });

  list.unshift({ ...STANDARD_HOME_SITE, name: title });
  return list;
}
