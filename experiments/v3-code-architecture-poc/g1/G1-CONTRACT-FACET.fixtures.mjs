#!/usr/bin/env node
/*
  G1-CONTRACT-FACET.fixtures.mjs —— 与 G1-CONTRACT-FACET.md 互相对账的夹具（G1-FACET-01）。

  用法：node experiments/v3-code-architecture-poc/g1/G1-CONTRACT-FACET.fixtures.mjs
  退出码：0 = 契约结构自洽（含与 EA 契约正文/夹具/Q45 护栏测试/BASELINE 的跨文件对拍）
          + 正反例全命中 + 三条「架空判据」变异全部被捕获；1 = 有任一项 FAIL；2 = 夹具无法运行。

  纪律：
  - 零依赖（只用 node:fs / node:path），可直接 node 跑；不起数据库、不跑 PoC、不写任何生产代码。
  - 这里实现的是**契约判据的最小模型**（挂载账 / 双身份发号 / 挂载判定 / 三操作 / 见证全形闸 /
    对账器），不是机制实现；判据语义逐条对应契约正文的 FM-* 小节。
  - **事件与见证形状复用 EA 契约夹具**：AuthorizationContext 九字段、机制封闭名单、
    REFUSE_UNMOUNTED 引用形状、归属账示例 facet:calibration-observed——由 S1/S2/S11 跨文件
    解析对拍，**本夹具不另造**（S2 字段集逐字逐序对账）。
  - 变异纪律：MUT-* 架空判据常驻本文件不删除（仓内「架空不删除」纪律）；断言方向 =
    真实判据必须拦住负例，架空判据必须放过同一负例（否则正反例表对「架空」没有判别力）。
  - Q45 护栏（契约 FM-3.2）：T-P2 复现 g1a-regression.test.ts 正例护栏的三条断言形状；
    S6 对拍护栏测试名、三断言词与 BASELINE passes 条目——「任何条款都不得使该正例判红」。
*/

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(HERE, 'G1-CONTRACT-FACET.md');
const EA_DOC_PATH = join(HERE, 'G1-CONTRACT-EVENT-AUTHORITY.md');
const EA_FIX_PATH = join(HERE, 'G1-CONTRACT-EVENT-AUTHORITY.fixtures.mjs');
const SELF_PATH = fileURLToPath(import.meta.url);
const REFUSAL_CODES_PATH = join(HERE, '..', 'src', 'contracts', 'index.ts');
const GUARD_TEST_PATH = join(HERE, '..', 'attacks', 'review', 'g1a-regression.test.ts');
const BASELINE_PATH = join(HERE, '..', 'attacks', 'BASELINE.json');

let doc = '', eaDoc = '', eaFix = '', guardSrc = '', baseline = null;
try {
  doc = readFileSync(CONTRACT_PATH, 'utf8');
  eaDoc = readFileSync(EA_DOC_PATH, 'utf8');
  eaFix = readFileSync(EA_FIX_PATH, 'utf8');
  guardSrc = readFileSync(GUARD_TEST_PATH, 'utf8');
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
} catch (e) {
  process.stderr.write('FATAL: 取文失败（契约/EA 两份/护栏测试/BASELINE 之一读不到）：' + e.message + '\n');
  process.exit(2);
}
const selfSrc = readFileSync(SELF_PATH, 'utf8');

let pass = 0, fail = 0;
const fails = [];
function check(name, cond, detail) {
  if (cond) { pass += 1; process.stdout.write('PASS  ' + name + '\n'); }
  else { fail += 1; fails.push(name); process.stdout.write('FAIL  ' + name + (detail ? '  —— ' + detail : '') + '\n'); }
}

// ============================================================ 与 EA 契约夹具的复用对拍（不另造）

// EA 机制封闭名单（运行时面）——从 EA 夹具源文解析
const eaMechBlock = (eaFix.match(/const MODEL_MECHANISM = \[([\s\S]*?)\];/) ?? [null, ''])[1];
const EA_MECH = [...eaMechBlock.matchAll(/'([a-z][a-z0-9-]+)'/g)].map(m => m[1]);
// EA 契约正文名单块（三方逐等之 EA 侧）
const eaDocBlock = (eaDoc.match(/<!-- EA-2 MECHANISM-CLOSED-LIST-BEGIN -->([\s\S]*?)<!-- EA-2 MECHANISM-CLOSED-LIST-END -->/) ?? [null, ''])[1];
const EA_DOC_MECH = eaDocBlock.replace(/[「」]/g, '').split(/[·\s]+/).map(s => s.replace(/[，,]/g, '').trim()).filter(s => /^[a-z][a-z0-9-]*$/.test(s));
// EA 侧「名 → 在册登记的机制轴」（锚文件轴归属侧模型的 EA 夹具实现）——R-2 ③ 支的名册绑定面
const eaAxisBlock = (eaFix.match(/const MECHANISM_AXIS_OF = \{([\s\S]*?)\};/) ?? [null, ''])[1];
const EA_AXIS_OF = Object.fromEntries([...eaAxisBlock.matchAll(/'([a-z][a-z0-9-]+)'\s*:\s*'([a-z0-9-]+)'/g)].map(m => [m[1], m[2]]));
// EA 契约正文的「提案未入账」块（R-5）——本契约的两个 planned 名不得出现在其中（各归各的门控）
const eaPendingBlock = (eaDoc.match(/<!-- EA-2 PLANNED-PENDING-LIST-BEGIN -->([\s\S]*?)<!-- EA-2 PLANNED-PENDING-LIST-END -->/) ?? [null, ''])[1];
const EA_PENDING = eaPendingBlock.replace(/[「」]/g, '').split(/[·\s]+/).map(s => s.trim()).filter(s => /^[a-z][a-z0-9-]*$/.test(s));
// EA AuthorizationContext 九字段（见证形状的唯一正源）
const EA_CTX_FIELDS = [...((eaFix.match(/const EA46_CTX_FIELDS = \[([^\]]*)\];/) ?? [null, ''])[1].matchAll(/'([^']+)'/g))].map(m => m[1]);

// 本契约的 planned 挂载名（FM-9）；入账走 EA-2.4 六步，夹具侧 S1 只钉「未入账」
const MODEL_PLANNED = ['facet-mounted', 'facet-unlinked'];
function docPlannedList() {
  const m = doc.match(/<!-- FM-9 PLANNED-MOUNT-LIST-BEGIN -->([\s\S]*?)<!-- FM-9 PLANNED-MOUNT-LIST-END -->/);
  if (!m) return null;
  return m[1].replace(/[「」]/g, '').split(/[·\s]+/).map(s => s.replace(/[，,]/g, '').trim())
    .filter(s => /^[a-z][a-z0-9-]*$/.test(s));
}

// 复用 EA 归属账既有示例（FM-3.3：扩展内容事件的合法形状；S2 对拍示例名确实在 EA 夹具账内）
const DOMAIN_OWNERSHIP = new Map([
  ['facet:calibration-observed', { owner: 'cap-calibration', requiresAuthority: 'calibration-write' }],
]);

// 本夹具的见证字段集——S2 与 EA 逐字逐序对账（「复用不另造」的机验）
const CTX_FIELDS = ['ctxId', 'actor', 'capability', 'axis', 'authorized', 'ruleSetVersion', 'contractVersion', 'issuedAtMs', 'txSeq'];
// 轴值：EA C-17 原文「至少 space-write、capability-admin」⇒ 本契约按 FM-7 扩 facet-mount（机制自有操作轴）
const MECH_ROUTE_AXES = new Set(['space-write', 'capability-admin']);
const MECH_AXES = new Set([...MECH_ROUTE_AXES, 'facet-mount']);

let NOW = 1730000000000;
function issueCtx(principal, capability, axis, txSeq) {
  return {
    ctxId: 'ctx-' + txSeq, actor: principal.actorId, capability, axis,
    authorized: principal.axes.includes(axis), ruleSetVersion: 'r1', contractVersion: 'v3',
    issuedAtMs: ++NOW, txSeq,
  };
}
function fullCtx(e) { return e != null && typeof e === 'object' && CTX_FIELDS.every(f => Object.prototype.hasOwnProperty.call(e, f)); }
// 名 → 在册登记的机制轴（本契约侧；与 EA 夹具同名条目必须逐等，S13 机验——两份名册不是二真源）
const MECHANISM_AXIS_OF = { 'facet-mounted': 'facet-mount', 'facet-unlinked': 'facet-mount' };
// 挂载审计全形闸 = **EA-4.5 ③ 支的覆盖式谓词**（R-2 依赖登记见 FM-7 DEP-EA45-3；字段面不另造）：
// 名 ∈ 机制封闭名单 ∧ 轴 ∈ 机制轴集 ∧ 轴 = 该名在册登记的机制轴 ∧ authorized = 1
function gateFullShapeMount(row) {
  const e = row.authority_basis;
  if (row.actor == null || !fullCtx(e)) return false;
  if (e.actor !== row.actor) return false;
  if (classify(row.event_type, true).cls !== 'mechanism') return false;          // 名在册
  if (!MECH_AXES.has(e.axis)) return false;                                      // 轴 ∈ 机制轴集
  if (MECHANISM_AXIS_OF[row.event_type] !== e.axis) return false;                // 名册轴绑定（防串用）
  if (e.authorized !== true) return false;                                       // 判定输入型必已生效
  return e.capability === row.capability;
}
function gateFullShapeRoute(row) {
  const e = row.authority_basis;
  if (row.actor == null || !fullCtx(e)) return false;
  return e.actor === row.actor && e.axis === 'capability-admin' && e.authorized === true;
}

