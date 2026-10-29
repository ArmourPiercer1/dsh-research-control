/**
 * 演化轴攻击 1 —— 模式演进：旧版本库缺 `records` 表（F-13 之前形态）。
 *
 * 背景事实（任务书确认）：`records` / `capability_route` / `projection_state` 是本轮修复
 * 新增的表；表结构用 `create table if not exists` 建立（`sqlite-port.ts` SCHEMA），
 * 因此**旧库文件可以缺表**——机制打开旧库时没有任何版本标记可判，`if not exists`
 * 会静默补建空表，`insert or ignore` 会静默补计数器。
 *
 * 被检验的契约：
 *  - F-13：`readRecord` 改读正源（`records`）⇒ 正源必须包含**全部历史声明**；
 *  - ID-08 / F-13 症状行：同一记录标识的首次声明必须唯一，精确记录引用不得歧义；
 *  - SP-10 / 呈现纪律：Kernel 中性形态 `PRESENT` 与数据面读数必须一致（真源唯一）；
 *  - ST-7 / F-07：驱动错误码不得越过 Storage Port（拒绝码必须是封闭集里的可判定机制码）。
 *
 * 本文件的失败断言 = finding：机制**静默接受**旧库后给出**错误结论**
 * （readRecord 静默 undefined、PRESENT 与 undefined 并存、既有合法 record-ref
 *  被报成 REQUIRED_REF_MISSING / RECORD_UNDECLARED、重声明"修复"制造双重声明并
 *  影子覆盖原始材料）。
 */
