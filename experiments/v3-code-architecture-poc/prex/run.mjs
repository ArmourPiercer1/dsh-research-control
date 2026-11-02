// prex/run.mjs — 轨迹驱动 + 断言（每条打印 PASS/FAIL；全过才 exit 0）。
//
// 运行：node experiments/v3-code-architecture-poc/prex/run.mjs
// 纪律（任务书）：断言失败时修代码或修预期后重跑，禁止弱化断言凑绿；每轮结果追加进
//   prex/.run/run-history.jsonl（第几轮、过/挂数、exit code 如实留痕）。
// 每次运行从全新台账开始（.run 为运行时数据、不提交；run-history 除外——它记录轮次）。

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Prex,
  PrexError,
  sl1Check,
  PREX_EVENTS,
  PRODUCTION_REGISTERED_NAMES,
  STRUCTURAL_DEFECT_CODES,
  SEMANTIC_JUDGMENT_TERMS,
  ASSESSMENT_EXIT_VERDICTS,
  PREX_CONTRACT_VERSION,
  PREX_SCHEMA_VERSION,
  PREX_VALIDATOR,
  BASE_LOGICAL_MS,
} from "./core.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN_DIR = join(HERE, ".run");
const LEDGER_PATH = join(RUN_DIR, "prex-ledger.jsonl");
const HISTORY_PATH = join(RUN_DIR, "run-history.jsonl");

// ———————————————————————————— 真实材料（出处见 README §3） ————————————————————————————
// 论文：Ronneberger, Fischer, Brox — U-Net: Convolutional Networks for Biomedical Image Segmentation
//   出版版（Proposition + citation Evidence 的 DOI 溯源）：DOI 10.1007/978-3-319-24574-4_28
//     （Crossref 核验 HTTP 200，2026-11-02；LNCS / MICCAI 2015，pp. 234–241，Springer）
//   引文文本源：arXiv:1505.04597v1（abstract 原文，2026-11-02 取文）
const UNET_TITLE = "U-Net: Convolutional Networks for Biomedical Image Segmentation";
const P1_CLAIM_QUOTE =
  "We show that such a network can be trained end-to-end from very few images and outperforms the prior best method (a sliding-window convolutional network) on the ISBI challenge for segmentation of neuronal structures in electron microscopic stacks.";
const P2_CLAIM_QUOTE = "Segmentation of a 512x512 image takes less than a second on a recent GPU.";
const RAW_ORIGIN_URL = "https://arxiv.org/abs/1505.04597";
const CROSSREF_URL = "https://api.crossref.org/works/10.1007/978-3-319-24574-4_28";
const DOI = "10.1007/978-3-319-24574-4_28";

// S-L0 原始材料：真实文本的构造损坏（构造损坏 of 真实文本；原文 + 损坏映射见 README §3.2）
const RAW_SENTENCE_ORIGINAL =
  "The architecture consists of a contracting path to capture context and a symmetric expanding path that enables precise localization.";
// 损坏映射（OCR 式：c→e 混淆 + 行界空格插入；token → 损坏 token，逐字对应）
const CORRUPTION_MAP = Object.freeze({
  architecture: "archit ecture",
  consists: "oon sists",
  contracting: "contrae ting",
  capture: "eapture",
  context: "eont ext",
  symmetric: "sym metrie",
  expanding: "exp anding",
  enables: "en ables",
  precise: "pre ise",
  localization: "loe alization",
});
function corruptSentence(original) {
  let out = original;
  for (const [orig, corrupted] of Object.entries(CORRUPTION_MAP)) {
    out = out.replace(new RegExp(`\\b${orig}\\b`, "g"), corrupted);
  }
  return out;
}
const RAW_SENTENCE_CORRUPTED = corruptSentence(RAW_SENTENCE_ORIGINAL);

