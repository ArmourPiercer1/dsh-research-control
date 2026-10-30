/**
 * 语义组合攻击（独立审查员）— S-2：T-05/XC-24 双时间读取里，Kernel 硬编码的 payload 键名
 * 会制造「空结果被读成不存在」（C12/CS-24）——而且空结果由 Kernel 自己的读路径产生。
 *
 * 被违反/被架空的情形：
 *  - T-05/XC-24：recorded_as_of 与对象时间两个条件相互独立；缺省截点必须回显；
 *  - C12/CS-24：空结果 ≠ ¬P；部分结果必须带边界标注；
 *  - N-01：「字段名是领域读名，不是冻结的 Schema 键名或数据库列名；落地命名由后续 Schema 设计决定」，
 *    而 CC-01 的契约字段名叫 `described_interval`。
 *
 * 现状（缺陷）：`readAsOf` 的对象时间过滤硬编码读取 `payload.describedAt`（read-context.ts:53）。
 * 领域若按契约自己的命名（或任何别的落地命名）写对象时间，`at:`/`during:` 查询会**静默返回空行**：
 *  无错误、无警告、无边界标注，`echo.truncated=false / moreRows=false`，`usedDescribedAt` 照常回显——
 *  调用方只能把空结果读成"该时间不存在该对象"。read-context.ts 的注释自称
 *  「Kernel 只执行谓词，不解释对象时间的科研含义」，但它**知道键名**——键名即约定，而约定没有在
 *  契约类型里声明（payload 是 unknown）。
 *
 * 本文件断言的是**当前（有缺陷的）行为**——今天通过，修复后应变红：
 * 最小机制修复（不引入科研语义，两种可取其一或并用）：
 *  ① fail-loud：当请求带 describedAtOrDuring 而可见集中**没有任何一行**带顶层数字 describedAt 时，
 *     echo 增加 `timeFieldMissing: true`（或抛 CONTEXT_INCOMPLETE{missing:'describedAt predicate'}）；
 *     「谓词字段在全部可见行中缺失」是形状检查，不是语义判定；
 *  ② 让对象时间访问器可注册：manifest 按 kind 声明对象时间取值器（与 ownsKinds 同型的机制注册），
 *     Kernel 不内置任何键名。
 * 回归测试：本文件即攻击证据（修复后"合同命名得到空结果"必须失败或带标注）。
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../../src/harness/world.ts';
import { readAsOf } from '../../src/kernel/read-context.ts';
import type { ReadContextSpec } from '../../src/contracts/index.ts';

const ALICE = PRINCIPAL('alice');

describe('S-2 双时间读取硬编码 describedAt 键名 ⇒ 合法命名静默变空', () => {
  test('领域按 CC-01 的字段名 described_interval 落地 ⇒ at: 查询静默返回空', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'sem-dat-'));
    const w = openWorld({ file: join(dir, 'attack.db'), space: 'SP-SEM-2', grants: { alice: ['space-write'] } });
    try {
      const byContractName = w.uow(ALICE, (tx) =>
        tx.createObject({ kind: 'test.claim', payload: { label: 'X', described_interval: 100 } }),
      );
      const head = w.ledgerHead();
      const ctx: ReadContextSpec = {
        space: 'SP-SEM-2', principal: ALICE, mode: 'as-recorded',
        recordedAsOf: head, describedAtOrDuring: { at: 100 }, consistency: 'stale-ok',
      };

      const res = readAsOf(w.kernel, ctx, { limit: 10 });
      // 当前（缺陷）行为：对象明明登记在对象时间 100，查询却"不存在"。
      expect(res.rows).toEqual([]);
      expect(res.echo.truncated).toBe(false);   // 无部分标注
      expect(res.echo.moreRows).toBe(false);    // 无"还有更多"
      expect(res.echo.usedDescribedAt).toBe(100); // 谓词照常回显，调用方无从怀疑
      expect(byContractName).toBeDefined();      // 对象确实存在（反差锚点）
      expect(w.readObject(byContractName)?.payload.described_interval).toBe(100);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('反差锚点：同一查询换成硬编码键名 describedAt ⇒ 有结果（证明差异只来自键名）', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'sem-dat-anchor-'));
    const w = openWorld({ file: join(dir, 'attack.db'), space: 'SP-SEM-2B', grants: { alice: ['space-write'] } });
    try {
      const oid = w.uow(ALICE, (tx) =>
        tx.createObject({ kind: 'test.claim', payload: { label: 'X', describedAt: 100 } }),
      );
      const head = w.ledgerHead();
      const ctx: ReadContextSpec = {
        space: 'SP-SEM-2B', principal: ALICE, mode: 'as-recorded',
        recordedAsOf: head, describedAtOrDuring: { at: 100 }, consistency: 'stale-ok',
      };
      const res = readAsOf(w.kernel, ctx, { limit: 10 });
      expect(res.rows.map((r) => r.oid)).toEqual([oid]);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('during: 查询同样静默变空（键名不匹配 ⇒ 整个区间"无对象"）', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'sem-dat-during-'));
    const w = openWorld({ file: join(dir, 'attack.db'), space: 'SP-SEM-2C', grants: { alice: ['space-write'] } });
    try {
      const oid = w.uow(ALICE, (tx) =>
        tx.createObject({ kind: 'test.claim', payload: { described_interval: 100 } }),
      );
      const head = w.ledgerHead();
      const res = readAsOf(w.kernel, {
        space: 'SP-SEM-2C', principal: ALICE, mode: 'as-recorded',
        recordedAsOf: head, describedAtOrDuring: { during: [50, 150] }, consistency: 'stale-ok',
      }, { limit: 10 });
      expect(res.rows).toEqual([]);
      expect(oid).toBeDefined();
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
