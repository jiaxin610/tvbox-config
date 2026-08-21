#!/usr/bin/env node
/**
 * IPTV-API — crawl public live playlists, probe, serve M3U / JSON / TVBox config.
 *
 *   GET  /                 API index
 *   GET  /api/status       last crawl stats
 *   GET  /api/upstreams    configured playlist sources
 *   GET  /api/channels     ?q=&group=&limit=
 *   GET  /api/m3u          live playlist
 *   GET  /api/txt          dial-style txt playlist
 *   GET  /api/refresh      re-crawl public sources (also POST)
 *   GET  /lives.m3u        alias of /api/m3u
 *   GET  /tvbox/config.json
 */

import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { collectPublicChannels } from "./lib/collect.mjs";
import { buildM3u, buildTxt } from "./lib/m3u.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, "dist");
const UPSTREAMS_PATH = join(ROOT, "sources", "upstreams.json");
const PORT = Number(process.env.PORT || 8787);

const state = {
  refreshing: false,
  lastError: null,
  channels: [],
  meta: null,
  timer: null,
};

async function loadConfig() {
  return JSON.parse(await readFile(UPSTREAMS_PATH, "utf8"));
}

function buildTvboxConfig(livesUrl) {
  return {
    spider: "",
    wallpaper: "",
    sites: [],
    lives: [
      {
        name: "IPTV-API",
        type: 0,
        url: livesUrl,
        epg: "",
        logo: "",
      },
    ],
    parses: [],
    flags: [],
    ijk: [],
    ads: [],
  };
}

