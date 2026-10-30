/**
 * P2 — 对象身份、引用与插件演化（#44 §5.2/§6.1/§6.2/§8.1/§11、§13.1–13.3、§15.1 边界 2）。
 *
 * 验的不是"能建对象"，而是四条会被实现写错的假设：
 *  1. kind/space 创建即固定，且在**存储层**就改不动（RD-01）；
 *  2. 精确引用永不漂移，而导航引用会变——两者若都能漂移，RD-05 的区分就是纸上的；
 *  3. 同事务内循环引用可写入，硬引用缺失整体回滚，软引用允许悬空（#44 §7.3 / C10、RF-02/04）；
 *  4. 换实现/拆包/移交只改 Capability→Plugin 映射，ObjectID 与旧精确引用不变，
 *     且**未迁移就切换必须 fail-loud**，不得静默返回空（#44 §11 / Q44）。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../src/harness/world.ts';
import { TEST_OBJECT_MODEL, TEST_OBJECT_MODEL_SPLIT, CAP_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import { TEST_FACET_CALIB, CAP_FACET, FacetStore } from '../src/domains/test-facet.ts';
import { asOid, type ObjectOid, type RevisionRef } from '../src/contracts/index.ts';

const ALICE = PRINCIPAL('alice');
const GRANTS = { alice: ['space-write', 'capability-admin'] };

describe('P2 身份 / 引用 / 插件演化', () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'p2-')); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });
  const world = (name: string, opts: Partial<Parameters<typeof openWorld>[0]> = {}): World =>
    openWorld({ file: join(dir, `${name}.db`), space: 'SP-1', grants: GRANTS, ...opts });

  test('kind 由注册表路由；未注册 kind 无法创建（Kernel 不解释 kind 语义）', () => {
    const w = world('p2-kind');
    const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
    expect(w.readObject(oid)!.kind).toBe('test.claim');
    expect(() => w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.unregistered', payload: {} })))
      .toThrow(/CAPABILITY_INACTIVE/);
    w.close();
  });

  test('kind / space 固定在存储层：Directory 行改不动（RD-01）', () => {
    const w = world('p2-frozen');
    const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
    expect(() => w.raw.run(`update object_directory set kind='test.subject' where oid=?`, oid))
      .toThrow(/DIRECTORY_IDENTITY_FROZEN/);
    expect(() => w.raw.run(`update object_directory set space='SP-2' where oid=?`, oid))
      .toThrow(/DIRECTORY_IDENTITY_FROZEN/);
    // 反差锚点：同一张表允许 INSERT ⇒ 拒绝针对 UPDATE，不是表只读
    expect(() => w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 2 } }))).not.toThrow();
    w.close();
  });

  test('精确引用读回原内容，导航引用跟随当前（RD-05 的机制基础）', () => {
    const w = world('p2-refs');
    const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
    const rev1: RevisionRef = { kind: 'revision-ref', oid, revision: 1 };
    w.uow(ALICE, (tx) => { tx.revise(oid, { payload: { v: 2 }, expectedRevision: 1 }); });

    const at1 = w.readRevision(rev1)!;
    const latest = w.readObject(oid)!;
    expect(at1.payload.v).toBe(1);       // 旧精确引用永不漂移
    expect(latest.revision).toBe(2);     // 导航"跟随当前"确实会变
    expect(latest.payload.v).toBe(2);
    // 旧 revision 的行仍在，未被覆盖 ⇒ 精确引用不是靠"记住旧值"实现的
    expect(w.raw.get<{ c: number }>(`select count(*) c from domain_state where oid=?`, oid)!.c).toBe(2);
    w.close();
  });

  test('同事务内循环精确引用可写入；循环不自动获得任何证明地位（C10）', () => {
    const w = world('p2-cycle');
    const out = w.uow(ALICE, (tx) => {
      const a = tx.createObject({ kind: 'test.claim', payload: { role: 'a' } });
      const b = tx.createObject({ kind: 'test.claim', payload: { role: 'b' } });
      tx.linkRef({ from: { kind: 'revision-ref', oid: a, revision: 1 }, to: { kind: 'revision-ref', oid: b, revision: 1 }, role: 'supports', required: true });
      tx.linkRef({ from: { kind: 'revision-ref', oid: b, revision: 1 }, to: { kind: 'revision-ref', oid: a, revision: 1 }, role: 'supports', required: true });
      return { a, b };
    });
    expect(w.raw.get<{ c: number }>(`select count(*) c from ref_edge`)!.c).toBe(2);
    // Kernel 层没有任何"环 ⇒ 证明力"的产物；环只是两条普通边。
    expect(w.raw.get<{ c: number }>(`select count(*) c from ledger where event_type like '%proof%'`)!.c).toBe(0);
    expect(out.a).not.toBe(out.b);
    w.close();
  });

  test('硬业务引用缺失整体回滚；开放科研引用允许悬空保存（RF-02/RF-04）', () => {
    const w = world('p2-refs-req');
    const a = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: {} }));
    const ghost = asOid('OBJ-SP-1-999999');

    expect(() => w.uow(ALICE, (tx) => {
      tx.linkRef({ from: { kind: 'revision-ref', oid: a, revision: 1 }, to: { kind: 'object-ref', oid: ghost }, role: 'depends-on', required: true });
    })).toThrow(/REQUIRED_REF_MISSING/);
    expect(w.raw.get<{ c: number }>(`select count(*) c from ref_edge`)!.c).toBe(0); // 回滚，不留半条边

    w.uow(ALICE, (tx) => {
      tx.linkRef({ from: { kind: 'revision-ref', oid: a, revision: 1 }, to: { kind: 'object-ref', oid: ghost }, role: 'open-question', required: false });
    });
    expect(w.raw.get<{ c: number }>(`select count(*) c from ref_edge where required=0`)!.c).toBe(1);
    w.close();
  });

  test('换实现（拆包）后 ObjectID 与旧精确引用不变（Q44）', () => {
    const w = world('p2-split');
    const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 'first' } }));
    const before = w.readObject(oid)!;

    w.transferCapability(CAP_OBJECT_MODEL, TEST_OBJECT_MODEL_SPLIT, ALICE);
    expect(w.kernel.registry.capability(CAP_OBJECT_MODEL)!.pluginId).toBe('test.object-model.split');

    const after = w.readObject(oid)!;
    expect(after.oid).toBe(before.oid);
    expect(after.revision).toBe(before.revision);
    expect(after.payload.v).toBe('first');       // 旧内容仍读得回
    expect(w.readRevision({ kind: 'revision-ref', oid, revision: 1 })!.payload.v).toBe('first');
    // 新写入仍走新实现，且对象身份没变
    const r2 = w.uow(ALICE, (tx) => tx.revise(oid, { payload: { v: 'second' }, expectedRevision: 1 }));
    expect(r2).toBe(2);
    w.close();
  });

  test('移交路由是持久的：重启后仍是新所有者，且失败事务不改路由（Q44 原子性）', () => {
    const w = world('p2-transfer');
    const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: {} }));
    // 失败的移交不得回写内存视图，也不得留下登记：这里用"缺运维权威"制造失败，
    // 顺带钉住移交属 capability-admin 轴而非空间写权（SP-09）。
    const OUTSIDER = { actorId: 'carol', verified: true } as const;   // 只有 space-write
    expect(() => w.transferCapability(CAP_OBJECT_MODEL, TEST_OBJECT_MODEL_SPLIT, OUTSIDER)).toThrow(/AUTHORITY_REQUIRED/);
    expect(w.kernel.registry.capability(CAP_OBJECT_MODEL)!.pluginId).toBe('test.object-model');
    expect(w.raw.get<{ c: number }>(`select count(*) c from ledger where event_type='capability-transferred'`)!.c).toBe(0);
    // 反差锚点 + 持久性：授权主体同一调用必须成功，然后重启只看持久性
    w.transferCapability(CAP_OBJECT_MODEL, TEST_OBJECT_MODEL_SPLIT, ALICE);
    expect(w.kernel.registry.capability(CAP_OBJECT_MODEL)!.pluginId).toBe('test.object-model.split');
    const w2 = w.restart();
    expect(w2.kernel.registry.capability(CAP_OBJECT_MODEL)!.pluginId).toBe('test.object-model.split');
    expect(w2.readObject(oid)!.oid).toBe(oid);
    // 移交本身留下了可审计的登记记录
    expect(w2.raw.get<{ c: number }>(`select count(*) c from ledger where event_type='capability-transferred'`)!.c).toBe(1);
    w2.close();
  });

  test('路由 ns 与冻结归属漂移 ⇒ 读路径 fail-loud，绝不静默返回空（#44 §11；漂移形状包 6 起只能界外构造，D-31）', () => {
    const w = world('p2-drift');
    const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
    const RENAMED = { ...TEST_OBJECT_MODEL_SPLIT, storageNamespace: 'dom_test_om_v2' };
    // 包 6（G5-A D-31）翻转：携 ns 的移交在**入口**就被拒——漂移不再能从合法通道构造出来
    expect(() => w.transferCapability(CAP_OBJECT_MODEL, RENAMED, ALICE)).toThrow(/TRANSFER_NS_DRIFT/);
    // #44 §11 的 fail-loud 判据仍然要钉：漂移形状改由界外构造（装配视图被改成与 dir.ns 不符，
    // 等价于裸面改 ns 后重开）——读面对界外漂移依旧拒绝服务，不静默返回空。
    w.kernel.registry.setRoute(CAP_OBJECT_MODEL, {
      capability: CAP_OBJECT_MODEL, pluginId: 'test.object-model.split',
      storageNamespace: 'dom_test_om_v2', contractVersion: 'v1',
    });
    expect(() => w.readObject(oid)).toThrow(/SCHEMA_INCOMPATIBLE/);
    expect(() => w.uow(ALICE, (tx) => tx.revise(oid, { payload: { v: 2 } }))).toThrow(/SCHEMA_INCOMPATIBLE/);
    w.close();
  });

  test('Facet 独立写入 / 版本化 / 卸载：基础对象不受影响（Q45）', () => {
    const w = world('p2-facet', { plugins: [TEST_OBJECT_MODEL, TEST_FACET_CALIB] });
    const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.subject', payload: { serial: 'A1' } }));
    const facets = new FacetStore(w.kernel.faceFor(CAP_FACET));

    w.uow(ALICE, (tx) => facets.write(tx, oid, { calibration: 'C-1' }));
    expect(facets.read(oid)!.payload.calibration).toBe('C-1');
    w.uow(ALICE, (tx) => facets.write(tx, oid, { calibration: 'C-2' }));
    expect(facets.read(oid)!.version).toBe(2);
    expect(w.readObject(oid)!.payload.serial).toBe('A1'); // 核心对象未被 Facet 改写

    // 卸载：不再注册该 Capability ⇒ 扩展能力降级，基础对象仍完整可读
    w.unloadCapability(CAP_FACET, ALICE);
    expect(() => facets.read(oid)).toThrow(/CAPABILITY_INACTIVE/);
    const still = w.readObject(oid)!;
    expect(still.payload.serial).toBe('A1');
    expect(still.revision).toBe(1);
    w.close();
  });

  test('Facet 越权：写别人的命名空间被拒（禁止复制核心权威，XC-28）', () => {
    const w = world('p2-facet-escape', { plugins: [TEST_OBJECT_MODEL, TEST_FACET_CALIB] });
    const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.subject', payload: { serial: 'A1' } }));
    const facets = new FacetStore(w.kernel.faceFor(CAP_FACET));
    expect(() => w.uow(ALICE, (tx) => facets.writeIntoForeignNamespace(tx, oid)))
      .toThrow(/NAMESPACE_ESCAPE/);
    // 反差锚点：同一个 store 写自己的 ns 正常 ⇒ 拒绝针对越权，不是 store 全坏
    w.uow(ALICE, (tx) => facets.write(tx, oid, { calibration: 'ok' }));
    expect(facets.read(oid)!.payload.calibration).toBe('ok');
    w.close();
  });
});
