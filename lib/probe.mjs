/** Concurrent URL health probe + m3u8 分辨率嗅探（高清/4K） */

const MEDIA_HINTS = [
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "application/octet-stream",
  "video/",
  "audio/",
  "mpegurl",
  "mpegts",
  "mp2t",
];

function looksLikeMedia(contentType, bodyPrefix) {
  const ct = (contentType || "").toLowerCase();
  if (MEDIA_HINTS.some((h) => ct.includes(h))) return true;
  const text = bodyPrefix.toString("utf8").trimStart();
  if (text.startsWith("#EXTM3U") || text.startsWith("#EXT-X-")) return true;
  if (bodyPrefix.length >= 200) {
    const head = text.slice(0, 64).toLowerCase();
    if (head.includes("<!doctype") || head.includes("<html") || head.includes("{")) return false;
    return true;
  }
  return false;
}

/** 从 m3u8 文本解析最大分辨率 → quality 等级 0/1/2/4/8 */
export function qualityFromPlaylist(text) {
  const t = String(text || "");
  let maxW = 0;
  let maxH = 0;
  for (const m of t.matchAll(/RESOLUTION=(\d+)\s*x\s*(\d+)/gi)) {
    maxW = Math.max(maxW, Number(m[1]) || 0);
    maxH = Math.max(maxH, Number(m[2]) || 0);
  }
  const px = Math.max(maxW, maxH);
  if (px >= 3800) return 8;
  if (px >= 2100 || (maxW >= 3800 && maxH >= 2100)) return 4;
  if (px >= 1080 || (maxW >= 1920 && maxH >= 1080)) return 2;
  if (px >= 720 || (maxW >= 1280 && maxH >= 720)) return 1;
  // 主播放列表里没有 RESOLUTION，但有高码率提示时保守给 2
  if (/BANDWIDTH=(\d+)/i.test(t)) {
    const bw = Math.max(
      0,
      ...[...t.matchAll(/BANDWIDTH=(\d+)/gi)].map((x) => Number(x[1]) || 0),
    );
    if (bw >= 8_000_000) return 4;
    if (bw >= 3_500_000) return 2;
  }
  return 0;
}

/** 从 m3u8 里取第一条可播分片 URL（相对路径按 playlist 解析） */
function firstSegmentUrl(playlistText, playlistUrl) {
  const lines = String(playlistText || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    try {
      return new URL(line, playlistUrl).href;
    } catch {
      return "";
    }
  }
  return "";
}

function looksLikeTsOrMp4(buf) {
  if (!buf || buf.length < 4) return false;
  // MPEG-TS sync
  if (buf[0] === 0x47) return true;
  // fMP4 / ISO BMFF
  const tag = buf.slice(4, 8).toString("ascii");
  if (tag === "ftyp" || tag === "styp" || tag === "moof" || tag === "mdat") return true;
  return false;
}

async function probeSegment(segUrl, { signal, userAgent, timeoutMs }) {
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  signal?.addEventListener?.("abort", onAbort, { once: true });
  const timer = setTimeout(() => ac.abort(), Math.min(timeoutMs || 4000, 4000));
  try {
    const resp = await fetch(segUrl, {
      method: "GET",
      redirect: "follow",
      signal: ac.signal,
      headers: {
        "User-Agent": userAgent,
        Accept: "*/*",
        Range: "bytes=0-1023",
        Connection: "close",
      },
    });
    if (!(resp.ok || resp.status === 206)) {
      return { ok: false, reason: `seg_http_${resp.status}` };
    }
    const reader = resp.body?.getReader();
    const chunks = [];
    let size = 0;
    const limit = 1024;
    if (reader) {
      while (size < limit) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
        size += value.byteLength;
      }
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }
    const buf = Buffer.concat(chunks);
    if (buf.length < 4) return { ok: false, reason: "seg_tiny" };
    const head = buf.toString("utf8", 0, Math.min(64, buf.length)).toLowerCase();
    if (head.includes("<!doctype") || head.includes("<html") || head.includes("404")) {
      return { ok: false, reason: "seg_html" };
    }
    if (looksLikeTsOrMp4(buf) || buf.length >= 188) {
      return { ok: true, reason: "seg_ok" };
    }
    return { ok: false, reason: "seg_bad" };
  } catch (err) {
    const name = err?.name === "AbortError" ? "seg_timeout" : "seg_error";
    return { ok: false, reason: name };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", onAbort);
  }
}

export async function probeUrl(
  url,
  { timeoutMs = 6000, userAgent = "okhttp/4.12.0", checkSegment = false } = {},
) {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ac.signal,
      headers: { "User-Agent": userAgent, Accept: "*/*", Connection: "close" },
    });
    const latencyMs = Date.now() - started;
    if (!resp.ok) {
      return { url, ok: false, latencyMs, reason: `http_${resp.status}`, quality: 0 };
    }
    const reader = resp.body?.getReader();
    const chunks = [];
    let size = 0;
    const limit = 8192;
    if (reader) {
      while (size < limit) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
        size += value.byteLength;
      }
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }
    const prefix = Buffer.concat(chunks);
    if (!looksLikeMedia(resp.headers.get("content-type"), prefix)) {
      return { url, ok: false, latencyMs, reason: "not_media", quality: 0 };
    }
    if (latencyMs > (timeoutMs || 6000)) {
      return { url, ok: false, latencyMs, reason: "slow", quality: 0 };
    }
    const text = prefix.toString("utf8");
    const quality = qualityFromPlaylist(text);

    // 可选：校验首个分片（默认关，避免国内源被 Range/超时误杀）
    if (checkSegment && text.trimStart().startsWith("#EXTM3U")) {
      const seg = firstSegmentUrl(text, url);
      if (seg) {
        const left = Math.max(1200, (timeoutMs || 6000) - (Date.now() - started));
        const segRes = await probeSegment(seg, {
          signal: ac.signal,
          userAgent,
          timeoutMs: left,
        });
        // 仅明确坏分片判死；超时/网络抖动保留（避免误杀国内源）
        if (
          !segRes.ok &&
          /seg_http_|seg_html|seg_bad|seg_tiny/.test(segRes.reason || "")
        ) {
          return {
            url,
            ok: false,
            latencyMs: Date.now() - started,
            reason: segRes.reason || "seg_fail",
            quality: 0,
          };
        }
      }
    }

    return {
      url,
      ok: true,
      latencyMs: Date.now() - started,
      reason: "ok",
      bytes: prefix.length,
      quality,
      resolution: quality,
    };
  } catch (err) {
    const name = err?.name === "AbortError" ? "timeout" : `error:${err?.name || "unknown"}`;
    return { url, ok: false, latencyMs: Date.now() - started, reason: name, quality: 0 };
  } finally {
    clearTimeout(timer);
  }
}

export async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let idx = 0;
  async function run() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i], i);
    }
  }
  const n = Math.min(concurrency, Math.max(items.length, 1));
  await Promise.all(Array.from({ length: n }, () => run()));
  return results;
}

export async function probeAll(urls, opts = {}) {
  const concurrency = opts.concurrency ?? 16;
  const probed = await mapPool(urls, concurrency, (url) => probeUrl(url, opts));
  return new Map(probed.map((r) => [r.url, r]));
}
