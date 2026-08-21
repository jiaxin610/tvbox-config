/** Concurrent URL health probe */

const MEDIA_HINTS = [
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "application/octet-stream",
  "video/",
  "audio/",
  "mpegurl",
];

function looksLikeMedia(contentType, bodyPrefix) {
  const ct = (contentType || "").toLowerCase();
  if (MEDIA_HINTS.some((h) => ct.includes(h))) return true;
  const text = bodyPrefix.toString("utf8").trimStart();
  return text.startsWith("#EXTM3U") || text.startsWith("#EXT-X-");
}

export async function probeUrl(url, { timeoutMs = 8000, userAgent = "iptv-api/1.0" } = {}) {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ac.signal,
      headers: { "User-Agent": userAgent, Accept: "*/*" },
    });
    const latencyMs = Date.now() - started;
    if (!resp.ok) {
      return { url, ok: false, latencyMs, reason: `http_${resp.status}` };
    }
    const reader = resp.body?.getReader();
    const chunks = [];
    let size = 0;
    if (reader) {
      while (size < 512) {
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
    return { url, ok: true, latencyMs, reason: "ok" };
  } catch (err) {
    const name = err?.name === "AbortError" ? "timeout" : `error:${err?.name || "unknown"}`;
    return { url, ok: false, latencyMs: null, reason: name };
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
