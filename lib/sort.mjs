/** Channel sort: 央视 CCTV1→…→CCTV17 → 卫视 → 其他（4K 并入同组，不单独置顶） */

const GROUP_ORDER = [
  { re: /央视|CCTV|中央/i, rank: 0 },
  { re: /卫视/i, rank: 1 },
  { re: /地方|省市|城市|省内/i, rank: 2 },
  { re: /新闻/i, rank: 3 },
  { re: /体育/i, rank: 4 },
  { re: /电影|影院/i, rank: 5 },
  { re: /少儿|卡通|动画/i, rank: 6 },
  { re: /演示|测试/i, rank: 90 },
];

/** CCTV-1 / CCTV1 / 央视1套 → 1；CCTV-4K 官方 4K 频道 → 100 */
export function cctvNumber(name) {
  const n = String(name || "");
  if (/CCTV\s*-?\s*4\s*K\b/i.test(n) || /CCTV\s*4K/i.test(n)) return 100;
  const m =
    n.match(/CCTV\s*-?\s*(\d{1,2})/i) ||
    n.match(/央视\s*(\d{1,2})/) ||
    n.match(/中央(?:电视台)?\s*(\d{1,2})/);
  return m ? Number(m[1]) : null;
}

function groupRank(group, name) {
  const g = `${group || ""} ${name || ""}`;
  for (const { re, rank } of GROUP_ORDER) {
    if (re.test(g)) return rank;
  }
  return 50;
}

function channelSortKey(ch) {
  const name = String(ch.name || "");
  const group = String(ch.group || "");
  const cctv = cctvNumber(name);
  const gr = groupRank(group, name);
  const cctvKey = cctv != null ? String(cctv).padStart(3, "0") : "999";
  // 去掉清晰度后缀再比名字，避免「湖南卫视 4K」排到「湖南卫视 高清」之外乱序
  const bare = name
    .replace(/\s*(?:8\s*k|4\s*k|超高清|超清|高清|标清|fhd|hd|sd)\s*$/i, "")
    .trim();
  return `${String(gr).padStart(2, "0")}_${cctvKey}_${bare}`;
}

/** Sort: 央视 CCTV1→… → 卫视 → 其他 */
export function compareChannels(a, b) {
  const ka = channelSortKey(a);
  const kb = channelSortKey(b);
  if (ka !== kb) return ka < kb ? -1 : 1;
  return String(a.name || "").localeCompare(String(b.name || ""), "zh-CN", {
    numeric: true,
    sensitivity: "base",
  });
}

export function sortChannels(channels) {
  return [...(channels || [])].sort(compareChannels);
}
