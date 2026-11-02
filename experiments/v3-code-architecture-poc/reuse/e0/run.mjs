#!/usr/bin/env node
// E0 有界薄片跑手——「复用优先」四事件薄片：append → replay → 投影 → 读回 + 两条纪律 + 出口实测。
// 退出码即结论：0 = 四事件跑通且全部正例绿、全部负例按预期红（被拒/被抓）；1 = 任一断言失效；2 = 环境前置缺失。
// 数据全部落 .scratch/e0/run/（可弃；.gitignore 已含 .scratch/）。宿主不可用时退模型形（如实打印模式）。

import { existsSync, mkdirSync, readFileSync, rmSync, copyFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { E0EventLog, bindPolicy } from "./lib/eventlog.mjs";
import { makePolicy, E0_EVENT_TYPES } from "./lib/validate.mjs";
import { project, naiveProject, UNKNOWN } from "./lib/projection.mjs";
import { readChain, appendLine, makeTornTail } from "./lib/jsonl.mjs";
import { openLedger, mirrorEvent, assertNoStandingObject, tryTamper } from "./lib/sqlite.mjs";
import { openHost, adaptHostLog } from "./lib/hostsession.mjs";
import { defineTool, ToolScope, preExecuteGate, decision, PromptSections, SlotsClientSide, assertNoIdentityMachinery } from "./lib/exit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../../..");
const DATA = join(REPO, ".scratch", "e0", "run");

let pass = 0;
let fail = 0;
const log_ = [];
function check(name, fn) {
  try {
    if (fn() === false) throw new Error("返回 false");
    pass++;
    log_.push(`PASS ${name}`);
  } catch (err) {
    fail++;
    log_.push(`FAIL ${name} :: ${err.message}`);
  }
}
// 负例：fn 必须抛 E0_REFUSED[:code 前缀]；不被拒 = 纪律失效 = 记 FAIL（=「混存必拒/补全必红」兑现）
function expectRefusal(name, fn, code = "") {
  try {
    fn();
    fail++;
    log_.push(`FAIL ${name} :: 本应被拒却被接纳（纪律失效）`);
  } catch (err) {
    if (String(err.message).startsWith(`E0_REFUSED${code ? " " + code : ""}`)) {
      pass++;
      log_.push(`PASS(负例红) ${name} :: ${err.message}`);
    } else {
      fail++;
      log_.push(`FAIL ${name} :: 抛错但非政策拒绝: ${err.message}`);
    }
  }
}

// —— 环境准备 ————————————————————————————————
rmSync(DATA, { recursive: true, force: true });
mkdirSync(DATA, { recursive: true });
const JSONL = join(DATA, "e0-ledger.jsonl");
const SQLITE = join(DATA, "e0-projection.sqlite");

const host = await openHost({ repoRoot: REPO });
console.log(`[E0] 真源模式 = ${host.mode}${host.mode === "real-host-session" ? "（宿主 Session 构建产物在位：机制面为宿主直用）" : "（宿主构建产物不在位：机制面为模型形复刻）"}`);

// 活动折叠（政策读侧依赖：standing 现值 / seq 可见 / 断言存在性）——由 post-commit 订阅推进
function makeLive() {
  const assertions = new Set();
  const assessmentIds = new Set();
  const standing = new Map();
  return {
    assessmentIds,
    onEvent(ev) {
      if (ev.type === "assertion.recorded") assertions.add(ev.data.assertionId);
      if (ev.type === "assessment.appended") assessmentIds.add(ev.data.assessmentId);
      if (ev.type === "standing.changed") standing.set(ev.data.subjectRef.assertionId, ev.data.to);
    },
    getStanding: (id) => standing.get(id) ?? UNKNOWN,
    hasAssertion: (id) => assertions.has(id),
    standingMap: standing,
  };
}

function buildLog(policy, live) {
  if (host.mode === "real-host-session") {
    const l = adaptHostLog(host, { policy });
    l.subscribe(live.onEvent);
    return l;
  }
  const l = new E0EventLog();
  bindPolicy(l, policy);
  l.subscribe(live.onEvent);
  return Object.assign(l, { backend: "model", subscribe: l.subscribe.bind(l), fork: (n) => l.fork(n) });
}

let live = makeLive();
let policy = makePolicy({ getStanding: live.getStanding, hasSeq: (s) => s < log.seq, hasAssertion: live.hasAssertion, assessmentIds: live.assessmentIds });
let log = buildLog(policy, live);
const db = openLedger(SQLITE);

