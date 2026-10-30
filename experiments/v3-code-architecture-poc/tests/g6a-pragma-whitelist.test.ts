/**
 * F-G6A-1 收口测试（外部复审第五轮裁定 2026-10-31 第③点；CONTRACTS.md §16.3「PRAGMA 类目
 * 更正与白名单收紧」段；草案锚 RE-REVIEW-G6-A.md 附录 C.2）。
 *
 * 血统与转正说明（正向回归面，第五轮裁定长期建议「把属『已修』的用例转为普通零失败测试
 * 作正向断言，并在报告里列映射表」）：
 *   本文件逐形对应原红队用例 `G6A-A5-2`（RE-REVIEW-G6-A.md 附录 A.1 `A5 guardRawBoundary…`
 * describe，报告 §① 表 #14 行 BARE_PRAGMA_READ 类目）：
 *   · 原断言 `pragma optimize` / `pragma wal_checkpoint` 放行（`NO_REFUSAL`）＝**发现本身**；
 *     收紧白名单后翻正为 `RAW_SQL_REFUSED`——翻转处逐条注释标注，其余断言原样保留；
 *   · 原「行为/耐久性开关全在赋值形 ⇒ 拒」的对照集与「裸词形纯读」的正例面原样保留
 *     （它们在修前已绿，属「已修/一贯如此」的正向面，第五轮裁定点名转正）。
 * 白名单面另钉三形要件（第五轮裁定第③点）：白名单内放行 / 写副作用形拒 / 赋值全形拒；
 * 残余如实：判据是**词法**的（CONTRACTS.md §16.3），字面量伪关键词等形态不在承诺内，
 * 误杀方向安全。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../src/harness/world.ts';
import { TEST_OBJECT_MODEL } from '../src/domains/test-object-model.ts';

const ADM = PRINCIPAL('pw-admin');
const GRANTS = { 'pw-admin': ['space-write', 'capability-admin'] };
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'g6a-pragma-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const open = (name: string): World =>
  openWorld({ file: join(dir, `${name}.db`), space: 'SP-PW', grants: GRANTS, plugins: [TEST_OBJECT_MODEL] });
const outcome = (fn: () => unknown): string => {
  try { fn(); return 'NO_REFUSAL'; }
  catch (e) {
    const err = e as { code?: unknown; message?: unknown };
    if (typeof err?.code === 'string' && err.code !== 'ERR_SQLITE_ERROR') return err.code;
    return String(err?.message ?? e);
  }
};
const isGuardRefused = (fn: () => unknown): boolean => outcome(fn).includes('RAW_SQL_REFUSED');

describe('F-G6A-1 PRAGMA 白名单（放行按词法形状、不按语义；G6A-A5-2 转正）', () => {
  test('① 白名单内单结果查询形放行（含 `schema.` 前缀/大小写混排）——ST-D/n9 连接态读锚不被误杀', () => {
    const w = open('pw-allow');
    try {
      // 白名单（CONTRACTS.md §16.3 逐条登记；recursive_triggers 为 ST-D/n9 读锚，见该段）：
      const NAMES = ['journal_mode', 'synchronous', 'user_version', 'schema_version', 'data_version',
        'integrity_check', 'foreign_key_check', 'table_info', 'compile_options', 'module_list',
        'page_count', 'freelist_count', 'recursive_triggers'];
      for (const n of NAMES) {
        expect(isGuardRefused(() => w.raw.all(`pragma ${n}`)), `pragma ${n}`).toBe(false);
        expect(isGuardRefused(() => w.raw.all(`PRAGMA ${n.toUpperCase()}`)), `PRAGMA ${n}`).toBe(false);
        expect(isGuardRefused(() => w.raw.all(`pragma main.${n}`)), `pragma main.${n}`).toBe(false);
      }
      // ST-D（tests/g5a-n9-storage.test.ts）与 n9 的既有读锚形态必须原样可用且读出连接态：
      expect(w.raw.get<{ recursive_triggers: number }>(`pragma recursive_triggers`)!.recursive_triggers).toBe(1);
      expect(JSON.stringify(w.raw.all(`pragma journal_mode`))).toContain('wal');
    } finally { w.close(); }
  });

  test('② 无参写副作用形拒（G6A-A5-2 发现翻正：optimize/wal_checkpoint 不再按「裸读」放行）', () => {
    const w = open('pw-side-effect');
    try {
      w.uow(ADM, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } }));
      // 原断言（发现面）：expect(outcome(…)).toBe('NO_REFUSAL') —— 收紧后翻正为拒：
      expect(outcome(() => w.raw.get(`pragma optimize`))).toContain('RAW_SQL_REFUSED');         // 写：ANALYZE+索引重建
      expect(outcome(() => w.raw.all(`pragma wal_checkpoint`))).toContain('RAW_SQL_REFUSED');    // 写：被动 checkpoint（WAL→主库）
      // 词法变体同拒（防「换个写法又透传」）：
      expect(outcome(() => w.raw.all(`pragma main.optimize`))).toContain('RAW_SQL_REFUSED');
      expect(outcome(() => w.raw.all(`PRAGMA WAL_CHECKPOINT`))).toContain('RAW_SQL_REFUSED');
      expect(outcome(() => w.raw.all(`pragma wal_checkpoint(truncate)`))).toContain('RAW_SQL_REFUSED');
      // foreign_keys 整名不在白名单（含函数形，宁可误杀——C.2 排除清单原文）：
      expect(outcome(() => w.raw.all(`pragma foreign_keys`))).toContain('RAW_SQL_REFUSED');
      expect(outcome(() => w.raw.all(`pragma foreign_keys(ledger)`))).toContain('RAW_SQL_REFUSED');
      // 拒后不变量原样（对照原用例「放行后不变量原样」面——防线未松动且现不再需要放行）：
      expect(w.raw.get<{ recursive_triggers: number }>(`pragma recursive_triggers`)!.recursive_triggers).toBe(1);
      expect(outcome(() => w.raw.run(`delete from ledger where seq=1`))).toContain('HISTORY_IMMUTABLE');
    } finally { w.close(); }
  });

  test('③ durability 开关赋值全形仍拒（G6A-A5-2 对照集原样转正：`=`/空格/函数形/`main.` 前缀）', () => {
    const w = open('pw-assign');
    try {
      // 原 A5-2 的 8 条形对照集，逐字保留（修前即拒 ⇒ 正向回归面）：
      for (const sql of [
        `pragma journal_mode = delete`, `pragma journal_mode(wal)`, `pragma journal_mode wal`,
        `pragma synchronous = off`, `pragma main.locking_mode = exclusive`,
        `pragma query_only = on`, `pragma writable_schema = on`, `pragma foreign_keys = off`,
      ]) {
        expect(outcome(() => w.raw.run(sql)), sql).toContain('RAW_SQL_REFUSED');
      }
      // G6A-A5-1 关闸形（空格赋值/schema 限定）同族再钉：
      for (const sql of [
        `pragma recursive_triggers = off`, `pragma main.recursive_triggers = off`, `pragma recursive_triggers off`,
      ]) {
        expect(outcome(() => w.raw.run(sql)), sql).toContain('RAW_SQL_REFUSED');
      }
      // 白名单名的赋值形也拒（**放行只认无参词法形**，与名单内与否无关）：
      expect(outcome(() => w.raw.run(`pragma user_version = 7`))).toContain('RAW_SQL_REFUSED');
      expect(outcome(() => w.raw.run(`pragma data_version = 9`))).toContain('RAW_SQL_REFUSED');
      // 赋值全形拒后，裸词形纯读放行且不改状态（原 A5-2 末三行原样转正）：
      expect(JSON.stringify(w.raw.all(`pragma journal_mode`))).toContain('wal');
      const syncBefore = JSON.stringify(w.raw.all(`pragma synchronous`));
      expect(outcome(() => w.raw.run(`pragma synchronous`))).toBe('NO_REFUSAL'); // 读形放行
      expect(JSON.stringify(w.raw.all(`pragma synchronous`))).toBe(syncBefore);
    } finally { w.close(); }
  });
});
