#!/usr/bin/env node
/**
 * preflight/ns/run.mjs — P-NS 最小真实测试：稳定物理命名空间 vs 通用重定位
 *
 * 授权与判据：`g1/G2-DEV-PLAN.md §0bis / P-NS`（2026-11-03 外部审查收口，现行）。
 * 对照假说：
 *   H0 = `CapabilityID` 稳定、持久 `storage_ns` 与 Plugin 包名分离，允许更换实现与
 *        **重启式离线 Schema 迁移**；
 *   H1 = 当前 RL/PR-8 的**物理位置迁移**（`ns-relocated` 通道）。
 * 性质：类甲实验（只读引用 `src/**` 机制本体，不落生产代码；无 DDL 进生产、无新事件名入封闭名单）。
 *
 * 五项与判定（§0bis P-NS「最小真实测试」逐字对应）：
 *   ① 同 CapabilityID 更换 PluginID 后旧 ObjectID/RevisionRef、旧事件与检查报告按原版本可读；
 *   ② 只升级一个 Space，另一空间仍可运行；
 *   ③ 不改变持久 ns/owner，缺旧解释器时 fail-loud 而非重解释；
 *   ④ 离线 Schema 升级的注入崩溃全回滚，重启后可恢复；
 *   ⑤ Facet/跨能力的精确引用在拆包后不漂移（合成挂载）。
 * 每项附**真正打破该保证的负例**。
 *
 * 迁移形态（本实验的关键事实）：`domain_state` 在存储层是追加式表
 * （`domain_state_no_update` / `domain_state_no_delete` 触发器 ⇒ 在线 DML 改版本戳被判据拒绝）。
 * 故 H0 的「重启式离线 Schema 迁移」在本仓形态下 = **离线窗口内单事务重写（DROP TRIGGER →
 * 盖戳 → 重建 TRIGGER → COMMIT）+ 换库后重启**；在线 DML 面仍被触发器拒绝（负例实测）。
 * 由该形态可直接推出：迁移的原子边界 = 事务提交/换库，崩溃必全回滚。
 *
 * 退出码约定（§0bis 固定产物规格）：
 *   0  = PASS_STABLE_NS（五项全过且 Kernel 未引入领域特殊分支）
 *   10 = RELOCATION_REQUIRED（提供无法用离线迁移/ns 解耦/普通适配消除的 Q44/Q45/历史不变量最小反例）
 *   2  = INCONCLUSIVE / 无效（脚手架故障、未定；不得把失败脚手架包装成技术否证）
 *
 * 运行环境：Node v24（`node:sqlite` 内置；`src/**` 为 TS，本文件以 `--experimental-transform-types`
 * 自重启加载——固定命令仍是 `node experiments/v3-code-architecture-poc/preflight/ns/run.mjs`）。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const SELF = fileURLToPath(import.meta.url);
const POC = dirname(dirname(dirname(SELF)));
const log = (...a) => console.log(...a);
const TRIGGER = 'domain_state_no_update';

// ───────────────────── 崩溃注入子进程（纯 raw sqlite，不加载任何 TS） ─────────────────────
// 用法：node run.mjs --crash-child <db> <ns> <fromV> <toV> [--no-tx]
//   事务形（默认）：BEGIN IMMEDIATE → DROP TRIGGER → 改一半行 → exit 9（不提交）⇒ 重开后全量回滚（含触发器恢复）。
//   非事务形（--no-tx）：DROP TRIGGER（autocommit）→ 逐行 autocommit 改一半 → exit 9 ⇒ 混合态 + 触发器缺失留存（负例）。
if (process.argv.includes('--crash-child')) {
  const rest = process.argv.slice(3);
  const [dbPath, ns, fromV, toV] = rest;
  const noTx = rest.includes('--no-tx');
  const db = new DatabaseSync(dbPath);
  const trig = db.prepare("select sql from sqlite_master where type='trigger' and name=?").get(TRIGGER).sql;
  const rows = db.prepare(
    'select oid, revision from domain_state where ns=? and contract_version=? order by oid, revision',
  ).all(ns, fromV);
  const upto = Math.max(1, Math.floor(rows.length / 2));
  const upd = db.prepare('update domain_state set contract_version=? where ns=? and oid=? and revision=?');
  if (!noTx) db.exec('BEGIN IMMEDIATE');
  db.exec(`DROP TRIGGER ${TRIGGER}`);
  let n = 0;
  for (const r of rows) {
    upd.run(toV, ns, r.oid, r.revision);
    n++;
    if (n >= upto) {
      log(`[crash-child] ${noTx ? '(非事务)' : '(事务内)'}已改 ${n}/${rows.length} 行，未提交即崩溃 exit 9`);
      process.exit(9);
    }
  }
  process.exit(9);
}

// ───────────────────── 以 transform-types 自重启（参数与退出码透传） ─────────────────────
if (!process.execArgv.some((a) => a.startsWith('--experimental-transform-types'))) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-transform-types', '--no-warnings', SELF, ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(r.status ?? 2);
}

// ───────────────────── 加载机制本体（只读引用 src/**） ─────────────────────
const { openWorld, PRINCIPAL } = await import('../../src/harness/world.ts');
const { TEST_OBJECT_MODEL, TEST_OBJECT_MODEL_SPLIT, CAP_OBJECT_MODEL } =
  await import('../../src/domains/test-object-model.ts');
const { TEST_FACET_CALIB, CAP_FACET, FacetStore } = await import('../../src/domains/test-facet.ts');

const ADMIN = PRINCIPAL('pns-admin');
const GRANTS = { 'pns-admin': ['space-write', 'capability-admin'] };
const NS = TEST_OBJECT_MODEL.storageNamespace;          // 'dom_test_om'
const NS_FACET = TEST_FACET_CALIB.storageNamespace;     // 'dom_test_facet'

/** v2 实现：同能力、同 ns、契约版本升到 v2（换实现 + 版本升级的最小夹具）。 */
const V2 = {
  ...TEST_OBJECT_MODEL,
  pluginId: 'test.object-model.v2',
  codeVersion: '0.0.3',
  provides: [{ capability: CAP_OBJECT_MODEL, contractVersion: 'v2' }],
};
/** Facet 拆包后的实现：pluginId 变、能力与 ns 不变（Q45 拆包材料）。 */
const FACET_SPLIT = { ...TEST_FACET_CALIB, pluginId: 'test.instrument-facet.split', codeVersion: '0.0.2' };