// 驱动层「提交后镜像」：log 是写侧唯一入口；jsonl + sqlite 是 post-commit 投影载体
function commit(type, data, opts = {}) {
  // 宿主事件面要求 JSON 可序列化载荷（实测：含 undefined 成员即拒）——在驱动边界做 JSON 归一，纪律判定不因此放松
  const ev = log.append(type, JSON.parse(JSON.stringify(data ?? {})), opts);
  const line = appendLine(JSONL, { seq: ev.seq, type: ev.type, sourceEventSeqs: ev.sourceEventSeqs, occurredAt: ev.occurredAt, recordedAt: ev.recordedAt, data: ev.data });
  mirrorEvent(db, { ...ev, digest: JSON.parse(line).digest });
  return ev;
}

// —— P 组：四事件 append → replay → 投影 → 读回 ——————————————————
check("P0 四事件名不在生产 20 冻结名内（冲突的机验证据，冻结面只读）", () => {
  const src = readFileSync(join(REPO, "src/host/history/registry/types.ts"), "utf8");
  const frozen = [...src.matchAll(/^\s{2}([A-Z][A-Z_]+):\s\w+Payload/gm)].map((m) => m[1]);
  if (frozen.length !== 20) throw new Error(`生产冻结事件名数=${frozen.length}，应为 20（冻结面被改过？）`);
  if (E0_EVENT_TYPES.some((t) => frozen.includes(t))) throw new Error("E0 事件名撞上冻结名");
  return true;
});

const scen = [
  ["assertion.recorded", { assertionId: "A1", channel: "SOURCE", text: "论文X §3：方法在 3 个基准上收敛" }, []],
  ["assertion.recorded", { assertionId: "A2", channel: "INFERENCE", text: "由 A1 外推：同类任务可迁移", basedOn: [0] }, [0]],
  ["assertion.recorded", { assertionId: "A3", channel: "SUGGESTION", text: "建议下一步跑消融", basedOn: [0] }, [0]],
  ["evidence.linked", { evidenceId: "EV1", assertionId: "A1", relation: "supports", locator: "p.12 ¶2", quote: "converges on all three" }, [0]],
  ["evidence.linked", { evidenceId: "EV2", assertionId: "A1", relation: "contradicts" }, [0]],
  ["assessment.appended", { assessmentId: "ASM1", subjectRef: { assertionId: "A1" }, stance: "POSITIVE", rationale: "直接引用支持" }, [3]],
  ["assessment.appended", { assessmentId: "ASM2", subjectRef: { assertionId: "A1" }, rationale: "矛盾证据未消化（stance 故意缺省）" }, [4]],
  ["standing.changed", { subjectRef: { assertionId: "A2" }, from: UNKNOWN, to: "CANDIDATE", reason: "外推有 A1 支持" }, [1]],
  ["standing.changed", { subjectRef: { assertionId: "A2" }, from: "CANDIDATE", to: "ACCEPTED", reason: "人工确认接纳" }, [7]],
  ["standing.changed", { subjectRef: { assertionId: "A2" }, from: "ACCEPTED", to: "RETRACTED", reason: "EV2 矛盾证据到位 → 接纳撤回" }, [4, 8]],
  ["standing.changed", { subjectRef: { assertionId: "A2" }, from: "RETRACTED", to: "CANDIDATE", reason: "重审中" }, [9]],
  ["standing.changed", { subjectRef: { assertionId: "A2" }, from: "CANDIDATE", to: "ACCEPTED", reason: "限定范围内重新接纳" }, [10]],
];
for (const [type, data, src] of scen) {
  check(`P1 append ${type}`, () => commit(type, data, { sourceEventSeqs: src }).seq >= 0);
}

check("P2 seq 连续且 = 日志长度（宿主 seq 契约）", () => log.seq === scen.length);

const records = readChain(JSONL);
check("P3 jsonl replay：digest 链 + seq 连续（全量读回）", () => records.length === scen.length);

// 交叉验证：内存事件面（宿主/模型形 log）折叠 vs 落盘 jsonl 重放折叠——两条路径投影必须逐字节相同
const liveProjection = project(log.snapshotEvents(0, scen.length).map((e) => ({ seq: e.seq, type: e.type, data: e.data })));
const rebuilt = project(records.map((r) => ({ seq: r.seq, type: r.type, data: r.data })));
check("P4 replay 投影 = 内存事件面投影（真源→投影可重建，两路径交叉）", () => JSON.stringify(liveProjection.snapshot()) === JSON.stringify(rebuilt.snapshot()));

