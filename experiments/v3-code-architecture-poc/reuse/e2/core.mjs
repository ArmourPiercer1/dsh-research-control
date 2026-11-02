// e2 核心切片——科研核心在「非 DSH 宿主」形态下的可运行证明。
// 只 import e0 的 5 个零宿主模块（eventlog/validate/projection/jsonl/sqlite）——
// 本切片禁止宿主构建产物 import（hostsession/exit 在 e0 树内但此处不引，见 README §8 模型形清单）。
//
// 真源选择（为什么核心自有、不用宿主 Session）：
//   多宿主目标（Codex / Claude Code 型宿主）没有宿主 Session 这一层——宿主 Session 真源
//   把核心绑死在「单一 DSH 会话」上，跨宿主即失配。核心自有真源 = jsonl digest 链
//   （跨进程可重放、篡改可检出）+ 自有投影 sqlite（派生读面，触发器 DDL 形）——
//   不依赖任何宿主存在。宿主（无论哪个）只是经 HostPort 协议驱动本核心的一个客户端。
//
// 本文件不出现任何宿主专用符号；存储根由宿主在 initialize 时经协议提供（见 server.mjs）。

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { E0EventLog, bindPolicy } from "../e0/lib/eventlog.mjs";
import { makePolicy, E0_EVENT_TYPES } from "../e0/lib/validate.mjs";
import { project, UNKNOWN } from "../e0/lib/projection.mjs";
import { readChain, appendLine } from "../e0/lib/jsonl.mjs";
import { openLedger, mirrorEvent, assertNoStandingObject } from "../e0/lib/sqlite.mjs";

import { E2, RPC } from "./host-port-protocol.mjs";

export class E2Error extends Error {
  constructor(rpcCode, message, data) {
    super(message);
    this.name = "E2Error";
    this.rpcCode = rpcCode;
    if (data !== undefined) this.data = data;
  }
}

function isRefused(err) {
  return String(err?.message).startsWith("E0_REFUSED");
}

function toE2(err, fallbackCode) {
  if (err instanceof E2Error) return err;
  if (isRefused(err)) return new E2Error(E2.POLICY_REFUSED, err.message);
  return new E2Error(fallbackCode, String(err?.message ?? err));
}

// —— 活动折叠（政策读侧依赖：standing 现值 / seq 可见 / 断言存在性）——————
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
  };
}