const results = [];
const failures = [];
function check(id, title, fn) {
  try {
    const detail = fn();
    results.push({ id, ok: true, detail });
    log(`\n✅ [${id}] ${title}\n   ${detail}`);
  } catch (e) {
    results.push({ id, ok: false, detail: String(e && e.message ? e.message : e) });
    failures.push(`${id}: ${e && e.message ? e.message : e}`);
    log(`\n❌ [${id}] ${title}\n   ${e && e.stack ? e.stack : e}`);
  }
}
const eq = (a, b, what) => {
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${what} 不一致：\n    实际=${sa}\n    期望=${sb}`);
};
const sha = (o) => createHash('sha256').update(JSON.stringify(o)).digest('hex');
const fileSha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const refusal = (fn) => {
  try { fn(); return 'NO_REFUSAL'; } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    // node:sqlite 把触发器 abort 包成 ERR_SQLITE_ERROR，拒绝码在 message 里
    const m = msg.match(/\b([A-Z][A-Z0-9_]{5,})\b/);
    return (e && e.code && e.code !== 'ERR_SQLITE_ERROR') ? e.code : (m ? m[1] : `OTHER:${msg.slice(0, 80)}`);
  }
};

mkdirSync(join(POC, '.poc-data'), { recursive: true });
const dir = mkdtempSync(join(POC, '.poc-data', 'pns-'));
const fileA = join(dir, 'space-a.db');
const fileB = join(dir, 'space-b.db');

/** 原始行快照（世界关闭时读；域状态 + 身份行 + 路由行 + 账本计数 + 触发器在位）。 */
function rawSnap(dbPath, ns) {
  const db = new DatabaseSync(dbPath);
  try {
    const state = db.prepare('select oid, revision, contract_version from domain_state where ns=? order by oid, revision').all(ns);
    const dirRows = db.prepare('select oid, space, kind, owner_capability, ns from object_directory order by oid').all();
    const routes = db.prepare('select capability, plugin_id, ns, contract_version, enabled from capability_route order by capability').all();
    const ledger = db.prepare('select count(*) c from ledger').get().c;
    const triggers = db.prepare("select name from sqlite_master where type='trigger' and name in ('domain_state_no_update','domain_state_no_delete') order by name").all().map((r) => r.name);
    return { state, dirRows, routes, ledger, triggers, hash: sha({ state, dirRows, routes, ledger, triggers }) };
  } finally { db.close(); }
}

/** WAL 库的安全副本：先 checkpoint 再复制（否则 -wal 里的已提交页会丢）。 */
function cleanCopy(src, dst) {
  const db = new DatabaseSync(src);
  try { db.exec('pragma wal_checkpoint(TRUNCATE)'); } finally { db.close(); }
  copyFileSync(src, dst);
}

/**
 * 离线迁移（重启式）：Kernel 未打开该库的窗口内，单事务重写版本戳并原子换库。
 * 触发器在同事务内恢复 ⇒ 崩溃即回滚（触发器与数据一起回滚），在线判据不受影响。
 * skipOid：刻意漏盖一行（负例夹具：模拟「迁移漏盖/缺旧解释器」）。
 */
function migrateOffline(dbPath, ns, fromV, toV, { skip = null } = {}) {
  const work = `${dbPath}.migrating-${process.pid}`;
  cleanCopy(dbPath, work);
  const db = new DatabaseSync(work);
  try {
    const trig = db.prepare("select sql from sqlite_master where type='trigger' and name=?").get(TRIGGER).sql;
    db.exec('BEGIN IMMEDIATE');
    db.exec(`DROP TRIGGER ${TRIGGER}`);
    const r = skip
      ? db.prepare('update domain_state set contract_version=? where ns=? and contract_version=? and not (oid=? and revision=?)')
          .run(toV, ns, fromV, skip.oid, skip.revision)
      : db.prepare('update domain_state set contract_version=? where ns=? and contract_version=?').run(toV, ns, fromV);
    db.exec(trig);
    db.exec('COMMIT');
    const integrity = db.prepare('pragma integrity_check').get();
    if (String(Object.values(integrity)[0]) !== 'ok') throw new Error(`迁移后完整性检查未过：${JSON.stringify(integrity)}`);
    db.close();
    rmSync(`${dbPath}-wal`, { force: true });   // 旧 WAL 不得随换库留下（否则读面按旧页回滚）
    rmSync(`${dbPath}-shm`, { force: true });
    renameSync(work, dbPath);   // 原子换库：提交边界 = 换库，崩溃只会留下旧库或完整新库
    return Number(r.changes ?? 0);
  } catch (e) {
    try { db.close(); } catch {}
    try { rmSync(work, { force: true }); } catch {}
    throw e;
  }
}

log('════════ P-NS：稳定物理命名空间 vs 通用重定位（最小真实测试） ════════');
log(`临时库目录：${dir}（两 Space = 两个 SQLite 文件，与 #44 §7「一 Space = 一 DB」一致）`);
log(`夹具：${TEST_OBJECT_MODEL.pluginId} → ${TEST_OBJECT_MODEL_SPLIT.pluginId}（同 ns / 同契约版本 v1）`);
log(`      ${TEST_OBJECT_MODEL.pluginId} → ${V2.pluginId}（同 ns / 契约版本 v1→v2，配离线迁移）`);

// ───────────────────── P-NS-1：换实现（拆包）后旧对象/事件/报告按原版本可读 ─────────────────────
let wA = openWorld({ file: fileA, space: 'SP-A', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, TEST_FACET_CALIB] });
const oidA = wA.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 'first' } }));
wA.uow(ADMIN, (tx) => tx.revise(oidA, { payload: { v: 'second' }, expectedRevision: 1 }));
const repA = wA.uow(ADMIN, (tx) => tx.recordReport({
  target: { kind: 'revision-ref', oid: oidA, revision: 1 },
  validatorId: 'v.pns', ruleVersion: 'r1', schemaVersion: 's1', environment: 'pns-poc',
  executedAt: 1, guaranteeScope: 'unit', verdict: 'PASS', findings: [], declaredGaps: [],
}));

