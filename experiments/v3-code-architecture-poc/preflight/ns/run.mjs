#!/usr/bin/env node
/**
 * preflight/ns/run.mjs — P-NS 最小真实测试：稳定物理命名空间 vs 通用重定位
 *
 * 授权与判据：`g1/G2-DEV-PLAN.md §0bis / P-NS`（2026-11-03 外部审查收口，现行）。
 * 版本治理上位约束：`g1/G1-UNIFIED-CONTRACTS.md §3.3/§3.4`（四层版本轴）与 §5.1（历史记录按自钉版本解释）：
 *   - `storage_schema_version`（物理层，per space×capability 登记）= 受控迁移可推进的**唯一**版本轴；
 *   - `contract_version`（契约层）= 记录所属 Capability 契约版本，**迁移器不得回填/代盖章**；
 *   - 规则层解释按记录自钉版本重放；旧解释器不可用 ⇒ 保留原记录 + 显式能力缺失
 *     （`UNINTERPRETED_FAIL_CLOSED`），**禁止**以改写历史版本实现兼容。
 * 本实验的迁移实现据此构造：物理版本单独推进 + 历史行 `contract_version` 一字不动 +
 * 版本化解释器派发。批量改写 `contract_version` 的旧做法作为**负例**保留（它会把历史语义改坏）。
 *
 * 对照假说：H0 = `CapabilityID` 稳定、持久 `storage_ns` 与 Plugin 包名分离、允许更换实现与重启式离线迁移；
 *           H1 = 当前 RL/PR-8 的物理位置迁移（`ns-relocated` 通道）。
 * 性质：类甲实验（只读引用 `src/**` 机制本体，不落生产代码；无生产 DDL/事件名；夹具表只存在于实验临时库）。
 *
 * 五项与判定（§0bis P-NS「最小真实测试」逐字对应）：
 *   ① 同 CapabilityID 更换 PluginID 后旧 ObjectID/RevisionRef、旧事件与检查报告按原版本可读；
 *   ② 只升级一个 Space，另一空间仍可运行；
 *   ③ 不改变持久 ns/owner，缺旧解释器时 fail-loud 而非重解释；
 *   ④ 离线 Schema 升级的注入崩溃全回滚，重启后可恢复；
 *   ⑤ Facet/跨能力的精确引用在拆包后不漂移（合成挂载）。
 * 每项附**真正打破该保证的负例**。
 *
 * 夹具边界（如实声明）：
 *   - 「物理层版本登记」用实验侧表 `pns_fixture_storage_schema` / `pns_fixture_migration_log` 模拟
 *     G2 的 per-(space×capability) 登记（D3-c）；PoC 现形是全局 `SCHEMA_VERSION` 常数（D-18 单插件假设）。
 *   - 「版本化读者」用实验侧派发器经只读 raw 面取原始行（机制层尚无该读者）；本实验不据此主张生产可用，
 *     生产迁移器/读者与换库、WAL 崩溃窗口的硬性验收归 PR-5（清单见 VERDICT §2）。
 *
 * 退出码（§0bis 固定产物规格）：0 = PASS_STABLE_NS；10 = RELOCATION_REQUIRED；2 = INCONCLUSIVE/无效。
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

// ───────────────────── 崩溃注入子进程（纯 raw sqlite，不加载任何 TS） ─────────────────────
// 用法：node run.mjs --crash-child <db> <space> <capability> <fromV> <toV> [--no-tx]
//   事务形（默认）：BEGIN IMMEDIATE → 写版本登记 + 迁移记录 → exit 9（不提交）⇒ 重开后零残留。
//   非事务形（--no-tx）：逐条 autocommit 写 → exit 9 ⇒ 版本登记与迁移记录半套留存（负例）。
if (process.argv.includes('--crash-child')) {
  const rest = process.argv.slice(3);
  const [dbPath, space, cap, fromV, toV] = rest;
  const noTx = rest.includes('--no-tx');
  const db = new DatabaseSync(dbPath);
  if (!noTx) db.exec('BEGIN IMMEDIATE');
  db.prepare(`insert into pns_fixture_storage_schema(space, capability, version, recorded_at)
              values(?,?,?,?) on conflict(space, capability) do update set version=excluded.version, recorded_at=excluded.recorded_at`)
    .run(space, cap, Number(toV), Date.now());
  if (!noTx) {
    db.prepare('insert into pns_fixture_migration_log(space, capability, from_v, to_v, rows_touched, note) values(?,?,?,?,?,?)')
      .run(space, cap, Number(fromV), Number(toV), 0, 'fixture: physical-only upgrade');
    log('[crash-child] 版本登记 + 迁移记录已写（事务内），未提交即崩溃 exit 9');
    process.exit(9);
  }
  log('[crash-child] 非事务：版本登记已落库、迁移记录尚未写 ⇒ 崩溃 exit 9（半套登记）');
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
const { Refusal } = await import('../../src/contracts/index.ts');
const { TEST_OBJECT_MODEL, TEST_OBJECT_MODEL_SPLIT, CAP_OBJECT_MODEL } =
  await import('../../src/domains/test-object-model.ts');
const { TEST_FACET_CALIB, CAP_FACET, FacetStore } = await import('../../src/domains/test-facet.ts');

const ADMIN = PRINCIPAL('pns-admin');
const GRANTS = { 'pns-admin': ['space-write', 'capability-admin'] };
const NS = TEST_OBJECT_MODEL.storageNamespace;          // 'dom_test_om'
const NS_FACET = TEST_FACET_CALIB.storageNamespace;     // 'dom_test_facet'

/** v2 实现：同能力、同 ns、契约版本 v2（换实现 + 版本升级的最小夹具）。 */
const V2 = {
  ...TEST_OBJECT_MODEL,
  pluginId: 'test.object-model.v2',
  codeVersion: '0.0.3',
  provides: [{ capability: CAP_OBJECT_MODEL, contractVersion: 'v2' }],
};
/** Facet 拆包后的实现：pluginId 变、能力与 ns 不变（Q45 拆包材料）。 */
const FACET_SPLIT = { ...TEST_FACET_CALIB, pluginId: 'test.instrument-facet.split', codeVersion: '0.0.2' };

