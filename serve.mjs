#!/usr/bin/env node
/** Tiny static server for dist/ — local TVBox testing on LAN. */

import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "dist");
const PORT = Number(process.env.PORT || 8080);

const TYPES = {
  ".json": "application/json; charset=utf-8",
  ".m3u": "application/vnd.apple.mpegurl; charset=utf-8",
  ".m3u8": "application/vnd.apple.mpegurl; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

const server = http.createServer(async (req, res) => {
  try {
    const path = (req.url || "/").split("?")[0];
    const file = path === "/" ? "/config.json" : path;
    const abs = join(ROOT, file.replace(/^\/+/, ""));
    if (!abs.startsWith(ROOT)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    const body = await readFile(abs);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(abs)] || "application/octet-stream",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  const ifaces = Object.values(os.networkInterfaces()).flat().filter(Boolean);
  const ipv4 = ifaces.filter((i) => i.family === "IPv4" && !i.internal).map((i) => i.address);
  console.log(`Serving ${ROOT}`);
  console.log(`Local:  http://127.0.0.1:${PORT}/config.json`);
  for (const ip of ipv4) {
    console.log(`LAN:    http://${ip}:${PORT}/config.json`);
  }
});
