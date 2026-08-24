/** iptv-api 风格频道愿望清单：sources/channels.txt */

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
    .replace(/超清|高清|标清|4k|8k|fhd|hd|sd|直播/gi, "");
}

function cctvNum(name) {
  const m = String(name || "").match(/cctv\s*-?\s*(\d{1,2})/i);
  return m ? Number(m[1]) : null;
}

/** 愿望清单频道名 ↔ 订阅里抓到的频道名 */
export function matchChannelName(candidate, wish) {
  const a = normName(candidate);
  const b = normName(wish);
  if (!a || !b) return false;
  if (a === b) return true;
  const ca = cctvNum(candidate);
  const cb = cctvNum(wish);
  if (ca != null && cb != null && ca === cb) return true;
  if (a.includes(b) || b.includes(a)) return true;
  return false;
}

/**
 * 按愿望清单重排/筛选频道；支持固定源 $!（不测速、排最前）
 */
export function applyChannelWishlist(aliveChannels, wishlist, { wishlistOnly = true, onLog = () => {} } = {}) {
  if (!wishlist?.length) return aliveChannels || [];

  const pool = [...(aliveChannels || [])];
  const used = new Set();
  const result = [];

  for (const wish of wishlist) {
    if (wish.url && wish.pinned) {
      result.push({
        name: wish.name,
        group: wish.group,
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
      // 已是 4K 的保留 4K 分组，否则用愿望清单分组
      if ((ch.quality || 0) < 4) ch.group = wish.group || ch.group;
      result.push(ch);
      continue;
    }

    if (wish.url && /^https?:\/\//i.test(wish.url)) {
      result.push({
        name: wish.name,
        group: wish.group,
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
