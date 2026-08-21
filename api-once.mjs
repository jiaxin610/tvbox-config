#!/usr/bin/env node
/**
 * IPTV scan once → write GitHub Pages dist/
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { scanIptvSubscriptions } from "./lib/collect.mjs";
import { buildM3u } from "./lib/m3u.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, "dist");
const PAGES_BASE =
  process.env.PAGES_BASE || "https://jiaxin610.github.io/tvbox-config";

function parseSubscribeTxt(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && /^https?:\/\//i.test(l));
}

const raw = JSON.parse(await readFile(join(ROOT, "sources", "upstreams.json"), "utf8"));
let fromFile = [];
try {
  fromFile = parseSubscribeTxt(
    await readFile(join(ROOT, "sources", "subscribe.txt"), "utf8"),
  );
} catch {
  /* optional */
}

const subscribe = [
  ...(Array.isArray(raw.subscribe) ? raw.subscribe : []),
  ...fromFile.map((url) => ({ name: url, url, enabled: true })),
];

// de-dupe by url
const seen = new Set();
const merged = [];
for (const s of subscribe) {
  const url = typeof s === "string" ? s : s.url;
  if (!url || seen.has(url)) continue;
  seen.add(url);
  merged.push(typeof s === "string" ? { url, name: url, enabled: true } : s);
}

const config = {
  ...raw,
  subscribe: merged,
  seed: [],
  playlists: [],
};

console.log(`[once] IPTV scan subscribe=${merged.length}`);
if (!merged.length) {
  console.warn(
    "[once] 没有订阅地址。请在 sources/subscribe.txt 写入你的 IPTV 订阅 URL。",
  );
}

const { channels, meta } = await scanIptvSubscriptions(config, {
  onLog: (m) => console.log(`[scan] ${m}`),
});

await mkdir(DIST, { recursive: true });
const livesUrl = `${PAGES_BASE.replace(/\/$/, "")}/lives.m3u`;
await writeFile(join(DIST, "lives.m3u"), buildM3u(channels), "utf8");
await writeFile(
  join(DIST, "config.json"),
  JSON.stringify(
    {
      spider: "",
      wallpaper: "",
      sites: [],
      lives: [
        {
          name: "IPTV扫描",
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
    },
    null,
    2,
  ) + "\n",
  "utf8",
);
await writeFile(
  join(DIST, "status.json"),
  JSON.stringify({ ...meta, channelCount: channels.length, livesUrl }, null, 2) +
    "\n",
  "utf8",
);
await writeFile(
  join(ROOT, "sources", "lives.json"),
  JSON.stringify(
    {
      channels: channels.map(({ name, group, urls, logo, tvgId }) => ({
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
await writeFile(
  join(DIST, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>IPTV扫描</title>
<p>配置：<a href="./config.json">${PAGES_BASE}/config.json</a></p>
<p>直播：<a href="./lives.m3u">${livesUrl}</a></p>
<p>扫描结果频道数：${channels.length}</p>
`,
  "utf8",
);

console.log(`[once] done channels=${channels.length}`);
