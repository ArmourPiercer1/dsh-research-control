/**
 * 契约版本偏差在**扫描面**上的失败形态必须可归因（第 12 轮 F-EV-R2 的作者侧回归）。
 *
 * 第 12 轮我改了 `readAsOf` 的语义（剔除版本不符的行 + 回显 `hiddenByContractSkew`），
 * 当时只有演化席位的攻击文件转绿作为证据——**那是审查方的断言，不是作者侧的锁**。
 * 本文件把它钉在作者侧，尤其是"逐行剔除"而非"整页毒化"这一条：
 * 后者会让一行旧形状伪装成"这段时间什么都没有"，正是本项目最禁止的读法。
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../src/harness/world.ts';
import { readAsOf } from '../src/kernel/read-context.ts';
import type { PluginManifest, ReadContextSpec } from '../src/contracts/index.ts';
import { TEST_OBJECT_MODEL, TEST_OBJECT_MODEL_SPLIT, CAP_OBJECT_MODEL } from '../src/domains/test-object-model.ts';

const ADMIN = PRINCIPAL('skew-admin');
const GRANTS = { 'skew-admin': ['space-write', 'capability-admin'] };

/** 同 ns、同 capability，只有契约版本不同 ⇒ 跨所有者移交后产生"行戳 v1 / 路由 v2"的混合库。 */
const SPLIT_V2: PluginManifest = {
  ...TEST_OBJECT_MODEL_SPLIT,
  provides: [{ capability: CAP_OBJECT_MODEL, contractVersion: 'v2' }],
};

const ctx = (w: World): ReadContextSpec => ({
  space: w.kernel.space, principal: ADMIN, mode: 'as-recorded', consistency: 'required',
});

const tmp = (name: string): string => join(mkdtempSync(join(POC_DATA_DIR, `skew-${name}-`)), 'space.db');

/** 先以 v1 建若干对象，再把路由显式移交给 v2 实现，返回文件路径（调用方重开世界）。 */
function buildV1Rows(file: string, count: number): void {
  const w = openWorld({ file, space: 'SP-SKEW', grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
  try {
    w.uow(ADMIN, (tx) => {
      for (let i = 0; i < count; i += 1) tx.createObject({ kind: 'test.claim', payload: { a: i } });
      return null;
    });
    w.transferCapability(CAP_OBJECT_MODEL, SPLIT_V2, ADMIN);
  } finally { w.close(); }
}

describe('扫描面遇契约版本偏差：逐行剔除且必须可归因', () => {
  test('混合版本库重开为 v2 ⇒ v1 行被剔除，且计数把"空"归因到版本偏差（不是"没有对象"）', () => {
    const file = tmp('all-skew');
    buildV1Rows(file, 2);
    const w = openWorld({ file, space: 'SP-SKEW', grants: GRANTS, plugins: [SPLIT_V2] });
    try {
      const r = readAsOf(w.kernel, ctx(w));
      expect(r.rows).toHaveLength(0);
      // 关键：空行必须带得出原因。计数为 0 就等于把"不可判定"伪装成"没有"
      expect(r.echo.hiddenByContractSkew).toBe(2);
    } finally { w.close(); rmSync(file, { force: true }); }
  });

  test('反差：剔除是**逐行**的——同一次扫描里 v2 新行照常端出，不被旧行毒化整页', () => {
    const file = tmp('mixed');
    buildV1Rows(file, 2);
    const w = openWorld({ file, space: 'SP-SKEW', grants: GRANTS, plugins: [SPLIT_V2] });
    try {
      w.uow(ADMIN, (tx) => tx.createObject({ kind: 'test.claim', payload: { a: 99 } }));
      const r = readAsOf(w.kernel, ctx(w));
      expect(r.rows).toHaveLength(1);                       // 只有 v2 那行
      expect(r.rows[0]!.payload.a).toBe(99);
      expect(r.echo.hiddenByContractSkew).toBe(2);          // 旧的两行被剔除，且数得出来
    } finally { w.close(); rmSync(file, { force: true }); }
  });

  test('反差：没有版本偏差时计数恒为 0（计数本身不得虚报）', () => {
    const file = tmp('clean');
    const w = openWorld({ file, space: 'SP-SKEW', grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
    try {
      w.uow(ADMIN, (tx) => {
        tx.createObject({ kind: 'test.claim', payload: { a: 1 } });
        return tx.createObject({ kind: 'test.claim', payload: { a: 2, describedAt: 5 } });
      });
      const r = readAsOf(w.kernel, ctx(w));
      expect(r.rows.length).toBeGreaterThan(0);
      expect(r.echo.hiddenByContractSkew).toBe(0);
    } finally { w.close(); rmSync(file, { force: true }); }
  });

  test('修订过的对象也计入同一条判据（`revise` 不盖戳会让 revision≥2 全成空标记）', () => {
    const file = tmp('revise');
    const w1 = openWorld({ file, space: 'SP-SKEW', grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
    try {
      const oid = w1.uow(ADMIN, (tx) => {
        const o = tx.createObject({ kind: 'test.claim', payload: { a: 1 } });
        tx.revise(o, { payload: { a: 2 }, expectedRevision: 1 });
        return o;
      });
      // v1 世界里修订行必须可读——若 revise 漏盖戳，这里就会因空标记被拒或计入偏差
      const r = readAsOf(w1.kernel, ctx(w1));
      expect(r.echo.hiddenByContractSkew).toBe(0);
      expect(r.rows.some((x) => x.oid === oid && x.revision === 2)).toBe(true);
    } finally { w1.close(); rmSync(file, { force: true }); }
  });
});