/**
 * 版本化解释器（实验侧，模拟 G2 规则层）：v1 解释 `{v}`、v2 解释 `{value:{amount,currency}}`。
 * 两条规则**语义不同**（这正是「版本戳不可改写」的可判据前提；两版规则相同则测试无鉴别力）。
 */
const INTERP = {
  v1: (p) => ({ kind: 'label', value: p?.v }),
  v2: (p) => {
    const a = p?.value;
    if (!a || typeof a.amount !== 'number' || typeof a.currency !== 'string') {
      throw new Refusal('UNINTERPRETED_FAIL_CLOSED', {
        reason: 'v2 解释器无法解释该载荷（缺 value.amount/currency）', contractVersion: 'v2',
      });
    }
    return { kind: 'amount', amount: a.amount, currency: a.currency };
  },
};

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
const refusal = (fn) => {
  try { fn(); return 'NO_REFUSAL'; } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    const m = msg.match(/\b([A-Z][A-Z0-9_]{5,})\b/);
    return (e && e.code && e.code !== 'ERR_SQLITE_ERROR') ? e.code : (m ? m[1] : `OTHER:${msg.slice(0, 80)}`);
  }
};

mkdirSync(join(POC, '.poc-data'), { recursive: true });
const dir = mkdtempSync(join(POC, '.poc-data', 'pns-'));
const fileA = join(dir, 'space-a.db');
const fileB = join(dir, 'space-b.db');

/** WAL 库的安全副本：先 checkpoint 再复制（否则 -wal 里的已提交页会丢）。 */
function cleanCopy(src, dst) {
  const db = new DatabaseSync(src);
  try { db.exec('pragma wal_checkpoint(TRUNCATE)'); } finally { db.close(); }
  copyFileSync(src, dst);
}

