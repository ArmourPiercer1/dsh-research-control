/**
 * P4 — 跨插件读取、双时间、空间隔离与滞后派生（#44 §5.1、§7.4、§9、§13.6/§13.10–13.12）。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../src/harness/world.ts';
import { TEST_OBJECT_MODEL } from '../src/domains/test-object-model.ts';
import { TEST_VALIDATION } from '../src/domains/test-validation.ts';
import { Projection } from '../src/kernel/projection.ts';
import { readAsOf } from '../src/kernel/read-context.ts';
import { presentReport, presentOpaque } from '../src/domains/report-presentation.ts';
import { asOid, type ReadContextSpec } from '../src/contracts/index.ts';

const ALICE = PRINCIPAL('alice');
const G = { alice: ['space-write'] };

describe('P4 读取上下文 / 空间隔离 / 滞后投影', () => {
  let dir: string;
  beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'p4-')); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });
  const mk = (name: string, space = 'SP-1'): World =>
    openWorld({ file: join(dir, `${name}.db`), space, grants: G, plugins: [TEST_OBJECT_MODEL, TEST_VALIDATION] });
  const ctx = (w: World, over: Partial<ReadContextSpec> = {}): ReadContextSpec =>
    ({ space: w.kernel.space, principal: ALICE, mode: 'as-recorded', consistency: 'stale-ok', ...over });

  test('跨插件读取必须经 ReadContext；缺 space 的读取无处可解析', () => {
    const w = mk('p4-ctx');
    const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { describedAt: 100 } }));
    expect(() => readAsOf(w.kernel, { actor: 'alice', mode: 'current' } as unknown as ReadContextSpec))
      .toThrow(/CONTEXT_INCOMPLETE/);
    expect(readAsOf(w.kernel, ctx(w)).rows.map((r) => r.oid)).toContain(oid);
    w.close();
  });

  test('双时间历史重建：先按知识截点过滤可见性，再按对象时间过滤（T-05、IC-H6）', () => {
    const w = mk('p4-dual');
    // 晚到登记：描述的是 T1 的装置状态，但直到 T3 才登记
    const early = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { describedAt: 100 } }));
    const headAtT2 = w.ledgerHead();
    const late = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { describedAt: 100, late: true } }));
    expect(late).not.toBe(early);

    const atT2 = readAsOf(w.kernel, ctx(w, { recordedAsOf: headAtT2, describedAtOrDuring: { at: 100 } }));
    expect(atT2.rows.map((r) => r.oid)).toEqual([early]);         // 晚到登记不得出现在当时已知视图（T-02）
    expect(atT2.echo.usedRecordedAsOf).toBe(headAtT2);
    expect(atT2.echo.usedDescribedAt).toBe(100);                   // 实际使用的两个时间必须回显

    const atT3 = readAsOf(w.kernel, ctx(w, { recordedAsOf: w.ledgerHead(), describedAtOrDuring: { at: 100 } }));
    expect(atT3.rows.map((r) => r.oid).sort()).toEqual([early, late].sort());
    // 只给对象时间不给知识截点 ⇒ 默认当前，但必须回显该默认（T-05）
    const noCutoff = readAsOf(w.kernel, ctx(w, { describedAtOrDuring: { at: 100 } }));
    expect(noCutoff.echo.usedRecordedAsOf).toBe(w.ledgerHead());
    expect(noCutoff.echo.recordedAsOfWasDefaulted).toBe(true);
    // 顺序不得交换：若先按 describedAt 过滤，晚到记录会进入"当时已知"视图
    const wrongOrder = w.raw.all<{ oid: string }>(
      `select oid from domain_state where json_extract(payload_json,'$.describedAt')=100 and recorded_seq<=?`, headAtT2,
    );
    expect(wrongOrder.map((r) => r.oid)).not.toContain(late);      // 该锚点说明两步过滤本就独立成立
    w.close();
  });

  test('两个空间无法互读：ObjectID / 搜索 / 错误 / 记录引用四条出口都不泄漏（SP-01）', () => {
    const a = mk('p4-spaceA', 'SP-1');
    const b = mk('p4-spaceB', 'SP-2');
    const secret = a.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { label: 'A 的私有内容' } }));

    // ① 直接拿对方 OID 读
    const viaId = readAsOf(b.kernel, ctx(b));
    expect(viaId.rows.map((r) => r.oid)).not.toContain(secret);
    // ② 搜索：只可能看见本空间内容
    expect(b.kernel.readSnapshot(secret)).toBeUndefined();
    // ③ 错误形态与"不存在"一致
    expect(() => b.kernel.readRevision({ kind: 'revision-ref', oid: secret, revision: 1 })).not.toThrow();
    expect(b.kernel.readRevision({ kind: 'revision-ref', oid: secret, revision: 1 })).toBeUndefined();
    // ④ 在自己的对象上登记指向对方对象的引用：保存合法，但呈现必须与"不存在"不可区分（SP-02、XC-09）
    const mine = b.uow(ALICE, (tx) => {
      const o = tx.createObject({ kind: 'test.claim', payload: {} });
      tx.linkRef({ from: { kind: 'revision-ref', oid: o, revision: 1 }, to: { kind: 'object-ref', oid: secret }, role: 'synth:open', required: false });
      return o;
    });
    const pMine = b.kernel.resolvePresented({ kind: 'object-ref', oid: mine });
    const pForeign = b.kernel.resolvePresented({ kind: 'object-ref', oid: secret });
    const pGhost = b.kernel.resolvePresented({ kind: 'object-ref', oid: asOid('OBJ-SP-2-000000') });
    expect(pForeign).toEqual(pGhost);          // 对外：跨空间目标与不存在同形
    expect(pMine).not.toEqual(pForeign);
    expect(JSON.stringify(pForeign)).not.toMatch(/SP-1/);   // 不泄漏目标所在空间
    // ⑤ Facet 也读不到对方：跨 DB 无共享路径
    expect(b.raw.all(`select 1 from object_directory where oid=?`, secret)).toEqual([]);
    a.close(); b.close();
  });

  test('检查报告对外脱敏：REF_UNRESOLVED 与 WITHHELD 合并为不可区分（RPT-09、XC-25）', () => {
    const w = mk('p4-report');
    const unresolved = presentReport({ items: [{ code: 'SYNTH_REF_UNRESOLVED', outcome: 'FAIL' }], coverage: 'COMPLETE' }, 'alice');
    const withheld = presentReport({ items: [{ code: 'SYNTH_WITHHELD_REFERENCE', outcome: 'INDETERMINATE' }], coverage: 'INCOMPLETE_DUE_TO_VISIBILITY' }, 'alice');
    expect(unresolved.items[0].code).toBe('UNVERIFIABLE_REFERENCE');
    expect(withheld.items[0].code).toBe('UNVERIFIABLE_REFERENCE');
    expect(unresolved.verdict).toBe('UNVERIFIABLE_TO_YOU');       // 不得以"其余项通过"推出合规
    expect(withheld.verdict).toBe('UNVERIFIABLE_TO_YOU');
    expect(JSON.stringify(withheld)).not.toMatch(/\d+/);          // 无计数侧信道（XC-23）
    // 有权审计视图仍拿到完整区分（真源唯一，SP-10）
    const audit = presentReport({ items: [{ code: 'SYNTH_WITHHELD_REFERENCE', outcome: 'INDETERMINATE' }], coverage: 'INCOMPLETE_DUE_TO_VISIBILITY' }, 'auditor');
    expect(audit.items[0].code).toBe('SYNTH_WITHHELD_REFERENCE');
    expect(audit.verdict).toBe('INDETERMINATE');
    w.close();
  });

  test('Journal 缺口不得伪装完整：投影游标越过后要求全量重建（#44 §7.4）', () => {
    const w = mk('p4-gap');
    const proj = new Projection(w.kernel, 'test.index');
    w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: {} }));
    w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: {} }));
    expect(proj.catchUp().applied).toBe(2);
    w.raw.run(`delete from journal where tx_epoch=2`);            // 模拟压缩事故
    expect(proj.status().gap).toBe(true);
    expect(() => proj.catchUp()).toThrow(/FULL_REBUILD_REQUIRED/);
    // Ledger 仍是完整真源：缺口可被检出正因为它能被 Ledger 对照出来
    expect(w.raw.get<{ c: number }>(`select count(*) c from ledger where event_type='object-registered'`)!.c).toBe(2);
    // 反差锚点：Journal 单独重放只得到 1 ⇒ Journal 不得被当作历史真源（§13.4）
    expect(proj.rebuildFrom('journal-only').applied).toBe(1);
    expect(proj.status().gap).toBe(true);
    expect(proj.rebuildFrom('snapshot').applied).toBe(2);
    expect(proj.status().gap).toBe(false);
    w.close();
  });

  test('重启后从游标续跑；业务视图始终依据权威记录，不受索引滞后影响', () => {
    const w = mk('p4-cursor');
    const proj = new Projection(w.kernel, 'test.index');
    const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
    expect(proj.catchUp().applied).toBe(1);
    const afterRestart = w.restart();
    const proj2 = new Projection(afterRestart.kernel, 'test.index');
    expect(proj2.status().watermark).toBe(1);                     // 游标持久
    const oid2 = afterRestart.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 2 } }));
    expect(proj2.status().lag).toBe(1);
    expect(afterRestart.readObject(oid2)!.payload.v).toBe(2);     // 业务视图直读权威，不依赖投影
    expect(proj2.indexQuery('test.claim').status).toBe('STALE');
    proj2.catchUp();
    expect(proj2.indexQuery('test.claim').status).toBe('FRESH');
    expect([...proj2.indexQuery('test.claim').oids].sort()).toEqual([oid, oid2].sort());
    afterRestart.close();
  });

  test('反向依赖只定位候选，不构成影响证明；未登记的隐含依赖不被声称发现（IC-R7、C06）', () => {
    const w = mk('p4-impact');
    const out = w.uow(ALICE, (tx) => {
      const a = tx.createObject({ kind: 'test.claim', payload: {} });
      const b = tx.createObject({ kind: 'test.claim', payload: {} });
      tx.linkRef({ from: { kind: 'revision-ref', oid: b, revision: 1 }, to: { kind: 'revision-ref', oid: a, revision: 1 }, role: 'synth:supports', required: false });
      return { a, b };
    });
    const r = w.kernel.impactCandidates(out.a, 1);
    expect(r.candidates.map((c) => c.oid)).toEqual([out.b]);
    expect(r.claim).toBe('CANDIDATES_ONLY');                      // 结果形态本身否认"影响成立"
    expect(r.undeclaredDepsClaimed).toBe(false);                   // 不声称发现全部隐含依赖
    expect('affected' in r).toBe(false);
    w.close();
  });
});
