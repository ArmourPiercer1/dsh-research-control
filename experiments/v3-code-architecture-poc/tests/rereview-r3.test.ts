/**
 * 独立复审第 3 轮回执（作者侧回归测试）。
 *
 * 复审员用三条攻击打穿了我写的窄面与契约版本面（R3-A/B/C 全部成立）。
 * 修法落地后，这里放**作者自己**的回归断言：不复用审查方的断言，因为审查方的文件
 * 可能随他们的判断改写；封死的口子必须由本仓自己的测试独立守住。
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../src/harness/world.ts';
import type { PluginManifest } from '../src/contracts/index.ts';
import { TEST_OBJECT_MODEL } from '../src/domains/test-object-model.ts';

const ALICE = PRINCIPAL('r3-author-fix');
const GRANTS = { 'r3-author-fix': ['space-write', 'capability-admin'] };
const FOREIGN: PluginManifest = {
  pluginId: 'r3.author.facet', codeVersion: '1',
  provides: [{ capability: 'cap.r3.author.facet', contractVersion: 'v1' }],
  requires: [], storageNamespace: 'dom_r3_author_facet',
};

describe('R3-A 窄面不得跨命名空间读', () => {
  test('别的能力的 face 读不走本能力对象的修订（恒拒绝，码与写侧越界同名）', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'r3a-'));
    const w = openWorld({ file: join(dir, 'x.db'), space: 'SP-A', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, FOREIGN] });
    try {
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { secret: 'core' } }));
      const face = w.kernel.faceFor('cap.r3.author.facet');
      expect(() => face.revisionOf({ kind: 'revision-ref', oid, revision: 1 })).toThrow(/NAMESPACE_ESCAPE/);
      // 窄面自己的 readOwn 也不该看得见别人的对象
      expect(face.readOwn(oid)).toBeUndefined();
      // 反差：宿主自己的解析路径照样能读（读的能力属于装配边界，不属于插件）
      expect(w.readRevision({ kind: 'revision-ref', oid, revision: 1 })?.payload.secret).toBe('core');
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('R3-B 无契约版本标记的行不可读', () => {
  test('contract_version 空串不是「未知就放过」，而是「不可判定就拒绝」', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'r3b-'));
    const w = openWorld({ file: join(dir, 'x.db'), space: 'SP-B', grants: GRANTS });
    try {
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { fresh: true } }));
      w.raw.run(
        `insert into domain_state(ns, oid, revision, payload_json, recorded_seq, contract_version) values(?,?,?,?,?,?)`,
        'dom_test_om', oid, 99, '{"legacy":true}', w.ledgerHead(), '',
      );
      expect(() => w.readRevision({ kind: 'revision-ref', oid, revision: 99 })).toThrow(/SCHEMA_INCOMPATIBLE/);
      // 反差：正常写入的行带版本，读得到
      expect(w.readRevision({ kind: 'revision-ref', oid, revision: 1 })?.payload.fresh).toBe(true);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('R3-C 存储命名空间必须被一个能力独占', () => {
  test('两个能力声明同一个 ns ⇒ 装配即拒绝，而不是让归属看迭代顺序', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'r3c-'));
    const cloneNs: PluginManifest = {
      pluginId: 'r3.author.clone', codeVersion: '1',
      provides: [{ capability: 'cap.r3.clone', contractVersion: 'v9' }],
      requires: [], storageNamespace: 'dom_test_om',   // 与 test.object-model 抢同一个所有权键
    };
    try {
      expect(() => openWorld({ file: join(dir, 'x.db'), space: 'SP-C', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, cloneNs] }))
        .toThrow(/ACTIVATION_IMPOSSIBLE/);
      // 反差：各占一个 ns 时照常装配
      const ok = openWorld({ file: join(dir, 'ok.db'), space: 'SP-C', grants: GRANTS, plugins: [TEST_OBJECT_MODEL, FOREIGN] });
      try { expect(ok.kernel.registry.capability('cap.r3.author.facet')?.contractVersion).toBe('v1'); }
      finally { ok.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
