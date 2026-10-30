/**
 * 独立复验席 R5–R8 第 1 项（S-0）独立攻击：guardRead 读句柄 + 三表追加式触发器。
 *
 * 本席纪律：只新建 attacks/review/ 下文件；不改 src/**、tests/**、他人攻击文件与既有断言。
 *
 * 作者声称：`guardRead()` 只放 SELECT/WITH 且禁多语句（RAW_SQL_REFUSED）；
 * domain_state/ref_edge/records 三表由触发器禁 UPDATE/DELETE。
 *
 * 本席攻击矩阵：
 *  A. 头部白名单归一化：前导注释/分号/空白/大小写
 *  B. PRAGMA（含 ignore_delete_triggers）/ 裸 DML / DDL
 *  C. 多语句分隔（含注释与空白变体）
 *  D. CTE 内 DML：`WITH x AS (DML … RETURNING …) SELECT …` —— 头部是合法 WITH，
 *     头部白名单与多语句检查都拦不住；能否封死取决于触发器覆盖面
 *  E. 触发器覆盖面：对**无触发器**的表（capability_route / meta / journal）做 CTE-DML；
 *     以及经未守卫面实测 `PRAGMA ignore_delete_triggers` 是否旁路 DELETE 触发器
 */
import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { POC_DATA_DIR } from '../../src/harness/paths.ts';
import { openWorld, PRINCIPAL, type World } from '../../src/harness/world.ts';
import type { StoragePort } from '../../src/contracts/index.ts';

const ALICE = PRINCIPAL('alice');

function mkWorld(tag: string, space = 'SP-G1') {
  const dir = mkdtempSync(join(POC_DATA_DIR, tag));
  const w = openWorld({ file: join(dir, 'attack.db'), space, grants: { alice: ['space-write'] } });
  return { w, dir };
}
function finish(w: World, dir: string) {
  w.close();
  rmSync(dir, { recursive: true, force: true });
}
/** 经机制读句柄执行；返回 null = 无异常（执行成功），否则返回拒绝码/错误信息。 */
function readErr(sql: string, port: StoragePort, ...params: unknown[]): string | null {
  try {
    port.read((r) => r.get(sql, ...params));
    return null;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return err.code ?? String(err.message ?? e);
  }
}

describe('S-0A：头部白名单与归一化（机制面 kernel.port.read）', () => {
  test('对照：合法 SELECT 放行', () => {
    const { w, dir } = mkWorld('r5r8-g-a-');
    try {
      expect(w.kernel.port.read((r) => r.get('select 1 as x'))).toEqual({ x: 1 });
    } finally { finish(w, dir); }
  });

  test('前导注释/空白/分号/大小写：归一化后放行（均为只读形态）', () => {
    const { w, dir } = mkWorld('r5r8-g-b-');
    try {
      const ok = (sql: string) => w.kernel.port.read((r) => r.get(sql));
      expect(ok('/* c */ select 1 as x')).toEqual({ x: 1 });
      expect(ok('-- c\nselect 1 as x')).toEqual({ x: 1 });
      expect(ok('   SeLeCt 1 as x')).toEqual({ x: 1 });
      expect(ok('; select 1 as x')).toEqual({ x: 1 });
    } finally { finish(w, dir); }
  });

  test('裸 DML / PRAGMA / DDL 经读句柄一律 RAW_SQL_REFUSED', () => {
    const { w, dir } = mkWorld('r5r8-g-c-');
    try {
      for (const sql of [
        'update capability_route set enabled=0',
        'delete from records',
        'pragma table_info(records)',
        'PRAGMA ignore_delete_triggers = 1',
        'drop trigger records_no_delete',
        'create table evil(x)',
      ]) {
        expect(readErr(sql, w.kernel.port)).toBe('RAW_SQL_REFUSED');
      }
    } finally { finish(w, dir); }
  });

  test('多语句（分号分隔，含注释/空白变体）一律 RAW_SQL_REFUSED', () => {
    const { w, dir } = mkWorld('r5r8-g-d-');
    try {
      for (const sql of [
        'select 1; delete from records',
        '/* c */ select 1; drop trigger records_no_delete',
        '; select 1; pragma ignore_delete_triggers=1',
        'select 1 ;\n drop trigger records_no_delete',
        'select 1; -- trailing comment',
        // 过度严格观察项：字符串字面量内分号也被拒（误报，仅记录，不是漏洞）
        "select 'a;b'",
      ]) {
        expect(readErr(sql, w.kernel.port)).toBe('RAW_SQL_REFUSED');
      }
    } finally { finish(w, dir); }
  });
});

