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
  preferNamePattern: "豆瓣|推荐|热门|榜单|douban|首页",
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

/** Put 豆瓣/推荐 sites first so TVBox home shows them */
export function prioritizeRecommendSites(sites, recommend) {
  const pattern = recommend?.preferNamePattern;
  const home = [];
  const rest = [];
  for (const s of sites || []) {
    if (isRecommendSite(s, pattern)) home.push(s);
    else rest.push(s);
  }
  return [...home, ...rest];
}

/** Attach categories so CMS / home tabs show 电影·剧集·综艺·动漫 */
export function applyHomeCategories(sites, recommend) {
  const cats = [
    ...(recommend?.homeCategories || []),
    ...(recommend?.cmsCategories || []),
  ];
  const uniq = [...new Set(cats.filter(Boolean))];
  return (sites || []).map((s) => {
    const type = Number(s.type);
    // type 1 CMS: categories whitelist for home/class tabs
    if (type === 1 || type === 0 || s.api?.includes("provide/vod")) {
      return {
        ...s,
        filter: 1,
        searchable: s.searchable === 0 ? 0 : 1,
        quickSearch: s.quickSearch === 0 ? 0 : 1,
        categories: Array.isArray(s.categories) && s.categories.length
          ? s.categories
          : uniq,
      };
    }
    // keep existing filterable for spider sites
    if (type === 3 && s.filterable == null && s.filter == null) {
      return { ...s, filterable: 1 };
    }
    return s;
  });
}

/**
 * Ensure a visible「首页推荐」entry exists at top.
 * If warehouse already has 豆瓣/推荐, only rename/boost; else mark first CMS as 推荐.
 */
export function ensureHomeRecommendSite(sites, recommend) {
  const list = [...(sites || [])];
  if (!list.length) return list;
  const pattern = recommend?.preferNamePattern;
  const idx = list.findIndex((s) => isRecommendSite(s, pattern));
  if (idx >= 0) {
    const s = { ...list[idx] };
    if (!/推荐|豆瓣/i.test(s.name)) s.name = `推荐┃${s.name}`;
    list.splice(idx, 1);
    list.unshift(s);
    return list;
  }
  // Promote first CMS / type1 as home recommend host
  const cmsIdx = list.findIndex(
    (s) => Number(s.type) === 1 || /provide\/vod/i.test(s.api || ""),
  );
  if (cmsIdx >= 0) {
    const s = { ...list[cmsIdx] };
    s.name = `推荐┃${s.name}`;
    s.filter = 1;
    list.splice(cmsIdx, 1);
    list.unshift(s);
  }
  return list;
}