/** 夹具表（模拟 G2 per-space×capability 物理版本登记与迁移记录；只存在于实验临时库）。 */
function ensureFixtureTables(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      create table if not exists pns_fixture_storage_schema(
        space text not null, capability text not null, version integer not null, recorded_at integer not null,
        primary key(space, capability));
      create table if not exists pns_fixture_migration_log(
        id integer primary key autoincrement, space text not null, capability text not null,
        from_v integer not null, to_v integer not null, rows_touched integer not null, note text not null);
    `);
  } finally { db.close(); }
}

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

/**
 * 离线物理升级（重启式）：Kernel 未打开该库的窗口内，单事务推进**物理层版本登记**并写迁移记录；
 * `domain_state`（含 `contract_version`）一字不动 —— §3.4「迁移器不回填版本戳/不代盖章」。
 * 提交边界 = 事务提交 + 换库（rename）；崩溃只会留下旧库或完整新库。
 */
function upgradeStorageSchema(dbPath, space, cap, fromV, toV) {
  const work = `${dbPath}.migrating-${process.pid}`;
  cleanCopy(dbPath, work);
  const db = new DatabaseSync(work);
  try {
    const before = db.prepare('select count(*) c from domain_state').get().c;
    db.exec('BEGIN IMMEDIATE');
    db.prepare(`insert into pns_fixture_storage_schema(space, capability, version, recorded_at)
                values(?,?,?,?) on conflict(space, capability) do update set version=excluded.version, recorded_at=excluded.recorded_at`)
      .run(space, cap, toV, Date.now());
    db.prepare('insert into pns_fixture_migration_log(space, capability, from_v, to_v, rows_touched, note) values(?,?,?,?,?,?)')
      .run(space, cap, fromV, toV, 0, 'physical-only upgrade; contract_version untouched');
    db.exec('COMMIT');
    const after = db.prepare('select count(*) c from domain_state').get().c;
    const integrity = db.prepare('pragma integrity_check').get();
    if (String(Object.values(integrity)[0]) !== 'ok') throw new Error(`升级后完整性检查未过：${JSON.stringify(integrity)}`);
    if (before !== after) throw new Error(`物理升级不应增减域行：${before} → ${after}`);
    db.close();
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    renameSync(work, dbPath);
    return { rowsTouched: 0, rowsTotal: after };
  } catch (e) {
    try { db.close(); } catch {}
    try { rmSync(work, { force: true }); } catch {}
    throw e;
  }
}

/** 版本化读者（实验侧夹具）：按**记录自钉的** contract_version 选解释器；无解释器 ⇒ 显式拒读。 */
function readWithInterpreter(world, oid, revision) {
  const row = world.raw.get('select payload_json, contract_version from domain_state where ns=? and oid=? and revision=?', NS, oid, revision);
  if (!row) throw new Error(`行不存在：${oid}#${revision}`);
  const fn = INTERP[row.contract_version];
  if (!fn) {
    throw new Refusal('UNINTERPRETED_FAIL_CLOSED', { reason: `无 ${row.contract_version} 解释器`, contractVersion: row.contract_version });
  }
  return { version: row.contract_version, value: fn(JSON.parse(row.payload_json)) };
}

/** 读取物理版本登记（世界关闭时）。 */
function storageSchemaOf(dbPath, space, cap) {
  const db = new DatabaseSync(dbPath);
  try {
    const r = db.prepare('select version from pns_fixture_storage_schema where space=? and capability=?').get(space, cap);
    const logs = db.prepare('select from_v, to_v, rows_touched from pns_fixture_migration_log where space=? and capability=? order by id').all(space, cap);
    return { version: r?.version ?? null, logs };
  } finally { db.close(); }
}