describe('S-0D：CTE 内 DML（头部为合法 WITH）', () => {
  test('records：CTE 内 DELETE/UPDATE 被触发器拦截（三表触发器对 CTE-DML 有效）', () => {
    const { w, dir } = mkWorld('r5r8-g-e-');
    try {
      w.uow(ALICE, (tx) => tx.declareRecord({ recordId: 'REC-G1', eventType: 'synth:raw-intake', payload: { text: 'x' } }));
      const count = () => w.kernel.port.read((r) => (r.get('select count(*) c from records') as { c: number }).c);
      expect(count()).toBe(1);
      for (const sql of [
        'with x as (delete from records returning 1) select 1 from x',
        "with x as (update records set payload_json='{}' returning 1) select 1 from x",
      ]) {
        let msg = '';
        try { w.kernel.port.read((r) => r.get(sql)); } catch (e) { msg = String((e as Error).message); }
        expect(msg).toContain('RECORD_MATERIAL_IMMUTABLE');
      }
      expect(count()).toBe(1); // 数据未变
    } finally { finish(w, dir); }
  });

  test('domain_state / ref_edge：CTE-DML 同样被触发器拦截', () => {
    const { w, dir } = mkWorld('r5r8-g-g2-');
    try {
      const oid = w.uow(ALICE, (tx) => tx.createObject({ kind: 'test.claim', payload: { text: 'x' } }));
      w.uow(ALICE, (tx) => tx.linkRef({
        from: { kind: 'revision-ref', oid, revision: 1 },
        to: { kind: 'object-ref', oid },
        role: 'self-loop', required: false,
      }));
      for (const [sql, want] of [
        ['with x as (delete from domain_state returning 1) select 1 from x', 'DOMAIN_STATE_APPEND_ONLY'],
        ['with x as (update ref_edge set role=? returning 1) select 1 from x', 'REF_EDGE_FROZEN'],
      ] as const) {
        let msg = '';
        try { w.kernel.port.read((r) => r.get(sql, want)); } catch (e) { msg = String((e as Error).message); }
        expect(msg).toContain(want);
      }
    } finally { finish(w, dir); }
  });

  test('【漏洞探针】capability_route 无触发器：读句柄 CTE-UPDATE 成功 ⇒ 路由状态被改且不留 ledger/journal 痕迹', () => {
    const { w, dir } = mkWorld('r5r8-g-f-');
    try {
      const cap = w.kernel.port.read((r) => (r.get('select capability from capability_route limit 1') as { capability: string }).capability);
      const head0 = w.ledgerHead();
      let executed = true;
      try {
        w.kernel.port.read((r) => r.get(
          'with x as (update capability_route set enabled=0, changed_seq=999 where capability=? returning 1) select 1 from x', cap));
      } catch { executed = false; }
      const enabled = w.kernel.port.read((r) => (r.get('select enabled from capability_route where capability=?', cap) as { enabled: number }).enabled);
      // 按本席判定写入期望：漏洞存在 ⇔ 执行成功 + enabled 被清零 + head 未动（无登记痕迹）
      expect(executed).toBe(true);
      expect(enabled).toBe(0);
      expect(w.ledgerHead()).toBe(head0);
    } finally { finish(w, dir); }
  });

  test('【漏洞探针】meta.ledger_seq 无触发器：读句柄 CTE-UPDATE 成功 ⇒ 审计序号凭空 +7', () => {
    const { w, dir } = mkWorld('r5r8-g-h-');
    try {
      const head0 = w.ledgerHead();
      let executed = true;
      try {
        w.kernel.port.read((r) => r.get(
          'with x as (update meta set value = value + 7 where key=? returning 1) select 1 from x', 'ledger_seq'));
      } catch { executed = false; }
      expect(executed).toBe(true);
      expect(w.ledgerHead()).toBe(head0 + 7);
    } finally { finish(w, dir); }
  });

  test('【漏洞探针】journal 无触发器：读句柄 CTE-INSERT 成功 ⇒ 幽灵 journal 行且 ledger 无对应行', () => {
    const { w, dir } = mkWorld('r5r8-g-j-');
    try {
      const head0 = w.ledgerHead();
      let executed = true;
      try {
        w.kernel.port.read((r) => r.get(
          "with x as (insert into journal(tx_epoch, ns, oid, op) values(1, 'SP-G1', null, 'ghost-op') returning 1) select 1 from x"));
      } catch { executed = false; }
      expect(executed).toBe(true);
      const n = w.kernel.port.read((r) => (r.get("select count(*) c from journal where op='ghost-op'") as { c: number }).c);
      expect(n).toBe(1);
      expect(w.ledgerHead()).toBe(head0); // 没有 ledger 行对应这条 journal
    } finally { finish(w, dir); }
  });
});

describe('S-0E：触发器稳健性（未守卫面 world.raw，纵深防御核查）', () => {
  test('PRAGMA ignore_delete_triggers 实测不生效：DELETE 触发器仍 abort', () => {
    const { w, dir } = mkWorld('r5r8-g-k-');
    try {
      w.uow(ALICE, (tx) => tx.declareRecord({ recordId: 'REC-G2', eventType: 'synth:raw-intake', payload: { text: 'x' } }));
      w.raw.run('pragma ignore_delete_triggers = 1');
      let msg = '';
      try { w.raw.run('delete from records where record_id=?', 'REC-G2'); } catch (e) { msg = String((e as Error).message); }
      // 若此断言失败（delete 成功），则触发器可被 PRAGMA 旁路 ⇒ P0
      expect(msg).toContain('RECORD_MATERIAL_IMMUTABLE');
      const c = w.kernel.port.read((r) => (r.get('select count(*) c from records') as { c: number }).c);
      expect(c).toBe(1);
    } finally { finish(w, dir); }
  });
});
