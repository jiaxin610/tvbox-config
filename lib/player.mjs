/** TVBox IJK — 原样使用仓配置；不再自改缓冲/重连（改了反而更易中途停加载） */

function softDecode() {
  return [
    { category: 4, name: "opensles", value: "0" },
    { category: 4, name: "overlay-format", value: "842225234" },
    { category: 4, name: "framedrop", value: "1" },
    { category: 4, name: "soundtouch", value: "1" },
    { category: 4, name: "start-on-prepared", value: "1" },
    { category: 1, name: "http-detect-range-support", value: "0" },
    { category: 1, name: "fflags", value: "fastseek" },
    { category: 2, name: "skip_loop_filter", value: "48" },
    { category: 4, name: "reconnect", value: "1" },
    { category: 4, name: "enable-accurate-seek", value: "0" },
    { category: 4, name: "mediacodec", value: "0" },
    { category: 4, name: "mediacodec-auto-rotate", value: "0" },
    { category: 4, name: "mediacodec-handle-resolution-change", value: "0" },
    { category: 4, name: "mediacodec-hevc", value: "0" },
    { category: 1, name: "dns_cache_timeout", value: "600000000" },
  ];
}

function hardDecode() {
  return softDecode().map((o) => {
    if (o.name === "mediacodec") return { ...o, value: "1" };
    if (o.name === "mediacodec-auto-rotate") return { ...o, value: "1" };
    if (o.name === "mediacodec-handle-resolution-change") return { ...o, value: "1" };
    if (o.name === "mediacodec-hevc") return { ...o, value: "1" };
    return o;
  });
}

/** 优先仓原版 ijk；没有才用 TOP 同款软/硬解 */
export function buildIjkOptions(warehouseIjk) {
  if (Array.isArray(warehouseIjk) && warehouseIjk.length) {
    return warehouseIjk;
  }
  return [
    { group: "软解码", options: softDecode() },
    { group: "硬解码", options: hardDecode() },
  ];
}
