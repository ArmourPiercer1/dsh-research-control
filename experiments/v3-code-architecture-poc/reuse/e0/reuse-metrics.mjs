#!/usr/bin/env node
// E0 复用率统计——数「薄片自己写的行」vs「对应宿主/自家既有能力的行」。
// 口径（诚实定义，别读错）：
//   分母 = 薄片自写代码行（*.mjs，剔空行与纯注释行）。
//   标注 `@e0-reuse <host|own|new> <锚点>` 从其所在行起覆盖到下一个标注（或文件尾）；
//   首个标注前的行记 untagged（保守计为「确需新写」）。
//   host = 宿主直用：该行覆盖的能力在真实宿主有对应 API/机制（锚 = tests/deepseek-harness 源码路径:行）；
//   own  = 自家重构复用：生产/V3 文档已有同能力，落地时应搬/改既有件（锚 = src|schema|docs|experiments 路径:行）；
//   new  = 确需新写：两侧均无对应物（锚省）。
//   **这些行仍是我写的**——档位说的是「能力归属」，不是「键盘归属」；真复用率上限 = (host+own)/分母，
//   且 host 档行在接上真宿主后可整体删除（替换为一次 API 调用），own 档行应替换为既有件的重构搬运。
// 另计 import 面：薄片 import 宿主构建产物的行数（0 = 全部自写复刻或适配层）。

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "../../../..");
const FILES = ["lib/eventlog.mjs", "lib/validate.mjs", "lib/projection.mjs", "lib/jsonl.mjs", "lib/sqlite.mjs", "lib/hostsession.mjs", "lib/exit.mjs", "run.mjs", "reuse-metrics.mjs"];

const MARK = /@e0-reuse\s+(host|own|new)\b\s*(\S+)?/;
const rows = [];
const anchorChecks = [];
const totals = { code: 0, host: 0, own: 0, new: 0, untagged: 0 };
let importHostLines = 0;

for (const f of FILES) {
  const src = readFileSync(join(HERE, f), "utf8").split("\n");
  const per = { file: f, code: 0, host: 0, own: 0, new: 0, untagged: 0 };
  // 预扫：每行的档位 = 最近一个已生效标注
  let tier = "untagged";
  const tiers = [];
  for (const line of src) {
    const m = line.match(MARK);
    if (m) tier = m[1]; // 标注行起生效（标注行自身也归该档）
    tiers.push(tier);
  }
  let li = 0;
  for (const line of src) {
    li++;
    const t = line.trim();
    if (!t) continue;
    const isComment = t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
    if (!isComment) {
      per.code++;
      per[tiers[li - 1]]++;
      if (/^\s*import .*from .*hostsession|openHost\(/.test(line)) importHostLines++;
    }
    // 锚点真值核：host/own 标注的锚支持「路径:行」「路径:起-止」「路径（无行号=存在性核）」
    const m = line.match(MARK);
    if (m && m[2] && m[1] !== "new") {
      const idx = m[2].lastIndexOf(":");
      const path = idx > 0 && /\d/.test(m[2].slice(idx + 1)) ? m[2].slice(0, idx) : m[2];
      const spec = idx > 0 && /\d/.test(m[2].slice(idx + 1)) ? m[2].slice(idx + 1) : "";
      const abs = join(REPO, path);
      let ok = false;
      let note = "";
      if (!existsSync(abs)) note = "路径不存在";
      else if (spec) {
        const lines = readFileSync(abs, "utf8").split("\n");
        const [a, b] = spec.split("-").map(Number);
        const hi = Number.isFinite(b) ? b : a;
        if (!Number.isInteger(a) || a < 1 || hi > lines.length || !lines[a - 1].trim()) note = `锚点行无效(${spec}/${lines.length}行)`;
        else ok = true;
      } else ok = true; // 文件级锚：只核存在
      anchorChecks.push({ file: f, line: li, tier: m[1], anchor: m[2], ok, note });
    }
  }
  rows.push(per);
  for (const k of Object.keys(totals)) totals[k] += per[k];
}

const reuse = totals.host + totals.own;
const out = {
  totals,
  reuseLines: reuse,
  reuseRateOfSlice: +(reuse / totals.code).toFixed(3),
  newWriteLines: totals.new + totals.untagged,
  newWriteRate: +((totals.new + totals.untagged) / totals.code).toFixed(3),
  hostDirectShare: +(totals.host / totals.code).toFixed(3),
  anchors: {
    total: anchorChecks.length,
    ok: anchorChecks.filter((a) => a.ok).length,
    bad: anchorChecks.filter((a) => !a.ok),
  },
  importHostLines,
  note: "host/own 行=能力归属档位（落地可替换为宿主调用/既有件重构）；untagged 保守计新写",
};
writeFileSync(join(REPO, ".scratch", "e0", "reuse-metrics.json"), JSON.stringify({ ...out, rows }, null, 2));
console.log("文件".padEnd(22), "代码行", "宿主直用", "自家重构", "确需新写", "未标注");
for (const r of rows) console.log(r.file.padEnd(22), String(r.code).padStart(5), String(r.host).padStart(7), String(r.own).padStart(7), String(r.new).padStart(7), String(r.untagged).padStart(6));
console.log("\n合计：代码行", totals.code, "｜宿主直用", totals.host, "｜自家重构复用", totals.own, "｜确需新写(含未标注)", totals.new + totals.untagged);
console.log(`复用率（host+own）= ${out.reuseRateOfSlice * 100}%（宿主直用占 ${out.hostDirectShare * 100}%）`);
console.log(`锚点核真：${out.anchors.ok}/${out.anchors.total} 真`, out.anchors.bad.length ? "｜坏锚: " + out.anchors.bad.map((b) => `${b.file}:${b.line} ${b.anchor}(${b.note})`).join("; ") : "");
console.log("明细 → .scratch/e0/reuse-metrics.json");
process.exit(out.anchors.bad.length === 0 ? 0 : 1); // 坏锚 = 标注掺假 = 红