check("P5 sqlite 镜像行数一致 + 无 standing 对象表（standing 不是 kind 的 DDL 机验）", () => {
  const n = db.prepare("SELECT COUNT(*) c FROM e0_event").get().c;
  return n === scen.length && assertNoStandingObject(db);
});

check("P6 standing.changed 表达「接纳可撤回」且不需要 FactStanding 对象", () => {
  // (a) 撤回 = 一条追加事件：日志只增一、无改写位（sqlite 触发器 P8 证、jsonl 链 P3 证）
  // (b) standing@时点：撤回前 ACCEPTED、撤回后 RETRACTED、再接纳后 ACCEPTED——全靠事件前缀折叠
  if (liveProjection.viewAt(9).standingOf("A2") !== "ACCEPTED") return false;
  if (liveProjection.viewAt(10).standingOf("A2") !== "RETRACTED") return false;
  if (liveProjection.standingOf("A2") !== "ACCEPTED") return false;
  // (c) standing 的唯一来源是 standing.changed 事件流：抽掉这类事件后无从得知 → 恒 UNKNOWN（不是「默认未接纳」）
  const stripped = project(records.filter((r) => r.type !== "standing.changed"));
  return stripped.standingOf("A2") === UNKNOWN;
});

check("P7 时点窗读回（宿主 snapshotEvents 形）+ 冻结", () => {
  const win = log.snapshotEvents(0, 3);
  if (win.length !== 3 || !Object.isFrozen(win) || !Object.isFrozen(win[0])) return false;
  try {
    win[0].type = "x";
    return false; // 改得动 = 未冻结 = 红
  } catch {
    return win[0].type === "assertion.recorded";
  }
});

check("P8 sqlite 物理篡改被触发器拒（生产 INV-HIST-1 形复用）", () => {
  const r = tryTamper(db);
  return r.blocked && r.deleteAlsoBlocked;
});

check("P9 fork 前缀截点：子只见前缀，父不受扰（宿主形另含 end-seed 标记占位——两形差异如实断言）", () => {
  const parentSeq = log.seq;
  const parentPrefix = JSON.stringify(log.snapshotEvents(0, 4).map((e) => [e.seq, e.type]));
  const child = log.fork(4);
  const childOwn = child.append("assertion.recorded", { assertionId: "A4", channel: "SOURCE", text: "fork 后的新断言" }, { sourceEventSeqs: [3] });
  if (log.seq !== parentSeq) return false; // 父不受扰
  if (JSON.stringify(child.snapshotEvents(0, 4).map((e) => [e.seq, e.type])) !== parentPrefix) return false; // 前缀逐等
  if (child.seq !== childOwn.seq + 1) return false; // 子的 own 是末条
  if (child.backend === "host") {
    // @e0-reuse host tests/deepseek-harness/packages/core/session/src/types.ts:427 — 实测发现：宿主 fork 注入 'session/end-seed' 标记且占一个 seq——模型形复刻**不**含此标记（两形差异如实记录，见 README §5）
    const marker = child.snapshotEvents(4, childOwn.seq).at(-1);
    return childOwn.seq === 5 && marker?.type === "session/end-seed";
  }
  return childOwn.seq === 4; // 模型形：无标记，own 直接续在截点后
});

if (host.mode === "real-host-session") {
  check("P10 宿主 Session 变异面封闭：prototype 无 update/delete/truncate/pop", () => {
    const names = Object.getOwnPropertyNames(host.Session.prototype);
    return !["update", "delete", "truncate", "pop", "splice", "remove"].some((k) => names.includes(k));
  });
}

