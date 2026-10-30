/**
 * D-30（包 5，席位 G4-A G4A-N9e 实测，P3）：guard 关锚正则被**中置注释**四式穿过。
 *
 * 修前 `normalizeSql` 只剥**前导**注释、被禁写法用 `^(insert\s+or\s+replace|replace\s+into)`
 * 锚定 ⇒ 四式穿透机制守卫句柄（`port.tx` 交出的 handle）。四式（原文含注释终止符，块注释写不下，
 * 用行注释列）：
 */
//   ① `insert/*c*/or replace …`   ② `replace/*c*/into …`
//   ③ `insert--c␊or replace …`（行注释换行续形）  ④ `… on conflict(seq) do update set …`
/**
 *
 * 修法（CONTRACTS.md §16.2 包 5 存储纪律）：归一化剥**全部**注释（块/行、任意位置）后做
 * **子串**匹配（放弃 `^` 锚——中置注释证明锚本来就是错的）；被禁名单补 `on conflict … do update`。
 * `on conflict … do nothing` 保持合法（投影登记的唯一合法 upsert 形，机制自己在用）。
 *
 * **如实边界**：`normalizeSql` 是**词法**手段——字符串字面量里的 `--`/`/*`/被禁词会被误剥误杀
 * （误杀方向安全：拒而不放行）；更深的形态（字面量内伪关键词的绕行、未来新语法形）仍可能绕。
 * 主修是触发器（D-27/D-28/D-29 把「改写有状态的面」逐表钉死），guard 只是纵深：对**无触发器**
 * 表（journal/projection_*）把被禁形态挡在守卫层，是本文件的主判据。
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../src/harness/paths.ts';
import { SqlitePort } from '../src/storage-sqlite/sqlite-port.ts';

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(POC_DATA_DIR, 'd30-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const outcome = (fn: () => unknown): string => {
  try { fn(); return 'NO_REFUSAL'; }
  catch (e) {
    const err = e as { code?: unknown; message?: unknown };
    return typeof err?.code === 'string' && err.code !== 'ERR_SQLITE_ERROR' ? err.code : String(err?.message ?? e);
  }
};

describe('D-30 guard 形态面：剥全部注释后子串匹配，四式穿透封死', () => {
  test('D30-1 四式各一条：中置块注释 ×2、行注释换行续形 ×1、upsert DO UPDATE ×1 ⇒ 机制守卫句柄一律 RAW_SQL_REFUSED', () => {
    const port = new SqlitePort({ file: join(dir, 'd30-1.db') });
    try {
      // ① insert 与 or 之间夹块注释（修前：归一化后 head=`insert or replace…`？不——修前只剥前导注释，
      //    块注释残留使 `^insert\s+or\s+replace` 失配 ⇒ 放行）
      expect(outcome(() => port.tx((raw) => raw.run(
        `insert/*c*/or replace into journal(seq, tx_epoch, ns, oid, op) values(1,1,'x','y','z')`,
      )))).toContain('RAW_SQL_REFUSED');
      // ② replace 与 into 之间夹块注释
      expect(outcome(() => port.tx((raw) => raw.run(
        `replace/*c*/into journal(seq, tx_epoch, ns, oid, op) values(2,1,'x','y','z')`,
      )))).toContain('RAW_SQL_REFUSED');
      // ③ 行注释 + 换行续形（`--` 注释吃掉行尾，下一行继续拼出被禁形态）
      expect(outcome(() => port.tx((raw) => raw.run(
        `insert--c\nor replace into journal(seq, tx_epoch, ns, oid, op) values(3,1,'x','y','z')`,
      )))).toContain('RAW_SQL_REFUSED');
      // ④ upsert DO UPDATE：语义上是整行改写，与被禁 REPLACE 同族（修前不在名单）
      expect(outcome(() => port.tx((raw) => raw.run(
        `insert into journal(tx_epoch, ns, oid, op) values(1,'x','y','a')
         on conflict(seq) do update set tx_epoch = 9`,
      )))).toContain('RAW_SQL_REFUSED');
      // 四式确属「无触发器表才谈得上穿透」的形态族：journal 没有任何不可变性触发器，
      // 拒的必须是**形态**而不是后果（对照：同表普通 insert 见 D30-2）。
    } finally { port.close(); }
  });

  test('D30-2 反面对照：合法形态不误伤——普通 insert、`on conflict do nothing`（投影登记形）、insert or ignore、带注释的合法语句照常放行', () => {
    const port = new SqlitePort({ file: join(dir, 'd30-2.db') });
    try {
      expect(outcome(() => port.tx((raw) => raw.run(
        `insert into journal(tx_epoch, ns, oid, op) values(1,'x','y','normal-insert-stays-legal')`,
      )))).toBe('NO_REFUSAL');
      // 机制自己就在用这一形（projection.ts 冷启动登记）——名单必须只杀 DO UPDATE
      expect(outcome(() => port.tx((raw) => raw.run(
        `insert into projection_state(name, seq, baseline, rebuilt_at) values('d30',0,0,1)
         on conflict(name) do nothing`,
      )))).toBe('NO_REFUSAL');
      expect(outcome(() => port.tx((raw) => raw.run(
        `insert or ignore into journal(tx_epoch, ns, oid, op) values(2,'x','y','ignore-ok')`,
      )))).toBe('NO_REFUSAL');
      // 中置/尾随注释不再破坏合法语句（剥全部注释后仍按 head 判只读形）
      expect(outcome(() => port.read((raw) => raw.get(
        `select 1 as x /* mid */ -- trailing\n`,
      )))).toBe('NO_REFUSAL');
      expect(outcome(() => port.tx((raw) => raw.run(
        `insert into journal(tx_epoch, ns, oid, op) /* mid */ values(3,'x','y','annotated') -- tail`,
      )))).toBe('NO_REFUSAL');
    } finally { port.close(); }
  });

  test('D30-3 纵深定位：对无触发器表拒的是形态不是后果；canonical REPLACE 打 ledger 仍撞触发器（守卫+触发器双层，N9 锚不回归）', () => {
    const port = new SqlitePort({ file: join(dir, 'd30-3.db') });
    try {
      // 守卫层先拒（无触发器表也拒 ⇒ 形态判据独立于后果）
      expect(outcome(() => port.tx((raw) => raw.run(
        `insert or replace into projection_cursor(projection, journal_seq, status) values('p',1,'ok')`,
      )))).toContain('RAW_SQL_REFUSED');
      // 触发器层仍在（守卫被绕过时后果照旧）：未守卫面打 H。先播种真冲突行——
      // REPLACE 只在主键冲突时走隐式删除（席位的实验教训，无冲突的 REPLACE 就是普通插入）。
      port.raw.run(
        `insert into ledger(seq, space, event_type, actor, payload_json, recorded_at)
         values(1,'SP-D30','object-registered','x','{}',1)`,
      );
      expect(outcome(() => port.raw.run(
        `replace into ledger(seq, space, event_type, actor, payload_json, recorded_at)
         values(1,'SP-D30','forged','x','{}',1)`,
      ))).toContain('HISTORY_IMMUTABLE');
      expect(port.raw.get<{ event_type: string }>(
        `select event_type from ledger where seq=1`)!.event_type).toBe('object-registered');
    } finally { port.close(); }
  });
});