/**
 * 迁移来源判据（夹具，模拟 §3.4「不补造当时合法迁移证据」）：物理版本被推到 >1 却没有任何迁移记录
 * ⇒ 该次升级无来源可证，按 fail-loud 处理（不允许「看起来升过」就当升过）。
 */
function assertMigrationProvenance(world, space, cap) {
  const reg = world.raw.get('select version from pns_fixture_storage_schema where space=? and capability=?', space, cap);
  const logs = world.raw.all('select id from pns_fixture_migration_log where space=? and capability=?', space, cap);
  if (reg && Number(reg.version) > 1 && logs.length === 0) {
    throw new Refusal('MIGRATION_PROVENANCE_MISSING', {
      reason: '物理版本已推进但无迁移记录', space, capability: cap, version: reg.version,
    });
  }
}

log('════════ P-NS：稳定物理命名空间 vs 通用重定位（最小真实测试） ════════');
log(`临时库目录：${dir}（两 Space = 两个 SQLite 文件，与 #44 §7「一 Space = 一 DB」一致）`);
log(`夹具：${TEST_OBJECT_MODEL.pluginId} → ${TEST_OBJECT_MODEL_SPLIT.pluginId}（同 ns / 同契约版本 v1）`);
log(`      ${TEST_OBJECT_MODEL.pluginId} → ${V2.pluginId}（同 ns / 契约版本 v1→v2，配物理层升级 + 版本化读者）`);
log('版本治理：物理层 storage_schema_version 可迁移；contract_version 与历史行一字不动（UNIFIED §3.3/§3.4）');

// ───────────────────── P-NS-1：换实现（拆包）后旧对象/事件/报告按原版本可读 ─────────────────────
let wA = openWorld({ file: fileA, space: 'SP-A', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, TEST_FACET_CALIB] });
const oidA = wA.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 'first' } }));
wA.uow(ADMIN, (tx) => tx.revise(oidA, { payload: { v: 'second' }, expectedRevision: 1 }));
const repA = wA.uow(ADMIN, (tx) => tx.recordReport({
  target: { kind: 'revision-ref', oid: oidA, revision: 1 },
  validatorId: 'v.pns', ruleVersion: 'r1', schemaVersion: 's1', environment: 'pns-poc',
  executedAt: 1, guaranteeScope: 'unit', verdict: 'PASS', findings: [], declaredGaps: [],
}));
const interpBefore = readWithInterpreter(wA, oidA, 1).value;

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
  eq(readWithInterpreter(wA, oidA, 1).value, interpBefore, '拆包后 v1 解释结果');

  // 负例（H1 耦合）：携新 ns 的移交在入口即拒——否则旧对象永久读不出。
  const drift = refusal(() => wA.transferCapability(CAP_OBJECT_MODEL,
    { ...TEST_OBJECT_MODEL_SPLIT, pluginId: 'test.object-model.split.ns', storageNamespace: 'dom_moved_ns' }, ADMIN));
  if (drift !== 'TRANSFER_NS_DRIFT') throw new Error(`携 ns 移交的拒绝码应为 TRANSFER_NS_DRIFT，实际 ${drift}`);
  return `pluginId ${routeBefore.pluginId} → ${routeAfter.pluginId}；ns=${routeAfter.storageNamespace} 恒等；`
    + `旧修订/事件(${evAfter})/报告 ${repA.reportId} 字节等；v1 解释结果不变；负例：携 ns 移交 ⇒ ${drift}`;
});

