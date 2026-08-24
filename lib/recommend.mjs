/** Homepage recommend helpers for TVBox */

import { readFile } from "node:fs/promises";

const DEFAULT_RECOMMEND = {
  title: "首页推荐",
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

/** 确保首页推荐站排第一，并标记 indexs=1 */
export function ensureHomeRecommendSite(sites, recommend) {
  const list = [...(sites || [])];
  if (!list.length) return list;

  let idx = list.findIndex((s) => Number(s.indexs) === 1);
  if (idx < 0) idx = list.findIndex((s) => isHomeIndexSite(s));
  if (idx < 0) {
    idx = list.findIndex((s) => Number(s.type) === 1 || /provide\/vod/i.test(s.api || ""));
  }

  if (idx >= 0) {
    const s = { ...list[idx] };
    if (!/首页|推荐|豆瓣/i.test(s.name)) s.name = `首页推荐┃${s.name}`;
    s.indexs = 1;
    list.splice(idx, 1);
    list.unshift(s);
  }
  return list;
}
