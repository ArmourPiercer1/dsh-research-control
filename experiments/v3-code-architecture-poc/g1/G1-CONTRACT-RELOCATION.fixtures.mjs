#!/usr/bin/env node
/*
  G1-CONTRACT-RELOCATION.fixtures.mjs —— 与 G1-CONTRACT-RELOCATION.md 互相对账的夹具。

  用法：node experiments/v3-code-architecture-poc/g1/G1-CONTRACT-RELOCATION.fixtures.mjs
  退出码：0 = 契约结构自洽 + 正反例全命中 + 十一条「架空判据必红」变异自验全部捕获；
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
const PRECHECK_GATES = ['AUTHORITY', 'ROUTE_STATE', 'NS_SHAPE', 'TARGET_UNCLAIMED', 'TARGET_EMPTY',
  'SOURCE_PARSEABLE', 'CONTENT_DIGEST', 'NO_INFLIGHT', 'CHAIN_INTACT', 'EPOCH_STABLE'];
// R-4（2026-11-01，汇编 I-4）：正文别处早已在用的两个取值**正式入集**为流程阶段门 11/12。
// 取 12 门而不是「把那两处换成集内门名」的理由在 RL-4 正文；两门的**修法**互不相同：
// 11 拒「批准主体资格」这一账外事实，12 拒「证据 digest 互检不等」这一证据面事实。
const FLOW_GATES = ['APPROVAL', 'REPAIR_PROVENANCE'];
const GATES = [...PRECHECK_GATES, ...FLOW_GATES];          // failedGate 取值封闭集 = 12
const gateValueOk = (v) => GATES.includes(v);
// 架空判据 MUT-7（常驻不删）：封闭集护栏写成「什么都算合法取值」= R-4 的空转锚
const gateValueOkMUT7 = () => true;
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
function callerBodyFor(code) { return JSON.stringify({ code }); } // R-1：调用方体零 hiddenBy* 遮蔽计数键
// 旧形态（**作废**，常驻仅供 T-N19 负例与 MUT-8 的判别力对拍）
function callerBodyForSuperseded(code) { return JSON.stringify({ code, echo: { hiddenByContractSkew: 0 } }); }
// R-1 判据（与 EA/FM 两侧同名判据同一把尺）
const callerSurfaceFreeOfShadowCounters = (body) => !/hiddenBy[A-Z]/.test(body);
// MUT-8 架空判据（常驻不删）：只核「响应体里不出现审计事件名/digest」——R-1 之前的全部内涵
const callerSurfaceFreeOfShadowCountersMUT8 = (body) => !/relocated|audit-recorded|Digest/.test(body);

// 机制内部直写的信封（全形，RL-5.4 / EA-4.5）——只有内部通道能产出，界外伪造走 rawLedgerInsert
function sealedEnvelope(by, cap) {
  return JSON.stringify({ axis: 'capability-admin', capability: cap,
    authorized: by.capabilityAdmin === true ? 1 : 0, actor: by.actorId,
    ruleSetVersion: 'r1', contractVersion: 'v3', truthSource: 'mechanism',
    entry: 'relocateNamespace', issuedSeq: null });
}

// ===== R-3（2026-11-01，汇编 I-3）：清单入选谓词 = 「物理有无 ns 位置列」，逐项区分两类账 =====
// (a) 位置键账：物理带 ns 列 ⇒ 进清单（现形全集）
const RELOCATABLE_NS_KEYS = ['domain_state'];
// (b) 挂载账：FM-2.1/FM-2.5 形状 —— PK (mount_id, gen)，位置键是**逻辑** target_oid，**无 ns 列**
const TABLE_SCHEMA = {
  domain_state: ['ns', 'oid', 'revision', 'payload_json', 'recorded_seq', 'contract_version'],
  object_directory: ['oid', 'space', 'kind', 'owner_capability', 'ns', 'created_seq'],
  capability_route: ['capability', 'plugin_id', 'ns', 'contract_version', 'enabled', 'changed_seq'],
  facet_mount: ['mount_id', 'gen', 'op', 'facet_capability', 'target_oid', 'binding', 'snapshot_revision', 'witness_seq'],
  ledger: ['seq', 'event_type', 'actor', 'authority_basis', 'payload_json', 'object_id'],
};
const nsKeyedTables = () => Object.keys(TABLE_SCHEMA).filter(t => TABLE_SCHEMA[t].includes('ns'));
// 双向构建期扫描判据：正向「ns-keyed 表未入清单」红；反向「清单里有不带 ns 列的表」也红（R-3 新增半边）
function scanNsKeyedKeys(list, opts = {}) {
  const exempt = opts.exempt ?? ['object_directory', 'capability_route']; // 逐表给「位置无关/由他机制管」论证，只减不增
  const missing = nsKeyedTables().filter(t => !list.includes(t) && !exempt.includes(t));
  const unlocationed = list.filter(t => !(TABLE_SCHEMA[t] ?? []).includes('ns'));
  return { buildRed: missing.length + unlocationed.length > 0, missing, unlocationed };
}
// 反向半边被架空 = MUT-9（常驻不删）：只查正向，把挂载表塞进清单也照样绿 ⇒ 正是「假保守」无人拦的形态
function scanNsKeyedKeysMUT9(list, opts = {}) { // 架空：只留正向半边（反向「清单里混进无 ns 列表」不再查）
  const exempt = opts.exempt ?? ['object_directory', 'capability_route'];
  const missing = nsKeyedTables().filter(t => !list.includes(t) && !exempt.includes(t));
  return { buildRed: missing.length > 0, missing, unlocationed: [] };
}function mountActive(w, mountId) { const rows = w.facet_mount.filter(r => r.mount_id === mountId); return rows.length > 0 && rows.sort((a, b) => a.gen - b.gen).pop().op === 'MOUNT'; }
function hasActiveMount(w, cap, oid) { return w.facet_mount.some(r => r.op === 'MOUNT' && r.facet_capability === cap && r.target_oid === oid); }
function facetWriteOk(w, cap, oid) { return hasActiveMount(w, cap, oid) ? { ok: true } : { refusal: 'REFUSE_UNMOUNTED' }; }

// 世界工厂
function mkWorld(opts = {}) {
  const w = {
    object_directory: new Map(), capability_route: new Map(), domain_state: [],
    records: new Map(), journal: [], ledger: [], meta: { ledger_seq: 0, ns_epoch: opts.nsEpoch ?? 0 },
    proposals: new Map(), relocSteps: [], committed: new Map(), quarantine: new Map(),
    facet_mount: [],                                    // R-3：挂载登记表（无 ns 列）
    nsNameApproved: opts.nsNameApproved !== false,       // R-5：EA-2.4 人工 Approved-By 是否已落地
    patchLog: [],                                        // R-6：显式修补账（运维修补面，不是事件名空间）
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
function precheckGates(w, p, by, subset) { for (const g of (subset || PRECHECK_GATES)) { const bad = runGate(g, w, p, by); if (bad) return bad; } return null; }
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
// ===== R-5（2026-11-01，汇编 I-5）：机制名批准门 =====
// `ns-relocated` 当前是 EA-2.4 的**提案名**（本合同 = 提案文书，不是批准文书；RL-2.2 R-5 更正段）。
// 人工 `Approved-By` 未落地 ⇒ 落账那一步装配红 fail-closed：整笔回滚，零半成品切换。
// 用 ACTIVATION_IMPOSSIBLE（FM-7「名册缺项 = 装配红」同族同码），**不是** failedGate 的成员——
// 它不是「迁移前提不满足」，是「本机制的落账名字尚未被批准存在」。
function mechanismNameGate(approved, eventType) {
  if (approved) return null;
  return { refusal: 'ACTIVATION_IMPOSSIBLE', detail: { gate: 'mechanism-name-not-approved', eventType, missing: 'Approved-By（EA-2.4 步骤 2 人工标记）' } };
}
// 架空批准门 MUT-6（常驻不删）：把「契约文书自称批准即过」写成判据 = I-5 的空转锚
const mechanismNameGateMUT6 = () => null;

// ===== R-6（2026-11-01，汇编 I-6）：呈现档修补 = 显式运维动作；机制绝不自动补戳 =====
const APPROVED_BY_RE = /^Approved-By: \d{4}-\d{2}-\d{2} \S+$/;
function patchPresentationTier(w, patch) { // 只追加修补行 + 只调呈现档，原行零改
  if (!APPROVED_BY_RE.test(patch.humanMarker ?? '')) return { refusal: 'PATCH_REQUIRES_HUMAN_MARKER' };
  const rows = w.domain_state.filter(r => r.ns === patch.ns && patch.oids.includes(r.oid));
  const before = JSON.stringify(rows);
  w.patchLog.push({ ns: patch.ns, oids: patch.oids.slice().sort(), fromTier: 'pre-cutover-default',
    toTier: patch.presentationTier, marker: patch.humanMarker, atSeq: patch.atSeq });
  if (JSON.stringify(w.domain_state.filter(r => r.ns === patch.ns && patch.oids.includes(r.oid))) !== before) {
    return { refusal: 'PATCH_MUTATED_HISTORY_ROW' };
  }
  return { ok: true, patched: rows.length, presentationTier: 'patched@seq' + patch.atSeq };
}
function presentationTierOf(w, row) {
  const hits = w.patchLog.filter(x => x.ns === row.ns && x.oids.includes(row.oid)).sort((a, b) => a.atSeq - b.atSeq);
  return hits.length ? hits[hits.length - 1].toTier : (row.contract_version === '' ? 'pre-cutover-default' : 'stamped');
}
// 真判据：重定位/打开期扫描零补戳路径
function autoStampScan(w) { void w; return { stamped: 0, verdict: 'NO_AUTO_STAMP_PATH' }; }
// 架空 MUT-10（常驻不删）：重定位顺带给无戳行盖章（gate 6「不越权代迁移器盖章」的违例形态）
function autoStampScanMUT10(w) { let n = 0; for (const r of w.domain_state) if (r.contract_version === '' || r.contract_version == null) { r.contract_version = 'v3'; n += 1; } return { stamped: n, verdict: 'AUTO_STAMPED' }; }

// ===== R-8（2026-11-01，工程审查 P1-1）：domain_state_no_update 窄化触发体（RL-5.2 第 3 处） =====
// 现体（改造前，全禁 UPDATE）：RL-5.1 步 3 的纯 ns 改写在它下面当场被拒——rl51.mjs 的夹具化复钉。
function domainStateUpdatePreNarrow(row, patch) { void row; void patch; throw new Refusal('DOMAIN_STATE_APPEND_ONLY'); } // domain_state_no_update（现体）
// 窄化体（规范形，RL-5.2 第 3 处）：WHEN 等式清单 = 非位置列全列逐等；任一非位置列变化 ⇒ abort，
// 信号文本逐字不变。opts.skipWhenClause = 架空 MUT-11（「窄化」写成全量放行 UPDATE）。
const DOMAIN_STATE_POSITION_COL = 'ns';
const DOMAIN_STATE_IMMUTABLE_COLS = ['oid', 'revision', 'payload_json', 'recorded_seq', 'contract_version']; // 与 RL-6.1 列语义表、契约 WHEN 清单三方逐等（S16）
function domainStateUpdate(row, patch, opts = {}) {
  if (opts.skipWhenClause) return { ...row, ...patch };                 // MUT-11：删 WHEN 等式核对 = 全量放行
  const dirty = Object.keys(patch).some(c => c !== DOMAIN_STATE_POSITION_COL && patch[c] !== row[c]);
  if (dirty) throw new Refusal('DOMAIN_STATE_APPEND_ONLY');             // 非位置列变化：窄化后仍拒
  return { ...row, ...patch };
}
const domainStateUpdateMUT11 = (row, patch) => domainStateUpdate(row, patch, { skipWhenClause: true });
// no_delete 面零改：DELETE 与 INSERT OR REPLACE（recursive_triggers=ON 的隐式删除）照拒——重定位不是删行通道
function domainStateDelete() { throw new Refusal('DOMAIN_STATE_APPEND_ONLY'); } // domain_state_no_delete（一字未动）
// REQUIRED_TRIGGERS 体摘要重锚（三件套①的可执行形态；打开判据 = 名在位 ∧ 体摘要与期望逐等，P-17 外置锚）
const triggerBodyDigests = new Map(); // 期望摘要表（外置正源形）：name → 'sha256:<hex>'
const triggerBodyRed = (name, liveBody) => !liveBody ? 'ABSENT'
  : !triggerBodyDigests.has(name) ? 'UNREGISTERED'
  : triggerBodyDigests.get(name) !== sha256(liveBody) ? 'DIGEST_MISMATCH' : null;

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
    // R-5：落账名字未获人工批准 ⇒ 装配红、整笔回滚（零半成品切换；不是「先切后补批准」）
    const ng = mechanismNameGate(w.nsNameApproved, NS_RELOC);
    if (ng) { restore(w, snap); return ng; }
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
  'SCHEMA_VERSION', 'QUARANTINED', 'PERMANENTLY_QUARANTINED',
  // RL-4 封闭集的**门名**（detail.failedGate 取值，不是 RefusalCode 成员）+ 引用到的他契约存储层信号
  'FAILED_GATES', 'APPROVAL', 'REPAIR_PROVENANCE', 'AUTHORITY', 'ROUTE_STATE', 'NS_SHAPE', 'TARGET_UNCLAIMED',
  'TARGET_EMPTY', 'SOURCE_PARSEABLE', 'CONTENT_DIGEST', 'NO_INFLIGHT', 'CHAIN_INTACT', 'EPOCH_STABLE',
  'MOUNT_ROW_FROZEN',
  // R-8（2026-11-01，工程审查 P1-1）：DOMAIN_STATE_APPEND_ONLY 是**既有存储层信号文本**
  // （sqlite-port.ts 触发器 raise(abort) 原文，非新拒绝码——RefusalCode 封闭集零扩员）；
  // DOMAIN_STATE_IMMUTABLE_COLS 是窄化等式清单的夹具常量名（RL-5.2 第 3 处三方逐等之夹具侧）。
  'DOMAIN_STATE_APPEND_ONLY', 'DOMAIN_STATE_IMMUTABLE_COLS']);
check('S3 契约内 backtick 全大写码全落「封闭拒绝码集 ∪ 新增声明码 ∪ 声明的存储/构建/状态信号」',
  [...tokensIn(doc)].every(t => CLOSED.has(t) || DECLARED.has(t)), [...tokensIn(doc)].filter(t => !CLOSED.has(t) && !DECLARED.has(t)).join(','));
check('S3b 新增拒绝码恰一枚 = RELOCATION_PRECONDITION（其余全在现状封闭集 ∪ 声明的门名/信号文本）',
  [...tokensIn(doc)].filter(t => !CLOSED.has(t) && !DECLARED.has(t)).length === 0
  && [...tokensIn(doc)].filter(t => !CLOSED.has(t) && !GATES.includes(t)).every(t => DECLARED.has(t))
  && doc.includes('RELOCATION_PRECONDITION')
  && GATES.filter(g => !DECLARED.has(g) && !CLOSED.has(g)).length === 0);

const casesInDoc = [...doc.matchAll(/\|\s*(T-[PN]\d{1,2})\s*\|/g)].map(m => m[1]);
const caseIds = [...SELF_SRC.matchAll(/^function run_T_([PN]\d{1,2})\(/gm)].map(m => 'T-' + m[1]);
check('S4 正反例表与夹具双向一致（表内每 id 都有 run_*，无孤儿实现，计数相等=32）',
  new Set(casesInDoc).size === caseIds.length && [...new Set(casesInDoc)].every(id => caseIds.includes(id)) && caseIds.length === 32,
  'doc=' + new Set(casesInDoc).size + ' fn=' + caseIds.length);

const faultsInDoc = [...doc.matchAll(/\|\s*(F-\d\d)\s*\|/g)].map(m => m[1]);
check('S5 故障矩阵 id 双向逐等（夹具 18 条 ↔ 正文表行，无缺无多）',
  faultsInDoc.length === FAULT_MATRIX.length && FAULT_MATRIX.every(f => faultsInDoc.includes(f)), 'doc=' + faultsInDoc.length);

const gateFromDoc = doc.includes('1. AUTHORITY') && doc.includes('10. EPOCH_STABLE')
  && doc.includes('11. APPROVAL') && doc.includes('12. REPAIR_PROVENANCE');   // R-4：11/12 正式入集
const gatesListed = GATES.every(g => doc.includes(g));
const gateValuesInDoc = [...doc.matchAll(/(?:failedGate|gate)='([A-Z_]{3,})'/g)].map(m => m[1]);
const strayGateValues = [...new Set(gateValuesInDoc)].filter(v => !GATES.includes(v));
check('S6 门清单封闭集三方逐等（正文 12 门逐名在位 ↔ 模型 GATES=12 ↔ 正文所有 failedGate/gate 取值 ⊆ 集；R-4）',
  gateFromDoc && gatesListed && GATES.length === 12 && PRECHECK_GATES.length === 10 && FLOW_GATES.length === 2
  && doc.includes('SOURCE_PARSEABLE') && doc.includes('TARGET_UNCLAIMED')
  && strayGateValues.length === 0 && gateValueOk('EVIDENCE_GRANT') === false,
  '正文缺门：' + GATES.filter(g => !doc.includes(g)).join(',') + ' 集外取值：' + strayGateValues.join(','));

check('S7 五要素（RL-1.3）+ B.7 五项映射逐条在位，「只改 route.ns 被明文禁止」句在位',
  ['实际数据搬迁', '物理位置映射', '审计见证', '原子切换', '历史读取'].every(s => doc.includes(s))
  && doc.includes('「只改 `route.ns`」被本契约明文禁止')
  && ['迁移前数据校验与目标准备', '唯一权威 + 历史修订身份不变性', '活跃路由切换原子性', '失败/崩溃/重试/跨版本读取恢复条件', '物理复制不得当成新科研历史事件'].every(s => doc.includes(s)));

check('S8 冻结关键句在位（自立/C6 撤销/不产生新科研事实/backfill 默认禁止/隔离并明确报告/回退不删历史）',
  doc.includes('对「打开期检出 ns 漂移」零提及、零承接') && doc.includes('迁移记录与数据/路由更新原子一致')
  && doc.includes('不产生新科研事实、不产生新科研修订') && doc.includes('默认禁止自动补造「当时合法迁移」的证据')
  && doc.includes('隔离并明确报告') && doc.includes('不得自动改写旧结论')
  && doc.includes('C6 撤销') && doc.includes('永久保留「事后修复」与「当时发生的合法迁移」之别'));

check('S9 十一条变异常驻本夹具（MUT-1..5 原有 + MUT-6 批准门 / MUT-7 封闭集护栏 / MUT-8 呈现面 / MUT-9 反向扫描 / MUT-10 自动补戳，R-1/R-3/R-4/R-5/R-6 各配一条 + MUT-11 R-8 窄化体架空）',
  ['chainCheckMUT1', 'routeGuardMUT2', 'repairMUT3', 'routeGuardMUT4', 'routeGuardMUT5', 'mechanismNameGateMUT6',
    'gateValueOkMUT7', 'callerSurfaceFreeOfShadowCountersMUT8', 'scanNsKeyedKeysMUT9', 'autoStampScanMUT10',
    'domainStateUpdateMUT11']
    .every(fn => new RegExp('(?:function|const) ' + fn + '\\b').test(SELF_SRC)));

// —— 2026-11-01 跨契约对账留痕（R-1/R-3/R-5/R-6）：两侧条文互指，任一侧单独回滚即红 ——
const readOpt = (pth) => { try { return readFileSync(pth, 'utf8'); } catch { return ''; } };
const eaDocX = readOpt(join(HERE, 'G1-CONTRACT-EVENT-AUTHORITY.md'));
const fmDocX = readOpt(join(HERE, 'G1-CONTRACT-FACET.md'));
check('S12 R-3 两侧互指在位：本契约 RL-3.4/RL-6.4 的类别谓词 + 零搬迁 ↔ FM-2.5/FM-11.1 同步句（A.6-6 旧句仍在原位）',
  doc.includes('物理有无 `ns` 位置列') && doc.includes('零搬迁') && doc.includes('R-3 更正')
  && doc.includes('挂载登记表') && fmDocX.includes('零搬迁') && fmDocX.includes('没有 `ns` 列')
  && fmDocX.includes('挂载登记、Facet 扩展记录')      // A 侧旧句保留（更正段不静默覆盖）
  && fmDocX.includes('不进** B 契约')                 // A 侧新句：明确不入该集合
  && doc.includes('A.6-6 的接口即此谓词'));
check('S13 R-6 收口句两侧同文（EA-5.3 / RL-6.1 / RL-8.4 各补一次；「绝不自动补戳」+「呈现档」+「改写历史语义」）',
  doc.includes('绝不自动补戳') && doc.includes('呈现档') && doc.includes('改写历史语义')
  && eaDocX.includes('绝不自动补戳') && eaDocX.includes('呈现档') && eaDocX.includes('改写历史语义'));
check('S14 R-5 提案文书降级在本契约在位（旧「即批准」句保留 + 划线 + fail-closed 代价成文），且 EA 侧同步',
  doc.includes('**提案文书**，不是批准文书') && doc.includes('~~本契约即 EA-2.4 流程的「机制新增可观察运行事实」提案与批准文书~~')
  && doc.includes('ACTIVATION_IMPOSSIBLE') && doc.includes('T-N20')
  && eaDocX.includes('提案文书') && eaDocX.includes('判据≠批准'));
check('S15 R-1 出口更正在本契约在位（「扫描面照旧 ≠ 调用方面照旧」+ 报告面半句），且 EA 侧 R-1 更正段在位',
  doc.includes('扫描面照旧 ≠ 调用方面照旧') && doc.includes('调用方可见响应体零')
  && doc.includes('hiddenBy*') && doc.includes('只进这一面')
  && eaDocX.includes('R-1 更正段') && eaDocX.includes('改的是出口'));

// S16（R-8，工程审查 P1-1）：窄化触发体判据**三方逐等**——契约 WHEN 等式清单 ↔ RL-6.1 列语义表
// （本夹具以常量列形）↔ 夹具 DOMAIN_STATE_IMMUTABLE_COLS；P-07 锚点错句按更正纪律**保留在位**
// （划线不删除），三处不相容点名、no_delete 零改句、摘要重锚三件套句全部成文。
check('S16 R-8 窄化等式清单三方逐等 + P-07 错锚更正就地留痕 + 三处不相容点名 + no_delete 零改 + 摘要重锚三件套在位',
  (() => {
    const whenBlock = (doc.match(/when not \(([\s\S]*?)\)\s*begin/) ?? [])[1] ?? '';
    const cols = [...whenBlock.matchAll(/new\.(\w+) is old\.\1/g)].map(m => m[1]);
    const whenEq = new Set(cols).size === cols.length && new Set(cols).size === DOMAIN_STATE_IMMUTABLE_COLS.length
      && DOMAIN_STATE_IMMUTABLE_COLS.every(c => cols.includes(c));
    const tableEq = TABLE_SCHEMA.domain_state.filter(c => c !== DOMAIN_STATE_POSITION_COL)
      .every(c => DOMAIN_STATE_IMMUTABLE_COLS.includes(c))
      && DOMAIN_STATE_IMMUTABLE_COLS.every(c => TABLE_SCHEMA.domain_state.includes(c));
    return whenEq && tableEq
      && doc.includes('三处不相容') && doc.includes('R-8')
      && doc.includes('无不可变性触发器') && doc.includes('~~**无不可变性触发器**~~')   // 旧错句保留（划线更正，非静默覆盖）
      && doc.includes('domain_state_no_delete') && doc.includes('一字不动')
      && doc.includes('名保留、体摘要重登') && doc.includes('本契约不钉死数字');
  })(),
  'WHEN 清单与常量集不等或更正句缺位');

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

function run_T_P10() { // R-3 正例：挂载账零搬迁 + 扩展记录随 domain_state 搬 + 清单不含挂载表
  const w = mkWorld(); addRoute(w, 'cap-a', 'ns-1'); addObject(w, 'O1', 'cap-a', 'ns-1', 1); addState(w, 'ns-1', 'O1', 1, { v: 1 }, 1);
  addState(w, 'ns-1', 'O1', 2, { facet: 'ext' }, 2);
  w.facet_mount.push({ mount_id: 'FM-1', gen: 1, op: 'MOUNT', facet_capability: 'cap-a', target_oid: 'O1',
    binding: 'NAVIGATION', snapshot_revision: 1, witness_seq: 1 });
  const mountBefore = JSON.stringify(w.facet_mount);
  if (!hasActiveMount(w, 'cap-a', 'O1')) return '挂载初始应 ACTIVE';
  const id = proposeRelocation(w, { capability: 'cap-a', expectedFromNs: 'ns-1', toNs: 'ns-2' }, ADMIN);
  approveRelocation(w, id, ADMIN2); precheckRelocation(w, id, ADMIN2);
  const ex = executeRelocation(w, id, ADMIN2);
  if (ex.refusal) return '切换被拒：' + JSON.stringify(ex);
  if (JSON.stringify(w.facet_mount) !== mountBefore) return '挂载登记表被搬动（R-3：该表零搬迁）';
  if (!hasActiveMount(w, 'cap-a', 'O1') || !mountActive(w, 'FM-1')) return '目标物理迁移后挂载语义变了（应不变）';
  if (!facetWriteOk(w, 'cap-a', 'O1').ok) return '迁移后扩展记录不可写（挂载判据输入应逐字不变）';
  if (!w.domain_state.some(r => r.ns === 'ns-2' && r.oid === 'O1' && r.revision === 2)) return '扩展记录行未随 domain_state 搬走';
  const scan = scanNsKeyedKeys(RELOCATABLE_NS_KEYS);
  if (scan.buildRed || RELOCATABLE_NS_KEYS.includes('facet_mount')) return '清单形状不符 R-3 收窄：' + JSON.stringify(scan);
  return true;
}
function run_T_N17() { // R-4 负例：集外取值必红；11/12 两门各以不同修法命中
  if (GATES.length !== 12 || !GATES.includes('APPROVAL') || !GATES.includes('REPAIR_PROVENANCE')) return '封闭集非 12 门';
  const stray = 'EVIDENCE_GRANT';
  if (gateValueOk(stray) !== false) return '集外取值未被拦（封闭集失守）';
  if (gateValueOkMUT7(stray) !== true) return 'MUT-7 竟能拦住——封闭集护栏对架空失去判别力';
  if (GATES.some(g => !doc.includes(g))) return '正文缺门：' + GATES.filter(g => !doc.includes(g)).join(',');
  const usedInDoc = [...doc.matchAll(/(?:failedGate|gate)='([A-Z_]{3,})'/g)].map(m => m[1]);
  const strayInDoc = usedInDoc.filter(v => !gateValueOk(v));
  if (strayInDoc.length) return '正文出现集外取值：' + strayInDoc.join(',');
  // 第 11 门：批准主体资格（账外事实）
  const w1 = worldTwo();
  const id1 = proposeRelocation(w1, { capability: 'cap-a', expectedFromNs: 'ns-1', toNs: 'ns-2' }, ADMIN);
  const self = approveRelocation(w1, id1, ADMIN);
  if (self.detail?.failedGate !== 'APPROVAL') return '第 11 门未命中自批：' + JSON.stringify(self);
  // 第 12 门：证据 digest 互检（证据面事实）——修法与第 11 门不同
  const w2 = mkWorld(); addRoute(w2, 'cap-a', 'ns-2'); addObject(w2, 'O1', 'cap-a', 'ns-1', 1); addState(w2, 'ns-1', 'O1', 1, { v: 1 }, 1);
  const rid = proposeRepair(w2, { capability: 'cap-a', fromNs: 'ns-1', toNs: 'ns-2', evidence: { sourceRefs: ['b'], operationGrant: 'G', observedDriftDigest: 'sha256:错' } }, ADMIN);
  approveRepair(w2, rid, ADMIN2);
  if (executeRepair(w2, rid, ADMIN2).detail?.failedGate !== 'REPAIR_PROVENANCE') return '第 12 门未命中 digest 互检不等';
  if (self.detail.failedGate === executeRepair(w2, rid, ADMIN2).detail.failedGate) return '两门塌成同一取值（修法未区分）';
  return true;
}
function run_T_N18() { // R-3 负例：双向扫描——塞进无 ns 列表 = 红；漏登记 ns-keyed 表 = 红
  const wrongA = scanNsKeyedKeys([...RELOCATABLE_NS_KEYS, 'facet_mount']);
  if (!wrongA.buildRed || !wrongA.unlocationed.includes('facet_mount')) return '把挂载表塞进清单未被判红（反向半边失守）';
  if (scanNsKeyedKeysMUT9([...RELOCATABLE_NS_KEYS, 'facet_mount']).buildRed !== false) return 'MUT-9 竟能拦住——反向半边对架空失去判别力';
  TABLE_SCHEMA.facet_index = ['ns', 'oid', 'tag']; // 新增一张带 ns 列的表却漏登记
  const wrongB = scanNsKeyedKeys(RELOCATABLE_NS_KEYS);
  delete TABLE_SCHEMA.facet_index;
  if (!wrongB.buildRed || !wrongB.missing.includes('facet_index')) return '新增 ns-keyed 表漏登记未被判红（正向半边失守）';
  const good = scanNsKeyedKeys(RELOCATABLE_NS_KEYS);
  if (good.buildRed) return '正确清单被误拦：' + JSON.stringify(good);
  if (nsKeyedTables().includes('facet_mount')) return '模型里挂载表竟带 ns 列（与 FM-2.1 形状矛盾）';
  return true;
}
function run_T_N19() { // R-1 负例：调用方拒答体带旧形态 hiddenBy* ⇒ 红；计数仍在运维面
  const w = mkWorld(); addRoute(w, 'cap-a', 'ns-2'); addObject(w, 'O1', 'cap-a', 'ns-1', 1);
  const scan = openScan(w);
  if (scan.refuse !== 'SCHEMA_UPGRADE_REQUIRED') return '负例构造失效：' + JSON.stringify(scan);
  if (callerSurfaceFreeOfShadowCounters(scan.caller) !== true) return '新调用方体被误判：' + scan.caller;
  const leak = callerBodyForSuperseded('SCHEMA_UPGRADE_REQUIRED');
  if (callerSurfaceFreeOfShadowCounters(leak) !== false) return '旧形态泄漏体未被点名';
  if (callerSurfaceFreeOfShadowCountersMUT8(leak) !== true) return 'MUT-8 竟能点名——判据对架空失去判别力';
  if (!scan.opsDetail || !('relocationGapCount' in scan.opsDetail)) return '计数未在运维/审计面可回看（R-1 改的是出口不是删除）';
  return true;
}
function run_T_N20() { // R-5 负例：无 Approved-By ⇒ 落账装配红、整笔回滚；标记落地后同调用成功
  const w = mkWorld({ nsNameApproved: false });
  addRoute(w, 'cap-a', 'ns-1'); addObject(w, 'O1', 'cap-a', 'ns-1', 1); addState(w, 'ns-1', 'O1', 1, { v: 1 }, 1);
  const id = proposeRelocation(w, { capability: 'cap-a', expectedFromNs: 'ns-1', toNs: 'ns-2' }, ADMIN);
  approveRelocation(w, id, ADMIN2);
  const pc = precheckRelocation(w, id, ADMIN2);
  if (!pc.ok) return '前三步应照跑照记账：' + JSON.stringify(pc);
  const before = snapshot(w);
  const ex = executeRelocation(w, id, ADMIN2);
  if (ex.refusal !== 'ACTIVATION_IMPOSSIBLE') return '未批准期间竟能落账：' + JSON.stringify(ex);
  if (snapshot(w) !== before) return '未批准落账留下半成品切换（应整笔回滚）';
  if (w.ledger.some(l => l.event_type === NS_RELOC)) return '未批准仍落了 ns-relocated 行';
  if (mechanismNameGateMUT6(false, NS_RELOC) !== null) return 'MUT-6 竟能拦住——批准门对架空失去判别力';
  w.nsNameApproved = true; // 人工标记落地
  const ok = executeRelocation(w, id, ADMIN2);
  if (ok.refusal) return '标记落地后同一调用未成功：' + JSON.stringify(ok);
  return true;
}
function run_T_N21() { // R-6 负例：重定位不是盖章通道；MUT-10（顺带盖章）改了历史行字节 ⇒ 判别力
  const w = mkWorld(); addRoute(w, 'cap-a', 'ns-1'); addObject(w, 'O1', 'cap-a', 'ns-1', 1);
  addState(w, 'ns-1', 'O1', 1, { v: 1 }, 1, '');           // 迁移器回填前形态（无戳）
  const id = proposeRelocation(w, { capability: 'cap-a', expectedFromNs: 'ns-1', toNs: 'ns-2' }, ADMIN);
  approveRelocation(w, id, ADMIN2); precheckRelocation(w, id, ADMIN2);
  if (executeRelocation(w, id, ADMIN2).refusal) return '合法切换被拒';
  const moved = w.domain_state.find(r => r.oid === 'O1' && r.revision === 1);
  if (moved.contract_version !== '') return '重定位顺带盖章（gate 6「不代盖章」破）：' + moved.contract_version;
  if (presentationTierOf(w, moved) !== 'pre-cutover-default') return '无戳行呈现档不该变：' + presentationTierOf(w, moved);
  if (autoStampScan(w).stamped !== 0) return '真判据存在自动补戳路径';
  const patch = patchPresentationTier(w, { ns: moved.ns, oids: ['O1'], presentationTier: 'v3', humanMarker: '', atSeq: 9 });
  if (patch.refusal !== 'PATCH_REQUIRES_HUMAN_MARKER') return '无人工标记的修补被放行';
  const okPatch = patchPresentationTier(w, { ns: moved.ns, oids: ['O1'], presentationTier: 'v3', humanMarker: 'Approved-By: 2026-11-01 user:wu', atSeq: 9 });
  if (!okPatch.ok) return '显式修补被拒：' + patch.refusal;
  if (w.domain_state.find(r => r.oid === 'O1' && r.revision === 1).contract_version !== '') return '修补改了原行字节（应只追加）';
  if (presentationTierOf(w, moved) !== 'v3') return '修补未调呈现档';
  const w2 = mkWorld(); addState(w2, 'ns-1', 'O9', 1, { v: 1 }, 1, '');
  if (autoStampScanMUT10(w2).stamped === 0) return 'MUT-10 竟能拦住自动补戳——判据失去判别力';
  return true;
}

// T-N22（R-8，工程审查 P1-1）：窄化触发体的**两侧**判据 + 摘要重锚义务 + REPLACE 旁路封堵。
// (a) 现体连纯 ns 都拒（P1-1 反例的常驻复跑，不再只活在 /tmp 一次性脚本里）；(b) 窄化体放行纯 ns；
// (c) 五个非位置列 × {单改, 连带 ns 一起改} 十形全拒；(d) 体改了摘要没登 ⇒ 打开红，重登后绿，
// 体再漂移又红（「删定义」= ABSENT 照红）；(e) REPLACE/DELETE 面一字未动照拒；(f) MUT-11 判别力。
function run_T_N22() {
  const row = { ns: 'ns-1', oid: 'O1', revision: 1, payload_json: '{"v":1}', recorded_seq: 7, contract_version: 'v3' };
  let preBlocked = null; try { domainStateUpdatePreNarrow(row, { ns: 'ns-2' }); } catch (e) { preBlocked = e.code; }
  if (preBlocked !== 'DOMAIN_STATE_APPEND_ONLY') return '现体未拒纯 ns UPDATE（反例复钉失败）：' + preBlocked;
  const moved = domainStateUpdate(row, { ns: 'ns-2' });
  if (moved.ns !== 'ns-2' || DOMAIN_STATE_IMMUTABLE_COLS.some(c => moved[c] !== row[c])) return '纯 ns 改写应过且零碰其余列';
  const noop = domainStateUpdate(row, { ns: 'ns-1' }); // no-op 是无害退化形（契约明写不加判据）
  if (JSON.stringify(noop) !== JSON.stringify(row)) return 'no-op UPDATE 不该产生任何字节变化';
  for (const col of DOMAIN_STATE_IMMUTABLE_COLS) {
    for (const patch of [{ [col]: col + '#tampered' }, { ns: 'ns-3', [col]: col + '#tampered' }]) {
      let blocked = null; try { domainStateUpdate(row, patch); } catch (e) { blocked = e.code; }
      if (blocked !== 'DOMAIN_STATE_APPEND_ONLY') return `非位置列 ${col}（${'ns' in patch ? '连带ns' : '单改'}）未被拒`;
    }
  }
  const oldBody = 'BEGIN RAISE(abort, DOMAIN_STATE_APPEND_ONLY) FOR-ALL-UPDATE END';
  const newBody = 'WHEN NOT (new.oid is old.oid AND ...5-cols...) BEGIN RAISE(abort, DOMAIN_STATE_APPEND_ONLY) END';
  if (triggerBodyRed('domain_state_no_update', newBody) !== 'UNREGISTERED') return '体改了摘要未登应红（未登记形态漏网）';
  triggerBodyDigests.set('domain_state_no_update', sha256(oldBody));
  if (triggerBodyRed('domain_state_no_update', newBody) !== 'DIGEST_MISMATCH') return '旧摘要在场、体已换应红';
  triggerBodyDigests.set('domain_state_no_update', sha256(newBody));
  if (triggerBodyRed('domain_state_no_update', newBody) !== null) return '重登后仍红（重登应放行）';
  if (triggerBodyRed('domain_state_no_update', newBody + '#drift') !== 'DIGEST_MISMATCH') return '体再漂移未被抓';
  if (triggerBodyRed('domain_state_no_update', '') !== 'ABSENT') return '「删定义」形态未被拦（P-17 违例）';
  let delBlocked = null; try { domainStateDelete(); } catch (e) { delBlocked = e.code; }
  if (delBlocked !== 'DOMAIN_STATE_APPEND_ONLY') return 'no_delete 面被改动（重定位不是删行通道）';
  let mutPassed = false; try { mutPassed = domainStateUpdateMUT11(row, { payload_json: '#tampered' }).payload_json === '#tampered'; } catch { mutPassed = false; }
  if (!mutPassed) return 'MUT-11 架空体没放过改写——窄化判据对架空失去判别力';
  return true;
}

const CASE_RUNNERS = { run_T_P1, run_T_P2, run_T_P3, run_T_P4, run_T_P5, run_T_P6, run_T_P7, run_T_P8, run_T_P9,
  run_T_N1, run_T_N2, run_T_N3, run_T_N4, run_T_N5, run_T_N6, run_T_N7, run_T_N8, run_T_N9, run_T_N10,
  run_T_N11, run_T_N12, run_T_N13, run_T_N14, run_T_N15, run_T_N16,
  run_T_P10, run_T_N17, run_T_N18, run_T_N19, run_T_N20, run_T_N21, run_T_N22 };
for (const id of caseIds) {
  const fn = CASE_RUNNERS['run_' + id.replace('-', '_')];
  let out; try { out = fn(); } catch (e) { out = '抛异常：' + e.message; }
  check('CASE ' + id, out === true, typeof out === 'string' ? out : '');
}

// ============================================================ 架空判据必红（十一条自验，变异常驻）

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

check('MUT-6 架空「契约自称批准即过」被 T-N20 判据区分（真批准门拒未入账落账、架空的放行）',
  mechanismNameGate(false, NS_RELOC).refusal === 'ACTIVATION_IMPOSSIBLE' && mechanismNameGateMUT6(false, NS_RELOC) === null);
check('MUT-7 架空「取值全都合法」被 T-N17 判据区分（真封闭集拒第 13 个取值、架空的放行）',
  gateValueOk('EVIDENCE_GRANT') === false && gateValueOkMUT7('EVIDENCE_GRANT') === true);
check('MUT-8 架空「只核审计事件名」被 T-N19 判据区分（真判据拦旧形态 hiddenBy 泄漏、架空的放过）',
  callerSurfaceFreeOfShadowCounters(callerBodyForSuperseded('SCHEMA_INCOMPATIBLE')) === false
  && callerSurfaceFreeOfShadowCountersMUT8(callerBodyForSuperseded('SCHEMA_INCOMPATIBLE')) === true);
check('MUT-9 架空「只查正向半边」被 T-N18 判据区分（真双向扫描红于清单混入无 ns 列表、架空的绿）',
  scanNsKeyedKeys([...RELOCATABLE_NS_KEYS, 'facet_mount']).buildRed === true
  && scanNsKeyedKeysMUT9([...RELOCATABLE_NS_KEYS, 'facet_mount']).buildRed === false);
check('MUT-10 架空「重定位顺带盖章」被 T-N21 判据区分（真判据零补戳、架空的真改了历史行字节）',
  (() => { const w = mkWorld(); addState(w, 'ns-1', 'OZ', 1, { v: 1 }, 1, ''); const before = JSON.stringify(w.domain_state);
    return autoStampScan(w).stamped === 0 && JSON.stringify(w.domain_state) === before
      && autoStampScanMUT10(w).stamped === 1 && JSON.stringify(w.domain_state) !== before; })());
check('MUT-11 架空「窄化=全量放行 UPDATE」被 T-N22 判据区分（真窄化体拒非位置列改写、架空的放过同一负例）',
  (() => { const row = { ns: 'ns-1', oid: 'O1', revision: 1, payload_json: '{"v":1}', recorded_seq: 7, contract_version: 'v3' };
    let realBlocked = false; try { domainStateUpdate(row, { payload_json: '#tampered' }); } catch (e) { realBlocked = e.code === 'DOMAIN_STATE_APPEND_ONLY'; }
    let mutPassed = false; try { mutPassed = domainStateUpdateMUT11(row, { payload_json: '#tampered' }).payload_json === '#tampered'; } catch { mutPassed = false; }
    return realBlocked && mutPassed; })());

process.stdout.write('\n合计：' + pass + ' PASS / ' + fail + ' FAIL\n');
if (fail > 0) { process.stdout.write('未通过项：\n  ' + fails.join('\n  ') + '\n'); process.exitCode = 1; }
else process.exitCode = 0;