// ———————————————————————————— 断言器 ————————————————————————————
let passCount = 0;
let failCount = 0;
const failures = [];
function A(id, desc, cond) {
  const ok = cond === true;
  if (ok) passCount++;
  else {
    failCount++;
    failures.push(id);
  }
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${desc}`);
  return ok;
}
function containsSemanticTerm(text) {
  const lower = text.toLowerCase();
  for (const t of SEMANTIC_JUDGMENT_TERMS) {
    if (/^[a-z]+$/.test(t)) {
      if (new RegExp(`\\b${t}\\b`, "i").test(lower)) return t;
    } else if (text.includes(t)) {
      return t;
    }
  }
  return null;
}
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

// ———————————————————————————— 运行开始：全新台账 + 轮次记账 ————————————————————————————
mkdirSync(RUN_DIR, { recursive: true });
rmSync(LEDGER_PATH, { force: true });
const priorRounds = existsSync(HISTORY_PATH) ? readFileSync(HISTORY_PATH, "utf8").split("\n").filter(Boolean).length : 0;
const ROUND = priorRounds + 1;
const WALL_START = process.hrtime.bigint();
const tWall = () => Number(process.hrtime.bigint() - WALL_START) / 1e6;
console.log(`=== prex run round=${ROUND}（全新台账；.run 运行时数据，不提交）===`);

// 材料常量（对象载荷）
const P1_R1 = {
  objectClass: "proposition",
  declared: {
    statement:
      "U-Net 可从极少量图像端到端训练，并在电子显微镜堆栈神经元结构分割的 ISBI 挑战上优于此前最佳方法（滑动窗口卷积网络）。",
    citations: [
      {
        doi: DOI,
        locator: "arXiv:1505.04597v1 abstract, sentence 4",
        quote: P1_CLAIM_QUOTE,
        // r1 故意缺 accessed_via（结构缺陷 → S-L1 未达成，但对象仍可登记：S-L1 旁路）
      },
    ],
  },
};
const P1_R2 = {
  ...P1_R1,
  declared: {
    statement: P1_R1.declared.statement,
    citations: [
      {
        ...P1_R1.declared.citations[0],
        accessed_via: "crossref-api (Crossref 核验 HTTP 200) + arXiv:1505.04597v1 文本副本",
      },
    ],
  },
};
const P2_R1 = {
  objectClass: "proposition",
  declared: {
    statement: "U-Net 对 512x512 图像的分割在近端 GPU 上耗时不足一秒。",
    citations: [
      {
        doi: DOI,
        locator: "arXiv:1505.04597v1 abstract, sentence 8",
        quote: P2_CLAIM_QUOTE,
        accessed_via: "crossref-api (Crossref 核验 HTTP 200) + arXiv:1505.04597v1 文本副本",
      },
    ],
  },
};
const E1 = {
  objectClass: "entity",
  subType: "publication",
  declared: {
    name: UNET_TITLE,
    venue: "MICCAI 2015, Lecture Notes in Computer Science, pp. 234–241, Springer International Publishing",
    doi: DOI,
    authors: ["Olaf Ronneberger", "Philipp Fischer", "Thomas Brox"],
    verification: "api.crossref.org/works/10.1007/978-3-319-24574-4_28 → HTTP 200（2026-11-02 核验；record indexed 2026-11-02T14:27:19Z）",
  },
};
const E2 = {
  objectClass: "entity",
  subType: "text-copy",
  declared: {
    name: "arXiv:1505.04597v1（U-Net 文本副本）",
    doi: "10.48550/arXiv.1505.04597",
    sourceUrl: RAW_ORIGIN_URL,
    role: "P-1/P-2 引文文本的核对源（v1 abstract）",
    knownFromMs: BASE_LOGICAL_MS + 500, // 材料可得时间早于首份报告（晚到登记 / 补录标注的建模输入）
  },
};
const A1 = {
  objectClass: "proposition",
  subType: "assessment",
  declared: {
    verdict: "SUPPORTED_WITHIN_DECLARED_SCOPE", // 作者声明的域相对 verdict（非机制计算）
    statement:
      "在声明的适用域内，U-Net 端到端少量样本主张（P-1）为其所引出版物自报结果所支持；本结论不构成对该主张科学真值的判定。",
    declaredGaps: [
      "引文文本按 arXiv v1 abstract 核对，未按 MICCAI camera-ready 版逐字核对",
      "基准比较为论文自报结果，无独立复现",
    ],
    applicabilityDomain: {
      domain: "生物医学图像分割（EM 堆栈 / 细胞追踪）",
      method: "U-Net encoder-decoder + dense skip connections",
      settings: ["ISBI 2012 EM segmentation challenge", "ISBI cell tracking challenge 2015"],
      excludes: ["其他分割域", "未发表设置"],
    },
    citations: [
      { object: "P1", revision: "r2", role: "subject-claim" },
      { object: "P1", revision: "r2", report: "RPT-2", role: "check-report" },
      { object: "E1", revision: "r1", role: "source-publication" },
      { object: "E2", revision: "r1", role: "source-text-copy" },
    ],
  },
};
const A2 = {
  objectClass: "proposition",
  subType: "assessment",
  declared: {
    verdict: "SCIENTIFICALLY_TRUE", // 负例：把 S-L1 结论当「科学为真」的语义真值词
    statement: "U-Net 主张在科学上为真。",
    applicabilityDomain: {
      domain: "生物医学图像分割",
      method: "U-Net",
      settings: ["ISBI 2012 EM segmentation challenge"],
      excludes: ["其他域"],
    },
    citations: [{ object: "P1", revision: "r2", report: "RPT-1", role: "check-report" }], // 负例：RPT-1 钉住 P1@r1，跨 revision 引用
    // 负例：缺 declaredGaps
  },
};
const A3 = {
  objectClass: "proposition",
  subType: "assessment",
  declared: {
    verdict: "SUPPORTED_WITHIN_DECLARED_SCOPE",
    statement: "E1 是一个身份可核验的出版物（DOI 可解析）。",
    declaredGaps: ["Crossref 记录未做独立交叉核验（仅单源 API）"],
    applicabilityDomain: {
      domain: "出版物身份核验",
      method: "crossref DOI lookup",
      settings: ["crossref.org"],
      excludes: ["出版方记录细节"],
    },
    citations: [{ object: "E1", revision: "r1", report: "RPT-2", role: "check-report" }], // 负例：RPT-2 钉住 P1@r2，跨对象引用
  },
};

// ———————————————————————————— 轨迹执行 ————————————————————————————
const T = {}; // 轨迹结果容器（断言在末尾统一核对，顺序与四件事对应）
const prex = new Prex(RUN_DIR);
const ACTOR = "principal:track";

const stepLog = [];
function step(name, fn) {
  const t0 = process.hrtime.bigint();
  const r = fn();
  const wall = Number(process.hrtime.bigint() - t0) / 1e6;
  stepLog.push({ name, wallMs: Number(wall.toFixed(3)) });
  console.log(`[track] ${name}  (+${wall.toFixed(3)}ms)`);
  return r;
}

// 检查报告构造（机制侧固定绑定模板；verdict/defects 由 S-L1 检查器对真实材料真实产出）
function makeFullReport(rptId, objectId, revision, ruleSetVersion) {
  const obj = prex.readObject(objectId, revision);
  const { verdict, defects } = sl1Check(obj.payload, ruleSetVersion, {
    resolveRef: (oid, rev) => prex.readObject(oid, rev) !== null,
  });
  return {
    rptId,
    target: { objectId, revision },
    contractVersion: PREX_CONTRACT_VERSION,
    schemaVersion: PREX_SCHEMA_VERSION,
    ruleSetVersion,
    validator: { ...PREX_VALIDATOR },
    inputEnvironment: { space: "prex-space-1", client: "prex-run", clock: "logical", node: process.version },
    checkedAt: prex.logicalNow,
    guaranteeScope: {
      covers: "S-L1 结构/声明检查：声明存在性、结构合法性、引用可解析性（对象确切 revision × 钉住规则集版本 × 输入环境）",
      excludes: "科学语义、原意、真值与科学充分性判定（RD-33：S-L1 只查声明不判语义）",
    },
    verdict,
    defects,
  };
}
// 独立复查（走公开报告门；同一对象 × 同一 revision × （可变更的）规则集版本 ⇒ 新报告，C11：旧报告不改写）
function recordRecheck(objectId, revision, ruleSetVersion, clientRequestId) {
  return prex.recordReport({
    report: makeFullReport(`RPT-${prex.nextRpt}`, objectId, revision, ruleSetVersion),
    actor: ACTOR,
    principalCanWrite: true,
    clientRequestId,
    op: "object-recheck",
  });
}

// c1 — RAW-1：真实文本的构造损坏（S-L0 不可解析 → Raw Intake）
step("c1 RAW-1 raw intake（构造损坏 of 真实文本；declaredType=proposition）", () => {
  T.raw1 = prex.declareRawIntake({
    recordId: "RAW-1",
    declaredType: "proposition",
    origin: { sourceRef: RAW_ORIGIN_URL, medium: "text", note: "构造损坏 of 真实文本（原文+损坏映射见 README §3.2）" },
    body: RAW_SENTENCE_CORRUPTED,
    actor: ACTOR,
    principalCanWrite: true,
    clientRequestId: "req-raw1-001",
  });
});

// c2 — RAW-2：declaredType 完全不认识（B-1 形态）
step("c2 RAW-2 raw intake（declaredType 完全不认识，B-1）", () => {
  T.raw2 = prex.declareRawIntake({
    recordId: "RAW-2",
    declaredType: "totally-unknown-foreign-schema-xyz",
    origin: { sourceRef: CROSSREF_URL, medium: "text" },
    body: UNET_TITLE,
    actor: ACTOR,
    principalCanWrite: true,
    clientRequestId: "req-raw2-001",
  });
});

// c3 — P-1 Domain Admission（可解析、有结构缺陷 → S-L1 未达成，仍登记）+ 首轮报告 RPT-1
step("c3 P-1 登记（r1，S-L1 未达成仍登记）+ 首轮报告 RPT-1（rs/v1）", () => {
  T.p1r1 = prex.registerObject({
    objectId: "P1",
    objectClass: "proposition",
    payload: P1_R1,
    actor: ACTOR,
    principalCanWrite: true,
    clientRequestId: "req-p1-admission-001",
    firstRoundCheck: { ruleSetVersion: "rs/v1" },
  });
});
const c3Block = prex.blocks.find((b) => b.events.some((e) => e.type === PREX_EVENTS.objectRegistered && e.payload.objectId === "P1"));
const c3Line = prex.lineOfBlockSeq(c3Block.seq);
T.c3Sha = sha(Buffer.from(c3Line));
// c3 时刻的时间快照（断言 A2-04 用：首轮报告落账后、显式修订前）
T.stateAfterC3 = {
  p1r1Readable: prex.readObject("P1", "r1") !== null,
  p1RevisionEventCount: prex.blocks.filter((b) => b.events.some((e) => e.type === PREX_EVENTS.objectRevised && e.payload.objectId === "P1")).length,
};
// 场景成本计时容器（必须先于任何使用它们的 step 声明）
const T_CRASH = {};
const T_BACKLOG = {};
const T_VISIT = {};

// c4 — P-1 修订 r2（补齐声明，显式修订）+ 同规则集重检 RPT-2（PASS；旧报告不改写）
step("c4 P-1 修订 r2 + 重检 RPT-2（rs/v1）", () => {
  T.p1r2 = prex.reviseObject({
    objectId: "P1",
    payload: P1_R2,
    actor: ACTOR,
    principalCanWrite: true,
    clientRequestId: "req-p1-rev2-001",
    recheck: { ruleSetVersion: "rs/v1" },
  });
});
// c4 块（含 P-1 修订 + RPT-2）字节基准（断言 A3-10 用：rs/v2 生效后该块字节仍逐等）
const c4Block = prex.blocks.find((b) => b.events.some((e) => e.type === PREX_EVENTS.checkReportRecorded && e.payload.rptId === "RPT-2"));
T.c4Sha = sha(Buffer.from(prex.lineOfBlockSeq(c4Block.seq)));

// c5 — E1（出版物 Entity）+ A-1（结论对象）+ A-1 首轮报告 RPT-3（E2 未登记 → 溯源未解析）
// E1 登记不带首轮报告（Domain Admission 的 S/R 报告「必要时」追加；任务轨迹 c5 只产生 R_A1-1）
step("c5 E1 登记 + A-1 登记 + A-1 首轮报告 RPT-3（rs/v1）", () => {
  T.e1 = prex.registerObject({
    objectId: "E1",
    objectClass: "entity",
    payload: E1,
    actor: ACTOR,
    principalCanWrite: true,
    clientRequestId: "req-e1-entity-001",
  });
  T.a1reg = prex.registerObject({
    objectId: "A1",
    objectClass: "proposition",
    payload: A1,
    actor: ACTOR,
    principalCanWrite: true,
    clientRequestId: "req-a1-admission-001",
    firstRoundCheck: { ruleSetVersion: "rs/v1" },
  });
});
const c5Block = prex.blocks.find((b) => b.events.some((e) => e.type === PREX_EVENTS.checkReportRecorded && e.payload.rptId === "RPT-3"));
const c5Line = prex.lineOfBlockSeq(c5Block.seq);
T.c5Sha = sha(Buffer.from(c5Line));

// c6 — A-2 / A-3（负例结论对象）
step("c6 A-2 + A-3 登记（负例结论对象）", () => {
  T.a2reg = prex.registerObject({ objectId: "A2", objectClass: "proposition", payload: A2, actor: ACTOR, principalCanWrite: true, clientRequestId: "req-a2-admission-001" });
  T.a3reg = prex.registerObject({ objectId: "A3", objectClass: "proposition", payload: A3, actor: ACTOR, principalCanWrite: true, clientRequestId: "req-a3-admission-001" });
});

// —— 出口尝试（积压窗口开启：证据 E2 未到达 ⇒ A-1 不可出口）——
step("出口尝试 #1（A-1，E2 未到达）", () => {
  T_BACKLOG.wallStart = tWall();
  T.exitA1first = prex.exitAssessment({ assessmentId: "A1", actor: ACTOR, principalCanWrite: true, clientRequestId: "req-a1-exit-001" });
});
step("出口尝试 #2（A-2，负例三码）", () => {
  T.exitA2 = prex.exitAssessment({ assessmentId: "A2", actor: ACTOR, principalCanWrite: true, clientRequestId: "req-a2-exit-001" });
});
step("出口尝试 #3（A-3，跨对象引用负例）", () => {
  T.exitA3 = prex.exitAssessment({ assessmentId: "A3", actor: ACTOR, principalCanWrite: true, clientRequestId: "req-a3-exit-001" });
});

// ——— 场景：中断（X-1 幂等形态）———
step("场景-中断：P-2 事务在提交点前进程级崩溃（crash-probe exit 9）", () => {
  T_CRASH.wallStart = tWall();
  T_CRASH.beforeSha = sha(prex.fileBytes());
  const spec = JSON.stringify({
    events: [{ typeKey: "objectRegistered", actor: ACTOR, payload: { objectId: "P2", objectClass: "proposition", payload: P2_R1 } }],
  });
  const child = spawnSync(process.execPath, [join(HERE, "crash-probe.mjs"), RUN_DIR, spec], { encoding: "utf8" });
  T_CRASH.childStatus = child.status;
  T_CRASH.childStdout = (child.stdout ?? "").trim();
  T_CRASH.afterSha = sha(prex.fileBytes());
});
step("场景-中断：同幂等键重放 #1（首次成功提交 c7，P-2 r1 + RPT-4）", () => {
  T.p2replay1 = prex.registerObject({
    objectId: "P2",
    objectClass: "proposition",
    payload: P2_R1,
    actor: ACTOR,
    principalCanWrite: true,
    clientRequestId: "req-p2-admission-001",
    firstRoundCheck: { ruleSetVersion: "rs/v1" },
  });
});
step("场景-中断：同幂等键重放 #2（应字节逐等返回首次结果）", () => {
  T.p2replay2 = prex.registerObject({
    objectId: "P2",
    objectClass: "proposition",
    payload: P2_R1,
    actor: ACTOR,
    principalCanWrite: true,
    clientRequestId: "req-p2-admission-001",
    firstRoundCheck: { ruleSetVersion: "rs/v1" },
  });
});
T_CRASH.wallMs = tWall() - T_CRASH.wallStart;

// ——— 场景：积压（D2-d 形态；窗口 = 首次出口拒绝 → 出口成功）———
step("积压：c8 E2 晚到登记（knownFromMs 早于首份报告）", () => {
  T.e2 = prex.registerObject({
    objectId: "E2",
    objectClass: "entity",
    payload: E2,
    actor: ACTOR,
    principalCanWrite: true,
    clientRequestId: "req-e2-entity-001",
    // E2 登记不带首轮报告（Domain Admission 的 S/R 报告「必要时」追加）
  });
});
step("积压：c9 A-1 复查 RPT-5（新报告；旧报告不改写）", () => {
  T.a1recheck = recordRecheck("A1", "r1", "rs/v1", "req-a1-recheck-001");
});
step("积压收口：c10 A-1 出口（证据到达 + 复查 PASS 后）", () => {
  T.exitA1final = prex.exitAssessment({ assessmentId: "A1", actor: ACTOR, principalCanWrite: true, clientRequestId: "req-a1-exit-002" });
  T_BACKLOG.wallMs = tWall() - T_BACKLOG.wallStart;
});

// ——— 场景：回访（D3-b/X-6 形态；规则集版本变更后回访旧对象）———
step("回访：c11 规则集 v2 生效，回访 P-1@r2 → 新报告 RPT-6（v2 新规则 verifiedAgainst 缺）", () => {
  T_VISIT.wallStart = tWall();
  T.p1r2v2 = recordRecheck("P1", "r2", "rs/v2", "req-p1-recheck-v2-001");
});
step("回访：钉住版本读 RPT-1 / RPT-2 / RAW-1（历史报告按钉住版本可读；原始字节不重解释）", () => {
  T.visitRpt1 = prex.readReport("RPT-1");
  T.visitRpt2 = prex.readReport("RPT-2");
  T.visitRaw1 = prex.readRaw("RAW-1");
});
T_VISIT.wallMs = tWall() - T_VISIT.wallStart;

// 重放整链验证（独立实例 = 跨进程复活形态）
const prexReopened = new Prex(RUN_DIR);
T.reopenChain = prexReopened.verifyChain();

// ———————————————————————————— 断言（四件事 × 契约锚） ————————————————————————————
console.log("\n=== 断言：1 — S-L0 提交（C-04 / #44 L234 / EA B-1/B-4 / C-09 / IC-H3）===");
const raw1Block = prex.blocks.find((b) => b.events.some((e) => e.type === PREX_EVENTS.rawRecordDeclared && e.payload.recordId === "RAW-1"));
const raw1Event = raw1Block ? raw1Block.events.find((e) => e.type === PREX_EVENTS.rawRecordDeclared) : null;
A(
  "A1-01",
  "不可解析材料（构造损坏 of 真实文本）仍被提交为原始记录：raw-record-declared 事件落账成功（commit ok，台账有行）",
  T.raw1.ok === true && raw1Block !== undefined && raw1Event !== undefined
);
A(
  "A1-02",
  "原始记录事件名不冒充生产封闭名单：prex:raw-record-declared ∉ 生产已入账 7 名；行内携 planned 未批准标注（gated EA-1.2.3）",
  raw1Event !== null &&
    !PRODUCTION_REGISTERED_NAMES.includes(raw1Event.type) &&
    raw1Event.nameProvenance.prexLocal === true &&
    raw1Event.nameProvenance.mirrorsProductionName === "raw-record-declared" &&
    raw1Event.nameProvenance.productionStatus.startsWith("planned-not-approved")
);
const raw1Read = prex.readRaw("RAW-1");
A(
  "A1-03",
  "原始记录类型标记 ≠ 任何正式对象类：读回 form==='raw'；Object Directory 无 RAW-1 行（不登记为正式对象）",
  raw1Read !== null && raw1Read.form === "raw" && !prex.listDirectory().some((d) => d.oid === "RAW-1")
);
A(
  "A1-04",
  "台账中不出现「把 RAW-1 当正式对象」的行：无任何非 raw 事件载荷引用 RAW-1（无 object-registered/revised/exit 以它为对象）",
  prex.blocks.every((b) =>
    b.events.every((e) => e.type === PREX_EVENTS.rawRecordDeclared || !JSON.stringify(e.payload).includes('"RAW-1"'))
  )
);
A(
  "A1-05",
  "对 RAW-1 的读取返回 raw 形态而非五类对象形态：读回键集恰为 {recordId,form,body,origin,declaredType,intakeNotes}，无 revision/kind/objectClass 字段",
  raw1Read !== null &&
    JSON.stringify(Object.keys(raw1Read).sort()) ===
      JSON.stringify(["body", "declaredType", "form", "intakeNotes", "origin", "recordId"])
);
A(
  "A1-06",
  "原文与来源完整保存、不被解释污染：body 与损坏文本 sha256 逐等；origin.sourceRef/medium 原样",
  raw1Read !== null &&
    sha(Buffer.from(raw1Read.body)) === sha(Buffer.from(RAW_SENTENCE_CORRUPTED)) &&
    raw1Read.origin.sourceRef === RAW_ORIGIN_URL &&
    raw1Read.origin.medium === "text"
);
A(
  "A1-07",
  "B-1 反向护栏：declaredType 完全不认识（totally-unknown-foreign-schema-xyz）仍被收为 raw，未产生任何 EVENT_AUTHORITY_REQUIRED 形态拒绝；declaredType 仅作数据保存",
  T.raw2.ok === true &&
    T.raw2.result.event === PREX_EVENTS.rawRecordDeclared &&
    prex.readRaw("RAW-2").declaredType === "totally-unknown-foreign-schema-xyz" &&
    !JSON.stringify(T.raw2).includes("AUTHORITY_REQUIRED")
);
let b4Refusal = null;
const b4Before = sha(prex.fileBytes());
try {
  prex.declareRawIntake({
    recordId: "RAW-3",
    declaredType: "proposition",
    origin: { sourceRef: RAW_ORIGIN_URL, medium: "text" },
    body: "unauthorized material",
    actor: "principal:nobody",
    principalCanWrite: false,
    clientRequestId: "req-raw3-001",
  });
} catch (e) {
  b4Refusal = e;
}
const b4After = sha(prex.fileBytes());
A(
  "A1-08",
  "B-4：无空间写权 ⇒ Raw Intake 完全拒收（SPACE_WRITE_DENIED），台账字节零变化（拒收与类型是否认识无关）",
  b4Refusal instanceof PrexError && b4Refusal.code === "SPACE_WRITE_DENIED" && b4Before === b4After && prex.readRaw("RAW-3") === null
);
A(
  "A1-09",
  "解析尝试结局留痕（每次尝试的输入/结局新增记录）：RAW-1 intakeNotes.parseAttempt==='UNPARSEABLE'；全链 digest 验证通过",
  raw1Event !== null && raw1Event.payload.intakeNotes.parseAttempt === "UNPARSEABLE" && prex.verifyChain().ok === true
);

console.log("\n=== 断言：2 — S-L1 旁路（#44 L235 / IC-S1 / EA B-5 / RD-33；中断场景 X-1/JC-1）===");
A(
  "A2-01",
  "可解析材料在 S-L1 未 PASS 时仍登记为正式对象：P-1 登记提交成功，Directory 行 {P1, proposition, prex-space-1}，r1 可读",
  T.p1r1.ok === true &&
    prex.listDirectory().some((d) => d.oid === "P1" && d.kind === "proposition" && d.space === "prex-space-1") &&
    prex.readObject("P1", "r1") !== null
);
const rpt1 = prex.readReport("RPT-1");
const p1RegBlock = prex.blockContaining("RPT-1");
const p1RegEvent = p1RegBlock ? p1RegBlock.events.find((e) => e.type === PREX_EVENTS.objectRegistered && e.payload.objectId === "P1") : null;
A(
  "A2-02",
  "首轮检查报告是独立记录：RPT-1 为独立事件（check-report-recorded，rptId 独立）；对象事件载荷不含报告 verdict（对象与报告解耦，同事务原子提交 Q40 形态）",
  rpt1 !== null && p1RegBlock !== undefined && p1RegEvent !== undefined && !JSON.stringify(p1RegEvent).includes('"verdict"')
);
A(
  "A2-03",
  "S-L1 未达成如实报告：RPT-1 verdict==='NOT_ACHIEVED'（≠PASS），缺陷清单非空且为首个结构缺陷码 CIT_ACCESS_VIA_MISSING",
  rpt1 !== null && rpt1.verdict === "NOT_ACHIEVED" && rpt1.defects.length === 1 && rpt1.defects[0].code === "CIT_ACCESS_VIA_MISSING"
);
A(
  "A2-04",
  "报告 verdict≠PASS 时对象不消失、不重写（c3 时刻快照）：首轮报告落账后 P-1@r1 仍可读，且此刻无任何 P-1 的 object-revised 行（未达成不说成 PASS、不静默修订）",
  T.stateAfterC3.p1r1Readable === true && T.stateAfterC3.p1RevisionEventCount === 0
);
A(
  "A2-05",
  "报告只含结构/声明缺陷清单：RPT-1 全部缺陷码 ∈ 结构/声明缺陷封闭词表（无语义判定码）",
  rpt1 !== null && rpt1.defects.every((d) => STRUCTURAL_DEFECT_CODES.includes(d.code))
);
A(
  "A2-06",
  "RD-33 机验：verdict+defects 面零语义判定词（封闭集扫描零命中）；guaranteeScope 声明不覆盖语义（声明不是判定）",
  rpt1 !== null &&
    containsSemanticTerm(JSON.stringify(rpt1.verdict) + JSON.stringify(rpt1.defects)) === null &&
    rpt1.guaranteeScope.excludes.includes("RD-33")
);
A(
  "A2-07",
  "对象修订追加不覆盖：P-1 r2 登记成功、r1 历史版本仍可读、P-1 的 object-revised 恰 1 条（即显式修订 c4，无静默改写）",
  T.p1r2.ok === true &&
    prex.readObject("P1", "r1") !== null &&
    prex.readObject("P1", "r2") !== null &&
    prex.blocks.filter((b) => b.events.some((e) => e.type === PREX_EVENTS.objectRevised && e.payload.objectId === "P1")).length === 1
);
A(
  "A2-08",
  "中断·零残留：提交点前进程级崩溃（exit 9）后台账文件字节逐等（零落盘、无部分行）；探针证据 staged=1 committed=0",
  T_CRASH.childStatus === 9 && T_CRASH.beforeSha === T_CRASH.afterSha && T_CRASH.childStdout.includes("staged=1") && T_CRASH.childStdout.includes("committed=0")
);
A(
  "A2-09",
  "中断·重放首次成功：同幂等键（actor,space,op,clientRequestId 四元组）重放 ⇒ 正常提交（idempotent=false，P-2 r1 + RPT-4 落账）",
  T.p2replay1.ok === true &&
    T.p2replay1.idempotent === false &&
    prex.readObject("P2", "r1") !== null &&
    prex.readReport("RPT-4") !== null &&
    prex.readReport("RPT-4").verdict === "PASS"
);
A(
  "A2-10",
  "中断·X-1 幂等：同键第二次重放 ⇒ 返回首次结果字节逐等（resultJson 字符串相等；不重算墙钟、不重执行）",
  T.p2replay2.ok === true && T.p2replay2.idempotent === true && T.p2replay2.resultJson === T.p2replay1.resultJson
);
A(
  "A2-11",
  "中断·不产生第二份记录：P-2 的 object-registered 事件恰 1 条（崩溃 + 两次重放后仍无第二份）",
  prex.blocks.filter((b) => b.events.some((e) => e.type === PREX_EVENTS.objectRegistered && e.payload.objectId === "P2")).length === 1
);

console.log("\n=== 断言：3 — 证据适用域（#44 L293 / ADJ D4-b / UNIFIED P5 / C11 / D3-b / X-6）===");
const reportSkeleton = (drop) => {
  const r = makeFullReport("RPT-NEG", "P1", "r1", "rs/v1");
  if (drop === "ruleSetVersion") delete r.ruleSetVersion;
  else if (drop === "inputEnvironment") delete r.inputEnvironment;
  else if (drop === "checkedAt") delete r.checkedAt;
  else if (drop === "guaranteeScope") delete r.guaranteeScope;
  else if (drop === "target.revision") delete r.target.revision;
  return r;
};
const negTest = (drop) => {
  const before = prex.blocks.length;
  let err = null;
  try {
    prex.recordReport({
      report: reportSkeleton(drop),
      actor: ACTOR,
      principalCanWrite: true,
      clientRequestId: `req-neg-${drop}-001`,
    });
  } catch (e) {
    err = e;
  }
  return { err, added: prex.blocks.length - before };
};
const n1 = negTest("ruleSetVersion");
const n2 = negTest("inputEnvironment");
const n3 = negTest("checkedAt");
const n4 = negTest("guaranteeScope");
const n5 = negTest("target.revision");
A("A3-01", "报告缺规则集版本（ruleSetVersion）⇒ 拒绝入库（RPT_BIND_INCOMPLETE），零新增块", n1.err?.code === "RPT_BIND_INCOMPLETE" && n1.added === 0);
A("A3-02", "报告缺输入环境（inputEnvironment）⇒ 拒绝入库，零新增块", n2.err?.code === "RPT_BIND_INCOMPLETE" && n2.added === 0);
A("A3-03", "报告缺执行时间（checkedAt）⇒ 拒绝入库，零新增块", n3.err?.code === "RPT_BIND_INCOMPLETE" && n3.added === 0);
A("A3-04", "报告缺声明保证范围（guaranteeScope）⇒ 拒绝入库，零新增块", n4.err?.code === "RPT_BIND_INCOMPLETE" && n4.added === 0);
A("A3-05", "报告缺对象确切 revision（target.revision）⇒ 拒绝入库，零新增块", n5.err?.code === "RPT_BIND_INCOMPLETE" && n5.added === 0);
const rpt6 = prex.readReport("RPT-6");
A(
  "A3-06",
  "同对象换规则集版本复查 ⇒ 产生新报告：RPT-6 为新 rptId（≠RPT-1/RPT-2），ruleSetVersion==='rs/v2'，verdict==='NOT_ACHIEVED'（v2 新规则 verifiedAgainst 缺）",
  rpt6 !== null && rpt6.ruleSetVersion === "rs/v2" && rpt6.verdict === "NOT_ACHIEVED" && rpt6.defects[0]?.code === "CIT_QUOTE_VERIFIED_AGAINST_MISSING"
);
const c3LineReread = prexReopened.lineOfBlockSeq(c3Block.seq);
A(
  "A3-07",
  "C11/D3-b：复查后旧报告字节不变（c3 块行自磁盘重读 sha256 逐等）；RPT-1 按其钉住版本 rs/v1 原样可读（不重解释：verdict 仍为存值 NOT_ACHIEVED）",
  c3LineReread !== null && sha(Buffer.from(c3LineReread)) === T.c3Sha && rpt1.ruleSetVersion === "rs/v1" && rpt1.verdict === "NOT_ACHIEVED"
);
A(
  "A3-08",
  "跨适用域引用（跨 revision）：A-2 以 RPT-1（钉住 P1@r1）支撑 P1@r2 结论 ⇒ 出口拒（OUT_OF_SCOPE_CITATION）",
  T.exitA2.ok === false && T.exitA2.codes.includes("OUT_OF_SCOPE_CITATION")
);
A(
  "A3-09",
  "跨适用域引用（跨对象）：A-3 以 RPT-2（钉住 P1@r2）支撑 E1 结论 ⇒ 出口拒（OUT_OF_SCOPE_CITATION）",
  T.exitA3.ok === false && T.exitA3.codes.includes("OUT_OF_SCOPE_CITATION")
);
A(
  "A3-10",
  "回访不重解释（X-6 原始字节）：rs/v2 生效后，RPT-2 所在块行（c4，自磁盘重读）sha256 逐等、RAW-1 原始体逐等（机制只按钉住版本供原始字节，不套用新规则重解释）",
  sha(Buffer.from(prexReopened.lineOfBlockSeq(c4Block.seq))) === T.c4Sha && sha(Buffer.from(prex.readRaw("RAW-1").body)) === sha(Buffer.from(RAW_SENTENCE_CORRUPTED))
);

console.log("\n=== 断言：4 — 结论出口判据（四分量 + IC-S2/RD-33 不变量；积压场景 D2-d/C11）===");
A(
  "A4-01",
  "积压·不可出口窗口：E2 到达前 A-1 出口被拒（PROVENANCE_REF_UNRESOLVED + EXIT_REPORT_NOT_PASS）——结论在证据到达前保持「不可出口」",
  T.exitA1first.ok === false &&
    T.exitA1first.codes.includes("PROVENANCE_REF_UNRESOLVED") &&
    T.exitA1first.codes.includes("EXIT_REPORT_NOT_PASS")
);
A("A4-02", "缺 declared_gaps ⇒ 拒出口（EXIT_MISSING_DECLARED_GAPS）", T.exitA2.ok === false && T.exitA2.codes.includes("EXIT_MISSING_DECLARED_GAPS"));
A(
  "A4-03",
  "把 S-L1 结论当「科学为真」⇒ 拒出口（VERDICT_SEMANTIC_CLAIM_REFUSED）：语义真值词 SCIENTIFICALLY_TRUE 落在域相对封闭词表外——机制只保证声明面",
  T.exitA2.ok === false && T.exitA2.codes.includes("VERDICT_SEMANTIC_CLAIM_REFUSED")
);
// 早截点 = E2 提交的前一个提交的 M(c)（动态定位，不依赖硬编码序号）
const e2Block = prex.blocks.find((b) => b.events.some((e) => e.type === PREX_EVENTS.objectRegistered && e.payload.objectId === "E2"));
const beforeE2 = prex.blocks[prex.blocks.indexOf(e2Block) - 1];
const earlyView = prex.readAt({ cutoffMs: beforeE2.commitRecordedAtMs });
const lateView = prex.readAt();
A(
  "A4-04",
  "D2-d·早截点不可见：晚到记录 E2 在其提交前一时刻的视图不可见（迟到登记不可追溯变成过去已登记）",
  earlyView.resolvedCutoff === beforeE2.c && !earlyView.items.some((i) => i.id === "E2")
);
A(
  "A4-05",
  "D2-d·晚截点携补录标注：E2 在默认（当前已提交）视图可见且 lateBackfill===true（补录派生键：提交序 > cutoff(knownFromMs)）",
  lateView.items.some((i) => i.id === "E2" && i.lateBackfill === true)
);
const rpt5 = prex.readReport("RPT-5");
const c5LineReread = prexReopened.lineOfBlockSeq(c5Block.seq);
A(
  "A4-06",
  "积压·复查产生新报告且旧报告不改写（C11）：RPT-5 为新 rptId（≠RPT-3）verdict==='PASS'；RPT-3 所在块行自磁盘重读 sha256 逐等（字节不变）",
  rpt5 !== null && rpt5.verdict === "PASS" && c5LineReread !== null && sha(Buffer.from(c5LineReread)) === T.c5Sha
);
A(
  "A4-07",
  "出口成功且出口记录是独立台账行：assessment-exited 事件恰 1 条；readExit(A1) 非空",
  T.exitA1final.ok === true && prex.countEvents(PREX_EVENTS.assessmentExited) === 1 && prex.readExit("A1") !== null
);
const exitRec = prex.readExit("A1");
A(
  "A4-08",
  "出口记录携四分量齐全：verdict（域相对值）+ declared_gaps（数组，2 项如实声明）+ 适用域声明（domain+method）+ 溯源绑定（4 条全部解析）",
  exitRec !== null &&
    ASSESSMENT_EXIT_VERDICTS.includes(exitRec.verdict) &&
    Array.isArray(exitRec.declaredGaps) &&
    exitRec.declaredGaps.length === 2 &&
    typeof exitRec.applicabilityDomain.domain === "string" &&
    typeof exitRec.applicabilityDomain.method === "string" &&
    Array.isArray(exitRec.provenanceBindings) &&
    exitRec.provenanceBindings.length === 4
);
A(
  "A4-09",
  "出口记录保留机制不变量声明（逐字）：「S-L1 PASS ≠ 原意被确认 ≠ 正确」+ RD-33 声明面限定",
  exitRec !== null &&
    exitRec.mechanismInvariants.sl1PassDisclaimer === "S-L1 PASS ≠ 原意被确认 ≠ 正确" &&
    exitRec.mechanismInvariants.rd33Note.includes("S-L1 只查声明不判语义")
);
A(
  "A4-10",
  "出口溯源绑定在适用域内：出口记录引用复查报告 RPT-5，其钉住目标 = {A1, r1}（与出口对象一致，非跨域引用）",
  exitRec !== null && exitRec.exitReportRef === "RPT-5" && rpt5.target.objectId === "A1" && rpt5.target.revision === "r1"
);

// ———————————————————————————— 汇总 + 成本表 ————————————————————————————
const WALL_MS = Number(tWall().toFixed(3));
const totalOps = 13 /* 13 个提交块 */ + 3 /* 出口拒绝尝试 */ + 1 /* 崩溃子进程 */ + 2 /* 幂等重放 */ + 5 /* 负例报告尝试 */ + 3 /* 回访钉住读 */;
const cost = {
  中断: {
    ops: "1 崩溃(子进程 exit9) + 1 重放提交 + 1 幂等重放 + 2 文件字节核验",
    wallMs: Number(T_CRASH.wallMs.toFixed(3)),
    note: "提交点前崩溃 = 零落盘；同幂等键重放返回首次结果字节逐等、不产生第二份记录（X-1/JC-1）",
  },
  积压: {
    ops: "3 出口拒绝尝试 + 3 中断场景操作 + 1 E2 晚到登记 + 1 复查(新报告 RPT-5) + 1 出口成功 = 9 机制操作；窗口跨 4 个提交块（P-2 重放 / E2 晚到登记 / RPT-5 复查 / 出口）",
    wallMs: Number(T_BACKLOG.wallMs.toFixed(3)),
    note: "E2 到达前结论保持不可出口；晚到记录在早截点不可见、晚截点携补录标注（D2-d）；旧报告不改写（C11）",
  },
  回访: {
    ops: "1 规则集 v2 重检（新报告 RPT-6）+ 3 钉住版本读（RPT-1/RPT-2/RAW-1）= 4 操作",
    wallMs: Number(T_VISIT.wallMs.toFixed(3)),
    note: "历史报告按钉住版本仍可读（D3-b）；原始字节不重解释（X-6）",
  },
};
console.log(`\n=== 汇总（round ${ROUND}）===`);
console.log(`断言: 总 ${passCount + failCount} | PASS ${passCount} | FAIL ${failCount}`);
if (failures.length) console.log(`失败断言: ${failures.join(", ")}`);
console.log(`整轮墙钟: ${WALL_MS}ms | 机制操作记账: ${totalOps}（中断 3 ⊂ 积压 9，三行不重复计）| 重放整链: ${JSON.stringify(T.reopenChain)}`);
console.log("成本表:");
for (const [k, v] of Object.entries(cost)) console.log(`  ${k}: ops=[${v.ops}] wall=${v.wallMs}ms — ${v.note}`);
console.log(`材料溯源: DOI ${DOI}（Crossref HTTP 200，2026-11-02）；引文文本源 arXiv:1505.04597v1；RAW-1 = 构造损坏 of 真实文本（arXiv v1 abstract sentence 3）`);

const EXIT_CODE = failCount === 0 ? 0 : 1;
appendFileSync(
  HISTORY_PATH,
  JSON.stringify({ round: ROUND, pass: passCount, fail: failCount, total: passCount + failCount, exitCode: EXIT_CODE, wallMs: WALL_MS, ts: new Date().toISOString() }) + "\n"
);
console.log(`run-history 已追加 round=${ROUND}（exit code ${EXIT_CODE}）`);
process.exit(EXIT_CODE);