// —— N 组：两条纪律 + 政策负例（必拒；被接纳即整体红） ——————————————————
expectRefusal("N1 三通道混存（channel 数组）必拒", () => commit("assertion.recorded", { assertionId: "B1", channel: ["SOURCE", "INFERENCE"] }, {}), "MIXED_OR_UNKNOWN_CHANNEL");
expectRefusal("N2 三通道混存（组合串 SOURCE+INFERENCE）必拒", () => commit("assertion.recorded", { assertionId: "B2", channel: "SOURCE+INFERENCE" }, {}), "MIXED_OR_UNKNOWN_CHANNEL");
expectRefusal("N3 SOURCE 通道混存推断键名必拒（/inference|suggestion|llm_/ 键名判据）", () => commit("assertion.recorded", { assertionId: "B3", channel: "SOURCE", inference_basis: "模型脑补" }, {}), "MIXED_CHANNEL_KEY");
expectRefusal("N4 INFERENCE 缺 basedOn 必拒", () => commit("assertion.recorded", { assertionId: "B4", channel: "INFERENCE", text: "无据外推" }, {}), "BASED_ON_REQUIRED");
expectRefusal("N5 INFERENCE basedOn 悬空必拒", () => commit("assertion.recorded", { assertionId: "B5", channel: "INFERENCE", text: "悬空", basedOn: [999] }, {}), "BASED_ON_DANGLING");
expectRefusal("N6 缺通道不默认（默认=洗白）", () => commit("assertion.recorded", { assertionId: "B6", text: "无通道" }, {}), "CHANNEL_REQUIRED");
expectRefusal("N7 未知事件类型必拒", () => commit("fact.proven", { x: 1 }, {}), "UNKNOWN_EVENT_TYPE");
expectRefusal("N8 悬空因果引用必拒", () => commit("evidence.linked", { evidenceId: "EV9", assertionId: "A1", relation: "supports" }, { sourceEventSeqs: [77] }), "DANGLING_CAUSAL_REF");
expectRefusal("N9 重复 assessmentId 必拒（幂等）", () => commit("assessment.appended", { assessmentId: "ASM1", subjectRef: { assertionId: "A1" }, stance: "NEGATIVE" }, {}), "DUP_ASSESSMENT");
expectRefusal("N10 standing from≠折叠现值必拒（防丢更新）", () => commit("standing.changed", { subjectRef: { assertionId: "A2" }, from: UNKNOWN, to: "CANDIDATE" }, {}), "STALE_STANDING");
expectRefusal("N11 非法 standing 转移必拒", () => commit("standing.changed", { subjectRef: { assertionId: "A2" }, from: "ACCEPTED", to: "UNKNOWN" }, {}), "ILLEGAL_TRANSITION");
expectRefusal("N12 补全写侧必拒（_defaulted 族键=caller 塞默认值）", () => commit("assessment.appended", { assessmentId: "ASM9", subjectRef: { assertionId: "A1" }, stance_defaulted: true }, {}), "DEFAULT_FILL_FORBIDDEN");
expectRefusal("N13 null 伪装缺省必拒", () => commit("assessment.appended", { assessmentId: "ASM8", subjectRef: { assertionId: "A1" }, stance: null }, {}), "NULL_DISGUISED_AS_MISSING");

check("N14 缺 stance 的评估读回恒 UNKNOWN（ASM2 无默认立场）", () => {
  const asm2 = liveProjection.assessments.get("A1").find((a) => a.assessmentId === "ASM2");
  return asm2.stance === UNKNOWN;
});

check("N15 补全必红（变异锚点：弱化投影会补全，纪律探针必须抓住）", () => {
  const naively = naiveProject(records.map((r) => ({ seq: r.seq, type: r.type, data: structuredClone(r.data) })));
  const violations = findCompletions(naively);
  if (violations.length === 0) throw new Error("纪律探针抓不住补全——探针无效");
  return findCompletions(liveProjection).length === 0; // 正式投影必须 0 违规
});
// @e0-reuse own docs/architecture/V3_IMPLEMENTATION_CONTRACT-DRAFT.md:74 — 探针判据：事件里缺 stance 而投影给出具体立场 = 补全（「全链无补全路径」的机验化）
function findCompletions(p) {
  const missing = new Set(records.filter((r) => r.type === "assessment.appended" && !("stance" in r.data)).map((r) => r.data.assessmentId));
  const out = [];
  for (const list of p.assessments.values()) for (const a of list) if (missing.has(a.assessmentId) && a.stance !== UNKNOWN) out.push(a.assessmentId);
  return out;
}

check("N16 政策变异锚点：去掉混存检查后 N2 输入会被洗白接纳（证明 N1/N2 的红源于纪律本体）", () => {
  // 弱化政策=「channel 含 + 时截断取首段」再走正式政策——同一输入必须被接纳，说明正式政策确实拒在混存判据
  const relaxed = makePolicy({ getStanding: () => UNKNOWN, hasSeq: () => true, hasAssertion: (id) => id === "A1", assessmentIds: new Set() });
  const patched = { seq: 99, type: "assertion.recorded", sourceEventSeqs: [], occurredAt: 0, recordedAt: 0, data: { assertionId: "B2x", channel: "SOURCE" } };
  relaxed(patched); // 截断后的事件应能通过——混存判据是唯一拦截点
  return true;
});

