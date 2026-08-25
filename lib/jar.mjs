/** Mirror TVBox jar/spider files to publish/jar/ and rewrite config URLs */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
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

async function readLocalJar(absPath) {
  const buf = await readFile(absPath);
  if (buf.length < 1000 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error("not_jar");
  }
  return buf;
}

async function downloadJar(url) {
  const resp = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "tvbox-publish/1.0", Accept: "*/*" },
  });
  if (!resp.ok) throw new Error(`http_${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length < 1000) throw new Error(`too_small_${buf.length}`);
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error("not_jar");
  return buf;
}

/**
 * Download all remote jars to publish/jar/, dedupe by content md5,
 * rewrite spider + site.jar to GitHub Pages URLs.
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
  await mkdir(jarDir, { recursive: true });

  const urlToField = new Map();
  const md5ToField = new Map();

  async function saveJar(buf, preferredName) {
    const md5 = createHash("md5").update(buf).digest("hex");
    if (md5ToField.has(md5)) return md5ToField.get(md5);

    const fname = preferredName || `${md5.slice(0, 12)}.jar`;
    await writeFile(join(jarDir, fname), buf);
    const hosted = `${base}/jar/${fname}`;
    const field = formatJarField(hosted, md5);
    md5ToField.set(md5, field);
    onLog(`[jar] saved ${fname} (${buf.length} bytes)`);
    return field;
  }

  async function mirrorJarField(jarField, preferredName = "") {
    const { url } = parseJarField(jarField);
    if (!url) return jarField || "";
    if (urlToField.has(url)) return urlToField.get(url);

    if (url.startsWith(`${base}/`)) {
      urlToField.set(url, jarField);
      return jarField;
    }

    if (!isValidSpider(url)) {
      urlToField.set(url, "");
      return "";
    }

    try {
      onLog(`[jar] download ${url.split("/").slice(-2).join("/")}`);
      let buf;
      if (url.startsWith(base)) {
        const rel = url.slice(base.length).replace(/^\//, "");
        buf = await readLocalJar(join(outDir, rel));
      } else {
        buf = await downloadJar(url);
      }
      const field = await saveJar(buf, preferredName);
      urlToField.set(url, field);
      return field;
    } catch (err) {
      onLog(`[jar] mirror failed ${url}: ${err.message}`);
      urlToField.set(url, jarField);
      return jarField;
    }
  }

  let newSpider = spider || "";
  if (newSpider) {
    const mirrored = await mirrorJarField(newSpider, "spider.jar");
    if (mirrored) newSpider = mirrored;
  }

  const loginJarField = (sites || []).find((s) =>
    /^csp_Config$/i.test(String(s.api || "")),
  )?.jar;
  if (loginJarField) {
    await mirrorJarField(loginJarField, "pan-login.jar");
  }

  const spiderSrc = parseJarField(spider).url;
  const loginJarSrc = parseJarField(
    (sites || []).find((s) => /^csp_Config$/i.test(String(s.api || "")))?.jar,
  ).url;
  const newSites = [];
  for (const s of sites || []) {
    const site = { ...s };
    if (!site.jar) {
      newSites.push(site);
      continue;
    }
    const src = parseJarField(site.jar).url;
    if (!isValidSpider(src)) {
      delete site.jar;
      newSites.push(site);
      continue;
    }
    let preferred = "";
    if (src && src === spiderSrc) preferred = "spider.jar";
    else if (src && loginJarSrc && src === loginJarSrc) preferred = "pan-login.jar";
    const mirrored = await mirrorJarField(site.jar, preferred);
    if (mirrored) site.jar = mirrored;
    else delete site.jar;
    newSites.push(site);
  }

  onLog(`[jar] privatized ${md5ToField.size} unique file(s)`);
  return { sites: newSites, spider: newSpider };
}
