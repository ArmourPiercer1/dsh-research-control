// prex/core.mjs — G1 冻结前「S-L0/S-L1 最小科研工作流预实验」机制切片（自包含，零 npm 依赖，只用 node 内置 crypto/fs/path）。
//
// 性质：2026-11-01 用户授权的 G1 冻结前预实验（席位任务书）；与生产实现完全隔离。
// 隔离纪律（违反即整批作废，见 README §6）：
//   - 本文件不 import src/**、tests/**、schema/**、g1/**，不 import 任何 @deepseek-ai/* 或仓内模块；
//   - 无 DDL、无生产机制代码、无新事件名进入生产封闭名单；
//   - 本文件全部事件名属于「prex 本地事件词表（非生产封闭名单）」——前缀 `prex:` 保证与生产名零碰撞；
//     其中 5 名镜像生产名（仅镜像其语义形态），raw-record-declared 对应的生产名是
//     **planned 未批准**（gated EA-1.2.3，见 g1/G1-CONTRACT-EVENT-AUTHORITY.md §2.4），
//     每条 prex:raw-record-declared 台账行都携 planned 状态标注（nameProvenance）。
//
// 台账形态：jsonl digest 链（与 experiments/v3-code-architecture-poc/reuse/e2 的形态同源：
//   prev-digest + stableStringify（键排序）+ GENESIS，digest = hex 64 位小写）。
//   与 e0 的一处**已登记形态差异**：链节点 = 提交块（一个事务 = 一行 jsonl），而不是 e0 的每事件一行。
//   这是 prex 层「提交点之前崩溃 = 零落盘」的建模形态：一个事务全量落盘或零落盘（撕裂尾在 open 时截断）。
//   详见 README §5。
//
// 时间语义（g1/G1-CONTRACT-COMMIT-SEQUENCE.md §3 前缀界形态）：
//   cutoff(t) = max{ c ∈ committed ∪ {0} : M(c) ≤ t }，M(c) = 第 c 个提交块的 commitRecordedAtMs；
//   空 ⇒ c = 0（空视图）。晚到登记不追溯为过去已登记（D2-d）；读必达「已提交」侧（CS-2.2）。
//   prex 用逻辑时钟（提交 i ⇒ BASE + i*1000 ms），墙钟只用于成本测量，永不进入台账。
//   「补录」标注派生键（CS §3.3 形态）：行在 t 视图带补录 ⇔ 该行提交序 c_O > cutoff(knownFromMs)。

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ———————————————————————————— 封闭词表（prex 本地） ————————————————————————————

// 正式五类对象（docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md L73-79 表；#42 RD-01：kind 创建即不可变）
export const FORMAL_OBJECT_CLASSES = Object.freeze([
  "entity",
  "concept",
  "association",
  "argumentation",
  "proposition",
]);

// prex 本地事件词表（非生产封闭名单）。镜像关系与批准状态如实标注：
export const PREX_EVENTS = Object.freeze({
  rawRecordDeclared: "prex:raw-record-declared",
  objectRegistered: "prex:object-registered",
  objectRevised: "prex:object-revised",
  checkReportRecorded: "prex:check-report-recorded",
  recordBackfilled: "prex:record-backfilled", // 本轨迹保留未用（晚到登记走 object-registered + 读时补录标注）
  assessmentExited: "prex:assessment-exited", // prex 独有（结论出口）；生产无对应机制名
});

// 生产机制封闭名单 —— 仅用于「不冒充」断言（A1-02），prex 永不写入这些名字。
// 正源：g1/G1-CONTRACT-EVENT-AUTHORITY.md §2.4（已入账 7 名 + 提案未入账 4 名 + A 侧 planned 2 名）。
export const PRODUCTION_REGISTERED_NAMES = Object.freeze([
  "capability-enabled",
  "capability-disabled",
  "capability-transferred",
  "object-registered",
  "check-report-recorded",
  "object-revised",
  "record-backfilled",
]);
export const PRODUCTION_PLANNED_NAMES = Object.freeze([
  "raw-record-declared", // planned 未批准，gated EA-1.2.3
  "integrity-audit-recorded",
  "read-shadow-recorded",
  "ns-relocated",
]);

// S-L1 verdict 封闭词汇（#44 L296：FAIL 优先，否则 INDETERMINATE 的归约在 prex 简化为：有结构/声明缺陷 ⇒ NOT_ACHIEVED）
export const SL1_VERDICTS = Object.freeze(["PASS", "NOT_ACHIEVED", "INDETERMINATE"]);

// 结构/声明缺陷封闭词汇（RD-33：机制只查声明不判语义——该词表内不含任何语义判定码）
export const STRUCTURAL_DEFECT_CODES = Object.freeze([
  "OBJ_CLASS_MISSING",
  "PROP_STATEMENT_EMPTY",
  "CIT_DOI_MISSING",
  "CIT_LOCATOR_MISSING",
  "CIT_ACCESS_VIA_MISSING",
  "CIT_QUOTE_VERIFIED_AGAINST_MISSING",
  "PROVENANCE_REF_UNRESOLVED",
  "ENTITY_IDENTITY_DCI_MISSING",
]);

// 语义判定词封闭集（RD-33 机验用：报告的 verdict + defects 面扫描必须零命中）。
// 注意：guaranteeScope 声明「不覆盖语义」时允许提及被排除域（声明不是判定），故扫描面 = verdict + defects。
export const SEMANTIC_JUDGMENT_TERMS = Object.freeze([
  "true",
  "false",
  "correct",
  "incorrect",
  "truth",
  "falsity",
  "proven",
  "disproven",
  "为真",
  "为假",
  "正确",
  "错误",
  "属实",
  "不属实",
  "科学成立",
  "科学不成立",
  "可信",
  "不可信",
]);

// 结论（assessment）出口 verdict 封闭词汇——只收域相对值；语义真值词（如 SCIENTIFICALLY_TRUE）全部在集合外 ⇒ 拒。
export const ASSESSMENT_EXIT_VERDICTS = Object.freeze([
  "SUPPORTED_WITHIN_DECLARED_SCOPE",
  "NOT_SUPPORTED_WITHIN_DECLARED_SCOPE",
  "INDETERMINATE_WITHIN_DECLARED_SCOPE",
]);

