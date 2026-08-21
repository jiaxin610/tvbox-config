#!/usr/bin/env node
/**
 * 解析脚本：读取 sources/subscribe.txt → 拉取 → 解析 M3U/TXT → 可选探测 → 写出结果
 *
 * 用法：
 *   node parse.mjs              # 只解析，不探测
 *   node parse.mjs --probe      # 解析并探测可用性
 *   或双击 parse.bat
 *
 * 输出：
 *   output/parsed.json   全部解析结果（含来源）
 *   output/parsed.m3u    合并后的 M3U
 *   output/parsed.txt    直播 TXT 格式
 *   output/alive.m3u     仅探测存活（需 --probe）
 *   output/report.txt    人可读报告
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseM3u, buildM3u, buildTxt } from "./lib/m3u.mjs";
import { parseTxt } from "./lib/collect.mjs";
import { probeAll } from "./lib/probe.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "output");
const doProbe = process.argv.includes("--probe");

function parseSubscribeTxt(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && /^https?:\/\//i.test(l));
}

function parsePlaylist(text, sourceName) {
  const t = text.trimStart();
  if (t.startsWith("#EXTM3U") || t.includes("#EXTINF:")) {
    return parseM3u(text, sourceName);
  }
  return parseTxt(text, sourceName);
}

async function fetchText(url) {
  const resp = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "tvbox-parse/1.0", Accept: "*/*" },
  });
  if (!resp.ok) throw new Error(`http_${resp.status}`);
  return resp.text();
}

const urls = parseSubscribeTxt(
  await readFile(join(ROOT, "sources", "subscribe.txt"), "utf8").catch(() => ""),
);

if (!urls.length) {
  console.error(
    "[parse] sources/subscribe.txt 里没有订阅地址（每行一个 http/https URL）",
  );
  process.exit(1);
}

console.log(`[parse] subscribe=${urls.length} probe=${doProbe ? "yes" : "no"}`);

const allItems = [];
const report = [];

for (const url of urls) {
  try {
    console.log(`[fetch] ${url}`);
    const text = await fetchText(url);
    const items = parsePlaylist(text, url);
    console.log(`[ok] ${items.length} channels`);
    report.push({ url, ok: true, count: items.length });
    for (const it of items) {
      allItems.push({
        name: it.name,
        group: it.group || "默认",
        url: it.url,
        logo: it.logo || "",
        tvgId: it.tvgId || "",
        source: url,
      });
    }
  } catch (err) {
    console.warn(`[fail] ${url} -> ${err.message}`);
    report.push({ url, ok: false, error: String(err.message || err) });
  }
}

// merge by name+url de-dupe
const seen = new Set();
const merged = [];
for (const it of allItems) {
  const key = `${it.name}||${it.url}`;
  if (seen.has(key)) continue;
  seen.add(key);
  merged.push(it);
}

// channels shape for m3u builder
function toChannels(items) {
  const map = new Map();
  for (const it of items) {
    const k = `${it.group}||${it.name}`;
    if (!map.has(k)) {
      map.set(k, {
        name: it.name,
        group: it.group,
        logo: it.logo,
        tvgId: it.tvgId,
        urls: [],
      });
    }
    const ch = map.get(k);
    if (!ch.urls.includes(it.url)) ch.urls.push(it.url);
  }
  return [...map.values()];
}

let channels = toChannels(merged);
let aliveChannels = channels;

if (doProbe) {
  const allUrls = [];
  for (const ch of channels) {
    for (const u of ch.urls) if (!allUrls.includes(u)) allUrls.push(u);
  }
  console.log(`[probe] urls=${allUrls.length}`);
  const probes = await probeAll(allUrls, { concurrency: 20, timeoutMs: 8000 });
  aliveChannels = [];
  for (const ch of channels) {
    const alive = ch.urls
      .map((u) => probes.get(u))
      .filter((r) => r?.ok)
      .sort((a, b) => (a.latencyMs ?? 1e9) - (b.latencyMs ?? 1e9));
    if (!alive.length) continue;
    aliveChannels.push({
      ...ch,
      urls: alive.map((r) => r.url),
      latencyMs: alive[0].latencyMs,
    });
  }
  console.log(`[probe] alive_channels=${aliveChannels.length}`);
}

await mkdir(OUT, { recursive: true });
await writeFile(
  join(OUT, "parsed.json"),
  JSON.stringify(
    {
      parsed_at: new Date().toISOString(),
      sources: report,
      item_count: merged.length,
      channel_count: channels.length,
      items: merged,
    },
    null,
    2,
  ) + "\n",
  "utf8",
);
await writeFile(join(OUT, "parsed.m3u"), buildM3u(channels), "utf8");
await writeFile(join(OUT, "parsed.txt"), buildTxt(channels), "utf8");
if (doProbe) {
  await writeFile(join(OUT, "alive.m3u"), buildM3u(aliveChannels), "utf8");
  await writeFile(join(OUT, "alive.txt"), buildTxt(aliveChannels), "utf8");
}

const lines = [
  `解析时间: ${new Date().toISOString()}`,
  `订阅数: ${urls.length}`,
  `解析条目: ${merged.length}`,
  `合并频道: ${channels.length}`,
  doProbe ? `存活频道: ${aliveChannels.length}` : `存活频道: (未探测，加 --probe)`,
  "",
  "来源：",
  ...report.map((r) =>
    r.ok ? `  OK  ${r.count}\t${r.url}` : `  FAIL ${r.error}\t${r.url}`,
  ),
  "",
  `输出目录: ${OUT}`,
];
await writeFile(join(OUT, "report.txt"), lines.join("\n") + "\n", "utf8");

console.log(`\n[parse] done -> ${OUT}`);
console.log(lines.filter((l) => l.startsWith("订阅") || l.startsWith("解析") || l.startsWith("合并") || l.startsWith("存活")).join("\n"));
