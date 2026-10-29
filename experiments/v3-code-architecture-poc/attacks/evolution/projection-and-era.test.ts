/**
 * 演化轴攻击 5 —— 投影跨演进重建 + 历史演进后的可解释性（ruleVersion 变化 / 截点落在
 * "表还不存在"的年代）。
 *
 * 任务问题：
 *  ① 索引方案变更后从旧 baseline 续跑会不会得出静默错误结果？
 *  ② 校验器 ruleVersion 变化后，旧报告与新报告的共存解释？
 *  ③ recorded_as_of 截点落在"表还不存在"的年代时读什么？
 *
 * 本文件的失败断言 = finding；通过的断言 = 机制确实设防的证据（同样登记）。
 */
import { describe, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../../src/harness/world.ts';
import { Projection } from '../../src/kernel/projection.ts';
import { ValidationService } from '../../src/domains/test-records.ts';
import { Refusal, asSpaceId } from '../../src/contracts/index.ts';

const SPACE = 'SP-ERA';
const ALICE = PRINCIPAL('alice');
const GRANTS = { alice: ['space-write', 'capability-admin'] };

function world(prefix: string) {
  const dir = mkdtempSync(join(POC_DATA_DIR, prefix));
  const w = openWorld({ file: join(dir, 'era.db'), space: SPACE, grants: GRANTS });
  return { dir, w };
}

describe('evolution attacks: projection across evolution + explainability of history after evolution', () => {
  test('projection guard: a new instance never continues an old baseline — the constructor re-derives watermark and baseline', () => {
    const { dir, w } = world('evolution-projection-rebuild-');
    try {
      const a = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'a' } }));
      const head0 = w.ledgerHead();
      const p1 = new Projection(w.kernel, 'idx');
      const row0 = w.raw.get<{ seq: number; baseline: number }>(`select seq, baseline from projection_state where name='idx'`)!;
      expect(row0.seq).toBe(head0);
      expect(row0.baseline).toBe(head0);

      // "索引方案变更"的机制内表达：新的投影实例（新代码）对同一 name 重新装配
      w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'b' } }));
      const head1 = w.ledgerHead();
      const p2 = new Projection(w.kernel, 'idx');
      const row1 = w.raw.get<{ seq: number; baseline: number }>(`select seq, baseline from projection_state where name='idx'`)!;
      // 不得从旧 baseline（head0 时代）续跑：新实例必须全量重建并把基线重锚到当前 head
      expect(row1.seq, '新实例的水位必须重锚到当前 head，而不是延续旧 baseline').toBe(head1);
      expect(row1.baseline, '基线必须随快照重建一起重锚').toBe(head1);
      const q = p2.indexQuery('test.claim');
      expect(q.status).toBe('FRESH');
      expect([...q.oids]).toContain(a);
      expect(p1.status()).toBeDefined(); // 旧实例的滞后状态仍是可查询的（滞后语义保留）
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('projection guard: a journal gap after the baseline is decidable (FULL_REBUILD_REQUIRED), never a silent half-history', () => {
    const { dir, w } = world('evolution-projection-gap-');
    try {
      w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'a' } }));
      const p = new Projection(w.kernel, 'idx');
      w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'b' } }));
      // journal 可压缩/可删除（ST-5）⇒ 删掉基线之后的一个 epoch，制造缺口
      w.raw.run(`delete from journal where tx_epoch=?`, w.ledgerHead());
      expect(() => p.catchUp()).toThrow(/FULL_REBUILD_REQUIRED/);
      // 反差锚点：全量重建消除缺口后，续跑可以成功
      p.rebuildFrom('snapshot');
      expect(() => p.catchUp()).not.toThrow();
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('ruleVersion coexistence: old and new reports are self-describing and the recorded_as_of cut separates their eras (RV-03/RPT-01)', () => {
    const { dir, w } = world('evolution-rules-coexist-');
    try {
      const vs = new ValidationService(w.kernel);
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'ok' } }));
      const r1 = vs.run(oid, 1, { actor: 'alice' }, 'v1');
      const row1Before = w.raw.get<{ rule_version: string; verdict: string; findings_json: string }>(
        `select rule_version, verdict, findings_json from check_report where report_id=?`, r1.reportId)!;
      // 对象修订 ⇒ 新规则版本产生**新**报告（RV-03：修订不得改写历史检查）
      w.uow(ALICE, (tx) => { tx.revise(oid, { payload: { text: 'ok-v2' } }); });
      const r2 = vs.run(oid, 2, { actor: 'alice' }, 'v2');

      const rows = w.raw.all<{ report_id: string; rule_version: string; target_rev: number }>(
        `select report_id, rule_version, target_rev from check_report order by recorded_seq`);
      expect(rows.map((r) => r.rule_version)).toEqual(['v1', 'v2']);
      // 旧报告逐字段未被新规则触碰
      const row1After = w.raw.get<{ rule_version: string; verdict: string; findings_json: string }>(
        `select rule_version, verdict, findings_json from check_report where report_id=?`, r1.reportId)!;
      expect(row1After).toEqual(row1Before);
      // recorded_as_of 截点可解释两个年代：截到 v1 报告时只有 1 条登记，截到 v2 报告时有 2 条
      const n1 = w.raw.get<{ c: number }>(
        `select count(*) c from ledger where event_type='check-report-recorded' and seq<=?`, r1.recordedAt)!.c;
      const n2 = w.raw.get<{ c: number }>(
        `select count(*) c from ledger where event_type='check-report-recorded' and seq<=?`, r2.recordedAt)!.c;
      expect([n1, n2]).toEqual([1, 2]);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('era attack: a record whose declaration predates the `records` table has no cut-point answer on any mechanism surface', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'evolution-era-olddb-'));
    const file = join(dir, 'old.db');
    try {
      // 旧版本库（测试装配）：无 records / capability_route / projection_state；
      // REC-OLD 的声明只存在于 ledger（seq=2）——这正是 F-13 之前的合法形态。
      const db = new DatabaseSync(file);
      db.exec(`
        pragma journal_mode = wal;
        create table meta(key text primary key, value integer not null);
        insert into meta(key, value) values('id_counter', 0), ('ledger_seq', 3);
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
        insert into object_directory(oid, space, kind, owner_capability, ns, created_seq)
          values('OBJ-${SPACE}-1', '${SPACE}', 'test.claim', 'cap.test.object-model', 'dom_test_om', 1);
        insert into domain_state(ns, oid, revision, payload_json, recorded_seq)
          values('dom_test_om', 'OBJ-${SPACE}-1', 1, '{"v":"old"}', 1);
        insert into ledger(seq, space, event_type, actor, object_id, revision, record_id, payload_json, described_at, recorded_at)
          values(1, '${SPACE}', 'object-registered', 'alice', 'OBJ-${SPACE}-1', 1, null, '{}', null, 1000);
        insert into ledger(seq, space, event_type, actor, object_id, revision, record_id, payload_json, described_at, recorded_at)
          values(2, '${SPACE}', 'synth:raw-intake', 'alice', null, null, 'REC-OLD', '{"text":"material"}', 1001);
        insert into ledger(seq, space, event_type, actor, object_id, revision, record_id, payload_json, described_at, recorded_at)
          values(3, '${SPACE}', 'synth:note', 'alice', null, null, null, '{}', null, 1002);
      `);
      db.close();

      const w: World = openWorld({ file, space: SPACE, grants: GRANTS });
      // 截点落在"records 表还不存在"的年代（在本旧库 = 全部历史年代）：
      // T-05 要求任何结果都标注实际使用的两个时间；记录面的读路径必须让
      // recorded_as_of 查询能判定"该截点时声明是否已存在"——机制必须给出
      // 声明截点（declared_seq）或一个可判定的不可判定信号，而不是静默 undefined。
      let rec: unknown;
      let refused: unknown;
      try { rec = w.readRecord('REC-OLD'); } catch (e) { refused = e; }
      const decidable = rec !== undefined || refused instanceof Refusal;
      expect(
        decidable,
        `截点前于 records 表存在年代时，记录声明（ledger seq=2）在机制面无任何答案：` +
          `readRecord=${JSON.stringify(rec)}，refused=${String(refused ?? 'none')}；` +
          'readAsOf 的 echo 只覆盖对象状态，记录面既不回显截点也不标记"早于表年代"⇒ 静默错答',
      ).toBe(true);
      w.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