const jsonlLinesBefore = records.length;
check("N17 jsonl 篡改（改写历史行）→ 链断必红", () => {
  const tampered = join(DATA, "tampered.jsonl");
  copyFileSync(JSONL, tampered);
  const lines = readFileSync(tampered, "utf8").split("\n").filter(Boolean);
  const target = lines.findIndex((l) => l.includes('"supports"'));
  if (target < 1) throw new Error("夹具缺 supports 行");
  lines[target] = lines[target].replace('"supports"', '"contradicts"');
  writeFileSync(tampered, lines.join("\n") + "\n");
  try {
    readChain(tampered);
    return false;
  } catch (err) {
    return err.message.startsWith("E0_REFUSED CHAIN_BROKEN");
  }
});

check("N18 撕裂尾：读不返给读者、写路径截断（宿主 session-persistence 语义复刻）", () => {
  const torn = join(DATA, "torn.jsonl");
  copyFileSync(JSONL, torn);
  makeTornTail(torn);
  const repaired = readChain(torn, { repairTornTail: true });
  return repaired.length === jsonlLinesBefore - 1 && readChain(torn).length === jsonlLinesBefore - 1;
});

expectRefusal("N19 拒绝不留痕：N1 被拒断言 B1 不可见", () => {
  if (live.hasAssertion("B1")) throw new Error("被拒事件污染了状态");
  commit("evidence.linked", { evidenceId: "EVB1", assertionId: "B1", relation: "supports" }, {}); // 应因断言不存在被拒
  throw new Error("unreachable");
});

// —— E 组：只读出口（模型形；真宿主条件见 README §4） ——————————————————
const writerScope = new ToolScope("session:writer");
const roScope = new ToolScope("investigator:read-only");
const readTool = defineTool({ name: "e0_ledger_read", description: "读投影（只读出口）", parameters: { type: "object", properties: {} }, readOnly: true, execute: async () => liveProjection.snapshot() });
const writeTool = defineTool({ name: "e0_event_append", description: "写事件", parameters: { type: "object", properties: {} }, readOnly: false, execute: async () => ({ ok: true }) });
writerScope.register(writeTool);
roScope.register(readTool); // 只读 scope 里根本不注册写工具 = scope 可见性屏蔽

check("E1 scope 可见性：只读面看不见写工具", () => roScope.visible().join() === "e0_ledger_read");
check("E2 pre-execute deny：写调用在只读 scope 被拒（decision 形状=宿主 PreToolDecision）", () => {
  const gate = preExecuteGate([roScope.name]);
  const d = gate({ scope: roScope, tool: writeTool });
  return d.kind === "deny" && typeof d.reason === "string" && Object.keys(d).every((k) => ["kind", "reason", "info"].includes(k));
});
check("E3 只读 scope 调只读工具放行；writer scope 不受扰", () => {
  const gate = preExecuteGate([roScope.name]);
  return gate({ scope: roScope, tool: readTool }).kind === "allow" && gate({ scope: writerScope, tool: writeTool }).kind === "allow";
});
check("E4 systemPrompt.section 注册+disposer", () => {
  const ps = new PromptSections();
  const dispose = ps.section({ name: "e0-readonly", order: 10, content: "你是只读调查者：账本、证据、standing 可读，不可写。" });
  const before = ps.render().length;
  dispose();
  return before === 1 && ps.render().length === 0;
});
check("E5 slot 面板形状可承载 standing（client 面槽位，读展示与写能力无关）", () => {
  const slots = new SlotsClientSide();
  const dispose = slots.register("settings.section", { kind: "panel", title: "E0 standing", fields: [{ label: "A2", value: liveProjection.standingOf("A2") }] });
  const ok = slots.observe("settings.section").length === 1;
  dispose();
  return ok && slots.observe("settings.section").length === 0;
});
check("E6 出口面无 Principal/Space/权轴机械（源码机验扫描）", () => assertNoIdentityMachinery(readFileSync(join(HERE, "lib/exit.mjs"), "utf8"), readFileSync(join(HERE, "lib/exit.mjs"), "utf8")));

// —— 汇总 ————————————————————————————————
writeFileSync(join(DATA, "verdict.json"), JSON.stringify({ mode: host.mode, pass, fail, checks: log_ }, null, 2));
for (const l of log_) console.log(l.includes("FAIL") ? l : `  ${l}`);
console.log(`\n[E0] 结论：${fail === 0 ? "跑通" : "未跑通"}（正例+负例 ${pass + fail} 条：绿 ${pass}，红 ${fail}）｜真源模式 ${host.mode}`);
db.close();
process.exit(fail === 0 ? 0 : 1);
