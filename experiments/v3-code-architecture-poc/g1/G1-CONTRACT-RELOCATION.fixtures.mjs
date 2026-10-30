#!/usr/bin/env node
/*
  G1-CONTRACT-RELOCATION.fixtures.mjs —— 与 G1-CONTRACT-RELOCATION.md 互相对账的夹具。

  用法：node experiments/v3-code-architecture-poc/g1/G1-CONTRACT-RELOCATION.fixtures.mjs
  退出码：0 = 契约结构自洽 + 正反例全命中 + 五条「架空判据必红」变异自验全部捕获；
          1 = 有任一项 FAIL；2 = 夹具自身无法运行（缺文件等）。

  纪律：
  - 零依赖（只用 node:fs / node:path / node:crypto），可直接 node 跑；不起数据库、不跑 PoC、不写生产代码。
  - 这里实现的是**契约判据的最小模型**（重定位账 / 触发器改造 / 链前缀完备 / 门清单 / 打开扫描 /
    修复流 / 陈旧窗 / RL-INFO 单一构造器），不是机制实现；判据语义逐条对应契约正文 RL-* 小节。
  - 变异纪律：MUT-* 架空判据**常驻本文件不删除**（照仓内「架空不删除」先例）；每条自验方向固定——
    真实判据必须拦住对应负例，架空判据必须放过同一负例（否则该负例对「架空」没有判别力）。
    还原方式：MUT 函数从不替换真实函数；真实判据恒为主路径唯一调用者，MUT 仅在自验断言分支旁路调用。
*/

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(HERE, 'G1-CONTRACT-RELOCATION.md');
const SELF_PATH = fileURLToPath(import.meta.url);
const SELF_SRC = readFileSync(SELF_PATH, 'utf8');
const EVT_PATH = join(HERE, 'G1-CONTRACT-EVENT-AUTHORITY.md');
const REFUSAL_CODES_PATH = join(HERE, '..', 'src', 'contracts', 'index.ts');

let doc = '';
try { doc = readFileSync(CONTRACT_PATH, 'utf8'); }
catch (e) { process.stderr.write('FATAL: 读不到契约正文 ' + CONTRACT_PATH + '：' + e.message + '\n'); process.exit(2); }
let evt = '';
try { evt = readFileSync(EVT_PATH, 'utf8'); }
catch (e) { process.stderr.write('FATAL: 读不到事件契约 ' + EVT_PATH + '：' + e.message + '\n'); process.exit(2); }

let pass = 0, fail = 0; const fails = [];
function check(name, cond, detail) {
  if (cond) { pass += 1; process.stdout.write('PASS  ' + name + '\n'); }
  else { fail += 1; fails.push(name); process.stdout.write('FAIL  ' + name + (detail ? '  —— ' + detail : '') + '\n'); }
}

// ============================================================ 判据常量（与契约互认）

const MECHANISM = ['capability-enabled', 'capability-disabled', 'capability-transferred',
  'object-registered', 'check-report-recorded', 'object-revised', 'record-backfilled',
  'raw-record-declared', 'integrity-audit-recorded', 'read-shadow-recorded', 'ns-relocated']; // 本契约自裁（RL-2.2）
const NS_RELOC = 'ns-relocated';
const NS_SHAPE_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
// RL-4 门清单封闭集（三方逐等之三：契约正文 ↔ 本模型 ↔ 触发器/执行调用点）
const GATES = ['AUTHORITY', 'ROUTE_STATE', 'NS_SHAPE', 'TARGET_UNCLAIMED', 'TARGET_EMPTY',
  'SOURCE_PARSEABLE', 'CONTENT_DIGEST', 'NO_INFLIGHT', 'CHAIN_INTACT', 'EPOCH_STABLE'];
const RELOC_STATES = ['PROPOSED', 'APPROVED', 'PRECHECKED', 'COMMITTED', 'REJECTED', 'ABANDONED',
  'REPAIR_PROPOSED', 'REPAIR_APPROVED', 'REPAIRED', 'QUARANTINED', 'PERMANENTLY_QUARANTINED'];
const RELOC_TERMINAL = new Set(['COMMITTED', 'REJECTED', 'ABANDONED', 'REPAIRED', 'PERMANENTLY_QUARANTINED']);
// 故障矩阵 id（S4 双向逐等）
const FAULT_MATRIX = ['F-01', 'F-02', 'F-03', 'F-04', 'F-05', 'F-06', 'F-07', 'F-08', 'F-09',
  'F-10', 'F-11', 'F-12', 'F-13', 'F-14', 'F-15', 'F-16', 'F-17', 'F-18'];

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const canonical = (rows) => JSON.stringify(rows.slice().sort((a, b) =>
  a.oid < b.oid ? -1 : a.oid > b.oid ? 1 : a.revision - b.revision)
  .map(r => [r.oid, r.revision, r.payload_json, r.recorded_seq, r.contract_version]));
const contentDigestOf = (world, ns) => 'sha256:' + sha256(canonical(world.domain_state.filter(r => r.ns === ns)));
const driftDigestOf = (world, cap) => {
  const pairs = [];
  for (const d of world.object_directory.values()) {
    if (d.owner_capability !== cap) continue;
    const r = world.capability_route.get(cap);
    if (r && r.ns !== d.ns) pairs.push([d.oid, d.ns, r.ns]);
  }
  return 'sha256:' + sha256(JSON.stringify(pairs.sort()));
};

class Refusal { constructor(code, detail) { this.code = code; this.detail = detail || {}; } }

// RL-INFO：普通调用者拒答体的**唯一构造器**（三处 fail-loud 共用一个 ⇒ 实现无法拆成两处）
function callerBodyFor(code) { return JSON.stringify({ code, echo: { hiddenByContractSkew: 0 } }); }

// 机制内部直写的信封（全形，RL-5.4 / EA-4.5）——只有内部通道能产出，界外伪造走 rawLedgerInsert
function sealedEnvelope(by, cap) {
  return JSON.stringify({ axis: 'capability-admin', capability: cap,
    authorized: by.capabilityAdmin === true ? 1 : 0, actor: by.actorId,
    ruleSetVersion: 'r1', contractVersion: 'v3', truthSource: 'mechanism',
    entry: 'relocateNamespace', issuedSeq: null });
}

// 世界工厂
function mkWorld(opts = {}) {
  const w = {
    object_directory: new Map(), capability_route: new Map(), domain_state: [],
    records: new Map(), journal: [], ledger: [], meta: { ledger_seq: 0, ns_epoch: opts.nsEpoch ?? 0 },
    proposals: new Map(), relocSteps: [], committed: new Map(), quarantine: new Map(),
  };
  return w;
}
function addRoute(w, cap, ns, pluginId = 'plg-' + cap, cv = 'v1', enabled = 1) {
  w.capability_route.set(cap, { capability: cap, plugin_id: pluginId, ns, contract_version: cv, enabled, changed_seq: null });
}
function addObject(w, oid, cap, ns, createdSeq) {
  w.object_directory.set(oid, { oid, space: 'S', kind: 'ENTITY', owner_capability: cap, ns, created_seq: createdSeq });
}
function addState(w, ns, oid, rev, payload, recordedSeq, cv = 'v1') {
  w.domain_state.push({ ns, oid, revision: rev, payload_json: JSON.stringify(payload), recorded_seq: recordedSeq, contract_version: cv });
}

