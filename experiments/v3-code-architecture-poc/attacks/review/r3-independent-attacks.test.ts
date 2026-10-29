import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../../src/harness/world.ts';
import { CAP_OBJECT_MODEL, TEST_OBJECT_MODEL } from '../../src/domains/test-object-model.ts';
import type { PluginManifest } from '../../src/contracts/index.ts';

const ALICE = PRINCIPAL('alice');
const ADMIN = PRINCIPAL('admin');
const GRANTS = { alice: ['space-write'], admin: ['space-write', 'capability-admin'] };

describe('R3 independent boundary attacks', () => {
  test('PluginFace revisionOf is not namespace-scoped: a domain face can read another capability', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'r3-face-read-'));
    const facet: PluginManifest = {
      pluginId: 'r3.facet', codeVersion: '1',
      provides: [{ capability: 'cap.r3.facet', contractVersion: 'v1' }],
      requires: [], storageNamespace: 'dom_r3_facet',
    };
    const w = openWorld({ file: join(dir, 'x.db'), space: 'R3', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, facet] });
    try {
      const oid = w.uow(ALICE, tx => tx.createObject({ kind: 'test.claim', payload: { secret: 'core' } }));
      const face = w.kernel.faceFor('cap.r3.facet');
      expect(face.revisionOf({ kind: 'revision-ref', oid, revision: 1 })?.payload.secret).toBe('core');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('empty contract_version is accepted by readRevision although current route has a nonempty version', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'r3-empty-contract-'));
    const w = openWorld({ file: join(dir, 'x.db'), space: 'R3', grants: GRANTS });
    try {
      const oid = w.uow(ALICE, tx => tx.createObject({ kind: 'test.claim', payload: { old: true } }));
      // A legacy/hand-crafted row with no version is not rejected by assertContractVersion.
      w.raw.run(
        `insert into domain_state(ns, oid, revision, payload_json, recorded_seq, contract_version) values(?,?,?,?,?,?)`,
        'dom_test_om', oid, 99, '{"legacy":true}', w.ledgerHead(), '',
      );
      const got = w.readRevision({ kind: 'revision-ref', oid, revision: 99 });
      expect(got?.payload.legacy).toBe(true);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('two capabilities sharing one namespace make NamespaceWriter version attribution order-dependent', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'r3-shared-ns-'));
    const second: PluginManifest = {
      pluginId: 'r3.second', codeVersion: '1',
      provides: [{ capability: 'cap.r3.second', contractVersion: 'v9' }],
      requires: [], storageNamespace: 'dom_test_om',
    };
    const w = openWorld({ file: join(dir, 'x.db'), space: 'R3', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, second] });
    try {
      const oid = w.uow(ALICE, tx => tx.createObject({ kind: 'test.claim', payload: { x: 1 } }));
      w.uow(ALICE, tx => w.kernel.faceFor('cap.r3.second').writerFor(tx).write({ ns: 'dom_test_om', oid, revision: 10, payload: { second: true }, eventType: 'r3' }));
      const row = w.raw.get<{ contract_version: string }>(`select contract_version from domain_state where oid=? and revision=?`, oid, 10);
      expect(row?.contract_version).toBe('v9');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
