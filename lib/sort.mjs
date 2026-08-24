/** Channel sort: CCTV1 → CCTV2 → … → 卫视 → others */

const GROUP_ORDER = [
  { re: /央视|CCTV|中央|央视频道/i, rank: 0 },
  { re: /卫视/i, rank: 1 },
  { re: /地方|省市|城市|省内/i, rank: 2 },
  { re: /新闻/i, rank: 3 },
  { re: /体育/i, rank: 4 },
  { re: /电影|影院/i, rank: 5 },
  { re: /少儿|卡通|动画/i, rank: 6 },
  { re: /演示|测试/i, rank: 90 },
];

/** CCTV-1 / CCTV1 / 央视1套 → 1 */
export function cctvNumber(name) {
  const n = String(name || "");
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
  // within 央视: CCTV1=001, CCTV2=002 ...
  const cctvKey = cctv != null ? String(cctv).padStart(3, "0") : "999";
  return `${String(gr).padStart(2, "0")}_${cctvKey}_${name}`;
}

/** Sort: CCTV1→CCTV2…, then 卫视, then others */
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
