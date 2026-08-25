/** 定时：网络扫台 + 点播单仓刷新并发布 */
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
  onLog(`[iptv] update start ${new Date().toISOString()}`);
  const result = await buildPublish({ onLog });
  onLog(`[iptv] live=${result.channels} vod=${result.sites}`);
  if (!push) return result;
  const url = await pushToGithub({ onLog });
  onLog(`[iptv] published ${url}`);
  return { ...result, url };
}

export async function runDaemon({ push = true, onLog = console.log } = {}) {
  const hours = await loadRefreshHours();
  onLog(`[iptv] daemon every ${hours}h (network scan, no local)`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await runOnce({ push, onLog });
    } catch (err) {
      onLog(`[iptv] error: ${err.message}`);
    }
    onLog(`[iptv] sleep ${hours}h until next run`);
    await new Promise((r) => setTimeout(r, hours * 3600 * 1000));
  }
}
