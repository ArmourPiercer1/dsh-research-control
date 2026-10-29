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
import { asSpaceId, Refusal } from '../../src/contracts/index.ts';

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
    // 两个候选包都装载（p2-identity 惯例）：持久所有者移交后必须仍在可装配集合内
    const { dir, w } = world('evolution-life-guard-', [TEST_OBJECT_MODEL, TEST_OBJECT_MODEL_SPLIT, TEST_FACET_CALIB]);
    try {
      // 夹具装配更新（非断言变更）：F-23 之后领域只接窄面 PluginFace，
      // 构造参数由 Kernel 改为 w.kernel.faceFor(...)。断言一条未动。
      const facets = new FacetStore(w.kernel.faceFor(CAP_FACET));
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

  test('disabled period: capability-excluded rows must not be indistinguishable from "object never existed" (C12: 空结果≠¬P)', () => {
    // 同一截点下两个世界的双时间读数必须可区分：
    //  A：对象存在但能力被禁用（行因能力状态被剔除）
    //  B：对象从未存在
    // 若两者结果（含 echo）深度相等，调用者无法把"禁用期被剔除"读成"从未登记"。
    const dirA = mkdtempSync(join(POC_DATA_DIR, 'evolution-life-excl-a-'));
    const wA = openWorld({ file: join(dirA, 'a.db'), space: SPACE, grants: GRANTS });
    const dirB = mkdtempSync(join(POC_DATA_DIR, 'evolution-life-excl-b-'));
    const wB = openWorld({ file: join(dirB, 'b.db'), space: SPACE, grants: GRANTS });
    try {
      wA.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'x' } }));
      wA.unloadCapability(CAP_OBJECT_MODEL, ADMIN);
      const readA = readAsOf(wA.kernel, { space: asSpaceId(SPACE), principal: ALICE, mode: 'as-recorded', recordedAsOf: 1, consistency: 'required' });
      const readB = readAsOf(wB.kernel, { space: asSpaceId(SPACE), principal: ALICE, mode: 'as-recorded', recordedAsOf: 1, consistency: 'required' });
      expect(readA.rows.length).toBe(0);
      expect(readB.rows.length).toBe(0);
      const same = JSON.stringify(readA.echo) === JSON.stringify(readB.echo) && JSON.stringify(readA.rows) === JSON.stringify(readB.rows);
      expect(
        same,
        `禁用剔除的结果与"从未存在"的结果深度相等（echo=${JSON.stringify(readA.echo)}）：` +
          'C12/T-05 要求截断与剔除必须显式标注，历史重建面不得把能力状态造成的空洞留成静默空集',
      ).toBe(false);
    } finally {
      wA.close(); wB.close();
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
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

      // F-03 的修复声明是"读写共用同一条 routeNs 判据"——双时间读面必须给出同形答案：
      // 要么抛出 SCHEMA_INCOMPATIBLE，要么不返回旧 ns 的行；两者都不发生（静默端数据）即违例。
      let dualRead: unknown;
      try { dualRead = dualTimeRead(w); } catch (e) { dualRead = e; }
      if (dualRead instanceof Error) {
        expect(String(dualRead.code ?? dualRead.message), '双时间面要么拒答（同形 SCHEMA_INCOMPATIBLE），要么不端数据')
          .toMatch(/SCHEMA_INCOMPATIBLE/);
      } else {
        const rows = (dualRead as { rows: Array<{ oid: string }> }).rows.filter((r) => r.oid === oid);
        expect(
          rows.length,
          `快照/精确读面报 SCHEMA_INCOMPATIBLE，双时间读面仍返回 ${rows.length} 行旧 ns payload：` +
            'readAsOf 不引用 registry/routeNs/capability',
        ).toBe(0);
      }
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
      let loadError: unknown;
      try { w.loadCapability(CAP_OBJECT_MODEL, ADMIN); } catch (e) { loadError = e; }

      const persisted = w.raw.get<{ plugin_id: string }>(
        `select plugin_id from capability_route where capability=?`, CAP_OBJECT_MODEL)!.plugin_id;
      const inMemory = w.kernel.registry.capability(CAP_OBJECT_MODEL)?.pluginId;
      // F-01：所有者是空间状态，持久路由是权威。再启用必须是**可判定**的：
      // 要么把内存所有者恢复为持久所有者，要么以封闭集里的机制码明确拒绝——
      // 不得"从加载清单里挑一个别的包悄悄顶替"（那等于无声的权限转移，
      // 且 ledger 里没有任何新的移交登记，重启后却换了人）。
      if (loadError === undefined) {
        expect(
          inMemory,
          `再启用后内存所有者=${JSON.stringify(inMemory)}，持久所有者=${JSON.stringify(persisted)}：` +
            'setRouteEnabled(true) 从加载的 manifest 恢复而非持久路由行',
        ).toBe(persisted);
      } else {
        expect(loadError, `拒绝再启用必须是封闭集机制码，实际是 ${String(loadError)}`).toBeInstanceOf(Refusal);
        expect((loadError as Refusal).code).toBe('ACTIVATION_IMPOSSIBLE');
      }
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
