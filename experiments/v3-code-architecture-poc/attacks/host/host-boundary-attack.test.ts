import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../../src/harness/world.ts';
import { CAP_OBJECT_MODEL, TEST_OBJECT_MODEL_SPLIT } from '../../src/domains/test-object-model.ts';
import type { CheckReportRecord, RevisionRef } from '../../src/contracts/index.ts';

const ALICE = PRINCIPAL('alice');

function world(prefix: string, grants: Record<string, readonly string[]> = { alice: ['space-write'] }) {
  const dir = mkdtempSync(join(POC_DATA_DIR, prefix));
  const w = openWorld({ file: join(dir, 'attack.db'), space: 'SP-HOST', grants });
  return { dir, w };
}

describe('host-boundary adversarial attacks', () => {
  test('required RevisionRef must reject an existing object at a nonexistent revision', () => {
    const { dir, w } = world('attack-host-revision-');
    try {
      const target = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: {} }));
      const source = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: {} }));
      const missing: RevisionRef = { kind: 'revision-ref', oid: target, revision: 999 };
      expect(() => w.uow(ALICE, (tx) => tx.linkRef({
        from: { kind: 'revision-ref', oid: source, revision: 1 },
        to: missing, role: 'required-exact', required: true,
      }))).toThrow(/REQUIRED_REF_MISSING/);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('recordReport must not consume a knowledge sequence without a ledger fact', () => {
    const { dir, w } = world('attack-host-report-seq-');
    try {
      const report: Omit<CheckReportRecord, 'reportId' | 'recordedAt'> = {
        target: { kind: 'record-ref', recordId: 'missing-record' }, validatorId: 'v',
        ruleVersion: '1', schemaVersion: '1', environment: 'test', executedAt: Date.now(),
        guaranteeScope: 'test', verdict: 'ok', findings: [], declaredGaps: [],
      };
      const out = w.uow(ALICE, (tx) => tx.recordReport(report));
      expect(w.raw.get(`select seq from ledger where seq=?`, out.seq)).toBeDefined();
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  // 修复后契约（作者按更强形态改写本断言，理由与原文差异见 REVIEW.md F-11）：
  // 插件面上已无路由改写入口；机制入口需要 capability-admin；强转触达内部方法时写点二次核对。
  test('space-write alone must not permit an arbitrary capability route rewrite', () => {
    const { dir, w } = world('host-route', { alice: ['space-write'], rooter: ['space-write', 'capability-admin'] });
    try {
      // 只有写权的主体：机制入口必须拒绝，且不留登记
      expect(() => w.transferCapability(CAP_OBJECT_MODEL, TEST_OBJECT_MODEL_SPLIT, ALICE)).toThrow(/AUTHORITY_REQUIRED/);
      expect(w.kernel.registry.capability(CAP_OBJECT_MODEL)!.pluginId).toBe('test.object-model');
      expect(w.raw.all(`select seq from ledger where event_type='capability-transferred'`)).toEqual([]);
      // 反差锚点：同一调用换运维权威主体必须成功（否则上面的绿色没有信息量）
      w.transferCapability(CAP_OBJECT_MODEL, TEST_OBJECT_MODEL_SPLIT, PRINCIPAL('rooter'));
      expect(w.kernel.registry.capability(CAP_OBJECT_MODEL)!.pluginId).toBe('test.object-model.split');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  // 纵深防御：即便绕过机制入口、强转触达机制内部方法，写点仍独立核对运维权威。
  test('bypassing the mechanism entry point must still hit an authority check at the write site', () => {
    const { dir, w } = world('host-route-bypass', { alice: ['space-write'] });
    try {
      expect(() => w.uow(ALICE, (tx) => {
        const inner = tx as unknown as { reassignRouteInternal(c: string, p: string, n: string, v?: string): void };
        inner.reassignRouteInternal(CAP_OBJECT_MODEL, 'attacker.plugin', 'dom_attacker');
      })).toThrow(/AUTHORITY_REQUIRED/);
      expect(w.kernel.registry.capability(CAP_OBJECT_MODEL)!.storageNamespace).toBe('dom_test_om');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('plugin handles must not carry arbitrary SQL (immutability triggers are not theirs to drop)', () => {
    const { dir, w } = world('host-raw-drop');
    try {
      // 类型面上 UnitOfWork 已不暴露 raw；运行时若被强转拿到，守卫仍须拒绝 DDL，
      // 否则"触发器保证不可变"只等于"没人去删触发器"。
      const oid = w.uow(ALICE, (tx) => {
        const handle = (tx as unknown as { raw: { run(sql: string, ...p: unknown[]): unknown } }).raw;
        expect(() => handle.run(`drop trigger if exists ledger_no_update`)).toThrow(/RAW_SQL_REFUSED/);
        expect(() => handle.run(`attach database ':memory:' as x`)).toThrow(/RAW_SQL_REFUSED/);
        return tx.createObject({ kind: 'test.claim', payload: { label: 'ok' } });
      });
      expect(w.readObject(oid)).toBeDefined();
      // 触发器仍在位：DML 篡改依旧被存储层拒绝
      expect(() => w.raw.run(`update ledger set event_type='forged' where seq=1`)).toThrow(/HISTORY_IMMUTABLE/);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