// 机制侧注册表（不是台账数据；版本身份随报告绑进台账——X-6「记录自携版本」）
export const PREX_CONTRACT_VERSION = "prex-contract/1";
export const PREX_SCHEMA_VERSION = "prex-schema/1";
export const PREX_VALIDATOR = Object.freeze({ id: "prex-s1-validator", version: "1.0.0" });
export const PREX_SPACE = "prex-space-1";

// 逻辑时钟零点对齐 2026-11-01T00:00:00Z（与 Crossref 核验时间同周；墙钟永不入台账）
export const BASE_LOGICAL_MS = 1_793_520_000_000;
const COMMIT_STEP_MS = 1000;

// ———————————————————————————— S-L1 规则集（机制侧注册表） ————————————————————————————
// 规则集变更 = 新版本；旧版本保留、历史报告按钉住版本可读（D3-b/X-6），机制不重解释原始字节。
// 每条规则：when(payload) 决定适用对象类；check 只产生结构/声明缺陷码（封闭词表），永不产生语义判定。

function citationsOf(payload) {
  const c = payload?.declared?.citations;
  return Array.isArray(c) ? c : [];
}

const RULE_OBJ_CLASS = Object.freeze({
  id: "OBJ-CLASS-DECLARED",
  check: (p) =>
    FORMAL_OBJECT_CLASSES.includes(p?.objectClass)
      ? null
      : { code: "OBJ_CLASS_MISSING", detail: "objectClass 缺失或不在正式五类词表" },
});

const RULE_PROP_STATEMENT = Object.freeze({
  id: "PROP-STATEMENT-DECLARED",
  when: (p) => p?.objectClass === "proposition" && p?.subType !== "assessment",
  check: (p) =>
    typeof p.declared?.statement === "string" && p.declared.statement.trim().length > 0
      ? null
      : { code: "PROP_STATEMENT_EMPTY", detail: "proposition 声明缺非空 statement" },
});

// 注意：来源引用规则（doi/locator/accessed_via/verifiedAgainst）只适用于非 assessment 的 proposition——
// assessment 的 declared.citations 是对象引用（{object, revision, report}），由 ASSESSMENT-PROVENANCE-RESOLVED 检查
const RULE_CIT_DOI = Object.freeze({
  id: "CIT-DOI-DECLARED",
  when: (p) => p?.objectClass === "proposition" && p?.subType !== "assessment",
  check: (p) => {
    for (let i = 0; i < citationsOf(p).length; i++) {
      const c = citationsOf(p)[i];
      if (typeof c?.doi !== "string" || c.doi.trim() === "") {
        return { code: "CIT_DOI_MISSING", detail: `citation[${i}] 缺声明 doi` };
      }
    }
    return null;
  },
});

const RULE_CIT_LOCATOR = Object.freeze({
  id: "CIT-LOCATOR-DECLARED",
  when: (p) => p?.objectClass === "proposition" && p?.subType !== "assessment",
  check: (p) => {
    for (let i = 0; i < citationsOf(p).length; i++) {
      const c = citationsOf(p)[i];
      if (typeof c?.locator !== "string" || c.locator.trim() === "") {
        return { code: "CIT_LOCATOR_MISSING", detail: `citation[${i}] 缺声明 locator` };
      }
    }
    return null;
  },
});

const RULE_CIT_ACCESS_VIA = Object.freeze({
  id: "CIT-ACCESS-VIA-DECLARED",
  when: (p) => p?.objectClass === "proposition" && p?.subType !== "assessment",
  check: (p) => {
    for (let i = 0; i < citationsOf(p).length; i++) {
      const c = citationsOf(p)[i];
      if (typeof c?.accessed_via !== "string" || c.accessed_via.trim() === "") {
        return { code: "CIT_ACCESS_VIA_MISSING", detail: `citation[${i}] 缺声明 accessed_via` };
      }
    }
    return null;
  },
});

const RULE_CIT_VERIFIED_AGAINST = Object.freeze({
  id: "CIT-QUOTE-VERIFIED-AGAINST-DECLARED",
  when: (p) => p?.objectClass === "proposition" && p?.subType !== "assessment",
  check: (p) => {
    for (let i = 0; i < citationsOf(p).length; i++) {
      const c = citationsOf(p)[i];
      if (typeof c?.quote === "string" && (typeof c?.verifiedAgainst !== "string" || c.verifiedAgainst.trim() === "")) {
        return { code: "CIT_QUOTE_VERIFIED_AGAINST_MISSING", detail: `citation[${i}] 有 quote 但缺声明 verifiedAgainst` };
      }
    }
    return null;
  },
});

const RULE_ASSESSMENT_PROVENANCE = Object.freeze({
  id: "ASSESSMENT-PROVENANCE-RESOLVED",
  when: (p) => p?.objectClass === "proposition" && p?.subType === "assessment",
  check: (p, { resolveRef }) => {
    for (let i = 0; i < citationsOf(p).length; i++) {
      const c = citationsOf(p)[i];
      if (typeof c?.object === "string" && resolveRef(c.object, c.revision) !== true) {
        return {
          code: "PROVENANCE_REF_UNRESOLVED",
          detail: `citation[${i}] 引用对象 ${c.object}@${c.revision} 未登记（结构/声明引用不可解析）`,
        };
      }
    }
    return null;
  },
});

const RULE_ENTITY_DCI = Object.freeze({
  id: "ENTITY-IDENTITY-DCI-DECLARED",
  when: (p) => p?.objectClass === "entity",
  check: (p) =>
    typeof p.declared?.doi !== "string" || p.declared.doi.trim() === ""
      ? { code: "ENTITY_IDENTITY_DCI_MISSING", detail: "entity 声明缺身份标识 doi" }
      : null,
});

