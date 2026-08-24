/** iptv-api 风格定时更新：采集 → 筛高清/4K → 测速 → 发布 */
import { buildPublish } from "./build.mjs";
import { pushToGithub } from "./gh-push.mjs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function loadRefreshHours() {
  try {
    const raw = JSON.parse(
      await readFile(join(ROOT, "sources", "upstreams.json"), "utf8"),
    );
    const h = Number(raw.refreshHours);
    return Number.isFinite(h) && h > 0 ? h : 6;
  } catch {
    return 6;
  }
}

export async function runOnce({ push = true, onLog = console.log } = {}) {
  onLog(`[iptv-api] update start ${new Date().toISOString()}`);
  const result = await buildPublish({ onLog });
  onLog(
    `[iptv-api] live=${result.channels} vod=${result.sites} (HD/4K only)`,
  );
  if (!push) return result;
  const url = await pushToGithub({ onLog });
  onLog(`[iptv-api] published ${url}`);
  return { ...result, url };
}

/** 后台循环：每 refreshHours 小时更新一次 */
export async function runDaemon({ push = true, onLog = console.log } = {}) {
  const hours = await loadRefreshHours();
  onLog(`[iptv-api] daemon every ${hours}h (minQuality=标清起)`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await runOnce({ push, onLog });
    } catch (err) {
      onLog(`[iptv-api] error: ${err.message}`);
    }
    const ms = hours * 3600 * 1000;
    onLog(`[iptv-api] sleep ${hours}h until next run`);
    await new Promise((r) => setTimeout(r, ms));
  }
}