// append-only 触发器面（P-07 同文件实测）
function ledgerAppend(w, row) { row.seq = ++w.meta.ledger_seq; w.ledger.push(row); return row; }
function ledgerUpdateAttempt() { throw new Refusal('HISTORY_IMMUTABLE'); }   // ledger_no_update
function ledgerDeleteAttempt() { throw new Refusal('HISTORY_IMMUTABLE'); }   // ledger_no_delete（伪造痕迹不可删）
function directoryUpdateAttempt() { throw new Refusal('DIRECTORY_IDENTITY_FROZEN'); }  // directory_no_update
// 界外：裸 INSERT 允许（无 ledger_no_insert 触发器）——T-N16 用
function rawLedgerInsert(w, row) { row.seq = ++w.meta.ledger_seq; w.ledger.push(row); return row; }

// 通用台账通道预留闸（EA-2）：机制名 mint 即拒
function genericAppend(w, eventType) { if (MECHANISM.includes(eventType)) throw new Refusal('EVENT_AUTHORITY_REQUIRED', { classification: 'mechanism' }); return ledgerAppend(w, { event_type: eventType, actor: null, authority_basis: null, payload_json: '{}', object_id: null }); }

// 移交（RL-5.3：永不携 ns）
function transferRoute(w, cap, to) {
  const cur = w.capability_route.get(cap);
  if (to.storageNamespace !== cur.ns) throw new Refusal('TRANSFER_NS_DRIFT', { capability: cap, currentNs: cur.ns, declaredNs: to.storageNamespace });
  cur.plugin_id = to.pluginId;
}

// ---- 链（RL-6.5）：链源 = ledger 的 ns-relocated 行（异源于任何可改工作流账） ----
function chainOf(w, cap) {
  return w.ledger.filter(l => l.event_type === NS_RELOC && (() => { try { return JSON.parse(l.payload_json).capability === cap; } catch { return false; } })())
    .map(l => { const p = JSON.parse(l.payload_json); return [p.fromNs, p.toNs, l.authority_basis]; });
}
// 真实判据：前缀完备（起点 = 出生 ns，逐跳衔接，终点 = 当前路由 ns）+ 每跳信封全形
function chainCheck(chain, birthNs, routeNs, sealed) {
  if (birthNs === routeNs) return true;
  const byFrom = new Map();
  for (const [f, t, env] of chain) { if (!sealed(env)) return false; if (!byFrom.has(f)) byFrom.set(f, t); }
  let cur = birthNs, guard = 0;
  while (guard++ < 100) { const nxt = byFrom.get(cur); if (nxt == null || nxt === cur) return false; if (nxt === routeNs) return true; cur = nxt; }
  return false;
}
// MUT-1 架空链：只要存在以 routeNs 为终点的一跳就放行（忽略出生前缀）
function chainCheckMUT1(chain, birthNs, routeNs) {
  if (birthNs === routeNs) return true;
  return chain.some(([, t]) => t === routeNs);
}
const envelopeSealed = (env) => { try { const e = JSON.parse(env); return e && e.axis === 'capability-admin' && e.authorized === 1 && typeof e.actor === 'string'; } catch { return false; } };

// 读归属（RL-6.5 + RL-7.3 陈旧窗，共用同一构造器出拒答体）
function readSnapshot(w, oid, readerEpoch) {
  const dir = w.object_directory.get(oid);
  if (!dir) return { refusal: 'NOT_FOUND_IN_SPACE' };
  const r = w.capability_route.get(dir.owner_capability);
  if (!r || !r.enabled) return { refusal: 'CAPABILITY_INACTIVE' };
  if (readerEpoch != null && readerEpoch !== w.meta.ns_epoch) return { refusal: 'SCHEMA_INCOMPATIBLE', caller: callerBodyFor('SCHEMA_INCOMPATIBLE'), why: 'stale-epoch' };
  if (r.ns !== dir.ns) { const chain = chainOf(w, dir.owner_capability); if (!chainCheck(chain, dir.ns, r.ns, envelopeSealed)) return { refusal: 'SCHEMA_INCOMPATIBLE', caller: callerBodyFor('SCHEMA_INCOMPATIBLE'), why: 'no-chain' }; }
  return { rows: w.domain_state.filter(s => s.ns === r.ns && s.oid === oid) };
}

// ---- 触发器 route_change_guarded 改造（RL-5.2）；opts 旁路 = MUT ----
function routeGuard(w, cap, patch, opts = {}) {
  const old = w.capability_route.get(cap);
  if (!old) return { abort: 'ROUTE_NOT_FOUND' };
  const nw = { ...old, ...patch };
  if (old.changed_seq != null && (nw.changed_seq == null || nw.changed_seq <= old.changed_seq)) return { abort: 'ROUTE_CHANGED_SEQ_MONOTONICITY' };
  const nsChanged = old.ns !== nw.ns;
  const enabledChanged = old.enabled !== nw.enabled;
  const implChanged = old.plugin_id !== nw.plugin_id || old.contract_version !== nw.contract_version;
  if (!opts.skipSplit && nsChanged && (enabledChanged || implChanged)) return { abort: 'ROUTE_RELOC_SPLIT_REQUIRED' };  // 拆单判据（MUT-5）
  const audit = w.ledger.find(l => l.seq === nw.changed_seq);
  if (!opts.skipAuditName) { // 子句②：白名单 + actor 非空 + 全形信封 + payload.capability 字面（MUT-2 整块旁路）
    if (!audit) return { abort: 'ROUTE_AUDIT_REQUIRED' };
    const WL = ['capability-enabled', 'capability-disabled', 'capability-transferred', NS_RELOC];
    if (!WL.includes(audit.event_type) || audit.actor == null) return { abort: 'ROUTE_AUDIT_REQUIRED' };
    let env, pl; try { env = JSON.parse(audit.authority_basis); pl = JSON.parse(audit.payload_json); } catch { return { abort: 'ROUTE_AUDIT_REQUIRED' }; }
    if (!env || env.axis !== 'capability-admin' || env.capability !== nw.capability || env.authorized !== 1) return { abort: 'ROUTE_AUDIT_REQUIRED' };
    if (!pl || pl.capability !== nw.capability) return { abort: 'ROUTE_AUDIT_REQUIRED' };
  } else if (!audit) return { abort: 'ROUTE_AUDIT_REQUIRED' };
  if (enabledChanged) { const want = nw.enabled ? 'capability-enabled' : 'capability-disabled'; if (audit.event_type !== want) return { abort: 'ROUTE_AUDIT_REQUIRED' }; }
  if (implChanged && !nsChanged && audit.event_type !== 'capability-transferred') return { abort: 'ROUTE_AUDIT_REQUIRED' };
  if (nsChanged && !opts.skipLoc) { // 子句③新增：ns 变化必配 ns-relocated 且 fromNs/toNs 字面相符（MUT-4）
    if (audit.event_type !== NS_RELOC) return { abort: 'ROUTE_AUDIT_REQUIRED' };
    let pl; try { pl = JSON.parse(audit.payload_json); } catch { return { abort: 'ROUTE_AUDIT_REQUIRED' }; }
    if (!pl || pl.fromNs !== old.ns || pl.toNs !== nw.ns) return { abort: 'ROUTE_AUDIT_REQUIRED' };
  }
  return { ok: true, nw };
}
const routeGuardMUT2 = (w, cap, patch) => routeGuard(w, cap, patch, { skipAuditName: true });
const routeGuardMUT4 = (w, cap, patch) => routeGuard(w, cap, patch, { skipLoc: true });
const routeGuardMUT5 = (w, cap, patch) => routeGuard(w, cap, patch, { skipSplit: true });
function routeUpdate(w, cap, patch) { const g = routeGuard(w, cap, patch); if (g.abort) throw new Refusal(g.abort); w.capability_route.set(cap, g.nw); }

