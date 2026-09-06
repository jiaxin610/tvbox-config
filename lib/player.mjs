/** TVBox IJK — 整集预读优先；不强制网盘 playerType */

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
    opt(1, "http-detect-range-support", "0"),
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
 * 尽量把可播内容提前读进内存（infbuf + 大 max-buffer-size）。
 * 注意：这是内存缓冲，不是落盘整集下载；4K 大文件仍受设备 RAM 限制。
 */
function fullEpisodeBuffer() {
  return [
    opt(4, "packet-buffering", "1"),
    opt(4, "infbuf", "1"),
    // 128MB：多数盒子可扛，尽量拉长预读
    opt(4, "max-buffer-size", "134217728"),
    opt(4, "min-frames", "600"),
    // 起播前多攒一点；之后持续填满到 last
    opt(4, "first-high-water-mark-ms", "30000"),
    opt(4, "next-high-water-mark-ms", "120000"),
    opt(4, "last-high-water-mark-ms", "1800000"),
    // HTTP 断线重连（format）
    opt(1, "reconnect", "1"),
    opt(1, "reconnect_at_eof", "1"),
    opt(1, "reconnect_streamed", "1"),
    opt(1, "reconnect_delay_max", "30"),
    opt(1, "timeout", "30000000"),
    opt(1, "rw_timeout", "30000000"),
  ];
}

function softDecode() {
  return baseDecode({ hard: false });
}

function hardDecode() {
  return baseDecode({ hard: true });
}

function fullCacheSoft() {
  return [...baseDecode({ hard: false }), ...fullEpisodeBuffer()];
}

function fullCacheHard() {
  return [...baseDecode({ hard: true }), ...fullEpisodeBuffer()];
}

const BUFFER_KEYS = new Set([
  "packet-buffering",
  "infbuf",
  "max-buffer-size",
  "min-frames",
  "first-high-water-mark-ms",
  "next-high-water-mark-ms",
  "last-high-water-mark-ms",
  "reconnect_at_eof",
  "reconnect_streamed",
  "reconnect_delay_max",
  "timeout",
  "rw_timeout",
]);

/** 给仓原版 ijk 补上预读参数（已有同名则不覆盖） */
function enrichWithBuffer(groups) {
  if (!Array.isArray(groups) || !groups.length) return [];
  return groups.map((g) => {
    const options = Array.isArray(g.options) ? [...g.options] : [];
    const have = new Set(options.map((o) => o?.name).filter(Boolean));
    for (const o of fullEpisodeBuffer()) {
      if (!BUFFER_KEYS.has(o.name)) continue;
      // format 层 reconnect 与 player 层可并存；按 category+name 去重
      const key = `${o.category}:${o.name}`;
      const exists = options.some((x) => `${x.category}:${x.name}` === key);
      if (!exists) options.push(o);
    }
    return { ...g, options };
  });
}

/**
 * 默认把「整集缓存」放最前，方便壳子默认选中；
 * 其后保留仓原版软/硬解（并注入预读）。
 */
export function buildIjkOptions(warehouseIjk) {
  const full = [
    { group: "整集缓存(软解)", options: fullCacheSoft() },
    { group: "整集缓存(硬解)", options: fullCacheHard() },
  ];
  const rest = Array.isArray(warehouseIjk) && warehouseIjk.length
    ? enrichWithBuffer(warehouseIjk)
    : [
        { group: "软解码", options: softDecode() },
        { group: "硬解码", options: hardDecode() },
      ];
  // 避免同名重复
  const seen = new Set(full.map((g) => g.group));
  for (const g of rest) {
    if (!seen.has(g.group)) {
      full.push(g);
      seen.add(g.group);
    }
  }
  return full;
}
