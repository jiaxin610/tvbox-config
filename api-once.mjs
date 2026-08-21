#!/usr/bin/env node
/**
 * One-shot crawl for CI / static hosting.
 */
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectPublicChannels } from "./lib/collect.mjs";
import { buildM3u } from "./lib/m3u.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, "dist");

const raw = JSON.parse(await readFile(join(ROOT, "sources", "upstreams.json"), "utf8"));
// normalize alternate key names
const config = {
  ...raw,
  userAgent: raw.userAgent || raw.userAgent,
  maxCandidates: raw.maxCandidates ?? raw.maxCandidates ?? 250,
  blockHostPattern: raw.blockHostPattern || raw.blockHostPattern,
  probeConcurrency: raw.probeConcurrency ?? raw.probeConcurrency ?? 16,
  probeTimeoutMs: raw.probeTimeoutMs ?? raw.probeTimeoutMs ?? 8000,
  playlists: raw.playlists || raw.playlists || [],
  seed: raw.seed || raw.seed || [],
};

console.log("[once] crawling public playlists…");
const { channels, meta } = await collectPublicChannels(config, {
  onLog: (m) => console.log(`[crawl] ${m}`),
});

await mkdir(DIST, { recursive: true });
const m3u = buildM3u(channels);
await writeFile(join(DIST, "lives.m3u"), m3u, "utf8");
await writeFile(
  join(DIST, "config.json"),
  JSON.stringify(
    {
      spider: "",
      wallpaper: "",
      sites: [],
      lives: [
        {
          name: "IPTV-API",
          type: 0,
          url: "./lives.m3u",
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
  JSON.stringify({ ...meta, channelCount: channels.length }, null, 2) + "\n",
  "utf8",
);
await writeFile(
  join(DIST, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>IPTV-API</title>
<p>TVBox 配置地址：</p>
<p><a href="./config.json">config.json</a></p>
<p><a href="./lives.m3u">lives.m3u</a></p>
`,
  "utf8",
);

console.log(`[once] done alive=${channels.length} -> ${DIST}`);