check('P-NS-1', '同 CapabilityID 更换 PluginID 后：旧 ObjectID/RevisionRef、旧事件、旧检查报告按原版本可读', () => {
  const rev1 = wA.readRevision({ kind: 'revision-ref', oid: oidA, revision: 1 });
  const evBefore = wA.kernel.eventsFor(oidA, 'object-registered', wA.ledgerHead()).length;
  const repBefore = wA.readRecord(repA.reportId);
  const routeBefore = wA.kernel.registry.capability(CAP_OBJECT_MODEL);

  wA.transferCapability(CAP_OBJECT_MODEL, TEST_OBJECT_MODEL_SPLIT, ADMIN);
  const routeAfter = wA.kernel.registry.capability(CAP_OBJECT_MODEL);
  if (routeAfter.pluginId !== 'test.object-model.split') throw new Error(`路由未换到新实现：${routeAfter.pluginId}`);
  if (routeAfter.storageNamespace !== routeBefore.storageNamespace) throw new Error('换实现把持久 ns 也换了（H0 判据破坏）');

  const rev1After = wA.readRevision({ kind: 'revision-ref', oid: oidA, revision: 1 });
  const evAfter = wA.kernel.eventsFor(oidA, 'object-registered', wA.ledgerHead()).length;
  const repAfter = wA.readRecord(repA.reportId);
  const latest = wA.readObject(oidA);

  eq(rev1After.payload, rev1.payload, '旧 RevisionRef 载荷');
  eq(rev1After.oid, rev1.oid, 'ObjectID');
  eq(evAfter, evBefore, '旧事件条数');
  eq(repAfter, repBefore, '旧检查报告行');
  eq(latest.payload, { v: 'second' }, '最新修订（导航读）');
  if (routeAfter.contractVersion !== 'v1') throw new Error(`拆包实现契约版本应保持 v1，实际 ${routeAfter.contractVersion}`);

  // 负例（H1 耦合）：携新 ns 的移交在入口即拒——否则旧对象永久读不出。
  const drift = refusal(() => wA.transferCapability(CAP_OBJECT_MODEL,
    { ...TEST_OBJECT_MODEL_SPLIT, pluginId: 'test.object-model.split.ns', storageNamespace: 'dom_moved_ns' }, ADMIN));
  if (drift !== 'TRANSFER_NS_DRIFT') throw new Error(`携 ns 移交的拒绝码应为 TRANSFER_NS_DRIFT，实际 ${drift}`);
  return `pluginId ${routeBefore.pluginId} → ${routeAfter.pluginId}；ns=${routeAfter.storageNamespace} 恒等；`
    + `旧修订/事件(${evAfter})/报告 ${repA.reportId} 字节等；负例：携 ns 移交 ⇒ ${drift}`;
});