// ───────────────────── P-NS-2：只升级一个 Space（物理层），另一空间仍可运行 ─────────────────────
check('P-NS-2', '只升级一个 Space 的物理 Schema 版本（历史行 contract_version 不动），另一 Space 仍可运行', () => {
  // Space B：独立库、v1 数据
  const wB = openWorld({ file: fileB, space: 'SP-B', grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
  const oidB = wB.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 'B-first' } }));
  wB.uow(ADMIN, (tx) => tx.revise(oidB, { payload: { v: 'B-second' }, expectedRevision: 1 }));
  wB.close();
  ensureFixtureTables(fileB);

  // Space A：关库 → 夹具表 → 物理层升级（v1→v2 登记 + 迁移记录，域行零改动）→ 重开
  wA.close();
  ensureFixtureTables(fileA);
  const before = rawSnap(fileA, NS);
  const up = upgradeStorageSchema(fileA, 'SP-A', CAP_OBJECT_MODEL, 1, 2);
  const after = rawSnap(fileA, NS);
  eq(after.state, before.state, '物理升级后域行（含 contract_version）');
  const schemaA = storageSchemaOf(fileA, 'SP-A', CAP_OBJECT_MODEL);
  eq(schemaA.version, 2, 'SP-A 物理版本登记');
  eq(schemaA.logs.length, 1, 'SP-A 迁移记录条数');

  // 重开（路由仍 v1，旧实现仍在位）：历史行照旧可读、解释结果与升级前逐字相同
  wA = openWorld({ file: fileA, space: 'SP-A', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, TEST_FACET_CALIB] });
  const aRev1 = wA.readRevision({ kind: 'revision-ref', oid: oidA, revision: 1 });
  eq(aRev1.payload, { v: 'first' }, '物理升级后旧修订');
  eq(readWithInterpreter(wA, oidA, 1).value, interpBefore, '物理升级后 v1 解释结果');
  eq([...new Set(after.state.map((r) => r.contract_version))], ['v1'], '历史行契约版本');

  // Space B 未升级：物理版本登记缺省、路由 v1、行 v1，照常读写（含新提交）
  const bSchema = storageSchemaOf(fileB, 'SP-B', CAP_OBJECT_MODEL);
  const wB2 = openWorld({ file: fileB, space: 'SP-B', grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
  const bRoute = wB2.kernel.registry.capability(CAP_OBJECT_MODEL);
  const oidB2 = wB2.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 'B-third' } }));
  const bRead = wB2.readObject(oidB2);
  wB2.close();
  if (bSchema.version !== null) throw new Error(`SP-B 被 A 的物理升级波及：version=${bSchema.version}`);
  if (bRoute.contractVersion !== 'v1') throw new Error(`SP-B 路由被波及：v${bRoute.contractVersion}`);
  eq(bRead.payload, { v: 'B-third' }, 'SP-B 升级后新提交');

  // 负例（真正打破 ② 的老做法）：按库批量改写**历史行**的 contract_version（旧迁移法）
  // ⇒ 该空间历史记录只剩 v2 解释器可用，v1 载荷被 v2 解释器拒读 ⇒ 历史语义不可解释。
  const broken = join(dir, 'space-b-restamped.db');
  cleanCopy(fileB, broken);
  const bdb = new DatabaseSync(broken);
  try {
    const trig = bdb.prepare("select sql from sqlite_master where type='trigger' and name='domain_state_no_update'").get().sql;
    bdb.exec('BEGIN IMMEDIATE');
    bdb.exec('DROP TRIGGER domain_state_no_update');
    const n = bdb.prepare('update domain_state set contract_version=? where ns=? and contract_version=?').run('v2', NS, 'v1').changes;
    bdb.exec(trig);
    bdb.exec('COMMIT');
    if (Number(n) < 1) throw new Error('负例夹具未生效：未改写任何行');
  } finally { bdb.close(); }
  const wBroken = openWorld({ file: broken, space: 'SP-B', grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
  const brokenLoud = refusal(() => readWithInterpreter(wBroken, oidB, 1));
  wBroken.close();
  if (brokenLoud !== 'UNINTERPRETED_FAIL_CLOSED') throw new Error(`被批量改版本的历史行应不可解释（UNINTERPRETED_FAIL_CLOSED），实际 ${brokenLoud}`);

  return `SP-A：物理版本登记 v1→v2、迁移记录 1 条、域行 ${up.rowsTotal} 行零改动（contract_version 仍 v1、v1 解释结果不变）；`
    + `SP-B 未升级（版本登记缺省、行 v1）且新提交可读；负例：按库批量改历史行版本 ⇒ 该空间历史记录 ${brokenLoud}`;
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
  if (routeRow.contract_version !== 'v1') throw new Error(`物理升级不应改路由契约版本：${routeRow.contract_version}`);

  // 机制层「缺版本派发」的 fail-loud：路由升到 v2 后直接读 v1 行 ⇒ SCHEMA_INCOMPATIBLE（不静默重解释）
  wA.transferCapability(CAP_OBJECT_MODEL, V2, ADMIN);
  const kernelLoud = refusal(() => wA.readRevision({ kind: 'revision-ref', oid: oidA, revision: 1 }));
  if (kernelLoud !== 'SCHEMA_INCOMPATIBLE') throw new Error(`v2 路由直读 v1 行应 fail-loud(SCHEMA_INCOMPATIBLE)，实际 ${kernelLoud}`);

  // 版本化读者：按记录自钉版本取 v1 解释器 ⇒ 结果与升级前逐字同（未重解释）
  const viaV1 = readWithInterpreter(wA, oidA, 1);
  eq(viaV1.version, 'v1', '历史行自钉版本');
  eq(viaV1.value, interpBefore, '历史行解释结果');

  // 负例：解释器缺失（只有 v2 解释器可用）⇒ 显式拒读，而不是退回 v2 规则硬解
  const saved = INTERP.v1;
  delete INTERP.v1;
  const noInterp = refusal(() => readWithInterpreter(wA, oidA, 1));
  INTERP.v1 = saved;
  if (noInterp !== 'UNINTERPRETED_FAIL_CLOSED') throw new Error(`缺 v1 解释器应拒读（UNINTERPRETED_FAIL_CLOSED），实际 ${noInterp}`);

  // 负例 2：宽容解释器（把 v1 载荷按 v2 规则硬解）⇒ 得到静默错误结果，正是契约禁止的「重解释」
  const lenient = (p) => ({ kind: 'amount', amount: Number(p?.value?.amount ?? p?.v), currency: 'JPY' });
  const wrong = lenient({ v: 'first' });
  if (Number.isFinite(wrong.amount)) throw new Error('宽容解释器负例未成立：应得到无法换算的金额');

  return `身份行 ns/owner 恒等（${after.dirRows.length} 行）、路由 ns=${routeRow.ns}、路由契约版本仍 v1；`
    + `机制层缺派发 ⇒ ${kernelLoud}（拒读不重解释）；版本化读者 v1 ⇒ 与升级前逐字同；`
    + '负例：缺 v1 解释器 ⇒ ' + noInterp + '；宽容解释器 ⇒ 静默错值（契约禁止）';
});

