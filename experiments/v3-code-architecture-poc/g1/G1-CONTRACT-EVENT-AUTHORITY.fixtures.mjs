#!/usr/bin/env node
/*
  G1-CONTRACT-EVENT-AUTHORITY.fixtures.mjs —— 与 G1-CONTRACT-EVENT-AUTHORITY.md 互相对账的夹具。

  用法：node experiments/v3-code-architecture-poc/g1/G1-CONTRACT-EVENT-AUTHORITY.fixtures.mjs
  退出码：0 = 契约自洽（结构校验 + 表驱动正反例 + 三条「架空判据必红」自验全部通过）；1 = 有任一项 FAIL；2 = 夹具自身无法运行（缺文件等）。

  纪律：
  - 零依赖（只用 node:fs / node:path / node:crypto / node:child_process），可直接 node 跑；不起数据库、
    不跑 PoC、不写任何生产代码；child_process 仅用于 git show **只读**抽取 #44 blob 原文做引用逐字
    保真机验（S3b，复审 P2-3），不做任何写入、网络或子命令。
  - 这里实现的是**契约判据的最小模型**（分类器 / 签发单点 / 预留闸 / 归属账 / 对账器 / 审计持久化），
    不是机制实现；判据语义逐条对应契约正文的 EA-* 小节。
  - 变异纪律：MUT-* 架空判据**常驻本文件不删除**（照仓内「架空不删除」纪律）；
    自验的断言方向是——真实判据必须拦住负例，架空判据必须放过同一负例
    （否则说明正反例表对「把判据架空」这件事没有判别力）。
*/

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(HERE, 'G1-CONTRACT-EVENT-AUTHORITY.md');
const SELF_PATH = fileURLToPath(import.meta.url);
const SELF_SRC = readFileSync(SELF_PATH, 'utf8');
const REFUSAL_CODES_PATH = join(HERE, '..', 'src', 'contracts', 'index.ts');

let doc = '';
try {
  doc = readFileSync(CONTRACT_PATH, 'utf8');
} catch (e) {
  process.stderr.write('FATAL: 读不到契约正文 ' + CONTRACT_PATH + '：' + e.message + '\n');
  process.exit(2);
}

let pass = 0, fail = 0;
const fails = [];
function check(name, cond, detail) {
  if (cond) { pass += 1; process.stdout.write('PASS  ' + name + '\n'); }
  else { fail += 1; fails.push(name); process.stdout.write('FAIL  ' + name + (detail ? '  —— ' + detail : '') + '\n'); }
}

// ============================================================ 判据常量（与契约互认）

// 契约 §2.4 名单块（机器可读锚：BEGIN/END 注释之间）——逐等之一方（契约方；第三方位状态见 S 组探针）
function docMechanismList() {
  const m = doc.match(/<!-- EA-2 MECHANISM-CLOSED-LIST-BEGIN -->([\s\S]*?)<!-- EA-2 MECHANISM-CLOSED-LIST-END -->/);
  if (!m) return null;
  return m[1].replace(/[「」]/g, '').split(/[·\s]+/).map(s => s.replace(/[，,]/g, '').trim())
    .filter(s => /^[a-z][a-z0-9-]*$/.test(s));
}

// 判据模型里的机制名单——两方/三方逐等的「夹具方」（本文件是判据的模型实现；第三方位是否在场由 S1c 判定）
// 【R-5 裁决 2026-11-01】只列**有批准面**的七名：包 6 既有预留五名（C-19）+ 存量就地升格两名。
// 本组契约新造、除契约文字外无批准记录的三名（raw-record-declared / integrity-audit-recorded /
// read-shadow-recorded）**不在运行时名单**——它们是本契约的提案（契约裁定形状与判据，判据≠批准），
// 入账的唯一门槛是锚文件里的人工 `Approved-By` 标记。台账见 G1-CONTRACT-RECONCILIATION.md R-5。
const MODEL_MECHANISM = [
  'capability-enabled', 'capability-disabled', 'capability-transferred',
  'object-registered', 'check-report-recorded',
  'object-revised', 'record-backfilled'             // 存量机制写点就地升格（EA-5.2，C.5-1 裁定）
];
// 提案未入账（EA-2.4 步骤 2 的人工标记未落地；锚文件 planned:true）
const MODEL_PENDING_APPROVAL = [
  { eventType: 'raw-record-declared', gated_by: 'EA-1.2.3' },       // 本契约新裁名
  { eventType: 'integrity-audit-recorded', gated_by: 'EA-7.1' },    // C-24 建议转正（判据面）
  { eventType: 'read-shadow-recorded', gated_by: 'EA-7.2' }         // 本契约新裁（读侧遮蔽持久化）
];
const RAW_FIXED_EVENT = 'raw-record-declared';
// planned 占位（不入运行时名单；EA-2.4 末段 + RL-2.2 提案文书降级）
const MODEL_PLANNED = [{ eventType: 'ns-relocated', gated_by: 'G1-NS-01' }];

// 名单的两个阶段（与 FM 夹具 w.listed 同型）：'listed' = 人工标记已落地的稳态（默认，正向用例的
// 世界）；'proposed' = 批准未落地 ⇒ 提案名按 unregistered 处理、机制内部直写装配红。
// FM-9 的两个挂载类机制名：名字本体与入账判据归 A 契约，EA 侧只在「已入账」阶段把它们当机制名
// （EA-4.5 ③ 支的覆盖域必须包含它们，否则 R-2 的三分对白契约为空——依赖登记见 FM-7/FM-11.2）
const FM_MOUNT_MECHANISM = ['facet-mounted', 'facet-unlinked'];
const PHASES = {
  'proposed': new Set(MODEL_MECHANISM),
  listed: new Set([...MODEL_MECHANISM, ...MODEL_PENDING_APPROVAL.map(p => p.eventType),
    ...MODEL_PLANNED.map(p => p.eventType), ...FM_MOUNT_MECHANISM])
};

// R-5 批准门（新增判据）：机制内部直写通道的名字必须已入账，否则装配红（fail-closed）。
// 用 ACTIVATION_IMPOSSIBLE（FM-7「名册缺项 = 装配红」同族同码），**不得**用
// EVENT_AUTHORITY_REQUIRED——后者出现在 Raw Intake 路径上就是 T-N8 钉的 B-1 违例。
function mechanismWriteGate(eventType, phase = 'listed') {
  if (PHASES[phase].has(eventType)) return null;
  return { refusal: { code: 'ACTIVATION_IMPOSSIBLE', detail: { gate: 'mechanism-name-not-approved', eventType, missing: 'Approved-By（EA-2.4 步骤 2 人工标记）' } } };
}
// 架空批准门 MUT-6（常驻不删）：把「有批准标记」写成「契约文书自称批准即过」= I-5 的空转锚
function mechanismWriteGateMUT6(eventType, phase = 'listed') { void phase; void eventType; return null; }

// 机制轴集（D-26/C-17「至少」的入账全集；FM-7 依 EA-2.4 扩入 facet-mount——R-2 ③ 支的覆盖域）
const MECHANISM_RESOURCES = new Set(['space-write', 'capability-admin']); // EA-3.2 判据④ 的基线两轴
const MECHANISM_AXES = new Set(['space-write', 'capability-admin', 'facet-mount']);
// 名册登记的机制轴（锚文件条目的 axis 归属侧模型；挂载两名的名字本体归 FM-9，这里只取「名→轴」登记面）
const MECHANISM_AXIS_OF = {
  'capability-enabled': 'capability-admin', 'capability-disabled': 'capability-admin',
  'capability-transferred': 'capability-admin', 'ns-relocated': 'capability-admin',
  'integrity-audit-recorded': 'capability-admin', 'read-shadow-recorded': 'capability-admin',
  'facet-mounted': 'facet-mount', 'facet-unlinked': 'facet-mount'
};
const registeredMechanismAxis = (eventType) => MECHANISM_AXIS_OF[eventType] ?? null;

// 归属账（EA-3）——锚文件的**夹具侧最小模型**（形状 = 契约 §6.1 entries）。P2-1 如实标注：这是夹具自建的
// 归属账模型，**不是**从锚文件 g1/EVENT-CONTRACT-LEDGER.json 读来的（锚未物化 ⇒ 无源可读）；锚物化后
// 第三方位改由 S1/S1b 的 anchorMechanismNames 实读，本 Map 退为纯分类器世界输入，不再兼任「第三方位」。
const OWNERSHIP = new Map([
  ['synth:fact-designation', { eventType: 'synth:fact-designation', ownerCapability: 'cap-records', requiresAuthority: 'domain-admission', truthSource: 'ledger-payload', interpretationRuleSetVersion: 'r1', contractVersion: 'v3' }],
  ['synth:admission-revoked', { eventType: 'synth:admission-revoked', ownerCapability: 'cap-records', requiresAuthority: 'domain-admission', truthSource: 'ledger-payload', interpretationRuleSetVersion: 'r1', contractVersion: 'v3' }],
  ['facet:calibration-observed', { eventType: 'facet:calibration-observed', ownerCapability: 'cap-calibration', requiresAuthority: 'calibration-write', truthSource: 'ledger-payload', interpretationRuleSetVersion: 'r1', contractVersion: 'v3' }],
  ['coordination:usecase-step', { eventType: 'coordination:usecase-step', ownerCapability: 'cap-records', requiresAuthority: 'usecase-run', truthSource: 'ledger-payload', interpretationRuleSetVersion: 'r1', contractVersion: 'v3' }]
]);

const sortSet = (xs) => [...new Set(xs)].sort();
const digest = (xs) => createHash('sha256').update(JSON.stringify(sortSet(xs))).digest('hex');

// EA-1.3a：declaredType 形状上限（与契约两处引用**逐字同步**——夹具 S11 机验这一同步）
const DECL_TYPE_RE_SRC = '^[A-Za-z0-9][A-Za-z0-9.:+/-]{0,127}$';
const DECL_TYPE_RE = new RegExp(DECL_TYPE_RE_SRC);

// ============================================================ EA-1.2 分类器（唯一判据点）

let classifyCalls = 0; // T-P3 用：Raw 路径对分类器必须零调用（EA-1.3a 三不参与之「不参与授权判定」）
function classify(eventType, phase = 'listed') {
  classifyCalls += 1;
  if (PHASES[phase].has(eventType)) return { cls: 'mechanism', owner: null };
  const e = OWNERSHIP.get(eventType);
  if (e) return { cls: 'domain', owner: e.ownerCapability };
  return { cls: 'unregistered', owner: null };
}

