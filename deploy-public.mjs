#!/usr/bin/env node
/**
 * Upload static IPTV config to a free public host (tries several providers).
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, "dist");

async function upload0x0(filePath, fileName) {
  const buf = await readFile(filePath);
  const form = new FormData();
  form.append("file", new Blob([buf]), fileName);
  const resp = await fetch("https://0x0.st", { method: "POST", body: form });
  const text = (await resp.text()).trim();
  if (!resp.ok || !/^https?:\/\//i.test(text)) throw new Error(`0x0: ${resp.status} ${text}`);
  return text.split(/\s+/)[0];
}

async function uploadTmpfiles(filePath, fileName) {
  const buf = await readFile(filePath);
  const form = new FormData();
  form.append("file", new Blob([buf]), fileName);
  const resp = await fetch("https://tmpfiles.org/api/v1/upload", {
    method: "POST",
    body: form,
  });
  const json = await resp.json();
  const url = json?.data?.url;
  if (!url) throw new Error(`tmpfiles: ${JSON.stringify(json)}`);
  // tmpfiles returns html page URL; convert to direct download
  return url.replace("tmpfiles.org/", "tmpfiles.org/dl/");
}

async function uploadLitterbox(filePath, fileName) {
  const buf = await readFile(filePath);
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append("time", "72h");
  form.append("fileToUpload", new Blob([buf]), fileName);
  const resp = await fetch("https://litterbox.catbox.moe/resources/internals/api.php", {
    method: "POST",
    body: form,
  });
  const text = (await resp.text()).trim();
  if (!/^https?:\/\//i.test(text)) throw new Error(`litterbox: ${text}`);
  return text;
}

async function uploadFileIo(filePath, fileName) {
  const buf = await readFile(filePath);
  const form = new FormData();
  form.append("file", new Blob([buf]), fileName);
  const resp = await fetch("https://file.io", { method: "POST", body: form });
  const json = await resp.json();
  if (!json?.success || !json?.link) throw new Error(`file.io: ${JSON.stringify(json)}`);
  return json.link;
}

const providers = [
  ["litterbox", uploadLitterbox],
  ["0x0.st", upload0x0],
  ["tmpfiles.org", uploadTmpfiles],
  ["file.io", uploadFileIo],
];

async function uploadWithFallback(filePath, fileName) {
  const errors = [];
  for (const [name, fn] of providers) {
    try {
      console.log(`try ${name} for ${fileName}…`);
      const url = await fn(filePath, fileName);
      console.log(`ok ${name}: ${url}`);
      return { provider: name, url };
    } catch (err) {
      console.warn(`fail ${name}: ${err.message}`);
      errors.push(`${name}: ${err.message}`);
    }
  }
  throw new Error("all upload providers failed:\n" + errors.join("\n"));
}

const lives = await uploadWithFallback(join(DIST, "lives.m3u"), "lives.m3u");

const config = {
  spider: "",
  wallpaper: "",
  sites: [],
  lives: [
    {
      name: "IPTV-API",
      type: 0,
      url: lives.url,
      epg: "",
      logo: "",
    },
  ],
  parses: [],
  flags: [],
  ijk: [],
  ads: [],
};

const configPath = join(DIST, "config.public.json");
await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
const cfg = await uploadWithFallback(configPath, "config.json");

const note = `${cfg.url}\n`;
await writeFile(join(ROOT, "记事本", "配置地址.txt"), note, "utf8");
await writeFile(
  join(DIST, "PUBLIC_URL.txt"),
  `config=${cfg.url}\nlives=${lives.url}\nprovider_config=${cfg.provider}\nprovider_lives=${lives.provider}\n`,
  "utf8",
);

console.log("\n======== TVBox 公网配置地址 ========");
console.log(cfg.url);
console.log("===================================\n");