// ───────────────────── P-NS-2：只升级一个 Space，另一空间仍可运行 ─────────────────────
check('P-NS-2', '只升级一个 Space（v1→v2 离线迁移 + 重启），另一 Space 仍按 v1 正常运行', () => {
  // Space B：独立库、v1 数据（不与 A 共享任何路由行）
  const wB = openWorld({ file: fileB, space: 'SP-B', grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
  const oidB = wB.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 'B-first' } }));
  wB.uow(ADMIN, (tx) => tx.revise(oidB, { payload: { v: 'B-second' }, expectedRevision: 1 }));
  wB.close();

  // Space A：路由升 v2（换实现）→ 关库 → 此时旧行仍 v1：用 v2 实现重开必须 fail-loud（缺旧解释器）
  wA.close();
  const wAroute = openWorld({ file: fileA, space: 'SP-A', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, TEST_FACET_CALIB] });
  wAroute.transferCapability(CAP_OBJECT_MODEL, V2, ADMIN);
  wAroute.close();
  const wPre = openWorld({ file: fileA, space: 'SP-A', grants: GRANTS, plugins: [V2, TEST_FACET_CALIB] });
  const preCode = refusal(() => wPre.readRevision({ kind: 'revision-ref', oid: oidA, revision: 1 }));
  wPre.close();
  if (preCode !== 'SCHEMA_INCOMPATIBLE') throw new Error(`未迁移就切 v2 实现应 fail-loud，实际 ${preCode}`);

  // 离线迁移（重启式）→ 以 v2 实现重开
  const stamped = migrateOffline(fileA, NS, 'v1', 'v2');
  wA = openWorld({ file: fileA, space: 'SP-A', grants: GRANTS, plugins: [V2, TEST_FACET_CALIB] });
  const aSnap = rawSnap(fileA, NS);
  const aRev1 = wA.readRevision({ kind: 'revision-ref', oid: oidA, revision: 1 });
  const aLatest = wA.readObject(oidA);
  eq(aRev1.payload, { v: 'first' }, 'SP-A 迁移后旧修订');
  eq(aLatest.payload, { v: 'second' }, 'SP-A 迁移后最新修订');
  eq([...new Set(aSnap.state.map((r) => r.contract_version))], ['v2'], 'SP-A 全部行契约版本');

  // Space B 未升级：路由 v1、行 v1，照常读写（含新提交）
  const bSnap = rawSnap(fileB, NS);
  const wB2 = openWorld({ file: fileB, space: 'SP-B', grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
  const bRoute = wB2.kernel.registry.capability(CAP_OBJECT_MODEL);
  const oidB2 = wB2.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 'B-third' } }));
  const bRead = wB2.readObject(oidB2);
  wB2.close();
  if (bRoute.contractVersion !== 'v1') throw new Error(`SP-B 路由被 SP-A 的升级波及：v${bRoute.contractVersion}`);
  eq([...new Set(bSnap.state.map((r) => r.contract_version))], ['v1'], 'SP-B 行契约版本');
  eq(bRead.payload, { v: 'B-third' }, 'SP-B 升级后新提交');

  wA.close();   // 后续检查在关库窗口内做副本/迁移（WAL 副本须 checkpoint）
  return `SP-A：未迁移 fail-loud=${preCode} → 盖戳 ${stamped} 行 → v2；SP-B 仍 v1（路由 ${bRoute.contractVersion}、行 v1）且新提交可读；`
    + `负例：两库独立，A 的升级未波及 B`;
});