// 架空判据 MUT-2（常驻不删）：未登记名一律当「域内自用名默认可写」= 现状 deny-by-exception 的模型
function classifyMUT2(eventType) {
  const c = classify(eventType);
  return c.cls === 'unregistered' ? { cls: 'auxiliary', owner: null } : c;
}

// 契约 EA-2.3 detail 合同
function refusal(eventType, channel, classification, owner) {
  return { code: 'EVENT_AUTHORITY_REQUIRED', detail: { eventType, channel, owner: owner ?? null, classification, reason: 'see EA-2.2/EA-2.3' } };
}

// 通用台账通道：EA-2.2 矩阵——mechanism / unregistered / domain 在通用通道全部拒
function genericAppend(eventType, channel, classifier = classify) {
  const c = classifier(eventType);
  if (c.cls === 'mechanism') return refusal(eventType, channel, 'mechanism', null);
  if (c.cls === 'domain') return refusal(eventType, channel, 'owned-by-other', c.owner);
  if (c.cls === 'unregistered') return refusal(eventType, channel, 'unregistered', null);
  return null; // classifier 判为 auxiliary ⇒ 放行（只可能来自 MUT-2）
}

// ============================================================ EA-4 签发单点 + 全形闸

// 唯一授权上下文生成点（机制单点，EA-4.3）：actor/axis/authorized/版本在此一次写全，入参无见证位
function issueAuthorizationContext({ principal, capability, entry, txSeq, nowMs, ruleSetVersion, contractVersion }) {
  return {
    ctxId: 'ctx-' + txSeq,
    actor: principal.actorId,                 // 已验证主体（宿主注入面，非载荷字段）
    capability,
    axis: entry.requiresAuthority,            // 取自归属账（机制侧，非调用方自报）
    authorized: !!principal.businessAxes.includes(entry.requiresAuthority), // principalCan 的模型
    ruleSetVersion, contractVersion, issuedAtMs: nowMs, txSeq
  };
}

const EA43_INPUT_FIELDS = ['eventType', 'objectId', 'revision', 'payload', 'describedAt']; // 与契约 §4.3 字段清单逐字对账
// 领域事件写入 Port：入参封闭 + 归属核对 + 取证（先于对象解析）
function domainWrite(portCapability, input, opts) {
  const extra = Object.keys(input).filter(k => !EA43_INPUT_FIELDS.includes(k));
  if (extra.length > 0) { // 自带见证 = 结构拒（复用同码，EA-2.3 末段）
    const r = refusal(input.eventType, 'appendAuthoritativeEvent', input.eventType.startsWith('synth:') ? 'unregistered' : 'unregistered', null);
    r.detail.reason = 'input-carries-witness-field';
    r.detail.extraFields = extra.sort();
    return { refusal: r };
  }
  const c = classify(input.eventType);
  if (c.cls === 'mechanism') return { refusal: refusal(input.eventType, 'appendAuthoritativeEvent', 'mechanism', null) };
  if (c.cls === 'unregistered') return { refusal: refusal(input.eventType, 'appendAuthoritativeEvent', 'unregistered', null) };
  if (c.owner !== portCapability) return { refusal: refusal(input.eventType, 'appendAuthoritativeEvent', 'owned-by-other', c.owner) };
  const entry = OWNERSHIP.get(input.eventType);
  const ctx = issueAuthorizationContext({ ...opts, capability: portCapability, entry });
  return { row: { seq: opts.txSeq, event_type: input.eventType, actor: ctx.actor, authority_basis: ctx, payload: input.payload, objectId: input.objectId ?? null } };
}

const EA46_CTX_FIELDS = ['ctxId', 'actor', 'capability', 'axis', 'authorized', 'ruleSetVersion', 'contractVersion', 'issuedAtMs', 'txSeq'];
// EA-4.5 全形闸（R-2 三分修订版：①领域事件 ②路由/运维审计 ③机制挂载类审计，覆盖式不点名）
function axisBranchFullShape(row, e, phase = 'listed') {
  const cls = classify(row.event_type, phase).cls;
  if (cls === 'domain') return !MECHANISM_AXES.has(e.axis);                     // ① D-26 原句
  if (cls !== 'mechanism') return false;                                        // 未入账名没有合法见证形态
  if (!MECHANISM_AXES.has(e.axis)) return false;                                             // ②③共同前提
  if (registeredMechanismAxis(row.event_type) !== e.axis) return false;         // 名册轴绑定（防串用）
  return e.authorized === true;                                                 // ②③：判定输入型必已生效
}
function gateFullShape(row, phase = 'listed') {
  const e = row.authority_basis;
  if (row.actor == null) return false;
  if (e == null || typeof e !== 'object') return false;
  if (!EA46_CTX_FIELDS.every(f => Object.prototype.hasOwnProperty.call(e, f))) return false;
  if (e.actor !== row.actor) return false;                 // 同源一致性（F-G6A-2 修法）
  if (!axisBranchFullShape(row, e, phase)) return false;   // 三分轴判据（EA-4.5 R-2）
  if (classify(row.event_type, phase).cls === 'domain'
    && classify(row.event_type, phase).owner !== e.capability) return false; // ①类的审计复算面
  return true;
}
// 架空判据 MUT-1（常驻不删）：只核「有一个 actor」——C-21 点名处的模型
function gateFullShapeMUT1(row) { return row.actor != null; }
// 架空判据 MUT-4（R-2 新增，常驻不删）：③ 支丢掉「名册轴绑定」——凡轴在机制轴集且 authorized=1 即过。
// 真判据必须拦住「机制名挂到别的机制轴上」的负例（T-N12），MUT-4 必须放过同一负例。
function gateFullShapeMUT4(row) {
  const e = row.authority_basis;
  if (row.actor == null || e == null) return false;
  if (!EA46_CTX_FIELDS.every(f => Object.hasOwnProperty.call(e, f))) return false;
  if (e.actor !== row.actor) return false;
  if (classify(row.event_type).cls === 'mechanism') return MECHANISM_AXES.has(e.axis) && e.authorized === true;
  return !MECHANISM_AXES.has(e.axis);
}

// EA-4.6 审计复算三态
function replayAuthorityEvidence(row, frozenVersions) {
  if (row.authority_basis == null) return 'UNVERIFIABLE_LEGACY';
  if (!gateFullShape(row)) return 'INCONSISTENT';
  const e = row.authority_basis;
  if (!frozenVersions.ruleSets.includes(e.ruleSetVersion)) return 'INCONSISTENT';
  if (!frozenVersions.contractVersions.includes(e.contractVersion)) return 'INCONSISTENT';
  return 'VERIFIED';
}
// 投影侧见证优先闸（§16.2 既有立场的最小模型：authorized=false 永不计入）
function countsInProjection(row) { return row.authority_basis != null && row.authority_basis.authorized === true && gateFullShape(row); }

// ============================================================ EA-1.3 Raw Intake 通道

function declareRawIntake(principal, env, phase = 'listed') {
  if (!principal.spaceWrite) return { refusal: { code: 'AUTHORITY_REQUIRED' }, deletedRaw: [] }; // B-4：既有授权路径，非本码
  // R-5：固定名 raw-record-declared 是本契约的**提案**（人工 Approved-By 未落地期间不入账）——
  // 未入账期间落账通道装配红 fail-closed（材料照收、行写不下去），不是「先落码后补批准」。
  const gate = mechanismWriteGate(RAW_FIXED_EVENT, phase);
  if (gate) return { refusal: gate.refusal, deletedRaw: [] };
  // declaredType 绝不进分类器（EA-1.2.3）；此路径不存在 EVENT_AUTHORITY_REQUIRED（B-1）
  // EA-1.3a：形状卫生在传输层做——畸变置 null + PARSE_FAILED，整封照常收（B-1 不因元数据形状翻转）
  let declaredType = env.declaredType ?? null;
  let notes = env.intakeNotes ?? null;
  if (declaredType !== null && !DECL_TYPE_RE.test(declaredType)) {
    declaredType = null;
    notes = { parseAttempt: 'PARSE_FAILED' };
  }
  const row = {
    seq: 0, event_type: RAW_FIXED_EVENT, actor: principal.actorId,
    payload: { recordId: env.recordId, declaredType, origin: env.origin ?? null, bodyRetained: env.body, intakeNotes: notes }
  };
  return { row };
}
// 越界误用模型（T-N8 用）：把预留闸接到 Raw 通道上 = 命名权威变存在性 oracle（B-1 违例形态）
function declareRawIntakeVIOLATING(principal, env) {
  const bad = genericAppend(env.declaredType, 'declareRawIntake-input');
  if (bad) return { refusal: bad };
  return declareRawIntake(principal, env);
}

// ============================================================ EA-3.3 装配期 OA-* 判据

function assembleOwnership(manifestClaims) { // [{eventType, owner}] ⇒ 零副作用或抛错语义用返回表达
  const seen = new Map();
  for (const c of manifestClaims) {
    if (MODEL_MECHANISM.includes(c.eventType)) return { error: 'AMBIGUOUS_AUTHORITY', rule: 'OA-2/OA-4 机制名认领', claim: c.eventType };
    if (RAW_FIXED_EVENT === c.eventType) return { error: 'AMBIGUOUS_AUTHORITY', rule: 'OA-4 Raw 固定名认领', claim: c.eventType };
    if (seen.has(c.eventType)) return { error: 'AMBIGUOUS_AUTHORITY', rule: 'OA-1 双认领', claim: c.eventType };
    seen.set(c.eventType, c.owner);
  }
  return { ok: true };
}
function axisIsMechanismOwn(axis) { return MECHANISM_RESOURCES.has(axis); } // 判据④（缺轴=③，模型里 entry 无 requiresAuthority）

// ============================================================ EA-5 历史解释（冻结表按名+版本，hasOwnProperty）

