/**
 * 语义组合攻击（独立审查员）— S-3：检查报告自身的记录标识游离在 Kernel 记录解析之外
 *
 * 被违反的契约：
 *  - ID-08：「未对象化的记录（H 事件、来源引用、**检查报告**、快照、采纳记录）有自身标识，
 *    可被引用，但不获得对象身份」——检查报告的 reportId 在本机制里**不可被引用**；
 *  - SP-02：解析失败「先判可见性再判不存在；不可区分时按 WITHHELD（保守侧）」——
 *    保守合并针对**跨空间/未提交**的不可区分；**本空间已提交**的报告解析成 OPAQUE 是假阴性，
 *    不是保守侧（它明明可以区分）；
 *  - XC-15/RF-05（检查记录不得充当论证输入端点）：端点资格审查要谈"引用报告"，
 *    而机制里对报告的硬引用（required）永远失败 ⇒ 报告只能以软引用出现，
 *    RF-05 的判据（领域函数 checkEndpoint）没有任何机制挂载点，纯靠自觉。
 *
 * 现状（缺陷）：阶段 D 第 1 轮 F-10 已修"报告消耗登记序却不写 ledger"（ledger 行有了），
 * 但报告的**自身标识 reportId** 从未在 `records` 表声明，也未写入任何 ledger 行的 record_id 列
 * （报告 ledger 行的 record_id 存的是**目标**的 record_id，或 null）：
 *  - resolvePresented(record-ref, reportId) 只查 ledger.record_id ⇒ 恒 OPAQUE；
 *  - checkRequiredRefs 对 record-ref 只查 records 表 ⇒ 对已提交报告的 required 引用恒
 *    REQUIRED_REF_MISSING（即使报告就在本空间）。
 *
 * 本文件断言的是**当前（有缺陷的）行为**——今天通过，修复后应变红：
 * 最小机制修复（不引入科研语义）：recordReport 在同一事务内把报告自身 recordId 声明进 `records`
 *  （declareRecord 同型：record_id=reportId, declared_seq=seq, payload_json=报告核心字段）；
 *  报告随即与其余记录同构：resolvePresented 得 PRESENT、required 引用可校验。
 * 回归测试：本文件即攻击证据（修复后 OPAQUE/REQUIRED_REF_MISSING 两处断言反转，反差锚点不变）。
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../../src/harness/world.ts';
import type { CheckReportRecord } from '../../src/contracts/index.ts';

const ALICE = PRINCIPAL('alice');

function reportFor(oid: string, revision: number): Omit<CheckReportRecord, 'reportId' | 'recordedAt'> {
  return {
    target: { kind: 'revision-ref', oid: oid as never, revision },
    validatorId: 'synth.claim-checker', ruleVersion: 'v1', schemaVersion: 'synth-1',
    environment: 'synth-env', executedAt: Date.now(), guaranteeScope: 'SYNTH-STRUCTURAL-ONLY',
    verdict: 'ACHIEVED', findings: [], declaredGaps: [],
  };
}

describe('S-3 报告的自身 recordId 游离于机制记录解析之外', () => {
  test('本空间已提交的报告 ⇒ resolvePresented 仍报 OPAQUE（假阴性）', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'sem-rpt-ident-'));
    const w = openWorld({ file: join(dir, 'attack.db'), space: 'SP-SEM-3', grants: { alice: ['space-write'] } });
    try {
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'x' } }));
      const out = w.uow(ALICE, (tx) => tx.recordReport(reportFor(oid, 1)));

      // 报告确实在本空间、已提交（F-10 修复后 ledger 行存在）：
      expect(w.raw.get(`select seq from ledger where seq=?`, out.seq)).toBeDefined();
      expect(w.raw.get(`select report_id from check_report where report_id=?`, out.reportId)).toBeDefined();
      // 但：
      expect(w.kernel.resolvePresented({ kind: 'record-ref', recordId: out.reportId })).toEqual({ state: 'OPAQUE' });
      // 报告自身的标识不在 records 表，也不在任何 ledger 行的 record_id 列：
      expect(w.raw.get(`select record_id from records where record_id=?`, out.reportId)).toBeUndefined();
      const ledgerRow = w.raw.get<{ record_id: string | null }>(`select record_id from ledger where seq=?`, out.seq);
      expect(ledgerRow?.record_id).toBeNull(); // 报告的 ledger 行没有承载报告自身标识
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('对本空间已提交报告的 required 引用 ⇒ 恒 REQUIRED_REF_MISSING（ID-08"可被引用"不成立）', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'sem-rpt-req-'));
    const w = openWorld({ file: join(dir, 'attack.db'), space: 'SP-SEM-3B', grants: { alice: ['space-write'] } });
    try {
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'x' } }));
      const out = w.uow(ALICE, (tx) => tx.recordReport(reportFor(oid, 1)));
      expect(() => w.uow(ALICE, (tx) =>
        tx.linkRef({
          from: { kind: 'revision-ref', oid: oid as never, revision: 1 },
          to: { kind: 'record-ref', recordId: out.reportId },
          role: 'input:premise', required: true,
        }),
      )).toThrow(/REQUIRED_REF_MISSING/);
      // 而报告就在同一事务可见的本空间里：
      expect(w.raw.get(`select report_id from check_report where report_id=?`, out.reportId)).toBeDefined();
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('反差锚点：经 declareRecord 声明的记录 ⇒ PRESENT 且 required 引用可过', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'sem-rpt-anchor-'));
    const w = openWorld({ file: join(dir, 'attack.db'), space: 'SP-SEM-3C', grants: { alice: ['space-write'] } });
    try {
      const oid = w.uow(ALICE, (tx) => {
        tx.declareRecord({ recordId: 'DECL-ANCHOR', eventType: 'e', payload: { n: 1 } });
        return tx.createObject({ kind: 'test.claim', payload: { text: 'x' } });
      });
      expect(w.kernel.resolvePresented({ kind: 'record-ref', recordId: 'DECL-ANCHOR' })).toEqual({ state: 'PRESENT' });
      expect(() => w.uow(ALICE, (tx) =>
        tx.linkRef({
          from: { kind: 'revision-ref', oid: oid as never, revision: 1 },
          to: { kind: 'record-ref', recordId: 'DECL-ANCHOR' },
          role: 'input:premise', required: true,
        }),
      )).not.toThrow();
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
