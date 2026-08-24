/** Homepage recommend helpers for TVBox */

import { readFile } from "node:fs/promises";

const DEFAULT_RECOMMEND = {
  title: "光速",
  homeSitePattern: "光速|guangsuapi|推荐_光速",
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
  preferNamePattern: "光速|推荐|热门|榜单|douban|首页",
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

/** indexs=1 首页源排最前，其次推荐站，再其余 */
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

/** 将光速 CMS 设为首页站（indexs=1，排第一） */
export function ensureHomeRecommendSite(sites, recommend) {
  const re = homeSiteRe(recommend);
  const list = (sites || []).map((s) => {
    const n = { ...s };
    if (Number(n.indexs) === 1) n.indexs = 0;
    return n;
  });

  const idx = list.findIndex((s) =>
    re.test(`${s.name || ""}${s.key || ""}${s.api || ""}`),
  );
  if (idx < 0) return list;

  const home = { ...list[idx] };
  home.name = recommend?.title || home.name || "光速";
  home.indexs = 1;
  list.splice(idx, 1);
  list.unshift(home);
  return list;
}
