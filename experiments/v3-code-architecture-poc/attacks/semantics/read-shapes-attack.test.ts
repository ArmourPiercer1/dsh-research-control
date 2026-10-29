/**
 * 语义组合攻击（独立审查员）— S-9/S-10/S-11：三个 P2 形状缺口
 *
 * S-9（XC-19/DF-08/G-REV/RV-01）：object-revised 的 ledger 行 payload 硬编码 '{}'。
 *   修订的完成依据（G-REV 要求 completion_basis ∈ {SAME_INTENT_CONFIRMED, NEW_JUDGEMENT,
 *   UNDETERMINED}）若要留痕只能写进 domain_state 的 payload——而后续 revise 会**整体替换**
 *   payload ⇒ 依据可被后来的修订抹掉；"按默认填充"（XC-19）与"真实声明"在 H 上不可区分，
 *   而 DF-08 明文：系统无法区分的状态就无法被门禁。
 *   最小机制修复：revise 接受可选 note/annotation 并落进该 ledger 行的 payload_json
 *   （机制中立：存领域声明的修订依据，Kernel 不解码），或文档化"完成依据必须另行
 *   appendLedger"的双记录约定。
 *
 * S-10（T-05/CS-01）：ReadContext 的 principal/consistency/mode 是装饰性字段——
 *   readAsOf 只查存在性、不产生任何行为差异（行级授权、一致性语义均未实现，注释自称"无权限语义"）；
 *   而 head 读路径（readSnapshot/World.readObject）不回显截点 ⇒ T-05"缺省截点必须回显"
 *   在快照读上不成立。
 *   最小机制修复：要么实现（principal 行级授权/consistency 语义），要么从 ReadContextSpec
 *   移除未实现字段并给 ObjectSnapshot 增加 cutoff 回显（读参数实际值，机制中立）。
 *
 * S-11（C06/C10/CS-15/CS-18）：impactCandidates 只匹配 to_rev=revision 的边——
 *   object-ref（to_rev NULL）与 record-ref 的入边全部不可见 ⇒ 对合法引用形态静默返回空，
 *   调用方只能把空读成"无依赖"；且 role 是自由字符串，"证明依赖"与"普通提及"的区分
 *   靠命名约定，无注册、无分类。
 *   最小机制修复：反向查询对 object-ref 边改为 to_oid 匹配且 (to_rev IS NULL OR to_rev=?)
 *   （或显式返回两栏 pinned/floating 候选）；manifest 声明本插件的 role 词表（同 ownsKinds
 *   型的机制注册），linkRef 拒未声明 role。
 *
 * 本文件断言的是**当前（有缺陷的）行为**——今天通过，修复后应变红。
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../../src/harness/world.ts';
import { readAsOf } from '../../src/kernel/read-context.ts';
import type { ReadContextSpec } from '../../src/contracts/index.ts';

const ALICE = PRINCIPAL('alice');
const MALLORY = PRINCIPAL('mallory'); // 无任何授权

function world(prefix: string, space = 'SP-SEM-9') {
  const dir = mkdtempSync(join(POC_DATA_DIR, prefix));
  const w = openWorld({ file: join(dir, 'attack.db'), space, grants: { alice: ['space-write'] } });
  return { dir, w };
}

describe('S-9 修订的 ledger 行不带完成依据载体（payload 恒 "{}"）', () => {
  test('revise 的 ledger 行 payload 为空对象：依据只能落 payload，而 payload 可被下一次 revise 抹掉', () => {
    const { dir, w } = world('sem-rev-ledger-');
    try {
      const a = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { completion_basis: 'SAME_INTENT_CONFIRMED', v: 1 } }));
      // 修订（依据仍只能写在 payload 里）：
      w.uow(ALICE, (tx) => tx.revise(a, { payload: { completion_basis: 'NEW_JUDGEMENT', v: 2 } }));
      const row = w.raw.get<{ payload_json: string }>(
        `select payload_json from ledger where event_type='object-revised' and object_id=? order by seq desc limit 1`, a,
      );
      expect(row?.payload_json).toBe('{}');
      // 再一次 revise 即抹掉上一条的"依据"：
      w.uow(ALICE, (tx) => tx.revise(a, { payload: { v: 3 } }));
      expect(w.readObject(a)?.payload).toEqual({ v: 3 }); // 依据字段消失，H 上无从考证
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('S-10 ReadContext 字段装饰性 + 快照读无截点回显', () => {
  test('principal/consistency/mode 不产生任何行为差异（无授权、无一致性语义）', () => {
    const { dir, w } = world('sem-ctx-');
    try {
      w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      const head = w.ledgerHead();
      const strict: ReadContextSpec = { space: 'SP-SEM-9', principal: ALICE, mode: 'current-snapshot', recordedAsOf: head, consistency: 'required' };
      const lax: ReadContextSpec = { space: 'SP-SEM-9', principal: MALLORY, mode: 'as-recorded', recordedAsOf: head, consistency: 'stale-ok' };
      const rStrict = readAsOf(w.kernel, strict, { limit: 10 });
      const rLax = readAsOf(w.kernel, lax, { limit: 10 });
      // 无授权的 mallory 与"required"一致性下的 alice 得到逐行相同的结果：
      expect(rLax.rows.map((r) => [r.oid, r.revision, r.payload])).toEqual(rStrict.rows.map((r) => [r.oid, r.revision, r.payload]));
      expect(rLax.rows.length).toBeGreaterThan(0);
      // 两个"模式"的差异只存在于 echo 的复读里：
      expect(rStrict.echo.mode).not.toBe(rLax.echo.mode);
      expect(rStrict.echo.recordedAsOfWasDefaulted).toBe(false);
      expect(rLax.echo.recordedAsOfWasDefaulted).toBe(false);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('快照读（World.readObject）不回显其实际使用的截点（T-05 缺省回显缺失）', () => {
    const { dir, w } = world('sem-snap-');
    try {
      const a = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      const snap = w.readObject(a);
      expect(snap).toBeDefined();
      // T-05：任何读结果都应回显实际使用的截点与是否采用了默认——快照读没有任何 echo 字段：
      expect(Object.keys(snap!).sort()).toEqual(['kind', 'oid', 'payload', 'recordedSeq', 'revision']);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('S-11 impactCandidates 对 object-ref/record-ref 入边静默不可见', () => {
  test('object-ref 入边（to_rev NULL）不进候选；revision-ref 入边进候选 ⇒ 空结果=读成"无依赖"', () => {
    const { dir, w } = world('sem-impact-');
    try {
      const target = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      const floating = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      const pinned = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      w.uow(ALICE, (tx) => {
        tx.linkRef({ from: { kind: 'revision-ref', oid: floating, revision: 1 }, to: { kind: 'object-ref', oid: target }, role: 'supports' });
        tx.linkRef({ from: { kind: 'revision-ref', oid: pinned, revision: 1 }, to: { kind: 'revision-ref', oid: target, revision: 1 }, role: 'supports-pinned' });
      });

      const res = w.kernel.impactCandidates(target, 1);
      expect(res.claim).toBe('CANDIDATES_ONLY');
      expect(res.undeclaredDepsClaimed).toBe(false);
      const ids = res.candidates.map((c) => c.oid).sort();
      // 当前（缺陷）行为：只有钉死的入边可见；object-ref 入边静默缺失：
      expect(ids).toEqual([pinned]);
      // 且 role 自由字符串：两个"支持"边靠命名约定区分，无注册、无分类：
      expect(res.candidates[0].role).toBe('supports-pinned');
      // 对照：浮动入边确实登记在册（不是"没写"，是"看不见"）：
      expect(w.raw.get(`select 1 as x from ref_edge where from_oid=? and role=?`, floating, 'supports')).toBeDefined();
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