const LEGACY_TABLE = {
  'object-revised': { r0: '机制登记的修订事实（切换前形状）', r1: '机制登记的修订事实（切换后同判据）' },
  'record-backfilled': { r0: '迁移器回填的记录登记（永久携带回填事实字段）', r1: '迁移器回填的记录登记（永久携带回填事实字段；新写入仅迁移器内部直写）' }
};
function interpretLegacyRow(row) { // 未知即 fail-closed（N6/N7 的 hasOwnProperty 课）
  const t = LEGACY_TABLE[row.event_type];
  if (!t || !Object.prototype.hasOwnProperty.call(t, row.version)) return 'UNINTERPRETED_FAIL_CLOSED';
  return t[row.version]; // 行本身一字不动地读——返回值只是解释文本
}

// ===== EA-5.3（R-6 收口句）显式修补事件模型 =====
// 收口句：修补 = **显式、可审计的运维动作**，只调整该行的**呈现档**且可被回看；机制**绝不自动补戳**，
// 也**不得因修补改写历史语义**（原行字节一字不动，修补只追加、零 UPDATE）。
// 如实边界：修补动作的载体若要进台账事件名空间，须另走 EA-2.4 入账——本模型用**运维修补账**表达，
// 不替自己新造机制事件名（那正是 R-5 刚作废的动作）。
const APPROVED_BY_RE = /^Approved-By: \d{4}-\d{2}-\d{2} \S+$/;
function patchContractVersionPresentation(patchLog, row, patch) {
  if (!APPROVED_BY_RE.test(patch.humanMarker ?? '')) return { refusal: 'PATCH_REQUIRES_HUMAN_MARKER' };
  const before = JSON.stringify(row);
  patchLog.push({ patchedSeq: row.seq, presentationTier: patch.presentationTier, marker: patch.humanMarker, atSeq: patch.atSeq });
  if (JSON.stringify(row) !== before) return { refusal: 'PATCH_MUTATED_HISTORY_ROW' }; // 只追加，零改旧行
  return { ok: true, presentationTier: presentationTierOf(patchLog, row) };
}
function presentationTierOf(patchLog, row) {
  const p = patchLog.filter(x => x.patchedSeq === row.seq).sort((a, b) => a.atSeq - b.atSeq).pop();
  return p ? 'patched@seq' + p.atSeq : 'pre-cutover-default';
}
// 机制侧不存在自动补戳路径（打开期扫描 / 迁移器顺带盖章都算违例）
function autoStampScan(history) { void history; return { stamped: 0, verdict: 'NO_AUTO_STAMP_PATH' }; }
// 架空判据 MUT-7（常驻不删）：打开期「顺手」给无戳行盖章——真判据零改历史行，MUT-7 改了历史行字节
function autoStampScanMUT7(history) { let n = 0; for (const r of history) if (r.contract_version == null) { r.contract_version = 'v3'; n += 1; } return { stamped: n, verdict: 'AUTO_STAMPED' }; }

// ============================================================ EA-6 构建期对账（异源是全部意义）

// expectSource='ledger-file' = 契约合规；'derived' = 从写点现算（R3 违例的模型 = MUT-3 家族）
function reconcile(ledgerEntries, writeSiteNames, expectSource) {
  if (expectSource !== 'ledger-file') {
    return { violations: [], sameSource: true }; // R3：合规对账器拒绝这样取期望集；此处返回「看起来一致」以暴露失明
  }
  const expect = new Set(ledgerEntries.filter(e => !e.planned).map(e => e.eventType));
  const approved = new Set(ledgerEntries.map(e => e.eventType));
  const sites = new Set(writeSiteNames);
  const v = [];
  for (const s of sites) if (!approved.has(s)) v.push({ rule: 'EVENT_RECON_ORPHAN', eventType: s });
  for (const e of ledgerEntries) if (!e.planned && !sites.has(e.eventType)) v.push({ rule: 'EVENT_RECON_STALE', eventType: e.eventType });
  return { violations: v, sameSource: false };
}
// 架空对账器 MUT-3（常驻不删）：期望集与写入码同源 ⇒ 「名单与写点一起改掉」永远自证一致（C-27/C-29）
function reconcileMUT3(_ledgerEntries, writeSiteNames) {
  const expect = new Set(writeSiteNames); // 从写点现算
  return { violations: [], sameSource: true };
}

// R4 EVENT_RECON_COUPLING 模型（契约 §6.2，父席限定①）：语义行变更 ∧ 写点模块同提交 = 红。
// 豁免（封闭表只减不增）：批准记录追加、planned 翻转、注释/排序/格式化 ⇒ ledgerSemanticDiff=false。
const LEDGER_FILE = 'g1/EVENT-CONTRACT-LEDGER.json';
const WRITE_MODULES = ['src/kernel/'];
function reconcileCoupling({ changedFiles, ledgerSemanticDiff }) {
  const touchesLedger = changedFiles.includes(LEDGER_FILE);
  const touchesWrites = changedFiles.some(f => WRITE_MODULES.some(w => f.startsWith(w)));
  return touchesLedger && touchesWrites && ledgerSemanticDiff ? 'EVENT_RECON_COUPLING' : null;
}

// ============================================================ EA-7 只报不阻计数器持久化

function persistAuditRun(history, run, phase = 'listed') { // 每次运行必落一条（EA-7.1）
  const gate = mechanismWriteGate('integrity-audit-recorded', phase);           // R-5：未入账 ⇒ 零行
  if (gate) return gate;
  const row = {
    eventType: 'integrity-audit-recorded', runId: run.runId, trigger: run.trigger,
    counts: { checked: run.checked, violations: run.violations.length, softChecked: run.softChecked, softGhosts: run.softGhosts.length },
    violationsDigest: digest(run.violations), softGhostsDigest: digest(run.softGhosts),
    schemaVersion: run.schemaVersion, ruleSetVersion: run.ruleSetVersion
  };
  history.push(row);
  return { row };
}
// 读侧遮蔽聚合落账（EA-7.2）：首次非零 或 距上次落账再满 K 次
const READ_SHADOW_K = 32; // 契约常量；改值 = 动本合同冻结面
function readShadowDecision(state, hiddenCounts, phase = 'listed') {
  const nonzero = hiddenCounts.byContractSkew > 0 || hiddenCounts.byInactiveCapability > 0;
  if (!nonzero) return { dropped: false, state };
  const firstEver = state.lastDrop === null && state.pending === 0;
  state.pending += 1;
  if (firstEver || state.pending >= READ_SHADOW_K) {
    const gate = mechanismWriteGate('read-shadow-recorded', phase);             // R-5：未入账 ⇒ 不落账
    if (gate) { state.pending -= 1; return { dropped: false, refusal: gate.refusal, state }; }
    const row = { eventType: 'read-shadow-recorded', windowEndSeq: state.seq, hidden: { ...hiddenCounts }, targetsDigest: digest(hiddenCounts.targets ?? []) };
    state.lastDrop = state.seq; state.pending = 0;
    return { dropped: true, row, state };
  }
  return { dropped: false, state };
}

// 挂载登记判据（本体归 G1-FACET-01/A1；本夹具只钉引用形状）——返回 ok/refuse
function stateRowWrite(writerCap, row, dir, mounts) {
  const owner = dir.get(row.oid);
  if (owner === undefined) return { refusal: 'NOT_FOUND_IN_SPACE' };
  if (owner !== writerCap && !mounts.has(writerCap + '|' + row.oid)) return { refusal: 'REFUSE_UNMOUNTED' };
  return { ok: true };
}

// EA-7.4 模型（R-1 修订后形态）：普通调用者可见响应面**零 `hiddenBy*` 键**——遮蔽计数的唯一
// 合法落点是内部审计通道的 read-shadow-recorded 行（裁决表 D1-d/C4；EA-7.2/7.4 更正段）。
// 审计/遮蔽事件的存在与否不经过这个函数（结构面），且三态世界（隐藏 0/1/≥2）在此逐字节同形。
const CALLER_ECHO_KEYS = [];                                    // 新形态：调用方 echo 面零遮蔽计数键
// 旧形态（已作废，仅用于 T-N11 负例与 MUT-5 的判别力自验；常驻不删）
const ECHO_SUPERSEDED_KEYS = ['hiddenByContractSkew', 'hiddenByInactiveCapability'];
function pluginVisibleResponse(world) {
  return JSON.stringify({ visibleRows: world.visibleRows, echo: Object.fromEntries(CALLER_ECHO_KEYS.map(k => [k, world.echo[k] ?? 0])) });
}
function pluginVisibleResponseSuperseded(world) { // 旧形态：把遮蔽计数摆进调用方 echo 面
  return JSON.stringify({ visibleRows: world.visibleRows, echo: Object.fromEntries(ECHO_SUPERSEDED_KEYS.map(k => [k, world.echo[k] ?? 0])) });
}
// R-1 新增判据：普通响应面不得出现任何 hiddenBy* 遮蔽计数键
const callerSurfaceFreeOfShadowCounters = (body) => !/hiddenBy[A-Z]/.test(body);
// 架空判据 MUT-5（常驻不删）：只核「响应体里不出现审计事件名字样」——即 R-1 之前 T-P7 的全部内涵；
// 真判据必须拦住旧形态泄漏体，MUT-5 必须放过同一泄漏体（否则该负例对架空无判别力）。
const callerSurfaceFreeOfShadowCountersMUT5 = (body) => !/audit-recorded|shadow-recorded|Digest/.test(body);
// 内部审计通道（有权面）：遮蔽计数在这里可回看——R-1 改的是出口，不是删除计数
const auditShadowCounts = (row) => row && row.hidden ? { ...row.hidden } : null;
// EA-5.1a 模型：对既有 ledger 行的任何 UPDATE/DELETE —— 既有触发器拒（G2-A F1 十写形实测的现状建模）
function ledgerRewriteAttempt() { return { refusal: 'TRIGGER_UPDATE_REFUSED' }; }

// ============================================================ 结构校验（S 组）：契约正文自身自洽