// ---- 门清单（RL-4）；ctx: {capability, expectedFromNs, toNs, contentDigest, epoch} ----
function assertAdmin(by) { if (by.capabilityAdmin !== true) throw new Refusal('AUTHORITY_REQUIRED'); }
function runGate(g, w, p, by) {
  const r = w.capability_route.get(p.capability);
  switch (g) {
    case 'AUTHORITY': assertAdmin(by); return null;
    case 'ROUTE_STATE': if (!r || !r.enabled) return 'ROUTE_STATE'; if (r.ns !== p.expectedFromNs) return 'ROUTE_STATE'; if (p.toNs === p.expectedFromNs) return 'ROUTE_STATE'; return null;
    case 'NS_SHAPE': return NS_SHAPE_RE.test(p.toNs) ? null : 'NS_SHAPE';
    case 'TARGET_UNCLAIMED': for (const x of w.capability_route.values()) if (x.ns === p.toNs) return 'TARGET_UNCLAIMED'; return null;
    case 'TARGET_EMPTY': return w.domain_state.some(s => s.ns === p.toNs) ? 'TARGET_EMPTY' : null;
    case 'SOURCE_PARSEABLE': for (const s of w.domain_state.filter(s => s.ns === p.fromNs)) { try { JSON.parse(s.payload_json); } catch { return 'SOURCE_PARSEABLE'; } } return null;
    case 'CONTENT_DIGEST': return null;
    case 'NO_INFLIGHT': { const infl = p.capability && [...w.proposals.values()].some(x => x.capability === p.capability && x.id !== p.id && !RELOC_TERMINAL.has(latest(w, x.id)?.state)); return infl ? 'NO_INFLIGHT' : null; }
    case 'CHAIN_INTACT': { const chain = chainOf(w, p.capability); if (!r) return 'ROUTE_STATE'; for (const d of w.object_directory.values()) if (d.owner_capability === p.capability && !chainCheck(chain, d.ns, r.ns, envelopeSealed)) return 'CHAIN_INTACT'; return null; }
    case 'EPOCH_STABLE': return p.epochAtPrecheck === w.meta.ns_epoch ? null : 'EPOCH_STABLE';
  }
  return null;
}
function precheckGates(w, p, by, subset) { for (const g of (subset || GATES)) { const bad = runGate(g, w, p, by); if (bad) return bad; } return null; }
// 修复流的来源互检（gate=REPAIR_PROVENANCE）；MUT-3 架空：不符仍放行
function repairProvenanceOk(w, p, MUT3) { const obs = driftDigestOf(w, p.capability); return MUT3 ? true : obs === p.evidence.observedDriftDigest; }
function repairMUT3(w, p) { return repairProvenanceOk(w, p, true); }

// 提案 / 批准 / 校验 / 执行（RL-3）
let _id = 0;
function proposeRelocation(w, a, by) {
  assertAdmin(by);
  const r = w.capability_route.get(a.capability);
  const id = 'NSR-' + (++_id);
  const p = { id, capability: a.capability, expectedFromNs: a.expectedFromNs, fromNs: a.expectedFromNs, toNs: a.toNs, proposedBy: by.actorId, epochAtPrecheck: null, contentDigest: null, proposalDigest: null, approvalDigest: null, approvedBy: null, provenance: 'AT-TIME', repairEvidence: null };
  w.proposals.set(id, p); w.relocSteps.push({ id, step: 1, state: 'PROPOSED' }); void r; return id;
}
function latest(w, id) { let s = null; for (const x of w.relocSteps) if (x.id === id) s = x; return s; }
function addStep(w, id, state) { w.relocSteps.push({ id, step: (latest(w, id)?.step || 0) + 1, state }); }
function approveRelocation(w, id, by) {
  assertAdmin(by);
  const p = w.proposals.get(id); if (!p) throw new Refusal('RELOCATION_PRECONDITION', { failedGate: 'APPROVAL' });
  if (by.actorId === p.proposedBy) return { refusal: 'RELOCATION_PRECONDITION', detail: { failedGate: 'APPROVAL' } };  // 自批拒（RL-3.3②）
  p.approvedBy = by.actorId; p.approvalDigest = 'sha256:' + sha256(by.actorId + id); addStep(w, id, 'APPROVED'); return { ok: true };
}
function precheckRelocation(w, id, by) {
  assertAdmin(by);
  const p = w.proposals.get(id); const st = latest(w, id);
  if (!st || st.state !== 'APPROVED') return { ok: false, failedGate: 'APPROVAL' };
  p.epochAtPrecheck = w.meta.ns_epoch;
  const bad = precheckGates(w, p, by);
  if (bad) { addStep(w, id, 'REJECTED'); return { ok: false, failedGate: bad }; }
  p.contentDigest = contentDigestOf(w, p.fromNs); p.proposalDigest = 'sha256:' + sha256(JSON.stringify([p.capability, p.fromNs, p.toNs, p.contentDigest]));
  addStep(w, id, 'PRECHECKED'); return { ok: true, checklistDigest: 'sha256:chk' + id, contentDigest: p.contentDigest };
}
function snapshot(w) { return JSON.stringify({ dir: [...w.object_directory], ds: w.domain_state, led: w.ledger, meta: w.meta, route: [...w.capability_route] }); }
function restore(w, s) { const o = JSON.parse(s); w.object_directory = new Map(o.dir); w.domain_state = o.ds; w.ledger = o.led; w.meta = o.meta; w.capability_route = new Map(o.route); }
function executeRelocation(w, id, by) {
  assertAdmin(by);
  const p = w.proposals.get(id); if (!p) throw new Refusal('RELOCATION_PRECONDITION', { failedGate: 'APPROVAL' });
  if (latest(w, id).state === 'COMMITTED') return w.committed.get(id);  // 幂等重放（RL-7.2）
  if (latest(w, id).state !== 'PRECHECKED') return { refusal: 'RELOCATION_PRECONDITION', detail: { failedGate: 'APPROVAL' } };
  const snap = snapshot(w);
  try {
    // 事务内复核（RL-4.3：1/2/5/7/10）
    const bad = precheckGates(w, p, by, ['AUTHORITY', 'ROUTE_STATE', 'TARGET_EMPTY', 'CONTENT_DIGEST', 'EPOCH_STABLE', 'CHAIN_INTACT']);
    if (bad) { restore(w, snap); addStep(w, id, 'REJECTED'); return { refusal: 'RELOCATION_PRECONDITION', detail: { failedGate: bad } }; }
    const cd = contentDigestOf(w, p.fromNs);
    if (cd !== p.contentDigest) { restore(w, snap); addStep(w, id, 'REJECTED'); return { refusal: 'RELOCATION_PRECONDITION', detail: { failedGate: 'CONTENT_DIGEST' } }; }
    // 3) 物理重映射（只改位置键 ns）
    for (const s of w.domain_state) if (s.ns === p.fromNs) s.ns = p.toNs;
    // 4) 落审计（先于路由，同事务；机制内部直写全形信封）
    const audit = ledgerAppend(w, { event_type: NS_RELOC, actor: by.actorId, authority_basis: sealedEnvelope(by, p.capability),
      payload_json: JSON.stringify({ capability: p.capability, fromNs: p.fromNs, toNs: p.toNs, oidScope: 'ALL', contentDigest: cd, provenance: 'AT-TIME', repairEvidence: null, relocationId: p.id }), object_id: null });
    // 5) 路由改 ns（触发器核审计行）
    routeUpdate(w, p.capability, { ns: p.toNs, changed_seq: audit.seq });
    // 6) ns_epoch 推进
    w.meta.ns_epoch += 1;
    addStep(w, id, 'COMMITTED'); const res = { status: 'COMMITTED', auditLedgerSeq: audit.seq, contentDigest: cd }; w.committed.set(id, res); return res;
  } catch (e) { restore(w, snap); throw e; }
}
function proposeRollback(w, sourceId, by) {
  const src = w.proposals.get(sourceId); const p = { ...src };
  const id = 'NSR-' + (++_id); const np = { id, capability: p.capability, expectedFromNs: p.toNs, fromNs: p.toNs, toNs: p.fromNs, proposedBy: by.actorId, epochAtPrecheck: null, contentDigest: null, proposalDigest: null, approvalDigest: null, approvedBy: null, provenance: 'AT-TIME', repairEvidence: null };
  w.proposals.set(id, np); w.relocSteps.push({ id, step: 1, state: 'PROPOSED' }); return id;  // 独立新提案，原链一字不动（RL-3⑥）
}
// 修复流（RL-8.4/8.5）
function proposeRepair(w, a, by) {
  assertAdmin(by);
  if (!a.evidence || !a.evidence.operationGrant) throw new Refusal('RELOCATION_PRECONDITION', { failedGate: 'REPAIR_PROVENANCE' });
  const id = 'NSR-' + (++_id);
  const p = { id, capability: a.capability, expectedFromNs: a.fromNs, fromNs: a.fromNs, toNs: a.toNs, proposedBy: by.actorId, epochAtPrecheck: w.meta.ns_epoch, contentDigest: null, proposalDigest: null, approvalDigest: null, approvedBy: null, provenance: 'AFTER-THE-FACT-REPAIR', evidence: a.evidence };
  w.proposals.set(id, p); w.relocSteps.push({ id, step: 1, state: 'REPAIR_PROPOSED' }); return id;
}
function approveRepair(w, id, by) { assertAdmin(by); const p = w.proposals.get(id); if (by.actorId === p.proposedBy) return { refusal: 'RELOCATION_PRECONDITION', detail: { failedGate: 'APPROVAL' } }; p.approvedBy = by.actorId; addStep(w, id, 'REPAIR_APPROVED'); return { ok: true }; }
function executeRepair(w, id, by, MUT3) {
  assertAdmin(by);
  const p = w.proposals.get(id); if (latest(w, id).state !== 'REPAIR_APPROVED') return { refusal: 'RELOCATION_PRECONDITION', detail: { failedGate: 'REPAIR_PROVENANCE' } };
  if (!repairProvenanceOk(w, p, MUT3)) return { refusal: 'RELOCATION_PRECONDITION', detail: { failedGate: 'REPAIR_PROVENANCE' } };  // 互检不符：零伪造链
  const snap = snapshot(w);
  try {
    for (const s of w.domain_state) if (s.ns === p.fromNs) s.ns = p.toNs;   // 残留行 remap
    const cd = contentDigestOf(w, p.toNs);
    ledgerAppend(w, { event_type: NS_RELOC, actor: by.actorId, authority_basis: sealedEnvelope(by, p.capability),
      payload_json: JSON.stringify({ capability: p.capability, fromNs: p.fromNs, toNs: p.toNs, oidScope: 'ALL', contentDigest: cd, provenance: 'AFTER-THE-FACT-REPAIR', repairEvidence: { sourceRefs: p.evidence.sourceRefs, observedDriftDigest: p.evidence.observedDriftDigest, operationGrant: p.evidence.operationGrant, repairedBy: by.actorId }, relocationId: p.id }), object_id: null });
    // 路由零改（changed_seq 不动）；ns_epoch 仍推进
    w.meta.ns_epoch += 1; addStep(w, id, 'REPAIRED'); w.quarantine.set(p.capability, 'REPAIRED'); return { status: 'REPAIRED', contentDigest: cd };
  } catch (e) { restore(w, snap); throw e; }
}
function confirmPermanentQuarantine(w, cap, by) { assertAdmin(by); w.quarantine.set(cap, 'PERMANENTLY_QUARANTINED'); }

