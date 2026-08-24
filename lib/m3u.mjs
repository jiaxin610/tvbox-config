/** M3U parse / build helpers */

import { sortChannels } from "./sort.mjs";

export function parseM3u(text, defaultGroup = "公开") {
  const lines = text.split(/\r?\n/);
  const out = [];
  let meta = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF:")) {
      const name = line.split(",").slice(1).join(",").trim() || "未命名";
      const groupMatch = line.match(/group-title="([^"]*)"/i);
      const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
      const idMatch = line.match(/tvg-id="([^"]*)"/i);
      meta = {
        name,
        group: (groupMatch?.[1] || defaultGroup).trim() || defaultGroup,
        logo: logoMatch?.[1] || "",
        tvgId: idMatch?.[1] || "",
      };
      continue;
    }
    if (line.startsWith("#")) continue;
    if (meta) {
      out.push({ ...meta, url: line });
      meta = null;
    }
  }
  return out;
}

export function buildM3u(channels, { resort = true } = {}) {
  // 默认再排一次：央视台号 → 卫视；保留清晰度后缀仅作展示
  const list = resort ? sortChannels(channels) : [...(channels || [])];
  const lines = ["#EXTM3U"];
  for (const ch of list) {
    const name = String(ch.name || "未命名").trim();
    const group = String(ch.group || "默认").trim();
    const urls = ch.urls || (ch.url ? [ch.url] : []);
    for (const url of urls) {
      if (!url) continue;
      const logo = ch.logo ? ` tvg-logo="${ch.logo}"` : "";
      const id = ch.tvgId ? ` tvg-id="${ch.tvgId}"` : "";
      lines.push(`#EXTINF:-1${id}${logo} group-title="${group}",${name}`);
      lines.push(url);
    }
  }
  return lines.join("\n") + "\n";
}

/** IPTV txt format: 分组,#genre# then 名称,url */
export function buildTxt(channels) {
  const sorted = sortChannels(channels);
  const byGroup = new Map();
  for (const ch of sorted) {
    const group = String(ch.group || "默认").trim();
    if (!byGroup.has(group)) byGroup.set(group, []);
    const urls = ch.urls || (ch.url ? [ch.url] : []);
    for (const url of urls) {
      if (url) byGroup.get(group).push(`${ch.name},${url}`);
    }
  }
  const parts = [];
  for (const [group, rows] of byGroup) {
    parts.push(`${group},#genre#`);
    parts.push(...rows);
    parts.push("");
  }
  return parts.join("\n");
}