// ───────────────────── P-NS-3：持久 ns/owner 不变 + 缺旧解释器 fail-loud ─────────────────────
check('P-NS-3', '升级不改变持久 ns/owner；缺旧解释器时 fail-loud（拒读，不重解释）', () => {
  const after = rawSnap(fileA, NS);
  if (after.dirRows.length !== 1) throw new Error(`身份行数异常：${after.dirRows.length}`);
  for (const r of after.dirRows) {
    if (r.ns !== NS) throw new Error(`身份行 ns 漂移：${r.oid} ns=${r.ns}`);
    if (r.owner_capability !== CAP_OBJECT_MODEL) throw new Error(`身份行 owner 漂移：${r.oid} owner=${r.owner_capability}`);
  }
  const routeRow = after.routes.find((r) => r.capability === CAP_OBJECT_MODEL);
  if (!routeRow) throw new Error('路由行缺失');
  if (routeRow.ns !== NS) throw new Error(`路由 ns 漂移：${routeRow.ns}`);
  if (routeRow.contract_version !== 'v2') throw new Error(`路由契约版本应为 v2，实际 ${routeRow.contract_version}`);

  // 「迁移漏盖」负例：在丢弃副本上刻意漏盖 revision 1（模拟缺旧解释器的行），v2 读者必须拒读
  const ghostDb = join(dir, 'space-a-ghost.db');
  cleanCopy(fileA, ghostDb);
  // 先把副本整体回退为 v1（构造迁移前形态），再只盖到 v2 但跳过 revision 1
  const rollback = join(dir, 'space-a-rollback.db');
  cleanCopy(fileA, rollback);
  const rdb = new DatabaseSync(rollback);
  try {
    const trig = rdb.prepare("select sql from sqlite_master where type='trigger' and name=?").get(TRIGGER).sql;
    rdb.exec('BEGIN IMMEDIATE');
    rdb.exec(`DROP TRIGGER ${TRIGGER}`);
    rdb.prepare('update domain_state set contract_version=? where ns=?').run('v1', NS);
    rdb.exec(trig);
    rdb.exec('COMMIT');
  } finally { rdb.close(); }
  const skipped = migrateOffline(rollback, NS, 'v1', 'v2', { skip: { oid: oidA, revision: 1 } });
  if (skipped < 1) throw new Error(`漏盖夹具构造失败：盖戳 ${skipped} 行`);
  const wG = openWorld({ file: rollback, space: 'SP-A', grants: GRANTS, plugins: [V2] });
  const loud = refusal(() => wG.readRevision({ kind: 'revision-ref', oid: oidA, revision: 1 }));
  const stillReadable = wG.readObject(oidA); // 最新行（revision 2）已盖 v2 ⇒ 可读：判据逐行，不整页毒化
  wG.close();
  if (loud !== 'SCHEMA_INCOMPATIBLE') throw new Error(`漏盖行读面应 fail-loud(SCHEMA_INCOMPATIBLE)，实际 ${loud}`);
  if (!stillReadable) throw new Error('逐行判据误伤：同对象最新 v2 行应仍可读');

  return `身份行 ns/owner 恒等（${after.dirRows.length} 行）、路由 ns=${routeRow.ns} 恒等；`
    + `漏盖行读面 ⇒ ${loud}（不重解释）；同对象已盖行仍可读（逐行）；触发器在位=${JSON.stringify(after.triggers)}`;
});

