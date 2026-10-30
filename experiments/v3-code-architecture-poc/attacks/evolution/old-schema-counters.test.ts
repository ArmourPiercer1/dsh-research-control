/**
 * 演化轴攻击 2（第 3 轮后重构）—— 模式演进：`meta` 计数器键缺失/落后/超前 的打开期判据。
 *
 * 第 3 轮前的行为（本轴第 1 轮证伪）：打开旧库 `insert or ignore` 静默补 `id_counter=0`，
 * 第一次 `createObject` 撞上冻结对象的 ObjectID，裸驱动主键冲突越过 Storage Port
 * （ST-7/F-07 违例），且修复持久化 ⇒ 空间对新对象永久不可写。
 *
 * 第 3 轮（HEAD 2284a99）的契约：打开路径做**计数器一致性校验**
 * （`id_counter < max(object_directory 编号) ⇒ SCHEMA_UPGRADE_REQUIRED`），
 * 把撞号从"写入期驱动异常"提前到"打开期机制拒绝"。
 *
 * 本文件检验修复后的契约（通过 = 守卫，失败 = 回归）：
 *  1. 缺键 + 有冻结对象 ⇒ 打开期可判定拒绝，detail 带 idCounter / maxExistingOidSuffix；
 *  2. 未标记的 v1 时代库（计数器同样缺键）⇒ 走"无版本标记"分支，同样是封闭集拒绝；
 *  3. 新库锚点：计数器初始化自洽，createObject 正常；
 *  4. 计数器**超前**（合法形态，如历史清理过编号空间之外的数据）⇒ 不得误拒，
 *     且继续写入从计数器+1 编号、不撞号（判据必须精确）。
 */
import { describe, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../../src/harness/world.ts';
import { Refusal } from '../../src/contracts/index.ts';

const ALICE = PRINCIPAL('alice');
const GRANTS = { alice: ['space-write'] };

function tamperedV3(prefix: string, space: string, tamper: (raw: DatabaseSync) => void) {
  const dir = mkdtempSync(join(POC_DATA_DIR, prefix));
  const file = join(dir, 'counter.db');
  const w = openWorld({ file, space, grants: GRANTS });
  w.close();
  const raw = new DatabaseSync(file);
  tamper(raw);
  raw.close();
  return { dir, file };
}

describe('evolution attacks: meta counter key missing / behind / ahead — decidable at open (post round-3 contract)', () => {
  test('missing id_counter key with frozen objects present: refused at open with migration-relevant detail', () => {
    const { dir, file } = tamperedV3('evolution-cnt-missing-', 'SP-CM', (raw) => {
      raw.exec(`delete from meta where key='id_counter'`);
      raw.exec(`insert into object_directory(oid, space, kind, owner_capability, ns, created_seq)
                values('OBJ-SP-CM-1', 'SP-CM', 'test.claim', 'cap.test.object-model', 'dom_test_om', 1)`);
    });
    try {
      let thrown: unknown;
      try { openWorld({ file, space: 'SP-CM', grants: GRANTS }); } catch (e) { thrown = e; }
      expect(thrown, '静默补 0 与冻结历史身份冲突 ⇒ 必须打开期拒绝').toBeInstanceOf(Refusal);
      expect((thrown as Refusal).code).toBe('SCHEMA_UPGRADE_REQUIRED');
      const d = (thrown as Refusal).detail as Record<string, unknown>;
      expect(d.idCounter ?? 0).toBe(0);
      expect(d.maxExistingOidSuffix).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('unmarked v1-era DB with the same counter defect: still one closed-set refusal (no marker branch)', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'evolution-cnt-v1era-'));
    const file = join(dir, 'v1era.db');
    try {
      // 最小 v1 时代库：无 schema_version、缺 id_counter、已有冻结对象 OBJ-SP-V1C-1
      const db = new DatabaseSync(file);
      db.exec(`
        pragma journal_mode = wal;
        create table meta(key text primary key, value integer not null);
        insert into meta(key, value) values('ledger_seq', 1);
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
        insert into object_directory(oid, space, kind, owner_capability, ns, created_seq)
          values('OBJ-SP-V1C-1', 'SP-V1C', 'test.claim', 'cap.test.object-model', 'dom_test_om', 1);
        insert into ledger(seq, space, event_type, actor, object_id, revision, record_id, payload_json, described_at, recorded_at)
          values(1, 'SP-V1C', 'object-registered', 'alice', 'OBJ-SP-V1C-1', 1, null, '{}', null, 1000);
      `);
      db.close();
      let thrown: unknown;
      try { openWorld({ file, space: 'SP-V1C', grants: GRANTS }); } catch (e) { thrown = e; }
      expect(thrown, '未标记旧库（计数器缺陷同样存在）必须封闭集拒绝，不得崩溃或裸驱动错误').toBeInstanceOf(Refusal);
      expect((thrown as Refusal).code).toBe('SCHEMA_UPGRADE_REQUIRED');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('contrast anchor: a NEW db initializes the counter consistently and createObject works', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'evolution-cnt-new-'));
    const w = openWorld({ file: join(dir, 'new.db'), space: 'SP-CN', grants: GRANTS });
    try {
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { n: 1 } }));
      expect(oid).toBe('OBJ-SP-CN-1');
      const counter = w.raw.get<{ value: number }>(`select value from meta where key='id_counter'`)!.value;
      expect(counter).toBe(1);
      // 重开仍一致（计数器持久化，不重锚）
      w.close();
      const w2 = openWorld({ file: join(dir, 'new.db'), space: 'SP-CN', grants: GRANTS });
      try {
        const oid2 = w2.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { n: 2 } }));
        expect(oid2).toBe('OBJ-SP-CN-2');
      } finally { w2.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('counter ahead of max existing OID is a LEGAL state: must open, and next write continues from counter+1', () => {
    const { dir, file } = tamperedV3('evolution-cnt-ahead2-', 'SP-CA2', (raw) => {
      raw.exec(`insert into object_directory(oid, space, kind, owner_capability, ns, created_seq)
                values('OBJ-SP-CA2-1', 'SP-CA2', 'test.claim', 'cap.test.object-model', 'dom_test_om', 1)`);
      raw.exec(`update meta set value=7 where key='id_counter'`);
    });
    try {
      const w = openWorld({ file, space: 'SP-CA2', grants: GRANTS }); // 判据必须精确：超前不是缺陷
      try {
        const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { n: 1 } }));
        expect(oid, '新对象必须从计数器+1 编号（不撞冻结的 -1）').toBe('OBJ-SP-CA2-8');
      } finally { w.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
