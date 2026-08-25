/** Privatize TVBox jars (+ limited js/py/json) into publish/ */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, join, extname } from "node:path";
import { isValidSpider } from "./warehouse.mjs";

export function parseJarField(jar) {
  const s = String(jar || "").trim();
  if (!s) return { url: "", md5: "" };
  const parts = s.split(";");
  return { url: parts[0].trim(), md5: (parts[2] || "").trim() };
}

export function formatJarField(url, md5) {
  return md5 ? `${url};md5;${md5}` : url;
}

function isHttpUrl(u) {
  return /^https?:\/\//i.test(String(u || "").trim());
}

function isScriptAsset(u) {
  const url = String(u || "").split(";")[0].trim();
  if (!isHttpUrl(url)) return false;
  return /\.(js|py|json)(\?|$)/i.test(url);
}

async function downloadBytes(url, timeoutMs = 12000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      redirect: "follow",
      signal: ac.signal,
      headers: { "User-Agent": "tvbox-publish/1.0", Accept: "*/*" },
    });
    if (!resp.ok) throw new Error(`http_${resp.status}`);
    return Buffer.from(await resp.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Mirror all site/spider jars to publish/jar/;
 * optionally mirror a limited number of js/py/json api files.
 */
export async function privatizeJars({
  sites,
  spider,
  outDir,
  pagesBase,
  onLog = () => {},
  maxScriptAssets = 40,
}) {
  const base = String(pagesBase || "").replace(/\/$/, "");
  const jarDir = join(outDir, "jar");
  const assetDir = join(outDir, "assets");
  await mkdir(jarDir, { recursive: true });
  await mkdir(assetDir, { recursive: true });

  const urlToHosted = new Map();
  const md5ToHosted = new Map();
  let scriptCount = 0;

  async function mirrorJarFieldFresh(jarField, preferredName = "") {
    const { url } = parseJarField(jarField);
    if (!url || !isValidSpider(url)) return jarField || "";
    if (urlToHosted.has(url)) {
      const hosted = urlToHosted.get(url);
      const md5 = [...md5ToHosted.entries()].find(([, v]) => v === hosted)?.[0];
      return formatJarField(hosted, md5 || "");
    }
    try {
      onLog(`[jar] ${url.split("/").slice(-2).join("/")}`);
      const buf = url.startsWith(`${base}/`)
        ? await readFile(join(outDir, url.slice(base.length).replace(/^\//, "")))
        : await downloadBytes(url, 20000);
      if (buf.length < 1000 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
        throw new Error("not_jar");
      }
      const md5 = createHash("md5").update(buf).digest("hex");
      if (md5ToHosted.has(md5)) {
        const hosted = md5ToHosted.get(md5);
        urlToHosted.set(url, hosted);
        return formatJarField(hosted, md5);
      }
      const fname = preferredName || `${md5.slice(0, 12)}.jar`;
      await writeFile(join(jarDir, fname), buf);
      const hosted = `${base}/jar/${fname}`;
      md5ToHosted.set(md5, hosted);
      urlToHosted.set(url, hosted);
      onLog(`[jar] saved ${fname} (${buf.length})`);
      return formatJarField(hosted, md5);
    } catch (err) {
      onLog(`[jar] skip ${url}: ${err.message}`);
      urlToHosted.set(url, url);
      return jarField;
    }
  }

  async function mirrorScript(url) {
    if (!isScriptAsset(url)) return url;
    if (urlToHosted.has(url)) return urlToHosted.get(url);
    if (scriptCount >= maxScriptAssets) return url;
    try {
      const buf = await downloadBytes(url, 8000);
      if (buf.length < 16) throw new Error("too_small");
      const md5 = createHash("md5").update(buf).digest("hex");
      if (md5ToHosted.has(md5)) {
        const hosted = md5ToHosted.get(md5);
        urlToHosted.set(url, hosted);
        return hosted;
      }
      const safe = basename(new URL(url).pathname).replace(/[^\w.\u4e00-\u9fa5-]+/g, "_") || "file";
      const fname = `${md5.slice(0, 10)}_${safe}`;
      await writeFile(join(assetDir, fname), buf);
      const hosted = `${base}/assets/${fname}`;
      md5ToHosted.set(md5, hosted);
      urlToHosted.set(url, hosted);
      scriptCount += 1;
      onLog(`[asset] ${fname}`);
      return hosted;
    } catch (err) {
      onLog(`[asset] skip: ${err.message}`);
      urlToHosted.set(url, url);
      return url;
    }
  }

  let newSpider = spider || "";
  if (newSpider) {
    const mirrored = await mirrorJarFieldFresh(newSpider, "spider.jar");
    if (mirrored) newSpider = mirrored;
  }

  const loginCfg = (sites || []).find(
    (s) => /^csp_Config$/i.test(String(s.api || "").split("?")[0]) && String(s.jar || "").trim(),
  );
  if (loginCfg?.jar) {
    await mirrorJarFieldFresh(loginCfg.jar, "pan-login.jar");
  }

  const spiderSrc = parseJarField(spider).url;
  const loginSrc = parseJarField(loginCfg?.jar).url;

  const newSites = [];
  for (const s of sites || []) {
    const site = { ...s };

    if (site.jar) {
      const src = parseJarField(site.jar).url;
      if (!isValidSpider(src)) {
        delete site.jar;
      } else {
        let preferred = "";
        if (src === spiderSrc) preferred = "spider.jar";
        else if (loginSrc && src === loginSrc) preferred = "pan-login.jar";
        const mirrored = await mirrorJarFieldFresh(site.jar, preferred);
        if (mirrored) site.jar = mirrored;
        else delete site.jar;
      }
    }

    const api = String(site.api || "").trim();
    if (isScriptAsset(api) && !/^csp_/i.test(api)) {
      site.api = await mirrorScript(api);
    }
    if (typeof site.ext === "string" && isScriptAsset(site.ext)) {
      site.ext = await mirrorScript(site.ext);
    }

    newSites.push(site);
  }

  onLog(`[mirror] jars=${md5ToHosted.size} scripts=${scriptCount}`);
  return { sites: newSites, spider: newSpider };
}
