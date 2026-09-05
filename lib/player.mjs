/** TVBox IJK presets — 网盘点播偏稳、直播偏流畅 */

function fmt(name, value) {
  return { category: 1, name, value: String(value) };
}
function codec(name, value) {
  return { category: 2, name, value: String(value) };
}
function player(name, value) {
  return { category: 4, name, value: String(value) };
}

/** 网盘/点播：加大缓冲 + FFmpeg 断线重连（解决播到一半不加载） */
function panStableOptions({ hard = false } = {}) {
  return [
    player("opensles", "0"),
    player("overlay-format", "842225234"),
    player("framedrop", "1"),
    player("soundtouch", "1"),
    player("start-on-prepared", "1"),
    player("packet-buffering", "1"),
    player("max-buffer-size", "15728640"),
    player("min-frames", "100"),
    player("infbuf", "1"),
    player("reconnect", "1"),
    player("reconnect_delay_max", "30"),
    player("enable-accurate-seek", "0"),
    player("mediacodec", hard ? "1" : "0"),
    player("mediacodec-auto-rotate", hard ? "1" : "0"),
    player("mediacodec-handle-resolution-change", hard ? "1" : "0"),
    player("mediacodec-hevc", hard ? "1" : "0"),
    fmt("http-detect-range-support", "0"),
    fmt("fflags", "fastseek"),
    fmt("reconnect", "1"),
    fmt("reconnect_streamed", "1"),
    fmt("reconnect_at_eof", "1"),
    fmt("reconnect_on_network_error", "1"),
    fmt("reconnect_delay_max", "30"),
    fmt("timeout", "30000000"),
    fmt("rw_timeout", "30000000"),
    codec("skip_loop_filter", "48"),
  ];
}

/** 直播：低缓冲、快速起播 */
function liveFluentOptions({ hard = false } = {}) {
  return [
    player("opensles", "0"),
    player("overlay-format", "842225234"),
    player("framedrop", "1"),
    player("soundtouch", "1"),
    player("start-on-prepared", "1"),
    player("packet-buffering", "0"),
    player("max-buffer-size", "1048576"),
    player("min-frames", "25"),
    player("reconnect", "1"),
    player("reconnect_delay_max", "15"),
    player("enable-accurate-seek", "0"),
    player("mediacodec", hard ? "1" : "0"),
    player("mediacodec-auto-rotate", hard ? "1" : "0"),
    player("mediacodec-handle-resolution-change", hard ? "1" : "0"),
    player("mediacodec-hevc", hard ? "1" : "0"),
    fmt("http-detect-range-support", "0"),
    fmt("fflags", "fastseek"),
    fmt("reconnect", "1"),
    fmt("reconnect_streamed", "1"),
    fmt("reconnect_on_network_error", "1"),
    fmt("reconnect_delay_max", "15"),
    fmt("timeout", "15000000"),
    fmt("rw_timeout", "15000000"),
    codec("skip_loop_filter", "48"),
  ];
}

export function buildIjkOptions() {
  return [
    {
      group: "网盘稳定(软解)",
      options: panStableOptions({ hard: false }),
    },
    {
      group: "网盘稳定(硬解)",
      options: panStableOptions({ hard: true }),
    },
    {
      group: "直播流畅(软解)",
      options: liveFluentOptions({ hard: false }),
    },
    {
      group: "直播流畅(硬解)",
      options: liveFluentOptions({ hard: true }),
    },
  ];
}