export const RULE_SETS = Object.freeze({
  "rs/v1": Object.freeze({
    version: "rs/v1",
    description:
      "S-L1 结构/声明检查 v1：正式五类 objectClass、proposition 非空 statement、citation 声明 doi+locator+accessed_via、assessment 引用可解析、entity 身份 doi",
    rules: Object.freeze([
      RULE_OBJ_CLASS,
      RULE_PROP_STATEMENT,
      RULE_CIT_DOI,
      RULE_CIT_LOCATOR,
      RULE_CIT_ACCESS_VIA,
      RULE_ASSESSMENT_PROVENANCE,
      RULE_ENTITY_DCI,
    ]),
  }),
  "rs/v2": Object.freeze({
    version: "rs/v2",
    description:
      "S-L1 结构/声明检查 v2 = v1 全部规则 + citation 有 quote 时必须声明 verifiedAgainst（规则集变更一律 bump 版本，C-12/SCR-74 同族）",
    rules: Object.freeze([
      RULE_OBJ_CLASS,
      RULE_PROP_STATEMENT,
      RULE_CIT_DOI,
      RULE_CIT_LOCATOR,
      RULE_CIT_ACCESS_VIA,
      RULE_CIT_VERIFIED_AGAINST,
      RULE_ASSESSMENT_PROVENANCE,
      RULE_ENTITY_DCI,
    ]),
  }),
});

// ———————————————————————————— digest 链工具（e2 形态同源，prex 自写实现） ————————————————————————————

function stableStringify(v) {
  if (v === null) return "null";
  if (typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map((x) => stableStringify(x)).join(",") + "]";
  return (
    "{" +
    Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + stableStringify(v[k]))
      .join(",") +
    "}"
  );
}

function digestOf(prevDigest, body) {
  return createHash("sha256").update(prevDigest + "\u0000" + stableStringify(body)).digest("hex");
}

export class PrexError extends Error {
  constructor(code, message) {
    super(`PREX_REFUSED ${code}: ${message}`);
    this.name = "PrexError";
    this.code = code;
  }
}

function nameProvenance(eventType) {
  // 逐名如实标注镜像关系与生产批准状态（prex 本地事件词表（非生产封闭名单））
  const table = {
    [PREX_EVENTS.rawRecordDeclared]: {
      prexLocal: true,
      mirrorsProductionName: "raw-record-declared",
      productionStatus: "planned-not-approved (gated EA-1.2.3)",
    },
    [PREX_EVENTS.objectRegistered]: {
      prexLocal: true,
      mirrorsProductionName: "object-registered",
      productionStatus: "registered (已入账 7 名之一)",
    },
    [PREX_EVENTS.objectRevised]: {
      prexLocal: true,
      mirrorsProductionName: "object-revised",
      productionStatus: "registered (已入账 7 名之一)",
    },
    [PREX_EVENTS.checkReportRecorded]: {
      prexLocal: true,
      mirrorsProductionName: "check-report-recorded",
      productionStatus: "registered (已入账 7 名之一)",
    },
    [PREX_EVENTS.recordBackfilled]: {
      prexLocal: true,
      mirrorsProductionName: "record-backfilled",
      productionStatus: "registered (已入账 7 名之一)",
    },
    [PREX_EVENTS.assessmentExited]: {
      prexLocal: true,
      mirrorsProductionName: null,
      productionStatus: null,
    },
  };
  return table[eventType];
}

// ———————————————————————————— S-L0 解析器（prex 最小形态） ————————————————————————————
// S-L0 = 解析层/原始登记（RD-22：禁裸层级名——该规则原文本身含裸 token，逐字见 `g1/G1-ADJUDICATION-TABLE.md:237`；本文档一律 S-L0/S-L1）。
// 材料若可解析为 prex 信封（JSON 对象 + objectClass ∈ 正式五类 + declared 对象）⇒ 可进 Domain Admission；
// 否则 parseAttempt = UNPARSEABLE（EA-1.2.3 三值词汇；PARSE_FAILED/STRUCTURED_INVALID 本轨迹未用），
// 一律转 Raw Intake：「即使 S-L0 无法解析仍保存为原始记录，不冒充正式五类对象」（C-04）。

export function trySL0Parse(body) {
  let doc;
  try {
    doc = JSON.parse(body);
  } catch {
    return { ok: false, parseAttempt: "UNPARSEABLE", reason: "body 不是合法 JSON（裸文本）" };
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    return { ok: false, parseAttempt: "UNPARSEABLE", reason: "JSON 顶层不是对象" };
  }
  if (!FORMAL_OBJECT_CLASSES.includes(doc.objectClass)) {
    return { ok: false, parseAttempt: "STRUCTURED_INVALID", reason: `objectClass 不在正式五类: ${JSON.stringify(doc.objectClass)}` };
  }
  if (doc.declared === null || typeof doc.declared !== "object" || Array.isArray(doc.declared)) {
    return { ok: false, parseAttempt: "STRUCTURED_INVALID", reason: "declared 不是对象" };
  }
  return { ok: true, doc };
}

// ———————————————————————————— S-L1 检查器（只查声明不判语义，RD-33） ————————————————————————————

export function sl1Check(objectPayload, ruleSetVersion, { resolveRef } = {}) {
  const rs = RULE_SETS[ruleSetVersion];
  if (!rs) throw new PrexError("RULE_SET_UNKNOWN", `未知规则集版本: ${ruleSetVersion}`);
  const defects = [];
  for (const rule of rs.rules) {
    if (rule.when && !rule.when(objectPayload)) continue;
    const d = rule.check(objectPayload, { resolveRef });
    if (d) defects.push(d);
  }
  const verdict = defects.length > 0 ? "NOT_ACHIEVED" : "PASS";
  return { verdict, defects };
}

// 报告绑定五分量（#44 L293 / ADJ D4-b / UNIFIED P5）：
//   {对象确切 revision, 规则集版本(含 contract/schema/validator 版本), 输入环境, 执行时间, 声明保证范围}
// 机制只做「存在形态门」（缺分量拒），不核验科学正确性。
export function validateReportBinding(report) {
  const missing = [];
  if (!report || typeof report !== "object" || Array.isArray(report)) return ["REPORT_NOT_OBJECT"];
  if (!report.target || typeof report.target !== "object") missing.push("target(对象确切引用)");
  else {
    if (typeof report.target.objectId !== "string" || report.target.objectId === "") missing.push("target.objectId");
    if (typeof report.target.revision !== "string" || !/^r[1-9]\d*$/.test(report.target.revision)) {
      missing.push("target.revision(确切 revision)");
    }
  }
  if (typeof report.contractVersion !== "string" || report.contractVersion === "") missing.push("contractVersion");
  if (typeof report.schemaVersion !== "string" || report.schemaVersion === "") missing.push("schemaVersion");
  if (typeof report.ruleSetVersion !== "string" || !RULE_SETS[report.ruleSetVersion]) missing.push("ruleSetVersion(规则集版本)");
  if (
    !report.validator ||
    typeof report.validator.id !== "string" ||
    report.validator.id === "" ||
    typeof report.validator.version !== "string" ||
    report.validator.version === ""
  ) {
    missing.push("validator(校验器身份与版本)");
  }
  if (!report.inputEnvironment || typeof report.inputEnvironment !== "object" || Array.isArray(report.inputEnvironment)) {
    missing.push("inputEnvironment(输入环境)");
  }
  if (typeof report.checkedAt !== "number" || !Number.isFinite(report.checkedAt)) missing.push("checkedAt(执行时间)");
  if (
    !report.guaranteeScope ||
    typeof report.guaranteeScope !== "object" ||
    Array.isArray(report.guaranteeScope) ||
    typeof report.guaranteeScope.covers !== "string" ||
    typeof report.guaranteeScope.excludes !== "string"
  ) {
    missing.push("guaranteeScope(声明保证范围)");
  }
  return missing;
}

