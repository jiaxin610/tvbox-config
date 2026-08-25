/** 定时重新拉取点播单仓并发布 */
import { buildPublish } from "./build.mjs";
import { pushToGithub } from "./gh-push.mjs";

const DEFAULT_HOURS = 12;

export async function runOnce({ push = true, onLog = console.log } = {}) {
  onLog(`[vod] update start ${new Date().toISOString()}`);
  const result = await buildPublish({ onLog });
  onLog(`[vod] sites=${result.sites}`);
  if (!push) return result;
  const url = await pushToGithub({ onLog });
  onLog(`[vod] published ${url}`);
  return { ...result, url };
}

export async function runDaemon({ push = true, onLog = console.log } = {}) {
  const hours = DEFAULT_HOURS;
  onLog(`[vod] daemon every ${hours}h`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await runOnce({ push, onLog });
    } catch (err) {
      onLog(`[vod] error: ${err.message}`);
    }
    onLog(`[vod] sleep ${hours}h until next run`);
    await new Promise((r) => setTimeout(r, hours * 3600 * 1000));
  }
}