// ───────────────────── P-NS-4：离线升级崩溃全回滚 + 重启可恢复（含两个负例） ─────────────────────
check('P-NS-4', '离线 Schema 升级的注入崩溃全回滚、重启后可恢复；在线 DML 与非事务迁移均为负例', () => {
  // 在线 DML 负例：Kernel 打开期间裸面改版本戳 ⇒ 触发器拒绝（迁移为什么必须离线）
  const wOn = openWorld({ file: fileA, space: 'SP-A', grants: GRANTS, plugins: [V2, TEST_FACET_CALIB] });
  const online = refusal(() => wOn.raw.run('update domain_state set contract_version=? where ns=?', 'v1', NS));
  wOn.close();
  if (online !== 'DOMAIN_STATE_APPEND_ONLY') throw new Error(`在线改版本戳应被拒（DOMAIN_STATE_APPEND_ONLY），实际 ${online}`);

  // 崩溃主证：构造迁移前形态（行 v1、路由 v2）的副本 → 事务内崩溃 → 全回滚（含触发器恢复）→ 重跑成功
  const crashDb = join(dir, 'space-a-crash.db');
  cleanCopy(fileA, crashDb);
  const cdb = new DatabaseSync(crashDb);
  try {
    const trig = cdb.prepare("select sql from sqlite_master where type='trigger' and name=?").get(TRIGGER).sql;
    cdb.exec('BEGIN IMMEDIATE');
    cdb.exec(`DROP TRIGGER ${TRIGGER}`);
    cdb.prepare('update domain_state set contract_version=? where ns=?').run('v1', NS);
    cdb.exec(trig);
    cdb.exec('COMMIT');
  } finally { cdb.close(); }
  const child = spawnSync(process.execPath,
    ['--experimental-transform-types', '--no-warnings', SELF, '--crash-child', crashDb, NS, 'v1', 'v2'],
    { encoding: 'utf8' });
  const afterCrash = rawSnap(crashDb, NS);
  eq([...new Set(afterCrash.state.map((r) => r.contract_version))], ['v1'], '事务内崩溃后的行版本（应全量回滚）');
  eq(afterCrash.triggers, ['domain_state_no_delete', 'domain_state_no_update'], '崩溃后触发器（应随事务回滚而保留）');
  if (!/已改 \d+\/\d+ 行/.test(String(child.stdout ?? ''))) throw new Error(`崩溃子进程未报告真实写入（无效证据）：${String(child.stdout ?? '').slice(0, 200)}`);
  const again = migrateOffline(crashDb, NS, 'v1', 'v2');
  const afterRetry = rawSnap(crashDb, NS);
  eq([...new Set(afterRetry.state.map((r) => r.contract_version))], ['v2'], '重跑迁移后的行版本');
  const wC = openWorld({ file: crashDb, space: 'SP-A', grants: GRANTS, plugins: [V2] });
  const rRead = wC.readRevision({ kind: 'revision-ref', oid: oidA, revision: 1 });
  wC.close();
  eq(rRead.payload, { v: 'first' }, '重启后可恢复读取');

  // 非事务负例：同点崩溃留下混合态 + 触发器缺失（证明「事务 + 换库」不是装饰）
  const badDb = join(dir, 'space-a-badtx.db');
  cleanCopy(fileA, badDb);
  const bdb = new DatabaseSync(badDb);
  try {
    const trig = bdb.prepare("select sql from sqlite_master where type='trigger' and name=?").get(TRIGGER).sql;
    bdb.exec('BEGIN IMMEDIATE');
    bdb.exec(`DROP TRIGGER ${TRIGGER}`);
    bdb.prepare('update domain_state set contract_version=? where ns=?').run('v1', NS);
    bdb.exec(trig);
    bdb.exec('COMMIT');
  } finally { bdb.close(); }
  const childBad = spawnSync(process.execPath,
    ['--experimental-transform-types', '--no-warnings', SELF, '--crash-child', badDb, NS, 'v1', 'v2', '--no-tx'],
    { encoding: 'utf8' });
  const mixed = rawSnap(badDb, NS);
  const mixedVersions = [...new Set(mixed.state.map((r) => r.contract_version))].sort();
  if (mixedVersions.length < 2) throw new Error(`非事务负例应留下混合态，实际 ${JSON.stringify(mixedVersions)}`);
  if (mixed.triggers.includes('domain_state_no_update')) throw new Error(`非事务负例应留下 update 触发器缺失，实际 ${JSON.stringify(mixed.triggers)}`);
  // 混合态库的打开面：触发器集不全 ⇒ 打开即拒（不隐式迁移，也不当作正常旧库放行）
  const loud = refusal(() => openWorld({ file: badDb, space: 'SP-A', grants: GRANTS, plugins: [V2] }));
  if (loud !== 'SCHEMA_UPGRADE_REQUIRED') throw new Error(`混合态/触发器缺失库的打开面应 fail-loud(SCHEMA_UPGRADE_REQUIRED)，实际 ${loud}`);

  return `在线 DML ⇒ ${online}；事务内崩溃 exit=${child.status} → 行版本 v1 全回滚、触发器随回滚保留、重跑盖戳 ${again} 行后恢复读取；`
    + `负例（非事务）：exit=${childBad.status} → 混合态 ${JSON.stringify(mixedVersions)} + update 触发器缺失留存 ⇒ 打开面 ${loud}`;
});

