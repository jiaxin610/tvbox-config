/** TVBox IJK — 重点：播到一半断线后继续加载（不强制 playerType） */

function opt(category, name, value) {
  return { category, name, value: String(value) };
}

function baseDecode({ hard = false } = {}) {
  return [
    opt(4, "opensles", "0"),
    opt(4, "overlay-format", "842225234"),
    opt(4, "framedrop", "1"),
    opt(4, "soundtouch", "1"),
    opt(4, "start-on-prepared", "1"),
    // 网盘直链多支持 Range；探测失败时关掉反而中途难续传
    opt(1, "http-detect-range-support", "1"),
    opt(1, "fflags", "fastseek"),
    opt(2, "skip_loop_filter", "48"),
    opt(4, "reconnect", "1"),
    opt(4, "enable-accurate-seek", "0"),
    opt(4, "mediacodec", hard ? "1" : "0"),
    opt(4, "mediacodec-auto-rotate", hard ? "1" : "0"),
    opt(4, "mediacodec-handle-resolution-change", hard ? "1" : "0"),
    opt(4, "mediacodec-hevc", hard ? "1" : "0"),
    opt(1, "dns_cache_timeout", "600000000"),
  ];
}

/**
 * 中途掉线继续加载：format 重连 + 适中缓冲。
 * 缓冲过大（上百 MB）时网盘一断更容易「卡住不再加载」，故用 24MB。
 */
function stayOnlineBuffer() {
  return [
    opt(4, "packet-buffering", "1"),
    opt(4, "infbuf", "1"),
    opt(4, "max-buffer-size", "25165824"), // 24MB
    opt(4, "min-frames", "100"),
    opt(4, "first-high-water-mark-ms", "5000"),
    opt(4, "next-high-water-mark-ms", "15000"),
    opt(4, "last-high-water-mark-ms", "60000"),
    // FFmpeg HTTP：断线自动重连（解决「突然不加载」）
    opt(1, "reconnect", "1"),
    opt(1, "reconnect_at_eof", "1"),
    opt(1, "reconnect_streamed", "1"),
    opt(1, "reconnect_on_network_error", "1"),
    opt(1, "reconnect_delay_max", "60"),
    opt(1, "timeout", "60000000"), // 60s
    opt(1, "rw_timeout", "60000000"),
    opt(1, "multiple_requests", "1"),
  ];
}

function softDecode() {
  return baseDecode({ hard: false });
}

function hardDecode() {
  return baseDecode({ hard: true });
}

function stayOnlineSoft() {
  return [...baseDecode({ hard: false }), ...stayOnlineBuffer()];
}

function stayOnlineHard() {
  return [...baseDecode({ hard: true }), ...stayOnlineBuffer()];
}

const STAY_ONLINE_KEYS = new Set([
  "packet-buffering",
  "infbuf",
  "max-buffer-size",
  "min-frames",
  "first-high-water-mark-ms",
  "next-high-water-mark-ms",
  "last-high-water-mark-ms",
  "reconnect_at_eof",
  "reconnect_streamed",
  "reconnect_on_network_error",
  "reconnect_delay_max",
  "timeout",
  "rw_timeout",
  "multiple_requests",
]);

/** 仓原版 ijk 注入重连/缓冲；已有同 category+name 不覆盖 */
function enrichStayOnline(groups) {
  if (!Array.isArray(groups) || !groups.length) return [];
  return groups.map((g) => {
    const options = Array.isArray(g.options) ? [...g.options] : [];
    // 统一打开 range 探测（利于网盘中途续传）
    const rangeIdx = options.findIndex(
      (o) => o?.name === "http-detect-range-support" && o.category === 1,
    );
    if (rangeIdx >= 0) options[rangeIdx] = opt(1, "http-detect-range-support", "1");
    else options.push(opt(1, "http-detect-range-support", "1"));

    for (const o of stayOnlineBuffer()) {
      if (!STAY_ONLINE_KEYS.has(o.name) && o.name !== "reconnect") continue;
      const key = `${o.category}:${o.name}`;
      const exists = options.some((x) => `${x.category}:${x.name}` === key);
      if (!exists) options.push(o);
    }
    // player 层 reconnect
    if (!options.some((x) => x.name === "reconnect" && x.category === 4)) {
      options.push(opt(4, "reconnect", "1"));
    }
    return { ...g, options };
  });
}

/**
 * 「播放不断线」放最前；其后保留仓软/硬解并注入重连。
 */
export function buildIjkOptions(warehouseIjk) {
  const full = [
    { group: "播放不断线(软解)", options: stayOnlineSoft() },
    { group: "播放不断线(硬解)", options: stayOnlineHard() },
  ];
  const rest =
    Array.isArray(warehouseIjk) && warehouseIjk.length
      ? enrichStayOnline(warehouseIjk)
      : [
          { group: "软解码", options: softDecode() },
          { group: "硬解码", options: hardDecode() },
        ];
  const seen = new Set(full.map((g) => g.group));
  for (const g of rest) {
    if (!seen.has(g.group)) {
      full.push(g);
      seen.add(g.group);
    }
  }
  return full;
}
