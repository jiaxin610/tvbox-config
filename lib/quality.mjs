/** 清晰度识别：0=未知 1=标清/720 2=1080/高清 4=4K 8=8K */
export function detectQuality(name, url = "") {
  const n = String(name || "").trim();
  const u = String(url || "");
  const nu = `${n} ${u}`;

  if (/标清|\bsd\b|576p?|540p?|480p?|360p?|270p?/i.test(nu)) return 1;
  if (/[\/_\-.](?:sd|576|540|480|360)[\/_\-.]/i.test(u)) return 1;

  if (/^cctv-?4k\b/i.test(n) || /cctv\s*-?\s*4k/i.test(n)) return 4;

  if (/8\s*k|4320p?/i.test(nu)) return 8;
  if (/[\/_\-.]8k[\/_\-.]/i.test(u) || /[^a-z0-9]8k[^a-z0-9]/i.test(u)) return 8;

  if (/2160p?|\buhd\b|超高清/i.test(nu)) return 4;
  if (/4\s*k/i.test(n) && !/^cctv-?\s*4\s*$/i.test(n)) return 4;
  if (/[\/_\-.](?:2160p?|uhd)[\/_\-.]/i.test(u)) return 4;
  if (/[\/_\-.]4k[\/_\-.]/i.test(u) || /[^a-z0-9]4k[^a-z0-9]/i.test(u)) {
    if (!/cctv-?\d*4k/i.test(u)) return 4;
  }

  if (/1080p?|\bfhd\b|全高清|蓝光|超清|高清/i.test(nu)) return 2;
  if (/[\/_\-.](?:1080p?|fhd|3m1080p)[\/_\-.]/i.test(u)) return 2;
  if (/3m1080p|1080p\/|\/1080p/i.test(u)) return 2;
  if (/[-_]hq(?:[\/_.]|$)/i.test(u) || /\bhq\b/i.test(u)) return 2;
  if (/hdcctv|\/hd\/|[-_.]hd[-_.\/]|hd\.m3u8/i.test(u)) return 2;
  if (/\/8000\/|\/8000\.m3u8/i.test(u)) return 2;

  if (/720p?/i.test(nu)) return 1;
  if (/[\/_\-.]720[\/_\-.]/i.test(u)) return 1;

  if (/(?:^|[\/_\-.])hd(?:[\/_\-.]|$)/i.test(u)) return 2;

  return 0;
}