// ───────────────────── P-NS-5：Facet/跨能力精确引用在拆包后不漂移 ─────────────────────
check('P-NS-5', 'Facet 合成挂载的精确引用在拆包（pluginId 变、能力/ns 不变）后不漂移', () => {
  // 合成挂载：facet 能力在**自己的 ns** 里挂一条指向核心对象 RevisionRef 的扩展记录（Q45 形态）
  const wA3 = openWorld({ file: fileA, space: 'SP-A', grants: GRANTS, plugins: [V2, TEST_FACET_CALIB] });
  const store = new FacetStore(wA3.kernel.faceFor(CAP_FACET));
  const target = { kind: 'revision-ref', oid: oidA, revision: 1 };
  wA3.uow(ADMIN, (tx) => store.write(tx, oidA, { target, note: '合成挂载：拆包稳定性夹具' }));
  const mountBefore = store.read(oidA);
  // 路径键引用（负例基线）：把「包名 + oid」当引用键——拆包后必然漂移
  const pathKeyBefore = `${wA3.kernel.registry.capability(CAP_FACET).pluginId}#${oidA}`;

  wA3.transferCapability(CAP_FACET, FACET_SPLIT, ADMIN);
  const mountAfter = store.read(oidA);
  const targetRead = wA3.readRevision(target);
  const facetRoute = wA3.kernel.registry.capability(CAP_FACET);
  const pathKeyAfter = `${facetRoute.pluginId}#${oidA}`;
  const coreOwner = wA3.kernel.ownerCapabilityOf(oidA);
  wA3.close();

  eq(mountAfter.payload, mountBefore.payload, '拆包后合成挂载载荷');
  eq(targetRead.payload, { v: 'first' }, '拆包后精确引用解析');
  if (facetRoute.storageNamespace !== NS_FACET) throw new Error('拆包把 facet 的持久 ns 换了');
  if (coreOwner !== CAP_OBJECT_MODEL) throw new Error(`核心对象 owner 漂移：${coreOwner}`);
  if (pathKeyBefore === pathKeyAfter) throw new Error('负例未成立：路径键在拆包后竟未变');
  // 负例说明：路径键（包名#oid）在拆包后改变 ⇒ 以它为键的引用会漂移；oid+revision 键不漂移
  return `挂载载荷逐字等；目标解析 v=${targetRead.payload.v}；facet ns=${facetRoute.storageNamespace} 恒等；`
    + `负例：路径键 ${pathKeyBefore} → ${pathKeyAfter} 已漂移（oid 键未漂移）`;
});