function classify(name, listed) {
  if (EA_MECH.includes(name)) return { cls: 'mechanism' };
  if (MODEL_PLANNED.includes(name)) return { cls: listed ? 'mechanism' : 'unregistered' };
  if (DOMAIN_OWNERSHIP.has(name)) return { cls: 'domain', owner: DOMAIN_OWNERSHIP.get(name).owner };
  return { cls: 'unregistered' };
}
function eaRefusal(name, channel, classification) {
  return { code: 'EVENT_AUTHORITY_REQUIRED', detail: { eventType: name, channel, classification } };
}
// 通用台账通道（EA-2.2 矩阵：三类别全拒；本夹具照抄该形状，planned 名的「无窗口」由此机验）
function genericAppend(w, principal, eventType, channel) {
  const c = classify(eventType, w.listed);
  return { refusal: eaRefusal(eventType, channel ?? 'appendLedger', c.cls) };
}

// ============================================================ 世界与端口最小模型

const OWN_NS = (cap) => 'ns:' + cap;
function mkWorld(opts = {}) {
  return {
    listed: opts.listed !== false, // 名单入账阶段（EA-2.4 完成与否）
    dir: new Map([
      ['O-core', { owner: 'cap-records', head: 3, revs: [1, 2, 3], payload: { serial: 'G1A-Q45' } }],
      ['O-core2', { owner: 'cap-records', head: 1, revs: [1], payload: { serial: 'core2' } }],
      ['O-hidden', { owner: 'cap-records', head: 1, revs: [1], payload: {} }],
      ['O-own', { owner: 'cap-calibration', head: 1, revs: [1], payload: {} }],
    ]),
    invisibleToCaller: new Set(['O-hidden']), // 存在但无可见权（与不存在同形的对偶世界，F-24/D1-c）
    routes: new Map([['cap-records', { enabled: true, plugin: 'p-rec' }], ['cap-calibration', { enabled: true, plugin: 'p-cal-old' }]]),
    mounts: new Map(), facetRows: [], ledger: [], edges: [], reports: [],
    counters: { fm: 0, fr: 0, seq: 0 },
  };
}
const PRIN = { actorId: 'user:lin', spaceWrite: true, axes: ['facet-mount', 'calibration-write'] };
const PRIN_OWNER = { actorId: 'user:wu', spaceWrite: true, axes: ['domain-admission'] };
const PRIN_ADMIN = { actorId: 'ops:root', spaceWrite: true, axes: ['capability-admin', 'facet-mount'] };
const PRIN_NOAXIS = { actorId: 'user:na', spaceWrite: true, axes: [] };

// FM-3.1(a)：唯一塑形函数——两个来源共用，detail 封闭键集 {oid, capability}
function refuseScope(oid, capability) { return { code: 'CAPABILITY_SCOPE_ESCAPE', detail: { oid, capability } }; }
function reasonForExtraField(f) {
  if (/core/i.test(f)) return 'input-carries-core-override';
  if (/Id$/.test(f)) return 'input-carries-id-field';
  return 'input-carries-foreign-authority';
}

function mountActive(w, mountId) { const m = w.mounts.get(mountId); return m ? m.rows[m.rows.length - 1].op === 'MOUNT' : false; }
function hasActiveMount(w, cap, oid) {
  for (const m of w.mounts.values()) {
    const r = m.rows[m.rows.length - 1];
    if (r.facetCapability === cap && r.targetOid === oid && r.op === 'MOUNT') return true;
  }
  return false;
}
function activationRefusal() { return { refusal: { code: 'ACTIVATION_IMPOSSIBLE', detail: { gate: 'planned-names-not-listed' } } }; }

// —— declareMount（FM-2.2 判据序：入账→白名单→写权→激活→轴取证→目标解析→绑定形态→同事务原子落账）
const DECLARE_FIELDS = ['targetOid', 'binding'];
function declareMount(w, cap, principal, input, mutator) {
  if (!w.listed) return activationRefusal();
  const extra = Object.keys(input).filter(k => !DECLARE_FIELDS.includes(k));
  if (extra.length > 0) { const r = refuseScope(input.targetOid ?? null, cap); r.detail.reason = reasonForExtraField(extra[0]); return { refusal: r }; }
  if (!principal.spaceWrite) return { refusal: { code: 'NO_SPACE_WRITE', detail: { capability: cap } } };
  const route = w.routes.get(cap);
  if (!route || !route.enabled) return { refusal: { code: 'CAPABILITY_INACTIVE', detail: { capability: cap } } };
  if (!principal.axes.includes('facet-mount')) return { refusal: { code: 'AUTHORITY_REQUIRED', detail: { capability: cap } } }; // ③ 取证先于解析
  const oid = input.targetOid; const o = w.dir.get(oid);
  if (!o || w.invisibleToCaller.has(oid)) return { refusal: { code: 'NOT_FOUND_IN_SPACE', detail: { oid } } }; // ④ 同形
  const b = input.binding;
  if (!b || (b.mode !== 'NAVIGATION' && b.mode !== 'PINNED')) return { refusal: refuseScope(oid, cap), signal: 'unknown-binding' };
  if (b.mode === 'PINNED') {
    if (b.revisionRef == null) return { refusal: { code: 'HARD_REF_NOT_PINNED', detail: { oid } } }; // ⑤ 浮动
    if (!o.revs.includes(b.revisionRef)) return { refusal: { code: 'NOT_FOUND_IN_SPACE', detail: { oid } } }; // ⑤ 修订不真实存在
  }
  const mountId = 'FM-' + (++w.counters.fm);
  const row = {
    mountId, gen: 1, op: 'MOUNT', facetCapability: cap, targetOid: oid, binding: { ...b },
    snapshotRevision: b.mode === 'PINNED' ? b.revisionRef : o.head, witnessSeq: w.counters.seq + 1,
  };
  if (mutator === 'MUT3-decoupled') { w.mounts.set(mountId, { rows: [row] }); return { mountId, witnessPending: true }; } // 架空：见证脱钩
  const seq = ++w.counters.seq;
  const ctx = issueCtx(principal, cap, 'facet-mount', seq);
  w.ledger.push({ seq, event_type: 'facet-mounted', capability: cap, actor: ctx.actor, authority_basis: ctx, echo: { mountId, targetOid: oid, op: 'MOUNT' } });
  w.mounts.set(mountId, { rows: [row] }); // 同事务原子：先账后行一起生效（F-20）
  return { mountId, witnessSeq: seq };
}

function unlinkMount(w, cap, principal, input) {
  if (!w.listed) return activationRefusal();
  if (Object.keys(input).filter(k => k !== 'mountId').length > 0) return { refusal: refuseScope(null, cap) };
  if (!principal.spaceWrite) return { refusal: { code: 'NO_SPACE_WRITE', detail: { capability: cap } } };
  if (!w.routes.get(cap)?.enabled) return { refusal: { code: 'CAPABILITY_INACTIVE', detail: { capability: cap } } };
  if (!principal.axes.includes('facet-mount')) return { refusal: { code: 'AUTHORITY_REQUIRED', detail: { capability: cap } } };
  const m = w.mounts.get(input.mountId);
  if (!m || m.rows[0].facetCapability !== cap || !mountActive(w, input.mountId)) return { refusal: { code: 'NOT_FOUND_IN_SPACE', detail: { mountId: input.mountId } } };
  const last = m.rows[m.rows.length - 1];
  const seq = ++w.counters.seq;
  const ctx = issueCtx(principal, cap, 'facet-mount', seq);
  w.ledger.push({ seq, event_type: 'facet-unlinked', capability: cap, actor: ctx.actor, authority_basis: ctx, echo: { mountId: input.mountId, op: 'UNLINK' } });
  m.rows.push({ mountId: input.mountId, gen: last.gen + 1, op: 'UNLINK', facetCapability: cap, targetOid: last.targetOid, binding: last.binding, snapshotRevision: last.snapshotRevision, witnessSeq: seq });
  return { witnessSeq: seq };
}

