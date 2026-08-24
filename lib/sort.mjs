/** Channel sort: CCTV1 → CCTV2 → … → 卫视 → others */

/** CCTV-1 / CCTV1 / 央视1套 → 1 */
export function cctvNumber(name) {
  const n = String(name || "");
  const m =
    n.match(/CCTV-?\s*(\d{1,2})/i) ||
    n.match(/央视\s*(\d{1,2})/) ||
    n.match(/中央(?:电视台)?\s*(\d{1,2})/);
  return m ? Number(m[1]) : null;
}

function groupRank(group, name) {
  const g = `${group || ""} ${name || ""}`;
  if (/CCTV|央视|中央/i.test(g)) return 0;
  if (/卫视/i.test(g)) return 1;
  if (/地方|省市|城市/i.test(g)) return 2;
  if (/新闻/i.test(g)) return 3;
  if (/体育/i.test(g)) return 4;
  if (/电影|影院/i.test(g)) return 5;
  if (/少儿|卡通|动画/i.test(g)) return 6;
  if (/演示|测试/i.test(g)) return 90;
  return 50;
}

/** Sort: CCTV1→CCTV2…, then 卫视, then others by name */
export function compareChannels(a, b) {
  const ra = groupRank(a.group, a.name);
  const rb = groupRank(b.group, b.name);
  if (ra !== rb) return ra - rb;

  const ca = cctvNumber(a.name);
  const cb = cctvNumber(b.name);
  if (ca != null && cb != null && ca !== cb) return ca - cb;
  if (ca != null && cb == null) return -1;
  if (ca == null && cb != null) return 1;

  const na = String(a.name || "");
  const nb = String(b.name || "");
  const numA = na.match(/(\d+)/);
  const numB = nb.match(/(\d+)/);
  if (numA && numB && na.replace(/\d+/g, "") === nb.replace(/\d+/g, "")) {
    return Number(numA[1]) - Number(numB[1]);
  }
  return na.localeCompare(nb, "zh-CN", { numeric: true, sensitivity: "base" });
}

export function sortChannels(channels) {
  return [...(channels || [])].sort(compareChannels);
}
