/** Concurrent URL health probe */

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
  // 部分专属源直接吐 TS/二进制，无 m3u 头：有足够字节且非 HTML 即视为可用
  if (bodyPrefix.length >= 200) {
    const head = text.slice(0, 64).toLowerCase();
    if (head.includes("<!doctype") || head.includes("<html") || head.includes("{")) return false;
    return true;
  }
  return false;
}

export async function probeUrl(url, { timeoutMs = 4500, userAgent = "okhttp/4.12.0" } = {}) {
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
      return { url, ok: false, latencyMs, reason: `http_${resp.status}` };
    }
    const reader = resp.body?.getReader();
    const chunks = [];
    let size = 0;
    if (reader) {
      while (size < 1024) {
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
      return { url, ok: false, latencyMs, reason: "not_media" };
    }
    // 首包过慢视为不可用（盒子端也难播）
    if (latencyMs > (timeoutMs || 4500)) {
      return { url, ok: false, latencyMs, reason: "slow" };
    }
    return { url, ok: true, latencyMs, reason: "ok", bytes: prefix.length };
  } catch (err) {
    const name = err?.name === "AbortError" ? "timeout" : `error:${err?.name || "unknown"}`;
    return { url, ok: false, latencyMs: Date.now() - started, reason: name };
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