// ───────────────────── 判定与输入锚 ─────────────────────
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const inputs = [
  'src/kernel/kernel.ts', 'src/storage-sqlite/sqlite-port.ts', 'src/harness/world.ts',
  'src/domains/test-object-model.ts', 'src/domains/test-facet.ts',
].map((rel) => `${rel} sha256=${sha256(join(POC, rel)).slice(0, 16)}`);
const head = spawnSync('git', ['-C', POC, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout?.trim() ?? '(unknown)';

log('\n════════ 汇总 ════════');
for (const r of results) log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}${r.ok ? '' : `  ${r.detail}`}`);
log(`输入：HEAD=${head}`);
for (const i of inputs) log(`输入：${i}`);

const allPass = results.length === 5 && results.every((r) => r.ok);
const necessity = failures.some((f) => /H0|漂移|永不|破坏/.test(f));
if (allPass) {
  log('\n判定：PASS_STABLE_NS —— 五项全过，Kernel 未引入领域特殊分支（业务无知的常驻机验见 tests/arch-independence.test.ts）。');
  log('分支后果：PR-8/W8 DEFERRED（不再是首版依赖）；ns-relocated 保持 planned、不要求批准；');
  log('          PR-5/PR-7 承接稳定 ns、启动版本/历史验证与可回滚重启式迁移；PR-10 不再验物理重定位。');
} else if (necessity) {
  log(`\n判定：RELOCATION_REQUIRED —— 未被离线迁移/ns 解耦/普通适配消除的反例：${failures.join(' | ')}`);
} else {
  log(`\n判定：INCONCLUSIVE —— 脚手架/未定（不得包装为技术否证）：${failures.join(' | ')}`);
}

rmSync(dir, { recursive: true, force: true });
process.exit(allPass ? 0 : (necessity ? 10 : 2));
