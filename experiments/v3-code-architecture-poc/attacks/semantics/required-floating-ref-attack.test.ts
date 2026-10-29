/**
 * 语义组合攻击（独立审查员）— S-4：硬完整性槽位接受浮动引用（精确性未强制）
 *
 * 被违反的契约：
 *  - ID-05：「形式化声明必须用精确引用；浮动引用禁止出现在形式化位置」；
 *  - RF-02：硬业务完整性引用必须在事务内"确实存在"；
 *  - XC-05：「评估对象写成"该命题的最新版本"」⇒ 评估随修订漂移。
 *
 * 现状（缺陷）：`linkRef` 的 `to` 接受任意 AnyRef，`required: true` 只是校验开关；
 * `checkRequiredRefs` 对 to_rev=NULL（即 object-ref）只验 oid 存在，不验精确性。
 * 于是「硬槽位 + 浮动目标」可以提交：提交后目标每修订一次，这条"硬"引用就静默覆盖新修订——
 * 机制层无法区分"有意跟随当前"与"本应钉死却写成了浮动"（这正是 XC-05 的形状）。
 * 阶段 D 第 1 轮 F-12 修的是 revision-ref 指向不存在修订的情形；object-ref 的浮动形态仍开着。
 *
 * 本文件断言的是**当前（有缺陷的）行为**——今天通过，修复后应变红：
 * 最小机制修复（不引入科研语义）：`required: true` 的引用必须是**精确引用**
 *  （revision-ref 或 record-ref）；object-ref + required ⇒ Refusal（新增机制码，如
 *  HARD_REF_NOT_PINNED——形状拒绝而非存在性拒绝，不涉及跨空间存在性泄漏的封闭集条款；
 *  理由：硬引用的提交期校验若指向浮动目标，其成立与否随时间改变，违背"事务内确实存在"
 *  这一机制自身不变量的时间确定性）。是否"形式化"由领域通过 required 声明，
 *  Kernel 只执行"声明为硬的引用必须钉死"这条引用完整性规则。
 * 回归测试：本文件即攻击证据（修复后"浮动硬引用"必须被拒；反差锚点不变）。
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../../src/harness/world.ts';

const ALICE = PRINCIPAL('alice');

describe('S-4 required=true 接受 object-ref（浮动硬引用）', () => {
  test('硬槽位 + 浮动目标可提交，且随目标修订静默漂移', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'sem-float-'));
    const w = openWorld({ file: join(dir, 'attack.db'), space: 'SP-SEM-4', grants: { alice: ['space-write'] } });
    try {
      const a = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      const b = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));

      // 当前（缺陷）：required=1 + to=object-ref（to_rev 落 NULL）提交成功。
      expect(() => w.uow(ALICE, (tx) =>
        tx.linkRef({
          from: { kind: 'revision-ref', oid: a, revision: 1 },
          to: { kind: 'object-ref', oid: b },
          role: 'evaluates', required: true,
        }),
      )).not.toThrow();
      const edge = w.raw.get<{ to_oid: string | null; to_rev: number | null; required: number }>(
        `select to_oid, to_rev, required from ref_edge where from_oid=? and role=?`, a, 'evaluates',
      );
      expect(edge?.to_rev).toBeNull();   // 浮动
      expect(edge?.required).toBe(1);    // 硬

      // 目标修订一次 ⇒ "硬"引用静默指向新修订，无重校验、无事件、无提示：
      w.uow(ALICE, (tx) => tx.revise(b, { payload: { v: 2 } }));
      const after = w.raw.get<{ to_rev: number | null }>(
        `select to_rev from ref_edge where from_oid=? and role=?`, a, 'evaluates',
      );
      expect(after?.to_rev).toBeNull(); // 仍是浮动：现在覆盖 rev2
      expect(w.readObject(b)?.revision).toBe(2);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('反差锚点：required + 幽灵 object-ref 仍被拒（校验只到存在性，不到精确性）', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'sem-float-anchor-'));
    const w = openWorld({ file: join(dir, 'attack.db'), space: 'SP-SEM-4B', grants: { alice: ['space-write'] } });
    try {
      const a = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      expect(() => w.uow(ALICE, (tx) =>
        tx.linkRef({
          from: { kind: 'revision-ref', oid: a, revision: 1 },
          to: { kind: 'object-ref', oid: 'OBJ-GHOST' },
          role: 'evaluates', required: true,
        }),
      )).toThrow(/REQUIRED_REF_MISSING/);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
