/**
 * 窄面对象的**运行时**接口面（`CONTRACTS.md` §14.6 规则 1 的作者侧落地）。
 *
 * 起因：外部复核指出 `Kernel.faceFor()` 返回的 `PluginFace` 里含 `writerFor()`，
 * 而它返回的 `NamespaceWriterImpl` 用 **TS 参数属性**持有 Kernel 与 SQL 句柄
 * （`kernel.ts:522` `constructor(private readonly k, private readonly cap, private readonly raw)`）。
 * `private` 只存在于编译期，运行时就是自有实例字段 ⇒ 插件经 `writerFor(tx)` 拿到第三个
 * 携带 `k`/`raw` 的对象。只修 D-7（`Kernel.port`）与 D-16（`UnitOfWork.raw`/`k`）**并不够**。
 *
 * 复核者只做了静态判定、未做动态复现；本文件把它变成实测。
 * 判据沿原型链收集成员名——`Object.keys` 会漏掉原型上的方法，那会让这条门禁变成假绿。
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../src/harness/world.ts';
import { CAP_RECORDS } from '../src/domains/test-records.ts';

const surface = (x: object): string[] => {
  const out = new Set<string>();
  let cur: object | null = x;
  while (cur && cur !== Object.prototype) {
    for (const n of Object.getOwnPropertyNames(cur)) out.add(n);
    cur = Object.getPrototypeOf(cur) as object | null;
  }
  return [...out];
};

describe('窄面对象的运行时接口面（§14.6 规则 1）', () => {
  test('PluginFace.writerFor() 返回的对象在运行时不再携带 k / raw（D-17 已修）', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'ns-writer-'));
    const w = openWorld({ file: join(dir, 'w.db'), space: 'SP-NW', grants: { alice: ['space-write'] } });
    try {
      // 只带出"泄漏了哪些成员名"这一字符串数组，断言放在事务外：
      // 在回调内抛断言会被回滚路径接管，真实失败会被 database is not open 盖掉（实测踩过）。
      const leaks = w.uow(PRINCIPAL('alice'), (tx) => {
        const writer = w.kernel.faceFor(CAP_RECORDS).writerFor(tx) as unknown as object;
        const names = surface(writer);
        return ['k', 'raw', 'port'].filter((m) => names.includes(m));
      });
      // D-17（已修）：修复前实测为 ['k','raw']。NamespaceWriterImpl 改用 `#k`/`#raw` 后，
      // 交出的实例上这两个名字都不存在（Kernel 侧回读走类内静态 peekRaw，类未导出）。
      expect(leaks).toEqual([]);
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
