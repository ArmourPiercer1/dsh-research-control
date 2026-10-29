import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld } from '../../src/harness/world.ts';
import type { CheckReportRecord, RevisionRef, VerifiedPrincipal } from '../../src/contracts/index.ts';

const ALICE: VerifiedPrincipal = { actorId: 'alice', verified: true };

function world(prefix: string) {
  const dir = mkdtempSync(join(POC_DATA_DIR, prefix));
  const w = openWorld({ file: join(dir, 'attack.db'), space: 'SP-ATTACK', grants: { alice: ['space-write'] } });
  return { dir, w };
}

describe('invariant attacks: sequence and exact-reference validation', () => {
  test('recordReport consumes a commit sequence without a ledger row', () => {
    const { dir, w } = world('attack-record-seq-');
    try {
      const report: Omit<CheckReportRecord, 'reportId' | 'recordedAt'> = {
        target: { kind: 'record-ref', recordId: 'not-yet-present' },
        validatorId: 'validator', ruleVersion: '1', schemaVersion: '1', environment: 'test',
        executedAt: Date.now(), guaranteeScope: 'test', verdict: 'ok', findings: [], declaredGaps: [],
      };
      const out = w.uow(ALICE, (tx) => tx.recordReport(report));

      const check = w.raw.get<{ recorded_seq: number }>(`select recorded_seq from check_report where report_id=?`, out.reportId);
      const ledger = w.raw.get(`select seq from ledger where seq=?`, out.seq);
      expect(check?.recorded_seq).toBe(out.seq);
      // Attack assertion: the report claims an H sequence that has no H/ledger record.
      expect(ledger).toBeDefined();
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('required revision reference to a nonexistent revision commits', () => {
    const { dir, w } = world('attack-required-revision-');
    try {
      const target = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { label: 'target' } }));
      const source = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { label: 'source' } }));
      const missing: RevisionRef = { kind: 'revision-ref', oid: target, revision: 999 };

      // Required exact references should be validated, but this currently commits.
      expect(() => w.uow(ALICE, (tx) => {
        tx.linkRef({ from: { kind: 'revision-ref', oid: source, revision: 1 }, to: missing, role: 'required-target', required: true });
      })).toThrow(/REQUIRED_REF_MISSING/);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('appendLedger permits duplicate record identifiers', () => {
    const { dir, w } = world('attack-duplicate-record-');
    try {
      // 修复后契约（作者按更强形态改写本断言，见 REVIEW.md F-10）：同一记录标识的第二次**声明**
      // 必须被拒绝，且整个事务回滚 ⇒ 不允许出现"精确记录引用解析出两条历史行"。
      expect(() => w.uow(ALICE, (tx) => {
        tx.appendLedger({ eventType: 'record-a', recordId: 'REC-DUP', payload: { n: 1 } });
        tx.appendLedger({ eventType: 'record-b', recordId: 'REC-DUP', payload: { n: 2 } });
      })).toThrow(/RECORD_ALREADY_DECLARED/);
      expect(w.raw.all(`select seq from ledger where record_id=?`, 'REC-DUP')).toEqual([]);
      // 反差锚点：显式声明一次 + 之后按引用追加，是合法形态
      w.uow(ALICE, (tx) => {
        tx.declareRecord({ recordId: 'REC-OK', eventType: 'record-a', payload: { n: 1 } });
        tx.appendLedger({ eventType: 'record-b', recordId: 'REC-OK', payload: { n: 2 }, declaresRecord: false });
      });
      expect(w.readRecord('REC-OK')!.payload).toEqual({ n: 1 });
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