async function persist() {
  await mkdir(DIST, { recursive: true });
  const m3u = buildM3u(state.channels);
  await writeFile(join(DIST, "lives.m3u"), m3u, "utf8");
  await writeFile(
    join(DIST, "config.json"),
    JSON.stringify(buildTvboxConfig("./lives.m3u"), null, 2) + "\n",
    "utf8",
  );
  await writeFile(
    join(DIST, "status.json"),
    JSON.stringify(
      {
        checked_at: state.meta?.checkedAt,
        ...state.meta,
        channels: state.channels.map((c) => ({
          name: c.name,
          group: c.group,
          alive: c.urls.map((url) => ({ url, latency_ms: c.latencyMs })),
          dead: [],
        })),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await writeFile(
    join(ROOT, "sources", "lives.json"),
    JSON.stringify(
      {
        channels: state.channels.map(({ name, group, urls, logo, tvgId }) => ({
          name,
          group,
          urls,
          logo,
          tvgId,
        })),
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

async function refresh(reason = "manual") {
  if (state.refreshing) {
    return { ok: false, message: "refresh already running" };
  }
  state.refreshing = true;
  state.lastError = null;
  console.log(`[refresh] start (${reason})`);
  try {
    const config = await loadConfig();
    const result = await collectPublicChannels(config, {
      onLog: (m) => console.log(`[crawl] ${m}`),
    });
    state.channels = result.channels;
    state.meta = { ...result.meta, reason };
    await persist();
    console.log(
      `[refresh] done channels=${result.meta.channelsAlive} aliveUrls=${result.meta.urlsAlive}`,
    );
    return { ok: true, meta: state.meta };
  } catch (err) {
    state.lastError = String(err.message || err);
    console.error(`[refresh] fail`, err);
    return { ok: false, message: state.lastError };
  } finally {
    state.refreshing = false;
  }
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendText(res, code, text, type = "text/plain; charset=utf-8") {
  res.writeHead(code, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });
  res.end(text);
}

function parseQuery(url) {
  const u = new URL(url, "http://local");
  return { path: u.pathname, query: u.searchParams };
}

async function handle(req, res) {
  const { path, query } = parseQuery(req.url || "/");

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "*",
    });
    res.end();
    return;
  }

  if (path === "/" || path === "/api") {
    return sendJson(res, 200, {
      name: "IPTV-API",
      description: "Crawl public live playlists, probe, serve M3U/JSON/TVBox",
      endpoints: {
        status: "/api/status",
        upstreams: "/api/upstreams",
        channels: "/api/channels?q=&group=&limit=",
        m3u: "/api/m3u",
        txt: "/api/txt",
        refresh: "/api/refresh",
        tvbox: "/tvbox/config.json",
        lives: "/lives.m3u",
      },
      channels: state.channels.length,
      refreshing: state.refreshing,
      checkedAt: state.meta?.checkedAt || null,
    });
  }

  if (path === "/api/status") {
    return sendJson(res, 200, {
      refreshing: state.refreshing,
      lastError: state.lastError,
      meta: state.meta,
      channelCount: state.channels.length,
    });
  }

  if (path === "/api/upstreams") {
    const config = await loadConfig();
    return sendJson(res, 200, {
      playlists: config.playlists,
      maxCandidates: config.maxCandidates,
      refreshHours: config.refreshHours,
    });
  }

  if (path === "/api/channels") {
    let list = state.channels;
    const q = (query.get("q") || "").trim().toLowerCase();
    const group = (query.get("group") || "").trim().toLowerCase();
    const limit = Math.min(Number(query.get("limit") || 500), 2000);
    if (group) list = list.filter((c) => String(c.group).toLowerCase().includes(group));
    if (q) {
      list = list.filter(
        (c) =>
          String(c.name).toLowerCase().includes(q) ||
          String(c.group).toLowerCase().includes(q),
      );
    }
    return sendJson(res, 200, {
      total: list.length,
      items: list.slice(0, limit),
    });
  }

  if (path === "/api/m3u" || path === "/lives.m3u") {
    return sendText(res, 200, buildM3u(state.channels), "application/vnd.apple.mpegurl; charset=utf-8");
  }

  if (path === "/api/txt") {
    return sendText(res, 200, buildTxt(state.channels), "text/plain; charset=utf-8");
  }

  if (path === "/api/refresh" && (req.method === "GET" || req.method === "POST")) {
    const result = await refresh("api");
    return sendJson(res, result.ok ? 200 : 409, result);
  }

  if (path === "/tvbox/config.json" || path === "/config.json") {
    const host = req.headers.host || `127.0.0.1:${PORT}`;
    const proto = req.headers["x-forwarded-proto"] || "http";
    const livesUrl = `${proto}://${host}/lives.m3u`;
    return sendJson(res, 200, buildTvboxConfig(livesUrl));
  }

  sendJson(res, 404, { error: "not found", path });
}

async function main() {
  // bootstrap from disk if present, then refresh
  try {
    const lives = JSON.parse(await readFile(join(ROOT, "sources", "lives.json"), "utf8"));
    if (Array.isArray(lives.channels) && lives.channels.length) {
      state.channels = lives.channels.map((c) => ({
        ...c,
        urls: c.urls || [],
        latencyMs: null,
      }));
      console.log(`[boot] loaded ${state.channels.length} channels from sources/lives.json`);
    }
  } catch {
    /* empty */
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      sendJson(res, 500, { error: String(err.message || err) });
    });
  });

  server.listen(PORT, "0.0.0.0", async () => {
    const ifaces = Object.values(os.networkInterfaces()).flat().filter(Boolean);
    const ipv4 = ifaces.filter((i) => i.family === "IPv4" && !i.internal).map((i) => i.address);
    console.log(`IPTV-API listening on :${PORT}`);
    console.log(`Local:  http://127.0.0.1:${PORT}/tvbox/config.json`);
    for (const ip of ipv4) {
      console.log(`LAN:    http://${ip}:${PORT}/tvbox/config.json`);
    }

    // initial crawl in background
    refresh("boot").catch(() => {});

    const config = await loadConfig().catch(() => ({ refreshHours: 6 }));
    const hours = Number(config.refreshHours || 6);
    if (hours > 0) {
      state.timer = setInterval(
        () => refresh("schedule").catch(() => {}),
        hours * 3600 * 1000,
      );
      if (state.timer.unref) state.timer.unref();
      console.log(`[schedule] auto refresh every ${hours}h`);
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
