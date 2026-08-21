#!/usr/bin/env node
/**
 * Import publicly listed IPTV-org streams, probe, keep only alive.
 * Skips raw-IP hosts (common unauthorized rebroadcast mirrors).
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SOURCES = join(ROOT, "sources");

const PLAYLISTS = [
  "https://iptv-org.github.io/iptv/categories/news.m3u",
  "https://iptv-org.github.io/iptv/categories/documentary.m3u",
  "https://iptv-org.github.io/iptv/categories/science.m3u",
  "https://iptv-org.github.io/iptv/categories/weather.m3u",
  "https://iptv-org.github.io/iptv/categories/music.m3u",
  "https://iptv-org.github.io/iptv/categories/religious.m3u",
  "https://iptv-org.github.io/iptv/categories/culture.m3u",
  "https://iptv-org.github.io/iptv/categories/education.m3u",
  "https://iptv-org.github.io/iptv/languages/zho.m3u",
];

/** Always keep these first (already verified / official public). */
const SEED = [
  {
    name: "演示-Mux测试流",
    group: "演示",
    urls: ["https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"],
  },
  {
    name: "演示-Apple BipBop",
    group: "演示",
    urls: [
      "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8",
    ],
  },
  {
    name: "CCTV+ 1",
    group: "新闻",
    urls: [
      "https://cd-live-stream.news.cctvplus.com/live/smil:CHANNEL1.smil/playlist.m3u8",
    ],
  },
  {
    name: "CCTV+ 2",
    group: "新闻",
    urls: [
      "https://cd-live-stream.news.cctvplus.com/live/smil:CHANNEL2.smil/playlist.m3u8",
    ],
  },
];

const BLOCK_HOST_RE =
  /^(?:\d{1,3}\.){3}\d{1,3}$|^localhost$|\.local$|bkpcp\.top|pdtvhd\.com|myip\.pdtvhd/i;

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function parseM3u(text, defaultGroup) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let meta = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF:")) {
      const name = line.split(",").slice(1).join(",").trim() || "未命名";
      const groupMatch = line.match(/group-title="([^"]*)"/i);
      meta = { name, group: groupMatch?.[1] || defaultGroup };
      continue;
    }
    if (line.startsWith("#")) continue;
    if (meta) {
      out.push({ ...meta, url: line });
      meta = null;
    }
  }
  return out;
}

async function fetchText(url) {
  const resp = await fetch(url, {
    headers: { "User-Agent": "tvbox-config-import/1.0", Accept: "*/*" },
    redirect: "follow",
  });
  if (!resp.ok) throw new Error(`${url} -> ${resp.status}`);
  return resp.text();
}

async function main() {
  const collected = [];
  const seenUrl = new Set(SEED.flatMap((c) => c.urls));

  for (const listUrl of PLAYLISTS) {
    const groupHint = listUrl.split("/").pop().replace(/\.m3u$/i, "");
    try {
      console.log(`fetch ${listUrl}`);
      const text = await fetchText(listUrl);
      const items = parseM3u(text, groupHint);
      for (const it of items) {
        const host = hostOf(it.url);
        if (!host || BLOCK_HOST_RE.test(host)) continue;
        let proto;
        try {
          proto = new URL(it.url).protocol;
        } catch {
          continue;
        }
        if (proto !== "http:" && proto !== "https:") continue;
        if (seenUrl.has(it.url)) continue;
        seenUrl.add(it.url);
        collected.push({
          name: it.name.replace(/\s+/g, " ").trim(),
          group: (it.group || groupHint).trim() || "公开",
          urls: [it.url],
        });
      }
    } catch (err) {
      console.warn(`skip playlist: ${err.message}`);
    }
  }

  // Cap candidates to keep probe time reasonable; prefer zho / news-like names first
  collected.sort((a, b) => {
    const score = (c) =>
      (/中|CCTV|卫视|综合|新闻|TV|News/i.test(c.name) ? 0 : 1) +
      (c.urls[0].startsWith("https") ? 0 : 1);
    return score(a) - score(b);
  });
  const capped = collected.slice(0, 180);
  const channels = [...SEED, ...capped];

  await mkdir(SOURCES, { recursive: true });
  const livesPath = join(SOURCES, "lives.json");
  await writeFile(livesPath, JSON.stringify({ channels }, null, 2) + "\n", "utf8");
  console.log(`wrote candidates=${channels.length} -> ${livesPath}`);

  // Probe & rebuild dist via maintain.mjs
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(ROOT, "maintain.mjs")], {
      cwd: ROOT,
      stdio: "inherit",
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`maintain exit ${code}`))));
  });

  // Keep only channels that actually played in the last probe
  const status = JSON.parse(await readFile(join(ROOT, "dist", "status.json"), "utf8"));
  const aliveChannels = [];
  for (const ch of status.channels || []) {
    if (!ch.alive?.length) continue;
    aliveChannels.push({
      name: ch.name,
      group: ch.group,
      urls: ch.alive.map((a) => a.url),
    });
  }
  await writeFile(
    livesPath,
    JSON.stringify({ channels: aliveChannels }, null, 2) + "\n",
    "utf8",
  );
  console.log(`pruned to alive channels=${aliveChannels.length}`);

  // Refresh dist once more from pruned list
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(ROOT, "maintain.mjs")], {
      cwd: ROOT,
      stdio: "inherit",
    });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`maintain exit ${code}`))));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