// —— writeFacetRecord（目标形态；判据消费挂载登记，不消费自由 oid）
const WRITE_FIELDS = ['mountId', 'facetRecordId', 'boundRevisionRef', 'payload'];
function writeFacetRecord(w, cap, principal, input) {
  if (!w.listed) return activationRefusal();
  const extra = Object.keys(input).filter(k => !WRITE_FIELDS.includes(k));
  if (extra.length > 0) { const r = refuseScope(input.mountId ? (w.mounts.get(input.mountId)?.rows[0].targetOid ?? null) : null, cap); r.detail.reason = reasonForExtraField(extra[0]); return { refusal: r }; }
  if (!principal.spaceWrite) return { refusal: { code: 'NO_SPACE_WRITE', detail: { capability: cap } } };
  if (!w.routes.get(cap)?.enabled) return { refusal: { code: 'CAPABILITY_INACTIVE', detail: { capability: cap } } };
  const m = w.mounts.get(input.mountId);
  if (!m || m.rows[0].facetCapability !== cap) return { refusal: { code: 'NOT_FOUND_IN_SPACE', detail: { mountId: input.mountId } } }; // 非己与不存在同形
  if (!mountActive(w, input.mountId)) return { refusal: refuseScope(m.rows[0].targetOid, cap), signal: 'REFUSE_UNMOUNTED' };
  const cur = m.rows[m.rows.length - 1]; const o = w.dir.get(cur.targetOid);
  if (cur.binding.mode === 'PINNED') {
    if (input.boundRevisionRef == null) return { refusal: { code: 'HARD_REF_NOT_PINNED', detail: { mountId: input.mountId } } };
    if (input.boundRevisionRef !== cur.binding.revisionRef) return { refusal: refuseScope(cur.targetOid, cap), signal: 'REFUSE_BINDING_MISMATCH' };
  } else if (input.boundRevisionRef != null && !o.revs.includes(input.boundRevisionRef)) {
    return { refusal: { code: 'NOT_FOUND_IN_SPACE', detail: { oid: cur.targetOid } } };
  }
  let rec = null;
  if (input.facetRecordId != null) {
    rec = w.facetRows.find(r => r.facetRecordId === input.facetRecordId && r.mountId === input.mountId);
    if (!rec) return { refusal: { code: 'NOT_FOUND_IN_SPACE', detail: { mountId: input.mountId } } };
  }
  const targetRevisionAtRecord = cur.binding.mode === 'PINNED' ? cur.binding.revisionRef : o.head; // 机制写「建立时修订」（FM-2.3）
  const facetRecordId = rec ? rec.facetRecordId : 'FR-' + (++w.counters.fr); // 机制发号，调用方不可自带
  const prevMax = Math.max(0, ...w.facetRows.filter(r => r.facetRecordId === facetRecordId).map(r => r.facetRevision));
  const row = { facetRecordId, facetRevision: prevMax + 1, mountId: input.mountId, ns: OWN_NS(cap), targetOid: cur.targetOid, targetRevisionAtRecord, boundRevisionRef: input.boundRevisionRef ?? null, payload: input.payload };
  w.facetRows.push(row);
  return { facetRecordId, facetRevision: row.facetRevision, targetRevisionAtRecord };
}

// —— 现行 write() 的他人-oid 形态（FM-3.3 收敛前形态：行形态入口 + 挂载判定新判据）
function legacyWrite(w, cap, principal, input, mutator) {
  if (input.ns !== OWN_NS(cap)) return { refusal: { code: 'NAMESPACE_ESCAPE', detail: { capability: cap } } };
  if (input.eventType != null) return genericAppend(w, principal, input.eventType, 'write-registration-row');
  if (!principal.spaceWrite) return { refusal: { code: 'NO_SPACE_WRITE', detail: { capability: cap } } };
  const o = w.dir.get(input.oid);
  if (!o) return { refusal: { code: 'NOT_FOUND_IN_SPACE', detail: { oid: input.oid } } };
  if (o.owner !== cap && !hasActiveMount(w, cap, input.oid) && mutator !== 'MUT1-rowshape') {
    return { refusal: refuseScope(input.oid, cap), signal: 'REFUSE_UNMOUNTED' };
  }
  w.facetRows.push({ facetRecordId: null, mountId: null, ns: input.ns, targetOid: input.oid, targetRevisionAtRecord: o.head, facetRevision: input.revision, payload: input.payload, legacy: true });
  return { ok: true };
}

// —— 核心修订（属主通道；越权形态 = D-19 形状，与挂载判定同一塑形函数）
function reviseCore(w, cap, principal, oid, payload) {
  const o = w.dir.get(oid);
  if (!o) return { refusal: { code: 'NOT_FOUND_IN_SPACE', detail: { oid } } };
  if (!principal.spaceWrite) return { refusal: { code: 'NO_SPACE_WRITE', detail: { capability: cap } } };
  if (o.owner !== cap) return { refusal: refuseScope(oid, cap), signal: 'NO_RIGHT' };
  o.head += 1; o.revs.push(o.head); o.payload = payload;
  return { revision: o.head };
}

// —— 三操作之「卸载实现 / 恢复启用 / 所有权移交」（既有路由通道；轴 capability-admin）
function routeOp(w, principal, cap, kind) {
  if (!principal.axes.includes('capability-admin')) return { refusal: { code: 'AUTHORITY_REQUIRED', detail: { capability: cap } } };
  const evName = { disable: 'capability-disabled', enable: 'capability-enabled', transfer: 'capability-transferred' }[kind];
  const seq = ++w.counters.seq;
  const ctx = issueCtx(principal, cap, 'capability-admin', seq);
  w.ledger.push({ seq, event_type: evName, capability: cap, actor: ctx.actor, authority_basis: ctx, echo: { capability: cap, kind } });
  const r = w.routes.get(cap);
  if (kind === 'disable') r.enabled = false;
  if (kind === 'enable') r.enabled = true;
  if (kind === 'transfer') r.plugin = r.plugin + '→new';
  return { witnessSeq: seq };
}
const disableCapability = (w, p, c) => routeOp(w, p, c, 'disable');
const enableCapability = (w, p, c) => routeOp(w, p, c, 'enable');
const transferRoute = (w, p, c) => routeOp(w, p, c, 'transfer');

// —— 查询面（FM-2.4：只见自己）
function mountState(w, cap, mountId) {
  const m = w.mounts.get(mountId);
  if (!m || m.rows[0].facetCapability !== cap) return null;
  const r = m.rows[m.rows.length - 1];
  return { mountId, active: r.op === 'MOUNT', gen: r.gen, targetOid: r.targetOid, binding: r.binding, snapshotRevision: r.snapshotRevision };
}
function listOwnMounts(w, cap) { return [...w.mounts.keys()].map(id => mountState(w, cap, id)).filter(Boolean); }

// —— 读面（FM-5.2 routeNs 模型：核心状态视图只含归属行；挂载/审计信息零出现）
function pluginVisibleResponse(w) {
  const core = {};
  for (const [oid, o] of w.dir) {
    if (w.invisibleToCaller.has(oid)) continue;
    core[oid] = {
      head: o.head, payload: o.payload,
      stateRows: w.facetRows.filter(r => r.targetOid === oid && r.ns === OWN_NS(o.owner)).map(r => r.facetRevision),
    };
  }
  return JSON.stringify({ core, echo: {} }); // R-1：插件可见面零 hiddenBy* 遮蔽计数键（FM-2.4 同步句）
}
// 旧形态（R-1 之前，**作废**，常驻仅供 T-N9 负例与 MUT-4 的判别力对拍）
function pluginVisibleResponseSuperseded(w) { return pluginVisibleResponse(w).replace('"echo":{}', '"echo":{"hiddenByContractSkew":0}'); }
// R-1 判据：普通调用者可见面零 hiddenBy* 键（与 EA 夹具同名判据同一把尺）
const callerSurfaceFreeOfShadowCounters = (body) => !/hiddenBy[A-Z]/.test(body);
// MUT-4 架空判据（常驻不删）：只核「响应里不出现审计事件名/digest」——即 R-1 之前的全部内涵
const callerSurfaceFreeOfShadowCountersMUT4 = (body) => !/facet-mounted|facet-unlinked|Digest|digest/.test(body);

// —— 内部审计真因复算面（FM-3.1(b)：账可复算、不落行、插件面零入口）
function auditTruthCause(w, op, cap, oid) {
  const o = w.dir.get(oid);
  if (!o) return 'NOT_FOUND';
  if (o.owner === cap) return 'OWNER_OK';
  if (op === 'state-row-write') return hasActiveMount(w, cap, oid) ? 'MOUNT_ACTIVE' : 'UNMOUNTED';
  return 'NO_RIGHT'; // 核心权威操作（有挂载也不授权改核心）
}
function auditQuery(w, principal, req) {
  if (!principal.axes.includes('capability-admin')) return null; // 无运维授权 = 无入口（不是拒形，面锚对拍）
  return auditTruthCause(w, req.op, req.cap, req.oid);
}

// —— 挂载账守卫与对账（FM-2.5 / F-20）
function rawMountRowOp(op) {
  if (op === 'update' || op === 'delete') return { refusal: 'MOUNT_ROW_FROZEN' };
  if (op === 'insert-bare') return { refusal: 'MOUNT_AUDIT_REQUIRED' };
  return { ok: true };
}
function reconcileMountWitnesses(w) {
  const v = [];
  for (const [mountId, m] of w.mounts) for (const row of m.rows) {
    const led = w.ledger.find(l => l.seq === row.witnessSeq);
    const want = row.op === 'MOUNT' ? 'facet-mounted' : 'facet-unlinked';
    if (!led || led.event_type !== want || !gateFullShapeMount(led)) v.push(mountId + ':gen' + row.gen);
  }
  return v;
}