// —— P2-1（复审 RE-REVIEW-G1-DOMAIN）：逐等第三方位的状态探针 ——
// 第三方位 = 锚文件 g1/EVENT-CONTRACT-LEDGER.json（EA §6.1 冻结路径；§9.4 U-1 登记实施批首项，
// 当下不存在）。两态纪律：**锚缺失 ⇒ S 组只执行两方（two-party）逐等并在检查名里如实报两方，
// 禁止静默当三方绿；锚在位 ⇒ 第三方位实读比对，不一致 = 红**。自述与实际读取源的一致性由 S1c 机验。
const LEDGER_ANCHOR_PATH = join(HERE, 'EVENT-CONTRACT-LEDGER.json'); // 与 R4 模型的路径常量 LEDGER_FILE 同一文件（两处同指 §6.1 位置）
function readLedgerAnchor() {
  try { return JSON.parse(readFileSync(LEDGER_ANCHOR_PATH, 'utf8')); } catch { return null; }
}
const LEDGER_ANCHOR = readLedgerAnchor();      // null = 锚文件未物化（当下现实）
let anchorParticipated = false;                // 仅当三方分支真的执行了比对才置 true（S1c 核对）
function anchorMechanismNames(planned) {
  if (!LEDGER_ANCHOR || !Array.isArray(LEDGER_ANCHOR.entries)) return null; // 锚在位但形状不合 §6.1 ⇒ null ⇒ 判红（fail-closed）
  const names = LEDGER_ANCHOR.entries
    .filter(e => e && e.class === 'mechanism' && (e.planned === true) === planned)
    .map(e => e.eventType);
  anchorParticipated = true;
  return names;
}
const RECON_WORD = LEDGER_ANCHOR ? '三方' : '两方';
const RECON_TAG = LEDGER_ANCHOR
  ? '三方：契约 §2.4 ↔ 锚文件 EVENT-CONTRACT-LEDGER.json ↔ 夹具模型（第三方位已实读比对）'
  : '两方（two-party）：契约 §2.4 ↔ 夹具模型 —— 锚文件 EVENT-CONTRACT-LEDGER.json 未物化，第三方位缺席，禁止自称三方';
const anchorEq = (names, model) => Array.isArray(names) && names.length === model.length && names.every((n, i) => n === model[i]);

const MECH_LIST = docMechanismList();
const anchorListed = LEDGER_ANCHOR ? anchorMechanismNames(false) : null;
const s1Label = 'S1 机制封闭名单' + RECON_WORD + '逐等（' + RECON_TAG + '，成员逐一含顺序）';
check(s1Label,
  Array.isArray(MECH_LIST) && MECH_LIST.length === MODEL_MECHANISM.length && MECH_LIST.every((n, i) => n === MODEL_MECHANISM[i])
  && (LEDGER_ANCHOR ? anchorEq(anchorListed, MODEL_MECHANISM) : true),
  MECH_LIST ? MECH_LIST.join(',') : '未找到 EA-2 名单块标记');

// R-5：提案未入账块同态逐等（顺序敏感；第三方位状态同 S1），且四名一律不入运行时名单
function docPendingList() {
  const m = doc.match(/<!-- EA-2 PLANNED-PENDING-LIST-BEGIN -->([\s\S]*?)<!-- EA-2 PLANNED-PENDING-LIST-END -->/);
  if (!m) return null;
  return m[1].replace(/[「」]/g, '').split(/[·\s]+/).map(s => s.replace(/[，,]/g, '').trim())
    .filter(s => /^[a-z][a-z0-9-]*$/.test(s));
}
const PENDING_DOC = docPendingList();
const PENDING_MODEL = [...MODEL_PENDING_APPROVAL.map(p => p.eventType), ...MODEL_PLANNED.map(p => p.eventType)];
const anchorPending = LEDGER_ANCHOR ? anchorMechanismNames(true) : null;
const s1bLabel = 'S1b 提案未入账块' + RECON_WORD + '逐等（' + RECON_TAG + '，契约 §2.4 R-5 段 ↔ 夹具 PENDING 模型）';
check(s1bLabel,
  Array.isArray(PENDING_DOC) && PENDING_DOC.length === PENDING_MODEL.length && PENDING_DOC.every((n, i) => n === PENDING_MODEL[i])
  && (LEDGER_ANCHOR ? anchorEq(anchorPending, PENDING_MODEL) : true),
  PENDING_DOC ? PENDING_DOC.join(',') : '未找到 PLANNED-PENDING 块标记');

// S1c（P2-1 新增机验）：夹具自述与实际读取源一致——独立重探锚文件，与 S1/S1b 实际渲染的标签、
// 实际发生的比对行为、以及契约 §6.2 更正段的两态句在位性四方对齐；任何一环不一致 = 夹具红。
const anchorProbeNow = (() => { try { JSON.parse(readFileSync(LEDGER_ANCHOR_PATH, 'utf8')); return true; } catch { return false; } })();
const docSpaced = doc.replace(/\s+/g, ' ');
check('S1c S 组自述与实际读取源一致（P2-1：锚缺失 ⇒ 如实报两方/two-party，静默当三方绿即违例；锚在位 ⇒ 第三方位必须实际参与比对；§6.2 两态句与旧句保留一并核对）',
  anchorProbeNow === (LEDGER_ANCHOR !== null)
  && (anchorProbeNow
    ? (RECON_WORD === '三方' && s1Label.includes('三方逐等') && s1bLabel.includes('三方逐等') && anchorParticipated === true)
    : (RECON_WORD === '两方' && s1Label.includes('两方逐等') && s1bLabel.includes('两方逐等')
      && !s1Label.includes('三方逐等') && !s1bLabel.includes('三方逐等') && anchorParticipated === false))
  && docSpaced.includes('夹具 S 组结构校验 就是这三方的当场执行器')   // 旧句保留原位（不静默删）
  && docSpaced.includes('现在时断言作废')                            // 就地作废标注在位
  && docSpaced.includes('（two-party）逐等')                         // 两态句的物化前一态成文
  && docSpaced.includes('锚文件物化后')                              // 两态句的物化后一态成文
  && doc.includes('S1c'),                                            // 本机验在契约正文有据
  'mode=' + RECON_WORD + ' probeNow=' + anchorProbeNow + ' anchorParticipated=' + anchorParticipated);
check('S2 planned/未入账条目不入运行时名单（proposed 阶段仍按 unregistered），且批准落地后可入账',
  [...PENDING_MODEL, 'ns-relocated'].every(n => !MODEL_MECHANISM.includes(n) && classify(n, 'proposed').cls === 'unregistered')
  && classify('ns-relocated').cls === 'mechanism');
check('S2b R-5 批准门在写入路径上（未入账 ⇒ 装配红；且不是走 EVENT_AUTHORITY_REQUIRED 那条 B-1 违例路）',
  mechanismWriteGate('read-shadow-recorded', 'proposed').refusal.code === 'ACTIVATION_IMPOSSIBLE'
  && mechanismWriteGate('capability-enabled', 'proposed') === null);

const refLines = doc.split('\n').filter(l => /\|\s*C-\d\d\s*\|/.test(l));
const shaRe = /5ec38974fc|0369c3196c|37de107ed5|d2f19cc/;
check('S3 每条引用行齐「文件 + 规则号 + 原文短句 + SHA」四要素（C-* 表行逐行核）',
  refLines.length >= 25 && refLines.every(l => shaRe.test(l) && l.includes('「') && (l.includes('.md') || l.includes('.yaml')) && l.includes('|')),
  '表行 ' + refLines.length + ' 条');
const extSha = s => refLines.filter(l => l.includes('`' + s + '`')).length;
check('S4 三份外部契约各有实取引用（#44/#42/#47 引用行计数 > 0，无「未取得」）',
  extSha('5ec38974fc') >= 4 && extSha('0369c3196c') >= 3 && extSha('37de107ed5') >= 3 && !doc.includes('未取得：C-'),
  ['#44=' + extSha('5ec38974fc'), '#42=' + extSha('0369c3196c'), '#47=' + extSha('37de107ed5')].join(' '));

// —— S3b（复审 P2-3 新增机验）：带引号的 #44 引句逐字保真——「引用四要素」里的原文短句必须
// **等于 `git show 5ec38974fc:…` 的 blob 抽取结果**（期望值取自 blob，不手打，非自证）。
// 做不到的整段（含「……」节略或内层引号改写）如实登记进 VERBATIM_UNCOVERED_44（各带理由）；
// 自述=实际覆盖：新非逐字片段未登记、或登记的片段已成孤儿 ⇒ 红；blob 取不到 ⇒ 红（fail-closed，
// 不许按「未验证」绿放行）。最低覆盖义务：被修行（P2-3，§9.3 OA-3 行）与 blob L223 抽取短语逐字相等。
const BLOB44_SPEC = '5ec38974fc:docs/architecture/V3_CODE_ARCHITECTURE_DRAFT.md';
let blob44 = null;
try { blob44 = execFileSync('git', ['show', BLOB44_SPEC], { cwd: HERE, encoding: 'utf8', maxBuffer: 1 << 24 }); } catch { blob44 = null; }
const c44Lines = refLines.filter(l => l.includes('`5ec38974fc`'));
const c44Frags = c44Lines.flatMap(l => [...l.matchAll(/「([^」]+)」/g)].map(m => m[1]));
// 诚实未覆盖清单（当下如实两条；相关条文日后逐字改正 ⇒ 删除此处登记，覆盖面只增不减）
const VERBATIM_UNCOVERED_44 = new Map([
  ['禁止『领域事件表一份、Ledger 另一份，两者均声明为真实事件历史』',
    'C-03（EA:40）第二片段：内层嵌套引号写作『』而 blob 原文为弯引号“”，整段非逐字（语义不翻转；逐字化属契约责任席的后续文书动作，不在本轮 P2-3 修行范围）'],
  ['有空间写权、缺少正式科研接纳授权的主体可保存**未生效声明**……**无空间写权则完全拒绝写入**（RD-27、PR-A1）',
    'C-05（EA:42）：「……」压缩了 blob L238 中段「但不能使 FactStanding 改变」，整段不等（节略各段各自逐字，整段逐字不可成立 ⇒ 登记未覆盖）'],
]);
const l223 = blob44 === null ? '' : (blob44.split('\n')[222] ?? '');
const m223 = l223.match(/绑定所属存储，([^，|]+?)\s*\|/);          // 短语由 blob 结构锚点抽出（单元格去空白后逐字）
const blobPhrase223 = m223 ? m223[1].trim() : null;
const oa3Line = doc.split('\n').find(l => l.includes('OA-3 把')) ?? '';
const oa3Quote = (oa3Line.match(/「([^」]+)」/) ?? [])[1] ?? null;
check('S3b 带引号 #44 引句逐字保真（P2-3：C-* 行片段=git blob 抽取结果逐字子串；§9.3 OA-3 行与 blob L223 抽取短语完全相等；未覆盖如实登记、覆盖漂移=红、blob 不可得=红）',
  blob44 !== null && blobPhrase223 !== null && oa3Quote !== null && oa3Quote === blobPhrase223
  && c44Frags.length >= 6
  && c44Frags.every(f => VERBATIM_UNCOVERED_44.has(f) || blob44.includes(f))
  && [...c44Frags].filter(f => VERBATIM_UNCOVERED_44.has(f)).length === VERBATIM_UNCOVERED_44.size
  && [...VERBATIM_UNCOVERED_44.values()].every(r => r.length > 10)
  && c44Frags.some(f => !VERBATIM_UNCOVERED_44.has(f)),
  'blob获取=' + (blob44 !== null) + ' 片段=' + c44Frags.length + ' 已登记未覆盖=' + VERBATIM_UNCOVERED_44.size
  + ' OA-3引句=' + JSON.stringify(oa3Quote) + ' L223抽取=' + JSON.stringify(blobPhrase223));

