/**
 * 演化轴攻击 2 —— 模式演进：旧版本库 `meta` 缺计数器键。
 *
 * 背景事实：`sqlite-port.ts` 打开库时执行
 *   `insert or ignore into meta(key, value) values('id_counter', 0), ('ledger_seq', 0)`
 * —— 旧库若缺 `id_counter` 键（旧版本用别的 OID 生成策略），会被**静默**补成 0，
 * 而空间里可能已有 `OBJ-<space>-1` 这样的冻结对象。机制没有任何 schema 版本标记，
 * 无法区分"新库"与"缺键旧库"。
 *
 * 被检验的契约：
 *  - ST-7 / F-07：驱动错误码不得越过 Storage Port，上层必须拿到可判定的机制语义
 *    （拒绝码封闭集里为这种情况**预留**了 `ID_TAKEN`）；
 *  - RD-01 / ID-01：ObjectID 全局唯一、永不复用；
 *  - F-04 同族：截点/计数器语义必须让"库早于当前机制"这一事实**可判定**。
 */
import { describe, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../../src/harness/world.ts';
import { Refusal } from '../../src/contracts/index.ts';

const ALICE = PRINCIPAL('alice');
const SPACE = 'SP-OLD';
const GRANTS = { alice: ['space-write', 'capability-admin'] };

/** 旧版本库：meta 只有 ledger_seq，没有 id_counter；已存在对象 OBJ-SP-OLD-1。 */
function buildOldCounterDb(file: string): void {
  const db = new DatabaseSync(file);
  db.exec(`
    pragma journal_mode = wal;
    create table meta(key text primary key, value integer not null);
    insert into meta(key, value) values('ledger_seq', 3);

    create table ledger(
      seq integer primary key, space text not null, event_type text not null,
      actor text, object_id text, revision integer, record_id text,
      payload_json text not null, described_at integer, recorded_at integer not null
    );
    create table object_directory(
      oid text primary key, space text not null, kind text not null,
      owner_capability text not null, ns text not null, created_seq integer not null
    );
    create table domain_state(
      ns text not null, oid text not null, revision integer not null,
      payload_json text not null, recorded_seq integer not null,
      primary key(ns, oid, revision)
    );
    create table journal(
      seq integer primary key autoincrement, tx_epoch integer not null,
      ns text, oid text, op text not null, payload_json text
    );
    create table ref_edge(
      from_oid text not null, from_rev integer not null,
      to_oid text, to_rev integer, to_record text,
      role text not null, required integer not null default 0,
      primary key(from_oid, from_rev, role, to_oid, to_record)
    );
    create table check_report(
      report_id text primary key, target_kind text not null, target_oid text, target_rev integer,
      target_record text, validator_id text not null, rule_version text not null, schema_version text not null,
      environment text not null, executed_at integer not null, guarantee_scope text not null,
      verdict text not null, findings_json text not null, declared_gaps_json text not null,
      recorded_seq integer not null
    );

    insert into object_directory(oid, space, kind, owner_capability, ns, created_seq)
      values('OBJ-${SPACE}-1', '${SPACE}', 'test.claim', 'cap.test.object-model', 'dom_test_om', 1);
    insert into domain_state(ns, oid, revision, payload_json, recorded_seq)
      values('dom_test_om', 'OBJ-SP-OLD-1', 1, '{"v":"old"}', 1);
    insert into ledger(seq, space, event_type, actor, object_id, revision, record_id, payload_json, described_at, recorded_at)
      values(1, '${SPACE}', 'object-registered', 'alice', 'OBJ-SP-OLD-1', 1, null, '{}', null, 1000);
    insert into ledger(seq, space, event_type, actor, object_id, revision, record_id, payload_json, described_at, recorded_at)
      values(2, '${SPACE}', 'object-revised', 'alice', 'OBJ-SP-OLD-1', 1, null, '{}', null, 1001);
    insert into ledger(seq, space, event_type, actor, object_id, revision, record_id, payload_json, described_at, recorded_at)
      values(3, '${SPACE}', 'synth:note', 'alice', null, null, null, '{}', null, 1002);
  `);
  db.close();
}

function openOldCounterWorld(prefix: string) {
  const dir = mkdtempSync(join(POC_DATA_DIR, prefix));
  const file = join(dir, 'old.db');
  buildOldCounterDb(file);
  const w = openWorld({ file, space: SPACE, grants: GRANTS });
  return { dir, w };
}

describe('evolution attacks: old DB whose meta lacks the id_counter key', () => {
  test('opening must not silently heal id_counter to 0 while the space already contains object id 1', () => {
    const { dir, w } = openOldCounterWorld('evolution-old-counter-heal-');
    try {
      const counter = w.raw.get<{ value: number }>(`select value from meta where key='id_counter'`)!.value;
      const maxExisting = w.raw.get<{ m: number }>(
        `select max(cast(substr(oid, length('OBJ-') + length('${SPACE}') + 2) as integer)) m from object_directory where oid like 'OBJ-${SPACE}-%'`
      )!.m!;
      // 机制要么拒绝打开"早于当前 schema"的库（可判定），要么把计数器初始化为与既有身份一致；
      // 静默补 0 会让下一次 createObject 必然撞上一个**冻结的**既有 ObjectID。
      expect(
        counter > maxExisting,
        `打开旧库后 id_counter=${counter}，而空间已存在最大对象编号 ${maxExisting}：静默补 0 与冻结历史身份直接冲突`,
      ).toBe(true);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('createObject after the silent heal must fail with a decidable mechanism code, not a raw driver error (ST-7)', () => {
    const { dir, w } = openOldCounterWorld('evolution-old-counter-port-');
    try {
      let thrown: unknown;
      try {
        w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { n: 1 } }));
      } catch (e) { thrown = e; }
      expect(thrown, '修复后的计数器必然撞既有 OID：写入必须失败且给出可判定诊断').toBeDefined();
      // ST-7 / F-07：驱动错误码不得越过 Storage Port。封闭集已为"ObjectID 已存在"
      // 预留 ID_TAKEN；裸驱动异常意味着调用方必须读懂 SQLite 才知道发生了什么。
      expect(thrown, `越过 Port 的是驱动异常而非机制拒绝码：${String(thrown)} (code=${(thrown as { code?: string })?.code})`)
        .toBeInstanceOf(Refusal);
      // 永久写死：修复是持久的（meta 行已落盘），第二次尝试同样失败 ⇒ 空间对新对象永久不可写。
      let thrown2: unknown;
      try {
        w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { n: 2 } }));
      } catch (e) { thrown2 = e; }
      expect(thrown2, '静默修复已持久化 ⇒ 空间对象创建永久不可用').toBeDefined();
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('contrast anchor: a NEW db initializes the counter consistently (failure is old-schema specific)', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'evolution-new-counter-anchor-'));
    const w = openWorld({ file: join(dir, 'new.db'), space: 'SP-NEW', grants: GRANTS });
    try {
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { n: 1 } }));
      expect(oid).toBe('OBJ-SP-NEW-1');
      const counter = w.raw.get<{ value: number }>(`select value from meta where key='id_counter'`)!.value;
      expect(counter).toBe(1);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