// —— 身份冒充 / 正式槽位 / 认领核心边 / XC-28 领域检查（FM-1.2 / FM-5.3）
function declareWithOwnId(id) { return /^(FM|FR)-/.test(id) ? { refusal: { code: 'RECORD_ID_RESERVED', detail: { id } } } : { ok: true }; }
function formalSlotAccepts(w, ref) {
  if (typeof ref === 'string') {
    if (ref.startsWith('FR-')) return false; // RF-05/06：Facet 记录 ID 不得冒充科研对象 ID
    const m = /^O-.+@(\d+)$/.test(ref);
    if (!m) return false;
    const [oid, rev] = ref.split('@'); const o = w.dir.get(oid);
    return !!o && o.revs.includes(Number(rev));
  }
  if (ref && ref.facetRecordId && ref.boundRevisionRef != null) return w.facetRows.some(r => r.facetRecordId === ref.facetRecordId); // 合法记录引用（F-02）
  return false;
}
function linkOwnedFacet(w, cap, from, role) {
  const o = w.dir.get(from.oid);
  if (o && o.owner !== cap) return { refusal: refuseScope(from.oid, cap), signal: 'NO_RIGHT' }; // 只能 own 自己的边
  w.edges.push({ from, role, cap });
  return { ok: true };
}
function runXc28Check(w, cap) {
  const dup = w.facetRows.some(r => r.ns === OWN_NS(cap) && r.payload && r.payload.used_in);
  const verdict = dup ? 'NOT_ACHIEVED' : 'ACHIEVED';
  w.reports.push({ verdict, ruleSetVersion: 'r1' });
  return verdict;
}
// 内容事件走归属能力签发 Port（EA-2.2/EA-3；复用 facet:calibration-observed 归属账示例）
function appendAuthoritative(w, cap, principal, input) {
  const c = classify(input.eventType, w.listed);
  if (c.cls !== 'domain' || c.owner !== cap) return { refusal: eaRefusal(input.eventType, 'appendAuthoritativeEvent', c.cls) };
  const e = DOMAIN_OWNERSHIP.get(input.eventType);
  const seq = ++w.counters.seq;
  const ctx = issueCtx(principal, cap, e.requiresAuthority, seq);
  const row = { seq, event_type: input.eventType, capability: cap, actor: ctx.actor, authority_basis: ctx, payload: input.payload };
  w.ledger.push(row);
  return { row, authorized: ctx.authorized };
}

// ============================================================ 架空判据（常驻不删）

// MUT-1 = D-24 现状：行形态判据（ns=自己 ⇒ 放行，不问挂载）——已在 legacyWrite(mutator='MUT1-rowshape') 建模
// MUT-2 = 卸载即撤销：disable 顺带把 ACTIVE 挂载清成 UNLINK
function disableCapabilityMUT2(w, principal, cap) {
  const r = disableCapability(w, principal, cap);
  if (!r.refusal) for (const m of w.mounts.values()) {
    const last = m.rows[m.rows.length - 1];
    if (last.facetCapability === cap && last.op === 'MOUNT') m.rows.push({ ...last, op: 'UNLINK', gen: last.gen + 1, witnessSeq: 0 });
  }
  return r;
}
// MUT-3 = 审计后置可脱钩：declareMount(mutator='MUT3-decoupled') 先落行、见证丢在崩溃窗口

// ============================================================ 结构校验（S 组）

const PLANNED_DOC = docPlannedList();
check('S1 planned 名单三方逐等（契约 FM-9 块 ↔ 夹具模型 ↔ 不在 EA 运行时名单/正文名单），gated_by=G1-FACET-01 在位',
  Array.isArray(PLANNED_DOC) && PLANNED_DOC.length === 2 && PLANNED_DOC.every((n, i) => n === MODEL_PLANNED[i])
  && MODEL_PLANNED.every(n => !EA_MECH.includes(n) && !EA_DOC_MECH.includes(n))
  && doc.includes("gated_by: 'G1-FACET-01'") && doc.includes('planned: true') && EA_MECH.length >= 7
  && EA_PENDING.length >= 1 && MODEL_PLANNED.every(n => !EA_PENDING.includes(n)));

check('S2 见证形状复用不另造：AuthorizationContext 九字段与 EA 夹具逐字逐序等；归属账示例 facet:calibration-observed 在 EA 账内',
  CTX_FIELDS.length === 9 && CTX_FIELDS.length === EA_CTX_FIELDS.length && CTX_FIELDS.every((f, i) => f === EA_CTX_FIELDS[i])
  && eaFix.includes("'facet:calibration-observed'") && eaFix.includes("cap-calibration") && doc.includes('facet:calibration-observed'));

const shaRe = /5ec38974fc|0369c3196c|37de107ed5|d2f19cc/;
const refLines = doc.split('\n').filter(l => /\|\s*F-\d\d\s*\|/.test(l));
const extSha = s => refLines.filter(l => l.includes('`' + s + '`')).length;
const bad47 = refLines.filter(l => l.includes('37de107ed5')).filter(l => !l.includes('条件式') && !l.includes('未覆盖'));
const openAttrib = doc.split('\n').filter(l => l.includes('属 #47 决策面')).filter(l => !l.includes('禁止') && !l.includes('不写'));
check('S3 引用表四要素逐行核 + #44≥5 / #42≥4 / #47 行全部条件式或未覆盖 + 「属 #47 决策面」零裸用',
  refLines.length >= 20 && refLines.every(l => shaRe.test(l) && l.includes('「') && /(\.md|\.ts|\.yaml)/.test(l))
  && extSha('5ec38974fc') >= 5 && extSha('0369c3196c') >= 4 && extSha('37de107ed5') >= 2 && bad47.length === 0 && openAttrib.length === 0,
  'F行=' + refLines.length + ' bad47=' + bad47.length + ' 裸归属=' + openAttrib.length);

const tokensIn = (text) => new Set([...text.matchAll(/`([A-Z][A-Z0-9_]{2,})`/g)].map(m => m[1]));
const CLOSED_CODES = new Set((readFileSync(REFUSAL_CODES_PATH, 'utf8').match(/'([A-Z][A-Z0-9_]{2,})'/g) ?? []).map(s => s.slice(1, -1)));
const NON_REFUSAL_OK = new Set(['REFUSE_UNMOUNTED', 'REFUSE_BINDING_MISMATCH', 'MOUNT_ROW_FROZEN', 'MOUNT_AUDIT_REQUIRED',
  'ROUTE_AUDIT_REQUIRED', 'HISTORY_IMMUTABLE', 'SCHEMA_VERSION', 'NO_REFUSAL', 'OPEN_DESIGN_QUESTIONS', 'FROZEN_DOCS',
  'NAVIGATION', 'PINNED', 'MECHANISM_RESOURCES', 'RELOCATABLE_NS_KEYS',
  'APPROVED_BY']); // 绑定模式名 / 他契约名单集名 / 批准标记名——形态词非拒绝码（FM-6/FM-7）
const badTokens = [...tokensIn(doc)].filter(t => !(CLOSED_CODES.has(t) || NON_REFUSAL_OK.has(t)));
check('S4 契约内出现的全大写码全部落在封闭拒绝码集 ∪ 声明的存储层信号文本（封闭集零扩张，FM-7）',
  badTokens.length === 0, badTokens.join(','));