const tokensIn = (text) => new Set((text.match(/`[A-Z][A-Z0-9_]{2,}(?:_[A-Z0-9]+)*`/g) ?? []).map(s => s.slice(1, -1)));
const CLOSED_CODES = new Set((readFileSync(REFUSAL_CODES_PATH, 'utf8').match(/'([A-Z][A-Z0-9_]{2,})'/g) ?? []).map(s => s.slice(1, -1)));
const NON_REFUSAL_OK = new Set(['EVENT_RECON_ORPHAN', 'EVENT_RECON_STALE', 'EVENT_RECON_SAMESOURCE', 'EVENT_RECON_COUPLING',
  'UNVERIFIABLE_LEGACY', 'VERIFIED', 'INCONSISTENT', 'REFUSE_UNMOUNTED', 'AMBIGUOUS_AUTHORITY',
  'NOT_FOUND_IN_SPACE', 'CAPABILITY_INACTIVE', 'ACTIVATION_IMPOSSIBLE', 'NO_REFUSAL', 'AUTHORITY_UNVERIFIED',
  'OPEN_DESIGN_QUESTIONS', 'FROZEN_DOCS', 'MECHANISM_RESOURCES', 'MECHANISM_AUDIT_EVENT_TYPES', 'REQUIRED_TRIGGERS',
  'ROUTED', 'ROUTE_AUDIT_REQUIRED', 'GATE_FULL_SHAPE', 'OA_1', 'OBJECT_REF', 'REVISION_REF', 'AUTHORITY_BASIS', 'KERNEL_PORT',
  'SCHEMA_VERSION', 'UNINTERPRETED_FAIL_CLOSED', 'TRIGGER_UPDATE_REFUSED']);
const badTokens = [...tokensIn(doc)].filter(t => !(CLOSED_CODES.has(t) || NON_REFUSAL_OK.has(t)));
check('S5 契约内出现的全大写码全部落在封闭拒绝码集 ∪ 声明的构建期/存储层信号（无自造运行时码）',
  badTokens.length === 0, badTokens.join(','));