// 打开判据序（RL-8.1；只有步 4 相关）+ 运行期 drift 计数（RL-8.2）
function openScan(w) {
  let routeDirMismatchCount = 0; const violations = [];
  for (const d of w.object_directory.values()) {
    const r = w.capability_route.get(d.owner_capability);
    if (!r || !r.enabled) continue;
    if (r.ns === d.ns) continue;
    routeDirMismatchCount++;
    if (!chainCheck(chainOf(w, d.owner_capability), d.ns, r.ns, envelopeSealed)) violations.push(d.oid);
  }
  const relocationGapCount = violations.length;
  if (relocationGapCount > 0) { const cap = [...w.proposals.values()][0]?.capability || 'cap-a'; w.quarantine.set(violations.length ? 'cap-a' : cap, 'QUARANTINED');
    return { refuse: 'SCHEMA_UPGRADE_REQUIRED', caller: callerBodyFor('SCHEMA_UPGRADE_REQUIRED'), opsDetail: { namedOids: violations.sort(), routeDirMismatchCount, relocationGapCount }, relocationGapCount, routeDirMismatchCount }; }
  return { ok: true, caller: callerBodyFor('NONE'), opsDetail: { routeDirMismatchCount, relocationGapCount }, relocationGapCount, routeDirMismatchCount };
}

// ============================================================ 结构校验（S 组）

const refR = doc.split('\n').filter(l => /^\|\s*R-\d\d\s*\|/.test(l));
const shaRe = /5ec38974fc|0369c3196c|37de107ed5/;
check('S1 上层引用表每行齐「文件+规则号+原文短句+SHA」四要素',
  refR.length >= 17 && refR.every(l => shaRe.test(l) && l.includes('「') && (l.includes('.md') || l.includes('同上')) && /\|\s*§|SF|ID-|RD-|C11|T-GAP|SD/.test(l)), 'R 行 ' + refR.length);
const cnt = s => refR.filter(l => l.includes(s)).length;
check('S2 三份上层各有实取引用（#44≥4 / #42≥3 / #47≥3），无「未取得项」被引用',
  cnt('5ec38974fc') >= 4 && cnt('0369c3196c') >= 3 && cnt('37de107ed5') >= 3 && !doc.includes('未取得：R-'),
  ['#44=' + cnt('5ec38974fc'), '#42=' + cnt('0369c3196c'), '#47=' + cnt('37de107ed5')].join(' '));

const tokensIn = (t) => new Set((t.match(/`[A-Z][A-Z0-9_]{2,}(?:_[A-Z0-9]+)*`/g) ?? []).map(s => s.slice(1, -1)));
const CLOSED = new Set((readFileSync(REFUSAL_CODES_PATH, 'utf8').match(/'([A-Z][A-Z0-9_]{2,})'/g) ?? []).map(s => s.slice(1, -1)));
const DECLARED = new Set(['RELOCATION_PRECONDITION', 'ROUTE_AUDIT_REQUIRED', 'ROUTE_CHANGED_SEQ_MONOTONICITY',
  'ROUTE_RELOC_SPLIT_REQUIRED', 'RELOCATION_LEDGER_FROZEN', 'RELOCATABLE_NS_KEYS', 'REQUIRED_TRIGGERS',
  'SCHEMA_VERSION', 'QUARANTINED', 'PERMANENTLY_QUARANTINED']);
check('S3 契约内 backtick 全大写码全落「封闭拒绝码集 ∪ 新增声明码 ∪ 声明的存储/构建/状态信号」',
  [...tokensIn(doc)].every(t => CLOSED.has(t) || DECLARED.has(t)), [...tokensIn(doc)].filter(t => !CLOSED.has(t) && !DECLARED.has(t)).join(','));