const t10 = doc.slice(doc.indexOf('## 10. FM-10'), doc.indexOf('## 11. FM-11'));
const casesInDoc = [...t10.matchAll(/\|\s*(T-[PN]\d{1,2})\s*\|/g)].map(m => m[1]);
const caseIds = [...selfSrc.matchAll(/^function run_T_([PN]\d{1,2})\(/gm)].map(m => 'T-' + m[1]);
check('S5 正反例表与夹具双向一致（表内每个 id 都有 run_*，无孤儿实现，双向等数=17）',
  casesInDoc.length === 17 && new Set(casesInDoc).size === 17 && caseIds.length === 17
  && casesInDoc.every(id => caseIds.includes(id)) && new Set(caseIds).size === 17,
  'doc=' + casesInDoc.length + ' fn=' + caseIds.length);

const GUARD_NAME = 'D-24 正例护栏：Facet 把扩展记录挂载到他人拥有的核心对象（Q45 合法形态）必须继续成功';
const baselineHit = (baseline.passes ?? []).some(x => x.includes('g1a-regression.test.ts') && x.includes(GUARD_NAME));
check('S6 Q45 护栏三重对拍：护栏测试名在契约逐字在位 + 「任何条款都不得使该正例判红」声明在位 + 测试源与 BASELINE passes 实含该条',
  doc.includes(GUARD_NAME) && doc.includes('任何条款都不得使该正例判红')
  && guardSrc.includes(GUARD_NAME) && baselineHit
  && guardSrc.includes("'NO_REFUSAL'") && guardSrc.includes('G1A-Q45')
  && guardSrc.includes('扩展挂载不得改写核心权威数据') && guardSrc.includes('扩展记录必须按扩展修订序列可读')
  && selfSrc.includes('G1A-Q45') && selfSrc.includes('NO_REFUSAL'));

check('S7 三操作分立正文在位 + 事件复用既有成员（capability-disabled / capability-enabled / capability-transferred ∈ EA 名单）',
  doc.includes('卸载实现 / 解除挂载 / 所有权移交是三种不同操作') && doc.includes('不得以卸载替代撤销或删除历史')
  && ['capability-disabled', 'capability-enabled', 'capability-transferred', 'object-revised'].every(n => EA_MECH.includes(n))
  && doc.includes('capability-transferred') && doc.includes('facet-unlinked'));

check('S8 双身份正文在位：「两套身份」+「挂载登记不得把目标对象 ID 充当 Facet 自身版本身份」+ FacetRecordID + 核心不可覆盖',
  doc.includes('两套身份') && doc.includes('挂载登记不得把目标对象 ID 充当 Facet 自身版本身份')
  && doc.includes('FacetRecordID') && doc.includes('核心修订不可被 Facet 覆盖') && doc.includes('不能覆盖对象核心 Revision'));

check('S9 FM-3.1 三条在位：取证先于解析 + 唯一塑形函数/内部审计保留真区别 + 「复用不改变该码原有越权语义」原句',
  doc.includes('取证先于对象解析') && doc.includes('唯一塑形函数') && doc.includes('内部审计保留真区别')
  && doc.includes('复用不改变 `CAPABILITY_SCOPE_ESCAPE` 原有的越权语义') && doc.includes('内部审计通道的判定复算面'));

check('S10 本夹具保留四条架空判据（MUT-1 行形态 / MUT-2 卸载即撤销 / MUT-3 见证脱钩 / MUT-4 遮蔽计数呈现面，常驻不删）',
  selfSrc.includes("mutator !== 'MUT1-rowshape'") && /function disableCapabilityMUT2\(/.test(selfSrc)
  && selfSrc.includes("mutator === 'MUT3-decoupled'") && /callerSurfaceFreeOfShadowCountersMUT4\s*=/.test(selfSrc));

// —— 跨契约对账（R-1/R-2/R-3；两侧条文互指，任一侧单独回滚即红）——
check('S12 R-2 显式依赖两侧互指在位：本契约 DEP-EA45-3 + 见证列指 EA-4.5 ③ 支 ↔ EA 正文三分式与挂载方点名',
  doc.includes('DEP-EA45-3') && doc.includes('EA-4.5 ③ 支')
  && eaDoc.includes('轴判据**三分**') && eaDoc.includes('registeredMechanismAxis')
  && eaDoc.includes('显式跨契约依赖') && eaDoc.includes('FM-7 轴值段与 FM-11.2 关系表')
  && eaDoc.includes('R-2 修订段') && eaDoc.includes('EA 夹具 S16 / FM 夹具 S12 双向机验')
  && /function gateFullShapeMUT4\(/.test(eaFix) && eaFix.includes('run_T_P8') && eaFix.includes('run_T_N12'));
check('S13 名册轴不成为二真源：本夹具「名→机制轴」与 EA 夹具同名条目逐等；且 facet_mount 形状零 ns 列（R-3 的前提）',
  MODEL_PLANNED.every(n => EA_AXIS_OF[n] === 'facet-mount' && MECHANISM_AXIS_OF[n] === EA_AXIS_OF[n])
  && !/FacetMountRow[\s\S]{0,900}?\bns\s*:/.test(doc.replace(/`ns`/g, 'NS列'))
  && doc.includes('没有 `ns` 列') && doc.includes('零搬迁')
  && /function gateFullShapeMount\([\s\S]{0,700}?MECHANISM_AXIS_OF\[row\.event_type\]/.test(selfSrc));
check('S14 R-1 同步在位：插件可见响应体零 hiddenBy* 键 + 正文同步句 + MUT-4 与旧形态常驻（判别力可自验）',
  !pluginVisibleResponse(mkWorld()).includes('hiddenBy')
  && callerSurfaceFreeOfShadowCounters(pluginVisibleResponse(mkWorld())) === true
  && doc.includes('零 `hiddenBy*` 遮蔽计数键') && eaDoc.includes('R-1 更正段')
  && pluginVisibleResponseSuperseded(mkWorld()).includes('hiddenByContractSkew'));

check('S11 存储层信号文本登记在位（不是 `RefusalCode` 封闭集成员）且 EA 夹具 REFUSE_UNMOUNTED 引用形状承接',
  doc.includes('不是 `RefusalCode` 封闭集成员') && eaFix.includes("'REFUSE_UNMOUNTED'")
  && ['REFUSE_UNMOUNTED', 'MOUNT_ROW_FROZEN', 'MOUNT_AUDIT_REQUIRED', 'REFUSE_BINDING_MISMATCH'].every(t => doc.includes(t)));

// ============================================================ 表驱动正反例（与 §10 表逐一对应；返回 null=通过）

function run_T_P1() {
  const w = mkWorld();
  const d = declareMount(w, 'cap-calibration', PRIN, { targetOid: 'O-core', binding: { mode: 'NAVIGATION' } });
  if (d.refusal) return 'declare 被拒：' + JSON.stringify(d.refusal);
  const coreBefore = JSON.stringify({ head: w.dir.get('O-core').head, payload: w.dir.get('O-core').payload });
  const wf = writeFacetRecord(w, 'cap-calibration', PRIN, { mountId: d.mountId, payload: { calibration: 'C-1' } });
  if (wf.refusal) return 'write 被拒：' + JSON.stringify(wf.refusal);
  if (wf.facetRecordId === 'O-core' || !/^FR-/.test(wf.facetRecordId)) return 'FR 发号异常：' + wf.facetRecordId;
  if (JSON.stringify({ head: w.dir.get('O-core').head, payload: w.dir.get('O-core').payload }) !== coreBefore) return '核心被改写';
  if (mountState(w, 'cap-calibration', d.mountId).snapshotRevision !== 3) return '挂载快照未记建立时修订';
  const rowSnap = JSON.stringify(w.facetRows[0]);
  const rv = reviseCore(w, 'cap-records', PRIN_OWNER, 'O-core', { serial: 'G1A-Q45', extra: 1 });
  if (rv.refusal) return '属主修订反被拒：' + JSON.stringify(rv.refusal);
  if (mountState(w, 'cap-calibration', d.mountId).snapshotRevision !== 3) return '核心再修订改写了挂载快照（A.8-2③ 违例）';
  if (w.facetRows[0].targetRevisionAtRecord !== 3) return '扩展行建立时修订被回溯改写';
  if (JSON.stringify(w.facetRows[0]) !== rowSnap) return '既有扩展记录被回溯改写';
  return null;
}

function run_T_P2() {
  // Q45 护栏形状对拍：helper = declareMount + write()；断言三条 = 护栏测试原文方向
  const w = mkWorld();
  const d = declareMount(w, 'cap-calibration', PRIN, { targetOid: 'O-core', binding: { mode: 'NAVIGATION' } });
  if (d.refusal) return '挂载建立被拒（护栏世界无法构造）：' + JSON.stringify(d.refusal);
  const r = legacyWrite(w, 'cap-calibration', PRIN, { ns: OWN_NS('cap-calibration'), oid: 'O-core', revision: 1, payload: { calibration: 'C-1' }, eventType: null });
  const code = r.ok ? 'NO_REFUSAL' : r.refusal.code;
  if (code !== 'NO_REFUSAL') return '护栏断言① 失败：期望 NO_REFUSAL，实得 ' + code;
  const read = w.facetRows.find(x => x.targetOid === 'O-core' && x.ns === OWN_NS('cap-calibration'));
  if (!read || read.payload.calibration !== 'C-1') return '护栏断言② 失败：扩展记录未按扩展修订序列可读';
  if (w.dir.get('O-core').payload.serial !== 'G1A-Q45') return '护栏断言③ 失败：扩展挂载改写了核心权威数据';
  const ce = appendAuthoritative(w, 'cap-calibration', PRIN, { eventType: 'facet:calibration-observed', payload: { cal: 'C-1' } });
  if (ce.refusal || ce.authorized !== true) return '内容事件签发通道异常：' + JSON.stringify(ce.refusal ?? ce);
  return null;
}

function run_T_P3() {
  const w = mkWorld();
  const bad = declareMount(w, 'cap-calibration', PRIN, { targetOid: 'O-core', binding: { mode: 'PINNED' } });
  if (bad.refusal?.code !== 'HARD_REF_NOT_PINNED') return '浮动 PINNED 未拒：' + JSON.stringify(bad);
  const ghost = declareMount(w, 'cap-calibration', PRIN, { targetOid: 'O-core', binding: { mode: 'PINNED', revisionRef: 99 } });
  if (ghost.refusal?.code !== 'NOT_FOUND_IN_SPACE') return '修订不存在未同形拒：' + JSON.stringify(ghost);
  const d = declareMount(w, 'cap-calibration', PRIN, { targetOid: 'O-core', binding: { mode: 'PINNED', revisionRef: 2 } });
  if (d.refusal) return 'PINNED 合法登记被拒：' + JSON.stringify(d.refusal);
  const miss = writeFacetRecord(w, 'cap-calibration', PRIN, { mountId: d.mountId, payload: {} });
  if (miss.refusal?.code !== 'HARD_REF_NOT_PINNED') return 'PINNED 行缺绑定未拒：' + JSON.stringify(miss);
  const mismatch = writeFacetRecord(w, 'cap-calibration', PRIN, { mountId: d.mountId, boundRevisionRef: 1, payload: {} });
  if (mismatch.refusal?.code !== 'CAPABILITY_SCOPE_ESCAPE' || mismatch.signal !== 'REFUSE_BINDING_MISMATCH') return '错绑未拒/信号错：' + JSON.stringify(mismatch);
  const okRow = writeFacetRecord(w, 'cap-calibration', PRIN, { mountId: d.mountId, boundRevisionRef: 2, payload: { claim: 'X' } });
  if (okRow.refusal) return '正绑被拒：' + JSON.stringify(okRow.refusal);
  if (!formalSlotAccepts(w, { facetRecordId: okRow.facetRecordId, boundRevisionRef: 2 })) return '检查输入槽位未接受合法绑定对';
  if (formalSlotAccepts(w, okRow.facetRecordId)) return '裸 FR 进了正式槽位（RF-05/06 违例）';
  if (!formalSlotAccepts(w, 'O-core@2')) return '合法 RevisionRef 被误拒';
  return null;
}

function run_T_P4() {
  const w = mkWorld();
  const d = declareMount(w, 'cap-calibration', PRIN, { targetOid: 'O-core', binding: { mode: 'NAVIGATION' } });
  const wf1 = writeFacetRecord(w, 'cap-calibration', PRIN, { mountId: d.mountId, payload: { v: 1 } });
  if (wf1.refusal || wf1.facetRevision !== 1) return '首写异常：' + JSON.stringify(wf1);
  const noAdmin = disableCapability(w, PRIN, 'cap-calibration');
  if (noAdmin.refusal?.code !== 'AUTHORITY_REQUIRED') return '非运维停用未拒：' + JSON.stringify(noAdmin);
  const mountsBefore = w.mounts.get(d.mountId).rows.length;
  const dis = disableCapability(w, PRIN_ADMIN, 'cap-calibration');
  if (dis.refusal) return '运维停用被拒：' + JSON.stringify(dis);
  const ev = w.ledger[w.ledger.length - 1];
  if (ev.event_type !== 'capability-disabled' || !gateFullShapeRoute(ev)) return '停用见证异常';
  if (w.mounts.get(d.mountId).rows.length !== mountsBefore || !mountActive(w, d.mountId)) return '卸载动了挂载态（违「卸载非撤销」）';
  const off = writeFacetRecord(w, 'cap-calibration', PRIN, { mountId: d.mountId, payload: { v: 2 } });
  if (off.refusal?.code !== 'CAPABILITY_INACTIVE') return '停用期写入未拒：' + JSON.stringify(off);
  enableCapability(w, PRIN_ADMIN, 'cap-calibration');
  const back = writeFacetRecord(w, 'cap-calibration', PRIN, { mountId: d.mountId, facetRecordId: wf1.facetRecordId, payload: { v: 2 } });
  if (back.refusal || back.facetRevision !== 2) return '恢复后挂载未续用：' + JSON.stringify(back);
  const un = unlinkMount(w, 'cap-calibration', PRIN, { mountId: d.mountId });
  if (un.refusal) return '解除被拒：' + JSON.stringify(un);
  const uev = w.ledger[w.ledger.length - 1];
  if (uev.event_type !== 'facet-unlinked' || !gateFullShapeMount(uev)) return '解除见证异常';
  if (mountActive(w, d.mountId)) return '解除后仍 ACTIVE';
  const afterUn = writeFacetRecord(w, 'cap-calibration', PRIN, { mountId: d.mountId, payload: {} });
  if (afterUn.refusal?.code !== 'CAPABILITY_SCOPE_ESCAPE' || afterUn.signal !== 'REFUSE_UNMOUNTED') return '解除后写入未拒：' + JSON.stringify(afterUn);
  if (w.facetRows.filter(r => r.mountId === d.mountId).length !== 2) return '历史扩展记录被删（不得删除历史）';
  const d2 = declareMount(w, 'cap-calibration', PRIN, { targetOid: 'O-core', binding: { mode: 'NAVIGATION' } });
  if (d2.refusal || d2.mountId === d.mountId) return '重挂未开新链：' + JSON.stringify(d2);
  const tr = transferRoute(w, PRIN_ADMIN, 'cap-calibration');
  if (tr.refusal) return '移交被拒：' + JSON.stringify(tr);
  const tev = w.ledger[w.ledger.length - 1];
  if (tev.event_type !== 'capability-transferred' || !gateFullShapeRoute(tev)) return '移交见证异常';
  const w2 = mkWorld(); // 移交不动挂载行的独立对拍（同一条链前后字节等）
  const m2 = declareMount(w2, 'cap-calibration', PRIN, { targetOid: 'O-core', binding: { mode: 'NAVIGATION' } });
  const snapA = JSON.stringify(w2.mounts.get(m2.mountId).rows);
  transferRoute(w2, PRIN_ADMIN, 'cap-calibration');
  if (JSON.stringify(w2.mounts.get(m2.mountId).rows) !== snapA) return '移交改写了挂载行';
  const okNewImpl = writeFacetRecord(w2, 'cap-calibration', PRIN, { mountId: m2.mountId, payload: { via: 'new-plugin' } });
  if (okNewImpl.refusal) return '同 CapabilityID 新实现写不通（挂载应随 CapabilityID）：' + JSON.stringify(okNewImpl);
  return null;
}

function run_T_P5() {
  const w = mkWorld();
  const before = pluginVisibleResponse(w);
  declareMount(w, 'cap-calibration', PRIN, { targetOid: 'O-core', binding: { mode: 'NAVIGATION' } });
  writeFacetRecord(w, 'cap-calibration', PRIN, { mountId: [...w.mounts.keys()][0], payload: { calibration: 'C-1' } });
  const after = pluginVisibleResponse(w);
  if (before !== after) return '他人挂载改变了属主读面字节（存在性 oracle）';
  if (listOwnMounts(w, 'cap-records').length !== 0) return '属主侧看到了他人挂载';
  const own = listOwnMounts(w, 'cap-calibration');
  if (own.length !== 1 || own[0].targetOid !== 'O-core') return '挂载方 own 面异常：' + JSON.stringify(own);
  if (after.includes('FM-') || after.includes('facet-mounted')) return '挂载信息出现在插件响应';
  return null;
}

function run_T_P6() {
  const w = mkWorld({ listed: false });
  const d = declareMount(w, 'cap-calibration', PRIN, { targetOid: 'O-core', binding: { mode: 'NAVIGATION' } });
  const wf = writeFacetRecord(w, 'cap-calibration', PRIN, { mountId: 'FM-1', payload: {} });
  const un = unlinkMount(w, 'cap-calibration', PRIN, { mountId: 'FM-1' });
  if (d.refusal?.code !== 'ACTIVATION_IMPOSSIBLE' || wf.refusal?.code !== 'ACTIVATION_IMPOSSIBLE' || un.refusal?.code !== 'ACTIVATION_IMPOSSIBLE') return '未入账未 fail-closed';
  if (w.mounts.size !== 0 || w.ledger.length !== 0) return '未入账阶段有残留行';
  return null;
}

function run_T_P7() {
  const w = mkWorld();
  const d = declareMount(w, 'cap-calibration', PRIN, { targetOid: 'O-core', binding: { mode: 'NAVIGATION' } });
  const t1 = auditQuery(w, PRIN_ADMIN, { op: 'state-row-write', cap: 'cap-calibration', oid: 'O-core2' });
  const t2 = auditQuery(w, PRIN_ADMIN, { op: 'core-revise', cap: 'cap-calibration', oid: 'O-core' });
  const t3 = auditQuery(w, PRIN_ADMIN, { op: 'state-row-write', cap: 'cap-calibration', oid: 'O-core' });
  if (t1 !== 'UNMOUNTED' || t2 !== 'NO_RIGHT' || t3 !== 'MOUNT_ACTIVE') return '真因复算面不可区分：' + [t1, t2, t3].join('/');
  if (auditQuery(w, PRIN, { op: 'state-row-write', cap: 'cap-calibration', oid: 'O-core2' }) !== null) return '插件面有审计入口';
  const resp = pluginVisibleResponse(w);
  if (['UNMOUNTED', 'NO_RIGHT', 'MOUNT_ACTIVE'].some(t => resp.includes(t))) return '真因词泄漏到对外字节';
  void d;
  return null;
}

function run_T_N1() {
  const w = mkWorld();
  const n0 = { dir: w.dir.size, rows: w.facetRows.length, ledger: w.ledger.length, mounts: w.mounts.size };
  const r = legacyWrite(w, 'cap-calibration', PRIN, { ns: OWN_NS('cap-calibration'), oid: 'O-core', revision: 9, payload: { forged: true }, eventType: null });
  if (r.ok) return '无挂载伪造行被放行（Q45 反例失守）';
  if (r.refusal.code !== 'CAPABILITY_SCOPE_ESCAPE' || r.signal !== 'REFUSE_UNMOUNTED') return '拒形/信号错：' + JSON.stringify(r);
  if (w.dir.size !== n0.dir || w.facetRows.length !== n0.rows || w.ledger.length !== n0.ledger || w.mounts.size !== n0.mounts) return '有残留';
  return null;
}

function run_T_N2() {
  const w = mkWorld();
  const d = declareMount(w, 'cap-calibration', PRIN, { targetOid: 'O-core', binding: { mode: 'NAVIGATION' } });
  const self = writeFacetRecord(w, 'cap-calibration', PRIN, { mountId: d.mountId, newFacetRecordId: 'FR-0', payload: {} });
  if (self.refusal?.code !== 'CAPABILITY_SCOPE_ESCAPE' || self.refusal.detail.reason !== 'input-carries-id-field') return '自带 id 未拒：' + JSON.stringify(self);
  const preId = declareMount(w, 'cap-calibration', PRIN, { targetOid: 'O-core', binding: { mode: 'NAVIGATION' }, mountId: 'FM-0' });
  if (preId.refusal?.code !== 'CAPABILITY_SCOPE_ESCAPE' || preId.refusal.detail.reason !== 'input-carries-id-field') return '自带 mountId 未拒：' + JSON.stringify(preId);
  const rr = declareWithOwnId('FR-7'); const rr2 = declareWithOwnId('FM-7');
  if (rr.refusal?.code !== 'RECORD_ID_RESERVED' || rr2.refusal?.code !== 'RECORD_ID_RESERVED') return '保留前缀未收归机制';
  if (formalSlotAccepts(w, 'FR-1')) return 'FR 冒充科研对象 ID 被正式槽接受（RF-05/06 违例）';
  if (!formalSlotAccepts(w, 'O-core@2')) return '合法对象引用被误拒';
  const wf = writeFacetRecord(w, 'cap-calibration', PRIN, { mountId: d.mountId, facetRecordId: 'FR-999', payload: {} });
  if (wf.refusal?.code !== 'NOT_FOUND_IN_SPACE') return '引用不存在记录未同形拒：' + JSON.stringify(wf);
  return null;
}

function run_T_N3() {
  // 两个平行世界、同一目标名：A 中该 oid 不存在；B 中存在但对调用方不可见 ⇒ 响应必须逐字节等（E-01 不放大）
  const wA = mkWorld(); // O-ghost 不存在
  const wB = mkWorld(); // O-ghost 存在但无可见权
  wB.dir.set('O-ghost', { owner: 'cap-records', head: 1, revs: [1], payload: { secret: true } });
  wB.invisibleToCaller.add('O-ghost');
  const a = declareMount(wA, 'cap-calibration', PRIN, { targetOid: 'O-ghost', binding: { mode: 'NAVIGATION' } });
  const b = declareMount(wB, 'cap-calibration', PRIN, { targetOid: 'O-ghost', binding: { mode: 'NAVIGATION' } });
  if (a.refusal?.code !== 'NOT_FOUND_IN_SPACE' || b.refusal?.code !== 'NOT_FOUND_IN_SPACE') return '两世界未走同码';
  if (JSON.stringify(a.refusal) !== JSON.stringify(b.refusal)) return '两世界不同形：' + JSON.stringify([a.refusal, b.refusal]);
  if (wA.mounts.size !== 0 || wB.mounts.size !== 0) return '同形路径有残留';
  // 对偶不变式：不可见的存在不改变读面字节（wB ≡ 基线世界）
  if (pluginVisibleResponse(wB) !== pluginVisibleResponse(mkWorld())) return '不可见存在改变了读面（oracle 泄漏）';
  return null;
}

function run_T_N4() {
  const w = mkWorld();
  const d = declareMount(w, 'cap-calibration', PRIN, { targetOid: 'O-core', binding: { mode: 'NAVIGATION' } });
  const head0 = w.dir.get('O-core').head;
  const r = writeFacetRecord(w, 'cap-calibration', PRIN, { mountId: d.mountId, coreRevisionOverride: 99, payload: {} });
  if (r.refusal?.code !== 'CAPABILITY_SCOPE_ESCAPE' || r.refusal.detail.reason !== 'input-carries-core-override') return '核心改写位未拒：' + JSON.stringify(r);
  if (w.dir.get('O-core').head !== head0) return '核心 head 被动';
  const PORT_METHODS = ['declareMount', 'unlinkMount', 'mountState', 'listOwnMounts', 'writeFacetRecord'];
  const CORE_WORDS = ['revise', 'reviseCore', 'reclassifyKind', 'setCoreRevision', 'overwriteCore', 'writeCorePayload'];
  const hit = PORT_METHODS.filter(m => CORE_WORDS.some(cw => m.toLowerCase().includes(cw.toLowerCase())));
  if (hit.length !== 0) return 'facet 面存在核心改写方法：' + hit.join(',');
  return null;
}

function run_T_N5() {
  const pre = mkWorld({ listed: false });
  const a = genericAppend(pre, PRIN, 'facet-mounted', 'appendLedger');
  if (a.refusal?.code !== 'EVENT_AUTHORITY_REQUIRED' || a.refusal.detail.classification !== 'unregistered') return '入账前 mint 未按 unregistered 拒：' + JSON.stringify(a);
  const post = mkWorld();
  const b = genericAppend(post, PRIN, 'facet-mounted', 'appendLedger');
  if (b.refusal?.code !== 'EVENT_AUTHORITY_REQUIRED' || b.refusal.detail.classification !== 'mechanism') return '入账后 mint 未按 mechanism 拒：' + JSON.stringify(b);
  const c = genericAppend(post, PRIN, 'facet:calibration-observed', 'appendLedger');
  if (c.refusal?.code !== 'EVENT_AUTHORITY_REQUIRED' || c.refusal.detail.classification !== 'domain') return '域事件走通用通道未拒：' + JSON.stringify(c);
  for (const op of ['insert-bare', 'update', 'delete']) {
    const rr = rawMountRowOp(op);
    const want = op === 'insert-bare' ? 'MOUNT_AUDIT_REQUIRED' : 'MOUNT_ROW_FROZEN';
    if (rr.refusal !== want) return '裸操作 ' + op + ' 未拒：' + JSON.stringify(rr);
  }
  if (post.mounts.size !== 0) return '绕行产生了挂载行';
  if (pre.mounts.size !== 0 || pre.ledger.length !== 0) return '入账前 mint 有残留';
  return null;
}

function run_T_N6() {
  const w = mkWorld();
  const r = declareMount(w, 'cap-calibration', PRIN_NOAXIS, { targetOid: 'O-core', binding: { mode: 'NAVIGATION' } });
  if (r.refusal?.code !== 'AUTHORITY_REQUIRED') return '缺轴未拒：' + JSON.stringify(r);
  if (w.mounts.size !== 0 || w.ledger.length !== 0) return '幽灵审计：缺轴路径出现了行';
  return null;
}

function run_T_N7() {
  const w = mkWorld();
  const d = declareMount(w, 'cap-calibration', PRIN, { targetOid: 'O-core', binding: { mode: 'NAVIGATION' } });
  const wf = writeFacetRecord(w, 'cap-calibration', PRIN, { mountId: d.mountId, payload: { used_in: 'E-1' } });
  if (wf.refusal) return '机制语义误炸（不该拦的拦了）：' + JSON.stringify(wf.refusal);
  const snap = JSON.parse(pluginVisibleResponse(w));
  if (snap.core['O-core'].stateRows.length !== 0) return '扩展行混入核心状态视图（FM-5.2 违例）';
  const lk = linkOwnedFacet(w, 'cap-calibration', { oid: 'O-core', rev: 3 }, 'used_in');
  if (lk.refusal?.code !== 'CAPABILITY_SCOPE_ESCAPE') return '扩展认领核心边未被拒：' + JSON.stringify(lk);
  const before = JSON.stringify(w.dir.get('O-core').payload);
  const verdict = runXc28Check(w, 'cap-calibration');
  if (verdict !== 'NOT_ACHIEVED') return '领域检查未报 NOT_ACHIEVED：' + verdict;
  if (JSON.stringify(w.dir.get('O-core').payload) !== before) return '检查报告反写了核心';
  return null;
}

function run_T_N8() {
  const w = mkWorld();
  const A = legacyWrite(w, 'cap-calibration', PRIN, { ns: OWN_NS('cap-calibration'), oid: 'O-core2', revision: 1, payload: {}, eventType: null });
  const B = reviseCore(w, 'cap-calibration', PRIN, 'O-core2', {});
  if (!A.refusal || !B.refusal) return '双源未都拒：' + JSON.stringify([A, B]);
  if (JSON.stringify(A.refusal) !== JSON.stringify(B.refusal)) return '未挂载与越权不同形：' + JSON.stringify([A.refusal, B.refusal]);
  const keys = Object.keys(B.refusal.detail).sort().join(',');
  if (keys !== 'capability,oid') return 'detail 键集非封闭：' + keys;
  const wire = JSON.stringify([A.refusal, B.refusal]) + pluginVisibleResponse(w);
  if (wire.includes('REFUSE_UNMOUNTED') || wire.includes('REFUSE_BINDING_MISMATCH')) return '内部信号词出现在对外字节';
  return null;
}

function run_T_P8() { // R-2：挂载见证行走 EA-4.5 ③ 支的覆盖式谓词；名册轴是判据的一半
  const w = mkWorld();
  const d = declareMount(w, 'cap-calibration', PRIN, { targetOid: 'O-core', binding: { mode: 'NAVIGATION' } });
  if (d.refusal) return 'declare 被拒：' + JSON.stringify(d.refusal);
  const led = w.ledger.find(l => l.event_type === 'facet-mounted');
  if (!led) return '无挂载见证行';
  if (gateFullShapeMount(led) !== true) return '③ 支未放行合法挂载见证行（R-2 未落实）';
  // 串轴（挂载名挂到路由轴）⇒ 真判据必拒
  if (gateFullShapeMount({ ...led, authority_basis: { ...led.authority_basis, axis: 'capability-admin' } }) !== false) return '挂载名串用路由轴未被拦';
  // 覆盖性：新机制名 + 新机制轴入账 ⇒ 判据一字不改即覆盖（点名清单式判据在此会失守）
  MODEL_PLANNED.push('facet-quarantined'); MECHANISM_AXIS_OF['facet-quarantined'] = 'facet-quarantine';
  MECH_AXES.add('facet-quarantine');
  let covered = false;
  try {
    covered = gateFullShapeMount({ event_type: 'facet-quarantined', actor: 'ops:root', capability: 'cap-calibration',
      authority_basis: { ctxId: 'c', actor: 'ops:root', capability: 'cap-calibration', axis: 'facet-quarantine',
        authorized: true, ruleSetVersion: 'r1', contractVersion: 'v3', issuedAtMs: 1, txSeq: 1 } }) === true;
  } finally {
    MODEL_PLANNED.pop(); delete MECHANISM_AXIS_OF['facet-quarantined']; MECH_AXES.delete('facet-quarantine');
  }
  if (!covered) return '③ 不是覆盖式：新机制轴/名入账后必须改判据 = 违例';
  return null;
}
function run_T_N9() { // R-1：普通响应面出现 hiddenBy* 遮蔽计数 ⇒ 判红（旧形态 echo 键就是违例）
  const w = mkWorld();
  const good = pluginVisibleResponse(w);
  if (callerSurfaceFreeOfShadowCounters(good) !== true) return '新形态被误判：' + good;
  const leak = pluginVisibleResponseSuperseded(w);
  if (!leak.includes('hiddenByContractSkew')) return '负例构造失效';
  if (callerSurfaceFreeOfShadowCounters(leak) !== false) return '泄漏体未被判据点名';
  if (callerSurfaceFreeOfShadowCountersMUT4(leak) !== true) return 'MUT-4 竟能点名——判据对架空失去判别力';
  return null;
}

// ============================================================ 变异自验（架空判据必须被捕获）

(function mutChecks() {
  // MUT-1：行形态判据（=D-24 现状）必须放过 T-N1 的负例 ⇒ 挂载判据有判别力
  {
    const w = mkWorld();
    const real = legacyWrite(w, 'cap-calibration', PRIN, { ns: OWN_NS('cap-calibration'), oid: 'O-core2', revision: 1, payload: { forged: true }, eventType: null });
    const mut = legacyWrite(mkWorld(), 'cap-calibration', PRIN, { ns: OWN_NS('cap-calibration'), oid: 'O-core2', revision: 1, payload: { forged: true }, eventType: null }, 'MUT1-rowshape');
    check('MUT-1 判别力：真实挂载判据拦下无挂载伪造行；架空行形态判据放过同一负例', !!real.refusal && !!mut.ok);
  }
  // MUT-2：卸载即撤销 ⇒ T-P4 的「卸载非撤销」在该判据下必红 ⇒ 用例有判别力
  {
    const w = mkWorld();
    const d = declareMount(w, 'cap-calibration', PRIN, { targetOid: 'O-core', binding: { mode: 'NAVIGATION' } });
    disableCapabilityMUT2(w, PRIN_ADMIN, 'cap-calibration');
    enableCapability(w, PRIN_ADMIN, 'cap-calibration');
    const back = writeFacetRecord(w, 'cap-calibration', PRIN, { mountId: d.mountId, payload: { v: 2 } });
    const realW = mkWorld();
    const rd = declareMount(realW, 'cap-calibration', PRIN, { targetOid: 'O-core', binding: { mode: 'NAVIGATION' } });
    disableCapability(realW, PRIN_ADMIN, 'cap-calibration'); enableCapability(realW, PRIN_ADMIN, 'cap-calibration');
    const realBack = writeFacetRecord(realW, 'cap-calibration', PRIN, { mountId: rd.mountId, payload: { v: 2 } });
    check('MUT-2 判别力：架空「卸载即撤销」使恢复后写入被拒（T-P4 会红）；真实判据下仍通', !!back.refusal && !realBack.refusal);
  }
  // MUT-4：R-1 的呈现面判据架空形（只核审计事件名字样）必须放过旧形态泄漏体
  {
    const w = mkWorld();
    const leak = pluginVisibleResponseSuperseded(w);
    check('MUT-4 判别力：真判据拦下旧形态 hiddenBy* 泄漏；架空「只核审计事件名」放过同一泄漏体',
      callerSurfaceFreeOfShadowCounters(leak) === false && callerSurfaceFreeOfShadowCountersMUT4(leak) === true);
  }
  // MUT-3：见证脱钩 ⇒ 对账器点名孤儿挂载链；原子形态零孤儿
  {
    const w = mkWorld();
    declareMount(w, 'cap-calibration', PRIN, { targetOid: 'O-core', binding: { mode: 'NAVIGATION' } }, 'MUT3-decoupled');
    const orphans = reconcileMountWitnesses(w);
    const w2 = mkWorld();
    declareMount(w2, 'cap-calibration', PRIN, { targetOid: 'O-core', binding: { mode: 'NAVIGATION' } });
    unlinkMount(w2, 'cap-calibration', PRIN, { mountId: 'FM-1' });
    check('MUT-3 判别力：见证脱钩产出无见证挂载链被点名；同事务原子形态对账干净',
      orphans.length === 1 && orphans[0] === 'FM-1:gen1' && reconcileMountWitnesses(w2).length === 0);
  }
})();

// ============================================================ 运行表驱动用例 + 收尾

const CASES = [
  ['T-P1', '跨 Capability 合法挂载 + 双身份 + 快照 + 核心再修订不改写解释', run_T_P1],
  ['T-P2', 'Q45 护栏三断言形状对拍 + 内容事件走签发 Port', run_T_P2],
  ['T-P3', 'PINNED 精确绑定 / 浮动与错绑各拒 / 正式槽位形状', run_T_P3],
  ['T-P4', '三操作各走各路（卸载≠撤销≠解除≠移交）+ 移交不动挂载行', run_T_P4],
  ['T-P5', '挂载对属主读面零差分（非 oracle）+ own 面只见自己', run_T_P5],
  ['T-P6', '未入账装配红 fail-closed 零残留', run_T_P6],
  ['T-P7', '内部审计真因可区分（UNMOUNTED/NO_RIGHT/MOUNT_ACTIVE）插件零入口', run_T_P7],
  ['T-P8', 'R-2 依赖兑现：挂载见证走 EA-4.5 ③ 覆盖式谓词 + 名册轴绑定 + 新机制轴入账零改判据', run_T_P8],
  ['T-N1', '无挂载伪造核心修订必拒零残留（EA T-N1 引用形状承接）', run_T_N1],
  ['T-N2', '身份冒充三连（自带 id / 保留前缀 / FR 进正式槽）各拒', run_T_N2],
  ['T-N3', '目标不存在 vs 无可见权 declare 逐字节同形', run_T_N3],
  ['T-N4', '核心改写位结构拒 + facet 面核心改写方法枚举空集', run_T_N4],
  ['T-N5', 'planned 名通用通道 mint 两阶段必拒 + 裸插触发面拒', run_T_N5],
  ['T-N6', '缺 facet-mount 轴 = AUTHORITY_REQUIRED 且零幽灵审计行', run_T_N6],
  ['T-N7', '第二真源三面：机制零误炸 + 不入核心快照 + 不认领核心边 + 报告可落', run_T_N7],
  ['T-N8', '未挂载 vs 越权：同一响应面逐字节等 + 信号词零对外', run_T_N8],
  ['T-N9', 'R-1 同步：普通响应面出现 hiddenBy* 遮蔽计数 ⇒ 判红（旧形态 echo 键 = 违例）', run_T_N9],
];
for (const [id, desc, fn] of CASES) {
  let r = null;
  try { r = fn(); } catch (e) { r = '夹具异常：' + e.message; }
  check(id + ' ' + desc, r === null, r === null ? '' : r);
}

process.stdout.write('\n合计 ' + (pass + fail) + ' 项：PASS ' + pass + ' / FAIL ' + fail + '\n');
if (fail > 0) { process.stdout.write('未通过项：\n  ' + fails.join('\n  ') + '\n'); process.exitCode = 1; }
else process.exitCode = 0;
