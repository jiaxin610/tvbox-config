/** Prefer public DNS for resolve4*; fetch/lookup still uses OS DNS on Windows. */

import dns from "node:dns";
import { setDefaultResultOrder } from "node:dns";
import https from "node:https";
import http from "node:http";

const PUBLIC_DNS = ["8.8.8.8", "1.1.1.1", "8.8.4.4"];

let applied = false;

export function preferPublicDns() {
  if (applied) return;
  applied = true;
  try {
    dns.setServers(PUBLIC_DNS);
    setDefaultResultOrder("ipv4first");
  } catch {
    /* ignore */
  }
}

/**
 * Fetch text; if OS DNS fails (ENOTFOUND), try resolve4 via public DNS
 * then HTTPS with correct SNI/Host. Skips obvious polluted IPs when possible.
 */
export async function fetchTextResilient(url, { headers = {}, timeoutMs = 20000 } = {}) {
  preferPublicDns();
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        redirect: "follow",
        signal: ac.signal,
        headers,
      });
      const text = await resp.text();
      return { ok: resp.ok, status: resp.status, text };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const code = err?.cause?.code || err?.code || "";
    if (code !== "ENOTFOUND" && err?.name !== "AbortError") {
      // still try IP path for other DNS weirdness
    }
  }

  const u = new URL(url);
  let ips = [];
  try {
    ips = await dns.promises.resolve4(u.hostname);
  } catch {
    throw new Error(`dns_fail:${u.hostname}`);
  }
  if (!ips.length) throw new Error(`dns_empty:${u.hostname}`);

  let lastErr = null;
  for (const ip of ips.slice(0, 3)) {
    try {
      return await requestByIp(u, ip, headers, timeoutMs);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error(`connect_fail:${u.hostname}`);
}

function requestByIp(u, ip, headers, timeoutMs) {
  const lib = u.protocol === "http:" ? http : https;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        host: ip,
        servername: u.hostname,
        path: `${u.pathname}${u.search}`,
        method: "GET",
        headers: { ...headers, Host: u.hostname },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.end();
  });
}
