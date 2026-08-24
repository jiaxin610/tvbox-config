/** TVBox IJK player presets — reduce stutter / improve reconnect */

export function buildIjkOptions() {
  return [
    {
      group: "流畅优先(软解)",
      options: [
        { category: 4, name: "opensles", value: "0" },
        { category: 4, name: "overlay-format", value: "842225234" },
        { category: 4, name: "framedrop", value: "1" },
        { category: 4, name: "soundtouch", value: "1" },
        { category: 4, name: "start-on-prepared", value: "1" },
        { category: 4, name: "packet-buffering", value: "0" },
        { category: 4, name: "max-buffer-size", value: "524288" },
        { category: 4, name: "min-frames", value: "25" },
        { category: 1, name: "http-detect-range-support", value: "0" },
        { category: 1, name: "fflags", value: "fastseek" },
        { category: 2, name: "skip_loop_filter", value: "48" },
        { category: 4, name: "reconnect", value: "1" },
        { category: 4, name: "reconnect_delay_max", value: "5" },
        { category: 4, name: "enable-accurate-seek", value: "0" },
        { category: 4, name: "mediacodec", value: "0" },
        { category: 4, name: "mediacodec-hevc", value: "0" },
      ],
    },
    {
      group: "流畅优先(硬解)",
      options: [
        { category: 4, name: "opensles", value: "0" },
        { category: 4, name: "overlay-format", value: "842225234" },
        { category: 4, name: "framedrop", value: "1" },
        { category: 4, name: "soundtouch", value: "1" },
        { category: 4, name: "start-on-prepared", value: "1" },
        { category: 4, name: "packet-buffering", value: "0" },
        { category: 4, name: "max-buffer-size", value: "524288" },
        { category: 4, name: "min-frames", value: "25" },
        { category: 1, name: "http-detect-range-support", value: "0" },
        { category: 1, name: "fflags", value: "fastseek" },
        { category: 2, name: "skip_loop_filter", value: "48" },
        { category: 4, name: "reconnect", value: "1" },
        { category: 4, name: "reconnect_delay_max", value: "5" },
        { category: 4, name: "enable-accurate-seek", value: "0" },
        { category: 4, name: "mediacodec", value: "1" },
        { category: 4, name: "mediacodec-auto-rotate", value: "1" },
        { category: 4, name: "mediacodec-handle-resolution-change", value: "1" },
        { category: 4, name: "mediacodec-hevc", value: "1" },
      ],
    },
  ];
}
