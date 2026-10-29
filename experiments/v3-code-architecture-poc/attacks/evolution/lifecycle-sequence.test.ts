/**
 * 演化轴攻击 4 —— 插件长期演化序列：拆包 → 移交 → 再拆包 → 装卸/禁用期读取 → 再启用。
 *
 * 任务问题：
 *  ① 跨这些步骤后 ObjectID / Revision / 精确引用 / 命名空间 / Facet 版本是否仍自洽？
 *  ② 禁用期间对旧 revision 的读取必须仍可用吗（PR #42 T-03/RV-03 方向：
 *     ID-03 旧修订永不改写永不删除、RV-02 旧对象原样保留可回放、RV-03 历史锚定旧修订）？
 *
 * 代码事实：
 *  - 快照/精确读面经 `routeNs`（kernel.ts:237/486/592）⇒ 禁用/漂移时 fail-loud；
 *  - 双时间读面 `readAsOf`（read-context.ts:43-48）直接扫 `domain_state`，
 *    **不引用** registry / routeNs / capability ⇒ 同一对象在两个读面上得到矛盾答案；
 *  - `setRouteEnabled(true)`（kernel.ts:272-277）从**加载的 manifest**恢复内存路由，
 *    而不是从**持久路由行**（F-01 声明的正源）⇒ 再启用后内存所有者与 DB 所有者背离，
 *    直到重启才被 `activate()` 修正。
 *
 * 契约锚点：CP-6 / F-03（换实现命名空间漂移 ⇒ 读写双向 SCHEMA_INCOMPATIBLE，
 * "读写共用同一条 routeNs 判据"）；F-01（持久路由是所有者权威，激活时覆盖内存视图）。
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../../src/harness/world.ts';
import { readAsOf } from '../../src/kernel/read-context.ts';
import { TEST_OBJECT_MODEL, TEST_OBJECT_MODEL_SPLIT, CAP_OBJECT_MODEL } from '../../src/domains/test-object-model.ts';
import { TEST_FACET_CALIB, CAP_FACET, FacetStore } from '../../src/domains/test-facet.ts';
import { asSpaceId } from '../../src/contracts/index.ts';

const SPACE = 'SP-LIFE';
const ALICE = PRINCIPAL('alice');
const ADMIN = PRINCIPAL('admin');
const GRANTS = { alice: ['space-write'], admin: ['space-write', 'capability-admin'] };

const RENAMED_NS = { ...TEST_OBJECT_MODEL_SPLIT, storageNamespace: 'dom_test_om_v2' };

function world(prefix: string, plugins?: Parameters<typeof openWorld>[0]['plugins']): { dir: string; w: World } {
  const dir = mkdtempSync(join(POC_DATA_DIR, prefix));
  const w = openWorld({ file: join(dir, 'life.db'), space: SPACE, grants: GRANTS, plugins });
  return { dir, w };
}

const dualTimeRead = (w: World) =>
  readAsOf(w.kernel, {
    space: asSpaceId(SPACE), principal: ALICE, mode: 'as-recorded',
    recordedAsOf: w.ledgerHead(), consistency: 'required',
  });

describe('evolution attacks: long plugin lifecycle sequence (split → transfer → disable → re-enable)', () => {
  test('sequence guard: ObjectID / Revision / exact refs / namespace / Facet version stay self-consistent (same-ns split)', () => {
    const { dir, w } = world('evolution-life-guard-', [TEST_OBJECT_MODEL, TEST_FACET_CALIB]);
    try {
      const facets = new FacetStore(w.kernel, CAP_FACET);
      const { a, b } = w.uow(ALICE, (tx) => {
        const a = tx.createObject({ kind: 'test.claim', payload: { text: 'claim' } });
        tx.revise(a, { payload: { text: 'claim-v2' } });
        const b = tx.createObject({ kind: 'test.claim', payload: { text: 'other' } });
        tx.linkRef({ from: { kind: 'revision-ref', oid: b, revision: 1 }, to: { kind: 'revision-ref', oid: a, revision: 2 }, role: 'supports', required: true });
        return { a, b };
      });
      w.uow(ALICE, (tx) => { facets.write(tx, a, { calibration: 'C-1' }); });
      w.uow(ALICE, (tx) => { facets.write(tx, a, { calibration: 'C-2' }); });

      // 拆包（同 ns）→ 移交 → 禁用 → 再启用
      w.transferCapability(CAP_OBJECT_MODEL, TEST_OBJECT_MODEL_SPLIT, ADMIN);
      w.unloadCapability(CAP_OBJECT_MODEL, ADMIN);
      w.loadCapability(CAP_OBJECT_MODEL, ADMIN);

      expect(w.readObject(a)!.oid).toBe(a);                       // ObjectID 不变
      expect(w.readObject(a)!.revision).toBe(2);                  // Revision 线未断
      expect(w.readRevision({ kind: 'revision-ref', oid: a, revision: 1 })!.payload.text).toBe('claim'); // 精确引用仍读到旧内容
      expect(facets.read(a).version).toBe(2);                     // Facet 版本自洽
      expect(facets.read(a).payload.calibration).toBe('C-2');
      const r3 = w.uow(ALICE, (tx) => tx.revise(a, { payload: { text: 'claim-v3' }, expectedRevision: 2 }));
      expect(r3).toBe(3);                                         // 写路径仍自洽（含 required ref 校验通过）
      expect(w.readObject(b)!.revision).toBe(1);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('disabled period: read surfaces must agree — snapshot read is refused while dual-time read silently serves the same object', () => {
    const { dir, w } = world('evolution-life-disabled-');
    try {
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'x' } }));
      // 锚点：启用时双时间读面给数据
      expect(dualTimeRead(w).rows.some((r) => r.oid === oid)).toBe(true);

      w.unloadCapability(CAP_OBJECT_MODEL, ADMIN);
      let snapshotRefused: unknown;
      try { w.readObject(oid); } catch (e) { snapshotRefused = e; }
      expect(snapshotRefused, '锚点：禁用期快照读面应当被拒（当前机制行为）').toBeDefined();

      const rows = dualTimeRead(w).rows.filter((r) => r.oid === oid);
      // CP-6/F-03：读写共用同一条 routeNs 判据 ⇒ 一个读面拒绝的可见性，
      // 另一个读面不得静默地给出数据（禁用期"旧 revision 是否可读"必须是机制的统一答案）。
      expect(
        rows.length,
        `快照读面被拒（${String((snapshotRefused as { code?: string })?.code ?? snapshotRefused)}），而双时间读面仍返回该对象 ${rows.length} 行` +
          '：readAsOf 不经过 routeNs，同一对象在禁用期得到"不可用"与"可用"两个矛盾答案',
      ).toBe(0);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('ns drift: SCHEMA_INCOMPATIBLE on the snapshot surface must not leak data through the dual-time surface (CP-6/F-03)', () => {
    const { dir, w } = world('evolution-life-drift-');
    try {
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'x' } }));
      w.transferCapability(CAP_OBJECT_MODEL, RENAMED_NS, ADMIN); // 换包未迁移 ns
      let snapshotRefused: unknown;
      try { w.readObject(oid); } catch (e) { snapshotRefused = e; }
      expect(String((snapshotRefused as { code?: string })?.code ?? snapshotRefused), '锚点：漂移后快照读面 fail-loud（p2-drift 已证）')
        .toMatch(/SCHEMA_INCOMPATIBLE/);

      const rows = dualTimeRead(w).rows.filter((r) => r.oid === oid);
      // F-03 的修复声明是"读写共用同一条 routeNs 判据"——双时间读面绕过了这条判据：
      // 旧 ns 的 payload（形状归属旧实现）被原样交给当前读者。
      expect(
        rows.length,
        `快照/精确读面报 SCHEMA_INCOMPATIBLE，双时间读面仍返回 ${rows.length} 行旧 ns payload：` +
          'readAsOf（read-context.ts）完全不引用 registry/routeNs/capability',
      ).toBe(0);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('re-enable must restore the PERSISTED owner, not the merely-loaded manifest (F-01: persistent route is the authority)', () => {
    const { dir, w } = world('evolution-life-owner-'); // 加载清单只有原始包
    try {
      w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'x' } }));
      w.transferCapability(CAP_OBJECT_MODEL, TEST_OBJECT_MODEL_SPLIT, ADMIN); // 持久所有者 = split 包
      const persistedAfterTransfer = w.raw.get<{ plugin_id: string }>(
        `select plugin_id from capability_route where capability=?`, CAP_OBJECT_MODEL)!.plugin_id;
      expect(persistedAfterTransfer).toBe('test.object-model.split');

      w.unloadCapability(CAP_OBJECT_MODEL, ADMIN);
      w.loadCapability(CAP_OBJECT_MODEL, ADMIN);

      const persisted = w.raw.get<{ plugin_id: string }>(
        `select plugin_id from capability_route where capability=?`, CAP_OBJECT_MODEL)!.plugin_id;
      const inMemory = w.kernel.registry.capability(CAP_OBJECT_MODEL)?.pluginId;
      // F-01：所有者是空间状态，持久路由是权威；激活时以持久路由覆盖内存视图。
      // 再启用走的是另一条路径（从加载 manifest 恢复）⇒ 进程内所有者与 DB 所有者背离，
      // 重启后"悄悄换人"，而 ledger 里没有任何新的移交登记。
      expect(
        inMemory,
        `再启用后内存所有者=${JSON.stringify(inMemory)}，持久所有者=${JSON.stringify(persisted)}：` +
          'setRouteEnabled(true) 从加载的 manifest 恢复而非持久路由行',
      ).toBe(persisted);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
