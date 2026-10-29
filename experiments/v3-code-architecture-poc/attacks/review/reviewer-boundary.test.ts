import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../../src/harness/world.ts';
import { CAP_OBJECT_MODEL, TEST_OBJECT_MODEL_SPLIT } from '../../src/domains/test-object-model.ts';
import type { CheckReportRecord, RevisionRef } from '../../src/contracts/index.ts';

const ALICE = PRINCIPAL('alice');
const ADMIN = PRINCIPAL('admin');

function world(prefix: string, grants: Record<string, readonly string[]> = { alice: ['space-write'] }) {
  const dir = mkdtempSync(join(POC_DATA_DIR, prefix));
  const w = openWorld({ file: join(dir, 'review.db'), space: 'SP-REVIEW', grants });
  return { dir, w };
}

describe('independent repair review attacks', () => {
  test('F-10 report ledger, journal and report roll back together; projection sees no gap', () => {
    const { dir, w } = world('review-f10-');
    try {
      const report: Omit<CheckReportRecord, 'reportId' | 'recordedAt'> = {
        target: { kind: 'record-ref', recordId: 'R' }, validatorId: 'v', ruleVersion: '1',
        schemaVersion: '1', environment: 'e', executedAt: 1, guaranteeScope: 'g', verdict: 'ok',
        findings: [], declaredGaps: [],
      };
      const out = w.uow(ALICE, (tx) => tx.recordReport(report));
      expect(w.raw.get('select seq from ledger where seq=?', out.seq)).toBeDefined();
      expect(w.raw.get('select tx_epoch from journal where tx_epoch=?', out.seq)).toBeDefined();
      w.close();
    } finally { try { w.close(); } catch {} rmSync(dir, { recursive: true, force: true }); }
  });

  test('F-12 soft record refs to missing records remain allowed', () => {
    const { dir, w } = world('review-f12-soft-');
    try {
      const source = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: {} }));
      expect(() => w.uow(ALICE, (tx) => tx.linkRef({
        from: { kind: 'revision-ref', oid: source, revision: 1 },
        to: { kind: 'record-ref', recordId: 'not-declared' }, role: 'optional', required: false,
      }))).not.toThrow();
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('F-12 rejects a missing source revision, not only a missing target revision', () => {
    const { dir, w } = world('review-f12-from-');
    try {
      const target = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: {} }));
      const source = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: {} }));
      expect(() => w.uow(ALICE, (tx) => tx.linkRef({
        from: { kind: 'revision-ref', oid: source, revision: 999 },
        to: { kind: 'revision-ref', oid: target, revision: 1 }, role: 'required', required: true,
      }))).toThrow(/REQUIRED_REF_MISSING/);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('F-14 guard blocks comment-prefixed DDL in all RawTx methods', () => {
    const { dir, w } = world('review-f14-comments-');
    try {
      expect(() => w.uow(ALICE, (tx) => {
        const raw = (tx as unknown as { raw: { run(sql: string, ...p: unknown[]): void; all(sql: string, ...p: unknown[]): unknown[]; get(sql: string, ...p: unknown[]): unknown } }).raw;
        for (const method of [
          (sql: string) => raw.run(sql),
          (sql: string) => raw.all(sql),
          (sql: string) => raw.get(sql),
        ]) {
          expect(() => method('/* disguise */ DROP TRIGGER IF EXISTS ledger_no_update')).toThrow();
        }
      })).not.toThrow();
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('F-11 target manifest without the capability is rejected without ledger registration', () => {
    const { dir, w } = world('review-f11-manifest-', { admin: ['capability-admin'] });
    try {
      const bad = { pluginId: 'bad', codeVersion: '1', storageNamespace: 'bad_ns', provides: [], requires: [] } as const;
      expect(() => w.transferCapability(CAP_OBJECT_MODEL, bad, ADMIN)).toThrow(/ACTIVATION_IMPOSSIBLE/);
      expect(w.raw.all("select seq from ledger where event_type='capability-transferred'")).toEqual([]);
      expect(w.kernel.registry.capability(CAP_OBJECT_MODEL)?.pluginId).toBe('test.object-model');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
