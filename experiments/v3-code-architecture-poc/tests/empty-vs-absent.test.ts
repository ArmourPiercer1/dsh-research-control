/**
 * 「空集」的三种成因必须互相可区分（F-24 残余 / S-2，均 P1）。
 *
 * C12/T-05 的形状要求是：**空结果不得被读成"没有"**。此前两条静默路径：
 *  ① 能力被禁用 ⇒ 扫描面把该行剔除，结果与"对象从未存在"逐字节相同；
 *  ② 对象时间不叫 `describedAt`（契约允许领域自己命名）⇒ Kernel 自己的谓词端出空集，
 *     `truncated/moreRows` 均为 false，`usedDescribedAt` 照常回显 ⇒ "区间内没有"。
 * 两条都属于本项目最不能留给 V3 的缺陷形态：把不可判定当成否定。
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../src/harness/world.ts';
import { readAsOf } from '../src/kernel/read-context.ts';
import type { CommitSequence, ReadContextSpec } from '../src/contracts/index.ts';
import { TEST_OBJECT_MODEL, CAP_OBJECT_MODEL } from '../src/domains/test-object-model.ts';

const ADMIN = PRINCIPAL('empty-absent-admin');
const GRANTS = { 'empty-absent-admin': ['space-write', 'capability-admin'] };

const ctx = (w: World, over: Partial<ReadContextSpec> = {}): ReadContextSpec => ({
  space: w.kernel.space, principal: ADMIN, mode: 'as-recorded', consistency: 'required', ...over,
});

function mk(name: string): World {
  const dir = mkdtempSync(join(POC_DATA_DIR, `ea-${name}-`));
  return openWorld({ file: join(dir, 'space.db'), space: 'SP-EA', grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
}

describe('空结果的第二种成因不得伪装成"没有对象"', () => {
  test('能力被禁用 ⇒ 空行 + 计数>0；启用时计数为 0（与"从未存在"可区分）', () => {
    const w = mk('disabled');
    try {
      w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { describedAt: 100 } }));
      const before = readAsOf(w.kernel, ctx(w));
      expect(before.rows.length).toBeGreaterThan(0);
      expect(before.echo.hiddenByInactiveCapability).toBe(0);

      w.kernel.setRouteEnabled(CAP_OBJECT_MODEL, false, ADMIN);
      const during = readAsOf(w.kernel, ctx(w));
      expect(during.rows).toEqual([]);                                   // 禁用期不端出对象（F-24）
      expect(during.echo.hiddenByInactiveCapability).toBeGreaterThan(0); // 但不许说成"没有对象"

      // 反差：与"这个空间本来就什么都没有"对照——那条路径的计数必须是 0
      const empty = mk('pristine');
      try {
        const none = readAsOf(empty.kernel, ctx(empty));
        expect(none.rows).toEqual([]);
        expect(none.echo.hiddenByInactiveCapability).toBe(0);
      } finally { empty.close(); }
    } finally { w.close(); }
  });

  test('对象时间换了键名 ⇒ 空集必须声明形状缺失，而不是伪装区间无值', () => {
    const w = mk('keyname');
    try {
      // 契约允许领域自命名时间（CC-01 的 described_interval）；Kernel 只认形状
      w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { described_interval: 100 } }));
      const miss = readAsOf(w.kernel, ctx(w, { describedAtOrDuring: { at: 100 } }));
      expect(miss.rows).toEqual([]);
      expect(miss.echo.timeFieldMissing).toBe(true);   // "查不到" ≠ "没有"：形状缺失被显式声明
      expect(miss.echo.truncated).toBe(false);

      // 反差 ①：同一谓词、正确键名 ⇒ 命中且 timeFieldMissing=false
      const w2 = mk('keyname-ok');
      try {
        w2.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { describedAt: 100 } }));
        const hit = readAsOf(w2.kernel, ctx(w2, { describedAtOrDuring: { at: 100 } }));
        expect(hit.rows.length).toBe(1);
        expect(hit.echo.timeFieldMissing).toBe(false);
      } finally { w2.close(); }

      // 反差 ②：可见集本身为空（截点早于一切）⇒ 形状缺失不适用，不得乱报
      const w3 = mk('keyname-empty');
      try {
        w3.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { described_interval: 100 } }));
        // 早于一切的截点：取第一条的 recordedSeq 再退一格（品牌类型只在这里下转，
        // 因为"零号截点"在契约里本就没有具名常量）。
        const first = readAsOf(w3.kernel, ctx(w3)).rows[0]!.recordedSeq;
        const before = (Number(first) - 1) as CommitSequence;
        const none = readAsOf(w3.kernel, ctx(w3, { recordedAsOf: before, describedAtOrDuring: { at: 100 } }));
        expect(none.rows).toEqual([]);
        expect(none.echo.timeFieldMissing).toBe(false);
      } finally { w3.close(); }
    } finally { w.close(); }
  });

  test('无时间谓词时不得报形状缺失（形状判定只服务于时间谓词）', () => {
    const w = mk('no-predicate');
    try {
      w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { described_interval: 100 } }));
      const all = readAsOf(w.kernel, ctx(w));
      expect(all.rows.length).toBe(1);
      expect(all.echo.timeFieldMissing).toBe(false);
    } finally { w.close(); }
  });
});
