/**
 * 机制句柄 SQL 守卫的作者回归（F-14′ / P0 的完整覆盖）。
 *
 * 复审员证明了"前导注释绕过"，但没有覆盖守卫的另一条分支：**多语句**
 * （首词合法、`; ` 之后藏 DDL）。缺一条测试就等于该分支未被证明，故本文件补齐，
 * 并保证每条负例都有正例反差——否则"全都拒绝"也能让测试假绿。
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL } from '../src/harness/world.ts';

const ALICE = PRINCIPAL('guard-tester');

function world(prefix: string) {
  const dir = mkdtempSync(join(POC_DATA_DIR, prefix));
  return { dir, w: openWorld({ file: join(dir, 'guard.db'), space: 'SP-GUARD', grants: { 'guard-tester': ['space-write'] } }) };
}
type Handle = { run(sql: string, ...p: unknown[]): void; all(sql: string, ...p: unknown[]): unknown[]; get(sql: string, ...p: unknown[]): unknown };
/**
 * 机制句柄的取得路径。
 * 原先写作 `(tx as { raw: Handle }).raw`——那是**顺着 D-16 的洞**拿句柄：
 * 洞一封，测试就取到 undefined，报的是 TypeError 而不是预期拒绝。
 * 测试不得把漏洞当夹具。改走 StoragePort 的受守卫包装（`guard` / `guardRead` 与原路径
 * 是同一套判据，被检对象没变），D-16 封与否都不影响本文件的语义。
 */
const withHandle = <R>(w: ReturnType<typeof openWorld>, fn: (h: Handle) => R): R =>
  w.kernel.port.tx((raw) => fn(raw as unknown as Handle));

describe('机制句柄 SQL 守卫（F-14′ 完整覆盖）', () => {
  test.each([
    ['前导块注释', '/* disguise */ DROP TRIGGER IF EXISTS ledger_no_update'],
    ['前导行注释', '-- disguise\nDROP TRIGGER IF EXISTS ledger_no_update'],
    ['多重注释 + 空白', '/* a */ -- b\n   /* c */\n\talter table ledger add column forged text'],
    ['前导分号', ';;pragma writable_schema = on'],
    ['多语句（首词合法）', 'select 1; drop trigger ledger_no_update'],
    ['多语句（读伪装的写）', 'select 1 as x; attach \':memory:\' as evil'],
  ])('%s 必须被拒', (_name, sql) => {
    const { dir, w } = world('guard-neg-');
    try {
      for (const call of [(h: Handle) => h.run(sql), (h: Handle) => h.all(sql), (h: Handle) => h.get(sql)]) {
        expect(() => withHandle(w, (h) => call(h))).toThrow(/RAW_SQL_REFUSED/);
      }
      // 反差：拒绝之后不可变性仍然把守 DML（守卫不是唯一一层）
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: {} }));
      expect(() => w.raw.run(`update ledger set event_type='forged' where seq=1`)).toThrow(/HISTORY_IMMUTABLE/);
      expect(w.readObject(oid)).toBeDefined();
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test.each([
    ['普通查询', `select count(*) c from ledger`],
    ['带注释的合法查询', `/* 读登记数 */ select count(*) c from ledger`],
    ['机制自身的合法写', `insert into journal(tx_epoch, ns, oid, op) values(999999,'guard','g:1','guard-probe')`],
  ])('反差正例：%s 不得被误伤', (_name, sql) => {
    const { dir, w } = world('guard-pos-');
    try {
      w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: {} }));
      expect(() => withHandle(w, (h) => h.run(sql))).not.toThrow();
    } finally { w.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('打开已建好的库：校验通过、数据仍在、模式未被再写（F-15 反差）', () => {
    const dir = mkdtempSync(join(POC_DATA_DIR, 'guard-open-'));
    const file = join(dir, 'guard.db');
    const w = openWorld({ file, space: 'SP-GUARD', grants: { 'guard-tester': ['space-write'] } });
    try {
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: {} }));
      const before = w.raw.all<{ name: string }>(`select name from sqlite_master where type='table' order by name`)
        .map((r) => r.name).join(',');
      w.close();
      const again = openWorld({ file, space: 'SP-GUARD', grants: { 'guard-tester': ['space-write'] } });
      try {
        expect(again.readObject(oid)).toBeDefined();
        const after = again.raw.all<{ name: string }>(`select name from sqlite_master where type='table' order by name`)
          .map((r) => r.name).join(',');
        expect(after).toBe(before);
        // 版本标记存在且与实现一致——它是"这个库迁过没有"的唯一可判定依据
        expect((again.raw.get<{ value: number }>(`select value from meta where key='schema_version'`)!).value).toBeGreaterThan(0);
      } finally { again.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
