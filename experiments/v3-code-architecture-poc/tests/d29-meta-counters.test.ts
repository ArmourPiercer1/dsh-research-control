/**
 * D-29（包 5，席位 G4-A G4A-N9d 实测，P3）：`meta.ledger_seq` 曾被归零 ⇒ H 序号单调前提失效。
 *
 * 席位实测两式：`replace into meta(key,value) values('ledger_seq',0)`（REPLACE 走隐式删除，
 * meta 无触发器）与 `insert into meta values('ledger_seq',0) on conflict(key) do update
 * set value=0`（upsert 走 UPDATE，同样无保护）⇒ 计数归零，下一次合法提交撞 PK 或回放旧号。
 *
 * 修法（CONTRACTS.md §16.2 包 5 存储纪律）：
 * ① `meta_counter_monotonic`（UPDATE）：任何键 `new.value < old.value` 一律 abort
 *    `META_COUNTER_MONOTONICITY`——`ledger_seq`/`id_counter`/`schema_version` 同受护
 *    （版本号下调同样是「打开路径判据的地基被动过」）；
 * ② `meta_ledger_seq_no_delete`：DELETE `ledger_seq` 键 abort 同码——堵住 REPLACE 的隐式删除形。
 *
 * **如实登记的边界**：`id_counter` 键的 DELETE 仍可行——该形态**打开期即 fail-loud**
 * （`SCHEMA_UPGRADE_REQUIRED`，old-schema 轴既有绿条钉着），属已治理的打开期形态；
 * **前跳（ghost seq，如 value+7）与合法发号在触发器层不可分辨**，与 journal 幽灵行同族，
 * 属裸句柄运维界残余。触发器对**连接层**生效：经 `SqlitePort` 建立的连接（含 `port.raw`）
 * 全部受护；手工 `new DatabaseSync` 不带 `recursive_triggers` 时 REPLACE 的隐式删除不触发
 * DELETE 触发器——裸文件全权界，登记不入承诺。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../src/harness/world.ts';
import { Refusal } from '../src/contracts/index.ts';
import { SCHEMA_VERSION, SqlitePort } from '../src/storage-sqlite/sqlite-port.ts';

const ALICE = PRINCIPAL('d29alice');
const GRANTS = { d29alice: ['space-write'] };
let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'd29-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const open = (file: string): World =>
  openWorld({ file, space: 'SP-D29', grants: GRANTS });
const outcome = (fn: () => unknown): string => {
  try { fn(); return 'NO_REFUSAL'; }
  catch (e) {
    const err = e as { code?: unknown; message?: unknown };
    return typeof err?.code === 'string' && err.code !== 'ERR_SQLITE_ERROR' ? err.code : String(err?.message ?? e);
  }
};
const metaVal = (w: World, key: string) =>
  w.raw.get<{ value: number }>(`select value from meta where key=?`, key)!.value;

describe('D-29 计数面：只增不减，归零两式与删除形均拒', () => {
  test('D29-1 ledger_seq 归零两式（REPLACE / ON CONFLICT DO UPDATE）+ DELETE 一并拒；水位不动，下一次提交照常续号', () => {
    const w = open(join(dir, 'd29-1.db'));
    try {
      w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 1 } })); // seq 1
      expect(w.ledgerHead()).toBe(1);
      expect(outcome(() => w.raw.run(
        `replace into meta(key, value) values('ledger_seq', 0)`,
      ))).toContain('META_COUNTER_MONOTONICITY');
      expect(outcome(() => w.raw.run(
        `insert into meta(key, value) values('ledger_seq', 0) on conflict(key) do update set value = 0`,
      ))).toContain('META_COUNTER_MONOTONICITY');
      expect(outcome(() => w.raw.run(
        `delete from meta where key='ledger_seq'`,
      ))).toContain('META_COUNTER_MONOTONICITY');
      expect(metaVal(w, 'ledger_seq')).toBe(1);
      const oid2 = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { v: 2 } }));
      expect(w.raw.get<{ created_seq: number }>(
        `select created_seq from object_directory where oid=?`, oid2,
      )!.created_seq).toBe(2); // 水位没被动过 ⇒ 续号而不是撞号/回放
    } finally { w.close(); }
  });

  test('D29-2 id_counter 与 schema_version 同受「不减」护：上调合法（超前是合法形态，old-schema 绿条所赖），下调/归零拒', () => {
    const w = open(join(dir, 'd29-2.db'));
    try {
      expect(outcome(() => w.raw.run(
        `update meta set value = 9999 where key='id_counter'`,
      ))).toBe('NO_REFUSAL');                              // 超前合法
      expect(outcome(() => w.raw.run(
        `update meta set value = 0 where key='id_counter'`,
      ))).toContain('META_COUNTER_MONOTONICITY');          // 归零拒
      expect(outcome(() => w.raw.run(
        `update meta set value = ? where key='schema_version'`, SCHEMA_VERSION - 1,
      ))).toContain('META_COUNTER_MONOTONICITY');          // 版本号下调拒（打开路径的地基）
      expect(metaVal(w, 'schema_version')).toBe(SCHEMA_VERSION);
      // 超前计数器之后写入照常（不误伤）
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: {} }));
      expect(oid).toBe('OBJ-SP-D29-10000');
    } finally { w.close(); }
  });

  test('D29-3 存量库打开路径 fail-loud：v6 库摘掉包 5 触发器并把版本退回 5 ⇒ 重开被 SCHEMA_UPGRADE_REQUIRED 拒，detail 带版本不符 + missingTriggers 逐名', () => {
    const file = join(dir, 'd29-3.db');
    const w = open(file);
    w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: {} }));
    w.close();
    const raw = new DatabaseSync(file);
    raw.exec(`drop trigger if exists route_change_guarded;`);
    raw.exec(`drop trigger if exists meta_counter_monotonic;`);
    raw.prepare(`update meta set value = ? where key='schema_version'`).run(5); // 触发器已摘 ⇒ 「存量 v5 库」形状
    raw.close();
    let thrown: unknown;
    try { new SqlitePort({ file }); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(Refusal);
    const r = thrown as Refusal;
    expect(r.code).toBe('SCHEMA_UPGRADE_REQUIRED');
    const d = r.detail as Record<string, unknown>;
    expect(d.foundVersion).toBe(5);
    expect(d.expectedVersion).toBe(SCHEMA_VERSION);
    expect((d.missingTriggers as string[]).sort()).toEqual(['meta_counter_monotonic', 'route_change_guarded']);
  });

  test('D29-5 触发器集逐名防护（外部复审点名）：包 5 的 7 条触发器**逐一**摘掉重开都必须 SCHEMA_UPGRADE_REQUIRED，missingTriggers 逐名报出——「触发器只护新库」类缺陷从此有人发现', () => {
    for (const doomed of ['route_no_delete', 'route_insert_guarded', 'route_change_guarded',
      'directory_no_delete', 'directory_birth_audited', 'meta_counter_monotonic', 'meta_ledger_seq_no_delete']) {
      const file = join(dir, `d29-5-${doomed}.db`);
      const w = open(file);
      w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: {} })); // 库先有状态（摘触发器不被 counter 判定抢跑）
      w.close();
      const raw = new DatabaseSync(file);
      raw.exec(`drop trigger ${doomed};`); // 版本标记不动（meta 触发器可能仍在其位）⇒ 走「版本一致但触发器集不完整」分支
      raw.close();
      let thrown: unknown;
      try { new SqlitePort({ file }); } catch (e) { thrown = e; }
      expect(thrown, `摘掉 ${doomed} 后必须拒开`).toBeInstanceOf(Refusal);
      const r = thrown as Refusal;
      expect(r.code, doomed).toBe('SCHEMA_UPGRADE_REQUIRED');
      expect((r.detail as Record<string, unknown>).missingTriggers, doomed).toEqual([doomed]);
      rmSync(file, { force: true });
    }
  });

  test('D29-4 对照锚：包 5 之后新库的触发器集完整、版本一致，重开照常（打开判据不误伤新库）', () => {
    const file = join(dir, 'd29-4.db');
    const w = open(file);
    w.close();
    const w2 = open(file);
    try {
      const names = w2.raw.all<{ name: string }>(
        `select name from sqlite_master where type='trigger'`).map((r) => r.name);
      for (const t of ['route_no_delete', 'route_change_guarded', 'route_insert_guarded',
        'directory_no_delete', 'directory_birth_audited', 'meta_counter_monotonic', 'meta_ledger_seq_no_delete']) {
        expect(names, `打开面必须自带包 5 触发器 ${t}`).toContain(t);
      }
      expect(metaVal(w2, 'schema_version')).toBe(SCHEMA_VERSION);
    } finally { w2.close(); }
  });
});
