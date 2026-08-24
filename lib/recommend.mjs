/** Homepage recommend helpers for TVBox */

import { readFile } from "node:fs/promises";

const DEFAULT_RECOMMEND = {
  title: "光速",
  homeSitePattern: "光速|guangsuapi|推荐_光速",
  homeRecPattern: "DouBan|DouDou|豆瓣|免费分享",
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

const FALLBACK_HOME_REC = {
  key: "豆瓣",
  name: "首页推荐",
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

function homeSiteRe(recommend) {
  return new RegExp(recommend?.homeSitePattern || DEFAULT_RECOMMEND.homeSitePattern, "i");
}

function homeRecRe(recommend) {
  return new RegExp(recommend?.homeRecPattern || DEFAULT_RECOMMEND.homeRecPattern, "i");
}

export function isRecommendSite(site, pattern) {
  const re = new RegExp(pattern || DEFAULT_RECOMMEND.preferNamePattern, "i");
  return re.test(`${site?.name || ""} ${site?.key || ""} ${site?.api || ""}`);
}

export function isHomeIndexSite(site, recommend) {
  const re = homeSiteRe(recommend);
  return Number(site?.indexs) === 1 || re.test(`${site?.name || ""}${site?.key || ""}${site?.api || ""}`);
}

/** 光速排前，其次推荐站 */
export function prioritizeRecommendSites(sites, recommend) {
  const pattern = recommend?.preferNamePattern;
  const homeRe = homeSiteRe(recommend);
  const recRe = homeRecRe(recommend);
  const vod = [];
  const rec = [];
  const rest = [];
  for (const s of sites || []) {
    if (homeRe.test(`${s.name || ""}${s.key || ""}${s.api || ""}`)) vod.push(s);
    else if (Number(s.indexs) === 1 || recRe.test(`${s.api || ""}${s.key || ""}${s.name || ""}`)) {
      rec.push(s);
    } else if (isRecommendSite(s, pattern)) rec.push(s);
    else rest.push(s);
  }
  return [...vod, ...rec, ...rest];
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
 * 光速 = 默认点播站（排第一）
 * 首页推荐 = 独立 indexs:1 站（热门电影/热播剧集，需 type:3 豆瓣类）
 */
export function ensureHomeRecommendSite(sites, recommend) {
  const vodRe = homeSiteRe(recommend);
  const recRe = homeRecRe(recommend);
  const list = (sites || []).map((s) => ({
    ...s,
    indexs: Number(s.indexs) === 1 ? 0 : (s.indexs ?? 0),
  }));

  const ordered = [];

  const vodIdx = list.findIndex((s) =>
    vodRe.test(`${s.name || ""}${s.key || ""}${s.api || ""}`),
  );
  if (vodIdx >= 0) {
    const vod = { ...list[vodIdx] };
    vod.name = recommend?.title || vod.name || "光速";
    vod.indexs = 0;
    ordered.push(vod);
    list.splice(vodIdx, 1);
  }

  const recIdx = list.findIndex((s) =>
    recRe.test(`${s.api || ""}${s.key || ""}${s.name || ""}`),
  );
  let homeRec;
  if (recIdx >= 0) {
    homeRec = { ...list[recIdx] };
    list.splice(recIdx, 1);
  } else {
    homeRec = { ...FALLBACK_HOME_REC };
  }
  homeRec.name = "首页推荐";
  homeRec.indexs = 1;
  if (!homeRec.api || !/^csp_/i.test(homeRec.api)) {
    homeRec.api = "csp_DouBan";
    homeRec.type = 3;
  }
  ordered.push(homeRec);

  return [...ordered, ...list];
}

/** 首页推荐站 api，用于匹配 spider jar */
export function getHomeRecSite(sites) {
  return (sites || []).find((s) => Number(s.indexs) === 1);
}