import { describe, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../../src/harness/world.ts';

const ALICE = PRINCIPAL('alice');
const SPACE = 'SP-OLD';
const GRANTS = { alice: ['space-write', 'capability-admin'] };

/**
 * 造"旧版本库"（测试装配，非机制出口）：当前 SCHEMA 减去 `records` / `capability_route`
 * / `projection_state` 三张新表；历史里含一条**只在 ledger 中声明过**的记录 REC-OLD
 * （seq=3）与一条指向它的引用边。`required` 由参数控制。
 */
function buildOldDb(file: string, requiredEdge: boolean): void {
  const db = new DatabaseSync(file);
  db.exec(`
    pragma journal_mode = wal;
    create table meta(key text primary key, value integer not null);
    insert into meta(key, value) values('id_counter', 2), ('ledger_seq', 4);

    create table ledger(
      seq integer primary key, space text not null, event_type text not null,
      actor text, object_id text, revision integer, record_id text,
      payload_json text not null, described_at integer, recorded_at integer not null
    );
    create trigger ledger_no_update before update on ledger
    begin select raise(abort, 'HISTORY_IMMUTABLE'); end;
    create trigger ledger_no_delete before delete on ledger
    begin select raise(abort, 'HISTORY_IMMUTABLE'); end;

    create table object_directory(
      oid text primary key, space text not null, kind text not null,
      owner_capability text not null, ns text not null, created_seq integer not null
    );
    create trigger directory_no_update before update on object_directory
    begin select raise(abort, 'DIRECTORY_IDENTITY_FROZEN'); end;

    create table domain_state(
      ns text not null, oid text not null, revision integer not null,
      payload_json text not null, recorded_seq integer not null,
      primary key(ns, oid, revision)
    );

    create table journal(
      seq integer primary key autoincrement, tx_epoch integer not null,
      ns text, oid text, op text not null, payload_json text
    );

    create table projection_cursor(
      projection text primary key, journal_seq integer not null,
      authority_seq integer, status text not null
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
    create trigger check_report_no_update before update on check_report
    begin select raise(abort, 'CHECK_REPORT_IMMUTABLE'); end;
    create trigger check_report_no_delete before delete on check_report
    begin select raise(abort, 'CHECK_REPORT_IMMUTABLE'); end;

    insert into object_directory(oid, space, kind, owner_capability, ns, created_seq)
      values('OBJ-${SPACE}-1', '${SPACE}', 'test.claim', 'cap.test.object-model', 'dom_test_om', 1);
    insert into domain_state(ns, oid, revision, payload_json, recorded_seq)
      values('dom_test_om', 'OBJ-${SPACE}-1', 1, '{"v":"old","fromRecord":"REC-OLD"}', 1);
    insert into domain_state(ns, oid, revision, payload_json, recorded_seq)
      values('dom_test_om', 'OBJ-SP-OLD-1', 2, '{"v":"old2"}', 2);
    insert into ledger(seq, space, event_type, actor, object_id, revision, record_id, payload_json, described_at, recorded_at)
      values(1, '${SPACE}', 'object-registered', 'alice', 'OBJ-SP-OLD-1', 1, null, '{}', null, 1000);
    insert into ledger(seq, space, event_type, actor, object_id, revision, record_id, payload_json, described_at, recorded_at)
      values(2, '${SPACE}', 'object-revised', 'alice', 'OBJ-SP-OLD-1', 2, null, '{}', null, 1001);
    insert into ledger(seq, space, event_type, actor, object_id, revision, record_id, payload_json, described_at, recorded_at)
      values(3, '${SPACE}', 'synth:raw-intake', 'alice', null, null, 'REC-OLD', '{"text":"material","sourceRef":"src"}', 1002);
    insert into ledger(seq, space, event_type, actor, object_id, revision, record_id, payload_json, described_at, recorded_at)
      values(4, '${SPACE}', 'synth:objectified', 'alice', null, null, 'REC-OLD', '{}', 1003);
    insert into ref_edge(from_oid, from_rev, to_oid, to_rev, to_record, role, required)
      values('OBJ-SP-OLD-1', 1, null, null, 'REC-OLD', 'synth:derived-from', ${requiredEdge ? 1 : 0});
    insert into journal(tx_epoch, ns, oid, op) values(1, 'dom_test_om', 'OBJ-SP-OLD-1', 'state-upsert');
    insert into journal(tx_epoch, ns, oid, op) values(2, 'dom_test_om', 'OBJ-SP-OLD-1', 'state-upsert');
  `);
  db.close();
}

function openOldWorld(prefix: string, requiredEdge: boolean) {
  const dir = mkdtempSync(join(POC_DATA_DIR, prefix));
  const file = join(dir, 'old.db');
  buildOldDb(file, requiredEdge);
  const w = openWorld({ file, space: SPACE, grants: GRANTS });
  return { dir, w };
}

describe('evolution attacks: old DB without `records` table (pre-F-13 schema)', () => {
  test('readRecord must not silently return undefined for a record legitimately declared in ledger history', () => {
    const { dir, w } = openOldWorld('evolution-old-records-read-', true);
    try {
      const decl = w.raw.get<{ seq: number }>(`select seq from ledger where record_id=?`, 'REC-OLD');
      expect(decl?.seq).toBe(3); // 前置：声明确实在历史里（fixture 自检）
      const rec = w.readRecord('REC-OLD');
      // F-13 把 readRecord 改读正源 records ⇒ 正源必须包含历史声明；
      // 缺表被静默补建为空后，历史声明在正源里**不存在**且无任何迁移/不可判定信号。
      expect(
        rec,
        `readRecord('REC-OLD') = ${JSON.stringify(rec)}，但 ledger 声明行 seq=3 存在；机制静默接受旧库并静默丢声明`,
      ).toBeDefined();
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('PRESENT/undefined divergence: presentation surface and data surface must agree (SP-10 single source)', () => {
    const { dir, w } = openOldWorld('evolution-old-records-divergence-', true);
    try {
      const presented = w.kernel.resolvePresented({ kind: 'record-ref', recordId: 'REC-OLD' });
      expect(presented.state).toBe('PRESENT'); // ledger 有 record_id 行 ⇒ 呈现面声称存在（当前实际行为）
      // 若呈现面声称 PRESENT，数据面必须读得到；否则"存在"与"读空"两个结论在同一机制内并存。
      expect(
        w.readRecord('REC-OLD') !== undefined,
        `resolvePresented=${JSON.stringify(presented)} 但 readRecord=${JSON.stringify(w.readRecord('REC-OLD'))}` +
          '：同一机制给出 PRESENT 与空读数两个不可互相解释的结论',
      ).toBe(true);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('an existing legitimate required record-ref must not be misdiagnosed as REQUIRED_REF_MISSING and write-lock the space', () => {
    const { dir, w } = openOldWorld('evolution-old-records-writelock-', true);
    try {
      // 与 REC-OLD 完全无关的合法写入（新对象）也触发全库 checkRequiredRefs：
      // 旧库中**合法存在**的记录被报成"缺失"，且该诊断指向数据丢失而不是"库早于 records 表"。
      expect(() => w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { n: 1 } })),
        '既有合法 record-ref 不应被判缺失；空间不应被永久写死').not.toThrow();
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('contrast anchor: the same operations on a NEW db all work (failure is schema-evolution specific)', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'evolution-new-records-anchor-'));
    const w = openWorld({ file: join(dir, 'new.db'), space: 'SP-NEW', grants: GRANTS });
    try {
      w.uow(ALICE, (tx) => {
        tx.declareRecord({ recordId: 'REC-NEW', eventType: 'synth:raw-intake', payload: { text: 'material' } });
        tx.appendLedger({ eventType: 'synth:objectified', recordId: 'REC-NEW', declaresRecord: false, payload: {} });
      });
      expect(w.readRecord('REC-NEW')).toBeDefined();
      expect(w.kernel.resolvePresented({ kind: 'record-ref', recordId: 'REC-NEW' }).state).toBe('PRESENT');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('soft edge: referencing an old-era record must not be misdiagnosed as RECORD_UNDECLARED', () => {
    const { dir, w } = openOldWorld('evolution-old-records-undeclared-', false);
    try {
      expect(() => w.uow(ALICE, (tx) => tx.appendLedger({
        eventType: 'synth:followup', recordId: 'REC-OLD', declaresRecord: false, payload: { note: 'follow-up' },
      }))).not.toThrow();
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('the only available "fix" (re-declaration) must not create a second declaration and shadow the original material', () => {
    const { dir, w } = openOldWorld('evolution-old-records-redeclare-', false);
    try {
      // 软引用边不挡写入 ⇒ 操作员面对 RECORD_UNDECLARED 的"修复"只能重新声明同一标识：
      w.uow(ALICE, (tx) => tx.appendLedger({
        eventType: 'synth:raw-intake', recordId: 'REC-OLD', payload: { text: 're-decl' },
      }));
      // ID-08 / F-13：同一记录标识的首次声明必须唯一。旧库的历史里已经有 seq=3 的声明，
      // 重声明后历史含两条声明事件 ⇒ 精确记录引用重新变成歧义引用（正是 F-13 要消灭的形态）。
      const decls = w.raw.all<{ seq: number }>(
        `select seq from ledger where record_id=? and event_type='synth:raw-intake' order by seq`, 'REC-OLD');
      expect(decls.length, `重声明后出现 ${decls.length} 条声明事件（seq=${decls.map((d) => d.seq).join(',')}）`).toBe(1);
      // 且 readRecord 正源被重声明影子覆盖：原始材料（ledger seq=3 的 payload）被静默替换。
      const rec = w.readRecord('REC-OLD');
      const original = w.raw.get<{ payload_json: string }>(
        `select payload_json from ledger where record_id=? and event_type='synth:raw-intake' order by seq limit 1`, 'REC-OLD');
      expect(rec?.payload, `readRecord=${JSON.stringify(rec?.payload)} 覆盖了历史原始材料 ${JSON.stringify(original?.payload_json)}`)
        .toEqual(JSON.parse(original!.payload_json));
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