export const DEFAULT_GUARANTEE_SCOPE = Object.freeze({
  covers: "S-L1 结构/声明检查：声明存在性、结构合法性、引用可解析性（对象确切 revision × 钉住规则集版本 × 输入环境）",
  excludes: "科学语义、原意、真值与科学充分性判定（RD-33：S-L1 只查声明不判语义）",
});

// ———————————————————————————— 台账本体 ————————————————————————————

export class Prex {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
    this.ledgerPath = join(dir, "prex-ledger.jsonl");
    this.repairedTornLines = 0;
    this.blocks = []; // {line, seq, t, c, commitRecordedAtMs, op, actor, clientRequestId, events, idem}
    this.raws = new Map(); // recordId -> raw 形态
    this.objects = new Map(); // oid -> {objectId, kind, space, revisions:{rN:payload}, latest, firstC, firstCommitRecordedAtMs, knownFromMs}
    this.reports = new Map(); // rptId -> report（原样存储字节，读不重解释，X-6）
    this.exits = new Map(); // assessmentId -> exit 记录
    this.directory = new Map(); // oid -> {oid, kind, space}
    this.idem = new Map(); // key -> {blockSeq, resultJson}
    this.nextRpt = 1;
    this._open();
  }

  // —— 打开：链验证 + 撕裂尾修复（e0 形态：撕裂尾读不返、写前截断）——
  _open() {
    if (!existsSync(this.ledgerPath)) {
      this._rebuildFromBlocks([]);
      return;
    }
    const rawText = readFileSync(this.ledgerPath, "utf8");
    const lines = rawText.split("\n").filter((l) => l.length > 0);
    const valid = [];
    let prev = "GENESIS";
    let torn = 0;
    for (let i = 0; i < lines.length; i++) {
      let rec;
      try {
        rec = JSON.parse(lines[i]);
      } catch {
        if (i === lines.length - 1) {
          torn = lines.length - i; // 末行撕裂：截断
          break;
        }
        throw new PrexError("CORRUPT_LINE", `第 ${i + 1} 行不是合法 JSON（非撕裂尾位置）`);
      }
      const { digest, ...body } = rec;
      if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) throw new PrexError("BAD_DIGEST", `第 ${i + 1} 行 digest 非法`);
      if (digest !== digestOf(prev, body)) throw new PrexError("CHAIN_BROKEN", `第 ${i + 1} 行链断裂（篡改检出）`);
      if (rec.seq !== i) throw new PrexError("SEQ_NOT_CONTIGUOUS", `第 ${i + 1} 行 seq 不连续`);
      prev = digest;
      valid.push({ line: lines[i], ...rec });
    }
    if (torn > 0) {
      // 撕裂尾截断（只发生在文件末行；截断后整块事务消失 = 该事务零落盘）
      const kept = valid.map((b) => b.line);
      const tmp = this.ledgerPath + ".trunc";
      writeFileSync(tmp, kept.length ? kept.join("\n") + "\n" : "");
      renameSync(tmp, this.ledgerPath);
      this.repairedTornLines = torn;
    }
    this._rebuildFromBlocks(valid);
  }

  _rebuildFromBlocks(blocks) {
    this.blocks = blocks;
    this.raws.clear();
    this.objects.clear();
    this.reports.clear();
    this.exits.clear();
    this.directory.clear();
    this.idem.clear();
    let rptCounter = 1;
    for (const b of blocks) {
      for (const ev of b.events) {
        const pl = ev.payload;
        switch (ev.type) {
          case PREX_EVENTS.rawRecordDeclared: {
            this.raws.set(pl.recordId, {
              recordId: pl.recordId,
              form: "raw",
              body: pl.body,
              origin: pl.origin,
              declaredType: pl.declaredType,
              intakeNotes: pl.intakeNotes,
              blockSeq: b.seq,
              c: b.c,
              commitRecordedAtMs: b.commitRecordedAtMs,
            });
            break;
          }
          case PREX_EVENTS.objectRegistered: {
            const oid = pl.objectId;
            const obj = {
              objectId: oid,
              kind: pl.objectClass,
              space: PREX_SPACE,
              revisions: { r1: pl.payload },
              latest: "r1",
              firstC: b.c,
              firstCommitRecordedAtMs: b.commitRecordedAtMs,
              knownFromMs:
                typeof pl.payload?.declared?.knownFromMs === "number" ? pl.payload.declared.knownFromMs : b.commitRecordedAtMs,
            };
            this.objects.set(oid, obj);
            this.directory.set(oid, { oid, kind: pl.objectClass, space: PREX_SPACE });
            break;
          }
          case PREX_EVENTS.objectRevised: {
            const obj = this.objects.get(pl.objectId);
            if (!obj) throw new PrexError("REVISE_UNKNOWN_OBJECT", pl.objectId);
            const n = Object.keys(obj.revisions).length + 1;
            obj.revisions[`r${n}`] = pl.payload;
            obj.latest = `r${n}`;
            break;
          }
          case PREX_EVENTS.checkReportRecorded: {
            this.reports.set(pl.rptId, { ...pl, blockSeq: b.seq, c: b.c });
            if (pl.rptId === `RPT-${rptCounter}`) rptCounter++;
            break;
          }
          case PREX_EVENTS.assessmentExited: {
            this.exits.set(pl.assessmentId, { ...pl, blockSeq: b.seq, c: b.c });
            break;
          }
          default:
            throw new PrexError("UNKNOWN_EVENT_TYPE", ev.type);
        }
      }
      if (b.idem) this.idem.set(b.idem.key, { blockSeq: b.seq, resultJson: b.idem.resultJson });
    }
    this.nextRpt = rptCounter;
  }

  get headCommit() {
    return this.blocks.length ? this.blocks[this.blocks.length - 1].c : 0;
  }

  get logicalNow() {
    return BASE_LOGICAL_MS + this.headCommit * COMMIT_STEP_MS;
  }

  fileBytes() {
    return existsSync(this.ledgerPath) ? readFileSync(this.ledgerPath) : Buffer.alloc(0);
  }

  // —— 幂等四元组（X-1/JC-1 形态）：key = (actor, space, op, clientRequestId) ——
  _idemKey({ op, actor, clientRequestId }) {
    if (typeof clientRequestId !== "string" || clientRequestId.trim() === "") {
      throw new PrexError("IDEM_KEY_MISSING", "clientRequestId 缺失（幂等四元组不完整）");
    }
    return createHash("sha256").update(stableStringify({ actor, space: PREX_SPACE, op, clientRequestId })).digest("hex");
  }

  /**
   * 重放分支（JC-1）：命中已入账幂等键 ⇒ 返回首次结果**字节逐等**，
   * 在任何业务守卫之前返回（不重执行、不重算、不重新鉴权）——X-1 幂等形态。
   */
  _replayHit({ op, actor, clientRequestId }) {
    const hit = this.idem.get(this._idemKey({ op, actor, clientRequestId }));
    if (!hit) return null;
    return {
      ok: true,
      idempotent: true,
      replayedFromBlockSeq: hit.blockSeq,
      commitSequence: this.headCommit,
      resultJson: hit.resultJson,
      result: JSON.parse(hit.resultJson),
    };
  }

  // —— 事务：staging 在内存；commit = 单行 append（提交点之前崩溃 = 零落盘）——
  beginTx() {
    return { events: [] };
  }

  _stage(tx, type, payload, actor) {
    if (!Object.values(PREX_EVENTS).includes(type)) throw new PrexError("UNKNOWN_EVENT_TYPE", type);
    tx.events.push({ type, nameProvenance: nameProvenance(type), actor, space: PREX_SPACE, payload });
  }

  /**
   * Raw Intake（EA-1.2.3/B-1 形态）：唯一入口；declaredType 不进分类器（数据就是数据）；
   * 任何 declaredType 取值都不得产生 EVENT_AUTHORITY_REQUIRED 形态拒绝（B-1 反向护栏）；
   * 无空间写权 ⇒ 完全拒收、台账零变化（B-4）。
   */
  declareRawIntake({ recordId, declaredType, origin, body, actor, principalCanWrite, clientRequestId, op = "raw-intake" }) {
    const replay = this._replayHit({ op, actor, clientRequestId });
    if (replay) return replay;
    if (principalCanWrite !== true) {
      // B-4：无空间写权 ⇒ 完全拒收（台账零变化）；拒绝与「类型是否认识」无关
      throw new PrexError("SPACE_WRITE_DENIED", "主体无空间写权：Raw Intake 完全拒收（B-4/C-07 SP-09(b)）");
    }
    if (typeof recordId !== "string" || recordId.trim() === "") throw new PrexError("RECORD_ID_MISSING", "recordId 缺失");
    if (this.raws.has(recordId) || this.objects.has(recordId)) {
      throw new PrexError("RECORD_ID_RESERVED", `recordId 已被占用: ${recordId}`);
    }
    if (typeof body !== "string") throw new PrexError("BODY_NOT_TEXT", "body 必须是文本（prex 最小形态）");
    const parsed = trySL0Parse(body);
    const tx = this.beginTx();
    this._stage(tx, PREX_EVENTS.rawRecordDeclared, {
      recordId,
      declaredType, // 机制不解释、不登记进 event_type、不据以命名（EA-1.3a 三不参与）
      origin,
      body, // 原文完整保存，不被解释污染
      intakeNotes: {
        parseAttempt: parsed.ok ? "STRUCTURED_VALID" : parsed.parseAttempt,
        parseResult: parsed.ok ? "admissible" : parsed.reason,
      },
    }, actor);
    const result = {
      ok: true,
      recordId,
      form: "raw",
      declaredType,
      parseAttempt: parsed.ok ? "STRUCTURED_VALID" : parsed.parseAttempt,
      event: PREX_EVENTS.rawRecordDeclared,
      nameProvenance: nameProvenance(PREX_EVENTS.rawRecordDeclared),
    };
    return this.commit(tx, { op, actor, clientRequestId, result });
  }

  /**
   * Domain Admission（#44 L235 形态）：S-L0 可解析 + objectClass ∈ 正式五类 ⇒ 登记正式对象；
   * S-L1 未达成不阻止登记（结构缺陷留报告，不能将未达成说成 PASS）；
   * 首轮检查报告与对象同事务原子落（Q40 单次原子提交形态）。
   */
  registerObject({ objectId, objectClass, payload, actor, principalCanWrite, clientRequestId, firstRoundCheck, op = "domain-admission" }) {
    const replay = this._replayHit({ op, actor, clientRequestId });
    if (replay) return replay;
    if (principalCanWrite !== true) throw new PrexError("SPACE_WRITE_DENIED", "主体无空间写权（C-07 SP-09(b)）");
    if (typeof objectId !== "string" || objectId.trim() === "") throw new PrexError("OBJECT_ID_MISSING", "objectId 缺失");
    if (this.objects.has(objectId) || this.raws.has(objectId)) throw new PrexError("OBJECT_ID_RESERVED", objectId);
    if (!FORMAL_OBJECT_CLASSES.includes(objectClass)) {
      // 冒充防线：objectClass 不在正式五类 ⇒ 不得登记为正式对象（C-04 不冒充正式五类对象）
      throw new PrexError("MASQUERADE_REFUSED", `objectClass 不在正式五类词表: ${objectClass}（材料走 Raw Intake 通道）`);
    }
    const parsed = trySL0Parse(JSON.stringify({ objectClass, declared: payload?.declared ?? payload }));
    if (!parsed.ok) throw new PrexError("SL0_UNPARSEABLE", `Domain Admission 只收可解析材料（S-L0 解析失败: ${parsed.reason}）`);
    const envelope = { objectClass, ...payload };
    const tx = this.beginTx();
    this._stage(tx, PREX_EVENTS.objectRegistered, { objectId, objectClass, payload: envelope }, actor);
    let firstReport = null;
    if (firstRoundCheck) {
      firstReport = this._buildReport({
        tx,
        target: { objectId, revision: "r1" },
        ruleSetVersion: firstRoundCheck.ruleSetVersion,
        objectPayload: envelope,
      });
    }
    const result = {
      ok: true,
      objectId,
      objectClass,
      revision: "r1",
      registered: true,
      sl1: firstReport ? { rptId: firstReport.rptId, verdict: firstReport.verdict, defects: firstReport.defects } : null,
    };
    return this.commit(tx, { op, actor, clientRequestId, result });
  }

  /** 对象修订：新 revision 行（追加不覆盖；旧 revision 行字节不变，D3-b/X-6） */
  reviseObject({ objectId, payload, actor, principalCanWrite, clientRequestId, recheck, op = "object-revision" }) {
    const replay = this._replayHit({ op, actor, clientRequestId });
    if (replay) return replay;
    if (principalCanWrite !== true) throw new PrexError("SPACE_WRITE_DENIED", "主体无空间写权（C-07 SP-09(b)）");
    const obj = this.objects.get(objectId);
    if (!obj) throw new PrexError("OBJECT_NOT_FOUND", objectId);
    const n = Object.keys(obj.revisions).length + 1;
    const nextRev = `r${n}`;
    const envelope = { objectClass: obj.kind, ...payload };
    const tx = this.beginTx();
    this._stage(tx, PREX_EVENTS.objectRevised, { objectId, revision: nextRev, payload: envelope }, actor);
    let report = null;
    if (recheck) {
      report = this._buildReport({ tx, target: { objectId, revision: nextRev }, ruleSetVersion: recheck.ruleSetVersion, objectPayload: envelope });
    }
    const result = {
      ok: true,
      objectId,
      revision: nextRev,
      previousRevision: obj.latest,
      recheck: report ? { rptId: report.rptId, verdict: report.verdict, defects: report.defects } : null,
    };
    return this.commit(tx, { op, actor, clientRequestId, result });
  }

  /** 独立检查报告（check-report-recorded）：绑定五分量存在形态门；缺任一分量 ⇒ 拒（ADJ D4-b/UNIFIED P5） */
  recordReport({ report, actor, principalCanWrite, clientRequestId, op = "check-report" }) {
    const replay = this._replayHit({ op, actor, clientRequestId });
    if (replay) return replay;
    if (principalCanWrite !== true) throw new PrexError("SPACE_WRITE_DENIED", "主体无空间写权（C-07 SP-09(b)）");
    if (typeof report?.rptId !== "string" || report.rptId.trim() === "") throw new PrexError("RPT_ID_MISSING", "rptId 缺失");
    if (this.reports.has(report.rptId)) throw new PrexError("RPT_ID_RESERVED", `rptId 已被占用: ${report.rptId}`);
    const missing = validateReportBinding(report);
    if (missing.length > 0) {
      throw new PrexError("RPT_BIND_INCOMPLETE", `检查报告缺绑定分量: ${missing.join(", ")}（存在形态门拒绝入库）`);
    }
    const obj = this.objects.get(report.target.objectId);
    if (!obj || obj.revisions[report.target.revision] === undefined) {
      throw new PrexError("RPT_TARGET_UNRESOLVED", `报告目标对象/revision 不存在: ${report.target.objectId}@${report.target.revision}`);
    }
    const tx = this.beginTx();
    this._stage(tx, PREX_EVENTS.checkReportRecorded, { ...report }, actor);
    const result = { ok: true, rptId: report.rptId, verdict: report.verdict, target: report.target, ruleSetVersion: report.ruleSetVersion };
    return this.commit(tx, { op, actor, clientRequestId, result });
  }

  _buildReport({ tx, target, ruleSetVersion, objectPayload }) {
    const { verdict, defects } = sl1Check(objectPayload, ruleSetVersion, {
      resolveRef: (oid, rev) => {
        const o = this.objects.get(oid);
        if (o && o.revisions[rev] !== undefined) return true;
        // #44 L90 形态：同事务内引用合法——同一事务中刚登记的 r1 对象在事务内可见
        if (rev === "r1") {
          return tx.events.some((ev) => ev.type === PREX_EVENTS.objectRegistered && ev.payload.objectId === oid);
        }
        return false;
      },
    });
    const report = {
      rptId: `RPT-${this.nextRpt++}`,
      target, // 对象确切 revision
      contractVersion: PREX_CONTRACT_VERSION,
      schemaVersion: PREX_SCHEMA_VERSION,
      ruleSetVersion, // 规则集版本（钉住）
      validator: { ...PREX_VALIDATOR }, // 校验器身份与版本
      inputEnvironment: { space: PREX_SPACE, client: "prex-run", clock: "logical", node: process.version },
      checkedAt: this.logicalNow, // 执行时间（逻辑时钟；重放分支不重算，JC-1）
      guaranteeScope: { ...DEFAULT_GUARANTEE_SCOPE }, // 声明保证范围
      verdict,
      defects, // 只含结构/声明缺陷码（封闭词表）
    };
    this._stage(tx, PREX_EVENTS.checkReportRecorded, { ...report }, tx.events.length ? tx.events[0].actor : "prex-mechanism");
    return report;
  }

  /**
   * 结论出口（assessment exit）。出口判据（四分量 + 机制不变量）：
   *   verdict（域相对封闭词表；语义真值词 ⇒ 拒）、declared_gaps（必须存在，数组）、
   *   适用域声明（applicabilityDomain）、溯源绑定（citations 全部可解析 + 所引报告在适用域内）。
   *   出口记录必须保留「S-L1 PASS ≠ 原意被确认 ≠ 正确」声明（IC-S2/RD-33）。
   *   闸返回全部违例码（不 fail-fast），便于一次出口尝试暴露全部缺陷。
   */
  exitAssessment({ assessmentId, actor, principalCanWrite, clientRequestId, op = "assessment-exit" }) {
    const replay = this._replayHit({ op, actor, clientRequestId });
    if (replay) return replay;
    if (principalCanWrite !== true) throw new PrexError("SPACE_WRITE_DENIED", "主体无空间写权（C-07 SP-09(b)）");
    const obj = this.objects.get(assessmentId);
    if (!obj || obj.kind !== "proposition") throw new PrexError("ASSESSMENT_NOT_FOUND", assessmentId);
    const p = obj.revisions[obj.latest];
    if (p.subType !== "assessment") throw new PrexError("NOT_AN_ASSESSMENT", assessmentId);
    const d = p.declared ?? {};
    const codes = [];
    if (typeof d.verdict !== "string" || d.verdict === "") codes.push("EXIT_MISSING_VERDICT");
    else if (!ASSESSMENT_EXIT_VERDICTS.includes(d.verdict)) {
      // 把 S-L1 PASS 当「科学为真」的语义真值词（如 SCIENTIFICALLY_TRUE）全部落在域相对封闭词表之外 ⇒ 拒
      codes.push("VERDICT_SEMANTIC_CLAIM_REFUSED");
    }
    if (!Array.isArray(d.declaredGaps)) codes.push("EXIT_MISSING_DECLARED_GAPS");
    if (
      !d.applicabilityDomain ||
      typeof d.applicabilityDomain !== "object" ||
      typeof d.applicabilityDomain.domain !== "string" ||
      typeof d.applicabilityDomain.method !== "string"
    ) {
      codes.push("EXIT_MISSING_APPLICABILITY_DOMAIN");
    }
    if (!Array.isArray(d.citations) || d.citations.length === 0) {
      codes.push("EXIT_MISSING_PROVENANCE");
    } else {
      for (const cit of d.citations) {
        const target = this.objects.get(cit.object);
        if (!target || target.revisions[cit.revision] === undefined) {
          codes.push("PROVENANCE_REF_UNRESOLVED");
          continue;
        }
        if (cit.report) {
          const r = this.reports.get(cit.report);
          if (!r) {
            codes.push("PROVENANCE_REF_UNRESOLVED");
            continue;
          }
          // 跨适用域引用：报告钉住的目标（对象 × revision × 规则集版本）必须与所引用入条一致
          if (r.target.objectId !== cit.object || r.target.revision !== cit.revision) {
            codes.push("OUT_OF_SCOPE_CITATION");
          }
        }
      }
    }
    const ownReports = [...this.reports.values()]
      .filter((r) => r.target.objectId === assessmentId)
      .sort((a, b) => a.blockSeq - b.blockSeq);
    if (ownReports.length > 0 && ownReports[ownReports.length - 1].verdict !== "PASS") {
      codes.push("EXIT_REPORT_NOT_PASS");
    }
    if (codes.length > 0) {
      return { ok: false, assessmentId, codes, reason: "结论未达出口判据（机制只保证声明面，RD-33）" };
    }
    const exitRecord = {
      assessmentId,
      revision: obj.latest,
      verdict: d.verdict,
      declaredGaps: d.declaredGaps,
      applicabilityDomain: d.applicabilityDomain,
      provenanceBindings: d.citations.map((cit) => {
        const r = cit.report ? this.reports.get(cit.report) : null;
        return {
          object: cit.object,
          revision: cit.revision,
          role: cit.role ?? null,
          report: r ? { rptId: r.rptId, target: r.target, ruleSetVersion: r.ruleSetVersion, verdict: r.verdict } : null,
        };
      }),
      exitReportRef: ownReports.length > 0 ? ownReports[ownReports.length - 1].rptId : null,
      exitCheckedAt: this.logicalNow,
      mechanismInvariants: {
        sl1PassDisclaimer: "S-L1 PASS ≠ 原意被确认 ≠ 正确",
        rd33Note: "机制只保证声明面：S-L1 只查声明不判语义（RD-33）；本出口记录不构成任何科学真值判定",
        c11Note: "复查产生新报告，旧 PASS 不改写（C11/IC-S2）；历史报告按其钉住的版本可读（D3-b/X-6）",
        vocabNote: "prex 本地事件词表（非生产封闭名单）",
      },
    };
    const tx = this.beginTx();
    this._stage(tx, PREX_EVENTS.assessmentExited, exitRecord, actor);
    const result = { ok: true, assessmentId, revision: obj.latest, verdict: d.verdict, exit: exitRecord };
    return this.commit(tx, { op, actor, clientRequestId, result });
  }

  /**
   * 提交点：单行 append（一个事务 = 一个链节点）。
   * 幂等（X-1/JC-1 形态）：key = (actor, space, op, clientRequestId) 四元组；
   *   命中 ⇒ 返回首次结果**字节逐等**（不重算墙钟、不重执行、不产生第二份记录）。
   */
  commit(tx, { op, actor, clientRequestId, result }) {
    const key = this._idemKey({ op, actor, clientRequestId });
    const hit = this.idem.get(key);
    if (hit) {
      // 重放分支：直接返回首次结果（JC-1：禁 Date.now() 重算、禁重执行）
      return {
        ok: true,
        idempotent: true,
        replayedFromBlockSeq: hit.blockSeq,
        commitSequence: this.headCommit,
        resultJson: hit.resultJson,
        result: JSON.parse(hit.resultJson),
      };
    }
    const c = this.headCommit + 1;
    const commitRecordedAtMs = BASE_LOGICAL_MS + c * COMMIT_STEP_MS;
    const resultJson = JSON.stringify(result);
    const blockBody = {
      seq: this.blocks.length,
      t: "commit",
      c,
      commitRecordedAtMs,
      op,
      actor,
      clientRequestId,
      events: tx.events,
      idem: { key, resultJson },
    };
    const prev = this.blocks.length ? this.blocks[this.blocks.length - 1].line ? JSON.parse(this.blocks[this.blocks.length - 1].line).digest : "GENESIS" : "GENESIS";
    const digest = digestOf(prev, blockBody);
    const line = JSON.stringify({ ...blockBody, digest });
    appendFileSync(this.ledgerPath, line + "\n");
    const block = { ...blockBody, line };
    this.blocks.push(block);
    // 投影增量（与 _rebuildFromBlocks 同逻辑）
    for (const ev of tx.events) {
      const pl = ev.payload;
      switch (ev.type) {
        case PREX_EVENTS.rawRecordDeclared:
          this.raws.set(pl.recordId, {
            recordId: pl.recordId,
            form: "raw",
            body: pl.body,
            origin: pl.origin,
            declaredType: pl.declaredType,
            intakeNotes: pl.intakeNotes,
            blockSeq: block.seq,
            c,
            commitRecordedAtMs,
          });
          break;
        case PREX_EVENTS.objectRegistered: {
          const obj = {
            objectId: pl.objectId,
            kind: pl.objectClass,
            space: PREX_SPACE,
            revisions: { r1: pl.payload },
            latest: "r1",
            firstC: c,
            firstCommitRecordedAtMs: commitRecordedAtMs,
            knownFromMs:
              typeof pl.payload?.declared?.knownFromMs === "number" ? pl.payload.declared.knownFromMs : commitRecordedAtMs,
          };
          this.objects.set(pl.objectId, obj);
          this.directory.set(pl.objectId, { oid: pl.objectId, kind: pl.objectClass, space: PREX_SPACE });
          break;
        }
        case PREX_EVENTS.objectRevised: {
          const obj = this.objects.get(pl.objectId);
          const n = Object.keys(obj.revisions).length + 1;
          obj.revisions[`r${n}`] = pl.payload;
          obj.latest = `r${n}`;
          break;
        }
        case PREX_EVENTS.checkReportRecorded:
          this.reports.set(pl.rptId, { ...pl, blockSeq: block.seq, c });
          if (pl.rptId === `RPT-${this.nextRpt}`) this.nextRpt++;
          break;
        case PREX_EVENTS.assessmentExited:
          this.exits.set(pl.assessmentId, { ...pl, blockSeq: block.seq, c });
          break;
        default:
          break;
      }
    }
    this.idem.set(key, { blockSeq: block.seq, resultJson });
    return {
      ok: true,
      idempotent: false,
      commitSequence: c,
      blockSeq: block.seq,
      eventSeqs: tx.events.map(() => block.seq),
      resultJson,
      result,
    };
  }

  // —— 读面（双时间截点：读必达「已提交」侧；回显实际生效截点，CS-2.2/CS-2.3 形态）——

  /** cutoff(t) = max{ c ∈ committed ∪ {0} : M(c) ≤ t }（CS-3.1 前缀界；空 ⇒ c=0 空视图） */
  resolveCutoff(tMs) {
    let c = 0;
    for (const b of this.blocks) {
      if (b.commitRecordedAtMs <= tMs) c = b.c;
      else break;
    }
    return c;
  }

  readAt({ cutoffMs } = {}) {
    const cStar = this.resolveCutoff(cutoffMs ?? Number.MAX_SAFE_INTEGER);
    const items = [];
    for (const b of this.blocks) {
      if (b.c > cStar) break;
      for (const ev of b.events) {
        if (ev.type === PREX_EVENTS.objectRegistered) {
          const obj = this.objects.get(ev.payload.objectId);
          const cT = this.resolveCutoff(obj.knownFromMs);
          items.push({
            kind: "object",
            id: obj.objectId,
            objectClass: obj.kind,
            revision: obj.latest,
            lateBackfill: obj.firstC > cT, // 补录派生键（CS §3.3 形态）
          });
        } else if (ev.type === PREX_EVENTS.rawRecordDeclared) {
          items.push({ kind: "raw", id: ev.payload.recordId, form: "raw" });
        } else if (ev.type === PREX_EVENTS.checkReportRecorded) {
          items.push({ kind: "report", id: ev.payload.rptId, ruleSetVersion: ev.payload.ruleSetVersion });
        } else if (ev.type === PREX_EVENTS.assessmentExited) {
          items.push({ kind: "exit", id: ev.payload.assessmentId });
        }
      }
    }
    const resolvedAtMs = cStar === 0 ? null : this.blocks.find((b) => b.c === cStar).commitRecordedAtMs;
    return {
      asOfInput: cutoffMs === undefined ? "head-default" : cutoffMs,
      resolvedCutoff: cStar,
      resolvedAtMs,
      cutoffDefaulted: cutoffMs === undefined,
      items,
    };
  }

  readRaw(recordId) {
    const r = this.raws.get(recordId);
    if (!r) return null;
    // 原始记录读面只返回 raw 形态：form/body/origin/declaredType/intakeNotes（无正式五类字段）
    return { recordId: r.recordId, form: r.form, body: r.body, origin: r.origin, declaredType: r.declaredType, intakeNotes: r.intakeNotes };
  }

  readObject(objectId, revision) {
    const obj = this.objects.get(objectId);
    if (!obj) return null;
    const rev = revision ?? obj.latest;
    const payload = obj.revisions[rev];
    if (payload === undefined) return null;
    return { objectId, objectClass: obj.kind, space: obj.space, revision: rev, payload };
  }

  readReport(rptId) {
    // 历史报告按其钉住的版本原样返回（D3-b/X-6：原始字节不重解释；读侧不重算 verdict）
    return this.reports.get(rptId) ?? null;
  }

  readExit(assessmentId) {
    return this.exits.get(assessmentId) ?? null;
  }

  listDirectory() {
    return [...this.directory.values()];
  }

  /** 台账中承载某报告/对象的原始行字节（字节级断言用；X-6 原始字节） */
  lineOfBlockSeq(blockSeq) {
    const b = this.blocks.find((x) => x.seq === blockSeq);
    return b ? b.line : null;
  }

  blockContaining(rptId) {
    return this.blocks.find((b) => b.events.some((ev) => ev.type === PREX_EVENTS.checkReportRecorded && ev.payload.rptId === rptId)) ?? null;
  }

  countEvents(type) {
    let n = 0;
    for (const b of this.blocks) for (const ev of b.events) if (ev.type === type) n++;
    return n;
  }

  verifyChain() {
    // 全链重放验证（digest + seq 连续）
    let prev = "GENESIS";
    for (const b of this.blocks) {
      const rec = JSON.parse(b.line);
      const { digest, ...body } = rec;
      if (digest !== digestOf(prev, body)) return { ok: false, at: b.seq };
      prev = digest;
    }
    return { ok: true, length: this.blocks.length };
  }
}
