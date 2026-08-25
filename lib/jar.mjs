/** Privatize TVBox assets: jar/spider + http js/py/json into publish/ */

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

function isAssetUrl(u) {
  const url = String(u || "").split(";")[0].trim();
  if (!isHttpUrl(url)) return false;
  return /\.(jar|jpg|jpeg|png|gif|js|py|json|txt|html?)(\?|$)/i.test(url);
}

function assetExt(url) {
  try {
    const p = new URL(url).pathname;
    const e = extname(p).toLowerCase();
    if (e === ".jpg" || e === ".jpeg" || e === ".png" || e === ".gif") return ".jar";
    return e || ".bin";
  } catch {
    return ".bin";
  }
}

async function downloadBytes(url) {
  const resp = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "tvbox-publish/1.0", Accept: "*/*" },
  });
  if (!resp.ok) throw new Error(`http_${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

/**
 * Download remote jars + site api/ext file URLs to publish/,
 * rewrite to GitHub Pages. Preserves TOP jar layout (site jar vs global spider).
 */
export async function privatizeJars({
  sites,
  spider,
  outDir,
  pagesBase,
  onLog = () => {},
}) {
  const base = String(pagesBase || "").replace(/\/$/, "");
  const jarDir = join(outDir, "jar");
  const assetDir = join(outDir, "assets");
  await mkdir(jarDir, { recursive: true });
  await mkdir(assetDir, { recursive: true });

  const urlToHosted = new Map();
  const md5ToHosted = new Map();

  async function mirrorUrl(rawUrl, { asJar = false, preferredName = "" } = {}) {
    const url = String(rawUrl || "").split(";")[0].trim();
    if (!url) return "";
    if (urlToHosted.has(url)) return urlToHosted.get(url);
    if (url.startsWith(`${base}/`)) {
      urlToHosted.set(url, url);
      return url;
    }
    if (!isHttpUrl(url)) {
      urlToHosted.set(url, "");
      return "";
    }

    try {
      onLog(`[mirror] ${url.split("/").slice(-2).join("/")}`);
      const buf = await downloadBytes(url);
      if (buf.length < 32) throw new Error(`too_small_${buf.length}`);

      if (asJar || isValidSpider(url)) {
        if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error("not_jar");
      }

      const md5 = createHash("md5").update(buf).digest("hex");
      if (md5ToHosted.has(md5)) {
        const hit = md5ToHosted.get(md5);
        urlToHosted.set(url, hit);
        return hit;
      }

      let hosted;
      if (asJar || isValidSpider(url)) {
        const fname = preferredName || `${md5.slice(0, 12)}.jar`;
        await writeFile(join(jarDir, fname), buf);
        hosted = `${base}/jar/${fname}`;
      } else {
        const ext = assetExt(url);
        const safe = basename(new URL(url).pathname).replace(/[^\w.\u4e00-\u9fa5-]+/g, "_") || "file";
        const fname = preferredName || `${md5.slice(0, 10)}_${safe}${extname(safe) ? "" : ext}`;
        await writeFile(join(assetDir, fname), buf);
        hosted = `${base}/assets/${fname}`;
      }

      md5ToHosted.set(md5, hosted);
      urlToHosted.set(url, hosted);
      onLog(`[mirror] ok ${hosted.split("/").slice(-2).join("/")} (${buf.length})`);
      return hosted;
    } catch (err) {
      onLog(`[mirror] skip ${url}: ${err.message}`);
      urlToHosted.set(url, url);
      return url;
    }
  }

  async function mirrorJarField(jarField, preferredName = "") {
    const { url, md5 } = parseJarField(jarField);
    if (!url) return jarField || "";
    if (!isValidSpider(url)) return "";
    const hosted = await mirrorUrl(url, { asJar: true, preferredName });
    if (!hosted) return "";
    return formatJarField(hosted, md5 || createHash("md5").update(hosted).digest("hex").slice(0, 32));
  }

  // Recompute md5 from actual file when we have preferred names
  async function mirrorJarFieldFresh(jarField, preferredName = "") {
    const { url } = parseJarField(jarField);
    if (!url || !isValidSpider(url)) return jarField || "";
    try {
      const buf = url.startsWith(`${base}/`)
        ? await readFile(join(outDir, url.slice(base.length).replace(/^\//, "")))
        : await downloadBytes(url);
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
      onLog(`[jar] saved ${fname} (${buf.length} bytes)`);
      return formatJarField(hosted, md5);
    } catch (err) {
      onLog(`[jar] mirror failed ${url}: ${err.message}`);
      return jarField;
    }
  }

  let newSpider = spider || "";
  if (newSpider) {
    const mirrored = await mirrorJarFieldFresh(newSpider, "spider.jar");
    if (mirrored) newSpider = mirrored;
  }

  // Prefer name pan-login.jar for first Config that has its own jar
  const loginCfg = (sites || []).find(
    (s) => /^csp_Config$/i.test(String(s.api || "").split("?")[0]) && String(s.jar || "").trim(),
  );
  if (loginCfg?.jar) {
    await mirrorJarFieldFresh(loginCfg.jar, "pan-login.jar");
  }

  const spiderSrc = parseJarField(spider).url;
  const loginSrc = parseJarField(loginCfg?.jar).url;

  async function rewriteExt(ext) {
    if (ext == null) return ext;
    if (typeof ext === "string") {
      if (isAssetUrl(ext)) return (await mirrorUrl(ext)) || ext;
      return ext;
    }
    if (Array.isArray(ext)) {
      const out = [];
      for (const item of ext) out.push(await rewriteExt(item));
      return out;
    }
    if (typeof ext === "object") {
      const out = {};
      for (const [k, v] of Object.entries(ext)) {
        if (typeof v === "string" && isAssetUrl(v)) {
          out[k] = (await mirrorUrl(v)) || v;
        } else if (v && typeof v === "object") {
          out[k] = await rewriteExt(v);
        } else {
          out[k] = v;
        }
      }
      return out;
    }
    return ext;
  }

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
    if (isAssetUrl(api) && !/^csp_/i.test(api)) {
      const hosted = await mirrorUrl(api);
      if (hosted) site.api = hosted;
    }

    if (site.ext != null) {
      site.ext = await rewriteExt(site.ext);
    }

    newSites.push(site);
  }

  onLog(`[mirror] privatized ${md5ToHosted.size} unique file(s)`);
  return { sites: newSites, spider: newSpider };
}
