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
import { migrateLegacyRecords } from '../../src/storage-sqlite/sqlite-port.ts';
import { Refusal, type ObjectOid } from '../../src/contracts/index.ts';

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
      // 直接用机制的报告通道（领域编排层在演进中，不作攻击依赖）
      const report = (oid: ObjectOid, revision: number, ruleVersion: string, executedAt: number) =>
        w.uow(ALICE, (tx) => tx.recordReport({
          target: { kind: 'revision-ref', oid, revision },
          validatorId: 'synth.claim-checker', ruleVersion, schemaVersion: 'synth-1',
          environment: 'synth-env', executedAt, guaranteeScope: 'SYNTH-STRUCTURAL-ONLY',
          verdict: 'ACHIEVED', findings: [], declaredGaps: [],
        }));
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'ok' } }));
      const r1 = report(oid, 1, 'v1', 111);
      const row1Before = w.raw.get<{ rule_version: string; verdict: string; findings_json: string }>(
        `select rule_version, verdict, findings_json from check_report where report_id=?`, r1.reportId)!;
      // 对象修订 ⇒ 新规则版本产生**新**报告（RV-03：修订不得改写历史检查）
      w.uow(ALICE, (tx) => { tx.revise(oid, { payload: { text: 'ok-v2' } }); });
      const r2 = report(oid, 2, 'v2', 222);

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

  test('era question: a declaration predating the `records` table must be decidable at open (or backfilled with a replayable cut-point), never silently absent', () => {
    // #4 的截点问题在当前形态（S-0 之后 records 被触发器钉死）：
    //  · 旧库特征 = ledger 里有 record_id 而 records 里没有对应行（夹具直接补这样一条行）；
    //  · 未迁移 ⇒ 打开期 SCHEMA_UPGRADE_REQUIRED（"该年代读什么"的答案 = 机制拒绝进入该年代，
    //    而不是读面静默给出空答案）；
    //  · 显式迁移后 ⇒ readRecord 返回 declared_seq = 原始声明的 ledger 截点，
    //    "表还不存在"的年代由此有了可回放的边界（T-05/RV-02 方向）。
    const dir = mkdtempSync(join(POC_DATA_DIR, 'evolution-era-backfill-'));
    const file = join(dir, 'era.db');
    try {
      const w0 = openWorld({ file, space: SPACE, grants: GRANTS });
      w0.close();
      // 旧库特征：ledger 里有 record_id 而 records 里没有对应行
      const raw0 = new DatabaseSync(file);
      const declSeq = (raw0.prepare(`select value from meta where key='ledger_seq'`).get() as { value: number }).value + 1;
      raw0.prepare(`update meta set value = ? where key='ledger_seq'`).run(declSeq);
      raw0.prepare(
        `insert into ledger(seq, space, event_type, actor, record_id, payload_json, described_at, recorded_at)
         values(?,?,?,?,?,?,?,?)`,
      ).run(declSeq, SPACE, 'synth:raw-intake', 'legacy-importer', 'REC-ERA',
        JSON.stringify({ text: 'material' }), null, Date.now());
      raw0.close();

      // (a) 未迁移：打开必须可判定拒绝（不得静默进入"表年代之前"的历史）
      let thrown: unknown;
      try { openWorld({ file, space: SPACE, grants: GRANTS }); } catch (e) { thrown = e; }
      expect(thrown, '模式新/历史旧必须打开期检出，不得让 readRecord 静默 undefined').toBeInstanceOf(Refusal);
      expect((thrown as Refusal).code).toBe('SCHEMA_UPGRADE_REQUIRED');

      // (b) 显式迁移：回填后打开通过，声明截点可回放
      const n = migrateLegacyRecords(file);
      expect(n).toBe(1);
      const w = openWorld({ file, space: SPACE, grants: GRANTS });
      try {
        const rec = w.readRecord('REC-ERA');
        expect(rec, '迁移后 readRecord 必须读到回填行').toBeDefined();
        expect(rec!.seq, `declared_seq=${rec!.seq} 必须等于原始声明截点 ${declSeq}`).toBe(declSeq);
        // 回填事件本身也登记在 ledger（历史仍可被 recorded_as_of 截点看见，不撞号）
        const backfill = w.raw.get<{ seq: number }>(
          `select seq from ledger where event_type='record-backfilled' and record_id='REC-ERA'`);
        expect(backfill, '回填必须留痕（可回放的迁移登记）').toBeDefined();
        expect(backfill!.seq).toBeGreaterThan(declSeq);
      } finally { w.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
