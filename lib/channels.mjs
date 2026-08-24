/** iptv-api 风格频道愿望清单：sources/channels.txt */

import { detectQuality } from "./quality.mjs";

/** 解析模板：分类,#genre# / 频道名 / 频道名,http://...$! */
export function parseChannelsTxt(text) {
  const out = [];
  let group = "默认";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.includes(",#genre#")) {
      group = line.split(",#genre#")[0].trim() || "默认";
      continue;
    }
    const idx = line.indexOf(",");
    if (idx > 0) {
      const name = line.slice(0, idx).trim();
      const rest = line.slice(idx + 1).trim();
      const pinned = /\$!/.test(rest);
      const url = rest.replace(/\$!.*$/, "").trim();
      if (!name) continue;
      if (/^https?:\/\//i.test(url)) {
        out.push({ name, group, url, pinned, wish: false });
      } else {
        out.push({ name, group, url: "", pinned: false, wish: true });
      }
      continue;
    }
    out.push({ name: line, group, url: "", pinned: false, wish: true });
  }
  return out;
}

function normName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[\s\-_+·.]/g, "")
    .replace(/（.*?）|\(.*?\)/g, "")
    .replace(/超高清|超清|高清|标清|8k|4k|fhd|hd|sd|直播/gi, "");
}

function isCctv4k(name) {
  return /cctv\s*-?\s*4\s*k\b/i.test(String(name || ""));
}

function cctvNum(name) {
  if (isCctv4k(name)) return 100;
  const m = String(name || "").match(/cctv\s*-?\s*(\d{1,2})(?!\s*k)/i);
  return m ? Number(m[1]) : null;
}

/** 愿望清单频道名 ↔ 订阅里抓到的频道名 */
export function matchChannelName(candidate, wish) {
  const a = normName(candidate);
  const b = normName(wish);
  if (!a || !b) return false;
  // CCTV-4K 官方频道与 CCTV-4 不可互配
  if (isCctv4k(candidate) !== isCctv4k(wish)) return false;
  if (a === b) return true;
  const ca = cctvNum(candidate);
  const cb = cctvNum(wish);
  if (ca != null && cb != null && ca === cb) return true;
  if (a.includes(b) || b.includes(a)) return true;
  return false;
}

function normalizeWishGroup(group, name) {
  const g = `${group || ""} ${name || ""}`;
  if (/卫视/i.test(g)) return "卫视";
  if (/CCTV|央视|中央/i.test(g)) return "央视";
  return String(group || "其他").replace(/^4K/i, "").trim() || "其他";
}

/**
 * 按愿望清单重排/筛选频道；支持固定源 $!（不测速、排最前）
 */
export function applyChannelWishlist(
  aliveChannels,
  wishlist,
  { wishlistOnly = true, minQuality = 0, onLog = () => {} } = {},
) {
  if (!wishlist?.length) return aliveChannels || [];

  const pool = [...(aliveChannels || [])];
  const used = new Set();
  const result = [];

  for (const wish of wishlist) {
    if (wish.url && wish.pinned) {
      const q = detectQuality(wish.name, wish.url);
      if (minQuality > 0 && q < minQuality) {
        onLog(`skip pinned ${wish.name} (quality ${q} < ${minQuality})`);
        continue;
      }
      result.push({
        name: wish.name,
        group: normalizeWishGroup(wish.group, wish.name),
        logo: "",
        tvgId: "",
        source: "pinned",
        urls: [wish.url],
        latencyMs: 0,
        pinned: true,
      });
      onLog(`pinned ${wish.name}`);
      continue;
    }

    const idx = pool.findIndex(
      (ch, i) => !used.has(i) && matchChannelName(ch.name, wish.name),
    );
    if (idx >= 0) {
      used.add(idx);
      const ch = { ...pool[idx] };
      // 4K/高清并入央视、卫视，便于搜台连看
      ch.group = normalizeWishGroup(wish.group || ch.group, ch.name);
      // 用清单名 + 最高清晰度，方便依次搜台
      const q = Number(ch.quality) || 0;
      const base = String(wish.name || ch.name)
        .replace(/\s*(?:8\s*k|4\s*k|超高清|超清|高清|标清)\s*$/i, "")
        .trim();
      if (q >= 8) ch.name = `${base} 8K`;
      else if (q >= 4) ch.name = `${base} 4K`;
      else if (q >= 2) ch.name = `${base} 高清`;
      else ch.name = base;
      result.push(ch);
      continue;
    }

    if (wish.url && /^https?:\/\//i.test(wish.url)) {
      const q = detectQuality(wish.name, wish.url);
      if (minQuality > 0 && q < minQuality) {
        onLog(`skip fixed ${wish.name} (not HD/4K)`);
        continue;
      }
      result.push({
        name: wish.name,
        group: normalizeWishGroup(wish.group, wish.name),
        logo: "",
        tvgId: "",
        source: "fixed",
        urls: [wish.url],
        latencyMs: 0,
      });
      onLog(`fixed ${wish.name} (no probe)`);
      continue;
    }

    onLog(`missing ${wish.name}`);
  }

  if (!wishlistOnly) {
    for (let i = 0; i < pool.length; i++) {
      if (!used.has(i)) result.push(pool[i]);
    }
  }

  return result;
}
