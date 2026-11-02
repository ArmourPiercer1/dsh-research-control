// E0 落盘与重放——E0 专用 jsonl（可弃，落 .scratch/），digest 链 + 撕裂尾截断。
// 角色：宿主 Session 面在 E0 里是「进程内真源」；jsonl 是其持久镜像 = 重放真源（跨进程可复活）。

import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, existsSync, renameSync, writeFileSync } from "node:fs";

// @e0-reuse host tests/deepseek-harness/packages/session/session-persistence/src/index.ts:119 — jsonl 仅追加 + 「a torn physical tail is never returned to a reader and is truncated by the write path before its first append」：撕裂尾读不返、写前截断
export function readChain(path, { repairTornTail = false } = {}) {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  const lines = raw.split("\n").filter((l) => l.length > 0);
  const out = [];
  let prev = "GENESIS";
  for (let i = 0; i < lines.length; i++) {
    let rec;
    try {
      rec = JSON.parse(lines[i]);
    } catch {
      // 末行解析失败 = 撕裂尾：默认不返给读者；repairTornTail 时由写路径先截断
      if (i === lines.length - 1 && repairTornTail) {
        truncateLastLine(path, lines.slice(0, i));
        return out;
      }
      throw new Error(`E0_REFUSED CORRUPT_LINE:${i + 1}`);
    }
    const { digest, ...body } = rec;
    // @e0-reuse own docs/architecture/V3_IMPLEMENTATION_CONTRACT-DRAFT.md:55 — content_sha256「hex 64 位小写」判据复用为链节点格式
    if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) refuse(`BAD_DIGEST@${i + 1}`);
    // @e0-reuse new — prev-digest 链：宿主 jsonl 无防篡改链（真源保证在进程内机制），生产 history 亦无（防改写=触发器）；跨进程后「重写旧行」只能靠链检出——E0 确需新写的一格
    const expect = digestOf(prev, body);
    if (digest !== expect) refuse(`CHAIN_BROKEN@${i + 1}`);
    if (rec.seq !== i) refuse(`SEQ_NOT_CONTIGUOUS@${i + 1}`);
    prev = digest;
    out.push(rec);
  }
  return out;
}

// @e0-reuse new — 追加写（含 digest 链）：宿主持久面在 session-persistence 包内、无公开「替任意日志落盘」API（storageDomain 不能当事件真源——无事务/可删/不跨键原子），E0 的 jsonl 写路径确需新写
export function appendLine(path, record) {
  const chain = readChain(path, { repairTornTail: true });
  const prev = chain.length ? chain.at(-1).digest : "GENESIS";
  const { digest: _drop, ...body } = record;
  const line = JSON.stringify({ ...body, digest: digestOf(prev, body) });
  appendFileSync(path, line + "\n");
  return line;
}

export function makeTornTail(path) {
  // 测试用：模拟崩溃撕裂尾（截掉最后一行的一部分）
  const raw = readFileSync(path, "utf8");
  writeFileSync(path, raw.slice(0, raw.length - 7));
}

function truncateLastLine(path, keptLines) {
  const tmp = `${path}.trunc`;
  writeFileSync(tmp, keptLines.length ? keptLines.join("\n") + "\n" : "");
  renameSync(tmp, path);
}

function digestOf(prev, body) {
  return createHash("sha256").update(prev + "\u0000" + stableStringify(body)).digest("hex");
}

// 与 JSON.stringify 同语义（undefined 成员脱落/转 null）+ 键排序：写侧与读侧（解析后）必须同形，否则 digest 自毁
function stableStringify(v) {
  if (v === null) return "null";
  if (typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map((x) => stableStringify(x)).join(",") + "]";
  return "{" + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
}

function refuse(code) {
  throw new Error(`E0_REFUSED ${code}`);
}