check('S3b 新增拒绝码恰一枚 = RELOCATION_PRECONDITION（其余全在现状封闭集）',
  [...tokensIn(doc)].filter(t => !CLOSED.has(t)).every(t => DECLARED.has(t)) && doc.includes('RELOCATION_PRECONDITION'));

const casesInDoc = [...doc.matchAll(/\|\s*(T-[PN]\d{1,2})\s*\|/g)].map(m => m[1]);
const caseIds = [...SELF_SRC.matchAll(/^function run_T_([PN]\d{1,2})\(/gm)].map(m => 'T-' + m[1]);
check('S4 正反例表与夹具双向一致（表内每 id 都有 run_*，无孤儿实现，计数相等）',
  new Set(casesInDoc).size === caseIds.length && [...new Set(casesInDoc)].every(id => caseIds.includes(id)) && caseIds.length === 25,
  'doc=' + new Set(casesInDoc).size + ' fn=' + caseIds.length);

const faultsInDoc = [...doc.matchAll(/\|\s*(F-\d\d)\s*\|/g)].map(m => m[1]);
check('S5 故障矩阵 id 双向逐等（夹具 18 条 ↔ 正文表行，无缺无多）',
  faultsInDoc.length === FAULT_MATRIX.length && FAULT_MATRIX.every(f => faultsInDoc.includes(f)), 'doc=' + faultsInDoc.length);

const gateFromDoc = doc.includes('1. AUTHORITY') && doc.includes('10. EPOCH_STABLE');
const gatesListed = GATES.every(g => doc.includes(g));
check('S6 门清单封闭集三方逐等（契约正文逐名在位 ↔ 模型 GATES；不多不少）',
  gateFromDoc && gatesListed && doc.includes('SOURCE_PARSEABLE') && doc.includes('TARGET_UNCLAIMED'),
  '正文缺门：' + GATES.filter(g => !doc.includes(g)).join(','));

check('S7 五要素（RL-1.3）+ B.7 五项映射逐条在位，「只改 route.ns 被明文禁止」句在位',
  ['实际数据搬迁', '物理位置映射', '审计见证', '原子切换', '历史读取'].every(s => doc.includes(s))
  && doc.includes('「只改 `route.ns`」被本契约明文禁止')
  && ['迁移前数据校验与目标准备', '唯一权威 + 历史修订身份不变性', '活跃路由切换原子性', '失败/崩溃/重试/跨版本读取恢复条件', '物理复制不得当成新科研历史事件'].every(s => doc.includes(s)));

check('S8 冻结关键句在位（自立/C6 撤销/不产生新科研事实/backfill 默认禁止/隔离并明确报告/回退不删历史）',
  doc.includes('对「打开期检出 ns 漂移」零提及、零承接') && doc.includes('迁移记录与数据/路由更新原子一致')
  && doc.includes('不产生新科研事实、不产生新科研修订') && doc.includes('默认禁止自动补造「当时合法迁移」的证据')
  && doc.includes('隔离并明确报告') && doc.includes('不得自动改写旧结论')
  && doc.includes('C6 撤销') && doc.includes('永久保留「事后修复」与「当时发生的合法迁移」之别'));

check('S9 五条变异常驻本夹具（chainCheckMUT1/routeGuardMUT2/repairMUT3/routeGuardMUT4/routeGuardMUT5）',
  /(?:function|const) chainCheckMUT1\b/.test(SELF_SRC) && /(?:function|const) routeGuardMUT2\b/.test(SELF_SRC)
  && /(?:function|const) repairMUT3\b/.test(SELF_SRC) && /(?:function|const) routeGuardMUT4\b/.test(SELF_SRC) && /(?:function|const) routeGuardMUT5\b/.test(SELF_SRC));

check('S10 链诚实分层（6.5a 界内防御 vs 界外登记边界）与 RL-INFO 单一判据在位，且未把检测写成防御',
  doc.includes('6.5a 链的诚实分层') && doc.includes('relocationGapCount') && doc.includes('是检测，不是防御')
  && doc.includes('RL-INFO') && doc.includes('普通调用者响应面零差分') && /ledger[^。]*不禁 INSERT|不禁 INSERT/.test(doc));

check('S11 本文不写「属 #47 决策面」；ns-relocated 锚文本沿用事件契约 planned/gated_by',
  !/本文写「属 #47 决策面」/.test(doc) && doc.includes('本文不写「属 #47 决策面」')
  && evt.includes("planned:true") && evt.includes("gated_by:'G1-NS-01'"));

// ============================================================ 正反例（与 §13 表逐一对应）

const ADMIN = { actorId: 'ops:wu', capabilityAdmin: true };
const ADMIN2 = { actorId: 'ops:lin', capabilityAdmin: true };
const NOADMIN = { actorId: 'user:guest', capabilityAdmin: false };
function worldTwo() { const w = mkWorld(); addRoute(w, 'cap-a', 'ns-1'); addObject(w, 'O1', 'cap-a', 'ns-1', 1); addObject(w, 'O2', 'cap-a', 'ns-1', 1); addState(w, 'ns-1', 'O1', 1, { v: 1 }, 1); addState(w, 'ns-1', 'O1', 2, { v: 2 }, 2); addState(w, 'ns-1', 'O2', 1, { v: 9 }, 3); return w; }
function fullFlow(w, toNs, propBy = ADMIN, apprBy = ADMIN2) { const id = proposeRelocation(w, { capability: 'cap-a', expectedFromNs: 'ns-1', toNs }, propBy); approveRelocation(w, id, apprBy); const pc = precheckRelocation(w, id, apprBy); if (!pc.ok) return { precheckFail: pc.failedGate, id }; const ex = executeRelocation(w, id, apprBy); return { id, pc, ex }; }
function snapshotRows(w, oid) { return w.domain_state.filter(s => s.oid === oid).map(s => [s.oid, s.revision, s.payload_json, s.recorded_seq, s.contract_version]).sort(); }

function run_T_P1() { // 合法端到端 + 历史快照逐字节等 + epoch+1
  const w = worldTwo(); const before = { O1: snapshotRows(w, 'O1'), O2: snapshotRows(w, 'O2') }; const ep0 = w.meta.ns_epoch;
  const { ex } = fullFlow(w, 'ns-2'); if (ex.status !== 'COMMITTED') return '未提交：' + JSON.stringify(ex);
  if (w.capability_route.get('cap-a').ns !== 'ns-2') return '路由未切';
  if (w.domain_state.some(s => s.ns !== 'ns-2')) return '有行未搬';
  if (w.meta.ns_epoch !== ep0 + 1) return 'epoch 未推进';
  if (JSON.stringify(snapshotRows(w, 'O1')) !== JSON.stringify(before.O1)) return '历史快照逐字节不等';
  if (JSON.stringify(snapshotRows(w, 'O2')) !== JSON.stringify(before.O2)) return 'O2 快照不等';
  return true;
}
function run_T_P2() { // 同参重放幂等：ledger 恰一条
  const w = worldTwo(); const { id, ex } = fullFlow(w, 'ns-2'); if (ex.status !== 'COMMITTED') return '首次未提交';
  const n = w.ledger.filter(l => l.event_type === NS_RELOC).length; const ex2 = executeRelocation(w, id, ADMIN2);
  return ex2.auditLedgerSeq === ex.auditLedgerSeq && w.ledger.filter(l => l.event_type === NS_RELOC).length === n && n === 1 ? true : '重放产生第二笔';
}
function run_T_P3() { // 回退=反向提案；迁出期出生对象回迁后可读；两事件俱在
  const w = worldTwo(); fullFlow(w, 'ns-2'); addObject(w, 'O3', 'cap-a', 'ns-2', 5); addState(w, 'ns-2', 'O3', 1, { v: 3 }, 5);
  const rid = proposeRollback(w, [...w.proposals.keys()].slice(-1)[0], ADMIN); approveRelocation(w, rid, ADMIN2);
  w.proposals.get(rid).epochAtPrecheck = w.meta.ns_epoch; precheckRelocation(w, rid, ADMIN2); const ex = executeRelocation(w, rid, ADMIN2);
  if (ex.status !== 'COMMITTED') return '回退未提交：' + JSON.stringify(ex);
  if (w.capability_route.get('cap-a').ns !== 'ns-1') return '未回到 nsA';
  if (readSnapshot(w, 'O3', w.meta.ns_epoch).refusal) return 'dir.ns=B 对象不可读';
  if (w.ledger.filter(l => l.event_type === NS_RELOC).length !== 2) return '两 AT-TIME 事件不俱在';
  return true;
}
function run_T_P4() { // 重定位后重开：routeDirMismatch>0 且 gap=0 ⇒ 开
  const w = worldTwo(); fullFlow(w, 'ns-2'); const scan = openScan(w);
  return !scan.refuse && scan.routeDirMismatchCount === 2 && scan.relocationGapCount === 0 ? true : JSON.stringify(scan);
}
function run_T_P5() { // 存量漂移修复：拒开→proposeRepair（digest 互检过）→REPAIRED→重开 ok
  const w = mkWorld(); addRoute(w, 'cap-a', 'ns-2'); addObject(w, 'O1', 'cap-a', 'ns-1', 1); addState(w, 'ns-1', 'O1', 1, { v: 1 }, 1);  // 残留行在 nsA、路由 nsB、无链
  const pre = openScan(w); if (!pre.refuse) return '漂移库未被拒开';
  const rid = proposeRepair(w, { capability: 'cap-a', fromNs: 'ns-1', toNs: 'ns-2', evidence: { sourceRefs: ['backup://2026-11'], operationGrant: 'OPS-42', observedDriftDigest: driftDigestOf(w, 'cap-a') } }, ADMIN);
  approveRepair(w, rid, ADMIN2); const ex = executeRepair(w, rid, ADMIN2); if (ex.status !== 'REPAIRED') return '修复失败：' + JSON.stringify(ex);
  const hop = w.ledger.filter(l => l.event_type === NS_RELOC).pop(); if (JSON.parse(hop.payload_json).provenance !== 'AFTER-THE-FACT-REPAIR') return 'hop 未永久标记';
  if (w.capability_route.get('cap-a').changed_seq !== null) return '修复伪造了路由变更戳';
  const scan = openScan(w); return !scan.refuse && scan.relocationGapCount === 0 ? true : '修复后重开仍拒：' + JSON.stringify(scan);
}
function run_T_P6() { // 零科研事实差分
  const w = worldTwo(); const ledN = w.ledger.length, recN = w.records.size, jn = w.journal.length, dirN = w.object_directory.size;
  const idsBefore = w.domain_state.map(s => s.oid + '@' + s.revision).sort().join('|'); const cdBefore = contentDigestOf(w, 'ns-1');
  fullFlow(w, 'ns-2');
  if (w.ledger.length !== ledN + 1) return 'ledger 差集非恰 1';
  if (w.ledger.filter(l => l.event_type === NS_RELOC).length !== 1) return '非 ns-relocated';
  if (w.records.size !== recN || w.journal.length !== jn || w.object_directory.size !== dirN) return '零写面被破坏';
  if (w.domain_state.map(s => s.oid + '@' + s.revision).sort().join('|') !== idsBefore) return '(oid,revision) 集变了';
  if (contentDigestOf(w, 'ns-2') !== cdBefore) return '内容 digest 前后不等（改了内容列）';
  return true;
}
function run_T_P7() { // 陈旧窗 fail-loud，非空集非旧数据；caller 体与 RL-6.5③ 同构造器
  const w = worldTwo(); const staleEpoch = w.meta.ns_epoch; fullFlow(w, 'ns-2');
  const r = readSnapshot(w, 'O1', staleEpoch);
  return r.refusal === 'SCHEMA_INCOMPATIBLE' && r.why === 'stale-epoch' && r.caller === callerBodyFor('SCHEMA_INCOMPATIBLE') && !r.caller.includes('O1') ? true : JSON.stringify(r);
}
function run_T_P8() { // 零对象能力重定位成功，读面同形无 oracle
  const w = mkWorld(); addRoute(w, 'cap-a', 'ns-1'); const { ex } = fullFlow(w, 'ns-2');
  return ex.status === 'COMMITTED' && w.capability_route.get('cap-a').ns === 'ns-2' && readSnapshot(w, 'O-nope', w.meta.ns_epoch).refusal === 'NOT_FOUND_IN_SPACE' ? true : JSON.stringify(ex);
}
function run_T_P9() { // 三级链 A→B→C，birth=A/B/C 各按链段可读
  const w = mkWorld(); addRoute(w, 'cap-a', 'ns-1'); addObject(w, 'OA', 'cap-a', 'ns-1', 1); addState(w, 'ns-1', 'OA', 1, { v: 1 }, 1);
  fullFlow(w, 'ns-2'); addObject(w, 'OB', 'cap-a', 'ns-2', 3); addState(w, 'ns-2', 'OB', 1, { v: 2 }, 3);
  const id2 = proposeRelocation(w, { capability: 'cap-a', expectedFromNs: 'ns-2', toNs: 'ns-3' }, ADMIN); approveRelocation(w, id2, ADMIN2); const pc2 = precheckRelocation(w, id2, ADMIN2); if (!pc2.ok) return '二级迁移校验未过：' + pc2.failedGate;
  const ex2 = executeRelocation(w, id2, ADMIN2); if (ex2.status !== 'COMMITTED' || w.capability_route.get('cap-a').ns !== 'ns-3') return '二级迁移未提交';
  const ep = w.meta.ns_epoch;
  return !readSnapshot(w, 'OA', ep).refusal && !readSnapshot(w, 'OB', ep).refusal ? true : '三级链读取失败';
}
function run_T_N1() { // transferRoute 携 ns → TRANSFER_NS_DRIFT
  const w = worldTwo(); try { transferRoute(w, 'cap-a', { storageNamespace: 'ns-z', pluginId: 'p2' }); return '未拒'; } catch (e) { return e.code === 'TRANSFER_NS_DRIFT'; }
}
function run_T_N2() { // 未批准 / 自批 即执行 → APPROVAL
  const w = worldTwo(); const id = proposeRelocation(w, { capability: 'cap-a', expectedFromNs: 'ns-1', toNs: 'ns-2' }, ADMIN);
  const r1 = executeRelocation(w, id, ADMIN); const r2 = approveRelocation(w, id, ADMIN);  // 自批
  return r1.refusal === 'RELOCATION_PRECONDITION' && r1.detail.failedGate === 'APPROVAL' && r2.refusal === 'RELOCATION_PRECONDITION' && r2.detail.failedGate === 'APPROVAL' ? true : JSON.stringify([r1, r2]);
}
function run_T_N3() { // 无 capability-admin → AUTHORITY_REQUIRED，零账步
  const w = worldTwo(); const before = w.relocSteps.length; try { proposeRelocation(w, { capability: 'cap-a', expectedFromNs: 'ns-1', toNs: 'ns-2' }, NOADMIN); return '未拒'; } catch (e) { return e.code === 'AUTHORITY_REQUIRED' && w.relocSteps.length === before; }
}
function run_T_N4() { // 目标残留 → TARGET_EMPTY
  const w = worldTwo(); addState(w, 'ns-2', 'OX', 1, { v: 1 }, 1);  // 无主残留行（不抢路由位）
  const { precheckFail } = fullFlow(w, 'ns-2'); return precheckFail === 'TARGET_EMPTY' || precheckFail === 'TARGET_UNCLAIMED' ? true : '未拦目标残留：' + precheckFail;
}
function run_T_N5() { // 源行不可解析 → SOURCE_PARSEABLE，禁跳行
  const w = worldTwo(); w.domain_state[0].payload_json = '{坏JSON'; const { precheckFail } = fullFlow(w, 'ns-2');
  return precheckFail === 'SOURCE_PARSEABLE' && w.capability_route.get('cap-a').ns === 'ns-1' ? true : '未拦或跳行：' + precheckFail;
}
function run_T_N6() { // 通用通道 mint ns-relocated → EVENT_AUTHORITY_REQUIRED
  const w = worldTwo(); try { genericAppend(w, NS_RELOC); return '未拒'; } catch (e) { return e.code === 'EVENT_AUTHORITY_REQUIRED' && e.detail.classification === 'mechanism'; }
}
function run_T_N7() { // 裸面：无审计/只配 transferred → 拒；连全形信封伪造 → 过闸（已登记界）+ 痕迹不可删
  const w = worldTwo(); w.meta.ledger_seq = 100;
  try { routeUpdate(w, 'cap-a', { ns: 'ns-2', changed_seq: 101 }); return '无审计却过闸'; } catch (e) { if (e.code !== 'ROUTE_AUDIT_REQUIRED') return '无审计码不符：' + e.code; }
  ledgerAppend(w, { event_type: 'capability-transferred', actor: 'x', authority_basis: sealedEnvelope(ADMIN, 'cap-a'), payload_json: JSON.stringify({ capability: 'cap-a' }), object_id: null }); const seqT = w.meta.ledger_seq;
  try { routeUpdate(w, 'cap-a', { ns: 'ns-2', changed_seq: seqT }); return '只配 transferred 却过闸'; } catch (e) { if (e.code !== 'ROUTE_AUDIT_REQUIRED') return 'transferred 码不符：' + e.code; }
  ledgerAppend(w, { event_type: NS_RELOC, actor: 'x', authority_basis: sealedEnvelope(ADMIN, 'cap-a'), payload_json: JSON.stringify({ capability: 'cap-a', fromNs: 'ns-1', toNs: 'ns-2' }), object_id: null }); const seqF = w.meta.ledger_seq;
  const g = routeGuard(w, 'cap-a', { ns: 'ns-2', changed_seq: seqF });
  if (!g.ok) return '全形伪造未过（应为已登记界=过）：' + g.abort;
  try { ledgerDeleteAttempt(); return '伪造痕迹竟可删'; } catch (e) { return e.code === 'HISTORY_IMMUTABLE'; }
}
function run_T_N8() { // 无链漂移库重开 → 拒开，点名仅运维面，caller 体无 oid
  const w = mkWorld(); addRoute(w, 'cap-a', 'ns-2'); addObject(w, 'O1', 'cap-a', 'ns-1', 1); addState(w, 'ns-1', 'O1', 1, { v: 1 }, 1);
  const scan = openScan(w); return scan.refuse === 'SCHEMA_UPGRADE_REQUIRED' && !scan.caller.includes('O1') && scan.opsDetail.namedOids.includes('O1') ? true : JSON.stringify(scan);
}
function run_T_N9() { // 修复证据不符 → REPAIR_PROVENANCE，零伪造链，转永久隔离
  const w = mkWorld(); addRoute(w, 'cap-a', 'ns-2'); addObject(w, 'O1', 'cap-a', 'ns-1', 1); addState(w, 'ns-1', 'O1', 1, { v: 1 }, 1); openScan(w);
  const ledN = w.ledger.filter(l => l.event_type === NS_RELOC).length;
  const rid = proposeRepair(w, { capability: 'cap-a', fromNs: 'ns-1', toNs: 'ns-2', evidence: { sourceRefs: ['backup://x'], operationGrant: 'OPS-9', observedDriftDigest: 'sha256:错' } }, ADMIN);
  approveRepair(w, rid, ADMIN2); const ex = executeRepair(w, rid, ADMIN2);
  confirmPermanentQuarantine(w, 'cap-a', ADMIN);
  return ex.detail?.failedGate === 'REPAIR_PROVENANCE' && w.ledger.filter(l => l.event_type === NS_RELOC).length === ledN && w.quarantine.get('cap-a') === 'PERMANENTLY_QUARANTINED' ? true : JSON.stringify(ex);
}
function run_T_N10() { // no-op（toNs=当前 ns）→ 拒，零切换
  const w = worldTwo(); const { precheckFail } = fullFlow(w, 'ns-1'); return (precheckFail === 'NS_SHAPE' || precheckFail === 'ROUTE_STATE') && w.capability_route.get('cap-a').ns === 'ns-1' ? true : 'no-op 未拦：' + precheckFail;
}
function run_T_N11() { // ns+enabled 混合语句 → ROUTE_RELOC_SPLIT_REQUIRED，路由一字不动
  const w = worldTwo(); w.meta.ledger_seq = 50; ledgerAppend(w, { event_type: 'capability-disabled', actor: 'x', authority_basis: sealedEnvelope(ADMIN, 'cap-a'), payload_json: JSON.stringify({ capability: 'cap-a' }), object_id: null });
  try { routeUpdate(w, 'cap-a', { ns: 'ns-2', enabled: 0, changed_seq: w.meta.ledger_seq }); return '混合却过闸'; } catch (e) { return e.code === 'ROUTE_RELOC_SPLIT_REQUIRED' && w.capability_route.get('cap-a').ns === 'ns-1'; }
}
function run_T_N12() { // 双提案并发 → NO_INFLIGHT
  const w = worldTwo(); const id1 = proposeRelocation(w, { capability: 'cap-a', expectedFromNs: 'ns-1', toNs: 'ns-2' }, ADMIN); const id2 = proposeRelocation(w, { capability: 'cap-a', expectedFromNs: 'ns-1', toNs: 'ns-3' }, ADMIN);
  approveRelocation(w, id2, ADMIN2); const pc = precheckRelocation(w, id2, ADMIN2); return pc.ok === false && pc.failedGate === 'NO_INFLIGHT' ? true : '双在途未拦：' + JSON.stringify(pc);
}
function run_T_N13() { // 会话内无链漂移快照读 → SCHEMA_INCOMPATIBLE，caller 无 oid（D-31 现状形复钉）
  const w = mkWorld(); addRoute(w, 'cap-a', 'ns-2'); addObject(w, 'O1', 'cap-a', 'ns-1', 1);
  const r = readSnapshot(w, 'O1', w.meta.ns_epoch); return r.refusal === 'SCHEMA_INCOMPATIBLE' && r.why === 'no-chain' && !r.caller.includes('O1') ? true : JSON.stringify(r);
}
function run_T_N14() { // 断链 capability 上直接重定位 → CHAIN_INTACT
  const w = mkWorld(); addRoute(w, 'cap-a', 'ns-3'); addObject(w, 'O1', 'cap-a', 'ns-1', 1); addState(w, 'ns-3', 'O1', 1, { v: 1 }, 1);  // 无链，路由 nsC，出生 nsA
  const id = proposeRelocation(w, { capability: 'cap-a', expectedFromNs: 'ns-3', toNs: 'ns-4' }, ADMIN); approveRelocation(w, id, ADMIN2); const pc = precheckRelocation(w, id, ADMIN2);
  return pc.ok === false && pc.failedGate === 'CHAIN_INTACT' ? true : '未拦叠漂移：' + JSON.stringify(pc);
}
function run_T_N15() { // precheck 后并发改路由再 execute → 回滚零残留（含 ghost 序号零留），重试成功
  const w = worldTwo(); const id = proposeRelocation(w, { capability: 'cap-a', expectedFromNs: 'ns-1', toNs: 'ns-2' }, ADMIN); approveRelocation(w, id, ADMIN2); precheckRelocation(w, id, ADMIN2);
  const seqBefore = w.meta.ledger_seq, epBefore = w.meta.ns_epoch; w.capability_route.get('cap-a').ns = 'ns-z';  // 并发把路由改了
  const ex = executeRelocation(w, id, ADMIN2);
  if (!ex.refusal) return '并发变更未拦';
  if (w.meta.ledger_seq !== seqBefore || w.meta.ns_epoch !== epBefore) return 'ghost 序号/epoch 被留';
  return true;
}
function run_T_N16() { // 界外伪造链（登记边界正断言）：过闸 + 痕迹不可删 + 界内 mint 仍零 + gap 报 0
  const w = mkWorld(); addRoute(w, 'cap-a', 'ns-2'); addObject(w, 'O1', 'cap-a', 'ns-1', 1); addState(w, 'ns-2', 'O1', 1, { v: 1 }, 1);
  rawLedgerInsert(w, { event_type: NS_RELOC, actor: 'forged', authority_basis: JSON.stringify({ axis: 'capability-admin', capability: 'cap-a', authorized: 1, actor: 'forged' }), payload_json: JSON.stringify({ capability: 'cap-a', fromNs: 'ns-1', toNs: 'ns-2' }), object_id: null });
  const scan = openScan(w);
  if (scan.refuse) return '伪造链本应过闸（登记边界），却拦住=文档与实现不符';
  if (scan.relocationGapCount !== 0) return '伪造链 gap 应为 0（不可检出）';
  let forgedDeleted = false; try { ledgerDeleteAttempt(); } catch (e) { forgedDeleted = e.code === 'HISTORY_IMMUTABLE'; }
  if (!forgedDeleted) return '伪造痕迹竟可删';
  let mintBlocked = false; try { genericAppend(w, NS_RELOC); } catch (e) { mintBlocked = e.code === 'EVENT_AUTHORITY_REQUIRED'; }
  return mintBlocked ? true : '界内 mint 未被拦（防御面破）';
}

const CASE_RUNNERS = { run_T_P1, run_T_P2, run_T_P3, run_T_P4, run_T_P5, run_T_P6, run_T_P7, run_T_P8, run_T_P9,
  run_T_N1, run_T_N2, run_T_N3, run_T_N4, run_T_N5, run_T_N6, run_T_N7, run_T_N8, run_T_N9, run_T_N10,
  run_T_N11, run_T_N12, run_T_N13, run_T_N14, run_T_N15, run_T_N16 };
for (const id of caseIds) {
  const fn = CASE_RUNNERS['run_' + id.replace('-', '_')];
  let out; try { out = fn(); } catch (e) { out = '抛异常：' + e.message; }
  check('CASE ' + id, out === true, typeof out === 'string' ? out : '');
}

// ============================================================ 架空判据必红（五条自验，变异常驻）

// 共用负例世界：cap-a 出生 nsA、路由 nsA，待切到 nsB
function mutWorld(auditRow) { const w = worldTwo(); w.meta.ledger_seq = 200; if (auditRow) { auditRow.seq = ++w.meta.ledger_seq; w.ledger.push(auditRow); } return { w, seq: w.meta.ledger_seq }; }

check('MUT-1 架空链前缀完备被区分（真判据拒起点不符的孤立尾跳、架空的放行）',
  chainCheck([['ns-2', 'ns-3', sealedEnvelope(ADMIN, 'cap-a')]], 'ns-1', 'ns-3', envelopeSealed) === false
  && chainCheckMUT1([['ns-2', 'ns-3', sealedEnvelope(ADMIN, 'cap-a')]], 'ns-1', 'ns-3') === true);
check('MUT-2 架空触发器事件名/信封判据被区分（真判据拒 actor 空的在册名行、架空的放行）',
  (() => { const { w, seq } = mutWorld({ event_type: NS_RELOC, actor: null, authority_basis: sealedEnvelope(ADMIN, 'cap-a'), payload_json: JSON.stringify({ capability: 'cap-a', fromNs: 'ns-1', toNs: 'ns-2' }) });
    return routeGuard(w, 'cap-a', { ns: 'ns-2', changed_seq: seq }).abort === 'ROUTE_AUDIT_REQUIRED' && routeGuardMUT2(w, 'cap-a', { ns: 'ns-2', changed_seq: seq }).ok === true; })());
check('MUT-3 架空修复证据互检被区分（真判据拒 digest 不符、架空的入账）',
  (() => { const w = mkWorld(); addRoute(w, 'cap-a', 'ns-2'); addObject(w, 'O1', 'cap-a', 'ns-1', 1); addState(w, 'ns-1', 'O1', 1, { v: 1 }, 1);
    const rid = proposeRepair(w, { capability: 'cap-a', fromNs: 'ns-1', toNs: 'ns-2', evidence: { sourceRefs: ['b'], operationGrant: 'G', observedDriftDigest: 'sha256:错' } }, ADMIN);
    approveRepair(w, rid, ADMIN2); return executeRepair(w, rid, ADMIN2).detail.failedGate === 'REPAIR_PROVENANCE' && repairMUT3(w, w.proposals.get(rid)) === true; })());
check('MUT-4 架空 fromNs/toNs 字面相符被区分（真判据拒名对位置错的行、架空的放行）',
  (() => { const { w, seq } = mutWorld({ event_type: NS_RELOC, actor: 'x', authority_basis: sealedEnvelope(ADMIN, 'cap-a'), payload_json: JSON.stringify({ capability: 'cap-a', fromNs: 'WRONG', toNs: 'ns-2' }) });
    return routeGuard(w, 'cap-a', { ns: 'ns-2', changed_seq: seq }).abort === 'ROUTE_AUDIT_REQUIRED' && routeGuardMUT4(w, 'cap-a', { ns: 'ns-2', changed_seq: seq }).ok === true; })());
check('MUT-5 架空拆单判据被区分（真判据出 SPLIT 专属拒因、架空的转落通用拒因 = 判据被架空）',
  (() => { const { w, seq } = mutWorld({ event_type: 'capability-enabled', actor: 'x', authority_basis: sealedEnvelope(ADMIN, 'cap-a'), payload_json: JSON.stringify({ capability: 'cap-a' }) });
    const real = routeGuard(w, 'cap-a', { ns: 'ns-2', enabled: 0, changed_seq: seq }).abort; const mut = routeGuardMUT5(w, 'cap-a', { ns: 'ns-2', enabled: 0, changed_seq: seq }).abort;
    return real === 'ROUTE_RELOC_SPLIT_REQUIRED' && mut !== 'ROUTE_RELOC_SPLIT_REQUIRED'; })());

process.stdout.write('\n合计：' + pass + ' PASS / ' + fail + ' FAIL\n');
if (fail > 0) { process.stdout.write('未通过项：\n  ' + fails.join('\n  ') + '\n'); process.exitCode = 1; }
else process.exitCode = 0;