// —— markdown 面板渲染（无 GUI 宿主的 UI 降级形态；slot 形态归 DSH adapter，见 README §6）——
function mdCell(v) {
  return String(v).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function renderPanelMarkdown(proj) {
  const L = [];
  L.push("# Research Core Panel（e2 · 非 DSH 宿主 · markdown 降级渲染）");
  L.push(`- events: ${proj.eventCount} ｜ standing = 事件折叠（无 standing 对象）｜ 真源: e2-ledger.jsonl（digest 链）｜ 投影: e2-projection.sqlite`);
  const assertions = [...proj.assertions.entries()].sort();
  L.push("", `## Assertions（${assertions.length}）`);
  L.push("| id | channel | standing | text |", "|---|---|---|---|");
  for (const [id, a] of assertions) L.push(`| ${mdCell(id)} | ${mdCell(a.channel)} | ${mdCell(proj.standingOf(id))} | ${mdCell(a.text)} |`);
  const evidence = [...proj.evidence.entries()].sort();
  L.push("", `## Evidence（${evidence.length}）`);
  L.push("| id | assertion | relation | locator | quote |", "|---|---|---|---|---|");
  for (const [id, e] of evidence) L.push(`| ${mdCell(id)} | ${mdCell(e.assertionId)} | ${mdCell(e.relation)} | ${mdCell(e.locator)} | ${mdCell(e.quote)} |`);
  const assessments = [...proj.assessments.entries()].sort();
  L.push("", `## Assessments（${assessments.length}）`);
  L.push("| id | subject | stance | rationale |", "|---|---|---|---|");
  for (const [aid, list] of assessments) {
    for (const a of list) L.push(`| ${mdCell(a.assessmentId)} | ${mdCell(aid)} | ${mdCell(a.stance)} | ${mdCell(a.rationale)} |`);
  }
  L.push("");
  return L.join("\n");
}

// —— 核心本体 ————————————————————————————————————————————————
export function createCore({ storageRoot }) {
  if (typeof storageRoot !== "string" || !storageRoot) {
    throw new E2Error(RPC.INVALID_PARAMS, "storageRoot required");
  }
  mkdirSync(storageRoot, { recursive: true });
  const jsonlPath = join(storageRoot, "e2-ledger.jsonl");
  const sqlitePath = join(storageRoot, "e2-projection.sqlite");

  // 自有投影：sqlite（触发器 DDL 形 = 生产 append-only 形搬运；standing 不建表）
  const db = openLedger(sqlitePath);
  assertNoStandingObject(db);

  // 事件面 + 政策（政策读侧闭包绑本核心活动折叠）
  const live = makeLive();
  const log = new E0EventLog();
  const policy = makePolicy({
    getStanding: live.getStanding,
    hasSeq: (s) => s < log.seq,
    hasAssertion: live.hasAssertion,
    assessmentIds: live.assessmentIds,
  });
  bindPolicy(log, policy);
  log.subscribe(live.onEvent);

  // 跨进程复活：真源 jsonl 重放（digest 链先验）→ 内存事件面 restore（replay 路径，不过写政策）
  const records = readChain(jsonlPath);
  for (const r of records) {
    log.restoreRecord({
      seq: r.seq,
      type: r.type,
      sourceEventSeqs: r.sourceEventSeqs,
      occurredAt: r.occurredAt,
      recordedAt: r.recordedAt,
      data: r.data,
    });
    live.onEvent({ type: r.type, data: r.data });
  }

  function commitEvent(type, data, sourceEventSeqs = []) {
    if (!E0_EVENT_TYPES.includes(type)) {
      throw new E2Error(E2.POLICY_REFUSED, `E0_REFUSED UNKNOWN_EVENT_TYPE:${type}`);
    }
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      throw new E2Error(RPC.INVALID_PARAMS, "arguments.data must be an object");
    }
    // 驱动边界 JSON 归一（照 e0 commit 边界；纪律判定不因此放松）
    const payload = JSON.parse(JSON.stringify(data));
    let ev;
    try {
      ev = log.append(type, payload, { sourceEventSeqs: [...sourceEventSeqs] });
    } catch (err) {
      throw toE2(err, E2.POLICY_REFUSED);
    }
    // 真源落盘（digest 链）+ 投影镜像（post-commit 两步；不可回滚 = 已知边界，见 README §9）
    const line = appendLine(jsonlPath, {
      seq: ev.seq,
      type: ev.type,
      sourceEventSeqs: ev.sourceEventSeqs,
      occurredAt: ev.occurredAt,
      recordedAt: ev.recordedAt,
      data: ev.data,
    });
    const digest = JSON.parse(line).digest;
    try {
      mirrorEvent(db, { ...ev, digest });
    } catch (err) {
      throw toE2(err, E2.POLICY_REFUSED);
    }
    return {
      ok: true,
      seq: ev.seq,
      digest,
      event: {
        seq: ev.seq,
        type: ev.type,
        sourceEventSeqs: ev.sourceEventSeqs,
        occurredAt: ev.occurredAt,
        recordedAt: ev.recordedAt,
        data: ev.data,
      },
    };
  }

  function panelGet() {
    // 读路径恒走真源 jsonl（每次重读 + digest 链校验）——篡改必红，不返脏读
    let recs;
    try {
      recs = readChain(jsonlPath);
    } catch (err) {
      const m = String(err?.message ?? "");
      // 读路径的链断/行损坏/序号断裂 = 真源损坏（-32002），不是写侧政策拒绝（-32001）
      if (/(CHAIN_BROKEN|CORRUPT_LINE|BAD_DIGEST|SEQ_NOT_CONTIGUOUS)/.test(m)) throw new E2Error(E2.LEDGER_CORRUPT, m);
      throw toE2(err, E2.LEDGER_CORRUPT);
    }
    const proj = project(recs.map((r) => ({ seq: r.seq, type: r.type, data: r.data })));
    return {
      format: "markdown", // UI 降级：无 GUI 宿主 = markdown 文本（非 slot 结构）
      body: renderPanelMarkdown(proj),
      events: proj.eventCount,
      source: { jsonl: "e2-ledger.jsonl", sqlite: "e2-projection.sqlite" },
    };
  }

  function close() {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }

  return {
    commitEvent,
    panelGet,
    close,
    seq: () => log.seq,
    paths: { jsonlPath, sqlitePath },
    live,
  };
}

export { UNKNOWN };