// ───────────────────── P-NS-4：物理升级崩溃全回滚 + 重启可恢复（含非事务负例） ─────────────────────
check('P-NS-4', '物理层升级的注入崩溃全回滚、重启后可恢复；非事务崩溃留半套登记（负例）', () => {
  // 在线 DML 负例：Kernel 打开期间裸面改历史行版本戳 ⇒ 触发器拒绝（迁移为什么必须离线）
  const online = refusal(() => wA.raw.run('update domain_state set contract_version=? where ns=?', 'v1', NS));
  if (online !== 'DOMAIN_STATE_APPEND_ONLY') throw new Error(`在线改版本戳应被拒（DOMAIN_STATE_APPEND_ONLY），实际 ${online}`);

  // 崩溃主证：把 A 回退成「升级前」形态（物理登记 v1、无迁移记录），再在事务内崩溃
  const crashDb = join(dir, 'space-a-crash.db');
  cleanCopy(fileA, crashDb);
  const reset = new DatabaseSync(crashDb);
  reset.exec('delete from pns_fixture_migration_log');
  reset.prepare('update pns_fixture_storage_schema set version=1').run();
  reset.close();
  const child = spawnSync(process.execPath,
    ['--experimental-transform-types', '--no-warnings', SELF, '--crash-child', crashDb, 'SP-A', CAP_OBJECT_MODEL, '1', '2'],
    { encoding: 'utf8' });
  if (child.status !== 9) throw new Error(`事务内崩溃子进程应以 exit 9 结束，实际 ${child.status}`);
  const s1 = storageSchemaOf(crashDb, 'SP-A', CAP_OBJECT_MODEL);
  eq(s1.version, 1, '崩溃后物理版本登记（应回滚）');
  eq(s1.logs.length, 0, '崩溃后迁移记录条数（应回滚）');
  eq(rawSnap(crashDb, NS).state, rawSnap(fileA, NS).state, '崩溃后域行（应逐字未变）');

  // 重跑成功 + 重启后可读
  const again = upgradeStorageSchema(crashDb, 'SP-A', CAP_OBJECT_MODEL, 1, 2);
  const s2 = storageSchemaOf(crashDb, 'SP-A', CAP_OBJECT_MODEL);
  eq(s2.version, 2, '重跑后物理版本登记');
  eq(s2.logs.length, 1, '重跑后迁移记录条数');
  // 重启后：路由已在 P-NS-3 升到 v2，故机制层直读 v1 行应继续 fail-loud（缺版本派发），
  // 而版本化读者按行自钉版本恢复历史解释——这正是 PR-5/PR-7 要实现的读者形态。
  const wC = openWorld({ file: crashDb, space: 'SP-A', grants: GRANTS, plugins: [V2] });
  const kernelAfter = refusal(() => wC.readRevision({ kind: 'revision-ref', oid: oidA, revision: 1 }));
  const interpAfter = readWithInterpreter(wC, oidA, 1);
  wC.close();
  if (kernelAfter !== 'SCHEMA_INCOMPATIBLE') throw new Error(`重启后机制层直读跨版本行应 fail-loud，实际 ${kernelAfter}`);
  eq(interpAfter.value, interpBefore, '重启后解释结果');

  // 非事务负例：版本登记写成功、迁移记录未写就崩溃 ⇒ 半套登记留存（无单一提交边界的形态）
  const badDb = join(dir, 'space-a-badtx.db');
  cleanCopy(fileA, badDb);
  const rdb = new DatabaseSync(badDb);
  rdb.exec('delete from pns_fixture_migration_log');
  rdb.prepare('update pns_fixture_storage_schema set version=1').run();
  rdb.close();
  const childBad = spawnSync(process.execPath,
    ['--experimental-transform-types', '--no-warnings', SELF, '--crash-child', badDb, 'SP-A', CAP_OBJECT_MODEL, '1', '2', '--no-tx'],
    { encoding: 'utf8' });
  if (childBad.status !== 9) throw new Error(`非事务崩溃子进程应以 exit 9 结束，实际 ${childBad.status}`);
  const s3 = storageSchemaOf(badDb, 'SP-A', CAP_OBJECT_MODEL);
  if (s3.version !== 2) throw new Error(`非事务负例：版本登记应已落库，实际 ${s3.version}`);
  if (s3.logs.length !== 0) throw new Error(`非事务负例：迁移记录应缺失（半套），实际 ${s3.logs.length} 条`);
  const wBad = openWorld({ file: badDb, space: 'SP-A', grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
  const badLoud = refusal(() => assertMigrationProvenance(wBad, 'SP-A', CAP_OBJECT_MODEL));
  wBad.close();
  if (badLoud !== 'MIGRATION_PROVENANCE_MISSING') throw new Error(`无来源的半套升级应 fail-loud（MIGRATION_PROVENANCE_MISSING），实际 ${badLoud}`);

  return `在线 DML ⇒ ${online}；事务内崩溃 exit=${child.status} → 版本登记/迁移记录双回滚（v1、0 条）、域行逐字未变；`
    + `重跑盖戳 v2 后版本化读者恢复历史解释（机制层直读仍 ${kernelAfter}）；负例（非事务）：exit=${childBad.status} → 半套登记 v2/0 条留存 ⇒ 来源判据 ${badLoud}`;
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
  const facetRoute = wA3.kernel.registry.capability(CAP_FACET);
  const pathKeyAfter = `${facetRoute.pluginId}#${oidA}`;
  const coreOwner = wA3.kernel.ownerCapabilityOf(oidA);
  wA3.close();

  eq(mountAfter.payload, mountBefore.payload, '拆包后合成挂载载荷');
  if (facetRoute.storageNamespace !== NS_FACET) throw new Error('拆包把 facet 的持久 ns 换了');
  if (coreOwner !== CAP_OBJECT_MODEL) throw new Error(`核心对象 owner 漂移：${coreOwner}`);
  if (pathKeyBefore === pathKeyAfter) throw new Error('负例未成立：路径键在拆包后竟未变');
  return `挂载载荷逐字等；facet ns=${facetRoute.storageNamespace} 恒等；核心对象 owner 恒等；`
    + `负例：路径键 ${pathKeyBefore} → ${pathKeyAfter} 已漂移（oid 键未漂移）`;
});

// ───────────────────── 判定与输入锚 ─────────────────────
const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const inputs = [
  'src/kernel/kernel.ts', 'src/storage-sqlite/sqlite-port.ts', 'src/harness/world.ts',
  'src/domains/test-object-model.ts', 'src/domains/test-facet.ts',
].map((rel) => `${rel} sha256=${sha256(join(POC, rel)).slice(0, 16)}`);
const head = spawnSync('git', ['-C', POC, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout?.trim() ?? '(unknown)';
// HEAD 只报「运行时刻的工作树指向」，不承担证据锚职责（提交本文件会改变 HEAD）；判据输入以 src sha256 为准。
const dirty = (spawnSync('git', ['-C', POC, 'status', '--porcelain', '--', 'src'], { encoding: 'utf8' }).stdout ?? '').trim();

log('\n════════ 汇总 ════════');
for (const r of results) log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}${r.ok ? '' : `  ${r.detail}`}`);
log(`输入：HEAD=${head}（工作树 src 面 ${dirty ? `有未提交改动 ${dirty.split('\n').length} 项` : '干净'}；HEAD 不承担锚职责，判据以 src sha256 为准）`);
for (const i of inputs) log(`输入：${i}`);

const allPass = results.length === 5 && results.every((r) => r.ok);
const necessity = failures.some((f) => /H0|漂移|永不|破坏/.test(f));
if (allPass) {
  log('\n判定：PASS_STABLE_NS —— 五项全过（换实现/稳定 ns 与离线物理升级两段均过），Kernel 未引入领域特殊分支。');
  log('迁移形态：物理层 storage_schema_version 单独推进；历史行 contract_version 与解释结果一字不变；');
  log('          缺旧解释器 ⇒ UNINTERPRETED_FAIL_CLOSED；批量改版本戳被负例实测否定（历史变不可解释）。');
  log('分支后果：PR-8/W8 DEFERRED；ns-relocated 保持 planned、不要求批准；PR-5/PR-7 承接稳定 ns、');
  log('          版本化读者/解释器派发与可回滚重启式迁移（含换库/WAL 崩溃窗口的硬性验收）；PR-10 不再验物理重定位。');
} else if (necessity) {
  log(`\n判定：RELOCATION_REQUIRED —— 未被离线迁移/ns 解耦/普通适配消除的反例：${failures.join(' | ')}`);
} else {
  log(`\n判定：INCONCLUSIVE —— 脚手架/未定（不得包装为技术否证）：${failures.join(' | ')}`);
}

rmSync(dir, { recursive: true, force: true });
process.exit(allPass ? 0 : (necessity ? 10 : 2));
