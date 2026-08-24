/** Parse TVBox configs: nxog 加密、JSON 注释、换行损坏 */

/** nxog 等：jhSPAyzn**base64… */
export function decodeNxogPayload(text) {
  const raw = String(text || "").trim();
  if (!raw.includes("**")) return raw;

  const b64 = raw.split("**").pop().replace(/[^A-Za-z0-9+/=]/g, "");
  if (!b64) return raw;
  try {
    return Buffer.from(b64, "base64").toString("utf8");
  } catch {
    return raw;
  }
}

/** 去掉整行 // 注释 */
export function stripLineComments(text) {
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

/** 修复字符串内未转义换行，并压缩结构空白 */
export function normalizeTvboxJson(text) {
  let body = stripLineComments(text);
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("not_json");
  body = body.slice(start, end + 1);

  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (esc) {
        out += c;
        esc = false;
        continue;
      }
      if (c === "\\") {
        out += c;
        esc = true;
        continue;
      }
      if (c === '"') {
        out += c;
        inStr = false;
        continue;
      }
      if (c === "\n") {
        out += "\\n";
        continue;
      }
      if (c === "\r") continue;
      out += c;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    if (c === "\n" || c === "\r" || c === "\t") continue;
    if (c === " " && out.at(-1) === " ") continue;
    out += c;
  }
  return out;
}

export function parseTvboxConfigText(text) {
  let body = decodeNxogPayload(text);
  body = normalizeTvboxJson(body);
  const data = JSON.parse(body);
  if (!data || typeof data !== "object") throw new Error("bad_json");
  return data;
}