const casesInDoc = [...doc.slice(doc.indexOf('## 8. EA-8'), doc.indexOf('## 9. EA-9')).matchAll(/\|\s*(T-[PN]\d{1,2})\s*\|/g)].map(m => m[1]);
const caseIds = [...SELF_SRC.matchAll(/^function run_T_([PN]\d{1,2})\(/gm)].map(m => 'T-' + m[1]);
check('S6 正反例表与夹具双向一致（表内每个 id 都有 run_*，无孤儿实现）',
  casesInDoc.length === 23 && casesInDoc.every(id => caseIds.includes(id)) && caseIds.length === casesInDoc.length,
  'doc=' + casesInDoc.length + ' fn=' + caseIds.length);

const docCollapsed = doc.replace(/\s+/g, ' ');
check('S7 EA-4.3 入参字段集与夹具模型逐字对账（「不得自带见证」是结构性质）',
  docCollapsed.includes(EA43_INPUT_FIELDS.join('; ')) && doc.includes('actor/authority_basis/ruleSetVersion/contractVersion'),
  EA43_INPUT_FIELDS.join(';'));

check('S8 历史节覆盖两个存量名 + 「不重写 Ledger」机验句在位',
  /EA-5/.test(doc) && doc.includes('object-revised') && doc.includes('record-backfilled')
  && doc.includes('不允许为统一命名重写既有 History Ledger') && doc.includes('别名映射'));

check('S9 反自证判据 R3 在正文（对账器不得从写点模块取期望集）',
  doc.includes('EVENT_RECON_SAMESOURCE') && doc.includes('禁止从') && doc.includes('g1/EVENT-CONTRACT-LEDGER.json'));

// —— 2026-11-01 跨契约对账（R-1/R-2/R-5/R-6）留痕机验：旧句保留 + 更正段在位 + 两侧互指 ——
const FM_DOC_PATH = join(HERE, 'G1-CONTRACT-FACET.md');
const FM_FIX_PATH = join(HERE, 'G1-CONTRACT-FACET.fixtures.mjs');
const RL_DOC_PATH = join(HERE, 'G1-CONTRACT-RELOCATION.md');
const RECON_DOC_PATH = join(HERE, 'G1-CONTRACT-RECONCILIATION.md');   // R-7 在位性核对（S19）
const ADJ_DOC_PATH = join(HERE, 'G1-ADJUDICATION-TABLE.md');          // D5-a 行复制扫描（S19，只读）
const CONTRACTS_DOC_PATH = join(HERE, '..', 'CONTRACTS.md');          // 打开面小节回填形态核对（S19，只读）
const readOpt = (pth) => { try { return readFileSync(pth, 'utf8'); } catch { return ''; } };
const fmDoc = readOpt(FM_DOC_PATH), fmFix = readOpt(FM_FIX_PATH), rlDoc = readOpt(RL_DOC_PATH);
const reconDoc = readOpt(RECON_DOC_PATH), adjDoc = readOpt(ADJ_DOC_PATH), contractsDoc = readOpt(CONTRACTS_DOC_PATH);

check('S15 R-1 留痕：正文含「R-1 更正段」+ 旧句原文保留（不静默覆盖）+ 新形态句「零 hiddenBy* 键」在位',
  [...doc.matchAll(/R-1 更正段/g)].length >= 2
  && doc.includes('既有 `hiddenByContractSkew` 等 echo 键')          // 旧句仍在原位
  && doc.includes('计数照旧进读回执')                                // 被取代的旧句仍在原位
  && doc.includes('调用方 echo 面**不含任何 `hiddenBy*` 键**')
  && doc.includes('改的是出口'));

check('S16 R-2 两侧互指：本契约点名 FM-7/FM-9 为 ③ 的挂载方 + FM 侧登记 DEP-EA45-3 显式依赖（任一侧单独回滚即红）',
  doc.includes('R-2 修订段') && doc.includes('FM-7 轴值段与 FM-11.2 关系表')
  && doc.includes('覆盖式谓词，不点名轴名也不点名事件名')
  && fmDoc.includes('DEP-EA45-3') && fmDoc.includes('EA-4.5 ③ 支')
  && /function gateFullShapeSuperseded2Branch\(/.test(readFileSync(SELF_PATH, 'utf8')));

check('S17 R-5 无自授批准：全文零处未标注取代的「本契约即批准」类句；提案名各有 gated_by；批准门在正文成文',
  [...doc.matchAll(/(本契约|本合同)(即|=|＝)批准/g)]
    .every(m => doc.slice(Math.max(0, m.index - 400), m.index + 400).includes('旧作')
      || doc.slice(Math.max(0, m.index - 400), m.index + 400).includes('更正')),
  '未标注取代的自授批准句残留')
  ;
check('S17b 提案块逐名有 gated_by（四个提案名各有门控锚），且正文声明「批准主体唯一 = 人工 Approved-By」',
  MODEL_PENDING_APPROVAL.every(x => doc.includes(x.gated_by)) && MODEL_PLANNED.every(x => doc.includes(x.gated_by))
  && doc.includes('PLANNED-PENDING-LIST-BEGIN') && doc.includes('Approved-By')
  && doc.includes('判据≠批准'));

check('S18 R-6 收口句在位（EA 侧成文 + RL 侧同半句，两侧各补一次）',
  doc.includes('绝不自动补戳') && doc.includes('呈现档') && doc.includes('改写历史语义')
  && (rlDoc === '' || (rlDoc.includes('绝不自动补戳') && rlDoc.includes('呈现档'))));

// S19（复审 P2-2 / 台账 R-7 的当机护栏）：D5-a「唯一责任者」文书正所 = RL-4，他处只允许指针引用。
// 全自动判据 J 由 G2 PR-0 承接（R-7 §10-3 待办）；本机验是 R-7 明文指定的当机形态，扫四种形态：
// ①R-7 裁决不在位/被删；②正所消失（RL-4 不再含十二门本体）；③受检住所长出「复制清单正文」形态
// （distinct 门名命中 ≥ 10）；④CONTRACTS.md 打开面小节一旦回填却非指针形（无 RL-4 锚，或命中 ≥ 10）。
// 门名集现场从 RL-4 正文抽取（编号行「N. GATE_NAME …」）——**不在本夹具手打门名清单**
// （R-7 红线：手打即自证，且扫描器自己成第二正源）。
const rl4Section = (() => {
  const i = rlDoc.indexOf('## 4. RL-4');
  if (i < 0) return '';
  const j = rlDoc.slice(i + 1).search(/^## /m);
  return j < 0 ? rlDoc.slice(i) : rlDoc.slice(i, i + 1 + j);
})();
const gateNamesFromRl4 = [...new Set([...rl4Section.matchAll(/^\s*「?\s*\d{1,2}\.\s*([A-Z][A-Z_]{3,})\b/gm)].map(m => m[1]))];
const distinctGateHits = (text) => gateNamesFromRl4.filter(n => new RegExp('\\b' + n + '\\b').test(text)).length;
// D5-a 行定位用前缀式（行首「| D5-a」）——若判据只认「| D5-a |」整格形，篡改者往格里加内容
// 反而会让行脱离检测（负例实测过的洞）；复制扫描按 ADJ **全文**做（≥10 命中=复制，指针形天然 ≪10）。
const d5aRow = (adjDoc.split('\n').find(l => /^\|\s*D5-a\b/.test(l)) ?? null);
const contractsOpenSec = (() => { // 「打开面」小节：标题行整行起算，取到下一个任意级标题；不存在 ⇒ null（回填是未来动作，不判红）
  const i = contractsDoc.search(/^#{1,4}[^\n]*打开面/m);
  if (i < 0) return null;
  const nl = contractsDoc.indexOf('\n', i);
  const body = contractsDoc.slice(nl + 1);
  const j = body.search(/^#{1,4}\s/m);
  return j < 0 ? contractsDoc.slice(i) : contractsDoc.slice(i, nl + 1 + j);
})();
check('S19 R-7 唯一正所护栏（P2-2）：R-7 裁决在位（唯一正所=RL-4 + 只允许指针引用 + PR-0 待办）∧ RL-4 十二门正所存在（门名现场抽取 ≥10）∧ ADJ 全文（含 D5-a 行）无清单复制（门名命中 < 10）∧ CONTRACTS.md 打开面小节若已回填则必须指针形（含 RL-4 锚且命中 < 10）',
  reconDoc.includes('R-7') && reconDoc.includes('唯一正所') && reconDoc.includes('只允许指针引用')
  && reconDoc.includes('复制即第二正源') && reconDoc.includes('PR-0')
  && rl4Section.length > 0 && gateNamesFromRl4.length >= 10
  && distinctGateHits(adjDoc) < 10
  && (contractsOpenSec === null || (contractsOpenSec.includes('RL-4') && distinctGateHits(contractsOpenSec) < 10)),
  '门名集=' + gateNamesFromRl4.length + ' ADJ全文命中=' + distinctGateHits(adjDoc) + ' D5a行在位=' + (d5aRow !== null)
  + ' 打开面小节=' + (contractsOpenSec === null ? '未回填' : distinctGateHits(contractsOpenSec) + ' 命中/RL-4锚=' + contractsOpenSec.includes('RL-4')));

check('S10 本夹具保留七条架空判据（变异常驻不删除；R-1/R-2/R-5/R-6 各配一条）',
  ['classifyMUT2', 'gateFullShapeMUT1', 'reconcileMUT3', 'gateFullShapeMUT4', 'callerSurfaceFreeOfShadowCountersMUT5',
    'mechanismWriteGateMUT6', 'autoStampScanMUT7']
    .every(fn => new RegExp('function ' + fn + '\\(|const ' + fn + ' =').test(readFileSync(SELF_PATH, 'utf8'))));

// —— 父席四条限定（§9.5）的正文在位与同步校验 ——
check('S11 declaredType 形状正则：契约两处引用与夹具实现逐字同步（EA-1.3a）',
  (doc.match(new RegExp(DECL_TYPE_RE_SRC.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length >= 2);
check('S12 限定② 正文在位：EA-5.1a 合一判据 + 「不允许为统一命名重写既有 History Ledger」+ 两旧名各有解释器版本行',
  doc.includes('EA-5.1a') && doc.includes('不允许为统一命名重写既有 History Ledger')
  && /object-revised[^\n]*revise 解释器/.test(doc) && /record-backfilled[^\n]*迁移器解释器/.test(doc));
check('S13 限定③ 正文在位：三不参与逐词（授权判定/路由/索引键）+ 畸变仍收',
  doc.includes('不参与任何授权判定') && doc.includes('不参与路由') && doc.includes('不进索引键') && doc.includes("PARSE_FAILED"));
check('S14 限定①④ 正文在位：R4 EVENT_RECON_COUPLING + 批准三要素；EA-7.4 非 oracle（内部审计通道/响应面零差分/唯一暴露通道）',
  doc.includes('EVENT_RECON_COUPLING') && doc.includes('批准三要素')
  && doc.includes('只进内部审计通道') && doc.includes('响应面零差分') && doc.includes('已裁决的运维授权路径'));

// ============================================================ 表驱动正反例（与 §8 表逐一对应）

const PRIN = { actorId: 'user:lin', spaceWrite: true, businessAxes: ['calibration-write', 'usecase-run'] };        // 无 domain-admission
const PRIN_OK = { actorId: 'user:wu', spaceWrite: true, businessAxes: ['domain-admission', 'usecase-run'] };
const PRIN_NOWRITE = { actorId: 'user:guest', spaceWrite: false, businessAxes: [] };
const FROZEN = { ruleSets: ['r1'], contractVersions: ['v3'] };
const dir = new Map([['O-core', 'cap-records'], ['O-other', 'cap-instrument']]);
const mounts = new Set(['cap-calibration|O-core']); // 合法挂载登记（G1-FACET-01 的 A1 形态引用位）
const OPTS_OK = { principal: PRIN_OK, txSeq: 101, nowMs: 1730000000000, ruleSetVersion: 'r1', contractVersion: 'v3' };
const OPTS_NOAUTH = { principal: PRIN, txSeq: 102, nowMs: 1730000000001, ruleSetVersion: 'r1', contractVersion: 'v3' };

const EVENT = 'synth:fact-designation';

function run_T_P1() { // 跨 Capability 合法领域事件（对象归属 ≠ 事件类型归属）
  const r = domainWrite('cap-records', { eventType: EVENT, objectId: 'O-other', revision: 3, payload: { note: 'adopt' } }, OPTS_OK);
  if (r.refusal) return '被拒：' + JSON.stringify(r.refusal.detail);
  if (!gateFullShape(r.row)) return '全形闸未过';
  if (replayAuthorityEvidence(r.row, FROZEN) !== 'VERIFIED') return '审计复算非 VERIFIED';
  return true;
}
function run_T_P2() { // 合法 Facet 挂载（Q45 护栏同形）
  const r = stateRowWrite('cap-calibration', { oid: 'O-core', revision: 1 }, dir, mounts);
  return r.ok ? true : '被拒：' + r.refusal;
}
function run_T_P3() { // Raw Intake 未识别材料仍收（+ EA-1.3a 形状卫生与三不参与）
  const before = classifyCalls;
  const r = declareRawIntake(PRIN, { recordId: 'REC-1', declaredType: 'zzz:unknown/v9', origin: { sourceRef: 'lab-notebook-7', medium: 'text', capturedAtMs: 1 }, body: '乱码原文 bytes…' });
  if (r.refusal) return '被拒：' + JSON.stringify(r.refusal);
  if (r.row.event_type !== RAW_FIXED_EVENT) return '台账名不是固定名';
  if (r.row.payload.bodyRetained !== '乱码原文 bytes…') return '原文未逐字节留存';
  if (r.row.payload.declaredType !== 'zzz:unknown/v9') return '合法形状的类型标签被丢';
  const over = declareRawIntake(PRIN, { recordId: 'REC-2', declaredType: 'x'.repeat(200), body: '原文照存' });
  if (over.refusal) return '超限 declaredType 被整封拒收（B-1 翻转）';
  if (over.row.payload.declaredType !== null || over.row.payload.intakeNotes?.parseAttempt !== 'PARSE_FAILED') return '超限未按 PARSE_FAILED 处置';
  if (over.row.payload.bodyRetained !== '原文照存') return '畸变时原文未照存';
  const bad = declareRawIntake(PRIN, { recordId: 'REC-3', declaredType: '❤ 含空白', body: 'b' });
  if (bad.refusal || bad.row.payload.declaredType !== null) return '字符集外未走 PARSE_FAILED 仍收路径';
  if (classifyCalls !== before) return 'Raw 路径调用了分类器（三不参与违例）';
  return true;
}
function run_T_P4() { // 有写权无业务轴 ⇒ 未生效声明（收存不投影）
  const r = domainWrite('cap-records', { eventType: EVENT, objectId: 'O-core', revision: 1, payload: { note: 'adopt?' } }, OPTS_NOAUTH);
  if (r.refusal) return '被拒：' + JSON.stringify(r.refusal.detail);
  if (r.row.authority_basis.authorized !== false) return 'authorized 应为 false';
  if (countsInProjection(r.row)) return '未生效声明被投影计入';
  if (replayAuthorityEvidence(r.row, FROZEN) !== 'VERIFIED') return '未生效行仍应可复算（有权=机制事实，authorized=false 也是）';
  return true;
}
function run_T_P5() { // 审计持久化：同数不同集可分（F-G6A-5 的解）
  const hist = [];
  const a = persistAuditRun(hist, { runId: 'a', trigger: 'open', checked: 20, violations: [], softChecked: 10, softGhosts: ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'], schemaVersion: 7, ruleSetVersion: 'r1' });
  const b = persistAuditRun(hist, { runId: 'b', trigger: 'audit-call', checked: 20, violations: [], softChecked: 10, softGhosts: ['e7', 'e8', 'e2', 'e3', 'e4', 'e5'], schemaVersion: 7, ruleSetVersion: 'r1' });
  if (hist.length !== 2) return '两次运行未各落一条';
  if (a.row.softGhostsDigest === b.row.softGhostsDigest) return '同数不同集 digest 相同（淹没能复现）';
  if (a.row.counts.softGhosts !== 6 || b.row.counts.softGhosts !== 6) return '计数语义被改动';
  const st = { lastDrop: null, pending: 0, seq: 1 };
  const d1 = readShadowDecision(st, { byContractSkew: 1, byInactiveCapability: 0, targets: ['x'] });
  if (!d1.dropped) return '首次非零未落账';
  let droppedTwice = false;
  for (let i = 0; i < READ_SHADOW_K; i += 1) if (readShadowDecision(st, { byContractSkew: 6, byInactiveCapability: 0, targets: Array.from({ length: 6 }, (_, j) => 'y' + j) }).dropped) droppedTwice = true;
  if (!droppedTwice) return 'K 窗口后未再落账';
  return true;
}
function run_T_P6() { // 旧名历史行读不变 + 新写切换 + 「为归类重写 Ledger」不存在（EA-5.1a 三面）
  const legacy = { event_type: 'object-revised', version: 'r0', actor: null, authority_basis: null };
  if (interpretLegacyRow(legacy) !== LEGACY_TABLE['object-revised'].r0) return '历史解释改变';
  if (replayAuthorityEvidence(legacy, FROZEN) !== 'UNVERIFIABLE_LEGACY') return '无信封历史行必须 UNVERIFIABLE_LEGACY（不追认有权）';
  const mint = genericAppend('object-revised', 'appendLedger');
  if (!mint) return '切换后旧名仍可经通用通道 mint';
  if (interpretLegacyRow({ event_type: 'no-such-name', version: 'r9' }) !== 'UNINTERPRETED_FAIL_CLOSED') return '未知版本未 fail-closed';
  if (ledgerRewriteAttempt().refusal !== 'TRIGGER_UPDATE_REFUSED') return '对历史行的改写没有被触发器拒（EA-5.1a 违宪面无拦截）';
  const backfill = interpretLegacyRow({ event_type: 'record-backfilled', version: 'r1' });
  if (!backfill.includes('回填事实')) return 'record-backfilled 解释未含「永久携带回填事实」义务（B.7）';
  return true;
}
function run_T_P7() { // 非 oracle（EA-7.4，R-1 修订后）：落账不扩对外信息面 ∧ 遮蔽计数退出调用方 echo
  const world = { visibleRows: 4, echo: { hiddenByContractSkew: 6 } }; // world 里仍有计数（内部态）
  const before = pluginVisibleResponse(world);
  const auditCh = [];
  persistAuditRun(auditCh, { runId: 'r', trigger: 'audit-call', checked: 9, violations: [], softChecked: 4, softGhosts: ['a', 'b', 'c', 'd'], schemaVersion: 7, ruleSetVersion: 'r1' });
  const st = { lastDrop: null, pending: 0, seq: 7 };
  const drop = readShadowDecision(st, { byContractSkew: 6, byInactiveCapability: 2, targets: ['t1', 't2'] });
  if (!drop.dropped) return '遮蔽未落账';
  auditCh.push(drop.row);
  const after = pluginVisibleResponse(world);
  if (after !== before) return '普通调用者响应面被落账改变（oracle 违例）：' + before + ' vs ' + after;
  if (auditCh.length !== 2) return '内部审计通道行数未 +2';
  if (/audit-recorded|shadow/.test(after)) return '对外响应混入审计事件名';
  if (callerSurfaceFreeOfShadowCounters(after) !== true) return '调用方 echo 面仍有 hiddenBy* 键（R-1 未落实）';
  if (after.includes('"hiddenByContractSkew"')) return '旧形态 echo 键未撤（R-1 未落实）';
  // 计数没被删，只是换了出口：内部审计行里逐字可回看
  const counts = auditShadowCounts(auditCh[1]);
  if (!counts || counts.byContractSkew !== 6 || counts.byInactiveCapability !== 2) return '遮蔽计数未在审计行里可回看：' + JSON.stringify(counts);
  // D1-d 的三态同形：隐藏 0 / 1 / ≥2 件在调用方处逐字节等
  const s0 = pluginVisibleResponse({ visibleRows: 4, echo: {} });
  const s1 = pluginVisibleResponse({ visibleRows: 4, echo: { hiddenByContractSkew: 1 } });
  const s9 = pluginVisibleResponse({ visibleRows: 4, echo: { hiddenByContractSkew: 6, hiddenByInactiveCapability: 3 } });
  if (!(s0 === s1 && s1 === s9)) return '隐藏 0/1/≥2 三态在调用方处不同形（可差分 oracle）';
  return true;
}
function run_T_N1() { // 无挂载伪造修订
  const r = stateRowWrite('cap-calibration', { oid: 'O-other', revision: 9 }, dir, new Set());
  return r.refusal === 'REFUSE_UNMOUNTED' ? true : '未被拒：' + JSON.stringify(r);
}
function run_T_N2() { // 自带见证（字段还全对）必拒
  const bad = domainWrite('cap-records', { eventType: EVENT, objectId: 'O-core', revision: 1, payload: {}, actor: 'user:wu', authority_basis: { axis: 'domain-admission', authorized: true } }, OPTS_OK);
  if (!bad.refusal) return '自带见证未被拒';
  if (bad.refusal.detail.reason !== 'input-carries-witness-field') return '拒绝原因错：' + bad.refusal.detail.reason;
  if (JSON.stringify(bad.refusal.detail.extraFields) !== JSON.stringify(['actor', 'authority_basis'])) return '越权字段集错';
  return true;
}
function run_T_N3() { // 名单外机制名 mint
  const r = genericAppend('capability-reloaded', 'appendLedger');
  if (!r) return '未拒';
  if (r.detail.classification !== 'unregistered') return 'classification=' + r.detail.classification;
  const r2 = genericAppend('record-backfilled', 'write'); // 存量名同样默认预留（不再是巧合无洞）
  if (!r2 || r2.detail.classification !== 'mechanism') return '存量机制名未落预留：' + JSON.stringify(r2);
  return true;
}
function run_T_N4() { // 名单内机制名 mint（D-27 五名之一）
  const r = genericAppend('object-registered', 'appendLedger');
  return r && r.detail.classification === 'mechanism' ? true : '未拒或分类错';
}
function run_T_N5() { // 信封 actor ≠ 行 actor ⇒ INCONSISTENT；且「只核非空」必须放过它（判别力自验）
  const forged = { event_type: EVENT, actor: 'user:wu', authority_basis: { ...issueAuthorizationContext({ ...OPTS_OK, capability: 'cap-records', entry: OWNERSHIP.get(EVENT) }), actor: 'user:attacker' } };
  if (replayAuthorityEvidence(forged, FROZEN) !== 'INCONSISTENT') return '全形判据未拦（不该发生）';
  if (gateFullShapeMUT1(forged) !== true) return 'MUT-1 竟能拦住——判据表对架空失去判别力（自验失败）';
  return true;
}
function run_T_N6() { // 双认领装配红
  const r = assembleOwnership([{ eventType: EVENT, owner: 'cap-records' }, { eventType: EVENT, owner: 'cap-instrument' }]);
  return r.error === 'AMBIGUOUS_AUTHORITY' && r.rule.includes('OA-1') ? true : '未拦：' + JSON.stringify(r);
}
function run_T_N7() { // manifest 认领机制名 / Raw 固定名
  const r = assembleOwnership([{ eventType: 'capability-transferred', owner: 'cap-x' }]);
  const r2 = assembleOwnership([{ eventType: RAW_FIXED_EVENT, owner: 'cap-x' }]);
  return r.error === 'AMBIGUOUS_AUTHORITY' && r2.error === 'AMBIGUOUS_AUTHORITY' ? true : '未拦';
}
function run_T_N8() { // 越界误用：预留闸接到 Raw 通道 = 契约违例（机验 C-28 句）
  const wrong = declareRawIntakeVIOLATING(PRIN, { recordId: 'R', declaredType: 'synth:fact-designation', body: 'x' });
  if (!wrong.refusal || wrong.refusal.code !== 'EVENT_AUTHORITY_REQUIRED') return '违例形态未复现（夹具失效）';
  const right = declareRawIntake(PRIN, { recordId: 'R', declaredType: 'synth:fact-designation', body: 'x' }); // 正确路径：declaredType 只是数据
  if (right.refusal) return '正确路径被拒（B-1 违例）';
  const nr = declareRawIntake(PRIN_NOWRITE, { recordId: 'R', declaredType: 'any', body: 'x' });
  if (!nr.refusal || nr.refusal.code !== 'AUTHORITY_REQUIRED') return 'B-4 必须走空间写权既有路径而非预留闸';
  return true;
}
function run_T_N9() { // 删定义洗白：异源对账点名、同源对账失明（C-27/C-29 的机验化）
  const ledger = MODEL_MECHANISM.map(n => ({ eventType: n, class: 'mechanism', planned: false }));
  const launderedLedger = ledger.filter(e => e.eventType !== 'record-backfilled');          // 名单删定义
  const launderedSites = MODEL_MECHANISM.filter(n => n !== 'record-backfilled');            // 写点同步删
  const honest = reconcile(launderedLedger, [...launderedSites, 'capability-reloaded'], 'ledger-file');
  if (!honest.violations.some(v => v.rule === 'EVENT_RECON_ORPHAN' && v.eventType === 'capability-reloaded')) return 'R1 未点名名单外写点';
  const orphanName = reconcile([...ledger, { eventType: 'ghost-approved', class: 'mechanism', planned: false }], MODEL_MECHANISM, 'ledger-file');
  if (!orphanName.violations.some(v => v.rule === 'EVENT_RECON_STALE')) return 'R2 未点名僵尸名单项';
  const blind = reconcileMUT3(launderedLedger, launderedSites);
  if (blind.violations.length !== 0) return 'MUT-3 竟能点名——判据表对同源架空失去判别力';
  return true;
}
function run_T_N10() { // R4：名单语义行与写码同提交 = 红；分开提交 / 纯豁免变更 = 放行
  if (reconcileCoupling({ changedFiles: [LEDGER_FILE, 'src/kernel/kernel.ts'], ledgerSemanticDiff: true }) !== 'EVENT_RECON_COUPLING') return '耦合提交未红';
  if (reconcileCoupling({ changedFiles: [LEDGER_FILE], ledgerSemanticDiff: true }) !== null) return '独立名单提交被误拦';
  if (reconcileCoupling({ changedFiles: ['src/kernel/kernel.ts'], ledgerSemanticDiff: false }) !== null) return '独立写码提交被误拦';
  if (reconcileCoupling({ changedFiles: [LEDGER_FILE, 'src/kernel/kernel.ts'], ledgerSemanticDiff: false }) !== null) return '豁免变更（追加批准记录/planned 翻转）被误拦';
  return true;
}

function run_T_P8() { // R-2 三分全形闸：②③ 各命中 + 旧两类别式的判别力 + ③ 的覆盖性自验
  const route = mechAuditRow('ns-relocated', 'capability-admin');
  const mount = mechAuditRow('facet-mounted', 'facet-mount');
  if (gateFullShape(route) !== true) return '② 路由/运维审计支未放行';
  if (gateFullShape(mount) !== true) return '③ 机制挂载类审计支未放行（R-2 未落实）';
  if (gateFullShapeSuperseded2Branch(mount) !== false) return '旧二类别式竟能放行挂载行——三分修订无必要（夹具失效）';
  if (gateFullShape(mechAuditRow('read-shadow-recorded', 'capability-admin', { authorized: false })) !== false) return '②③ 未强制 authorized=1';
  // 覆盖性自验：新机制轴 + 新机制名入账 ⇒ 判据一字不改即覆盖（回头堆名单就是违例）
  MECHANISM_AXES.add('quarantine-op'); MECHANISM_AXIS_OF['quarantine-executed'] = 'quarantine-op'; PHASES.listed.add('quarantine-executed');
  let covered = false;
  try { covered = gateFullShape(mechAuditRow('quarantine-executed', 'quarantine-op')) === true; }
  finally { MECHANISM_AXES.delete('quarantine-op'); delete MECHANISM_AXIS_OF['quarantine-executed']; PHASES.listed.delete('quarantine-executed'); }
  if (!covered) return '③ 不是覆盖式谓词：新机制轴/新名入账后必须改判据 = 违例';
  return true;
}
function run_T_P9() { // R-6 正例：修补是显式运维动作——只追加、只调呈现档、可回看、无自动补戳路径
  const history = [{ seq: 11, event_type: 'object-revised', contract_version: null, payload_json: '{}' }];
  const patchLog = [];
  const before = JSON.stringify(history);
  if (presentationTierOf(patchLog, history[0]) !== 'pre-cutover-default') return '无戳行未走「切换前」缺省档';
  const noMarker = patchContractVersionPresentation(patchLog, history[0], { rowSeq: 11, presentationTier: 'v3', humanMarker: '', atSeq: 40 });
  if (noMarker.refusal !== 'PATCH_REQUIRES_HUMAN_MARKER') return '无人工标记的修补被放行';
  if (patchLog.length !== 0) return '无标记修补仍落了行';
  const ok = patchContractVersionPresentation(patchLog, history[0], { rowSeq: 11, presentationTier: 'v3', humanMarker: 'Approved-By: 2026-11-01 user:wu', atSeq: 41 });
  if (!ok.ok) return '显式修补被拒：' + ok.refusal;
  if (ok.presentationTier !== 'patched@seq41') return '呈现档未按修补行调整：' + ok.presentationTier;
  if (JSON.stringify(history) !== before) return '修补改了历史行（应只追加、零 UPDATE）';
  if (patchLog[0].marker !== 'Approved-By: 2026-11-01 user:wu') return '修补行不可回看（缺人工标记）';
  const auto = autoStampScan(history);
  if (auto.stamped !== 0 || JSON.stringify(history) !== before) return '机制侧存在自动补戳路径（R-6 违例）';
  return true;
}
function run_T_N11() { // R-1 负例：普通响应面出现 hiddenBy* ⇒ 判红（旧形态 echo 键集就是违例）
  const leak = pluginVisibleResponseSuperseded({ visibleRows: 4, echo: { hiddenByContractSkew: 6, hiddenByInactiveCapability: 1 } });
  if (!/hiddenBy/.test(leak)) return '负例构造失效（旧形态未含 hiddenBy 键）';
  if (callerSurfaceFreeOfShadowCounters(leak) !== false) return '泄漏体未被判据点名';
  const good = pluginVisibleResponse({ visibleRows: 4, echo: { hiddenByContractSkew: 6 } });
  if (callerSurfaceFreeOfShadowCounters(good) !== true) return '新形态被误判';
  if (callerSurfaceFreeOfShadowCountersMUT5(leak) !== true) return 'MUT-5 竟能点名——判据对架空失去判别力';
  return true;
}
function run_T_N12() { // R-2 负例：机制名串到别的机制轴 / 名单外名带机制轴 / 领域事件冒充机制审计轴
  if (gateFullShape(mechAuditRow('facet-mounted', 'capability-admin')) !== false) return '挂载名串用路由轴未被拦';
  if (gateFullShapeMUT4(mechAuditRow('facet-mounted', 'capability-admin')) !== true) return 'MUT-4 竟能拦住——③ 的架空形失去判别力';
  if (gateFullShape(mechAuditRow('facet-remounted', 'facet-mount')) !== false) return '机制封闭名单外的名带机制轴被放行';
  const dom = domainWrite('cap-records', { eventType: EVENT, objectId: 'O-core', revision: 1, payload: {} }, OPTS_OK);
  if (dom.refusal) return '正例构造失效：' + JSON.stringify(dom.refusal.detail);
  if (gateFullShape({ ...dom.row, authority_basis: { ...dom.row.authority_basis, axis: 'capability-admin' } }) !== false) return '领域事件冒充机制审计轴被放行（① 失守）';
  return true;
}
function run_T_N13() { // R-5 负例：无 Approved-By ⇒ 该名字不可入账、机制直写装配红；标记落地后同调用成功
  const name = 'read-shadow-recorded';
  if (classify(name, 'proposed').cls !== 'unregistered') return '未入账名被分类为 mechanism（提案名冒充已入账）';
  const mint = genericAppend(name, 'appendLedger', (n) => classify(n, 'proposed'));
  if (!mint || mint.detail.classification !== 'unregistered') return '通用通道未拒未入账名';
  const hist = [];
  const run = { runId: 'x', trigger: 'open', checked: 1, violations: [], softChecked: 0, softGhosts: [], schemaVersion: 7, ruleSetVersion: 'r1' };
  const blocked = persistAuditRun(hist, run, 'proposed');
  if (!blocked.refusal || blocked.refusal.code !== 'ACTIVATION_IMPOSSIBLE') return '机制直写未 fail-closed：' + JSON.stringify(blocked);
  if (hist.length !== 0) return '未批准期间仍落了账（装配应红、零行）';
  const raw = declareRawIntake(PRIN, { recordId: 'R', declaredType: 'zzz:x', body: 'b' }, 'proposed');
  if (!raw.refusal || raw.refusal.code !== 'ACTIVATION_IMPOSSIBLE') return 'Raw 落账通道未 fail-closed';
  if (raw.refusal.code === 'EVENT_AUTHORITY_REQUIRED') return '未入账给了 B-1 违例码（T-N8 同族）';
  if (mechanismWriteGateMUT6(name, 'proposed') !== null) return 'MUT-6 竟能拦住——批准门对架空失去判别力';
  const landed = persistAuditRun(hist, { ...run, runId: 'y' }, 'listed');
  if (!landed.row || hist.length !== 1) return '人工标记落地后同一调用未成功（fail-closed 写成了永久禁用）';
  return true;
}
function run_T_N14() { // R-6 负例：自动补戳路径不存在；MUT-7（打开期顺带盖章）改了历史行字节 ⇒ 判别力
  const h = [{ seq: 1, contract_version: null }, { seq: 2, contract_version: null }];
  const before = JSON.stringify(h);
  if (autoStampScan(h).stamped !== 0) return '真判据竟会补戳';
  if (JSON.stringify(h) !== before) return '真判据改了历史行';
  const mut = autoStampScanMUT7(h);
  if (mut.stamped === 0) return 'MUT-7 竟能拦住自动补戳——判据失去判别力';
  if (JSON.stringify(h) === before) return 'MUT-7 与真判据不可分（架空形没改历史行）';
  return true;
}

// 机制类审计行的构造器（②③ 支用；capability 侧的机制单点写在真实实现里，模型只钉形状与轴）
function mechAuditRow(eventType, axis, opts = {}) {
  const ctx = { ctxId: 'ctx-m' + eventType, actor: 'ops:root', capability: 'cap-mechanism', axis,
    authorized: opts.authorized === false ? false : true, ruleSetVersion: 'r1', contractVersion: 'v3',
    issuedAtMs: 1730000000009, txSeq: 900 };
  return { event_type: eventType, actor: 'ops:root', authority_basis: ctx };
}
// R-2 之前的两类别式（**作废形态**，常驻不删）：T-P8 用它证明三分修订改的是真行为
function gateFullShapeSuperseded2Branch(row) {
  const e = row.authority_basis;
  if (row.actor == null || e == null) return false;
  if (!EA46_CTX_FIELDS.every(f => Object.prototype.hasOwnProperty.call(e, f))) return false;
  if (e.actor !== row.actor) return false;
  return (!MECHANISM_AXES.has(e.axis)) || (e.axis === 'capability-admin' && e.authorized === true);
}

const CASE_RUNNERS = { run_T_P1, run_T_P2, run_T_P3, run_T_P4, run_T_P5, run_T_P6, run_T_P7, run_T_P8, run_T_P9,
  run_T_N1, run_T_N2, run_T_N3, run_T_N4, run_T_N5, run_T_N6, run_T_N7, run_T_N8, run_T_N9, run_T_N10,
  run_T_N11, run_T_N12, run_T_N13, run_T_N14 };
for (const id of caseIds) {
  const fn = CASE_RUNNERS['run_' + id.replace('-', '_')];
  let out;
  try { out = fn(); } catch (e) { out = '抛异常：' + e.message; }
  check('CASE ' + id, out === true, typeof out === 'string' ? out : '');
}

// ============================================================ 架空判据必红（三条自验，变异常驻）

check('MUT-1 架空「actor 非空即过」被 T-N5 判据区分（真判据拦得住、架空的拦不住）',
  gateFullShape({ event_type: EVENT, actor: 'a', authority_basis: { ...issueAuthorizationContext({ ...OPTS_OK, capability: 'cap-records', entry: OWNERSHIP.get(EVENT) }), actor: 'b' } }) === false
  && gateFullShapeMUT1({ event_type: EVENT, actor: 'a', authority_basis: null }) === true);
check('MUT-2 架空 deny-by-exception 被 T-N3 判据区分（真分类器拒未来名、架空的放行）',
  genericAppend('capability-migrated-v9', 'appendLedger') !== null && genericAppend('capability-migrated-v9', 'appendLedger', classifyMUT2) === null);
check('MUT-3 架空「同源自证对账」被 T-N9 判据区分（异源点名、同源失明）',
  reconcile([], ['capability-reloaded'], 'ledger-file').violations.length === 1 && reconcileMUT3([], ['capability-reloaded']).violations.length === 0);
check('R3 合规对账器拒绝同源取期望集（expectSource 不合规 = 构建期信号，非「看起来一致」）',
  reconcile([], ['x'], 'derived').sameSource === true && doc.includes('EVENT_RECON_SAMESOURCE'));

process.stdout.write('\n合计：' + pass + ' PASS / ' + fail + ' FAIL\n');
if (fail > 0) { process.stdout.write('未通过项：\n  ' + fails.join('\n  ') + '\n'); process.exitCode = 1; }
else process.exitCode = 0;
